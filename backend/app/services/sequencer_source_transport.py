from __future__ import annotations

from backend.app.services.sequencer_runtime_constants import TRANSPORT_SUBUNITS_PER_BEAT

from typing import TYPE_CHECKING

from backend.app.models.session import SessionDeviceTransportRequest
from backend.app.services.sequencer_runtime_constants import TRANSPORT_SUBUNITS_PER_STEP
from backend.app.services.sequencer_runtime_models import SequencerTrackRuntime

if TYPE_CHECKING:
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime


class SequencerSourceTransport:
    """Song coordinates over the existing clock; manual phases never follow song seeks.

    Opted into by explicit device/arranger commands. Legacy transport and offline
    exports retain their existing bounded clock until such a command is received.
    All methods run under the sequencer lock, at an audio render boundary.
    """

    def __init__(self, runtime: SessionSequencerRuntime):
        self.runtime = runtime
        self.active = False
        self.arranger_active = False
        self.arrangement_running = False
        self.origin = 0
        self.cursor = 0
        self.bounds = (0, TRANSPORT_SUBUNITS_PER_BEAT, False)
        self.playing: set[str] = set()
        self.pending_starts: set[str] = set()
        self.manual_pads: dict[str, int] = {}
        self.manual_origins: dict[str, int] = {}

    def tracks(self):
        config = self.runtime._ensure_config()
        return {**config.tracks, **config.controller_tracks}

    def is_arrangement(self, track):
        authored = self.runtime._auditions.get(track.track_id, {}).get("authored", {})
        return authored.get("pad_loop_enabled", track.pad_loop_enabled)

    def position(self, at: int | None = None) -> int:
        at = self.runtime._absolute_subunit if at is None else at
        return max(0, at - self.origin) if self.arrangement_running else self.cursor

    def status(self, at: int | None = None):
        if not self.active:
            return {}
        return {"independent_sources": True, "arrangement_running": self.arrangement_running,
                "arrangement_transport_subunit": self.position(at)}

    def activate(self):
        if self.active:
            return
        runtime = self.runtime
        self.arranger_active = runtime._arranger_active()
        self.arrangement_running = self.arranger_active
        self.cursor = runtime._absolute_subunit
        if runtime._config:
            config = runtime._config
            self.bounds = runtime._authored_bounds or (
                config.playback_start_subunit, config.playback_end_subunit, config.playback_loop)
            for identity, track in self.tracks().items():
                if runtime._running and track.enabled and identity not in runtime._auditions:
                    self.playing.add(identity)
                    if not track.pad_loop_enabled:
                        self.manual_pads[identity] = track.active_pad
                        self.manual_origins[identity] = track.phase_offset_subunit
                if identity not in runtime._auditions:
                    track.configured_enabled = identity in self.playing
                    track.enabled = identity in self.playing
            self.unbound(config)
        runtime._audition_standalone = False
        runtime._authored_bounds = None
        self.active = True

    @staticmethod
    def unbound(config):
        config.playback_start_subunit = 0
        config.playback_end_subunit = 2**60
        config.playback_loop = False

    def prepare(self, config, *, device_command: bool = False):
        self.bounds = (config.playback_start_subunit, config.playback_end_subunit, config.playback_loop)
        self.unbound(config)
        identities = set(config.tracks) | set(config.controller_tracks)
        self.playing.intersection_update(identities)
        self.pending_starts.intersection_update(identities)
        self.manual_pads = {key: pad for key, pad in self.manual_pads.items() if key in identities}
        self.manual_origins = {key: at for key, at in self.manual_origins.items() if key in identities}
        previous = self.tracks() if self.runtime._config else {}
        for identity, track in {**config.tracks, **config.controller_tracks}.items():
            track.configured_enabled = identity in self.playing
            old = previous.get(identity)
            if old and self.is_arrangement(old) != track.pad_loop_enabled and identity in self.playing:
                if track.pad_loop_enabled:
                    if not self.arrangement_running and not device_command:
                        self.begin(self.bounds[0] if self.bounds[2] else self.cursor)
                else:
                    self.manual_origins[identity] = self.runtime._absolute_subunit
                    self.manual_pads[identity] = track.configured_active_pad
            if not track.pad_loop_enabled and identity in self.manual_pads:
                pad = self.manual_pads[identity]
                if pad in track.pads:
                    track.configured_active_pad = pad

    def track_origin(self, track):
        return self.origin if track.pad_loop_enabled else self.manual_origins.get(track.track_id, 0)

    def locate(self, track, at: int):
        origin = self.track_origin(track)
        self.runtime._position_prepared_track(track, max(0, at - origin))
        track.phase_offset_subunit += origin

    def begin(self, position: int):
        start, end, _ = self.bounds
        if position < start or position >= end:
            position = start
        self.origin = self.runtime._absolute_subunit - position
        self.cursor = position
        self.arrangement_running = True

    def next_boundary(self):
        return self.origin + self.bounds[1] if self.arrangement_running else None

    def clear_device_audition(self, track):
        state = self.runtime._auditions.pop(track.track_id, None)
        if state:
            for key, value in state["authored"].items():
                setattr(track, key, value)
            self.runtime._audition_status_tracks.add(track.track_id)

    def release(self, track):
        if isinstance(track, SequencerTrackRuntime):
            self.runtime._release_track_notes_locked(track.track_id, track.midi_channel)
            self.runtime._last_timed_attack.pop(track.track_id, None)
            track.queued_enabled = None
        else:
            track.last_value = None
        track.queued_pad = None

    def set_playing(self, track, playing: bool, pad: int | None = None):
        self.clear_device_audition(track)
        self.release(track)
        if playing:
            self.playing.add(track.track_id)
            self.pending_starts.add(track.track_id)
        else:
            self.playing.discard(track.track_id)
            self.pending_starts.discard(track.track_id)
        track.configured_enabled = playing
        if playing and not track.pad_loop_enabled:
            self.manual_origins[track.track_id] = self.runtime._absolute_subunit
            self.manual_pads[track.track_id] = track.active_pad if pad is None else pad
            track.configured_active_pad = self.manual_pads[track.track_id]
        self.locate(track, self.runtime._absolute_subunit)

    def router_song(self, reset: bool = True):
        callback = getattr(self.runtime._midi_service, "source_song_transport", None)
        if callback:
            callback(position=self.position() / TRANSPORT_SUBUNITS_PER_BEAT, running=self.arrangement_running,
                     arranger=self.arranger_active, reset=reset, sample=self.runtime._render_event_sample)

    def has_arrangement_devices(self):
        return any(self.is_arrangement(track) and identity in self.playing for identity, track in self.tracks().items()) or bool(
            getattr(self.runtime._midi_service, "source_arrangement_playing", False))

    def command(self, request: SessionDeviceTransportRequest):
        runtime = self.runtime
        tracks = self.tracks()
        if any(identity not in tracks for identity in request.track_ids):
            raise ValueError("Device track is not configured.")
        targets = [tracks[identity] for identity in request.track_ids]
        if request.pad_index is not None and any(request.pad_index not in track.pads for track in targets):
            raise ValueError("Device pad is not configured.")
        self.activate()
        play = request.action == "play"
        if request.arranger:
            runtime.clear_auditions()
            clear = getattr(runtime._midi_service, "clear_auditions", None)
            if clear:
                clear()
            targets = [track for track in tracks.values() if track.pad_loop_enabled]
            self.arranger_active = play
            if play:
                self.begin((request.position_step or 0) * TRANSPORT_SUBUNITS_PER_STEP)
            else:
                self.cursor = self.position()
                self.arrangement_running = False
        elif play and (any(self.is_arrangement(track) for track in targets) or request.arpeggiator_id and
                       getattr(runtime._midi_service, "source_uses_arrangement")(request.arpeggiator_id)):
            if not self.arrangement_running:
                self.begin(self.bounds[0] if self.bounds[2] else (request.position_step or 0) * TRANSPORT_SUBUNITS_PER_STEP)
        for track in targets:
            self.set_playing(track, play, request.pad_index)
        router_command = getattr(runtime._midi_service, "source_device_transport", None)
        if router_command and (request.arpeggiator_id or request.arranger):
            router_command(request, position=self.position() / TRANSPORT_SUBUNITS_PER_BEAT)
        if not self.has_arrangement_devices():
            self.cursor = self.position()
            self.arrangement_running = self.arranger_active = False
        self.advance(runtime._absolute_subunit)
        self.router_song(reset=request.arranger and play)
        if play:
            runtime.start()
        self.stop_if_idle()
        runtime._reset_render_event_cursor_locked(runtime._ensure_config())
        runtime._audition_status_tracks.update(tracks)
        return runtime._status_locked()

    def seek(self, position: int):
        start, end, _ = self.bounds
        position = max(start, min(end, position))
        self.cursor = position
        self.origin = self.runtime._absolute_subunit - position
        if self.arrangement_running:
            self.reposition()
            self.advance(self.runtime._absolute_subunit)
        self.router_song()
        self.runtime._reset_render_event_cursor_locked(self.runtime._ensure_config())

    def reposition(self):
        runtime = self.runtime
        for identity, track in self.tracks().items():
            if not self.is_arrangement(track):
                continue
            state = runtime._auditions.get(identity)
            if state:
                self.release(track)
                runtime._reset_audition_origins(state, runtime._absolute_subunit)
                if state.get("action"):
                    state["boundary"] = runtime._absolute_subunit
                    runtime._apply_audition_command(track, runtime._absolute_subunit)
                elif state.get("sequence"):
                    runtime._position_prepared_track(track, 0)
                    track.phase_offset_subunit += runtime._absolute_subunit
                continue
            if identity not in self.playing:
                continue
            self.release(track)
            self.locate(track, runtime._absolute_subunit)
            self.pending_starts.add(identity)
        runtime._audition_status_tracks.update(self.tracks())

    def advance(self, at: int):
        boundary = self.next_boundary()
        if boundary is None or at < boundary:
            return
        start, end, loop = self.bounds
        if loop:
            self.origin = at - start
            self.cursor = start
            self.reposition()
        else:
            self.cursor = end
            self.arrangement_running = self.arranger_active = False
            for track in self.tracks().values():
                if self.is_arrangement(track):
                    self.set_playing(track, False)
        self.router_song()
        self.stop_if_idle()

    def stop_if_idle(self):
        runtime = self.runtime
        if (self.arrangement_running or any(t.enabled for t in self.tracks().values()) or runtime._auditions
                or getattr(runtime._midi_service, "source_playing", False)
                or getattr(runtime._midi_service, "audition_status", lambda: {})()):
            return
        if runtime._running:
            runtime._running = False
            runtime._stop_event.set()
            runtime._emit_render_transport_event_locked("stopped", {"transport_subunit": runtime._absolute_subunit,
                                                                    **self.status()})

    def stop(self):
        self.cursor = self.position()
        self.arrangement_running = self.arranger_active = False
        self.playing.clear()
        self.pending_starts.clear()
