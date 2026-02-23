from __future__ import annotations

import asyncio
import ctypes
import logging
import os
import re
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any

from backend.app.engine.webrtc_audio import (
    WEBRTC_AUDIO_SAMPLE_RATE,
    CsoundAudioFrameBuffer,
    CsoundWebRtcAudioBridge,
)

logger = logging.getLogger(__name__)

DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES = 128
DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES = 512


@dataclass(slots=True)
class EngineStartResult:
    backend: str
    detail: str
    audio_mode: str = "local"
    audio_stream_ready: bool = False
    audio_stream_sample_rate: int | None = None


class CsoundWorker:
    def __init__(
        self,
        *,
        webrtc_ice_servers: list[dict[str, Any]] | None = None,
        gen_audio_assets_dir: str | None = None,
    ) -> None:
        self._backend = "mock"
        self._audio_output_mode = self._resolve_audio_output_mode(
            os.getenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "local")
        )
        self._webrtc_ice_servers = [dict(server) for server in (webrtc_ice_servers or [])]
        configured_assets_dir = (gen_audio_assets_dir or os.getenv("VISUALCSOUND_GEN_AUDIO_ASSETS_DIR", "")).strip()
        self._gen_audio_assets_dir = os.path.abspath(configured_assets_dir) if configured_assets_dir else None
        self._csound: Any | None = None
        self._thread: threading.Thread | None = None
        self._running = False
        self._lock = threading.Lock()
        self._audio_frame_buffer: CsoundAudioFrameBuffer | None = None
        self._audio_bridge: CsoundWebRtcAudioBridge | None = None
        self._streaming_block_seconds = 0.0
        self._host_midi_enabled = False
        self._host_midi_buffer = bytearray()
        self._host_midi_lock = threading.Lock()
        self._host_midi_callbacks: dict[str, Any] = {}

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
    def audio_output_mode(self) -> str:
        return self._audio_output_mode

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    @property
    def browser_audio_stream_sample_rate(self) -> int | None:
        if self._audio_output_mode != "streaming":
            return None
        return WEBRTC_AUDIO_SAMPLE_RATE

    @property
    def browser_audio_streaming_ready(self) -> bool:
        return (
            self._audio_output_mode == "streaming"
            and self._backend == "ctcsound"
            and self._audio_bridge is not None
            and self._running
        )

    @property
    def accepts_direct_midi(self) -> bool:
        return self._backend == "ctcsound" and self._host_midi_enabled and self._running

    def start(self, csd: str, midi_input: str, rtmidi_module: str) -> EngineStartResult:
        with self._lock:
            if self._running:
                return EngineStartResult(
                    backend=self._backend,
                    detail="already running",
                    audio_mode=self._audio_output_mode,
                    audio_stream_ready=self.browser_audio_streaming_ready,
                    audio_stream_sample_rate=self.browser_audio_stream_sample_rate,
                )

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

    async def create_webrtc_audio_answer(self, *, offer_sdp: str, offer_type: str) -> tuple[str, str]:
        if self._audio_output_mode != "streaming":
            raise ValueError("Browser audio streaming is disabled (VISUALCSOUND_AUDIO_OUTPUT_MODE=local).")
        if self._backend != "ctcsound":
            raise RuntimeError("Browser audio streaming requires the ctcsound backend.")
        if not self.is_running:
            raise RuntimeError("Session must be running before negotiating browser audio.")

        bridge = self._audio_bridge
        if bridge is None:
            raise RuntimeError("Browser audio stream is not ready for this session.")
        return await bridge.create_answer(offer_sdp=offer_sdp, offer_type=offer_type)

    async def close_webrtc_audio(self) -> None:
        bridge = self._audio_bridge
        self._audio_bridge = None
        frame_buffer = self._audio_frame_buffer
        self._audio_frame_buffer = None
        if frame_buffer is not None:
            frame_buffer.close()
        if bridge is not None:
            await bridge.close()

    def queue_midi_message(self, message: list[int]) -> bool:
        if len(message) != 3:
            return False
        if not self.accepts_direct_midi:
            return False
        with self._host_midi_lock:
            self._host_midi_buffer.extend(int(value) & 0xFF for value in message)
        return True

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
        if self._audio_output_mode == "streaming":
            return self._start_ctcsound_streaming(csd, midi_input, rtmidi_module)
        return self._start_ctcsound_local(csd, midi_input, rtmidi_module)

    def _start_ctcsound_local(self, csd: str, midi_input: str, rtmidi_module: str) -> EngineStartResult:
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
                self._apply_gen_audio_search_dir_option(csound)

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
                    audio_mode=self._audio_output_mode,
                )

            return EngineStartResult(
                backend="ctcsound",
                detail="started with CSound",
                audio_mode=self._audio_output_mode,
            )

        attempted = ", ".join(attempts)
        message = "; ".join(errors) if errors else "unknown startup error"
        raise RuntimeError(f"CSound start failed for all rtmidi modules ({attempted}): {message}")

    def _start_ctcsound_streaming(self, csd: str, midi_input: str, rtmidi_module: str) -> EngineStartResult:
        assert self._ctcsound is not None

        requested_module = self._normalize_rtmidi_module(rtmidi_module)
        if sys.platform == "darwin":
            requested_module = "coremidi"
        attempts: list[str] = []
        errors: list[str] = []

        for module in self._streaming_rtmidi_candidates(requested_module):
            attempts.append(module)
            csound = self._ctcsound.Csound()
            try:
                software_buffer, hardware_buffer = self._extract_runtime_buffer_sizes(csd)
                runtime_csd = self._apply_streaming_runtime_options(
                    csd,
                    midi_input=midi_input,
                    rtmidi_module=module,
                )

                csound.setOption("-d")
                csound.setOption("-n")
                csound.setOption(f"-b{software_buffer}")
                csound.setOption(f"-B{hardware_buffer}")
                csound.setOption(f"-M{midi_input}")
                csound.setOption(f"-+rtmidi={module}")
                self._apply_gen_audio_search_dir_option(csound)
                self._configure_host_midi_callbacks(csound)

                compile_result = csound.compileCsdText(runtime_csd)
                if compile_result != 0:
                    raise RuntimeError(f"CSound compile failed with code {compile_result}")

                start_result = csound.start()
                if start_result != 0:
                    raise RuntimeError(f"CSound start failed with code {start_result}")

                source_sr = self._resolve_runtime_sr(csound, runtime_csd)
                source_nchnls = self._resolve_runtime_nchnls(csound, runtime_csd)
                source_ksmps = self._resolve_runtime_ksmps(csound, runtime_csd)
                frame_buffer = CsoundAudioFrameBuffer(
                    source_sample_rate=source_sr,
                    source_channels=source_nchnls,
                    target_sample_rate=WEBRTC_AUDIO_SAMPLE_RATE,
                )
                audio_bridge = CsoundWebRtcAudioBridge(frame_buffer, ice_servers=self._webrtc_ice_servers)
            except Exception as exc:
                errors.append(f"{module}: {exc}")
                self._teardown_csound(csound)
                logger.warning("CSound streaming startup failed with rtmidi=%s: %s", module, exc)
                continue

            self._csound = csound
            self._audio_frame_buffer = frame_buffer
            self._audio_bridge = audio_bridge
            self._streaming_block_seconds = (
                float(source_ksmps) / float(source_sr) if source_sr > 0 and source_ksmps > 0 else 0.0
            )
            self._host_midi_enabled = True
            self._thread = threading.Thread(
                target=self._streaming_perform_loop,
                daemon=True,
                name="csound-perform-ksmps",
            )
            self._thread.start()

            if module != requested_module:
                logger.warning(
                    "Requested rtmidi module '%s' unavailable; fell back to '%s'.",
                    requested_module,
                    module,
                )
                return EngineStartResult(
                    backend="ctcsound",
                    detail=f"started with CSound browser streaming (rtmidi fallback: {module})",
                    audio_mode=self._audio_output_mode,
                    audio_stream_ready=True,
                    audio_stream_sample_rate=WEBRTC_AUDIO_SAMPLE_RATE,
                )

            return EngineStartResult(
                backend="ctcsound",
                detail="started with CSound browser streaming",
                audio_mode=self._audio_output_mode,
                audio_stream_ready=True,
                audio_stream_sample_rate=WEBRTC_AUDIO_SAMPLE_RATE,
            )

        attempted = ", ".join(attempts)
        message = "; ".join(errors) if errors else "unknown startup error"
        raise RuntimeError(f"CSound streaming start failed for all rtmidi modules ({attempted}): {message}")

    def _streaming_perform_loop(self) -> None:
        next_deadline: float | None = None
        while True:
            with self._lock:
                if not self._running or self._csound is None:
                    return
                csound = self._csound
                bridge = self._audio_bridge
                block_seconds = self._streaming_block_seconds

            try:
                result = csound.performKsmps()
                if bridge is not None:
                    bridge.push_csound_block(csound.spout())
            except Exception:
                logger.exception("CSound performKsmps streaming loop failed")
                with self._lock:
                    self._running = False
                return

            if result != 0:
                logger.info("CSound performKsmps exited with status %s", result)
                with self._lock:
                    self._running = False
                return

            if block_seconds > 0.0:
                now = time.perf_counter()
                if next_deadline is None or (now - next_deadline) > 0.5:
                    # Re-anchor after startup and after long stalls to avoid burst catch-up.
                    next_deadline = now
                next_deadline += block_seconds
                sleep_seconds = next_deadline - now
                if sleep_seconds > 0.0:
                    time.sleep(sleep_seconds)

    def _stop_ctcsound(self) -> None:
        bridge = self._audio_bridge
        frame_buffer = self._audio_frame_buffer

        if frame_buffer is not None:
            frame_buffer.close()

        if bridge is not None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                try:
                    asyncio.run(bridge.close())
                except Exception:
                    logger.exception("Failed to close WebRTC bridge during CSound shutdown")
            else:
                loop.create_task(bridge.close())

        self._audio_bridge = None
        self._audio_frame_buffer = None
        self._streaming_block_seconds = 0.0
        self._host_midi_enabled = False
        self._host_midi_callbacks = {}
        with self._host_midi_lock:
            self._host_midi_buffer.clear()

        if not self._csound:
            return

        try:
            self._teardown_csound(self._csound)
        except Exception:
            logger.exception("Failed to stop CSound cleanly")
        finally:
            self._csound = None
            self._thread = None

    def _apply_gen_audio_search_dir_option(self, csound: Any) -> None:
        if not self._gen_audio_assets_dir:
            return
        csound.setOption(f"--env:SSDIR={self._gen_audio_assets_dir}")

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

    def _configure_host_midi_callbacks(self, csound: Any) -> None:
        if self._ctcsound is None:
            return

        self._host_midi_enabled = False
        with self._host_midi_lock:
            self._host_midi_buffer.clear()

        ct = self._ctcsound
        raw_midi_read_func = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int)
        raw_midi_write_func = ctypes.CFUNCTYPE(
            ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int
        )

        def _midi_in_open(_csound_ptr: object, user_data_ptr: object, _dev_name: bytes | None) -> int:
            try:
                if user_data_ptr is not None:
                    user_data_ptr[0] = None  # type: ignore[index]
            except Exception:
                pass
            return 0

        def _midi_in_close(_csound_ptr: object, _user_data: object) -> int:
            return 0

        def _midi_out_open(_csound_ptr: object, user_data_ptr: object, _dev_name: bytes | None) -> int:
            try:
                if user_data_ptr is not None:
                    user_data_ptr[0] = None  # type: ignore[index]
            except Exception:
                pass
            return 0

        def _midi_out_close(_csound_ptr: object, _user_data: object) -> int:
            return 0

        def _midi_read(_csound_ptr: object, _user_data: object, buffer_ptr: object, nbytes: int) -> int:
            count = max(0, int(nbytes))
            if count <= 0:
                return 0
            with self._host_midi_lock:
                available = len(self._host_midi_buffer)
                if available <= 0:
                    return 0
                read_count = min(count, available)
                chunk = bytes(self._host_midi_buffer[:read_count])
                del self._host_midi_buffer[:read_count]
            ctypes.memmove(buffer_ptr, chunk, read_count)
            return read_count

        def _midi_write(_csound_ptr: object, _user_data: object, _buffer_ptr: object, _nbytes: int) -> int:
            # Output MIDI from CSound is not currently consumed by the app.
            return 0

        callbacks = {
            "in_open": ct.MIDIINOPENFUNC(_midi_in_open),
            "in_close": ct.MIDIINCLOSEFUNC(_midi_in_close),
            "out_open": ct.MIDIOUTOPENFUNC(_midi_out_open),
            "out_close": ct.MIDIOUTCLOSEFUNC(_midi_out_close),
            # ctcsound's MIDIREADFUNC / MIDIWRITEFUNC wrappers use c_char_p for the buffer
            # parameter, which is unsuitable for writable binary MIDI data in Python callbacks.
            # Register raw callbacks with a void* buffer to copy bytes into Csound's buffer.
            "read": raw_midi_read_func(_midi_read),
            "write": raw_midi_write_func(_midi_write),
        }
        self._host_midi_callbacks = callbacks

        csound.setHostImplementedMIDIIO(True)
        csound.setExternalMidiInOpenCallback(callbacks["in_open"])
        csound.setExternalMidiInCloseCallback(callbacks["in_close"])
        csound.setExternalMidiOutOpenCallback(callbacks["out_open"])
        csound.setExternalMidiOutCloseCallback(callbacks["out_close"])
        ct.libcsound.csoundSetExternalMidiReadCallback.argtypes = [ctypes.c_void_p, raw_midi_read_func]
        ct.libcsound.csoundSetExternalMidiReadCallback(csound.cs, callbacks["read"])
        ct.libcsound.csoundSetExternalMidiWriteCallback.argtypes = [ctypes.c_void_p, raw_midi_write_func]
        ct.libcsound.csoundSetExternalMidiWriteCallback(csound.cs, callbacks["write"])

    @staticmethod
    def _normalize_rtmidi_module(module: str) -> str:
        return module.strip().strip("'\"") if module else ""

    @staticmethod
    def _resolve_audio_output_mode(raw_value: str) -> str:
        value = (raw_value or "").strip().lower()
        if value in {"streaming", "browser", "webrtc"}:
            return "streaming"
        if value and value not in {"local"}:
            logger.warning("Unknown VISUALCSOUND_AUDIO_OUTPUT_MODE '%s'; using local", raw_value)
        return "local"

    @classmethod
    def _rtmidi_candidates(cls, preferred: str) -> list[str]:
        candidates: list[str] = []
        for module in (preferred, *cls._platform_rtmidi_fallbacks()):
            normalized = cls._normalize_rtmidi_module(module)
            if normalized and normalized not in candidates:
                candidates.append(normalized)
        return candidates

    @classmethod
    def _streaming_rtmidi_candidates(cls, preferred: str) -> list[str]:
        # Streaming mode uses host-implemented MIDI callbacks, so prefer the "null" backend
        # to avoid depending on an OS MIDI subsystem inside the container.
        candidates: list[str] = []
        for module in ("null", preferred, *cls._platform_rtmidi_fallbacks()):
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

    @classmethod
    def _apply_streaming_runtime_options(
        cls,
        csd: str,
        midi_input: str,
        rtmidi_module: str,
    ) -> str:
        runtime_csd = cls._apply_runtime_midi_options(
            csd,
            midi_input=midi_input,
            rtmidi_module=rtmidi_module,
            rtaudio_option=None,
        )
        return cls._rewrite_csoptions_for_no_audio_output(runtime_csd)

    @staticmethod
    def _rewrite_csoptions_for_no_audio_output(csd: str) -> str:
        lines: list[str] = []
        in_options = False
        option_parts: list[str] = []

        def _clean_audio_flags(text: str) -> str:
            cleaned = text
            cleaned = re.sub(r"(^|\s)-odac(?=\s|$)", " ", cleaned)
            cleaned = re.sub(r"(^|\s)-iadc(?=\s|$)", " ", cleaned)
            cleaned = re.sub(r"(^|\s)-n(?=\s|$)", " ", cleaned)
            cleaned = re.sub(r"(^|\s)-o(?:\s+\S+|\S+)(?=\s|$)", " ", cleaned)
            cleaned = re.sub(r"(^|\s)-i(?:\s+\S+|\S+)(?=\s|$)", " ", cleaned)
            cleaned = re.sub(r"(^|\s)-\+rtaudio=\S+", " ", cleaned)
            cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
            return cleaned

        for line in csd.splitlines():
            stripped = line.strip()
            if stripped == "<CsOptions>":
                in_options = True
                option_parts = []
                lines.append(line)
                continue
            if stripped == "</CsOptions>":
                in_options = False
                option_parts.append("-n")
                lines.append(" ".join(part for part in option_parts if part).strip())
                lines.append(line)
                continue

            if not in_options:
                lines.append(line)
                continue

            cleaned = _clean_audio_flags(line)
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

    @classmethod
    def _resolve_runtime_sr(cls, csound: object, runtime_csd: str) -> int:
        numeric = cls._invoke_numeric_member(csound, ("sr", "GetSr", "getSr"))
        if numeric is not None and numeric > 0:
            return numeric
        parsed = cls._extract_orchestra_numeric_scalar(runtime_csd, "sr")
        if parsed is not None and parsed > 0:
            return parsed
        return WEBRTC_AUDIO_SAMPLE_RATE

    @classmethod
    def _resolve_runtime_nchnls(cls, csound: object, runtime_csd: str) -> int:
        numeric = cls._invoke_numeric_member(csound, ("nchnls", "GetNchnls", "getNchnls"))
        if numeric is not None and numeric > 0:
            return numeric
        parsed = cls._extract_orchestra_numeric_scalar(runtime_csd, "nchnls")
        if parsed is not None and parsed > 0:
            return parsed
        return 2

    @classmethod
    def _resolve_runtime_ksmps(cls, csound: object, runtime_csd: str) -> int:
        numeric = cls._invoke_numeric_member(csound, ("ksmps", "GetKsmps", "getKsmps"))
        if numeric is not None and numeric > 0:
            return numeric
        parsed = cls._extract_orchestra_numeric_scalar(runtime_csd, "ksmps")
        if parsed is not None and parsed > 0:
            return parsed
        return 32

    @staticmethod
    def _invoke_numeric_member(csound: object, candidate_names: tuple[str, ...]) -> int | None:
        for name in candidate_names:
            member = getattr(csound, name, None)
            if member is None:
                continue
            try:
                value = member() if callable(member) else member
            except Exception:
                continue
            try:
                numeric = int(round(float(value)))
            except (TypeError, ValueError):
                continue
            return numeric
        return None

    @staticmethod
    def _extract_orchestra_numeric_scalar(csd: str, name: str) -> int | None:
        pattern = rf"(?mi)^\s*{re.escape(name)}\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*$"
        match = re.search(pattern, csd)
        if not match:
            return None
        try:
            return int(round(float(match.group(1))))
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
            audio_mode=self._audio_output_mode,
            audio_stream_ready=False,
            audio_stream_sample_rate=self.browser_audio_stream_sample_rate,
        )

    def _stop_mock(self) -> None:
        # The loop checks _running; clearing it is enough.
        self._thread = None
        self._audio_frame_buffer = None
        self._audio_bridge = None
        self._streaming_block_seconds = 0.0

    def _mock_loop(self) -> None:
        while True:
            with self._lock:
                if not self._running:
                    return
            time.sleep(0.1)
