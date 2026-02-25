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


class SessionInstrumentAssignment(BaseModel):
    patch_id: str = Field(min_length=1)
    midi_channel: int = Field(default=1, ge=1, le=16)


class SessionCreateRequest(BaseModel):
    patch_id: str | None = Field(default=None, min_length=1)
    instruments: list[SessionInstrumentAssignment] = Field(default_factory=list, min_length=0, max_length=16)

    @model_validator(mode="after")
    def validate_instrument_selection(self) -> "SessionCreateRequest":
        if not self.instruments and not self.patch_id:
            raise ValueError("Either patch_id or instruments must be provided when creating a session.")

        seen_channels: set[int] = set()
        for assignment in self.instruments:
            if assignment.midi_channel in seen_channels:
                raise ValueError(f"MIDI channel '{assignment.midi_channel}' is assigned more than once.")
            seen_channels.add(assignment.midi_channel)
        return self


class SessionCreateResponse(BaseModel):
    session_id: str
    patch_id: str
    instruments: list[SessionInstrumentAssignment] = Field(default_factory=list)
    state: SessionState


class SessionInfo(BaseModel):
    session_id: str
    patch_id: str
    instruments: list[SessionInstrumentAssignment] = Field(default_factory=list)
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


class SessionAudioWebRtcOfferRequest(BaseModel):
    type: Literal["offer"]
    sdp: str = Field(min_length=1)


class SessionAudioWebRtcAnswerResponse(BaseModel):
    type: Literal["answer"]
    sdp: str = Field(min_length=1)
    sample_rate: int = Field(ge=1)


class MidiInputRef(BaseModel):
    id: str
    name: str
    backend: str


class BindMidiInputRequest(BaseModel):
    midi_input: str = Field(min_length=1)


MidiEventType = Literal["note_on", "note_off", "all_notes_off", "control_change"]


class SessionMidiEventRequest(BaseModel):
    type: MidiEventType
    channel: int = Field(default=1, ge=1, le=16)
    note: int | None = Field(default=None, ge=0, le=127)
    velocity: int = Field(default=100, ge=1, le=127)
    controller: int | None = Field(default=None, ge=0, le=127)
    value: int | None = Field(default=None, ge=0, le=127)

    @model_validator(mode="after")
    def validate_note_requirements(self) -> "SessionMidiEventRequest":
        if self.type in {"note_on", "note_off"} and self.note is None:
            raise ValueError("note is required for note_on/note_off MIDI events")
        if self.type == "control_change":
            if self.controller is None:
                raise ValueError("controller is required for control_change MIDI events")
            if self.value is None:
                raise ValueError("value is required for control_change MIDI events")
        return self


SequencerStepNotes = int | list[int] | None


class SessionSequencerStepConfig(BaseModel):
    note: SequencerStepNotes = None
    hold: bool = False
    velocity: int | None = Field(default=None, ge=0, le=127)

    @model_validator(mode="before")
    @classmethod
    def coerce_notes_alias(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        if "note" not in value and "notes" in value:
            return {**value, "note": value["notes"]}
        return value


SequencerStepConfig = SequencerStepNotes | SessionSequencerStepConfig


class SessionSequencerPadConfig(BaseModel):
    pad_index: int = Field(ge=0, le=7)
    steps: list[SequencerStepConfig] = Field(default_factory=list, max_length=32)


class SessionSequencerTrackConfig(BaseModel):
    track_id: str = Field(min_length=1, max_length=64)
    midi_channel: int = Field(default=1, ge=1, le=16)
    step_count: Literal[16, 32] = 16
    velocity: int = Field(default=100, ge=1, le=127)
    gate_ratio: float = Field(default=0.8, gt=0.0, le=1.0)
    sync_to_track_id: str | None = Field(default=None, min_length=1, max_length=64)
    active_pad: int = Field(default=0, ge=0, le=7)
    queued_pad: int | None = Field(default=None, ge=0, le=7)
    pad_loop_enabled: bool = False
    pad_loop_repeat: bool = True
    pad_loop_sequence: list[int] = Field(default_factory=list, max_length=256)
    enabled: bool = True
    queued_enabled: bool | None = None
    pads: list[SessionSequencerPadConfig] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_unique_pad_indexes(self) -> "SessionSequencerTrackConfig":
        seen: set[int] = set()
        for pad in self.pads:
            if pad.pad_index in seen:
                raise ValueError(f"Duplicate pad_index '{pad.pad_index}' in track '{self.track_id}'.")
            seen.add(pad.pad_index)
        for index, pad_number in enumerate(self.pad_loop_sequence):
            if pad_number < 0 or pad_number > 7:
                raise ValueError(
                    f"pad_loop_sequence[{index}] must be in range 0..7 in track '{self.track_id}'."
                )
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
        for track in self.tracks:
            if track.sync_to_track_id is None:
                continue
            if track.sync_to_track_id == track.track_id:
                raise ValueError(f"Track '{track.track_id}' cannot sync to itself.")
            if track.sync_to_track_id not in seen:
                raise ValueError(
                    f"Track '{track.track_id}' sync_to_track_id '{track.sync_to_track_id}' does not exist."
                )
        return self


class SessionSequencerStartRequest(BaseModel):
    config: SessionSequencerConfigRequest | None = None


class SessionSequencerQueuePadRequest(BaseModel):
    pad_index: int = Field(ge=0, le=7)


class SessionSequencerTrackStatus(BaseModel):
    track_id: str
    midi_channel: int
    step_count: Literal[16, 32]
    local_step: int = Field(ge=0)
    active_pad: int = Field(ge=0, le=7)
    queued_pad: int | None = Field(default=None, ge=0, le=7)
    pad_loop_position: int | None = Field(default=None, ge=0)
    enabled: bool = True
    queued_enabled: bool | None = None
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
