from __future__ import annotations

import logging
import os
import re
import sys
import threading
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)

DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES = 128
DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES = 512


@dataclass(slots=True)
class EngineStartResult:
    backend: str
    detail: str


class CsoundWorker:
    def __init__(self) -> None:
        self._backend = "mock"
        self._csound = None
        self._thread: threading.Thread | None = None
        self._running = False
        self._lock = threading.Lock()

        force_mock = os.getenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "").strip().lower()
        if force_mock in {"1", "true", "yes", "on"}:
            self._ctcsound = None
            logger.info("VISUALCSOUND_FORCE_MOCK_ENGINE is set; using mock realtime engine")
            return

        try:
            import ctcsound  # type: ignore

            self._ctcsound = ctcsound
            self._backend = "ctcsound"
        except Exception:
            self._ctcsound = None
            logger.warning("ctcsound not available; using mock realtime engine")

    @property
    def backend(self) -> str:
        return self._backend

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def start(self, csd: str, midi_input: str, rtmidi_module: str) -> EngineStartResult:
        with self._lock:
            if self._running:
                return EngineStartResult(backend=self._backend, detail="already running")

            self._running = True
            try:
                if self._backend == "ctcsound":
                    result = self._start_ctcsound(csd, midi_input, rtmidi_module)
                else:
                    result = self._start_mock()
            except Exception:
                self._running = False
                raise

            return result

    def stop(self) -> str:
        with self._lock:
            if not self._running:
                return "already stopped"

            if self._backend == "ctcsound":
                self._stop_ctcsound()
            else:
                self._stop_mock()

            self._running = False
            return "stopped"

    def panic(self) -> str:
        with self._lock:
            if self._backend == "ctcsound" and self._csound is not None:
                try:
                    # Best-effort panic: turn off currently active instrument instances.
                    self._csound.inputMessage("turnoff2 1, 0, 1")
                    return "panic sent"
                except Exception:
                    logger.exception("Failed to send panic message to CSound")
                    return "panic failed"

            return "panic ignored (mock backend)"

    def _start_ctcsound(self, csd: str, midi_input: str, rtmidi_module: str) -> EngineStartResult:
        assert self._ctcsound is not None

        requested_module = self._normalize_rtmidi_module(rtmidi_module)
        if sys.platform == "darwin":
            requested_module = "coremidi"
        rtaudio_option = self._platform_rtaudio_option()
        attempts: list[str] = []
        errors: list[str] = []

        for module in self._rtmidi_candidates(requested_module):
            attempts.append(module)
            csound = self._ctcsound.Csound()
            try:
                software_buffer, hardware_buffer = self._extract_runtime_buffer_sizes(csd)
                runtime_csd = self._apply_runtime_midi_options(
                    csd,
                    midi_input=midi_input,
                    rtmidi_module=module,
                    rtaudio_option=rtaudio_option,
                )
                csound.setOption("-d")
                csound.setOption("-odac")
                csound.setOption(f"-b{software_buffer}")
                csound.setOption(f"-B{hardware_buffer}")
                csound.setOption(f"-M{midi_input}")
                csound.setOption(f"-+rtmidi={module}")
                if rtaudio_option:
                    csound.setOption(f"-+rtaudio={rtaudio_option}")

                compile_result = csound.compileCsdText(runtime_csd)
                if compile_result != 0:
                    raise RuntimeError(f"CSound compile failed with code {compile_result}")

                start_result = csound.start()
                if start_result != 0:
                    raise RuntimeError(f"CSound start failed with code {start_result}")
            except Exception as exc:
                errors.append(f"{module}: {exc}")
                self._teardown_csound(csound)
                logger.warning("CSound startup failed with rtmidi=%s: %s", module, exc)
                continue

            self._csound = csound
            self._thread = threading.Thread(target=csound.perform, daemon=True, name="csound-perform")
            self._thread.start()

            if module != requested_module:
                logger.warning(
                    "Requested rtmidi module '%s' unavailable; fell back to '%s'.",
                    requested_module,
                    module,
                )
                return EngineStartResult(
                    backend="ctcsound",
                    detail=f"started with CSound (rtmidi fallback: {module})",
                )

            return EngineStartResult(backend="ctcsound", detail="started with CSound")

        attempted = ", ".join(attempts)
        message = "; ".join(errors) if errors else "unknown startup error"
        raise RuntimeError(f"CSound start failed for all rtmidi modules ({attempted}): {message}")

    def _stop_ctcsound(self) -> None:
        if not self._csound:
            return

        try:
            self._teardown_csound(self._csound)
        except Exception:
            logger.exception("Failed to stop CSound cleanly")
        finally:
            self._csound = None
            self._thread = None

    @staticmethod
    def _teardown_csound(csound: object) -> None:
        for method_name in ("stop", "cleanup", "reset"):
            method = getattr(csound, method_name, None)
            if not callable(method):
                continue
            try:
                method()
            except Exception:
                # Cleanup is best-effort after a failed startup attempt.
                pass

    @staticmethod
    def _normalize_rtmidi_module(module: str) -> str:
        return module.strip().strip("'\"") if module else ""

    @classmethod
    def _rtmidi_candidates(cls, preferred: str) -> list[str]:
        candidates: list[str] = []
        for module in (preferred, *cls._platform_rtmidi_fallbacks()):
            normalized = cls._normalize_rtmidi_module(module)
            if normalized and normalized not in candidates:
                candidates.append(normalized)
        return candidates

    @staticmethod
    def _platform_rtaudio_option() -> str | None:
        if sys.platform == "darwin":
            return "auhal"
        return None

    @staticmethod
    def _platform_rtmidi_fallbacks() -> tuple[str, ...]:
        if sys.platform == "darwin":
            return ("coremidi", "portmidi", "virtual", "null", "cmidi")
        if sys.platform.startswith("linux"):
            return ("alsaseq", "portmidi", "virtual", "null", "cmidi")
        if sys.platform.startswith(("win32", "cygwin")):
            return ("winmme", "portmidi", "virtual", "null", "cmidi")
        return ("portmidi", "virtual", "null", "cmidi")

    @staticmethod
    def _apply_runtime_midi_options(
        csd: str,
        midi_input: str,
        rtmidi_module: str,
        rtaudio_option: str | None = None,
    ) -> str:
        lines: list[str] = []
        in_options = False
        option_parts: list[str] = []

        for line in csd.splitlines():
            stripped = line.strip()
            if stripped == "<CsOptions>":
                in_options = True
                option_parts = []
                lines.append(line)
                continue
            if stripped == "</CsOptions>":
                in_options = False
                existing_options = " ".join(option_parts)
                if not CsoundWorker._contains_option_with_int(existing_options, "b"):
                    option_parts.append(f"-b {DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES}")
                if not CsoundWorker._contains_option_with_int(existing_options, "B"):
                    option_parts.append(f"-B{DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES}")
                option_parts.append(f"-M{midi_input}")
                option_parts.append(f"-+rtmidi={rtmidi_module}")
                if rtaudio_option:
                    option_parts.append(f"-+rtaudio={rtaudio_option}")
                lines.append(" ".join(option_parts).strip())
                lines.append(line)
                continue

            if not in_options:
                lines.append(line)
                continue

            cleaned = re.sub(r"(^|\s)-M\S+", " ", line)
            cleaned = re.sub(r"(^|\s)-\+rtmidi=\S+", " ", cleaned)
            if rtaudio_option:
                cleaned = re.sub(r"(^|\s)-\+rtaudio=\S+", " ", cleaned)
            cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
            if cleaned:
                option_parts.append(cleaned)

        return "\n".join(lines)

    @staticmethod
    def _contains_option_with_int(options: str, flag: str) -> bool:
        pattern = rf"(^|\s)-{re.escape(flag)}(?:\s+\d+|\d+)(?=\s|$)"
        return re.search(pattern, options) is not None

    @classmethod
    def _extract_runtime_buffer_sizes(cls, csd: str) -> tuple[int, int]:
        options = cls._extract_csoptions_text(csd)
        software = cls._extract_numeric_option(options, "b")
        hardware = cls._extract_numeric_option(options, "B")

        if software is None or software < 1:
            software = DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES
        if hardware is None or hardware < 1:
            hardware = DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES

        return software, hardware

    @staticmethod
    def _extract_csoptions_text(csd: str) -> str:
        match = re.search(r"<CsOptions>(.*?)</CsOptions>", csd, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            return ""
        return match.group(1)

    @staticmethod
    def _extract_numeric_option(options: str, flag: str) -> int | None:
        pattern = rf"(?:^|\s)-{re.escape(flag)}(?:\s+(\d+)|(\d+))(?=\s|$)"
        match = re.search(pattern, options)
        if not match:
            return None

        value = match.group(1) or match.group(2)
        if value is None:
            return None
        try:
            return int(value)
        except ValueError:
            return None

    def _start_mock(self) -> EngineStartResult:
        self._thread = threading.Thread(target=self._mock_loop, daemon=True, name="mock-csound")
        self._thread.start()
        return EngineStartResult(
            backend="mock",
            detail=(
                "Mock audio engine started. Install ctcsound for realtime synthesis: "
                "uv pip install ctcsound"
            ),
        )

    def _stop_mock(self) -> None:
        # The loop checks _running; clearing it is enough.
        self._thread = None

    def _mock_loop(self) -> None:
        while True:
            with self._lock:
                if not self._running:
                    return
            time.sleep(0.1)
