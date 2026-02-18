from __future__ import annotations

import os
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

        all_notes_off = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "all_notes_off", "channel": 1},
        )
        assert all_notes_off.status_code == 200


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
