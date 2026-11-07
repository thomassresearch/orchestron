"""Native controller fan-out shared with the final-image correctness probe."""
import pytest

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.tests.controller_fanout_support import probe_controller_fanout


@pytest.mark.parametrize('mode', ['step', 'curve'])
def test_controller_sequencer_fanout_reaches_separate_native_owners(monkeypatch, mode):
    monkeypatch.setenv('VISUALCSOUND_FORCE_MOCK_ENGINE', 'false')
    try:
        load_ctcsound_module()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    probe_controller_fanout(mode)
