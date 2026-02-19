from __future__ import annotations

import heapq
import logging
import math
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from backend.app.models.session import (
    SessionSequencerConfigRequest,
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
class SequencerTrackRuntime:
    track_id: str
    midi_channel: int
    step_count: int
    velocity: int
    gate_ratio: float
    enabled: bool
    queued_enabled: bool | None
    pads: dict[int, tuple[tuple[int, ...], ...]] = field(default_factory=dict)
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
            self._config = self._build_runtime_config(request)
            self._current_step = self._current_step % self._config.step_count
            next_active_notes: dict[str, set[int]] = {}
            for track_id in self._config.tracks:
                next_active_notes[track_id] = self._active_notes.get(track_id, set())
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
        note_off_heap: list[tuple[float, str, int, int]] = []
        next_step_time = time.perf_counter() + 0.01

        while not self._stop_event.is_set():
            now = time.perf_counter()
            self._flush_due_note_off(now, note_off_heap)

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

            self._perform_step(config, current_step, next_step_time, step_duration, note_off_heap)
            next_step_time += step_duration

            if next_step_time < now - (step_duration * 2.0):
                next_step_time = now + step_duration

        self._flush_due_note_off(time.perf_counter() + 1.0, note_off_heap)
        with self._lock:
            self._send_all_notes_off_locked()
            for notes in self._active_notes.values():
                notes.clear()

    def _perform_step(
        self,
        config: SequencerRuntimeConfig,
        step_index: int,
        step_start: float,
        step_duration: float,
        note_off_heap: list[tuple[float, str, int, int]],
    ) -> None:
        switch_payloads: list[dict[str, str | int | float | bool | None]] = []
        running_track_count = 0
        next_step = 0

        with self._lock:
            for track_id, track in config.tracks.items():
                pad_steps = track.pads.get(track.active_pad)
                if not track.enabled or not pad_steps:
                    continue
                running_track_count += 1
                local_step = step_index % track.step_count
                notes = pad_steps[local_step]
                if not notes:
                    continue

                for note in notes:
                    self._send_note_on_locked(track, note)
                    self._active_notes.setdefault(track_id, set()).add(note)
                    note_off_at = step_start + max(0.005, step_duration * track.gate_ratio)
                    heapq.heappush(note_off_heap, (note_off_at, track_id, track.midi_channel, note))

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

    def _flush_due_note_off(
        self,
        now: float,
        note_off_heap: list[tuple[float, str, int, int]],
    ) -> None:
        due: list[tuple[str, int, int]] = []
        while note_off_heap and note_off_heap[0][0] <= now:
            _, track_id, midi_channel, note = heapq.heappop(note_off_heap)
            due.append((track_id, midi_channel, note))

        if not due:
            return

        with self._lock:
            for track_id, midi_channel, note in due:
                self._send_note_off_locked(midi_channel, note)
                active_notes = self._active_notes.get(track_id)
                if active_notes is not None:
                    active_notes.discard(note)

    def _send_note_on_locked(self, track: SequencerTrackRuntime, note: int) -> None:
        channel_byte = (track.midi_channel - 1) & 0x0F
        message = [0x90 + channel_byte, _clamp_midi_note(note), track.velocity]
        self._send_message_locked(message)

    def _send_note_off_locked(self, midi_channel: int, note: int) -> None:
        channel_byte = (midi_channel - 1) & 0x0F
        message = [0x80 + channel_byte, _clamp_midi_note(note), 0]
        self._send_message_locked(message)

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
    def _normalize_steps(raw_steps: list[int | list[int] | None], step_count: int) -> tuple[tuple[int, ...], ...]:
        padded = raw_steps[:step_count] + [None] * max(0, step_count - len(raw_steps))
        normalized = [_normalize_step_notes(entry) for entry in padded]
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
            pads: dict[int, tuple[tuple[int, ...], ...]] = {
                index: tuple(() for _ in range(track_step_count))
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
