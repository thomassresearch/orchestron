"""Native acoustic and phrasing regressions against the independent tenor fixture."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.saxophone_audio_support import (
    compile_instruments, fundamental, note_events, render, rms, section, spectrum_metrics,
    upper_harmonic_fraction,
)


def audition(notes, *, mode="host", controls=None, seconds=2, ksmps=None):
    artifact, targets = compile_instruments([load_patch_fixture("tenor_saxophone")], mode=mode,
                                           settings=[controls or {}], ksmps=ksmps)
    audio, _ = render(artifact, targets, note_events(notes), seconds, mode=mode)
    assert np.isfinite(audio).all()
    assert .001 < abs(audio).max() < 10 ** (-3 / 20)
    np.testing.assert_allclose(audio[:, 0], audio[:, 1], atol=1e-12)
    assert abs(audio[-4800:]).max() < 1e-8
    return audio


def assert_pitch(audio, start, end, note, tolerance=15):
    expected = 440 * 2 ** ((note - 69) / 12)
    segment = section(audio, start, end)
    measured = fundamental(segment, expected)
    assert abs(1200 * np.log2(measured / expected)) < tolerance, (note, measured)
    assert spectrum_metrics(segment, expected)["fundamental_fraction"] > .03


@pytest.mark.parametrize("velocity", [32, 64, 96])
def test_normal_register_is_tuned_and_releases_cleanly(velocity):
    notes = [(.1 + i * .65, note, velocity, .45) for i, note in enumerate([44, 48, 55, 60, 67, 72, 76])]
    audio = audition(notes, seconds=5)
    for start, note, _, _ in notes:
        assert_pitch(audio, start + .12, start + .42, note)


@pytest.mark.parametrize("note", [44, 60, 76])
def test_velocity_changes_loudness_and_overblown_register(note):
    velocities = [32, 64, 96, 108, 115, 120, 127]
    notes = [(.1 + i * .7, note, vel, .45) for i, vel in enumerate(velocities)]
    audio = audition(notes, seconds=5.2)
    hz = 440 * 2 ** ((note - 69) / 12)
    metrics = [spectrum_metrics(section(audio, start + .15, start + .42), hz) for start, *_ in notes]
    assert metrics[1]["rms_dbfs"] > metrics[0]["rms_dbfs"] + 5
    assert metrics[2]["rms_dbfs"] > metrics[1]["rms_dbfs"] + 3
    assert metrics[-1]["octave_to_fundamental"] > metrics[2]["octave_to_fundamental"] * 2
    assert metrics[-1]["octave_to_fundamental"] > 1


@pytest.mark.parametrize("mode", ["host", "midi", "score"])
def test_connected_velocity_changes_squeal_and_fallback_restores_soft_note(mode):
    # A distinct pitch makes note-off ownership unambiguous in ordinary MIDI.
    audio = audition([(.1, 60, 64, 1.8), (.6, 67, 127, .65)], mode=mode, seconds=2.3)
    hz = 440 * 2 ** ((60 - 69) / 12)
    soft = spectrum_metrics(section(audio, .3, .55), hz)
    hard = spectrum_metrics(section(audio, .85, 1.15), 440 * 2 ** ((67 - 69) / 12))
    fallback = spectrum_metrics(section(audio, 1.5, 1.8), hz)
    # Changing register also changes the fixed body-filter response.
    assert hard["rms_dbfs"] > soft["rms_dbfs"] + 3
    assert hard["octave_to_fundamental"] > soft["octave_to_fundamental"] * 2
    assert hard["octave_to_fundamental"] > fallback["octave_to_fundamental"] * 2
    assert abs(fallback["rms_dbfs"] - soft["rms_dbfs"]) < 3


def test_repeated_connected_pitch_can_get_harder_then_softer_without_a_gap():
    audio = audition([(.1, 60, 64, .55), (.6, 60, 127, .55), (1.1, 60, 64, .6)], seconds=2.1)
    hz = 440 * 2 ** ((60 - 69) / 12)
    hard = spectrum_metrics(section(audio, .8, 1.05), hz)
    soft = spectrum_metrics(section(audio, 1.35, 1.65), hz)
    assert hard["octave_to_fundamental"] > soft["octave_to_fundamental"] * 2
    assert hard["rms_dbfs"] > soft["rms_dbfs"] + 5


@pytest.mark.parametrize("ksmps", [1, 16, 64])
def test_last_note_priority_wide_leaps_and_new_phrase(ksmps):
    audio = audition([(.1, 44, 80, 1.8), (.6, 76, 80, .6), (2.1, 60, 96, .4)],
                     seconds=2.9, ksmps=ksmps)
    for start, end, note in [(.3, .55, 44), (.8, 1.1, 76), (1.5, 1.8, 44), (2.25, 2.45, 60)]:
        assert_pitch(audio, start, end, note)
    assert rms(section(audio, 2.02, 2.08)) < 1e-8
    assert rms(section(audio, 2.2, 2.45)) > .02


def test_zero_squeal_preserves_normal_register_and_maximum_is_overblown():
    metrics = []
    for value in [0, .65, 1]:
        audio = audition([(.1, 60, 127, 1)], controls={"sax_squeal": value})
        metrics.append(spectrum_metrics(section(audio, .5, .95), 440 * 2 ** ((60 - 69) / 12)))
    assert metrics[0]["fundamental_fraction"] > .3
    assert metrics[1]["octave_to_fundamental"] > metrics[0]["octave_to_fundamental"] * 3
    assert metrics[2]["octave_to_fundamental"] > metrics[1]["octave_to_fundamental"] * 3


@pytest.mark.parametrize("control", ["sax_tone", "sax_growl", "sax_vibrato"])
def test_control_extremes_are_audibly_distinct_and_bounded(control):
    spectra = []
    for value in [0, 1]:
        audio = audition([(.1, 60, 110, 1.25)], controls={control: value})
        segment = section(audio, .6, 1.25)
        spectra.append(abs(np.fft.rfft(segment * np.hanning(len(segment)))) ** 2)
    # Tonal brightness and growl/vibrato sidebands must affect spectral shape, not only gain.
    spectra = [x / x.sum() for x in spectra]
    assert np.sum(abs(spectra[1] - spectra[0])) > .015


def test_all_controls_maximum_keeps_headroom():
    audition([(.1 + i * .65, note, 127, .45) for i, note in enumerate([44, 60, 76])], seconds=2.5,
             controls={key: 1 for key in ["sax_tone", "sax_growl", "sax_squeal", "sax_vibrato"]})


@pytest.mark.parametrize("note", [44, 60, 76])
def test_sustained_normal_note_does_not_latch_into_an_overblown_mode(note):
    audio = audition([(.1, note, 80, 4)], seconds=4.5)
    for start, end in [(.5, 1), (2, 2.5), (3.4, 4)]:
        assert_pitch(audio, start, end, note)
        assert spectrum_metrics(section(audio, start, end), 440 * 2 ** ((note - 69) / 12))["fundamental_fraction"] > .3


def test_normal_register_has_richer_harmonics_than_original():
    notes = [(.15 + i * .8, note, velocity, .6)
             for i, (note, velocity) in enumerate((n, v) for n in [44, 48, 55, 60, 67, 72, 76]
                                                 for v in [64, 80, 96])]
    spectra = []
    for fixture in ["tenor_saxophone_original", "tenor_saxophone"]:
        artifact, targets = compile_instruments([load_patch_fixture(fixture)], mode="host")
        audio, _ = render(artifact, targets, note_events(notes), 17.5, mode="host")
        spectra.append(np.array([
            upper_harmonic_fraction(section(audio, start + .3, start + .56), 440 * 2 ** ((note - 69) / 12))
            for start, note, _, _ in notes
        ]))
    # Harmonic bands exclude most breath noise and are normalized to harmonic
    # power: gain or extra hiss cannot satisfy this timbral regression.
    before, after = spectra
    assert np.median(after) > np.median(before) * 1.5
    assert np.count_nonzero(after > before) >= 14
