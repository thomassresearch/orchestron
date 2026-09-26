from __future__ import annotations

from backend.app.models.performance_controller import ControllerNumber

from backend.app.models.audio import AudioGraph, MixerState

from backend.app.models.controller_curve import (
    normalize_controller_keypoints as _normalize_controller_keypoints,
    sample_controller_curve_value as _sample_controller_curve_value,
)
from backend.app.models.sequencer_constants import (
    TRANSPORT_SUBUNITS_PER_STEP as _OFFLINE_TRANSPORT_SUBUNITS_PER_STEP,
    TRANSPORT_SUBUNITS_PER_BEAT as _OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT,
    CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM as _OFFLINE_CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM,
    MAX_SEQUENCER_STEPS as _OFFLINE_MAX_STEPS_PER_PAD,
    DEFAULT_PAD_COUNT as _OFFLINE_DEFAULT_PAD_COUNT,
    PAUSE_BEAT_COUNTS as _OFFLINE_PAUSE_BEAT_COUNTS,
)

import math
from fractions import Fraction
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.app.models.instrument_type import InstrumentType, infer_instrument_type
from backend.app.models.patch import PatchGraph
from backend.app.models.session import (
    SessionArpeggiatorConfig,
    SessionControllerSequencerPadConfig,
    SessionControllerSequencerTrackConfig,
    SessionSequencerConfigRequest,
    SessionSequencerPadConfig,
    SessionSequencerStepConfig,
    SessionSequencerTimingConfig,
    SessionSequencerTrackConfig,
)
from backend.app.models.source_text import reject_control_characters

OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS = 65_536
OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS = 200_000
OFFLINE_CSD_EXPORT_MAX_STEP_NOTES = 16
OFFLINE_CSD_EXPORT_MAX_WALL_SECONDS = 5.0
_ARPEGGIATOR_RATE_BEATS: dict[str, float] = {
    "1/1": 4.0,
    "1/2": 2.0,
    "1/4": 1.0,
    "1/8": 0.5,
    "1/16": 0.25,
    "1/32": 0.125,
    "1/8T": 1.0 / 3.0,
    "1/16T": 1.0 / 6.0,
    "1/8D": 0.75,
    "1/16D": 0.375,
}


class ExportPerformanceEffectRoute(BaseModel):
    source_id: str = Field(alias="sourceId", min_length=1, max_length=128)
    channel: str = Field(min_length=1, max_length=128)

    model_config = ConfigDict(populate_by_name=True)


class ExportPerformanceInstrumentAssignment(BaseModel):
    performance_controller_values: dict[str, ControllerNumber] = Field(default_factory=dict, alias="performanceControllerValues")
    id: str | None = Field(default=None, min_length=1, max_length=128)
    patch_id: str = Field(alias="patchId", min_length=1)
    patch_name: str | None = Field(default=None, alias="patchName")
    midi_channel: int = Field(default=1, alias="midiChannel", ge=0, le=16)
    level: float | None = Field(default=None, ge=1, le=10, exclude=True)
    effect_source_ids: list[str] = Field(default_factory=list, alias="effectSourceIds", max_length=16)
    effect_routes: list[ExportPerformanceEffectRoute] = Field(
        default_factory=list, alias="effectRoutes", max_length=64
    )

    model_config = ConfigDict(populate_by_name=True)




class ExportPerformanceConfig(BaseModel):
    audio_graph: AudioGraph | None = Field(default=None, alias="audioGraph")
    mixer: MixerState = Field(default_factory=MixerState)
    version: int = Field(default=1, ge=1, le=18)
    instruments: list[ExportPerformanceInstrumentAssignment] = Field(default_factory=list, max_length=64)

    @model_validator(mode="after")
    def reject_conflicting_routing(self):
        if self.audio_graph is not None and any(b.effect_routes or b.effect_source_ids or b.level is not None for b in self.instruments):
            raise ValueError("Do not combine legacy Level/routing and the explicit audio graph")
        return self

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class ExportedPatchDefinition(BaseModel):
    source_patch_id: str = Field(alias="sourcePatchId", min_length=1)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    is_template: bool = Field(default=False, alias="isTemplate")
    always_on: bool = Field(default=False, alias="alwaysOn")
    instrument_type: InstrumentType = Field(default="melody", alias="instrumentType")
    schema_version: Literal[1, 2] = 1
    graph: PatchGraph

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def promote_control_flow_schema(self) -> "ExportedPatchDefinition":
        if "instrument_type" not in self.model_fields_set:
            self.instrument_type = infer_instrument_type(self.name, self.description, self.always_on)
        self.always_on = self.instrument_type == "continuous"
        if self.graph.control_flow:
            self.schema_version = 2
        return self

    @field_validator("source_patch_id")
    @classmethod
    def validate_source_patch_id_text(cls, value: str) -> str:
        return reject_control_characters(value, field_name="Source patch ID")

    @field_validator("name")
    @classmethod
    def validate_name_text(cls, value: str) -> str:
        return reject_control_characters(value, field_name="Patch name")


class ExportedPerformanceDocument(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    config: ExportPerformanceConfig


class PerformanceExportPayload(BaseModel):
    format: Literal["orchestron.performance"]
    version: Literal[1]
    exported_at: str
    performance: ExportedPerformanceDocument
    patch_definitions: list[ExportedPatchDefinition] = Field(default_factory=list)


class PerformanceCsdMidiControllerState(BaseModel):
    target_channels: list[Annotated[int, Field(strict=True, ge=1, le=16)]] = Field(
        default_factory=lambda: list(range(1, 17)), alias="targetChannels", min_length=1, max_length=16
    )

    controller_number: int = Field(alias="controllerNumber", ge=0, le=127)
    value: int = Field(ge=0, le=127)
    enabled: bool = True

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("target_channels")
    @classmethod
    def normalize_target_channels(cls, channels: list[int]) -> list[int]:
        return sorted(set(channels))


class PerformanceCsdExportRequest(BaseModel):
    performance_export: PerformanceExportPayload = Field(alias="performanceExport")
    sequencer_config: SessionSequencerConfigRequest = Field(alias="sequencerConfig")
    event_source: Literal["midiFile", "score"] = Field(default="midiFile", alias="eventSource")
    midi_controllers: list[PerformanceCsdMidiControllerState] = Field(
        default_factory=list,
        alias="midiControllers",
        max_length=32,
    )

    @model_validator(mode="after")
    def validate_offline_export_budget(self) -> "PerformanceCsdExportRequest":
        config = self.sequencer_config
        playback_steps = config.playback_end_step - config.playback_start_step
        if playback_steps > OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS:
            raise ValueError(
                "Offline performance CSD export playback range exceeds "
                f"{OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS} transport steps."
            )
        if config.playback_end_step > OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS:
            raise ValueError("Offline performance CSD export absolute end exceeds "
                             f"{OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS} transport steps.")
        if config.playback_loop:
            raise ValueError("Offline performance CSD export does not support looping playback.")

        for track in config.tracks:
            for pad in track.pads:
                for step in pad.steps:
                    note_count = _sequencer_step_note_count(step)
                    if note_count > OFFLINE_CSD_EXPORT_MAX_STEP_NOTES:
                        raise ValueError(
                            "Offline performance CSD export step note lists cannot exceed "
                            f"{OFFLINE_CSD_EXPORT_MAX_STEP_NOTES} notes."
                        )

        estimated_events = self._estimate_offline_midi_event_count(playback_steps)
        if estimated_events > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
            raise ValueError(
                "Offline performance CSD export would generate too many MIDI events "
                f"({estimated_events} estimated, limit {OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS})."
            )
        return self

    def _estimate_offline_midi_event_count(self, playback_steps: int) -> int:
        playback_start_subunit = self.sequencer_config.playback_start_step * _OFFLINE_TRANSPORT_SUBUNITS_PER_STEP
        playback_end_subunit = (
            self.sequencer_config.playback_start_step + max(1, int(playback_steps))
        ) * _OFFLINE_TRANSPORT_SUBUNITS_PER_STEP
        event_count = len({
            (channel, controller.controller_number)
            for controller in self.midi_controllers if controller.enabled
            for channel in controller.target_channels
        })
        note_activity_events: dict[int, list[tuple[int, str, tuple[int, ...]]]] = {}
        arpeggiator_input_channels = {
            arpeggiator.input_channel
            for arpeggiator in self.sequencer_config.arpeggiators
        }
        for track in self.sequencer_config.tracks:
            track_event_count, track_activity_events = _estimate_note_track_events(
                track,
                playback_start_subunit=playback_start_subunit,
                playback_end_subunit=playback_end_subunit,
                stop_at_limit=track.midi_channel not in arpeggiator_input_channels,
            )
            if track.midi_channel not in arpeggiator_input_channels:
                event_count += track_event_count
            if track_activity_events:
                note_activity_events.setdefault(track.midi_channel, []).extend(track_activity_events)
            if event_count > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
                return event_count

        fallback_channels = {
            assignment.midi_channel
            for assignment in self.performance_export.performance.config.instruments
            if 1 <= assignment.midi_channel <= 16
        } or {1}
        for track in self.sequencer_config.controller_tracks:
            event_count += _estimate_controller_track_events(
                track,
                fallback_channels=fallback_channels,
                consumed_input_channels=arpeggiator_input_channels,
                playback_start_subunit=playback_start_subunit,
                playback_end_subunit=playback_end_subunit,
            )
            if event_count > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
                return event_count

        for arpeggiator in self.sequencer_config.arpeggiators:
            event_count += _estimate_arpeggiator_events(
                arpeggiator,
                note_activity_events.get(arpeggiator.input_channel, []),
                playback_start_subunit=playback_start_subunit,
                playback_end_subunit=playback_end_subunit,
            )
            if event_count > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
                return event_count

        return event_count

    model_config = ConfigDict(populate_by_name=True)


def _sequencer_step_note_count(step: object) -> int:
    note_value: object
    if isinstance(step, SessionSequencerStepConfig):
        note_value = step.note
    elif isinstance(step, dict):
        note_value = step.get("note", step.get("notes"))
    else:
        note_value = step

    if note_value is None:
        return 0
    if isinstance(note_value, int):
        return 1
    if isinstance(note_value, list):
        unique_notes: set[int] = set()
        for note in note_value:
            if isinstance(note, int):
                unique_notes.add(max(0, min(127, int(note))))
            else:
                return OFFLINE_CSD_EXPORT_MAX_STEP_NOTES + 1
        return len(unique_notes)
    return OFFLINE_CSD_EXPORT_MAX_STEP_NOTES + 1


def _sequencer_step_note_values(step: object) -> tuple[int, ...]:
    note_value: object
    if isinstance(step, SessionSequencerStepConfig):
        note_value = step.note
    elif isinstance(step, dict):
        note_value = step.get("note", step.get("notes"))
    else:
        note_value = step

    if note_value is None:
        return ()
    if isinstance(note_value, int):
        return (max(0, min(127, int(note_value))),)
    if isinstance(note_value, list):
        notes: list[int] = []
        for note in note_value:
            if not isinstance(note, int):
                return ()
            normalized_note = max(0, min(127, int(note)))
            if normalized_note not in notes:
                notes.append(normalized_note)
        return tuple(notes[:OFFLINE_CSD_EXPORT_MAX_STEP_NOTES])
    return ()


def _sequencer_step_hold(step: object) -> bool:
    if isinstance(step, SessionSequencerStepConfig):
        return bool(step.hold)
    if isinstance(step, dict):
        return bool(step.get("hold", False))
    return False


def _pause_beat_count_from_token(token: int) -> int | None:
    if token >= 0:
        return None
    beat_count = abs(int(token))
    return beat_count if beat_count in _OFFLINE_PAUSE_BEAT_COUNTS else None


def _normalized_pad_loop_sequence(raw_sequence: list[int]) -> tuple[int, ...]:
    normalized: list[int] = []
    for entry in raw_sequence[:256]:
        token = int(entry)
        if 0 <= token < _OFFLINE_DEFAULT_PAD_COUNT:
            normalized.append(token)
            continue
        pause_beat_count = _pause_beat_count_from_token(token)
        if pause_beat_count is not None:
            normalized.append(-pause_beat_count)
    return tuple(normalized)


def _transport_subunits_for_length(length_beats: int, timing: SessionSequencerTimingConfig) -> int:
    return (
        max(1, int(length_beats))
        * (_OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT * 4 // (timing.meter_denominator if timing.beat_unit == "meter" else 4))
        * max(1, int(timing.beat_rate_denominator))
    ) // max(1, int(timing.beat_rate_numerator))


def _step_count_for_length(length_beats: int, timing: SessionSequencerTimingConfig) -> int:
    return min(_OFFLINE_MAX_STEPS_PER_PAD, max(1, int(length_beats)) * max(1, int(timing.steps_per_beat)))


def _transport_subunits_per_local_step(timing: SessionSequencerTimingConfig) -> int:
    return max(
        1,
        (
            (_OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT * 4 // (timing.meter_denominator if timing.beat_unit == "meter" else 4))
            * max(1, int(timing.beat_rate_denominator))
        )
        // (max(1, int(timing.beat_rate_numerator)) * max(1, int(timing.steps_per_beat))),
    )


def _pad_by_index(
    pads: list[SessionSequencerPadConfig] | list[SessionControllerSequencerPadConfig],
) -> dict[int, SessionSequencerPadConfig | SessionControllerSequencerPadConfig]:
    return {pad.pad_index: pad for pad in pads}


def _pad_length_beats(
    track: SessionSequencerTrackConfig | SessionControllerSequencerTrackConfig,
    token: int,
) -> int:
    if token >= 0:
        pad = _pad_by_index(track.pads).get(token)
        if pad is not None and pad.length_beats is not None:
            return int(pad.length_beats)
        return int(track.length_beats)
    pause_beat_count = _pause_beat_count_from_token(token)
    return pause_beat_count if pause_beat_count is not None else int(track.length_beats)


def _token_transport_subunit_count(
    track: SessionSequencerTrackConfig | SessionControllerSequencerTrackConfig,
    token: int,
) -> int:
    return _transport_subunits_for_length(_pad_length_beats(track, token), track.timing)


def _track_sequence(
    track: SessionSequencerTrackConfig | SessionControllerSequencerTrackConfig,
) -> tuple[tuple[int, ...], bool]:
    if track.pad_loop_enabled and track.pad_loop_sequence:
        return _normalized_pad_loop_sequence(track.pad_loop_sequence), bool(track.pad_loop_repeat)
    return (int(track.active_pad),), True


def _iter_track_token_segments(
    track: SessionSequencerTrackConfig | SessionControllerSequencerTrackConfig,
    *,
    playback_end_subunit: int,
) -> tuple[list[tuple[int, int, int]], int]:
    sequence, repeat = _track_sequence(track)
    if not sequence:
        return ([], 0)

    segments: list[tuple[int, int, int]] = []
    cursor = 0
    while cursor < playback_end_subunit:
        for token in sequence:
            length_subunits = max(1, _token_transport_subunit_count(track, token))
            next_cursor = cursor + length_subunits
            segments.append((token, cursor, next_cursor))
            cursor = next_cursor
            if cursor >= playback_end_subunit:
                break
        if not repeat:
            break
    return (segments, cursor)


def _estimate_note_track_events(
    track: SessionSequencerTrackConfig,
    *,
    playback_start_subunit: int,
    playback_end_subunit: int,
    stop_at_limit: bool = False,
) -> tuple[int, list[tuple[int, str, tuple[int, ...]]]]:
    if not track.enabled:
        return (0, [])

    pads = _pad_by_index(track.pads)
    local_step_span = _transport_subunits_per_local_step(track.timing)
    event_count = 0
    active_notes: set[int] = set()
    activity_events: list[tuple[int, str, tuple[int, ...]]] = []

    def release_notes(at_subunit: int) -> None:
        nonlocal event_count
        if not active_notes:
            return
        notes = tuple(sorted(active_notes))
        if playback_start_subunit <= at_subunit <= playback_end_subunit:
            event_count += len(notes)
        activity_events.append((at_subunit, "off", notes))
        active_notes.clear()

    def attack_notes(at_subunit: int, notes: tuple[int, ...]) -> None:
        nonlocal event_count
        release_notes(at_subunit)
        if not notes:
            return
        if playback_start_subunit <= at_subunit < playback_end_subunit:
            event_count += len(notes)
        activity_events.append((at_subunit, "on", notes))
        active_notes.update(notes)

    segments, sequence_end_subunit = _iter_track_token_segments(
        track,
        playback_end_subunit=playback_end_subunit,
    )
    for segment_index, (token, segment_start, segment_end) in enumerate(segments):
        if _pause_beat_count_from_token(token) is not None or token < 0:
            release_notes(segment_start)
            continue
        pad = pads.get(token)
        if pad is None:
            release_notes(segment_start)
            continue
        pad_length_beats = int(pad.length_beats) if pad.length_beats is not None else int(track.length_beats)
        step_count = _step_count_for_length(pad_length_beats, track.timing)
        for local_step in range(step_count):
            step_subunit = segment_start + (local_step * local_step_span)
            if step_subunit >= segment_end:
                break
            # An early cell just outside the nominal range may sound inside it.
            if step_subunit > playback_end_subunit + local_step_span // 2:
                break
            step = pad.steps[local_step] if local_step < len(pad.steps) else None
            notes = _sequencer_step_note_values(step)
            if notes:
                count = step.ratchets if isinstance(step, SessionSequencerStepConfig) else 1
                # Count every potential strike, including silent ramp endpoints.
                # This bounds direct output and supplies repeated input activity
                # to the downstream arpeggiator estimate.
                attack_start = step_subunit
                if count > 1:
                    attack_start += round(Fraction(local_step_span * step.timing_offset_percent, 100))
                    if local_step == 0 and (segment_index == 0 or segments[segment_index - 1][0] != token):
                        attack_start = max(segment_start, attack_start)
                for strike in range(count):
                    attack_notes(attack_start + round(Fraction(local_step_span * strike, count)), notes)
                    if stop_at_limit and event_count > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
                        return (event_count, activity_events)
                if count > 1:
                    release_notes(min(attack_start + local_step_span, playback_end_subunit))
            elif not _sequencer_step_hold(step):
                release_notes(step_subunit)

    sequence, repeat = _track_sequence(track)
    if not repeat and sequence_end_subunit <= playback_end_subunit:
        release_notes(sequence_end_subunit)
    release_notes(playback_end_subunit)
    return (event_count, activity_events)


def _controller_pad_events(
    pad: SessionControllerSequencerPadConfig | None,
    *,
    length_beats: int,
    timing: SessionSequencerTimingConfig,
) -> tuple[tuple[int, int], ...]:
    transport_subunit_count = _transport_subunits_for_length(length_beats, timing)
    normalized_keypoints = _normalize_controller_keypoints([] if pad is None else pad.keypoints)
    events: list[tuple[int, int]] = []

    event_offset = 0
    while event_offset < transport_subunit_count:
        normalized_position = event_offset / float(max(1, transport_subunit_count))
        value = _sample_controller_curve_value(normalized_keypoints, normalized_position)
        if not events or events[-1][1] != value:
            events.append((event_offset, value))
        event_offset += _OFFLINE_CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM

    if not events:
        events.append((0, 0))
    return tuple(events)


def _estimate_controller_track_events(
    track: SessionControllerSequencerTrackConfig,
    *,
    fallback_channels: set[int],
    consumed_input_channels: set[int],
    playback_start_subunit: int,
    playback_end_subunit: int,
) -> int:
    if not track.enabled:
        return 0
    target_channels = [
        channel
        for channel in (
            sorted({max(1, min(16, int(channel))) for channel in track.target_channels})
            or sorted(fallback_channels)
        )
        if channel not in consumed_input_channels
    ]
    if not target_channels:
        return 0

    pads = _pad_by_index(track.pads)
    event_count = 0
    last_value: int | None = None
    segments, _sequence_end_subunit = _iter_track_token_segments(
        track,
        playback_end_subunit=playback_end_subunit,
    )
    for token, segment_start, segment_end in segments:
        if _pause_beat_count_from_token(token) is not None or token < 0:
            continue
        pad = pads.get(token)
        length_beats = _pad_length_beats(track, token)
        for offset_subunit, value in _controller_pad_events(pad, length_beats=length_beats, timing=track.timing):
            event_subunit = segment_start + offset_subunit
            if event_subunit >= segment_end:
                break
            if event_subunit < playback_start_subunit:
                last_value = value
                continue
            if event_subunit >= playback_end_subunit:
                break
            if value == last_value:
                continue
            last_value = value
            event_count += len(target_channels)
            if event_count > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
                return event_count
    return event_count


def _estimate_arpeggiator_events(
    arpeggiator: SessionArpeggiatorConfig,
    activity_events: list[tuple[int, str, tuple[int, ...]]],
    *,
    playback_start_subunit: int,
    playback_end_subunit: int,
) -> int:
    if not arpeggiator.enabled or not activity_events:
        return 0

    events = sorted(activity_events, key=lambda item: (item[0], 0 if item[1] == "off" else 1))
    active_notes: set[int] = set()
    interval_start: int | None = None
    interval_max_notes = 0
    intervals: list[tuple[int, int, int]] = []

    for event_subunit, kind, notes in events:
        if event_subunit > playback_end_subunit:
            break
        was_active = bool(active_notes)
        if kind == "off":
            active_notes.difference_update(notes)
        else:
            active_notes.update(notes)
        is_active = bool(active_notes)
        if not was_active and is_active:
            interval_start = event_subunit
            interval_max_notes = len(active_notes)
        elif was_active and not is_active and interval_start is not None:
            intervals.append((interval_start, event_subunit, max(1, interval_max_notes)))
            interval_start = None
            interval_max_notes = 0
        elif is_active:
            interval_max_notes = max(interval_max_notes, len(active_notes))

    if active_notes and interval_start is not None:
        intervals.append((interval_start, playback_end_subunit, max(1, interval_max_notes)))

    if arpeggiator.processing_mode == "mute":
        return 0
    if arpeggiator.processing_mode == "bypass":
        return sum(len(notes) for _, _, notes in activity_events) + 2 * 128
    if arpeggiator.hold_mode != "off":
        first = min((at for at, kind, _ in activity_events if kind != "off"), default=playback_end_subunit)
        max_notes = min(128, sum(len(notes) for _, kind, notes in activity_events if kind != "off"))
        intervals = [(first, playback_end_subunit, max(1, max_notes))]
    event_count = 0
    for interval_start, interval_end, max_held_notes in intervals:
        clipped_start = max(playback_start_subunit, interval_start)
        clipped_end = min(playback_end_subunit, interval_end)
        if clipped_end <= clipped_start:
            continue
        duration_beats = (clipped_end - clipped_start) / float(_OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT)
        estimates = []
        for pad in arpeggiator.pads:
            rate = _ARPEGGIATOR_RATE_BEATS[str(pad.rate)]
            notes = min(128, max_held_notes * pad.octaves) if pad.pattern == "chord" or any(s.kind == "chord" for s in pad.steps) else 1
            strikes = max(s.ratchets for s in pad.steps)
            estimates.append(math.ceil(duration_beats / rate) * notes * strikes * 2)
        event_count += max(estimates, default=0)
        if event_count > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
            return event_count
    return event_count
