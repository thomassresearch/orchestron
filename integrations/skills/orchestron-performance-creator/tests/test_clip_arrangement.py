import copy
import json
from pathlib import Path
from orchestron.cli import orchestron_cli as cli


def test_clip_score_more_than_eight_definitions_survives_cli_round_trip():
    root = Path(__file__).resolve().parents[4]
    track = json.loads((root / "backend/tests/fixtures/sequencers/score.json").read_text())["authored"]
    config = cli.empty_performance_config()
    config["version"] = 23
    config["sequencer"]["scoreTracks"] = [track]
    definitions = [{"id": f"p{i}", "kind": "pattern", "source": "score", "revision": 0, "name": f"Score {i}", "payload": copy.deepcopy(track["pads"][0])} for i in range(12)]
    model = {"version": 1, "revision": 0, "end": 40320, "lanes": [{"id": track["id"], "source": "score", "cycleTicks": None, "definitions": definitions,
        "clips": [{"id": "c", "name": "Cut", "start": 0, "offset": 10080, "length": 20160, "mode": "once", "children": [{"id": "use", "definitionId": "p11"}]}]}]}
    config["sequencer"]["clipArrangement"] = model
    restored = cli.normalize_performance_config(copy.deepcopy(config), [])
    assert restored["version"] == 23
    assert restored["sequencer"]["clipArrangement"] == model
    wire = cli.build_runtime_config(restored)
    assert len(wire["score_tracks"][0]["pads"]) == 12
    assert wire["score_tracks"][0]["clip_schedule"]["clips"][0]["content"][0]["pad"] == 11
    assert wire["playback_end_step"] == 16
    assert restored["sequencer"]["clipArrangement"] == model


def test_legacy_cli_pad_edit_cannot_write_clip_shadow_data(monkeypatch):
    import pytest
    from types import SimpleNamespace
    config = {"version": 23, "sequencer": {"clipArrangement": {"version": 1}, "tracks": [{"id": "lead", "pads": []}]}}
    monkeypatch.setattr(cli, "load_edit_session", lambda _: {"config": copy.deepcopy(config)})
    writes = []
    monkeypatch.setattr(cli, "save_edit_session", lambda *args: writes.append(args))
    with pytest.raises(cli.OrchestronCliError, match="Legacy pad commands"):
        cli.update_session_config(SimpleNamespace(session_file=None), lambda current: current["sequencer"]["tracks"][0].update(pads=[{"lengthBeats": 4}]))
    assert writes == []


def test_instrument_automation_round_trip_and_runtime_projection():
    from orchestron.clip_arrangement import project_clips
    root = Path(__file__).resolve().parents[4]
    config = json.loads((root / "backend/tests/fixtures/sequencers/instrument_automation_performance.json").read_text())
    normalized = cli.normalize_performance_config(copy.deepcopy(config), [])
    assert normalized["version"] == 24
    assert normalized["sequencer"]["clipArrangement"] == config["sequencer"]["clipArrangement"]
    runtime = cli.build_runtime_config(normalized)
    track = runtime["controller_tracks"][0]
    assert track["enabled"] is False  # Missing owner is preserved but cannot broadcast.
    assert track["automation_target"] == {"instrument_id": "one", "controller_node_ids": ["setting"]}
    assert track["pads"][0]["curve_duration_ticks"] == 512 * 20160
    assert track["clip_schedule"]["clips"][0]["content"][0]["length"] == 512 * 20160
    config["instruments"] = [{"id": "one", "patchId": "test", "midiChannel": 7, "performanceControllerMidiCCs": {"setting": 24}}]
    projected, _, _ = project_clips(config)
    assert projected["sequencer"]["controllerSequencers"][0]["targetChannels"] == [7]
    assert projected["sequencer"]["controllerSequencers"][0]["controllerNumber"] == 24
