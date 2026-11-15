"""Compile the independent stereo vocoder fixture in live and export modes."""
import pytest

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
