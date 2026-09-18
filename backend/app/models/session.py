from __future__ import annotations

from backend.app.models.performance_controller import ControllerNumber

from backend.app.models.audio import AudioGraph, MixerState, AudioDiagnostic

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
SequencerScaleRoot = Literal[
    "C",
    "C#",
    "Db",
    "D",
    "D#",
    "Eb",
    "E",
    "F",
    "F#",
    "Gb",
    "G",
    "G#",
    "Ab",
    "A",
    "A#",
    "Bb",
    "B",
    "Cb",
]
SequencerScaleType = Literal["major", "neutral", "minor"]
SequencerMode = Literal["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"]
ArpeggiatorPattern = Literal[
    "up",
    "down",
    "up_down",
    "down_up",
    "as_played",
    "random",
    "chord",
    "inside_out",
    "outside_in",
]
ArpeggiatorRate = Literal["1/1", "1/2", "1/4", "1/8", "1/16", "1/32", "1/8T", "1/16T", "1/8D", "1/16D"]
ArpeggiatorVelocityMode = Literal["input", "fixed", "accent", "random"]
ArpeggiatorRestartMode = Literal["free", "first_note", "beat", "bar"]


def _is_valid_pad_loop_token(token: int) -> bool:
    if 0 <= token <= 7:
        return True
    return token in _PAUSE_TOKENS


SessionAudioOutputMode = Literal["browser_clock"]
TimestampQuality = Literal["authoritative", "best_effort"]
BrowserClockRenderPriority = Literal["steady", "interactive"]

BROWSER_CLOCK_MAX_SAMPLE_RATE = 192_000
BROWSER_CLOCK_MAX_QUEUE_WATERMARK_MS = 2_000
BROWSER_CLOCK_MAX_BLOCKS_PER_REQUEST = 512
BROWSER_CLOCK_RENDER_QUEUE_MAXSIZE = 8
BROWSER_CLOCK_MAX_REPORTED_FRAMES = 6 * BROWSER_CLOCK_MAX_SAMPLE_RATE


class SessionState(StrEnum):
    IDLE = "idle"
    COMPILED = "compiled"
    RUNNING = "running"
    ERROR = "error"


class SessionEffectRoute(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    channel: str = Field(min_length=1, max_length=128)


class SessionInstrumentAssignment(BaseModel):
    performance_controller_values: dict[str, ControllerNumber] = Field(default_factory=dict)
    level: float | None = Field(default=None, ge=1, le=10, exclude=True)
    id: str | None = Field(default=None, min_length=1, max_length=128)
    patch_id: str = Field(min_length=1)
    midi_channel: int = Field(default=1, ge=0, le=16)
    effect_source_ids: list[str] = Field(default_factory=list, max_length=16)
    effect_routes: list[SessionEffectRoute] = Field(default_factory=list, max_length=64)




class SessionCreateRequest(BaseModel):
    audio_graph: AudioGraph | None = None
    mixer: MixerState = Field(default_factory=MixerState)
    patch_id: str | None = Field(default=None, min_length=1)
    instruments: list[SessionInstrumentAssignment] = Field(default_factory=list, min_length=0, max_length=64)

    @model_validator(mode="after")
    def validate_instrument_selection(self) -> "SessionCreateRequest":
        if not self.instruments and not self.patch_id:
            raise ValueError("Either patch_id or instruments must be provided when creating a session.")
        return self


class SessionInstrumentValidationRequest(BaseModel):
    audio_graph: AudioGraph | None = None
    mixer: MixerState = Field(default_factory=MixerState)
    instruments: list[SessionInstrumentAssignment] = Field(min_length=1, max_length=64)


class SessionResolvedEffectRoute(BaseModel):
    source_id: str
    source_outlet: str
    target_id: str
    target_inlet: str


class SessionInstrumentValidationResponse(BaseModel):
    audio_graph: AudioGraph | None = None
    diagnostics: list[AudioDiagnostic] = Field(default_factory=list)
    valid: bool = True
    instruments: list[SessionInstrumentAssignment]
    resolved_routes: list[SessionResolvedEffectRoute] = Field(default_factory=list)


class SessionCreateResponse(BaseModel):
    session_id: str
    patch_id: str
    instruments: list[SessionInstrumentAssignment] = Field(default_factory=list)
    state: SessionState


class SessionInfo(BaseModel):
    audio_graph: AudioGraph | None = None
    mixer: MixerState = Field(default_factory=MixerState)
    mixer_revision: int = 0
    session_id: str
    patch_id: str
    instruments: list[SessionInstrumentAssignment] = Field(default_factory=list)
    state: SessionState
    midi_input: str | None = None
    created_at: datetime
    started_at: datetime | None = None


class CompileResponse(BaseModel):
    manifest: dict[str, Any] = Field(default_factory=dict)
    session_id: str
    state: SessionState
    orc: str
    csd: str
    diagnostics: list[str] = Field(default_factory=list)


class SessionActionResponse(BaseModel):
    session_id: str
    state: SessionState
    detail: str


class BrowserClockClaimControllerRequest(BaseModel):
    type: Literal["claim_controller"]
    audio_context_sample_rate: int = Field(ge=1, le=BROWSER_CLOCK_MAX_SAMPLE_RATE)
    queue_low_water_frames: int = Field(ge=1)
    queue_high_water_frames: int = Field(ge=1)
    max_blocks_per_request: int = Field(ge=1, le=BROWSER_CLOCK_MAX_BLOCKS_PER_REQUEST)

    @model_validator(mode="after")
    def validate_queue_targets(self) -> "BrowserClockClaimControllerRequest":
        if self.queue_high_water_frames <= self.queue_low_water_frames:
            raise ValueError("queue_high_water_frames must be greater than queue_low_water_frames.")
        max_queue_frames = int(
            round(self.audio_context_sample_rate * (BROWSER_CLOCK_MAX_QUEUE_WATERMARK_MS / 1000.0))
        )
        if self.queue_high_water_frames > max_queue_frames:
            raise ValueError(
                "queue_high_water_frames exceeds the server browser-clock queue watermark budget "
                f"({max_queue_frames} frames)."
            )
        return self


class BrowserClockRequestRenderRequest(BaseModel):
    type: Literal["request_render"]
    block_count: int = Field(ge=1, le=BROWSER_CLOCK_MAX_BLOCKS_PER_REQUEST)
    request_id: str | None = Field(default=None, min_length=1, max_length=128)
    client_perf_ms: float | None = Field(default=None, ge=0.0)
    priority: BrowserClockRenderPriority = "steady"


class BrowserClockClockSyncRequest(BaseModel):
    type: Literal["clock_sync"]
    request_id: str = Field(min_length=1, max_length=128)
    client_send_perf_ms: float = Field(ge=0.0)


class BrowserClockReleaseControllerRequest(BaseModel):
    type: Literal["release_controller"]


class BrowserClockManualMidiRequest(BaseModel):
    type: Literal["manual_midi"]
    midi: SessionMidiEventRequest
    event_perf_ms: float | None = None


class BrowserClockTimingReportRequest(BaseModel):
    type: Literal["timing_report"]
    client_perf_ms: float
    audio_context_time_s: float = Field(ge=0.0)
    queued_frames: int = Field(ge=0, le=BROWSER_CLOCK_MAX_REPORTED_FRAMES)
    sample_rate: int = Field(ge=1, le=BROWSER_CLOCK_MAX_SAMPLE_RATE)
    pending_render_frames: int = Field(default=0, ge=0, le=BROWSER_CLOCK_MAX_REPORTED_FRAMES)
    underrun_count: int = Field(default=0, ge=0)
    clock_sync_offset_ns: int | None = None
    clock_sync_rtt_ms: float | None = Field(default=None, ge=0.0)


class BrowserClockSequencerStartControlRequest(BaseModel):
    arranger_active: bool = False
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


class HostMidiDeviceRef(MidiInputRef):
    host_id: str
    timestamp_quality: TimestampQuality = "best_effort"


class HostMidiRegisterRequest(BaseModel):
    type: Literal["register_host"]
    host_id: str = Field(min_length=1, max_length=256)
    host_name: str | None = Field(default=None, min_length=1, max_length=256)
    protocol_version: int = Field(default=1, ge=1)


class HostMidiClockSyncRequest(BaseModel):
    type: Literal["clock_sync"]
    client_monotonic_ns: int = Field(ge=0)


class HostMidiDeviceInventoryRequest(BaseModel):
    type: Literal["device_inventory"]
    devices: list[HostMidiDeviceRef] = Field(default_factory=list)


class HostMidiEvent(BaseModel):
    device_id: str = Field(min_length=1, max_length=256)
    midi: list[int] = Field(min_length=3, max_length=3)
    timestamp_ns: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_midi_bytes(self) -> "HostMidiEvent":
        if len(self.midi) != 3:
            raise ValueError("Host MIDI events must contain exactly 3 bytes.")
        self.midi = [max(0, min(255, int(value))) for value in self.midi]
        return self


class HostMidiEventsRequest(BaseModel):
    type: Literal["midi_events"]
    events: list[HostMidiEvent] = Field(default_factory=list)


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
    source_id: str | None = Field(default=None, min_length=1, max_length=256)
    source_scale_root: SequencerScaleRoot | None = None
    source_scale_type: SequencerScaleType | None = None
    source_mode: SequencerMode | None = None

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
    timing_offset_percent: int = Field(default=0, ge=-50, le=50, strict=True)
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
    scale_root: SequencerScaleRoot | None = None
    scale_type: SequencerScaleType | None = None
    mode: SequencerMode | None = None
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
    scale_root: SequencerScaleRoot | None = None
    scale_type: SequencerScaleType | None = None
    mode: SequencerMode | None = None
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


class ArpeggiatorStepConfig(BaseModel):
    kind: Literal["next", "position", "rest", "tie", "chord"] = "next"
    note_position: int = Field(default=1, ge=1, le=128)
    velocity: int = Field(default=100, ge=0, le=200)
    gate_ratio: float | None = Field(default=None, ge=0.05, le=2.0)
    probability: float = Field(default=1.0, ge=0, le=1)
    ratchets: int = Field(default=1, ge=1, le=4)


class ArpeggiatorPadConfig(BaseModel):
    length_beats: ControllerSequencerPadLengthBeats = 4
    rate: ArpeggiatorRate = "1/16"
    gate_ratio: float = Field(default=0.72, ge=0.05, le=2.0)
    swing: float = Field(default=0.0, ge=0.0, le=0.75)
    octaves: int = Field(default=1, ge=1, le=4)
    pattern: ArpeggiatorPattern = "up"
    octave_traversal: Literal["range", "octave"] = "range"
    velocity_mode: ArpeggiatorVelocityMode = "input"
    fixed_velocity: int = Field(default=100, ge=1, le=127)
    accent_cycle: list[int] = Field(default_factory=list, max_length=32)
    probability: float = Field(default=1.0, ge=0.0, le=1.0)
    repeats: int = Field(default=1, ge=1, le=4)
    humanize_ms: float = Field(default=0.0, ge=0.0, le=50.0)
    humanize_velocity: int = Field(default=0, ge=0, le=32)
    transpose: int = Field(default=0, ge=-24, le=24)
    scale_quantize: bool = False
    scale_mode: Literal["off", "source", "custom"] = "off"
    scale_root: SequencerScaleRoot = "C"
    scale_type: SequencerScaleType = "minor"
    mode: SequencerMode = "aeolian"
    rotation: int = Field(default=0, ge=0, le=31)
    advance_rests: bool = False
    random_seed: int = Field(default=42622, ge=0, le=2147483647)
    random_mode: Literal["repeat", "evolve"] = "repeat"
    steps: list[ArpeggiatorStepConfig] = Field(
        default_factory=lambda: [ArpeggiatorStepConfig() for _ in range(16)], min_length=1, max_length=32,
    )

    @model_validator(mode="before")
    @classmethod
    def migrate_settings(cls, value):
        if not isinstance(value, dict):
            return value
        value = dict(value)
        if "scale_mode" not in value:
            value["scale_mode"] = "source" if value.get("scale_quantize") else "off"
        if "steps" not in value and value.get("velocity_mode") == "accent" and value.get("accent_cycle"):
            accents = value["accent_cycle"][:32]
            # Old accents were absolute MIDI velocities, not percentages.
            value["steps"] = [{"velocity": round(max(1, min(127, v)) / 127 * 100)} for v in accents]
            if value.get("velocity_mode") == "accent":
                value["velocity_mode"] = "fixed"
                value["fixed_velocity"] = 127
        return value


class SessionArpeggiatorConfig(ArpeggiatorPadConfig):
    # Flat musical fields remain accepted for older API clients; pads are canonical.
    arpeggiator_id: str = Field(min_length=1, max_length=256)
    enabled: bool = False
    input_channel: int = Field(ge=1, le=16)
    target_channel: int = Field(ge=1, le=16)
    playback_mode: Literal["arranger", "live"] = "arranger"
    processing_mode: Literal["active", "bypass", "mute"] = "active"
    latch: bool = False
    hold_mode: Literal["off", "replace", "toggle"] = "off"
    restart_mode: ArpeggiatorRestartMode = "free"
    active_pad: int = Field(default=0, ge=0, le=7)
    pad_loop_enabled: bool = True
    pad_loop_repeat: bool = True
    pad_loop_sequence: list[int] = Field(default_factory=lambda: [0], max_length=8192)
    launch_quantize: Literal["cycle", "bar"] = "cycle"
    pads: list[ArpeggiatorPadConfig] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def complete_pads(self):
        if any(not _is_valid_pad_loop_token(token) for token in self.pad_loop_sequence):
            raise ValueError("Invalid arpeggiator pad sequence token")
        if not self.pads:
            self.pads = [ArpeggiatorPadConfig.model_validate(self.model_dump(exclude={"pads"}))]
        self.pads += [ArpeggiatorPadConfig() for _ in range(8 - len(self.pads))]
        return self


class ArpeggiatorCommand(BaseModel):
    command: Literal["launch", "cancel", "arrangement", "clear"]
    pad_index: int | None = Field(default=None, ge=0, le=7)

    @model_validator(mode="after")
    def require_pad(self):
        if self.command == "launch" and self.pad_index is None:
            raise ValueError("launch requires pad_index")
        return self


class ArrangerTransportRequest(BaseModel):
    active: bool


def _validate_arpeggiator_routes(arpeggiators: list[SessionArpeggiatorConfig]) -> None:
    seen_arpeggiator_ids: set[str] = set()
    seen_input_channels: set[int] = set()
    for arpeggiator in arpeggiators:
        if arpeggiator.arpeggiator_id in seen_arpeggiator_ids:
            raise ValueError(f"Duplicate arpeggiator_id '{arpeggiator.arpeggiator_id}'.")
        seen_arpeggiator_ids.add(arpeggiator.arpeggiator_id)
        if arpeggiator.input_channel in seen_input_channels:
            raise ValueError(f"Arpeggiator input channel '{arpeggiator.input_channel}' is assigned more than once.")
        seen_input_channels.add(arpeggiator.input_channel)
    for arpeggiator in arpeggiators:
        if arpeggiator.target_channel in seen_input_channels:
            raise ValueError(
                f"Arpeggiator '{arpeggiator.arpeggiator_id}' target_channel cannot target another arpeggiator input."
            )


class SessionArpeggiatorConfigRequest(BaseModel):
    tempo_bpm: int = Field(default=120, ge=30, le=300)
    arpeggiators: list[SessionArpeggiatorConfig] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def validate_arpeggiators(self) -> "SessionArpeggiatorConfigRequest":
        _validate_arpeggiator_routes(self.arpeggiators)
        return self


class LaneOutputControl(BaseModel):
    mute: bool = False
    solo: bool = False


class SessionLaneOutputRequest(BaseModel):
    revision: int = Field(ge=0)
    lanes: dict[str, LaneOutputControl] = Field(default_factory=dict, max_length=272)


class BrowserClockLaneOutputRequest(SessionLaneOutputRequest):
    type: Literal["lane_output"]
    request_id: str = Field(min_length=1, max_length=128)


class SessionSequencerConfigRequest(BaseModel):
    lane_output: SessionLaneOutputRequest | None = None
    timing: SessionSequencerTimingConfig = Field(default_factory=SessionSequencerTimingConfig)
    step_count: int = Field(default=16, ge=1)
    playback_start_step: int = Field(default=0, ge=0)
    playback_end_step: int = Field(default=16, ge=1)
    playback_loop: bool = False
    tracks: list[SessionSequencerTrackConfig] = Field(default_factory=list, max_length=128)
    controller_tracks: list[SessionControllerSequencerTrackConfig] = Field(default_factory=list, max_length=128)
    arpeggiators: list[SessionArpeggiatorConfig] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def validate_unique_track_ids(self) -> "SessionSequencerConfigRequest":
        if self.playback_end_step <= self.playback_start_step:
            raise ValueError("playback_end_step must be greater than playback_start_step.")
        if not self.tracks and not self.controller_tracks and not self.arpeggiators:
            raise ValueError("At least one sequencer, controller, or arpeggiator must be configured.")
        seen: set[str] = set()
        for track in self.tracks:
            if track.track_id in seen:
                raise ValueError(f"Duplicate track_id '{track.track_id}'.")
            seen.add(track.track_id)
        for track in self.controller_tracks:
            if track.track_id in seen:
                raise ValueError(f"Duplicate track_id '{track.track_id}'.")
            seen.add(track.track_id)
        _validate_arpeggiator_routes(self.arpeggiators)
        if self.lane_output is not None:
            lane_ids = {t.track_id.split(":")[1] if t.track_id.startswith("drumrow:") and len(t.track_id.split(":")) == 3 else t.track_id for t in self.tracks}
            lane_ids.update(t.track_id for t in self.controller_tracks)
            lane_ids.update(a.arpeggiator_id for a in self.arpeggiators if a.playback_mode == "arranger")
            if self.lane_output.lanes.keys() - lane_ids:
                raise ValueError("Unknown arranger lane.")
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
    arranger_active: bool = False


class SessionSequencerSeekRequest(BaseModel):
    config: SessionSequencerConfigRequest
    position_step: int = Field(ge=0)


class SessionAuditionRequest(BaseModel):
    """Session-only override. Never part of a performance or bundle."""
    action: Literal["start", "cancel", "stop", "return", "preview_start", "preview_end", "workspace_start", "workspace_end"]
    gesture_id: str | None = Field(default=None, min_length=1, max_length=128)
    revision: int | None = Field(default=None, ge=0)
    track_ids: list[str] = Field(default_factory=list, max_length=128)
    arpeggiator_id: str | None = Field(default=None, min_length=1, max_length=256)
    sequence: list[int] = Field(default_factory=list, max_length=256)

    @model_validator(mode="after")
    def valid_target_and_tokens(self):
        if bool(self.track_ids) == bool(self.arpeggiator_id):
            raise ValueError("Specify tracks or one arpeggiator.")
        if len(set(self.track_ids)) != len(self.track_ids) or any(not i or len(i) > 256 for i in self.track_ids):
            raise ValueError("Invalid track identifiers.")
        if self.action in {"start", "preview_start", "workspace_start"} and not self.sequence:
            raise ValueError("An audition requires a playable sequence.")
        if self.action.startswith(("preview_", "workspace_")) and (self.gesture_id is None or self.revision is None):
            raise ValueError("A preview requires a gesture identity and revision.")
        if self.action.startswith("workspace_") and self.arpeggiator_id:
            raise ValueError("Workspace audition requires sequencer tracks.")
        if any(t not in set(range(8)) | {-1, -2, -4, -8, -16} for t in self.sequence):
            raise ValueError("Invalid audition token.")
        return self


class BrowserClockAuditionRequest(SessionAuditionRequest):
    type: Literal["audition"]
    request_id: str = Field(min_length=1, max_length=128)


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


class SessionArpeggiatorStatus(BaseModel):
    arpeggiator_id: str
    enabled: bool
    input_channel: int = Field(ge=1, le=16)
    target_channel: int = Field(ge=1, le=16)
    held_notes: list[int] = Field(default_factory=list)
    active_note: int | None = Field(default=None, ge=0, le=127)
    step_index: int = Field(default=0, ge=0)
    last_velocity: int | None = Field(default=None, ge=0, le=127)

    active_notes: list[int] = Field(default_factory=list)
    active_pad: int = 0
    queued_pad: int | None = None
    pad_loop_position: int | None = None
    manual_override: bool = False
    cycle: int = 0
    state: Literal["stopped", "waiting_notes", "waiting_arranger", "playing", "bypassed", "muted", "pause"] = "stopped"
    effective_scale: str = "off"
    preview_notes: list[list[int]] = Field(default_factory=list)
    preview_degrees: list[list[Literal[1, 2, 3, 4, 5, 6, 7] | None]] = Field(default_factory=list)


class SessionSequencerStatus(BaseModel):
    lane_output: dict[str, Any] = Field(default_factory=dict)
    auditions: dict[str, dict[str, Any]] = Field(default_factory=dict)
    arranger_active: bool = False
    session_id: str
    running: bool
    timing: SessionSequencerTimingConfig
    step_count: int = Field(ge=1)
    current_step: int = Field(ge=0)
    cycle: int = Field(ge=0)
    transport_subunit: int = Field(ge=0)
    tracks: list[SessionSequencerTrackStatus] = Field(default_factory=list)
    controller_tracks: list[SessionControllerSequencerTrackStatus] = Field(default_factory=list)
    arpeggiators: list[SessionArpeggiatorStatus] = Field(default_factory=list)


class SessionEvent(BaseModel):
    session_id: str
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)


@dataclass
class CompileArtifact:
    # Populated for version-11 performance compilation; standalone patches remain independent.
    orc: str
    csd: str
    diagnostics: list[str] = field(default_factory=list)
    manifest: dict[str, Any] = field(default_factory=dict)
