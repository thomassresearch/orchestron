"""Session facade over the T05 coordinator, with the original worker as fallback.

The parent inherits the existing scheduler, controller state, lane gate and
boundary queue. Children own DSP only. Default construction still uses the plain
CsoundWorker, whose render loop is unchanged.
"""
from __future__ import annotations

import threading

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.parallel_csound_renderer import (
    BlockInputs, MAX_REQUEST_FRAMES, PartitionCancelled, PartitionRenderCoordinator, PartitionRuntimeError,
)
from backend.app.engine.realtime_renderer import EngineStartResult
from backend.app.models.render_protocol import ControlWrite, MidiDelivery
from backend.app.services.compiler_common import CompilationError
from backend.app.services.render_partition_plan import plan_render_partitions


class ParallelCsoundRenderer(CsoundWorker):
    def __init__(self, *, options, coordinator_factory=PartitionRenderCoordinator, **kwargs):
        super().__init__(**kwargs)
        self.options = options
        self._coordinator = coordinator_factory(policy=options.policy)
        self._render_lock = threading.RLock()
        self._lifecycle_guard = threading.Lock()
        self._generation = 0
        self._cancel_start = threading.Event()
        self._stopping = 0
        self._parallel = False
        self._candidate = None
        self._canonical_csd = None
        self._fallback_reason = None
        self._quarantined = False
        self.fatal_error = None
        self._failure_diagnostics = None
        self._control_revision = 0

    def prepare(self, compiler, targets, graph, mixer, canonical):
        """Called after canonical validation, outside rendering, under session lifecycle ownership."""
        if self.is_running:
            raise RuntimeError("Stop before preparing a renderer.")
        self._candidate = None
        self._canonical_csd = canonical.csd
        self._fallback_reason = None
        if self._quarantined and self.options.policy.mode == "auto":
            self._fallback_reason = "previous_parallel_failure"
        elif self.backend == "mock":
            self._fallback_reason = "native_backend_unavailable"
        elif not self.options.allow_unqualified:
            self._fallback_reason = "parallel_not_qualified"
        else:
            try:
                self._prepare_candidate(compiler, targets, graph, mixer, canonical)
            except Exception as exc:
                # Canonical validation has already succeeded. Only optional
                # partition preparation can be abandoned in favour of that CSD.
                self._fallback_reason = f"parallel_prepare_failed: {str(exc)[:512]}"
                if self.options.policy.mode == "parallel":
                    raise CompilationError([self._fallback_reason]) from exc

    def _prepare_candidate(self, compiler, targets, graph, mixer, canonical):
        dependency = compiler.analyze_realtime_graph(targets, graph)
        costs = self.options.costs(dependency) if self.options.costs is not None else None
        plan = plan_render_partitions(dependency, policy=self.options.policy, costs=costs)
        if plan.layout != "coarse":
            self._fallback_reason = ",".join(d.code for d in plan.diagnostics)
        else:
            compilation = compiler.compile_realtime_partitions(targets, graph, mixer, plan)
            if compilation.canonical.orc != canonical.orc or compilation.canonical.manifest != canonical.manifest:
                raise ValueError("Parallel compilation does not match the canonical session artifact.")
            self._candidate = (compilation, plan)

    @property
    def renderer_diagnostics(self):
        if self._failure_diagnostics is not None:
            return dict(self._failure_diagnostics)
        return {
            "requested": self.options.policy.mode,
            "selected": "parallel" if self._parallel else "single",
            "worker_count": self._coordinator.worker_count if self._parallel else int(self.is_running),
            "qualified": False,
            "fallback_reason": self._fallback_reason,
            "failed": self.fatal_error is not None,
            "committed_sample": self._coordinator.committed_sample if self._parallel else self.render_sample_cursor,
            "published_sample": self._coordinator.published_sample if self._parallel else self.render_sample_cursor,
        }

    @property
    def render_sample_cursor(self):
        return self._coordinator.committed_sample if self._parallel else self._render_sample_cursor

    def request_stop(self):
        """Nonblocking intent, also usable while session Start owns its lifecycle lock."""
        with self._lifecycle_guard:
            self._generation += 1
            self._cancel_start.set()

    def _check_start(self, generation):
        if generation != self._generation or self._cancel_start.is_set():
            raise PartitionCancelled("Session start/render cancelled.")

    @property
    def start_generation(self):
        return self._generation

    def start(self, csd, midi_input, rtmidi_module, *, expected_generation=None):
        with self._lifecycle_guard:
            if self._stopping or (expected_generation is not None and expected_generation != self._generation):
                raise PartitionCancelled("Session is stopping.")
            if self.is_running:
                return EngineStartResult(self.backend, "already running")
            generation = self._generation
            cancel = self._cancel_start = threading.Event()
        with self._render_lock:
            self._check_start(generation)
            if self.is_running:
                return EngineStartResult(self.backend, "already running")
            if self._coordinator.process_ids or self._coordinator.shared_memory_name is not None:
                raise PartitionRuntimeError("Previous parallel owners must be reaped before restart/fallback.")
            if csd != self._canonical_csd:
                raise ValueError("Session renderer requires the current prepared canonical artifact.")
            self.fatal_error = None
            self._failure_diagnostics = None
            self._parallel = False
            if self._candidate is not None and not (self._quarantined and self.options.policy.mode == "auto"):
                try:
                    self._coordinator.start(*self._candidate, cancel_event=cancel)
                    self._check_start(generation)
                except Exception as exc:
                    self._coordinator.stop()
                    self._check_start(generation)
                    if self.options.policy.mode != "auto":
                        raise
                    self._fallback_reason = f"parallel_start_failed: {str(exc)[:512]}"
                    self._quarantined = True
                else:
                    _, plan = self._candidate
                    with self._lock:
                        self._runtime_sr = plan.graph.engine.sample_rate
                        self._runtime_ksmps = plan.graph.engine.ksmps
                        self._runtime_nchnls = 2
                        self._render_sample_cursor = 0
                        self._midi_scheduler.reset()
                        self._midi_scheduler.set_engine_sample_rate(self._runtime_sr)
                        self._host_midi_enabled = True
                        self._parallel = self._running = True
                    with self._mixer_lock:
                        self._control_pending.clear()
                        self._control_revision = 0
                    return EngineStartResult("ctcsound", "started with parallel Csound processes (unqualified)")
            elif self.options.policy.mode == "parallel":
                raise PartitionRuntimeError(f"Parallel rendering unavailable: {self._fallback_reason or 'no candidate'}")
            self._check_start(generation)
            try:
                result = super().start(csd, midi_input, rtmidi_module)
                self._check_start(generation)
                return result
            except Exception as exc:
                super().stop()
                self._check_start(generation)
                if self._fallback_reason:
                    raise PartitionRuntimeError(f"{self._fallback_reason}; single start failed: {exc}") from exc
                raise

    def stop(self):
        with self._lifecycle_guard:
            self._generation += 1
            self._cancel_start.set()
            self._stopping += 1
        try:
            # External cancellation makes the coordinator yield render ownership.
            self._coordinator.stop()
            with self._render_lock:
                result = super().stop()
                self._parallel = False
                return result
        finally:
            with self._lifecycle_guard:
                self._stopping -= 1

    def run_at_render_boundary(self, action):
        generation = self._generation

        def guarded():
            if generation != self._generation or self._stopping:
                raise PartitionCancelled("Boundary action cancelled by session lifecycle.")
            return action()

        return super().run_at_render_boundary(guarded)

    def enqueue_timestamped_midi(self, message, *, source, target_engine_sample=None, delivery_delay_seconds=None,
                                 source_timestamp_ns=None, mapped_backend_monotonic_ns=None, sync_stale=False):
        if not self._parallel:
            return super().enqueue_timestamped_midi(message, source=source, target_engine_sample=target_engine_sample,
                delivery_delay_seconds=delivery_delay_seconds, source_timestamp_ns=source_timestamp_ns,
                mapped_backend_monotonic_ns=mapped_backend_monotonic_ns, sync_stale=sync_stale)
        if len(message) != 3:
            return False
        sample = self.render_sample_cursor
        metadata = dict(source=source, source_timestamp_ns=source_timestamp_ns,
                        mapped_backend_monotonic_ns=mapped_backend_monotonic_ns, sync_stale=sync_stale)
        if target_engine_sample is not None:
            return self._midi_scheduler.enqueue(message, target_engine_sample=max(sample, int(target_engine_sample)),
                late=target_engine_sample < sample, **metadata)[0]
        return self._midi_scheduler.enqueue_after_delay(message, current_engine_sample=sample,
            delivery_delay_seconds=delivery_delay_seconds, source=source, source_timestamp_ns=source_timestamp_ns,
            mapped_backend_monotonic_ns=mapped_backend_monotonic_ns)[0]

    def release_lane_events(self, identities):
        self._midi_scheduler.release_sources({f"lane:{identity}" for identity in identities}, sample=self.render_sample_cursor)

    def panic(self):
        if not self._parallel:
            return super().panic()

        def apply():
            self._midi_scheduler.reset()
            self._midi_scheduler.set_engine_sample_rate(self.runtime_sample_rate)
            # Full ordered broadcast reaches every local note assignment and the
            # scoped legato panic listeners, independent of instrument numbers.
            for channel in range(16):
                for control in (64, 120, 123):
                    self.enqueue_timestamped_midi([0xB0 + channel, control, 0], source="panic")

        self.run_at_render_boundary(apply)
        return "panic queued"

    def render_blocks(self, *, block_count, target_sample_rate, before_block=None, expected_generation=None):
        with self._render_lock:
            if expected_generation is not None:
                self._check_start(expected_generation)
            if not self._parallel:
                return super().render_blocks(block_count=block_count, target_sample_rate=target_sample_rate, before_block=before_block)
            # Reject caller input before treating an exception as a DSP failure.
            # No native work or parent scheduling has occurred at this point.
            if (type(block_count) is not int or block_count < 1 or type(target_sample_rate) is not int
                    or not 8000 <= target_sample_rate <= 192000
                    or block_count * self.runtime_ksmps > MAX_REQUEST_FRAMES):
                raise ValueError("Invalid parallel render request size/rate.")
            generation = self._generation
            arity = self._callback_arity(before_block)

            def prepare(index, sample):
                self._check_start(generation)
                self._apply_boundary_actions()
                if before_block is not None:
                    before_block(index, sample) if arity >= 2 else before_block(index)
                events = self._midi_scheduler.drain_block(block_start_sample=sample,
                                                        block_end_sample=sample + self.runtime_ksmps)
                self.performance_controllers.deliver(events)
                with self._mixer_lock:
                    pending, self._control_pending = self._control_pending, {}
                if pending:
                    self._control_revision += 1
                return BlockInputs(control_revision=self._control_revision,
                    midi=tuple(MidiDelivery(sequence=e.sequence, source=e.source, target_engine_sample=e.target_engine_sample,
                                           message=tuple(e.message), late=e.late) for e in events),
                    controls=tuple(ControlWrite(channel=name, value=float(value)) for name, value in pending.items()))

            try:
                result = self._coordinator.render_blocks(block_count=block_count, target_sample_rate=target_sample_rate,
                                                         prepare_block=prepare)
                self._check_start(generation)
                with self._mixer_lock:
                    for frame in self._coordinator.drain_meter_frames():
                        levels = {identity: {key: max(0., frame["channels"][channel]) for key, channel in names.items()}
                                  for identity, names in self._mixer_meters.items()}
                        self._mixer_meter_frames.append({"engineSample": frame["engineSample"], "levels": levels})
                    self._mixer_meter_frames = self._mixer_meter_frames[-32:]
                return result
            except Exception as exc:
                with self._lock:
                    self._running = False
                if not self._cancel_start.is_set():
                    self.fatal_error = str(exc)
                    self._quarantined = True
                    self._fallback_reason = "previous_parallel_failure"
                    self._failure_diagnostics = self.renderer_diagnostics
                    self.request_stop()
                raise
