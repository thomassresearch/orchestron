"""Clip occurrence mapping around the existing musical playback kernels."""
from backend.app.services.sequencer_runtime_models import SequencerTrackRuntime


def position(track, at):
    resolved = track.clip_schedule.locate(at)
    track.clip_silent = resolved.pad is None
    track.clip_boundary = resolved.boundary
    track.clip_occurrence = resolved.occurrence
    if isinstance(track, SequencerTrackRuntime):
        track.clip_transpose = resolved.transpose
        if track.clip_latched_occurrence != resolved.occurrence or track.clip_source_start != resolved.source_start:
            track.clip_latched_pad = None
            track.clip_latched_occurrence = None
        track.clip_source_start = resolved.source_start
    track.phase_offset_subunit = resolved.source_start
    if resolved.pad is not None:
        track.active_pad = resolved.pad
    track.pad_loop_position = None
    track.sequence_ended = False


def advance(runtime, track, at, *, release=True, delay=None):
    audition = runtime._auditions.get(track.track_id, {})
    origin = audition["origin"] if audition.get("sequence") else (runtime.sources.track_origin(track) if runtime.sources.active else 0)
    previous = (track.clip_occurrence, track.clip_silent, track.phase_offset_subunit)
    position(track, max(0, at - origin))
    track.phase_offset_subunit += origin
    if track.clip_boundary is not None:
        track.clip_boundary += origin
    anticipated = isinstance(track, SequencerTrackRuntime) and track.clip_future and track.clip_future[:2] == (at, track.clip_occurrence)
    if anticipated:
        track.clip_latched_occurrence = track.clip_occurrence
        track.clip_latched_pair, track.clip_latched_pad = track.clip_future[2:]
        track.clip_future = None
    changed = previous != (track.clip_occurrence, track.clip_silent, track.phase_offset_subunit)
    if changed and release:
        if isinstance(track, SequencerTrackRuntime):
            if not anticipated:
                runtime._release_track_notes_locked(track.track_id, track.midi_channel, delivery_delay_seconds=delay)
            elif track.track_id in runtime._strum_states:
                from backend.app.services.sequencer_strum import release_pitches
                state = runtime._strum_states[track.track_id]
                release_pitches(runtime, track, state, [n for n,v in state.voices.items() if v.nominal_start < at], delay)
                state.pending = [a for a in state.pending if a.voice.nominal_start >= at]
        else:
            # Keep CCs held through ordinary rests/loops; new curves sample at the new phase.
            track.last_value = None
    return changed
