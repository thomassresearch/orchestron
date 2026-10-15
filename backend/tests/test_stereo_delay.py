"""Sample-level audio regressions for the independent Stereo Delay fixture."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe


def audition(source, seconds, *, values=None, ksmps=32, mode="midi"):
    return render_probe(compile_probe(load_patch_fixture("stereo_delay"), values=values,
                                      ksmps=ksmps, mode=mode), source, seconds)


def expected_echoes(source, length, *, tempo=120, beats=4, feedback=0.5, stereo=0.5):
    """Independent discrete-time reference: add each shifted/panned input copy."""
    expected = np.zeros((length, 2))
    expected[:min(len(source), length)] = source[:length]
    interval = int(np.floor(SAMPLE_RATE * 60 * beats / tempo + 0.5))
    mono = source.mean(axis=1)
    for n, start in enumerate(range(interval, length, interval), 1):
        echo = (1 - stereo) * source.copy()
        echo[:, (n + 1) % 2] += stereo * mono
        count = min(len(source), length - start)
        expected[start:start + count] += feedback ** n * echo[:count]
    return expected


@pytest.mark.parametrize("stereo", [0, 0.5, 1])
@pytest.mark.parametrize("channels", [(0.25, 0), (0, 0.25), (0.25, 0.25), (0.25, -0.125)])
def test_echo_channel_parity_levels_and_overlapping_inputs(stereo, channels):
    source = np.zeros((25000, 2))
    source[0] = channels
    source[17001] = np.asarray(channels)[::-1] * 0.5
    values = dict(sd_tempo=180, sd_beats=1, sd_stereo=stereo)
    audio = audition(source, 2.1, values=values)
    np.testing.assert_allclose(audio, expected_echoes(source, len(audio), tempo=180, beats=1, stereo=stereo), atol=2e-8)


@pytest.mark.parametrize("tempo,beats", [(120, 4), (180, 1), (40, 16), (137, 1.375)])
def test_timing_at_default_extremes_and_fractional_beats(tempo, beats):
    source = np.zeros((64, 2))
    source[0] = [0.125, 0.25]
    values = dict(sd_tempo=tempo, sd_beats=beats, sd_feedback=0.9, sd_stereo=1)
    audio = audition(source, 60 * beats / tempo * 5 + 0.01, values=values)
    assert np.isfinite(audio).all()
    np.testing.assert_allclose(audio, expected_echoes(source, len(audio), tempo=tempo, beats=beats,
                                                    feedback=0.9, stereo=1), atol=2e-8)


def test_feedback_zero_preserves_arbitrary_stereo_exactly_and_silence_stays_silent():
    source = np.random.default_rng(42).uniform(-0.2, 0.2, (48000, 2)).astype(np.float32)
    audio = audition(source, 1, values=dict(sd_feedback=0, sd_beats=1, sd_tempo=180))
    np.testing.assert_array_equal(audio, source)
    silent = audition(np.zeros((64, 2)), 2, values=dict(sd_feedback=0.9, sd_stereo=1, sd_beats=1))
    assert np.count_nonzero(silent) == 0


@pytest.mark.parametrize("ksmps,mode", [(1, "midi"), (1, "score"), (64, "midi")])
def test_live_and_offline_echoes_match(ksmps, mode):
    source = np.zeros((64, 2))
    source[0] = [0.125, 0.25]
    values = dict(sd_tempo=137, sd_beats=1.375, sd_feedback=0.9, sd_stereo=0.5)
    audio = audition(source, 4, values=values, ksmps=ksmps, mode=mode)
    np.testing.assert_allclose(audio, expected_echoes(source, len(audio), tempo=137, beats=1.375,
                                                    feedback=0.9), atol=2e-8)


def test_representative_audio_headroom_and_decay_without_a_limiter():
    t = np.arange(4800) / SAMPLE_RATE
    source = np.column_stack([0.2 * np.sin(2 * np.pi * f * t) * np.exp(-30 * t) for f in (330, 550)])
    audio = audition(source, 7, values=dict(sd_tempo=180, sd_beats=1))
    assert np.isfinite(audio).all() and np.max(np.abs(audio)) < 0.21
    assert np.max(np.abs(audio[-16000:])) < 1e-6
    # Dry gain stays at unity even when sustained input plus feedback exceeds 0 dBFS.
    hot = audition(np.full((96000, 2), 0.5), 2,
                   values=dict(sd_tempo=180, sd_beats=1, sd_feedback=0.9, sd_stereo=0))
    assert np.isfinite(hot).all() and np.max(hot) > 1
