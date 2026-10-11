from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402


def score():
    return {"version": 2, "tempo": 108, "key": "D", "mode": "dorian", "tracks": [{
        "type": "melodic", "channel": 1, "velocity": 90, "length_beats": 6,
        "timing": {"meter_numerator": 6, "meter_denominator": 8, "steps_per_beat": 3},
        "pads": [{"pad": 1, "events": [
            {"root": "D4", "at_step": 0, "duration_steps": 3, "velocity": 54},
            {"root": "F4", "at_step": 4, "duration_steps": 2, "velocity": 115},
        ]}, {"pad": 2, "events": []}], "pad_loop": {"repeat": False, "root": [1, 2, 1]},
    }]}


def test_expressive_score_preserves_timing_dynamics_rests_and_runtime():
    config = cli.empty_performance_config()
    created = cli.apply_score_spec_to_config(config, score())
    track = created[0]
    assert track["stepCount"] == 18
    assert track["timing"]["meterDenominator"] == 8
    assert config["sequencer"]["timing"]["meterDenominator"] == 4
    steps = track["pads"][0]["steps"]
    assert steps[0]["velocity"] == 54 and steps[4]["velocity"] == 115
    assert steps[1]["hold"] and steps[2]["hold"] and not steps[3]["hold"]
    cli.normalize_performance_config(config, [])
    runtime = cli.build_runtime_config(json.loads(json.dumps(config)))
    exported = runtime["tracks"][0]
    assert exported["timing"]["steps_per_beat"] == 3
    assert exported["timing"]["beat_unit"] == "meter"
    assert exported["pads"][0]["steps"][4]["velocity"] == 115
    assert exported["pad_loop_sequence"] == [0, 1, 0]
    assert not exported["pad_loop_repeat"]


def test_progression_velocity_and_legacy_score_defaults():
    config = cli.empty_performance_config()
    track = cli.apply_score_spec_to_config(config, {"tracks": [{"type": "melodic", "velocity": 93,
        "progression": [{"roman": "i", "at_step": 0, "duration_steps": 2, "velocity": 61},
                        {"roman": "iv", "at_step": 4, "duration_steps": 2}]}]})[0]
    assert track["pads"][0]["steps"][0]["velocity"] == 61
    assert track["pads"][0]["steps"][4]["velocity"] == 93
    assert track["timing"]["stepsPerBeat"] == 4


@pytest.mark.parametrize("mutation", [
    lambda s: s.update(version=3),
    lambda s: s["tracks"][0]["timing"].update(steps_per_beat=5),
    lambda s: s["tracks"][0]["timing"].update(steps_per_beat=True),
    lambda s: s["tracks"][0]["timing"].update(tempo=80),
    lambda s: s["tracks"][0]["timing"].update(beat_rate_numerator=7, beat_rate_denominator=5),
    lambda s: s["tracks"][0]["pads"][0]["events"][0].update(velocity=0),
    lambda s: s["tracks"][0]["pads"][0]["events"][0].update(velocity="60"),
    lambda s: s["tracks"][0]["pads"][0]["events"][0].update(at_step=.5),
    lambda s: s["tracks"][0]["pads"][0]["events"][0].update(duration_steps=19),
    lambda s: s["tracks"][0]["pads"][0]["events"][1].update(at_step=0),
    lambda s: s["tracks"][0]["pads"][0]["events"][1].update(at_step=2),
    lambda s: s["tracks"][0]["pads"][0]["events"][0].update(pitches=[62, 65]),
    lambda s: s["tracks"][0]["pads"][0].update(timing={"steps_per_beat": 4}),
    lambda s: s["tracks"][0]["pads"][0].update(steps="s0=C4"),
])
def test_rejected_scores_leave_config_and_staged_file_unchanged(mutation, tmp_path, capsys):
    config = cli.empty_performance_config()
    before = copy.deepcopy(config)
    invalid = score()
    mutation(invalid)
    with pytest.raises(cli.OrchestronCliError):
        cli.apply_score_spec_to_config(config, invalid)
    assert config == before
    path, spec = tmp_path / "edit.json", tmp_path / "score.json"
    cli.save_edit_session(path, {"config": config, "dirty": False})
    saved = path.read_bytes()
    spec.write_text(json.dumps(invalid))
    assert cli.main(["--json", "--session-file", str(path), "edit", "apply-score", str(spec)]) == 1
    assert json.loads(capsys.readouterr().err)["ok"] is False
    assert path.read_bytes() == saved


@pytest.mark.parametrize("kind", ["drummer", "controller"])
def test_local_timing_is_independent_for_other_sequencer_types(kind):
    config = cli.empty_performance_config()
    track = cli.apply_score_spec_to_config(config, {"tracks": [{"type": kind, "length_beats": 3,
        "timing": {"meter_numerator": 3, "steps_per_beat": 6, "beat_rate_numerator": 3, "beat_rate_denominator": 2}}]})[0]
    assert track["pads"][0]["stepCount"] == 18
    assert track["timing"]["beatRateNumerator"] == 3
    assert config["sequencer"]["timing"]["beatRateNumerator"] == 1
