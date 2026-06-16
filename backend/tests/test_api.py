from __future__ import annotations

import asyncio
from io import BytesIO
import json
import os
import queue
import time
import threading
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient
import mido
from pydantic import ValidationError
import pytest
from starlette.testclient import WebSocketDenialResponse
from starlette.websockets import WebSocketDisconnect

from backend.app.models.export import (
    OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS,
    OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS,
    PerformanceCsdExportRequest,
)
from backend.app.models.patch import (
    MAX_GEN_ARGUMENT_COUNT,
    MAX_GEN_RAW_ARG_TOKEN_LENGTH,
    MAX_GEN_TABLE_SIZE,
)
from backend.app.models.session import BROWSER_CLOCK_MAX_SAMPLE_RATE, MidiInputRef
from backend.app.core.config import get_settings
from backend.app.main import create_app
from backend.app.services import performance_export_service
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.persisted_json_limits import PERSISTED_JSON_REQUEST_OVERHEAD_BYTES
from backend.app.services.performance_export_service import (
    OfflineMidiExportBudgetExceededError,
    OfflineMidiExportTimeoutError,
    PerformanceExportService,
)


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


def test_app_state_round_trip(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        missing = client.get("/api/app-state")
        assert missing.status_code == 404

        payload = {
            "state": {
                "version": 1,
                "activePage": "sequencer",
                "performanceName": "Last Set",
                "sequencer": {"bpm": 128, "tracks": []},
            }
        }
        saved = client.put("/api/app-state", json=payload)
        assert saved.status_code == 200
        saved_body = saved.json()
        assert saved_body["state"] == payload["state"]
        first_updated_at = saved_body["updated_at"]

        loaded = client.get("/api/app-state")
        assert loaded.status_code == 200
        assert loaded.json()["state"] == payload["state"]

        updated = client.put(
            "/api/app-state",
            json={"state": {"version": 1, "activePage": "config", "performanceName": "Last Set (Updated)"}},
        )
        assert updated.status_code == 200
        updated_body = updated.json()
        assert updated_body["state"]["activePage"] == "config"
        assert updated_body["updated_at"] >= first_updated_at


def test_app_state_rejects_oversized_persisted_document_without_overwriting(tmp_path: Path) -> None:
    with _client(tmp_path, app_state_max_bytes=64, persisted_json_string_max_bytes=1024) as client:
        initial = {"state": {"version": 1, "activePage": "instrument"}}
        assert client.put("/api/app-state", json=initial).status_code == 200

        response = client.put("/api/app-state", json={"state": {"version": 1, "blob": "x" * 80}})

        assert response.status_code == 422
        assert "state exceeds maximum persisted JSON size" in response.text
        loaded = client.get("/api/app-state")
        assert loaded.status_code == 200
        assert loaded.json()["state"] == initial["state"]


def test_app_state_rejects_oversized_nested_string(tmp_path: Path) -> None:
    with _client(tmp_path, app_state_max_bytes=1024, persisted_json_string_max_bytes=8) as client:
        response = client.put("/api/app-state", json={"state": {"nested": {"blob": "x" * 9}}})

        assert response.status_code == 422
        assert "state.nested.blob exceeds maximum persisted JSON string size" in response.text


def test_app_state_rejects_oversized_request_before_json_parsing(tmp_path: Path) -> None:
    body_limit = 64 + PERSISTED_JSON_REQUEST_OVERHEAD_BYTES
    with _client(tmp_path, app_state_max_bytes=64, persisted_json_string_max_bytes=body_limit * 2) as client:
        response = client.put("/api/app-state", json={"state": {"blob": "x" * body_limit}})

        assert response.status_code == 413
        assert "Persistent JSON request exceeds maximum size" in response.text


def test_patch_ui_layout_supports_nested_sequencer_payload(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Layout Patch",
            "description": "ui layout nesting",
            "schema_version": 1,
            "graph": {
                "nodes": [],
                "connections": [],
                "ui_layout": {
                    "sequencer": {
                        "bpm": 120,
                        "midiChannel": 1,
                        "stepCount": 32,
                        "steps": [60, None, 67, None] + [None] * 28,
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        created = client.post("/api/patches", json=patch_payload)
        assert created.status_code == 201
        patch_id = created.json()["id"]

        loaded = client.get(f"/api/patches/{patch_id}")
        assert loaded.status_code == 200
        sequencer = loaded.json()["graph"]["ui_layout"]["sequencer"]
        assert sequencer["bpm"] == 120
        assert sequencer["midiChannel"] == 1
        assert sequencer["stepCount"] == 32
        assert len(sequencer["steps"]) == 32
        assert sequencer["steps"][0] == 60
        assert sequencer["steps"][1] is None


def test_patch_description_length_limit_is_2048_characters(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        allowed_description = "a" * 2048
        created = client.post(
            "/api/patches",
            json=_minimal_patch_payload(name="Description Limit Patch", description=allowed_description),
        )

        assert created.status_code == 201
        patch_id = created.json()["id"]
        assert created.json()["description"] == allowed_description
        assert client.get("/api/patches").json()[0]["description"] == allowed_description

        rejected_create = client.post(
            "/api/patches",
            json=_minimal_patch_payload(name="Oversized Description Patch", description="b" * 2049),
        )
        assert rejected_create.status_code == 422
        assert "2048" in rejected_create.text

        rejected_update = client.put(f"/api/patches/{patch_id}", json={"description": "c" * 2049})
        assert rejected_update.status_code == 422
        assert "2048" in rejected_update.text

        loaded = client.get(f"/api/patches/{patch_id}")
        assert loaded.status_code == 200
        assert loaded.json()["description"] == allowed_description


def test_patch_template_flag_defaults_and_updates(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        regular = client.post("/api/patches", json=_minimal_patch_payload(name="Regular Patch"))
        assert regular.status_code == 201
        assert regular.json()["is_template"] is False
        assert client.get("/api/patches").json()[0]["is_template"] is False

        template_payload = _minimal_patch_payload(name="Template Patch")
        template_payload["is_template"] = True
        template = client.post("/api/patches", json=template_payload)
        assert template.status_code == 201
        patch_id = template.json()["id"]
        assert template.json()["is_template"] is True

        listed = client.get("/api/patches").json()
        assert listed[0]["id"] == patch_id
        assert listed[0]["is_template"] is True

        updated = client.put(f"/api/patches/{patch_id}", json={"is_template": False})
        assert updated.status_code == 200
        assert updated.json()["is_template"] is False
        loaded = client.get(f"/api/patches/{patch_id}")
        assert loaded.status_code == 200
        assert loaded.json()["is_template"] is False


def test_patch_always_on_flag_and_audio_port_summaries(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        regular = client.post("/api/patches", json=_minimal_patch_payload(name="Regular Patch"))
        assert regular.status_code == 201
        assert regular.json()["always_on"] is False

        missing_inleta_message = 'always on instruments require at least one "inleta" instance'
        rejected_create_payload = _minimal_patch_payload(name="Invalid Always-On Patch")
        rejected_create_payload["always_on"] = True
        rejected_create = client.post("/api/patches", json=rejected_create_payload)
        assert rejected_create.status_code == 422
        assert rejected_create.json()["detail"] == missing_inleta_message

        rejected_update = client.put(f"/api/patches/{regular.json()['id']}", json={"always_on": True})
        assert rejected_update.status_code == 422
        assert rejected_update.json()["detail"] == missing_inleta_message

        effect = client.post("/api/patches", json=_always_on_effect_patch_payload(name="Stereo Effect"))
        assert effect.status_code == 201
        patch_id = effect.json()["id"]
        assert effect.json()["always_on"] is True

        listed = client.get("/api/patches").json()
        listed_effect = next(patch for patch in listed if patch["id"] == patch_id)
        assert listed_effect["always_on"] is True
        assert listed_effect["audio_inlet_names"] == ["left", "right"]
        assert listed_effect["audio_outlet_names"] == []

        source = client.post("/api/patches", json=_audio_source_patch_payload(name="Stereo Source"))
        assert source.status_code == 201
        listed = client.get("/api/patches").json()
        listed_source = next(patch for patch in listed if patch["id"] == source.json()["id"])
        assert listed_source["always_on"] is False
        assert listed_source["audio_inlet_names"] == []
        assert listed_source["audio_outlet_names"] == ["left", "right"]

        connected_effect = client.post(
            "/api/patches",
            json=_always_on_effect_patch_payload(name="Connected Stereo Effect", connected_snames=True),
        )
        connected_source = client.post(
            "/api/patches",
            json=_audio_source_patch_payload(name="Connected Stereo Source", connected_snames=True),
        )
        assert connected_effect.status_code == 201
        assert connected_source.status_code == 201
        listed = client.get("/api/patches").json()
        listed_connected_effect = next(patch for patch in listed if patch["id"] == connected_effect.json()["id"])
        listed_connected_source = next(patch for patch in listed if patch["id"] == connected_source.json()["id"])
        assert listed_connected_effect["audio_inlet_names"] == ["left", "right"]
        assert listed_connected_source["audio_outlet_names"] == ["left", "right"]

        updated = client.put(f"/api/patches/{patch_id}", json={"always_on": False})
        assert updated.status_code == 200
        assert updated.json()["always_on"] is False
        loaded = client.get(f"/api/patches/{patch_id}")
        assert loaded.status_code == 200
        assert loaded.json()["always_on"] is False


def test_template_patch_cannot_create_runtime_session(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = _minimal_patch_payload(name="Draft Template")
        patch_payload["is_template"] = True
        patch_payload["graph"]["nodes"] = [  # type: ignore[index]
            {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}}
        ]

        created = client.post("/api/patches", json=patch_payload)
        assert created.status_code == 201

        response = client.post("/api/sessions", json={"patch_id": created.json()["id"]})
        assert response.status_code == 422
        assert "template" in response.text


def test_patch_create_rejects_oversized_graph_document(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        patch_graph_max_bytes=128,
        patch_ui_layout_max_bytes=1024,
        persisted_json_string_max_bytes=1024,
    ) as client:
        response = client.post(
            "/api/patches",
            json={
                "name": "Oversized Patch",
                "description": "",
                "schema_version": 1,
                "graph": {
                    "nodes": [],
                    "connections": [],
                    "ui_layout": {"blob": "x" * 160},
                    "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
                },
            },
        )

        assert response.status_code == 422
        assert "graph exceeds maximum persisted JSON size" in response.text
        assert client.get("/api/patches").json() == []


def test_patch_update_rejects_oversized_ui_layout_without_overwriting(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        patch_graph_max_bytes=4096,
        patch_ui_layout_max_bytes=128,
        persisted_json_string_max_bytes=1024,
    ) as client:
        payload = {
            "name": "Limited Layout Patch",
            "description": "",
            "schema_version": 1,
            "graph": {
                "nodes": [],
                "connections": [],
                "ui_layout": {"label": "ok"},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }
        created = client.post("/api/patches", json=payload)
        assert created.status_code == 201
        patch_id = created.json()["id"]

        response = client.put(
            f"/api/patches/{patch_id}",
            json={
                "graph": {
                    **payload["graph"],
                    "ui_layout": {"blob": "x" * 180},
                }
            },
        )

        assert response.status_code == 422
        assert "graph.ui_layout exceeds maximum persisted JSON size" in response.text
        loaded = client.get(f"/api/patches/{patch_id}")
        assert loaded.status_code == 200
        assert loaded.json()["graph"]["ui_layout"] == payload["graph"]["ui_layout"]


def test_patch_rejects_oversized_nested_ui_layout_string(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        patch_graph_max_bytes=4096,
        patch_ui_layout_max_bytes=1024,
        persisted_json_string_max_bytes=8,
    ) as client:
        response = client.post(
            "/api/patches",
            json={
                "name": "Nested String Patch",
                "description": "",
                "schema_version": 1,
                "graph": {
                    "nodes": [],
                    "connections": [],
                    "ui_layout": {"nested": {"blob": "x" * 9}},
                    "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
                },
            },
        )

        assert response.status_code == 422
        assert "graph.ui_layout.nested.blob exceeds maximum persisted JSON string size" in response.text


def test_performance_crud_round_trips_config_payload(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        performance_config = {
            "version": 2,
            "instruments": [{"patchId": "patch-alpha", "midiChannel": 1}],
            "sequencer": {
                "bpm": 128,
                "stepCount": 16,
                "tracks": [
                    {
                        "id": "voice-1",
                        "name": "Kick",
                        "midiChannel": 1,
                        "stepCount": 16,
                        "scaleRoot": "C",
                        "scaleType": "minor",
                        "mode": "aeolian",
                        "activePad": 0,
                        "queuedPad": None,
                        "pads": [[36] + [None] * 31] + [[None] * 32 for _ in range(7)],
                        "enabled": False,
                        "queuedEnabled": None,
                    }
                ],
                "pianoRolls": [
                    {
                        "id": "piano-1",
                        "name": "Piano Roll 1",
                        "midiChannel": 2,
                        "scaleRoot": "C",
                        "scaleType": "minor",
                        "mode": "aeolian",
                        "enabled": False,
                    }
                ],
            },
        }

        create_response = client.post(
            "/api/performances",
            json={
                "name": "Live Set A",
                "description": "Main venue set",
                "config": performance_config,
            },
        )
        assert create_response.status_code == 201
        created = create_response.json()
        performance_id = created["id"]
        assert created["config"] == performance_config

        list_response = client.get("/api/performances")
        assert list_response.status_code == 200
        assert any(item["id"] == performance_id for item in list_response.json())

        get_response = client.get(f"/api/performances/{performance_id}")
        assert get_response.status_code == 200
        assert get_response.json()["name"] == "Live Set A"
        assert get_response.json()["config"] == performance_config

        updated_config = {
            **performance_config,
            "sequencer": {
                **performance_config["sequencer"],
                "bpm": 132,
            },
        }
        update_response = client.put(
            f"/api/performances/{performance_id}",
            json={"name": "Live Set A (Updated)", "description": "Updated arrangement", "config": updated_config},
        )
        assert update_response.status_code == 200
        updated = update_response.json()
        assert updated["name"] == "Live Set A (Updated)"
        assert updated["description"] == "Updated arrangement"
        assert updated["config"] == updated_config

        delete_response = client.delete(f"/api/performances/{performance_id}")
        assert delete_response.status_code == 204

        missing_response = client.get(f"/api/performances/{performance_id}")
        assert missing_response.status_code == 404


def test_performance_create_rejects_oversized_config_document(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        performance_config_max_bytes=64,
        persisted_json_string_max_bytes=1024,
    ) as client:
        response = client.post(
            "/api/performances",
            json={
                "name": "Oversized Performance",
                "description": "",
                "config": {"version": 2, "blob": "x" * 80},
            },
        )

        assert response.status_code == 422
        assert "config exceeds maximum persisted JSON size" in response.text
        assert client.get("/api/performances").json() == []


def test_performance_update_rejects_oversized_nested_config_string_without_overwriting(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        performance_config_max_bytes=1024,
        persisted_json_string_max_bytes=8,
    ) as client:
        created = client.post(
            "/api/performances",
            json={"name": "Limited Performance", "description": "", "config": {"version": 2, "label": "ok"}},
        )
        assert created.status_code == 201
        performance_id = created.json()["id"]

        response = client.put(
            f"/api/performances/{performance_id}",
            json={"config": {"version": 2, "nested": {"blob": "x" * 9}}},
        )

        assert response.status_code == 422
        assert "config.nested.blob exceeds maximum persisted JSON string size" in response.text
        loaded = client.get(f"/api/performances/{performance_id}")
        assert loaded.status_code == 200
        assert loaded.json()["config"] == {"version": 2, "label": "ok"}


def test_opcodes_include_markdown_documentation(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/api/opcodes")
        assert response.status_code == 200

        opcodes_by_name = {item["name"]: item for item in response.json()}
        oscili = opcodes_by_name["oscili"]

        assert "documentation_markdown" in oscili
        assert "documentation_url" in oscili
        assert "oscili" in oscili["documentation_markdown"].lower()
        assert oscili["documentation_url"].startswith("https://csound.com/docs/manual/")


def test_opcodes_include_cross_modulation_and_tanh_metadata(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/api/opcodes")
        assert response.status_code == 200

        opcodes_by_name = {item["name"]: item for item in response.json()}

    tanh = opcodes_by_name["tanh"]
    assert tanh["category"] == "math"
    assert tanh["documentation_url"] == "https://csound.com/docs/manual/tanh.html"
    assert tanh["template"] == "{aout} = tanh({xin})"
    assert tanh["inputs"][0]["id"] == "xin"
    assert tanh["inputs"][0]["signal_type"] == "a"
    assert tanh["inputs"][0]["accepted_signal_types"] == ["a", "k", "i"]
    assert tanh["outputs"][0]["signal_type"] == "a"

    for opcode_name in ("crossfmi", "crosspmi", "crossfmpmi"):
        opcode = opcodes_by_name[opcode_name]
        assert opcode["category"] == "fm"
        assert opcode["documentation_url"] == "https://csound.com/docs/manual/crossfm.html"
        assert opcode["icon"] == "/static/icons/vco.svg"
        assert [output["id"] for output in opcode["outputs"]] == ["a1", "a2"]
        assert [output["signal_type"] for output in opcode["outputs"]] == ["a", "a"]
        assert [input_port["id"] for input_port in opcode["inputs"]] == [
            "xfrq1",
            "xfrq2",
            "xndx1",
            "xndx2",
            "kcps",
            "ifn1",
            "ifn2",
            "iphs1",
            "iphs2",
        ]
        assert opcode["inputs"][0]["accepted_signal_types"] == ["a", "k", "i"]
        assert opcode["inputs"][4]["accepted_signal_types"] == ["k", "i"]
        assert opcode["inputs"][-2]["required"] is False
        assert opcode["inputs"][-1]["required"] is False
        assert opcode["template"].startswith(f"{{a1}}, {{a2}} {opcode_name} ")


def test_add_opcodes_guide_exists_and_contains_key_references() -> None:
    docs_path = Path(__file__).resolve().parents[2] / "ADD_OPCODES.md"
    assert docs_path.exists()

    text = docs_path.read_text(encoding="utf-8")
    assert "https://csound.com/docs/manual/PartReference.html" in text
    assert "backend/app/data/opcodes.json" in text
    assert "backend/app/services/compiler_orchestra.py" in text
    assert "frontend/src/lib/documentation.ts" in text


def test_patch_compile_and_runtime_flow(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Runtime Patch",
            "description": "test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "midi_note", "params": {}, "position": {"x": 50, "y": 50}},
                    {
                        "id": "n2",
                        "opcode": "adsr",
                        "params": {"iatt": 0.01, "idec": 0.2, "islev": 0.6, "irel": 0.15},
                        "position": {"x": 230, "y": 50},
                    },
                    {"id": "n3", "opcode": "k_mul", "params": {}, "position": {"x": 410, "y": 50}},
                    {
                        "id": "n4",
                        "opcode": "oscili",
                        "params": {"ifn": 1},
                        "position": {"x": 580, "y": 50},
                    },
                    {"id": "n5", "opcode": "outs", "params": {}, "position": {"x": 760, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "kamp", "to_node_id": "n3", "to_port_id": "a"},
                    {"from_node_id": "n2", "from_port_id": "kenv", "to_node_id": "n3", "to_port_id": "b"},
                    {"from_node_id": "n3", "from_port_id": "kout", "to_node_id": "n4", "to_port_id": "amp"},
                    {"from_node_id": "n1", "from_port_id": "kfreq", "to_node_id": "n4", "to_port_id": "freq"},
                    {"from_node_id": "n4", "from_port_id": "asig", "to_node_id": "n5", "to_port_id": "left"},
                    {"from_node_id": "n4", "from_port_id": "asig", "to_node_id": "n5", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        assert "oscili" in compile_response.json()["orc"]

        start_response = client.post(f"/api/sessions/{session_id}/start")
        assert start_response.status_code == 200
        assert start_response.json()["state"] in {"running", "compiled"}

        stop_response = client.post(f"/api/sessions/{session_id}/stop")
        assert stop_response.status_code == 200
        assert stop_response.json()["state"] in {"compiled", "idle"}


def test_patch_create_rejects_control_characters_in_patch_name(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Bad Patch\ninstr 99",
            "description": "test",
            "schema_version": 1,
            "graph": {
                "nodes": [{"id": "n1", "opcode": "outs", "params": {}, "position": {"x": 10, "y": 10}}],
                "connections": [],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        response = client.post("/api/patches", json=patch_payload)

        assert response.status_code == 422
        assert "control characters" in response.text


def test_patch_create_rejects_control_characters_in_node_identifiers(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Bad Node Patch",
            "description": "test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1\ninstr 99", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 10, "y": 10}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 100, "y": 10}},
                ],
                "connections": [
                    {"from_node_id": "n1\ninstr 99", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"}
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        response = client.post("/api/patches", json=patch_payload)

        assert response.status_code == 422
        assert "control characters" in response.text


def test_patch_update_rejects_control_characters_in_patch_name(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Runtime Patch",
            "description": "test",
            "schema_version": 1,
            "graph": {
                "nodes": [{"id": "n1", "opcode": "outs", "params": {}, "position": {"x": 10, "y": 10}}],
                "connections": [],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }
        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201

        response = client.put(
            f"/api/patches/{create_patch.json()['id']}",
            json={"name": "Updated\ninstr 99"},
        )

        assert response.status_code == 422
        assert "control characters" in response.text


def test_engine_rates_drive_compiled_sr_and_ksmps(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Engine Rate Patch",
            "description": "engine config test",
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
                "engine_config": {"sr": 44100, "control_rate": 4400, "ksmps": 1, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        orc = compile_response.json()["orc"]

        assert "sr = 44100" in orc
        assert "ksmps = 10" in orc


def test_patch_defaults_compile_to_48khz_and_32_ksmps(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Default Engine Patch",
            "description": "default engine config test",
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
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        created_graph = create_patch.json()["graph"]
        assert created_graph["engine_config"] == {
            "sr": 48_000,
            "control_rate": 1_500,
            "ksmps": 32,
            "nchnls": 2,
            "software_buffer": 128,
            "hardware_buffer": 512,
            "0dbfs": 1.0,
        }
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        orc = compile_response.json()["orc"]

        assert "sr = 48000" in orc
        assert "ksmps = 32" in orc


def test_compile_uses_input_formula_for_multi_inbound_input(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Formula Merge Patch",
            "description": "multi-input formula",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "c1", "opcode": "const_k", "params": {"value": 0.2}, "position": {"x": 40, "y": 40}},
                    {"id": "c2", "opcode": "const_k", "params": {"value": 0.6}, "position": {"x": 40, "y": 150}},
                    {"id": "c3", "opcode": "const_k", "params": {"value": 2}, "position": {"x": 40, "y": 260}},
                    {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 100}},
                    {"id": "k2a", "opcode": "k_to_a", "params": {}, "position": {"x": 430, "y": 100}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 610, "y": 100}},
                ],
                "connections": [
                    {"from_node_id": "c1", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c3", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "b"},
                    {"from_node_id": "m1", "from_port_id": "kout", "to_node_id": "k2a", "to_port_id": "kin"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "input_formulas": {
                        "m1::a": {
                            "expression": "in1 + (in2 * 0.5)",
                            "inputs": [
                                {"token": "in1", "from_node_id": "c1", "from_port_id": "kout"},
                                {"token": "in2", "from_node_id": "c2", "from_port_id": "kout"},
                            ],
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        lines = compiled_orc.splitlines()
        formula_line = ""
        for index, line in enumerate(lines):
            if "; node:m1 opcode:k_mul" in line and index + 1 < len(lines):
                formula_line = lines[index + 1].strip()
                break

        assert formula_line
        assert "k_c1_kout" in formula_line
        assert "k_c2_kout" in formula_line
        assert "0.5" in formula_line
        assert "k_c3_kout" in formula_line


def test_compile_defaults_to_sum_for_multi_inbound_without_formula(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Default Merge Patch",
            "description": "implicit sum for multi-input",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "c1", "opcode": "const_k", "params": {"value": 0.2}, "position": {"x": 40, "y": 40}},
                    {"id": "c2", "opcode": "const_k", "params": {"value": 0.6}, "position": {"x": 40, "y": 150}},
                    {"id": "c3", "opcode": "const_k", "params": {"value": 2}, "position": {"x": 40, "y": 260}},
                    {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 100}},
                    {"id": "k2a", "opcode": "k_to_a", "params": {}, "position": {"x": 430, "y": 100}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 610, "y": 100}},
                ],
                "connections": [
                    {"from_node_id": "c1", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c3", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "b"},
                    {"from_node_id": "m1", "from_port_id": "kout", "to_node_id": "k2a", "to_port_id": "kin"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        lines = compiled_orc.splitlines()
        formula_line = ""
        for index, line in enumerate(lines):
            if "; node:m1 opcode:k_mul" in line and index + 1 < len(lines):
                formula_line = lines[index + 1].strip()
                break

        assert formula_line
        assert "k_c1_kout" in formula_line
        assert "k_c2_kout" in formula_line
        assert "+" in formula_line


def test_compile_supports_unary_functions_in_input_formula(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Unary Function Formula Patch",
            "description": "input formula unary functions",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "c1", "opcode": "const_k", "params": {"value": -0.2}, "position": {"x": 40, "y": 40}},
                    {"id": "c2", "opcode": "const_k", "params": {"value": 0.6}, "position": {"x": 40, "y": 150}},
                    {"id": "c3", "opcode": "const_k", "params": {"value": 2}, "position": {"x": 40, "y": 260}},
                    {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 100}},
                    {"id": "k2a", "opcode": "k_to_a", "params": {}, "position": {"x": 430, "y": 100}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 610, "y": 100}},
                ],
                "connections": [
                    {"from_node_id": "c1", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c3", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "b"},
                    {"from_node_id": "m1", "from_port_id": "kout", "to_node_id": "k2a", "to_port_id": "kin"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "input_formulas": {
                        "m1::a": {
                            "expression": "floor(abs(in1) + ceil(ampdb(dbamp(in2)) * 0.5))",
                            "inputs": [
                                {"token": "in1", "from_node_id": "c1", "from_port_id": "kout"},
                                {"token": "in2", "from_node_id": "c2", "from_port_id": "kout"},
                            ],
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        lines = compiled_orc.splitlines()
        formula_line = ""
        for index, line in enumerate(lines):
            if "; node:m1 opcode:k_mul" in line and index + 1 < len(lines):
                formula_line = lines[index + 1].strip()
                break

        assert formula_line
        assert "abs(" in formula_line
        assert "ampdb(" in formula_line
        assert "dbamp(" in formula_line
        assert "ceil(" in formula_line
        assert "floor(" in formula_line
        assert "k_c1_kout" in formula_line
        assert "k_c2_kout" in formula_line
        assert "k_c3_kout" in formula_line


def test_compile_uses_input_formula_for_single_inbound_input(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Single Input Formula Patch",
            "description": "single-input scaling formula",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "c1", "opcode": "const_k", "params": {"value": 0.8}, "position": {"x": 40, "y": 40}},
                    {"id": "c2", "opcode": "const_k", "params": {"value": 2}, "position": {"x": 40, "y": 150}},
                    {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 100}},
                    {"id": "k2a", "opcode": "k_to_a", "params": {}, "position": {"x": 430, "y": 100}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 610, "y": 100}},
                ],
                "connections": [
                    {"from_node_id": "c1", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "b"},
                    {"from_node_id": "m1", "from_port_id": "kout", "to_node_id": "k2a", "to_port_id": "kin"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "input_formulas": {
                        "m1::a": {
                            "expression": "0.5 * in1",
                            "inputs": [
                                {"token": "in1", "from_node_id": "c1", "from_port_id": "kout"},
                            ],
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        lines = compiled_orc.splitlines()
        formula_line = ""
        for index, line in enumerate(lines):
            if "; node:m1 opcode:k_mul" in line and index + 1 < len(lines):
                formula_line = lines[index + 1].strip()
                break

        assert formula_line
        assert "k_c1_kout" in formula_line
        assert "0.5" in formula_line
        assert "k_c2_kout" in formula_line


def test_compile_uses_constant_input_formula_without_inbound_connection(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Constant Formula Patch",
            "description": "constant formula on required input",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "c2", "opcode": "const_k", "params": {"value": 2}, "position": {"x": 40, "y": 150}},
                    {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 100}},
                    {"id": "k2a", "opcode": "k_to_a", "params": {}, "position": {"x": 430, "y": 100}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 610, "y": 100}},
                ],
                "connections": [
                    {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "b"},
                    {"from_node_id": "m1", "from_port_id": "kout", "to_node_id": "k2a", "to_port_id": "kin"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "input_formulas": {
                        "m1::a": {
                            "expression": "0.75",
                            "inputs": [],
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        lines = compiled_orc.splitlines()
        formula_line = ""
        for index, line in enumerate(lines):
            if "; node:m1 opcode:k_mul" in line and index + 1 < len(lines):
                formula_line = lines[index + 1].strip()
                break

        assert formula_line
        assert "0.75" in formula_line
        assert "k_c2_kout" in formula_line


def test_compile_supports_sr_literal_in_input_formula(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "SR Literal Formula Patch",
            "description": "formula can reference configured sample rate",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "c2", "opcode": "const_k", "params": {"value": 2}, "position": {"x": 40, "y": 150}},
                    {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 100}},
                    {"id": "k2a", "opcode": "k_to_a", "params": {}, "position": {"x": 430, "y": 100}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 610, "y": 100}},
                ],
                "connections": [
                    {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "b"},
                    {"from_node_id": "m1", "from_port_id": "kout", "to_node_id": "k2a", "to_port_id": "kin"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "input_formulas": {
                        "m1::a": {
                            "expression": "sr / 2",
                            "inputs": [],
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]
        assert "sr = 48000" in compiled_orc

        lines = compiled_orc.splitlines()
        formula_line = ""
        for index, line in enumerate(lines):
            if "; node:m1 opcode:k_mul" in line and index + 1 < len(lines):
                formula_line = lines[index + 1].strip()
                break

        assert formula_line
        assert "sr" in formula_line
        assert "/ 2" in formula_line
        assert "k_c2_kout" in formula_line


def test_compile_rejects_invalid_input_formula(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Broken Formula Patch",
            "description": "unknown token in formula",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "c1", "opcode": "const_k", "params": {"value": 0.2}, "position": {"x": 40, "y": 40}},
                    {"id": "c2", "opcode": "const_k", "params": {"value": 0.6}, "position": {"x": 40, "y": 150}},
                    {"id": "c3", "opcode": "const_k", "params": {"value": 2}, "position": {"x": 40, "y": 260}},
                    {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 100}},
                    {"id": "k2a", "opcode": "k_to_a", "params": {}, "position": {"x": 430, "y": 100}},
                    {"id": "out", "opcode": "outs", "params": {}, "position": {"x": 610, "y": 100}},
                ],
                "connections": [
                    {"from_node_id": "c1", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
                    {"from_node_id": "c3", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "b"},
                    {"from_node_id": "m1", "from_port_id": "kout", "to_node_id": "k2a", "to_port_id": "kin"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "left"},
                    {"from_node_id": "k2a", "from_port_id": "aout", "to_node_id": "out", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "input_formulas": {
                        "m1::a": {
                            "expression": "in1 + in9",
                            "inputs": [
                                {"token": "in1", "from_node_id": "c1", "from_port_id": "kout"},
                                {"token": "in2", "from_node_id": "c2", "from_port_id": "kout"},
                            ],
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 422
        diagnostics = compile_response.json()["detail"]["diagnostics"]
        assert any("unknown input token 'in9'" in item for item in diagnostics)


def test_session_midi_event_endpoint(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "MIDI Event Patch",
            "description": "session midi event test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        start_response = client.post(f"/api/sessions/{session_id}/start")
        assert start_response.status_code == 200

        note_on = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "note_on", "channel": 1, "note": 60, "velocity": 100},
        )
        if note_on.status_code == 404:
            assert "midi output" in note_on.text.lower()
            return
        assert note_on.status_code == 200

        note_off = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "note_off", "channel": 1, "note": 60},
        )
        assert note_off.status_code == 200

        control_change = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "control_change", "channel": 1, "controller": 10, "value": 64},
        )
        assert control_change.status_code == 200

        all_notes_off = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "all_notes_off", "channel": 1},
        )
        assert all_notes_off.status_code == 200


def test_session_backend_sequencer_flow_with_pad_queue(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Runtime Patch",
            "description": "backend sequencer runtime test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "velocity": 100,
                                "gate_ratio": 0.8,
                                "active_pad": 0,
                                "pads": [
                                    {"pad_index": 0, "steps": [60, None, 67, None] + [None] * 12},
                                    {"pad_index": 1, "steps": [72, None, 74, None] + [None] * 12},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True
            assert start_sequencer.json()["tracks"][0]["active_pad"] == 0

            queue_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/voice-1/queue-pad",
                json={"pad_index": 1},
            )
            assert queue_pad.status_code == 200
            assert queue_pad.json()["tracks"][0]["queued_pad"] == 1

            switched = False
            for _ in range(25):
                driver.pump_for(0.1)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                if data["tracks"][0]["active_pad"] == 1 and data["tracks"][0]["queued_pad"] is None:
                    switched = True
                    break

            assert switched, "Queued pad did not switch on loop boundary in expected time."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_active_pad_uses_pad_specific_step_count(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Per-Pad Step Count Patch",
            "description": "backend sequencer per-pad step count test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "active_pad": 1,
                                "pads": [
                                    {"pad_index": 0, "length_beats": 4, "steps": [60, None] + [None] * 14},
                                    {"pad_index": 1, "length_beats": 2, "steps": [72, None] + [None] * 6},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            started = start_sequencer.json()
            assert started["running"] is True
            assert started["tracks"][0]["active_pad"] == 1
            assert started["tracks"][0]["step_count"] == 8

            queue_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/voice-1/queue-pad",
                json={"pad_index": 0},
            )
            assert queue_pad.status_code == 200
            assert queue_pad.json()["tracks"][0]["queued_pad"] == 0

            switched = False
            for _ in range(20):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                body = status.json()
                if body["tracks"][0]["active_pad"] == 0 and body["tracks"][0]["step_count"] == 16:
                    switched = True
                    break

            assert switched, "Expected queued pad switch to update active pad step_count in runtime status."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_pad_looper_sequence_stops_when_repeat_disabled(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Pad Looper Patch",
            "description": "pad looper sequence runtime test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "enabled": True,
                                "active_pad": 7,
                                "pad_loop_enabled": True,
                                "pad_loop_repeat": False,
                                "pad_loop_sequence": [0, 1],
                                "pads": [
                                    {"pad_index": 0, "steps": [60, None] + [None] * 14},
                                    {"pad_index": 1, "steps": [72, None] + [None] * 14},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True
            track = next(item for item in start_sequencer.json()["tracks"] if item["track_id"] == "voice-1")
            assert track["active_pad"] == 0

            saw_second_pad = False
            stopped_after_sequence = False
            for _ in range(50):
                driver.pump_for(0.1)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-1")

                if track["enabled"] and track["active_pad"] == 1:
                    saw_second_pad = True

                if saw_second_pad and track["enabled"] is False and track["queued_enabled"] is None:
                    stopped_after_sequence = True
                    break

            assert saw_second_pad, "Pad looper did not advance to the second pad in the configured sequence."
            assert stopped_after_sequence, "Pad looper did not stop the track when repeat was disabled."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_disabled_pad_looper_track_preserves_selected_pad_while_transport_runs(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Disabled Pad Selection Patch",
            "description": "stopped pad-looper track selection test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "enabled": True,
                            "active_pad": 0,
                            "pads": [
                                {"pad_index": 0, "steps": [60, None] + [None] * 14},
                            ],
                        },
                        {
                            "track_id": "voice-2",
                            "midi_channel": 2,
                            "enabled": False,
                            "active_pad": 1,
                            "pad_loop_enabled": True,
                            "pad_loop_repeat": True,
                            "pad_loop_sequence": [0, 1],
                            "pads": [
                                {"pad_index": 0, "steps": [36, None] + [None] * 14},
                                {"pad_index": 1, "steps": [48, None] + [None] * 14},
                            ],
                        },
                    ],
                    tempo_bpm=300,
                )
            },
        )
        assert start_sequencer.status_code == 200
        started_tracks = {track["track_id"]: track for track in start_sequencer.json()["tracks"]}
        assert started_tracks["voice-2"]["enabled"] is False
        assert started_tracks["voice-2"]["active_pad"] == 1
        assert started_tracks["voice-2"]["pad_loop_position"] is None

        status = client.get(f"/api/sessions/{session_id}/sequencer/status")
        assert status.status_code == 200
        tracks = {track["track_id"]: track for track in status.json()["tracks"]}
        assert tracks["voice-2"]["enabled"] is False
        assert tracks["voice-2"]["active_pad"] == 1
        assert tracks["voice-2"]["pad_loop_position"] is None

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200


def test_session_backend_sequencer_pad_looper_repeats_across_multiple_pause_tokens(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Multi Pause Loop Patch",
            "description": "pad looper multi-pause repeat test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "enabled": True,
                                "active_pad": 0,
                                "pad_loop_enabled": True,
                                "pad_loop_repeat": True,
                                "pad_loop_sequence": [0, -4, -8],
                                "pads": [
                                    {"pad_index": 0, "steps": [60, None] + [None] * 14},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                        playback_end_step=256,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True

            saw_first_pause = False
            saw_second_pause = False
            wrapped_to_start = False

            for _ in range(80):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-1")

                if track["pad_loop_position"] == 1:
                    saw_first_pause = True
                if track["pad_loop_position"] == 2:
                    saw_second_pause = True
                if saw_second_pause and track["pad_loop_position"] == 0 and data["running"] is True:
                    wrapped_to_start = True
                    break

            assert saw_first_pause, "Pad looper never entered the first pause token."
            assert saw_second_pause, "Pad looper never entered the second pause token."
            assert wrapped_to_start, "Pad looper did not wrap back to the first token after the second pause."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_stop_preserves_playhead_and_position_start(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Transport Resume Patch",
            "description": "transport resume test",
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
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "pads": [{"pad_index": 0, "steps": [60, None, 67, None] + [None] * 12}],
                            }
                        ],
                        tempo_bpm=300,
                        playback_end_step=32,
                    )
                },
            )
            assert start_response.status_code == 200

            preserved_absolute_step: int | None = None
            for _ in range(20):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                body = status.json()
                absolute_step = body["cycle"] * body["step_count"] + body["current_step"]
                if absolute_step >= 4:
                    preserved_absolute_step = absolute_step
                    break

            assert preserved_absolute_step is not None

            stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_response.status_code == 200
            stopped_absolute_step = stop_response.json()["cycle"] * stop_response.json()["step_count"] + stop_response.json()["current_step"]
            assert stopped_absolute_step == preserved_absolute_step

            resume_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={"position_step": preserved_absolute_step},
            )
            assert resume_response.status_code == 200
            resumed_absolute_step = resume_response.json()["cycle"] * resume_response.json()["step_count"] + resume_response.json()["current_step"]
            assert resumed_absolute_step == preserved_absolute_step

            client.post(f"/api/sessions/{session_id}/sequencer/stop")


def test_session_backend_sequencer_transport_seek_moves_in_four_step_blocks(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Transport Seek Patch",
            "description": "transport seek test",
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
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "pads": [{"pad_index": 0, "steps": [60] + [None] * 15}],
                        }
                    ],
                    tempo_bpm=120,
                    playback_end_step=32,
                )
            },
        )
        assert start_response.status_code == 200

        stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_response.status_code == 200

        forward_response = client.post(f"/api/sessions/{session_id}/sequencer/forward")
        assert forward_response.status_code == 200
        forward_absolute_step = forward_response.json()["cycle"] * forward_response.json()["step_count"] + forward_response.json()["current_step"]
        assert forward_absolute_step == 8

        rewind_response = client.post(f"/api/sessions/{session_id}/sequencer/rewind")
        assert rewind_response.status_code == 200
        rewind_absolute_step = rewind_response.json()["cycle"] * rewind_response.json()["step_count"] + rewind_response.json()["current_step"]
        assert rewind_absolute_step == 0


def test_session_backend_sequencer_three_four_timing_updates_transport_status(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Three Four Patch",
            "description": "3/4 timing status test",
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
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "pads": [{"pad_index": 0, "steps": [60] + [None] * 11}],
                        }
                    ],
                    tempo_bpm=180,
                    meter_numerator=3,
                    meter_denominator=4,
                    steps_per_beat=4,
                )
            },
        )
        assert start_response.status_code == 200
        started = start_response.json()
        assert started["timing"] == _sequencer_timing(
            tempo_bpm=180,
            meter_numerator=4,
            meter_denominator=4,
            steps_per_beat=8,
        )
        assert started["step_count"] == 8
        assert started["tracks"][0]["timing"] == _sequencer_timing(
            tempo_bpm=180,
            meter_numerator=3,
            meter_denominator=4,
            steps_per_beat=4,
        )

        client.post(f"/api/sessions/{session_id}/sequencer/stop")
        forward_response = client.post(f"/api/sessions/{session_id}/sequencer/forward")
        assert forward_response.status_code == 200
        forward_absolute_step = forward_response.json()["cycle"] * forward_response.json()["step_count"] + forward_response.json()["current_step"]
        assert forward_absolute_step == 8


def test_session_backend_sequencer_polyrhythm_beat_rate_advances_local_step_between_transport_steps(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Polyrhythm Patch",
            "description": "beat-rate ratio timing test",
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
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "timing": _sequencer_timing(
                                    tempo_bpm=120,
                                    meter_numerator=4,
                                    meter_denominator=4,
                                    steps_per_beat=4,
                                    beat_rate_numerator=3,
                                    beat_rate_denominator=2,
                                ),
                                "length_beats": 1,
                                "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60, None, None, None]}],
                            }
                        ],
                        tempo_bpm=120,
                    )
                },
            )
            assert start_response.status_code == 200
            started = start_response.json()
            assert started["transport_subunit"] == 0
            assert started["tracks"][0]["timing"] == _sequencer_timing(
                tempo_bpm=120,
                meter_numerator=4,
                meter_denominator=4,
                steps_per_beat=4,
                beat_rate_numerator=3,
                beat_rate_denominator=2,
            )

            target_status: dict[str, object] | None = None
            deadline = time.time() + 0.75
            while time.time() < deadline:
                driver.pump_for(0.005)
                status_response = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status_response.status_code == 200
                status = status_response.json()
                transport_subunit = int(status["transport_subunit"])
                if 560 <= transport_subunit < 840:
                    target_status = status
                    break

            assert target_status is not None, "Expected to observe the 3:2 local-step window before transport step 2."
            assert target_status["current_step"] == 1
            assert target_status["tracks"][0]["local_step"] == 1
            assert target_status["transport_subunit"] < 840

            stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_response.status_code == 200


def test_session_backend_sequencer_accepts_meter_aligned_three_beat_pad_lengths(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Odd Beat Length Patch",
            "description": "3/4 odd beat length test",
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
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "length_beats": 3,
                            "pads": [{"pad_index": 0, "length_beats": 3, "steps": [60, None] + [None] * 10}],
                        }
                    ],
                    tempo_bpm=210,
                    meter_numerator=3,
                    meter_denominator=4,
                    steps_per_beat=4,
                )
            },
        )
        assert start_response.status_code == 200
        started = start_response.json()
        assert started["tracks"][0]["timing"] == _sequencer_timing(
            tempo_bpm=210,
            meter_numerator=3,
            meter_denominator=4,
            steps_per_beat=4,
        )
        assert started["tracks"][0]["length_beats"] == 3
        assert started["tracks"][0]["step_count"] == 12

        stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_response.status_code == 200


def test_session_backend_sequencer_six_eight_timing_uses_steps_per_bar(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Six Eight Patch",
            "description": "6/8 timing status test",
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
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "pads": [{"pad_index": 0, "length_beats": 8, "steps": [60] + [None] * 31}],
                        }
                    ],
                    tempo_bpm=210,
                    meter_numerator=6,
                    meter_denominator=8,
                    steps_per_beat=4,
                )
            },
        )
        assert start_response.status_code == 200
        started = start_response.json()
        assert started["timing"] == _sequencer_timing(
            tempo_bpm=210,
            meter_numerator=4,
            meter_denominator=4,
            steps_per_beat=8,
        )
        assert started["step_count"] == 8
        assert started["tracks"][0]["timing"] == _sequencer_timing(
            tempo_bpm=210,
            meter_numerator=6,
            meter_denominator=8,
            steps_per_beat=4,
        )
        assert started["tracks"][0]["length_beats"] == 8
        assert started["tracks"][0]["step_count"] == 32

        stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_response.status_code == 200


def test_session_backend_sequencer_selected_range_loops_and_one_shot_ends_at_range_end(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Playback Window Patch",
            "description": "playback range test",
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
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            loop_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "pad_loop_enabled": True,
                                "pad_loop_repeat": True,
                                "pad_loop_sequence": [0, 1],
                                "pads": [
                                    {"pad_index": 0, "steps": [60] + [None] * 15},
                                    {"pad_index": 1, "steps": [67] + [None] * 15},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                        playback_start_step=16,
                        playback_end_step=24,
                        playback_loop=True,
                    )
                },
            )
            assert loop_response.status_code == 200

            saw_range_wrap = False
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                absolute_step = status.json()["cycle"] * status.json()["step_count"] + status.json()["current_step"]
                if absolute_step == 16 and status.json()["running"] is True:
                    saw_range_wrap = True
                    break

            assert saw_range_wrap, "Expected looping playback window to wrap back to the selected range start."

            client.post(f"/api/sessions/{session_id}/sequencer/stop")

            one_shot_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "pads": [{"pad_index": 0, "steps": [60] + [None] * 15}],
                            }
                        ],
                        tempo_bpm=300,
                        playback_start_step=0,
                        playback_end_step=8,
                        playback_loop=False,
                    )
                },
            )
            assert one_shot_response.status_code == 200

            stopped_at_end = False
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                body = status.json()
                absolute_step = body["cycle"] * body["step_count"] + body["current_step"]
                if body["running"] is False and absolute_step == 8:
                    stopped_at_end = True
                    break

            assert stopped_at_end, "Expected one-shot playback to stop at the configured playback_end_step."


def test_session_backend_sequencer_hold_steps_release_only_on_non_hold_rest(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Hold Patch",
            "description": "hold step runtime test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "active_pad": 0,
                                "pads": [
                                    {
                                        "pad_index": 0,
                                        "steps": [
                                            {"note": 60, "hold": False},
                                            {"note": None, "hold": True},
                                            {"note": None, "hold": True},
                                            {"note": None, "hold": False},
                                        ]
                                        + [None] * 12,
                                    }
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True

            saw_held_note = False
            saw_release_after_hold = False
            for _ in range(40):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-1")
                active_notes = track["active_notes"]
                if 60 in active_notes:
                    saw_held_note = True
                if saw_held_note and len(active_notes) == 0:
                    saw_release_after_hold = True
                    break

            assert saw_held_note, "Expected held note to remain active during hold-rest steps."
            assert saw_release_after_hold, "Expected held note to release on first rest step with hold disabled."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_uses_step_velocity_for_note_on(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Velocity Patch",
            "description": "step velocity runtime test",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        midi_router = _runtime_midi_router(client, session_id)
        assert midi_router is not None
        captured_messages: list[list[int]] = []
        original_enqueue_message = midi_router._enqueue_timestamped_midi

        def capture_enqueue_message(
            message: list[int],
            *,
            source: str,
            target_engine_sample: int | None = None,
            delivery_delay_seconds: float | None = None,
            source_timestamp_ns: int | None = None,
            mapped_backend_monotonic_ns: int | None = None,
            sync_stale: bool = False,
        ) -> bool:
            _ = (
                source,
                target_engine_sample,
                delivery_delay_seconds,
                source_timestamp_ns,
                mapped_backend_monotonic_ns,
                sync_stale,
            )
            captured_messages.append(list(message))
            return True

        midi_router._enqueue_timestamped_midi = capture_enqueue_message
        try:
            with _BrowserClockRenderDriver(client, session_id) as driver:
                start_sequencer = client.post(
                    f"/api/sessions/{session_id}/sequencer/start",
                    json={
                        "config": _sequencer_config(
                            [
                                {
                                    "track_id": "voice-1",
                                    "midi_channel": 1,
                                    "velocity": 100,
                                    "active_pad": 0,
                                    "pads": [
                                        {
                                            "pad_index": 0,
                                            "steps": [
                                                {"note": 60, "hold": False, "velocity": 23},
                                                None,
                                                {"note": 67, "hold": False, "velocity": 91},
                                                None,
                                            ]
                                            + [None] * 12,
                                        }
                                    ],
                                }
                            ],
                            tempo_bpm=300,
                        )
                    },
                )
                assert start_sequencer.status_code == 200
                assert start_sequencer.json()["running"] is True

                saw_first_velocity = False
                saw_second_velocity = False
                for _ in range(40):
                    note_ons = [msg for msg in captured_messages if len(msg) == 3 and (msg[0] & 0xF0) == 0x90]
                    if any(msg[1] == 60 and msg[2] == 23 for msg in note_ons):
                        saw_first_velocity = True
                    if any(msg[1] == 67 and msg[2] == 91 for msg in note_ons):
                        saw_second_velocity = True
                    if saw_first_velocity and saw_second_velocity:
                        break
                    driver.pump_for(0.05)

                assert saw_first_velocity, "Expected step 1 note-on to use velocity 23."
                assert saw_second_velocity, "Expected step 3 note-on to use velocity 91."

                stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
                assert stop_sequencer.status_code == 200
                assert stop_sequencer.json()["running"] is False
        finally:
            midi_router._enqueue_timestamped_midi = original_enqueue_message


def test_session_backend_sequencer_schedules_pad_switch_note_events_with_positive_delay(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Timing Patch",
            "description": "scheduled pad switch timing",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        midi_router = _runtime_midi_router(client, session_id)
        assert midi_router is not None
        scheduled_calls: list[tuple[list[list[int]], float | None]] = []
        original_enqueue_message = midi_router._enqueue_timestamped_midi

        def capture_enqueue_message(
            message: list[int],
            *,
            source: str,
            target_engine_sample: int | None = None,
            delivery_delay_seconds: float | None = None,
            source_timestamp_ns: int | None = None,
            mapped_backend_monotonic_ns: int | None = None,
            sync_stale: bool = False,
        ) -> bool:
            _ = (
                source,
                target_engine_sample,
                source_timestamp_ns,
                mapped_backend_monotonic_ns,
                sync_stale,
            )
            scheduled_calls.append(([list(message)], delivery_delay_seconds))
            return True

        midi_router._enqueue_timestamped_midi = capture_enqueue_message
        try:
            with _BrowserClockRenderDriver(client, session_id) as driver:
                start_sequencer = client.post(
                    f"/api/sessions/{session_id}/sequencer/start",
                    json={
                        "config": _sequencer_config(
                                [
                                    {
                                        "track_id": "voice-1",
                                        "midi_channel": 1,
                                        "length_beats": 1,
                                        "active_pad": 0,
                                        "pads": [
                                            {"pad_index": 0, "length_beats": 1, "steps": [60, None, None, None]},
                                            {"pad_index": 1, "length_beats": 1, "steps": [67, None, None, None]},
                                        ],
                                    }
                                ],
                                tempo_bpm=300,
                                playback_end_step=16,
                            )
                        },
                    )
                assert start_sequencer.status_code == 200

                queue_pad = client.post(
                    f"/api/sessions/{session_id}/sequencer/tracks/voice-1/queue-pad",
                    json={"pad_index": 1},
                )
                assert queue_pad.status_code == 200

                saw_switched_note = False
                saw_render_driven_delivery = False
                for _ in range(50):
                    for messages, delivery_delay_seconds in scheduled_calls:
                        if delivery_delay_seconds is None:
                            saw_render_driven_delivery = True
                        if any(len(message) == 3 and (message[0] & 0xF0) == 0x90 and message[1] == 67 for message in messages):
                            saw_switched_note = True
                            if delivery_delay_seconds is None:
                                saw_render_driven_delivery = True
                    if saw_switched_note and saw_render_driven_delivery:
                        break
                    driver.pump_for(0.05)

                assert saw_switched_note, "Expected queued pad switch to emit the first note from pad 1."
                assert saw_render_driven_delivery, (
                    "Expected sequencer note events to use render-driven engine scheduling instead of wall-clock delays."
                )

                stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
                assert stop_sequencer.status_code == 200
        finally:
            midi_router._enqueue_timestamped_midi = original_enqueue_message


def test_session_backend_sequencer_queued_track_enable_starts_on_loop_boundary(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Queued Enable Patch",
            "description": "queued track enable",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "enabled": True,
                                "active_pad": 0,
                                "pads": [{"pad_index": 0, "steps": [60] + [None] * 15}],
                            },
                            {
                                "track_id": "voice-2",
                                "midi_channel": 2,
                                "enabled": False,
                                "queued_enabled": True,
                                "active_pad": 0,
                                "pads": [{"pad_index": 0, "steps": [72] + [None] * 15}],
                            },
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200

            track2 = next(track for track in start_sequencer.json()["tracks"] if track["track_id"] == "voice-2")
            assert track2["enabled"] is False
            assert track2["queued_enabled"] is True

            enabled_after_boundary = False
            for _ in range(25):
                driver.pump_for(0.1)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-2")
                if data["cycle"] >= 1 and track["enabled"] is True and track["queued_enabled"] is None:
                    enabled_after_boundary = True
                    break

            assert enabled_after_boundary, "Queued track enable did not activate on step-1 boundary in expected time."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_controller_sequencer_runs_without_note_tracks(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Controller Sequencer Patch",
            "description": "controller-only sequencer runtime",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [],
                    tempo_bpm=240,
                    controller_tracks=[
                        {
                            "track_id": "cc-1",
                            "controller_number": 74,
                            "length_beats": 16,
                            "active_pad": 0,
                            "enabled": True,
                            "pads": [
                                {
                                    "pad_index": 0,
                                    "length_beats": 16,
                                    "keypoints": [
                                        {"position": 0.0, "value": 10},
                                        {"position": 0.5, "value": 96},
                                        {"position": 1.0, "value": 10},
                                    ],
                                }
                            ],
                        }
                    ],
                )
            },
        )
        assert start_sequencer.status_code == 200
        payload = start_sequencer.json()
        assert payload["running"] is True
        assert payload["tracks"] == []
        assert len(payload["controller_tracks"]) == 1
        controller_track = payload["controller_tracks"][0]
        assert controller_track["track_id"] == "cc-1"
        assert controller_track["step_count"] == 64
        assert controller_track["length_beats"] == 16
        assert controller_track["active_pad"] == 0
        assert controller_track["runtime_pad_start_subunit"] == 0
        assert controller_track["target_channels"] == [1]

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200
        assert stop_sequencer.json()["running"] is False


def test_session_backend_controller_sequencer_sends_control_changes_on_session_channels(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Controller Routing Patch",
            "description": "controller sequencer output routing",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"patch_id": patch_id, "midi_channel": 2},
                    {"patch_id": patch_id, "midi_channel": 5},
                ]
            },
        )
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        midi_router = _runtime_midi_router(client, session_id)
        assert midi_router is not None
        captured_messages: list[list[int]] = []
        original_enqueue_message = midi_router._enqueue_timestamped_midi

        def capture_enqueue_message(
            message: list[int],
            *,
            source: str,
            target_engine_sample: int | None = None,
            delivery_delay_seconds: float | None = None,
            source_timestamp_ns: int | None = None,
            mapped_backend_monotonic_ns: int | None = None,
            sync_stale: bool = False,
        ) -> bool:
            _ = (
                source,
                target_engine_sample,
                delivery_delay_seconds,
                source_timestamp_ns,
                mapped_backend_monotonic_ns,
                sync_stale,
            )
            captured_messages.append(list(message))
            return True

        midi_router._enqueue_timestamped_midi = capture_enqueue_message
        try:
            with _BrowserClockRenderDriver(client, session_id) as driver:
                start_sequencer = client.post(
                    f"/api/sessions/{session_id}/sequencer/start",
                    json={
                        "config": _sequencer_config(
                            [],
                            tempo_bpm=300,
                            controller_tracks=[
                                {
                                    "track_id": "cc-1",
                                    "controller_number": 74,
                                    "active_pad": 0,
                                    "enabled": True,
                                    "pads": [
                                        {
                                            "pad_index": 0,
                                            "keypoints": [
                                                {"position": 0.0, "value": 22},
                                                {"position": 0.5, "value": 90},
                                                {"position": 1.0, "value": 22},
                                            ],
                                        }
                                    ],
                                }
                            ],
                        )
                    },
                )
                assert start_sequencer.status_code == 200

                saw_channel_2 = False
                saw_channel_5 = False
                for _ in range(40):
                    for message in captured_messages:
                        if len(message) != 3 or (message[0] & 0xF0) != 0xB0:
                            continue
                        channel = (message[0] & 0x0F) + 1
                        if message[1] == 74 and channel == 2:
                            saw_channel_2 = True
                        if message[1] == 74 and channel == 5:
                            saw_channel_5 = True
                    if saw_channel_2 and saw_channel_5:
                        break
                    driver.pump_for(0.05)

                assert saw_channel_2, "Expected controller sequencer to emit CC74 on session MIDI channel 2."
                assert saw_channel_5, "Expected controller sequencer to emit CC74 on session MIDI channel 5."

                stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
                assert stop_sequencer.status_code == 200
        finally:
            midi_router._enqueue_timestamped_midi = original_enqueue_message


def test_session_backend_controller_sequencer_queue_pad_switches_and_clears_queue(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Controller Queue Patch",
            "description": "controller pad queueing",
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

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [],
                        tempo_bpm=300,
                        playback_end_step=96,
                        controller_tracks=[
                            {
                                "track_id": "cc-1",
                                "controller_number": 74,
                                "length_beats": 4,
                                "active_pad": 0,
                                "enabled": True,
                                "pads": [
                                    {"pad_index": 0, "length_beats": 4, "keypoints": [{"position": 0.0, "value": 10}]},
                                    {"pad_index": 1, "length_beats": 4, "keypoints": [{"position": 0.0, "value": 90}]},
                                ],
                            }
                        ],
                    )
                },
            )
            assert start_sequencer.status_code == 200

            queue_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/cc-1/queue-pad",
                json={"pad_index": 1},
            )
            assert queue_pad.status_code == 200
            queued_track = queue_pad.json()["controller_tracks"][0]
            assert queued_track["active_pad"] == 0
            assert queued_track["queued_pad"] == 1

            switched = False
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                controller_track = status.json()["controller_tracks"][0]
                if controller_track["active_pad"] == 1 and controller_track["queued_pad"] is None:
                    switched = True
                    break

            assert switched, "Expected queued controller pad to switch on the next loop boundary."

            queue_second_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/cc-1/queue-pad",
                json={"pad_index": 0},
            )
            assert queue_second_pad.status_code == 200
            clear_queue = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/cc-1/queue-pad",
                json={"pad_index": None},
            )
            assert clear_queue.status_code == 200
            cleared_track = clear_queue.json()["controller_tracks"][0]
            assert cleared_track["queued_pad"] is None

            remained_on_pad_1 = True
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                controller_track = status.json()["controller_tracks"][0]
                if controller_track["active_pad"] != 1:
                    remained_on_pad_1 = False
                    break

            assert remained_on_pad_1, "Expected cleared controller queue to leave the active pad unchanged."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_arpeggiator_config_does_not_reconfigure_sequencer_transport(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        session_id = _create_running_session(client, patch_name="Arpeggiator Config Isolation")

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "scale_root": "C",
                            "scale_type": "minor",
                            "mode": "aeolian",
                            "length_beats": 1,
                            "active_pad": 0,
                            "enabled": True,
                            "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60, None, None, None]}],
                        }
                    ],
                    playback_end_step=8,
                )
            },
        )
        assert start_sequencer.status_code == 200
        assert start_sequencer.json()["running"] is True

        arpeggiator_config = client.put(
            f"/api/sessions/{session_id}/arpeggiators/config",
            json={
                "tempo_bpm": 120,
                "arpeggiators": [
                    {
                        "arpeggiator_id": "arp-1",
                        "enabled": True,
                        "input_channel": 2,
                        "target_channel": 1,
                    }
                ],
            },
        )
        assert arpeggiator_config.status_code == 200
        assert arpeggiator_config.json()[0]["arpeggiator_id"] == "arp-1"
        assert arpeggiator_config.json()[0]["enabled"] is True

        status = client.get(f"/api/sessions/{session_id}/sequencer/status")
        assert status.status_code == 200
        payload = status.json()
        assert payload["running"] is True
        assert payload["tracks"][0]["track_id"] == "voice-1"
        assert payload["tracks"][0]["enabled"] is True

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200


def test_const_nodes_use_node_params_without_value_input_port(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        opcodes_response = client.get("/api/opcodes")
        assert opcodes_response.status_code == 200
        opcodes_by_name = {item["name"]: item for item in opcodes_response.json()}
        assert opcodes_by_name["const_a"]["inputs"] == []
        assert opcodes_by_name["const_i"]["inputs"] == []
        assert opcodes_by_name["const_k"]["inputs"] == []
        assert opcodes_by_name["const_s"]["inputs"] == []
        const_s_outputs = {item["id"]: item for item in opcodes_by_name["const_s"]["outputs"]}
        assert const_s_outputs["sout"]["signal_type"] == "S"
        assert opcodes_by_name["const_s"]["documentation_url"] == "https://csound.com/docs/manual/PartOpcodesOverview.html"

        patch_payload = {
            "name": "Const Patch",
            "description": "const node control",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.25}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 220, "y": 50}},
                    {"id": "n3", "opcode": "const_s", "params": {"value": "left_bus"}, "position": {"x": 50, "y": 150}},
                    {"id": "n4", "opcode": "outleta", "params": {}, "position": {"x": 220, "y": 150}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n4", "to_port_id": "asignal"},
                    {"from_node_id": "n3", "from_port_id": "sout", "to_node_id": "n4", "to_port_id": "sname"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]
        assert 'S_n3_sout_1 = "left_bus"' in compiled_orc
        assert "outleta S_n3_sout_1, a_n1_aout_1" in compiled_orc
        assert " = 0.25" in compile_response.json()["orc"]


def test_midi_opcodes_and_vco_compile_flow(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        opcodes_response = client.get("/api/opcodes")
        assert opcodes_response.status_code == 200
        opcodes_by_name = {item["name"]: item for item in opcodes_response.json()}
        assert opcodes_by_name["ampmidi"]["category"] == "midi"
        assert opcodes_by_name["ampmidi"]["outputs"][0]["signal_type"] == "i"
        ampmidi_inputs = {item["id"]: item for item in opcodes_by_name["ampmidi"]["inputs"]}
        assert ampmidi_inputs["ifn"]["required"] is False
        assert opcodes_by_name["ampmidicurve"]["category"] == "midi"
        assert opcodes_by_name["ampmidicurve"]["outputs"][0]["signal_type"] == "k"
        assert opcodes_by_name["ampmidid"]["category"] == "midi"
        assert opcodes_by_name["ampmidid"]["outputs"][0]["signal_type"] == "k"
        assert opcodes_by_name["cpsmidi"]["category"] == "midi"
        assert opcodes_by_name["cpsmidi"]["outputs"][0]["signal_type"] == "i"
        assert opcodes_by_name["midictrl"]["category"] == "midi"
        assert opcodes_by_name["notnum"]["category"] == "midi"
        assert opcodes_by_name["notnum"]["outputs"][0]["signal_type"] == "i"
        assert opcodes_by_name["vco"]["category"] == "oscillator"
        assert opcodes_by_name["ftgen"]["category"] == "tables"
        assert opcodes_by_name["ftgen"]["outputs"][0]["signal_type"] == "i"
        vco_inputs = {item["id"]: item for item in opcodes_by_name["vco"]["inputs"]}
        assert vco_inputs["ifn"]["required"] is False
        assert vco_inputs["iwave"]["required"] is False
        assert vco_inputs["freq"]["required"] is True

        patch_payload = {
            "name": "VCO MIDI Patch",
            "description": "cpsmidi + midictrl driving vco",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "cpsmidi", "params": {}, "position": {"x": 40, "y": 40}},
                    {
                        "id": "n2",
                        "opcode": "midictrl",
                        "params": {"inum": 1, "imin": 0, "imax": 0.4},
                        "position": {"x": 200, "y": 160},
                    },
                    {"id": "n3", "opcode": "vco", "params": {"iwave": 1}, "position": {"x": 360, "y": 40}},
                    {"id": "n4", "opcode": "outs", "params": {}, "position": {"x": 600, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "kfreq", "to_node_id": "n3", "to_port_id": "freq"},
                    {"from_node_id": "n2", "from_port_id": "kval", "to_node_id": "n3", "to_port_id": "amp"},
                    {"from_node_id": "n3", "from_port_id": "asig", "to_node_id": "n4", "to_port_id": "left"},
                    {"from_node_id": "n3", "from_port_id": "asig", "to_node_id": "n4", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]
        compiled_csd = compile_response.json()["csd"]
        assert "cpsmidi" in compiled_orc
        assert "f 1 0 16384 10 1" in compiled_csd
        cpsmidi_line = next(line.strip() for line in compiled_orc.splitlines() if " cpsmidi" in line)
        assert cpsmidi_line.startswith("i_")
        assert "midictrl" in compiled_orc
        vco_line = next(line.strip() for line in compiled_orc.splitlines() if " vco " in line)
        assert vco_line.endswith(", 0.5")
        assert not vco_line.endswith(", 0.5, 0")


def test_vco_accepts_audio_rate_frequency_input(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Audio Rate Freq Mod",
            "description": "oscili audio output drives vco frequency",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_k", "params": {"value": 0.2}, "position": {"x": 40, "y": 40}},
                    {"id": "n2", "opcode": "const_k", "params": {"value": 3}, "position": {"x": 40, "y": 180}},
                    {"id": "n3", "opcode": "oscili", "params": {"amp": 440, "ifn": 1}, "position": {"x": 250, "y": 180}},
                    {"id": "n4", "opcode": "vco", "params": {"iwave": 1}, "position": {"x": 460, "y": 40}},
                    {"id": "n5", "opcode": "outs", "params": {}, "position": {"x": 660, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "kout", "to_node_id": "n4", "to_port_id": "amp"},
                    {"from_node_id": "n2", "from_port_id": "kout", "to_node_id": "n3", "to_port_id": "freq"},
                    {"from_node_id": "n3", "from_port_id": "asig", "to_node_id": "n4", "to_port_id": "freq"},
                    {"from_node_id": "n4", "from_port_id": "asig", "to_node_id": "n5", "to_port_id": "left"},
                    {"from_node_id": "n4", "from_port_id": "asig", "to_node_id": "n5", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]
        assert " oscili " in compiled_orc
        vco_line = next(line.strip() for line in compiled_orc.splitlines() if " vco " in line)
        assert vco_line.endswith(", 0.5")
        assert not vco_line.endswith(", 0.5, 0")


def test_vco_with_explicit_ifn_keeps_function_table_argument(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "VCO Explicit Ifn",
            "description": "vco ifn is only emitted when explicitly provided",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_k", "params": {"value": 0.2}, "position": {"x": 40, "y": 40}},
                    {"id": "n2", "opcode": "const_i", "params": {"value": 5}, "position": {"x": 40, "y": 150}},
                    {"id": "n3", "opcode": "vco", "params": {"iwave": 1}, "position": {"x": 260, "y": 40}},
                    {"id": "n4", "opcode": "outs", "params": {}, "position": {"x": 500, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "kout", "to_node_id": "n3", "to_port_id": "amp"},
                    {"from_node_id": "n2", "from_port_id": "iout", "to_node_id": "n3", "to_port_id": "freq"},
                    {"from_node_id": "n2", "from_port_id": "iout", "to_node_id": "n3", "to_port_id": "ifn"},
                    {"from_node_id": "n3", "from_port_id": "asig", "to_node_id": "n4", "to_port_id": "left"},
                    {"from_node_id": "n3", "from_port_id": "asig", "to_node_id": "n4", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]
        vco_line = next(line.strip() for line in compiled_orc.splitlines() if " vco " in line)
        assert vco_line.endswith(", 0.5, i_n2_iout_1")


def test_syncphasor_compile_flow(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Syncphasor Patch",
            "description": "syncphasor schema and compile coverage",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.0}, "position": {"x": 40, "y": 160}},
                    {"id": "n2", "opcode": "syncphasor", "params": {"xcps": 55, "iphs": 0.25}, "position": {"x": 260, "y": 80}},
                    {"id": "n3", "opcode": "outs", "params": {}, "position": {"x": 520, "y": 80}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "asyncin"},
                    {"from_node_id": "n2", "from_port_id": "asyncout", "to_node_id": "n3", "to_port_id": "left"},
                    {"from_node_id": "n2", "from_port_id": "aphase", "to_node_id": "n3", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        syncphasor_line = next(line.strip() for line in compiled_orc.splitlines() if " syncphasor " in line)
        outputs_fragment = syncphasor_line.split(" syncphasor ", 1)[0]
        assert "," in outputs_fragment
        assert syncphasor_line.endswith(", 0.25")


def test_platerev_compile_flow(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Platerev Patch",
            "description": "platerev schema and compile coverage",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 40, "y": 120}},
                    {
                        "id": "n2",
                        "opcode": "platerev",
                        "params": {"itabexcite": 1, "itabouts": 1, "kbndry": 0.9, "aexcite2": 0},
                        "position": {"x": 280, "y": 60},
                    },
                    {"id": "n3", "opcode": "outs", "params": {}, "position": {"x": 580, "y": 60}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "aexcite1"},
                    {"from_node_id": "n2", "from_port_id": "aleft", "to_node_id": "n3", "to_port_id": "left"},
                    {"from_node_id": "n2", "from_port_id": "aright", "to_node_id": "n3", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]
        assert "__VS_OPTIONAL_OMIT__" not in compiled_orc

        platerev_line = next(line.strip() for line in compiled_orc.splitlines() if " platerev " in line)
        outputs_fragment = platerev_line.split(" platerev ", 1)[0]
        assert "," in outputs_fragment
        assert "platerev 1, 1, 0.9" in platerev_line
        assert "a_n1_aout" in platerev_line
        assert platerev_line.rsplit(", ", 1)[1].startswith("a_n1_aout")


def test_ftgen_output_connects_to_vco_ifn(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "VCO With FTGEN",
            "description": "ftgen table is routed into vco ifn",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {
                        "id": "n1",
                        "opcode": "ftgen",
                        "params": {"ifn": 7, "itime": 0, "isize": 8192, "igen": 10, "iarg1": 1},
                        "position": {"x": 40, "y": 60},
                    },
                    {
                        "id": "n2",
                        "opcode": "vco",
                        "params": {"amp": 0.2, "freq": 220, "iwave": 1},
                        "position": {"x": 280, "y": 40},
                    },
                    {"id": "n3", "opcode": "outs", "params": {}, "position": {"x": 520, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "ift", "to_node_id": "n2", "to_port_id": "ifn"},
                    {"from_node_id": "n2", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "left"},
                    {"from_node_id": "n2", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        ftgen_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgen " in line)
        assert ftgen_line.endswith("ftgen 7, 0, 8192, 10, 1")

        vco_line = next(line.strip() for line in compiled_orc.splitlines() if " vco " in line)
        assert vco_line.endswith(", 0.5, i_n1_ift_1")


def test_gen_meta_opcode_renders_ftgen_line(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "GEN Meta Node",
            "description": "GEN meta-opcode compiles to ftgen",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {
                        "id": "n1",
                        "opcode": "GEN",
                        "params": {},
                        "position": {"x": 40, "y": 60},
                    },
                    {
                        "id": "n2",
                        "opcode": "vco",
                        "params": {"amp": 0.2, "freq": 220, "iwave": 1},
                        "position": {"x": 280, "y": 40},
                    },
                    {"id": "n3", "opcode": "outs", "params": {}, "position": {"x": 520, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "ift", "to_node_id": "n2", "to_port_id": "ifn"},
                    {"from_node_id": "n2", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "left"},
                    {"from_node_id": "n2", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "gen_nodes": {
                        "n1": {
                            "mode": "ftgen",
                            "tableNumber": 0,
                            "startTime": 0,
                            "tableSize": 4096,
                            "routineNumber": 10,
                            "normalize": True,
                            "harmonicAmplitudes": [1, 0.5, 0.25],
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        gen_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgen " in line)
        assert gen_line.endswith("ftgen 0, 0, 4096, 10, 1, 0.5, 0.25")


def _gen_meta_patch_payload(gen_node_config: dict[str, object]) -> dict[str, object]:
    return {
        "name": "GEN Limit Patch",
        "description": "GEN config validation",
        "schema_version": 1,
        "graph": {
            "nodes": [
                {"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 60}},
                {"id": "v1", "opcode": "vco", "params": {"amp": 0.2, "freq": 220, "iwave": 1}, "position": {"x": 280, "y": 40}},
                {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 520, "y": 40}},
            ],
            "connections": [
                {"from_node_id": "g1", "from_port_id": "ift", "to_node_id": "v1", "to_port_id": "ifn"},
                {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "left"},
                {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "right"},
            ],
            "ui_layout": {"gen_nodes": {"g1": gen_node_config}},
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }


def _gen10_config(**overrides: object) -> dict[str, object]:
    config: dict[str, object] = {
        "mode": "ftgen",
        "tableNumber": 0,
        "startTime": 0,
        "tableSize": 4096,
        "routineNumber": 10,
        "normalize": True,
        "harmonicAmplitudes": [1],
    }
    config.update(overrides)
    return config


def test_gen_meta_opcode_allows_max_table_size(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        create_patch = client.post(
            "/api/patches",
            json=_gen_meta_patch_payload(_gen10_config(tableSize=MAX_GEN_TABLE_SIZE)),
        )
        assert create_patch.status_code == 201

        create_session = client.post("/api/sessions", json={"patch_id": create_patch.json()["id"]})
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")
        assert compile_response.status_code == 200
        gen_line = next(line.strip() for line in compile_response.json()["orc"].splitlines() if " ftgen " in line)
        assert gen_line.endswith(f"ftgen 0, 0, {MAX_GEN_TABLE_SIZE}, 10, 1")


@pytest.mark.parametrize(
    ("field_overrides", "expected_text"),
    [
        ({"tableSize": MAX_GEN_TABLE_SIZE + 1}, "GEN tableSize cannot exceed"),
        ({"tableSize": -1}, "GEN tableSize cannot be negative"),
        ({"tableSize": 0}, "GEN tableSize cannot be 0"),
        ({"rawArgs": [0] * (MAX_GEN_ARGUMENT_COUNT + 1)}, "GEN rawArgs cannot exceed"),
        ({"rawArgsText": ",".join(["1"] * (MAX_GEN_ARGUMENT_COUNT + 1))}, "GEN raw argument text cannot exceed"),
        ({"rawArgsText": "x" * (MAX_GEN_RAW_ARG_TOKEN_LENGTH + 1)}, "GEN raw argument tokens cannot exceed"),
    ],
)
def test_patch_create_rejects_oversized_gen_node_config(
    tmp_path: Path,
    field_overrides: dict[str, object],
    expected_text: str,
) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/patches",
            json=_gen_meta_patch_payload(_gen10_config(**field_overrides)),
        )

    assert response.status_code == 422
    assert expected_text in response.text


def test_gen_audio_asset_upload_persists_file(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        payload = b"RIFFdemoWAVEfmt "
        response = client.post(
            "/api/assets/gen-audio",
            content=payload,
            headers={"X-File-Name": "kick sample.wav", "Content-Type": "audio/wav"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["original_name"] == "kick_sample.wav"
        assert body["stored_name"].endswith(".wav")
        assert body["size_bytes"] == len(payload)

        stored_path = tmp_path / "gen_audio_assets" / body["stored_name"]
        assert stored_path.exists()
        assert stored_path.read_bytes() == payload


def _post_gen_audio_upload_asgi(
    client: TestClient,
    *,
    headers: dict[str, str],
    receive,
) -> tuple[int, bytes]:
    sent: list[dict[str, object]] = []
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/assets/gen-audio",
        "raw_path": b"/api/assets/gen-audio",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (name.lower().encode("ascii"), value.encode("utf-8"))
            for name, value in headers.items()
        ],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    async def run_request() -> None:
        await client.app(scope, receive, send)

    asyncio.run(run_request())

    status = next(
        int(message["status"])
        for message in sent
        if message["type"] == "http.response.start"
    )
    body = b"".join(
        message.get("body", b"")
        for message in sent
        if message["type"] == "http.response.body"
    )
    return status, body


def _post_bundle_import_asgi(
    client: TestClient,
    *,
    headers: dict[str, str],
    receive,
) -> tuple[int, bytes]:
    sent: list[dict[str, object]] = []
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/bundles/import/expand",
        "raw_path": b"/api/bundles/import/expand",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (name.lower().encode("ascii"), value.encode("utf-8"))
            for name, value in headers.items()
        ],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    async def run_request() -> None:
        await client.app(scope, receive, send)

    asyncio.run(run_request())

    status = next(
        int(message["status"])
        for message in sent
        if message["type"] == "http.response.start"
    )
    body = b"".join(
        message.get("body", b"")
        for message in sent
        if message["type"] == "http.response.body"
    )
    return status, body


def test_gen_audio_asset_upload_rejects_empty_stream(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/assets/gen-audio",
            content=b"",
            headers={"X-File-Name": "empty.wav", "Content-Type": "audio/wav"},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Audio upload is empty."
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_gen_audio_asset_upload_rejects_declared_oversize_before_reading_body(
    tmp_path: Path,
) -> None:
    receive_calls = 0

    async def receive() -> dict[str, object]:
        nonlocal receive_calls
        receive_calls += 1
        raise AssertionError("Oversized upload body should not be read.")

    with _client(tmp_path, gen_audio_asset_max_bytes=5) as client:
        status, body = _post_gen_audio_upload_asgi(
            client,
            headers={
                "X-File-Name": "too-large.wav",
                "Content-Type": "audio/wav",
                "Content-Length": "6",
            },
            receive=receive,
        )

        assert status == 413
        assert b"Audio upload exceeds maximum size (5 bytes)." in body
        assert receive_calls == 0
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_gen_audio_asset_upload_rejects_stream_oversize_before_later_chunks(
    tmp_path: Path,
) -> None:
    chunks = [b"abc", b"def", b"this chunk must not be read"]
    chunk_index = 0

    async def receive() -> dict[str, object]:
        nonlocal chunk_index
        if chunk_index >= 2:
            raise AssertionError("Upload handler consumed beyond the oversized chunk.")
        body = chunks[chunk_index]
        chunk_index += 1
        return {"type": "http.request", "body": body, "more_body": True}

    with _client(tmp_path, gen_audio_asset_max_bytes=5) as client:
        status, body = _post_gen_audio_upload_asgi(
            client,
            headers={"X-File-Name": "stream.wav", "Content-Type": "audio/wav"},
            receive=receive,
        )

        assert status == 413
        assert b"Audio upload exceeds maximum size (5 bytes)." in body
        assert chunk_index == 2
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_gen_audio_asset_upload_rejects_repeated_valid_uploads_after_byte_quota(
    tmp_path: Path,
) -> None:
    with _client(tmp_path, gen_audio_assets_max_total_bytes=10) as client:
        first = client.post(
            "/api/assets/gen-audio",
            content=b"abcdef",
            headers={"X-File-Name": "first.wav", "Content-Type": "audio/wav"},
        )
        assert first.status_code == 201

        second = client.post(
            "/api/assets/gen-audio",
            content=b"ghijk",
            headers={"X-File-Name": "second.wav", "Content-Type": "audio/wav"},
        )

        assert second.status_code == 413
        assert "generated audio asset storage quota" in second.text
        stored_files = [path for path in (tmp_path / "gen_audio_assets").iterdir() if not path.name.startswith(".")]
        assert len(stored_files) == 1
        assert stored_files[0].read_bytes() == b"abcdef"


def test_gen_audio_asset_upload_rejects_repeated_valid_uploads_after_count_quota(
    tmp_path: Path,
) -> None:
    with _client(tmp_path, gen_audio_assets_max_count=1) as client:
        first = client.post(
            "/api/assets/gen-audio",
            content=b"abcd",
            headers={"X-File-Name": "first.wav", "Content-Type": "audio/wav"},
        )
        assert first.status_code == 201

        second = client.post(
            "/api/assets/gen-audio",
            content=b"efgh",
            headers={"X-File-Name": "second.wav", "Content-Type": "audio/wav"},
        )

        assert second.status_code == 413
        assert "generated audio asset count quota" in second.text
        assert len(list((tmp_path / "gen_audio_assets").iterdir())) == 1


def test_gen_audio_asset_upload_rejects_declared_quota_overflow_before_reading_body(
    tmp_path: Path,
) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    (asset_dir / "existing.wav").write_bytes(b"abcd")
    receive_calls = 0

    async def receive() -> dict[str, object]:
        nonlocal receive_calls
        receive_calls += 1
        raise AssertionError("Quota-rejected upload body should not be read.")

    with _client(tmp_path, gen_audio_assets_max_total_bytes=5) as client:
        status, body = _post_gen_audio_upload_asgi(
            client,
            headers={
                "X-File-Name": "quota.wav",
                "Content-Type": "audio/wav",
                "Content-Length": "2",
            },
            receive=receive,
        )

        assert status == 413
        assert b"generated audio asset storage quota" in body
        assert receive_calls == 0
        assert sorted(path.name for path in asset_dir.iterdir()) == ["existing.wav"]


def test_patch_bundle_export_uses_zip_when_gen_audio_is_referenced(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "sample.aiff"
    audio_bytes = b"FORMfake"
    (asset_dir / stored_name).write_bytes(audio_bytes)

    payload = {
        "sourcePatchId": "patch-1",
        "name": "Bundled Patch",
        "description": "zip export",
        "schema_version": 1,
        "graph": {
            "nodes": [{"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 0, "y": 0}}],
            "connections": [],
            "ui_layout": {
                "gen_nodes": {
                    "g1": {
                        "mode": "ftgen",
                        "tableNumber": 5,
                        "startTime": 0,
                        "tableSize": 0,
                        "routineNumber": 1,
                        "normalize": True,
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": "demo.aiff",
                            "stored_name": stored_name,
                            "content_type": "audio/aiff",
                            "size_bytes": len(audio_bytes),
                        },
                        "sampleSkipTime": 0,
                        "sampleFormat": 0,
                        "sampleChannel": 0,
                    }
                }
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/patch", json=payload)
        assert response.status_code == 200
        assert response.headers["x-orchestron-export-format"] == "zip"
        assert response.headers["content-type"].startswith("application/zip")

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            entries = set(archive.namelist())
            assert "instrument.orch.instrument.json" in entries
            assert f"audio/{stored_name}" in entries
            exported_json = json.loads(archive.read("instrument.orch.instrument.json").decode("utf-8"))
            assert exported_json["name"] == "Bundled Patch"
            assert archive.read(f"audio/{stored_name}") == audio_bytes


def test_performance_bundle_export_uses_zip_when_patch_definitions_reference_gen_audio(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "sample.wav"
    audio_bytes = b"RIFFdemoWAVEfmt "
    (asset_dir / stored_name).write_bytes(audio_bytes)

    payload = {
        "format": "orchestron.performance",
        "version": 1,
        "exported_at": "2026-02-23T12:00:00Z",
        "performance": {
            "name": "Bundled Performance",
            "description": "",
            "config": {
                "version": 1,
                "bpm": 120,
                "stepCount": 16,
                "tracks": [],
                "pianoRolls": [],
                "midiControllers": [],
                "instruments": [{"patchId": "patch-1", "patchName": "Patch A", "midiChannel": 1}],
            },
        },
        "patch_definitions": [
            {
                "sourcePatchId": "patch-1",
                "name": "Patch A",
                "description": "",
                "schema_version": 1,
                "graph": {
                    "nodes": [{"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 0, "y": 0}}],
                    "connections": [],
                    "ui_layout": {
                        "gen_nodes": {
                            "g1": {
                                "mode": "ftgen",
                                "tableNumber": 5,
                                "startTime": 0,
                                "tableSize": 0,
                                "routineNumber": 1,
                                "normalize": True,
                                "sampleAsset": {
                                    "asset_id": "asset-1",
                                    "original_name": "demo.wav",
                                    "stored_name": stored_name,
                                    "content_type": "audio/wav",
                                    "size_bytes": len(audio_bytes),
                                },
                            }
                        }
                    },
                    "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
                },
            }
        ],
    }

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance", json=payload)
        assert response.status_code == 200
        assert response.headers["x-orchestron-export-format"] == "zip"
        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            entries = set(archive.namelist())
            assert "performance.orch.json" in entries
            assert f"audio/{stored_name}" in entries
            exported_json = json.loads(archive.read("performance.orch.json").decode("utf-8"))
            assert exported_json["format"] == "orchestron.performance"


def test_patch_bundle_export_uses_zip_when_sfload_asset_is_referenced(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "drums.sf2"
    audio_bytes = b"RIFFfakeSF2"
    (asset_dir / stored_name).write_bytes(audio_bytes)

    payload = {
        "sourcePatchId": "patch-1",
        "name": "Bundled sfload Patch",
        "description": "zip export for sfload",
        "schema_version": 1,
        "graph": {
            "nodes": [{"id": "s1", "opcode": "sfload", "params": {}, "position": {"x": 0, "y": 0}}],
            "connections": [],
            "ui_layout": {
                "sfload_nodes": {
                    "s1": {
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": "drums.sf2",
                            "stored_name": stored_name,
                            "content_type": "audio/sf2",
                            "size_bytes": len(audio_bytes),
                        },
                        "samplePath": "",
                    }
                }
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/patch", json=payload)
        assert response.status_code == 200
        assert response.headers["x-orchestron-export-format"] == "zip"
        assert response.headers["content-type"].startswith("application/zip")

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            entries = set(archive.namelist())
            assert "instrument.orch.instrument.json" in entries
            assert f"audio/{stored_name}" in entries
            exported_json = json.loads(archive.read("instrument.orch.instrument.json").decode("utf-8"))
            assert exported_json["name"] == "Bundled sfload Patch"
            assert archive.read(f"audio/{stored_name}") == audio_bytes


def _performance_csd_export_payload(
    *,
    gen_node_config: dict[str, object] | None = None,
    sfload_node_config: dict[str, object] | None = None,
    sfload_params: dict[str, object] | None = None,
) -> dict[str, object]:
    nodes = [
        {"id": "a1", "opcode": "const_a", "params": {"value": 0.1}, "position": {"x": 20, "y": 20}},
        {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
    ]
    ui_layout: dict[str, object] = {}
    if gen_node_config is not None:
        nodes.append({"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 20, "y": 140}})
        ui_layout["gen_nodes"] = {"g1": gen_node_config}
    if sfload_node_config is not None or sfload_params is not None:
        nodes.append(
            {
                "id": "s1",
                "opcode": "sfload",
                "params": sfload_params or {},
                "position": {"x": 20, "y": 260},
            }
        )
        if sfload_node_config is not None:
            ui_layout["sfload_nodes"] = {"s1": sfload_node_config}

    return {
        "performanceExport": {
            "format": "orchestron.performance",
            "version": 1,
            "exported_at": "2026-03-16T12:00:00.000Z",
            "performance": {
                "name": "Offline Export",
                "description": "render bundle",
                "config": {
                    "version": 7,
                    "instruments": [{"patchId": "patch-1", "midiChannel": 1}],
                },
            },
            "patch_definitions": [
                {
                    "sourcePatchId": "patch-1",
                    "name": "Offline Instrument",
                    "description": "includes bundled assets",
                    "schema_version": 1,
                    "graph": {
                        "nodes": nodes,
                        "connections": [
                            {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "left"},
                            {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "right"},
                        ],
                        "ui_layout": ui_layout,
                        "engine_config": {"sr": 44100, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
                    },
                }
            ],
        },
        "sequencerConfig": {
            "timing": _sequencer_timing(tempo_bpm=120, steps_per_beat=8),
            "step_count": 8,
            "playback_start_step": 0,
            "playback_end_step": 8,
            "playback_loop": False,
            "tracks": [
                {
                    "track_id": "voice-1",
                    "midi_channel": 1,
                    "timing": _sequencer_timing(tempo_bpm=120, steps_per_beat=4),
                    "length_beats": 1,
                    "velocity": 100,
                    "gate_ratio": 0.8,
                    "sync_to_track_id": None,
                    "active_pad": 0,
                    "queued_pad": None,
                    "pad_loop_enabled": False,
                    "pad_loop_repeat": True,
                    "pad_loop_sequence": [0],
                    "enabled": True,
                    "queued_enabled": None,
                    "pads": [
                        {
                            "pad_index": 0,
                            "length_beats": 1,
                            "steps": [{"note": 60, "hold": False, "velocity": 100}, None, None, None],
                        }
                    ],
                }
            ],
            "controller_tracks": [
                {
                    "track_id": "cc-1",
                    "controller_number": 1,
                    "timing": _sequencer_timing(tempo_bpm=120, steps_per_beat=4),
                    "length_beats": 1,
                    "active_pad": 0,
                    "queued_pad": None,
                    "pad_loop_enabled": False,
                    "pad_loop_repeat": True,
                    "pad_loop_sequence": [0],
                    "enabled": True,
                    "pads": [
                        {
                            "pad_index": 0,
                            "length_beats": 1,
                            "keypoints": [{"position": 0.0, "value": 0}, {"position": 1.0, "value": 127}],
                        }
                    ],
                }
            ],
        },
    }


def _midi_messages_with_absolute_ticks(midi_bytes: bytes):
    midi_file = mido.MidiFile(file=BytesIO(midi_bytes))
    for track in midi_file.tracks:
        absolute_tick = 0
        for message in track:
            absolute_tick += message.time
            yield absolute_tick, message


def test_performance_csd_export_bundle_includes_csd_midi_readme_and_assets(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "sample.aiff"
    uploaded_sample_bytes = b"FORMoffline"
    (asset_dir / stored_name).write_bytes(uploaded_sample_bytes)

    soundfont_stored_name = "lead.sf2"
    soundfont_bytes = b"sfbkoffline"
    (asset_dir / soundfont_stored_name).write_bytes(soundfont_bytes)

    payload = _performance_csd_export_payload(
        gen_node_config={
            "mode": "ftgen",
            "tableNumber": 5,
            "startTime": 0,
            "tableSize": 16384,
            "routineNumber": 1,
            "normalize": True,
            "sampleAsset": {
                "asset_id": "asset-1",
                "original_name": "demo.aiff",
                "stored_name": stored_name,
                "content_type": "audio/aiff",
                "size_bytes": len(uploaded_sample_bytes),
            },
            "sampleSkipTime": 0,
            "sampleFormat": 0,
            "sampleChannel": 0,
        },
        sfload_node_config={
            "sampleAsset": {
                "asset_id": "asset-2",
                "original_name": "lead.sf2",
                "stored_name": soundfont_stored_name,
                "content_type": "audio/sf2",
                "size_bytes": len(soundfont_bytes),
            },
            "samplePath": "",
        },
    )

    external_secret_path = tmp_path / "outside-secret.sf2"
    external_secret_bytes = b"outside-secret-soundfont"
    external_secret_path.write_bytes(external_secret_bytes)

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200
        assert response.headers["x-orchestron-export-format"] == "zip"
        assert response.headers["content-type"].startswith("application/zip")

        assert external_secret_bytes not in response.content
        assert str(external_secret_path).encode("utf-8") not in response.content

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            bundle_root = "Offline_Export"
            entries = set(archive.namelist())
            assert f"{bundle_root}/Offline_Export.csd" in entries
            assert f"{bundle_root}/Offline_Export.mid" in entries
            assert f"{bundle_root}/README.txt" in entries
            assert f"{bundle_root}/assets/{stored_name}" in entries
            assert f"{bundle_root}/assets/{soundfont_stored_name}" in entries
            assert archive.read(f"{bundle_root}/assets/{stored_name}") == uploaded_sample_bytes
            assert archive.read(f"{bundle_root}/assets/{soundfont_stored_name}") == soundfont_bytes

            csd = archive.read(f"{bundle_root}/Offline_Export.csd").decode("utf-8")
            assert "sr = 48000" in csd
            assert "ksmps = 1" in csd
            assert f'"assets/{stored_name}"' in csd
            assert f'"assets/{soundfont_stored_name}"' in csd
            assert str(tmp_path) not in csd
            assert "-d -W -f -o Offline_Export.wav -F Offline_Export.mid" in csd
            assert "-F Offline_Export.mid" in csd
            assert "f 0 " in csd

            readme = archive.read(f"{bundle_root}/README.txt").decode("utf-8")
            assert f"change into the bundled '{bundle_root}/' directory" in readme
            assert "csound -d -W -f -o Offline_Export.wav -F Offline_Export.mid Offline_Export.csd" in readme
            assert "32-bit float" in readme
            assert "MIDI Controller lane values" in readme

            midi_bytes = archive.read(f"{bundle_root}/Offline_Export.mid")
            assert midi_bytes.startswith(b"MThd")
            assert b"\xFF\x51\x03" in midi_bytes
            assert b"\x90\x3C\x64" in midi_bytes
            assert b"\xB0\x01" in midi_bytes


def test_performance_csd_score_export_inlines_score_and_rewrites_midi_opcodes(tmp_path: Path) -> None:
    payload = _performance_csd_export_payload()
    payload["eventSource"] = "score"
    graph = payload["performanceExport"]["patch_definitions"][0]["graph"]  # type: ignore[index]
    graph["nodes"].extend(
        [
            {"id": "pitch", "opcode": "cpsmidi", "params": {}, "position": {"x": 20, "y": 120}},
            {"id": "note", "opcode": "notnum", "params": {}, "position": {"x": 20, "y": 180}},
            {"id": "amp", "opcode": "ampmidi", "params": {"iscal": 1, "ifn": 1}, "position": {"x": 20, "y": 240}},
            {"id": "combo", "opcode": "midi_note", "params": {"gain": 0.5}, "position": {"x": 20, "y": 300}},
            {
                "id": "cutoff",
                "opcode": "midictrl",
                "params": {"inum": 1, "imin": 0, "imax": 127},
                "position": {"x": 20, "y": 360},
            },
        ]
    )

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            entries = set(archive.namelist())
            assert "Offline_Export/Offline_Export.csd" in entries
            assert "Offline_Export/Offline_Export.mid" not in entries
            assert "Offline_Export/WARNINGS.txt" in entries

            csd = archive.read("Offline_Export/Offline_Export.csd").decode("utf-8")
            assert "-d -W -f -o Offline_Export.wav" in csd
            assert "-F Offline_Export.mid" not in csd
            assert "csound -d -W -o Offline_Export.wav" not in csd
            assert "massign" not in csd
            assert "cpsmidinn(p4)" in csd
            assert "tablei(p5 / 128, 1, 1)" in csd
            assert "gk_vcs_score_cc[] init 2048" in csd
            assert "instr 9000" in csd
            assert "gk_vcs_score_cc[1]" in csd
            assert "i_vcs_internal_score_note_p4 = p4" in csd
            assert "i_vcs_internal_score_velocity_p5 = p5" in csd
            assert " cpsmidi\n" not in csd
            assert " ampmidi " not in csd
            assert " midictrl " not in csd
            assert "i 9000 0 " in csd
            assert "i 1 0 0.125 60 100" in csd

            readme = archive.read("Offline_Export/README.txt").decode("utf-8")
            assert "csound -d -W -f -o Offline_Export.wav Offline_Export.csd" in readme
            assert "-F Offline_Export.mid" not in readme
            assert "32-bit float" in readme
            assert "WARNINGS.txt" in readme

            warnings = archive.read("Offline_Export/WARNINGS.txt").decode("utf-8")
            assert "approximates ampmidi node 'amp'" in warnings


def test_performance_csd_midi_export_seeds_enabled_midi_controller_values(tmp_path: Path) -> None:
    payload = _performance_csd_export_payload()
    payload["midiControllers"] = [
        {"controllerNumber": 10, "value": 91, "enabled": True},
        {"controllerNumber": 11, "value": 37, "enabled": True},
        {"controllerNumber": 12, "value": 99, "enabled": False},
    ]
    performance = payload["performanceExport"]["performance"]  # type: ignore[index]
    performance["config"]["instruments"] = [  # type: ignore[index]
        {"patchId": "patch-1", "midiChannel": 1},
        {"patchId": "patch-1", "midiChannel": 4},
    ]

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            midi_bytes = archive.read("Offline_Export/Offline_Export.mid")

    tick_zero_messages = [
        message
        for tick, message in _midi_messages_with_absolute_ticks(midi_bytes)
        if tick == 0 and not getattr(message, "is_meta", False)
    ]
    seeded_controllers = [
        (message.channel, message.control, message.value)
        for message in tick_zero_messages
        if message.type == "control_change"
    ]
    first_note_on_index = next(
        index
        for index, message in enumerate(tick_zero_messages)
        if message.type == "note_on" and message.velocity > 0
    )
    last_seeded_controller_index = max(
        index
        for index, message in enumerate(tick_zero_messages)
        if message.type == "control_change" and message.control in {10, 11}
    )

    assert seeded_controllers[:4] == [
        (0, 10, 91),
        (3, 10, 91),
        (0, 11, 37),
        (3, 11, 37),
    ]
    assert (0, 12, 99) not in seeded_controllers
    assert (3, 12, 99) not in seeded_controllers
    assert last_seeded_controller_index < first_note_on_index


def test_performance_csd_score_export_seeds_enabled_midi_controller_values(tmp_path: Path) -> None:
    payload = _performance_csd_export_payload()
    payload["eventSource"] = "score"
    payload["midiControllers"] = [
        {"controllerNumber": 10, "value": 91, "enabled": True},
        {"controllerNumber": 11, "value": 37, "enabled": True},
        {"controllerNumber": 12, "value": 99, "enabled": False},
    ]
    performance = payload["performanceExport"]["performance"]  # type: ignore[index]
    performance["config"]["instruments"] = [  # type: ignore[index]
        {"patchId": "patch-1", "midiChannel": 1},
        {"patchId": "patch-1", "midiChannel": 4},
    ]
    graph = payload["performanceExport"]["patch_definitions"][0]["graph"]  # type: ignore[index]
    graph["nodes"].extend(  # type: ignore[index]
        [
            {
                "id": "cutoff",
                "opcode": "midictrl",
                "params": {"inum": 10, "imin": 100, "imax": 8000},
                "position": {"x": 20, "y": 120},
            },
            {
                "id": "resonance",
                "opcode": "midictrl",
                "params": {"inum": 11, "imin": 0, "imax": 1},
                "position": {"x": 20, "y": 180},
            },
        ]
    )

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            csd = archive.read("Offline_Export/Offline_Export.csd").decode("utf-8")
            readme = archive.read("Offline_Export/README.txt").decode("utf-8")

    assert "i 9000 0 0.000021 10 91" in csd
    assert "i 9000 0 0.000021 11 37" in csd
    assert "i 9000 0 0.000021 394 91" in csd
    assert "i 9000 0 0.000021 395 37" in csd
    assert "i 9000 0 0.000021 12 99" not in csd
    assert "i 9000 0 0.000021 396 99" not in csd
    assert "gk_vcs_score_cc[10] init 91" in csd
    assert "gk_vcs_score_cc[11] init 37" in csd
    assert "gk_vcs_score_cc[394] init 91" in csd
    assert "gk_vcs_score_cc[395] init 37" in csd
    assert "gk_vcs_score_cc[12] init 99" not in csd
    assert "gk_vcs_score_cc[396] init 99" not in csd
    assert "gk_vcs_score_cc[10]" in csd
    assert "gk_vcs_score_cc[11]" in csd
    assert " midictrl " not in csd
    assert csd.index("i 9000 0 0.000021 10 91") < csd.index("i 1 0 0.125 60 100")
    assert "MIDI Controller lane values" in readme


def test_performance_csd_export_runs_always_on_effect_for_score_duration(tmp_path: Path) -> None:
    source_payload = _audio_source_patch_payload(name="Export Source")
    effect_payload = _always_on_effect_patch_payload(name="Export Effect")
    base_sequencer_config = _performance_csd_export_payload()["sequencerConfig"]
    payload = {
        "performanceExport": {
            "format": "orchestron.performance",
            "version": 1,
            "exported_at": "2026-03-16T12:00:00.000Z",
            "performance": {
                "name": "Effect Export",
                "description": "routes through always-on effect",
                "config": {
                    "version": 10,
                    "instruments": [
                        {"id": "src", "patchId": "patch-source", "midiChannel": 1},
                        {
                            "id": "fx",
                            "patchId": "patch-fx",
                            "midiChannel": 0,
                            "effectRoutes": [{"sourceId": "src", "channel": "right"}],
                        },
                    ],
                },
            },
            "patch_definitions": [
                {
                    "sourcePatchId": "patch-source",
                    "name": "Export Source",
                    "description": "",
                    "schema_version": 1,
                    "graph": source_payload["graph"],
                },
                {
                    "sourcePatchId": "patch-fx",
                    "name": "Export Effect",
                    "description": "",
                    "alwaysOn": True,
                    "schema_version": 1,
                    "graph": effect_payload["graph"],
                },
            ],
        },
        "sequencerConfig": base_sequencer_config,
    }

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            csd = archive.read("Effect_Export/Effect_Export.csd").decode("utf-8")
            assert 'massign 1, "vcs_instr_1"' in csd
            assert 'connect "vcs_instr_1", "right", "vcs_instr_2", "right"' in csd
            assert 'connect "vcs_instr_1", "left", "vcs_instr_2", "left"' not in csd
            assert 'alwayson "vcs_instr_2"' in csd
            assert "f 0 2.5" in csd


def test_performance_csd_score_export_calls_routed_instruments_by_number(tmp_path: Path) -> None:
    source_payload = _audio_source_patch_payload(name="Export Source")
    effect_payload = _always_on_effect_patch_payload(name="Export Effect")
    base_sequencer_config = _performance_csd_export_payload()["sequencerConfig"]
    payload = {
        "eventSource": "score",
        "performanceExport": {
            "format": "orchestron.performance",
            "version": 1,
            "exported_at": "2026-03-16T12:00:00.000Z",
            "performance": {
                "name": "Effect Score Export",
                "description": "routes score notes through always-on effect",
                "config": {
                    "version": 10,
                    "instruments": [
                        {"id": "src", "patchId": "patch-source", "midiChannel": 1},
                        {
                            "id": "fx",
                            "patchId": "patch-fx",
                            "midiChannel": 0,
                            "effectRoutes": [{"sourceId": "src", "channel": "right"}],
                        },
                    ],
                },
            },
            "patch_definitions": [
                {
                    "sourcePatchId": "patch-source",
                    "name": "Export Source",
                    "description": "",
                    "schema_version": 1,
                    "graph": source_payload["graph"],
                },
                {
                    "sourcePatchId": "patch-fx",
                    "name": "Export Effect",
                    "description": "",
                    "alwaysOn": True,
                    "schema_version": 1,
                    "graph": effect_payload["graph"],
                },
            ],
        },
        "sequencerConfig": base_sequencer_config,
    }

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            csd = archive.read("Effect_Score_Export/Effect_Score_Export.csd").decode("utf-8")
            assert 'instr "vcs_instr_1"' not in csd
            assert "instr vcs_instr_1" in csd
            assert 'connect "vcs_instr_1", "right", "vcs_instr_2", "right"' in csd
            assert 'alwayson "vcs_instr_2"' in csd
            assert "i_vcs_internal_score_note_p4 = p4" in csd
            assert "i_vcs_internal_score_velocity_p5 = p5" in csd
            assert "\ni 1 0 0.125 60 100\n" in csd
            assert '\ni "vcs_instr_1" ' not in csd
            assert "f 0 2.5" in csd


def test_performance_csd_export_rejects_always_on_effect_route_loop(tmp_path: Path) -> None:
    effect_a_payload = _always_on_effect_with_outlets_patch_payload(name="Export Effect A")
    effect_b_payload = _always_on_effect_with_outlets_patch_payload(name="Export Effect B")
    payload = {
        "performanceExport": {
            "format": "orchestron.performance",
            "version": 1,
            "exported_at": "2026-03-16T12:00:00.000Z",
            "performance": {
                "name": "Cyclic Effect Export",
                "description": "contains an invalid feedback route",
                "config": {
                    "version": 10,
                    "instruments": [
                        {
                            "id": "fx-a",
                            "patchId": "patch-fx-a",
                            "midiChannel": 0,
                            "effectRoutes": [{"sourceId": "fx-b", "channel": "left"}],
                        },
                        {
                            "id": "fx-b",
                            "patchId": "patch-fx-b",
                            "midiChannel": 0,
                            "effectRoutes": [{"sourceId": "fx-a", "channel": "left"}],
                        },
                    ],
                },
            },
            "patch_definitions": [
                {
                    "sourcePatchId": "patch-fx-a",
                    "name": "Export Effect A",
                    "description": "",
                    "alwaysOn": True,
                    "schema_version": 1,
                    "graph": effect_a_payload["graph"],
                },
                {
                    "sourcePatchId": "patch-fx-b",
                    "name": "Export Effect B",
                    "description": "",
                    "alwaysOn": True,
                    "schema_version": 1,
                    "graph": effect_b_payload["graph"],
                },
            ],
        },
        "sequencerConfig": _performance_csd_export_payload()["sequencerConfig"],
    }

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 422
        diagnostics = response.json()["detail"]["diagnostics"]
        assert "Effect routing would create an audio feedback loop." in diagnostics


def test_performance_csd_export_rejects_empty_midi_performance(tmp_path: Path) -> None:
    payload = _performance_csd_export_payload()
    payload["sequencerConfig"]["tracks"][0]["enabled"] = False
    payload["sequencerConfig"]["controller_tracks"][0]["enabled"] = False

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 400
    assert "generated no MIDI note-on events" in response.text


def test_performance_csd_export_rejects_template_patch_definition(tmp_path: Path) -> None:
    payload = _performance_csd_export_payload()
    definition = payload["performanceExport"]["patch_definitions"][0]  # type: ignore[index]
    definition["isTemplate"] = True

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 400
    assert "template" in response.text


@pytest.mark.parametrize(
    ("field_name", "malicious_value"),
    [
        ("sourcePatchId", "patch-1\ninstr 99"),
        ("name", "Offline Instrument\ninstr 99"),
        ("node_id", "a1\ninstr 99"),
    ],
)
def test_performance_csd_export_request_rejects_control_characters_in_orc_metadata(
    field_name: str,
    malicious_value: str,
) -> None:
    payload = _performance_csd_export_payload()
    definition = payload["performanceExport"]["patch_definitions"][0]  # type: ignore[index]
    if field_name == "node_id":
        graph = definition["graph"]
        graph["nodes"][0]["id"] = malicious_value
        graph["connections"][0]["from_node_id"] = malicious_value
        graph["connections"][1]["from_node_id"] = malicious_value
    else:
        definition[field_name] = malicious_value

    with pytest.raises(ValidationError, match="control characters"):
        PerformanceCsdExportRequest.model_validate(payload)


def test_performance_csd_export_rejects_huge_playback_range_before_export_work(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_export_starts(*_args: object, **_kwargs: object) -> bytes:
        raise AssertionError("performance CSD export work should not start for oversized playback range")

    monkeypatch.setattr(PerformanceExportService, "build_performance_csd_archive", fail_if_export_starts)
    payload = _performance_csd_export_payload()
    payload["sequencerConfig"]["playback_end_step"] = OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS + 1

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 422
    assert "playback range exceeds" in response.text


def test_performance_csd_export_rejects_event_count_before_export_work(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_export_starts(*_args: object, **_kwargs: object) -> bytes:
        raise AssertionError("performance CSD export work should not start for oversized MIDI event count")

    monkeypatch.setattr(PerformanceExportService, "build_performance_csd_archive", fail_if_export_starts)
    payload = _performance_csd_export_payload()
    note_burst = list(range(16))
    base_track = payload["sequencerConfig"]["tracks"][0]
    payload["sequencerConfig"]["playback_end_step"] = 1024
    payload["sequencerConfig"]["tracks"] = [
        {
            **base_track,
            "track_id": f"voice-{index}",
            "midi_channel": (index % 16) + 1,
            "pads": [
                {
                    "pad_index": 0,
                    "length_beats": 1,
                    "steps": [{"note": note_burst, "hold": False, "velocity": 100}],
                }
            ],
        }
        for index in range(128)
    ]
    assert 1024 * 128 * len(note_burst) * 2 > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 422
    assert "too many MIDI events" in response.text


def test_performance_csd_export_event_budget_is_arrangement_aware_for_finite_pad_loops() -> None:
    payload = _performance_csd_export_payload()
    payload["performanceExport"]["performance"]["config"]["instruments"] = [  # type: ignore[index]
        {"patchId": "patch-1", "midiChannel": channel}
        for channel in range(1, 8)
    ]
    sequencer_config = payload["sequencerConfig"]  # type: ignore[index]
    sequencer_config["timing"] = _sequencer_timing(tempo_bpm=147, steps_per_beat=8)  # type: ignore[index]
    sequencer_config["step_count"] = 8  # type: ignore[index]
    sequencer_config["playback_start_step"] = 0  # type: ignore[index]
    sequencer_config["playback_end_step"] = 4096  # type: ignore[index]
    finite_pad_loop = [0] * 64
    track_timing = _sequencer_timing(tempo_bpm=147, steps_per_beat=4)

    sequencer_config["tracks"] = [  # type: ignore[index]
        {
            "track_id": "voice-1",
            "midi_channel": 6,
            "timing": track_timing,
            "length_beats": 8,
            "velocity": 100,
            "gate_ratio": 0.8,
            "sync_to_track_id": None,
            "active_pad": 0,
            "queued_pad": None,
            "pad_loop_enabled": True,
            "pad_loop_repeat": False,
            "pad_loop_sequence": finite_pad_loop,
            "enabled": True,
            "queued_enabled": None,
            "pads": [
                {
                    "pad_index": 0,
                    "length_beats": 8,
                    "steps": [{"note": 60, "hold": False, "velocity": 100}],
                }
            ],
        }
    ]
    sequencer_config["controller_tracks"] = [  # type: ignore[index]
        {
            "track_id": f"cc-{index}",
            "controller_number": controller_number,
            "timing": track_timing,
            "length_beats": 8,
            "active_pad": 0,
            "queued_pad": None,
            "pad_loop_enabled": True,
            "pad_loop_repeat": False,
            "pad_loop_sequence": finite_pad_loop,
            "enabled": True,
            "pads": [
                {
                    "pad_index": 0,
                    "length_beats": 8,
                    "keypoints": [{"position": 0.0, "value": 64}, {"position": 1.0, "value": 64}],
                }
            ],
        }
        for index, controller_number in enumerate((10, 11, 74), start=1)
    ]
    sequencer_config["arpeggiators"] = [  # type: ignore[index]
        {
            "arpeggiator_id": "arp-1",
            "enabled": True,
            "input_channel": 6,
            "target_channel": 4,
            "rate": "1/16",
            "gate_ratio": 0.72,
            "swing": 0.0,
            "octaves": 2,
            "pattern": "up_down",
            "latch": False,
            "velocity_mode": "input",
            "fixed_velocity": 100,
            "accent_cycle": [],
            "probability": 1.0,
            "repeats": 1,
            "humanize_ms": 0.0,
            "humanize_velocity": 0,
            "transpose": 0,
            "scale_quantize": False,
            "scale_root": "C",
            "scale_type": "minor",
            "mode": "aeolian",
            "restart_mode": "first_note",
        }
    ]

    old_worst_case_estimate = (
        4096 * 1 * 2
        + 4096 * 3 * 15 * 7
        + 4096 * 16 * 4 * 2
    )
    assert old_worst_case_estimate > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS

    request = PerformanceCsdExportRequest.model_validate(payload)

    assert request.sequencer_config.playback_end_step == 4096


def test_performance_csd_export_event_budget_excludes_consumed_arpeggiator_input_notes() -> None:
    payload = _performance_csd_export_payload()
    payload["performanceExport"]["performance"]["config"]["instruments"] = [  # type: ignore[index]
        {"patchId": "patch-1", "midiChannel": 5},
        {"patchId": "patch-1", "midiChannel": 6},
    ]
    sequencer_config = payload["sequencerConfig"]  # type: ignore[index]
    sequencer_config["timing"] = _sequencer_timing(tempo_bpm=147, steps_per_beat=8)  # type: ignore[index]
    sequencer_config["playback_start_step"] = 0  # type: ignore[index]
    sequencer_config["playback_end_step"] = 4096  # type: ignore[index]
    input_note_burst = list(range(48, 64))
    track_timing = _sequencer_timing(tempo_bpm=147, steps_per_beat=4)
    arp_input_track = {
        "midi_channel": 6,
        "timing": track_timing,
        "length_beats": 1,
        "velocity": 100,
        "gate_ratio": 0.8,
        "sync_to_track_id": None,
        "active_pad": 0,
        "queued_pad": None,
        "pad_loop_enabled": False,
        "pad_loop_repeat": True,
        "pad_loop_sequence": [0],
        "enabled": True,
        "queued_enabled": None,
        "pads": [
            {
                "pad_index": 0,
                "length_beats": 1,
                "steps": [{"note": input_note_burst, "hold": False, "velocity": 100}],
            }
        ],
    }
    sequencer_config["tracks"] = [  # type: ignore[index]
        {**arp_input_track, "track_id": f"arp-input-{index}"}
        for index in range(4)
    ]
    sequencer_config["controller_tracks"] = [  # type: ignore[index]
        {
            "track_id": "cc-arp-input",
            "controller_number": 74,
            "timing": track_timing,
            "length_beats": 1,
            "active_pad": 0,
            "queued_pad": None,
            "pad_loop_enabled": False,
            "pad_loop_repeat": True,
            "pad_loop_sequence": [0],
            "enabled": True,
            "target_channels": [6],
            "pads": [
                {
                    "pad_index": 0,
                    "length_beats": 1,
                    "keypoints": [{"position": 0.0, "value": 0}, {"position": 0.5, "value": 127}],
                }
            ],
        }
    ]
    sequencer_config["arpeggiators"] = [  # type: ignore[index]
        {
            "arpeggiator_id": "arp-1",
            "enabled": True,
            "input_channel": 6,
            "target_channel": 5,
            "rate": "1/1",
            "gate_ratio": 0.72,
            "swing": 0.0,
            "octaves": 1,
            "pattern": "up",
            "latch": False,
            "velocity_mode": "input",
            "fixed_velocity": 100,
            "accent_cycle": [],
            "probability": 1.0,
            "repeats": 1,
            "humanize_ms": 0.0,
            "humanize_velocity": 0,
            "transpose": 0,
            "scale_quantize": False,
            "scale_root": "C",
            "scale_type": "minor",
            "mode": "aeolian",
            "restart_mode": "first_note",
        }
    ]

    consumed_input_note_events = 4 * 4096 * len(input_note_burst) * 2
    assert consumed_input_note_events > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS

    request = PerformanceCsdExportRequest.model_validate(payload)

    assert request.sequencer_config.arpeggiators[0].input_channel == 6


def test_performance_csd_export_rejects_oversized_step_note_list_before_export_work(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_export_starts(*_args: object, **_kwargs: object) -> bytes:
        raise AssertionError("performance CSD export work should not start for oversized step note list")

    monkeypatch.setattr(PerformanceExportService, "build_performance_csd_archive", fail_if_export_starts)
    payload = _performance_csd_export_payload()
    payload["sequencerConfig"]["tracks"][0]["pads"][0]["steps"] = [
        {"note": list(range(17)), "hold": False, "velocity": 100}
    ]

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 422
    assert "step note lists cannot exceed" in response.text


def test_performance_csd_export_rejects_looping_playback_before_export_work(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_export_starts(*_args: object, **_kwargs: object) -> bytes:
        raise AssertionError("performance CSD export work should not start for looping playback")

    monkeypatch.setattr(PerformanceExportService, "build_performance_csd_archive", fail_if_export_starts)
    payload = _performance_csd_export_payload()
    payload["sequencerConfig"]["playback_loop"] = True

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 422
    assert "does not support looping playback" in response.text


def test_performance_csd_export_midi_generation_enforces_event_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = PerformanceCsdExportRequest.model_validate(_performance_csd_export_payload())
    exporter = PerformanceExportService(compiler_service=None, gen_asset_service=None)  # type: ignore[arg-type]
    monkeypatch.setattr(performance_export_service, "OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS", 1)

    with pytest.raises(OfflineMidiExportBudgetExceededError, match="too many MIDI events"):
        exporter._build_midi_file(
            request=request,
            controller_default_channels=(1,),
            track_name="budget",
        )


def test_performance_csd_export_midi_generation_uses_offline_clock_for_event_ticks() -> None:
    request = PerformanceCsdExportRequest.model_validate(_performance_csd_export_payload())
    exporter = PerformanceExportService(compiler_service=None, gen_asset_service=None)  # type: ignore[arg-type]

    midi_bytes = exporter._build_midi_file(
        request=request,
        controller_default_channels=(1,),
        track_name="clock",
    )
    note_events = [
        (tick, message.type, message.channel, message.note, message.velocity)
        for tick, message in _midi_messages_with_absolute_ticks(midi_bytes)
        if message.type in {"note_on", "note_off"} and message.channel == 0 and message.note == 60
    ]

    assert note_events[:2] == [
        (0, "note_on", 0, 60, 100),
        (120, "note_off", 0, 60, 0),
    ]


def test_performance_csd_export_midi_generation_includes_arpeggiator_output_notes() -> None:
    payload = _performance_csd_export_payload()
    sequencer_config = payload["sequencerConfig"]  # type: ignore[index]
    sequencer_config["playback_end_step"] = 16  # type: ignore[index]
    sequencer_config["controller_tracks"] = []  # type: ignore[index]
    sequencer_config["tracks"] = [  # type: ignore[index]
        {
            "track_id": "arp-input",
            "midi_channel": 6,
            "timing": _sequencer_timing(tempo_bpm=120, steps_per_beat=4),
            "length_beats": 1,
            "velocity": 100,
            "gate_ratio": 0.8,
            "sync_to_track_id": None,
            "active_pad": 0,
            "queued_pad": None,
            "pad_loop_enabled": False,
            "pad_loop_repeat": True,
            "pad_loop_sequence": [0],
            "enabled": True,
            "queued_enabled": None,
            "pads": [
                {
                    "pad_index": 0,
                    "length_beats": 1,
                    "steps": [
                        {"note": 64, "hold": True, "velocity": 100},
                        {"note": None, "hold": True, "velocity": 100},
                        {"note": None, "hold": True, "velocity": 100},
                        {"note": None, "hold": False, "velocity": 100},
                    ],
                }
            ],
        }
    ]
    sequencer_config["arpeggiators"] = [  # type: ignore[index]
        {
            "arpeggiator_id": "arp-1",
            "enabled": True,
            "input_channel": 6,
            "target_channel": 5,
            "rate": "1/16",
            "gate_ratio": 0.5,
            "swing": 0.0,
            "octaves": 1,
            "pattern": "up",
            "latch": False,
            "velocity_mode": "input",
            "fixed_velocity": 100,
            "accent_cycle": [],
            "probability": 1.0,
            "repeats": 1,
            "humanize_ms": 0.0,
            "humanize_velocity": 0,
            "transpose": 0,
            "scale_quantize": False,
            "scale_root": "C",
            "scale_type": "minor",
            "mode": "aeolian",
            "restart_mode": "first_note",
        }
    ]
    request = PerformanceCsdExportRequest.model_validate(payload)
    exporter = PerformanceExportService(compiler_service=None, gen_asset_service=None)  # type: ignore[arg-type]

    midi_bytes = exporter._build_midi_file(
        request=request,
        controller_default_channels=(5, 6),
        track_name="arp",
    )
    note_on_events = [
        (tick, message.channel, message.note, message.velocity)
        for tick, message in _midi_messages_with_absolute_ticks(midi_bytes)
        if message.type == "note_on" and message.velocity > 0
    ]

    assert any(channel == 4 and note == 64 and velocity == 100 for _tick, channel, note, velocity in note_on_events)
    assert not any(channel == 5 and note == 64 for _tick, channel, note, _velocity in note_on_events)


def test_performance_csd_export_midi_generation_enforces_wall_clock_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = PerformanceCsdExportRequest.model_validate(_performance_csd_export_payload())
    exporter = PerformanceExportService(compiler_service=None, gen_asset_service=None)  # type: ignore[arg-type]
    timer_values = iter([0.0, 10.0])
    monkeypatch.setattr(performance_export_service, "_monotonic_seconds", lambda: next(timer_values))

    with pytest.raises(OfflineMidiExportTimeoutError, match="exceeded"):
        exporter._build_midi_file(
            request=request,
            controller_default_channels=(1,),
            track_name="timeout",
        )


@pytest.mark.parametrize(
    ("node_kind", "sample_path"),
    [
        ("gen", "absolute"),
        ("gen", "../secret.wav"),
        ("gen_named", "absolute"),
        ("gen_named", "../secret.wav"),
        ("sfload", "absolute"),
        ("sfload", "../secret.sf2"),
    ],
)
def test_performance_csd_export_rejects_raw_sample_paths(
    tmp_path: Path,
    node_kind: str,
    sample_path: str,
) -> None:
    secret_path = tmp_path / "outside-secret.bin"
    secret_bytes = b"raw-sample-path-secret"
    secret_path.write_bytes(secret_bytes)
    resolved_sample_path = str(secret_path) if sample_path == "absolute" else sample_path

    gen_node_config = None
    sfload_node_config = None
    expected_message = "samplePath. Upload"
    if node_kind in {"gen", "gen_named"}:
        gen_node_config = {
            "mode": "ftgen",
            "tableNumber": 5,
            "startTime": 0,
            "tableSize": 16384,
            "routineNumber": 1,
            "normalize": True,
            "sampleAsset": None,
            "samplePath": resolved_sample_path,
            "sampleSkipTime": 0,
            "sampleFormat": 0,
            "sampleChannel": 0,
        }
    else:
        sfload_node_config = {"sampleAsset": None, "samplePath": resolved_sample_path}

    payload = _performance_csd_export_payload(
        gen_node_config=gen_node_config,
        sfload_node_config=sfload_node_config,
    )

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 400
    assert expected_message in response.text
    assert secret_bytes not in response.content
    assert str(secret_path).encode("utf-8") not in response.content


def test_performance_csd_export_rejects_sfload_legacy_filename_param(tmp_path: Path) -> None:
    secret_path = tmp_path / "legacy-secret.sf2"
    secret_bytes = b"legacy-filename-secret"
    secret_path.write_bytes(secret_bytes)
    payload = _performance_csd_export_payload(sfload_params={"filename": str(secret_path)})

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 400
    assert "raw filename parameter" in response.text
    assert secret_bytes not in response.content
    assert str(secret_path).encode("utf-8") not in response.content


def test_performance_csd_export_rejects_stored_asset_symlink_escape(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    secret_path = tmp_path / "outside-secret.wav"
    secret_bytes = b"stored-asset-symlink-secret"
    secret_path.write_bytes(secret_bytes)
    stored_name = "linked.wav"
    try:
        (asset_dir / stored_name).symlink_to(secret_path)
    except OSError as err:
        pytest.skip(f"symlink creation is unavailable: {err}")

    payload = _performance_csd_export_payload(
        gen_node_config={
            "mode": "ftgen",
            "tableNumber": 5,
            "startTime": 0,
            "tableSize": 16384,
            "routineNumber": 1,
            "normalize": True,
            "sampleAsset": {
                "asset_id": "asset-1",
                "original_name": "linked.wav",
                "stored_name": stored_name,
                "content_type": "audio/wav",
                "size_bytes": len(secret_bytes),
            },
            "sampleSkipTime": 0,
            "sampleFormat": 0,
            "sampleChannel": 0,
        }
    )

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 400
    assert "escapes configured asset directory" in response.text
    assert secret_bytes not in response.content
    assert str(secret_path).encode("utf-8") not in response.content


def test_performance_csd_export_rejects_missing_stored_asset(tmp_path: Path) -> None:
    payload = _performance_csd_export_payload(
        sfload_node_config={
            "sampleAsset": {
                "asset_id": "asset-1",
                "original_name": "missing.sf2",
                "stored_name": "missing.sf2",
                "content_type": "audio/sf2",
                "size_bytes": 1,
            },
            "samplePath": "",
        }
    )

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)

    assert response.status_code == 400
    assert "does not exist on the backend" in response.text


def test_patch_bundle_export_uses_zip_when_gen01_named_routine_is_referenced(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "sample.aiff"
    audio_bytes = b"FORMfake"
    (asset_dir / stored_name).write_bytes(audio_bytes)

    payload = {
        "sourcePatchId": "patch-1",
        "name": "Bundled Named GEN01 Patch",
        "description": "zip export for GEN01 routineName",
        "schema_version": 1,
        "graph": {
            "nodes": [{"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 0, "y": 0}}],
            "connections": [],
            "ui_layout": {
                "gen_nodes": {
                    "g1": {
                        "mode": "ftgen",
                        "tableNumber": 5,
                        "startTime": 0,
                        "tableSize": 0,
                        "routineNumber": 1,
                        "routineName": "GEN01",
                        "normalize": True,
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": "demo.aiff",
                            "stored_name": stored_name,
                            "content_type": "audio/aiff",
                            "size_bytes": len(audio_bytes),
                        },
                        "sampleSkipTime": 0,
                        "sampleFormat": 0,
                        "sampleChannel": 0,
                    }
                }
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/patch", json=payload)
        assert response.status_code == 200
        assert response.headers["x-orchestron-export-format"] == "zip"

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            entries = set(archive.namelist())
            assert "instrument.orch.instrument.json" in entries
            assert f"audio/{stored_name}" in entries


def test_bundle_import_expand_restores_audio_files_with_identical_filename(tmp_path: Path) -> None:
    stored_name = "aa963aa1-921d-41f8-a250-2b0fa13713b3.aiff"
    audio_bytes = b"FORMfake"
    payload = {
        "sourcePatchId": "patch-1",
        "name": "Imported Patch",
        "description": "",
        "schema_version": 1,
        "graph": {
            "nodes": [{"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 0, "y": 0}}],
            "connections": [],
            "ui_layout": {
                "gen_nodes": {
                    "g1": {
                        "mode": "ftgen",
                        "tableNumber": 5,
                        "startTime": 0,
                        "tableSize": 0,
                        "routineNumber": 1,
                        "normalize": True,
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": "demo.aiff",
                            "stored_name": stored_name,
                            "content_type": "audio/aiff",
                            "size_bytes": len(audio_bytes),
                        },
                        "sampleSkipTime": 0,
                        "sampleFormat": 0,
                        "sampleChannel": 0,
                    }
                }
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("anything.orch.instrument.json", json.dumps(payload).encode("utf-8"))
        archive.writestr(f"audio/{stored_name}", audio_bytes)

    with _client(tmp_path) as client:
        response = client.post(
            "/api/bundles/import/expand",
            content=archive_bytes.getvalue(),
            headers={
                "X-File-Name": "bundle.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )
        assert response.status_code == 200
        parsed = response.json()
        assert parsed["name"] == "Imported Patch"
        stored_path = tmp_path / "gen_audio_assets" / stored_name
        assert stored_path.exists()
        assert stored_path.read_bytes() == audio_bytes


def test_bundle_import_rejects_declared_oversize_before_reading_body(tmp_path: Path) -> None:
    receive_calls = 0

    async def receive() -> dict[str, object]:
        nonlocal receive_calls
        receive_calls += 1
        raise AssertionError("Oversized bundle import body should not be read.")

    with _client(tmp_path, bundle_import_max_bytes=5) as client:
        status, body = _post_bundle_import_asgi(
            client,
            headers={
                "X-File-Name": "too-large.orch.zip",
                "Content-Type": "application/zip",
                "Content-Length": "6",
            },
            receive=receive,
        )

        assert status == 413
        assert b"Bundle import exceeds maximum request size (5 bytes)." in body
        assert receive_calls == 0
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_bundle_import_rejects_stream_oversize_before_later_chunks(tmp_path: Path) -> None:
    chunks = [b"abc", b"def", b"this chunk must not be read"]
    chunk_index = 0

    async def receive() -> dict[str, object]:
        nonlocal chunk_index
        if chunk_index >= 2:
            raise AssertionError("Bundle import consumed beyond the oversized chunk.")
        body = chunks[chunk_index]
        chunk_index += 1
        return {"type": "http.request", "body": body, "more_body": True}

    with _client(tmp_path, bundle_import_max_bytes=5) as client:
        status, body = _post_bundle_import_asgi(
            client,
            headers={"X-File-Name": "stream.orch.zip", "Content-Type": "application/zip"},
            receive=receive,
        )

        assert status == 413
        assert b"Bundle import exceeds maximum request size (5 bytes)." in body
        assert chunk_index == 2
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_bundle_import_rejects_zip_with_too_many_members(tmp_path: Path) -> None:
    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("patch.orch.instrument.json", b'{"name":"Small"}')
        archive.writestr("extra.txt", b"extra")

    with _client(tmp_path, bundle_import_zip_max_members=1) as client:
        response = client.post(
            "/api/bundles/import/expand",
            content=archive_bytes.getvalue(),
            headers={
                "X-File-Name": "bundle.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )

        assert response.status_code == 413
        assert "Import ZIP contains too many members" in response.text
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_bundle_import_rejects_zip_total_uncompressed_size_limit(tmp_path: Path) -> None:
    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("patch.orch.instrument.json", b'{"name":"Small"}')
        archive.writestr("extra.txt", b"x" * 128)

    with _client(tmp_path, bundle_import_zip_max_uncompressed_bytes=64) as client:
        response = client.post(
            "/api/bundles/import/expand",
            content=archive_bytes.getvalue(),
            headers={
                "X-File-Name": "bundle.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )

        assert response.status_code == 413
        assert "Import ZIP exceeds maximum total uncompressed size" in response.text
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_bundle_import_rejects_zip_bomb_style_oversized_audio_member(tmp_path: Path) -> None:
    stored_name = "sample.wav"
    payload = {
        "sourcePatchId": "patch-1",
        "name": "Oversized Audio",
        "description": "",
        "schema_version": 1,
        "graph": {
            "nodes": [{"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 0, "y": 0}}],
            "connections": [],
            "ui_layout": {
                "gen_nodes": {
                    "g1": {
                        "routineNumber": 1,
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": "sample.wav",
                            "stored_name": stored_name,
                            "content_type": "audio/wav",
                            "size_bytes": 128,
                        },
                    }
                }
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }
    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("patch.orch.instrument.json", json.dumps(payload).encode("utf-8"))
        archive.writestr(f"audio/{stored_name}", b"x" * 128)

    assert len(archive_bytes.getvalue()) < 1024

    with _client(
        tmp_path,
        gen_audio_asset_max_bytes=64,
        bundle_import_max_bytes=1024,
        bundle_import_zip_max_uncompressed_bytes=4096,
    ) as client:
        response = client.post(
            "/api/bundles/import/expand",
            content=archive_bytes.getvalue(),
            headers={
                "X-File-Name": "bundle.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )

        assert response.status_code == 413
        assert "Audio import payload exceeds maximum size (64 bytes)." in response.text
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_bundle_import_rejects_repeated_valid_imports_after_byte_quota(tmp_path: Path) -> None:
    first_archive = _build_gen_asset_import_archive(stored_name="first.wav", audio_bytes=b"abcdef")
    second_archive = _build_gen_asset_import_archive(stored_name="second.wav", audio_bytes=b"ghijk")

    with _client(
        tmp_path,
        gen_audio_assets_max_total_bytes=10,
        bundle_import_max_bytes=4096,
    ) as client:
        first = client.post(
            "/api/bundles/import/expand",
            content=first_archive,
            headers={
                "X-File-Name": "first.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )
        assert first.status_code == 200

        second = client.post(
            "/api/bundles/import/expand",
            content=second_archive,
            headers={
                "X-File-Name": "second.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )

        assert second.status_code == 413
        assert "generated audio asset storage quota" in second.text
        stored_files = sorted(path.name for path in (tmp_path / "gen_audio_assets").iterdir())
        assert stored_files == ["first.wav"]


def test_bundle_import_rejects_over_quota_batch_without_partial_asset_writes(tmp_path: Path) -> None:
    payload = {
        "sourcePatchId": "patch-1",
        "name": "Two Assets",
        "description": "",
        "schema_version": 1,
        "graph": {
            "nodes": [
                {"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 0, "y": 0}},
                {"id": "s1", "opcode": "sfload", "params": {}, "position": {"x": 0, "y": 0}},
            ],
            "connections": [],
            "ui_layout": {
                "gen_nodes": {
                    "g1": {
                        "routineNumber": 1,
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": "first.wav",
                            "stored_name": "first.wav",
                            "content_type": "audio/wav",
                            "size_bytes": 6,
                        },
                    }
                },
                "sfload_nodes": {
                    "s1": {
                        "sampleAsset": {
                            "asset_id": "asset-2",
                            "original_name": "second.sf2",
                            "stored_name": "second.sf2",
                            "content_type": "audio/sf2",
                            "size_bytes": 6,
                        },
                        "samplePath": "",
                    }
                },
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }
    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("two.orch.instrument.json", json.dumps(payload).encode("utf-8"))
        archive.writestr("audio/first.wav", b"abcdef")
        archive.writestr("audio/second.sf2", b"ghijkl")

    with _client(
        tmp_path,
        gen_audio_assets_max_total_bytes=10,
        bundle_import_max_bytes=4096,
    ) as client:
        response = client.post(
            "/api/bundles/import/expand",
            content=archive_bytes.getvalue(),
            headers={
                "X-File-Name": "two.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )

        assert response.status_code == 413
        assert "generated audio asset storage quota" in response.text
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_bundle_import_rejects_reserved_gen01_alias_stored_name(tmp_path: Path) -> None:
    archive_bytes = _build_gen_asset_import_archive(stored_name="soundin.1234", audio_bytes=b"abcdef")

    with _client(tmp_path, bundle_import_max_bytes=4096) as client:
        response = client.post(
            "/api/bundles/import/expand",
            content=archive_bytes,
            headers={
                "X-File-Name": "reserved.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )

        assert response.status_code == 400
        assert "Invalid stored audio asset name" in response.text
        assert list((tmp_path / "gen_audio_assets").iterdir()) == []


def test_gen_asset_gc_removes_only_unreferenced_expired_assets_and_derived_files(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    referenced = asset_dir / "referenced.wav"
    unreferenced = asset_dir / "unreferenced.wav"
    recent = asset_dir / "recent.wav"
    alias = asset_dir / "soundin.1234"
    temp = asset_dir / ".orphan.wav.import"
    referenced.write_bytes(b"ref")
    unreferenced.write_bytes(b"old")
    recent.write_bytes(b"new")
    alias.write_bytes(b"alias")
    temp.write_bytes(b"temp")
    for path in [referenced, unreferenced, alias, temp]:
        os.utime(path, (0, 0))

    service = GenAssetService(audio_dir=asset_dir, gc_min_age_seconds=60)
    removed_count = service.garbage_collect_unreferenced_assets(referenced_stored_names={"referenced.wav"})

    assert removed_count == 3
    assert referenced.exists()
    assert recent.exists()
    assert not unreferenced.exists()
    assert not alias.exists()
    assert not temp.exists()


def test_bundle_import_expand_restores_sfload_audio_asset(tmp_path: Path) -> None:
    stored_name = "piano.sf2"
    audio_bytes = b"RIFFfakeSF2"
    payload = {
        "sourcePatchId": "patch-1",
        "name": "Imported sfload Patch",
        "description": "",
        "schema_version": 1,
        "graph": {
            "nodes": [{"id": "s1", "opcode": "sfload", "params": {}, "position": {"x": 0, "y": 0}}],
            "connections": [],
            "ui_layout": {
                "sfload_nodes": {
                    "s1": {
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": "piano.sf2",
                            "stored_name": stored_name,
                            "content_type": "audio/sf2",
                            "size_bytes": len(audio_bytes),
                        },
                        "samplePath": "",
                    }
                }
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("anything.orch.instrument.json", json.dumps(payload).encode("utf-8"))
        archive.writestr(f"audio/{stored_name}", audio_bytes)

    with _client(tmp_path) as client:
        response = client.post(
            "/api/bundles/import/expand",
            content=archive_bytes.getvalue(),
            headers={
                "X-File-Name": "bundle.orch.instrument.zip",
                "Content-Type": "application/zip",
            },
        )
        assert response.status_code == 200
        parsed = response.json()
        assert parsed["name"] == "Imported sfload Patch"
        stored_path = tmp_path / "gen_audio_assets" / stored_name
        assert stored_path.exists()
        assert stored_path.read_bytes() == audio_bytes


def _build_gen_asset_import_archive(*, stored_name: str, audio_bytes: bytes) -> bytes:
    payload = {
        "sourcePatchId": "patch-1",
        "name": "Imported Patch",
        "description": "",
        "schema_version": 1,
        "graph": {
            "nodes": [{"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 0, "y": 0}}],
            "connections": [],
            "ui_layout": {
                "gen_nodes": {
                    "g1": {
                        "routineNumber": 1,
                        "sampleAsset": {
                            "asset_id": "asset-1",
                            "original_name": stored_name,
                            "stored_name": stored_name,
                            "content_type": "audio/wav",
                            "size_bytes": len(audio_bytes),
                        },
                    }
                }
            },
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }
    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("patch.orch.instrument.json", json.dumps(payload).encode("utf-8"))
        archive.writestr(f"audio/{stored_name}", audio_bytes)
    return archive_bytes.getvalue()


def test_gen01_uploaded_asset_uses_numeric_filecode_alias(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "sample.aiff"
    (asset_dir / stored_name).write_bytes(b"FORMfake")

    with _client(tmp_path) as client:
        patch_payload = {
            "name": "GEN01 Filename Workaround",
            "description": "GEN01 filename is emitted via string variable",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 40}},
                    {"id": "v1", "opcode": "vco", "params": {"amp": 0.2, "freq": 220, "iwave": 1}, "position": {"x": 280, "y": 40}},
                    {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 520, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "g1", "from_port_id": "ift", "to_node_id": "v1", "to_port_id": "ifn"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "left"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "gen_nodes": {
                        "g1": {
                            "mode": "ftgen",
                            "tableNumber": 5,
                            "startTime": 0,
                            "tableSize": 0,
                            "routineNumber": 1,
                            "normalize": True,
                            "sampleAsset": {
                                "asset_id": "asset-1",
                                "original_name": "demo.aiff",
                                "stored_name": stored_name,
                                "content_type": "audio/aiff",
                                "size_bytes": 8,
                            },
                            "sampleSkipTime": 0,
                            "sampleFormat": 0,
                            "sampleChannel": 0,
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        gen01_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgen 5, 0, 0, 1," in line)
        assert "ftgenonce" not in gen01_line
        assert '"sample.aiff"' not in gen01_line
        assert "S_g1_gen01_file" not in gen01_line
        assert gen01_line.endswith(", 0, 0, 0")

        gen_args = gen01_line.split(" ftgen ", 1)[1].split(", ")
        assert len(gen_args) == 8
        filecode = int(gen_args[4])
        alias_path = asset_dir / f"soundin.{filecode}"
        assert alias_path.exists()
        assert alias_path.samefile(asset_dir / stored_name)


@pytest.mark.parametrize(
    ("node_kind", "sample_path"),
    [
        ("gen", "absolute"),
        ("gen", "../secret.wav"),
        ("sfload", "absolute"),
        ("sfload", "../secret.sf2"),
    ],
)
def test_session_compile_rejects_raw_sample_paths(
    tmp_path: Path,
    node_kind: str,
    sample_path: str,
) -> None:
    secret_path = tmp_path / "outside-secret.bin"
    secret_bytes = b"session-raw-sample-path-secret"
    secret_path.write_bytes(secret_bytes)
    resolved_sample_path = str(secret_path) if sample_path == "absolute" else sample_path

    nodes = [
        {"id": "a1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
        {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
    ]
    connections = [
        {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "left"},
        {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "right"},
    ]
    ui_layout: dict[str, object] = {}
    if node_kind == "gen":
        nodes.extend(
            [
                {"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 120}},
                {"id": "v1", "opcode": "vco", "params": {"amp": 0.2, "freq": 220, "iwave": 1}, "position": {"x": 280, "y": 120}},
            ]
        )
        connections.append({"from_node_id": "g1", "from_port_id": "ift", "to_node_id": "v1", "to_port_id": "ifn"})
        ui_layout["gen_nodes"] = {
            "g1": {
                "mode": "ftgen",
                "tableNumber": 5,
                "startTime": 0,
                "tableSize": 16384,
                "routineNumber": 1,
                "routineName": "GEN01" if node_kind == "gen_named" else "",
                "normalize": True,
                "sampleAsset": None,
                "samplePath": resolved_sample_path,
                "sampleSkipTime": 0,
                "sampleFormat": 0,
                "sampleChannel": 0,
            }
        }
    else:
        nodes.append({"id": "s1", "opcode": "sfload", "params": {}, "position": {"x": 40, "y": 120}})
        ui_layout["sfload_nodes"] = {"s1": {"sampleAsset": None, "samplePath": resolved_sample_path}}

    patch_payload = {
        "name": "Raw samplePath compile rejection",
        "description": "raw sample paths must not reach Csound",
        "schema_version": 1,
        "graph": {
            "nodes": nodes,
            "connections": connections,
            "ui_layout": ui_layout,
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    with _client(tmp_path) as client:
        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]
        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")

    assert compile_response.status_code == 422
    diagnostics = compile_response.json()["detail"]["diagnostics"]
    assert any("uses samplePath" in item for item in diagnostics)
    assert secret_bytes not in compile_response.content
    assert str(secret_path).encode("utf-8") not in compile_response.content


def test_session_compile_rejects_sfload_legacy_filename_param(tmp_path: Path) -> None:
    secret_path = tmp_path / "legacy-secret.sf2"
    secret_bytes = b"session-legacy-filename-secret"
    secret_path.write_bytes(secret_bytes)

    patch_payload = {
        "name": "Legacy sfload filename rejection",
        "description": "raw sfload filename params must not reach Csound",
        "schema_version": 1,
        "graph": {
            "nodes": [
                {"id": "a1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                {"id": "s1", "opcode": "sfload", "params": {"filename": str(secret_path)}, "position": {"x": 40, "y": 120}},
            ],
            "connections": [
                {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "left"},
                {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "right"},
            ],
            "ui_layout": {},
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    with _client(tmp_path) as client:
        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]
        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")

    assert compile_response.status_code == 422
    diagnostics = compile_response.json()["detail"]["diagnostics"]
    assert any("raw filename parameter" in item for item in diagnostics)
    assert secret_bytes not in compile_response.content
    assert str(secret_path).encode("utf-8") not in compile_response.content


def test_session_start_rejects_raw_sample_path_before_csound_start(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_csound_starts(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("CsoundWorker.start should not be called for raw samplePath patches")

    monkeypatch.setattr("backend.app.engine.csound_worker.CsoundWorker.start", fail_if_csound_starts)
    secret_path = tmp_path / "runtime-secret.sf2"
    secret_bytes = b"runtime-raw-sample-path-secret"
    secret_path.write_bytes(secret_bytes)

    patch_payload = {
        "name": "Runtime raw samplePath rejection",
        "description": "start must fail before Csound sees raw paths",
        "schema_version": 1,
        "graph": {
            "nodes": [
                {"id": "a1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                {"id": "s1", "opcode": "sfload", "params": {}, "position": {"x": 40, "y": 120}},
            ],
            "connections": [
                {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "left"},
                {"from_node_id": "a1", "from_port_id": "aout", "to_node_id": "o1", "to_port_id": "right"},
            ],
            "ui_layout": {"sfload_nodes": {"s1": {"sampleAsset": None, "samplePath": str(secret_path)}}},
            "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
        },
    }

    with _client(tmp_path) as client:
        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]
        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201

        start_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/start")

    assert start_response.status_code == 422
    diagnostics = start_response.json()["detail"]["diagnostics"]
    assert any("uses samplePath" in item for item in diagnostics)
    assert secret_bytes not in start_response.content
    assert str(secret_path).encode("utf-8") not in start_response.content


def test_gen01_ftgenonce_mode_is_coerced_to_ftgen(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "sample.aiff"
    (asset_dir / stored_name).write_bytes(b"FORMfake")

    with _client(tmp_path) as client:
        patch_payload = {
            "name": "GEN01 ftgenonce coercion",
            "description": "GEN01 should compile as ftgen to avoid ftgenonce.iS runtime issue",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "g1", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 40}},
                    {"id": "v1", "opcode": "vco", "params": {"amp": 0.2, "freq": 220, "iwave": 1}, "position": {"x": 280, "y": 40}},
                    {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 520, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "g1", "from_port_id": "ift", "to_node_id": "v1", "to_port_id": "ifn"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "left"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "gen_nodes": {
                        "g1": {
                            "mode": "ftgenonce",
                            "tableNumber": 5,
                            "startTime": 0,
                            "tableSize": 16384,
                            "routineNumber": 1,
                            "normalize": True,
                            "sampleAsset": {
                                "asset_id": "asset-1",
                                "original_name": "demo.aiff",
                                "stored_name": stored_name,
                                "content_type": "audio/aiff",
                                "size_bytes": 8,
                            },
                            "sampleSkipTime": 0,
                            "sampleFormat": 0,
                            "sampleChannel": 0,
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        gen01_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgen 5, " in line)
        assert " ftgenonce " not in gen01_line
        assert "S_g1_gen01_file" not in gen01_line


def test_gen_meta_opcode_supports_gen08_gen11_gen17_gen20(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "GEN 8 11 17 20",
            "description": "Routine-specific GEN forms compile correctly",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "g8", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 40}},
                    {"id": "g11", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 40}},
                    {"id": "g17", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 180}},
                    {"id": "g20", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 320}},
                    {"id": "v1", "opcode": "vco", "params": {"amp": 0.2, "freq": 220, "iwave": 1}, "position": {"x": 300, "y": 40}},
                    {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 540, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "g11", "from_port_id": "ift", "to_node_id": "v1", "to_port_id": "ifn"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "left"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "gen_nodes": {
                        "g8": {
                            "mode": "ftgen",
                            "tableNumber": 8,
                            "startTime": 0,
                            "tableSize": 512,
                            "routineNumber": 8,
                            "normalize": True,
                            "segmentStartValue": 1,
                            "segments": [
                                {"length": 0.3, "value": 0.5},
                                {"length": 0.7, "value": 0.125},
                            ],
                        },
                        "g11": {
                            "mode": "ftgen",
                            "tableNumber": 11,
                            "startTime": 0,
                            "tableSize": 2048,
                            "routineNumber": 11,
                            "normalize": True,
                            "gen11HarmonicCount": 8,
                            "gen11LowestHarmonic": 2,
                            "gen11Multiplier": 0.5,
                        },
                        "g17": {
                            "mode": "ftgen",
                            "tableNumber": 17,
                            "startTime": 0,
                            "tableSize": 128,
                            "routineNumber": 17,
                            "normalize": False,
                            "gen17Pairs": [
                                {"x": 0, "y": 60},
                                {"x": 12, "y": 62},
                                {"x": 24, "y": 67},
                            ],
                        },
                        "g20": {
                            "mode": "ftgenonce",
                            "tableNumber": 20,
                            "tableSize": 1024,
                            "routineNumber": 20,
                            "normalize": True,
                            "gen20WindowType": 7,
                            "gen20Max": 1,
                            "gen20Opt": 6.8,
                        },
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        gen08_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgen 8, 0, 512, 8," in line)
        assert gen08_line.endswith("ftgen 8, 0, 512, 8, 1, 0.3, 0.5, 0.7, 0.125")

        gen11_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgen 11, 0, 2048, 11," in line)
        assert gen11_line.endswith("ftgen 11, 0, 2048, 11, 8, 2, 0.5")

        gen17_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgen 17, 0, 128, -17," in line)
        assert gen17_line.endswith("ftgen 17, 0, 128, -17, 0, 60, 12, 62, 24, 67")

        gen20_line = next(line.strip() for line in compiled_orc.splitlines() if " ftgenonce 20, 0, 1024, 20," in line)
        assert gen20_line.endswith("ftgenonce 20, 0, 1024, 20, 7, 1, 6.8")


def test_gen_meta_opcode_supports_genpadsynth_named_routine(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "GENpadsynth",
            "description": "Named padsynth GEN routine compiles correctly",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "gpad", "opcode": "GEN", "params": {}, "position": {"x": 40, "y": 40}},
                    {"id": "v1", "opcode": "vco", "params": {"amp": 0.2, "freq": 220, "iwave": 1}, "position": {"x": 300, "y": 40}},
                    {"id": "o1", "opcode": "outs", "params": {}, "position": {"x": 540, "y": 40}},
                ],
                "connections": [
                    {"from_node_id": "gpad", "from_port_id": "ift", "to_node_id": "v1", "to_port_id": "ifn"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "left"},
                    {"from_node_id": "v1", "from_port_id": "asig", "to_node_id": "o1", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "gen_nodes": {
                        "gpad": {
                            "mode": "ftgenonce",
                            "tableNumber": 21,
                            "tableSize": 262144,
                            "routineNumber": 10,
                            "routineName": "padsynth",
                            "normalize": False,
                            "rawArgsText": "261.625565, 55, 0, 1, 1, 1, 1, 0.5, 0.25",
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        padsynth_line = next(line.strip() for line in compiled_orc.splitlines() if ' ftgenonce 21, 0, 262144, "padsynth",' in line)
        assert padsynth_line.endswith('ftgenonce 21, 0, 262144, "padsynth", 261.625565, 55, 0, 1, 1, 1, 1, 0.5, 0.25')


def test_additional_opcode_references_are_available(tmp_path: Path) -> None:
    expected_urls = {
        "ampmidi": "https://csound.com/docs/manual/ampmidi.html",
        "ampmidicurve": "https://csound.com/docs/manual/ampmidicurve.html",
        "ampmidid": "https://csound.com/docs/manual/ampmidid.html",
        "lfo": "https://csound.com/docs/manual/lfo.html",
        "jitter": "https://csound.com/docs/manual/jitter.html",
        "oscil3": "https://csound.com/docs/manual/oscil3.html",
        "poscil3": "https://csound.com/docs/manual/poscil3.html",
        "vibr": "https://csound.com/docs/manual/vibr.html",
        "vibrato": "https://csound.com/docs/manual/vibrato.html",
        "vosim": "https://csound.com/docs/manual/vosim.html",
        "voice": "https://csound.com/docs/manual/voice.html",
        "fmb3": "https://csound.com/docs/manual/fmb3.html",
        "fmbell": "https://csound.com/docs/manual/fmbell.html",
        "fmmetal": "https://csound.com/docs/manual/fmmetal.html",
        "fmpercfl": "https://csound.com/docs/manual/fmpercfl.html",
        "fmrhode": "https://csound.com/docs/manual/fmrhode.html",
        "fmvoice": "https://csound.com/docs/manual/fmvoice.html",
        "fmwurlie": "https://csound.com/docs/manual/fmwurlie.html",
        "madsr": "https://csound.com/docs/manual/madsr.html",
        "mxadsr": "https://csound.com/docs/manual/mxadsr.html",
        "pinker": "https://csound.com/docs/manual/pinker.html",
        "pinkish": "https://csound.com/docs/manual/pinkish.html",
        "noise": "https://csound.com/docs/manual/noise.html",
        "random": "https://csound.com/docs/manual/random.html",
        "randomh": "https://csound.com/docs/manual/randomh.html",
        "randomi": "https://csound.com/docs/manual/randomi.html",
        "release": "https://csound.com/docs/manual/release.html",
        "pluck": "https://csound.com/docs/manual/pluck.html",
        "sekere": "https://csound.com/docs/manual/sekere.html",
        "sleighbells": "https://csound.com/docs/manual/sleighbells.html",
        "wgpluck2": "https://csound.com/docs/manual/wgpluck2.html",
        "wgflute": "https://csound.com/docs/manual/wgflute.html",
        "wgclar": "https://csound.com/docs/manual/wgclar.html",
        "wgbow": "https://csound.com/docs/manual/wgbow.html",
        "wgbowedbar": "https://csound.com/docs/manual/wgbowedbar.html",
        "wguide2": "https://csound.com/docs/manual/wguide2.html",
        "pan2": "https://csound.com/docs/manual/pan2.html",
        "delay": "https://csound.com/docs/manual/delay.html",
        "delayk": "https://csound.com/docs/manual/delayk.html",
        "delayr": "https://csound.com/docs/manual/delayr.html",
        "delayw": "https://csound.com/docs/manual/delayw.html",
        "deltap": "https://csound.com/docs/manual/deltap.html",
        "deltap3": "https://csound.com/docs/manual/deltap3.html",
        "vdelay3": "https://csound.com/docs/manual/vdelay3.html",
        "vdelayxs": "https://csound.com/docs/manual/vdelayxs.html",
        "flanger": "https://csound.com/docs/manual/flanger.html",
        "comb": "https://csound.com/docs/manual/comb.html",
        "vcomb": "https://csound.com/docs/manual/vcomb.html",
        "reverb2": "https://csound.com/docs/manual/reverb2.html",
        "platerev": "https://csound.com/docs/manual/platerev.html",
        "limit": "https://csound.com/docs/manual/limit.html",
        "dam": "https://csound.com/docs/manual/dam.html",
        "follow2": "https://csound.com/docs/manual/follow2.html",
        "exciter": "https://csound.com/docs/manual/exciter.html",
        "distort1": "https://csound.com/docs/manual/distort1.html",
        "powershape": "https://csound.com/docs/manual/powershape.html",
        "pvsanal": "https://csound.com/docs/manual/pvsanal.html",
        "pvsmorph": "https://csound.com/docs/manual/pvsmorph.html",
        "pvshift": "https://csound.com/docs/manual/pvshift.html",
        "pvsynth": "https://csound.com/docs/manual/pvsynth.html",
        "pvsosc": "https://csound.com/docs/manual/pvsosc.html",
        "pvsvoc": "https://csound.com/docs/manual/pvsvoc.html",
        "pvswarp": "https://csound.com/docs/manual/pvswarp.html",
        "pvsmooth": "https://csound.com/docs/manual/pvsmooth.html",
        "fold": "https://csound.com/docs/manual/fold.html",
        "gbuzz": "https://csound.com/docs/manual/gbuzz.html",
        "grain": "https://csound.com/docs/manual/grain.html",
        "grain2": "https://csound.com/docs/manual/grain2.html",
        "grain3": "https://csound.com/docs/manual/grain3.html",
        "granule": "https://csound.com/docs/manual/granule.html",
        "diode_ladder": "https://csound.com/docs/manual/diode_ladder.html",
        "expseg": "https://csound.com/docs/manual/expseg.html",
        "expsega": "https://csound.com/docs/manual/expsega.html",
        "expsegr": "https://csound.com/docs/manual/expsegr.html",
        "expon": "https://csound.com/docs/manual/expon.html",
        "linenr": "https://csound.com/docs/manual/linenr.html",
        "envlpxr": "https://csound.com/docs/manual/envlpxr.html",
        "transegr": "https://csound.com/docs/manual/transegr.html",
        "linseg": "https://csound.com/docs/manual/linseg.html",
        "linsegr": "https://csound.com/docs/manual/linsegr.html",
        "foscili": "https://csound.com/docs/manual/foscili.html",
        "ftgenonce": "https://csound.com/docs/manual/ftgenonce.html",
        "marimba": "https://csound.com/docs/manual/marimba.html",
        "moog": "https://csound.com/docs/manual/moog.html",
        "moogladder2": "https://csound.com/docs/manual/moogladder2.html",
        "moogvcf": "https://csound.com/docs/manual/moogvcf.html",
        "rezzy": "https://csound.com/docs/manual/rezzy.html",
        "resonx": "https://csound.com/docs/manual/resonx.html",
        "vclpf": "https://csound.com/docs/manual/vclpf.html",
        "tbvcf": "https://csound.com/docs/manual/tbvcf.html",
        "statevar": "https://csound.com/docs/manual/statevar.html",
        "skf": "https://csound.com/docs/manual/skf.html",
        "butterlp": "https://csound.com/docs/manual/butterlp.html",
        "butterbp": "https://csound.com/docs/manual/butterbp.html",
        "butterhp": "https://csound.com/docs/manual/butterhp.html",
        "butterbr": "https://csound.com/docs/manual/butterbr.html",
        "clip": "https://csound.com/docs/manual/clip.html",
        "fof": "https://csound.com/docs/manual/fof.html",
        "fof2": "https://csound.com/docs/manual/fof2.html",
        "fofilter": "https://csound.com/docs/manual/fofilter.html",
        "outletk": "https://csound.com/docs/manual/outletk.html",
        "outleta": "https://csound.com/docs/manual/outleta.html",
        "inletk": "https://csound.com/docs/manual/inletk.html",
        "inleta": "https://csound.com/docs/manual/inleta.html",
        "maxalloc": "https://csound.com/docs/manual/maxalloc.html",
        "notnum": "https://csound.com/docs/manual/notnum.html",
        "ntrpol": "https://csound.com/docs/manual/ntrpol.html",
        "rms": "https://csound.com/docs/manual/rms.html",
        "samphold": "https://csound.com/docs/manual/samphold.html",
        "portk": "https://csound.com/docs/manual/portk.html",
        "downsamp": "https://csound.com/docs/manual/downsamp.html",
        "sfload": "https://csound.com/docs/manual/sfload.html",
        "sfplay3": "https://csound.com/docs/manual/sfplay3.html",
        "sfinstr3": "https://csound.com/docs/manual/sfinstr3.html",
        "syncphasor": "https://csound.com/docs/manual/syncphasor.html",
        "upsamp": "https://csound.com/docs/manual/upsamp.html",
        "vco2": "https://csound.com/docs/manual/vco2.html",
        "vco2init": "https://csound.com/docs/manual/vco2init.html",
        "xtratim": "https://csound.com/docs/manual/xtratim.html",
        "dripwater": "https://csound.com/docs/manual/dripwater.html",
    }

    with _client(tmp_path) as client:
        response = client.get("/api/opcodes")
        assert response.status_code == 200
        opcodes_by_name = {item["name"]: item for item in response.json()}

        for opcode_name, expected_url in expected_urls.items():
            assert opcode_name in opcodes_by_name
            assert opcodes_by_name[opcode_name]["documentation_url"] == expected_url

        linseg_inputs = {item["id"]: item for item in opcodes_by_name["linseg"]["inputs"]}
        assert linseg_inputs["ia"]["required"] is True
        assert linseg_inputs["idur1"]["required"] is True
        assert linseg_inputs["ib"]["required"] is True
        assert linseg_inputs["idur2"]["required"] is False
        assert linseg_inputs["ic"]["required"] is False
        assert linseg_inputs["idur3"]["required"] is False
        assert linseg_inputs["id"]["required"] is False

        linsegr_inputs = {item["id"]: item for item in opcodes_by_name["linsegr"]["inputs"]}
        for required_port in ["ia", "idur1", "ib", "irel", "iz"]:
            assert linsegr_inputs[required_port]["required"] is True

        expsegr_inputs = {item["id"]: item for item in opcodes_by_name["expsegr"]["inputs"]}
        expsegr_outputs = {item["id"]: item for item in opcodes_by_name["expsegr"]["outputs"]}
        assert opcodes_by_name["expsegr"]["category"] == "envelope"
        for required_port in ["ia", "idur1", "ib", "irel", "iz"]:
            assert expsegr_inputs[required_port]["required"] is True
        assert expsegr_outputs["kenv"]["signal_type"] == "k"

        expon_inputs = {item["id"]: item for item in opcodes_by_name["expon"]["inputs"]}
        expon_outputs = {item["id"]: item for item in opcodes_by_name["expon"]["outputs"]}
        assert opcodes_by_name["expon"]["category"] == "envelope"
        assert list(expon_inputs.keys()) == ["ia", "idur", "ib"]
        assert expon_outputs["kenv"]["signal_type"] == "k"

        linenr_inputs = {item["id"]: item for item in opcodes_by_name["linenr"]["inputs"]}
        linenr_outputs = {item["id"]: item for item in opcodes_by_name["linenr"]["outputs"]}
        assert opcodes_by_name["linenr"]["category"] == "envelope"
        assert linenr_inputs["kamp"]["signal_type"] == "k"
        assert linenr_inputs["kamp"]["accepted_signal_types"] == ["k", "i"]
        assert linenr_inputs["iatdec"]["default"] == 0.01
        assert linenr_outputs["kenv"]["signal_type"] == "k"

        envlpxr_inputs = {item["id"]: item for item in opcodes_by_name["envlpxr"]["inputs"]}
        envlpxr_outputs = {item["id"]: item for item in opcodes_by_name["envlpxr"]["outputs"]}
        assert opcodes_by_name["envlpxr"]["category"] == "envelope"
        assert envlpxr_inputs["kamp"]["accepted_signal_types"] == ["k", "i"]
        assert envlpxr_inputs["ixmod"]["required"] is False
        assert envlpxr_inputs["irind"]["required"] is False
        assert envlpxr_outputs["kenv"]["signal_type"] == "k"

        transegr_inputs = {item["id"]: item for item in opcodes_by_name["transegr"]["inputs"]}
        transegr_outputs = {item["id"]: item for item in opcodes_by_name["transegr"]["outputs"]}
        assert opcodes_by_name["transegr"]["category"] == "envelope"
        assert list(transegr_inputs.keys()) == ["ia", "idur1", "itype1", "ib", "idur2", "itype2", "ic"]
        assert transegr_outputs["kenv"]["signal_type"] == "k"

        sfload_inputs = opcodes_by_name["sfload"]["inputs"]
        sfload_outputs = {item["id"]: item for item in opcodes_by_name["sfload"]["outputs"]}
        assert sfload_inputs == []
        assert sfload_outputs["ifilhandle"]["signal_type"] == "i"

        syncphasor_inputs = {item["id"]: item for item in opcodes_by_name["syncphasor"]["inputs"]}
        syncphasor_outputs = {item["id"]: item for item in opcodes_by_name["syncphasor"]["outputs"]}
        assert syncphasor_inputs["xcps"]["signal_type"] == "k"
        assert syncphasor_inputs["xcps"]["accepted_signal_types"] == ["a", "k", "i"]
        assert syncphasor_inputs["asyncin"]["signal_type"] == "a"
        assert syncphasor_inputs["asyncin"]["default"] == 0
        assert syncphasor_inputs["iphs"]["required"] is False
        assert syncphasor_outputs["aphase"]["signal_type"] == "a"
        assert syncphasor_outputs["asyncout"]["signal_type"] == "a"

        voice_inputs = {item["id"]: item for item in opcodes_by_name["voice"]["inputs"]}
        voice_outputs = {item["id"]: item for item in opcodes_by_name["voice"]["outputs"]}
        assert opcodes_by_name["voice"]["category"] == "oscillator"
        assert voice_inputs["kamp"]["signal_type"] == "k"
        assert voice_inputs["kfreq"]["signal_type"] == "k"
        assert voice_inputs["kform"]["default"] == 1
        assert voice_inputs["ifn"]["signal_type"] == "i"
        assert voice_inputs["ivfn"]["signal_type"] == "i"
        assert voice_outputs["asig"]["signal_type"] == "a"

        vosim_inputs = {item["id"]: item for item in opcodes_by_name["vosim"]["inputs"]}
        vosim_outputs = {item["id"]: item for item in opcodes_by_name["vosim"]["outputs"]}
        assert opcodes_by_name["vosim"]["category"] == "oscillator"
        assert vosim_inputs["kamp"]["signal_type"] == "k"
        assert vosim_inputs["kfund"]["signal_type"] == "k"
        assert vosim_inputs["ifn"]["signal_type"] == "i"
        assert vosim_inputs["iskip"]["required"] is False
        assert vosim_outputs["asig"]["signal_type"] == "a"

        moogvcf_inputs = {item["id"]: item for item in opcodes_by_name["moogvcf"]["inputs"]}
        moogvcf_outputs = {item["id"]: item for item in opcodes_by_name["moogvcf"]["outputs"]}
        assert moogvcf_inputs["xfco"]["accepted_signal_types"] == ["a", "k", "i"]
        assert moogvcf_inputs["xres"]["accepted_signal_types"] == ["a", "k", "i"]
        assert moogvcf_inputs["iscale"]["required"] is False
        assert moogvcf_inputs["iskip"]["required"] is False
        assert moogvcf_outputs["aout"]["signal_type"] == "a"

        upsamp_inputs = {item["id"]: item for item in opcodes_by_name["upsamp"]["inputs"]}
        upsamp_outputs = {item["id"]: item for item in opcodes_by_name["upsamp"]["outputs"]}
        assert upsamp_inputs["ksig"]["signal_type"] == "k"
        assert upsamp_inputs["ksig"]["accepted_signal_types"] == ["k", "i"]
        assert upsamp_outputs["aout"]["signal_type"] == "a"

        statevar_inputs = {item["id"]: item for item in opcodes_by_name["statevar"]["inputs"]}
        statevar_outputs = {item["id"]: item for item in opcodes_by_name["statevar"]["outputs"]}
        assert statevar_inputs["ain"]["signal_type"] == "a"
        assert statevar_inputs["xcf"]["accepted_signal_types"] == ["a", "k", "i"]
        assert statevar_inputs["xq"]["accepted_signal_types"] == ["a", "k", "i"]
        assert statevar_inputs["iosamps"]["required"] is False
        assert statevar_inputs["istor"]["required"] is False
        assert statevar_outputs["ahp"]["signal_type"] == "a"
        assert statevar_outputs["alp"]["signal_type"] == "a"
        assert statevar_outputs["abp"]["signal_type"] == "a"
        assert statevar_outputs["abr"]["signal_type"] == "a"

        skf_inputs = {item["id"]: item for item in opcodes_by_name["skf"]["inputs"]}
        skf_outputs = {item["id"]: item for item in opcodes_by_name["skf"]["outputs"]}
        assert skf_inputs["asig"]["signal_type"] == "a"
        assert skf_inputs["xcf"]["accepted_signal_types"] == ["a", "k", "i"]
        assert skf_inputs["xk"]["accepted_signal_types"] == ["a", "k", "i"]
        assert skf_inputs["ihp"]["required"] is False
        assert skf_inputs["istor"]["required"] is False
        assert skf_outputs["aout"]["signal_type"] == "a"

        platerev_inputs = {item["id"]: item for item in opcodes_by_name["platerev"]["inputs"]}
        platerev_outputs = {item["id"]: item for item in opcodes_by_name["platerev"]["outputs"]}
        assert opcodes_by_name["platerev"]["category"] == "reverb"
        assert platerev_inputs["itabexcite"]["signal_type"] == "i"
        assert platerev_inputs["itabouts"]["signal_type"] == "i"
        assert platerev_inputs["kbndry"]["signal_type"] == "k"
        assert platerev_inputs["aexcite1"]["signal_type"] == "a"
        assert platerev_inputs["aexcite2"]["required"] is False
        assert platerev_outputs["aleft"]["signal_type"] == "a"
        assert platerev_outputs["aright"]["signal_type"] == "a"

        reverb2_inputs = {item["id"]: item for item in opcodes_by_name["reverb2"]["inputs"]}
        assert "israte" not in reverb2_inputs
        assert reverb2_inputs["iskip"]["required"] is False

        downsamp_inputs = {item["id"]: item for item in opcodes_by_name["downsamp"]["inputs"]}
        downsamp_outputs = {item["id"]: item for item in opcodes_by_name["downsamp"]["outputs"]}
        assert downsamp_inputs["asig"]["signal_type"] == "a"
        assert downsamp_inputs["iwlen"]["required"] is False
        assert downsamp_outputs["kout"]["signal_type"] == "k"

        portk_inputs = {item["id"]: item for item in opcodes_by_name["portk"]["inputs"]}
        portk_outputs = {item["id"]: item for item in opcodes_by_name["portk"]["outputs"]}
        assert opcodes_by_name["portk"]["category"] == "modulation"
        assert portk_inputs["ksig"]["signal_type"] == "k"
        assert portk_inputs["ksig"]["accepted_signal_types"] == ["k", "i"]
        assert portk_inputs["khtim"]["default"] == 0.05
        assert portk_inputs["isig"]["required"] is False
        assert portk_outputs["kout"]["signal_type"] == "k"

        jitter_inputs = {item["id"]: item for item in opcodes_by_name["jitter"]["inputs"]}
        jitter_outputs = {item["id"]: item for item in opcodes_by_name["jitter"]["outputs"]}
        assert opcodes_by_name["jitter"]["category"] == "modulation"
        assert jitter_inputs["kamp"]["accepted_signal_types"] == ["k", "i"]
        assert jitter_inputs["kcpsmin"]["accepted_signal_types"] == ["k", "i"]
        assert jitter_inputs["kcpsmax"]["accepted_signal_types"] == ["k", "i"]
        assert jitter_outputs["kout"]["signal_type"] == "k"

        random_inputs = {item["id"]: item for item in opcodes_by_name["random"]["inputs"]}
        random_outputs = {item["id"]: item for item in opcodes_by_name["random"]["outputs"]}
        assert opcodes_by_name["random"]["category"] == "modulation"
        assert random_inputs["kmin"]["accepted_signal_types"] == ["k", "i"]
        assert random_inputs["kmax"]["accepted_signal_types"] == ["k", "i"]
        assert random_outputs["kout"]["signal_type"] == "k"

        randomh_inputs = {item["id"]: item for item in opcodes_by_name["randomh"]["inputs"]}
        randomh_outputs = {item["id"]: item for item in opcodes_by_name["randomh"]["outputs"]}
        assert opcodes_by_name["randomh"]["category"] == "modulation"
        assert randomh_inputs["kmin"]["accepted_signal_types"] == ["k", "i"]
        assert randomh_inputs["kmax"]["accepted_signal_types"] == ["k", "i"]
        assert randomh_inputs["kcps"]["accepted_signal_types"] == ["k", "i"]
        assert randomh_inputs["imode"]["required"] is False
        assert randomh_inputs["ifirstval"]["required"] is False
        assert randomh_outputs["kout"]["signal_type"] == "k"

        randomi_inputs = {item["id"]: item for item in opcodes_by_name["randomi"]["inputs"]}
        randomi_outputs = {item["id"]: item for item in opcodes_by_name["randomi"]["outputs"]}
        assert opcodes_by_name["randomi"]["category"] == "modulation"
        assert randomi_inputs["kmin"]["accepted_signal_types"] == ["k", "i"]
        assert randomi_inputs["kmax"]["accepted_signal_types"] == ["k", "i"]
        assert randomi_inputs["kcps"]["accepted_signal_types"] == ["k", "i"]
        assert randomi_inputs["imode"]["required"] is False
        assert randomi_inputs["ifirstval"]["required"] is False
        assert randomi_outputs["kout"]["signal_type"] == "k"

        release_inputs = opcodes_by_name["release"]["inputs"]
        release_outputs = {item["id"]: item for item in opcodes_by_name["release"]["outputs"]}
        assert opcodes_by_name["release"]["category"] == "modulation"
        assert release_inputs == []
        assert release_outputs["krel"]["signal_type"] == "k"

        resonx_inputs = {item["id"]: item for item in opcodes_by_name["resonx"]["inputs"]}
        resonx_outputs = {item["id"]: item for item in opcodes_by_name["resonx"]["outputs"]}
        assert opcodes_by_name["resonx"]["category"] == "filter"
        assert resonx_inputs["asig"]["signal_type"] == "a"
        assert resonx_inputs["xcf"]["accepted_signal_types"] == ["a", "k", "i"]
        assert resonx_inputs["xbw"]["accepted_signal_types"] == ["a", "k", "i"]
        assert resonx_inputs["inumlayer"]["required"] is False
        assert resonx_inputs["iscl"]["required"] is False
        assert resonx_inputs["iskip"]["required"] is False
        assert resonx_outputs["aout"]["signal_type"] == "a"

        vco2init_inputs = {item["id"]: item for item in opcodes_by_name["vco2init"]["inputs"]}
        vco2init_outputs = {item["id"]: item for item in opcodes_by_name["vco2init"]["outputs"]}
        assert opcodes_by_name["vco2init"]["category"] == "tables"
        assert vco2init_inputs["iwave"]["signal_type"] == "i"
        assert vco2init_inputs["ibasfn"]["required"] is False
        assert vco2init_inputs["ipmul"]["default"] == 1.05
        assert vco2init_inputs["isrcft"]["required"] is False
        assert vco2init_outputs["ifn"]["signal_type"] == "i"

        vcomb_inputs = {item["id"]: item for item in opcodes_by_name["vcomb"]["inputs"]}
        vcomb_outputs = {item["id"]: item for item in opcodes_by_name["vcomb"]["outputs"]}
        assert opcodes_by_name["vcomb"]["category"] == "delay"
        assert vcomb_inputs["asig"]["signal_type"] == "a"
        assert vcomb_inputs["xlpt"]["accepted_signal_types"] == ["a", "k", "i"]
        assert vcomb_inputs["iskip"]["required"] is False
        assert vcomb_inputs["insmps"]["required"] is False
        assert vcomb_outputs["aout"]["signal_type"] == "a"

        vdelayxs_inputs = {item["id"]: item for item in opcodes_by_name["vdelayxs"]["inputs"]}
        vdelayxs_outputs = {item["id"]: item for item in opcodes_by_name["vdelayxs"]["outputs"]}
        assert opcodes_by_name["vdelayxs"]["category"] == "delay"
        assert vdelayxs_inputs["asig"]["signal_type"] == "a"
        assert vdelayxs_inputs["asig2"]["signal_type"] == "a"
        assert vdelayxs_inputs["asig2"]["default"] == 0
        assert vdelayxs_inputs["adl"]["signal_type"] == "a"
        assert vdelayxs_inputs["adl"]["accepted_signal_types"] == ["a", "k", "i"]
        assert vdelayxs_inputs["imaxdel"]["signal_type"] == "i"
        assert vdelayxs_inputs["iws"]["signal_type"] == "i"
        assert vdelayxs_inputs["ist"]["required"] is False
        assert list(vdelayxs_outputs.keys()) == ["aout", "aout2"]
        assert vdelayxs_outputs["aout"]["signal_type"] == "a"
        assert vdelayxs_outputs["aout2"]["signal_type"] == "a"

        maxalloc_inputs = {item["id"]: item for item in opcodes_by_name["maxalloc"]["inputs"]}
        assert opcodes_by_name["maxalloc"]["category"] == "utility"
        assert list(maxalloc_inputs.keys()) == ["icount"]
        assert maxalloc_inputs["icount"]["signal_type"] == "i"
        assert maxalloc_inputs["icount"]["default"] == 8
        assert opcodes_by_name["maxalloc"]["outputs"] == []

        xtratim_inputs = {item["id"]: item for item in opcodes_by_name["xtratim"]["inputs"]}
        assert opcodes_by_name["xtratim"]["category"] == "utility"
        assert list(xtratim_inputs.keys()) == ["iextradur"]
        assert xtratim_inputs["iextradur"]["signal_type"] == "i"
        assert xtratim_inputs["iextradur"]["default"] == 0.2
        assert opcodes_by_name["xtratim"]["outputs"] == []

        wgpluck2_inputs = {item["id"]: item for item in opcodes_by_name["wgpluck2"]["inputs"]}
        wgpluck2_outputs = {item["id"]: item for item in opcodes_by_name["wgpluck2"]["outputs"]}
        assert opcodes_by_name["wgpluck2"]["category"] == "physical_modeling"
        assert wgpluck2_inputs["iplk"]["signal_type"] == "i"
        assert wgpluck2_inputs["kamp"]["signal_type"] == "k"
        assert wgpluck2_inputs["icps"]["signal_type"] == "i"
        assert wgpluck2_outputs["asig"]["signal_type"] == "a"

        sekere_inputs = {item["id"]: item for item in opcodes_by_name["sekere"]["inputs"]}
        sekere_outputs = {item["id"]: item for item in opcodes_by_name["sekere"]["outputs"]}
        assert opcodes_by_name["sekere"]["category"] == "physical_modeling"
        assert sekere_inputs["iamp"]["signal_type"] == "i"
        assert sekere_inputs["idettack"]["signal_type"] == "i"
        assert sekere_inputs["inum"]["required"] is False
        assert sekere_inputs["idamp"]["required"] is False
        assert sekere_inputs["imaxshake"]["required"] is False
        assert sekere_outputs["asig"]["signal_type"] == "a"

        sleighbells_inputs = {item["id"]: item for item in opcodes_by_name["sleighbells"]["inputs"]}
        sleighbells_outputs = {item["id"]: item for item in opcodes_by_name["sleighbells"]["outputs"]}
        assert opcodes_by_name["sleighbells"]["category"] == "physical_modeling"
        assert sleighbells_inputs["kamp"]["signal_type"] == "k"
        assert sleighbells_inputs["kamp"]["accepted_signal_types"] == ["k", "i"]
        assert sleighbells_inputs["idettack"]["signal_type"] == "i"
        assert sleighbells_inputs["inum"]["required"] is False
        assert sleighbells_inputs["idamp"]["required"] is False
        assert sleighbells_inputs["imaxshake"]["required"] is False
        assert sleighbells_inputs["ifreq"]["required"] is False
        assert sleighbells_inputs["ifreq1"]["required"] is False
        assert sleighbells_inputs["ifreq2"]["required"] is False
        assert sleighbells_outputs["asig"]["signal_type"] == "a"

        wgclar_inputs = {item["id"]: item for item in opcodes_by_name["wgclar"]["inputs"]}
        assert wgclar_inputs["kfreq"]["accepted_signal_types"] == ["a", "k", "i"]
        assert wgclar_inputs["iminfreq"]["required"] is False

        wgbow_inputs = {item["id"]: item for item in opcodes_by_name["wgbow"]["inputs"]}
        assert wgbow_inputs["kfreq"]["accepted_signal_types"] == ["a", "k", "i"]
        assert wgbow_inputs["ifn"]["required"] is False
        assert wgbow_inputs["iminfreq"]["required"] is False

        wgbowedbar_inputs = {item["id"]: item for item in opcodes_by_name["wgbowedbar"]["inputs"]}
        assert wgbowedbar_inputs["kfreq"]["accepted_signal_types"] == ["a", "k", "i"]
        assert wgbowedbar_inputs["const"]["required"] is False
        assert wgbowedbar_inputs["itvel"]["required"] is False
        assert wgbowedbar_inputs["ibowpos"]["required"] is False
        assert wgbowedbar_inputs["ilow"]["required"] is False

        oscil3_inputs = {item["id"]: item for item in opcodes_by_name["oscil3"]["inputs"]}
        oscil3_outputs = {item["id"]: item for item in opcodes_by_name["oscil3"]["outputs"]}
        assert opcodes_by_name["oscil3"]["category"] == "oscillator"
        assert oscil3_inputs["amp"]["accepted_signal_types"] == ["a", "k", "i"]
        assert oscil3_inputs["freq"]["accepted_signal_types"] == ["a", "k", "i"]
        assert oscil3_inputs["ifn"]["required"] is False
        assert oscil3_inputs["ifn"]["default"] == -1
        assert oscil3_inputs["iphs"]["required"] is False
        assert oscil3_outputs["asig"]["signal_type"] == "a"

        grain_inputs = {item["id"]: item for item in opcodes_by_name["grain"]["inputs"]}
        grain_outputs = {item["id"]: item for item in opcodes_by_name["grain"]["outputs"]}
        assert opcodes_by_name["grain"]["category"] == "oscillator"
        assert grain_inputs["xamp"]["accepted_signal_types"] == ["a", "k", "i"]
        assert grain_inputs["xpitch"]["accepted_signal_types"] == ["a", "k", "i"]
        assert grain_inputs["xdens"]["accepted_signal_types"] == ["a", "k", "i"]
        assert grain_inputs["i_max_grains"]["required"] is False
        assert grain_outputs["asig"]["signal_type"] == "a"

        grain2_inputs = {item["id"]: item for item in opcodes_by_name["grain2"]["inputs"]}
        grain2_outputs = {item["id"]: item for item in opcodes_by_name["grain2"]["outputs"]}
        assert opcodes_by_name["grain2"]["category"] == "oscillator"
        assert list(grain2_inputs.keys()) == [
            "kcps",
            "kfmd",
            "kgdur",
            "iovrlp",
            "kfn",
            "iwfn",
            "irpow",
            "iseed",
            "imode",
        ]
        assert grain2_inputs["kcps"]["accepted_signal_types"] == ["k", "i"]
        assert grain2_inputs["kcps"]["default"] == 220
        assert grain2_inputs["kfmd"]["accepted_signal_types"] == ["k", "i"]
        assert grain2_inputs["kgdur"]["accepted_signal_types"] == ["k", "i"]
        assert grain2_inputs["kfn"]["accepted_signal_types"] == ["k", "i"]
        assert grain2_inputs["irpow"]["default"] == 0
        assert grain2_inputs["irpow"]["required"] is False
        assert grain2_inputs["iseed"]["required"] is False
        assert grain2_inputs["imode"]["required"] is False
        assert grain2_outputs["asig"]["signal_type"] == "a"

        grain3_inputs = {item["id"]: item for item in opcodes_by_name["grain3"]["inputs"]}
        grain3_outputs = {item["id"]: item for item in opcodes_by_name["grain3"]["outputs"]}
        assert opcodes_by_name["grain3"]["category"] == "oscillator"
        assert list(grain3_inputs.keys()) == [
            "kcps",
            "kphs",
            "kfmd",
            "kpmd",
            "kgdur",
            "kdens",
            "imaxovr",
            "kfn",
            "iwfn",
            "kfrpow",
            "kprpow",
            "iseed",
            "imode",
        ]
        assert grain3_inputs["kcps"]["accepted_signal_types"] == ["k", "i"]
        assert grain3_inputs["kphs"]["accepted_signal_types"] == ["k", "i"]
        assert grain3_inputs["kfn"]["accepted_signal_types"] == ["k", "i"]
        assert grain3_inputs["kfrpow"]["accepted_signal_types"] == ["k", "i"]
        assert grain3_inputs["kprpow"]["accepted_signal_types"] == ["k", "i"]
        assert grain3_inputs["iseed"]["required"] is False
        assert grain3_inputs["imode"]["required"] is False
        assert grain3_outputs["asig"]["signal_type"] == "a"

        granule_inputs = {item["id"]: item for item in opcodes_by_name["granule"]["inputs"]}
        granule_outputs = {item["id"]: item for item in opcodes_by_name["granule"]["outputs"]}
        assert opcodes_by_name["granule"]["category"] == "oscillator"
        assert granule_inputs["xamp"]["accepted_signal_types"] == ["a", "k", "i"]
        assert granule_inputs["kgap"]["accepted_signal_types"] == ["k", "i"]
        assert granule_inputs["kgsize"]["accepted_signal_types"] == ["k", "i"]
        assert granule_inputs["ifnenv"]["required"] is False
        assert granule_outputs["asig"]["signal_type"] == "a"

        follow2_inputs = {item["id"]: item for item in opcodes_by_name["follow2"]["inputs"]}
        follow2_outputs = {item["id"]: item for item in opcodes_by_name["follow2"]["outputs"]}
        assert opcodes_by_name["follow2"]["category"] == "analysis"
        assert follow2_inputs["asig"]["signal_type"] == "a"
        assert follow2_inputs["katt"]["accepted_signal_types"] == ["k", "i"]
        assert follow2_inputs["krel"]["accepted_signal_types"] == ["k", "i"]
        assert follow2_outputs["aout"]["signal_type"] == "a"

        pinkish_inputs = {item["id"]: item for item in opcodes_by_name["pinkish"]["inputs"]}
        pinkish_outputs = {item["id"]: item for item in opcodes_by_name["pinkish"]["outputs"]}
        assert opcodes_by_name["pinkish"]["category"] == "noise"
        assert pinkish_inputs["xin"]["signal_type"] == "a"
        assert pinkish_inputs["imethod"]["required"] is False
        assert pinkish_outputs["aout"]["signal_type"] == "a"

        powershape_inputs = {item["id"]: item for item in opcodes_by_name["powershape"]["inputs"]}
        powershape_outputs = {item["id"]: item for item in opcodes_by_name["powershape"]["outputs"]}
        assert opcodes_by_name["powershape"]["category"] == "distortion"
        assert powershape_inputs["ain"]["signal_type"] == "a"
        assert powershape_inputs["kshapeamount"]["accepted_signal_types"] == ["k", "i"]
        assert powershape_inputs["ifullscale"]["required"] is False
        assert powershape_outputs["aout"]["signal_type"] == "a"

        pvsanal_inputs = {item["id"]: item for item in opcodes_by_name["pvsanal"]["inputs"]}
        pvsanal_outputs = {item["id"]: item for item in opcodes_by_name["pvsanal"]["outputs"]}
        assert opcodes_by_name["pvsanal"]["category"] == "spectral"
        assert pvsanal_inputs["ain"]["signal_type"] == "a"
        assert pvsanal_inputs["iformat"]["required"] is False
        assert pvsanal_inputs["iinit"]["required"] is False
        assert pvsanal_outputs["fsig"]["signal_type"] == "f"

        pvsynth_inputs = {item["id"]: item for item in opcodes_by_name["pvsynth"]["inputs"]}
        pvsynth_outputs = {item["id"]: item for item in opcodes_by_name["pvsynth"]["outputs"]}
        assert opcodes_by_name["pvsynth"]["category"] == "spectral"
        assert pvsynth_inputs["fsrc"]["signal_type"] == "f"
        assert pvsynth_inputs["iinit"]["required"] is False
        assert pvsynth_outputs["aout"]["signal_type"] == "a"

        pvsmorph_inputs = {item["id"]: item for item in opcodes_by_name["pvsmorph"]["inputs"]}
        pvsmorph_outputs = {item["id"]: item for item in opcodes_by_name["pvsmorph"]["outputs"]}
        assert pvsmorph_inputs["fsig1"]["signal_type"] == "f"
        assert pvsmorph_inputs["fsig2"]["signal_type"] == "f"
        assert pvsmorph_inputs["kampint"]["accepted_signal_types"] == ["k", "i"]
        assert pvsmorph_inputs["kfrqint"]["accepted_signal_types"] == ["k", "i"]
        assert pvsmorph_outputs["fsig"]["signal_type"] == "f"

        pvshift_inputs = {item["id"]: item for item in opcodes_by_name["pvshift"]["inputs"]}
        pvshift_outputs = {item["id"]: item for item in opcodes_by_name["pvshift"]["outputs"]}
        assert pvshift_inputs["fsigin"]["signal_type"] == "f"
        assert pvshift_inputs["kkeepform"]["required"] is False
        assert pvshift_inputs["kgain"]["required"] is False
        assert pvshift_inputs["kcoefs"]["required"] is False
        assert pvshift_outputs["fsig"]["signal_type"] == "f"

        pvsosc_inputs = {item["id"]: item for item in opcodes_by_name["pvsosc"]["inputs"]}
        pvsosc_outputs = {item["id"]: item for item in opcodes_by_name["pvsosc"]["outputs"]}
        assert pvsosc_inputs["kamp"]["accepted_signal_types"] == ["k", "i"]
        assert pvsosc_inputs["kfreq"]["accepted_signal_types"] == ["k", "i"]
        assert pvsosc_inputs["ioverlap"]["required"] is False
        assert pvsosc_outputs["fsig"]["signal_type"] == "f"

        pvsvoc_inputs = {item["id"]: item for item in opcodes_by_name["pvsvoc"]["inputs"]}
        pvsvoc_outputs = {item["id"]: item for item in opcodes_by_name["pvsvoc"]["outputs"]}
        assert pvsvoc_inputs["famp"]["signal_type"] == "f"
        assert pvsvoc_inputs["fexc"]["signal_type"] == "f"
        assert pvsvoc_inputs["kcoefs"]["required"] is False
        assert pvsvoc_outputs["fsig"]["signal_type"] == "f"

        pvswarp_inputs = {item["id"]: item for item in opcodes_by_name["pvswarp"]["inputs"]}
        pvswarp_outputs = {item["id"]: item for item in opcodes_by_name["pvswarp"]["outputs"]}
        assert pvswarp_inputs["fsigin"]["signal_type"] == "f"
        assert pvswarp_inputs["klowest"]["required"] is False
        assert pvswarp_inputs["kmeth"]["required"] is False
        assert pvswarp_inputs["kgain"]["required"] is False
        assert pvswarp_inputs["kcoefs"]["required"] is False
        assert pvswarp_outputs["fsig"]["signal_type"] == "f"

        pvsmooth_inputs = {item["id"]: item for item in opcodes_by_name["pvsmooth"]["inputs"]}
        pvsmooth_outputs = {item["id"]: item for item in opcodes_by_name["pvsmooth"]["outputs"]}
        assert pvsmooth_inputs["fsigin"]["signal_type"] == "f"
        assert pvsmooth_inputs["kacf"]["accepted_signal_types"] == ["k", "i"]
        assert pvsmooth_inputs["kfcf"]["accepted_signal_types"] == ["k", "i"]
        assert pvsmooth_outputs["fsig"]["signal_type"] == "f"


def test_compile_supports_additional_opcodes(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Additional Opcodes",
            "description": "compile coverage for expanded opcode set",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "poscil3", "params": {"amp": 0.2, "freq": 220}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                    {"id": "n3", "opcode": "lfo", "params": {"kamp": 0.4, "kcps": 3}, "position": {"x": 20, "y": 120}},
                    {"id": "n4", "opcode": "vibr", "params": {"amp": 0.01, "cps": 5, "ifn": 1}, "position": {"x": 20, "y": 170}},
                    {"id": "n5", "opcode": "vibrato", "params": {}, "position": {"x": 20, "y": 220}},
                    {"id": "n6", "opcode": "fmb3", "params": {}, "position": {"x": 20, "y": 270}},
                    {"id": "n7", "opcode": "fmbell", "params": {}, "position": {"x": 20, "y": 320}},
                    {"id": "n8", "opcode": "fmmetal", "params": {}, "position": {"x": 20, "y": 370}},
                    {"id": "n9", "opcode": "fmpercfl", "params": {}, "position": {"x": 20, "y": 420}},
                    {"id": "n10", "opcode": "fmrhode", "params": {}, "position": {"x": 20, "y": 470}},
                    {"id": "n11", "opcode": "fmvoice", "params": {}, "position": {"x": 20, "y": 520}},
                    {"id": "n12", "opcode": "fmwurlie", "params": {}, "position": {"x": 20, "y": 570}},
                    {"id": "n13", "opcode": "madsr", "params": {}, "position": {"x": 20, "y": 620}},
                    {"id": "n14", "opcode": "mxadsr", "params": {}, "position": {"x": 20, "y": 670}},
                    {"id": "n15", "opcode": "pinker", "params": {}, "position": {"x": 20, "y": 720}},
                    {"id": "n16", "opcode": "noise", "params": {}, "position": {"x": 20, "y": 770}},
                    {"id": "n17", "opcode": "pluck", "params": {}, "position": {"x": 20, "y": 820}},
                    {"id": "n18", "opcode": "wgflute", "params": {}, "position": {"x": 20, "y": 870}},
                    {"id": "n19", "opcode": "wguide2", "params": {"asig": 0}, "position": {"x": 20, "y": 920}},
                    {"id": "n20", "opcode": "pan2", "params": {"asig": 0}, "position": {"x": 20, "y": 970}},
                    {"id": "n21", "opcode": "vdelay3", "params": {"asig": 0}, "position": {"x": 20, "y": 1020}},
                    {"id": "n22", "opcode": "flanger", "params": {"asig": 0}, "position": {"x": 20, "y": 1070}},
                    {"id": "n23", "opcode": "comb", "params": {"asig": 0}, "position": {"x": 20, "y": 1120}},
                    {"id": "n24", "opcode": "reverb2", "params": {"asig": 0}, "position": {"x": 20, "y": 1170}},
                    {"id": "n25", "opcode": "limit", "params": {"xin": 0}, "position": {"x": 20, "y": 1220}},
                    {"id": "n26", "opcode": "exciter", "params": {"asig": 0}, "position": {"x": 20, "y": 1270}},
                    {"id": "n27", "opcode": "delay", "params": {"asig": 0}, "position": {"x": 20, "y": 1320}},
                    {"id": "n28", "opcode": "delayk", "params": {"ksig": 0}, "position": {"x": 20, "y": 1370}},
                    {"id": "n29", "opcode": "delayr", "params": {}, "position": {"x": 20, "y": 1420}},
                    {"id": "n30", "opcode": "delayw", "params": {"asig": 0}, "position": {"x": 20, "y": 1470}},
                    {"id": "n31", "opcode": "deltap", "params": {}, "position": {"x": 20, "y": 1520}},
                    {"id": "n32", "opcode": "deltap3", "params": {}, "position": {"x": 20, "y": 1570}},
                    {"id": "n33", "opcode": "diode_ladder", "params": {"ain": 0}, "position": {"x": 20, "y": 1620}},
                    {"id": "n34", "opcode": "distort1", "params": {"asig": 0}, "position": {"x": 20, "y": 1670}},
                    {"id": "n35", "opcode": "dripwater", "params": {}, "position": {"x": 20, "y": 1720}},
                    {"id": "n36", "opcode": "foscili", "params": {}, "position": {"x": 20, "y": 1770}},
                    {"id": "n37", "opcode": "ftgenonce", "params": {}, "position": {"x": 20, "y": 1820}},
                    {"id": "n38", "opcode": "marimba", "params": {}, "position": {"x": 20, "y": 1870}},
                    {"id": "n39", "opcode": "moogladder2", "params": {"ain": 0}, "position": {"x": 20, "y": 1920}},
                    {"id": "n40", "opcode": "rezzy", "params": {"ain": 0}, "position": {"x": 20, "y": 1970}},
                    {"id": "n41", "opcode": "vdelayxs", "params": {"asig": 0}, "position": {"x": 20, "y": 2020}},
                    {"id": "n42", "opcode": "vclpf", "params": {"ain": 0}, "position": {"x": 20, "y": 2070}},
                    {"id": "n43", "opcode": "vco2", "params": {}, "position": {"x": 20, "y": 2120}},
                    {"id": "n44", "opcode": "dam", "params": {"ain": 0}, "position": {"x": 20, "y": 2170}},
                    {"id": "n45", "opcode": "gbuzz", "params": {}, "position": {"x": 20, "y": 2220}},
                    {"id": "n46", "opcode": "expseg", "params": {}, "position": {"x": 20, "y": 2270}},
                    {"id": "n47", "opcode": "expsega", "params": {}, "position": {"x": 20, "y": 2320}},
                    {"id": "n48", "opcode": "linseg", "params": {}, "position": {"x": 20, "y": 2370}},
                    {"id": "n49", "opcode": "linsegr", "params": {}, "position": {"x": 20, "y": 2420}},
                    {"id": "n49a", "opcode": "expon", "params": {}, "position": {"x": 20, "y": 2445}},
                    {"id": "n49b", "opcode": "expsegr", "params": {}, "position": {"x": 20, "y": 2470}},
                    {"id": "n49c", "opcode": "linenr", "params": {}, "position": {"x": 20, "y": 2495}},
                    {"id": "n49d", "opcode": "envlpxr", "params": {}, "position": {"x": 20, "y": 2520}},
                    {"id": "n49e", "opcode": "transegr", "params": {}, "position": {"x": 20, "y": 2545}},
                    {"id": "n50", "opcode": "butterlp", "params": {"asig": 0}, "position": {"x": 20, "y": 2470}},
                    {"id": "n51", "opcode": "butterbp", "params": {"asig": 0}, "position": {"x": 20, "y": 2520}},
                    {"id": "n52", "opcode": "butterhp", "params": {"asig": 0}, "position": {"x": 20, "y": 2570}},
                    {"id": "n53", "opcode": "butterbr", "params": {"asig": 0}, "position": {"x": 20, "y": 2620}},
                    {"id": "n54", "opcode": "tbvcf", "params": {"asig": 0}, "position": {"x": 20, "y": 2670}},
                    {"id": "n55", "opcode": "clip", "params": {"asig": 0}, "position": {"x": 20, "y": 2720}},
                    {"id": "n56", "opcode": "fof", "params": {}, "position": {"x": 20, "y": 2770}},
                    {"id": "n57", "opcode": "fof2", "params": {}, "position": {"x": 20, "y": 2820}},
                    {"id": "n58", "opcode": "fofilter", "params": {"ain": 0}, "position": {"x": 20, "y": 2870}},
                    {"id": "n58b", "opcode": "voice", "params": {}, "position": {"x": 20, "y": 2895}},
                    {"id": "n59", "opcode": "inletk", "params": {"sname": "k_bus"}, "position": {"x": 20, "y": 2920}},
                    {"id": "n60", "opcode": "inleta", "params": {"sname": "a_bus"}, "position": {"x": 20, "y": 2970}},
                    {
                        "id": "n61",
                        "opcode": "outletk",
                        "params": {"sname": "k_bus", "ksignal": 0},
                        "position": {"x": 20, "y": 3020},
                    },
                    {
                        "id": "n62",
                        "opcode": "outleta",
                        "params": {"sname": "a_bus", "asignal": 0},
                        "position": {"x": 20, "y": 3070},
                    },
                    {"id": "n63", "opcode": "rms", "params": {"asig": 0}, "position": {"x": 20, "y": 3120}},
                    {"id": "n64", "opcode": "samphold", "params": {}, "position": {"x": 20, "y": 3170}},
                    {
                        "id": "n65",
                        "opcode": "sfload",
                        "params": {},
                        "position": {"x": 20, "y": 3220},
                    },
                    {"id": "n66", "opcode": "sfplay3", "params": {"ipreindex": 0}, "position": {"x": 20, "y": 3270}},
                    {
                        "id": "n67",
                        "opcode": "sfinstr3",
                        "params": {"ifilhandle": 1, "instrnum": 0},
                        "position": {"x": 20, "y": 3320},
                    },
                    {"id": "n68", "opcode": "ampmidi", "params": {}, "position": {"x": 20, "y": 3370}},
                    {"id": "n69", "opcode": "ampmidicurve", "params": {}, "position": {"x": 20, "y": 3420}},
                    {"id": "n70", "opcode": "ampmidid", "params": {}, "position": {"x": 20, "y": 3470}},
                    {"id": "n71", "opcode": "notnum", "params": {}, "position": {"x": 20, "y": 3520}},
                    {
                        "id": "n72",
                        "opcode": "ntrpol",
                        "params": {"asig1": 0, "asig2": 0},
                        "position": {"x": 20, "y": 3570},
                    },
                    {"id": "n73", "opcode": "moog", "params": {}, "position": {"x": 20, "y": 3620}},
                    {"id": "n74", "opcode": "moogvcf", "params": {"asig": 0}, "position": {"x": 20, "y": 3670}},
                    {"id": "n75", "opcode": "upsamp", "params": {"ksig": 0}, "position": {"x": 20, "y": 3720}},
                    {"id": "n76", "opcode": "downsamp", "params": {"asig": 0}, "position": {"x": 20, "y": 3770}},
                    {"id": "n77", "opcode": "fold", "params": {"asig": 0}, "position": {"x": 20, "y": 3820}},
                    {"id": "n78", "opcode": "statevar", "params": {"ain": 0}, "position": {"x": 20, "y": 3870}},
                    {"id": "n79", "opcode": "skf", "params": {"asig": 0}, "position": {"x": 20, "y": 3920}},
                    {
                        "id": "n80",
                        "opcode": "platerev",
                        "params": {"itabexcite": 1, "itabouts": 1, "aexcite1": 0},
                        "position": {"x": 20, "y": 3970},
                    },
                    {"id": "n81", "opcode": "wgclar", "params": {}, "position": {"x": 20, "y": 4020}},
                    {"id": "n82", "opcode": "wgbow", "params": {}, "position": {"x": 20, "y": 4070}},
                    {"id": "n83", "opcode": "wgbowedbar", "params": {}, "position": {"x": 20, "y": 4120}},
                    {"id": "n84", "opcode": "wgpluck2", "params": {}, "position": {"x": 20, "y": 4170}},
                    {"id": "n85", "opcode": "portk", "params": {"ksig": 0, "khtim": 0.05}, "position": {"x": 20, "y": 4220}},
                    {"id": "n86", "opcode": "vosim", "params": {}, "position": {"x": 20, "y": 4270}},
                    {"id": "n87", "opcode": "vco2init", "params": {}, "position": {"x": 20, "y": 4320}},
                    {"id": "n88", "opcode": "vcomb", "params": {"asig": 0}, "position": {"x": 20, "y": 4370}},
                    {"id": "n89", "opcode": "maxalloc", "params": {"icount": 8}, "position": {"x": 20, "y": 4420}},
                    {"id": "n89a", "opcode": "xtratim", "params": {}, "position": {"x": 20, "y": 4445}},
                    {"id": "n90", "opcode": "oscil3", "params": {"amp": 0.2, "freq": 330}, "position": {"x": 20, "y": 4470}},
                    {"id": "n91", "opcode": "follow2", "params": {"asig": 0}, "position": {"x": 20, "y": 4520}},
                    {"id": "n92", "opcode": "pinkish", "params": {"xin": 0}, "position": {"x": 20, "y": 4570}},
                    {"id": "n93", "opcode": "powershape", "params": {"ain": 0}, "position": {"x": 20, "y": 4620}},
                    {"id": "n94", "opcode": "pvsanal", "params": {"ain": 0}, "position": {"x": 20, "y": 4670}},
                    {"id": "n95", "opcode": "pvsosc", "params": {}, "position": {"x": 20, "y": 4720}},
                    {"id": "n96", "opcode": "pvsmorph", "params": {"fsig1": 0, "fsig2": 0}, "position": {"x": 20, "y": 4770}},
                    {"id": "n97", "opcode": "pvsmooth", "params": {"fsigin": 0}, "position": {"x": 20, "y": 4820}},
                    {"id": "n98", "opcode": "pvshift", "params": {"fsigin": 0}, "position": {"x": 20, "y": 4870}},
                    {"id": "n99", "opcode": "pvswarp", "params": {"fsigin": 0}, "position": {"x": 20, "y": 4920}},
                    {"id": "n100", "opcode": "pvsvoc", "params": {"famp": 0, "fexc": 0}, "position": {"x": 20, "y": 4970}},
                    {"id": "n101", "opcode": "pvsynth", "params": {"fsrc": 0}, "position": {"x": 20, "y": 5020}},
                    {"id": "n102", "opcode": "jitter", "params": {}, "position": {"x": 20, "y": 5070}},
                    {"id": "n103", "opcode": "random", "params": {}, "position": {"x": 20, "y": 5120}},
                    {"id": "n104", "opcode": "randomh", "params": {}, "position": {"x": 20, "y": 5170}},
                    {"id": "n105", "opcode": "randomi", "params": {}, "position": {"x": 20, "y": 5220}},
                    {"id": "n106", "opcode": "resonx", "params": {"asig": 0}, "position": {"x": 20, "y": 5270}},
                    {"id": "n107", "opcode": "release", "params": {}, "position": {"x": 20, "y": 5320}},
                    {"id": "n108", "opcode": "sekere", "params": {}, "position": {"x": 20, "y": 5370}},
                    {"id": "n109", "opcode": "sleighbells", "params": {}, "position": {"x": 20, "y": 5420}},
                    {"id": "n110", "opcode": "grain", "params": {}, "position": {"x": 20, "y": 5470}},
                    {"id": "n111", "opcode": "grain2", "params": {}, "position": {"x": 20, "y": 5520}},
                    {"id": "n112", "opcode": "grain3", "params": {}, "position": {"x": 20, "y": 5570}},
                    {"id": "n113", "opcode": "granule", "params": {}, "position": {"x": 20, "y": 5620}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "sfload_nodes": {
                        "n65": {
                            "sampleAsset": {
                                "asset_id": "sfload-asset-1",
                                "original_name": "test.sf2",
                                "stored_name": "test.sf2",
                                "content_type": "audio/sf2",
                                "size_bytes": 8,
                            }
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        asset_dir = tmp_path / "gen_audio_assets"
        asset_dir.mkdir(parents=True, exist_ok=True)
        (asset_dir / "test.sf2").write_bytes(b"sfbkfake")

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        assert "__VS_OPTIONAL_OMIT__" not in compiled_orc
        for opcode in [
            "poscil3",
            "lfo",
            "vibr",
            "vibrato",
            "fmb3",
            "fmbell",
            "fmmetal",
            "fmpercfl",
            "fmrhode",
            "fmvoice",
            "fmwurlie",
            "madsr",
            "mxadsr",
            "pinker",
            "noise",
            "pluck",
            "wgpluck2",
            "wgflute",
            "wgclar",
            "wgbow",
            "wgbowedbar",
            "wguide2",
            "pan2",
            "vdelay3",
            "delay",
            "delayk",
            "delayr",
            "delayw",
            "deltap",
            "deltap3",
            "vdelayxs",
            "flanger",
            "comb",
            "reverb2",
            "limit",
            "dam",
            "exciter",
            "distort1",
            "diode_ladder",
            "foscili",
            "ftgenonce",
            "marimba",
            "moogladder2",
            "rezzy",
            "vclpf",
            "vco2",
            "vco2init",
            "vcomb",
            "dripwater",
            "gbuzz",
            "grain",
            "grain2",
            "grain3",
            "granule",
            "oscil3",
            "follow2",
            "pinkish",
            "powershape",
            "pvsanal",
            "pvsosc",
            "pvsmorph",
            "pvsmooth",
            "pvshift",
            "pvswarp",
            "pvsvoc",
            "pvsynth",
            "expseg",
            "expsega",
            "expsegr",
            "expon",
            "linseg",
            "linsegr",
            "linenr",
            "envlpxr",
            "transegr",
            "butterlp",
            "butterbp",
            "butterhp",
            "butterbr",
            "tbvcf",
            "statevar",
            "skf",
            "clip",
            "fof",
            "fof2",
            "fofilter",
            "vosim",
            "voice",
            "inletk",
            "inleta",
            "outletk",
            "outleta",
            "rms",
            "samphold",
            "jitter",
            "random",
            "randomh",
            "randomi",
            "release",
            "portk",
            "maxalloc",
            "xtratim",
            "sfload",
            "sfplay3",
            "sfinstr3",
            "ampmidi",
            "ampmidicurve",
            "ampmidid",
            "notnum",
            "ntrpol",
            "moog",
            "moogvcf",
            "resonx",
            "sekere",
            "sleighbells",
            "upsamp",
            "downsamp",
            "fold",
            "platerev",
        ]:
            assert opcode in compiled_orc
        assert any(" voice " in line for line in compiled_orc.splitlines())
        mxadsr_line = next(line.strip() for line in compiled_orc.splitlines() if " mxadsr " in line)
        assert mxadsr_line.count(",") == 5
        flanger_line = next(line.strip() for line in compiled_orc.splitlines() if " flanger " in line)
        assert ", a(" in flanger_line
        vdelayxs_line = next(line.strip() for line in compiled_orc.splitlines() if " vdelayxs " in line)
        assert ", a(" in vdelayxs_line
        sfload_line = next(line for line in compiled_orc.splitlines() if ' sfload "test.sf2"' in line)
        maxalloc_line = next(line for line in compiled_orc.splitlines() if line.strip().startswith("maxalloc "))
        instr_line_index = compiled_orc.splitlines().index("instr 1")
        sfload_line_index = compiled_orc.splitlines().index(sfload_line)
        maxalloc_line_index = compiled_orc.splitlines().index(maxalloc_line)
        assert sfload_line.startswith("gi_")
        assert maxalloc_line.strip() == "maxalloc 1, 8"
        assert maxalloc_line_index < instr_line_index
        assert sfload_line_index < instr_line_index


def test_maxalloc_uses_assigned_instrument_number_in_multi_instrument_compile(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload_a = {
            "name": "maxalloc instrument a",
            "description": "maxalloc should target assigned instrument number",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                    {"id": "n3", "opcode": "maxalloc", "params": {"icount": 3}, "position": {"x": 20, "y": 120}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }
        patch_payload_b = {
            **patch_payload_a,
            "name": "maxalloc instrument b",
            "graph": {
                **patch_payload_a["graph"],
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                    {"id": "n3", "opcode": "maxalloc", "params": {"icount": 7}, "position": {"x": 20, "y": 120}},
                ],
            },
        }

        create_patch_a = client.post("/api/patches", json=patch_payload_a)
        create_patch_b = client.post("/api/patches", json=patch_payload_b)
        assert create_patch_a.status_code == 201
        assert create_patch_b.status_code == 201
        patch_id_a = create_patch_a.json()["id"]
        patch_id_b = create_patch_b.json()["id"]

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"patch_id": patch_id_a, "midi_channel": 1},
                    {"patch_id": patch_id_b, "midi_channel": 2},
                ]
            },
        )
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        maxalloc_lines = [line.strip() for line in compiled_orc.splitlines() if line.strip().startswith("maxalloc ")]
        instr_line_index = compiled_orc.splitlines().index("instr 1")
        maxalloc_line_index = min(
            compiled_orc.splitlines().index(line)
            for line in compiled_orc.splitlines()
            if line.strip().startswith("maxalloc ")
        )
        assert maxalloc_lines == ["maxalloc 1, 3", "maxalloc 2, 7"]
        assert maxalloc_line_index < instr_line_index


def test_maxalloc_accepts_connected_const_i_icount_source(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "maxalloc const_i icount",
            "description": "maxalloc should accept connected const_i icount source",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_i", "params": {"value": 4}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 120}},
                    {"id": "n3", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 120}},
                    {"id": "n4", "opcode": "maxalloc", "params": {}, "position": {"x": 200, "y": 20}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "iout", "to_node_id": "n4", "to_port_id": "icount"},
                    {"from_node_id": "n2", "from_port_id": "aout", "to_node_id": "n3", "to_port_id": "left"},
                    {"from_node_id": "n2", "from_port_id": "aout", "to_node_id": "n3", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]
        assert "maxalloc 1, 4" in compiled_orc


def test_maxalloc_rejects_connected_non_const_i_icount_source(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "maxalloc invalid connected icount",
            "description": "maxalloc should reject non-const_i icount source",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "notnum", "params": {}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 120}},
                    {"id": "n3", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 120}},
                    {"id": "n4", "opcode": "maxalloc", "params": {}, "position": {"x": 200, "y": 20}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "inote", "to_node_id": "n4", "to_port_id": "icount"},
                    {"from_node_id": "n2", "from_port_id": "aout", "to_node_id": "n3", "to_port_id": "left"},
                    {"from_node_id": "n2", "from_port_id": "aout", "to_node_id": "n3", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 422
        diagnostics = compile_response.json()["detail"]["diagnostics"]
        assert any("only accepts a direct const_i connection for icount" in item for item in diagnostics)


def test_mxadsr_supports_legacy_idrss_param_key(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "mxadsr legacy idrss",
            "description": "uses legacy mxadsr release parameter key",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "mxadsr", "params": {"idrss": 0.75}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "poscil3", "params": {"amp": 0.2, "freq": 220}, "position": {"x": 20, "y": 120}},
                    {"id": "n3", "opcode": "outs", "params": {}, "position": {"x": 220, "y": 120}},
                ],
                "connections": [
                    {"from_node_id": "n2", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "left"},
                    {"from_node_id": "n2", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        mxadsr_line = next(line.strip() for line in compiled_orc.splitlines() if " mxadsr " in line)
        assert mxadsr_line.endswith(", 0, 0.75")


def test_flanger_accepts_audio_delay_input_without_forced_cast(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "flanger audio delay input",
            "description": "flanger should keep adel as audio when connected from an audio source",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {
                        "id": "n1",
                        "opcode": "poscil3",
                        "params": {"amp": 0.2, "freq": 220},
                        "position": {"x": 20, "y": 20},
                    },
                    {
                        "id": "n2",
                        "opcode": "poscil3",
                        "params": {"amp": 0.001, "freq": 0.25},
                        "position": {"x": 20, "y": 120},
                    },
                    {
                        "id": "n3",
                        "opcode": "flanger",
                        "params": {"kfeedback": 0.3},
                        "position": {"x": 220, "y": 70},
                    },
                    {"id": "n4", "opcode": "outs", "params": {}, "position": {"x": 420, "y": 70}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "asig"},
                    {"from_node_id": "n2", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "adel"},
                    {"from_node_id": "n3", "from_port_id": "aout", "to_node_id": "n4", "to_port_id": "left"},
                    {"from_node_id": "n3", "from_port_id": "aout", "to_node_id": "n4", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        flanger_line = next(line.strip() for line in compiled_orc.splitlines() if " flanger " in line)
        assert "a(a_" not in flanger_line


def test_vdelayxs_accepts_init_delay_input_with_audio_cast(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "vdelayxs init delay input",
            "description": "vdelayxs should accept init-rate delay input and cast it to audio",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {
                        "id": "n1",
                        "opcode": "poscil3",
                        "params": {"amp": 0.2, "freq": 220},
                        "position": {"x": 20, "y": 20},
                    },
                    {"id": "n2", "opcode": "const_i", "params": {"value": 0.03}, "position": {"x": 20, "y": 120}},
                    {
                        "id": "n3",
                        "opcode": "vdelayxs",
                        "params": {"imaxdel": 1, "iws": 1024},
                        "position": {"x": 220, "y": 70},
                    },
                    {"id": "n4", "opcode": "outs", "params": {}, "position": {"x": 420, "y": 70}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n3", "to_port_id": "asig"},
                    {"from_node_id": "n2", "from_port_id": "iout", "to_node_id": "n3", "to_port_id": "adl"},
                    {"from_node_id": "n3", "from_port_id": "aout", "to_node_id": "n4", "to_port_id": "left"},
                    {"from_node_id": "n3", "from_port_id": "aout2", "to_node_id": "n4", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        vdelayxs_line = next(line.strip() for line in compiled_orc.splitlines() if " vdelayxs " in line)
        assert "a(i_" in vdelayxs_line


def test_reverb2_compiles_with_iskip_without_optional_gap(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Reverb2 SkipInit",
            "description": "reverb2 should accept iskip as the only optional arg",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "reverb2", "params": {"asig": 0, "iskip": 1}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 220, "y": 20}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        reverb2_line = next(line.strip() for line in compiled_orc.splitlines() if " reverb2 " in line)
        assert reverb2_line.endswith("reverb2 0, 1.5, 0.5, 1")


def test_sfload_uploaded_asset_uses_relative_stored_name(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "uploaded.sf2"
    (asset_dir / stored_name).write_bytes(b"sfbkfake")

    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Uploaded sfload Asset",
            "description": "sfload should compile uploaded assets with relative path",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                    {"id": "n3", "opcode": "sfload", "params": {}, "position": {"x": 20, "y": 120}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "sfload_nodes": {
                        "n3": {
                            "sampleAsset": {
                                "asset_id": "sf2-asset-1",
                                "original_name": "bank.sf2",
                                "stored_name": stored_name,
                                "content_type": "audio/sf2",
                                "size_bytes": 8,
                            }
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        sfload_line = next(line for line in compiled_orc.splitlines() if ' sfload "' in line)
        assert f' sfload "{stored_name}"' in sfload_line
        assert str(asset_dir) not in compiled_orc


def test_multi_instrument_session_compiles_distinct_channel_mappings(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Channel Instrument",
            "description": "minimal compile graph",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_a = client.post("/api/patches", json={**patch_payload, "name": "Instrument A"})
        patch_b = client.post("/api/patches", json={**patch_payload, "name": "Instrument B"})
        assert patch_a.status_code == 201
        assert patch_b.status_code == 201

        patch_a_id = patch_a.json()["id"]
        patch_b_id = patch_b.json()["id"]

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"patch_id": patch_a_id, "midi_channel": 1},
                    {"patch_id": patch_b_id, "midi_channel": 2},
                ]
            },
        )
        assert create_session.status_code == 201

        response_body = create_session.json()
        assert response_body["patch_id"] == patch_a_id
        assert len(response_body["instruments"]) == 2

        session_id = response_body["session_id"]
        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200

        compiled_orc = compile_response.json()["orc"]
        assert "massign 0, 0" in compiled_orc
        assert "massign 1, 1" in compiled_orc
        assert "massign 2, 2" in compiled_orc
        assert "instr 1" in compiled_orc
        assert "instr 2" in compiled_orc


def test_always_on_effect_session_compiles_audio_route_matrix(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        source = client.post("/api/patches", json=_audio_source_patch_payload(name="Dry Source"))
        effect = client.post("/api/patches", json=_always_on_effect_patch_payload(name="Stereo Effect"))
        assert source.status_code == 201
        assert effect.status_code == 201

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"id": "src", "patch_id": source.json()["id"], "midi_channel": 1},
                    {
                        "id": "fx",
                        "patch_id": effect.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "src", "channel": "left"}],
                    },
                ]
            },
        )
        assert create_session.status_code == 201
        session_body = create_session.json()
        assert session_body["instruments"][0]["midi_channel"] == 1
        assert session_body["instruments"][1]["midi_channel"] == 0
        assert session_body["instruments"][1]["effect_routes"] == [{"source_id": "src", "channel": "left"}]

        compile_response = client.post(f"/api/sessions/{session_body['session_id']}/compile")
        assert compile_response.status_code == 200

        compiled_orc = compile_response.json()["orc"]
        assert 'instr vcs_instr_1' in compiled_orc
        assert 'instr vcs_instr_2' in compiled_orc
        assert 'massign 1, "vcs_instr_1"' in compiled_orc
        assert 'massign 0, "vcs_instr_2"' not in compiled_orc
        assert 'connect "vcs_instr_1", "left", "vcs_instr_2", "left"' in compiled_orc
        assert 'connect "vcs_instr_1", "right", "vcs_instr_2", "right"' not in compiled_orc
        assert 'alwayson "vcs_instr_2"' in compiled_orc


def test_always_on_effect_session_routes_connected_const_s_port_names(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        source = client.post(
            "/api/patches",
            json=_audio_source_patch_payload(name="Connected Dry Source", connected_snames=True),
        )
        effect = client.post(
            "/api/patches",
            json=_always_on_effect_patch_payload(name="Connected Stereo Effect", connected_snames=True),
        )
        assert source.status_code == 201
        assert effect.status_code == 201

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"id": "src", "patch_id": source.json()["id"], "midi_channel": 1},
                    {
                        "id": "fx",
                        "patch_id": effect.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "src", "channel": "right"}],
                    },
                ]
            },
        )
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")
        assert compile_response.status_code == 200

        compiled_orc = compile_response.json()["orc"]
        assert 'connect "vcs_instr_1", "right", "vcs_instr_2", "right"' in compiled_orc
        assert 'alwayson "vcs_instr_2"' in compiled_orc


def test_always_on_effect_session_routes_unmatched_source_outlet_names_to_stereo_inlets(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        source = client.post(
            "/api/patches",
            json=_audio_source_patch_payload_with_outlet_names(
                name="Dry Lillian-Style Source",
                left_name="dryl",
                right_name="dryr",
            ),
        )
        effect = client.post("/api/patches", json=_always_on_effect_patch_payload(name="Stereo Effect"))
        assert source.status_code == 201
        assert effect.status_code == 201

        listed = client.get("/api/patches").json()
        listed_source = next(patch for patch in listed if patch["id"] == source.json()["id"])
        assert listed_source["audio_outlet_names"] == ["dryl", "dryr"]

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"id": "src", "patch_id": source.json()["id"], "midi_channel": 1},
                    {
                        "id": "fx",
                        "patch_id": effect.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [
                            {"source_id": "src", "channel": "dryl"},
                            {"source_id": "src", "channel": "dryr"},
                        ],
                    },
                ]
            },
        )
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")
        assert compile_response.status_code == 200

        compiled_orc = compile_response.json()["orc"]
        assert 'connect "vcs_instr_1", "dryl", "vcs_instr_2", "left"' in compiled_orc
        assert 'connect "vcs_instr_1", "dryr", "vcs_instr_2", "right"' in compiled_orc


def test_always_on_effect_session_preserves_outleta_input_formulas(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        source_payload = _audio_source_patch_payload_with_outlet_names(
            name="Wet Send Source",
            left_name="sendl",
            right_name="sendr",
        )
        source_payload["graph"]["nodes"].extend(
            [
                {
                    "id": "dry_l",
                    "opcode": "outleta",
                    "params": {"sname": "dryl"},
                    "position": {"x": 200, "y": 180},
                },
                {
                    "id": "dry_r",
                    "opcode": "outleta",
                    "params": {"sname": "dryr"},
                    "position": {"x": 200, "y": 260},
                },
            ]
        )
        source_payload["graph"]["connections"].extend(
            [
                {"from_node_id": "sig", "from_port_id": "aout", "to_node_id": "dry_l", "to_port_id": "asignal"},
                {"from_node_id": "sig", "from_port_id": "aout", "to_node_id": "dry_r", "to_port_id": "asignal"},
            ]
        )
        source_payload["graph"]["ui_layout"] = {
            "input_formulas": {
                "out_l::asignal": {
                    "expression": "0.00005*in1",
                    "inputs": [{"token": "in1", "from_node_id": "sig", "from_port_id": "aout"}],
                },
                "out_r::asignal": {
                    "expression": "0.00005*in1",
                    "inputs": [{"token": "in1", "from_node_id": "sig", "from_port_id": "aout"}],
                },
            }
        }

        source = client.post("/api/patches", json=source_payload)
        effect = client.post("/api/patches", json=_always_on_effect_patch_payload(name="Stereo Reverb"))
        assert source.status_code == 201
        assert effect.status_code == 201

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"id": "src", "patch_id": source.json()["id"], "midi_channel": 1},
                    {
                        "id": "fx",
                        "patch_id": effect.json()["id"],
                        "midi_channel": 0,
                        "effect_source_ids": ["src"],
                        "effect_routes": [
                            {"source_id": "src", "channel": "sendl"},
                            {"source_id": "src", "channel": "sendr"},
                        ],
                    },
                ]
            },
        )
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")
        assert compile_response.status_code == 200

        compiled_orc = compile_response.json()["orc"]
        assert 'connect "vcs_instr_1", "sendl", "vcs_instr_2", "left"' in compiled_orc
        assert 'connect "vcs_instr_1", "sendr", "vcs_instr_2", "right"' in compiled_orc
        assert 'connect "vcs_instr_1", "dryl", "vcs_instr_2", "left"' not in compiled_orc
        assert 'connect "vcs_instr_1", "dryr", "vcs_instr_2", "right"' not in compiled_orc
        assert "outleta \"sendl\", (0.00005 * a_sig_aout_1)" in compiled_orc
        assert "outleta \"sendr\", (0.00005 * a_sig_aout_1)" in compiled_orc


def test_always_on_effect_session_compiles_cascaded_audio_routes(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        source = client.post("/api/patches", json=_audio_outlet_only_source_patch_payload(name="Dry Source"))
        reverb = client.post("/api/patches", json=_always_on_effect_with_outlets_patch_payload(name="Routable Reverb"))
        compressor = client.post("/api/patches", json=_always_on_effect_patch_payload(name="Final Compressor"))
        assert source.status_code == 201
        assert reverb.status_code == 201
        assert compressor.status_code == 201

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"id": "src", "patch_id": source.json()["id"], "midi_channel": 1},
                    {
                        "id": "rvb",
                        "patch_id": reverb.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "src", "channel": "left"}],
                    },
                    {
                        "id": "cmp",
                        "patch_id": compressor.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "rvb", "channel": "left"}],
                    },
                ]
            },
        )
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")
        assert compile_response.status_code == 200

        compiled_orc = compile_response.json()["orc"]
        assert 'connect "vcs_instr_1", "left", "vcs_instr_2", "left"' in compiled_orc
        assert 'connect "vcs_instr_2", "left", "vcs_instr_3", "left"' in compiled_orc
        assert 'alwayson "vcs_instr_2"' in compiled_orc
        assert 'alwayson "vcs_instr_3"' in compiled_orc


def test_always_on_effect_session_rejects_audio_route_loop(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        effect_a = client.post(
            "/api/patches",
            json=_always_on_effect_with_outlets_patch_payload(name="Effect A"),
        )
        effect_b = client.post(
            "/api/patches",
            json=_always_on_effect_with_outlets_patch_payload(name="Effect B"),
        )
        assert effect_a.status_code == 201
        assert effect_b.status_code == 201

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {
                        "id": "fx-a",
                        "patch_id": effect_a.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "fx-b", "channel": "left"}],
                    },
                    {
                        "id": "fx-b",
                        "patch_id": effect_b.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "fx-a", "channel": "left"}],
                    },
                ]
            },
        )
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")
        assert compile_response.status_code == 422
        diagnostics = compile_response.json()["detail"]["diagnostics"]
        assert "Effect routing would create an audio feedback loop." in diagnostics


def test_always_on_effect_session_rejects_indirect_audio_route_loop(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        effect_a = client.post("/api/patches", json=_always_on_effect_with_outlets_patch_payload(name="Effect A"))
        effect_b = client.post("/api/patches", json=_always_on_effect_with_outlets_patch_payload(name="Effect B"))
        effect_c = client.post("/api/patches", json=_always_on_effect_with_outlets_patch_payload(name="Effect C"))
        assert effect_a.status_code == 201
        assert effect_b.status_code == 201
        assert effect_c.status_code == 201

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {
                        "id": "fx-a",
                        "patch_id": effect_a.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "fx-c", "channel": "left"}],
                    },
                    {
                        "id": "fx-b",
                        "patch_id": effect_b.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "fx-a", "channel": "left"}],
                    },
                    {
                        "id": "fx-c",
                        "patch_id": effect_c.json()["id"],
                        "midi_channel": 0,
                        "effect_routes": [{"source_id": "fx-b", "channel": "left"}],
                    },
                ]
            },
        )
        assert create_session.status_code == 201

        compile_response = client.post(f"/api/sessions/{create_session.json()['session_id']}/compile")
        assert compile_response.status_code == 422
        diagnostics = compile_response.json()["detail"]["diagnostics"]
        assert "Effect routing would create an audio feedback loop." in diagnostics


def test_multi_instrument_compile_deduplicates_sfload_for_same_file(tmp_path: Path) -> None:
    asset_dir = tmp_path / "gen_audio_assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = "shared.sf2"
    (asset_dir / stored_name).write_bytes(b"sfbkshared")

    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Shared SoundFont",
            "description": "dedupe sfload across instruments",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                    {"id": "n3", "opcode": "sfload", "params": {}, "position": {"x": 20, "y": 120}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {
                    "sfload_nodes": {
                        "n3": {
                            "sampleAsset": {
                                "asset_id": "sfload-asset-1",
                                "original_name": "shared.sf2",
                                "stored_name": stored_name,
                                "content_type": "audio/sf2",
                                "size_bytes": 10,
                            }
                        }
                    }
                },
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        patch_id = patch_response.json()["id"]

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"patch_id": patch_id, "midi_channel": 1},
                    {"patch_id": patch_id, "midi_channel": 2},
                ]
            },
        )
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200
        compiled_orc = compile_response.json()["orc"]

        sfload_calls = [line for line in compiled_orc.splitlines() if f' sfload "{stored_name}"' in line]
        assert len(sfload_calls) == 1
        assert "opcode:sfload (alias)" in compiled_orc


def test_multi_instrument_compile_uses_first_instrument_engine_config(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Control Rate Variant",
            "description": "first engine config should drive bundle header",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.05}, "position": {"x": 20, "y": 20}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 200, "y": 20}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 44100, "control_rate": 4410, "ksmps": 10, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        variant_payload = {
            **patch_payload,
            "name": "Engine Variant B",
            "graph": {
                **patch_payload["graph"],
                "engine_config": {
                    "sr": 48000,
                    "control_rate": 3000,
                    "ksmps": 16,
                    "nchnls": 1,
                    "0dbfs": 0.5,
                },
            },
        }

        patch_a = client.post("/api/patches", json={**patch_payload, "name": "Engine Variant A"})
        patch_b = client.post("/api/patches", json=variant_payload)
        assert patch_a.status_code == 201
        assert patch_b.status_code == 201

        patch_a_id = patch_a.json()["id"]
        patch_b_id = patch_b.json()["id"]

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"patch_id": patch_a_id, "midi_channel": 1},
                    {"patch_id": patch_b_id, "midi_channel": 2},
                ]
            },
        )
        assert create_session.status_code == 201

        session_id = create_session.json()["session_id"]
        compile_response = client.post(f"/api/sessions/{session_id}/compile")
        assert compile_response.status_code == 200

        compiled_orc = compile_response.json()["orc"]
        assert "sr = 44100" in compiled_orc
        assert "ksmps = 10" in compiled_orc
        assert "nchnls = 2" in compiled_orc
        assert "0dbfs = 1.0" in compiled_orc
        assert "instr 1" in compiled_orc
        assert "instr 2" in compiled_orc
