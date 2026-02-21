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
            self._ensure_config()
            if self._running:
                return self._status_locked()

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
                    for note in notes:
                        self._send_note_on_locked(track, note)
                        active_notes.add(note)
                elif not step_state.hold:
                    self._release_track_notes_locked(track_id, track.midi_channel)

            next_step = (self._current_step + 1) % config.step_count
            if next_step == 0:
                self._cycle += 1

            for track_id, track in config.tracks.items():
                local_boundary_reached = (next_step % track.step_count) == 0

                if track.queued_enabled is not None:
                    if track.queued_enabled:
                        # Newly armed tracks are aligned to shared step-1 boundaries
                        # while others are running. If no track is running, they arm now.
                        if self._can_start_track_on_boundary_locked(config, track_id, next_step):
                            track.enabled = True
                            track.queued_enabled = None
                    elif not track.enabled:
                        track.queued_enabled = None
                    elif local_boundary_reached:
                        track.enabled = False
                        track.queued_enabled = None
                        self._release_track_notes_locked(track_id, track.midi_channel)

                if local_boundary_reached and track.queued_pad is not None and track.queued_pad != track.active_pad:
                    track.active_pad = track.queued_pad
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

    def _send_note_on_locked(self, track: SequencerTrackRuntime, note: int) -> None:
        channel_byte = (track.midi_channel - 1) & 0x0F
        message = [0x90 + channel_byte, _clamp_midi_note(note), track.velocity]
        self._send_message_locked(message)

    def _send_note_off_locked(self, midi_channel: int, note: int) -> None:
        channel_byte = (midi_channel - 1) & 0x0F
        message = [0x80 + channel_byte, _clamp_midi_note(note), 0]
        self._send_message_locked(message)

    def _release_track_notes_locked(self, track_id: str, midi_channel: int) -> None:
        active_notes = self._active_notes.get(track_id)
        if not active_notes:
            return

        for note in sorted(active_notes):
            self._send_note_off_locked(midi_channel, note)
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
            self._send_message_locked([0xB0 + channel_byte, 123, 0])
            self._send_message_locked([0xB0 + channel_byte, 120, 0])

    def _send_message_locked(self, message: list[int]) -> None:
        try:
            self._midi_service.send_message(self._midi_input_selector, message)
        except Exception as exc:  # pragma: no cover - runtime dependent
            logger.warning("Sequencer MIDI message failed: %s", exc)

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
    def _normalize_step(value: int | list[int] | SessionSequencerStepConfig | None) -> SequencerStepRuntime:
        if isinstance(value, SessionSequencerStepConfig):
            return SequencerStepRuntime(
                notes=_normalize_step_notes(value.note),
                hold=bool(value.hold),
            )
        return SequencerStepRuntime(notes=_normalize_step_notes(value), hold=False)

    @staticmethod
    def _normalize_steps(
        raw_steps: list[int | list[int] | SessionSequencerStepConfig | None],
        step_count: int,
    ) -> tuple[SequencerStepRuntime, ...]:
        padded = raw_steps[:step_count] + [None] * max(0, step_count - len(raw_steps))
        normalized = [SessionSequencerRuntime._normalize_step(entry) for entry in padded]
        return tuple(normalized[:_MAX_STEPS])

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
                pads[pad.pad_index] = self._normalize_steps(pad.steps, track_step_count)

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
            )

        config = SequencerRuntimeConfig(
            bpm=request.bpm,
            step_count=16 if request.step_count == 16 else 32,
            tracks=tracks,
        )
        self._refresh_transport_step_count_locked(config)
        return config
