from __future__ import annotations

from bisect import bisect_right
import logging
import threading
import time
from typing import Any
from typing import Callable
from typing import Literal
from typing import Protocol

from backend.app.models.session import (
    SessionSequencerConfigRequest,
    SessionControllerSequencerTrackStatus,
    SessionSequencerStatus,
    SessionSequencerTimingConfig,
    SessionSequencerTrackStatus,
)
from backend.app.services.arpeggiator_runtime import MidiSourceContext
from backend.app.services.sequencer_runtime_config import (
    clamp_controller_value as _clamp_controller_value,
    clamp_midi_note as _clamp_midi_note,
    clamp_midi_velocity as _clamp_midi_velocity,
    compile_sequencer_runtime_config,
)
from backend.app.services.sequencer_runtime_constants import (
    DEFAULT_TRACK_LENGTH_BEATS as _DEFAULT_TRACK_LENGTH_BEATS,
    MAX_SEQUENCER_STEPS as _MAX_STEPS,
    PAUSE_BEAT_COUNTS as _PAUSE_BEAT_COUNTS,
    TRANSPORT_STEPS_PER_BEAT as _TRANSPORT_STEPS_PER_BEAT,
    TRANSPORT_SUBUNITS_PER_BEAT as _TRANSPORT_SUBUNITS_PER_BEAT,
    TRANSPORT_SUBUNITS_PER_STEP as _TRANSPORT_SUBUNITS_PER_STEP,
)
from backend.app.services.sequencer_runtime_models import (
    ControllerSequencerPadRuntime,
    ControllerSequencerTrackRuntime,
    RenderTransportEvent,
    SequencerPadRuntime,
    SequencerRuntimeConfig,
    SequencerTimingRuntime,
    SequencerTrackRuntime,
)
logger = logging.getLogger(__name__)

PublishEventFn = Callable[[str, dict[str, Any]], None]


class SequencerMidiOutput(Protocol):
    output_name: str

    def send_scheduled_message(
        self,
        _selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None,
    ) -> str: ...

    def send_scheduled_messages(
        self,
        _selector: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
    ) -> str: ...

_SCHEDULER_SLEEP_S = 0.001
_SCHEDULER_SPIN_THRESHOLD_S = 0.0008
_MIDI_SCHEDULE_LEAD_S = 0.100
_RENDER_SUBUNIT_EPSILON = 1e-9


class SessionSequencerRuntime:
    def __init__(
        self,
        session_id: str,
        midi_service: SequencerMidiOutput,
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
        self._next_render_event_subunit: int | None = None
        self._render_block_start_sample: int | None = None
        self._render_transport_events: list[RenderTransportEvent] = []

    def set_midi_input(self, midi_input_selector: str) -> None:
        with self._lock:
            self._midi_input_selector = midi_input_selector

    def configure(self, request: SessionSequencerConfigRequest) -> SessionSequencerStatus:
        with self._lock:
            previous_config = self._config
            next_config = compile_sequencer_runtime_config(
                request,
                controller_default_channels=self._controller_default_channels,
            )
            self._release_reconfigured_track_notes_locked(previous_config, next_config)
            self._config = next_config
            self._absolute_subunit = self._normalize_stopped_absolute_subunit_locked(self._absolute_subunit, next_config)
            self._apply_absolute_subunit_locked(next_config, self._absolute_subunit)
            self._reset_render_event_cursor_locked(next_config)
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
            self._reset_render_event_cursor_locked(config)

            self._stop_event.clear()
            self._running = True
            self._render_subunit_remainder = 0.0
            self._reset_render_event_cursor_locked(config)
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
            self._next_render_event_subunit = None
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

    def render_transport_state(self) -> tuple[int, bool]:
        with self._lock:
            return (self._visible_absolute_subunit_locked(), self._running)

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
            if not self._running:
                return config.timing.tempo_bpm

            self._render_block_start_sample = (
                None if block_start_sample is None else max(0, int(block_start_sample))
            )

            if self._render_subunit_remainder <= _RENDER_SUBUNIT_EPSILON:
                self._render_subunit_remainder = 0.0
                self._perform_render_block_events_locked(config, self._absolute_subunit)

            if sample_rate > 0 and ksmps > 0:
                block_seconds = float(ksmps) / float(sample_rate)
                subunit_duration = config.timing.transport_subunit_duration_seconds
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

            return config.timing.tempo_bpm

    def drain_render_transport_events(
        self,
        *,
        engine_sample_start: int,
        engine_sample_end: int,
    ) -> list[RenderTransportEvent]:
        with self._lock:
            lower = max(0, int(engine_sample_start))
            upper = max(lower, int(engine_sample_end))
            drained: list[RenderTransportEvent] = []
            retained: list[RenderTransportEvent] = []
            for event in self._render_transport_events:
                if lower <= event.engine_sample <= upper:
                    drained.append(event)
                else:
                    retained.append(event)
            self._render_transport_events = retained
            return drained

    def _emit_render_transport_event_locked(
        self,
        kind: Literal["step", "pad_switches", "loop", "stopped"],
        payload: dict[str, Any],
    ) -> None:
        if self._clock_mode != "render_driven" or self._render_block_start_sample is None:
            event_type = "sequencer_step" if kind == "step" else "sequencer_pad_switches"
            if kind in {"step", "pad_switches"}:
                self._publish_event(event_type, payload)
            return
        self._render_transport_events.append(
            RenderTransportEvent(
                engine_sample=self._render_block_start_sample,
                kind=kind,
                payload=payload,
            )
        )

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
                    [self._note_on_message(track.midi_channel, note, step_state.velocity) for note in notes],
                    source_context=self._source_context_for_track(track),
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

    def _reset_render_event_cursor_locked(self, config: SequencerRuntimeConfig) -> None:
        if self._clock_mode != "render_driven":
            self._next_render_event_subunit = None
            return
        if self._absolute_subunit >= config.playback_end_subunit and not config.playback_loop:
            self._next_render_event_subunit = None
            return
        self._next_render_event_subunit = self._next_event_subunit_locked(config, self._absolute_subunit)

    def _advance_render_to_event_locked(
        self,
        config: SequencerRuntimeConfig,
        next_subunit: int,
    ) -> None:
        transport_subunit = self._absolute_subunit
        if next_subunit <= transport_subunit:
            return
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        current_visible_step = transport_subunit // _TRANSPORT_SUBUNITS_PER_STEP

        if config.playback_loop and next_subunit >= config.playback_end_subunit:
            loop_from_subunit = config.playback_end_subunit
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
            self._emit_render_transport_event_locked(
                "loop",
                {
                    "previous_transport_subunit": loop_from_subunit,
                    "transport_subunit": self._absolute_subunit,
                },
            )
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
                self._emit_render_transport_event_locked(
                    "stopped",
                    {"transport_subunit": self._absolute_subunit},
                )
                self._send_all_notes_off_locked()
                for notes in self._active_notes.values():
                    notes.clear()
            else:
                self._absolute_subunit = next_subunit

        next_visible_step = self._absolute_subunit // _TRANSPORT_SUBUNITS_PER_STEP
        if next_visible_step != current_visible_step and not switch_payloads:
            self._emit_render_transport_event_locked(
                "step",
                self._sequencer_step_event_payload_locked(config, previous_step=current_visible_step),
            )
        if switch_payloads:
            self._emit_render_transport_event_locked(
                "pad_switches",
                self._sequencer_pad_switches_event_payload_locked(config, switch_payloads),
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

        for track_id in config.sync_master_track_ids:
            track = config.tracks.get(track_id)
            if track is not None and self._track_at_sync_boundary_locked(track, next_subunit):
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
        self._reset_render_event_cursor_locked(config)
        return self._status_locked()

    def _seek_transport_cycle_locked(self, direction: int) -> SessionSequencerStatus:
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
        pad_switches_payload: dict[str, Any] | None = None
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
                        source_context=self._source_context_for_track(track),
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
            # The batched pad event carries the same shared transport delta,
            # so avoid a second WebSocket submission at that same boundary.
            publish_step_event = next_visible_step != current_visible_step and not switch_payloads

            if publish_step_event:
                step_payload = self._sequencer_step_event_payload_locked(config, previous_step=current_visible_step)
            else:
                step_payload: dict[str, Any] = {}
            if switch_payloads:
                pad_switches_payload = self._sequencer_pad_switches_event_payload_locked(config, switch_payloads)

        if publish_step_event:
            self._publish_event("sequencer_step", step_payload)
        if pad_switches_payload is not None:
            self._publish_event("sequencer_pad_switches", pad_switches_payload)
        return next_wait_subunits * config.timing.transport_subunit_duration_seconds

    def _sequencer_step_event_payload_locked(
        self,
        config: SequencerRuntimeConfig,
        *,
        previous_step: int,
    ) -> dict[str, Any]:
        return {
            "previous_step": previous_step % max(1, config.step_count),
            **self._sequencer_runtime_delta_payload_locked(config),
        }

    def _sequencer_runtime_delta_payload_locked(self, config: SequencerRuntimeConfig) -> dict[str, Any]:
        """Build the WebSocket transport delta without constructing Pydantic status models."""
        visible_absolute_subunit = self._visible_absolute_subunit_locked()
        current_step, cycle = self._transport_position_locked(config, visible_absolute_subunit)
        return {
            "current_step": current_step,
            "cycle": cycle,
            "running": self._running,
            "step_count": max(1, config.step_count),
            "transport_subunit": visible_absolute_subunit,
            "tracks": [
                {
                    "track_id": track.track_id,
                    "local_step": self._local_step_for(track, visible_absolute_subunit),
                }
                for track in config.tracks.values()
            ],
            "controller_tracks": [
                {
                    "track_id": track.track_id,
                    "runtime_pad_start_subunit": track.phase_offset_subunit if track.enabled else None,
                }
                for track in config.controller_tracks.values()
            ],
        }

    def _sequencer_pad_switches_event_payload_locked(
        self,
        config: SequencerRuntimeConfig,
        payloads: list[dict[str, str | int | float | bool | None]],
    ) -> dict[str, Any]:
        """Publish one shared delta for every pad that switched at this boundary."""
        visible_absolute_subunit = self._visible_absolute_subunit_locked()
        switches: list[dict[str, Any]] = []
        for payload in payloads:
            track_id = payload.get("track_id")
            if not isinstance(track_id, str):
                continue

            note_track = config.tracks.get(track_id)
            if note_track is not None:
                switches.append(
                    {
                        "track_id": note_track.track_id,
                        "track_kind": "note",
                        "active_pad": note_track.active_pad,
                        "local_step": self._local_step_for(note_track, visible_absolute_subunit),
                        "queued_pad": note_track.queued_pad,
                        "pad_loop_position": note_track.pad_loop_position,
                        "enabled": note_track.enabled,
                        "queued_enabled": note_track.queued_enabled,
                        "runtime_pad_start_subunit": (
                            note_track.phase_offset_subunit if note_track.enabled else None
                        ),
                    }
                )
                continue

            controller_track = config.controller_tracks.get(track_id)
            if controller_track is not None:
                switches.append(
                    {
                        "track_id": controller_track.track_id,
                        "track_kind": "controller",
                        "active_pad": controller_track.active_pad,
                        "queued_pad": controller_track.queued_pad,
                        "pad_loop_position": controller_track.pad_loop_position,
                        "enabled": controller_track.enabled,
                        "runtime_pad_start_subunit": (
                            controller_track.phase_offset_subunit if controller_track.enabled else None
                        ),
                    }
                )

        return {
            "switches": switches,
            **self._sequencer_runtime_delta_payload_locked(config),
        }

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
        source_context: MidiSourceContext | None = None,
    ) -> None:
        try:
            contextual_send = getattr(self._midi_service, "send_scheduled_message_with_context", None)
            if callable(contextual_send) and source_context is not None:
                contextual_send(
                    self._midi_input_selector,
                    message,
                    delivery_delay_seconds=delivery_delay_seconds,
                    source_context=source_context,
                )
                return
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
        source_context: MidiSourceContext | None = None,
    ) -> None:
        if not messages:
            return
        try:
            contextual_send_many = getattr(self._midi_service, "send_scheduled_messages_with_context", None)
            contextual_send_one = getattr(self._midi_service, "send_scheduled_message_with_context", None)
            if source_context is not None and len(messages) > 1 and callable(contextual_send_many):
                contextual_send_many(
                    self._midi_input_selector,
                    messages,
                    delivery_delay_seconds=delivery_delay_seconds,
                    source_context=source_context,
                )
                return
            if source_context is not None and len(messages) == 1 and callable(contextual_send_one):
                contextual_send_one(
                    self._midi_input_selector,
                    messages[0],
                    delivery_delay_seconds=delivery_delay_seconds,
                    source_context=source_context,
                )
                return
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
            self._config = compile_sequencer_runtime_config(
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
                ),
                controller_default_channels=self._controller_default_channels,
            )
            self._active_notes = {track_id: set() for track_id in self._config.tracks}
        return self._config

    @staticmethod
    def _source_context_for_track(track: SequencerTrackRuntime) -> MidiSourceContext | None:
        pad = track.pads.get(track.active_pad)
        scale_root = pad.scale_root if pad and pad.scale_root is not None else track.scale_root
        mode = pad.mode if pad and pad.mode is not None else track.mode
        if scale_root is None and mode is None:
            return None
        return MidiSourceContext(
            source_id=track.track_id,
            scale_root=scale_root,  # type: ignore[arg-type]
            mode=mode,  # type: ignore[arg-type]
        )
