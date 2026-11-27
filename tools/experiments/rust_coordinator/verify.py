"""Opt-in regression probes for this experiment. Run via pytest using this file's path."""
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import multiprocessing

import pytest

from backend.app.engine import session_parallel_renderer
from backend.app.engine.parallel_csound_renderer import BlockInputs, PartitionCancelled, PartitionRenderCoordinator, PartitionRuntimeError
from backend.app.engine.render_ipc import MailboxCapacityError
from backend.app.models.render_protocol import MidiDelivery, RendererPolicy
from backend.tests import test_rust_worker_experiment as worker_tests
from backend.tests import test_sample_player as sample_tests
from backend.tests.partition_process_support import controlled_process, corrupt_process
from backend.tests.render_plan_support import prepared_partition
from backend.tests.test_parallel_csound_renderer import assert_released
from backend.tests.test_sample_player import media as media  # pytest fixture
from tools.experiments.rust_coordinator.bridge import RustCoordinator


@pytest.mark.parametrize("case,k,batch,rate", [("two", 1, 256, 48000), ("sidechain", 32, 255, 44100), ("eight", 32, 1024, 96000)])
def test_exact_pcm_meters_and_cursors(monkeypatch, case, k, batch, rate):
    from backend.app.engine.csound_process import run_csound_process
    monkeypatch.setenv("VISUALCSOUND_PARALLEL_WORKER", "rust")
    targets, plan, compilation = prepared_partition(case, k)
    args = plan, compilation, targets, run_csound_process, batch, rate
    expected = worker_tests.capture(*args)
    monkeypatch.setattr(worker_tests, "PartitionRenderCoordinator", RustCoordinator)
    assert worker_tests.capture(*args) == expected


def test_sample_routing_and_cancellation(media, monkeypatch):
    factory = partial(session_parallel_renderer.ParallelCsoundRenderer, coordinator_factory=RustCoordinator)
    monkeypatch.setattr(session_parallel_renderer, "ParallelCsoundRenderer", factory)
    sample_tests.test_partitioned_sample_vocoder_pcm_and_source_cancellation(media, monkeypatch, "rust", 48000, 32)


def midi(sample, count=1, width=1):
    return BlockInputs(midi=tuple(MidiDelivery(sequence=i + 1, source="x"*width, target_engine_sample=sample,
                                               message=(0x90, 60, 100), late=False) for i in range(count)))


@pytest.mark.parametrize("corruption,events", [
    ("sequence", False), ("sample", True), ("revision", True), ("epoch", True),
    ("slots", True), ("duplicate", False), ("dependency_duplicate", False),
])
def test_corrupt_completion(corruption, events):
    _, plan, compilation = prepared_partition()
    renderer = RustCoordinator(policy=RendererPolicy(stop_timeout_seconds=.25),
                               _worker_target=partial(corrupt_process, corruption=corruption))
    renderer.start(compilation, plan)
    name, pids = renderer.shared_memory_name, renderer.process_ids
    with pytest.raises(PartitionRuntimeError):
        renderer.render_blocks(block_count=8, target_sample_rate=48000,
                               prepare_block=(lambda i, s: midi(s)) if events else None)
    assert renderer.published_sample == 0
    assert_released(renderer, name, pids)


@pytest.mark.parametrize("action", ["timeout", "stop", "crash", "second_block_error"])
def test_failed_batch_releases_resources(action):
    ctx = multiprocessing.get_context("spawn")
    entered, release = ctx.Event(), ctx.Event()
    _, plan, compilation = prepared_partition()
    mode = "hang" if action in ("timeout", "stop") else action
    renderer = RustCoordinator(policy=RendererPolicy(stop_timeout_seconds=.35, render_timeout_seconds=.2),
                               _worker_target=partial(controlled_process, mode=mode, entered=entered, release=release))
    renderer.start(compilation, plan)
    name, pids = renderer.shared_memory_name, renderer.process_ids
    with ThreadPoolExecutor() as executor:
        result = executor.submit(renderer.render_blocks, block_count=8, target_sample_rate=48000)
        if action == "stop":
            assert entered.wait(3)
            renderer.stop()
        match = {"timeout": "timed out", "stop": "cancelled", "crash": "exited", "second_block_error": "injected"}[action]
        with pytest.raises(PartitionCancelled if action == "stop" else PartitionRuntimeError, match=match):
            result.result(3)
    assert renderer.committed_sample == renderer.published_sample == 0
    assert_released(renderer, name, pids)


def test_dense_mailbox_split_and_single_step_limit():
    _, plan, compilation = prepared_partition()

    def capture(cls):
        renderer = cls(policy=RendererPolicy(coordination_frames=256), _worker_target=controlled_process)
        renderer.start(compilation, plan)
        name, pids = renderer.shared_memory_name, renderer.process_ids
        calls = []
        try:
            def prepare(_, sample):
                calls.append(sample)
                return midi(sample, count=256, width=700)
            result = renderer.render_blocks(block_count=8, target_sample_rate=48000, prepare_block=prepare)
            assert calls == list(range(0, 256, 32)) and renderer._sequence > 1
            with pytest.raises(MailboxCapacityError):
                renderer.render_blocks(block_count=1, target_sample_rate=48000,
                                       prepare_block=lambda _, s: midi(s, count=2048, width=700))
            assert renderer.sealed_sample == renderer.published_sample == 256
            return result.pcm_f32le, renderer._sequence
        finally:
            renderer.stop()
            assert_released(renderer, name, pids)

    assert capture(PartitionRenderCoordinator) == capture(RustCoordinator)
