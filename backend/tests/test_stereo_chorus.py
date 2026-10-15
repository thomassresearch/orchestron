"""Audio regressions for the versioned Chorus with variable LFO depth."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe


AMOUNT = "0712c97b-afbc-400f-8282-6e5508ed10fd"
RATE = "chorus_rate_multiplier"


@pytest.mark.parametrize("amount", [0.001, 0.02, 0.0809260309512236, 0.1])
@pytest.mark.parametrize("rate", [0.1, 1, 10])
def test_variable_depth_is_silent_without_input_and_has_bounded_stereo_output(amount, rate):
    patch = load_patch_fixture("stereo_chorus")
    artifact = compile_probe(patch, values={AMOUNT: amount, RATE: rate})
    # The former out-of-range taps could generate garbage even before a note.
    silent = render_probe(artifact, np.zeros((64, 2)), 2)
    np.testing.assert_array_equal(silent, 0)
    t = np.arange(SAMPLE_RATE * 2) / SAMPLE_RATE
    source = np.column_stack([0.1 * np.sin(2 * np.pi * f * t) for f in (220, 330)])
    audio = render_probe(artifact, source, 4)
    assert np.isfinite(audio).all()
    assert np.max(np.abs(audio)) < 0.2
    assert np.min(np.max(np.abs(audio), axis=0)) > 0.01
    assert np.max(np.abs(audio[-SAMPLE_RATE:])) < 1e-4


@pytest.mark.parametrize("ksmps", [1, 64])
def test_maximum_depth_preserves_dry_channels_and_stable_feedback_gain(ksmps):
    artifact = compile_probe(load_patch_fixture("stereo_chorus"),
                             values={AMOUNT: 0.1, RATE: 10}, ksmps=ksmps)
    source = np.tile([0.1, 0.05], (SAMPLE_RATE, 1)).astype(np.float32)
    audio = render_probe(artifact, source, 1)
    assert np.isfinite(audio).all()
    # No tap is shorter than 14 ms: the initial dry channel gains stay at 0.1.
    np.testing.assert_allclose(audio[:480], source[:480] * 0.1, atol=1e-8)
    # The mono-average feedback buffer settles to mean(input)/(1 - 0.08).
    expected = source[0] * 0.1 + 6 * (0.8 * 0.92 / 4) * source[0].mean() / (1 - 0.08)
    np.testing.assert_allclose(audio[-480:], np.tile(expected, (480, 1)), atol=5e-5)
