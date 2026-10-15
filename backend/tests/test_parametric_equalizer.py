"""Measure the seven-band EQ against independent RBJ frequency responses."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe


FREQUENCIES = [63, 160, 400, 1000, 2500, 6300, 16000]
CONTROLS = ["d4c20b81-8b7c-4312-91b6-8997156f2ca2", "eq_160_gain_db",
            "cded9f16-e830-42d7-964f-d9bce78a3cd8", "377a004c-dd56-4042-b647-29f60bc7880a",
            "eq_2500_gain_db", "eq_6300_gain_db", "eq_16000_gain_db"]


def impulse_response(values=None, *, ksmps=32, mode="midi"):
    source = np.zeros((2 * SAMPLE_RATE, 2), dtype=np.float32)
    source[0, 0] = 0.01
    source[128, 1] = -0.005
    artifact = compile_probe(load_patch_fixture("parametric_equalizer"),
                             values=values, ksmps=ksmps, mode=mode)
    return source, render_probe(artifact, source, 2)


def rbj_response(hz, db, frequencies):
    """Cookbook peaking biquad, independent of pareq's tan/denominator-Q form."""
    amplitude = 10 ** (db / 40)
    omega = 2 * np.pi * hz / SAMPLE_RATE
    alpha = np.sin(omega) / (2 * 1.05)
    cosine = np.cos(omega)
    z = np.exp(-2j * np.pi * frequencies / SAMPLE_RATE)
    return ((1 + alpha * amplitude) - 2 * cosine * z + (1 - alpha * amplitude) * z**2) / (
        (1 + alpha / amplitude) - 2 * cosine * z + (1 - alpha / amplitude) * z**2)


def test_original_parallel_sum_has_three_times_neutral_gain():
    source = np.zeros((SAMPLE_RATE, 2), dtype=np.float32)
    source[0] = [0.01, -0.005]
    output = render_probe(compile_probe(load_patch_fixture("parametric_equalizer_original")), source, 1)
    np.testing.assert_allclose(output, source * 3, atol=1e-9)


@pytest.mark.parametrize("ksmps", [1, 32, 64])
def test_neutral_eq_is_sample_exact_unity_in_both_channels(ksmps):
    source, output = impulse_response(ksmps=ksmps)
    np.testing.assert_allclose(output, source, atol=1e-10)


@pytest.mark.parametrize("band", range(7))
@pytest.mark.parametrize("db", [-20, 6, 20])
def test_each_band_matches_center_gain_and_full_complex_response(band, db):
    source, output = impulse_response({CONTROLS[band]: db})
    assert np.isfinite(output).all()
    assert abs(output[-4800:]).max() < 1e-10
    frequencies = np.fft.rfftfreq(len(output), 1 / SAMPLE_RATE)
    measured = np.fft.rfft(output[:, 0]) / source[0, 0]
    expected = rbj_response(FREQUENCIES[band], db, frequencies)
    np.testing.assert_allclose(measured, expected, rtol=2e-6, atol=2e-7)
    center = np.argmin(abs(frequencies - FREQUENCIES[band]))
    assert 20 * np.log10(abs(measured[center])) == pytest.approx(db, abs=2e-5)
    # Different sign, level and start time check matching L/R processing without bleed.
    np.testing.assert_array_equal(output[:128, 1], 0)
    np.testing.assert_allclose(output[128:, 1], -0.5 * output[:-128, 0], atol=1e-11)


@pytest.mark.parametrize("db", [-20, 0, 20])
def test_silence_and_all_band_extremes_are_stable(db):
    values = dict.fromkeys(CONTROLS, db)
    artifact = compile_probe(load_patch_fixture("parametric_equalizer"), values=values)
    np.testing.assert_array_equal(render_probe(artifact, np.zeros((64, 2)), 0.25), 0)
    source, output = impulse_response(values)
    assert np.isfinite(output).all()
    assert abs(output[-4800:]).max() < 1e-10
    frequencies = np.fft.rfftfreq(len(output), 1 / SAMPLE_RATE)
    expected = np.prod([rbj_response(hz, db, frequencies) for hz in FREQUENCIES], axis=0)
    np.testing.assert_allclose(np.fft.rfft(output[:, 0]) / source[0, 0], expected,
                               rtol=2e-5, atol=2e-6)


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_live_and_both_offline_modes_match_with_mixed_gains(mode):
    values = dict(zip(CONTROLS, [-20, 7, -4, 20, 0, -8, 12]))
    _, live = impulse_response(values)
    _, offline = impulse_response(values, ksmps=1, mode=mode)
    np.testing.assert_allclose(live, offline, atol=1e-11)


def test_equal_boost_and_cut_are_reciprocal():
    responses = []
    for db in (-20, 20):
        source, output = impulse_response(dict.fromkeys(CONTROLS, db))
        responses.append(np.fft.rfft(output[:, 0]) / source[0, 0])
    np.testing.assert_allclose(responses[0] * responses[1], 1, atol=1e-8)
