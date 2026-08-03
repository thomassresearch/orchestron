from __future__ import annotations

import asyncio
import os
import time
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.main import create_app


def _client(
    tmp_path: Path,
    *,
    audio_output_mode: str = "browser_clock",
    host_midi_token: str | None = None,
    gen_audio_asset_max_bytes: int | None = None,
    gen_audio_assets_max_total_bytes: int | None = None,
    gen_audio_assets_max_count: int | None = None,
    gen_audio_asset_gc_min_age_seconds: float | None = None,
    bundle_import_max_bytes: int | None = None,
    bundle_import_json_max_bytes: int | None = None,
    bundle_import_zip_max_members: int | None = None,
    bundle_import_zip_max_uncompressed_bytes: int | None = None,
    arpeggiator_pending_input_max_events: int | None = None,
    browser_clock_manual_midi_max_future_ms: float | None = None,
    browser_clock_manual_midi_rate_per_second: float | None = None,
    browser_clock_manual_midi_burst: int | None = None,
    session_max_active: int | None = None,
    session_max_active_per_client: int | None = None,
    session_create_rate_per_minute: float | None = None,
    session_create_rate_burst: int | None = None,
    session_event_ws_max_subscriptions_total: int | None = None,
    session_event_ws_max_subscriptions_per_session: int | None = None,
    session_event_ws_connect_rate_per_minute: float | None = None,
    session_event_ws_connect_rate_burst: int | None = None,
    session_idle_timeout_seconds: float | None = None,
    app_state_max_bytes: int | None = None,
    patch_graph_max_bytes: int | None = None,
    patch_ui_layout_max_bytes: int | None = None,
    performance_config_max_bytes: int | None = None,
    persisted_json_string_max_bytes: int | None = None,
) -> TestClient:
    db_path = tmp_path / "test.db"
    static_dir = tmp_path / "static"
    frontend_dist = tmp_path / "frontend_dist"
    gen_audio_assets_dir = tmp_path / "gen_audio_assets"
    frontend_dist.mkdir(parents=True, exist_ok=True)
    (frontend_dist / "index.html").write_text("<!doctype html><html><body>client-ok</body></html>")

    os.environ["VISUALCSOUND_DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["VISUALCSOUND_STATIC_DIR"] = str(static_dir)
    os.environ["VISUALCSOUND_FRONTEND_DIST_DIR"] = str(frontend_dist)
    os.environ["VISUALCSOUND_GEN_AUDIO_ASSETS_DIR"] = str(gen_audio_assets_dir)
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "true"
    os.environ["VISUALCSOUND_AUDIO_OUTPUT_MODE"] = audio_output_mode
    if gen_audio_asset_max_bytes is None:
        os.environ.pop("VISUALCSOUND_GEN_AUDIO_ASSET_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_GEN_AUDIO_ASSET_MAX_BYTES"] = str(gen_audio_asset_max_bytes)
    if gen_audio_assets_max_total_bytes is None:
        os.environ.pop("VISUALCSOUND_GEN_AUDIO_ASSETS_MAX_TOTAL_BYTES", None)
    else:
        os.environ["VISUALCSOUND_GEN_AUDIO_ASSETS_MAX_TOTAL_BYTES"] = str(gen_audio_assets_max_total_bytes)
    if gen_audio_assets_max_count is None:
        os.environ.pop("VISUALCSOUND_GEN_AUDIO_ASSETS_MAX_COUNT", None)
    else:
        os.environ["VISUALCSOUND_GEN_AUDIO_ASSETS_MAX_COUNT"] = str(gen_audio_assets_max_count)
    if gen_audio_asset_gc_min_age_seconds is None:
        os.environ.pop("VISUALCSOUND_GEN_AUDIO_ASSET_GC_MIN_AGE_SECONDS", None)
    else:
        os.environ["VISUALCSOUND_GEN_AUDIO_ASSET_GC_MIN_AGE_SECONDS"] = str(gen_audio_asset_gc_min_age_seconds)
    if bundle_import_max_bytes is None:
        os.environ.pop("VISUALCSOUND_BUNDLE_IMPORT_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_BUNDLE_IMPORT_MAX_BYTES"] = str(bundle_import_max_bytes)
    if bundle_import_json_max_bytes is None:
        os.environ.pop("VISUALCSOUND_BUNDLE_IMPORT_JSON_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_BUNDLE_IMPORT_JSON_MAX_BYTES"] = str(bundle_import_json_max_bytes)
    if bundle_import_zip_max_members is None:
        os.environ.pop("VISUALCSOUND_BUNDLE_IMPORT_ZIP_MAX_MEMBERS", None)
    else:
        os.environ["VISUALCSOUND_BUNDLE_IMPORT_ZIP_MAX_MEMBERS"] = str(bundle_import_zip_max_members)
    if bundle_import_zip_max_uncompressed_bytes is None:
        os.environ.pop("VISUALCSOUND_BUNDLE_IMPORT_ZIP_MAX_UNCOMPRESSED_BYTES", None)
    else:
        os.environ["VISUALCSOUND_BUNDLE_IMPORT_ZIP_MAX_UNCOMPRESSED_BYTES"] = str(
            bundle_import_zip_max_uncompressed_bytes
        )
    if arpeggiator_pending_input_max_events is None:
        os.environ.pop("VISUALCSOUND_ARPEGGIATOR_PENDING_INPUT_MAX_EVENTS", None)
    else:
        os.environ["VISUALCSOUND_ARPEGGIATOR_PENDING_INPUT_MAX_EVENTS"] = str(arpeggiator_pending_input_max_events)
    if browser_clock_manual_midi_max_future_ms is None:
        os.environ.pop("VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_MAX_FUTURE_MS", None)
    else:
        os.environ["VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_MAX_FUTURE_MS"] = str(
            browser_clock_manual_midi_max_future_ms
        )
    if browser_clock_manual_midi_rate_per_second is None:
        os.environ.pop("VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_RATE_PER_SECOND", None)
    else:
        os.environ["VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_RATE_PER_SECOND"] = str(
            browser_clock_manual_midi_rate_per_second
        )
    if browser_clock_manual_midi_burst is None:
        os.environ.pop("VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_BURST", None)
    else:
        os.environ["VISUALCSOUND_BROWSER_CLOCK_MANUAL_MIDI_BURST"] = str(browser_clock_manual_midi_burst)
    if session_max_active is None:
        os.environ.pop("VISUALCSOUND_SESSION_MAX_ACTIVE", None)
    else:
        os.environ["VISUALCSOUND_SESSION_MAX_ACTIVE"] = str(session_max_active)
    if session_max_active_per_client is None:
        os.environ.pop("VISUALCSOUND_SESSION_MAX_ACTIVE_PER_CLIENT", None)
    else:
        os.environ["VISUALCSOUND_SESSION_MAX_ACTIVE_PER_CLIENT"] = str(session_max_active_per_client)
    if session_create_rate_per_minute is None:
        os.environ.pop("VISUALCSOUND_SESSION_CREATE_RATE_PER_MINUTE", None)
    else:
        os.environ["VISUALCSOUND_SESSION_CREATE_RATE_PER_MINUTE"] = str(session_create_rate_per_minute)
    if session_create_rate_burst is None:
        os.environ.pop("VISUALCSOUND_SESSION_CREATE_RATE_BURST", None)
    else:
        os.environ["VISUALCSOUND_SESSION_CREATE_RATE_BURST"] = str(session_create_rate_burst)
    if session_event_ws_max_subscriptions_total is None:
        os.environ.pop("VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_TOTAL", None)
    else:
        os.environ["VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_TOTAL"] = str(
            session_event_ws_max_subscriptions_total
        )
    if session_event_ws_max_subscriptions_per_session is None:
        os.environ.pop("VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_PER_SESSION", None)
    else:
        os.environ["VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_PER_SESSION"] = str(
            session_event_ws_max_subscriptions_per_session
        )
    if session_event_ws_connect_rate_per_minute is None:
        os.environ.pop("VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_PER_MINUTE", None)
    else:
        os.environ["VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_PER_MINUTE"] = str(
            session_event_ws_connect_rate_per_minute
        )
    if session_event_ws_connect_rate_burst is None:
        os.environ.pop("VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_BURST", None)
    else:
        os.environ["VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_BURST"] = str(
            session_event_ws_connect_rate_burst
        )
    if session_idle_timeout_seconds is None:
        os.environ.pop("VISUALCSOUND_SESSION_IDLE_TIMEOUT_SECONDS", None)
    else:
        os.environ["VISUALCSOUND_SESSION_IDLE_TIMEOUT_SECONDS"] = str(session_idle_timeout_seconds)
    if app_state_max_bytes is None:
        os.environ.pop("VISUALCSOUND_APP_STATE_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_APP_STATE_MAX_BYTES"] = str(app_state_max_bytes)
    if patch_graph_max_bytes is None:
        os.environ.pop("VISUALCSOUND_PATCH_GRAPH_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_PATCH_GRAPH_MAX_BYTES"] = str(patch_graph_max_bytes)
    if patch_ui_layout_max_bytes is None:
        os.environ.pop("VISUALCSOUND_PATCH_UI_LAYOUT_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_PATCH_UI_LAYOUT_MAX_BYTES"] = str(patch_ui_layout_max_bytes)
    if performance_config_max_bytes is None:
        os.environ.pop("VISUALCSOUND_PERFORMANCE_CONFIG_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_PERFORMANCE_CONFIG_MAX_BYTES"] = str(performance_config_max_bytes)
    if persisted_json_string_max_bytes is None:
        os.environ.pop("VISUALCSOUND_PERSISTED_JSON_STRING_MAX_BYTES", None)
    else:
        os.environ["VISUALCSOUND_PERSISTED_JSON_STRING_MAX_BYTES"] = str(persisted_json_string_max_bytes)
    if host_midi_token is None:
        os.environ.pop("VISUALCSOUND_HOST_MIDI_TOKEN", None)
    else:
        os.environ["VISUALCSOUND_HOST_MIDI_TOKEN"] = host_midi_token

    get_settings.cache_clear()
    app = create_app()
    return TestClient(app)


def _minimal_patch_payload(*, name: str = "Test Patch", description: str = ""):
    return {
        "name": name,
        "description": description,
        "schema_version": 1,
        "graph": {
            "nodes": [],
            "connections": [],
            "ui_layout": {},
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }


def _audio_source_patch_payload(*, name: str = "Audio Source", connected_snames: bool = False):
    payload = _minimal_patch_payload(name=name)
    payload["graph"]["nodes"] = [
        {"id": "sig", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
        {
            "id": "out_l",
            "opcode": "outleta",
            "params": {} if connected_snames else {"sname": "left"},
            "position": {"x": 200, "y": 20},
        },
        {
            "id": "out_r",
            "opcode": "outleta",
            "params": {} if connected_snames else {"sname": "right"},
            "position": {"x": 200, "y": 100},
        },
        {"id": "outs", "opcode": "outs", "params": {}, "position": {"x": 380, "y": 20}},
    ]
    if connected_snames:
        payload["graph"]["nodes"].extend(
            [
                {"id": "name_l", "opcode": "const_s", "params": {"value": "left"}, "position": {"x": 20, "y": 140}},
                {"id": "name_r", "opcode": "const_s", "params": {"value": "right"}, "position": {"x": 20, "y": 200}},
            ]
        )
    payload["graph"]["connections"] = [
        {"from_node_id": "sig", "from_port_id": "aout", "to_node_id": "out_l", "to_port_id": "asignal"},
        {"from_node_id": "sig", "from_port_id": "aout", "to_node_id": "out_r", "to_port_id": "asignal"},
        {"from_node_id": "sig", "from_port_id": "aout", "to_node_id": "outs", "to_port_id": "left"},
        {"from_node_id": "sig", "from_port_id": "aout", "to_node_id": "outs", "to_port_id": "right"},
    ]
    if connected_snames:
        payload["graph"]["connections"].extend(
            [
                {"from_node_id": "name_l", "from_port_id": "sout", "to_node_id": "out_l", "to_port_id": "sname"},
                {"from_node_id": "name_r", "from_port_id": "sout", "to_node_id": "out_r", "to_port_id": "sname"},
            ]
        )
    return payload


def _audio_source_patch_payload_with_outlet_names(
    *,
    name: str = "Named Audio Source",
    left_name: str = "left",
    right_name: str = "right",
):
    payload = _audio_source_patch_payload(name=name)
    for node in payload["graph"]["nodes"]:
        if node["id"] == "out_l":
            node["params"] = {"sname": left_name}
        if node["id"] == "out_r":
            node["params"] = {"sname": right_name}
    return payload


def _audio_outlet_only_source_patch_payload(*, name: str = "Audio Outlet Source"):
    payload = _audio_source_patch_payload(name=name)
    payload["graph"]["nodes"] = [node for node in payload["graph"]["nodes"] if node["id"] != "outs"]
    payload["graph"]["connections"] = [
        connection for connection in payload["graph"]["connections"] if connection["to_node_id"] != "outs"
    ]
    return payload


def _always_on_effect_patch_payload(*, name: str = "Always-On Effect", connected_snames: bool = False):
    payload = _minimal_patch_payload(name=name)
    payload["always_on"] = True
    payload["graph"]["nodes"] = [
        {
            "id": "in_l",
            "opcode": "inleta",
            "params": {} if connected_snames else {"sname": "left"},
            "position": {"x": 20, "y": 20},
        },
        {
            "id": "in_r",
            "opcode": "inleta",
            "params": {} if connected_snames else {"sname": "right"},
            "position": {"x": 20, "y": 100},
        },
        {"id": "outs", "opcode": "outs", "params": {}, "position": {"x": 260, "y": 20}},
    ]
    if connected_snames:
        payload["graph"]["nodes"].extend(
            [
                {"id": "name_l", "opcode": "const_s", "params": {"value": "left"}, "position": {"x": 20, "y": 180}},
                {"id": "name_r", "opcode": "const_s", "params": {"value": "right"}, "position": {"x": 20, "y": 240}},
            ]
        )
    payload["graph"]["connections"] = [
        {"from_node_id": "in_l", "from_port_id": "asignal", "to_node_id": "outs", "to_port_id": "left"},
        {"from_node_id": "in_r", "from_port_id": "asignal", "to_node_id": "outs", "to_port_id": "right"},
    ]
    if connected_snames:
        payload["graph"]["connections"].extend(
            [
                {"from_node_id": "name_l", "from_port_id": "sout", "to_node_id": "in_l", "to_port_id": "sname"},
                {"from_node_id": "name_r", "from_port_id": "sout", "to_node_id": "in_r", "to_port_id": "sname"},
            ]
        )
    return payload


def _always_on_effect_with_outlets_patch_payload(*, name: str = "Routable Always-On Effect"):
    payload = _always_on_effect_patch_payload(name=name)
    payload["graph"]["nodes"].extend(
        [
            {
                "id": "out_l",
                "opcode": "outleta",
                "params": {"sname": "left"},
                "position": {"x": 450, "y": 20},
            },
            {
                "id": "out_r",
                "opcode": "outleta",
                "params": {"sname": "right"},
                "position": {"x": 450, "y": 100},
            },
        ]
    )
    payload["graph"]["connections"].extend(
        [
            {"from_node_id": "in_l", "from_port_id": "asignal", "to_node_id": "out_l", "to_port_id": "asignal"},
            {"from_node_id": "in_r", "from_port_id": "asignal", "to_node_id": "out_r", "to_port_id": "asignal"},
        ]
    )
    return payload


def _sequencer_timing(
    *,
    tempo_bpm: int = 120,
    meter_numerator: int = 4,
    meter_denominator: int = 4,
    steps_per_beat: int = 4,
    beat_rate_numerator: int = 1,
    beat_rate_denominator: int = 1,
) -> dict[str, int]:
    return {
        "tempo_bpm": tempo_bpm,
        "meter_numerator": meter_numerator,
        "meter_denominator": meter_denominator,
        "steps_per_beat": steps_per_beat,
        "beat_rate_numerator": beat_rate_numerator,
        "beat_rate_denominator": beat_rate_denominator,
    }


def _sequencer_config(
    tracks: list[dict[str, object]],
    *,
    tempo_bpm: int = 120,
    meter_numerator: int = 4,
    meter_denominator: int = 4,
    steps_per_beat: int = 4,
    **extra: object,
) -> dict[str, object]:
    timing = _sequencer_timing(
        tempo_bpm=tempo_bpm,
        meter_numerator=meter_numerator,
        meter_denominator=meter_denominator,
        steps_per_beat=steps_per_beat,
    )
    config: dict[str, object] = {
        "timing": timing,
        "step_count": 8,
        "tracks": [{**track, "timing": track.get("timing", timing)} for track in tracks],
    }
    config.update(extra)
    return config


def _create_basic_patch(client: TestClient, *, name: str = "Quota Patch") -> str:
    patch_payload = {
        "name": name,
        "description": "session quota regression patch",
        "schema_version": 1,
        "graph": {
            "nodes": [
                {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
            ],
            "connections": [
                {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
            ],
            "ui_layout": {},
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }
    patch_response = client.post("/api/patches", json=patch_payload)
    assert patch_response.status_code == 201
    return patch_response.json()["id"]


def _create_running_session(client: TestClient, *, patch_name: str = "Browser Clock Patch") -> str:
    patch_payload = {
        "name": patch_name,
        "description": "browser clock runtime",
        "schema_version": 1,
        "graph": {
            "nodes": [
                {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
            ],
            "connections": [
                {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
            ],
            "ui_layout": {},
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }
    patch_response = client.post("/api/patches", json=patch_payload)
    assert patch_response.status_code == 201
    patch_id = patch_response.json()["id"]

    session_response = client.post("/api/sessions", json={"patch_id": patch_id})
    assert session_response.status_code == 201
    session_id = session_response.json()["session_id"]

    compile_response = client.post(f"/api/sessions/{session_id}/compile")
    assert compile_response.status_code == 200
    start_response = client.post(f"/api/sessions/{session_id}/start")
    assert start_response.status_code == 200
    return session_id


def _event_bus_subscription_count(client: TestClient) -> int:
    return asyncio.run(client.app.state.container.event_bus.stats()).subscription_count



class _BrowserClockRenderDriver:
    def __init__(self, client: TestClient, session_id: str, *, block_count: int = 8) -> None:
        self._client = client
        self._session_id = session_id
        self._block_count = block_count
        self._websocket_context = None
        self._websocket = None
        self.stream_config: dict[str, object] | None = None
        self._lock = threading.Lock()

    def __enter__(self) -> "_BrowserClockRenderDriver":
        start_response = self._client.post(f"/api/sessions/{self._session_id}/start")
        assert start_response.status_code == 200

        self._websocket_context = self._client.websocket_connect(
            f"/ws/sessions/{self._session_id}/browser-clock"
        )
        self._websocket = self._websocket_context.__enter__()
        self._websocket.send_json(
            {
                "type": "claim_controller",
                "audio_context_sample_rate": 48_000,
                "queue_low_water_frames": 1024,
                "queue_high_water_frames": 2048,
                "max_blocks_per_request": max(1, self._block_count),
            }
        )
        stream_config = self._websocket.receive_json()
        assert stream_config["type"] == "stream_config"
        self.stream_config = stream_config
        self._send_timing_report()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        websocket = self._websocket
        websocket_context = self._websocket_context
        self._websocket = None
        self._websocket_context = None
        if websocket is not None:
            try:
                websocket.send_json({"type": "release_controller"})
            except Exception:
                pass
        if websocket_context is not None:
            websocket_context.__exit__(exc_type, exc, tb)

    def pump_once(self, *, block_count: int | None = None) -> dict[str, object]:
        with self._lock:
            self._send_timing_report()
            assert self._websocket is not None
            requested_blocks = max(1, block_count or self._block_count)
            self._websocket.send_json({"type": "request_render", "block_count": requested_blocks})
            metadata = self._websocket.receive_json()
            assert metadata["type"] == "render_chunk"
            self._websocket.receive_bytes()
            return metadata

    def pump_for(self, duration_seconds: float) -> None:
        stream_config = self.stream_config or {}
        engine_sample_rate = max(1, int(stream_config.get("engine_sample_rate", 48_000)))
        ksmps = max(1, int(stream_config.get("ksmps", 64)))
        request_duration = (ksmps * max(1, self._block_count)) / float(engine_sample_rate)
        iterations = max(1, int(round(max(0.0, duration_seconds) / max(request_duration, 1e-6))))
        for _ in range(iterations):
            self.pump_once()

    def _send_timing_report(self) -> None:
        assert self._websocket is not None
        self._websocket.send_json(
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


def _runtime_midi_router(client: TestClient, session_id: str):
    sessions = client.app.state.container.session_service._sessions
    return sessions[session_id].midi_router



