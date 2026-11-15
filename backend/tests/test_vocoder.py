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
    speech[:, 1] = 0
    a = render(patch, speech, sound, values={'voc_makeup': 0, 'voc_gain': 0})
    b = render(patch, speech, sound, values={'voc_makeup': 24, 'voc_gain': -24})
    np.testing.assert_allclose(a, b, atol=1e-6)
    np.testing.assert_allclose(b[:, 1], 0, atol=1e-6)
