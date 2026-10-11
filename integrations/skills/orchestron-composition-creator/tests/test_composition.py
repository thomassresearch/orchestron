import copy
import json
from fractions import Fraction
from pathlib import Path
import wave

import mido
import numpy as np
import pytest
from music21 import note, scale, stream

from orchestron_composition import session
from orchestron_composition.generators import develop, new_phrase, validate_brief
from orchestron_composition.preview import render
from orchestron_composition.score import CompositionError, assemble, qn
from orchestron_composition.vendor.arvo import isorhythm, minimalism, tintinnabuli, transformations


@pytest.fixture
def score():
    return json.loads((Path(__file__).parent / "fixtures/triplet_score.json").read_text())


def test_arvo_compatibility_preserves_pitches_and_operates_without_deprecations():
    import warnings

    melody = stream.Stream([note.Note(p) for p in ["C4", "D4", "E4"]])
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        assert [n.pitch.midi for n in transformations.scalar_transposition(melody, 1, scale.MajorScale("C4"))] == [
            62,
            64,
            65,
        ]
        assert [n.pitch.midi for n in transformations.scalar_inversion(melody, "C4", scale.MajorScale("C4"))] == [
            60,
            59,
            57,
        ]
        assert [n.pitch.midi for n in transformations.retrograde(melody)] == [64, 62, 60]
        assert [n.pitch.midi for n in transformations.octave_shift(melody, 1)] == [72, 74, 76]
        assert len(isorhythm.create_isorhythm(["C4", "E4"], [Fraction(1, 3)], length=6).notes) == 6
        for process in (minimalism.additive_process, minimalism.subtractive_process, minimalism.scanning_process):
            assert len(process(melody, iterations_end=2).flatten().notes) > 0
        assert len(tintinnabuli.create_t_voice(melody, ["C", "E", "G"]).notes) == 3
    assert [n.pitch.midi for n in melody] == [60, 62, 64]


@pytest.mark.parametrize("meter", [[4, 4], [6, 8], [3, 4]])
@pytest.mark.parametrize("grid", ["straight", "triplet"])
def test_generation_is_reproducible_and_bounded(meter, grid):
    brief = validate_brief({"meter": meter, "grid": grid})
    one = new_phrase(brief, 52, 1)
    assert one == new_phrase(brief, 52, 1)
    assert one != new_phrase(brief, 53, 1)
    assert all(brief["low"] <= n["pitch_midi"] <= brief["high"] for n in one["parts"][0]["events"])
    assert qn(one["length_qn"]) == 2 * meter[0] * Fraction(4, meter[1])


@pytest.mark.parametrize(
    "operation",
    ["vary", "answer", "invert", "retrograde", "isorhythm", "additive", "subtractive", "scan", "tintinnabuli"],
)
def test_development_preserves_rhythm_rests_and_locked_notes(score, operation):
    original = copy.deepcopy(score)
    result = develop(score, validate_brief({}), 22, operation, [{"start_qn": "0", "end_qn": "1"}])
    assert result["parts"][0]["events"][:2] == score["parts"][0]["events"][:2]
    assert [(n["onset_qn"], n["duration_qn"]) for n in result["parts"][0]["events"]] == [
        (n["onset_qn"], n["duration_qn"]) for n in score["parts"][0]["events"]
    ]
    assert result["parts"][1:] == score["parts"][1:]
    assert score == original


def test_session_review_restart_branching_and_undo(tmp_path):
    session.create(tmp_path, {}, 42)
    ids = session.generate(tmp_path)
    with pytest.raises(CompositionError, match="Select Keep"):
        session.generate(tmp_path, parent_id=ids[0])
    session.review(tmp_path, ids[0], "favourite", "Keep the opening", [{"start_qn": "0", "end_qn": "2"}])
    saved = session.load(tmp_path)
    children = session.generate(tmp_path, parent_id=ids[0])
    loaded = session.load(tmp_path)
    assert loaded["candidates"][ids[0]] == saved["candidates"][ids[0]]
    assert all(loaded["candidates"][i]["parents"] == [ids[0]] for i in children)
    assert all(loaded["candidates"][i]["review"]["locks"] == [{"start_qn": "0", "end_qn": "2"}] for i in children)
    restored = session.undo(tmp_path)
    assert restored["candidates"] == saved["candidates"]
    before = (tmp_path / "session.json").read_bytes()
    with pytest.raises(CompositionError, match="session changed"):
        session.review(tmp_path, ids[0], "reject", "", [], revision=0)
    assert (tmp_path / "session.json").read_bytes() == before


def test_combination_continuation_and_arrangement_preserve_identity(score):
    brief = validate_brief({})
    continued = develop(score, brief, 55, "continue", [])
    assert qn(continued["length_qn"]) == 16
    assert continued["parts"][0]["events"][:4] == score["parts"][0]["events"]
    arrangement = assemble([score, score, score], "Three phrases")
    assert len(arrangement["sections"]) == 3 and arrangement["length_qn"] == "24"
    assert arrangement["parts"][0]["events"][4]["onset_qn"] == "8"


def test_imported_revision_inherits_locks_and_rejects_changed_notes_or_silence(tmp_path, score):
    session.create(tmp_path, {k: score[k] for k in ("tempo", "key", "mode", "meter")}, 42)
    parent = session.import_candidate(tmp_path, score)
    locks = [{"start_qn": "0", "end_qn": "2"}]
    session.review(tmp_path, parent, "keep", "Protect this passage", locks)
    revised = copy.deepcopy(score)
    revised["parts"][0]["events"][-1]["velocity"] = 65
    child = session.import_candidate(tmp_path, revised, parent)
    saved = session.load(tmp_path)
    assert saved["candidates"][child]["parents"] == [parent]
    assert saved["candidates"][child]["review"]["locks"] == locks
    before = (tmp_path / "session.json").read_bytes()
    changed = copy.deepcopy(revised)
    changed["parts"][0]["events"][0]["velocity"] = 64
    with pytest.raises(CompositionError, match="locked melody"):
        session.import_candidate(tmp_path, changed, parent)
    changed = copy.deepcopy(revised)
    changed["parts"][0]["events"].append({"pitch_midi": 61, "onset_qn": "5/3", "duration_qn": "1/3", "velocity": 88})
    with pytest.raises(CompositionError, match="locked melody"):
        session.import_candidate(tmp_path, changed, parent)
    assert (tmp_path / "session.json").read_bytes() == before


def test_midi_audio_and_musicxml_are_playable(score, tmp_path):
    result = render(score, tmp_path)
    assert result["renderer"] == "builtin-midi-synth"
    midi = mido.MidiFile(tmp_path / "mix.mid")
    attacks = [m for track in midi.tracks for m in track if m.type == "note_on" and m.velocity]
    assert sorted((m.note, m.velocity) for m in attacks) == sorted(
        (e["pitch_midi"], e["velocity"]) for p in score["parts"] for e in p["events"]
    )
    with wave.open(str(tmp_path / "mix.wav")) as audio:
        assert audio.getnframes() / audio.getframerate() >= float(qn(score["length_qn"])) * 60 / score["tempo"]
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2")
        assert np.max(np.abs(samples)) > 100
    from music21 import converter

    assert len(converter.parse(tmp_path / "score.musicxml").parts) == 2
