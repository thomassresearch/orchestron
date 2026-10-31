from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402


def active_hits(track, pad_index):
    keys = {row["id"]: row["key"] for row in track["rows"]}
    return {(keys[row["rowId"]], step): cell["velocity"]
            for row in track["pads"][pad_index]["rows"]
            for step, cell in enumerate(row["steps"]) if cell["active"]}


@pytest.mark.parametrize("version", [1, 2])
def test_custom_hits_survive_save_normalize_and_runtime(version, tmp_path):
    spec = cli.load_score_spec(Path(__file__).parent / "fixtures/drummer_custom.yaml")
    spec["version"] = version
    config = cli.empty_performance_config()
    track = cli.apply_score_spec_to_config(config, spec)[0]
    assert active_hits(track, 0) == {(35, 0): 127, (38, 0): 1, (54, 17): 73}
    assert active_hits(track, 1) == {(54, 5): 91, (0, 0): 100, (127, 0): 99}
    assert active_hits(track, 2) == {}
    assert active_hits(track, 3)[36, 4] == 108
    assert all(active_hits(track, pad) == {} for pad in range(4, 8))
    assert len({r["key"] for r in track["rows"]}) == len(track["rows"])
    assert all({r["rowId"] for r in p["rows"]} == {r["id"] for r in track["rows"]} for p in track["pads"])
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": config})
    restored = cli.normalize_performance_config(cli.load_edit_session(path)["config"], [])
    assert restored["sequencer"]["drummerTracks"][0] == track
    assert restored["sequencer"]["tracks"] == restored["sequencer"]["scoreTracks"] == []
    runtime = cli.build_runtime_config(restored)
    row_id = next(r["id"] for r in track["rows"] if r["key"] == 54)
    wire = next(t for t in runtime["tracks"] if t["track_id"] == f"drumrow:drum-1:{row_id}")
    assert wire["timing"]["steps_per_beat"] == 6
    assert wire["timing"]["beat_rate_numerator"] == 3
    assert wire["pads"][0]["steps"][17] == {
        "note": 54, "hold": False, "velocity": 73, "timing_offset_percent": -20,
        "ratchets": 3, "ratchet_end_velocity": 40,
    }
    assert wire["pads"][1]["steps"][5]["velocity"] == 91
    assert wire["pads"][1]["length_beats"] == 1
    assert track["pads"][1]["stepCount"] == 6
    assert wire["pad_loop_sequence"] == [0, 1, 0, 2, 3]
    assert wire["pad_loop_repeat"] is False


def run(path, capsys, *args, ok=True):
    status = cli.main(["--json", "--session-file", str(path), "edit", *args])
    captured = capsys.readouterr()
    assert status == (0 if ok else 1), captured.err
    return json.loads(captured.out if ok else captured.err)


def test_cli_custom_pads_and_legacy_default(tmp_path, capsys):
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": cli.empty_performance_config()})
    run(path, capsys, "add-drummer", "--channel", "11", "--pad", "P2",
        "--hits", "35@0:118 38@4:101 54@15:62", "--pad-hits", "1=35@8:90",
        "--pad-hits", "3=", "--pad-groove", "4=electro", "--pad-loop", "A 3 4", "--pad-loop-group", "A=1 2")
    track = cli.load_edit_session(path)["config"]["sequencer"]["drummerTracks"][0]
    assert track["midiChannel"] == 11 and track["activePad"] == 1
    assert active_hits(track, 0) == {(35, 8): 90}
    assert active_hits(track, 1) == {(35, 0): 118, (38, 4): 101, (54, 15): 62}
    assert active_hits(track, 2) == {}
    assert active_hits(track, 3)[39, 4] == 86
    run(path, capsys, "add-drummer")
    legacy = cli.load_edit_session(path)["config"]["sequencer"]["drummerTracks"][1]
    assert active_hits(legacy, 0)[38, 12] == 116
    assert len(legacy["rows"]) == 8


@pytest.mark.parametrize("hits", [
    None, {}, [None], [{"key": True, "at_step": 0}], [{"key": "36", "at_step": 0}],
    [{"key": -1, "at_step": 0}], [{"key": 128, "at_step": 0}],
    [{"key": 36, "at_step": -1}], [{"key": 36, "at_step": 16}], [{"key": 36, "at_step": .5}],
    [{"key": 36, "at_step": True}], [{"key": 36}], [{"at_step": 0}],
    [{"key": 36, "at_step": 0, "velocty": 60}],
    [{"key": 36, "at_step": 0}, {"key": 36, "at_step": 0, "velocity": 50}],
] + [[{"key": 36, "at_step": 0, "velocity": v}] for v in [0, 128, True, "70", 70.5, None]])
def test_invalid_hits_reject_atomically(hits, tmp_path, capsys):
    config = cli.empty_performance_config()
    before = copy.deepcopy(config)
    spec = {"version": 2, "tempo": 145, "tracks": [
        {"type": "melodic", "grid_pattern": "D3"},
        {"type": "drummer", "hits": hits},
    ]}
    with pytest.raises(cli.OrchestronCliError):
        cli.apply_score_spec_to_config(config, spec)
    assert config == before
    path, source = tmp_path / "edit.json", tmp_path / "score.json"
    cli.save_edit_session(path, {"config": config, "dirty": False})
    saved = path.read_bytes()
    source.write_text(json.dumps(spec))
    error = run(path, capsys, "apply-score", str(source), ok=False)
    assert error["error"]["path"]
    assert path.read_bytes() == saved


@pytest.mark.parametrize("track", [
    {"hits": [], "groove": "backbeat"},
    {"pads": [{"pad": 1, "hits": [], "groove": "backbeat"}]},
    {"hits": [], "pads": [{"pad": 1, "hits": []}]},
    {"pads": [{"pad": 2, "hits": []}, {"pad": 2, "groove": "electro"}]},
    {"pads": [{"pad": 1, "length_beats": 1, "hits": [{"key": 54, "at_step": 4}]}]},
    {"timing": {"steps_per_beat": 2}, "hits": [{"key": 54, "at_step": 8}]},
    {"type": "melodic", "hits": []},
])
def test_conflicts_and_local_pad_boundaries_reject_atomically(track):
    config = cli.empty_performance_config()
    before = copy.deepcopy(config)
    with pytest.raises(cli.OrchestronCliError):
        cli.apply_score_spec_to_config(config, {"tracks": [{"type": "drummer", **track}]})
    assert config == before


@pytest.mark.parametrize("args", [
    ["--hits", "kick@0:115"], ["--hits", "36@0"], ["--hits", "36@0:0"],
    ["--hits", "36@16:115"], ["--hits", "36@0:115 36@0:90"],
    ["--hits", "", "--pad-groove", "1=electro"],
    ["--pad-hits", "2=36@0:115", "--pad-hits", "2=36@4:90"],
    ["--pad-hits", "9=36@0:115"], ["--pad-hits", "36@0:115"],
])
def test_cli_invalid_patterns_leave_staged_file_unchanged(args, tmp_path, capsys):
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": cli.empty_performance_config()})
    before = path.read_bytes()
    run(path, capsys, "add-drummer", *args, ok=False)
    assert path.read_bytes() == before
