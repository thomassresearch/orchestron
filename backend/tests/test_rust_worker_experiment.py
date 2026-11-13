"""Retained experiment parity and the default Rust parallel worker contract."""
from functools import partial
import os
from pathlib import Path

import numpy as np
import pytest

from backend.app.engine.csound_process import run_csound_process
from backend.app.engine.midi_scheduler import EngineMidiScheduler
from backend.app.engine.parallel_csound_renderer import BlockInputs, PartitionRenderCoordinator, PartitionRuntimeError
from backend.app.models.render_protocol import ControlWrite, MidiDelivery, RendererPolicy
from backend.experiments.rust_worker.bridge import run_python_worker, run_rust_worker
from backend.experiments.rust_worker.build import default_library, validate_library
from backend.tests.render_plan_support import prepared_partition
from backend.tests.test_parallel_csound_renderer import assert_released


def require_rust_worker(*args, **kwargs):
    """Fail inside the spawned child if default execution touches the Python loop."""
    from backend.app.engine.partition_native import NativeCsoundPartition

    def forbidden(*args, **kwargs):
        raise AssertionError("Deprecated Python loop used instead of default Rust")

    NativeCsoundPartition.perform = forbidden
    run_csound_process(*args, **kwargs)


def worker_with_library(*args, library, **kwargs):
    """Exercise the default loader's startup failures inside a real spawned child."""
    from backend.experiments.rust_worker import bridge
    bridge.default_library = lambda: validate_library(library)
    run_csound_process(*args, **kwargs)


def test_default_rust_and_explicit_deprecated_python_match(monkeypatch, rust_library):
    monkeypatch.delenv("VISUALCSOUND_PARALLEL_WORKER", raising=False)
    targets, plan, compilation = prepared_partition()
    native = capture(plan, compilation, targets, require_rust_worker, 256, 48000)
    monkeypatch.setenv("VISUALCSOUND_PARALLEL_WORKER", "python")
    rollback = capture(plan, compilation, targets, run_csound_process, 256, 48000)
    assert native == rollback


@pytest.mark.parametrize("damage", ["missing", "source", "binary", "stamp"])
def test_default_library_rejects_missing_and_stale_builds(tmp_path, monkeypatch, rust_library, damage):
    import json
    from backend.experiments.rust_worker import build
    root = tmp_path / "rust_worker"
    packaged = root / "_native" / build.library_name()
    packaged.parent.mkdir(parents=True)
    source = Path(rust_library)
    packaged.write_bytes(source.read_bytes())
    stamp = json.loads(source.with_suffix(source.suffix + ".json").read_text())
    monkeypatch.setattr(build, "ROOT", root)
    monkeypatch.setattr(build, "source_identity", lambda: stamp["sources"])
    recorded = {**stamp, "sources": dict(stamp["sources"])}
    if damage == "source":
        recorded["sources"]["lib.rs"] = "stale"
    elif damage == "binary":
        packaged.write_bytes(b"damaged")
    elif damage == "missing":
        packaged.unlink()
    packaged.with_suffix(packaged.suffix + ".json").write_text(
        "[]" if damage == "stamp" else json.dumps(recorded))
    with pytest.raises(RuntimeError, match="Rust parallel worker unavailable or stale"):
        build.default_library()


def test_python_rollback_does_not_load_rust_and_rejects_invalid_selector(monkeypatch):
    from backend.experiments.rust_worker import bridge

    def unavailable():
        raise AssertionError("Python rollback must not need a Rust binary")

    monkeypatch.setattr(bridge, "default_library", unavailable)
    monkeypatch.setenv("VISUALCSOUND_PARALLEL_WORKER", "python")
    assert bridge.default_batch_factory() is None
    monkeypatch.setenv("VISUALCSOUND_PARALLEL_WORKER", "typo")
    with pytest.raises(ValueError, match="must be rust or python"):
        bridge.default_batch_factory()


@pytest.fixture(scope="module")
def rust_library():
    override = os.environ.get("ORCHESTRON_TEST_RUST_WORKER_LIBRARY")
    library = Path(override).resolve(strict=True) if override else default_library()
    return str(library)


def capture(plan, compilation, targets, target, batch, rate, frames=8192):
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(coordination_frames=batch), _worker_target=target)
    scheduler = EngineMidiScheduler()
    for sample, status, note, value in [(0, 0x90, 60, 90), (31, 0x90, 64, 70), (63, 0x80, 60, 0),
            (95, 0xB0, 64, 127), (127, 0x80, 64, 0), (159, 0xB0, 64, 0), (191, 0x90, 67, 110),
            (1024, 0xB0, 120, 0), (2048, 0x90, 60, 100)]:
        for instrument in targets:
            if instrument.midi_channel:
                scheduler.enqueue([status + instrument.midi_channel - 1, note, value], source="parity",
                                  target_engine_sample=sample)
    gain = next(name for p in compilation.programs for name in p.controls if "gain" in name.lower())
    ksmps = plan.graph.engine.ksmps
    calls, audio, meters = [], [], []
    revision = 0

    def prepare(index, sample):
        nonlocal revision
        calls.append((sample, renderer.render_sample_cursor))
        controls = ()
        if sample in (32, 64, 128, 2048):
            revision += 1
            controls = (ControlWrite(channel=gain, value=revision / 5),)
        return BlockInputs(control_revision=revision, controls=controls,
            midi=tuple(MidiDelivery(sequence=e.sequence, source=e.source, target_engine_sample=e.target_engine_sample,
                message=tuple(e.message), late=e.late) for e in scheduler.drain_block(
                    block_start_sample=sample, block_end_sample=sample + ksmps)))

    try:
        renderer.start(compilation, plan)
        pids, name = renderer.process_ids, renderer.shared_memory_name
        index = 0
        while renderer.committed_sample < frames:
            count = min((1, 3, 7, 19, 63, 257)[index % 6], (frames - renderer.committed_sample) // ksmps)
            audio.append(renderer.render_blocks(block_count=count, target_sample_rate=rate, prepare_block=prepare).pcm_f32le)
            meters.append((renderer.last_meters.copy(), renderer.drain_meter_frames()))
            index += 1
        assert renderer.committed_sample == renderer.published_sample == frames
    finally:
        renderer.stop()
    assert_released(renderer, name, pids)
    return b"".join(audio), meters, calls


@pytest.mark.parametrize("case,ksmps,batch,rate", [
    ("two", 1, 256, 48000), ("two", 32, 32, 48000), ("two", 32, 255, 44100),
    ("four", 32, 256, 48000), ("eight", 32, 1024, 96000), ("shared", 32, 256, 48000),
    ("bypass", 32, 256, 48000), ("sidechain", 32, 256, 48000),
    ("custom_ports", 32, 256, 48000), ("legato", 32, 256, 48000), ("tables", 32, 256, 48000),
])
def test_rust_batches_match_current_python_exactly(rust_library, case, ksmps, batch, rate):
    targets, plan, compilation = prepared_partition(case, ksmps)
    reference = capture(plan, compilation, targets, run_python_worker, batch, rate)
    candidate = capture(plan, compilation, targets, partial(run_rust_worker, library=rust_library), batch, rate)
    assert candidate[1:] == reference[1:]
    np.testing.assert_array_equal(np.frombuffer(candidate[0], "<u4"), np.frombuffer(reference[0], "<u4"))
    assert np.max(np.abs(np.frombuffer(reference[0], "<f4"))) > 0.00001


def test_missing_experimental_library_fails_and_reaps_without_silent_python_fallback(tmp_path):
    _, plan, compilation = prepared_partition()
    renderer = PartitionRenderCoordinator(_worker_target=partial(run_rust_worker, library=str(tmp_path / "absent.so")))
    with pytest.raises(PartitionRuntimeError, match="absent.so"):
        renderer.start(compilation, plan)
    assert not renderer.process_ids and renderer.shared_memory_name is None
    renderer.stop()


def amplitude_fixture(amplitude):
    from backend.tests.render_plan_support import planner_inputs
    from backend.tests.test_whole_instrument_rendering import prepare
    targets, graph, mixer = planner_inputs("two", 32)
    for target in targets:
        for node in target.patch.graph.nodes:
            if node.opcode == "ampmidi":
                node.params["iscal"] = amplitude
    plan, compilation = prepare((targets, graph, mixer))
    return targets, plan, compilation


@pytest.mark.parametrize("amplitude", [1e-39, 1e-36])
@pytest.mark.parametrize("rate", [48000, 44100, 96000])
def test_rust_pcm_preserves_subnormal_conversion_and_resampling(rust_library, amplitude, rate):
    targets, plan, compilation = amplitude_fixture(amplitude)
    a = capture(plan, compilation, targets, run_python_worker, 256, rate)
    b = capture(plan, compilation, targets, partial(run_rust_worker, library=rust_library), 256, rate)
    assert a[1:] == b[1:]
    np.testing.assert_array_equal(np.frombuffer(a[0], "<u4"), np.frombuffer(b[0], "<u4"))
    assert np.any(np.frombuffer(a[0], "<u4") & 0x7fffffff)


@pytest.mark.parametrize("arm", ["python", "rust"])
def test_overflow_withholds_entire_request_and_reaps(rust_library, arm):
    targets, plan, compilation = prepared_partition()
    gains = tuple(ControlWrite(channel=name, value=1e100) for name in sorted({
        name for p in compilation.programs for name in p.controls if "gain" in name.lower()}))
    target = run_python_worker if arm == "python" else partial(run_rust_worker, library=rust_library)
    renderer = PartitionRenderCoordinator(_worker_target=target)
    try:
        renderer.start(compilation, plan)
        pids, name = renderer.process_ids, renderer.shared_memory_name

        def prepare(index, sample):
            return BlockInputs(control_revision=int(sample >= 256), controls=gains if sample == 256 else (),
                midi=tuple(MidiDelivery(sequence=i + 1, source="overflow", target_engine_sample=sample,
                message=(0x90 + t.midi_channel - 1, 60, 100), late=False)
                for i, t in enumerate(t for t in targets if t.midi_channel)) if sample == 256 else ())

        with pytest.raises(PartitionRuntimeError, match="float32|nonfinite"):
            renderer.render_blocks(block_count=32, target_sample_rate=48000, prepare_block=prepare)
        assert renderer.published_sample == 0
    finally:
        renderer.stop()
    assert_released(renderer, name, pids)
