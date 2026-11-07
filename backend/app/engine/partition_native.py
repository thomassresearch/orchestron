"""One exclusively owned native instance, without session clocks or schedulers."""
from __future__ import annotations

import ctypes
from functools import partial

import numpy as np

from backend.app.engine.csound_worker import CsoundWorker


def configure_audio_abi(library, width):
    """Some ctcsound wheels incorrectly declare audio pointers as int pointers.

    Use the verified native MYFLT width, just as the direct binding does. This
    correction is local to an explicitly created partition/probe instance.
    """
    scalar = ctypes.c_double if width == 8 else ctypes.c_float
    for name in ("csoundGetAudioChannel", "csoundSetAudioChannel"):
        function = getattr(library, name)
        function.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(scalar)]
        function.restype = None
    library.csoundGet0dBFS.argtypes = [ctypes.c_void_p]
    library.csoundGet0dBFS.restype = scalar


class NativePartitionError(RuntimeError):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code


class NativeCsoundPartition:
    def __init__(self, module, csd, engine, sample_bytes):
        self.cs = module.Csound()
        self.pending = bytearray()
        self.callbacks = []
        self.output_buffer = None
        try:
            width = int(self.cs.sizeOfMYFLT())
            if width != sample_bytes or width not in (4, 8):
                raise RuntimeError("Plan/native sample ABI mismatch.")
            # The direct wrapper explicitly uses double for *all* native methods.
            if type(self.cs).__name__ == "DirectCsound" and width != 8:
                raise RuntimeError("Direct binding requires native float64.")
            for name in ("audioChannel", "setAudioChannel"):
                if not callable(getattr(self.cs, name, None)):
                    raise RuntimeError("Native binding lacks audio-channel bridge APIs.")
            self.dtype = np.dtype("float64" if width == 8 else "float32")
            configure_audio_abi(module.libcsound, width)
            self._library = module.libcsound
            self._midi_callbacks(module)
            csd = CsoundWorker._apply_headless_runtime_options(csd, "internal:loopback", "null", suppress_messages=True)
            if self.cs.compileCsdText(csd) != 0:
                raise NativePartitionError("compile", "Native partition failed to compile.")
            if self.cs.start() != 0:
                raise NativePartitionError("start", "Native partition failed to start.")
            self.cs.setMessageLevel(0)
            if (self.cs.sr(), self.cs.ksmps(), self.cs.nchnls()) != (engine.sample_rate, engine.ksmps, engine.channels):
                raise RuntimeError("Partition does not retain full-performance engine settings.")
            output = np.asarray(self.cs.spout())
            if output.dtype != self.dtype:
                raise RuntimeError("Binding sample dtype disagrees with native ABI.")
            if output.size != engine.ksmps * engine.channels or not output.flags.c_contiguous:
                raise RuntimeError("Binding output buffer disagrees with native format.")
            # Start allocates spout for this fixed-format native lifetime. Borrow
            # its view once; read only after performKsmps, never after reset.
            self.output_buffer = output.reshape(engine.ksmps, engine.channels)
            if module.libcsound.csoundGet0dBFS(self.cs.cs) != engine.zero_dbfs:
                raise RuntimeError("Partition does not retain full-performance 0dbfs.")
        except BaseException:
            self.close()
            raise

    def bind_audio_transfer(self, name, values, *, into_csound):
        """Bind a validated, epoch-owned shared view to the existing copy API.

        Csound still copies each block through Get/SetAudioChannel. Only name
        encoding, numpy validation and pointer construction move out of the hot
        loop. The partial retains the array through its ctypes pointer.
        """
        if (values.dtype != self.dtype or values.shape != (self.cs.ksmps(),)
                or not values.flags.c_contiguous or not values.flags.writeable):
            raise ValueError("Invalid persistent audio-channel buffer.")
        scalar = ctypes.c_double if self.dtype.itemsize == 8 else ctypes.c_float
        function = self._library.csoundSetAudioChannel if into_csound else self._library.csoundGetAudioChannel
        return partial(function, self.cs.cs, name.encode(), values.ctypes.data_as(ctypes.POINTER(scalar)))

    def bind_meter_reader(self, name):
        # Only generated meter channels are borrowed. Their fixed control type
        # and storage last until reset; this same child thread owns all DSP and
        # reads them after performKsmps. Never send a native pointer to the parent.
        scalar = ctypes.c_double if self.dtype.itemsize == 8 else ctypes.c_float
        pointer = ctypes.POINTER(scalar)()
        function = self._library.csoundGetChannelPtr
        function.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(scalar)), ctypes.c_char_p, ctypes.c_int]
        function.restype = ctypes.c_int
        # Csound channel enum: CONTROL=1, OUTPUT=32.
        if function(self.cs.cs, ctypes.byref(pointer), name.encode(), 1 | 32) != 0 or not pointer:
            raise RuntimeError("Cannot bind native meter channel.")
        return lambda: pointer[0]

    def _midi_callbacks(self, module):
        def read(_cs, _user, destination, capacity):
            count = min(len(self.pending), max(0, capacity))
            if count:
                ctypes.memmove(destination, bytes(self.pending[:count]), count)
                del self.pending[:count]
            return count

        read_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int)
        opened = module.MIDIINOPENFUNC(lambda *_: 0)
        closed = module.MIDIINCLOSEFUNC(lambda *_: 0)
        reader = read_type(read)
        self.callbacks.extend((opened, closed, reader))
        self.cs.setHostImplementedMIDIIO(True)
        self.cs.setExternalMidiInOpenCallback(opened)
        self.cs.setExternalMidiInCloseCallback(closed)
        module.libcsound.csoundSetExternalMidiReadCallback.argtypes = [ctypes.c_void_p, read_type]
        module.libcsound.csoundSetExternalMidiReadCallback(self.cs.cs, reader)

    def perform(self, midi, controls):
        if self.pending:
            raise RuntimeError("Previous sealed MIDI block was not consumed.")
        self.pending.extend(byte for message in midi for byte in message)
        for name, value in controls:
            self.cs.setControlChannel(name, value)
        if self.cs.performKsmps() != 0:
            raise RuntimeError("Native partition ended before the requested block completed.")

    def close(self):
        self.output_buffer = None
        cs, self.cs = self.cs, None
        if cs is not None:
            try:
                cs.stop()
            finally:
                try:
                    cs.cleanup()
                finally:
                    cs.reset()

