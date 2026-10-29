"""Sparse score preparation and occurrence-owned playback on the shared clock."""
from bisect import bisect_right
from dataclasses import dataclass, field
from fractions import Fraction
from functools import lru_cache

from backend.app.services.sequencer_runtime_models import SequencerPadRuntime, SequencerTimingRuntime, SequencerTrackRuntime


@dataclass(frozen=True, slots=True)
class ScoreNote:
    id: str
    pitch: int
    velocity: int
    start: int
    end: int


@lru_cache(maxsize=32)
def prepare_pad(notes, length, numerator, denominator, grid, rate_n, rate_d, root, mode):
    duration = length * 20160 * 4 * rate_d // (denominator * rate_n)
    scale = Fraction(rate_d, rate_n)
    prepared = [ScoreNote(identity, pitch, velocity, round(start * scale),
                          min(duration, round((start + span) * scale)))
                for identity, pitch, velocity, start, span in notes if velocity > 0]
    prepared = sorted((n for n in prepared if n.start < n.end), key=lambda n: (n.start, n.id))
    # Reconciliation needs authored releases: a newly inserted attack in the
    # past must not truncate an already sounding voice in this occurrence.
    by_id = {n.id: n for n in prepared}
    # Same-pitch retriggers supersede the old voice permanently, including on seek.
    next_attack = {}
    truncated = []
    for note in reversed(prepared):
        end = min(note.end, next_attack.get(note.pitch, note.end))
        next_attack[note.pitch] = note.start
        if note.start < end:
            truncated.append(note if end == note.end else ScoreNote(note.id, note.pitch, note.velocity, note.start, end))
    prepared = tuple(reversed(truncated))
    by_pitch = []
    for pitch in sorted({n.pitch for n in prepared}):
        values = tuple(n for n in prepared if n.pitch == pitch)
        by_pitch.append((tuple(n.start for n in values), values))
    return SequencerPadRuntime(length, length * grid, duration, (), scale_root=root, mode=mode,
        score_notes=prepared, score_offsets=tuple(n.start for n in prepared),
        score_events=tuple(sorted({t for n in prepared for t in (n.start, n.end)})),
        score_by_pitch=tuple(by_pitch), score_by_id=by_id)


def compile_score_track(request, tempo):
    timing = SequencerTimingRuntime(**{**request.timing.model_dump(), "tempo_bpm": tempo, "beat_unit": "meter"})
    supplied = {p.pad_index: p for p in request.pads}
    pads = {}
    for index in range(8):
        p = supplied.get(index)
        pads[index] = prepare_pad(tuple((n.id, n.pitch, n.velocity, n.start_ticks, n.duration_ticks) for n in p.notes) if p else (),
            p.length_beats if p else request.length_beats, timing.meter_numerator, timing.meter_denominator,
            timing.steps_per_beat, timing.beat_rate_numerator, timing.beat_rate_denominator,
            p.scale_root if p else request.scale_root, p.mode if p else request.mode)
    pad = pads[request.active_pad]
    return SequencerTrackRuntime(track_id=request.track_id, midi_channel=request.midi_channel, timing=timing,
        scale_root=request.scale_root, mode=request.mode, length_beats=request.length_beats,
        step_count=pad.step_count, transport_subunit_count=pad.transport_subunit_count,
        velocity=request.velocity, gate_ratio=1, sync_to_track_id=None,
        enabled=request.enabled, configured_enabled=request.enabled, queued_enabled=request.queued_enabled,
        pads=pads, active_pad=request.active_pad, configured_active_pad=request.active_pad,
        queued_pad=request.queued_pad, configured_queued_pad=request.queued_pad,
        pad_loop_enabled=request.pad_loop_enabled, pad_loop_repeat=request.pad_loop_repeat,
        pad_loop_sequence=tuple(request.pad_loop_sequence), is_score=True, launch_quantization=request.launch_quantization)


@dataclass(slots=True)
class ScoreState:
    pad_index: int
    origin: int
    pad: SequencerPadRuntime
    last: int
    voices: dict[int, ScoreNote] = field(default_factory=dict)


def release(runtime, track, state, pitches, delay=None):
    pitches = list(pitches)
    if pitches:
        runtime._send_messages_locked([runtime._note_off_message(track.midi_channel, p) for p in pitches],
            delivery_delay_seconds=delay, source_context=runtime._source_context_for_track(track))
    for p in pitches:
        state.voices.pop(p, None)
        runtime._active_notes.setdefault(track.track_id, set()).discard(p)


def perform(runtime, track, pad, now, delay):
    if not track.enabled or pad is None:
        runtime._release_track_notes_locked(track.track_id, track.midi_channel, delivery_delay_seconds=delay)
        return
    local = runtime._local_transport_offset_for(track, now)
    origin = now - local
    state = runtime._score_states.get(track.track_id)
    if state is None or state.origin != origin or state.pad_index != track.active_pad or local < state.last:
        runtime._release_track_notes_locked(track.track_id, track.midi_channel, delivery_delay_seconds=delay)
        state = ScoreState(track.active_pad, origin, pad, local)
        runtime._score_states[track.track_id] = state
        attacks = []
        for starts, values in pad.score_by_pitch:
            index = bisect_right(starts, local) - 1
            if index >= 0 and values[index].end > local:
                attacks.append(values[index])
    else:
        attacks = pad.score_notes[bisect_right(pad.score_offsets, state.last):bisect_right(pad.score_offsets, local)]
    release(runtime, track, state, [p for p, n in state.voices.items() if n.end <= local], delay)
    for note in attacks:
        if note.end <= local:
            continue
        if note.pitch in state.voices:
            release(runtime, track, state, [note.pitch], delay)
        runtime._send_messages_locked([runtime._note_on_message(track.midi_channel, note.pitch, note.velocity)],
            delivery_delay_seconds=delay, source_context=runtime._source_context_for_track(track))
        state.voices[note.pitch] = note
        runtime._active_notes.setdefault(track.track_id, set()).add(note.pitch)
    state.last = local


def next_event(runtime, track, pad, now):
    local = runtime._local_transport_offset_for(track, now)
    index = bisect_right(pad.score_events, local)
    candidates = [now - local + pad.score_events[index]] if index < len(pad.score_events) else []
    state = runtime._score_states.get(track.track_id)
    if state:
        candidates.extend(now - local + n.end for n in state.voices.values() if n.end > local)
    if track.queued_pad is not None and not track.pad_loop_enabled and track.launch_quantization == "bar":
        bar = track.timing.local_beat_subunits * track.timing.meter_numerator * track.timing.beat_rate_denominator // track.timing.beat_rate_numerator
        candidates.append(now - local + (local // bar + 1) * bar)
    return candidates


def bar_launch(track, now):
    if not track.is_score or track.pad_loop_enabled or track.launch_quantization != "bar" or track.queued_pad is None:
        return False
    bar = track.timing.local_beat_subunits * track.timing.meter_numerator * track.timing.beat_rate_denominator // track.timing.beat_rate_numerator
    return now > track.phase_offset_subunit and (now - track.phase_offset_subunit) % bar == 0


def reconcile(runtime, config):
    for identity, state in list(runtime._score_states.items()):
        track = config.tracks.get(identity)
        if track is None or not track.is_score:
            continue
        pad = runtime._active_pad_runtime(track)
        local = runtime._local_transport_offset_for(track, runtime._absolute_subunit)
        if pad is None or state.origin != runtime._absolute_subunit - local or state.pad_index != track.active_pad:
            runtime._release_track_notes_locked(identity, track.midi_channel)
            continue
        if pad is state.pad:
            continue
        for pitch, old in list(state.voices.items()):
            note = pad.score_by_id.get(old.id)
            if note is None or note.pitch != pitch or note.start != old.start or note.end <= local:
                release(runtime, track, state, [pitch])
            else:
                state.voices[pitch] = note
        state.pad = pad
        state.last = local
