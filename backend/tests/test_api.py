from __future__ import annotations

from io import BytesIO
import json
import os
import time
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.main import create_app


def _client(tmp_path: Path) -> TestClient:
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
                            "active_pad": 1,
                            "pads": [
                                {"pad_index": 0, "step_count": 16, "steps": [60, None] + [None] * 14},
                                {"pad_index": 1, "step_count": 8, "steps": [72, None] + [None] * 6},
                            ],
                        }
                    ],
                }
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
            status = client.get(f"/api/sessions/{session_id}/sequencer/status")
            assert status.status_code == 200
            body = status.json()
            if body["tracks"][0]["active_pad"] == 0 and body["tracks"][0]["step_count"] == 16:
                switched = True
                break
            time.sleep(0.05)

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
                }
            },
        )
        assert start_sequencer.status_code == 200
        assert start_sequencer.json()["running"] is True
        track = next(item for item in start_sequencer.json()["tracks"] if item["track_id"] == "voice-1")
        # Looper start aligns the track to the first pad in the configured sequence.
        assert track["active_pad"] == 0

        saw_second_pad = False
        stopped_after_sequence = False
        for _ in range(50):
            status = client.get(f"/api/sessions/{session_id}/sequencer/status")
            assert status.status_code == 200
            data = status.json()
            track = next(item for item in data["tracks"] if item["track_id"] == "voice-1")

            if track["enabled"] and track["active_pad"] == 1:
                saw_second_pad = True

            if saw_second_pad and track["enabled"] is False and track["queued_enabled"] is None:
                stopped_after_sequence = True
                break

            time.sleep(0.1)

        assert saw_second_pad, "Pad looper did not advance to the second pad in the configured sequence."
        assert stopped_after_sequence, "Pad looper did not stop the track when repeat was disabled."

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200
        assert stop_sequencer.json()["running"] is False


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
                }
            },
        )
        assert start_sequencer.status_code == 200
        assert start_sequencer.json()["running"] is True

        saw_held_note = False
        saw_release_after_hold = False
        for _ in range(40):
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
            time.sleep(0.05)

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

        midi_service = client.app.state.container.midi_service
        captured_messages: list[list[int]] = []
        original_send_message = midi_service.send_message

        def capture_send_message(input_selector: str, message: list[int]) -> str:
            captured_messages.append(list(message))
            return "mock"

        midi_service.send_message = capture_send_message  # type: ignore[method-assign]
        try:
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
                    }
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
                time.sleep(0.05)

            assert saw_first_velocity, "Expected step 1 note-on to use velocity 23."
            assert saw_second_velocity, "Expected step 3 note-on to use velocity 91."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False
        finally:
            midi_service.send_message = original_send_message  # type: ignore[method-assign]


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
                        "params": {"itabexcite": 1, "itabouts": 1, "kbndry": 0.9},
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
        assert platerev_line.endswith(", 0")


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


def test_gen_meta_opcode_supports_gen11_gen17_gen20(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "GEN 11 17 20",
            "description": "Routine-specific GEN forms compile correctly",
            "schema_version": 1,
            "graph": {
                "nodes": [
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
        "noise": "https://csound.com/docs/manual/noise.html",
        "pluck": "https://csound.com/docs/manual/pluck.html",
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
        "reverb2": "https://csound.com/docs/manual/reverb2.html",
        "platerev": "https://csound.com/docs/manual/platerev.html",
        "limit": "https://csound.com/docs/manual/limit.html",
        "dam": "https://csound.com/docs/manual/dam.html",
        "exciter": "https://csound.com/docs/manual/exciter.html",
        "distort1": "https://csound.com/docs/manual/distort1.html",
        "fold": "https://csound.com/docs/manual/fold.html",
        "gbuzz": "https://csound.com/docs/manual/gbuzz.html",
        "diode_ladder": "https://csound.com/docs/manual/diode_ladder.html",
        "expseg": "https://csound.com/docs/manual/expseg.html",
        "expsega": "https://csound.com/docs/manual/expsega.html",
        "linseg": "https://csound.com/docs/manual/linseg.html",
        "linsegr": "https://csound.com/docs/manual/linsegr.html",
        "foscili": "https://csound.com/docs/manual/foscili.html",
        "ftgenonce": "https://csound.com/docs/manual/ftgenonce.html",
        "marimba": "https://csound.com/docs/manual/marimba.html",
        "moog": "https://csound.com/docs/manual/moog.html",
        "moogladder2": "https://csound.com/docs/manual/moogladder2.html",
        "moogvcf": "https://csound.com/docs/manual/moogvcf.html",
        "rezzy": "https://csound.com/docs/manual/rezzy.html",
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

        wgpluck2_inputs = {item["id"]: item for item in opcodes_by_name["wgpluck2"]["inputs"]}
        wgpluck2_outputs = {item["id"]: item for item in opcodes_by_name["wgpluck2"]["outputs"]}
        assert opcodes_by_name["wgpluck2"]["category"] == "physical_modeling"
        assert wgpluck2_inputs["iplk"]["signal_type"] == "i"
        assert wgpluck2_inputs["kamp"]["signal_type"] == "k"
        assert wgpluck2_inputs["icps"]["signal_type"] == "i"
        assert wgpluck2_outputs["asig"]["signal_type"] == "a"

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
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "asig", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {"sfload_nodes": {"n65": {"samplePath": "/tmp/test.sf2"}}},
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
            "dripwater",
            "gbuzz",
            "expseg",
            "expsega",
            "linseg",
            "linsegr",
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
            "portk",
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
            "upsamp",
            "downsamp",
            "fold",
            "platerev",
        ]:
            assert opcode in compiled_orc
        assert any(" voice " in line for line in compiled_orc.splitlines())
        sfload_line = next(line for line in compiled_orc.splitlines() if ' sfload "/tmp/test.sf2"' in line)
        instr_line_index = compiled_orc.splitlines().index("instr 1")
        sfload_line_index = compiled_orc.splitlines().index(sfload_line)
        assert sfload_line.startswith("gi_")
        assert sfload_line_index < instr_line_index


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


def test_multi_instrument_compile_deduplicates_sfload_for_same_file(tmp_path: Path) -> None:
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
                "ui_layout": {"sfload_nodes": {"n3": {"samplePath": "/tmp/shared.sf2"}}},
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

        sfload_calls = [line for line in compiled_orc.splitlines() if ' sfload "/tmp/shared.sf2"' in line]
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
