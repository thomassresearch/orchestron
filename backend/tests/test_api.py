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
