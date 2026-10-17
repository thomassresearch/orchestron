"""DSP oracles for the three continuous stereo effects, using independent fixtures."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.stereo_delay_audio import SAMPLE_RATE as SR, compile_probe, render_probe


def render(name, source, seconds=None, ksmps=32, mode='midi', **values):
    return render_probe(compile_probe(load_patch_fixture(name), values=values, ksmps=ksmps, mode=mode),
                        source, seconds or len(source) / SR)


@pytest.mark.parametrize('ksmps,mode', [(32, 'midi'), (64, 'midi'), (1, 'midi'), (1, 'score')])
def test_widener_identity_mono_and_synthetic_side(ksmps, mode):
    source = np.random.default_rng(12).uniform(-.2, .2, (4800, 2)).astype(np.float32)
    identity = render('stereo_widener', source, ksmps=ksmps, mode=mode, sw_width=1, sw_output=0)
    np.testing.assert_allclose(identity, source, atol=1e-8)
    mono = render('stereo_widener', source, ksmps=ksmps, mode=mode, sw_width=0, sw_mono=1, sw_output=0)
    np.testing.assert_allclose(mono, np.repeat(source.mean(axis=1)[:, None], 2, axis=1), atol=2e-8)
    source[:, 1] = source[:, 0]
    wide = render('stereo_widener', source, ksmps=ksmps, mode=mode,
                  sw_width=2, sw_mono=1, sw_delay=10, sw_output=0)
    delayed = np.pad(source[:-480, 0], (480, 0))
    np.testing.assert_allclose(wide[:, 0], 2 * source[:, 0] - delayed, atol=4e-8)
    np.testing.assert_allclose(wide[:, 1], delayed, atol=2e-8)
    np.testing.assert_allclose(wide.mean(axis=1), source[:, 0], atol=2e-8)


@pytest.mark.parametrize('bits', [2, 8, 16, 7.6])
@pytest.mark.parametrize('ksmps,mode', [(32, 'midi'), (64, 'midi'), (1, 'midi'), (1, 'score')])
def test_crusher_signed_quantization_and_drive(bits, ksmps, mode):
    x = np.linspace(-1.2, 1.2, 4800, dtype=np.float32)
    source = np.column_stack([x, -x])
    audio = render('bit_crusher', source, ksmps=ksmps, mode=mode,
                   bc_bits=bits, bc_downsample=1, bc_output=0, bc_drive=6)
    q = 2 ** (int(np.floor(bits + .5)) - 1)
    expected = np.minimum(np.floor(np.clip(source.astype(float) * 10 ** .3, -1, 1) * q + .5) / q, 1 - 1 / q)
    # fold initializes its held sample to zero, then samples from frame 1.
    expected[0] = 0
    np.testing.assert_allclose(audio, expected, atol=1e-9)


def test_crusher_dry_and_sample_holding():
    x = np.linspace(-.8, .8, 4800, dtype=np.float32)
    source = np.column_stack([x, -x])
    np.testing.assert_allclose(render('bit_crusher', source, bc_mix=0, bc_output=0), source, atol=1e-12)
    audio = render('bit_crusher', source, bc_downsample=8, bc_bits=16, bc_output=0)
    changes = np.flatnonzero(np.abs(np.diff(audio[:, 0])) > 1e-6) + 1
    assert len(changes) > 500
    np.testing.assert_array_equal(np.diff(changes), 8)


@pytest.mark.parametrize('ksmps,mode', [(32, 'midi'), (64, 'midi'), (1, 'midi'), (1, 'score')])
def test_harmonizer_dry_and_unison_latency(ksmps, mode):
    source = np.zeros((8192, 2), dtype=np.float32)
    source[2048] = [.2, -.1]
    expected = np.zeros_like(source)
    expected[3584] = source[2048]
    dry = render('harmonizer', source, ksmps=ksmps, mode=mode, hz_mix=0, hz_output=0)
    np.testing.assert_allclose(dry, expected, atol=1e-10)
    wet = render('harmonizer', source, ksmps=ksmps, mode=mode, hz_mix=1, hz_output=0,
                 hz_interval1=0, hz_interval2=0, hz_level1=1, hz_level2=1)
    assert np.argmax(abs(wet[:, 0])) == 3584
    # Phase-vocoder reconstruction leaves low-level transient ringing.
    np.testing.assert_allclose(wet, expected, atol=5e-4)


@pytest.mark.parametrize('voice,interval', [(1, -24), (1, 7), (2, 12), (2, 24), (2, 6.6)])
def test_harmony_frequencies_levels_and_stereo_separation(voice, interval):
    t = np.arange(SR * 2) / SR
    source = np.column_stack([.1 * np.sin(2 * np.pi * 440 * t), np.zeros_like(t)])
    values = dict(hz_level1=0, hz_level2=0, hz_mix=1, hz_output=0)
    values[f'hz_level{voice}'] = 1
    values[f'hz_interval{voice}'] = interval
    audio = render('harmonizer', source, **values)
    np.testing.assert_array_equal(audio[:, 1], 0)
    spectrum = np.abs(np.fft.rfft(audio[SR:, 0] * np.hanning(SR)))
    expected = 440 * 2 ** (np.floor(interval + .5) / 12)
    assert abs(np.argmax(spectrum) - expected) < 2
    values[f'hz_level{voice}'] = .5
    half = render('harmonizer', source, **values)
    np.testing.assert_allclose(half, audio * .5, atol=1e-9)
    values[f'hz_level{voice}'] = 0
    np.testing.assert_array_equal(render('harmonizer', source, **values), 0)


@pytest.mark.parametrize('name', ['stereo_widener', 'bit_crusher', 'harmonizer'])
def test_controller_endpoints_silence_finiteness_and_tails(name):
    patch = load_patch_fixture(name)
    controls = [n for n in patch.graph.nodes if n.opcode == 'perf_controller']
    settings = [{}] + [{n.id: n.params[endpoint]} for n in controls for endpoint in ('min', 'max')]
    t = np.arange(SR // 4) / SR
    source = np.column_stack([.08 * np.sin(2 * np.pi * 440 * t), .06 * np.sin(2 * np.pi * 660 * t)])
    for values in settings:
        silent = render(name, np.zeros((SR // 20, 2)), **values)
        np.testing.assert_array_equal(silent, 0)
        audio = render(name, source, seconds=.5, **values)
        assert np.isfinite(audio).all()
        assert np.max(abs(audio)) < 1
        assert np.max(abs(audio[-2400:])) < 1e-6
    if name == 'bit_crusher':
        source[:, 1] = 0
        np.testing.assert_array_equal(render(name, source)[:, 1], 0)
