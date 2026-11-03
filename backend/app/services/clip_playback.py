"""Clip occurrence mapping around the existing musical playback kernels."""
from backend.app.services.sequencer_runtime_models import SequencerTrackRuntime


def position(track, at):
    resolved = track.clip_schedule.locate(at)
    track.clip_silent = resolved.pad is None
    track.clip_boundary = resolved.boundary
    track.clip_occurrence = resolved.occurrence
    track.phase_offset_subunit = resolved.source_start
    if resolved.pad is not None:
        track.active_pad = resolved.pad
    track.pad_loop_position = None
    track.sequence_ended = False


def advance(runtime, track, at, *, release=True, delay=None):
    origin = runtime.sources.track_origin(track) if runtime.sources.active else 0
    previous = (track.clip_occurrence, track.clip_silent, track.phase_offset_subunit)
    position(track, max(0, at - origin))
    track.phase_offset_subunit += origin
    track.clip_boundary += origin
    changed = previous != (track.clip_occurrence, track.clip_silent, track.phase_offset_subunit)
    if changed and release:
        if isinstance(track, SequencerTrackRuntime):
            runtime._release_track_notes_locked(track.track_id, track.midi_channel, delivery_delay_seconds=delay)
        else:
            # Keep CCs held through ordinary rests/loops; new curves sample at the new phase.
            track.last_value = None
    return changed
