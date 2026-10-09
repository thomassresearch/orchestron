"""Prepared chord attacks and occurrence-owned releases on the musical clock."""
from dataclasses import dataclass, field
from fractions import Fraction
from functools import lru_cache

from backend.app.services.sequencer_runtime_models import SequencerStepRuntime


@lru_cache(maxsize=4096)
def prepared_strum_attacks(step: SequencerStepRuntime, span: int) -> tuple[tuple[int, int], ...]:
    if step.strum_direction == "off" or not step.strum_spread_percent or len(step.notes) < 2:
        return ()
    notes = sorted(set(step.notes), reverse=step.strum_direction == "down")
    return tuple((round(Fraction(span * step.strum_spread_percent * index, 100 * (len(notes) - 1))), note)
                 for index, note in enumerate(notes))


@dataclass(slots=True)
class StrumVoice:
    nominal_start: int
    shift: int
    nominal_end: int | None
    strummed: bool

    @property
    def end(self) -> int | None:
        return None if self.nominal_end is None else self.nominal_end + self.shift


@dataclass(slots=True)
class StrumAttack:
    at: int
    note: int
    velocity: int
    voice: StrumVoice


@dataclass(slots=True)
class StrumState:
    pad_index: int
    pending: list[StrumAttack] = field(default_factory=list)
    voices: dict[int, StrumVoice] = field(default_factory=dict)

    def future_events(self, now: int) -> list[int]:
        return [attack.at for attack in self.pending if attack.at > now] + [
            voice.end for voice in self.voices.values() if voice.end is not None and voice.end > now
        ]

    def remap(self, distance: int) -> None:
        for attack in self.pending:
            attack.at -= distance
        for voice in [*self.voices.values(), *(attack.voice for attack in self.pending)]:
            voice.nominal_start -= distance
            if voice.nominal_end is not None:
                voice.nominal_end -= distance


def release_pitches(runtime, track, state: StrumState, pitches, delay) -> None:
    notes = sorted(set(pitches))
    if not notes:
        return
    runtime._send_messages_locked(
        [runtime._note_off_message(track.midi_channel, note) for note in notes],
        delivery_delay_seconds=delay, source_context=runtime._source_context_for_track(track),
    )
    for note in notes:
        state.voices.pop(note, None)
        runtime._active_notes.setdefault(track.track_id, set()).discard(note)


def perform_strum_events(runtime, track, pad, config, now: int, delay) -> None:
    """Use individual voices while this track has strums or unfinished strum tails.

    Ordinary notes still release at their next note/rest boundary. Strummed
    notes own their shifted release, even when later steps have already begun.
    Replacing a pitch replaces its release record: stale note-offs cannot fire.
    """
    runtime._next_render_event_subunit = None
    state = runtime._strum_states.get(track.track_id)
    if state is not None and state.pad_index != track.active_pad:
        runtime._release_track_notes_locked(track.track_id, track.midi_channel, delivery_delay_seconds=delay)
        state = None
    if state is None:
        state = StrumState(track.active_pad)
        runtime._strum_states[track.track_id] = state
        # Adopt an existing unstrummed chord when enabling the feature live.
        sounding = runtime._timed_notes.pop(track.track_id, None)
        span = runtime._transport_subunits_per_local_step(track)
        base = now - runtime._local_transport_offset_for(track, now)
        nominal = base + ((now - base) // span) * span
        for note in runtime._active_notes.get(track.track_id, ()):
            state.voices[note] = StrumVoice(
                sounding.nominal_start if sounding else nominal,
                sounding.shift if sounding else 0,
                sounding.nominal_end if sounding else runtime._nominal_note_end(track, base, nominal), False,
            )

    release_pitches(runtime, track, state,
                    [note for note, voice in state.voices.items() if voice.end is not None and voice.end <= now], delay)
    matches = [attack for attack in runtime._timed_attacks(track, now, config) if attack[0] == now
               and runtime._last_timed_attack.get(track.track_id) != (track.active_pad, attack[1], attack[2])]
    if matches:
        _, base, index, step = matches[-1]
        runtime._last_timed_attack[track.track_id] = (track.active_pad, base, index)
        nominal = base + index * runtime._transport_subunits_per_local_step(track)
        origin = track
        current_base = now - runtime._local_transport_offset_for(track, now)
        if base > current_base:
            origin = runtime._following_note_track(track, base) or track
            if config.playback_loop and base == config.playback_end_subunit:
                from copy import copy
                origin = copy(track)
                runtime._position_prepared_track(origin, config.playback_start_subunit)
        end = runtime._nominal_note_end(origin, base, nominal)
        release_pitches(runtime, track, state,
                        [note for note, voice in state.voices.items() if not voice.strummed], delay)
        attacks = pad.strum_attacks[index]
        for offset, note in attacks or tuple((0, note) for note in step.notes):
            if step.velocity > 0:
                state.pending.append(StrumAttack(now + offset, note, step.velocity,
                    StrumVoice(nominal, now - nominal + offset, end, bool(attacks))))

    # Collapse only identical pitches at the same timestamp. Different pitches
    # from a finishing strum and the next step are both audible at 100% spread.
    due = sorted((attack for attack in state.pending if attack.at <= now),
                 key=lambda attack: (attack.at, attack.voice.nominal_start))
    state.pending = [attack for attack in state.pending if attack.at > now]
    by_note = {attack.note: attack for attack in due}
    release_pitches(runtime, track, state, [note for note in by_note if note in state.voices], delay)
    for attack in by_note.values():
        runtime._send_messages_locked(
            [runtime._note_on_message(track.midi_channel, attack.note, attack.velocity)],
            delivery_delay_seconds=delay, source_context=runtime._source_context_for_track(track),
        )
        state.voices[attack.note] = attack.voice
        runtime._active_notes.setdefault(track.track_id, set()).add(attack.note)
    if not state.pending and not state.voices:
        runtime._strum_states.pop(track.track_id, None)


def refresh_strum_releases(runtime, config) -> None:
    for track_id, state in list(runtime._strum_states.items()):
        track = config.tracks.get(track_id)
        if track is None or not track.enabled:
            continue
        if state.pad_index != track.active_pad:
            runtime._release_track_notes_locked(track_id, track.midi_channel)
            continue
        base = runtime._absolute_subunit - runtime._local_transport_offset_for(track, runtime._absolute_subunit)
        # Keep live HOLD editing; freeze the notes, spacing and timing of a
        # started occurrence. Releases already crossing a boundary remain owned.
        for voice in [*state.voices.values(), *(attack.voice for attack in state.pending)]:
            if voice.nominal_end is None or voice.nominal_end >= base:
                voice.nominal_end = runtime._nominal_note_end(track, base, voice.nominal_start)
        release_pitches(runtime, track, state,
                        [note for note, voice in state.voices.items()
                         if voice.end is not None and voice.end <= runtime._absolute_subunit], None)
