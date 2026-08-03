from __future__ import annotations

from backend.app.models.session import (
    SessionControllerSequencerKeypointConfig,
    SessionSequencerConfigRequest,
    SessionSequencerStepConfig,
)
from backend.app.services.sequencer_runtime_constants import (
    CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM,
    DEFAULT_PAD_COUNT,
    MAX_SEQUENCER_STEPS,
    PAUSE_BEAT_COUNTS,
    TRANSPORT_STEPS_PER_BEAT,
    TRANSPORT_SUBUNITS_PER_BEAT,
    TRANSPORT_SUBUNITS_PER_STEP,
)
from backend.app.services.sequencer_runtime_models import (
    ControllerSequencerEventRuntime,
    ControllerSequencerPadRuntime,
    ControllerSequencerTrackRuntime,
    SequencerPadRuntime,
    SequencerRuntimeConfig,
    SequencerStepRuntime,
    SequencerTimingRuntime,
    SequencerTrackRuntime,
)


def clamp_midi_note(value: int) -> int:
    return max(0, min(127, int(value)))


def clamp_midi_velocity(value: int) -> int:
    return max(0, min(127, int(value)))


def clamp_controller_value(value: float) -> int:
    return max(0, min(127, int(round(value))))


def _clamp_controller_position(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _normalize_step_notes(value: int | list[int] | None) -> tuple[int, ...]:
    if value is None:
        return ()
    if isinstance(value, int):
        return (clamp_midi_note(value),)
    if isinstance(value, list):
        notes: list[int] = []
        for entry in value:
            if not isinstance(entry, int):
                raise ValueError("Step notes list must contain integers only.")
            note = clamp_midi_note(entry)
            if note not in notes:
                notes.append(note)
        return tuple(notes)
    raise ValueError("Step value must be null, an integer note, or a list of integer notes.")


def _normalize_controller_keypoints(
    raw: list[SessionControllerSequencerKeypointConfig],
) -> tuple[tuple[float, int], ...]:
    epsilon = 1e-6
    normalized = sorted(
        (
            _clamp_controller_position(point.position),
            clamp_controller_value(point.value),
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

    boundary_value = clamp_controller_value(start_point[1])
    return ((0.0, boundary_value), *interior, (1.0, boundary_value))


def _controller_curve_control_points(
    keypoints: tuple[tuple[float, int], ...],
) -> tuple[tuple[float, int], ...]:
    if not keypoints:
        return _normalize_controller_keypoints([])
    return _normalize_controller_keypoints(
        [
            SessionControllerSequencerKeypointConfig(position=position, value=value)
            for position, value in keypoints
        ]
    )


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
    points = _controller_curve_control_points(keypoints)
    if len(points) <= 1:
        return 0
    if t <= 0.0:
        return clamp_controller_value(points[0][1])
    if t >= 1.0:
        return clamp_controller_value(points[-1][1])

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
    return clamp_controller_value(_catmull_rom_1d(p0[1], p1[1], p2[1], p3[1], local_t))


def _step_count_for_length(length_beats: int, timing: SequencerTimingRuntime) -> int:
    return min(MAX_SEQUENCER_STEPS, max(1, length_beats) * max(1, timing.steps_per_beat))


def _transport_subunit_count_for_length(length_beats: int, timing: SequencerTimingRuntime) -> int:
    return (
        max(1, length_beats) * TRANSPORT_SUBUNITS_PER_BEAT * timing.beat_rate_denominator
    ) // timing.beat_rate_numerator


def _normalize_step(
    value: int | list[int] | SessionSequencerStepConfig | None,
    default_velocity: int,
) -> SequencerStepRuntime:
    if isinstance(value, SessionSequencerStepConfig):
        return SequencerStepRuntime(
            notes=_normalize_step_notes(value.note),
            hold=bool(value.hold),
            velocity=clamp_midi_velocity(
                value.velocity if value.velocity is not None else default_velocity
            ),
        )
    return SequencerStepRuntime(
        notes=_normalize_step_notes(value),
        hold=False,
        velocity=clamp_midi_velocity(default_velocity),
    )


def _normalize_steps(
    raw_steps: list[int | list[int] | SessionSequencerStepConfig | None],
    step_count: int,
    default_velocity: int,
) -> tuple[SequencerStepRuntime, ...]:
    padded = raw_steps[:step_count] + [None] * max(0, step_count - len(raw_steps))
    return tuple(_normalize_step(entry, default_velocity) for entry in padded[:MAX_SEQUENCER_STEPS])


def _compile_controller_pad_runtime(
    keypoints: list[SessionControllerSequencerKeypointConfig],
    *,
    length_beats: int,
    timing: SequencerTimingRuntime,
) -> ControllerSequencerPadRuntime:
    step_count = _step_count_for_length(length_beats, timing)
    transport_subunit_count = _transport_subunit_count_for_length(length_beats, timing)
    normalized_keypoints = _normalize_controller_keypoints(keypoints)
    events: list[ControllerSequencerEventRuntime] = []

    for event_offset in range(0, transport_subunit_count, CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM):
        normalized_position = event_offset / float(max(1, transport_subunit_count))
        value = _sample_controller_curve_value(normalized_keypoints, normalized_position)
        if not events or events[-1].value != value:
            events.append(ControllerSequencerEventRuntime(offset_subunit=event_offset, value=value))

    if not events:
        events.append(ControllerSequencerEventRuntime(offset_subunit=0, value=0))

    return ControllerSequencerPadRuntime(
        length_beats=length_beats,
        step_count=step_count,
        transport_subunit_count=transport_subunit_count,
        events=tuple(events),
        event_offsets=tuple(event.offset_subunit for event in events),
    )


def _normalize_pad_loop_sequence(raw_sequence: list[int]) -> tuple[int, ...]:
    normalized: list[int] = []
    for entry in raw_sequence[:256]:
        token = int(entry)
        if 0 <= token < DEFAULT_PAD_COUNT:
            normalized.append(token)
            continue
        beat_count = abs(token) if token < 0 else 0
        if beat_count in PAUSE_BEAT_COUNTS:
            normalized.append(-beat_count)
    return tuple(normalized)


def _normalize_controller_target_channels(
    raw_channels: list[int],
    controller_default_channels: tuple[int, ...],
) -> tuple[int, ...]:
    if raw_channels:
        normalized = tuple(sorted({max(1, min(16, int(channel))) for channel in raw_channels}))
        if normalized:
            return normalized
    return controller_default_channels or (1,)


def _transport_subunit_count_for_token(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    token: int,
) -> int:
    pad = track.pads.get(token)
    if pad is not None:
        return max(1, pad.transport_subunit_count)
    beat_count = abs(token) if token < 0 else 0
    if beat_count in PAUSE_BEAT_COUNTS:
        return _transport_subunit_count_for_length(beat_count, track.timing)
    active_pad = track.pads.get(track.configured_active_pad)
    return max(1, active_pad.transport_subunit_count if active_pad else track.transport_subunit_count)


def _transport_extent_for_track(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    step_quantum: int,
) -> int:
    if track.pad_loop_enabled and track.pad_loop_sequence:
        return max(
            step_quantum,
            sum(_transport_subunit_count_for_token(track, token) for token in track.pad_loop_sequence),
        )
    return max(
        step_quantum,
        _transport_subunit_count_for_token(track, track.configured_active_pad),
    )


def compile_sequencer_runtime_config(
    request: SessionSequencerConfigRequest,
    *,
    controller_default_channels: tuple[int, ...],
) -> SequencerRuntimeConfig:
    timing = SequencerTimingRuntime(
        tempo_bpm=request.timing.tempo_bpm,
        meter_numerator=4,
        meter_denominator=4,
        steps_per_beat=TRANSPORT_STEPS_PER_BEAT,
        beat_rate_numerator=1,
        beat_rate_denominator=1,
    )
    step_quantum = TRANSPORT_STEPS_PER_BEAT
    subunit_quantum = TRANSPORT_SUBUNITS_PER_BEAT
    tracks: dict[str, SequencerTrackRuntime] = {}
    controller_tracks: dict[str, ControllerSequencerTrackRuntime] = {}

    for track_request in request.tracks:
        track_timing = SequencerTimingRuntime(
            tempo_bpm=request.timing.tempo_bpm,
            meter_numerator=track_request.timing.meter_numerator,
            meter_denominator=track_request.timing.meter_denominator,
            steps_per_beat=track_request.timing.steps_per_beat,
            beat_rate_numerator=track_request.timing.beat_rate_numerator,
            beat_rate_denominator=track_request.timing.beat_rate_denominator,
        )
        track_length_beats = track_request.length_beats if 1 <= track_request.length_beats <= 8 else 4
        track_step_count = _step_count_for_length(track_length_beats, track_timing)
        track_transport_subunit_count = _transport_subunit_count_for_length(track_length_beats, track_timing)
        pads: dict[int, SequencerPadRuntime] = {
            index: SequencerPadRuntime(
                length_beats=track_length_beats,
                step_count=track_step_count,
                transport_subunit_count=track_transport_subunit_count,
                steps=tuple(SequencerStepRuntime(notes=(), hold=False) for _ in range(track_step_count)),
                scale_root=track_request.scale_root,
                mode=track_request.mode,
            )
            for index in range(DEFAULT_PAD_COUNT)
        }

        for pad in track_request.pads:
            pad_length_beats = (
                pad.length_beats
                if pad.length_beats is not None and 1 <= pad.length_beats <= 8
                else track_length_beats
            )
            pad_step_count = _step_count_for_length(pad_length_beats, track_timing)
            pads[pad.pad_index] = SequencerPadRuntime(
                length_beats=pad_length_beats,
                step_count=pad_step_count,
                transport_subunit_count=_transport_subunit_count_for_length(pad_length_beats, track_timing),
                steps=_normalize_steps(pad.steps, pad_step_count, track_request.velocity),
                scale_root=pad.scale_root or track_request.scale_root,
                mode=pad.mode or track_request.mode,
            )

        active_pad = track_request.active_pad if track_request.active_pad in pads else 0
        queued_pad = track_request.queued_pad if track_request.queued_pad in pads else None
        tracks[track_request.track_id] = SequencerTrackRuntime(
            track_id=track_request.track_id,
            midi_channel=track_request.midi_channel,
            timing=track_timing,
            scale_root=track_request.scale_root,
            mode=track_request.mode,
            length_beats=track_length_beats,
            step_count=track_step_count,
            transport_subunit_count=track_transport_subunit_count,
            velocity=track_request.velocity,
            gate_ratio=track_request.gate_ratio,
            sync_to_track_id=track_request.sync_to_track_id,
            enabled=track_request.enabled,
            configured_enabled=track_request.enabled,
            queued_enabled=track_request.queued_enabled,
            pads=pads,
            active_pad=active_pad,
            configured_active_pad=active_pad,
            queued_pad=queued_pad,
            pad_loop_enabled=track_request.pad_loop_enabled,
            pad_loop_repeat=track_request.pad_loop_repeat,
            pad_loop_sequence=_normalize_pad_loop_sequence(track_request.pad_loop_sequence),
        )

    for track_request in request.controller_tracks:
        track_timing = SequencerTimingRuntime(
            tempo_bpm=request.timing.tempo_bpm,
            meter_numerator=track_request.timing.meter_numerator,
            meter_denominator=track_request.timing.meter_denominator,
            steps_per_beat=track_request.timing.steps_per_beat,
            beat_rate_numerator=track_request.timing.beat_rate_numerator,
            beat_rate_denominator=track_request.timing.beat_rate_denominator,
        )
        track_length_beats = track_request.length_beats if 1 <= track_request.length_beats <= 16 else 4
        track_step_count = _step_count_for_length(track_length_beats, track_timing)
        track_transport_subunit_count = _transport_subunit_count_for_length(track_length_beats, track_timing)
        pads = {
            index: _compile_controller_pad_runtime([], length_beats=track_length_beats, timing=track_timing)
            for index in range(DEFAULT_PAD_COUNT)
        }
        for pad in track_request.pads:
            pad_length_beats = (
                pad.length_beats
                if pad.length_beats is not None and 1 <= pad.length_beats <= 16
                else track_length_beats
            )
            pads[pad.pad_index] = _compile_controller_pad_runtime(
                pad.keypoints,
                length_beats=pad_length_beats,
                timing=track_timing,
            )

        active_pad = track_request.active_pad if track_request.active_pad in pads else 0
        queued_pad = track_request.queued_pad if track_request.queued_pad in pads else None
        controller_tracks[track_request.track_id] = ControllerSequencerTrackRuntime(
            track_id=track_request.track_id,
            controller_number=track_request.controller_number,
            target_channels=_normalize_controller_target_channels(
                track_request.target_channels,
                controller_default_channels,
            ),
            timing=track_timing,
            length_beats=track_length_beats,
            step_count=track_step_count,
            transport_subunit_count=track_transport_subunit_count,
            enabled=track_request.enabled,
            configured_enabled=track_request.enabled,
            pads=pads,
            active_pad=active_pad,
            configured_active_pad=active_pad,
            queued_pad=queued_pad,
            pad_loop_enabled=track_request.pad_loop_enabled,
            pad_loop_repeat=track_request.pad_loop_repeat,
            pad_loop_sequence=_normalize_pad_loop_sequence(track_request.pad_loop_sequence),
        )

    playback_end_subunit = request.playback_end_step * TRANSPORT_SUBUNITS_PER_STEP
    if "playback_end_step" not in request.model_fields_set:
        playback_end_subunit = max(
            subunit_quantum,
            max(
                (
                    _transport_extent_for_track(track, subunit_quantum)
                    for track in [*tracks.values(), *controller_tracks.values()]
                ),
                default=subunit_quantum,
            ),
        )

    return SequencerRuntimeConfig(
        timing=timing,
        step_count=step_quantum,
        playback_start_subunit=request.playback_start_step * TRANSPORT_SUBUNITS_PER_STEP,
        playback_end_subunit=playback_end_subunit,
        playback_loop=request.playback_loop,
        tracks=tracks,
        controller_tracks=controller_tracks,
        sync_master_track_ids=frozenset(
            track.sync_to_track_id
            for track in tracks.values()
            if track.sync_to_track_id is not None
        ),
    )
