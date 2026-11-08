"""Real spawn, native parity and bounded lifecycle/failure qualification for T05."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from functools import partial
import json
import multiprocessing
from multiprocessing.shared_memory import SharedMemory
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

import numpy as np
import pytest

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.engine.midi_scheduler import EngineMidiScheduler
from backend.app.engine.parallel_csound_renderer import (
    BlockInputs, PartitionCancelled, PartitionRenderCoordinator, PartitionRuntimeError,
)
from backend.app.engine.render_ipc import FINAL_BUS
from backend.app.models.render_protocol import ControlWrite, MidiDelivery, RendererPolicy
from backend.tests.partition_process_support import controlled_process, corrupt_process, subnormal_pcm_probe
from backend.tests.render_plan_support import prepared_partition as prepared
from backend.tools._sequential_partition_probe import compare_sequential

CTX = multiprocessing.get_context("spawn")


def test_native_output_view_follows_current_blocks_and_is_released_before_reset():
    from backend.app.engine.partition_native import NativeCsoundPartition
    try:
        module = load_ctcsound_module()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    _, plan, compilation = prepared("two", 32)
    instance = NativeCsoundPartition(module, compilation.canonical.csd, plan.graph.engine, plan.sample_bytes)
    try:
        view = instance.output_buffer
        assert np.shares_memory(view, np.asarray(instance.cs.spout()))
        initial = view.copy()
        instance.perform([(0x90, 60, 100)], [])
        first = view.copy()
        instance.perform([], [])
        np.testing.assert_array_equal(view.reshape(-1), np.asarray(instance.cs.spout()).reshape(-1))
        assert np.any(first != initial) and np.any(view != first)
        del view
    finally:
        instance.close()
    assert instance.output_buffer is None and instance.cs is None


def coordinator(**kwargs):
    return PartitionRenderCoordinator(policy=RendererPolicy(coordination_frames=1, startup_timeout_seconds=10.,
        stop_timeout_seconds=.5, render_timeout_seconds=2.), **kwargs)


def assert_released(renderer, name, pids):
    assert not renderer.is_running and not renderer.process_ids
    assert renderer.shared_memory_name is None
    assert not set(pids) & {p.pid for p in multiprocessing.active_children()}
    with pytest.raises(FileNotFoundError):
        SharedMemory(name=name, track=False)


def drain(scheduler, sample, ksmps, *, controls=(), revision=0):
    return BlockInputs(midi=tuple(MidiDelivery(sequence=e.sequence, source=e.source,
        target_engine_sample=e.target_engine_sample, message=tuple(e.message), late=e.late)
        for e in scheduler.drain_block(block_start_sample=sample, block_end_sample=sample + ksmps)),
        controls=controls, control_revision=revision)


@pytest.mark.parametrize("rate", [48000, 44100, 96000])
@pytest.mark.parametrize("amplitude", [1e-39, 1e-36])
def test_pcm_conversion_preserves_native_thread_subnormal_behavior_in_fresh_processes(rate, amplitude):
    try:
        load_ctcsound_module()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    results = []
    for mode in ("single", "parallel"):
        reader, writer = CTX.Pipe(duplex=False)
        process = CTX.Process(target=subnormal_pcm_probe, args=(mode, writer, rate, amplitude))
        try:
            process.start()
            writer.close()
            assert reader.poll(30), "Native conversion probe did not complete"
            pcm, peak = reader.recv()
            assert peak > 0
            assert (peak < 2 ** -126) == (amplitude == 1e-39), "Exercise both subnormal and small normal samples"
            results.append(pcm)
            process.join(10)
            assert process.exitcode == 0
        finally:
            if process.is_alive():
                process.kill()
                process.join(5)
            process.close()
            reader.close()
            writer.close()
    # Compare bit patterns without dumping thousands of PCM bytes on failure.
    np.testing.assert_array_equal(np.frombuffer(results[0], dtype="<u4"),
                                  np.frombuffer(results[1], dtype="<u4"))


@pytest.mark.parametrize("ksmps", [1, 32])
@pytest.mark.parametrize("case", ["two", "four", "eight", "shared", "bypass", "sidechain", "custom_ports", "legato"])
def test_spawned_native_audio_matches_canonical_and_sequential(case, ksmps):
    try:
        native = load_ctcsound_module()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    targets, plan, compilation = prepared(case, ksmps)
    # Cover note retriggers, sustain, note release, panic and subsequent tails.
    script = [(s, (status + target.midi_channel - 1, note, velocity))
              for s, status, note, velocity in [(0, 0x90, 60, 100), (31, 0x90, 64, 80),
                  (63, 0x80, 60, 0), (64, 0x90, 60, 70), (96, 0xB0, 64, 127),
                  (128, 0x80, 64, 0), (160, 0xB0, 64, 0), (192, 0xB0, 120, 0)]
              for target in targets if target.midi_channel]
    script.sort(key=lambda row: row[0])
    controls = []
    # Subscribe the same canonical control names in both paths, retaining all
    # other initial values. Controls are sealed at the same sample as MIDI.
    gain = next(c for p in compilation.programs for c in p.controls if "gain" in c.lower())
    controls.extend([(64, gain, .5), (160, gain, .8)])
    frames = 8192
    reference = compare_sequential(compilation, plan, frames=frames, events=script, controls=controls, module=native)
    scheduler = EngineMidiScheduler()
    for sample, event in script:
        scheduler.enqueue(event, source="fixture", target_engine_sample=sample)
    renderer = coordinator()
    writes_index, revision = 0, 0
    meters, pcm, calls = [], [], []

    def prepare(index, sample):
        nonlocal writes_index, revision
        calls.append(sample)
        writes = {}
        while writes_index < len(controls) and controls[writes_index][0] < sample + ksmps:
            _, name, value = controls[writes_index]
            writes[name] = value
            writes_index += 1
            revision += 1
        return drain(scheduler, sample, ksmps,
                     controls=tuple(ControlWrite(channel=k, value=v) for k, v in writes.items()), revision=revision)

    try:
        renderer.start(compilation, plan)
        pids, name = renderer.process_ids, renderer.shared_memory_name
        meter_names = [m for stage in plan.graph.stages for m in stage.meters]
        for _ in range(frames // ksmps):
            result = renderer.render_blocks(block_count=1, target_sample_rate=plan.graph.engine.sample_rate, prepare_block=prepare)
            pcm.append(np.frombuffer(result.pcm_f32le, dtype="<f4").reshape(-1, 2))
            meters.append([renderer.last_meters[m] for m in meter_names])
            # Check final native samples before parent float32 conversion too.
            native_output = renderer._arena.audio(renderer._layout.audio[FINAL_BUS], (renderer._sequence - 1) % 2)
            np.testing.assert_array_equal(native_output,
                reference.canonical.reshape(-1, 2)[result.engine_sample_start:result.engine_sample_end])
        assert renderer.process_ids == pids and len(set(pids)) == len(compilation.programs)
        assert renderer.committed_sample == renderer.sealed_sample == renderer.published_sample == frames
        assert calls == list(range(0, frames, ksmps))
        np.testing.assert_array_equal(np.concatenate(pcm), reference.canonical.reshape(-1, 2).astype(np.float32))
        np.testing.assert_array_equal(meters, reference.canonical_meters)
        np.testing.assert_array_equal(reference.partitioned, reference.canonical)
        assert np.max(np.abs(reference.canonical)) > .0001
        assert renderer.drain_meter_frames()[0]["engineSample"] == ksmps
    finally:
        renderer.stop()
    assert_released(renderer, name, pids)


def test_independent_workers_execute_concurrently_and_use_current_generation():
    _, plan, compilation = prepared()
    upstream = sum(not p.predecessors for p in plan.partitions)
    renderer = coordinator(_worker_target=partial(controlled_process, mode="barrier", barrier=CTX.Barrier(upstream)))
    try:
        renderer.start(compilation, plan)
        pids, name = renderer.process_ids, renderer.shared_memory_name
        result = renderer.render_blocks(block_count=6, target_sample_rate=plan.graph.engine.sample_rate)
        pcm = np.frombuffer(result.pcm_f32le, dtype="<f4").reshape(6, plan.graph.engine.ksmps, 2)
        # Every cut is a separate contribution, never last block's samples.
        for index, block in enumerate(pcm):
            assert np.all(block == (index + 1) * (len(plan.buses) + 1))
    finally:
        renderer.stop()
    assert_released(renderer, name, pids)


def test_midi_arriving_after_parent_drain_is_delivered_in_next_block():
    _, plan, compilation = prepared()
    entered, release = CTX.Event(), CTX.Event()
    renderer = coordinator(_worker_target=partial(controlled_process, mode="hold_once", entered=entered, release=release))
    scheduler, sealed = EngineMidiScheduler(), []

    def prepare(index, sample):
        inputs = drain(scheduler, sample, plan.graph.engine.ksmps)
        sealed.append(inputs)
        return inputs

    try:
        renderer.start(compilation, plan)
        with ThreadPoolExecutor() as executor:
            future = executor.submit(renderer.render_blocks, block_count=2, target_sample_rate=48000, prepare_block=prepare)
            assert entered.wait(5)
            assert renderer.committed_sample == 0 and renderer.sealed_sample == 32
            scheduler.enqueue([0x90, 60, 100], source="late", target_engine_sample=0)
            release.set()
            result = future.result(5)
        assert not sealed[0].midi
        assert len(sealed[1].midi) == 1 and sealed[1].midi[0].late
        assert sealed[1].midi[0].target_engine_sample == 32
        assert result.engine_sample_end == 64
    finally:
        release.set()
        renderer.stop()


@pytest.mark.parametrize("mode", ["affinity_error", "compile_error", "second_block_error", "crash", "nonfinite", "float32_overflow"])
def test_failure_discards_request_and_reaps_all_workers(mode, recording_cpu_placement):
    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=partial(controlled_process, mode=mode))
    if mode in {"compile_error", "affinity_error"}:
        with pytest.raises(PartitionRuntimeError, match="start" if mode == "affinity_error" else "compile"):
            renderer.start(compilation, plan)
        assert not renderer.process_ids and renderer.shared_memory_name is None
    else:
        renderer.start(compilation, plan)
        pids, name = renderer.process_ids, renderer.shared_memory_name
        with pytest.raises(PartitionRuntimeError):
            renderer.render_blocks(block_count=3, target_sample_rate=48000)
        assert renderer.published_sample == 0
        assert renderer.committed_sample == (32 if mode == "second_block_error" else 0)
        assert_released(renderer, name, pids)
    renderer.stop()
    assert not recording_cpu_placement._owners
    # Rollback permits a fresh explicit attempt; no implicit replay of failed PCM.
    renderer._target = controlled_process
    renderer.start(compilation, plan)
    assert renderer.render_sample_cursor == 0
    renderer.stop()


@pytest.mark.parametrize("corruption", ["ready", "sequence", "sample", "epoch", "revision", "slots", "duplicate", "dependency_duplicate"])
def test_wrong_or_duplicate_completion_invalidates_epoch(corruption):
    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=partial(corrupt_process, corruption=corruption))
    try:
        with pytest.raises((ValueError, PartitionRuntimeError)):
            renderer.start(compilation, plan)
            renderer.render_blocks(block_count=3, target_sample_rate=48000)
        assert not renderer.is_running and renderer.published_sample == 0
        assert not renderer.process_ids and renderer.shared_memory_name is None
    finally:
        renderer.stop()


@pytest.mark.parametrize("phase", ["hang_compile", "hang", "hang_close"])
def test_stop_cancels_native_hangs_and_has_one_global_cleanup_budget(phase):
    _, plan, compilation = prepared()
    entered, release = CTX.Event(), CTX.Event()
    renderer = coordinator(_worker_target=partial(controlled_process, mode=phase, entered=entered, release=release))
    with ThreadPoolExecutor() as executor:
        if phase == "hang_compile":
            future = executor.submit(renderer.start, compilation, plan)
        else:
            renderer.start(compilation, plan)
            if phase == "hang":
                future = executor.submit(renderer.render_blocks, block_count=4, target_sample_rate=48000)
            else:
                future = None
        if phase != "hang_close":
            assert entered.wait(5)
        name, pids = renderer.shared_memory_name, renderer.process_ids
        epoch = renderer.epoch
        started = time.monotonic()
        renderer.stop()
        assert time.monotonic() - started < 2
        if future is not None:
            with pytest.raises(PartitionCancelled):
                future.result(5)
    assert renderer.epoch > epoch and renderer.published_sample == 0
    assert_released(renderer, name, pids)


def test_render_timeout_and_serial_requests():
    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=controlled_process)
    try:
        renderer.start(compilation, plan)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(renderer.render_blocks, block_count=8, target_sample_rate=44100) for _ in range(2)]
            results = sorted((f.result(5) for f in futures), key=lambda r: r.engine_sample_start)
        assert [(r.engine_sample_start, r.engine_sample_end) for r in results] == [(0, 256), (256, 512)]
        assert all(r.target_frame_count == 235 for r in results)
    finally:
        renderer.stop()
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(render_timeout_seconds=.1, stop_timeout_seconds=.2),
        _worker_target=partial(controlled_process, mode="hang", entered=CTX.Event(), release=CTX.Event()))
    try:
        renderer.start(compilation, plan)
        name, pids = renderer.shared_memory_name, renderer.process_ids
        started = time.monotonic()
        with pytest.raises(PartitionRuntimeError, match="timed out"):
            renderer.render_blocks(block_count=1, target_sample_rate=48000)
        assert time.monotonic() - started < 1
        assert_released(renderer, name, pids)
    finally:
        renderer.stop()


def test_capacity_rejects_before_spawning_and_unknown_controls_fail_closed():
    _, plan, compilation = prepared()
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(max_shared_memory_bytes=1024), _worker_target=controlled_process)
    with pytest.raises(ValueError, match="capacity"):
        renderer.start(compilation, plan)
    assert not renderer.process_ids and renderer.shared_memory_name is None
    renderer = coordinator(_worker_target=controlled_process)
    try:
        renderer.start(compilation, plan)
        with pytest.raises(ValueError, match="Unknown"):
            renderer.render_blocks(block_count=1, target_sample_rate=48000,
                prepare_block=lambda *_: BlockInputs(controls=(ControlWrite(channel="foreign", value=1.),)))
        assert not renderer.process_ids and renderer.published_sample == 0
    finally:
        renderer.stop()


@pytest.fixture
def recording_cpu_placement(monkeypatch):
    from backend.app.engine import parallel_csound_renderer
    from backend.app.engine.render_cpu_placement import RenderCpuPlacement

    pool = RenderCpuPlacement(lambda: set(range(16)))
    acquire = pool.acquire
    def reserve(owner, workers):
        acquire(owner, workers)
        # Exercise ownership on any host without changing the test process CPUs.
        return (None,) * workers
    monkeypatch.setattr(pool, "acquire", reserve)
    monkeypatch.setattr(parallel_csound_renderer, "PROCESS_RENDER_CPU_PLACEMENT", pool)
    return pool


def test_partial_spawn_failure_rolls_back_before_fresh_single_fallback(monkeypatch, recording_cpu_placement):
    from backend.app.engine.csound_worker import CsoundWorker
    from backend.app.engine.renderer_factory import create_realtime_renderer

    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=controlled_process)
    original = renderer._context.Process
    created = []
    names = []

    def process(**kwargs):
        names.append(renderer.shared_memory_name)
        child = original(**kwargs)
        if created:
            def fail_start():
                raise OSError("injected spawn failure")
            child.start = fail_start
        created.append(child)
        return child

    monkeypatch.setattr(renderer._context, "Process", process)
    with pytest.raises(OSError, match="spawn failure"):
        renderer.start(compilation, plan)
    assert len(created) == 2
    assert not recording_cpu_placement._owners
    assert_released(renderer, names[0], ())
    single = create_realtime_renderer()
    assert type(single) is CsoundWorker
    try:
        single.start(compilation.canonical.csd, "internal:loopback", "null")
        assert single.render_blocks(block_count=2, target_sample_rate=48000).engine_sample_end == 64
    finally:
        single.stop()


def test_one_hundred_native_start_render_stop_cycles_release_ownership():
    try:
        load_ctcsound_module()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    _, plan, compilation = prepared()
    renderer = coordinator()
    descriptors = Path("/proc/self/fd") if sys.platform.startswith("linux") else Path("/dev/fd")
    counts = []
    epochs = []
    try:
        for _ in range(100):
            renderer.start(compilation, plan)
            epochs.append(renderer.epoch)
            name, pids = renderer.shared_memory_name, renderer.process_ids
            assert renderer.render_blocks(block_count=2, target_sample_rate=48000).engine_sample_end == 64
            renderer.stop()
            renderer.stop()
            assert_released(renderer, name, pids)
            if descriptors.exists():
                counts.append(len(list(descriptors.iterdir())))
        assert len(set(epochs)) == 100
        if counts:
            assert max(counts) == min(counts)
    finally:
        renderer.stop()


def test_parent_death_terminates_children_even_during_native_hang(tmp_path):
    report = tmp_path / "parent.json"
    with (tmp_path / "parent.log").open("w+") as log:
        parent = subprocess.Popen([sys.executable, "-m", "backend.tests.partition_process_support", str(report)],
            stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 15
            while not report.exists() and parent.poll() is None and time.monotonic() < deadline:
                time.sleep(.02)
            if not report.exists():
                log.seek(0)
                pytest.fail(log.read())
            ownership = json.loads(report.read_text())
            parent.kill()
            parent.wait(timeout=5)

            def exists(pid):
                try:
                    os.kill(pid, 0)
                    # Container PID 1 may retain an exited orphan as a zombie.
                    # It holds no native state, descriptors or shared mapping.
                    stat = Path(f"/proc/{pid}/stat")
                    return not (stat.exists() and stat.read_text().split()[2] == "Z")
                except ProcessLookupError:
                    return False

            deadline = time.monotonic() + 5
            while any(exists(pid) for pid in ownership["pids"]) and time.monotonic() < deadline:
                time.sleep(.02)
            assert not any(exists(pid) for pid in ownership["pids"])
            # The dedicated resource tracker may run just after the final child exits.
            while time.monotonic() < deadline:
                try:
                    shared = SharedMemory(name=ownership["name"], track=False)
                except FileNotFoundError:
                    break
                shared.close()
                time.sleep(.02)
            else:
                pytest.fail("Parent-exit shared memory was not unlinked")
        finally:
            if parent.poll() is None:
                parent.kill()
            parent.wait(timeout=5)


def test_oversized_sealed_midi_is_rejected_before_any_worker_advances():
    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=controlled_process)
    try:
        renderer.start(compilation, plan)
        midi = tuple(MidiDelivery(sequence=i + 1, source="x" * 128, target_engine_sample=0,
                                 message=(0x90, 60, 100), late=False) for i in range(16384))
        with pytest.raises(ValueError, match="mailbox capacity"):
            renderer.render_blocks(block_count=1, target_sample_rate=48000, prepare_block=lambda *_: BlockInputs(midi=midi))
        assert renderer.committed_sample == renderer.sealed_sample == renderer.published_sample == 0
        assert not renderer.process_ids
    finally:
        renderer.stop()


def test_startup_timeout_and_stop_wins_over_waiting_restart(monkeypatch):
    _, plan, compilation = prepared()
    entered, release = CTX.Event(), CTX.Event()
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(startup_timeout_seconds=1., stop_timeout_seconds=.2),
        _worker_target=partial(controlled_process, mode="hang_compile", entered=entered, release=release))
    started = time.monotonic()
    with pytest.raises(PartitionRuntimeError, match="timed out"):
        renderer.start(compilation, plan)
    assert time.monotonic() - started < 2
    assert not renderer.process_ids and renderer.shared_memory_name is None

    entered, release = CTX.Event(), CTX.Event()
    renderer = coordinator(_worker_target=partial(controlled_process, mode="hang", entered=entered, release=release))
    cleanup_entered, cleanup_release = threading.Event(), threading.Event()
    original_cleanup = renderer._invalidate_and_cleanup

    def hold_cleanup():
        cleanup_entered.set()
        assert cleanup_release.wait(5)
        original_cleanup()

    try:
        renderer.start(compilation, plan)
        monkeypatch.setattr(renderer, "_invalidate_and_cleanup", hold_cleanup)
        with ThreadPoolExecutor(max_workers=3) as executor:
            rendering = executor.submit(renderer.render_blocks, block_count=10, target_sample_rate=48000)
            assert entered.wait(5)
            stopping = executor.submit(renderer.stop)
            assert renderer._cancel.wait(5)
            assert cleanup_entered.wait(5)
            with pytest.raises(PartitionCancelled):
                renderer.start(compilation, plan)
            cleanup_release.set()
            stopping.result(5)
            with pytest.raises(PartitionCancelled):
                rendering.result(5)
        assert not renderer.is_running and not renderer.process_ids
    finally:
        cleanup_release.set()
        renderer.stop()


def test_failed_fresh_start_has_zero_cursor_after_previous_epoch():
    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=controlled_process)
    renderer.start(compilation, plan)
    renderer.render_blocks(block_count=1, target_sample_rate=48000)
    renderer.stop()
    assert renderer.committed_sample == 32
    renderer._target = partial(controlled_process, mode="compile_error")
    with pytest.raises(PartitionRuntimeError):
        renderer.start(compilation, plan)
    assert renderer.committed_sample == renderer.published_sample == renderer.sealed_sample == 0


def test_request_conversion_matches_single_resampler_once_per_request():
    from backend.app.engine.browser_audio_pcm import resample_stereo_block_linear
    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=controlled_process)
    try:
        renderer.start(compilation, plan)
        result = renderer.render_blocks(block_count=5, target_sample_rate=44100)
        raw = np.repeat(np.arange(1, 6, dtype=np.float32) * (len(plan.buses) + 1), 32)
        expected = resample_stereo_block_linear(np.column_stack((raw, raw)), source_sample_rate=48000, target_sample_rate=44100)
        assert result.pcm_f32le == expected.astype("<f4").tobytes()
    finally:
        renderer.stop()


def test_native_abi_mismatch_rolls_back_before_ready_or_audio():
    try:
        module = load_ctcsound_module()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    native = module.Csound()
    width = int(native.sizeOfMYFLT())
    native.reset()
    _, plan, compilation = prepared(sample_bytes=4 if width == 8 else 8)
    renderer = coordinator()
    with pytest.raises(PartitionRuntimeError, match="ABI mismatch"):
        renderer.start(compilation, plan)
    assert not renderer.process_ids and renderer.shared_memory_name is None
    assert renderer.committed_sample == 0


def test_empty_requests_keep_last_control_revision_and_reject_older_inputs():
    _, plan, compilation = prepared()
    renderer = coordinator(_worker_target=controlled_process)
    try:
        renderer.start(compilation, plan)
        control = compilation.programs[0].controls[0]
        renderer.render_blocks(block_count=1, target_sample_rate=48000, prepare_block=lambda *_:
            BlockInputs(control_revision=7, controls=(ControlWrite(channel=control, value=.5),)))
        renderer.render_blocks(block_count=2, target_sample_rate=48000)
        assert renderer._revision == 7 and renderer.published_sample == 96
        with pytest.raises(ValueError, match="backwards"):
            renderer.render_blocks(block_count=1, target_sample_rate=48000,
                                   prepare_block=lambda *_: BlockInputs(control_revision=6))
        assert renderer.committed_sample == renderer.published_sample == 96
        assert not renderer.process_ids
    finally:
        renderer.stop()


def test_blocked_parent_callback_keeps_ownership_until_it_yields(recording_cpu_placement):
    _, plan, compilation = prepared()
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(stop_timeout_seconds=.1), _worker_target=controlled_process)
    entered, release = threading.Event(), threading.Event()

    def prepare(*_):
        entered.set()
        assert release.wait(5)
        return BlockInputs()

    try:
        renderer.start(compilation, plan)
        with ThreadPoolExecutor() as executor:
            rendering = executor.submit(renderer.render_blocks, block_count=1, target_sample_rate=48000, prepare_block=prepare)
            try:
                assert entered.wait(5)
                with pytest.raises(PartitionRuntimeError, match="still owns"):
                    renderer.start(compilation, plan)
                with pytest.raises(PartitionRuntimeError, match="has not yielded"):
                    renderer.stop()
                assert renderer.shared_memory_name is not None and renderer.process_ids
                assert renderer in recording_cpu_placement._owners
                with pytest.raises(PartitionRuntimeError, match="still owns"):
                    renderer.start(compilation, plan)
            finally:
                release.set()
            with pytest.raises(PartitionCancelled):
                rendering.result(5)
        assert not renderer.process_ids and renderer.shared_memory_name is None
        assert not recording_cpu_placement._owners
        assert renderer.published_sample == 0
    finally:
        release.set()
        renderer.stop()
