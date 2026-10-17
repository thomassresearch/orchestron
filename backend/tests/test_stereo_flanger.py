"""Native audio regressions for the independent Stereo Flanger fixture."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe


def audition(source, seconds, *, values=None, ksmps=32, mode="midi"):
    return render_probe(compile_probe(load_patch_fixture("stereo_flanger"), values=values,
                                      ksmps=ksmps, mode=mode), source, seconds)


@pytest.mark.parametrize("ksmps,mode", [(32, "midi"), (64, "midi"), (1, "midi"), (1, "score")])
@pytest.mark.parametrize("feedback", [-0.9, 0, 0.5, 0.9])
def test_static_comb_delay_and_signed_feedback_match_impulse_oracle(ksmps, mode, feedback):
    source = np.zeros((64, 2))
    source[0] = [0.25, -0.125]
    audio = audition(source, 0.05, values=dict(sf_depth=0, sf_delay=1,
                                             sf_feedback=feedback, sf_mix=0.5),
                     ksmps=ksmps, mode=mode)
    expected = np.zeros_like(audio)
    expected[0] = source[0] * 0.5
    # A 1 ms delay is 48 samples; Csound flanger's feedback memory adds one
    # sample per repeat. This oracle sums signed impulses, without a DSP graph.
    for repeat, index in enumerate(range(48, len(audio), 49)):
        expected[index] = source[0] * 0.5 * (1 - abs(feedback)) * feedback ** repeat
    np.testing.assert_allclose(audio, expected, atol=1e-8)


def test_dry_mix_is_exact_and_channels_remain_independent():
    source = np.random.default_rng(52).uniform(-0.2, 0.2, (4800, 2)).astype(np.float32)
    dry = audition(source, 0.1, values=dict(sf_mix=0))
    np.testing.assert_array_equal(dry, source)
    for channel in (0, 1):
        isolated = source.copy()
        isolated[:, 1 - channel] = 0
        wet = audition(isolated, 0.2, values=dict(sf_mix=1, sf_feedback=-0.9))
        np.testing.assert_array_equal(wet[:, 1 - channel], 0)
        assert np.max(np.abs(wet[:, channel])) > 0.005


@pytest.mark.parametrize("phase", [0, 90, 180])
def test_audio_rate_sweep_matches_independent_fractional_delay(phase):
    frames = SAMPLE_RATE
    t = np.arange(frames) / SAMPLE_RATE
    mono = (0.2 * np.sin(2 * np.pi * 997 * t)).astype(np.float32)
    source = np.column_stack([mono, mono])
    audio = audition(source, 1, values=dict(sf_feedback=0, sf_mix=1, sf_rate=2,
                                           sf_delay=0.2, sf_depth=5, sf_phase=phase))
    for channel, degrees in enumerate((0, phase)):
        delay = (0.2 + 5 * (1 + np.sin(2 * np.pi * 2 * t + np.deg2rad(degrees)))) / 1000
        expected = np.interp(np.arange(frames) - delay * SAMPLE_RATE,
                             np.arange(frames), mono, left=0, right=0)
        np.testing.assert_allclose(audio[:, channel], expected, atol=2e-6)
    if phase == 0:
        np.testing.assert_array_equal(audio[:, 0], audio[:, 1])
    else:
        assert np.sqrt(np.mean((audio[:, 0] - audio[:, 1]) ** 2)) > 0.1


@pytest.mark.parametrize("values", [
    {},
    dict(sf_rate=0.02, sf_delay=0.2, sf_depth=0, sf_feedback=-0.9, sf_phase=0, sf_mix=0),
    dict(sf_rate=5, sf_delay=5, sf_depth=5, sf_feedback=0.9, sf_phase=180, sf_mix=1),
    dict(sf_rate=5, sf_delay=0.2, sf_depth=5, sf_feedback=-0.9, sf_phase=180, sf_mix=1),
])
def test_extremes_are_silent_without_input_bounded_and_decay(values):
    silent = audition(np.zeros((64, 2)), 0.1, values=values)
    np.testing.assert_array_equal(silent, 0)
    source = np.random.default_rng(7).uniform(-0.2, 0.2, (SAMPLE_RATE, 2)).astype(np.float32)
    audio = audition(source, 3, values=values)
    assert np.isfinite(audio).all()
    assert np.max(np.abs(audio)) <= 0.200001
    assert np.max(np.abs(audio[-SAMPLE_RATE // 2:])) < 1e-6
