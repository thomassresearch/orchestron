"""Parent scheduling, controls and cancellation over persistent real processes."""
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import multiprocessing
import threading

import numpy as np
import pytest

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.parallel_csound_renderer import PartitionCancelled, PartitionRenderCoordinator, PartitionRuntimeError
from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
from backend.app.models.session import SessionInstrumentAssignment
from backend.app.services.compiler_mixer import mixer_control_values
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tests.partition_process_support import controlled_process
from backend.tests.render_plan_support import planner_inputs
from backend.tests.session_parallel_support import options


def prepared(monkeypatch, *, mode="auto", case="two", ksmps=32, target=None, opt_in=True):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "false")
    factory = partial(PartitionRenderCoordinator, _worker_target=target) if target else PartitionRenderCoordinator
    worker = ParallelCsoundRenderer(options=options(mode, qualified_opt_in=opt_in), coordinator_factory=factory)
    if worker.backend != "ctcsound":
        pytest.skip("Native Csound unavailable")
    compiler = CompilerService(OpcodeService("/static/icons"))
    targets, graph, mixer = planner_inputs(case, ksmps)
    artifact = compiler.compile_patch_bundle(targets, midi_input="internal:loopback", rtmidi_module="null",
                                              audio_graph=graph, mixer=mixer)
    worker.prepare(compiler, targets, graph, mixer, artifact)
    return worker, artifact, mixer


def start(worker, artifact, mixer):
    result = worker.start(artifact.csd, "internal:loopback", "null")
    worker.configure_mixer(artifact.manifest, mixer_control_values(artifact.manifest, mixer))
    return result


def test_capacity_is_rechecked_after_prepare_and_denial_does_not_quarantine(monkeypatch):
    from backend.app.engine.render_capacity import MIB, RenderCapacity
    worker, artifact, mixer = prepared(monkeypatch)
    admission = worker.options.admission
    original_probe = admission.probe
    try:
        admission.probe = lambda: RenderCapacity(2., True, 4096 * MIB, 64 * MIB)
        start(worker, artifact, mixer)
        assert worker.renderer_diagnostics["fallback_reason"] == "insufficient_cpu_capacity"
        assert worker.renderer_diagnostics["selected"] == "single"
        assert [lease.workers for lease in admission.leases] == [1]
        worker.stop()
        assert not admission.leases
        admission.probe = original_probe
        start(worker, artifact, mixer)
        assert worker.renderer_diagnostics["selected"] == "parallel"
        assert admission.leases[0].workers == 3
    finally:
        worker.stop()
    assert not admission.leases


def test_lease_is_retained_until_cleanup_reaps_native_owners(monkeypatch):
    worker, artifact, mixer = prepared(monkeypatch)
    start(worker, artifact, mixer)
    original_stop = worker._coordinator.stop
    def failed_stop():
        raise PartitionRuntimeError("native owner still alive")
    monkeypatch.setattr(worker._coordinator, "stop", failed_stop)
    try:
        with pytest.raises(PartitionRuntimeError, match="still alive"):
            worker.stop()
        assert worker.options.admission.leases[0].workers == 3
        assert worker._coordinator.process_ids
    finally:
        monkeypatch.setattr(worker._coordinator, "stop", original_stop)
        worker.stop()
    assert not worker.options.admission.leases


def test_slow_requests_suppress_future_parallel_admission_without_changing_transport(monkeypatch):
    from itertools import count
    from types import SimpleNamespace
    from backend.app.engine import session_parallel_renderer
    from backend.app.engine.render_capacity import MIB, RenderAdmissionError
    worker, artifact, mixer = prepared(monkeypatch)
    try:
        start(worker, artifact, mixer)
        times = count()
        monkeypatch.setattr(session_parallel_renderer, "time", SimpleNamespace(monotonic=lambda: float(next(times))))
        for _ in range(3):
            worker.render_blocks(block_count=1, target_sample_rate=48000)
        assert worker.is_running and worker.render_sample_cursor == 96
        assert worker.renderer_diagnostics["slow_requests"] == 3
        with pytest.raises(RenderAdmissionError, match="recent_render_pressure"):
            worker.options.admission.acquire(object(), workers=3, memory_bytes=400 * MIB, shared_bytes=4 * MIB)
    finally:
        worker.stop()


@pytest.mark.parametrize("ksmps,rate", [(1, 48000), (32, 44100), (32, 48000)])
def test_native_facade_matches_single_timing_audio_controls_and_meters(monkeypatch, ksmps, rate):
    worker, artifact, mixer = prepared(monkeypatch, case="shared", ksmps=ksmps)
    single = CsoundWorker()
    traces, audio, meters = [], [], []
    try:
        for renderer in (single, worker):
            start(renderer, artifact, mixer)
            gain = next(name for name in mixer_control_values(artifact.manifest, mixer) if "gain" in name.lower())
            trace, chunks, levels = [], [], []
            def before(index, sample):
                trace.append((sample, renderer.render_sample_cursor))
                if sample == 0:
                    for channel in range(4):
                        renderer.enqueue_timestamped_midi([0x90 + channel, 60, 100], source=f"lane:voice{channel}", target_engine_sample=sample)
                if sample == 128:
                    renderer.queue_control_channels({gain: .5})
                if sample == 256:
                    renderer.release_lane_events(["voice0"])
                if sample == 512:
                    renderer.enqueue_timestamped_midi([0xB1, 123, 0], source="host", target_engine_sample=sample - 1)
            for _ in range(8):
                result = renderer.render_blocks(block_count=256 // ksmps, target_sample_rate=rate, before_block=before)
                chunks.append(result)
                levels.extend(renderer.drain_mixer_meters())
            traces.append(trace)
            audio.append(chunks)
            meters.append(levels)
        assert worker.renderer_diagnostics["selected"] == "parallel"
        assert worker._csound is None and len(worker._coordinator.process_ids) >= 3
        assert traces[0] == traces[1] == [(s, s) for s in range(0, 2048, ksmps)]
        assert [(c.engine_sample_start, c.engine_sample_end, c.target_frame_count) for c in audio[0]] == [
            (c.engine_sample_start, c.engine_sample_end, c.target_frame_count) for c in audio[1]]
        left, right = [np.frombuffer(b"".join(c.pcm_f32le for c in chunks), dtype="<f4") for chunks in audio]
        assert np.max(np.abs(left)) > .001
        np.testing.assert_allclose(left, right, rtol=0, atol=1e-7)
        assert [m["engineSample"] for m in meters[0]] == [m["engineSample"] for m in meters[1]]
        assert meters[1] and meters[1][0]["levels"].keys() == meters[0][0]["levels"].keys()
    finally:
        worker.stop()
        single.stop()


def test_empty_blocks_keep_live_boundaries_and_do_not_replay_payloads(monkeypatch):
    worker, artifact, mixer = prepared(monkeypatch, target=controlled_process)
    captured = []
    original = worker._coordinator.render_blocks

    def render(**kwargs):
        prepare = kwargs["prepare_block"]
        def observe(index, sample):
            inputs = prepare(index, sample)
            captured.append((sample, inputs))
            return inputs
        return original(**{**kwargs, "prepare_block": observe})

    monkeypatch.setattr(worker._coordinator, "render_blocks", render)
    try:
        start(worker, artifact, mixer)
        gain = next(name for name in artifact.manifest["initialControls"] if "gain" in name.lower())
        boundaries = []
        def before(_index, sample):
            boundaries.append(sample)
            if sample == 96:
                worker.enqueue_timestamped_midi([0x90, 60, 100], source="manual")
            if sample == 128:
                worker.queue_control_channels({gain: .5})
            if sample == 192:
                worker.enqueue_timestamped_midi([0x80, 60, 0], source="manual")
        worker.render_blocks(block_count=7, target_sample_rate=48000, before_block=before)
        worker.render_blocks(block_count=2, target_sample_rate=48000, before_block=before)
        assert boundaries == list(range(0, 288, 32))
        assert [(s, [e.message for e in b.midi]) for s, b in captured if b.midi] == [
            (96, [(0x90, 60, 100)]), (192, [(0x80, 60, 0)])]
        assert [s for s, b in captured if b.controls] == [0, 128]
        assert [b.control_revision for _, b in captured] == [1] * 4 + [2] * 5
        worker.stop()
        start(worker, artifact, mixer)
        captured.clear()
        worker.render_blocks(block_count=3, target_sample_rate=48000)
        assert [s for s, _ in captured] == [0, 32, 64]
        assert all(not b.midi and b.control_revision == 1 for _, b in captured)
        assert all(not b.controls for _, b in captured[1:])
    finally:
        worker.stop()


def test_controller_cc_has_one_parent_revision_and_idle_boundary_completes(monkeypatch):
    worker, artifact, mixer = prepared(monkeypatch, target=controlled_process)
    try:
        start(worker, artifact, mixer)
        channel = next(iter(mixer_control_values(artifact.manifest, mixer)))
        assignment = SessionInstrumentAssignment(id="source0", patch_id="source0", midi_channel=1,
            performance_controller_midi_ccs={"knob": 1})
        worker.performance_controllers.configure([assignment], {"source0": {"knob": {
            "node_id": "knob", "channel": channel, "default": .5}}})
        before = worker.performance_controllers.snapshot("source0")["revisions"]["knob"]
        assert worker.run_at_render_boundary(lambda: "idle") == "idle"
        for count, rate in [(0, 48000), (1, 0), (192001, 48000)]:
            with pytest.raises(ValueError):
                worker.render_blocks(block_count=count, target_sample_rate=rate)
        assert worker.is_running and worker.fatal_error is None and worker.render_sample_cursor == 0
        worker.enqueue_timestamped_midi([0xB0, 1, 127], source="host", target_engine_sample=0)
        worker.render_blocks(block_count=2, target_sample_rate=48000)
        state = worker.performance_controllers.snapshot("source0")
        assert state["revisions"]["knob"] == before + 1
        assert state["values"]["knob"] == 1
        with pytest.raises(ValueError, match="bad edit"):
            worker.run_at_render_boundary(lambda: (_ for _ in ()).throw(ValueError("bad edit")))
        assert worker.is_running
        assert worker.render_blocks(block_count=1, target_sample_rate=48000).engine_sample_start == 64
    finally:
        worker.stop()


def test_native_panic_releases_every_assignment_and_accepts_fresh_notes(monkeypatch):
    worker, artifact, mixer = prepared(monkeypatch)
    def peak(blocks=64):
        pcm = worker.render_blocks(block_count=blocks, target_sample_rate=48000).pcm_f32le
        return np.max(np.abs(np.frombuffer(pcm, dtype="<f4")))
    try:
        start(worker, artifact, mixer)
        # Repeated Start must retain the cancellation event of the active epoch.
        cancel = worker._cancel_start
        assert worker.start(artifact.csd, "internal:loopback", "null").detail == "already running"
        assert worker._cancel_start is cancel
        for channel in (0, 1):
            worker.enqueue_timestamped_midi([0x90 + channel, 60, 100], source="manual", delivery_delay_seconds=0)
        assert peak() > .001
        worker.panic()
        peak()  # Retain and drain the short private effect tails.
        assert peak() < 1e-7
        worker.queue_midi_message([0x91, 67, 100], delivery_delay_seconds=0)
        assert peak() > .0001
    finally:
        worker.stop()


def test_render_queued_before_stop_cannot_advance_restarted_engine(monkeypatch):
    worker, artifact, mixer = prepared(monkeypatch, target=controlled_process)
    try:
        start(worker, artifact, mixer)
        token = worker.start_generation
        entered = threading.Event()
        def old_request():
            entered.set()
            return worker.render_blocks(block_count=2, target_sample_rate=48000, expected_generation=token)
        with ThreadPoolExecutor() as pool:
            with worker._render_lock:
                old = pool.submit(old_request)
                assert entered.wait(2)
                worker.stop()
                start(worker, artifact, mixer)
            with pytest.raises(PartitionCancelled):
                old.result(5)
        assert worker.is_running and worker.render_sample_cursor == 0
        assert worker.render_blocks(block_count=1, target_sample_rate=48000).engine_sample_start == 0
    finally:
        worker.stop()


@pytest.mark.parametrize("cancel", [False, True])
def test_boundary_and_late_midi_during_active_block_are_not_partially_applied(monkeypatch, cancel):
    context = multiprocessing.get_context("spawn")
    entered, release = context.Event(), context.Event()
    worker, artifact, mixer = prepared(monkeypatch, target=partial(controlled_process,
        mode="hold_once", entered=entered, release=release))
    start(worker, artifact, mixer)
    trace, applied, queued = [], [], threading.Event()
    original = worker._midi_scheduler.drain_block
    def drain(**kwargs):
        events = original(**kwargs)
        trace.append((kwargs["block_start_sample"], [(e.source, e.target_engine_sample, e.late) for e in events]))
        return events
    monkeypatch.setattr(worker._midi_scheduler, "drain_block", drain)
    # Signal exactly when the callback is queued, without relying on sleep races.
    # Boundary queue uses this lock before trying to acquire render ownership.
    class ObservedLock:
        def __enter__(self): worker_lock.acquire()
        def __exit__(self, *_):
            worker_lock.release()
            if worker._boundary_actions:
                queued.set()
    worker_lock = threading.Lock()
    worker._boundary_lock = ObservedLock()
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            rendering = pool.submit(worker.render_blocks, block_count=2, target_sample_rate=48000)
            assert entered.wait(5)
            worker.enqueue_timestamped_midi([0x90, 61, 90], source="after-drain", target_engine_sample=0)
            editing = pool.submit(worker.run_at_render_boundary, lambda: applied.append(worker.render_sample_cursor))
            assert queued.wait(2)
            if cancel:
                worker.request_stop()
            release.set()
            if cancel:
                with pytest.raises(PartitionCancelled):
                    rendering.result(5)
                with pytest.raises(PartitionCancelled):
                    editing.result(5)
                assert applied == []
            else:
                rendering.result(5)
                editing.result(5)
                assert applied == [32]
                assert trace == [(0, []), (32, [("after-drain", 32, True)])]
    finally:
        release.set()
        worker.stop()


@pytest.mark.parametrize("mode", ["auto", "parallel"])
def test_startup_failure_fallback_and_active_failure_quarantine(monkeypatch, mode):
    worker, artifact, mixer = prepared(monkeypatch, mode=mode,
        target=partial(controlled_process, mode="compile_error"))
    gate, controllers, midi = worker.lane_output, worker.performance_controllers, worker.midi_output
    try:
        if mode == "parallel":
            with pytest.raises(PartitionRuntimeError, match="compile"):
                start(worker, artifact, mixer)
        else:
            start(worker, artifact, mixer)
            assert worker.renderer_diagnostics["selected"] == "single"
            assert "parallel_start_failed" in worker.renderer_diagnostics["fallback_reason"]
            assert worker._csound is not None
        assert not worker._coordinator.process_ids and worker._coordinator.shared_memory_name is None
        assert (worker.lane_output, worker.performance_controllers, worker.midi_output) == (gate, controllers, midi)
    finally:
        worker.stop()
    # A fresh facade can start parallel, but never substitutes single mid-request.
    worker, artifact, mixer = prepared(monkeypatch, mode=mode,
        target=partial(controlled_process, mode="second_block_error"))
    try:
        start(worker, artifact, mixer)
        with pytest.raises(PartitionRuntimeError):
            worker.render_blocks(block_count=3, target_sample_rate=48000)
        assert worker.fatal_error and not worker.is_running and worker._csound is None
        assert worker.renderer_diagnostics["committed_sample"] == 32
        assert worker.renderer_diagnostics["published_sample"] == 0
        worker.stop()
        assert worker.renderer_diagnostics["committed_sample"] == 32
        start(worker, artifact, mixer)
        assert worker.renderer_diagnostics["selected"] == ("single" if mode == "auto" else "parallel")
        assert worker.render_sample_cursor == 0
    finally:
        worker.stop()


def test_stop_cancels_start_and_stale_start_token_without_late_fallback(monkeypatch):
    context = multiprocessing.get_context("spawn")
    entered, release = context.Event(), context.Event()
    worker, artifact, mixer = prepared(monkeypatch, target=partial(controlled_process,
        mode="hang_compile", entered=entered, release=release))
    token = worker.start_generation
    try:
        with ThreadPoolExecutor() as pool:
            starting = pool.submit(start, worker, artifact, mixer)
            assert entered.wait(5)
            worker.stop()
            with pytest.raises(PartitionCancelled):
                starting.result(5)
        assert worker._csound is None and not worker.is_running
        assert not worker._coordinator.process_ids and worker._coordinator.shared_memory_name is None
        with pytest.raises(PartitionCancelled):
            worker.start(artifact.csd, "internal:loopback", "null", expected_generation=token)
    finally:
        worker.stop()


@pytest.mark.parametrize("mode", ["auto", "parallel"])
def test_unqualified_selection_is_closed_by_default(monkeypatch, mode):
    worker, artifact, mixer = prepared(monkeypatch, mode=mode, opt_in=False)
    try:
        if mode == "auto":
            start(worker, artifact, mixer)
            assert worker.renderer_diagnostics["selected"] == "single"
        else:
            with pytest.raises(PartitionRuntimeError, match="parallel_not_qualified"):
                start(worker, artifact, mixer)
        assert worker.renderer_diagnostics["fallback_reason"] == "parallel_not_qualified"
        assert not worker._coordinator.process_ids
    finally:
        worker.stop()
