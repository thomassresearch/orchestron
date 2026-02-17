from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


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

        csound = self._ctcsound.Csound()
        csound.setOption("-d")
        csound.setOption("-odac")
        csound.setOption(f"-M{midi_input}")
        csound.setOption(f"-+rtmidi={rtmidi_module}")

        compile_result = csound.compileCsdText(csd)
        if compile_result != 0:
            raise RuntimeError(f"CSound compile failed with code {compile_result}")

        start_result = csound.start()
        if start_result != 0:
            raise RuntimeError(f"CSound start failed with code {start_result}")

        self._csound = csound
        self._thread = threading.Thread(target=csound.perform, daemon=True, name="csound-perform")
        self._thread.start()

        return EngineStartResult(backend="ctcsound", detail="started with CSound")

    def _stop_ctcsound(self) -> None:
        if not self._csound:
            return

        try:
            self._csound.stop()
            self._csound.cleanup()
            self._csound.reset()
        except Exception:
            logger.exception("Failed to stop CSound cleanly")
        finally:
            self._csound = None
            self._thread = None

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
