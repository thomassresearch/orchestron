"""Enough and Logan DSP contracts against independent versioned snapshots."""

import numpy as np
import pytest

from backend.tests.altamax_audio_support import reference
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, fundamental, note_events, render, rms


def audition(name, notes, seconds, *, values=None, mode="score", ksmps=1):
    artifact, targets = compile_guitars([load_patch_fixture(name)], mode=mode,
                                       settings=[values or {}], ksmps=ksmps)
    audio, _ = render(artifact, targets, note_events(notes), seconds, mode=mode)
    return audio


@pytest.mark.parametrize("name", ["enough", "logan"])
@pytest.mark.parametrize("mode,ksmps", [("host", 32), ("host", 64), ("midi", 1), ("score", 1)])
def test_register_retriggers_chords_and_release(name, mode, ksmps):
    notes = [(.1, 36, 96, .12), (.3, 60, 96, .4), (.7, 60, 96, .25), (1, 84, 96, .3)]
    notes += [(1.6, note, 64, .4) for note in [48, 55, 60]]
    x = audition(name, notes, 2.7, mode=mode, ksmps=ksmps)
    assert np.isfinite(x).all() and .01 < abs(x).max() < 1
    np.testing.assert_allclose(x[:, 0], x[:, 1], atol=1e-12)
    assert abs(x[-2400:]).max() < 1e-10
    for start, _, _, duration in notes:
        assert rms(x[int((start + .02) * 48000):int((start + duration) * 48000)]) > .001


@pytest.mark.parametrize("name", ["enough", "logan"])
@pytest.mark.parametrize("mode,ksmps", [("host", 32), ("host", 64), ("score", 1)])
def test_velocity_scales_gain_without_changing_timbre(name, mode, ksmps):
    soft = audition(name, [(.1, 60, 32, .5)], 1.2, mode=mode, ksmps=ksmps)
    loud = audition(name, [(.1, 60, 96, .5)], 1.2, mode=mode, ksmps=ksmps)
    np.testing.assert_allclose(loud, soft * 3, atol=1e-10)


@pytest.mark.parametrize("name", ["enough", "logan"])
@pytest.mark.parametrize("mode,ksmps", [("host", 32), ("host", 64), ("score", 1)])
def test_control_endpoints_and_release_duration(name, mode, ksmps):
    patch = load_patch_fixture(name)
    for node in patch.graph.nodes:
        if node.opcode != "perf_controller":
            continue
        for bound in ["min", "max"]:
            values = {node.id: node.params[bound]}
            release = values.get(name + "_release", .2 if name == "enough" else .5)
            x = audition(name, [(.1, 60, 127, .4)], .7 + release, values=values, mode=mode, ksmps=ksmps)
            assert np.isfinite(x).all() and abs(x).max() <= 1.000001, (node.id, bound)
            assert abs(x[-2400:]).max() < 1e-10, (node.id, bound)
            if node.id.endswith("level") and bound == "min":
                assert abs(x).max() == 0
            else:
                assert rms(x[9600:19200]) > .001
                assert rms(x[int((.5 + release * .4) * 48000):int((.5 + release * .6) * 48000)]) > .00001


@pytest.mark.parametrize("mode,ksmps", [("host", 32), ("host", 64), ("score", 1)])
def test_enough_becomes_a_sine_at_end_of_evolution(mode, ksmps):
    for time in [.25, 1, 4]:
        end = .1 + 2 * time
        x = audition("enough", [(.1, 60, 127, end + .8)], end + .6,
                     values={"enough_evolution": time}, mode=mode, ksmps=ksmps)
        tail = x[int((end + .1) * 48000):int((end + .5) * 48000), 0]
        expected = 440 * 2 ** ((60 - 69) / 12)
        assert abs(1200 * np.log2(fundamental(tail, expected) / expected)) < 1
        assert rms(tail) == pytest.approx(.5 / np.sqrt(2), rel=.01)
    clean = audition("enough", [(.1, 60, 127, .8)], 1.2, values={"enough_timbre": 0})
    complex_sound = audition("enough", [(.1, 60, 127, .8)], 1.2)
    assert rms(clean[9600:24000] - complex_sound[9600:24000]) > .1


def test_logan_phase_shaping_matches_source_after_midi_attack():
    notes = [(.1, 60, 127, 5.5)]
    x = audition("logan", notes, 6.2)
    original = reference("logan", notes, 6.2)
    # MIDI/SCORE velocity scaling in Csound ampmidi is 127/128 at velocity 127.
    np.testing.assert_allclose(x[9600:264000], original[9600:264000] * (127 / 128), atol=2e-10)


def test_enough_source_and_port_share_late_pitch_and_spectral_decay():
    notes = [(.1, 60, 127, 3)]
    x = audition("enough", notes, 3.5)
    original = reference("enough", notes, 3.5)
    expected = 440 * 2 ** ((60 - 69) / 12)
    for signal in [x, original]:
        tail = signal[110400:139200, 0]
        assert abs(1200 * np.log2(fundamental(tail, expected) / expected)) < 1
        def brightness(samples):
            power = abs(np.fft.rfft(samples * np.hanning(len(samples)))) ** 2
            frequency = np.fft.rfftfreq(len(samples), 1 / 48000)
            return power[frequency > 2 * expected].sum() / power.sum()
        assert brightness(signal[9600:24000, 0]) > .02
        assert brightness(tail) < .001
