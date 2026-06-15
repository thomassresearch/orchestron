from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.app.models.patch import PatchGraph
from backend.app.models.session import (
    SessionArpeggiatorConfig,
    SessionControllerSequencerKeypointConfig,
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
_OFFLINE_TRANSPORT_STEPS_PER_BEAT = 8
_OFFLINE_TRANSPORT_SUBUNITS_PER_STEP = 420
_OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT = _OFFLINE_TRANSPORT_STEPS_PER_BEAT * _OFFLINE_TRANSPORT_SUBUNITS_PER_STEP
_OFFLINE_CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM = 28
_OFFLINE_MAX_STEPS_PER_PAD = 128
_OFFLINE_DEFAULT_PAD_COUNT = 8
_OFFLINE_PAUSE_BEAT_COUNTS = {1, 2, 4, 8, 16}
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
    id: str | None = Field(default=None, min_length=1, max_length=128)
    patch_id: str = Field(alias="patchId", min_length=1)
    patch_name: str | None = Field(default=None, alias="patchName")
    midi_channel: int = Field(default=1, alias="midiChannel", ge=0, le=16)
    effect_source_ids: list[str] = Field(default_factory=list, alias="effectSourceIds", max_length=16)
    effect_routes: list[ExportPerformanceEffectRoute] = Field(
        default_factory=list, alias="effectRoutes", max_length=64
    )

    model_config = ConfigDict(populate_by_name=True)


class ExportPerformanceConfig(BaseModel):
    version: int = 1
    instruments: list[ExportPerformanceInstrumentAssignment] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class ExportedPatchDefinition(BaseModel):
    source_patch_id: str = Field(alias="sourcePatchId", min_length=1)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    is_template: bool = Field(default=False, alias="isTemplate")
    always_on: bool = Field(default=False, alias="alwaysOn")
    schema_version: int = 1
    graph: PatchGraph

    model_config = ConfigDict(populate_by_name=True)

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


class PerformanceCsdExportRequest(BaseModel):
    performance_export: PerformanceExportPayload = Field(alias="performanceExport")
    sequencer_config: SessionSequencerConfigRequest = Field(alias="sequencerConfig")

    @model_validator(mode="after")
    def validate_offline_export_budget(self) -> "PerformanceCsdExportRequest":
        config = self.sequencer_config
        playback_steps = config.playback_end_step - config.playback_start_step
        if playback_steps > OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS:
            raise ValueError(
                "Offline performance CSD export playback range exceeds "
                f"{OFFLINE_CSD_EXPORT_MAX_PLAYBACK_STEPS} transport steps."
            )
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
        event_count = 0
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
        * _OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT
        * max(1, int(timing.beat_rate_denominator))
    ) // max(1, int(timing.beat_rate_numerator))


def _step_count_for_length(length_beats: int, timing: SessionSequencerTimingConfig) -> int:
    return min(_OFFLINE_MAX_STEPS_PER_PAD, max(1, int(length_beats)) * max(1, int(timing.steps_per_beat)))


def _transport_subunits_per_local_step(timing: SessionSequencerTimingConfig) -> int:
    return max(
        1,
        (
            _OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT
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
    for token, segment_start, segment_end in segments:
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
            if step_subunit > playback_end_subunit:
                break
            step = pad.steps[local_step] if local_step < len(pad.steps) else None
            notes = _sequencer_step_note_values(step)
            if notes:
                attack_notes(step_subunit, notes)
            elif not _sequencer_step_hold(step):
                release_notes(step_subunit)

    sequence, repeat = _track_sequence(track)
    if not repeat and sequence_end_subunit <= playback_end_subunit:
        release_notes(sequence_end_subunit)
    release_notes(playback_end_subunit)
    return (event_count, activity_events)


def _clamp_controller_position(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _clamp_controller_value(value: float) -> int:
    return max(0, min(127, int(round(value))))


def _normalize_controller_keypoints(
    raw: list[SessionControllerSequencerKeypointConfig],
) -> tuple[tuple[float, int], ...]:
    epsilon = 1e-6
    normalized = sorted(
        (
            _clamp_controller_position(point.position),
            _clamp_controller_value(point.value),
        )
        for point in raw
    )

    start_point: tuple[float, int] | None = None
    end_point: tuple[float, int] | None = None
    interior: list[tuple[float, int]] = []
    for position, value in normalized:
        if position <= epsilon:
            start_point = (0.0, value)
            continue
        if position >= 1.0 - epsilon:
            end_point = (1.0, value)
            continue
        if interior and abs(interior[-1][0] - position) <= epsilon:
            interior[-1] = (position, value)
        else:
            interior.append((position, value))

    if start_point is None:
        start_point = (0.0, 0)
    if end_point is None:
        end_point = (1.0, 0)

    boundary_value = _clamp_controller_value(start_point[1])
    start_point = (0.0, boundary_value)
    end_point = (1.0, boundary_value)
    return (start_point, *interior, end_point)


def _catmull_rom_1d(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def _sample_controller_curve_value(
    keypoints: tuple[tuple[float, int], ...],
    normalized_position: float,
) -> int:
    t = _clamp_controller_position(normalized_position)
    points = keypoints or _normalize_controller_keypoints([])
    if len(points) <= 1:
        return 0
    if t <= 0.0:
        return _clamp_controller_value(points[0][1])
    if t >= 1.0:
        return _clamp_controller_value(points[-1][1])

    segment_index = 0
    for index in range(len(points) - 1):
        if t <= points[index + 1][0]:
            segment_index = index
            break

    p1 = points[segment_index]
    p2 = points[min(len(points) - 1, segment_index + 1)]
    p0 = points[max(0, segment_index - 1)]
    p3 = points[min(len(points) - 1, segment_index + 2)]
    span = max(1e-6, p2[0] - p1[0])
    local_t = max(0.0, min(1.0, (t - p1[0]) / span))
    return _clamp_controller_value(_catmull_rom_1d(p0[1], p1[1], p2[1], p3[1], local_t))


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

    rate_beats = _ARPEGGIATOR_RATE_BEATS.get(str(arpeggiator.rate), 0.25)
    generated_notes_per_step = 1
    if arpeggiator.pattern == "chord":
        generated_notes_per_step = max(1, int(arpeggiator.octaves))

    event_count = 0
    for interval_start, interval_end, max_held_notes in intervals:
        clipped_start = max(playback_start_subunit, interval_start)
        clipped_end = min(playback_end_subunit, interval_end)
        if clipped_end <= clipped_start:
            continue
        duration_beats = (clipped_end - clipped_start) / float(_OFFLINE_TRANSPORT_SUBUNITS_PER_BEAT)
        step_count = max(0, math.ceil(duration_beats / max(1e-6, rate_beats)))
        if arpeggiator.pattern == "chord":
            notes_per_step = max(1, max_held_notes * generated_notes_per_step)
        else:
            notes_per_step = generated_notes_per_step
        event_count += step_count * notes_per_step * 2
        if event_count > OFFLINE_CSD_EXPORT_MAX_MIDI_EVENTS:
            return event_count

    return event_count
