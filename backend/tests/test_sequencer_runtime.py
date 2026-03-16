from __future__ import annotations

from backend.app.services import sequencer_runtime


def test_midi_schedule_lead_is_100ms() -> None:
    assert sequencer_runtime._MIDI_SCHEDULE_LEAD_S == 0.100
