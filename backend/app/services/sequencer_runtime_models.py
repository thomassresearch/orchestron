from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from backend.app.services.sequencer_runtime_constants import (
    TRANSPORT_STEPS_PER_BEAT,
    TRANSPORT_SUBUNITS_PER_BEAT,
)


@dataclass(slots=True)
class SequencerStepRuntime:
    notes: tuple[int, ...]
    hold: bool = False
    velocity: int = 100


@dataclass(slots=True)
class SequencerPadRuntime:
    length_beats: int
    step_count: int
    transport_subunit_count: int
    steps: tuple[SequencerStepRuntime, ...]
    scale_root: str | None = None
    mode: str | None = None


@dataclass(slots=True)
class ControllerSequencerEventRuntime:
    offset_subunit: int
    value: int


@dataclass(slots=True)
class ControllerSequencerPadRuntime:
    length_beats: int
    step_count: int
    transport_subunit_count: int
    events: tuple[ControllerSequencerEventRuntime, ...]
    event_offsets: tuple[int, ...] = ()


@dataclass(slots=True)
class SequencerTrackRuntime:
    track_id: str
    midi_channel: int
    timing: SequencerTimingRuntime
    scale_root: str | None
    mode: str | None
    length_beats: int
    step_count: int
    transport_subunit_count: int
    velocity: int
    gate_ratio: float
    sync_to_track_id: str | None
    enabled: bool
    configured_enabled: bool
    queued_enabled: bool | None
    pads: dict[int, SequencerPadRuntime] = field(default_factory=dict)
    active_pad: int = 0
    configured_active_pad: int = 0
    queued_pad: int | None = None
    pad_loop_enabled: bool = False
    pad_loop_repeat: bool = True
    pad_loop_sequence: tuple[int, ...] = ()
    pad_loop_position: int | None = None
    phase_offset_subunit: int = 0
    sequence_ended: bool = False


@dataclass(slots=True)
class ControllerSequencerTrackRuntime:
    track_id: str
    controller_number: int
    target_channels: tuple[int, ...]
    timing: SequencerTimingRuntime
    length_beats: int
    step_count: int
    transport_subunit_count: int
    enabled: bool
    configured_enabled: bool
    pads: dict[int, ControllerSequencerPadRuntime] = field(default_factory=dict)
    active_pad: int = 0
    configured_active_pad: int = 0
    queued_pad: int | None = None
    pad_loop_enabled: bool = False
    pad_loop_repeat: bool = True
    pad_loop_sequence: tuple[int, ...] = ()
    pad_loop_position: int | None = None
    phase_offset_subunit: int = 0
    sequence_ended: bool = False
    last_value: int | None = None


@dataclass(slots=True)
class SequencerTimingRuntime:
    tempo_bpm: int
    meter_numerator: int
    meter_denominator: int
    steps_per_beat: int
    beat_rate_numerator: int = 1
    beat_rate_denominator: int = 1

    @property
    def steps_per_bar(self) -> int:
        return self.meter_numerator * self.steps_per_beat

    @property
    def beat_duration_seconds(self) -> float:
        return 60.0 / float(self.tempo_bpm)

    @property
    def step_duration_seconds(self) -> float:
        return self.beat_duration_seconds / float(self.steps_per_beat)

    @property
    def transport_step_duration_seconds(self) -> float:
        return self.beat_duration_seconds / float(TRANSPORT_STEPS_PER_BEAT)

    @property
    def transport_subunit_duration_seconds(self) -> float:
        return self.beat_duration_seconds / float(TRANSPORT_SUBUNITS_PER_BEAT)

    @property
    def transport_subunits_per_local_step(self) -> int:
        return (
            TRANSPORT_SUBUNITS_PER_BEAT * self.beat_rate_denominator
        ) // (self.beat_rate_numerator * self.steps_per_beat)


@dataclass(slots=True)
class SequencerRuntimeConfig:
    timing: SequencerTimingRuntime
    step_count: int
    playback_start_subunit: int = 0
    playback_end_subunit: int = TRANSPORT_SUBUNITS_PER_BEAT
    playback_loop: bool = False
    tracks: dict[str, SequencerTrackRuntime] = field(default_factory=dict)
    controller_tracks: dict[str, ControllerSequencerTrackRuntime] = field(default_factory=dict)
    sync_master_track_ids: frozenset[str] = frozenset()


@dataclass(slots=True)
class RenderTransportEvent:
    engine_sample: int
    kind: Literal["step", "pad_switches", "loop", "stopped"]
    payload: dict[str, Any]
