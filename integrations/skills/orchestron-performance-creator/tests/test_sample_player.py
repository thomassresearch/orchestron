from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402
from orchestron.clip_arrangement import project_clips  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[4] / "backend/tests/fixtures/sample_player/performance.json"


@pytest.mark.parametrize("format", ["mp3", "m4a"])
def test_sample_maps_survive_unrelated_edit_and_runtime_projection(format):
    original = json.loads(FIXTURE.read_text())
    for asset in original["sampleAssets"].values():
        if asset["source"]["format"] == "mp3":
            asset["source"].update(format=format, stored_name=f"sam-{asset['source']['sha256']}.{format}")
    config = copy.deepcopy(original)
    config["mixer"] = {"strips": {"kit-a": {"gainDb": -6}}}
    cli.normalize_performance_config(config, [{"id": "sample-player-test", "always_on": False}])
    assert config["version"] == 27
    assert config["sequencer"]["clipArrangement"] == original["sequencer"]["clipArrangement"]
    project_clips(config)
    wire = cli.session_audio_request(config)
    assert wire["sample_assets"] == original["sampleAssets"]
    for instrument, expected in zip(wire["instruments"], original["instruments"], strict=True):
        assert instrument["sample_map"]["entries"] == [{"note": entry["note"], "asset_id": entry["assetId"]}
                                                       for entry in expected["sampleMap"]["entries"]]
    assert cli.runtime_assignments_match(config, wire)
    wire["instruments"][1]["sample_map"]["entries"] = []
    assert not cli.runtime_assignments_match(config, wire)


def test_unknown_format_and_unresolved_sample_are_rejected():
    original = json.loads(FIXTURE.read_text())
    with pytest.raises(cli.OrchestronCliError, match="version 27"):
        cli.normalize_performance_config({**original, "version": 26}, [])
    with pytest.raises(cli.OrchestronCliError, match="missing asset"):
        cli.normalize_performance_config({**original, "sampleAssets": {}}, [])
