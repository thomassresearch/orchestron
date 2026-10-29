"""Sparse Score Sequencer authoring is distinct from legacy composition-score specs."""
import argparse
import copy
import json
from pathlib import Path

import pytest
from orchestron.cli import orchestron_cli as cli

ROOT = Path(__file__).resolve().parents[4]


def fixture():
    return json.loads((ROOT / "backend/tests/fixtures/sequencers/score.json").read_text())


@pytest.mark.parametrize("version", range(1, 22))
def test_legacy_migration_and_score_runtime_round_trip(version):
    config = cli.empty_performance_config()
    config["version"] = version
    assert cli.normalize_performance_config(config, [])["sequencer"]["scoreTracks"] == []
    config["sequencer"]["scoreTracks"] = [fixture()["authored"]]
    config["version"] = 21
    restored = cli.normalize_performance_config(json.loads(json.dumps(config)), [])
    score = restored["sequencer"]["scoreTracks"][0]
    assert len(score["pads"]) == 8
    assert score["pads"][0]["notes"] == fixture()["authored"]["pads"][0]["notes"]
    runtime = cli.build_runtime_config(restored)
    assert runtime["score_tracks"][0]["pads"] == fixture()["runtime"]["pads"]
    assert runtime["playback_end_step"] == 9600


def test_add_score_command_and_invalid_edit_is_atomic(tmp_path, capsys):
    context = cli.CliContext(api_url="http://localhost:8000/api", json_output=True, debug=False, timeout=20, session_file=tmp_path / "edit.json")
    config = cli.empty_performance_config()
    cli.save_edit_session(context.session_file, {"config": config})
    spec = tmp_path / "score.json"
    spec.write_text(json.dumps(fixture()["authored"]))
    cli.command_edit_add_score_sequencer(argparse.Namespace(spec=str(spec)), context)
    assert json.loads(capsys.readouterr().out)["result"]["name"] == "Long Score"
    original = context.session_file.read_text()
    with pytest.raises(cli.OrchestronCliError):
        cli.command_edit_add_score_sequencer(argparse.Namespace(spec=str(spec)), context)
    assert context.session_file.read_text() == original
    invalid = copy.deepcopy(fixture()["authored"])
    invalid["id"] = "another"
    invalid["pads"][0]["notes"][0]["durationTicks"] = 0
    spec.write_text(json.dumps(invalid))
    with pytest.raises(cli.OrchestronCliError):
        cli.command_edit_add_score_sequencer(argparse.Namespace(spec=str(spec)), context)
    assert context.session_file.read_text() == original
