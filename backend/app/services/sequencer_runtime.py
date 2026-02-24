from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from backend.app.models.session import (
    SessionSequencerConfigRequest,
    SessionSequencerStepConfig,
    SessionSequencerStatus,
    SessionSequencerTrackStatus,
)
from backend.app.services.midi_service import MidiService

logger = logging.getLogger(__name__)

PublishEventFn = Callable[[str, dict[str, str | int | float | bool | None]], None]

_DEFAULT_PADS = 8
_MAX_STEPS = 32
_SCHEDULER_SLEEP_S = 0.001
_SCHEDULER_SPIN_THRESHOLD_S = 0.0008


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
class SequencerTrackRuntime:
    track_id: str
    midi_channel: int
    step_count: int
    velocity: int
    gate_ratio: float
    enabled: bool
    queued_enabled: bool | None
    pads: dict[int, tuple[SequencerStepRuntime, ...]] = field(default_factory=dict)
    active_pad: int = 0
    queued_pad: int | None = None
    pad_loop_enabled: bool = False
    pad_loop_repeat: bool = True
    pad_loop_sequence: tuple[int, ...] = ()
    pad_loop_position: int | None = None


@dataclass(slots=True)
class SequencerRuntimeConfig:
    bpm: int
    step_count: int
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
        self._current_step = 0
        self._cycle = 0
        self._active_notes: dict[str, set[int]] = {}

    def set_midi_input(self, midi_input_selector: str) -> None:
        with self._lock:
            self._midi_input_selector = midi_input_selector

    def configure(self, request: SessionSequencerConfigRequest) -> SessionSequencerStatus:
        with self._lock:
            previous_config = self._config
            next_config = self._build_runtime_config(request)
            self._restore_pad_loop_runtime_state_locked(previous_config, next_config)
            self._release_reconfigured_track_notes_locked(previous_config, next_config)
            self._config = next_config
            self._current_step = self._current_step % self._config.step_count
            next_active_notes: dict[str, set[int]] = {}
            for track_id in self._config.tracks:
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
                track.queued_pad = None
                self._current_step = 0

            return self._status_locked()

    def start(self) -> SessionSequencerStatus:
        with self._lock:
            config = self._ensure_config()
            if self._running:
                return self._status_locked()

            for track in config.tracks.values():
                self._reset_pad_loop_for_start_locked(track)

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
                self._current_step = 0
                return self._status_locked()

            self._running = False
            self._stop_event.set()
            thread = self._thread

        if thread and thread.is_alive():
            thread.join(timeout=1.0)

        with self._lock:
            self._thread = None
            self._current_step = 0
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
                current_step = self._current_step
                step_duration = 60.0 / float(config.bpm) / 4.0

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
    def _pad_loop_config_matches(a: SequencerTrackRuntime, b: SequencerTrackRuntime) -> bool:
        return (
            a.pad_loop_enabled == b.pad_loop_enabled
            and a.pad_loop_repeat == b.pad_loop_repeat
            and a.pad_loop_sequence == b.pad_loop_sequence
        )

    @staticmethod
    def _pad_loop_position_for_active_pad(track: SequencerTrackRuntime) -> int | None:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            return None
        for index, pad_index in enumerate(track.pad_loop_sequence):
            if pad_index == track.active_pad:
                return index
        return None

    def _initialize_pad_loop_state_locked(self, track: SequencerTrackRuntime) -> None:
        track.pad_loop_position = self._pad_loop_position_for_active_pad(track)

    def _reset_pad_loop_for_start_locked(self, track: SequencerTrackRuntime) -> None:
        if not track.pad_loop_enabled or not track.pad_loop_sequence:
            track.pad_loop_position = None
            return

        first_pad = track.pad_loop_sequence[0]
        if first_pad in track.pads:
            track.active_pad = first_pad
        track.pad_loop_position = 0

        if track.queued_pad == track.active_pad:
            track.queued_pad = None

    def _restore_pad_loop_runtime_state_locked(
        self,
        previous_config: SequencerRuntimeConfig | None,
        next_config: SequencerRuntimeConfig,
    ) -> None:
        for track_id, next_track in next_config.tracks.items():
            previous_track = previous_config.tracks.get(track_id) if previous_config else None
            if previous_track and self._pad_loop_config_matches(previous_track, next_track):
                previous_position = previous_track.pad_loop_position
                if previous_position is not None and 0 <= previous_position < len(next_track.pad_loop_sequence):
                    next_track.pad_loop_position = previous_position
                    continue
            self._initialize_pad_loop_state_locked(next_track)

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

        if (
            current_position < 0
            or current_position >= len(sequence)
            or sequence[current_position] != track.active_pad
        ):
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

    def _perform_step(
        self,
        config: SequencerRuntimeConfig,
        step_index: int,
    ) -> None:
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        running_track_count = 0
        next_step = 0

        with self._lock:
            for track_id, track in config.tracks.items():
                pad_steps = track.pads.get(track.active_pad)
                active_notes = self._active_notes.setdefault(track_id, set())
                if not track.enabled or not pad_steps:
                    self._release_track_notes_locked(track_id, track.midi_channel)
                    continue
                running_track_count += 1
                local_step = step_index % track.step_count
                step_state = pad_steps[local_step]
                notes = step_state.notes
                if notes:
                    # Any non-rest step starts a new note event, so release currently held notes first.
                    self._release_track_notes_locked(track_id, track.midi_channel)
                    # Send chord tones as one batch to minimize inter-note skew within the step tick.
                    self._send_messages_locked(
                        [self._note_on_message(track.midi_channel, note, step_state.velocity) for note in notes]
                    )
                    for note in notes:
                        active_notes.add(note)
                elif not step_state.hold:
                    self._release_track_notes_locked(track_id, track.midi_channel)

            next_step = (self._current_step + 1) % config.step_count
            if next_step == 0:
                self._cycle += 1

            for track_id, track in config.tracks.items():
                local_boundary_reached = (next_step % track.step_count) == 0
                manual_pad_switch_applied = False
                track_started_on_boundary = False

                if track.queued_enabled is not None:
                    if track.queued_enabled:
                        # Newly armed tracks are aligned to shared step-1 boundaries
                        # while others are running. If no track is running, they arm now.
                        if self._can_start_track_on_boundary_locked(config, track_id, next_step):
                            self._reset_pad_loop_for_start_locked(track)
                            track.enabled = True
                            track.queued_enabled = None
                            track_started_on_boundary = True
                    elif not track.enabled:
                        track.queued_enabled = None
                    elif local_boundary_reached:
                        track.enabled = False
                        track.queued_enabled = None
                        self._release_track_notes_locked(track_id, track.midi_channel)

                if local_boundary_reached and track.queued_pad is not None and track.queued_pad != track.active_pad:
                    track.active_pad = track.queued_pad
                    track.queued_pad = None
                    manual_pad_switch_applied = True
                    switch_payloads.append(
                        {
                            "track_id": track.track_id,
                            "active_pad": track.active_pad,
                            "cycle": self._cycle,
                        }
                    )

                if local_boundary_reached and track.enabled and not track_started_on_boundary:
                    next_pad_from_loop, stop_track_on_loop_end = self._pad_loop_boundary_action_locked(
                        track,
                        manual_switch_applied=manual_pad_switch_applied,
                    )
                    if stop_track_on_loop_end:
                        track.enabled = False
                        track.queued_enabled = None
                        track.queued_pad = None
                        self._release_track_notes_locked(track_id, track.midi_channel)
                    elif next_pad_from_loop is not None and next_pad_from_loop != track.active_pad:
                        track.active_pad = next_pad_from_loop
                        track.queued_pad = None
                        switch_payloads.append(
                            {
                                "track_id": track.track_id,
                                "active_pad": track.active_pad,
                                "cycle": self._cycle,
                            }
                        )

            self._current_step = next_step
            self._refresh_transport_step_count_locked(config)
            if self._current_step >= config.step_count:
                self._current_step = self._current_step % config.step_count

            step_payload: dict[str, str | int | float | bool | None] = {
                "step": step_index,
                "next_step": self._current_step,
                "cycle": self._cycle,
                "track_count": running_track_count,
            }

        self._publish_event("sequencer_step", step_payload)
        for payload in switch_payloads:
            self._publish_event("sequencer_pad_switched", payload)

    def _send_note_on_locked(self, track: SequencerTrackRuntime, note: int, velocity: int) -> None:
        self._send_message_locked(self._note_on_message(track.midi_channel, note, velocity))

    def _send_note_off_locked(self, midi_channel: int, note: int) -> None:
        self._send_message_locked(self._note_off_message(midi_channel, note))

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
                or not next_track.enabled
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
            self._midi_service.send_messages(self._midi_input_selector, messages)
        except Exception as exc:  # pragma: no cover - runtime dependent
            logger.warning("Sequencer MIDI batch failed: %s", exc)

    def _status_locked(self) -> SessionSequencerStatus:
        config = self._config
        if config is None:
            return SessionSequencerStatus(
                session_id=self._session_id,
                running=False,
                bpm=120,
                step_count=16,
                current_step=0,
                cycle=0,
                tracks=[],
            )

        tracks = [
            SessionSequencerTrackStatus(
                track_id=track.track_id,
                midi_channel=track.midi_channel,
                step_count=16 if track.step_count == 16 else 32,
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
            bpm=config.bpm,
            step_count=16 if config.step_count == 16 else 32,
            current_step=self._current_step,
            cycle=self._cycle,
            tracks=tracks,
        )

    def _ensure_config(self) -> SequencerRuntimeConfig:
        if self._config is None:
            self._config = self._build_runtime_config(SessionSequencerConfigRequest(tracks=[
                {
                    "track_id": "voice-1",
                    "midi_channel": 1,
                    "pads": [{"pad_index": 0, "steps": [None] * 16}],
                }
            ]))
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
            pad_index = int(entry)
            if 0 <= pad_index < _DEFAULT_PADS:
                normalized.append(pad_index)
        return tuple(normalized)

    @staticmethod
    def _transport_step_count(tracks: list[SequencerTrackRuntime]) -> int:
        enabled_counts = [track.step_count for track in tracks if track.enabled]
        if not enabled_counts:
            return 16

        loop = enabled_counts[0]
        for step_count in enabled_counts[1:]:
            loop = math.lcm(loop, step_count)
        return 16 if loop <= 16 else 32

    @staticmethod
    def _can_start_track_on_boundary_locked(
        config: SequencerRuntimeConfig,
        track_id: str,
        next_step: int,
    ) -> bool:
        for candidate in config.tracks.values():
            if candidate.track_id == track_id or not candidate.enabled:
                continue
            if (next_step % candidate.step_count) != 0:
                return False
        return True

    @staticmethod
    def _refresh_transport_step_count_locked(config: SequencerRuntimeConfig) -> None:
        config.step_count = SessionSequencerRuntime._transport_step_count(list(config.tracks.values()))

    def _build_runtime_config(self, request: SessionSequencerConfigRequest) -> SequencerRuntimeConfig:
        tracks: dict[str, SequencerTrackRuntime] = {}
        for track_request in request.tracks:
            track_step_count = 16 if track_request.step_count == 16 else 32
            pads: dict[int, tuple[SequencerStepRuntime, ...]] = {
                index: tuple(SequencerStepRuntime(notes=(), hold=False) for _ in range(track_step_count))
                for index in range(_DEFAULT_PADS)
            }

            for pad in track_request.pads:
                pads[pad.pad_index] = self._normalize_steps(
                    pad.steps,
                    track_step_count,
                    track_request.velocity,
                )

            active_pad = track_request.active_pad if track_request.active_pad in pads else 0
            queued_pad = track_request.queued_pad if track_request.queued_pad in pads else None

            tracks[track_request.track_id] = SequencerTrackRuntime(
                track_id=track_request.track_id,
                midi_channel=track_request.midi_channel,
                step_count=track_step_count,
                velocity=track_request.velocity,
                gate_ratio=track_request.gate_ratio,
                enabled=track_request.enabled,
                queued_enabled=track_request.queued_enabled,
                pads=pads,
                active_pad=active_pad,
                queued_pad=queued_pad,
                pad_loop_enabled=track_request.pad_loop_enabled,
                pad_loop_repeat=track_request.pad_loop_repeat,
                pad_loop_sequence=self._normalize_pad_loop_sequence(track_request.pad_loop_sequence),
            )

        config = SequencerRuntimeConfig(
            bpm=request.bpm,
            step_count=16 if request.step_count == 16 else 32,
            tracks=tracks,
        )
        self._refresh_transport_step_count_locked(config)
        return config
