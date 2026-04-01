from __future__ import annotations

from bisect import bisect_right
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from typing import Callable
from typing import Literal

from backend.app.models.session import (
    SessionControllerSequencerKeypointConfig,
    SessionSequencerConfigRequest,
    SessionControllerSequencerTrackStatus,
    SessionSequencerStepConfig,
    SessionSequencerStatus,
    SessionSequencerTimingConfig,
    SessionSequencerTrackStatus,
)
from backend.app.services.midi_service import MidiService

logger = logging.getLogger(__name__)

PublishEventFn = Callable[[str, dict[str, Any]], None]

_DEFAULT_PADS = 8
_MAX_STEPS = 128
_SCHEDULER_SLEEP_S = 0.001
_SCHEDULER_SPIN_THRESHOLD_S = 0.0008
_MIDI_SCHEDULE_LEAD_S = 0.100
_RENDER_SUBUNIT_EPSILON = 1e-9
_PAUSE_BEAT_COUNTS = frozenset({1, 2, 4, 8, 16})
_DEFAULT_TRACK_LENGTH_BEATS = 4
_TRANSPORT_STEPS_PER_BEAT = 8
_TRANSPORT_SUBUNITS_PER_STEP = 420
_TRANSPORT_SUBUNITS_PER_BEAT = _TRANSPORT_STEPS_PER_BEAT * _TRANSPORT_SUBUNITS_PER_STEP
_CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM = 28


def _clamp_midi_note(value: int) -> int:
    return max(0, min(127, int(value)))


def _clamp_midi_velocity(value: int) -> int:
    return max(0, min(127, int(value)))


def _clamp_controller_position(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _clamp_controller_value(value: float) -> int:
    return max(0, min(127, int(round(value))))


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


def _normalize_controller_keypoints(
    raw: list[SessionControllerSequencerKeypointConfig],
) -> tuple[tuple[float, int], ...]:
    epsilon = 1e-6
    normalized = sorted(
        (
            _clamp_controller_position(point.position),
            _clamp_controller_value(point.value),
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

    boundary_value = _clamp_controller_value(start_point[1])
    start_point = (0.0, boundary_value)
    end_point = (1.0, boundary_value)
    return (start_point, *interior, end_point)


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
        return _clamp_controller_value(points[0][1])
    if t >= 1.0:
        return _clamp_controller_value(points[-1][1])

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
    value = _catmull_rom_1d(p0[1], p1[1], p2[1], p3[1], local_t)
    return _clamp_controller_value(value)


@dataclass(slots=True)
class SequencerStepRuntime:
    notes: tuple[int, ...]
    hold: bool = False
    velocity: int = 100


@dataclass(slots=True)
class SequencerPadRuntime:
    length_beats: int
    step_count: int
    transport_subunit_count: int
    steps: tuple[SequencerStepRuntime, ...]


@dataclass(slots=True)
class ControllerSequencerEventRuntime:
    offset_subunit: int
    value: int


@dataclass(slots=True)
class ControllerSequencerPadRuntime:
    length_beats: int
    step_count: int
    transport_subunit_count: int
    events: tuple[ControllerSequencerEventRuntime, ...]
    event_offsets: tuple[int, ...] = ()


@dataclass(slots=True)
class SequencerTrackRuntime:
    track_id: str
    midi_channel: int
    timing: SequencerTimingRuntime
    length_beats: int
    step_count: int
    transport_subunit_count: int
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
    phase_offset_subunit: int = 0
    sequence_ended: bool = False


@dataclass(slots=True)
class ControllerSequencerTrackRuntime:
    track_id: str
    controller_number: int
    target_channels: tuple[int, ...]
    timing: SequencerTimingRuntime
    length_beats: int
    step_count: int
    transport_subunit_count: int
    enabled: bool
    configured_enabled: bool
    pads: dict[int, ControllerSequencerPadRuntime] = field(default_factory=dict)
    active_pad: int = 0
    configured_active_pad: int = 0
    queued_pad: int | None = None
    pad_loop_enabled: bool = False
    pad_loop_repeat: bool = True
    pad_loop_sequence: tuple[int, ...] = ()
    pad_loop_position: int | None = None
    phase_offset_subunit: int = 0
    sequence_ended: bool = False
    last_value: int | None = None


@dataclass(slots=True)
class SequencerTimingRuntime:
    tempo_bpm: int
    meter_numerator: int
    meter_denominator: int
    steps_per_beat: int
    beat_rate_numerator: int = 1
    beat_rate_denominator: int = 1

    @property
    def steps_per_bar(self) -> int:
        return self.meter_numerator * self.steps_per_beat

    @property
    def beat_duration_seconds(self) -> float:
        return 60.0 / float(self.tempo_bpm)

    @property
    def step_duration_seconds(self) -> float:
        return self.beat_duration_seconds / float(self.steps_per_beat)

    @property
    def transport_step_duration_seconds(self) -> float:
        return self.beat_duration_seconds / float(_TRANSPORT_STEPS_PER_BEAT)

    @property
    def transport_subunit_duration_seconds(self) -> float:
        return self.beat_duration_seconds / float(_TRANSPORT_SUBUNITS_PER_BEAT)

    @property
    def transport_subunits_per_local_step(self) -> int:
        return (
            _TRANSPORT_SUBUNITS_PER_BEAT * self.beat_rate_denominator
        ) // (self.beat_rate_numerator * self.steps_per_beat)


@dataclass(slots=True)
class SequencerRuntimeConfig:
    timing: SequencerTimingRuntime
    step_count: int
    playback_start_subunit: int = 0
    playback_end_subunit: int = _TRANSPORT_SUBUNITS_PER_BEAT
    playback_loop: bool = False
    tracks: dict[str, SequencerTrackRuntime] = field(default_factory=dict)
    controller_tracks: dict[str, ControllerSequencerTrackRuntime] = field(default_factory=dict)


class SessionSequencerRuntime:
    def __init__(
        self,
        session_id: str,
        midi_service: MidiService,
        midi_input_selector: str,
        controller_default_channels: tuple[int, ...],
        publish_event: PublishEventFn,
        *,
        clock_mode: Literal["wall_clock", "render_driven"] = "wall_clock",
    ) -> None:
        self._session_id = session_id
        self._midi_service = midi_service
        self._midi_input_selector = midi_input_selector
        self._controller_default_channels = controller_default_channels
        self._publish_event = publish_event
        self._clock_mode = clock_mode

        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

        self._config: SequencerRuntimeConfig | None = None
        self._running = False
        self._absolute_subunit = 0
        self._scheduled_visible_subunit = 0
        self._scheduled_visible_until_time: float | None = None
        self._active_notes: dict[str, set[int]] = {}
        self._render_subunit_remainder = 0.0

    def set_midi_input(self, midi_input_selector: str) -> None:
        with self._lock:
            self._midi_input_selector = midi_input_selector

    def configure(self, request: SessionSequencerConfigRequest) -> SessionSequencerStatus:
        with self._lock:
            previous_config = self._config
            next_config = self._build_runtime_config(request)
            self._release_reconfigured_track_notes_locked(previous_config, next_config)
            self._config = next_config
            self._absolute_subunit = self._normalize_stopped_absolute_subunit_locked(self._absolute_subunit, next_config)
            self._apply_absolute_subunit_locked(next_config, self._absolute_subunit)
            next_active_notes: dict[str, set[int]] = {}
            for track_id in next_config.tracks:
                next_active_notes[track_id] = set(self._active_notes.get(track_id, set()))
            self._active_notes = next_active_notes
            return self._status_locked()

    def queue_pad(self, track_id: str, pad_index: int | None) -> SessionSequencerStatus:
        with self._lock:
            config = self._ensure_config()
            track = config.tracks.get(track_id)
            if track is not None:
                self._queue_note_track_pad_locked(track_id, track, pad_index)
                return self._status_locked()

            controller_track = config.controller_tracks.get(track_id)
            if controller_track is not None:
                self._queue_controller_track_pad_locked(track_id, controller_track, pad_index)
                return self._status_locked()

            raise ValueError(f"Track '{track_id}' is not configured.")

    def _queue_note_track_pad_locked(
        self,
        track_id: str,
        track: SequencerTrackRuntime,
        pad_index: int | None,
    ) -> None:
        if pad_index is None:
            track.queued_pad = None
            return
        if pad_index not in track.pads:
            raise ValueError(f"Pad '{pad_index}' is not configured for track '{track_id}'.")

        if self._running:
            track.queued_pad = pad_index
            return

        track.active_pad = pad_index
        track.configured_active_pad = pad_index
        track.queued_pad = None
        track.phase_offset_subunit = self._absolute_subunit - (
            self._absolute_subunit % self._transport_subunit_count_for_pad(track, pad_index)
        )
        track.pad_loop_position = None
        track.sequence_ended = False

    def _queue_controller_track_pad_locked(
        self,
        track_id: str,
        track: ControllerSequencerTrackRuntime,
        pad_index: int | None,
    ) -> None:
        if pad_index is None:
            track.queued_pad = None
            return
        if pad_index not in track.pads:
            raise ValueError(f"Pad '{pad_index}' is not configured for track '{track_id}'.")

        if self._running:
            track.queued_pad = pad_index
            return

        track.active_pad = pad_index
        track.configured_active_pad = pad_index
        track.queued_pad = None
        track.phase_offset_subunit = self._absolute_subunit - (
            self._absolute_subunit % self._transport_subunit_count_for_pad(track, pad_index)
        )
        track.pad_loop_position = None
        track.sequence_ended = False
        track.last_value = None

    def rewind_cycle(self) -> SessionSequencerStatus:
        with self._lock:
            return self._seek_transport_cycle_locked(-1)

    def forward_cycle(self) -> SessionSequencerStatus:
        with self._lock:
            return self._seek_transport_cycle_locked(1)

    def start(self, position_step: int | None = None) -> SessionSequencerStatus:
        with self._lock:
            config = self._ensure_config()
            if self._running:
                return self._status_locked()

            requested_position_step = self._absolute_subunit // _TRANSPORT_SUBUNITS_PER_STEP if position_step is None else position_step
            requested_subunit = max(0, int(round(requested_position_step))) * _TRANSPORT_SUBUNITS_PER_STEP
            self._absolute_subunit = self._normalize_start_absolute_subunit_locked(requested_subunit, config)
            self._apply_absolute_subunit_locked(config, self._absolute_subunit)

            self._stop_event.clear()
            self._running = True
            self._render_subunit_remainder = 0.0
            if self._clock_mode == "render_driven":
                return self._status_locked()
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

            config = self._config
            if config is not None:
                visible_subunit = self._visible_absolute_subunit_locked()
                if visible_subunit != self._absolute_subunit:
                    self._apply_absolute_subunit_locked(config, visible_subunit)

            self._running = False
            self._stop_event.set()
            self._scheduled_visible_until_time = None
            self._render_subunit_remainder = 0.0
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

    def advance_render_block(self, *, sample_rate: int, ksmps: int) -> SessionSequencerStatus:
        with self._lock:
            if self._clock_mode != "render_driven":
                raise RuntimeError("Render-driven advancement is only available in render_driven mode.")

            config = self._ensure_config()
            if not self._running:
                return self._status_locked()

            if self._render_subunit_remainder <= _RENDER_SUBUNIT_EPSILON:
                self._render_subunit_remainder = 0.0
                self._perform_render_block_events_locked(config, self._absolute_subunit)

            if sample_rate > 0 and ksmps > 0:
                block_seconds = float(ksmps) / float(sample_rate)
                subunit_duration = config.timing.transport_subunit_duration_seconds
                if subunit_duration > 0.0:
                    self._render_subunit_remainder += block_seconds / subunit_duration

            while self._running and self._render_subunit_remainder >= (1.0 - _RENDER_SUBUNIT_EPSILON):
                self._advance_one_render_subunit_locked(config)
                self._render_subunit_remainder = max(0.0, self._render_subunit_remainder - 1.0)
                if self._running and self._render_subunit_remainder > _RENDER_SUBUNIT_EPSILON:
                    self._perform_render_block_events_locked(config, self._absolute_subunit)

            if self._render_subunit_remainder <= _RENDER_SUBUNIT_EPSILON:
                self._render_subunit_remainder = 0.0

            return self._status_locked()

    def _run(self) -> None:
        next_event_time = time.perf_counter() + 0.01
        wait_duration = 0.01

        while not self._stop_event.is_set():
            now = time.perf_counter()

            with self._lock:
                if not self._running:
                    break
                config = self._config
                if config is None:
                    break
                current_subunit = self._absolute_subunit

            wait = next_event_time - now
            if wait > _MIDI_SCHEDULE_LEAD_S + _SCHEDULER_SPIN_THRESHOLD_S:
                time.sleep(min(wait - _MIDI_SCHEDULE_LEAD_S, _SCHEDULER_SLEEP_S))
                continue
            if wait > _MIDI_SCHEDULE_LEAD_S:
                continue

            with self._lock:
                if not self._running:
                    break
                config = self._config
                if config is None:
                    break
                current_subunit = self._absolute_subunit

            wait_duration = self._perform_subunit_event(
                config,
                current_subunit,
                scheduled_time=next_event_time,
            )
            next_event_time += wait_duration

            now = time.perf_counter()
            if next_event_time < now - (wait_duration * 2.0):
                next_event_time = now + wait_duration

        with self._lock:
            self._send_all_notes_off_locked()
            for notes in self._active_notes.values():
                notes.clear()

    def _perform_render_block_events_locked(
        self,
        config: SequencerRuntimeConfig,
        transport_subunit: int,
    ) -> None:
        controller_messages: list[list[int]] = []
        for track_id, track in config.tracks.items():
            pad_runtime = self._active_pad_runtime(track)
            active_notes = self._active_notes.setdefault(track_id, set())
            if not track.enabled or pad_runtime is None or not pad_runtime.steps:
                self._release_track_notes_locked(track_id, track.midi_channel)
                continue
            if not self._local_step_boundary_reached(track, transport_subunit):
                continue
            local_step = self._local_step_for(track, transport_subunit)
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

        for track in config.controller_tracks.values():
            value = self._controller_track_value_at_current_subunit_locked(track, transport_subunit)
            if value is None or value == track.last_value:
                continue
            track.last_value = value
            for channel in track.target_channels:
                controller_messages.append(self._control_change_message(channel, track.controller_number, value))

        if controller_messages:
            self._send_messages_locked(controller_messages)

    def _advance_one_render_subunit_locked(self, config: SequencerRuntimeConfig) -> None:
        transport_subunit = self._absolute_subunit
        next_subunit = transport_subunit + 1
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        current_visible_step = transport_subunit // _TRANSPORT_SUBUNITS_PER_STEP

        if config.playback_loop and next_subunit >= config.playback_end_subunit:
            previous_active_pads = {
                track_id: track.active_pad
                for track_id, track in config.tracks.items()
                if track.enabled
            }
            previous_controller_active_pads = {
                track_id: track.active_pad
                for track_id, track in config.controller_tracks.items()
                if track.enabled
            }
            self._apply_absolute_subunit_locked(config, config.playback_start_subunit)
            for track_id, previous_active_pad in previous_active_pads.items():
                track = config.tracks.get(track_id)
                if track and track.enabled and track.active_pad != previous_active_pad:
                    _, cycle = self._transport_position_locked(config, self._absolute_subunit)
                    switch_payloads.append(
                        {
                            "track_id": track.track_id,
                            "active_pad": track.active_pad,
                            "cycle": cycle,
                        }
                    )
            for track_id, previous_active_pad in previous_controller_active_pads.items():
                track = config.controller_tracks.get(track_id)
                if track and track.enabled and track.active_pad != previous_active_pad:
                    _, cycle = self._transport_position_locked(config, self._absolute_subunit)
                    switch_payloads.append(
                        {
                            "track_id": track.track_id,
                            "active_pad": track.active_pad,
                            "cycle": cycle,
                        }
                    )
        else:
            switch_payloads = self._advance_tracks_for_next_subunit_locked(
                config,
                next_subunit,
                release_notes=True,
                delivery_delay_seconds=None,
            )
            switch_payloads.extend(self._advance_controller_tracks_for_next_subunit_locked(config, next_subunit))
            if next_subunit >= config.playback_end_subunit:
                self._absolute_subunit = config.playback_end_subunit
                self._running = False
                self._stop_event.set()
                self._send_all_notes_off_locked()
                for notes in self._active_notes.values():
                    notes.clear()
            else:
                self._absolute_subunit = next_subunit

        next_visible_step = self._absolute_subunit // _TRANSPORT_SUBUNITS_PER_STEP
        if next_visible_step != current_visible_step:
            self._publish_event(
                "sequencer_step",
                self._sequencer_step_event_payload_locked(config, previous_step=current_visible_step),
            )
        for payload in switch_payloads:
            self._publish_event(
                "sequencer_pad_switched",
                self._sequencer_pad_switch_event_payload_locked(config, payload),
            )

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
    def _transport_subunit_count_for_length(length_beats: int, timing: SequencerTimingRuntime) -> int:
        return (
            max(1, length_beats) *
            _TRANSPORT_SUBUNITS_PER_BEAT *
            timing.beat_rate_denominator
        ) // timing.beat_rate_numerator

    @staticmethod
    def _current_pad_loop_token(track: SequencerTrackRuntime | ControllerSequencerTrackRuntime) -> int | None:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            return None
        position = track.pad_loop_position
        if position is None or position < 0 or position >= len(track.pad_loop_sequence):
            return None
        return track.pad_loop_sequence[position]

    @staticmethod
    def _pad_loop_position_for_active_pad(track: SequencerTrackRuntime | ControllerSequencerTrackRuntime) -> int | None:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            return None
        for index, pad_index in enumerate(track.pad_loop_sequence):
            if pad_index == track.active_pad:
                return index
        return None

    def _reset_pad_loop_for_start_locked(
        self,
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    ) -> None:
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
    def _set_track_phase_offset_for_boundary_locked(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        next_subunit: int,
    ) -> None:
        track.phase_offset_subunit = next_subunit

    @staticmethod
    def _step_count_for_pad(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        pad_index: int,
    ) -> int:
        pad = track.pads.get(pad_index)
        if pad and 1 <= pad.step_count <= _MAX_STEPS:
            return pad.step_count
        return track.step_count if 1 <= track.step_count <= _MAX_STEPS else 16

    @staticmethod
    def _transport_subunit_count_for_pad(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        pad_index: int,
    ) -> int:
        pad = track.pads.get(pad_index)
        if pad and pad.transport_subunit_count > 0:
            return pad.transport_subunit_count
        return max(1, track.transport_subunit_count)

    @staticmethod
    def _length_beats_for_pad(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        pad_index: int,
    ) -> int:
        pad = track.pads.get(pad_index)
        if pad and pad.length_beats > 0:
            return pad.length_beats
        return track.length_beats if track.length_beats > 0 else _DEFAULT_TRACK_LENGTH_BEATS

    @staticmethod
    def _step_count_for_loop_token(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        token: int,
    ) -> int:
        if token in track.pads:
            return SessionSequencerRuntime._step_count_for_pad(track, token)
        pause_beat_count = SessionSequencerRuntime._pause_beat_count_from_token(token)
        if pause_beat_count is not None:
            return SessionSequencerRuntime._step_count_for_pause(pause_beat_count, track.timing)
        return SessionSequencerRuntime._step_count_for_pad(track, track.active_pad)

    @staticmethod
    def _transport_subunit_count_for_loop_token(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        token: int,
    ) -> int:
        if token in track.pads:
            return SessionSequencerRuntime._transport_subunit_count_for_pad(track, token)
        pause_beat_count = SessionSequencerRuntime._pause_beat_count_from_token(token)
        if pause_beat_count is not None:
            return SessionSequencerRuntime._transport_subunit_count_for_length(pause_beat_count, track.timing)
        return SessionSequencerRuntime._transport_subunit_count_for_pad(track, track.active_pad)

    @staticmethod
    def _length_beats_for_loop_token(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        token: int,
    ) -> int:
        if token in track.pads:
            return SessionSequencerRuntime._length_beats_for_pad(track, token)
        pause_beat_count = SessionSequencerRuntime._pause_beat_count_from_token(token)
        if pause_beat_count is not None:
            return pause_beat_count
        return SessionSequencerRuntime._length_beats_for_pad(track, track.active_pad)

    @staticmethod
    def _active_pad_runtime(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    ) -> SequencerPadRuntime | ControllerSequencerPadRuntime | None:
        token = SessionSequencerRuntime._current_pad_loop_token(track)
        if token is not None:
            return track.pads.get(token)
        return track.pads.get(track.active_pad)

    @staticmethod
    def _active_pad_step_count(track: SequencerTrackRuntime | ControllerSequencerTrackRuntime) -> int:
        token = SessionSequencerRuntime._current_pad_loop_token(track)
        if token is not None:
            return SessionSequencerRuntime._step_count_for_loop_token(track, token)
        return SessionSequencerRuntime._step_count_for_pad(track, track.active_pad)

    @staticmethod
    def _active_pad_transport_subunit_count(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    ) -> int:
        token = SessionSequencerRuntime._current_pad_loop_token(track)
        if token is not None:
            return SessionSequencerRuntime._transport_subunit_count_for_loop_token(track, token)
        return SessionSequencerRuntime._transport_subunit_count_for_pad(track, track.active_pad)

    @staticmethod
    def _transport_subunits_per_local_step(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
    ) -> int:
        return max(1, track.timing.transport_subunits_per_local_step)

    @staticmethod
    def _local_transport_offset_for(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        transport_subunit: int,
    ) -> int:
        return (
            transport_subunit - track.phase_offset_subunit
        ) % SessionSequencerRuntime._active_pad_transport_subunit_count(track)

    @staticmethod
    def _local_step_for(track: SequencerTrackRuntime, transport_subunit: int) -> int:
        step_count = max(1, SessionSequencerRuntime._active_pad_step_count(track))
        step_index_in_pad = SessionSequencerRuntime._local_transport_offset_for(track, transport_subunit)
        return min(
            step_count - 1,
            step_index_in_pad // SessionSequencerRuntime._transport_subunits_per_local_step(track),
        )

    @staticmethod
    def _local_step_boundary_reached(track: SequencerTrackRuntime, transport_subunit: int) -> bool:
        return (
            SessionSequencerRuntime._local_transport_offset_for(track, transport_subunit)
            % SessionSequencerRuntime._transport_subunits_per_local_step(track)
        ) == 0

    @staticmethod
    def _track_cycle_boundary_reached_for_next_subunit(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        next_subunit: int,
    ) -> bool:
        return (
            (next_subunit - track.phase_offset_subunit)
            % SessionSequencerRuntime._active_pad_transport_subunit_count(track)
        ) == 0

    @staticmethod
    def _track_at_sync_boundary_locked(track: SequencerTrackRuntime, next_subunit: int) -> bool:
        if not track.enabled:
            return False
        if not SessionSequencerRuntime._track_cycle_boundary_reached_for_next_subunit(track, next_subunit):
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
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        next_subunit: int,
        *,
        release_notes: bool,
        delivery_delay_seconds: float | None = None,
    ) -> None:
        track.phase_offset_subunit = next_subunit
        track.sequence_ended = False
        if track.pad_loop_enabled and track.pad_loop_sequence:
            self._reset_pad_loop_for_start_locked(track)
        else:
            track.pad_loop_position = None
        if release_notes:
            self._release_track_notes_locked(
                track_id,
                track.midi_channel,
                delivery_delay_seconds=delivery_delay_seconds,
            )

    def _pad_loop_boundary_action_locked(
        self,
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
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
        next_subunit: int,
    ) -> bool:
        for candidate in config.tracks.values():
            if candidate.track_id == track_id or not candidate.enabled:
                continue
            if not SessionSequencerRuntime._track_cycle_boundary_reached_for_next_subunit(candidate, next_subunit):
                return False
        return True

    def _advance_tracks_for_next_subunit_locked(
        self,
        config: SequencerRuntimeConfig,
        next_subunit: int,
        *,
        release_notes: bool,
        delivery_delay_seconds: float | None = None,
    ) -> list[dict[str, str | int | float | bool | None]]:
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        sync_master_triggered_ids: set[str] = set()
        _, next_cycle = self._transport_position_locked(config, next_subunit)

        for track_id, track in config.tracks.items():
            local_boundary_reached = self._track_cycle_boundary_reached_for_next_subunit(track, next_subunit)
            manual_pad_switch_applied = False
            track_started_on_boundary = False

            if track.queued_enabled is not None:
                if track.queued_enabled:
                    if self._can_start_track_on_boundary_locked(config, track_id, next_subunit):
                        self._reset_pad_loop_for_start_locked(track)
                        track.phase_offset_subunit = next_subunit
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
                        self._release_track_notes_locked(
                            track_id,
                            track.midi_channel,
                            delivery_delay_seconds=delivery_delay_seconds,
                        )

            if local_boundary_reached and track.queued_pad is not None and track.queued_pad != track.active_pad:
                track.active_pad = track.queued_pad
                track.queued_pad = None
                track.sequence_ended = False
                self._set_track_phase_offset_for_boundary_locked(track, next_subunit)
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
                        self._release_track_notes_locked(
                            track_id,
                            track.midi_channel,
                            delivery_delay_seconds=delivery_delay_seconds,
                        )
                elif next_pad_from_loop is not None:
                    self._set_track_phase_offset_for_boundary_locked(track, next_subunit)
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
                        self._release_track_notes_locked(
                            track_id,
                            track.midi_channel,
                            delivery_delay_seconds=delivery_delay_seconds,
                        )
                else:
                    self._set_track_phase_offset_for_boundary_locked(track, next_subunit)

        for track_id, track in config.tracks.items():
            if self._track_at_sync_boundary_locked(track, next_subunit):
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
                    next_subunit,
                    release_notes=release_notes,
                    delivery_delay_seconds=delivery_delay_seconds,
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

    def _advance_controller_tracks_for_next_subunit_locked(
        self,
        config: SequencerRuntimeConfig,
        next_subunit: int,
    ) -> list[dict[str, str | int | float | bool | None]]:
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        _, next_cycle = self._transport_position_locked(config, next_subunit)

        for track in config.controller_tracks.values():
            local_boundary_reached = self._track_cycle_boundary_reached_for_next_subunit(track, next_subunit)
            manual_pad_switch_applied = False
            if not local_boundary_reached or not track.enabled:
                continue

            if track.queued_pad is not None and track.queued_pad != track.active_pad:
                track.active_pad = track.queued_pad
                track.queued_pad = None
                track.sequence_ended = False
                self._set_track_phase_offset_for_boundary_locked(track, next_subunit)
                manual_pad_switch_applied = True
                switch_payloads.append(
                    {
                        "track_id": track.track_id,
                        "active_pad": track.active_pad,
                        "cycle": next_cycle,
                    }
                )

            next_pad_from_loop, stop_track_on_loop_end = self._pad_loop_boundary_action_locked(
                track,
                manual_switch_applied=manual_pad_switch_applied,
            )
            if stop_track_on_loop_end:
                track.enabled = False
                track.sequence_ended = True
                track.queued_pad = None
                track.last_value = None
                continue

            if next_pad_from_loop is not None:
                self._set_track_phase_offset_for_boundary_locked(track, next_subunit)
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
            else:
                self._set_track_phase_offset_for_boundary_locked(track, next_subunit)

        return switch_payloads

    def _transport_position_locked(
        self,
        config: SequencerRuntimeConfig,
        absolute_subunit: int | None = None,
    ) -> tuple[int, int]:
        normalized_absolute = max(0, int(self._absolute_subunit if absolute_subunit is None else absolute_subunit))
        visible_absolute_step = normalized_absolute // _TRANSPORT_SUBUNITS_PER_STEP
        step_count = max(1, config.step_count)
        return (visible_absolute_step % step_count, visible_absolute_step // step_count)

    def _visible_absolute_subunit_locked(self) -> int:
        if not self._running:
            return self._absolute_subunit
        if (
            self._scheduled_visible_until_time is not None
            and time.perf_counter() < self._scheduled_visible_until_time
        ):
            return self._scheduled_visible_subunit
        return self._absolute_subunit

    def _playback_seek_bounds_locked(self, config: SequencerRuntimeConfig, *, running: bool) -> tuple[int, int]:
        min_subunit = max(0, config.playback_start_subunit)
        max_subunit = max(min_subunit, config.playback_end_subunit - (1 if running else 0))
        return (min_subunit, max_subunit)

    def _normalize_stopped_absolute_subunit_locked(
        self,
        absolute_subunit: int,
        config: SequencerRuntimeConfig,
    ) -> int:
        min_subunit, max_subunit = self._playback_seek_bounds_locked(config, running=False)
        normalized = max(min_subunit, min(max_subunit, int(round(absolute_subunit))))
        if config.playback_loop and not (config.playback_start_subunit <= normalized <= config.playback_end_subunit):
            return config.playback_start_subunit
        return normalized

    def _normalize_start_absolute_subunit_locked(
        self,
        absolute_subunit: int,
        config: SequencerRuntimeConfig,
    ) -> int:
        requested = int(round(absolute_subunit))
        if requested < config.playback_start_subunit or requested >= config.playback_end_subunit:
            return config.playback_start_subunit
        return requested

    def _normalize_seek_absolute_subunit_locked(
        self,
        absolute_subunit: int,
        config: SequencerRuntimeConfig,
        *,
        running: bool,
    ) -> int:
        min_subunit, max_subunit = self._playback_seek_bounds_locked(config, running=running)
        return max(min_subunit, min(max_subunit, int(round(absolute_subunit))))

    def _reset_track_runtime_for_absolute_subunit_locked(self, track: SequencerTrackRuntime) -> None:
        track.enabled = track.configured_enabled
        track.active_pad = track.configured_active_pad
        track.phase_offset_subunit = 0
        track.pad_loop_position = None
        track.sequence_ended = False
        if track.enabled:
            self._reset_pad_loop_for_start_locked(track)

    def _reset_controller_track_runtime_for_absolute_subunit_locked(
        self,
        track: ControllerSequencerTrackRuntime,
    ) -> None:
        track.enabled = track.configured_enabled
        track.active_pad = track.configured_active_pad
        track.phase_offset_subunit = 0
        track.pad_loop_position = None
        track.sequence_ended = False
        track.last_value = None
        if track.enabled:
            self._reset_pad_loop_for_start_locked(track)

    def _next_track_cycle_boundary_subunit(
        self,
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        current_subunit: int,
    ) -> int:
        cycle_length = max(1, self._active_pad_transport_subunit_count(track))
        cycle_offset = self._local_transport_offset_for(track, current_subunit)
        return current_subunit - cycle_offset + cycle_length

    def _next_local_step_boundary_subunit(self, track: SequencerTrackRuntime, current_subunit: int) -> int:
        transport_offset = self._local_transport_offset_for(track, current_subunit)
        step_span = max(1, self._transport_subunits_per_local_step(track))
        return current_subunit - transport_offset + (((transport_offset // step_span) + 1) * step_span)

    @staticmethod
    def _controller_pause_token_active(track: ControllerSequencerTrackRuntime) -> bool:
        token = SessionSequencerRuntime._current_pad_loop_token(track)
        return token is not None and SessionSequencerRuntime._pause_beat_count_from_token(token) is not None

    def _controller_track_value_at_current_subunit_locked(
        self,
        track: ControllerSequencerTrackRuntime,
        transport_subunit: int,
    ) -> int | None:
        if not track.enabled or self._controller_pause_token_active(track):
            return None
        pad_runtime = self._active_pad_runtime(track)
        if not isinstance(pad_runtime, ControllerSequencerPadRuntime) or not pad_runtime.event_offsets:
            return None
        local_offset = self._local_transport_offset_for(track, transport_subunit)
        index = bisect_right(pad_runtime.event_offsets, local_offset) - 1
        if index < 0:
            return None
        return pad_runtime.events[index].value

    def _next_controller_change_subunit_locked(
        self,
        track: ControllerSequencerTrackRuntime,
        current_subunit: int,
    ) -> int | None:
        if not track.enabled or self._controller_pause_token_active(track):
            return None
        pad_runtime = self._active_pad_runtime(track)
        if not isinstance(pad_runtime, ControllerSequencerPadRuntime) or not pad_runtime.event_offsets:
            return None
        local_offset = self._local_transport_offset_for(track, current_subunit)
        next_index = bisect_right(pad_runtime.event_offsets, local_offset)
        if next_index >= len(pad_runtime.event_offsets):
            return None
        return current_subunit - local_offset + pad_runtime.event_offsets[next_index]

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
                candidates.append(self._next_track_cycle_boundary_subunit(track, current_subunit))
                pad_runtime = self._active_pad_runtime(track)
                if pad_runtime is not None and pad_runtime.steps:
                    candidates.append(self._next_local_step_boundary_subunit(track, current_subunit))
        for track in config.controller_tracks.values():
            if not track.enabled:
                continue
            candidates.append(self._next_track_cycle_boundary_subunit(track, current_subunit))
            next_controller_change = self._next_controller_change_subunit_locked(track, current_subunit)
            if next_controller_change is not None:
                candidates.append(next_controller_change)
        candidates.append(config.playback_end_subunit)
        return min(candidate for candidate in candidates if candidate > current_subunit)

    def _apply_absolute_subunit_locked(self, config: SequencerRuntimeConfig, absolute_subunit: int) -> None:
        normalized_absolute = max(0, int(round(absolute_subunit)))
        simulation_target = min(normalized_absolute, config.playback_end_subunit)
        pending_by_track: dict[str, tuple[int | None, bool | None]] = {}
        pending_by_controller_track: dict[str, int | None] = {}

        for track in config.tracks.values():
            pending_by_track[track.track_id] = (track.queued_pad, track.queued_enabled)
            track.queued_pad = None
            track.queued_enabled = None
            self._reset_track_runtime_for_absolute_subunit_locked(track)
        for track in config.controller_tracks.values():
            pending_by_controller_track[track.track_id] = track.queued_pad
            track.queued_pad = None
            self._reset_controller_track_runtime_for_absolute_subunit_locked(track)

        simulated_subunit = 0
        while True:
            next_boundary = self._next_cycle_event_subunit_locked(config, simulated_subunit)
            if next_boundary is None or next_boundary > simulation_target:
                break
            self._advance_tracks_for_next_subunit_locked(
                config,
                next_boundary,
                release_notes=False,
            )
            self._advance_controller_tracks_for_next_subunit_locked(config, next_boundary)
            simulated_subunit = next_boundary

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
        for track in config.controller_tracks.values():
            pending_pad = pending_by_controller_track[track.track_id]
            track.queued_pad = (
                pending_pad
                if pending_pad is not None and pending_pad in track.pads and pending_pad != track.active_pad
                else None
            )

        self._absolute_subunit = normalized_absolute
        self._scheduled_visible_subunit = normalized_absolute
        self._scheduled_visible_until_time = None

    def _seek_steps_locked(self, delta_steps: int) -> SessionSequencerStatus:
        config = self._ensure_config()
        target_subunit = self._absolute_subunit + (int(delta_steps) * _TRANSPORT_SUBUNITS_PER_STEP)
        normalized_target = self._normalize_seek_absolute_subunit_locked(
            target_subunit,
            config,
            running=self._running,
        )
        if normalized_target == self._absolute_subunit:
            return self._status_locked()

        if self._running:
            for track_id, track in config.tracks.items():
                self._release_track_notes_locked(track_id, track.midi_channel)
            for notes in self._active_notes.values():
                notes.clear()

        self._apply_absolute_subunit_locked(config, normalized_target)
        return self._status_locked()

    def _seek_transport_cycle_locked(self, direction: int) -> SessionSequencerStatus:
        config = self._ensure_config()
        current_step = max(0, self._absolute_subunit // _TRANSPORT_SUBUNITS_PER_STEP)
        cycle_steps = max(1, _TRANSPORT_STEPS_PER_BEAT)
        if direction < 0:
            target_step = max(0, ((max(0, current_step - 1)) // cycle_steps) * cycle_steps)
        else:
            target_step = ((current_step // cycle_steps) + 1) * cycle_steps
        delta_steps = target_step - current_step
        return self._seek_steps_locked(delta_steps)

    def _perform_subunit_event(
        self,
        config: SequencerRuntimeConfig,
        transport_subunit: int,
        *,
        scheduled_time: float | None = None,
    ) -> float:
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        publish_step_event = False
        next_wait_subunits = 1

        with self._lock:
            event_delivery_delay_seconds = (
                None
                if scheduled_time is None
                else max(0.0, scheduled_time - time.perf_counter())
            )
            controller_messages: list[list[int]] = []
            for track_id, track in config.tracks.items():
                pad_runtime = self._active_pad_runtime(track)
                active_notes = self._active_notes.setdefault(track_id, set())
                if not track.enabled or pad_runtime is None or not pad_runtime.steps:
                    self._release_track_notes_locked(
                        track_id,
                        track.midi_channel,
                        delivery_delay_seconds=event_delivery_delay_seconds,
                    )
                    continue
                if not self._local_step_boundary_reached(track, transport_subunit):
                    continue
                local_step = self._local_step_for(track, transport_subunit)
                step_state = pad_runtime.steps[local_step]
                notes = step_state.notes
                if notes:
                    self._release_track_notes_locked(
                        track_id,
                        track.midi_channel,
                        delivery_delay_seconds=event_delivery_delay_seconds,
                    )
                    self._send_messages_locked(
                        [self._note_on_message(track.midi_channel, note, step_state.velocity) for note in notes],
                        delivery_delay_seconds=event_delivery_delay_seconds,
                    )
                    for note in notes:
                        active_notes.add(note)
                elif not step_state.hold:
                    self._release_track_notes_locked(
                        track_id,
                        track.midi_channel,
                        delivery_delay_seconds=event_delivery_delay_seconds,
                    )

            for track in config.controller_tracks.values():
                value = self._controller_track_value_at_current_subunit_locked(track, transport_subunit)
                if value is None or value == track.last_value:
                    continue
                track.last_value = value
                for channel in track.target_channels:
                    controller_messages.append(
                        self._control_change_message(channel, track.controller_number, value)
                    )

            if controller_messages:
                self._send_messages_locked(
                    controller_messages,
                    delivery_delay_seconds=event_delivery_delay_seconds,
                )

            next_subunit = self._next_event_subunit_locked(config, transport_subunit)
            next_wait_subunits = max(1, next_subunit - transport_subunit)
            boundary_scheduled_time = (
                None
                if scheduled_time is None
                else scheduled_time + (next_wait_subunits * config.timing.transport_subunit_duration_seconds)
            )
            self._scheduled_visible_subunit = transport_subunit
            self._scheduled_visible_until_time = boundary_scheduled_time
            boundary_delivery_delay_seconds = (
                None
                if boundary_scheduled_time is None
                else max(0.0, boundary_scheduled_time - time.perf_counter())
            )
            current_visible_step = transport_subunit // _TRANSPORT_SUBUNITS_PER_STEP

            if config.playback_loop and next_subunit >= config.playback_end_subunit:
                previous_active_pads = {
                    track_id: track.active_pad
                    for track_id, track in config.tracks.items()
                    if track.enabled
                }
                previous_controller_active_pads = {
                    track_id: track.active_pad
                    for track_id, track in config.controller_tracks.items()
                    if track.enabled
                }
                self._apply_absolute_subunit_locked(config, config.playback_start_subunit)
                for track_id, previous_active_pad in previous_active_pads.items():
                    track = config.tracks.get(track_id)
                    if track and track.enabled and track.active_pad != previous_active_pad:
                        _, cycle = self._transport_position_locked(config, self._absolute_subunit)
                        switch_payloads.append(
                            {
                                "track_id": track.track_id,
                                "active_pad": track.active_pad,
                                "cycle": cycle,
                            }
                        )
                for track_id, previous_active_pad in previous_controller_active_pads.items():
                    track = config.controller_tracks.get(track_id)
                    if track and track.enabled and track.active_pad != previous_active_pad:
                        _, cycle = self._transport_position_locked(config, self._absolute_subunit)
                        switch_payloads.append(
                            {
                                "track_id": track.track_id,
                                "active_pad": track.active_pad,
                                "cycle": cycle,
                            }
                        )
            else:
                switch_payloads = self._advance_tracks_for_next_subunit_locked(
                    config,
                    next_subunit,
                    release_notes=True,
                    delivery_delay_seconds=boundary_delivery_delay_seconds,
                )
                switch_payloads.extend(self._advance_controller_tracks_for_next_subunit_locked(config, next_subunit))
                if next_subunit >= config.playback_end_subunit:
                    self._absolute_subunit = config.playback_end_subunit
                    self._running = False
                    self._stop_event.set()
                else:
                    self._absolute_subunit = next_subunit

            next_visible_step = self._absolute_subunit // _TRANSPORT_SUBUNITS_PER_STEP
            publish_step_event = next_visible_step != current_visible_step

            if publish_step_event:
                step_payload = self._sequencer_step_event_payload_locked(config, previous_step=current_visible_step)
            else:
                step_payload: dict[str, Any] = {}

        if publish_step_event:
            self._publish_event("sequencer_step", step_payload)
        for payload in switch_payloads:
            self._publish_event(
                "sequencer_pad_switched",
                self._sequencer_pad_switch_event_payload_locked(config, payload),
            )
        return next_wait_subunits * config.timing.transport_subunit_duration_seconds

    def _sequencer_step_event_payload_locked(
        self,
        config: SequencerRuntimeConfig,
        *,
        previous_step: int,
    ) -> dict[str, Any]:
        status = self._status_locked()
        runtime_payload = self._sequencer_runtime_delta_payload_from_status(status)
        return {
            "previous_step": previous_step % max(1, config.step_count),
            **runtime_payload,
        }

    @staticmethod
    def _sequencer_runtime_delta_payload_from_status(status: SessionSequencerStatus) -> dict[str, Any]:
        return {
            "current_step": status.current_step,
            "cycle": status.cycle,
            "running": status.running,
            "step_count": status.step_count,
            "transport_subunit": status.transport_subunit,
            "tracks": [
                {
                    "track_id": track.track_id,
                    "local_step": track.local_step,
                }
                for track in status.tracks
            ],
            "controller_tracks": [
                {
                    "track_id": track.track_id,
                    "runtime_pad_start_subunit": track.runtime_pad_start_subunit,
                }
                for track in status.controller_tracks
            ],
        }

    def _sequencer_pad_switch_event_payload_locked(
        self,
        config: SequencerRuntimeConfig,
        payload: dict[str, str | int | float | bool | None],
    ) -> dict[str, Any]:
        status = self._status_locked()
        enriched_payload: dict[str, Any] = {
            **payload,
            **self._sequencer_runtime_delta_payload_from_status(status),
        }

        track_id = payload.get("track_id")
        if not isinstance(track_id, str):
            return enriched_payload

        track_status = next((track for track in status.tracks if track.track_id == track_id), None)
        if track_status is not None:
            enriched_payload.update(
                {
                    "track_kind": "note",
                    "local_step": track_status.local_step,
                    "queued_pad": track_status.queued_pad,
                    "pad_loop_position": track_status.pad_loop_position,
                    "enabled": track_status.enabled,
                    "queued_enabled": track_status.queued_enabled,
                    "runtime_pad_start_subunit": track_status.runtime_pad_start_subunit,
                }
            )
            return enriched_payload

        controller_track_status = next(
            (track for track in status.controller_tracks if track.track_id == track_id),
            None,
        )
        if controller_track_status is not None:
            enriched_payload.update(
                {
                    "track_kind": "controller",
                    "queued_pad": controller_track_status.queued_pad,
                    "pad_loop_position": controller_track_status.pad_loop_position,
                    "enabled": controller_track_status.enabled,
                    "runtime_pad_start_subunit": controller_track_status.runtime_pad_start_subunit,
                }
            )
        return enriched_payload

    @staticmethod
    def _note_on_message(midi_channel: int, note: int, velocity: int) -> list[int]:
        channel_byte = (midi_channel - 1) & 0x0F
        return [0x90 + channel_byte, _clamp_midi_note(note), _clamp_midi_velocity(velocity)]

    @staticmethod
    def _note_off_message(midi_channel: int, note: int) -> list[int]:
        channel_byte = (midi_channel - 1) & 0x0F
        return [0x80 + channel_byte, _clamp_midi_note(note), 0]

    @staticmethod
    def _control_change_message(midi_channel: int, controller_number: int, value: int) -> list[int]:
        channel_byte = (midi_channel - 1) & 0x0F
        return [0xB0 + channel_byte, _clamp_midi_note(controller_number), _clamp_controller_value(value)]

    def _release_track_notes_locked(
        self,
        track_id: str,
        midi_channel: int,
        *,
        delivery_delay_seconds: float | None = None,
    ) -> None:
        active_notes = self._active_notes.get(track_id)
        if not active_notes:
            return

        self._send_messages_locked(
            [self._note_off_message(midi_channel, note) for note in sorted(active_notes)],
            delivery_delay_seconds=delivery_delay_seconds,
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

    def _send_message_locked(
        self,
        message: list[int],
        *,
        delivery_delay_seconds: float | None = None,
    ) -> None:
        try:
            self._midi_service.send_scheduled_message(
                self._midi_input_selector,
                message,
                delivery_delay_seconds=delivery_delay_seconds,
            )
        except Exception as exc:  # pragma: no cover - runtime dependent
            logger.warning("Sequencer MIDI message failed: %s", exc)

    def _send_messages_locked(
        self,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None = None,
    ) -> None:
        if not messages:
            return
        try:
            if len(messages) == 1:
                self._midi_service.send_scheduled_message(
                    self._midi_input_selector,
                    messages[0],
                    delivery_delay_seconds=delivery_delay_seconds,
                )
                return
            self._midi_service.send_scheduled_messages(
                self._midi_input_selector,
                messages,
                delivery_delay_seconds=delivery_delay_seconds,
            )
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
                transport_subunit=0,
                tracks=[],
                controller_tracks=[],
            )

        current_step, cycle = self._transport_position_locked(config)
        visible_absolute_subunit = self._visible_absolute_subunit_locked()
        current_step, cycle = self._transport_position_locked(config, visible_absolute_subunit)
        tracks = [
            SessionSequencerTrackStatus(
                track_id=track.track_id,
                midi_channel=track.midi_channel,
                timing=SessionSequencerTimingConfig(
                    tempo_bpm=track.timing.tempo_bpm,
                    meter_numerator=track.timing.meter_numerator,
                    meter_denominator=track.timing.meter_denominator,
                    steps_per_beat=track.timing.steps_per_beat,
                    beat_rate_numerator=track.timing.beat_rate_numerator,
                    beat_rate_denominator=track.timing.beat_rate_denominator,
                ),
                length_beats=self._length_beats_for_pad(track, track.active_pad),
                step_count=self._active_pad_step_count(track),
                local_step=self._local_step_for(track, visible_absolute_subunit),
                active_pad=track.active_pad,
                queued_pad=track.queued_pad,
                pad_loop_position=track.pad_loop_position,
                enabled=track.enabled,
                queued_enabled=track.queued_enabled,
                runtime_pad_start_subunit=track.phase_offset_subunit if track.enabled else None,
                active_notes=sorted(self._active_notes.get(track.track_id, set())),
            )
            for track in config.tracks.values()
        ]
        controller_tracks = [
            SessionControllerSequencerTrackStatus(
                track_id=track.track_id,
                controller_number=track.controller_number,
                timing=SessionSequencerTimingConfig(
                    tempo_bpm=track.timing.tempo_bpm,
                    meter_numerator=track.timing.meter_numerator,
                    meter_denominator=track.timing.meter_denominator,
                    steps_per_beat=track.timing.steps_per_beat,
                    beat_rate_numerator=track.timing.beat_rate_numerator,
                    beat_rate_denominator=track.timing.beat_rate_denominator,
                ),
                length_beats=self._length_beats_for_pad(track, track.active_pad),
                step_count=self._active_pad_step_count(track),
                active_pad=track.active_pad,
                queued_pad=track.queued_pad,
                pad_loop_position=track.pad_loop_position if track.enabled else None,
                enabled=track.enabled,
                runtime_pad_start_subunit=track.phase_offset_subunit if track.enabled else None,
                last_value=track.last_value,
                target_channels=list(track.target_channels),
            )
            for track in config.controller_tracks.values()
        ]

        return SessionSequencerStatus(
            session_id=self._session_id,
            running=self._running,
            timing=SessionSequencerTimingConfig(
                tempo_bpm=config.timing.tempo_bpm,
                meter_numerator=config.timing.meter_numerator,
                meter_denominator=config.timing.meter_denominator,
                steps_per_beat=config.timing.steps_per_beat,
                beat_rate_numerator=config.timing.beat_rate_numerator,
                beat_rate_denominator=config.timing.beat_rate_denominator,
            ),
            step_count=max(1, config.step_count),
            current_step=current_step,
            cycle=cycle,
            transport_subunit=visible_absolute_subunit,
            tracks=tracks,
            controller_tracks=controller_tracks,
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
    def _compile_controller_pad_runtime(
        keypoints: list[SessionControllerSequencerKeypointConfig],
        *,
        length_beats: int,
        timing: SequencerTimingRuntime,
    ) -> ControllerSequencerPadRuntime:
        step_count = SessionSequencerRuntime._step_count_for_length(length_beats, timing)
        transport_subunit_count = SessionSequencerRuntime._transport_subunit_count_for_length(length_beats, timing)
        normalized_keypoints = _normalize_controller_keypoints(keypoints)
        events: list[ControllerSequencerEventRuntime] = []

        event_offset = 0
        while event_offset < transport_subunit_count:
            normalized_position = event_offset / float(max(1, transport_subunit_count))
            value = _sample_controller_curve_value(normalized_keypoints, normalized_position)
            if not events or events[-1].value != value:
                events.append(ControllerSequencerEventRuntime(offset_subunit=event_offset, value=value))
            event_offset += _CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM

        if not events:
            events.append(ControllerSequencerEventRuntime(offset_subunit=0, value=0))

        return ControllerSequencerPadRuntime(
            length_beats=length_beats,
            step_count=step_count,
            transport_subunit_count=transport_subunit_count,
            events=tuple(events),
            event_offsets=tuple(event.offset_subunit for event in events),
        )

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

    def _normalize_controller_target_channels(self, raw_channels: list[int]) -> tuple[int, ...]:
        if raw_channels:
            normalized = tuple(sorted({max(1, min(16, int(channel))) for channel in raw_channels}))
            if normalized:
                return normalized
        if self._controller_default_channels:
            return self._controller_default_channels
        return (1,)

    @staticmethod
    def _transport_extent_for_track(
        track: SequencerTrackRuntime | ControllerSequencerTrackRuntime,
        step_quantum: int,
    ) -> int:
        if track.pad_loop_enabled and track.pad_loop_sequence:
            return max(
                step_quantum,
                sum(
                    SessionSequencerRuntime._transport_subunit_count_for_loop_token(track, token)
                    for token in track.pad_loop_sequence
                ),
            )
        return max(step_quantum, SessionSequencerRuntime._transport_subunit_count_for_pad(track, track.configured_active_pad))

    def _build_runtime_config(self, request: SessionSequencerConfigRequest) -> SequencerRuntimeConfig:
        timing = SequencerTimingRuntime(
            tempo_bpm=request.timing.tempo_bpm,
            meter_numerator=4,
            meter_denominator=4,
            steps_per_beat=_TRANSPORT_STEPS_PER_BEAT,
            beat_rate_numerator=1,
            beat_rate_denominator=1,
        )
        step_quantum = _TRANSPORT_STEPS_PER_BEAT
        subunit_quantum = _TRANSPORT_SUBUNITS_PER_BEAT
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
            track_step_count = self._step_count_for_length(track_length_beats, track_timing)
            track_transport_subunit_count = self._transport_subunit_count_for_length(track_length_beats, track_timing)
            pads: dict[int, SequencerPadRuntime] = {
                index: SequencerPadRuntime(
                    length_beats=track_length_beats,
                    step_count=track_step_count,
                    transport_subunit_count=track_transport_subunit_count,
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
                    transport_subunit_count=self._transport_subunit_count_for_length(pad_length_beats, track_timing),
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
                pad_loop_sequence=self._normalize_pad_loop_sequence(track_request.pad_loop_sequence),
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
            track_step_count = self._step_count_for_length(track_length_beats, track_timing)
            track_transport_subunit_count = self._transport_subunit_count_for_length(track_length_beats, track_timing)
            pads = {
                index: self._compile_controller_pad_runtime(
                    [],
                    length_beats=track_length_beats,
                    timing=track_timing,
                )
                for index in range(_DEFAULT_PADS)
            }

            for pad in track_request.pads:
                pad_length_beats = (
                    pad.length_beats
                    if pad.length_beats is not None and 1 <= pad.length_beats <= 16
                    else track_length_beats
                )
                pads[pad.pad_index] = self._compile_controller_pad_runtime(
                    pad.keypoints,
                    length_beats=pad_length_beats,
                    timing=track_timing,
                )

            active_pad = track_request.active_pad if track_request.active_pad in pads else 0
            queued_pad = track_request.queued_pad if track_request.queued_pad in pads else None
            controller_tracks[track_request.track_id] = ControllerSequencerTrackRuntime(
                track_id=track_request.track_id,
                controller_number=track_request.controller_number,
                target_channels=self._normalize_controller_target_channels(track_request.target_channels),
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
                pad_loop_sequence=self._normalize_pad_loop_sequence(track_request.pad_loop_sequence),
            )

        playback_end_subunit = request.playback_end_step * _TRANSPORT_SUBUNITS_PER_STEP
        if "playback_end_step" not in request.model_fields_set:
            playback_end_subunit = max(
                subunit_quantum,
                max(
                    (
                        self._transport_extent_for_track(track, subunit_quantum)
                        for track in [*tracks.values(), *controller_tracks.values()]
                    ),
                    default=subunit_quantum,
                ),
            )

        return SequencerRuntimeConfig(
            timing=timing,
            step_count=step_quantum,
            playback_start_subunit=request.playback_start_step * _TRANSPORT_SUBUNITS_PER_STEP,
            playback_end_subunit=playback_end_subunit,
            playback_loop=request.playback_loop,
            tracks=tracks,
            controller_tracks=controller_tracks,
        )
