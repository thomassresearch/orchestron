from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from backend.app.models.session import (
    SessionSequencerConfigRequest,
    SessionSequencerStepConfig,
    SessionSequencerStatus,
    SessionSequencerTimingConfig,
    SessionSequencerTrackStatus,
)
from backend.app.services.midi_service import MidiService

logger = logging.getLogger(__name__)

PublishEventFn = Callable[[str, dict[str, str | int | float | bool | None]], None]

_DEFAULT_PADS = 8
_MAX_STEPS = 128
_SCHEDULER_SLEEP_S = 0.001
_SCHEDULER_SPIN_THRESHOLD_S = 0.0008
_PAUSE_BEAT_COUNTS = frozenset({1, 2, 4, 8, 16})
_DEFAULT_TRACK_LENGTH_BEATS = 4
_TRANSPORT_STEPS_PER_BEAT = 8


def _clamp_midi_note(value: int) -> int:
    return max(0, min(127, int(value)))


def _clamp_midi_velocity(value: int) -> int:
    return max(0, min(127, int(value)))


def _normalize_step_notes(value: int | list[int] | None) -> tuple[int, ...]:
    if value is None:
        return ()
    if isinstance(value, int):
        return (_clamp_midi_note(value),)
    if isinstance(value, list):
        notes: list[int] = []
        for entry in value:
            if not isinstance(entry, int):
                raise ValueError("Step notes list must contain integers only.")
            note = _clamp_midi_note(entry)
            if note not in notes:
                notes.append(note)
        return tuple(notes)
    raise ValueError("Step value must be null, an integer note, or a list of integer notes.")


@dataclass(slots=True)
class SequencerStepRuntime:
    notes: tuple[int, ...]
    hold: bool = False
    velocity: int = 100


@dataclass(slots=True)
class SequencerPadRuntime:
    length_beats: int
    step_count: int
    transport_step_count: int
    steps: tuple[SequencerStepRuntime, ...]


@dataclass(slots=True)
class SequencerTrackRuntime:
    track_id: str
    midi_channel: int
    timing: SequencerTimingRuntime
    length_beats: int
    step_count: int
    transport_step_count: int
    velocity: int
    gate_ratio: float
    sync_to_track_id: str | None
    enabled: bool
    configured_enabled: bool
    queued_enabled: bool | None
    pads: dict[int, SequencerPadRuntime] = field(default_factory=dict)
    active_pad: int = 0
    configured_active_pad: int = 0
    queued_pad: int | None = None
    pad_loop_enabled: bool = False
    pad_loop_repeat: bool = True
    pad_loop_sequence: tuple[int, ...] = ()
    pad_loop_position: int | None = None
    phase_offset: int = 0
    sequence_ended: bool = False


@dataclass(slots=True)
class SequencerTimingRuntime:
    tempo_bpm: int
    meter_numerator: int
    meter_denominator: int
    steps_per_beat: int

    @property
    def steps_per_bar(self) -> int:
        return self.meter_numerator * self.steps_per_beat

    @property
    def beat_duration_seconds(self) -> float:
        return 60.0 / float(self.tempo_bpm)

    @property
    def step_duration_seconds(self) -> float:
        return self.beat_duration_seconds / float(self.steps_per_beat)


@dataclass(slots=True)
class SequencerRuntimeConfig:
    timing: SequencerTimingRuntime
    step_count: int
    playback_start_step: int = 0
    playback_end_step: int = 16
    playback_loop: bool = False
    tracks: dict[str, SequencerTrackRuntime] = field(default_factory=dict)


class SessionSequencerRuntime:
    def __init__(
        self,
        session_id: str,
        midi_service: MidiService,
        midi_input_selector: str,
        publish_event: PublishEventFn,
    ) -> None:
        self._session_id = session_id
        self._midi_service = midi_service
        self._midi_input_selector = midi_input_selector
        self._publish_event = publish_event

        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

        self._config: SequencerRuntimeConfig | None = None
        self._running = False
        self._absolute_step = 0
        self._active_notes: dict[str, set[int]] = {}

    def set_midi_input(self, midi_input_selector: str) -> None:
        with self._lock:
            self._midi_input_selector = midi_input_selector

    def configure(self, request: SessionSequencerConfigRequest) -> SessionSequencerStatus:
        with self._lock:
            previous_config = self._config
            next_config = self._build_runtime_config(request)
            self._release_reconfigured_track_notes_locked(previous_config, next_config)
            self._config = next_config
            self._absolute_step = self._normalize_stopped_absolute_step_locked(self._absolute_step, next_config)
            self._apply_absolute_step_locked(next_config, self._absolute_step)
            next_active_notes: dict[str, set[int]] = {}
            for track_id in next_config.tracks:
                next_active_notes[track_id] = set(self._active_notes.get(track_id, set()))
            self._active_notes = next_active_notes
            return self._status_locked()

    def queue_pad(self, track_id: str, pad_index: int) -> SessionSequencerStatus:
        with self._lock:
            config = self._ensure_config()
            track = config.tracks.get(track_id)
            if not track:
                raise ValueError(f"Track '{track_id}' is not configured.")
            if pad_index not in track.pads:
                raise ValueError(f"Pad '{pad_index}' is not configured for track '{track_id}'.")

            if self._running:
                track.queued_pad = pad_index
            else:
                track.active_pad = pad_index
                track.configured_active_pad = pad_index
                track.queued_pad = None
                if not track.pad_loop_enabled or not track.pad_loop_sequence:
                    track.phase_offset = self._absolute_step - (
                        self._absolute_step % self._transport_step_count_for_pad(track, pad_index)
                    )
                    track.pad_loop_position = None
                    track.sequence_ended = False

            return self._status_locked()

    def rewind_cycle(self) -> SessionSequencerStatus:
        with self._lock:
            config = self._ensure_config()
            return self._seek_steps_locked(-max(1, config.step_count))

    def forward_cycle(self) -> SessionSequencerStatus:
        with self._lock:
            config = self._ensure_config()
            return self._seek_steps_locked(max(1, config.step_count))

    def start(self, position_step: int | None = None) -> SessionSequencerStatus:
        with self._lock:
            config = self._ensure_config()
            if self._running:
                return self._status_locked()

            requested_position = self._absolute_step if position_step is None else position_step
            self._absolute_step = self._normalize_start_absolute_step_locked(requested_position, config)
            self._apply_absolute_step_locked(config, self._absolute_step)

            self._stop_event.clear()
            self._running = True
            self._thread = threading.Thread(
                target=self._run,
                daemon=True,
                name=f"sequencer-{self._session_id[:8]}",
            )
            self._thread.start()
            return self._status_locked()

    def stop(self) -> SessionSequencerStatus:
        thread: threading.Thread | None = None
        with self._lock:
            if not self._running:
                return self._status_locked()

            self._running = False
            self._stop_event.set()
            thread = self._thread

        if thread and thread.is_alive():
            thread.join(timeout=1.0)

        with self._lock:
            self._thread = None
            self._send_all_notes_off_locked()
            self._active_notes = {track_id: set() for track_id in self._active_notes}
            return self._status_locked()

    def shutdown(self) -> None:
        self.stop()

    def status(self) -> SessionSequencerStatus:
        with self._lock:
            return self._status_locked()

    def _run(self) -> None:
        next_step_time = time.perf_counter() + 0.01

        while not self._stop_event.is_set():
            now = time.perf_counter()

            with self._lock:
                if not self._running:
                    break
                config = self._config
                if config is None:
                    break
                current_step = self._absolute_step
                step_duration = config.timing.step_duration_seconds

            wait = next_step_time - now
            if wait > _SCHEDULER_SPIN_THRESHOLD_S:
                time.sleep(min(wait, _SCHEDULER_SLEEP_S))
                continue
            if wait > 0:
                continue

            self._perform_step(config, current_step)
            next_step_time += step_duration

            if next_step_time < now - (step_duration * 2.0):
                next_step_time = now + step_duration

        with self._lock:
            self._send_all_notes_off_locked()
            for notes in self._active_notes.values():
                notes.clear()

    @staticmethod
    def _pause_beat_count_from_token(token: int) -> int | None:
        if token >= 0:
            return None
        beat_count = abs(int(token))
        return beat_count if beat_count in _PAUSE_BEAT_COUNTS else None

    @staticmethod
    def _step_count_for_length(length_beats: int, timing: SequencerTimingRuntime) -> int:
        return min(_MAX_STEPS, max(1, length_beats) * max(1, timing.steps_per_beat))

    @staticmethod
    def _step_count_for_pause(pause_beat_count: int, timing: SequencerTimingRuntime) -> int:
        return max(1, pause_beat_count * max(1, timing.steps_per_beat))

    @staticmethod
    def _current_pad_loop_token(track: SequencerTrackRuntime) -> int | None:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            return None
        position = track.pad_loop_position
        if position is None or position < 0 or position >= len(track.pad_loop_sequence):
            return None
        return track.pad_loop_sequence[position]

    @staticmethod
    def _pad_loop_position_for_active_pad(track: SequencerTrackRuntime) -> int | None:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            return None
        for index, pad_index in enumerate(track.pad_loop_sequence):
            if pad_index == track.active_pad:
                return index
        return None

    def _reset_pad_loop_for_start_locked(self, track: SequencerTrackRuntime) -> None:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            track.pad_loop_position = None
            return

        first_token = track.pad_loop_sequence[0]
        if first_token in track.pads:
            track.active_pad = first_token
        track.pad_loop_position = 0

        if track.queued_pad == track.active_pad:
            track.queued_pad = None

    @staticmethod
    def _step_count_for_pad(track: SequencerTrackRuntime, pad_index: int) -> int:
        pad = track.pads.get(pad_index)
        if pad and 1 <= pad.step_count <= _MAX_STEPS:
            return pad.step_count
        return track.step_count if 1 <= track.step_count <= _MAX_STEPS else 16

    @staticmethod
    def _transport_step_count_for_pad(track: SequencerTrackRuntime, pad_index: int) -> int:
        pad = track.pads.get(pad_index)
        if pad and pad.transport_step_count > 0:
            return pad.transport_step_count
        return max(1, track.transport_step_count)

    @staticmethod
    def _length_beats_for_pad(track: SequencerTrackRuntime, pad_index: int) -> int:
        pad = track.pads.get(pad_index)
        if pad and 1 <= pad.length_beats <= 8:
            return pad.length_beats
        return track.length_beats if 1 <= track.length_beats <= 8 else _DEFAULT_TRACK_LENGTH_BEATS

    @staticmethod
    def _step_count_for_loop_token(track: SequencerTrackRuntime, token: int) -> int:
        if token in track.pads:
            return SessionSequencerRuntime._step_count_for_pad(track, token)
        pause_beat_count = SessionSequencerRuntime._pause_beat_count_from_token(token)
        if pause_beat_count is not None:
            return SessionSequencerRuntime._step_count_for_pause(pause_beat_count, track.timing)
        return SessionSequencerRuntime._step_count_for_pad(track, track.active_pad)

    @staticmethod
    def _transport_step_count_for_loop_token(track: SequencerTrackRuntime, token: int) -> int:
        if token in track.pads:
            return SessionSequencerRuntime._transport_step_count_for_pad(track, token)
        pause_beat_count = SessionSequencerRuntime._pause_beat_count_from_token(token)
        if pause_beat_count is not None:
            return max(1, pause_beat_count * _TRANSPORT_STEPS_PER_BEAT)
        return SessionSequencerRuntime._transport_step_count_for_pad(track, track.active_pad)

    @staticmethod
    def _length_beats_for_loop_token(track: SequencerTrackRuntime, token: int) -> int:
        if token in track.pads:
            return SessionSequencerRuntime._length_beats_for_pad(track, token)
        pause_beat_count = SessionSequencerRuntime._pause_beat_count_from_token(token)
        if pause_beat_count is not None:
            return pause_beat_count
        return SessionSequencerRuntime._length_beats_for_pad(track, track.active_pad)

    @staticmethod
    def _active_pad_runtime(track: SequencerTrackRuntime) -> SequencerPadRuntime | None:
        token = SessionSequencerRuntime._current_pad_loop_token(track)
        if token is not None:
            return track.pads.get(token)
        return track.pads.get(track.active_pad)

    @staticmethod
    def _active_pad_step_count(track: SequencerTrackRuntime) -> int:
        token = SessionSequencerRuntime._current_pad_loop_token(track)
        if token is not None:
            return SessionSequencerRuntime._step_count_for_loop_token(track, token)
        return SessionSequencerRuntime._step_count_for_pad(track, track.active_pad)

    @staticmethod
    def _active_pad_transport_step_count(track: SequencerTrackRuntime) -> int:
        token = SessionSequencerRuntime._current_pad_loop_token(track)
        if token is not None:
            return SessionSequencerRuntime._transport_step_count_for_loop_token(track, token)
        return SessionSequencerRuntime._transport_step_count_for_pad(track, track.active_pad)

    @staticmethod
    def _transport_steps_per_local_step(track: SequencerTrackRuntime) -> int:
        return max(1, _TRANSPORT_STEPS_PER_BEAT // max(1, track.timing.steps_per_beat))

    @staticmethod
    def _local_transport_offset_for(track: SequencerTrackRuntime, step_index: int) -> int:
        return (step_index - track.phase_offset) % SessionSequencerRuntime._active_pad_transport_step_count(track)

    @staticmethod
    def _local_step_for(track: SequencerTrackRuntime, step_index: int) -> int:
        step_count = max(1, SessionSequencerRuntime._active_pad_step_count(track))
        step_index_in_pad = SessionSequencerRuntime._local_transport_offset_for(track, step_index)
        return min(
            step_count - 1,
            step_index_in_pad // SessionSequencerRuntime._transport_steps_per_local_step(track),
        )

    @staticmethod
    def _local_step_boundary_reached(track: SequencerTrackRuntime, step_index: int) -> bool:
        return (
            SessionSequencerRuntime._local_transport_offset_for(track, step_index)
            % SessionSequencerRuntime._transport_steps_per_local_step(track)
        ) == 0

    @staticmethod
    def _local_boundary_reached_for_next_step(track: SequencerTrackRuntime, next_step: int) -> bool:
        return (
            (next_step - track.phase_offset) % SessionSequencerRuntime._active_pad_transport_step_count(track)
        ) == 0

    @staticmethod
    def _track_at_sync_boundary_locked(track: SequencerTrackRuntime, next_step: int) -> bool:
        if not track.enabled:
            return False
        if not SessionSequencerRuntime._local_boundary_reached_for_next_step(track, next_step):
            return False
        if track.pad_loop_enabled and track.pad_loop_sequence:
            if track.pad_loop_position != 0:
                return False
            first_token = track.pad_loop_sequence[0]
            if first_token in track.pads:
                return track.active_pad == first_token
            return SessionSequencerRuntime._pause_beat_count_from_token(first_token) is not None
        return True

    def _reset_track_for_sync_locked(
        self,
        track_id: str,
        track: SequencerTrackRuntime,
        next_step: int,
        *,
        release_notes: bool,
    ) -> None:
        track.phase_offset = next_step
        track.sequence_ended = False
        if track.pad_loop_enabled and track.pad_loop_sequence:
            self._reset_pad_loop_for_start_locked(track)
        else:
            track.pad_loop_position = None
        if release_notes:
            self._release_track_notes_locked(track_id, track.midi_channel)

    def _pad_loop_boundary_action_locked(
        self,
        track: SequencerTrackRuntime,
        *,
        manual_switch_applied: bool,
    ) -> tuple[int | None, bool]:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            track.pad_loop_position = None
            return (None, False)

        if manual_switch_applied:
            track.pad_loop_position = self._pad_loop_position_for_active_pad(track)
            return (None, False)

        sequence = track.pad_loop_sequence
        current_position = track.pad_loop_position
        if current_position is None:
            track.pad_loop_position = 0
            return (sequence[0], False)

        if current_position < 0 or current_position >= len(sequence):
            current_position = self._pad_loop_position_for_active_pad(track)
            if current_position is None:
                track.pad_loop_position = 0
                return (sequence[0], False)

        next_position = current_position + 1
        if next_position < len(sequence):
            track.pad_loop_position = next_position
            return (sequence[next_position], False)

        if track.pad_loop_repeat:
            track.pad_loop_position = 0
            return (sequence[0], False)

        track.pad_loop_position = None
        return (None, True)

    @staticmethod
    def _can_start_track_on_boundary_locked(
        config: SequencerRuntimeConfig,
        track_id: str,
        next_step: int,
    ) -> bool:
        for candidate in config.tracks.values():
            if candidate.track_id == track_id or not candidate.enabled:
                continue
            if not SessionSequencerRuntime._local_boundary_reached_for_next_step(candidate, next_step):
                return False
        return True

    def _advance_tracks_for_next_step_locked(
        self,
        config: SequencerRuntimeConfig,
        next_step: int,
        *,
        release_notes: bool,
    ) -> list[dict[str, str | int | float | bool | None]]:
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        sync_master_triggered_ids: set[str] = set()
        _, next_cycle = self._transport_position_locked(config, next_step)

        for track_id, track in config.tracks.items():
            local_boundary_reached = self._local_boundary_reached_for_next_step(track, next_step)
            manual_pad_switch_applied = False
            track_started_on_boundary = False

            if track.queued_enabled is not None:
                if track.queued_enabled:
                    if self._can_start_track_on_boundary_locked(config, track_id, next_step):
                        self._reset_pad_loop_for_start_locked(track)
                        track.phase_offset = next_step
                        track.enabled = True
                        track.sequence_ended = False
                        track.queued_enabled = None
                        track_started_on_boundary = True
                elif not track.enabled:
                    track.queued_enabled = None
                elif local_boundary_reached:
                    track.enabled = False
                    track.sequence_ended = False
                    track.queued_enabled = None
                    if release_notes:
                        self._release_track_notes_locked(track_id, track.midi_channel)

            if local_boundary_reached and track.queued_pad is not None and track.queued_pad != track.active_pad:
                track.active_pad = track.queued_pad
                track.queued_pad = None
                track.sequence_ended = False
                manual_pad_switch_applied = True
                switch_payloads.append(
                    {
                        "track_id": track.track_id,
                        "active_pad": track.active_pad,
                        "cycle": next_cycle,
                    }
                )

            if local_boundary_reached and track.enabled and not track_started_on_boundary:
                next_pad_from_loop, stop_track_on_loop_end = self._pad_loop_boundary_action_locked(
                    track,
                    manual_switch_applied=manual_pad_switch_applied,
                )
                if stop_track_on_loop_end:
                    track.enabled = False
                    track.sequence_ended = True
                    track.queued_enabled = None
                    track.queued_pad = None
                    if release_notes:
                        self._release_track_notes_locked(track_id, track.midi_channel)
                elif next_pad_from_loop is not None:
                    if next_pad_from_loop in track.pads and next_pad_from_loop != track.active_pad:
                        track.active_pad = next_pad_from_loop
                        track.queued_pad = None
                        track.sequence_ended = False
                        switch_payloads.append(
                            {
                                "track_id": track.track_id,
                                "active_pad": track.active_pad,
                                "cycle": next_cycle,
                            }
                        )
                    elif self._pause_beat_count_from_token(next_pad_from_loop) is not None and release_notes:
                        self._release_track_notes_locked(track_id, track.midi_channel)

        for track_id, track in config.tracks.items():
            if self._track_at_sync_boundary_locked(track, next_step):
                sync_master_triggered_ids.add(track_id)

        if sync_master_triggered_ids:
            for track_id, track in config.tracks.items():
                master_track_id = track.sync_to_track_id
                if (
                    master_track_id is None
                    or master_track_id not in sync_master_triggered_ids
                    or not track.enabled
                ):
                    continue
                previous_active_pad = track.active_pad
                self._reset_track_for_sync_locked(
                    track_id,
                    track,
                    next_step,
                    release_notes=release_notes,
                )
                if track.active_pad != previous_active_pad:
                    switch_payloads.append(
                        {
                            "track_id": track.track_id,
                            "active_pad": track.active_pad,
                            "cycle": next_cycle,
                        }
                    )

        return switch_payloads

    def _transport_position_locked(
        self,
        config: SequencerRuntimeConfig,
        absolute_step: int | None = None,
    ) -> tuple[int, int]:
        normalized_absolute = max(0, int(self._absolute_step if absolute_step is None else absolute_step))
        step_count = max(1, config.step_count)
        return (normalized_absolute % step_count, normalized_absolute // step_count)

    def _playback_seek_bounds_locked(self, config: SequencerRuntimeConfig, *, running: bool) -> tuple[int, int]:
        min_step = max(0, config.playback_start_step)
        max_step = max(min_step, config.playback_end_step - (1 if running else 0))
        return (min_step, max_step)

    def _normalize_stopped_absolute_step_locked(
        self,
        absolute_step: int,
        config: SequencerRuntimeConfig,
    ) -> int:
        min_step, max_step = self._playback_seek_bounds_locked(config, running=False)
        normalized = max(min_step, min(max_step, int(round(absolute_step))))
        if config.playback_loop and not (config.playback_start_step <= normalized <= config.playback_end_step):
            return config.playback_start_step
        return normalized

    def _normalize_start_absolute_step_locked(
        self,
        absolute_step: int,
        config: SequencerRuntimeConfig,
    ) -> int:
        requested = int(round(absolute_step))
        if requested < config.playback_start_step or requested >= config.playback_end_step:
            return config.playback_start_step
        return requested

    def _normalize_seek_absolute_step_locked(
        self,
        absolute_step: int,
        config: SequencerRuntimeConfig,
        *,
        running: bool,
    ) -> int:
        min_step, max_step = self._playback_seek_bounds_locked(config, running=running)
        return max(min_step, min(max_step, int(round(absolute_step))))

    def _reset_track_runtime_for_absolute_step_locked(self, track: SequencerTrackRuntime) -> None:
        track.enabled = track.configured_enabled
        track.active_pad = track.configured_active_pad
        track.phase_offset = 0
        track.pad_loop_position = None
        track.sequence_ended = False
        self._reset_pad_loop_for_start_locked(track)

    def _apply_absolute_step_locked(self, config: SequencerRuntimeConfig, absolute_step: int) -> None:
        normalized_absolute = max(0, int(round(absolute_step)))
        simulation_target = min(normalized_absolute, config.playback_end_step)
        pending_by_track: dict[str, tuple[int | None, bool | None]] = {}

        for track in config.tracks.values():
            pending_by_track[track.track_id] = (track.queued_pad, track.queued_enabled)
            track.queued_pad = None
            track.queued_enabled = None
            self._reset_track_runtime_for_absolute_step_locked(track)

        for step in range(simulation_target):
            self._advance_tracks_for_next_step_locked(
                config,
                step + 1,
                release_notes=False,
            )

        for track in config.tracks.values():
            pending_pad, pending_enabled = pending_by_track[track.track_id]
            track.queued_pad = (
                pending_pad
                if pending_pad is not None and pending_pad in track.pads and pending_pad != track.active_pad
                else None
            )
            if pending_enabled is True and track.enabled:
                track.queued_enabled = None
            elif pending_enabled is False and not track.enabled:
                track.queued_enabled = None
            else:
                track.queued_enabled = pending_enabled

        self._absolute_step = normalized_absolute

    def _seek_steps_locked(self, delta_steps: int) -> SessionSequencerStatus:
        config = self._ensure_config()
        target_step = self._absolute_step + int(delta_steps)
        normalized_target = self._normalize_seek_absolute_step_locked(
            target_step,
            config,
            running=self._running,
        )
        if normalized_target == self._absolute_step:
            return self._status_locked()

        if self._running:
            for track_id, track in config.tracks.items():
                self._release_track_notes_locked(track_id, track.midi_channel)
            for notes in self._active_notes.values():
                notes.clear()

        self._apply_absolute_step_locked(config, normalized_target)
        return self._status_locked()

    def _perform_step(
        self,
        config: SequencerRuntimeConfig,
        step_index: int,
    ) -> None:
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        running_track_count = 0
        next_absolute_step = step_index + 1

        with self._lock:
            for track_id, track in config.tracks.items():
                pad_runtime = self._active_pad_runtime(track)
                active_notes = self._active_notes.setdefault(track_id, set())
                if not track.enabled or pad_runtime is None or not pad_runtime.steps:
                    self._release_track_notes_locked(track_id, track.midi_channel)
                    continue
                if not self._local_step_boundary_reached(track, step_index):
                    continue
                running_track_count += 1
                local_step = self._local_step_for(track, step_index)
                step_state = pad_runtime.steps[local_step]
                notes = step_state.notes
                if notes:
                    self._release_track_notes_locked(track_id, track.midi_channel)
                    self._send_messages_locked(
                        [self._note_on_message(track.midi_channel, note, step_state.velocity) for note in notes]
                    )
                    for note in notes:
                        active_notes.add(note)
                elif not step_state.hold:
                    self._release_track_notes_locked(track_id, track.midi_channel)

            if config.playback_loop and next_absolute_step >= config.playback_end_step:
                previous_active_pads = {
                    track_id: track.active_pad
                    for track_id, track in config.tracks.items()
                    if track.enabled
                }
                self._apply_absolute_step_locked(config, config.playback_start_step)
                for track_id, previous_active_pad in previous_active_pads.items():
                    track = config.tracks.get(track_id)
                    if track and track.enabled and track.active_pad != previous_active_pad:
                        _, cycle = self._transport_position_locked(config, self._absolute_step)
                        switch_payloads.append(
                            {
                                "track_id": track.track_id,
                                "active_pad": track.active_pad,
                                "cycle": cycle,
                            }
                        )
            else:
                switch_payloads = self._advance_tracks_for_next_step_locked(
                    config,
                    next_absolute_step,
                    release_notes=True,
                )
                if next_absolute_step >= config.playback_end_step:
                    self._absolute_step = config.playback_end_step
                    self._running = False
                    self._stop_event.set()
                else:
                    self._absolute_step = next_absolute_step

            next_step, cycle = self._transport_position_locked(config, self._absolute_step)
            step_payload: dict[str, str | int | float | bool | None] = {
                "step": step_index,
                "next_step": next_step,
                "cycle": cycle,
                "track_count": running_track_count,
            }

        self._publish_event("sequencer_step", step_payload)
        for payload in switch_payloads:
            self._publish_event("sequencer_pad_switched", payload)

    @staticmethod
    def _note_on_message(midi_channel: int, note: int, velocity: int) -> list[int]:
        channel_byte = (midi_channel - 1) & 0x0F
        return [0x90 + channel_byte, _clamp_midi_note(note), _clamp_midi_velocity(velocity)]

    @staticmethod
    def _note_off_message(midi_channel: int, note: int) -> list[int]:
        channel_byte = (midi_channel - 1) & 0x0F
        return [0x80 + channel_byte, _clamp_midi_note(note), 0]

    def _release_track_notes_locked(self, track_id: str, midi_channel: int) -> None:
        active_notes = self._active_notes.get(track_id)
        if not active_notes:
            return

        self._send_messages_locked(
            [self._note_off_message(midi_channel, note) for note in sorted(active_notes)]
        )
        active_notes.clear()

    def _release_reconfigured_track_notes_locked(
        self,
        previous_config: SequencerRuntimeConfig | None,
        next_config: SequencerRuntimeConfig,
    ) -> None:
        if previous_config is None:
            return

        for track_id, previous_track in previous_config.tracks.items():
            active_notes = self._active_notes.get(track_id)
            if not active_notes:
                continue
            next_track = next_config.tracks.get(track_id)
            if (
                next_track is None
                or next_track.midi_channel != previous_track.midi_channel
                or not next_track.configured_enabled
            ):
                self._release_track_notes_locked(track_id, previous_track.midi_channel)

    def _send_all_notes_off_locked(self) -> None:
        config = self._config
        if config is None:
            return
        for track in config.tracks.values():
            channel_byte = (track.midi_channel - 1) & 0x0F
            self._send_messages_locked([[0xB0 + channel_byte, 123, 0], [0xB0 + channel_byte, 120, 0]])

    def _send_message_locked(self, message: list[int]) -> None:
        try:
            self._midi_service.send_message(self._midi_input_selector, message)
        except Exception as exc:  # pragma: no cover - runtime dependent
            logger.warning("Sequencer MIDI message failed: %s", exc)

    def _send_messages_locked(self, messages: list[list[int]]) -> None:
        if not messages:
            return
        try:
            if len(messages) == 1:
                self._midi_service.send_message(self._midi_input_selector, messages[0])
                return
            self._midi_service.send_messages(self._midi_input_selector, messages)
        except Exception as exc:  # pragma: no cover - runtime dependent
            logger.warning("Sequencer MIDI batch failed: %s", exc)

    def _status_locked(self) -> SessionSequencerStatus:
        config = self._config
        if config is None:
            return SessionSequencerStatus(
                session_id=self._session_id,
                running=False,
                timing=SessionSequencerTimingConfig(),
                step_count=_TRANSPORT_STEPS_PER_BEAT,
                current_step=0,
                cycle=0,
                tracks=[],
            )

        current_step, cycle = self._transport_position_locked(config)
        tracks = [
            SessionSequencerTrackStatus(
                track_id=track.track_id,
                midi_channel=track.midi_channel,
                timing=SessionSequencerTimingConfig(
                    tempo_bpm=track.timing.tempo_bpm,
                    meter_numerator=track.timing.meter_numerator,
                    meter_denominator=track.timing.meter_denominator,
                    steps_per_beat=track.timing.steps_per_beat,
                ),
                length_beats=self._length_beats_for_pad(track, track.active_pad),
                step_count=self._active_pad_step_count(track),
                local_step=self._local_step_for(track, self._absolute_step),
                active_pad=track.active_pad,
                queued_pad=track.queued_pad,
                pad_loop_position=track.pad_loop_position,
                enabled=track.enabled,
                queued_enabled=track.queued_enabled,
                active_notes=sorted(self._active_notes.get(track.track_id, set())),
            )
            for track in config.tracks.values()
        ]

        return SessionSequencerStatus(
            session_id=self._session_id,
            running=self._running,
            timing=SessionSequencerTimingConfig(
                tempo_bpm=config.timing.tempo_bpm,
                meter_numerator=config.timing.meter_numerator,
                meter_denominator=config.timing.meter_denominator,
                steps_per_beat=config.timing.steps_per_beat,
            ),
            step_count=max(1, config.step_count),
            current_step=current_step,
            cycle=cycle,
            tracks=tracks,
        )

    def _ensure_config(self) -> SequencerRuntimeConfig:
        if self._config is None:
            self._config = self._build_runtime_config(
                SessionSequencerConfigRequest(
                    timing=SessionSequencerTimingConfig(),
                    step_count=_TRANSPORT_STEPS_PER_BEAT,
                    tracks=[
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "timing": SessionSequencerTimingConfig(),
                            "length_beats": 4,
                            "pads": [{"pad_index": 0, "length_beats": 4, "steps": [None] * 16}],
                        }
                    ]
                )
            )
            self._active_notes = {track_id: set() for track_id in self._config.tracks}
        return self._config

    @staticmethod
    def _normalize_step(
        value: int | list[int] | SessionSequencerStepConfig | None,
        default_velocity: int,
    ) -> SequencerStepRuntime:
        if isinstance(value, SessionSequencerStepConfig):
            return SequencerStepRuntime(
                notes=_normalize_step_notes(value.note),
                hold=bool(value.hold),
                velocity=_clamp_midi_velocity(
                    value.velocity if value.velocity is not None else default_velocity
                ),
            )
        return SequencerStepRuntime(
            notes=_normalize_step_notes(value),
            hold=False,
            velocity=_clamp_midi_velocity(default_velocity),
        )

    @staticmethod
    def _normalize_steps(
        raw_steps: list[int | list[int] | SessionSequencerStepConfig | None],
        step_count: int,
        default_velocity: int,
    ) -> tuple[SequencerStepRuntime, ...]:
        padded = raw_steps[:step_count] + [None] * max(0, step_count - len(raw_steps))
        normalized = [SessionSequencerRuntime._normalize_step(entry, default_velocity) for entry in padded]
        return tuple(normalized[:_MAX_STEPS])

    @staticmethod
    def _normalize_pad_loop_sequence(raw_sequence: list[int]) -> tuple[int, ...]:
        normalized: list[int] = []
        for entry in raw_sequence[:256]:
            token = int(entry)
            if 0 <= token < _DEFAULT_PADS:
                normalized.append(token)
                continue
            pause_beat_count = SessionSequencerRuntime._pause_beat_count_from_token(token)
            if pause_beat_count is not None:
                normalized.append(-pause_beat_count)
        return tuple(normalized)

    @staticmethod
    def _transport_extent_for_track(track: SequencerTrackRuntime, step_quantum: int) -> int:
        if track.pad_loop_enabled and track.pad_loop_sequence:
            return max(
                step_quantum,
                sum(
                    SessionSequencerRuntime._transport_step_count_for_loop_token(track, token)
                    for token in track.pad_loop_sequence
                ),
            )
        return max(step_quantum, SessionSequencerRuntime._transport_step_count_for_pad(track, track.configured_active_pad))

    def _build_runtime_config(self, request: SessionSequencerConfigRequest) -> SequencerRuntimeConfig:
        timing = SequencerTimingRuntime(
            tempo_bpm=request.timing.tempo_bpm,
            meter_numerator=4,
            meter_denominator=4,
            steps_per_beat=_TRANSPORT_STEPS_PER_BEAT,
        )
        step_quantum = _TRANSPORT_STEPS_PER_BEAT
        tracks: dict[str, SequencerTrackRuntime] = {}
        for track_request in request.tracks:
            track_timing = SequencerTimingRuntime(
                tempo_bpm=request.timing.tempo_bpm,
                meter_numerator=track_request.timing.meter_numerator,
                meter_denominator=track_request.timing.meter_denominator,
                steps_per_beat=track_request.timing.steps_per_beat,
            )
            track_length_beats = track_request.length_beats if 1 <= track_request.length_beats <= 8 else 4
            track_step_count = self._step_count_for_length(track_length_beats, track_timing)
            track_transport_step_count = track_length_beats * _TRANSPORT_STEPS_PER_BEAT
            pads: dict[int, SequencerPadRuntime] = {
                index: SequencerPadRuntime(
                    length_beats=track_length_beats,
                    step_count=track_step_count,
                    transport_step_count=track_transport_step_count,
                    steps=tuple(SequencerStepRuntime(notes=(), hold=False) for _ in range(track_step_count)),
                )
                for index in range(_DEFAULT_PADS)
            }

            for pad in track_request.pads:
                pad_length_beats = pad.length_beats if pad.length_beats is not None and 1 <= pad.length_beats <= 8 else track_length_beats
                pad_step_count = self._step_count_for_length(pad_length_beats, track_timing)
                pads[pad.pad_index] = SequencerPadRuntime(
                    length_beats=pad_length_beats,
                    step_count=pad_step_count,
                    transport_step_count=pad_length_beats * _TRANSPORT_STEPS_PER_BEAT,
                    steps=self._normalize_steps(
                        pad.steps,
                        pad_step_count,
                        track_request.velocity,
                    ),
                )

            active_pad = track_request.active_pad if track_request.active_pad in pads else 0
            queued_pad = track_request.queued_pad if track_request.queued_pad in pads else None

            tracks[track_request.track_id] = SequencerTrackRuntime(
                track_id=track_request.track_id,
                midi_channel=track_request.midi_channel,
                timing=track_timing,
                length_beats=track_length_beats,
                step_count=track_step_count,
                transport_step_count=track_transport_step_count,
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
                pad_loop_sequence=self._normalize_pad_loop_sequence(track_request.pad_loop_sequence),
            )

        playback_end_step = request.playback_end_step
        if "playback_end_step" not in request.model_fields_set:
            playback_end_step = max(
                step_quantum,
                max((self._transport_extent_for_track(track, step_quantum) for track in tracks.values()), default=step_quantum),
            )

        return SequencerRuntimeConfig(
            timing=timing,
            step_count=step_quantum,
            playback_start_step=request.playback_start_step,
            playback_end_step=playback_end_step,
            playback_loop=request.playback_loop,
            tracks=tracks,
        )
