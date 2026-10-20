"""Sample-level DSP regressions using the independent Autopanner fixture."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe


def audition(source, seconds, *, values=None, ksmps=32, mode="midi"):
    return render_probe(compile_probe(load_patch_fixture("autopanner"), values=values,
                                      ksmps=ksmps, mode=mode), source, seconds)


@pytest.mark.parametrize("ksmps,mode", [(32, "midi"), (64, "midi"), (1, "midi"), (1, "score")])
@pytest.mark.parametrize("tempo,beats,depth", [
    (120, 4, 1), (40, 16, 1), (180, 0.125, 1), (137, 1.375, 0.63),
])
def test_sweep_matches_sample_time_oracle(ksmps, mode, tempo, beats, depth):
    period = 60 * beats / tempo
    seconds = max(0.2, period * 1.25)
    source = np.full((round(seconds * SAMPLE_RATE), 2), 0.25, dtype=np.float32)
    audio = audition(source, seconds, values=dict(ap_tempo=tempo, ap_beats=beats, ap_depth=depth),
                     ksmps=ksmps, mode=mode)
    t = np.arange(len(audio)) / SAMPLE_RATE
    wave = np.sin(2 * np.pi * t / period)
    expected = source * np.column_stack([1 - depth * (1 + wave) / 2, 1 - depth * (1 - wave) / 2])
    np.testing.assert_allclose(audio, expected, atol=2e-8)
    np.testing.assert_allclose(audio.sum(axis=1), 0.25 * (2 - depth), atol=1e-12)
    np.testing.assert_allclose(audio[0], 0.25 * (1 - depth / 2), atol=1e-12)
    assert audio[1, 1] > audio[1, 0]  # Starts centered, then moves right.


@pytest.mark.parametrize("ksmps,mode", [(32, "midi"), (64, "midi"), (1, "midi"), (1, "score")])
def test_zero_depth_is_sample_exact_stereo_bypass(ksmps, mode):
    source = np.random.default_rng(92).uniform(-0.8, 0.8, (4800, 2)).astype(np.float32)
    audio = audition(source, 0.1, values=dict(ap_depth=0), ksmps=ksmps, mode=mode)
    np.testing.assert_array_equal(audio, source)


@pytest.mark.parametrize("channel", [0, 1])
def test_channels_never_cross_and_phase_restarts(channel):
    source = np.zeros((2 * SAMPLE_RATE, 2), dtype=np.float32)
    source[:, channel] = 0.5
    first = audition(source, 2)
    second = audition(source, 2)
    np.testing.assert_array_equal(first, second)
    np.testing.assert_array_equal(first[:, 1 - channel], 0)
    assert np.max(first[:, channel]) > 0.49
    assert np.min(first[:, channel]) < 1e-8


@pytest.mark.parametrize("values", [
    {}, dict(ap_tempo=40, ap_beats=16, ap_depth=0),
    dict(ap_tempo=180, ap_beats=0.125, ap_depth=1),
])
def test_silence_extremes_gain_bounds_and_no_tail(values):
    np.testing.assert_array_equal(audition(np.zeros((64, 2)), 0.1, values=values), 0)
    source = np.random.default_rng(9).uniform(-0.8, 0.8, (4800, 2)).astype(np.float32)
    audio = audition(source, 0.2, values=values)
    assert np.isfinite(audio).all()
    assert np.all(np.abs(audio[:len(source)]) <= np.abs(source) + 1e-12)
    np.testing.assert_array_equal(audio[len(source):], 0)
