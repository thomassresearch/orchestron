from __future__ import annotations

import ctypes
import ctypes.util
import importlib
import logging
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from typing import Any

logger = logging.getLogger(__name__)

MYFLT = ctypes.c_double
MIDIINOPENFUNC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_char_p)
MIDIINCLOSEFUNC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
MIDIOUTOPENFUNC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_char_p)
MIDIOUTCLOSEFUNC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)


class _PrefixedSymbolLibrary:
    def __init__(self, library: ctypes.CDLL) -> None:
        self._library = library

    def __getattr__(self, name: str) -> Any:
        try:
            return getattr(self._library, name)
        except AttributeError:
            if name.startswith("_"):
                raise
            return getattr(self._library, f"_{name}")


def load_ctcsound_module() -> Any:
    try:
        return _import_stock_ctcsound()
    except Exception as exc:
        if sys.platform != "darwin":
            raise
        logger.info("Stock ctcsound import failed on macOS; using direct Csound binding: %s", exc)
        return _load_direct_ctcsound_module()


def _import_stock_ctcsound() -> Any:
    return importlib.import_module("ctcsound")


def _load_direct_ctcsound_module() -> Any:
    libcsound = _load_csound_library()
    _configure_libcsound_signatures(libcsound)
    return SimpleNamespace(
        Csound=_build_direct_csound_class(libcsound),
        MIDIINOPENFUNC=MIDIINOPENFUNC,
        MIDIINCLOSEFUNC=MIDIINCLOSEFUNC,
        MIDIOUTOPENFUNC=MIDIOUTOPENFUNC,
        MIDIOUTCLOSEFUNC=MIDIOUTCLOSEFUNC,
        libcsound=libcsound,
    )


def _load_csound_library() -> _PrefixedSymbolLibrary:
    errors: list[str] = []
    mode = getattr(ctypes, "RTLD_GLOBAL", 0)
    for candidate in _candidate_csound_library_paths():
        try:
            return _PrefixedSymbolLibrary(ctypes.CDLL(candidate, mode=mode))
        except OSError as exc:
            errors.append(f"{candidate}: {exc}")
    attempted = ", ".join(_candidate_csound_library_paths())
    detail = "; ".join(errors) if errors else "no library candidates were found"
    raise RuntimeError(f"Failed to load Csound runtime ({attempted}): {detail}")


def _candidate_csound_library_paths() -> list[str]:
    raw_candidates = [
        os.getenv("VISUALCSOUND_CSOUNDLIB_PATH"),
        ctypes.util.find_library("CsoundLib64"),
        "/opt/homebrew/Frameworks/CsoundLib64.framework/CsoundLib64",
        "/usr/local/Frameworks/CsoundLib64.framework/CsoundLib64",
        "/Library/Frameworks/CsoundLib64.framework/CsoundLib64",
    ]
    candidates: list[str] = []
    seen: set[str] = set()
    for raw in raw_candidates:
        if not raw:
            continue
        candidate = raw.strip()
        if not candidate or candidate in seen:
            continue
        if "/" in candidate and not Path(candidate).exists():
            continue
        seen.add(candidate)
        candidates.append(candidate)
    return candidates


def _configure_libcsound_signatures(libcsound: _PrefixedSymbolLibrary) -> None:
    libcsound.csoundCreate.restype = ctypes.c_void_p
    libcsound.csoundCreate.argtypes = [ctypes.py_object]
    libcsound.csoundDestroy.argtypes = [ctypes.c_void_p]

    libcsound.csoundSetOption.restype = ctypes.c_int
    libcsound.csoundSetOption.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    libcsound.csoundCompileCsdText.restype = ctypes.c_int
    libcsound.csoundCompileCsdText.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    libcsound.csoundStart.restype = ctypes.c_int
    libcsound.csoundStart.argtypes = [ctypes.c_void_p]
    libcsound.csoundPerformKsmps.restype = ctypes.c_int
    libcsound.csoundPerformKsmps.argtypes = [ctypes.c_void_p]
    libcsound.csoundStop.argtypes = [ctypes.c_void_p]
    libcsound.csoundCleanup.argtypes = [ctypes.c_void_p]
    libcsound.csoundReset.argtypes = [ctypes.c_void_p]
    libcsound.csoundInputMessage.restype = ctypes.c_int
    libcsound.csoundInputMessage.argtypes = [ctypes.c_void_p, ctypes.c_char_p]

    libcsound.csoundGetSr.restype = MYFLT
    libcsound.csoundGetSr.argtypes = [ctypes.c_void_p]
    libcsound.csoundGetNchnls.restype = ctypes.c_int
    libcsound.csoundGetNchnls.argtypes = [ctypes.c_void_p]
    libcsound.csoundGetKsmps.restype = ctypes.c_int
    libcsound.csoundGetKsmps.argtypes = [ctypes.c_void_p]
    libcsound.csoundGetSpout.restype = ctypes.POINTER(MYFLT)
    libcsound.csoundGetSpout.argtypes = [ctypes.c_void_p]

    libcsound.csoundSetHostImplementedMIDIIO.argtypes = [ctypes.c_void_p, ctypes.c_int]
    libcsound.csoundSetExternalMidiInOpenCallback.argtypes = [ctypes.c_void_p, MIDIINOPENFUNC]
    libcsound.csoundSetExternalMidiInCloseCallback.argtypes = [ctypes.c_void_p, MIDIINCLOSEFUNC]
    libcsound.csoundSetExternalMidiOutOpenCallback.argtypes = [ctypes.c_void_p, MIDIOUTOPENFUNC]
    libcsound.csoundSetExternalMidiOutCloseCallback.argtypes = [ctypes.c_void_p, MIDIOUTCLOSEFUNC]

    libcsound.csoundGetControlChannel.restype = MYFLT
    libcsound.csoundGetControlChannel.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]
    libcsound.csoundSetControlChannel.argtypes = [ctypes.c_void_p, ctypes.c_char_p, MYFLT]


def _build_direct_csound_class(libcsound: _PrefixedSymbolLibrary) -> type:
    class DirectCsound:
        def __init__(self, hostData: object | None = None, pointer_: object | None = None) -> None:
            self.fromPointer = pointer_ is not None
            self.cs = pointer_ if pointer_ is not None else libcsound.csoundCreate(hostData)
            self.extMidiInOpenCbRef: object | None = None
            self.extMidiInCloseCbRef: object | None = None
            self.extMidiOutOpenCbRef: object | None = None
            self.extMidiOutCloseCbRef: object | None = None
            if not self.cs:
                raise RuntimeError("csoundCreate returned a null pointer.")

        def __del__(self) -> None:
            if getattr(self, "fromPointer", False):
                return
            csound_ptr = getattr(self, "cs", None)
            if csound_ptr:
                try:
                    libcsound.csoundDestroy(csound_ptr)
                except Exception:
                    pass

        @staticmethod
        def _cstring(value: str) -> bytes:
            return value.encode("utf-8")

        @staticmethod
        def _callback_ref(function: object, callback_type: object) -> object:
            if isinstance(function, ctypes._CFuncPtr):  # type: ignore[attr-defined]
                return function
            return callback_type(function)

        def setOption(self, option: str) -> int:  # noqa: N802
            return int(libcsound.csoundSetOption(self.cs, self._cstring(option)))

        def compileCsdText(self, csd: str) -> int:  # noqa: N802
            return int(libcsound.csoundCompileCsdText(self.cs, self._cstring(csd)))

        def start(self) -> int:
            return int(libcsound.csoundStart(self.cs))

        def perform(self) -> int:
            while True:
                status = self.performKsmps()
                if status != 0:
                    return status

        def performKsmps(self) -> int:  # noqa: N802
            return int(libcsound.csoundPerformKsmps(self.cs))

        def stop(self) -> None:
            libcsound.csoundStop(self.cs)

        def cleanup(self) -> int:
            return int(libcsound.csoundCleanup(self.cs))

        def reset(self) -> None:
            libcsound.csoundReset(self.cs)

        def inputMessage(self, message: str) -> int:  # noqa: N802
            return int(libcsound.csoundInputMessage(self.cs, self._cstring(message)))

        def sr(self) -> float:
            return float(libcsound.csoundGetSr(self.cs))

        def nchnls(self) -> int:
            return int(libcsound.csoundGetNchnls(self.cs))

        def ksmps(self) -> int:
            return int(libcsound.csoundGetKsmps(self.cs))

        def spout(self) -> Any:
            import numpy as np  # type: ignore

            size = max(0, self.ksmps() * self.nchnls())
            if size <= 0:
                return np.zeros((0,), dtype=np.float64)
            buffer = libcsound.csoundGetSpout(self.cs)
            return np.ctypeslib.as_array(buffer, shape=(size,))

        def setHostImplementedMIDIIO(self, state: bool) -> None:  # noqa: N802
            libcsound.csoundSetHostImplementedMIDIIO(self.cs, int(bool(state)))

        def setExternalMidiInOpenCallback(self, function: object) -> None:  # noqa: N802
            self.extMidiInOpenCbRef = self._callback_ref(function, MIDIINOPENFUNC)
            libcsound.csoundSetExternalMidiInOpenCallback(self.cs, self.extMidiInOpenCbRef)

        def setExternalMidiInCloseCallback(self, function: object) -> None:  # noqa: N802
            self.extMidiInCloseCbRef = self._callback_ref(function, MIDIINCLOSEFUNC)
            libcsound.csoundSetExternalMidiInCloseCallback(self.cs, self.extMidiInCloseCbRef)

        def setExternalMidiOutOpenCallback(self, function: object) -> None:  # noqa: N802
            self.extMidiOutOpenCbRef = self._callback_ref(function, MIDIOUTOPENFUNC)
            libcsound.csoundSetExternalMidiOutOpenCallback(self.cs, self.extMidiOutOpenCbRef)

        def setExternalMidiOutCloseCallback(self, function: object) -> None:  # noqa: N802
            self.extMidiOutCloseCbRef = self._callback_ref(function, MIDIOUTCLOSEFUNC)
            libcsound.csoundSetExternalMidiOutCloseCallback(self.cs, self.extMidiOutCloseCbRef)

        def controlChannel(self, name: str) -> tuple[float, int]:
            err = ctypes.c_int()
            value = libcsound.csoundGetControlChannel(self.cs, self._cstring(name), ctypes.byref(err))
            return (float(value), int(err.value))

        def setControlChannel(self, name: str, value: float) -> None:
            libcsound.csoundSetControlChannel(self.cs, self._cstring(name), MYFLT(float(value)))

    return DirectCsound
