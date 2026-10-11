import copy
import json
from fractions import Fraction
from pathlib import Path

import pytest

from orchestron.cli import orchestron_cli as cli
from orchestron_composition.generators import new_phrase, validate_brief
from orchestron_composition.orchestron_export import export_score
from orchestron_composition.score import CompositionError, assemble, event, qn


def runtime_events(score):
    config = cli.empty_performance_config()
    cli.apply_score_spec_to_config(config, export_score(score))
    cli.normalize_performance_config(config, [])
    runtime = cli.build_runtime_config(json.loads(json.dumps(config)))
    events = []
    lengths = []
    for track in runtime["tracks"]:
        beat = Fraction(4, track["timing"]["meter_denominator"])
        step = beat / track["timing"]["steps_per_beat"]
        position = Fraction(0)
        for token in track["pad_loop_sequence"]:
            if token < 0:
                position -= token * beat
                continue
            pad = track["pads"][token]
            count = pad["length_beats"] * track["timing"]["steps_per_beat"]
            for i, cell in enumerate(pad["steps"][:count]):
                if cell["note"] is None:
                    continue
                duration = 1
                while i + duration < count and pad["steps"][i + duration]["hold"]:
                    duration += 1
                pitches = cell["note"] if isinstance(cell["note"], list) else [cell["note"]]
                for pitch in pitches:
                    events.append(
                        (track["midi_channel"], pitch, position + i * step, duration * step, cell["velocity"])
                    )
            position += count * step
        lengths.append(position)
    expected = [
        (p["channel"], e["pitch_midi"], qn(e["onset_qn"]), qn(e["duration_qn"]), e["velocity"])
        for p in score["parts"]
        for e in p["events"]
    ]
    assert sorted(events) == sorted(expected)
    assert all(length == qn(score["length_qn"]) for length in lengths)
    return config


def test_polyphonic_triplets_rests_and_velocities_survive_real_importer():
    score = json.loads((Path(__file__).parent / "fixtures/triplet_score.json").read_text())
    config = runtime_events(score)
    assert len(config["sequencer"]["tracks"]) == 4
    assert all(
        not isinstance(s["note"], list) for t in config["sequencer"]["tracks"] for p in t["pads"] for s in p["steps"]
    )


@pytest.mark.parametrize("meter", [[4, 4], [6, 8]])
@pytest.mark.parametrize("grid", ["straight", "triplet"])
def test_full_generated_arrangement_imports_without_timing_loss(meter, grid):
    brief = validate_brief({"meter": meter, "grid": grid})
    scores = [new_phrase(brief, i, i % 3) for i in range(6)]
    runtime_events(assemble(scores, "Full song"))


def test_more_than_eight_unique_pads_split_into_aligned_tracks():
    score = new_phrase(validate_brief({"harmony": False}), 10, 0)
    score["length_qn"] = "160"
    score["parts"][0]["events"] = [event(60 + i, Fraction(16 * i), Fraction(1), 70 + i) for i in range(10)]
    config = runtime_events(score)
    assert len(config["sequencer"]["tracks"]) == 2


def test_long_notes_move_pad_boundaries_instead_of_retriggering():
    score = new_phrase(validate_brief({"harmony": False}), 10, 0)
    score["length_qn"] = "24"
    score["parts"][0]["events"] = [event(60, Fraction(15), Fraction(3))]
    config = runtime_events(score)
    assert config["sequencer"]["tracks"][0]["pads"][0]["lengthBeats"] == 15


@pytest.mark.parametrize("bad_event", [event(60, Fraction(0), Fraction(17)), event(60, Fraction(1, 5), Fraction(1, 5))])
def test_unsupported_material_is_reported_without_silent_changes(bad_event):
    score = new_phrase(validate_brief({"harmony": False}), 10, 0)
    score["length_qn"] = "24"
    score["parts"][0]["events"] = [bad_event]
    before = copy.deepcopy(score)
    with pytest.raises(CompositionError):
        export_score(score)
    assert before == score
