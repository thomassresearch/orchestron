from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SessionState(StrEnum):
    IDLE = "idle"
    COMPILED = "compiled"
    RUNNING = "running"
    ERROR = "error"


class SessionCreateRequest(BaseModel):
    patch_id: str = Field(min_length=1)


class SessionCreateResponse(BaseModel):
    session_id: str
    patch_id: str
    state: SessionState


class SessionInfo(BaseModel):
    session_id: str
    patch_id: str
    state: SessionState
    midi_input: str | None = None
    created_at: datetime
    started_at: datetime | None = None


class CompileResponse(BaseModel):
    session_id: str
    state: SessionState
    orc: str
    csd: str
    diagnostics: list[str] = Field(default_factory=list)


class SessionActionResponse(BaseModel):
    session_id: str
    state: SessionState
    detail: str


class MidiInputRef(BaseModel):
    id: str
    name: str
    backend: str


class BindMidiInputRequest(BaseModel):
    midi_input: str = Field(min_length=1)


MidiEventType = Literal["note_on", "note_off", "all_notes_off"]


class SessionMidiEventRequest(BaseModel):
    type: MidiEventType
    channel: int = Field(default=1, ge=1, le=16)
    note: int | None = Field(default=None, ge=0, le=127)
    velocity: int = Field(default=100, ge=1, le=127)

    @model_validator(mode="after")
    def validate_note_requirements(self) -> "SessionMidiEventRequest":
        if self.type in {"note_on", "note_off"} and self.note is None:
            raise ValueError("note is required for note_on/note_off MIDI events")
        return self


SequencerStepNotes = int | list[int] | None


class SessionSequencerPadConfig(BaseModel):
    pad_index: int = Field(ge=0, le=7)
    steps: list[SequencerStepNotes] = Field(default_factory=list, max_length=32)


class SessionSequencerTrackConfig(BaseModel):
    track_id: str = Field(min_length=1, max_length=64)
    midi_channel: int = Field(default=1, ge=1, le=16)
    velocity: int = Field(default=100, ge=1, le=127)
    gate_ratio: float = Field(default=0.8, gt=0.0, le=1.0)
    active_pad: int = Field(default=0, ge=0, le=7)
    queued_pad: int | None = Field(default=None, ge=0, le=7)
    pads: list[SessionSequencerPadConfig] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_unique_pad_indexes(self) -> "SessionSequencerTrackConfig":
        seen: set[int] = set()
        for pad in self.pads:
            if pad.pad_index in seen:
                raise ValueError(f"Duplicate pad_index '{pad.pad_index}' in track '{self.track_id}'.")
            seen.add(pad.pad_index)
        return self


class SessionSequencerConfigRequest(BaseModel):
    bpm: int = Field(default=120, ge=30, le=300)
    step_count: Literal[16, 32] = 16
    tracks: list[SessionSequencerTrackConfig] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def validate_unique_track_ids(self) -> "SessionSequencerConfigRequest":
        seen: set[str] = set()
        for track in self.tracks:
            if track.track_id in seen:
                raise ValueError(f"Duplicate track_id '{track.track_id}'.")
            seen.add(track.track_id)
        return self


class SessionSequencerStartRequest(BaseModel):
    config: SessionSequencerConfigRequest | None = None


class SessionSequencerQueuePadRequest(BaseModel):
    pad_index: int = Field(ge=0, le=7)


class SessionSequencerTrackStatus(BaseModel):
    track_id: str
    midi_channel: int
    active_pad: int = Field(ge=0, le=7)
    queued_pad: int | None = Field(default=None, ge=0, le=7)
    active_notes: list[int] = Field(default_factory=list)


class SessionSequencerStatus(BaseModel):
    session_id: str
    running: bool
    bpm: int = Field(ge=30, le=300)
    step_count: Literal[16, 32]
    current_step: int = Field(ge=0)
    cycle: int = Field(ge=0)
    tracks: list[SessionSequencerTrackStatus] = Field(default_factory=list)


class SessionEvent(BaseModel):
    session_id: str
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    type: str
    payload: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


@dataclass
class CompileArtifact:
    orc: str
    csd: str
    diagnostics: list[str] = field(default_factory=list)
