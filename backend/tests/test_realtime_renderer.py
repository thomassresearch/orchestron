from __future__ import annotations

from dataclasses import asdict

import pytest

from backend.app.engine import csound_worker
from backend.app.engine.realtime_renderer import EngineRenderResult, EngineStartResult, RealtimeRenderer
from backend.app.engine.renderer_factory import create_realtime_renderer
from backend.app.engine.session_runtime import RuntimeSession


MOCK_CSD = "sr = 48000\nksmps = 32\nnchnls = 2"


def test_session_defaults_to_distinct_original_single_renderers(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    first = RuntimeSession(session_id="first", instruments=[])
    second = RuntimeSession(session_id="second", instruments=[])
    assert type(first.worker) is type(second.worker) is csound_worker.CsoundWorker
    assert isinstance(first.worker, RealtimeRenderer)
    assert first.worker is not second.worker
    assert first.worker.performance_controllers is not second.worker.performance_controllers
    assert first.worker.lane_output is not second.worker.lane_output
    first.worker.start(MOCK_CSD, "internal:loopback", "null")
    try:
        first.worker.render_blocks(block_count=2, target_sample_rate=48000)
        assert first.worker.render_sample_cursor == 64
        assert second.worker.render_sample_cursor == 0
        assert not second.worker.is_running
    finally:
        first.worker.stop()


@pytest.mark.parametrize("mock_reason", ["explicit", "unavailable"])
def test_factory_preserves_mock_fallback_lifecycle_and_result_contract(monkeypatch, mock_reason):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", str(mock_reason == "explicit"))
    attempts = []

    def unavailable():
        attempts.append(True)
        raise ImportError("intentional missing native binding")

    monkeypatch.setattr(csound_worker, "load_ctcsound_module", unavailable)
    renderer = create_realtime_renderer()
    assert type(renderer) is csound_worker.CsoundWorker
    assert isinstance(renderer, RealtimeRenderer)
    assert attempts == ([] if mock_reason == "explicit" else [True])
    assert renderer.backend == "mock" and not renderer.browser_clock_ready
    assert csound_worker.EngineStartResult is EngineStartResult
    assert csound_worker.EngineRenderResult is EngineRenderResult

    started = renderer.start(MOCK_CSD, "internal:loopback", "null")
    try:
        assert type(started) is EngineStartResult
        assert (started.backend, started.audio_mode) == ("mock", "browser_clock")
        assert renderer.start(MOCK_CSD, "internal:loopback", "null").detail == "already running"
        assert not renderer.accepts_direct_midi and not renderer.browser_clock_ready
        assert renderer.enqueue_timestamped_midi([0x90, 60, 100], source="manual", target_engine_sample=32)
        assert renderer.run_at_render_boundary(lambda: "applied") == "applied"
        observed = []
        rendered = renderer.render_blocks(
            block_count=3, target_sample_rate=24000,
            before_block=lambda index, sample: observed.append((index, sample, renderer.render_sample_cursor)),
        )
        assert observed == [(0, 0, 0), (1, 32, 32), (2, 64, 64)]
        assert type(rendered) is EngineRenderResult
        assert asdict(rendered) == {
            "engine_sample_start": 0, "engine_sample_end": 96, "engine_sample_rate": 48000,
            "target_sample_rate": 24000, "channels": 2, "block_count": 3,
            "target_frame_count": 48, "pcm_f32le": bytes(48 * 2 * 4),
        }

        def failed_edit():
            raise ValueError("intentional edit failure")

        with pytest.raises(ValueError, match="intentional edit failure"):
            renderer.run_at_render_boundary(failed_edit)
        assert renderer.is_running and renderer.render_sample_cursor == 96
    finally:
        assert renderer.stop() == "stopped"
    assert renderer.render_sample_cursor == 0 and not renderer.is_running
    with pytest.raises(RuntimeError, match="must be running"):
        renderer.render_blocks(block_count=1, target_sample_rate=48000)
    assert renderer.stop() == "already stopped"
    renderer.start(MOCK_CSD, "internal:loopback", "null")
    try:
        assert renderer.render_blocks(block_count=1, target_sample_rate=48000).engine_sample_start == 0
    finally:
        renderer.stop()


def test_factory_does_not_hide_native_start_errors_with_mock_fallback(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "false")
    monkeypatch.setattr(csound_worker, "load_ctcsound_module", object)

    def fail_start(*_args):
        raise RuntimeError("intentional native compile failure")

    monkeypatch.setattr(csound_worker.CsoundWorker, "_start_ctcsound", fail_start)
    renderer = create_realtime_renderer()
    with pytest.raises(RuntimeError, match="intentional native compile failure"):
        renderer.start("invalid", "internal:loopback", "null")
    assert renderer.backend == "ctcsound"
    assert not renderer.is_running
    assert renderer.render_sample_cursor == 0
