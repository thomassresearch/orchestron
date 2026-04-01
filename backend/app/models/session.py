from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any
from typing import Literal

from pydantic import BaseModel, Field, model_validator

_PAUSE_BEAT_COUNTS: tuple[int, ...] = (1, 2, 4, 8, 16)
_PAUSE_TOKENS: tuple[int, ...] = tuple(-beat_count for beat_count in _PAUSE_BEAT_COUNTS)
_SEQUENCER_PAD_LENGTH_BEATS: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7, 8)
_CONTROLLER_SEQUENCER_PAD_LENGTH_BEATS: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7, 8, 16)
_SEQUENCER_BEAT_RATE_OPTIONS: tuple[tuple[int, int], ...] = (
    (1, 1),
    (2, 1),
    (3, 2),
    (4, 3),
    (3, 4),
    (5, 4),
    (4, 5),
    (7, 4),
)

SequencerPadLengthBeats = Literal[1, 2, 3, 4, 5, 6, 7, 8]
ControllerSequencerPadLengthBeats = Literal[1, 2, 3, 4, 5, 6, 7, 8, 16]


def _is_valid_pad_loop_token(token: int) -> bool:
    if 0 <= token <= 7:
        return True
    return token in _PAUSE_TOKENS


SessionAudioOutputMode = Literal["local", "streaming", "browser_clock"]


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


class BrowserClockClaimControllerRequest(BaseModel):
    type: Literal["claim_controller"]
    audio_context_sample_rate: int = Field(ge=1)
    queue_low_water_frames: int = Field(ge=1)
    queue_high_water_frames: int = Field(ge=1)
    max_blocks_per_request: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_queue_targets(self) -> "BrowserClockClaimControllerRequest":
        if self.queue_high_water_frames <= self.queue_low_water_frames:
            raise ValueError("queue_high_water_frames must be greater than queue_low_water_frames.")
        return self


class BrowserClockRequestRenderRequest(BaseModel):
    type: Literal["request_render"]
    block_count: int = Field(ge=1)


class BrowserClockReleaseControllerRequest(BaseModel):
    type: Literal["release_controller"]


class BrowserClockManualMidiRequest(BaseModel):
    type: Literal["manual_midi"]
    midi: SessionMidiEventRequest


class BrowserClockSequencerStartControlRequest(BaseModel):
    type: Literal["sequencer_start"]
    request_id: str = Field(min_length=1, max_length=128)
    config: "SessionSequencerConfigRequest | None" = None
    position_step: int | None = Field(default=None, ge=0)


class BrowserClockSequencerCommandRequest(BaseModel):
    type: Literal["sequencer_stop", "sequencer_rewind", "sequencer_forward"]
    request_id: str = Field(min_length=1, max_length=128)


class BrowserClockQueuePadControlRequest(BaseModel):
    type: Literal["queue_pad"]
    request_id: str = Field(min_length=1, max_length=128)
    track_id: str = Field(min_length=1, max_length=256)
    pad_index: int | None = Field(default=None, ge=0, le=7)


class MidiInputRef(BaseModel):
    id: str
    name: str
    backend: str
    selector: str


class BindMidiInputRequest(BaseModel):
    midi_input: str = Field(min_length=1)


MidiEventType = Literal["note_on", "note_off", "all_notes_off", "control_change"]


class SessionMidiEventRequest(BaseModel):
    type: MidiEventType
    channel: int = Field(default=1, ge=1, le=16)
    note: int | None = Field(default=None, ge=0, le=127)
    velocity: int = Field(default=100, ge=0, le=127)
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


class SessionSequencerTimingConfig(BaseModel):
    tempo_bpm: int = Field(default=120, ge=30, le=300)
    meter_numerator: Literal[2, 3, 4, 5, 6, 7] = 4
    meter_denominator: Literal[4, 8] = 4
    steps_per_beat: Literal[2, 4, 8] = 4
    beat_rate_numerator: int = Field(default=1, ge=1)
    beat_rate_denominator: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def validate_beat_rate(self) -> "SessionSequencerTimingConfig":
        if (self.beat_rate_numerator, self.beat_rate_denominator) not in _SEQUENCER_BEAT_RATE_OPTIONS:
            raise ValueError(
                "beat_rate must be one of "
                + ", ".join(f"{numerator}:{denominator}" for numerator, denominator in _SEQUENCER_BEAT_RATE_OPTIONS)
                + "."
            )
        return self

    @property
    def steps_per_bar(self) -> int:
        return self.meter_numerator * self.steps_per_beat


class SessionSequencerPadConfig(BaseModel):
    pad_index: int = Field(ge=0, le=7)
    length_beats: SequencerPadLengthBeats | None = None
    steps: list[SequencerStepConfig] = Field(default_factory=list, max_length=128)


class SessionControllerSequencerKeypointConfig(BaseModel):
    position: float = Field(ge=0.0, le=1.0)
    value: int = Field(ge=0, le=127)


class SessionControllerSequencerPadConfig(BaseModel):
    pad_index: int = Field(ge=0, le=7)
    length_beats: ControllerSequencerPadLengthBeats | None = None
    keypoints: list[SessionControllerSequencerKeypointConfig] = Field(default_factory=list, max_length=256)


class SessionSequencerTrackConfig(BaseModel):
    track_id: str = Field(min_length=1, max_length=256)
    midi_channel: int = Field(default=1, ge=1, le=16)
    timing: SessionSequencerTimingConfig = Field(default_factory=SessionSequencerTimingConfig)
    length_beats: SequencerPadLengthBeats = 4
    velocity: int = Field(default=100, ge=1, le=127)
    gate_ratio: float = Field(default=0.8, gt=0.0, le=1.0)
    sync_to_track_id: str | None = Field(default=None, min_length=1, max_length=256)
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
        for index, token in enumerate(self.pad_loop_sequence):
            if not _is_valid_pad_loop_token(token):
                raise ValueError(
                    "pad_loop_sequence[{index}] must be a pad index 0..7 or a pause token "
                    "-1/-2/-4/-8/-16 in track '{track_id}'.".format(index=index, track_id=self.track_id)
                )
        return self


class SessionControllerSequencerTrackConfig(BaseModel):
    track_id: str = Field(min_length=1, max_length=256)
    controller_number: int = Field(ge=0, le=127)
    timing: SessionSequencerTimingConfig = Field(default_factory=SessionSequencerTimingConfig)
    length_beats: ControllerSequencerPadLengthBeats = 4
    active_pad: int = Field(default=0, ge=0, le=7)
    queued_pad: int | None = Field(default=None, ge=0, le=7)
    pad_loop_enabled: bool = False
    pad_loop_repeat: bool = True
    pad_loop_sequence: list[int] = Field(default_factory=list, max_length=256)
    enabled: bool = True
    pads: list[SessionControllerSequencerPadConfig] = Field(default_factory=list, max_length=8)
    target_channels: list[int] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def validate_unique_pad_indexes(self) -> "SessionControllerSequencerTrackConfig":
        seen: set[int] = set()
        for pad in self.pads:
            if pad.pad_index in seen:
                raise ValueError(f"Duplicate pad_index '{pad.pad_index}' in controller track '{self.track_id}'.")
            seen.add(pad.pad_index)
        for index, token in enumerate(self.pad_loop_sequence):
            if not _is_valid_pad_loop_token(token):
                raise ValueError(
                    "pad_loop_sequence[{index}] must be a pad index 0..7 or a pause token "
                    "-1/-2/-4/-8/-16 in controller track '{track_id}'.".format(index=index, track_id=self.track_id)
                )
        if self.length_beats not in _CONTROLLER_SEQUENCER_PAD_LENGTH_BEATS:
            raise ValueError(
                "length_beats must be one of "
                + ", ".join(str(value) for value in _CONTROLLER_SEQUENCER_PAD_LENGTH_BEATS)
                + f" in controller track '{self.track_id}'."
            )
        normalized_channels: set[int] = set()
        for channel in self.target_channels:
            normalized_channel = int(channel)
            if normalized_channel < 1 or normalized_channel > 16:
                raise ValueError(
                    f"target_channels entries must be between 1 and 16 in controller track '{self.track_id}'."
                )
            normalized_channels.add(normalized_channel)
        self.target_channels = sorted(normalized_channels)
        return self


class SessionSequencerConfigRequest(BaseModel):
    timing: SessionSequencerTimingConfig = Field(default_factory=SessionSequencerTimingConfig)
    step_count: int = Field(default=16, ge=1)
    playback_start_step: int = Field(default=0, ge=0)
    playback_end_step: int = Field(default=16, ge=1)
    playback_loop: bool = False
    tracks: list[SessionSequencerTrackConfig] = Field(default_factory=list, max_length=128)
    controller_tracks: list[SessionControllerSequencerTrackConfig] = Field(default_factory=list, max_length=128)

    @model_validator(mode="after")
    def validate_unique_track_ids(self) -> "SessionSequencerConfigRequest":
        if self.playback_end_step <= self.playback_start_step:
            raise ValueError("playback_end_step must be greater than playback_start_step.")
        if not self.tracks and not self.controller_tracks:
            raise ValueError("At least one sequencer track or controller track must be configured.")
        seen: set[str] = set()
        for track in self.tracks:
            if track.track_id in seen:
                raise ValueError(f"Duplicate track_id '{track.track_id}'.")
            seen.add(track.track_id)
        for track in self.controller_tracks:
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
    position_step: int | None = Field(default=None, ge=0)


class SessionSequencerQueuePadRequest(BaseModel):
    pad_index: int | None = Field(default=None, ge=0, le=7)


class SessionSequencerTrackStatus(BaseModel):
    track_id: str
    midi_channel: int
    timing: SessionSequencerTimingConfig
    length_beats: SequencerPadLengthBeats
    step_count: int = Field(ge=1, le=128)
    local_step: int = Field(ge=0)
    active_pad: int = Field(ge=0, le=7)
    queued_pad: int | None = Field(default=None, ge=0, le=7)
    pad_loop_position: int | None = Field(default=None, ge=0)
    enabled: bool = True
    queued_enabled: bool | None = None
    runtime_pad_start_subunit: int | None = Field(default=None, ge=0)
    active_notes: list[int] = Field(default_factory=list)


class SessionControllerSequencerTrackStatus(BaseModel):
    track_id: str
    controller_number: int = Field(ge=0, le=127)
    timing: SessionSequencerTimingConfig
    length_beats: ControllerSequencerPadLengthBeats
    step_count: int = Field(ge=1, le=128)
    active_pad: int = Field(ge=0, le=7)
    queued_pad: int | None = Field(default=None, ge=0, le=7)
    pad_loop_position: int | None = Field(default=None, ge=0)
    enabled: bool = True
    runtime_pad_start_subunit: int | None = Field(default=None, ge=0)
    last_value: int | None = Field(default=None, ge=0, le=127)
    target_channels: list[int] = Field(default_factory=list)


class SessionSequencerStatus(BaseModel):
    session_id: str
    running: bool
    timing: SessionSequencerTimingConfig
    step_count: int = Field(ge=1)
    current_step: int = Field(ge=0)
    cycle: int = Field(ge=0)
    transport_subunit: int = Field(ge=0)
    tracks: list[SessionSequencerTrackStatus] = Field(default_factory=list)
    controller_tracks: list[SessionControllerSequencerTrackStatus] = Field(default_factory=list)


class SessionEvent(BaseModel):
    session_id: str
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)


@dataclass
class CompileArtifact:
    orc: str
    csd: str
    diagnostics: list[str] = field(default_factory=list)
