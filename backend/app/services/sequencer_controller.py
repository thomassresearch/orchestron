"""Discrete controller events and lifecycle state, shared by live and offline playback."""
from __future__ import annotations

from bisect import bisect_left

from backend.app.services.arpeggiator_runtime import MidiSourceContext


def send_value(runtime, track, value, *, channels=None, delay=None):
    runtime._send_messages_locked(
        [runtime._control_change_message(channel, track.controller_number, value)
         for channel in (track.target_channels if channels is None else channels)],
        delivery_delay_seconds=delay, source_context=MidiSourceContext(source_id=track.track_id),
    )


def stop_step_controller(runtime, track, *, delay=None):
    if track.controller_mode != "step" or not track.step_active or runtime._audition_simulating:
        return
    send_value(runtime, track, track.reset_value, delay=delay)
    track.last_value = track.reset_value
    track.step_active = False
    track.step_last_subunit = None


def stop_step_controllers(runtime, *, delay=None):
    if runtime._config:
        for track in runtime._config.controller_tracks.values():
            stop_step_controller(runtime, track, delay=delay)


def restart_step_controller(runtime, track):
    if track.controller_mode != "step" or runtime._audition_simulating:
        return
    track.step_last_subunit = None
    if runtime._running and track.enabled:
        send_value(runtime, track, track.reset_value)
        track.last_value = track.reset_value
        track.step_active = True
    else:
        stop_step_controller(runtime, track)


def reconcile_step_controllers(runtime, previous, config):
    """Carry occurrence guards across edits; clean up only departing CC/channel pairs."""
    old_tracks = previous.controller_tracks if previous else {}
    for identity, old in old_tracks.items():
        new = config.controller_tracks.get(identity)
        continuing = new is not None and new.controller_mode == "step" and new.enabled
        if old.controller_mode != "step" or not old.step_active:
            continue
        if not continuing:
            stop_step_controller(runtime, old)
            if new is not None:
                # Cleanup changed the receiver even when the curve equals the
                # last step value. Force the curve to establish its value again.
                new.last_value = None
            continue
        new.step_active = True
        new.step_last_subunit = old.step_last_subunit
        new.last_value = old.last_value
        old_channels = set(old.target_channels)
        new_channels = set(new.target_channels)
        if old.controller_number != new.controller_number:
            departing, arriving = old_channels, new_channels
        else:
            departing, arriving = old_channels - new_channels, new_channels - old_channels
        if departing:
            send_value(runtime, old, old.reset_value, channels=sorted(departing))
        if arriving:
            send_value(runtime, new, new.reset_value, channels=sorted(arriving))
    # Entering step mode starts at the current position, without replaying an event
    # already passed in this render block. Initialization is still immediate.
    if runtime._running:
        for track in config.controller_tracks.values():
            if track.controller_mode == "step" and track.enabled and not track.step_active:
                restart_step_controller(runtime, track)
                track.step_last_subunit = runtime._absolute_subunit


def perform_step_controllers(runtime, config, at, *, track_ids=None, delay=None):
    tracks = [track for track in config.controller_tracks.values() if track.controller_mode == "step"
              and (track_ids is None or track.track_id in track_ids)]
    # Initialize every target before any musical events at this timestamp.
    for track in tracks:
        if not track.enabled:
            stop_step_controller(runtime, track, delay=delay)
            continue
        if not track.step_active:
            send_value(runtime, track, track.reset_value, delay=delay)
            track.last_value = track.reset_value
            track.step_active = True
    for track in tracks:
        if not track.enabled:
            continue
        if track.step_last_subunit == at:
            continue
        # Mark even empty cells/positions: a live edit cannot backfill elapsed time.
        track.step_last_subunit = at
        if runtime._controller_pause_token_active(track):
            continue
        pad = runtime._active_pad_runtime(track)
        if pad is None:
            continue
        offset = runtime._local_transport_offset_for(track, at)
        index = bisect_left(pad.event_offsets, offset)
        if index < len(pad.events) and pad.events[index].offset_subunit == offset:
            value = pad.events[index].value
            send_value(runtime, track, value, delay=delay)
            track.last_value = value
