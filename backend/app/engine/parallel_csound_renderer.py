"""Internal execution coordinator used by the opt-in session renderer.

Only an explicit caller can start it with a validated coarse compilation. The
default factory returns CsoundWorker. The T06 facade owns live operations and
next-start fallback; T07 owns admission and performance selection.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import multiprocessing
from multiprocessing.connection import wait
import threading
import time
from typing import Callable

import numpy as np
from pydantic import Field

from backend.app.engine.browser_audio_pcm import resample_stereo_block_linear
from backend.app.engine.csound_process import run_csound_process
from backend.app.engine.realtime_renderer import EngineRenderResult
from backend.app.engine.render_ipc import (
    FINAL_BUS, SharedArena, build_layout, expected_done, slots_for, validate_envelope,
)
from backend.app.models.render_protocol import (
    Contract, ControlWrite, EngineFormat, Error, Init, MidiDelivery, Ready, Render, RendererPolicy, Stop,
)
from backend.app.services.compiler_partitioned import validate_realtime_partition_compilation

MAX_REQUEST_FRAMES = 192_000


class PartitionRuntimeError(RuntimeError):
    """The epoch is unusable; the caller must discard this entire PCM request."""


class PartitionCancelled(PartitionRuntimeError):
    pass


class BlockInputs(Contract):
    """Already drained/gated parent events; callbacks execute once before sealing."""
    midi: tuple[MidiDelivery, ...] = Field(default=(), max_length=16384)
    controls: tuple[ControlWrite, ...] = Field(default=(), max_length=16384)
    control_revision: int = Field(default=0, ge=0)


@dataclass
class _Child:
    process: object
    command_ready: object
    reply_ready: object
    regions: object
    identity: dict
    busy: bool = False


class PartitionRenderCoordinator:
    """One render owner, one sealed block, and an all-predecessor completion barrier.

    prepare_block(index, S) is a trusted, nonblocking parent callback. It must not
    recursively call lifecycle/render methods. No callback is sent to a child.
    Cancellation cannot forcibly interrupt arbitrary Python code in that callback.
    """
    def __init__(self, *, policy=None, _worker_target=run_csound_process):
        self.policy = policy or RendererPolicy()
        self._target = _worker_target
        self._context = multiprocessing.get_context("spawn")
        self._operation = threading.Lock()
        self._state = threading.Lock()
        self._cancel = threading.Event()
        self._external_cancel = None
        self._stop_serial = 0
        self._stoppers = 0
        self._children = {}
        self._arena = None
        self._layout = None
        self._running = False
        self.epoch = 0
        self.committed_sample = self.sealed_sample = self.published_sample = 0
        self._sequence = self._revision = 0
        self._meter_frames = []
        self._next_meter_sample = 0
        self.last_meters = {}

    @property
    def is_running(self):
        return self._running and not self._cancel.is_set()

    @property
    def render_sample_cursor(self):
        return self.committed_sample

    @property
    def process_ids(self):
        """Internal diagnostics, never a public session response."""
        return tuple(child.process.pid for child in self._children.values())

    @property
    def worker_count(self):
        return len(self._children)

    @property
    def shared_memory_name(self):
        return self._arena.name if self._arena is not None else None

    def _check(self, deadline):
        if self._cancel.is_set() or (self._external_cancel is not None and self._external_cancel.is_set()):
            raise PartitionCancelled("Partition operation cancelled.")
        if time.monotonic() >= deadline:
            raise PartitionRuntimeError("Partition operation timed out.")

    def _send(self, child, message, data=None):
        if child.busy or child.reply_ready.acquire(False):
            raise PartitionRuntimeError("Duplicate/unsolicited partition completion.")
        self._arena.send(child.regions.command, data or self._arena.encode(message, child.regions.command))
        child.busy = True
        child.command_ready.release()

    def _check_quiescent(self):
        for child in self._children.values():
            if not child.process.is_alive():
                raise PartitionRuntimeError("Partition exited outside its completion barrier.")
            if child.busy or child.reply_ready.acquire(False):
                raise PartitionRuntimeError("Duplicate/unsolicited partition completion.")

    def _collect(self, expected, deadline):
        pending = dict(expected)
        while pending:
            self._check(deadline)
            for identity, wanted in tuple(pending.items()):
                self._check(deadline)
                child = self._children[identity]
                if child.reply_ready.acquire(timeout=min(.005, max(0, deadline - time.monotonic()))):
                    received = self._arena.receive(child.regions.reply)
                    validate_envelope(received, child.identity)
                    if isinstance(received, Error):
                        raise PartitionRuntimeError(f"Partition {identity} {received.code}: {received.detail}")
                    if received != wanted:
                        raise PartitionRuntimeError("Partition completion does not match sealed interval/artifact.")
                    child.busy = False
                    del pending[identity]
                if not child.process.is_alive():
                    raise PartitionRuntimeError(f"Partition {identity} exited unexpectedly.")

    @contextmanager
    def _start_ownership(self):
        # Start cannot wait indefinitely behind an arbitrary parent callback,
        # including one whose cancellation has already timed out.
        if not self._operation.acquire(blocking=False):
            raise PartitionRuntimeError("A partition operation still owns the renderer; Stop must finish before Start.")
        try:
            yield
        finally:
            self._operation.release()

    def start(self, compilation, plan, *, cancel_event=None):
        with self._state:
            if self._stoppers:
                raise PartitionCancelled("Start cancelled by concurrent Stop.")
            serial = self._stop_serial
        with self._start_ownership():
            with self._state:
                if self._stoppers or serial != self._stop_serial:
                    raise PartitionCancelled("Start cancelled by concurrent Stop.")
                if self._running or self._children or self._arena is not None:
                    raise PartitionRuntimeError("Stop and reap the previous partition epoch before starting.")
                self._cancel = threading.Event()
                self._external_cancel = cancel_event
                self.epoch += 1
                self.committed_sample = self.sealed_sample = self.published_sample = 0
                self._sequence = self._revision = self._next_meter_sample = 0
                self._meter_frames.clear()
                self.last_meters = {}
            deadline = time.monotonic() + self.policy.startup_timeout_seconds
            try:
                self._check(deadline)
                validate_realtime_partition_compilation(compilation, plan)
                if not compilation.programs or plan.layout != "coarse":
                    raise ValueError("Explicit partition execution requires a coarse compilation.")
                if len(compilation.programs) > self.policy.max_workers or plan.graph.engine.channels != 2:
                    raise ValueError("Unsupported partition worker count or output format.")
                self._plan, self._compilation = plan, compilation
                self._format = EngineFormat(sample_rate=plan.graph.engine.sample_rate, ksmps=plan.graph.engine.ksmps,
                    zero_dbfs=plan.graph.engine.zero_dbfs, native_sample_type="float64" if plan.sample_bytes == 8 else "float32")
                self._layout = build_layout(compilation, plan, self.epoch,
                    limit=min(self.policy.max_shared_memory_bytes, plan.shared_audio_limit))
                self._arena = SharedArena(size=self._layout.size)
                for identity, regions in self._layout.workers.items():
                    self._arena.write(regions.bootstrap, self._layout.bootstraps[identity])
                # Allocate/reuse views before rendering, including the final stereo output.
                for region in (*self._layout.audio.values(), *(r.meters for r in self._layout.workers.values())):
                    for slot in (0, 1):
                        self._arena.audio(region, slot)
                ready = {}
                for program in compilation.programs:
                    self._check(deadline)
                    regions = self._layout.workers[program.id]
                    command, reply = self._context.Semaphore(0), self._context.Semaphore(0)
                    envelope = dict(protocol_version=1, epoch=self.epoch, partition_id=program.id, plan_hash=plan.plan_hash)
                    process = self._context.Process(target=self._target, name=f"csound-{program.id}", daemon=True,
                        args=(self._arena.name, self._arena.size, regions.bootstrap, regions.bootstrap_hash, command, reply))
                    child = _Child(process, command, reply, regions, envelope)
                    self._children[program.id] = child
                    process.start()
                    init = Init(**envelope, artifact_hash=compilation.artifact_hash, engine=self._format)
                    self._send(child, init)
                    ready[program.id] = Ready(**envelope, artifact_hash=compilation.artifact_hash, engine=self._format)
                self._collect(ready, deadline)
                self._check_quiescent()
                with self._state:
                    self._check(deadline)
                    self._running = True
            except BaseException:
                self._invalidate_and_cleanup()
                raise

    def render_blocks(self, *, block_count, target_sample_rate, prepare_block: Callable | None = None):
        if (type(block_count) is not int or block_count < 1 or type(target_sample_rate) is not int
                or not 8000 <= target_sample_rate <= 192000):
            raise ValueError("Invalid partition render request size/rate.")
        epoch = self.epoch
        with self._operation:
            if not self.is_running or epoch != self.epoch:
                raise PartitionCancelled("Partition epoch is not running.")
            frames = block_count * self._format.ksmps
            if frames > MAX_REQUEST_FRAMES:
                raise ValueError("Partition render request exceeds frame capacity.")
            start = self.committed_sample
            pcm = np.empty((frames, 2), dtype=np.float32)
            try:
                for index in range(block_count):
                    deadline = time.monotonic() + self.policy.render_timeout_seconds
                    self._check(deadline)
                    sample = self.committed_sample
                    inputs = prepare_block(index, sample) if prepare_block is not None else BlockInputs(control_revision=self._revision)
                    if not isinstance(inputs, BlockInputs):
                        raise ValueError("Parent preparation must return BlockInputs.")
                    if inputs.control_revision < self._revision:
                        raise ValueError("Control revision moved backwards.")
                    all_controls = {name for p in self._compilation.programs for name in p.controls}
                    if (len({c.channel for c in inputs.controls}) != len(inputs.controls)
                            or any(c.channel not in all_controls for c in inputs.controls)):
                        raise ValueError("Unknown or uncoalesced parent control write.")
                    descriptors = {}
                    for program in self._compilation.programs:
                        buses = tuple(b for b, _ in (*program.inputs, *program.outputs))
                        if program.owns_output:
                            buses += (FINAL_BUS,)
                        child = self._children[program.id]
                        message = Render(**child.identity, sequence=self._sequence, sample_start=sample,
                            frame_count=self._format.ksmps, control_revision=inputs.control_revision,
                            slots=slots_for(buses, self._sequence), midi=inputs.midi,
                            controls=tuple(c for c in inputs.controls if c.channel in program.controls))
                        # Reject any oversized descriptor BEFORE dispatching any worker.
                        descriptors[program.id] = (message, self._arena.encode(message, child.regions.command))
                    self._check(deadline)
                    self._check_quiescent()
                    self.sealed_sample = sample + self._format.ksmps
                    completed = set()
                    while len(completed) < len(self._children):
                        wave = [p for p in self._plan.partitions if p.id not in completed
                                and all(pred in completed for pred in p.predecessors)]
                        if not wave:
                            raise PartitionRuntimeError("Partition dependency barrier cannot advance.")
                        expected = {}
                        for partition in wave:
                            message, encoded = descriptors[partition.id]
                            self._send(self._children[partition.id], message, encoded)
                            expected[partition.id] = expected_done(message)
                        self._collect(expected, deadline)
                        completed.update(expected)
                    self._check(deadline)
                    self._check_quiescent()
                    slot = self._sequence % 2
                    output = self._arena.audio(self._layout.audio[FINAL_BUS], slot)
                    meters = {name: float(value) for p in self._compilation.programs
                              for name, value in zip(p.meters, self._arena.audio(self._layout.workers[p.id].meters, slot), strict=True)}
                    if not np.isfinite(output).all() or not all(np.isfinite(v) for v in meters.values()):
                        raise PartitionRuntimeError("Partition output contains nonfinite audio/meters.")
                    converted = pcm[index * self._format.ksmps:(index + 1) * self._format.ksmps]
                    with np.errstate(over="ignore"):
                        converted[:] = output
                    if not np.isfinite(converted).all():
                        raise PartitionRuntimeError("Partition output exceeds float32 PCM range.")
                    with self._state:
                        self._check(deadline)
                        self.committed_sample = self.sealed_sample
                        self._sequence += 1
                        self._revision = inputs.control_revision
                        self.last_meters = meters
                        if self.committed_sample >= self._next_meter_sample:
                            self._meter_frames.append({"engineSample": self.committed_sample, "channels": meters})
                            self._meter_frames = self._meter_frames[-32:]
                            self._next_meter_sample = self.committed_sample + max(1, self._format.sample_rate // 15)
                # Keep the single renderer's conversion/resampling order: float32
                # engine blocks, then exactly one resample per completed request.
                pcm = resample_stereo_block_linear(pcm, source_sample_rate=self._format.sample_rate,
                                                   target_sample_rate=target_sample_rate)
                result = EngineRenderResult(start, self.committed_sample, self._format.sample_rate, target_sample_rate,
                                           2, block_count, len(pcm), np.asarray(pcm, dtype="<f4").tobytes())
                with self._state:
                    self._check(deadline)
                    self.published_sample = self.committed_sample
                    return result
            except BaseException:
                self._invalidate_and_cleanup()
                raise

    def drain_meter_frames(self):
        with self._state:
            frames, self._meter_frames = self._meter_frames, []
            return frames

    def stop(self):
        # Signal before waiting for render ownership, so a native hang or a
        # queued multi-block request cannot defer Stop indefinitely.
        with self._state:
            self._stop_serial += 1
            self._stoppers += 1
            self._cancel.set()
            self._running = False
        try:
            if not self._operation.acquire(timeout=self.policy.stop_timeout_seconds * 2):
                raise PartitionRuntimeError("Parent preparation has not yielded; cleanup remains owned by that operation.")
            try:
                self._invalidate_and_cleanup()
            finally:
                self._operation.release()
        finally:
            with self._state:
                self._stoppers -= 1

    def _invalidate_and_cleanup(self):
        self._running = False
        self._cancel.set()
        self.epoch += 1
        with self._state:
            self._meter_frames.clear()
            self.last_meters = {}
        deadline = time.monotonic() + self.policy.stop_timeout_seconds
        for child in self._children.values():
            if child.process.pid is not None and child.process.is_alive() and not child.busy:
                stop = Stop(**child.identity)
                self._arena.send(child.regions.command, self._arena.encode(stop, child.regions.command))
                child.command_ready.release()

        def join_until(end):
            alive = [c.process for c in self._children.values() if c.process.pid is not None and c.process.is_alive()]
            while alive and time.monotonic() < end:
                wait([p.sentinel for p in alive], timeout=max(0, end - time.monotonic()))
                alive = [p for p in alive if p.is_alive()]
            return alive

        alive = join_until(deadline - self.policy.stop_timeout_seconds * .5)
        for process in alive:
            process.terminate()
        alive = join_until(deadline - self.policy.stop_timeout_seconds * .25)
        for process in alive:
            process.kill()
        alive = join_until(deadline)
        if alive:
            # Retain handles and arena for a later Stop. Never advertise clean
            # rollback/fallback while an old native owner is still alive.
            raise PartitionRuntimeError("Partition process could not be reaped; epoch remains quarantined.")
        for child in self._children.values():
            if child.process.pid is not None:
                child.process.join(timeout=0)
            child.process.close()
        self._children.clear()
        if self._arena is not None:
            self._arena.close()
            self._arena = None
        self._layout = None
