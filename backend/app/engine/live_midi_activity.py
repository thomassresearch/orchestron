from __future__ import annotations

from dataclasses import dataclass, field

from backend.app.models.session import SessionMidiEventRequest


@dataclass(slots=True)
class LiveMidiActivity:
    """Bounded, session-only external input state for browser playback policy."""

    host_id: str | None = None
    notes: set[tuple[int, int]] = field(default_factory=set)
    sustain: set[int] = field(default_factory=set)

    @property
    def held(self) -> bool:
        return bool(self.notes or self.sustain)

    def reset(self) -> None:
        self.host_id = None
        self.notes.clear()
        self.sustain.clear()

    def record(self, midi: SessionMidiEventRequest, host_id: str) -> None:
        self.host_id = host_id
        channel = midi.channel
        if midi.type == "note_on" and midi.velocity > 0:
            assert midi.note is not None
            self.notes.add((channel, midi.note))
        elif midi.type in {"note_on", "note_off"}:
            self.notes.discard((channel, midi.note))
        elif midi.type == "all_notes_off" or (midi.type == "control_change" and midi.controller in {120, 123}):
            self.notes = {key for key in self.notes if key[0] != channel}
            self.sustain.discard(channel)
        elif midi.type == "control_change" and midi.controller == 64:
            if midi.value is not None and midi.value >= 64:
                self.sustain.add(channel)
            else:
                self.sustain.discard(channel)
        elif midi.type == "control_change" and midi.controller == 121:
            self.sustain.discard(channel)
