from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402

SCORE = Path(__file__).parent / "fixtures" / "drummer_ratchets.yaml"


@pytest.fixture
def session(tmp_path):
    config = cli.empty_performance_config()
    cli.apply_score_spec_to_config(config, {"tracks": [
        {"type": "melodic", "grid_pattern": "C3"},
        {"type": "drummer", "pads": [{"pad": 1, "groove": "backbeat"}, {"pad": 2, "groove": "backbeat"}]},
    ]})
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": config, "dirty": False})
    return path


def run(path, capsys, *args, ok=True):
    status = cli.main(["--json", "--session-file", str(path), "edit", *args])
    captured = capsys.readouterr()
    assert status == (0 if ok else 1), captured.err
    return json.loads(captured.out if ok else captured.err)


def ratchets(path, capsys, action, *args, track="drum-1", pad="1", ok=True):
    return run(path, capsys, "ratchets", action, "--track", track, "--pad", pad, *args, ok=ok)


def config(path):
    return cli.load_edit_session(path)["config"]


def test_list_legacy_defaults_without_writing(session, capsys):
    before = session.read_bytes()
    rows = ratchets(session, capsys, "list")["result"]["steps"]
    assert len(rows) == 16 * 8
    assert all(row["ratchets"] == 1 and row["ratchetEndVelocity"] is None for row in rows)
    selected = ratchets(session, capsys, "list", "--key", "38", "--step", "4")["result"]["steps"]
    assert selected[0]["active"] is True
    assert selected[0]["velocity"] > 0
    assert selected[0]["timingOffsetPercent"] == 0
    assert session.read_bytes() == before


@pytest.mark.parametrize("count", range(1, 9))
@pytest.mark.parametrize("end_velocity", [0, 40, 100, 127])
def test_counts_and_ramps_round_trip_to_runtime(session, capsys, count, end_velocity):
    ratchets(session, capsys, "set", "--key", "38", "--step", "4", "--count", str(count), "--end-velocity", str(end_velocity))
    restored = cli.normalize_performance_config(config(session), [])
    assert restored["version"] == 18
    wire = next(t for t in cli.build_runtime_config(restored)["tracks"] if t["track_id"] == "drumrow:drum-1:drum-row-2")
    cell = wire["pads"][0]["steps"][4]
    assert (cell["ratchets"], cell["ratchet_end_velocity"]) == (count, end_velocity)
    assert cell["note"] == 38


def test_edit_explicit_pad_active_and_inactive_cells_then_reset(session, capsys):
    run(session, capsys, "step-timing", "set", "--track", "drum-1", "--pad", "2", "--key", "38", "--step", "4", "--percent", "-20")
    before = config(session)
    result = ratchets(session, capsys, "set", "--row", "drum-row-2", "--step", "4", "--step", "5", "--step", "4",
                      "--count", "4", "--end-velocity", "40", pad="P2")["result"]["steps"]
    assert [row["active"] for row in result] == [True, False]
    expected = copy.deepcopy(before)
    for index in (4, 5):
        expected["sequencer"]["drummerTracks"][0]["pads"][1]["rows"][1]["steps"][index].update(ratchets=4, ratchetEndVelocity=40)
    assert config(session) == expected
    ratchets(session, capsys, "reset", "--key", "38", "--step", "4", "--step", "5", pad="2")
    for index in (4, 5):
        expected["sequencer"]["drummerTracks"][0]["pads"][1]["rows"][1]["steps"][index].update(ratchets=1, ratchetEndVelocity=None)
    assert config(session) == expected


def test_count_only_retains_ramp_and_constant_clears_it(session, capsys):
    target = ["--key", "38", "--step", "4"]
    ratchets(session, capsys, "set", *target, "--count", "4", "--end-velocity", "0")
    for count in (1, 8):
        cell = ratchets(session, capsys, "set", *target, "--count", str(count))["result"]["steps"][0]
        assert cell["ratchets"] == count and cell["ratchetEndVelocity"] == 0
    cell = ratchets(session, capsys, "set", *target, "--count", "3", "--constant")["result"]["steps"][0]
    assert cell["ratchets"] == 3 and cell["ratchetEndVelocity"] is None
    # Timing edits preserve newly authored ratchets and ramps too.
    run(session, capsys, "step-timing", "set", "--track", "drum-1", "--pad", "1", *target, "--percent", "50")
    listed = ratchets(session, capsys, "list", *target)["result"]["steps"][0]
    assert listed["ratchets"] == 3 and listed["timingOffsetPercent"] == 50


@pytest.mark.parametrize("args", [
    ["--count", "0"], ["--count", "9"], ["--count", "1.5"], ["--count", "true"],
    ["--count", "4", "--end-velocity", "-1"], ["--count", "4", "--end-velocity", "128"],
    ["--count", "4", "--end-velocity", "4.5"], ["--count", "4", "--end-velocity", "null"],
    ["--count", "4", "--step", "16"], ["--count", "4", "--step", "-1"],
])
def test_invalid_cli_edit_is_atomic(session, capsys, args):
    before = session.read_bytes()
    result = ratchets(session, capsys, "set", "--key", "38", "--step", "4", *args, ok=False)
    assert result["error"]["path"]
    assert session.read_bytes() == before


def test_wrong_track_pad_and_ambiguous_key_are_rejected(session, capsys):
    before = session.read_bytes()
    for options in ({"track": "voice-1"}, {"track": "missing"}, {"pad": "9"}):
        ratchets(session, capsys, "set", "--key", "36", "--step", "0", "--count", "4", ok=False, **options)
        assert session.read_bytes() == before
    saved = cli.load_edit_session(session)
    saved["config"]["sequencer"]["drummerTracks"][0]["rows"][1]["key"] = 36
    cli.save_edit_session(session, saved)
    before = session.read_bytes()
    ratchets(session, capsys, "set", "--key", "36", "--step", "0", "--count", "4", ok=False)
    assert session.read_bytes() == before
    ratchets(session, capsys, "set", "--row", "drum-row-1", "--step", "0", "--count", "4")


@pytest.mark.parametrize("extra", [[], ["--key", "38", "--end-velocity", "40", "--constant"]])
def test_parser_requires_selector_and_exclusive_ramp_flags(session, capsys, extra):
    before = session.read_bytes()
    with pytest.raises(SystemExit) as caught:
        ratchets(session, capsys, "set", "--step", "4", "--count", "4", *extra)
    assert caught.value.code == 2
    assert session.read_bytes() == before


@pytest.mark.parametrize("score_format", ["yaml", "json"])
def test_score_fixture_targets_primary_and_separate_pads(session, capsys, tmp_path, score_format):
    score_path = SCORE
    if score_format == "json":
        score_path = tmp_path / "score.json"
        score_path.write_text(json.dumps(cli.load_score_spec(SCORE)))
    run(session, capsys, "apply-score", str(score_path))
    restored = cli.normalize_performance_config(config(session), [])
    track = restored["sequencer"]["drummerTracks"][-1]
    assert track["activePad"] == 1
    snare = track["pads"][1]["rows"][1]["steps"][4]
    assert (snare["ratchets"], snare["ratchetEndVelocity"], snare["timingOffsetPercent"]) == (4, 40, -20)
    assert track["pads"][0]["rows"][1]["steps"][4].get("ratchets", 1) == 1
    inactive = track["pads"][2]["rows"][1]["steps"][5]
    assert inactive["active"] is False and inactive["ratchets"] == 3 and inactive["ratchetEndVelocity"] is None
    wire = next(t for t in cli.build_runtime_config(restored)["tracks"] if t["track_id"] == "drumrow:drum-2:drum-row-2")
    assert wire["pads"][2]["steps"][4]["ratchet_end_velocity"] == 0
    assert wire["pads"][2]["steps"][5]["note"] is None


@pytest.mark.parametrize("field,value", [
    ("ratchets", 0), ("ratchets", 9), ("ratchets", 1.5), ("ratchets", True), ("ratchets", "4"), ("ratchets", None),
    ("ratchet_end_velocity", -1), ("ratchet_end_velocity", 128), ("ratchet_end_velocity", 0.5),
    ("ratchet_end_velocity", False), ("ratchet_end_velocity", "40"), ("at_step", 16), ("at_step", True),
    ("key", "38"), ("key", 1), ("ratchetEndVelocity", 40),
])
def test_invalid_score_values_leave_staged_file_unchanged(session, capsys, tmp_path, field, value):
    entry = {"at_step": 4, "key": 38, "ratchets": 4, field: value}
    score = tmp_path / "bad.json"
    score.write_text(json.dumps({"version": 1, "tempo": 140, "tracks": [
        {"grid_pattern": "G3"}, {"type": "drummer", "step_ratchets": [entry]}]}))
    before = session.read_bytes()
    result = run(session, capsys, "apply-score", str(score), ok=False)
    assert result["error"]["path"].startswith("tracks[1].step_ratchets[0]")
    assert session.read_bytes() == before


@pytest.mark.parametrize("track", [
    {"type": "drummer", "step_ratchets": {}},
    {"type": "drummer", "step_ratchets": [False]},
    {"type": "drummer", "step_ratchets": [{"at_step": 4, "ratchets": 4}]},
    {"type": "drummer", "step_ratchets": [{"at_step": 4, "key": 38}]},
    {"type": "drummer", "step_ratchets": [{"at_step": 4, "key": 38, "ratchets": 4}] * 2},
    {"type": "drummer", "step_ratchets": [{"at_step": 4, "key": 38, "ratchets": 4}], "pads": [
        {"pad": 1, "groove": "backbeat", "step_ratchets": [{"at_step": 4, "key": 38, "ratchets": 2}]}]},
    {"type": "melodic", "grid_pattern": "C3", "step_ratchets": []},
    {"type": "controller", "pads": [{"pad": 2, "step_ratchets": []}]},
    {"type": "arpeggiator", "step_ratchets": []},
])
def test_invalid_score_structure_is_atomic(session, capsys, tmp_path, track):
    score = tmp_path / "bad.json"
    score.write_text(json.dumps({"version": 1, "tracks": [track]}))
    before = session.read_bytes()
    result = run(session, capsys, "apply-score", str(score), ok=False)
    assert result["error"]["path"]
    assert session.read_bytes() == before
