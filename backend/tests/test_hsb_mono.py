"""HSB Mono DSP, using a versioned fixture and unmodified monophonic compiler."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.hsb_mono_audio import compile_patch, render


@pytest.fixture(autouse=True)
def native_engine(monkeypatch):
    monkeypatch.delenv("VISUALCSOUND_FORCE_MOCK_ENGINE", raising=False)
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "browser_clock")


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def state(trace, seconds, ksmps=32, instance=0):
    return trace[round(seconds * 48000 / ksmps), instance]


@pytest.mark.parametrize("ksmps", [1, 32])
@pytest.mark.parametrize("mode", ["midi", "score"])
@pytest.mark.parametrize("gap", [0, 0.010, 0.019, 0.022, 0.080])
def test_narrow_gap_glides_and_long_gap_snaps(ksmps, mode, gap):
    artifact = compile_patch(load_patch_fixture("hsb_mono"), ksmps=ksmps, mode=mode)
    start = 0.2 + gap
    events = [(0.1, [0x90, 60, 90]), (0.2, [0x80, 60, 0]),
              (start, [0x90, 67, 90]), (start + 0.2, [0x80, 67, 0])]
    audio, trace = render(artifact, seconds=0.7,
                          score=f"i 1 .1 .1 60 90 1 1\ni 1 {start} .2 67 90 2 1",
                          events=events if mode == "midi" else None)
    pitch = state(trace, start + 0.060, ksmps)[0]
    if gap <= 0.019:
        assert pitch == pytest.approx((hz(60) + hz(67)) / 2, abs=1.1)
    else:
        assert pitch == pytest.approx(hz(67), abs=1e-8)
    assert 0.02 < abs(audio).max() < 0.3
    np.testing.assert_allclose(audio[:, 0], audio[:, 1], atol=1e-12)
    assert abs(audio[-4800:]).max() < 1e-12


def test_overlapping_last_note_fallback_and_separate_instances():
    artifact = compile_patch(load_patch_fixture("hsb_mono"), copies=2,
                             values={"hsb_legato_rate": 0.001})
    _, trace = render(artifact, score=(
        "i 1 .1 .4 60 90 1 1\ni 1 .2 .1 67 90 2 1\n"
        "i 2 .1 .5 48 90 3 2"), seconds=0.8)
    assert state(trace, .22)[0] == pytest.approx(hz(67), abs=.001)
    assert state(trace, .32)[0] == pytest.approx(hz(60), abs=.001)
    assert state(trace, .32, instance=1)[0] == pytest.approx(hz(48), abs=1e-8)


@pytest.mark.parametrize("values,expected", [
    ({}, [0, 0, .060]),
    ({"hsb_tonality": 0, "hsb_brightness": -2, "hsb_legato_rate": .001}, [0, -2, .001]),
    ({"hsb_tonality": 1, "hsb_brightness": 2, "hsb_legato_rate": .5}, [1, 2, .5]),
])
def test_performance_controls_and_silent_tail(values, expected):
    audio, trace = render(compile_patch(load_patch_fixture("hsb_mono"), values=values),
                          score="i 1 .1 .6 60 127 1 1")
    np.testing.assert_allclose(state(trace, .1)[2:], expected, atol=1e-10)
    np.testing.assert_allclose(state(trace, .5)[2:], expected, atol=1e-10)
    assert 0.01 < abs(audio).max() < 0.3
    assert abs(audio[-4800:]).max() == 0


def test_midi_controls_full_range_reset_and_channel_isolation():
    artifact = compile_patch(load_patch_fixture("hsb_mono"), mode="midi",
                             values={"hsb_tonality": .3, "hsb_brightness": -.4, "hsb_legato_rate": .08})
    events = [(0.1, [0x90, 60, 90]), (1.3, [0x80, 60, 0])]
    for time, channel, value in [(.2, 1, 127), (.4, 16, 1), (.7, 16, 127), (1., 16, 0)]:
        events.extend((time, [0xB0 + channel - 1, cc, value]) for cc in [20, 74, 5])
    audio, trace = render(artifact, events=events, seconds=1.6)
    for time, expected in [(.35, [.3, -.4, .08]), (.65, [0, -2, .001]),
                           (.95, [1, 2, .5]), (1.25, [.3, -.4, .08])]:
        np.testing.assert_allclose(state(trace, time)[2:], expected, atol=2e-7)
    assert abs(audio).max() < .3
    assert abs(audio[-4800:]).max() == 0


def test_velocity_and_low_high_registers():
    artifact = compile_patch(load_patch_fixture("hsb_mono"))
    quiet, _ = render(artifact, score="i 1 .1 .5 60 40 1 1")
    loud, _ = render(artifact, score="i 1 .1 .5 60 120 1 1")
    assert np.sqrt(np.mean(loud ** 2)) / np.sqrt(np.mean(quiet ** 2)) == pytest.approx(3, rel=.001)
    for note in [36, 84]:
        audio, _ = render(artifact, score=f"i 1 .1 .5 {note} 127 1 1")
        assert 0.01 < abs(audio).max() < .3


def test_slow_glide_continues_smoothly_through_release():
    artifact = compile_patch(load_patch_fixture("hsb_mono"), values={"hsb_legato_rate": .5})
    _, trace = render(artifact, score="i 1 .1 .1 48 100 1 1\ni 1 .2 .1 72 100 2 1", seconds=.5)
    for time in [.31, .33, .36]:
        expected = hz(72) + (hz(48) - hz(72)) * 2 ** (-(time - .2) / .5)
        assert state(trace, time)[0] == pytest.approx(expected, abs=.5)
