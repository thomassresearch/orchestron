"""Experiment-only POSIX adapter. Application builds and sessions never import it."""
from __future__ import annotations

import ctypes as ct
import json
from pathlib import Path
import sys
import time

from pydantic import TypeAdapter

from backend.app.engine.parallel_csound_renderer import (
    BlockInputs, PartitionCancelled, PartitionRenderCoordinator, PartitionRuntimeError,
)
from backend.app.engine.render_ipc import MailboxCapacityError

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[2]
OUTPUT = ROOT / "output/rust-coordinator"
LIBRARY = OUTPUT / "target/release" / (
    "libcoordinator_probe.dylib" if sys.platform == "darwin" else "libcoordinator_probe.so"
)
SPARSE = TypeAdapter(list[tuple[int, BlockInputs]])
CANCEL = ct.CFUNCTYPE(ct.c_bool)


class RustCoordinator(PartitionRenderCoordinator):
    def __init__(self, *, library=LIBRARY, **kwargs):
        super().__init__(**kwargs)
        if sys.platform not in ("darwin", "linux"):
            raise RuntimeError("This experiment requires POSIX multiprocessing on macOS or Linux")
        self._lib = ct.CDLL(str(library))
        ptr, size, data = ct.c_void_p, ct.c_size_t, ct.c_char_p
        self._lib.coord_new.argtypes = [data, size, ptr, size, ptr]
        self._lib.coord_new.restype = ptr
        self._lib.coord_free.argtypes = [ptr]
        self._lib.coord_free.restype = None
        self._lib.coord_prepare.argtypes = [ptr, ct.c_uint64, ct.c_uint64, ct.c_uint64, size, data, size, ptr]
        self._lib.coord_execute.argtypes = [ptr, ct.c_uint64, CANCEL, ptr, size, ct.c_int, ptr]
        self._error = ct.create_string_buffer(2048)
        self._native = None
        self._cancelled = CANCEL(self._is_cancelled)
        self.native_batches = 0

    def _is_cancelled(self):
        return self._cancel.is_set() or (self._external_cancel is not None and self._external_cancel.is_set())

    def _bind(self):
        # First batch, under the normal render operation lock. Borrow only from
        # this epoch. Child objects retain every fd/semaphore until coord_free.
        base = ct.addressof(ct.c_char.from_buffer(self._arena.memory.buf))
        programs = {p.id: (p, sorted(buses), sorted(controls)) for p, buses, controls in self._render_programs}
        self._ordered = [self._children[pid] for wave in self._waves for pid in wave]
        workers = []
        for child in self._ordered:
            pid = child.identity["partition_id"]
            program, buses, controls = programs[pid]
            reply = child.reply_ready
            meters = child.regions.meters.region
            workers.append(dict(
                id=pid, buses=buses, controls=controls, channels=sorted(self._sample_channels[pid]),
                token=list(child.codec.token), sentinel=child.process.sentinel,
                command=[child.regions.command.offset, child.regions.command.size],
                reply=[child.regions.reply.offset, child.regions.reply.size],
                meter_offset=[meters.offset, meters.offset + meters.size // 2], meter_count=len(program.meters),
                command_sem=child.command_ready._semlock.handle,
                reply_sem=getattr(reply, "fence", reply)._semlock.handle,
                reply_fd=reply.reader.fileno() if hasattr(reply, "reader") else None,
            ))
        cfg = json.dumps(dict(epoch=self.epoch, plan=self._plan.plan_hash, workers=workers,
                              edges=[s._semlock.handle for s in self._dependency_fences.values()],
                              ksmps=self._format.ksmps, max_blocks=self._batch_blocks,
                              pcm=[v.ctypes.data - base for v in self._pcm_views],
                              mode=[v.ctypes.data - base for v in self._mode_views])).encode()
        self._native = self._lib.coord_new(cfg, len(cfg), base, self._arena.size, self._error)
        if not self._native:
            raise PartitionRuntimeError(self._error.value.decode(errors="replace"))

    def _render_prepared(self, inputs, pcm, request_start, deadline):
        if self._native is None:
            self._bind()
        sample, revision = self.committed_sample, self._revision
        sparse = []
        for i, step in enumerate(inputs):
            if step.midi or step.controls or step.samples or step.control_revision != revision:
                sparse.append((i, step))
            revision = step.control_revision
        payload = SPARSE.dump_json(sparse) if sparse else b""
        count = self._lib.coord_prepare(self._native, self._sequence, sample, self._revision,
                                        len(inputs), payload, len(payload), self._error)
        if count < 0:
            message = self._error.value.decode(errors="replace")
            if "mailbox capacity" in message:
                raise MailboxCapacityError(message)
            raise PartitionRuntimeError(message)
        self._check(deadline)
        frames = count * self._format.ksmps
        self.sealed_sample = sample + frames
        for child in self._ordered:
            child.busy = True  # On failure, cleanup must reap before reusing a mailbox.
        destination = pcm[sample - request_start:self.sealed_sample - request_start]
        mode = self._lib.coord_execute(self._native, max(0, int((deadline-time.monotonic()) * 1e9)),
                                       self._cancelled, destination.ctypes.data, destination.size,
                                       -1 if self._float32_mode is None else self._float32_mode, self._error)
        if mode < 0:
            if self._is_cancelled():
                raise PartitionCancelled("Partition operation cancelled")
            raise PartitionRuntimeError(self._error.value.decode(errors="replace"))
        for child in self._ordered:
            child.busy = False
        slot = self._sequence % 2

        def meters_at(index):
            return {name: float(value) for names, values in self._meter_views[slot]
                    for name, value in zip(names, values[index], strict=True)}

        with self._state:
            self._check(deadline)
            # Rust checked every row. Materialize Python dicts only for meter
            # snapshots that callers can observe under this same lock.
            step = self._format.ksmps
            index = max(0, (self._next_meter_sample - sample - 1) // step)
            last = None
            while index < count:
                at = sample + (index + 1) * step
                levels = meters_at(index)
                self._meter_frames.append({"engineSample": at, "channels": levels})
                if index == count - 1:
                    last = levels
                self._next_meter_sample = at + max(1, self._format.sample_rate // 15)
                index = (self._next_meter_sample - sample - 1) // step
            del self._meter_frames[:-32]
            self.last_meters = meters_at(count - 1) if last is None else last
            self.committed_sample = self.sealed_sample
            self._revision = inputs[count - 1].control_revision
            self._float32_mode = mode
            self._sequence += 1
            self.native_batches += 1
        return count

    def _invalidate_and_cleanup(self):
        if self._native is not None:
            self._lib.coord_free(self._native)
            self._native = None
        self._ordered = ()
        super()._invalidate_and_cleanup()
