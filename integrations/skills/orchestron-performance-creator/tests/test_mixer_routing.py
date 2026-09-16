from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402


def patch(identity, *, inputs=(), outputs=("left", "right"), name=None):
    return {"id": identity, "name": name or identity, "always_on": bool(inputs),
            "audio_inlet_names": list(inputs), "audio_outlet_names": list(outputs),
            "graph": {"nodes": [{"id": f"{opcode}-{port}", "opcode": opcode, "params": {"sname": port}}
                                for opcode, ports in (("inleta", inputs), ("outleta", outputs)) for port in ports],
                      "connections": []}}


@pytest.fixture
def rack():
    patches = [patch("source-patch", outputs=("dryl", "dryr", "sendl", "sendr")),
               patch("compressor-patch", inputs=("left", "right"), name="Compressor Effect"),
               patch("delay-patch", inputs=("left", "right"), name="Delay Effect"),
               patch("insert-patch", inputs=("left", "right")),
               patch("reverb-patch", inputs=("left", "right"), name="Reverb Effect")]
    # Deliberately versioned test data, independent of the developer's demo.
    fixture = Path(__file__).parent / "fixtures/mixer_routes.json"
    return json.loads(fixture.read_text()), patches


class FakeApi:
    def __init__(self, patches):
        self.patches = patches
        self.validation_error = False

    def get(self, path):
        if path == "/patches":
            return copy.deepcopy(self.patches)
        return copy.deepcopy(next(p for p in self.patches if path == "/patches/" + p["id"]))

    def post(self, path, payload):
        assert path == "/sessions/validate-instruments", "The preset must not write patches or performances."
        if self.validation_error:
            raise cli.OrchestronCliError("backend_error", "Invalid routing")
        return {"diagnostics": [], "resolved_routes": []}


@pytest.fixture
def staged(rack, tmp_path, monkeypatch, capsys):
    config, patches = rack
    api = FakeApi(patches)
    monkeypatch.setattr(cli, "ApiClient", lambda *args, **kwargs: api)
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": config, "dirty": False})

    def run(*arguments, success=True):
        result = cli.main(["--json", "--session-file", str(path), "edit", *arguments])
        captured = capsys.readouterr()
        assert result == (0 if success else 1), captured.err
        return json.loads(captured.out if success else captured.err)

    return run, path, api


def test_strip_master_and_atomic_stereo_send_edits(staged):
    run, path, _ = staged
    original = cli.load_edit_session(path)["config"]
    run("mixer", "strip", "set", "--binding", "lead", "--gain-db", "silence", "--mute", "--solo")
    result = run("mixer", "strip", "set", "--binding", "lead", "--gain-db", "-9", "--no-mute")
    assert result["result"]["strips"]["lead"] == {"gainDb": -9, "balance": 0.25, "mute": False, "solo": True}
    run("mixer", "strip", "set", "--binding", "$master", "--gain-db", "-4", "--balance", "-1", "--mute")
    run("mixer", "send", "set", "--route", "send-left", "--route", "send-right", "--gain-db", "-20", "--tap", "post")
    saved = cli.load_edit_session(path)["config"]
    assert saved["audioGraph"] == original["audioGraph"]
    assert saved["mixer"]["strips"]["$master"] == {"gainDb": -4, "balance": -1, "mute": True, "solo": False}
    assert saved["mixer"]["sends"] == {r: {"gainDb": -20, "tap": "post"} for r in ("send-left", "send-right")}
    before = path.read_bytes()
    assert "$master" in run("mixer", "list")["result"]["strips"]
    assert path.read_bytes() == before


@pytest.mark.parametrize("arguments", [
    ["strip", "set", "--binding", "missing", "--mute"],
    ["strip", "set", "--binding", "$master", "--solo"],
    ["strip", "set", "--binding", "lead", "--gain-db", "13"],
    ["strip", "set", "--binding", "lead", "--gain-db", "-61"],
    ["strip", "set", "--binding", "lead", "--gain-db", "NaN"],
    ["strip", "set", "--binding", "lead", "--balance", "2"],
    ["strip", "set", "--binding", "lead"],
    ["send", "set", "--route", "send-left", "--route", "missing", "--gain-db", "-1"],
    ["send", "set", "--route", "dry-left", "--gain-db", "-1"],
    ["send", "set", "--route", "send-left", "--gain-db", "7"],
    ["send", "set", "--route", "send-left", "--gain-db=inf"],
])
def test_invalid_mixer_edits_preserve_draft(staged, arguments):
    run, path, _ = staged
    before = path.read_bytes()
    run("mixer", *arguments, success=False)
    assert path.read_bytes() == before


def test_main_send_coexist_list_and_exact_removal(staged):
    run, path, _ = staged
    args = ("routes", "add", "--source", "lead", "--outlet", "dryl", "--target", "delay", "--inlet", "left")
    added = run(*args, "--kind", "main")["result"]
    assert run(*args, "--kind", "main")["result"]["id"] == added["id"]
    listed = run("routes", "list", "--target", "delay")["result"]
    assert {r["kind"] for r in listed} == {"main", "send"}
    assert next(r for r in listed if r["id"] == "send-left")["send"] == {"gainDb": -12, "tap": "pre"}
    run("routes", "remove", "--id", "send-left")
    config = cli.load_edit_session(path)["config"]
    assert added["id"] in {r["id"] for r in config["audioGraph"]["routes"]}
    assert "send-left" not in config["mixer"]["sends"]
    run("routes", "remove", "--source", "lead", "--outlet", "dryl", "--target", "delay")
    assert added["id"] not in {r["id"] for r in cli.load_edit_session(path)["config"]["audioGraph"]["routes"]}


def test_new_send_defaults_and_failed_route_validation(staged):
    run, path, api = staged
    args = ("routes", "add", "--source", "lead", "--outlet", "dryl", "--target", "$master", "--inlet", "left", "--kind", "send")
    added = run(*args)["result"]
    assert cli.load_edit_session(path)["config"]["mixer"]["sends"][added["id"]] == {"gainDb": None, "tap": "post"}
    api.validation_error = True
    before = path.read_bytes()
    run("routes", "add", "--source", "lead", "--outlet", "dryr", "--target", "$master", "--inlet", "right", success=False)
    assert path.read_bytes() == before


def test_preset_preserves_bindings_mixer_inserts_and_unrelated_returns(rack):
    config, patches = rack
    config["instruments"][1]["performanceControllerValues"] = {"threshold": 0.3}
    original = copy.deepcopy(config)
    api = FakeApi(patches)
    result = cli.ensure_standard_effect_matrix(config, api, send_gain_db=-12)
    assert result["masterId"] == "$master"
    assert result["standardEffects"][1]["bindingId"] == "compressor"
    assert config["instruments"][1]["performanceControllerValues"] == {"threshold": 0.3}
    assert config["audioGraph"]["insertOwners"] == original["audioGraph"]["insertOwners"]
    assert config["mixer"]["strips"]["lead"] == original["mixer"]["strips"]["lead"]
    for route in original["audioGraph"]["routes"]:
        assert route in config["audioGraph"]["routes"]
    assert config["mixer"]["sends"]["send-left"] == {"gainDb": -12, "tap": "pre"}
    reverb_sends = [r for r in config["audioGraph"]["routes"] if r["targetId"] == cli.STANDARD_REVERB_BINDING_ID]
    assert {r["sourcePort"] for r in reverb_sends} == {"dryl", "dryr"}
    assert all(r["kind"] == "send" and config["mixer"]["sends"][r["id"]] == {"gainDb": -12, "tap": "post"} for r in reverb_sends)
    config["mixer"]["sends"][reverb_sends[0]["id"]] = {"gainDb": -18, "tap": "pre"}
    before = copy.deepcopy(config)
    cli.ensure_standard_effect_matrix(config, api, send_gain_db=-5)
    assert config == before
    restored = cli.normalize_performance_config(json.loads(json.dumps(config)), patches)
    assert restored == config
    api.validation_error = True
    with pytest.raises(cli.OrchestronCliError):
        cli.ensure_standard_effect_matrix(config, api)
    assert config == before


@pytest.mark.parametrize("merge", [False, True])
def test_preset_replaces_main_paths_and_optionally_preserves_custom(rack, merge):
    config, patches = rack
    config["audioGraph"]["routes"][0]["targetId"] = "$master"
    custom = {**config["audioGraph"]["routes"][1], "id": "custom", "kind": "custom"}
    config["audioGraph"]["routes"].append(custom)
    cli.ensure_standard_effect_matrix(config, FakeApi(patches), merge=merge)
    routes = config["audioGraph"]["routes"]
    assert not any(r["sourceId"] == "lead" and r["targetId"] == "$master" and r["kind"] == "main" for r in routes)
    assert (custom in routes) is merge


def test_speaker_option_rejected_without_any_api_calls(rack):
    config, _ = rack
    before = copy.deepcopy(config)
    with pytest.raises(cli.OrchestronCliError, match="obsolete"):
        cli.ensure_standard_effect_matrix(config, object(), speaker_patch_ref="old-output")
    assert config == before


def test_main_port_selection_prefers_metadata_and_rejects_ambiguity():
    p = patch("lead", outputs=("dryl", "dryr", "left", "right"))
    assert cli.main_stereo_ports(p, direction="output") == ["dryl", "dryr"]
    p["audio_interface"] = {"mainOutput": "main", "groups": [{"id": "main", "direction": "output", "layout": "stereo", "ports": ["right", "left"]}]}
    assert cli.main_stereo_ports(p, direction="output") == ["right", "left"]
    p = patch("ambiguous", outputs=("left", "right", "l", "r"))
    with pytest.raises(cli.OrchestronCliError, match="unambiguous"):
        cli.main_stereo_ports(p, direction="output")
    p = patch("direct", outputs=())
    p["has_direct_output"] = True
    assert cli.main_stereo_ports(p, direction="output") == ["$direct.left", "$direct.right"]


@pytest.mark.parametrize("section,maximum", [("strip", "12"), ("send", "6")])
def test_mixer_gain_boundaries_and_silence(staged, section, maximum):
    run, _, _ = staged
    selection = ("--binding", "lead") if section == "strip" else ("--route", "send-left")
    key, identity = ("strips", "lead") if section == "strip" else ("sends", "send-left")
    for value, expected in (("-60", -60), (maximum, float(maximum)), ("silence", None)):
        result = run("mixer", section, "set", *selection, "--gain-db", value)
        assert result["result"][key][identity]["gainDb"] == expected


def test_preset_ambiguous_effects_leave_original_config_unchanged(rack):
    config, patches = rack
    config["instruments"].append({"id": "another-compressor", "patchId": "compressor-patch", "midiChannel": 0})
    before = copy.deepcopy(config)
    with pytest.raises(cli.OrchestronCliError, match="Multiple rack instances"):
        cli.ensure_standard_effect_matrix(config, FakeApi(patches))
    assert config == before


def test_feedback_route_and_ambiguous_removal_leave_draft_unchanged(staged):
    run, path, _ = staged
    before = path.read_bytes()
    run("routes", "add", "--source", "compressor", "--outlet", "left", "--target", "compressor", success=False)
    assert path.read_bytes() == before
    run("routes", "remove", "--id", "send-left", "--source", "lead", success=False)
    assert path.read_bytes() == before
    run("routes", "remove", "--id", "unknown", success=False)
    assert path.read_bytes() == before
