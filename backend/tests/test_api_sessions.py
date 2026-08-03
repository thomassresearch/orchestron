from __future__ import annotations

import queue
import time
import threading
from pathlib import Path

from pydantic import ValidationError
import pytest
from starlette.testclient import WebSocketDenialResponse
from starlette.websockets import WebSocketDisconnect

from backend.app.models.session import BROWSER_CLOCK_MAX_SAMPLE_RATE, MidiInputRef

from backend.tests.api_test_support import (
    _client,
    _create_basic_patch,
    _create_running_session,
    _event_bus_subscription_count,
)

def test_session_event_websocket_rejects_missing_session_without_event_bus_allocation(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        with pytest.raises(WebSocketDenialResponse) as exc_info:
            with client.websocket_connect("/ws/sessions/missing-session"):
                pass

        assert exc_info.value.status_code == 404
        assert _event_bus_subscription_count(client) == 0


def test_session_event_websocket_subscribes_only_for_existing_session(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client, patch_name="Session Event WebSocket")

        assert _event_bus_subscription_count(client) == 0
        with client.websocket_connect(f"/ws/sessions/{session_id}"):
            assert _event_bus_subscription_count(client) == 1

        assert _event_bus_subscription_count(client) == 0


def test_session_event_websocket_subscription_cap_rejects_without_extra_allocation(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        audio_output_mode="browser_clock",
        session_event_ws_max_subscriptions_per_session=1,
    ) as client:
        session_id = _create_running_session(client, patch_name="Session Event WebSocket Cap")

        with client.websocket_connect(f"/ws/sessions/{session_id}"):
            assert _event_bus_subscription_count(client) == 1

            with pytest.raises(WebSocketDenialResponse) as exc_info:
                with client.websocket_connect(f"/ws/sessions/{session_id}"):
                    pass

            assert exc_info.value.status_code == 429
            assert _event_bus_subscription_count(client) == 1

        assert _event_bus_subscription_count(client) == 0


def test_session_event_websocket_total_subscription_cap_rejects_without_extra_allocation(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        audio_output_mode="browser_clock",
        session_event_ws_max_subscriptions_total=1,
    ) as client:
        first_session_id = _create_running_session(client, patch_name="Session Event WebSocket Total Cap A")
        second_session_id = _create_running_session(client, patch_name="Session Event WebSocket Total Cap B")

        with client.websocket_connect(f"/ws/sessions/{first_session_id}"):
            assert _event_bus_subscription_count(client) == 1

            with pytest.raises(WebSocketDenialResponse) as exc_info:
                with client.websocket_connect(f"/ws/sessions/{second_session_id}"):
                    pass

            assert exc_info.value.status_code == 429
            assert _event_bus_subscription_count(client) == 1

        assert _event_bus_subscription_count(client) == 0


def test_session_event_websocket_rate_limit_rejects_without_event_bus_allocation(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        audio_output_mode="browser_clock",
        session_event_ws_connect_rate_per_minute=1.0,
        session_event_ws_connect_rate_burst=1,
    ) as client:
        with pytest.raises(WebSocketDenialResponse) as first_exc_info:
            with client.websocket_connect("/ws/sessions/missing-session-a"):
                pass
        assert first_exc_info.value.status_code == 404

        with pytest.raises(WebSocketDenialResponse) as second_exc_info:
            with client.websocket_connect("/ws/sessions/missing-session-b"):
                pass

        assert second_exc_info.value.status_code == 429
        assert _event_bus_subscription_count(client) == 0



def test_health_endpoint(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_client_static_endpoint(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/client")
        assert response.status_code == 200
        assert "client-ok" in response.text


def test_root_redirects_to_client(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/", follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"].endswith("/client")


def test_session_creation_rejects_when_global_quota_reached(tmp_path: Path) -> None:
    with _client(tmp_path, session_max_active=1, session_max_active_per_client=10) as client:
        patch_id = _create_basic_patch(client)

        first = client.post("/api/sessions", json={"patch_id": patch_id})
        assert first.status_code == 201

        second = client.post("/api/sessions", json={"patch_id": patch_id})
        assert second.status_code == 429
        assert "Active session capacity reached" in second.text
        assert len(client.app.state.container.session_service._sessions) == 1


def test_session_creation_rejects_when_client_quota_reached(tmp_path: Path) -> None:
    with _client(tmp_path, session_max_active=10, session_max_active_per_client=1) as client:
        patch_id = _create_basic_patch(client)

        first = client.post("/api/sessions", json={"patch_id": patch_id})
        assert first.status_code == 201

        second = client.post("/api/sessions", json={"patch_id": patch_id})
        assert second.status_code == 429
        assert "Client active session quota reached" in second.text
        assert len(client.app.state.container.session_service._sessions) == 1


def test_session_creation_is_rate_limited_per_client(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        session_max_active=10,
        session_max_active_per_client=10,
        session_create_rate_per_minute=0.001,
        session_create_rate_burst=1,
    ) as client:
        patch_id = _create_basic_patch(client)

        first = client.post("/api/sessions", json={"patch_id": patch_id})
        assert first.status_code == 201

        second = client.post("/api/sessions", json={"patch_id": patch_id})
        assert second.status_code == 429
        assert "Session creation rate limit exceeded" in second.text
        assert int(second.headers["Retry-After"]) > 0
        assert len(client.app.state.container.session_service._sessions) == 1


def test_session_delete_frees_quota_capacity(tmp_path: Path) -> None:
    with _client(tmp_path, session_max_active=1, session_max_active_per_client=1) as client:
        patch_id = _create_basic_patch(client)

        first = client.post("/api/sessions", json={"patch_id": patch_id})
        assert first.status_code == 201
        session_id = first.json()["session_id"]

        delete = client.delete(f"/api/sessions/{session_id}")
        assert delete.status_code == 204

        second = client.post("/api/sessions", json={"patch_id": patch_id})
        assert second.status_code == 201
        assert len(client.app.state.container.session_service._sessions) == 1


def test_idle_session_expiration_frees_quota_capacity(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        session_max_active=1,
        session_max_active_per_client=1,
        session_idle_timeout_seconds=0.01,
    ) as client:
        patch_id = _create_basic_patch(client)

        first = client.post("/api/sessions", json={"patch_id": patch_id})
        assert first.status_code == 201

        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            if not client.app.state.container.session_service._sessions:
                break
            time.sleep(0.02)

        assert client.app.state.container.session_service._sessions == {}
        second = client.post("/api/sessions", json={"patch_id": patch_id})
        assert second.status_code == 201


def test_quota_rejection_happens_before_worker_allocation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(tmp_path, session_max_active=1, session_max_active_per_client=10) as client:
        patch_id = _create_basic_patch(client)

        first = client.post("/api/sessions", json={"patch_id": patch_id})
        assert first.status_code == 201

        def fail_worker_allocation(*_args, **_kwargs):
            raise AssertionError("CsoundWorker should not be allocated after quota rejection.")

        monkeypatch.setattr("backend.app.services.session_service.CsoundWorker.__init__", fail_worker_allocation)

        second = client.post("/api/sessions", json={"patch_id": patch_id})
        assert second.status_code == 429
        assert len(client.app.state.container.session_service._sessions) == 1


def test_runtime_config_exposes_browser_clock_mode(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        response = client.get("/api/runtime-config")
        assert response.status_code == 200
        assert response.json()["audio_output_mode"] == "browser_clock"
        assert response.json()["browser_clock_enabled"] is True


def test_runtime_config_maps_streaming_alias_to_browser_clock(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="streaming") as client:
        response = client.get("/api/runtime-config")
        assert response.status_code == 200
        assert response.json()["audio_output_mode"] == "browser_clock"
        assert response.json()["browser_clock_enabled"] is True


def test_runtime_config_rejects_local_audio_output_mode(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="VISUALCSOUND_AUDIO_OUTPUT_MODE=local is no longer supported"):
        _client(tmp_path, audio_output_mode="local")


def test_runtime_config_rejects_webrtc_audio_output_mode(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="VISUALCSOUND_AUDIO_OUTPUT_MODE=webrtc is no longer supported"):
        _client(tmp_path, audio_output_mode="webrtc")


def test_browser_clock_client_assets_include_shared_array_buffer_headers(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        response = client.get("/client")
        assert response.status_code == 200
        assert response.headers["cross-origin-opener-policy"] == "same-origin"
        assert response.headers["cross-origin-embedder-policy"] == "require-corp"


def test_browser_clock_controller_websocket_streams_pcm_chunks(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client)

        with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
            websocket.send_json(
                {
                    "type": "claim_controller",
                    "audio_context_sample_rate": 48_000,
                    "queue_low_water_frames": 1024,
                    "queue_high_water_frames": 2048,
                    "max_blocks_per_request": 8,
                }
            )
            stream_config = websocket.receive_json()
            assert stream_config["type"] == "stream_config"
            assert stream_config["engine_sample_rate"] == 48_000
            assert stream_config["ksmps"] == 64
            assert stream_config["channels"] == 2
            assert stream_config["target_sample_rate"] == 48_000
            assert isinstance(stream_config["server_monotonic_ns"], int)
            assert stream_config["timing_report_interval_ms"] == 100
            assert stream_config["engine_ksmps_latency_frames"] == 64

            websocket.send_json(
                {
                    "type": "clock_sync",
                    "request_id": "clock-sync-1",
                    "client_send_perf_ms": time.perf_counter() * 1000.0,
                }
            )
            clock_sync = websocket.receive_json()
            assert clock_sync["type"] == "clock_sync"
            assert clock_sync["request_id"] == "clock-sync-1"
            assert clock_sync["client_send_perf_ms"] >= 0.0
            assert isinstance(clock_sync["server_received_monotonic_ns"], int)
            assert isinstance(clock_sync["server_sent_monotonic_ns"], int)
            assert clock_sync["server_sent_monotonic_ns"] >= clock_sync["server_received_monotonic_ns"]

            websocket.send_json(
                {
                    "type": "timing_report",
                    "client_perf_ms": time.perf_counter() * 1000.0,
                    "audio_context_time_s": 0.25,
                    "queued_frames": 512,
                    "sample_rate": 48_000,
                    "pending_render_frames": 128,
                    "underrun_count": 3,
                    "clock_sync_offset_ns": 2_500_000,
                    "clock_sync_rtt_ms": 4.25,
                }
            )

            websocket.send_json(
                {
                    "type": "request_render",
                    "block_count": 2,
                    "request_id": "render-steady-1",
                    "client_perf_ms": time.perf_counter() * 1000.0,
                    "priority": "steady",
                }
            )
            metadata = websocket.receive_json()
            assert metadata["type"] == "render_chunk"
            assert metadata["engine_block_count"] == 2
            assert metadata["engine_sample_start"] == 0
            assert metadata["engine_sample_end"] == 128
            assert metadata["target_frame_count"] == 128
            assert "sequencer_status" not in metadata
            assert metadata["timeline_segments"]
            assert isinstance(metadata["transport_events"], list)
            assert metadata["telemetry"]["request_id"] == "render-steady-1"
            assert metadata["telemetry"]["priority"] == "steady"
            assert metadata["telemetry"]["queued_frames_at_start"] == 512
            assert metadata["telemetry"]["pending_render_frames_at_start"] == 128
            assert metadata["telemetry"]["underrun_count_at_start"] == 3
            assert metadata["telemetry"]["timing_sync_stale"] is False
            assert metadata["telemetry"]["clock_sync_rtt_ms"] == 4.25
            assert metadata["telemetry"]["timing_report_age_ms"] is not None
            assert metadata["telemetry"]["timing_report_age_ms"] >= 0.0
            assert metadata["telemetry"]["websocket_message_wait_ms"] is not None
            assert metadata["telemetry"]["websocket_message_wait_ms"] >= 0.0
            assert metadata["telemetry"]["render_service_time_ms"] >= 0.0
            assert isinstance(metadata["telemetry"]["server_received_monotonic_ns"], int)
            assert isinstance(metadata["telemetry"]["server_render_started_monotonic_ns"], int)
            assert isinstance(metadata["telemetry"]["server_render_completed_monotonic_ns"], int)
            assert metadata["telemetry"]["note_on_to_render_request_ms"] is None
            assert metadata["telemetry"]["note_on_to_render_complete_ms"] is None

            pcm = websocket.receive_bytes()
            assert len(pcm) == metadata["target_frame_count"] * metadata["channels"] * 4


def test_browser_clock_interactive_render_reports_note_on_latency(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Telemetry")

        with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
            websocket.send_json(
                {
                    "type": "claim_controller",
                    "audio_context_sample_rate": 48_000,
                    "queue_low_water_frames": 1024,
                    "queue_high_water_frames": 2048,
                    "max_blocks_per_request": 8,
                }
            )
            stream_config = websocket.receive_json()
            assert stream_config["type"] == "stream_config"

            websocket.send_json(
                {
                    "type": "timing_report",
                    "client_perf_ms": time.perf_counter() * 1000.0,
                    "audio_context_time_s": 0.0,
                    "queued_frames": 96,
                    "sample_rate": 48_000,
                    "pending_render_frames": 32,
                    "underrun_count": 1,
                }
            )
            websocket.send_json(
                {
                    "type": "manual_midi",
                    "midi": {"type": "note_on", "channel": 1, "note": 60, "velocity": 100},
                    "event_perf_ms": time.perf_counter() * 1000.0,
                }
            )
            websocket.send_json(
                {
                    "type": "request_render",
                    "block_count": 1,
                    "request_id": "render-interactive-1",
                    "client_perf_ms": time.perf_counter() * 1000.0,
                    "priority": "interactive",
                }
            )

            metadata = websocket.receive_json()
            assert metadata["type"] == "render_chunk"
            assert metadata["telemetry"]["request_id"] == "render-interactive-1"
            assert metadata["telemetry"]["priority"] == "interactive"
            assert metadata["telemetry"]["note_on_to_render_request_ms"] is not None
            assert metadata["telemetry"]["note_on_to_render_request_ms"] >= 0.0
            assert metadata["telemetry"]["note_on_to_render_complete_ms"] is not None
            assert metadata["telemetry"]["note_on_to_render_complete_ms"] >= metadata["telemetry"][
                "note_on_to_render_request_ms"
            ]

            pcm = websocket.receive_bytes()
            assert len(pcm) == metadata["target_frame_count"] * metadata["channels"] * 4


def test_browser_clock_render_queue_does_not_block_manual_midi(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Concurrent Control")
        runtime = client.app.state.container.session_service._sessions[session_id]
        original_render_blocks = runtime.worker.render_blocks
        render_started = threading.Event()
        allow_render_finish = threading.Event()

        def slow_render_blocks(*, block_count: int, target_sample_rate: int, before_block=None):
            render_started.set()
            assert allow_render_finish.wait(timeout=1.0)
            return original_render_blocks(
                block_count=block_count,
                target_sample_rate=target_sample_rate,
                before_block=before_block,
            )

        runtime.worker.render_blocks = slow_render_blocks

        try:
            with client.websocket_connect(f"/ws/sessions/{session_id}") as session_ws:
                with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
                    websocket.send_json(
                        {
                            "type": "claim_controller",
                            "audio_context_sample_rate": 48_000,
                            "queue_low_water_frames": 1024,
                            "queue_high_water_frames": 2048,
                            "max_blocks_per_request": 8,
                        }
                    )
                    stream_config = websocket.receive_json()
                    assert stream_config["type"] == "stream_config"

                    websocket.send_json(
                        {
                            "type": "timing_report",
                            "client_perf_ms": time.perf_counter() * 1000.0,
                            "audio_context_time_s": 0.0,
                            "queued_frames": 0,
                            "sample_rate": 48_000,
                            "pending_render_frames": 0,
                            "underrun_count": 0,
                        }
                    )
                    websocket.send_json(
                        {
                            "type": "request_render",
                            "block_count": 1,
                            "request_id": "slow-render-1",
                            "client_perf_ms": time.perf_counter() * 1000.0,
                            "priority": "steady",
                        }
                    )

                    assert render_started.wait(timeout=0.5)

                    event_queue: queue.Queue[dict[str, object]] = queue.Queue()

                    def _receive_session_event() -> None:
                        event_queue.put(session_ws.receive_json())

                    receiver = threading.Thread(target=_receive_session_event, daemon=True)
                    receiver.start()

                    websocket.send_json(
                        {
                            "type": "manual_midi",
                            "midi": {"type": "note_on", "channel": 1, "note": 60, "velocity": 100},
                            "event_perf_ms": time.perf_counter() * 1000.0,
                        }
                    )

                    midi_event = event_queue.get(timeout=0.2)
                    assert midi_event["type"] == "midi_event"
                    assert midi_event["payload"]["type"] == "note_on"
                    assert midi_event["payload"]["note"] == 60

                    allow_render_finish.set()
                    metadata = websocket.receive_json()
                    assert metadata["type"] == "render_chunk"
                    assert metadata["telemetry"]["request_id"] == "slow-render-1"
                    websocket.receive_bytes()
                    receiver.join(timeout=1.0)
        finally:
            allow_render_finish.set()
            runtime.worker.render_blocks = original_render_blocks


def test_browser_clock_rejects_oversized_claim_budget(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Oversized Claim")

        with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
            websocket.send_json(
                {
                    "type": "claim_controller",
                    "audio_context_sample_rate": BROWSER_CLOCK_MAX_SAMPLE_RATE + 1,
                    "queue_low_water_frames": 1024,
                    "queue_high_water_frames": 2048,
                    "max_blocks_per_request": 8,
                }
            )

            message = websocket.receive_json()
            assert message["type"] == "engine_error"
            assert "audio_context_sample_rate" in message["detail"]
            with pytest.raises(WebSocketDisconnect):
                websocket.receive_text()


def test_browser_clock_rejects_render_above_controller_budget(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Oversized Render")
        runtime = client.app.state.container.session_service._sessions[session_id]
        original_render_blocks = runtime.worker.render_blocks
        render_called = threading.Event()

        def capture_render_blocks(*, block_count: int, target_sample_rate: int, before_block=None):
            render_called.set()
            return original_render_blocks(
                block_count=block_count,
                target_sample_rate=target_sample_rate,
                before_block=before_block,
            )

        runtime.worker.render_blocks = capture_render_blocks

        try:
            with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
                websocket.send_json(
                    {
                        "type": "claim_controller",
                        "audio_context_sample_rate": 48_000,
                        "queue_low_water_frames": 1024,
                        "queue_high_water_frames": 2048,
                        "max_blocks_per_request": 4,
                    }
                )
                assert websocket.receive_json()["type"] == "stream_config"

                websocket.send_json(
                    {
                        "type": "request_render",
                        "block_count": 5,
                        "request_id": "oversized-render",
                        "client_perf_ms": time.perf_counter() * 1000.0,
                        "priority": "steady",
                    }
                )

                message = websocket.receive_json()
                assert message["type"] == "engine_error"
                assert "block budget" in message["detail"]
                with pytest.raises(WebSocketDisconnect):
                    websocket.receive_text()
            assert not render_called.is_set()
        finally:
            runtime.worker.render_blocks = original_render_blocks


def test_browser_clock_rejects_manual_midi_beyond_future_horizon(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        audio_output_mode="browser_clock",
        browser_clock_manual_midi_max_future_ms=10.0,
    ) as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Manual MIDI Horizon")
        arpeggiator_config = client.put(
            f"/api/sessions/{session_id}/arpeggiators/config",
            json={
                "tempo_bpm": 120,
                "arpeggiators": [
                    {
                        "arpeggiator_id": "arp-1",
                        "enabled": True,
                        "input_channel": 1,
                        "target_channel": 2,
                    }
                ],
            },
        )
        assert arpeggiator_config.status_code == 200

        with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
            websocket.send_json(
                {
                    "type": "claim_controller",
                    "audio_context_sample_rate": 48_000,
                    "queue_low_water_frames": 1024,
                    "queue_high_water_frames": 2048,
                    "max_blocks_per_request": 8,
                }
            )
            assert websocket.receive_json()["type"] == "stream_config"

            now_client_perf_ms = time.perf_counter() * 1000.0
            websocket.send_json(
                {
                    "type": "timing_report",
                    "client_perf_ms": now_client_perf_ms,
                    "audio_context_time_s": 0.0,
                    "queued_frames": 0,
                    "sample_rate": 48_000,
                    "pending_render_frames": 0,
                    "underrun_count": 0,
                }
            )
            websocket.send_json(
                {
                    "type": "manual_midi",
                    "midi": {"type": "note_on", "channel": 1, "note": 60, "velocity": 100},
                    "event_perf_ms": now_client_perf_ms + 100.0,
                }
            )

            message = websocket.receive_json()
            assert message["type"] == "engine_error"
            assert "too far in the future" in message["detail"]
            with pytest.raises(WebSocketDisconnect):
                websocket.receive_text()


def test_browser_clock_rate_limits_manual_midi(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        audio_output_mode="browser_clock",
        browser_clock_manual_midi_rate_per_second=0.001,
        browser_clock_manual_midi_burst=1,
    ) as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Manual MIDI Rate Limit")

        with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
            websocket.send_json(
                {
                    "type": "claim_controller",
                    "audio_context_sample_rate": 48_000,
                    "queue_low_water_frames": 1024,
                    "queue_high_water_frames": 2048,
                    "max_blocks_per_request": 8,
                }
            )
            assert websocket.receive_json()["type"] == "stream_config"

            manual_midi = {
                "type": "manual_midi",
                "midi": {"type": "note_on", "channel": 1, "note": 60, "velocity": 100},
            }
            websocket.send_json(manual_midi)
            websocket.send_json(manual_midi)

            message = websocket.receive_json()
            assert message["type"] == "engine_error"
            assert "rate limit" in message["detail"]
            with pytest.raises(WebSocketDisconnect):
                websocket.receive_text()


def test_browser_clock_coalesces_steady_render_queue_when_full(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Render Queue Budget")
        runtime = client.app.state.container.session_service._sessions[session_id]
        original_render_blocks = runtime.worker.render_blocks
        render_started = threading.Event()
        allow_render_finish = threading.Event()
        rendered_block_counts: list[int] = []

        def slow_first_render_blocks(*, block_count: int, target_sample_rate: int, before_block=None):
            rendered_block_counts.append(block_count)
            render_started.set()
            assert allow_render_finish.wait(timeout=1.0)
            return original_render_blocks(
                block_count=block_count,
                target_sample_rate=target_sample_rate,
                before_block=before_block,
            )

        runtime.worker.render_blocks = slow_first_render_blocks

        try:
            with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as websocket:
                websocket.send_json(
                    {
                        "type": "claim_controller",
                        "audio_context_sample_rate": 48_000,
                        "queue_low_water_frames": 1024,
                        "queue_high_water_frames": 2048,
                        "max_blocks_per_request": 8,
                    }
                )
                assert websocket.receive_json()["type"] == "stream_config"

                websocket.send_json(
                    {
                        "type": "request_render",
                        "block_count": 1,
                        "request_id": "active-render",
                        "client_perf_ms": time.perf_counter() * 1000.0,
                        "priority": "steady",
                    }
                )
                assert render_started.wait(timeout=0.5)

                for index in range(9):
                    websocket.send_json(
                        {
                            "type": "request_render",
                            "block_count": 1,
                            "request_id": f"queued-render-{index}",
                            "client_perf_ms": time.perf_counter() * 1000.0,
                            "priority": "steady",
                        }
                    )

                allow_render_finish.set()
                first = websocket.receive_json()
                assert first["type"] == "render_chunk"
                assert first["engine_block_count"] == 1
                websocket.receive_bytes()

                second = websocket.receive_json()
                assert second["type"] == "render_chunk"
                assert second["engine_block_count"] == 8
                websocket.receive_bytes()

            assert rendered_block_counts == [1, 8]
        finally:
            allow_render_finish.set()
            runtime.worker.render_blocks = original_render_blocks


def test_browser_clock_controller_takeover_revokes_previous_browser(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock") as client:
        session_id = _create_running_session(client, patch_name="Browser Clock Takeover")

        with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as first:
            first.send_json(
                {
                    "type": "claim_controller",
                    "audio_context_sample_rate": 48_000,
                    "queue_low_water_frames": 1024,
                    "queue_high_water_frames": 2048,
                    "max_blocks_per_request": 8,
                }
            )
            first_config = first.receive_json()
            assert first_config["type"] == "stream_config"

            with client.websocket_connect(f"/ws/sessions/{session_id}/browser-clock") as second:
                second.send_json(
                    {
                        "type": "claim_controller",
                        "audio_context_sample_rate": 48_000,
                        "queue_low_water_frames": 1024,
                        "queue_high_water_frames": 2048,
                        "max_blocks_per_request": 8,
                    }
                )
                second_config = second.receive_json()
                assert second_config["type"] == "stream_config"

                revoked = first.receive_json()
                assert revoked["type"] == "controller_revoked"

                with pytest.raises(WebSocketDisconnect):
                    first.receive_text()


def test_host_midi_bridge_inventory_and_external_event_delivery(tmp_path: Path) -> None:
    with _client(tmp_path, audio_output_mode="browser_clock", host_midi_token="test-token") as client:
        session_id = _create_running_session(client, patch_name="Host MIDI Bridge")

        with client.websocket_connect(f"/ws/sessions/{session_id}") as session_ws:
            with client.websocket_connect("/ws/host-midi", headers={"authorization": "Bearer test-token"}) as host_ws:
                host_ws.send_json(
                    {
                        "type": "register_host",
                        "host_id": "host-a",
                        "host_name": "Test Host",
                        "protocol_version": 1,
                    }
                )
                registered = host_ws.receive_json()
                assert registered["type"] == "host_registered"
                assert registered["host_id"] == "host-a"

                host_ws.send_json(
                    {
                        "type": "device_inventory",
                        "devices": [
                            {
                                "id": "host:keyboard:a",
                                "name": "Host Keyboard",
                                "backend": "host_bridge",
                                "selector": "keyboard-a",
                                "host_id": "host-a",
                                "timestamp_quality": "authoritative",
                            }
                        ],
                    }
                )
                inventory_ack = host_ws.receive_json()
                assert inventory_ack == {
                    "type": "device_inventory_ack",
                    "host_id": "host-a",
                    "device_count": 1,
                }

                midi_inputs = client.get("/api/midi/inputs")
                assert midi_inputs.status_code == 200
                assert midi_inputs.json()[0]["id"] == "internal:loopback"
                assert any(item["id"] == "host:keyboard:a" for item in midi_inputs.json())

                bound = client.put(
                    f"/api/sessions/{session_id}/midi-input",
                    json={"midi_input": "host:keyboard:a"},
                )
                assert bound.status_code == 200
                assert bound.json()["midi_input"] == "host:keyboard:a"

                midi_bound_event = session_ws.receive_json()
                assert midi_bound_event["type"] == "midi_bound"

                host_ws.send_json(
                    {
                        "type": "midi_events",
                        "events": [
                            {
                                "device_id": "host:keyboard:a",
                                "midi": [0x90, 60, 100],
                                "timestamp_ns": 123_456_789,
                            }
                        ],
                    }
                )

                external_event = session_ws.receive_json()
                assert external_event["type"] == "midi_event"
                assert external_event["payload"]["type"] == "note_on"
                assert external_event["payload"]["note"] == 60
                assert external_event["payload"]["sync_stale"] is True

            midi_inputs_after_disconnect = client.get("/api/midi/inputs")
            assert midi_inputs_after_disconnect.status_code == 200
            assert all(item["id"] != "host:keyboard:a" for item in midi_inputs_after_disconnect.json())

            internal_event = client.post(
                f"/api/sessions/{session_id}/midi-event",
                json={"type": "note_on", "channel": 1, "note": 61, "velocity": 90},
            )
            assert internal_event.status_code == 200

            internal_event_payload = session_ws.receive_json()
            assert internal_event_payload["type"] == "midi_event"
            assert internal_event_payload["payload"]["note"] == 61
            assert "sync_stale" not in internal_event_payload["payload"]


def test_bind_midi_input_normalizes_legacy_selector_to_stable_id(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        container = client.app.state.container
        stable_input = MidiInputRef(
            id="mido:arturia-keystep-37:abcdef123456",
            name="Arturia KeyStep 37",
            backend="mido",
            selector="3",
        )
        container.midi_service.list_inputs = lambda: [stable_input]

        patch_payload = {
            "name": "MIDI Binding Patch",
            "description": "selector migration",
            "schema_version": 1,
            "graph": {
                "nodes": [{"id": "n1", "opcode": "outs", "params": {}, "position": {"x": 10, "y": 10}}],
                "connections": [],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }
        created_patch = client.post("/api/patches", json=patch_payload)
        assert created_patch.status_code == 201
        patch_id = created_patch.json()["id"]

        created_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert created_session.status_code == 201
        session_id = created_session.json()["session_id"]

        response = client.put(f"/api/sessions/{session_id}/midi-input", json={"midi_input": "3"})
        assert response.status_code == 200
        assert response.json()["midi_input"] == stable_input.id


