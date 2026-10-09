"""Audio regressions for the independent Tube Overdrive fixture."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.tube_overdrive_audio import SAMPLE_RATE, compile_probe, render_probe


def audition(**kwargs):
    return render_probe(compile_probe(load_patch_fixture("tube_overdrive"), **kwargs))


def sustained(samples):
    return samples[SAMPLE_RATE // 2:3 * SAMPLE_RATE // 2, 0]


@pytest.mark.parametrize("drive", [0, 12, 24])
def test_silence_has_no_bias_or_startup_pop(drive):
    samples = audition(scenario="silence", values={"tube_drive_db": drive})
    assert np.max(np.abs(samples)) < 1e-12


@pytest.mark.parametrize("scenario", ["sine", "bass", "chord", "bright"])
def test_default_headroom_stereo_and_release(scenario):
    samples = audition(scenario=scenario)
    assert np.isfinite(samples).all()
    assert 0.01 < np.max(np.abs(samples)) < 0.7
    np.testing.assert_allclose(samples[:, 0], samples[:, 1], atol=1e-12)
    assert np.max(np.abs(samples[-4800:])) < 1e-8


def test_stereo_insert_does_not_leak_into_silent_right_channel():
    samples = audition(right=False)
    assert np.max(np.abs(samples[:, 0])) > 0.1
    assert np.max(np.abs(samples[:, 1])) < 1e-12


def test_drive_increases_distortion_and_retains_even_harmonics_without_dc():
    ratios = []
    for drive in [0, 12, 24]:
        signal = sustained(audition(values={"tube_drive_db": drive}))
        assert abs(signal.mean()) < 1e-7
        spectrum = np.abs(np.fft.rfft(signal))
        harmonics = spectrum[np.arange(2, 25) * 250]
        ratios.append(np.linalg.norm(harmonics) / spectrum[250])
        assert spectrum[500] / spectrum[250] > 0.01
    assert ratios[0] < ratios[1] < ratios[2]
    assert ratios[2] > 0.2


def test_tone_damps_highs_and_output_scales_without_changing_the_shape():
    dark = sustained(audition(scenario="bright", values={"tube_tone_hz": 2000}))
    light = sustained(audition(scenario="bright", values={"tube_tone_hz": 12000}))
    bins = np.fft.rfftfreq(len(dark), 1 / SAMPLE_RATE) > 6000
    assert np.linalg.norm(np.fft.rfft(dark)[bins]) < 0.25 * np.linalg.norm(np.fft.rfft(light)[bins])
    quiet = audition(values={"tube_output_db": -18})
    loud = audition(values={"tube_output_db": 6})
    # Csound's ampdb conversion differs slightly from Python's base-10 expression.
    np.testing.assert_allclose(loud, quiet * 10 ** (24 / 20), rtol=1e-6, atol=1e-10)


def test_hot_input_and_boost_remain_finite_but_output_trim_can_clip():
    samples = audition(amplitude=1, values={"tube_drive_db": 0, "tube_output_db": 6})
    assert np.isfinite(samples).all()
    assert np.max(np.abs(samples)) > 1  # An output gain control is not a hard limiter.
    maximum = audition(scenario="bright", amplitude=1,
                       values={"tube_drive_db": 24, "tube_tone_hz": 12000, "tube_output_db": 6})
    assert np.isfinite(maximum).all()
    assert np.max(np.abs(maximum)) < 1


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_live_and_offline_insert_settings_produce_the_same_sustained_signal(mode):
    values = {"tube_drive_db": 18, "tube_tone_hz": 4000, "tube_output_db": -6}
    live = sustained(audition(values=values))
    exported = sustained(audition(values=values, ksmps=1, mode=mode))
    # Envelope start timing can vary by a block; compare harmonic magnitudes after settling.
    np.testing.assert_allclose(np.abs(np.fft.rfft(exported)), np.abs(np.fft.rfft(live)), atol=1e-7)
