"""Compile the independent stereo vocoder fixture in live and export modes."""
import pytest
import numpy as np

from backend.tests.csound_test_support import load_patch_fixture
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


@pytest.mark.parametrize('ksmps', [1, 32, 64])
@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_vocoder_compile(ksmps, mode):
    patch = load_patch_fixture('vocoder')
    patch.graph.engine_config.ksmps = ksmps
    result = CompilerService(OpcodeService('/static/icons')).compile_patch_bundle(
        [PatchInstrumentTarget(patch, 0, assignment_id='voc', always_on=True)],
        midi_input='0', rtmidi_module='none', performance_input_mode=mode)
    assert result.orc.count(' pvsanal ') == 4
    assert result.orc.count(' pvsvoc ') == 2
    assert result.orc.count(' pvsynth ') == 2
    assert 'floor(' in result.orc and 'ampdb(' in result.orc


@pytest.mark.parametrize('ksmps,mode', [(1, 'score'), (32, 'midi'), (64, 'midi')])
def test_makeup_is_louder_with_full_level_probe_headroom(ksmps, mode):
    from backend.tools.vocoder_audio import render, signals
    patch = load_patch_fixture('vocoder')
    speech, sound = signals(.5)
    before = render(patch, speech, sound, values={'voc_makeup': 0}, ksmps=ksmps, mode=mode)
    after = render(patch, speech, sound, ksmps=ksmps, mode=mode)
    np.testing.assert_allclose(after, before * 10 ** (3 / 20), rtol=2e-5, atol=1e-6)
    assert np.isfinite(after).all()
    assert .1 < np.max(abs(after)) < .95
    assert np.sqrt(np.mean(after ** 2)) > np.sqrt(np.mean(before ** 2))
    np.testing.assert_allclose(after[-2400:], 0, atol=1e-6)


def test_makeup_trim_and_silent_channel():
    from backend.tools.vocoder_audio import render, signals
    patch = load_patch_fixture('vocoder')
    speech, sound = signals(.5)
    speech[:, 1] = sound[:, 1] = 0
    a = render(patch, speech, sound, values={'voc_makeup': 0, 'voc_gain': 0})
    b = render(patch, speech, sound, values={'voc_makeup': 24, 'voc_gain': -24})
    np.testing.assert_allclose(a, b, atol=1e-6)
    np.testing.assert_allclose(b[:, 1], 0, atol=1e-6)


def test_quiet_speech_drives_vocoder_independently_after_silence():
    from backend.tools.vocoder_audio import SAMPLE_RATE, render, signals

    patch = load_patch_fixture('vocoder')
    speech, carrier = signals(1)
    # Identical vowels and carriers, 36 dB apart, with two onsets.
    speech = np.repeat(speech[:, :1], 2, axis=1)
    carrier = np.repeat(carrier[:, :1], 2, axis=1)
    speech[:, 0] *= 10 ** (-36 / 20)
    speech[:SAMPLE_RATE // 4] = 0
    speech[SAMPLE_RATE // 2:3 * SAMPLE_RATE // 4] = 0
    output = render(patch, speech, carrier, values={'voc_output_ratio': 1})
    output -= render(patch, np.zeros_like(speech), carrier, values={'voc_output_ratio': 1})
    for start in (SAMPLE_RATE // 4, 3 * SAMPLE_RATE // 4):
        np.testing.assert_allclose(output[start - 2400:start], 0, atol=1e-6)
        # Allow 40 ms for the FFT and 5 ms for the output lookahead.
        window = output[start + 2160:start + 5040]
        quiet, loud = np.sqrt(np.mean(window ** 2, axis=0))
        assert loud > .03
        assert -4 < 20 * np.log10(quiet / loud) < 0


def test_speech_analysis_band_edges_and_stopband():
    from backend.tools.vocoder_audio import SAMPLE_RATE, render

    patch = load_patch_fixture('vocoder')
    # Tap the two analyzer inputs to measure the actual speech passband
    # independently of carrier harmonics and the vocoder's spectral smoothing.
    graph = patch.graph
    formulas = graph.ui_layout['input_formulas']
    for side in ('left', 'right'):
        analyzer = f'voc_speech_{side}'
        outlet = f'voc_out_{side}'
        source = next(e for e in graph.connections if e.to_node_id == analyzer and e.to_port_id == 'ain')
        tap = next(e for e in graph.connections if e.to_node_id == outlet)
        tap.from_node_id, tap.from_port_id = source.from_node_id, source.from_port_id
        formulas[f'{outlet}::asignal'] = formulas[f'{analyzer}::ain']

    t = np.arange(SAMPLE_RATE // 4) / SAMPLE_RATE
    levels = []
    for left, right in ((1000, 1000), (300, 3000), (75, 12000)):
        tones = .1 * np.sin(2 * np.pi * t[:, None] * [left, right])
        output = render(patch, tones, np.zeros_like(tones))
        levels.append(np.sqrt(np.mean(output[4800:9600] ** 2, axis=0)))
    edge_db, stop_db = 20 * np.log10(np.array(levels[1:]) / levels[0])
    np.testing.assert_allclose(edge_db, -3, atol=.6)
    assert np.all(stop_db < -22)


def test_output_compressor_ratio_and_stereo_link():
    from backend.tools.vocoder_audio import SAMPLE_RATE, render

    patch = load_patch_fixture('vocoder')
    t = np.arange(SAMPLE_RATE) / SAMPLE_RATE
    left = np.sin(2 * np.pi * 1000 * t) * np.where(t < .5, .25, .25 * 10 ** .5)
    stereo = np.column_stack([left, -left * .25])
    for ratio in (1, 4, 10):
        controls = {'voc_gain': 0, 'voc_makeup': 0, 'voc_dry_wet': .1}
        if ratio != 4:  # Exercise the actual patch default.
            controls['voc_output_ratio'] = ratio
        out = render(patch, np.zeros_like(stereo), stereo, values=controls)
        np.testing.assert_allclose(out[:, 1], -out[:, 0] * .25, atol=1e-7)
        low = np.max(np.abs(out[12000:21600, 0]))
        high = np.max(np.abs(out[36000:45600, 0]))
        assert 20 * np.log10(high / low) == pytest.approx(10 / ratio, abs=.15)
        if ratio == 1:
            delay = SAMPLE_RATE // 200
            np.testing.assert_allclose(out[delay + 32:delay + len(stereo)], stereo[32:] * .1, atol=2e-6)


def test_logarithmic_dry_mixin_adds_carrier_at_unity_wet_level():
    from backend.tools.vocoder_audio import SAMPLE_RATE, render, signals

    patch = load_patch_fixture('vocoder')
    control = next(n for n in patch.graph.nodes if n.id == 'voc_dry_wet')
    assert control.params == dict(label='Dry Mixin', min=.0001, max=.1,
                                  default=.0001, scale='logarithmic')
    speech, carrier = signals(.5)
    unity = {'voc_output_ratio': 1, 'voc_gain': 0, 'voc_makeup': 0}
    baseline = render(patch, speech, carrier, values=unity)
    delay = SAMPLE_RATE // 200
    delayed = np.zeros_like(baseline)
    delayed[delay:delay + len(carrier)] = carrier
    # The k_to_a gain interpolates from zero during the first control block.
    delayed[delay:delay + 32] *= (np.arange(1, 33) / 32)[:, None]
    for gain in (.001, .01, .1):
        out = render(patch, speech, carrier, values={**unity, 'voc_dry_wet': gain})
        np.testing.assert_allclose(out - baseline, delayed * (gain - .0001), atol=2e-6)

    silent = np.zeros_like(speech)
    full = render(patch, silent, carrier, values={'voc_dry_wet': .01})
    lower = render(patch, silent, carrier / 10, values={'voc_dry_wet': .1})
    np.testing.assert_allclose(full, lower, atol=2e-6)
