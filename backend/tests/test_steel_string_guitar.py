"""Behavioral DSP regressions use immutable guitar fixtures, never examples."""

import re

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, render, note_events, fundamental, periodic_pitch, rms


def guitar(variant="legato"):
    return load_patch_fixture("steel_string_guitar_" + variant)


def state(trace, time, mode="host", instance=0):
    return trace[round(time * 48000 / (16 if mode == "host" else 1)), instance]


def midi_pitch(hz):
    return 69 + 12 * np.log2(hz / 440)


@pytest.mark.parametrize("mode", ["host", "midi", "score"])
def test_fret_steps_preserve_pluck_and_gap_rearticulates(mode):
    artifact, targets = compile_guitars([guitar()], mode=mode)
    notes = [(.1, 52, 64, .4), (.5, 59, 127, 1), (1.5, 47, 32, 1), (2.6, 64, 96, .2)]
    audio, trace = render(artifact, targets, note_events(notes), 3.2, mode=mode, trace=True)
    block = 16 if mode == "host" else 1
    active = trace[round(.1 * 48000 / block):round(2.5 * 48000 / block), 0]
    pitches = midi_pitch(active[:, 0])
    np.testing.assert_allclose(pitches, np.round(pitches), atol=1e-8)
    for start, end, expected in [(.5, 1.5, np.arange(52, 60)), (1.5, 2.5, np.arange(47, 60))]:
        section = trace[round(start * 48000 / block):round(end * 48000 / block), 0, 0]
        np.testing.assert_array_equal(np.unique(np.round(midi_pitch(section))), expected)
    assert state(trace, .1, mode)[0] == pytest.approx(440 * 2 ** ((52 - 69) / 12))
    assert state(trace, 1.4, mode)[1:4] == pytest.approx([1, 0, .5])
    assert state(trace, 1.2, mode)[1:4] == pytest.approx([1, 0, .5])
    assert state(trace, 2.605, mode)[1] == 2
    assert state(trace, 2.605, mode)[2] > .1
    assert state(trace, 2.605, mode)[3] == pytest.approx(.75)
    assert np.isfinite(audio).all() and .001 < abs(audio).max() < .7
    np.testing.assert_allclose(audio[:, 0], audio[:, 1], atol=1e-12)
    assert abs(audio[-4800:]).max() < 1e-8


def test_same_note_overlap_does_not_repluck_and_releases_balance():
    artifact, targets = compile_guitars([guitar()], mode="host")
    audio, trace = render(artifact, targets, note_events([(.1, 60, 50, .5), (.3, 60, 127, .6)]),
                          1.2, mode="host", trace=True)
    for time in [.4, .7, .89]:
        assert state(trace, time)[1:4] == pytest.approx([1, 0, 50 / 128])
    assert abs(audio[-4800:]).max() < 1e-8


def test_last_note_fallback_and_two_instances_are_independent():
    artifact, targets = compile_guitars([guitar(), guitar()], mode="host")
    events = note_events([(.1, 52, 72, 1.6), (.3, 59, 120, .6)])
    events += note_events([(.1, 76, 100, .3), (.6, 72, 80, .5)], channel=1)
    _, trace = render(artifact, targets, events, 2, mode="host", trace=True)
    assert midi_pitch(state(trace, .85)[0]) == pytest.approx(59)
    assert midi_pitch(state(trace, 1.6)[0]) == pytest.approx(52)
    assert state(trace, 1.6)[1:4] == pytest.approx([1, 0, 72 / 128])
    assert midi_pitch(state(trace, .61, instance=1)[0]) == pytest.approx(72)
    assert state(trace, .61, instance=1)[1] == 2
    assert state(trace, .61)[1] == 1


@pytest.mark.parametrize("ksmps", [1, 16, 64])
@pytest.mark.parametrize("start_note,end_note", [(64, 76), (76, 64)])
def test_default_octave_slide_holds_every_intermediate_fret(ksmps, start_note, end_note):
    artifact, targets = compile_guitars([guitar()], mode="host", ksmps=ksmps)
    audio, trace = render(artifact, targets, note_events([(.1, start_note, 100, .4), (.5, end_note, 100, .9)]),
                      1.7, mode="host", trace=True)
    pitch = midi_pitch(trace[round(.5 * 48000 / ksmps):round(1.3 * 48000 / ksmps), 0, 0])
    np.testing.assert_allclose(pitch, np.round(pitch), atol=1e-8)
    notes = np.round(pitch).astype(int)
    boundaries = np.r_[0, np.flatnonzero(np.diff(notes)) + 1, len(notes)]
    plateaus = notes[boundaries[:-1]]
    direction = 1 if end_note > start_note else -1
    np.testing.assert_array_equal(plateaus, np.arange(start_note, end_note + direction, direction))
    # The old 40 ms half-time rushed early frets in 5–10 ms. Verify real dwell time.
    assert np.min(np.diff(boundaries)[1:-1] * ksmps / 48000) >= .014
    # Measure the audible waveform too: an integer control trace alone would not
    # catch accidental smoothing after the quantizer or inside a replacement source.
    for index, note in enumerate(plateaus[1:-1], 1):
        start = 24000 + boundaries[index] * ksmps + 144
        end = 24000 + boundaries[index + 1] * ksmps - 48
        expected = 440 * 2 ** ((note - 69) / 12)
        measured = periodic_pitch(audio[start:end, 0], expected)
        assert abs(1200 * np.log2(measured / expected)) < 15


def test_controls_refresh_at_new_phrase_not_connected_notes():
    artifact, targets = compile_guitars([guitar()], mode="host")
    channel = re.search(r'i_guitar_pick_iout_\d+ chnget "([^"]+)"', artifact.orc)[1]
    _, trace = render(artifact, targets, note_events([(.1, 52, 64, .4), (.5, 59, 96, .3), (.9, 64, 100, .2)]),
                      1.4, mode="host", trace=True, controller_updates=[(.4, channel, 1)])
    assert state(trace, .7)[4] == pytest.approx(.35)
    assert state(trace, .92)[4] == 1


@pytest.mark.parametrize("mode", ["host", "midi", "score"])
def test_polyphonic_notes_release_independently(mode):
    artifact, targets = compile_guitars([guitar("polyphonic")], mode=mode)
    audio, _ = render(artifact, targets, note_events([(.1, 52, 100, 1.1), (.1, 61, 100, .2)]), 1.6, mode=mode)
    def power_near(note, start, end):
        segment = audio[round(start * 48000):round(end * 48000), 0]
        spectrum = abs(np.fft.rfft(segment * np.hanning(len(segment)))) ** 2
        frequencies = np.fft.rfftfreq(len(segment), 1 / 48000)
        expected = 440 * 2 ** ((note - 69) / 12)
        return spectrum[abs(frequencies - expected) < 12].sum()
    early = power_near(61, .13, .28) / power_near(52, .13, .28)
    late = power_near(61, .7, 1) / power_near(52, .7, 1)
    assert early > late * 20
    assert rms(audio[33600:48000]) > .0005
    assert abs(audio[-4800:]).max() < 1e-8


def test_register_velocity_and_chord_headroom():
    patch = guitar("polyphonic")
    artifact, targets = compile_guitars([patch], mode="host")
    notes = [(.1 + i * .7, n, 100, .5) for i, n in enumerate([40, 52, 64, 76, 88])]
    audio, _ = render(artifact, targets, note_events(notes), 3.7, mode="host")
    for start, note, _, _ in notes:
        segment = audio[round((start + .06) * 48000):round((start + .45) * 48000), 0]
        expected = 440 * 2 ** ((note - 69) / 12)
        assert abs(1200 * np.log2(fundamental(segment, expected) / expected)) < 15
    notes = [(.1 + i * .7, 57, v, .45) for i, v in enumerate([24, 48, 80, 127])]
    audio, _ = render(artifact, targets, note_events(notes), 3, mode="host")
    levels = [rms(audio[round((start + .02) * 48000):round((start + .3) * 48000)]) for start, *_ in notes]
    assert all(b > a * 1.3 for a, b in zip(levels, levels[1:]))
    artifact, targets = compile_guitars([patch], mode="host", settings=[{
        "guitar_pick": 1, "guitar_brightness": 1, "guitar_body": 1, "guitar_sustain": 8,
    }])
    audio, _ = render(artifact, targets, note_events([(.1, n, 127, .8) for n in [40, 47, 52, 56, 59, 64]]),
                      2, mode="host")
    assert np.isfinite(audio).all() and .01 < abs(audio).max() < .71


def test_controller_extremes_change_timbre_decay_release_and_slide():
    patch = guitar("polyphonic")
    renders = {}
    for control, lo, hi in [("pick", 0, 1), ("brightness", 0, 1), ("body", 0, 1),
                            ("sustain", 1, 8), ("release", .05, .8)]:
        for side, value in [("min", lo), ("max", hi)]:
            artifact, targets = compile_guitars([patch], mode="host", settings=[{"guitar_" + control: value}])
            note = 45 if control == "body" else 52  # A2 excites the fixed 110 Hz body resonance.
            audio, _ = render(artifact, targets, note_events([(.1, note, 100, 1.2)]), 2.3, mode="host")
            assert np.isfinite(audio).all() and abs(audio).max() < .71
            assert abs(audio[-4800:]).max() < 1e-8
            renders[control, side] = audio
    def high_ratio(audio):
        section = audio[5760:12000, 0]
        power = abs(np.fft.rfft(section * np.hanning(len(section)))) ** 2
        freq = np.fft.rfftfreq(len(section), 1 / 48000)
        return power[(freq > 3000) & (freq < 12000)].sum() / power.sum()
    for control in ["pick", "brightness"]:
        assert high_ratio(renders[control, "max"]) > high_ratio(renders[control, "min"]) * 1.2
    assert rms(renders["body", "max"][7000:18000]) > rms(renders["body", "min"][7000:18000]) * 1.03
    assert rms(renders["sustain", "max"][48000:57600]) > rms(renders["sustain", "min"][48000:57600]) * 1.3
    assert rms(renders["release", "max"][72000:76800]) > .0001
    assert rms(renders["release", "min"][72000:76800]) < 1e-8
    positions = []
    for half_time in [.015, .15]:
        artifact, targets = compile_guitars([guitar()], mode="host", settings=[{"guitar_slide": half_time}])
        _, trace = render(artifact, targets, note_events([(.1, 52, 100, .4), (.5, 64, 100, .9)]),
                          1.7, mode="host", trace=True)
        positions.append(midi_pitch(state(trace, .6)[0]))
    assert positions[0] == pytest.approx(64) and positions[1] < 60
