import copy
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from orchestron.cli import orchestron_cli as cli
from orchestron.song_model import QUARTER, SongError, empty_clip_config, validate, model, lane_for
from orchestron.song_spec import apply_song
from orchestron.song_inspect import inspect
from orchestron.song_authoring import put_lane, put_definition, put_clip, edit_occurrence
from orchestron.song_session import transaction, session_lock
from orchestron.song_transpose import edit as transpose, contributions


def song():
    return {
        "schema": "orchestron-song",
        "version": 1,
        "id": "test-song",
        "songMeter": [4, 4],
        "end": "128bar",
        "lanes": [
            {
                "id": "bass",
                "source": "sequencer",
                "channel": 2,
                "definitions": [{"id": "bass-main", "music": {"lengthBeats": 8, "steps": "s0=C3/4s s4=G3/4s"}}],
                "clips": [
                    {"id": f"section-{i}", "start": f"{i * 32}bar", "repeat": 16, "children": ["bass-main"]}
                    for i in range(4)
                ],
            },
            {
                "id": "drums",
                "source": "drummer",
                "channel": 10,
                "definitions": [
                    {"id": "groove", "music": {"lengthBeats": 8, "groove": "backbeat"}},
                    {"id": "fill", "music": {"lengthBeats": 8, "hits": "36@0:110 38@4:100"}},
                    {"id": "phrase", "kind": "group", "children": ["groove", "groove", "groove", "fill"]},
                ],
                "clips": [
                    {"id": f"drums-{i}", "start": f"{i * 32}bar", "repeat": 4, "children": ["phrase"]} for i in range(4)
                ],
            },
        ],
    }


def built():
    config, session = empty_clip_config(), {}
    apply_song(config, session, song())
    validate(config)
    return config, session


def test_compact_song_retry_and_unknown_fields():
    config, session = built()
    before = copy.deepcopy(config)
    apply_song(config, session, song())
    assert config == before
    assert len([d for l in model(config)["lanes"] for d in l["definitions"] if d["kind"] == "pattern"]) == 3
    assert len(model(config)["lanes"][0]["clips"]) == 4
    bad = song()
    bad["arrangement"] = {}
    with pytest.raises(SongError, match="Unknown field"):
        apply_song(config, session, bad)


def test_pitch_edit_reuses_music_and_local_note_variation_splits_only_one_pass():
    config, _ = built()
    target = inspect(config, view="tree", lane_id="bass", clip_id="section-0")["items"][0]["target"]
    target.pop("fingerprint")
    target.pop("revision")
    original = copy.deepcopy(lane_for(config, "bass")["definitions"][0]["payload"])
    transpose(
        config, {"target": target, "scope": "placement", "offset": {"diatonicSteps": 0, "chromaticSemitones": 12}}
    )
    assert len(lane_for(config, "bass")["definitions"]) == 1
    assert lane_for(config, "bass")["definitions"][0]["payload"] == original
    assert contributions(config, target)["effective"]["chromaticSemitones"] == 12
    result = edit_occurrence(config, target, {"music": {"lengthBeats": 8, "steps": "s0=D3"}}, "local")
    validate(config)
    assert len(lane_for(config, "bass")["definitions"]) == 2
    assert len(lane_for(config, "bass")["clips"]) == 5
    assert contributions(config, result["target"])["effective"]["chromaticSemitones"] == 12
    assert lane_for(config, "bass")["definitions"][0]["payload"] == original


def test_transaction_failure_dry_run_noop_stale_and_writer_lock(tmp_path):
    config, session = built()
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {**session, "config": config, "editRevision": 3})
    before = path.read_bytes()

    def overlap(config, session):
        return put_clip(config, "bass", {"id": "collision", "start": 0, "length": "4b", "children": ["bass-main"]})

    with pytest.raises(SongError, match="overlap"):
        transaction(path, "collision", overlap)
    assert path.read_bytes() == before
    result = transaction(path, "repeat", lambda c, s: apply_song(c, s, song()))
    assert not result["state"]["changed"]
    assert path.read_bytes() == before
    result = transaction(path, "end", lambda c, s: model(c).update(end=600 * QUARTER), dry_run=True)
    assert result["state"]["stage"] == "preview"
    assert path.read_bytes() == before
    with pytest.raises(SongError, match="revision"):
        transaction(path, "stale", lambda c, s: None, expected=2)
    with session_lock(path):
        with pytest.raises(SongError, match="Another command"):
            with session_lock(path):
                pass
    assert path.read_bytes() == before


def test_history_is_gui_format_and_round_trips(tmp_path):
    config, _ = built()
    path = tmp_path / "edit.json"
    cli.save_edit_session(path, {"config": config})
    transaction(path, "extend", lambda c, s: model(c).update(end=600 * QUARTER))
    changed = json.loads(path.read_text())["config"]
    history = changed["sequencer"]["clipHistory"]
    assert history["version"] == 2 and history["cursor"] == 1
    assert all("changes" in e and "before" not in e for e in history["entries"])
    from orchestron.song_history import replay

    transaction(path, "undo", lambda c, s: replay(c, False), history=False)
    assert json.loads(path.read_text())["config"]["sequencer"]["clipArrangement"] == model(config)
    transaction(path, "redo", lambda c, s: replay(c, True), history=False)
    assert json.loads(path.read_text())["config"] == changed


def test_subprocess_json_creation_apply_error_and_readonly_inspection(tmp_path):
    path, spec = tmp_path / "session.json", tmp_path / "song.json"
    spec.write_text(json.dumps(song()))

    def run(*args):
        return subprocess.run(
            [sys.executable, "-m", "orchestron.cli.orchestron_cli", "--json", "--session-file", str(path), *args],
            capture_output=True,
            text=True,
        )

    result = run("edit", "begin", "--new", "--offline", "--arranger", "clips", "--name", "Test")
    assert result.returncode == 0, result.stderr
    result = run("edit", "apply-song", "--file", str(spec))
    assert result.returncode == 0, result.stderr
    assert len(result.stdout.encode()) < 16 * 1024
    before = path.read_bytes()
    result = run("edit", "inspect")
    assert json.loads(result.stdout)["result"]["counts"]["patterns"] == 3
    assert path.read_bytes() == before
    result = run("edit", "absent-command")
    assert result.returncode == 2 and not result.stdout
    assert json.loads(result.stderr)["error"]["stateChanged"] is False
    result = run("edit", "apply-song", "--file", str(tmp_path / "missing.json"))
    assert result.returncode == 1 and json.loads(result.stderr)["error"]["retry"]
    assert path.read_bytes() == before


def test_authoritative_unused_payload_and_overlap_rejected():
    config, _ = built()
    config["sequencer"]["tracks"][0]["pads"] = []
    assert inspect(config, view="definitions", lane_id="bass")["items"][0]["storedSteps"] > 0
    d = copy.deepcopy(lane_for(config, "bass")["definitions"][0])
    d["id"] = "unused"
    d["payload"]["steps"][0]["timingOffsetPercent"] = 51
    lane_for(config, "bass")["definitions"].append(d)
    with pytest.raises(SongError):
        validate(config)


def test_long_loop_inspection_and_scalar_growth():
    config, _ = built()
    lane = lane_for(config, "bass")
    lane["clips"] = lane["clips"][:1]
    original_definitions = copy.deepcopy(lane["definitions"])
    put_clip(config, "bass", {"id": "section-0", "length": "800000b"})
    result = inspect(
        config, view="window", lane_id="bass", clip_id="section-0", start=0, end=800000 * QUARTER, limit=3, offset=90000
    )
    assert len(result["items"]) == 3 and result["truncated"]
    assert lane["definitions"] == original_definitions and len(lane["clips"]) == 1
