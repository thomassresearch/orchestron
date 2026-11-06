"""Baseline contracts for later renderer changes; no parallel execution enabled."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.models.render_protocol import RendererPolicy, RenderMessage
from backend.tools._parallel_render_workload import build_workload, load_workloads
from backend.tools.benchmark_parallel_render import distribution, run_case


def message():
    return {"type": "RENDER", "protocol_version": 1, "epoch": 1, "partition_id": "branch1",
            "plan_hash": "a" * 64, "sequence": 0, "sample_start": 32, "frame_count": 32,
            "control_revision": 0, "slots": [], "midi": [], "controls": []}


def test_protocol_roundtrip_and_safe_initial_policy():
    import json
    adapter = TypeAdapter(RenderMessage)
    wire = message()
    decoded = adapter.validate_json(json.dumps(wire))
    assert adapter.validate_json(decoded.model_dump_json()) == decoded
    assert RendererPolicy().mode == "single"
    assert RendererPolicy().max_inflight_blocks == 1
    with pytest.raises(ValidationError):
        decoded.epoch = 2


@pytest.mark.parametrize("field,value", [("epoch", 0), ("sequence", -1), ("protocol_version", 2),
                                        ("frame_count", 0), ("sample_start", "32"), ("unexpected", 1)])
def test_protocol_rejects_invalid_envelopes(field, value):
    import json
    wire = {**message(), field: value}
    with pytest.raises(ValidationError):
        TypeAdapter(RenderMessage).validate_json(json.dumps(wire))


def test_protocol_preserves_deferred_release_duplicates_but_rejects_wrong_interval():
    import json
    wire = message()
    event = {"sequence": 1, "source": "lane:lead", "target_engine_sample": 32,
             "message": [128, 60, 0], "late": True}
    wire["midi"] = [event, event]
    adapter = TypeAdapter(RenderMessage)
    assert len(adapter.validate_json(json.dumps(wire)).midi) == 2
    wire["midi"] = [{**event, "target_engine_sample": 64}]
    with pytest.raises(ValidationError):
        adapter.validate_json(json.dumps(wire))
    wire["midi"] = []
    wire["controls"] = [{"channel": "gain", "value": float("nan")}]
    with pytest.raises(ValidationError):
        adapter.validate_json(json.dumps(wire))


def test_workloads_compile_stably_without_runtime_selection():
    for case in load_workloads().values():
        first, config = build_workload(case, 32)
        second, _ = build_workload(case, 32)
        assert first.csd == second.csd
        assert len(config.tracks) == case.sources * case.voices
        assert first.manifest["masterId"] == "$master"
        assert any(route["targetId"] == "$output" and route["sourceId"].startswith("source")
                   for route in first.manifest["routes"])
        if case.topology == "shared":
            assert len([r for r in first.manifest["routes"] if r["targetId"] == "shared"]) == case.sources


def test_native_baseline_refuses_mock(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    with pytest.raises(RuntimeError, match="refusing mock"):
        run_case("tiny_1", 32, 12288)


def test_baseline_percentiles_use_nearest_rank():
    assert distribution(list(range(1, 101))) == {"median": 50.5, "p95": 95, "p99": 99, "max": 100}


@pytest.mark.parametrize("ksmps", [1, 32])
def test_native_midi_block_interval_and_equal_sample_order(monkeypatch, ksmps):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "false")
    worker = CsoundWorker()
    if worker.backend != "ctcsound":
        pytest.skip("Native Csound unavailable")
    csd = (Path(__file__).parent / "fixtures/csound/midi_sample_probe.csd").read_text()
    csd = csd.replace("ksmps = 1", f"ksmps = {ksmps}")
    try:
        worker.start(csd, "internal:loopback", "null")
        worker.queue_control_channels({"gain": 1})
        events = [(ksmps - 1, [0x90, 60, 100]),
                  (2 * ksmps, [0xB0, 74, 127]), (2 * ksmps, [0xB0, 74, 0]),
                  (3 * ksmps, [0x80, 60, 0])]
        for sample, midi in events:
            assert worker.enqueue_timestamped_midi(midi, source="manual", target_engine_sample=sample)
        result = worker.render_blocks(block_count=4, target_sample_rate=48000)
        samples = np.frombuffer(result.pcm_f32le, dtype=np.float32).reshape(-1, 2)
        expected = np.zeros(4 * ksmps, dtype=np.float32)
        expected[:3 * ksmps] = .25
        np.testing.assert_array_equal(samples[:, 0], expected)
        np.testing.assert_array_equal(samples[:, 1], -expected)
    finally:
        worker.stop()


@pytest.mark.parametrize("ksmps", [1, 32])
def test_midi_after_drain_is_late_next_block_and_cursor_stays_committed(monkeypatch, ksmps):
    """Injection point is deterministic; no wall-clock scheduling assumptions."""
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    worker.start(f"sr = 48000\nksmps = {ksmps}\nnchnls = 2", "unused", "null")
    delivered, cursors = [], []
    drain = worker._midi_scheduler.drain_block

    def observed(**kwargs):
        events = drain(**kwargs)
        delivered.extend((kwargs["block_start_sample"], e.target_engine_sample, e.late) for e in events)
        return events

    class Engine:
        def performKsmps(self):
            cursors.append(worker.render_sample_cursor)
            if len(cursors) == 1:
                assert worker.enqueue_timestamped_midi([0x90, 60, 100], source="manual", target_engine_sample=0)
            return 0

        def spout(self):
            return np.zeros((ksmps, 2))

    worker._midi_scheduler.drain_block = observed
    worker._backend, worker._csound = "ctcsound", Engine()
    try:
        result = worker.render_blocks(block_count=3, target_sample_rate=48000)
        assert cursors == [0, ksmps, 2 * ksmps]
        assert delivered == [(ksmps, ksmps, True)]
        assert result.engine_sample_end == 3 * ksmps
    finally:
        worker.stop()
