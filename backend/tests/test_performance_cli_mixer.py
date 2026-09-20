"""Exercise the standalone performance CLI against isolated backend API storage."""

import copy
import json
from pathlib import Path
import sys

import pytest

from backend.tests.api_test_support import (
    _always_on_effect_with_outlets_patch_payload,
    _audio_outlet_only_source_patch_payload,
    _audio_source_patch_payload,
    _client,
)

SKILL_ROOT = Path(__file__).resolve().parents[2] / "integrations/skills/orchestron-performance-creator"
sys.path.insert(0, str(SKILL_ROOT / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402


class BackendApi:
    def __init__(self, client):
        self.client = client
        self.calls = []

    def call(self, method, path, payload=None):
        self.calls.append((method, path))
        response = self.client.request(method, "/api" + path, **({"json": payload} if payload is not None else {}))
        if response.is_error:
            raise cli.OrchestronCliError("backend_error", response.text)
        return response.json()

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, payload=None):
        return self.call("POST", path, payload)

    def put(self, path, payload):
        return self.call("PUT", path, payload)


def save_patch(client, payload):
    response = client.post("/api/patches", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def effect_payload(name):
    payload = _always_on_effect_with_outlets_patch_payload(name=name)
    payload["graph"]["nodes"] = [n for n in payload["graph"]["nodes"] if n["opcode"] != "outs"]
    payload["graph"]["connections"] = [c for c in payload["graph"]["connections"] if c["to_node_id"] != "outs"]
    return payload


def test_cli_normalization_preserves_optional_arranger_history():
    config = cli.empty_performance_config()
    config["arrangerHistory"] = {"version": 1, "cursor": 0, "entries": [], "basis": []}
    history = copy.deepcopy(config["arrangerHistory"])
    normalized = cli.normalize_performance_config(config, [])
    assert normalized["version"] == 16
    assert normalized["arrangerHistory"] == history


def test_cli_preset_validates_and_compiles_direct_outputs_without_speaker_or_patch_writes(tmp_path):
    with _client(tmp_path) as client:
        source_payload = _audio_source_patch_payload(name="Direct Source")
        source_payload["graph"]["nodes"] = [n for n in source_payload["graph"]["nodes"] if n["opcode"] != "outleta"]
        source_payload["graph"]["connections"] = [c for c in source_payload["graph"]["connections"] if c["to_node_id"] == "outs"]
        source = save_patch(client, source_payload)
        save_patch(client, effect_payload("Reverb Effect"))
        save_patch(client, effect_payload("Compressor Effect"))
        api = BackendApi(client)
        before = api.get("/patches")
        config = cli.empty_performance_config()
        config["instruments"] = [{"id": "source", "patchId": source["id"], "midiChannel": 1}]
        cli.ensure_standard_effect_matrix(config, api, send_gain_db=-12)
        assert api.get("/patches") == before
        assert not any(method == "POST" and path == "/patches" for method, path in api.calls)
        runtime = cli.create_compiled_runtime(api, config)
        manifest = runtime["compiled"]["manifest"]
        assert "$master" in manifest["meters"]
        assert len(config["instruments"]) == 3
        # Main routes capture both direct ports instead of leaving a parallel output bypass.
        routes = manifest["routes"]
        assert not any(r["sourceId"] == "source" and r["targetId"] == "$output" for r in routes)
        assert any(r["targetId"] == "$master" for r in routes)


def test_cli_mixer_roundtrip_push_and_graph_validation_with_master_insert(tmp_path, monkeypatch, capsys):
    with _client(tmp_path) as client:
        config = json.loads((SKILL_ROOT / "tests/fixtures/mixer_routes.json").read_text())
        source = _audio_outlet_only_source_patch_payload(name="Fixture Lead")
        for node in source["graph"]["nodes"]:
            if node["opcode"] == "outleta":
                node["params"]["sname"] = "dryl" if node["id"] == "out_l" else "dryr"
        payloads = {"source-patch": source, "compressor-patch": effect_payload("Compressor Effect"),
                    "delay-patch": effect_payload("Delay Effect"), "insert-patch": effect_payload("Master Trim")}
        ids = {key: save_patch(client, payload)["id"] for key, payload in payloads.items()}
        for binding in config["instruments"]:
            binding["patchId"] = ids[binding["patchId"]]
        api = BackendApi(client)
        config = cli.normalize_performance_config(config, api.get("/patches"))
        api.post("/sessions/validate-instruments", cli.session_audio_request(config))
        runtime = cli.create_compiled_runtime(api, config)
        session_id = runtime["session"]["session_id"]
        path = tmp_path / "edit.json"
        cli.save_edit_session(path, {"name": "Mixer Fixture", "description": "", "config": config,
                                    "performanceId": None, "attachedSessionId": session_id, "dirty": False})
        monkeypatch.setattr(cli, "ApiClient", lambda *args, **kwargs: api)

        def run(*args):
            assert cli.main(["--json", "--session-file", str(path), "edit", *args]) == 0
            return json.loads(capsys.readouterr().out)["result"]

        run("mixer", "strip", "set", "--binding", "$master", "--gain-db", "silence")
        run("mixer", "send", "set", "--route", "send-left", "--route", "send-right", "--gain-db", "-18", "--tap", "post")
        api.calls.clear()
        run("push-runtime")
        assert not any(method == "POST" and (p == "/sessions" or p.endswith("/compile")) for method, p in api.calls)
        desired = api.get(f"/sessions/{session_id}/mixer")["mixer"]
        assert desired["strips"]["$master"]["gainDb"] is None
        assert desired["sends"]["send-right"] == {"gainDb": -18, "tap": "post"}
        saved = cli.load_edit_session(path)["config"]
        assert saved["audioGraph"] == config["audioGraph"]
        run("commit")
        performance_id = cli.load_edit_session(path)["performanceId"]
        restored = api.get(f"/performances/{performance_id}")["config"]
        assert restored["mixer"] == saved["mixer"]
        assert restored["audioGraph"] == saved["audioGraph"]
        run("routes", "add", "--source", "lead", "--outlet", "dryl", "--target", "delay", "--inlet", "left", "--kind", "main")
        before = path.read_bytes()
        assert cli.main(["--json", "--session-file", str(path), "edit", "push-runtime"]) == 1
        assert "runtime_instruments_changed" in capsys.readouterr().err
        assert path.read_bytes() == before
        broken = copy.deepcopy(config)
        broken["audioGraph"]["routes"].append({"id": "feedback", "sourceId": "compressor", "sourcePort": "left",
            "targetId": "compressor", "targetPort": "left", "kind": "custom", "sourceStage": "strip", "targetStage": "input"})
        with pytest.raises(cli.OrchestronCliError):
            api.post("/sessions/validate-instruments", cli.session_audio_request(broken))


def test_cli_accepts_definition_library_without_song_and_rejects_expansion_overflow():
    pattern = cli.parse_pad_loop_pattern_from_cli(root_sequence=None, group_assignments=["A=1 P2"], super_group_assignments=["I=A P4"])
    assert pattern["rootSequence"] == []
    assert cli.compile_pad_loop_items(pattern, pattern["superGroups"][0]["sequence"], depth=0) == [0, -2, -4]
    track = {"activePad": 0, "padLoopEnabled": True}
    cli.apply_pad_loop_settings(track, pattern=pattern, enabled=True, repeat=False)
    assert not track["padLoopEnabled"]
    assert track["padLoopPattern"]["groups"]
    huge = {"groups": [{"id": "A", "sequence": [{"type": "pad", "padIndex": 0}] * 129}], "superGroups": []}
    with pytest.raises(cli.OrchestronCliError, match="256"):
        cli.compile_pad_loop_items(huge, [{"type": "group", "groupId": "A"}] * 2, depth=0)


def test_cli_preserves_valid_definition_colours_without_changing_music():
    raw = {"rootSequence": [{"type": "group", "groupId": "A"}],
           "groups": [{"id": "A", "sequence": [{"type": "pad", "padIndex": 0}]}], "superGroups": [],
           "definitionColors": {"pad:0": "#ABCDEF", "group:A": "#113355", "pad:8": "#123456", "super:I": "red"}}
    pattern = cli.parse_pad_loop_pattern(raw)
    assert pattern["definitionColors"] == {"pad:0": "#abcdef", "group:A": "#113355"}
    assert cli.compile_pad_loop_items(pattern, pattern["rootSequence"], depth=0) == [0]
