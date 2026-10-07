from __future__ import annotations

from functools import lru_cache

from backend.app.models.controller_curve import (
    clamp_controller_value as clamp_controller_value,
    normalize_controller_keypoints as _normalize_controller_keypoints,
    sample_controller_curve_values as _sample_controller_curve_values,
)
from backend.app.services.sequencer_note_timing import note_positions, ratchet_strikes, terminating_steps

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


def _step_count_for_length(length_beats: int, timing: SequencerTimingRuntime) -> int:
    return min(MAX_SEQUENCER_STEPS, max(1, length_beats) * max(1, timing.steps_per_beat))


def _transport_subunit_count_for_length(length_beats: int, timing: SequencerTimingRuntime) -> int:
    return (
        max(1, length_beats) * timing.local_beat_subunits * timing.beat_rate_denominator
    ) // timing.beat_rate_numerator


def _compile_controller_pad_runtime(
    keypoints: list[SessionControllerSequencerKeypointConfig],
    *,
    length_beats: int,
    timing: SequencerTimingRuntime,
) -> ControllerSequencerPadRuntime:
    step_count = _step_count_for_length(length_beats, timing)
    transport_subunit_count = _transport_subunit_count_for_length(length_beats, timing)
    normalized_keypoints = _normalize_controller_keypoints(keypoints)
    return _compiled_controller_pad(normalized_keypoints, length_beats, step_count, transport_subunit_count)


@lru_cache(maxsize=512)
def _compiled_controller_pad(
    normalized_keypoints: tuple[tuple[float, int], ...],
    length_beats: int,
    step_count: int,
    transport_subunit_count: int,
) -> ControllerSequencerPadRuntime:
    events: list[ControllerSequencerEventRuntime] = []

    constant = all(value == normalized_keypoints[0][1] for _, value in normalized_keypoints)
    offsets = (0,) if constant else range(0, transport_subunit_count, CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM)
    duration = float(max(1, transport_subunit_count))
    values = _sample_controller_curve_values(normalized_keypoints, (offset / duration for offset in offsets))
    for event_offset, value in zip(offsets, values, strict=True):
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


_NoteStepKey = tuple[tuple[int, ...], bool, int | None, int, int, int | None]


def _note_step_key(
    steps: list[int | list[int] | SessionSequencerStepConfig | None],
    step_count: int,
) -> tuple[_NoteStepKey, ...]:
    # Trailing authored steps are retained in the request but do not play in this pad.
    return tuple(
        (_normalize_step_notes(step.note), bool(step.hold), step.velocity,
         step.timing_offset_percent, step.ratchets, step.ratchet_end_velocity)
        if isinstance(step, SessionSequencerStepConfig)
        else (_normalize_step_notes(step), False, None, 0, 1, None)
        for step in steps[:step_count]
    )


@lru_cache(maxsize=512)
def _cached_note_pad(
    key: tuple[_NoteStepKey, ...],
    velocity: int,
    length_beats: int,
    step_count: int,
    duration: int,
    span: int,
    scale_root: str | None,
    mode: str | None,
) -> SequencerPadRuntime:
    """Share immutable pad data only; each compilation creates fresh track state."""
    padded = key[:step_count] + (((), False, None, 0, 1, None),) * max(0, step_count - len(key))
    steps = tuple(
        SequencerStepRuntime(
            notes=notes,
            hold=hold,
            velocity=clamp_midi_velocity(value if value is not None else velocity),
            timing_offset_percent=offset,
            ratchets=ratchets,
            ratchet_end_velocity=end_velocity,
        )
        for notes, hold, value, offset, ratchets, end_velocity in padded[:MAX_SEQUENCER_STEPS]
    )
    positions = note_positions(steps, span)
    return SequencerPadRuntime(
        length_beats=length_beats,
        step_count=step_count,
        transport_subunit_count=duration,
        steps=steps,
        scale_root=scale_root,
        mode=mode,
        note_offsets=tuple(at for at, _ in positions),
        note_step_indices=tuple(index for _, index in positions),
        ratchet_strikes=ratchet_strikes(steps, span),
        terminating_step_indices=terminating_steps(steps),
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
        beat_unit=request.timing.beat_unit,
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
            beat_unit=track_request.timing.beat_unit,
        )
        track_length_beats = track_request.length_beats if 1 <= track_request.length_beats <= 16 else 4
        track_step_count = _step_count_for_length(track_length_beats, track_timing)
        track_transport_subunit_count = _transport_subunit_count_for_length(track_length_beats, track_timing)
        supplied_indexes = {pad.pad_index for pad in track_request.pads}
        pads: dict[int, SequencerPadRuntime] = {
            index: _cached_note_pad(
                (), 100, track_length_beats, track_step_count, track_transport_subunit_count,
                track_timing.transport_subunits_per_local_step, track_request.scale_root, track_request.mode,
            )
            for index in range(DEFAULT_PAD_COUNT)
            if index not in supplied_indexes
        }

        for pad in track_request.pads:
            pad_length_beats = (
                pad.length_beats
                if pad.length_beats is not None and 1 <= pad.length_beats <= 16
                else track_length_beats
            )
            pad_step_count = _step_count_for_length(pad_length_beats, track_timing)
            pads[pad.pad_index] = _cached_note_pad(
                _note_step_key(pad.steps, pad_step_count), track_request.velocity, pad_length_beats,
                pad_step_count, _transport_subunit_count_for_length(pad_length_beats, track_timing),
                track_timing.transport_subunits_per_local_step,
                pad.scale_root or track_request.scale_root, pad.mode or track_request.mode,
            )

        active_pad = track_request.active_pad if track_request.active_pad in pads else 0
        queued_pad = track_request.queued_pad if track_request.queued_pad in pads else None
        tracks[track_request.track_id] = SequencerTrackRuntime(
            track_id=track_request.track_id,
            has_timing_offsets=any(step.timing_offset_percent or step.ratchets > 1 for pad in pads.values() for step in pad.steps),
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
            configured_queued_enabled=track_request.queued_enabled,
            pads=pads,
            active_pad=active_pad,
            configured_active_pad=active_pad,
            queued_pad=queued_pad,
            configured_queued_pad=queued_pad,
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
            beat_unit=track_request.timing.beat_unit,
        )
        track_length_beats = track_request.length_beats if 1 <= track_request.length_beats <= 32 else 4
        track_step_count = _step_count_for_length(track_length_beats, track_timing)
        track_transport_subunit_count = _transport_subunit_count_for_length(track_length_beats, track_timing)
        supplied_indexes = {pad.pad_index for pad in track_request.pads}
        pads = {
            index: _compile_controller_pad_runtime([], length_beats=track_length_beats, timing=track_timing)
            for index in range(DEFAULT_PAD_COUNT)
            if index not in supplied_indexes
        }
        for pad in track_request.pads:
            pad_length_beats = (
                pad.length_beats
                if pad.length_beats is not None and 1 <= pad.length_beats <= 32
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
            configured_queued_pad=queued_pad,
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
