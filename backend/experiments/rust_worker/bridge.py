"""Retained Rust worker loop, now the default for parallel synthesis batches."""
from __future__ import annotations

import ctypes as C
from functools import partial
from pathlib import Path
import os

import numpy as np

from backend.app.engine.csound_process import native_float32_mode, run_csound_process
from backend.experiments.rust_worker.build import default_library


def worker_implementation():
    mode = os.environ.get("VISUALCSOUND_PARALLEL_WORKER", "rust").strip().lower()
    if mode not in {"rust", "python"}:
        raise ValueError("VISUALCSOUND_PARALLEL_WORKER must be rust or python (deprecated).")
    return mode


def default_batch_factory(**kwargs):
    if worker_implementation() == "python":
        return None  # DEPRECATED: explicit rollback/comparison only; remove after migration.
    return RustBatchLoop(library=default_library(), **kwargs)


class Bus(C.Structure):
    _fields_ = [("name", C.c_char_p), ("slots", C.c_void_p * 2)]


class Config(C.Structure):
    _fields_ = [("cs", C.c_void_p), ("ksmps", C.c_size_t), ("max_blocks", C.c_size_t),
        ("inputs", C.POINTER(Bus)), ("input_count", C.c_size_t),
        ("outputs", C.POINTER(Bus)), ("output_count", C.c_size_t),
        ("meter_ptrs", C.POINTER(C.c_void_p)), ("meter_count", C.c_size_t),
        ("meters", C.c_void_p * 2), ("final_audio", C.c_void_p * 2),
        ("pcm", C.c_void_p * 2), ("spout", C.c_void_p),
        *[(name, C.c_void_p) for name in ("perform", "set_audio", "get_audio", "set_control", "set_read")]]


class Control(C.Structure):
    _fields_ = [("name", C.c_char_p), ("value", C.c_double)]


class Events(C.Structure):
    _fields_ = [("midi", C.c_char_p), ("midi_len", C.c_size_t),
                ("controls", C.POINTER(Control)), ("control_count", C.c_size_t)]


ERRORS = {1: "Invalid Rust batch bounds", 2: "Previous sealed MIDI block was not consumed.",
    3: "Native partition ended before the requested block completed.",
    4: "Partition output exceeds float32 PCM range.", 5: "Native partition produced nonfinite audio/meters.",
    6: "Reentrant Rust batch"}


class RustBatchLoop:
    def __init__(self, *, library, instance, engine, inputs, outputs, meter_views, meter_names,
                 final_views, pcm_views, mode_views):
        if instance.dtype != np.dtype("float64") or engine.channels != 2:
            raise RuntimeError("Rust parallel worker requires native float64 stereo; no silent Python fallback.")
        self.handle = None
        self.lib = C.CDLL(str(Path(library).resolve(strict=True)))
        self.lib.worker_abi.restype = C.c_uint32
        if self.lib.worker_abi() != 1:
            raise RuntimeError("Rust parallel worker ABI mismatch")
        self.lib.worker_create.argtypes, self.lib.worker_create.restype = [C.POINTER(Config)], C.c_void_p
        self.lib.worker_render.argtypes = [C.c_void_p, C.c_size_t, C.c_size_t, C.POINTER(Events)]
        self.lib.worker_render.restype = C.c_int
        self.lib.worker_destroy.argtypes, self.lib.worker_destroy.restype = [C.c_void_p], None
        self._refs = (instance, inputs, outputs, meter_views, final_views, pcm_views, mode_views)
        self.mode_views = mode_views
        self.mode = None
        self.blocks = len(inputs[0])

        def buses(views):
            result = (Bus * len(views[0][0]))()
            for i, (name, _) in enumerate(views[0][0]):
                pointers = []
                for slot in views:
                    base = slot[0][i][1].ctypes.data
                    for block, connections in enumerate(slot):
                        channel, values = connections[i]
                        if (channel != name or values.dtype != instance.dtype or values.shape != (engine.ksmps,)
                                or not values.flags.c_contiguous or not values.flags.writeable
                                or values.ctypes.data != base + block * engine.ksmps * 8):
                            raise ValueError("Invalid Rust shared audio layout")
                    pointers.append(base)
                result[i] = Bus(name.encode(), (C.c_void_p * 2)(*pointers))
            return result

        def pointers(views, shape, dtype):
            if not views:
                return (C.c_void_p * 2)()
            for view in views:
                if (view.shape != shape or view.dtype != dtype or not view.flags.c_contiguous
                        or not view.flags.writeable):
                    raise ValueError("Invalid Rust shared output layout")
            return (C.c_void_p * 2)(*(view.ctypes.data for view in views))

        self.inputs, self.outputs = buses(inputs), buses(outputs)
        self.meter_ptrs = (C.c_void_p * len(meter_names))()
        get_ptr = instance._library.csoundGetChannelPtr
        get_ptr.argtypes = [C.c_void_p, C.POINTER(C.c_void_p), C.c_char_p, C.c_int]
        get_ptr.restype = C.c_int
        for index, name in enumerate(meter_names):
            pointer = C.c_void_p()
            if get_ptr(instance.cs.cs, C.byref(pointer), name.encode(), 1 | 32) != 0 or not pointer.value:
                raise RuntimeError("Cannot bind Rust meter channel")
            self.meter_ptrs[index] = pointer.value
        frames = self.blocks * engine.ksmps
        self.config = Config(instance.cs.cs, engine.ksmps, self.blocks,
            self.inputs, len(self.inputs), self.outputs, len(self.outputs), self.meter_ptrs, len(meter_names),
            pointers(meter_views, (self.blocks, len(meter_names)), np.dtype("float64")),
            pointers(final_views, (frames, 2), np.dtype("float64")),
            pointers(pcm_views, (frames, 2), np.dtype("float32")),
            instance.output_buffer.ctypes.data if final_views else None,
            *(C.cast(getattr(instance._library, name), C.c_void_p).value for name in (
                "csoundPerformKsmps", "csoundSetAudioChannel", "csoundGetAudioChannel", "csoundSetControlChannel",
                "csoundSetExternalMidiReadCallback")))
        self.handle = self.lib.worker_create(C.byref(self.config))
        if not self.handle:
            raise RuntimeError("Cannot initialize Rust batch loop")

    def render(self, slot, block_count, deliveries):
        if not self.handle or slot not in (0, 1) or not 1 <= block_count <= self.blocks:
            raise ValueError("Invalid Rust batch bounds")
        events = None
        if deliveries is not None:
            if len(deliveries) != block_count:
                raise ValueError("Rust batch event count mismatch")
            events = (Events * block_count)()
            for index, delivery in enumerate(deliveries):
                midi = bytes(byte for event in delivery.midi for byte in event.message)
                controls = (Control * len(delivery.controls))(
                    *(Control(c.channel.encode(), c.value) for c in delivery.controls))
                # ctypes retains both buffers through the containing structure.
                events[index] = Events(midi, len(midi), controls, len(controls))
        code = self.lib.worker_render(self.handle, slot, block_count, events)
        if code:
            raise RuntimeError(ERRORS.get(code, f"Unknown Rust worker status {code}"))
        if self.mode_views:
            if self.mode is None:
                self.mode = native_float32_mode()
            self.mode_views[slot][0] = self.mode

    def close(self):
        if self.handle:
            self.lib.worker_destroy(self.handle)
            self.handle = None
        self._refs = ()


def run_rust_worker(*args, library, **kwargs):
    """Explicit library override retained for controlled experiments."""
    run_csound_process(*args, _batch_factory=partial(RustBatchLoop, library=library), **kwargs)


def _python_batch_factory(**kwargs):
    # DEPRECATED: preserve the original loop for rollback and honest A/B comparisons.
    return None


def run_python_worker(*args, **kwargs):
    """Deprecated Python parallel worker; never selected implicitly by library failure."""
    run_csound_process(*args, _batch_factory=_python_batch_factory, **kwargs)
