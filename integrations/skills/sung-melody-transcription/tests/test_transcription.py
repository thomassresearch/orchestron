import subprocess
import sys

import mido
import numpy as np
import pytest

from sung_melody.notes import Note, acoustic_events, refine, segment
from sung_melody.output import render, write_midi
from sung_melody.pitch import decode_salience
from sung_melody.rhythm import beat_fit, parse_meter, quantize
from sung_melody.scale import fit_scales


def test_joint_scale_tuning_and_relative_key_tie():
    result = fit_scales([p+.23 for p in [60, 62, 64, 65, 67, 69, 71]])
    assert {c["name"] for c in result["tied_candidates"]} == {"C major", "A natural minor"}
    for candidate in result["tied_candidates"]:
        assert candidate["tuning_cents"] == pytest.approx(23)
        assert candidate["squared_error_cents"] < 1e-8


def test_sparse_material_reports_all_ties():
    result = fit_scales([60, 67, 72])
    assert len(result["tied_candidates"]) > 2
    assert len({(c["tonic"], c["mode"]) for c in result["all_candidates"]}) == 24


def test_tuning_bound_and_global_objective_against_dense_reference():
    pitches = np.array([60.49, 62.15, 64.68, 67.2])
    fits = fit_scales(pitches)
    for candidate in fits["all_candidates"]:
        assert -50 <= candidate["tuning_cents"] <= 50
        targets = np.array([p for p in range(45, 85) if p % 12 in candidate["pitch_classes"]])
        offsets = np.linspace(-.5, .5, 1001)
        errors = ((pitches[:, None, None]-offsets[None, :, None]-targets)**2).min(axis=2).sum(axis=0)
        assert candidate["squared_error_cents"] <= errors.min()*10000+1e-7


def test_vibrato_robust_median_and_clap_does_not_split_sustained_note():
    pitch = 69+.18*np.sin(np.arange(100)*.3)
    pitch[40] = 75  # One-frame octave-tracker glitch should not become a note.
    f0 = 440*2**((pitch-69)/12)
    notes = segment(f0, np.ones(100), np.array([.5]), np.array([.5]), [])
    assert len(notes) == 1
    assert notes[0].pitch == pytest.approx(69, abs=.05)


def test_repeated_attack_survives_refinement():
    f0 = np.full(100, 440.)
    notes = segment(f0, np.ones(100), np.array([]), np.array([.5]), [])
    assert len(refine(notes, [])) == 2


def test_short_isolated_clap_pitch_is_logged_and_removed():
    f0 = np.zeros(100)
    f0[49:54] = 440
    log = []
    assert segment(f0, np.full(100, .05), np.array([.5]), np.array([]), log) == []
    assert log[0]["kind"] == "clap_transient"


def test_strong_stable_brief_note_coincident_with_clap_is_retained():
    f0 = np.zeros(100)
    f0[49:56] = 440
    notes = segment(f0, np.ones(100), np.array([.5]), np.array([]), [])
    assert len(notes) == 1 and notes[0].pitch == 69


def test_false_split_merges_but_rest_and_repeated_attack_survive():
    log = []
    sustained = [Note("a", 0, .5, 60), Note("b", .53, 1, 60)]
    assert len(refine(sustained, log)) == 1
    assert log[0]["kind"] == "merge_false_split"
    sustained[1].attack = True
    assert len(refine(sustained, [])) == 2
    sustained[1].attack, sustained[1].start = False, .7
    assert len(refine(sustained, [])) == 2


def test_unstable_edge_scoops_removed_but_short_stable_gestures_retained():
    scoop = Note("a", 0, .07, 59, unstable=True)
    main = Note("b", .07, 1, 60)
    release = Note("c", 1, 1.06, 59, unstable=True)
    log = []
    result = refine([scoop, main, release], log)
    assert len(result) == 1 and result[0].pitch == 60
    assert {entry["kind"] for entry in log} == {"remove_onset_scoop", "remove_release_dip"}
    scoop.unstable = release.unstable = False
    assert len(refine([scoop, main, release], [])) == 3


def test_clap_pulse_with_missing_beat_and_supplied_tempo():
    claps = np.array([.2, .7, 1.2, 2.2, 2.7, 3.2])
    beat = beat_fit(claps)
    assert beat["source"] == "claps" and beat["tempo"] == pytest.approx(120)
    assert ((.2-beat["beat_zero_seconds"]) % .5) == pytest.approx(0, abs=1e-8)
    assert beat_fit(claps, 90)["tempo"] == 90
    assert beat_fit(np.array([]))["source"] == "default"


def test_joint_quantization_preserves_rest_positive_durations_nonoverlap_and_length():
    notes = [Note("a", .01, .22, 60), Note("b", .32, .49, 62), Note("c", .5, .99, 64)]
    result, length = quantize(notes, beat_fit(np.array([]), 120, 0), (4, 4), 2, "preserve", [])
    assert length == 8
    assert result[1]["start_beat"]-result[0]["end_beat"] >= .25
    for i, note in enumerate(result):
        assert note["start_beat"] < note["end_beat"] <= length
        assert note["start_beat"]/.25 == round(note["start_beat"]/.25)
        if i:
            assert note["start_beat"] >= result[i-1]["end_beat"]


def test_eighth_prior_only_tips_ambiguous_timings():
    beat = beat_fit(np.array([]), 60, 0)
    result, _ = quantize([Note("a", .63, 1.13, 60)], beat, (4, 4), 1, "preserve", [])
    assert (result[0]["start_beat"], result[0]["end_beat"]) == (.5, 1)
    result, _ = quantize([Note("a", .25, .75, 60)], beat, (4, 4), 1, "preserve", [])
    assert (result[0]["start_beat"], result[0]["end_beat"]) == (.25, .75)


@pytest.mark.parametrize("ending, expected", [("preserve", 1), ("hold", 4), ("rest", 1)])
def test_ending_and_trailing_rest(ending, expected):
    result, length = quantize([Note("a", 0, 1, 60)], beat_fit(np.array([]), 60, 0),
                              (4, 4), 1, ending, [])
    assert result[-1]["end_beat"] == expected and length == 4


def test_phrase_cropping_and_compound_meter():
    log = []
    result, length = quantize([Note("a", 0, 2.7, 60), Note("b", 3.2, 4, 62)],
                              beat_fit(np.array([]), 60, 0), parse_meter("6/8"), 1, "rest", log)
    assert length == 3 and len(result) == 1 and result[0]["end_beat"] <= 2.75
    assert any(e["kind"] == "phrase_crop" for e in log)


def test_leading_and_trailing_resolvable_rests_survive():
    result, _ = quantize([Note("a", .13, 3.87, 60)], beat_fit(np.array([]), 60, 0),
                         (4, 4), 1, "preserve", [])
    assert result[0]["start_beat"] >= .25
    assert result[0]["end_beat"] <= 3.75


def test_impossible_density_fails_instead_of_erasing_notes():
    notes = [Note(str(i), i*.01, (i+1)*.01, 60+i) for i in range(20)]
    with pytest.raises(ValueError, match="cannot fit"):
        quantize(notes, beat_fit(np.array([]), 60, 0), (1, 4), 1, "preserve", [])


def test_salience_confidence_is_not_binary_voicing():
    salience = np.zeros((2, 360))
    salience[:, 200] = [.7, .02]
    f0, confidence = decode_salience(salience)
    assert confidence.tolist() == [.7, .02]
    assert f0[0] == f0[1] and f0[0] > 0


def test_midi_note_off_precedes_retrigger_and_keeps_phrase_silence(tmp_path):
    notes = [{"id": str(i), "midi_pitch": 60, "start_beat": i, "end_beat": i+1, "velocity": 88}
             for i in range(2)]
    path = tmp_path/"melody.mid"
    write_midi(notes, 120, (6, 8), 6, path)
    midi = mido.MidiFile(path)
    events = [m for m in midi.tracks[0] if m.type.startswith("note_")]
    assert [m.type for m in events] == ["note_on", "note_off", "note_on", "note_off"]
    assert midi.length == pytest.approx(3)
    assert sum(m.time for m in midi.tracks[0]) == 6*960


def test_renderer_fails_without_substituting_synthesis(tmp_path):
    with pytest.raises(ValueError, match="FluidSynth is missing"):
        render(tmp_path/"x.mid", tmp_path/"x.wav", tmp_path/"font.sf2", "nonexistent-fluidsynth-test")
    assert not (tmp_path/"x.wav").exists()


def test_cli_help_is_standalone():
    process = subprocess.run([sys.executable, "-m", "sung_melody.cli", "transcribe", "--help"],
                             capture_output=True, text=True)
    assert process.returncode == 0 and "--soundfont" in process.stdout


def test_acoustic_claps_do_not_become_tonal_attacks():
    sr = 16000
    times = np.arange(sr*3)/sr
    audio = .1*np.sin(2*np.pi*220*times)
    rng = np.random.default_rng(4)
    for onset in [.5, 1., 1.5, 2., 2.5]:
        offset = int(onset*sr)
        audio[offset:offset+640] += .4*rng.normal(size=640)*np.exp(-np.arange(640)/120)
    claps, attacks = acoustic_events(audio, sr)
    assert len(claps) >= 4
    assert not any(np.any(abs(attacks-c) < .09) for c in claps)


def test_disabling_claps_restores_tonal_reattack_evidence():
    sr = 16000
    times = np.arange(sr*3)/sr
    audio = .1*np.sin(2*np.pi*220*times)
    audio[int(.95*sr):sr] *= .1
    audio[sr:sr+640] += .4*np.random.default_rng(4).normal(size=640)*np.exp(-np.arange(640)/120)
    claps, suppressed = acoustic_events(audio, sr)
    none, restored = acoustic_events(audio, sr, detect_claps=False)
    assert np.any(abs(claps-1) < .03)
    assert not np.any(abs(suppressed-1) < .04)
    assert len(none) == 0 and np.any(abs(restored-1) < .04)


def test_renderer_timeout_is_recoverable(tmp_path, monkeypatch):
    import sung_melody.output as output

    font = tmp_path/"font.sf2"
    font.write_bytes(b"test")
    monkeypatch.setattr(output.shutil, "which", lambda _: "/test/fluidsynth")
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("fluidsynth", 180)
    monkeypatch.setattr(output.subprocess, "run", timeout)
    with pytest.raises(ValueError, match="timed out"):
        render(tmp_path/"x.mid", tmp_path/"x.wav", font)
