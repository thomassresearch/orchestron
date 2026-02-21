from __future__ import annotations

import os
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.main import create_app


def _client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "test.db"
    static_dir = tmp_path / "static"
    frontend_dist = tmp_path / "frontend_dist"
    frontend_dist.mkdir(parents=True, exist_ok=True)
    (frontend_dist / "index.html").write_text("<!doctype html><html><body>client-ok</body></html>")

    os.environ["VISUALCSOUND_DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["VISUALCSOUND_STATIC_DIR"] = str(static_dir)
    os.environ["VISUALCSOUND_FRONTEND_DIST_DIR"] = str(frontend_dist)
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "true"

    get_settings.cache_clear()
    app = create_app()
    return TestClient(app)


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


def test_add_opcodes_guide_exists_and_contains_key_references() -> None:
    docs_path = Path(__file__).resolve().parents[2] / "ADD_OPCODES.md"
    assert docs_path.exists()

    text = docs_path.read_text(encoding="utf-8")
    assert "https://csound.com/docs/manual/PartReference.html" in text
    assert "backend/app/services/opcode_service.py" in text
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

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": {
                    "bpm": 300,
                    "step_count": 16,
                    "tracks": [
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
                }
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
            status = client.get(f"/api/sessions/{session_id}/sequencer/status")
            assert status.status_code == 200
            data = status.json()
            if data["tracks"][0]["active_pad"] == 1 and data["tracks"][0]["queued_pad"] is None:
                switched = True
                break
            time.sleep(0.1)

        assert switched, "Queued pad did not switch on loop boundary in expected time."

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200
        assert stop_sequencer.json()["running"] is False


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

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": {
                    "bpm": 300,
                    "step_count": 16,
                    "tracks": [
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
                }
            },
        )
        assert start_sequencer.status_code == 200

        track2 = next(track for track in start_sequencer.json()["tracks"] if track["track_id"] == "voice-2")
        assert track2["enabled"] is False
        assert track2["queued_enabled"] is True

        enabled_after_boundary = False
        for _ in range(25):
            status = client.get(f"/api/sessions/{session_id}/sequencer/status")
            assert status.status_code == 200
            data = status.json()
            track = next(item for item in data["tracks"] if item["track_id"] == "voice-2")
            if data["cycle"] >= 1 and track["enabled"] is True and track["queued_enabled"] is None:
                enabled_after_boundary = True
                break
            time.sleep(0.1)

        assert enabled_after_boundary, "Queued track enable did not activate on step-1 boundary in expected time."

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200
        assert stop_sequencer.json()["running"] is False


def test_const_nodes_use_node_params_without_value_input_port(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        opcodes_response = client.get("/api/opcodes")
        assert opcodes_response.status_code == 200
        opcodes_by_name = {item["name"]: item for item in opcodes_response.json()}
        assert opcodes_by_name["const_a"]["inputs"] == []
        assert opcodes_by_name["const_i"]["inputs"] == []
        assert opcodes_by_name["const_k"]["inputs"] == []

        patch_payload = {
            "name": "Const Patch",
            "description": "const node control",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.25}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 220, "y": 50}},
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
        assert " = 0.25" in compile_response.json()["orc"]


def test_midi_opcodes_and_vco_compile_flow(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        opcodes_response = client.get("/api/opcodes")
        assert opcodes_response.status_code == 200
        opcodes_by_name = {item["name"]: item for item in opcodes_response.json()}
        assert opcodes_by_name["cpsmidi"]["category"] == "midi"
        assert opcodes_by_name["cpsmidi"]["outputs"][0]["signal_type"] == "i"
        assert opcodes_by_name["midictrl"]["category"] == "midi"
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


def test_additional_opcode_references_are_available(tmp_path: Path) -> None:
    expected_urls = {
        "lfo": "https://csound.com/docs/manual/lfo.html",
        "poscil3": "https://csound.com/docs/manual/poscil3.html",
        "vibr": "https://csound.com/docs/manual/vibr.html",
        "vibrato": "https://csound.com/docs/manual/vibrato.html",
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
        "noise": "https://csound.com/docs/manual/noise.html",
        "pluck": "https://csound.com/docs/manual/pluck.html",
        "wgflute": "https://csound.com/docs/manual/wgflute.html",
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
        "reverb2": "https://csound.com/docs/manual/reverb2.html",
        "limit": "https://csound.com/docs/manual/limit.html",
        "dam": "https://csound.com/docs/manual/dam.html",
        "exciter": "https://csound.com/docs/manual/exciter.html",
        "distort1": "https://csound.com/docs/manual/distort1.html",
        "diode_ladder": "https://csound.com/docs/manual/diode_ladder.html",
        "foscili": "https://csound.com/docs/manual/foscili.html",
        "ftgenonce": "https://csound.com/docs/manual/ftgenonce.html",
        "marimba": "https://csound.com/docs/manual/marimba.html",
        "moogladder2": "https://csound.com/docs/manual/moogladder2.html",
        "rezzy": "https://csound.com/docs/manual/rezzy.html",
        "vclpf": "https://csound.com/docs/manual/vclpf.html",
        "vco2": "https://csound.com/docs/manual/vco2.html",
        "dripwater": "https://csound.com/docs/manual/dripwater.html",
    }

    with _client(tmp_path) as client:
        response = client.get("/api/opcodes")
        assert response.status_code == 200
        opcodes_by_name = {item["name"]: item for item in response.json()}

        for opcode_name, expected_url in expected_urls.items():
            assert opcode_name in opcodes_by_name
            assert opcodes_by_name[opcode_name]["documentation_url"] == expected_url


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
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n2", "to_port_id": "right"},
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
            "wgflute",
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
            "dripwater",
        ]:
            assert opcode in compiled_orc


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
