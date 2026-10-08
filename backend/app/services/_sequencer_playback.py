"""Playback kernel shared by the Python fallback and the optional Cython build.

The .pxd augments pure timing helpers with direct C calls. Absolute musical
positions deliberately remain Python integers, including signed phase anchors.
Stateful operations continue through the runtime, which owns locks and MIDI.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from copy import copy

from backend.app.services.sequencer_note_timing import RatchetRoll, SoundingTimedNote
from backend.app.services.sequencer_runtime_constants import (
    MAX_SEQUENCER_STEPS as _MAX_STEPS,
    PAUSE_BEAT_COUNTS as _PAUSE_BEAT_COUNTS,
    TRANSPORT_SUBUNITS_PER_BEAT as _TRANSPORT_SUBUNITS_PER_BEAT,
    TRANSPORT_SUBUNITS_PER_STEP as _TRANSPORT_SUBUNITS_PER_STEP,
)
from backend.app.services.sequencer_runtime_models import (
    ControllerSequencerPadRuntime, ControllerSequencerTrackRuntime,
    SequencerPadRuntime, SequencerRuntimeConfig, SequencerTimingRuntime, SequencerTrackRuntime,
)

_RENDER_SUBUNIT_EPSILON = 1e-9


def timing_span(timing):
    # Validated meter {4, 8}, grid <= 8, numerator <= 7, denominator <= 5:
    # intermediate values fit a signed 32-bit long as well as a 64-bit long.
    denominator = timing.meter_denominator if timing.beat_unit == "meter" else 4
    numerator = timing.beat_rate_numerator
    rate_denominator = timing.beat_rate_denominator
    steps = timing.steps_per_beat
    local_beat = (_TRANSPORT_SUBUNITS_PER_BEAT * 4) // denominator
    return (local_beat * rate_denominator) // (numerator * steps)



def advance_render_block(
    self,
    *,
    sample_rate: int,
    ksmps: int,
    block_start_sample: int | None = None,
) -> int:
    """Advance render-driven transport by one Csound k-block.

    This method runs inside the audio render deadline.  It deliberately
    returns only the tempo needed by the arpeggiator router rather than a
    full status snapshot; callers must request that snapshot once the
    render request has completed.
    """
    with self._lock:
        if self._clock_mode != "render_driven":
            raise RuntimeError("Render-driven advancement is only available in render_driven mode.")

        config = self._ensure_config()
        self._render_block_start_sample = (
            None if block_start_sample is None else max(0, int(block_start_sample))
        )

        self._render_event_delay_seconds = 0.0
        self._render_event_sample = self._render_block_start_sample
        if self.sources.active and not self.sources.arrangement_running and not self.sources.playing and not self._auditions:
            self.sources.stop_if_idle()
        if self._audition_status_tracks:
            self._emit_render_transport_event_locked("pad_switches",
                self._sequencer_pad_switches_event_payload_locked(config,
                    [{"track_id": identity} for identity in sorted(self._audition_status_tracks)]))
            self._audition_status_tracks.clear()
        if not self._running:
            self._render_event_delay_seconds = self._render_event_sample = None
            return config.timing.tempo_bpm
        if self._render_subunit_remainder <= _RENDER_SUBUNIT_EPSILON:
            self._render_subunit_remainder = 0.0
            self._perform_render_block_events_locked(config, self._absolute_subunit)
        elif self.sources.pending_starts:
            # Start a newly commanded device at this audio block even when
            # the shared clock lies between subunits. Do not replay peers.
            self._perform_render_block_events_locked(config, self._absolute_subunit,
                                                    self.sources.pending_starts)

        if sample_rate > 0 and ksmps > 0:
            block_seconds = float(ksmps) / float(sample_rate)
            # Explicit float conversion also keeps this temporary unboxed in Cython.
            subunit_duration = float(config.timing.transport_subunit_duration_seconds)
            if subunit_duration > 0.0:
                self._render_subunit_remainder += block_seconds / subunit_duration

        subunits_to_advance = int(self._render_subunit_remainder + _RENDER_SUBUNIT_EPSILON)
        while self._running and subunits_to_advance > 0:
            next_event_subunit = self._next_render_event_subunit
            if next_event_subunit is None or next_event_subunit <= self._absolute_subunit:
                next_event_subunit = self._next_event_subunit_locked(config, self._absolute_subunit)
                self._next_render_event_subunit = next_event_subunit

            distance_to_event = max(1, next_event_subunit - self._absolute_subunit)
            if distance_to_event > subunits_to_advance:
                self._absolute_subunit += subunits_to_advance
                self._render_subunit_remainder = max(
                    0.0,
                    self._render_subunit_remainder - float(subunits_to_advance),
                )
                subunits_to_advance = 0
                break

            # Events inside a large render block retain their individual sample positions.
            self._render_event_delay_seconds = max(0.0, block_seconds -
                (self._render_subunit_remainder - distance_to_event) * subunit_duration)
            self._render_event_sample = None if block_start_sample is None else block_start_sample + round(
                self._render_event_delay_seconds * sample_rate)
            self._advance_render_to_event_locked(config, next_event_subunit)
            self._render_subunit_remainder = max(
                0.0,
                self._render_subunit_remainder - float(distance_to_event),
            )
            subunits_to_advance -= distance_to_event
            if self._running:
                self._next_render_event_subunit = self._next_event_subunit_locked(
                    config,
                    self._absolute_subunit,
                )
                if self._render_subunit_remainder > _RENDER_SUBUNIT_EPSILON:
                    self._perform_render_block_events_locked(config, self._absolute_subunit)

        if self._render_subunit_remainder <= _RENDER_SUBUNIT_EPSILON:
            self._render_subunit_remainder = 0.0

        self._render_event_delay_seconds = None
        self._render_event_sample = None
        return config.timing.tempo_bpm


def _following_note_track(self, track: SequencerTrackRuntime, boundary: int) -> SequencerTrackRuntime | None:
    """Preview a local boundary without consuming queues or publishing state."""
    if not track.enabled or track.queued_enabled is False:
        return None
    following = copy(track)
    manual = track.queued_pad is not None and track.queued_pad != track.active_pad
    if manual:
        following.active_pad = track.queued_pad
        following.queued_pad = None
    token, stopped = self._pad_loop_boundary_action_locked(following, manual_switch_applied=manual)
    if stopped:
        return None
    if token is not None and token >= 0:
        following.active_pad = token
    following.phase_offset_subunit = boundary
    return following


def _timed_attacks(self, track: SequencerTrackRuntime, now: int, config: SequencerRuntimeConfig):
    pad = _active_pad_runtime(track)
    if pad is None or not pad.steps:
        return ()
    local = _local_transport_offset_for(track, now)
    base = now - local
    cursor = bisect_left(pad.note_offsets, local)
    positions = list(zip(pad.note_offsets[cursor:cursor + 2], pad.note_step_indices[cursor:cursor + 2]))
    if local == 0 and pad.note_offsets and pad.note_offsets[0] < 0:
        positions.insert(0, (0, pad.note_step_indices[0]))
    attacks = [(base + offset, base, index, pad.steps[index]) for offset, index in positions]
    boundary = base + pad.transport_subunit_count
    song_boundary = self.sources.next_boundary() if self.sources.active and self.sources.is_arrangement(track) else None
    if song_boundary is not None:
        attacks = [attack for attack in attacks if attack[0] < song_boundary]
    # An anticipated attack belongs to the upcoming occurrence, not the outgoing one.
    if not self._auditions.get(track.track_id, {}).get("action") and pad.note_offsets and pad.note_offsets[0] < 0 and (boundary < config.playback_end_subunit or config.playback_loop):
        following = self._following_note_track(track, boundary)
        if boundary >= config.playback_end_subunit:
            following = copy(track)
            self._position_prepared_track(following, config.playback_start_subunit)
            if (not following.enabled or config.playback_start_subunit != following.phase_offset_subunit
                    or track.queued_enabled is False or track.queued_pad not in (None, track.active_pad)):
                following = None
        if song_boundary is not None and boundary >= song_boundary:
            # A mapped seek releases arrangement notes at the song boundary.
            # Let the destination trigger its first step instead of anticipating
            # an occurrence that may be a rest, another pad, or beyond song end.
            following = None
        master = config.tracks.get(track.sync_to_track_id)
        sync_reset = master is not None and self._track_at_sync_boundary_locked(master, boundary)
        if (following is not None and following.active_pad == track.active_pad
                and _active_pad_runtime(following) is not None and not sync_reset
                and track.queued_enabled is not True):
            offset, index = pad.note_offsets[0], pad.note_step_indices[0]
            attacks.append((boundary + offset, boundary, index, pad.steps[index]))
    return attacks


def _nominal_note_end(self, track: SequencerTrackRuntime, base: int, after: int) -> int | None:
    """Find the next legacy note/rest boundary, including HOLDs across pads."""
    seen: set[tuple[int, int | None]] = set()
    candidate = track
    while True:
        pad = _active_pad_runtime(candidate)
        if pad is None:
            return base
        span = _transport_subunits_per_local_step(candidate)
        terminals = pad.terminating_step_indices
        index = bisect_right(terminals, (after - base) // span)
        if index < len(terminals):
            return base + terminals[index] * span
        boundary = base + pad.transport_subunit_count
        following = self._following_note_track(candidate, boundary)
        if following is None:
            return boundary
        signature = (following.active_pad, following.pad_loop_position)
        if signature in seen:
            return None  # All-HOLD cycle: sustain until a command or another attack.
        seen.add(signature)
        candidate, base = following, boundary


def _perform_ratchet_strike(self, track: SequencerTrackRuntime, now: int, delay: float | None) -> None:
    roll = self._ratchet_rolls.get(track.track_id)
    if roll is None or roll.next_attack != now:
        return
    strike = roll.strikes[roll.next_strike]
    # The occurrence and strike cursor survive live edits. A zero-velocity
    # strike releases its predecessor without emitting a MIDI note-on/off alias.
    roll.next_strike += 1
    self._next_render_event_subunit = None
    self._release_track_notes_locked(track.track_id, track.midi_channel,
                                     delivery_delay_seconds=delay, preserve_roll=True)
    self._timed_notes[track.track_id] = SoundingTimedNote(
        roll.nominal_start, roll.start - roll.nominal_start,
        roll.nominal_start + strike.release_offset,
    )
    if strike.velocity > 0:
        self._send_messages_locked(
            [self._note_on_message(track.midi_channel, note, strike.velocity) for note in roll.notes],
            delivery_delay_seconds=delay, source_context=self._source_context_for_track(track),
        )
        self._active_notes.setdefault(track.track_id, set()).update(roll.notes)


def _perform_note_events_locked(self, config: SequencerRuntimeConfig, now: int, delay: float | None = None,
                                *, track_ids: set[str] | None = None) -> None:
    for track_id, track in config.tracks.items():
        if track_ids is not None and track_id not in track_ids:
            continue
        pad = _active_pad_runtime(track)
        if not track.enabled or pad is None or not pad.steps:
            self._release_track_notes_locked(track_id, track.midi_channel, delivery_delay_seconds=delay)
            continue
        roll = self._ratchet_rolls.get(track_id)
        if roll is not None and roll.pad_index != track.active_pad:
            self._release_track_notes_locked(track_id, track.midi_channel, delivery_delay_seconds=delay)
            roll = None
        sounding = self._timed_notes.get(track_id)
        if not track.has_timing_offsets and sounding is None and roll is None:
            # Preserve the original single-hit path, including legacy HOLD semantics.
            duration = _active_pad_transport_subunit_count(track)
            local_offset = (now - track.phase_offset_subunit) % duration
            step_span = _transport_subunits_per_local_step(track)
            if local_offset % step_span:
                continue
            local_step = min(max(1, pad.step_count) - 1, local_offset // step_span)
            step = pad.steps[local_step]
            if not step.notes:
                if not step.hold:
                    self._release_track_notes_locked(track_id, track.midi_channel, delivery_delay_seconds=delay)
                continue
            base = now - local_offset
            self._last_timed_attack[track_id] = (track.active_pad, base, local_step)
        else:
            if sounding is not None and sounding.release_subunit is not None and sounding.release_subunit <= now:
                self._release_track_notes_locked(track_id, track.midi_channel, delivery_delay_seconds=delay,
                                                 preserve_roll=True)
            if roll is not None and roll.end <= now:
                self._ratchet_rolls.pop(track_id, None)
            matches = [attack for attack in self._timed_attacks(track, now, config) if attack[0] == now
                       and self._last_timed_attack.get(track_id) != (track.active_pad, attack[1], attack[2])]
            if not matches:
                self._perform_ratchet_strike(track, now, delay)
                continue
            _, base, index, step = matches[-1]
            self._last_timed_attack[track_id] = (track.active_pad, base, index)
            nominal = base + index * _transport_subunits_per_local_step(track)
            origin = track
            current_base = now - _local_transport_offset_for(track, now)
            if base > current_base:
                origin = self._following_note_track(track, base) or track
                if config.playback_loop and base == config.playback_end_subunit:
                    origin = copy(track)
                    self._position_prepared_track(origin, config.playback_start_subunit)
            self._release_track_notes_locked(track_id, track.midi_channel, delivery_delay_seconds=delay)
            if step.ratchets > 1:
                self._ratchet_rolls[track_id] = RatchetRoll(
                    track.active_pad, base, nominal, now, step.notes, pad.ratchet_strikes[index],
                )
                self._perform_ratchet_strike(track, now, delay)
                continue
            end = self._nominal_note_end(origin, base, nominal)
            self._timed_notes[track_id] = SoundingTimedNote(nominal, now - nominal, end)
        self._release_untimed_notes_before_attack(track, delay)
        self._send_messages_locked(
            [self._note_on_message(track.midi_channel, note, step.velocity) for note in step.notes],
            delivery_delay_seconds=delay, source_context=self._source_context_for_track(track),
        )
        self._active_notes.setdefault(track_id, set()).update(step.notes)


def _release_untimed_notes_before_attack(self, track: SequencerTrackRuntime, delay: float | None) -> None:
    if track.track_id not in self._timed_notes:
        self._release_track_notes_locked(track.track_id, track.midi_channel, delivery_delay_seconds=delay)


def _pause_beat_count_from_token(token: int) -> int | None:
    if token >= 0:
        return None
    beat_count = abs(int(token))
    return beat_count if beat_count in _PAUSE_BEAT_COUNTS else None


def _step_count_for_pause(pause_beat_count: int, timing: SequencerTimingRuntime) -> int:
    return max(1, pause_beat_count * max(1, timing.steps_per_beat))


def _transport_subunit_count_for_length(length_beats: int, timing: SequencerTimingRuntime) -> int:
    return (
        max(1, length_beats) *
        timing.local_beat_subunits *
        timing.beat_rate_denominator
    ) // timing.beat_rate_numerator


def _current_pad_loop_token(track: SequencerTrackRuntime | ControllerSequencerTrackRuntime) -> int | None:
    if not track.pad_loop_enabled or not track.pad_loop_sequence:
        return None
    position = track.pad_loop_position
    if position is None or position < 0 or position >= len(track.pad_loop_sequence):
        return None
    return track.pad_loop_sequence[position]


def _step_count_for_pad(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    pad_index: int,
) -> int:
    pad = track.pads.get(pad_index)
    if pad and 1 <= pad.step_count <= _MAX_STEPS:
        return pad.step_count
    return track.step_count if 1 <= track.step_count <= _MAX_STEPS else 16


def _transport_subunit_count_for_pad(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    pad_index: int,
) -> int:
    pad = track.pads.get(pad_index)
    if pad and pad.transport_subunit_count > 0:
        return pad.transport_subunit_count
    return max(1, track.transport_subunit_count)


def _step_count_for_loop_token(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    token: int,
) -> int:
    if token in track.pads:
        return _step_count_for_pad(track, token)
    pause_beat_count = _pause_beat_count_from_token(token)
    if pause_beat_count is not None:
        return _step_count_for_pause(pause_beat_count, track.timing)
    return _step_count_for_pad(track, track.active_pad)


def _transport_subunit_count_for_loop_token(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    token: int,
) -> int:
    if token in track.pads:
        return _transport_subunit_count_for_pad(track, token)
    pause_beat_count = _pause_beat_count_from_token(token)
    if pause_beat_count is not None:
        return _transport_subunit_count_for_length(pause_beat_count, track.timing)
    return _transport_subunit_count_for_pad(track, track.active_pad)


def _active_pad_runtime(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
) -> SequencerPadRuntime | ControllerSequencerPadRuntime | None:
    token = _current_pad_loop_token(track)
    if token is not None:
        return track.pads.get(token)
    return track.pads.get(track.active_pad)


def _active_pad_step_count(track: SequencerTrackRuntime | ControllerSequencerTrackRuntime) -> int:
    token = _current_pad_loop_token(track)
    if token is not None:
        return _step_count_for_loop_token(track, token)
    return _step_count_for_pad(track, track.active_pad)


def _active_pad_transport_subunit_count(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
) -> int:
    token = _current_pad_loop_token(track)
    if token is not None:
        return _transport_subunit_count_for_loop_token(track, token)
    return _transport_subunit_count_for_pad(track, track.active_pad)


def _transport_subunits_per_local_step(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
) -> int:
    return max(1, timing_span(track.timing))


def _local_transport_offset_for(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    transport_subunit: int,
) -> int:
    return (
        transport_subunit - track.phase_offset_subunit
    ) % _active_pad_transport_subunit_count(track)


def _local_step_for(track: SequencerTrackRuntime, transport_subunit: int) -> int:
    step_count = max(1, _active_pad_step_count(track))
    step_index_in_pad = _local_transport_offset_for(track, transport_subunit)
    return min(
        step_count - 1,
        step_index_in_pad // _transport_subunits_per_local_step(track),
    )


def _track_cycle_boundary_reached_for_next_subunit(
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    next_subunit: int,
) -> bool:
    return (
        (next_subunit - track.phase_offset_subunit)
        % _active_pad_transport_subunit_count(track)
    ) == 0


def _next_track_cycle_boundary_subunit(
    self,
    track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    current_subunit: int,
) -> int:
    cycle_length = max(1, _active_pad_transport_subunit_count(track))
    cycle_offset = _local_transport_offset_for(track, current_subunit)
    return current_subunit - cycle_offset + cycle_length


def _next_local_step_boundary_subunit(self, track: SequencerTrackRuntime, current_subunit: int) -> int:
    transport_offset = _local_transport_offset_for(track, current_subunit)
    step_span = max(1, _transport_subunits_per_local_step(track))
    return current_subunit - transport_offset + (((transport_offset // step_span) + 1) * step_span)


def _next_cycle_event_subunit_locked(self, config: SequencerRuntimeConfig, current_subunit: int) -> int | None:
    next_boundary: int | None = None
    for track in config.tracks.values():
        candidate = self._next_track_cycle_boundary_subunit(track, current_subunit)
        if candidate <= current_subunit:
            continue
        next_boundary = candidate if next_boundary is None else min(next_boundary, candidate)
    for track in config.controller_tracks.values():
        candidate = self._next_track_cycle_boundary_subunit(track, current_subunit)
        if candidate <= current_subunit:
            continue
        next_boundary = candidate if next_boundary is None else min(next_boundary, candidate)
    return next_boundary


def _next_event_subunit_locked(self, config: SequencerRuntimeConfig, current_subunit: int) -> int:
    candidates = [((current_subunit // _TRANSPORT_SUBUNITS_PER_STEP) + 1) * _TRANSPORT_SUBUNITS_PER_STEP]
    for track in config.tracks.values():
        if track.enabled:
            duration = _active_pad_transport_subunit_count(track)
            local_offset = (current_subunit - track.phase_offset_subunit) % duration
            origin = current_subunit - local_offset
            candidates.append(origin + max(1, duration))
            pad_runtime = _active_pad_runtime(track)
            if pad_runtime is not None and pad_runtime.steps:
                step_span = _transport_subunits_per_local_step(track)
                candidates.append(origin + ((local_offset // step_span) + 1) * step_span)
                roll = self._ratchet_rolls.get(track.track_id)
                if roll is not None:
                    candidates.extend(at for at in (roll.next_attack, roll.end) if at is not None and at > current_subunit)
                if track.has_timing_offsets or track.track_id in self._timed_notes or roll is not None:
                    candidates.extend(at for at, _, _, _ in self._timed_attacks(track, current_subunit, config) if at > current_subunit)
                    sounding = self._timed_notes.get(track.track_id)
                    if sounding is not None and sounding.release_subunit is not None and sounding.release_subunit > current_subunit:
                        candidates.append(sounding.release_subunit)
    for track in config.controller_tracks.values():
        if not track.enabled:
            continue
        candidates.append(self._next_track_cycle_boundary_subunit(track, current_subunit))
        next_controller_change = self._next_controller_change_subunit_locked(track, current_subunit)
        if next_controller_change is not None:
            candidates.append(next_controller_change)
    candidates.extend(state["boundary"] for state in self._auditions.values() if state.get("action") and state["boundary"] > current_subunit)
    candidates.append(config.playback_end_subunit)
    if self.sources.active and self.sources.next_boundary() is not None:
        candidates.append(self.sources.next_boundary())
    return min(candidate for candidate in candidates if candidate > current_subunit)
