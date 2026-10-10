import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli


def test_strum_config_and_runtime_round_trip():
    step = {'note': 60, 'chord': 'maj', 'strumDirection': 'down', 'strumSpreadPercent': 100}
    config = {'version': 18, 'instruments': [], 'sequencer': {'tracks': [
        {'id': 'lead', 'midiChannel': 1, 'pads': [{'steps': [step]}]}]}}
    restored = cli.normalize_performance_config(config, [])
    assert restored['version'] == 19
    assert restored['sequencer']['tracks'][0]['pads'][0]['steps'][0] == step
    runtime = cli.build_runtime_config(restored)['tracks'][0]['pads'][0]['steps'][0]
    assert runtime['strum_direction'] == 'down'
    assert runtime['strum_spread_percent'] == 100
    step['note'] = None
    assert cli.build_runtime_config(restored)['tracks'][0]['pads'][0]['steps'][0]['strum_spread_percent'] == 100


@pytest.mark.parametrize('values', [{'strumDirection': 'random'}, {'strumSpreadPercent': 101},
                                   {'strumSpreadPercent': True}, {'strumSpreadPercent': 1.5}])
def test_strum_validation(values):
    with pytest.raises(cli.OrchestronCliError, match='strum'):
        cli.normalize_performance_config({'version': 19, 'instruments': [], 'sequencer': {
            'tracks': [{'pads': [{'steps': [values]}]}]}}, [])


@pytest.fixture
def session(tmp_path):
    config = cli.empty_performance_config()
    cli.apply_score_spec_to_config(config, {"tracks": [
        {"pads": [{"pad": 1, "steps": "s0=C3:maj/4s s4=F3:min7/4s"},
                  {"pad": 2, "grid_pattern": "G3:maj G3 . _"}]},
        {"type": "drummer", "groove": "backbeat"},
        {"type": "controller"},
        {"type": "arpeggiator"},
    ]})
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": config, "dirty": False})
    return path


def run(path, capsys, *args, ok=True):
    status = cli.main(["--json", "--session-file", str(path), "edit", *args])
    captured = capsys.readouterr()
    assert status == (0 if ok else 1), captured.err
    return json.loads(captured.out if ok else captured.err)


def strum(path, capsys, action, *args, track="voice-1", pad="1", ok=True):
    return run(path, capsys, "strum", action, "--track", track, "--pad", pad, *args, ok=ok)


def config(path):
    return cli.load_edit_session(path)["config"]


def test_list_defaults_is_read_only_and_explicit_steps_are_deduplicated(session, capsys):
    before = session.read_bytes()
    rows = strum(session, capsys, "list")["result"]["steps"]
    assert len(rows) == 16
    assert all((row["strumDirection"], row["strumSpreadPercent"], row["strumSpreadMilliseconds"], row["strumActive"])
               == ("off", 0, 0, False) for row in rows)
    selected = strum(session, capsys, "list", "--step", "4", "--step", "0", "--step", "4")["result"]["steps"]
    assert [row["step"] for row in selected] == [4, 0]
    assert selected[0]["chord"] == "min7"
    assert session.read_bytes() == before


@pytest.mark.parametrize("direction", ["off", "up", "down"])
@pytest.mark.parametrize("spread", [0, 40, 100])
def test_set_round_trips_to_runtime_without_changing_notes(session, capsys, direction, spread):
    before = config(session)
    row = strum(session, capsys, "set", "--step", "0", "--direction", direction, "--spread", str(spread))["result"]["steps"][0]
    assert row["strumActive"] == (direction != "off" and spread > 0)
    assert row["strumSpreadMilliseconds"] == spread * 1.25
    expected = copy.deepcopy(before)
    track = expected["sequencer"]["tracks"][0]
    track["pads"][0]["steps"][0].update(strumDirection=direction, strumSpreadPercent=spread)
    if "steps" in track:
        track["steps"] = copy.deepcopy(track["pads"][0]["steps"])
    assert config(session) == expected
    restored = cli.normalize_performance_config(config(session), [])
    wire = cli.build_runtime_config(restored)["tracks"][0]["pads"][0]["steps"][0]
    assert restored["version"] == 19
    assert (wire["strum_direction"], wire["strum_spread_percent"], wire["note"]) == (direction, spread, [48, 52, 55])


def test_partial_edits_and_reset_preserve_material_timing_and_other_pads(session, capsys):
    run(session, capsys, "step-timing", "set", "--track", "voice-1", "--pad", "2", "--step", "0", "--percent", "-20")
    before = config(session)
    selected = ["--step", "0", "--step", "1", "--step", "2", "--step", "3"]
    rows = strum(session, capsys, "set", *selected, "--direction", "down", "--spread-percent", "100", pad="P2")["result"]["steps"]
    assert [row["strumActive"] for row in rows] == [True, False, False, False]
    rows = strum(session, capsys, "set", *selected, "--direction", "off", pad="2")["result"]["steps"]
    assert all(row["strumSpreadPercent"] == 100 and not row["strumActive"] for row in rows)
    strum(session, capsys, "set", *selected, "--spread", "40", pad="2")
    rows = strum(session, capsys, "set", *selected, "--direction", "up", pad="2")["result"]["steps"]
    assert all(row["strumSpreadPercent"] == 40 for row in rows)
    strum(session, capsys, "reset", *selected, pad="2")
    expected = copy.deepcopy(before)
    for index in range(4):
        expected["sequencer"]["tracks"][0]["pads"][1]["steps"][index].update(strumDirection="off", strumSpreadPercent=0)
    assert config(session) == expected
    assert rows[0]["timingOffsetPercent"] == -20


def test_milliseconds_follow_global_tempo_and_local_meter_grid_and_ratio(session, capsys):
    saved = cli.load_edit_session(session)
    saved["config"]["sequencer"]["timing"]["tempoBPM"] = 90
    saved["config"]["sequencer"]["tracks"][0]["timing"].update(
        tempoBPM=170, meterDenominator=8, stepsPerBeat=6, beatRateNumerator=3, beatRateDenominator=2)
    cli.save_edit_session(session, saved)
    row = strum(session, capsys, "set", "--step", "0", "--direction", "up", "--spread", "100")["result"]["steps"][0]
    assert row["strumSpreadMilliseconds"] == pytest.approx(60000 / 90 / 2 / 6 * 2 / 3)


@pytest.mark.parametrize("args", [[], ["--direction", "random"], ["--direction", "UP"],
    ["--spread", "-1"], ["--spread", "101"], ["--spread", "1.5"], ["--spread", "true"],
    ["--spread", "null"], ["--spread", "50", "--step", "16"], ["--spread", "50", "--step", "-1"]])
def test_invalid_cli_changes_are_atomic(session, capsys, args):
    before = session.read_bytes()
    result = strum(session, capsys, "set", "--step", "0", *args, ok=False)
    assert result["error"]["path"]
    assert session.read_bytes() == before


@pytest.mark.parametrize("options", [{"track": "drum-1"}, {"track": "cc-1"}, {"track": "arp-1"},
                                       {"track": "missing"}, {"pad": "9"}])
def test_wrong_track_or_pad_is_atomic(session, capsys, options):
    before = session.read_bytes()
    strum(session, capsys, "set", "--step", "0", "--spread", "40", ok=False, **options)
    assert session.read_bytes() == before


@pytest.mark.parametrize("action", ["set", "reset"])
def test_mutations_require_explicit_step_selection(session, capsys, action):
    before = session.read_bytes()
    with pytest.raises(SystemExit) as caught:
        strum(session, capsys, action)
    assert caught.value.code == 2
    assert session.read_bytes() == before


@pytest.mark.parametrize("score_format", ["yaml", "json"])
def test_score_fixture_applies_track_pad_event_and_progression_strums(session, capsys, tmp_path, score_format):
    score = Path(__file__).parent / "fixtures" / "melodic_strum.yaml"
    if score_format == "json":
        contents = cli.load_score_spec(score)
        score = tmp_path / "score.json"
        score.write_text(json.dumps(contents))
    run(session, capsys, "apply-score", str(score))
    track = config(session)["sequencer"]["tracks"][-1]
    assert track["activePad"] == 1
    assert track["pads"][0]["steps"][0].get("strumDirection", "off") == "off"
    wire = cli.build_runtime_config(cli.normalize_performance_config(config(session), []))["tracks"][1]
    for pad, step, direction, spread, timing in [(1, 0, "up", 40, 0), (1, 4, "down", 100, -20),
                                               (2, 4, "down", 75, 0), (2, 8, "up", 100, 0), (3, 0, "up", 100, 25)]:
        cell = wire["pads"][pad]["steps"][step]
        assert (cell["strum_direction"], cell["strum_spread_percent"], cell["timing_offset_percent"]) == (direction, spread, timing)
    assert wire["pads"][2]["steps"][8]["note"] is None
    assert wire["pads"][3]["steps"][1]["hold"] is True


@pytest.mark.parametrize("field,value", [
    ("strum_direction", "random"), ("strum_direction", True), ("strum_direction", None),
    ("strum_spread_percent", -1), ("strum_spread_percent", 101), ("strum_spread_percent", 0.5),
    ("strum_spread_percent", False), ("strum_spread_percent", "40"), ("strum_spread_percent", None),
    ("at_step", 16), ("at_step", True), ("at_step", "0"), ("strumDirection", "up"),
])
def test_invalid_score_values_are_atomic(session, capsys, tmp_path, field, value):
    entry = {"at_step": 0, "strum_direction": "up", "strum_spread_percent": 40, field: value}
    score = tmp_path / "bad.json"
    score.write_text(json.dumps({"tempo": 150, "tracks": [{"grid_pattern": "C3:maj", "step_strum": [entry]}]}))
    before = session.read_bytes()
    result = run(session, capsys, "apply-score", str(score), ok=False)
    assert result["error"]["path"].startswith("tracks[0].step_strum[0]")
    assert session.read_bytes() == before


@pytest.mark.parametrize("track", [
    {"grid_pattern": "C3:maj", "step_strum": {}},
    {"grid_pattern": "C3:maj", "step_strum": [False]},
    {"grid_pattern": "C3:maj", "step_strum": [{"at_step": 0}]},
    {"grid_pattern": "C3:maj", "step_strum": [{"strum_direction": "up"}]},
    {"grid_pattern": "C3:maj", "strum_direction": "up"},
    {"grid_pattern": "C3:maj", "step_strum": [{"at_step": 0, "strum_direction": "up"}] * 2},
    {"step_strum": [{"at_step": 0, "strum_direction": "up"}], "pads": [{"pad": 1, "events": [
        {"root": "C3", "chord": "maj", "strum_spread_percent": 40}]}]},
    {"steps": "s0=C3:maj/1s", "events": [{"root": "G3", "strum_direction": "up"}]},
    {"events": [{"root": "C3"}], "progression": [{"roman": "I", "strum_direction": "up"}]},
    {"type": "drummer", "step_strum": []},
    {"type": "controller", "pads": [{"pad": 2, "step_strum": []}]},
    {"type": "arpeggiator", "step_strum": []},
    {"type": "drummer", "events": [{"root": "C3", "strum_direction": "up"}]},
])
def test_invalid_score_structure_is_atomic(session, capsys, tmp_path, track):
    score = tmp_path / "bad.json"
    score.write_text(json.dumps({"tracks": [track]}))
    before = session.read_bytes()
    result = run(session, capsys, "apply-score", str(score), ok=False)
    assert result["error"]["path"]
    assert session.read_bytes() == before
