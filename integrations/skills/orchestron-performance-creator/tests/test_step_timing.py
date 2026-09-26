from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402


@pytest.fixture
def session(tmp_path):
    config = cli.empty_performance_config()
    cli.apply_score_spec_to_config(config, {"tracks": [
        {"type": "melodic", "channel": 2, "grid_pattern": "C3 _ . G3", "pads": [{"pad": 2, "grid_pattern": "F3 _ . A3"}]},
        {"type": "drummer", "groove": "backbeat"},
    ]})
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": config, "dirty": False})
    return path


def run(path, capsys, *args, ok=True):
    result = cli.main(["--json", "--session-file", str(path), "edit", *args])
    captured = capsys.readouterr()
    assert result == (0 if ok else 1), captured.err
    return json.loads(captured.out if ok else captured.err)


def config(path):
    return cli.load_edit_session(path)["config"]


def timing(path, capsys, operation, *args, track="voice-1", pad="1", ok=True):
    return run(path, capsys, "step-timing", operation, "--track", track, "--pad", pad, *args, ok=ok)


def test_discovery_and_read_only_listing(session, capsys):
    before = session.read_bytes()
    found = run(session, capsys, "sequencers", "list")["result"]["sequencers"]
    assert [(x["id"], x["type"]) for x in found] == [("voice-1", "melodic"), ("drum-1", "drummer")]
    assert found[0]["pads"][0] == {"pad": 1, "stepCount": 16, "lengthBeats": 4}
    assert found[1]["rows"][0] == {"id": "drum-row-1", "key": 36}
    rows = timing(session, capsys, "list")["result"]["steps"]
    assert len(rows) == 16 and rows[0]["note"] == 48 and rows[1]["hold"] is True
    drum_rows = timing(session, capsys, "list", track="drum-1")["result"]["steps"]
    assert len(drum_rows) == 16 * 8
    assert all(row["timingOffsetPercent"] == row["timingOffsetMilliseconds"] == 0 for row in rows + drum_rows)
    assert session.read_bytes() == before


def test_edit_nonactive_pad_preserves_everything_else_and_resets(session, capsys):
    before = config(session)
    result = timing(session, capsys, "set", "--step", "0", "--step", "1", "--percent", "-20", pad="P2")["result"]
    assert [row["timingOffsetMilliseconds"] for row in result["steps"]] == [-25, -25]
    expected = copy.deepcopy(before)
    for index in (0, 1):
        expected["sequencer"]["tracks"][0]["pads"][1]["steps"][index]["timingOffsetPercent"] = -20
    assert config(session) == expected
    timing(session, capsys, "reset", "--step", "0", "--step", "1", pad="2")
    assert all(config(session)["sequencer"]["tracks"][0]["pads"][1]["steps"][index]["timingOffsetPercent"] == 0 for index in (0, 1))


def test_drum_hit_and_inactive_cell_preserve_activation_and_velocity(session, capsys):
    before = config(session)
    result = timing(session, capsys, "set", "--key", "38", "--step", "4", "--step", "5", "--percent", "50", track="drum-1")["result"]
    assert [row["active"] for row in result["steps"]] == [True, False]
    assert [row["timingOffsetMilliseconds"] for row in result["steps"]] == [62.5, 62.5]
    expected = copy.deepcopy(before)
    for index in (4, 5):
        expected["sequencer"]["drummerTracks"][0]["pads"][0]["rows"][1]["steps"][index]["timingOffsetPercent"] = 50
    assert config(session) == expected
    reset = timing(session, capsys, "reset", "--row", "drum-row-2", "--step", "4", track="drum-1")["result"]
    assert reset["steps"][0]["timingOffsetPercent"] == 0


@pytest.mark.parametrize("args", [
    ["--step", "0", "--step", "16", "--percent", "20"],
    ["--step", "-1", "--percent", "20"],
    ["--step", "1.5", "--percent", "20"],
    ["--step", "0", "--percent", "-51"],
    ["--step", "0", "--percent", "51"],
    ["--step", "0", "--percent", "2.5"],
    ["--step", "0", "--percent", "true"],
    ["--step", "0", "--percent", "20", "--key", "36"],
])
def test_invalid_edit_is_structured_and_atomic(session, capsys, args):
    before = session.read_bytes()
    result = timing(session, capsys, "set", *args, ok=False)
    assert result["ok"] is False and result["error"]["path"]
    assert session.read_bytes() == before


def test_missing_and_ambiguous_selectors(session, capsys):
    before = session.read_bytes()
    for track, extra in (("missing", []), ("drum-1", []), ("drum-1", ["--row", "missing"]), ("drum-1", ["--key", "1"])):
        timing(session, capsys, "set", "--step", "0", "--percent", "10", *extra, track=track, ok=False)
        assert session.read_bytes() == before
    timing(session, capsys, "list", pad="9", ok=False)
    saved = cli.load_edit_session(session)
    saved["config"]["sequencer"]["drummerTracks"][0]["rows"][1]["key"] = 36
    cli.save_edit_session(session, saved)
    before = session.read_bytes()
    timing(session, capsys, "set", "--key", "36", "--step", "0", "--percent", "10", track="drum-1", ok=False)
    assert session.read_bytes() == before
    timing(session, capsys, "set", "--row", "drum-row-1", "--step", "0", "--percent", "-50", track="drum-1")


def test_milliseconds_follow_global_tempo_local_grid_and_ratio_and_mirror(session, capsys):
    saved = cli.load_edit_session(session)
    seq = saved["config"]["sequencer"]
    seq["timing"]["tempoBPM"] = 60
    track = seq["tracks"][0]
    track["timing"] = {**track["timing"], "tempoBPM": 200, "stepsPerBeat": 8, "beatRateNumerator": 3, "beatRateDenominator": 2}
    track["steps"] = copy.deepcopy(track["pads"][0]["steps"])
    cli.save_edit_session(session, saved)
    result = timing(session, capsys, "set", "--step", "0", "--percent", "-30")["result"]
    assert result["steps"][0]["timingOffsetMilliseconds"] == -25
    restored = config(session)["sequencer"]["tracks"][0]
    assert restored["steps"] == restored["pads"][0]["steps"]


def test_score_patterns_events_progressions_and_drum_pads_round_trip(session, capsys, tmp_path):
    score = {"tracks": [
        {"type": "melodic", "channel": 2, "step_timing": [{"at_step": 3, "timing_offset_percent": -20}], "pads": [
            {"pad": 1, "grid_pattern": "C3 _ . G3"},
            {"pad": 2, "events": [{"at_step": 0, "root": "D3", "duration_steps": 4, "timing_offset_percent": 25}]},
            {"pad": 3, "progression": ["i", {"roman": "IV", "timing_offset_percent": -50}]},
            {"pad": 4, "steps": "s0=C3/4s", "step_timing": [{"at_step": 0, "timing_offset_percent": 50}]},
        ]},
        {"type": "drummer", "step_timing": [{"key": 38, "at_step": 4, "timing_offset_percent": 15}], "pads": [
            {"pad": 1, "groove": "backbeat"},
            {"pad": 2, "groove": "electro", "step_timing": [{"key": 36, "at_step": 0, "timing_offset_percent": -10}]},
        ]},
    ]}
    spec = tmp_path / "score.json"
    spec.write_text(json.dumps(score))
    run(session, capsys, "apply-score", str(spec))
    restored = cli.normalize_performance_config(config(session), [])
    melody = restored["sequencer"]["tracks"][1]
    assert [melody["pads"][p]["steps"][s]["timingOffsetPercent"] for p, s in ((0, 3), (1, 0), (2, 4), (3, 0))] == [-20, 25, -50, 50]
    assert melody["pads"][1]["steps"][1]["hold"] is True
    assert melody["pads"][1]["steps"][1].get("timingOffsetPercent", 0) == 0
    runtime = cli.build_runtime_config(restored)
    lead = next(t for t in runtime["tracks"] if t["track_id"] == melody["id"])
    assert lead["pads"][2]["steps"][4]["timing_offset_percent"] == -50
    snare = next(t for t in runtime["tracks"] if t["track_id"] == "drumrow:drum-2:drum-row-2")
    assert snare["pads"][0]["steps"][4]["timing_offset_percent"] == 15
    drums = restored["sequencer"]["drummerTracks"][1]
    assert drums["pads"][1]["rows"][0]["steps"][0]["timingOffsetPercent"] == -10
    assert restored["version"] == 18


@pytest.mark.parametrize("offset", [-51, 51, 1.5, True, "20", None])
def test_score_strict_offset_validation(offset):
    with pytest.raises(cli.OrchestronCliError) as caught:
        cli.apply_score_spec_to_config(cli.empty_performance_config(), {"tracks": [{"events": [
            {"root": "C3", "timing_offset_percent": offset}]}]})
    assert caught.value.path.endswith("timing_offset_percent")


@pytest.mark.parametrize("track", [
    {"grid_pattern": "C3", "step_timing": [{"at_step": 16, "timing_offset_percent": 10}]},
    {"grid_pattern": "C3", "step_timing": [{"at_step": 1.5, "timing_offset_percent": 10}]},
    {"grid_pattern": "C3", "step_timing": [{"at_step": 0, "timing_offset_percent": 10}] * 2},
    {"events": [{"root": "C3", "timing_offset_percent": 0}], "step_timing": [{"at_step": 0, "timing_offset_percent": 10}]},
    {"events": [{"root": "C3", "at_step": -1, "timing_offset_percent": 10}]},
    {"grid_pattern": "C3", "step_timing": {}},
    {"grid_pattern": "C3", "step_timing": [False]},
    {"grid_pattern": "C3", "step_timing": [{"at_step": 0}]},
    {"type": "drummer", "step_timing": [{"at_step": 0, "timing_offset_percent": 10}]},
    {"type": "drummer", "step_timing": [{"at_step": 0, "key": 1, "timing_offset_percent": 10}]},
    {"steps": "s0=C3", "events": [{"root": "C3", "timing_offset_percent": 10}]},
    {"step_timing": [{"at_step": 0, "timing_offset_percent": 10}], "pads": [
        {"pad": 1, "grid_pattern": "C3", "step_timing": [{"at_step": 0, "timing_offset_percent": 20}]}]},
])
def test_score_failure_does_not_write_partial_tracks_or_offsets(session, capsys, tmp_path, track):
    spec = tmp_path / "bad.json"
    spec.write_text(json.dumps({"tempo": 140, "tracks": [{"grid_pattern": "G3"}, track]}))
    before = session.read_bytes()
    result = run(session, capsys, "apply-score", str(spec), ok=False)
    assert result["error"]["path"]
    assert session.read_bytes() == before


def test_yaml_and_legacy_missing_offsets(tmp_path):
    spec = tmp_path / "score.yaml"
    spec.write_text('tracks:\n  - type: melodic\n    events:\n      - root: C3\n        timing_offset_percent: -20\n')
    performance = cli.empty_performance_config()
    track = cli.apply_score_spec_to_config(performance, cli.load_score_spec(spec))[0]
    assert track["pads"][0]["steps"][0]["timingOffsetPercent"] == -20
    del track["pads"][0]["steps"][0]["timingOffsetPercent"]
    targets = cli.step_timing_targets(track, "melodic", 0, [0])
    assert cli.step_timing_result(performance, track, "melodic", targets)["steps"][0]["timingOffsetPercent"] == 0
    assert cli.build_runtime_config(performance)["tracks"][0]["pads"][0]["steps"][0]["timing_offset_percent"] == 0
