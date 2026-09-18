from __future__ import annotations

from dataclasses import dataclass, field
from collections import deque
import random
import heapq
import math
from fractions import Fraction
import threading
from typing import Any, Callable, Iterable, Protocol

from backend.app.models.session import (
    ArpeggiatorCommand,
    SessionAuditionRequest,
    ArpeggiatorPadConfig,
    SessionArpeggiatorConfig,
    SessionArpeggiatorStatus,
    SequencerMode,
    SequencerScaleRoot,
)
from backend.app.services.sequencer_runtime_models import RenderTransportEvent
from backend.app.engine.lane_output import LaneOutputGate, lane_id
from backend.app.services.preview_commands import PreviewCommands


class TimestampedMidiEnqueue(Protocol):
    def __call__(
        self,
        message: list[int],
        *,
        source: str,
        target_engine_sample: int | None = None,
        delivery_delay_seconds: float | None = None,
        source_timestamp_ns: int | None = None,
        mapped_backend_monotonic_ns: int | None = None,
        sync_stale: bool = False,
    ) -> bool: ...


@dataclass(frozen=True, slots=True)
class MidiSourceContext:
    source_id: str | None = None
    scale_root: SequencerScaleRoot | None = None
    mode: SequencerMode | None = None


@dataclass(slots=True)
class HeldNote:
    note: int
    velocity: int
    order: int
    source_context: MidiSourceContext | None = None


@dataclass(order=True, slots=True)
class PendingInputEvent:
    target_sample: int
    sequence: int
    arpeggiator_id: str = field(compare=False)
    message: tuple[int, int, int] = field(compare=False)
    source_context: MidiSourceContext | None = field(default=None, compare=False)


@dataclass(slots=True)
class ArpeggiatorRuntimeState:
    config: SessionArpeggiatorConfig
    preview: dict[str, Any] | None = None
    audition_sequence: tuple[int, ...] = ()
    audition_origin: Fraction = Fraction(0)
    audition_pending: tuple[str, tuple[int, ...], Fraction] | None = None
    audition_stopped: bool = False
    held_notes: dict[int, HeldNote] = field(default_factory=dict)
    physical_notes: dict[tuple[str, int], HeldNote] = field(default_factory=dict)
    active_notes: dict[int, int] = field(default_factory=dict)
    voice_ends: dict[int, int] = field(default_factory=dict)
    voice_sources: dict[int, str] = field(default_factory=dict)
    outputs: list[tuple[int, int, int, int, int]] = field(default_factory=list)
    step_index: int = 0
    note_index: int = 0
    phrase_offset: int = 0
    displayed_step: int = 0
    held_order_sequence: int = 0
    last_velocity: int | None = None
    active_pad: int = 0
    queued_pad: int | None = None
    queued_beat: Fraction | None = None
    manual_override: bool = False
    pad_loop_position: int | None = None
    anchor_beat: Fraction | None = None
    boundary_beat: Fraction | None = None
    paused: bool = False
    last_restart: int = -1
    last_notes: list[int] = field(default_factory=list)

    @property
    def pad(self) -> ArpeggiatorPadConfig:
        return self.config.pads[self.active_pad]


_ROOT_PITCH_CLASS: dict[str, int] = {
    "C": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
}

_MODE_INTERVALS: dict[str, tuple[int, ...]] = {
    "ionian": (0, 2, 4, 5, 7, 9, 11),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "aeolian": (0, 2, 3, 5, 7, 8, 10),
    "locrian": (0, 1, 3, 5, 6, 8, 10),
}

_RATE_BEATS: dict[str, float] = {
    "1/1": 4.0,
    "1/2": 2.0,
    "1/4": 1.0,
    "1/8": 0.5,
    "1/16": 0.25,
    "1/32": 0.125,
    "1/8T": 1.0 / 3.0,
    "1/16T": 1.0 / 6.0,
    "1/8D": 0.75,
    "1/16D": 0.375,
}


def _clamp_midi_note(value: int) -> int:
    return max(0, min(127, int(value)))


def _clamp_midi_velocity(value: int) -> int:
    return max(0, min(127, int(value)))


def _midi_channel(message: tuple[int, int, int] | list[int]) -> int:
    return (int(message[0]) & 0x0F) + 1


def _note_on_message(midi_channel: int, note: int, velocity: int) -> list[int]:
    return [0x90 + ((midi_channel - 1) & 0x0F), _clamp_midi_note(note), _clamp_midi_velocity(velocity)]


def _note_off_message(midi_channel: int, note: int) -> list[int]:
    return [0x80 + ((midi_channel - 1) & 0x0F), _clamp_midi_note(note), 0]


class PerformanceMidiRouter:
    """One event scheduler for live rendering and offline MIDI capture.

    Musical positions use rational beats; only the final conversion rounds to samples.
    Inputs, pad boundaries, transport changes, attacks and releases share one timeline.
    """

    def __init__(self, *, enqueue_timestamped_midi: TimestampedMidiEnqueue,
                 current_engine_sample: Callable[[], int], output_name: str = "engine:internal",
                 max_pending_inputs: int = 16_384,
                 max_future_samples: int | Callable[[], int] | None = None,
                 collect_status_events: bool = False) -> None:
        self._enqueue_timestamped_midi = enqueue_timestamped_midi
        self._current_engine_sample = current_engine_sample
        self._output_name = output_name
        self._max_pending_inputs = max(1, max_pending_inputs)
        self._max_future_samples = max_future_samples
        self._lock = threading.RLock()
        self._states: dict[str, ArpeggiatorRuntimeState] = {}
        self._preview_commands = PreviewCommands()
        self.lane_output: LaneOutputGate | None = None
        self._input_channel_to_id: dict[int, str] = {}
        self._pending_inputs: list[PendingInputEvent] = []
        self._transport_events: list[tuple[int, int, Fraction, bool, bool]] = []
        self._sequence = 0
        self._tempo_bpm = 120
        self._sample_rate = 48_000
        self._anchor_sample = 0
        self._anchor_beat = Fraction(0)
        self._arranger_running = False
        self._arranger_intent = False
        self._bar_beats = 4
        self._sample = 0
        self._collect_status_events = collect_status_events
        self._status_events: deque[RenderTransportEvent] = deque(maxlen=4096)
        self._last_status_payload: dict | None = None
        self._status_dirty = True

    @property
    def output_name(self) -> str:
        return self._output_name

    @property
    def arranger_running(self) -> bool:
        return self._arranger_intent

    def _beat(self, sample: int) -> Fraction:
        return self._anchor_beat + Fraction((sample - self._anchor_sample) * self._tempo_bpm, self._sample_rate * 60)

    def _sample_for(self, beat: Fraction) -> int:
        return self._anchor_sample + round((beat - self._anchor_beat) * self._sample_rate * 60 / self._tempo_bpm)

    @staticmethod
    def _rate(pad: ArpeggiatorPadConfig) -> Fraction:
        return Fraction(_RATE_BEATS[pad.rate]).limit_denominator(96)

    def _step_beat(self, state: ArpeggiatorRuntimeState, index: int | None = None) -> Fraction:
        index = state.step_index if index is None else index
        swing = Fraction(str(state.pad.swing)) / 2 if index % 2 else Fraction(0)
        return (state.anchor_beat or Fraction(0)) + self._rate(state.pad) * (index + swing)

    def _index_at_or_after(self, state: ArpeggiatorRuntimeState, beat: Fraction) -> int:
        index = max(0, math.floor((beat - (state.anchor_beat or Fraction(0))) / self._rate(state.pad)))
        while self._step_beat(state, index) < beat:
            index += 1
        return index

    def configure(self, configs: Iterable[SessionArpeggiatorConfig], *, tempo_bpm: int) -> None:
        configs = list(configs)
        channels = [config.input_channel for config in configs]
        if len(channels) != len(set(channels)) or any(c.target_channel in channels for c in configs):
            raise ValueError("Arpeggiators require unique inputs and cannot target another arpeggiator input.")
        with self._lock:
            if self.lane_output:
                self.lane_output.configure_arpeggiators(configs)
            self._status_dirty = True
            self._set_tempo(tempo_bpm, self._current_engine_sample())
            new_states = {}
            for config in configs:
                state = self._states.get(config.arpeggiator_id)
                if state is None:
                    state = ArpeggiatorRuntimeState(config=config, active_pad=config.active_pad)
                    if config.playback_mode == "arranger" and self._arranger_running:
                        self._locate(state, self._beat(self._sample), reset=True)
                else:
                    old = state.config
                    reset = (old.input_channel, old.target_channel, old.playback_mode, old.processing_mode) != (
                        config.input_channel, config.target_channel, config.playback_mode, config.processing_mode)
                    if reset or not config.enabled and not state.audition_sequence:
                        self._clear(state, self._current_engine_sample())
                    if not config.enabled and not state.audition_sequence:
                        state.anchor_beat = None
                        state.step_index = state.note_index = state.phrase_offset = 0
                    state.config = config
                    if reset or old.active_pad != config.active_pad and not self._running(state):
                        state.active_pad = config.active_pad
                        state.anchor_beat = None
                    if old.hold_mode != config.hold_mode:
                        state.held_notes = {note.note: note for note in state.physical_notes.values()}
                    if old.pads[state.active_pad].rate != state.pad.rate and state.anchor_beat is not None:
                        phrase_position = state.step_index - state.phrase_offset
                        state.step_index = self._index_at_or_after(state, self._beat(self._sample))
                        state.phrase_offset = state.step_index - phrase_position
                    if self._running(state) and state.anchor_beat is not None:
                        # Rate edits retain the current musical position; do not replay past steps.
                        while self._step_beat(state) < self._beat(self._sample):
                            state.step_index += 1
                    if (old.pad_loop_sequence != config.pad_loop_sequence or old.pad_loop_enabled != config.pad_loop_enabled
                            or [p.length_beats for p in old.pads] != [p.length_beats for p in config.pads]):
                        state.boundary_beat = self._beat(self._sample)
                new_states[config.arpeggiator_id] = state
            for key, state in self._states.items():
                if key not in new_states:
                    self._clear(state, self._current_engine_sample())
            self._states = new_states
            self._preview_commands.retain(new_states)
            self._input_channel_to_id = {c.input_channel: c.arpeggiator_id for c in configs}
            self._pending_inputs = [e for e in self._pending_inputs if e.arpeggiator_id in new_states]
            heapq.heapify(self._pending_inputs)

    def _set_tempo(self, tempo: int, sample: int) -> None:
        tempo = max(1, int(tempo))
        if tempo != self._tempo_bpm:
            self._anchor_beat = self._beat(sample)
            self._anchor_sample = sample
            self._tempo_bpm = tempo

    def set_transport(self, *, beat: Fraction | float, running: bool, sample: int | None = None,
                      reset: bool = True, bar_beats: int | None = None) -> None:
        with self._lock:
            self._arranger_intent = running
            if bar_beats is not None:
                self._bar_beats = max(1, bar_beats)
            self._sequence += 1
            heapq.heappush(self._transport_events, (
                self._current_engine_sample() if sample is None else sample, self._sequence,
                Fraction(beat).limit_denominator(3_360_000), running, reset,
            ))

    def transport_discontinuity(self, beat: float, *, stopped: bool = False, sample: int | None = None) -> None:
        self.set_transport(beat=beat, running=self._arranger_intent and not stopped, sample=sample)

    def _apply_transport(self, sample: int, beat: Fraction, running: bool, reset: bool) -> None:
        delta = beat - self._beat(sample)
        self._anchor_sample, self._anchor_beat = sample, beat
        was_running = self._arranger_running
        self._arranger_running = running
        for state in self._states.values():
            if state.config.playback_mode == "live":
                if state.anchor_beat is not None:
                    state.anchor_beat += delta
                if state.queued_beat is not None:
                    state.queued_beat += delta
                continue
            if was_running and not running:
                state.preview = None
                state.audition_sequence = ()
                state.audition_pending = None
                state.audition_stopped = False
            if state.audition_pending and reset:
                action, sequence, _ = state.audition_pending
                state.audition_pending = (action, sequence, beat)
                self._apply_audition(state, beat, sample)
                continue
            if state.audition_sequence and reset:
                if state.preview:
                    state.preview["fields"]["audition_origin"] = beat
                    state.preview["fields"]["anchor_beat"] = None
                state.audition_origin = beat
                state.anchor_beat = None
                self._locate(state, beat, reset=True)
                continue
            if reset or was_running != running:
                self._release(state, sample)
                state.queued_pad = state.queued_beat = None
                state.manual_override = False
                if not running:
                    self._clear(state, sample)
                    state.anchor_beat = None
                else:
                    self._locate(state, beat, reset=True)

    def audition_status(self):
        return {key: {"active": bool(state.audition_sequence), "queued": state.audition_pending[0] if state.audition_pending else None}
                | ({"preview_gesture": state.preview["gesture"], "preview_revision": state.preview["revision"], "preview_active": state.preview.get("applied", False)} if state.preview else {})
                for key, state in self._states.items() if state.audition_sequence or state.audition_pending}

    def audition(self, request: SessionAuditionRequest, *, transport_running: bool | None = None) -> None:
        with self._lock:
            state = self._states.get(request.arpeggiator_id)
            if state is None or state.config.playback_mode != "arranger":
                raise ValueError("Definition audition requires an Arranger arpeggiator.")
            if any(token >= len(state.config.pads) for token in request.sequence):
                raise ValueError("Audition pad is not configured.")
            sample = self._current_engine_sample()
            beat = self._beat(sample)
            if request.action.startswith("preview_"):
                self._preview(state, request, beat, sample)
                return
            state.preview = None
            if request.action == "cancel":
                state.audition_pending = None
            else:
                boundary = state.boundary_beat
                if boundary is None or boundary <= beat:
                    length = Fraction(state.pad.length_beats)
                    anchor = state.anchor_beat if state.anchor_beat is not None else Fraction(0)
                    boundary = anchor + ((beat - anchor) // length + 1) * length
                running = self._arranger_intent or bool(state.audition_sequence) if transport_running is None else transport_running
                immediate = request.action == "stop" or not running
                state.audition_pending = (request.action, tuple(request.sequence), beat if immediate else boundary)
                if immediate:
                    self._apply_audition(state, beat, sample)
            self._status_dirty = True

    def _preview(self, state, request, beat, sample):
        if not self._preview_commands.accept([request.arpeggiator_id], request):
            return
        if request.action == "preview_start":
            if state.preview is None:
                state.preview = {"running": self._running(state), "applied": False, "fields": {key: getattr(state, key) for key in (
                    "audition_sequence", "audition_origin", "audition_pending", "audition_stopped",
                    "manual_override", "active_pad", "anchor_beat", "queued_pad", "queued_beat")}}
            state.preview["gesture"] = request.gesture_id
            state.preview["revision"] = request.revision
            boundary = state.boundary_beat
            if boundary is None or boundary <= beat:
                length = Fraction(state.pad.length_beats)
                anchor = state.anchor_beat if state.anchor_beat is not None else Fraction(0)
                boundary = anchor + ((beat - anchor) // length + 1) * length
            state.audition_pending = ("start", tuple(request.sequence), boundary if self._arranger_intent else beat)
            self._apply_audition(state, beat, sample)
        elif state.preview and state.preview["gesture"] == request.gesture_id:
            snapshot, state.preview = state.preview, None
            if not snapshot["applied"]:
                state.audition_pending = snapshot["fields"]["audition_pending"]
                self._status_dirty = True
                return
            self._release(state, sample)
            for key, value in snapshot["fields"].items():
                setattr(state, key, value)
            state.step_index = state.note_index = state.phrase_offset = 0
            self._locate(state, beat, reset=True)
            if state.anchor_beat is not None:
                state.step_index = self._index_at_or_after(state, beat)
            if not snapshot["running"]:
                state.audition_stopped = True
            if state.audition_pending and state.audition_pending[2] <= beat:
                self._apply_audition(state, beat, sample)
        self._status_dirty = True

    def _apply_audition(self, state, beat, sample):
        pending = state.audition_pending
        if not pending or beat < pending[2]:
            return
        action, sequence, at = pending
        if action == "start" and state.preview:
            state.preview["applied"] = True
        state.audition_pending = None
        state.audition_sequence = sequence if action == "start" else ()
        state.audition_stopped = action == "stop"
        state.audition_origin = at
        state.manual_override = False
        state.anchor_beat = None
        state.step_index = state.note_index = state.phrase_offset = 0
        self._release(state, sample)
        self._locate(state, at, reset=True)

    def clear_auditions(self, *, stop: bool = False):
        with self._lock:
            beat = self._beat(self._sample)
            for state in self._states.values():
                state.preview = None
                if state.audition_sequence or state.audition_pending:
                    state.audition_pending = ("stop" if stop else "return", (), beat)
                    self._apply_audition(state, beat, self._sample)
                if not stop:
                    state.audition_stopped = False
            self._status_dirty = True

    def command(self, arpeggiator_id: str, command: ArpeggiatorCommand) -> None:
        with self._lock:
            self._status_dirty = True
            state = self._states.get(arpeggiator_id)
            if state is None:
                raise ValueError("Arpeggiator does not exist")
            sample = self._current_engine_sample()
            beat = self._beat(sample)
            if command.command == "clear":
                self._clear(state, sample)
            elif command.command == "cancel":
                state.queued_pad = state.queued_beat = None
            elif command.command == "arrangement":
                state.manual_override = False
                state.queued_pad = state.queued_beat = None
                self._release(state, sample)
                self._locate(state, beat, reset=True)
            elif not self._running(state) or state.anchor_beat is None:
                state.active_pad = int(command.pad_index or 0)
                state.manual_override = True
                state.step_index = state.note_index = state.phrase_offset = 0
                state.anchor_beat = None
            else:
                state.queued_pad = command.pad_index
                if state.config.launch_quantize == "bar":
                    state.queued_beat = Fraction((beat // self._bar_beats + 1) * self._bar_beats)
                else:
                    cycle = self._rate(state.pad) * len(state.pad.steps)
                    state.queued_beat = state.anchor_beat + ((beat - state.anchor_beat) // cycle + 1) * cycle

    def _running(self, state: ArpeggiatorRuntimeState) -> bool:
        return not state.audition_stopped and (bool(state.audition_sequence) or state.config.enabled and (state.config.playback_mode == "live" or self._arranger_running))

    def _locate(self, state: ArpeggiatorRuntimeState, beat: Fraction, *, reset: bool = False) -> None:
        config = state.config
        if not state.audition_sequence and (not config.pad_loop_enabled or state.manual_override or config.playback_mode == "live"):
            state.boundary_beat = None
            state.paused = False
            if state.anchor_beat is None:
                state.anchor_beat = beat if config.playback_mode == "live" else Fraction(0)
            return
        origin = state.audition_origin if state.audition_sequence else Fraction(0)
        position = max(Fraction(0), beat - origin)
        sequence = state.audition_sequence or config.pad_loop_sequence or [config.active_pad]
        lengths = [Fraction(config.pads[t].length_beats if t >= 0 else -t) for t in sequence]
        total = sum(lengths, Fraction(0))
        if not state.audition_sequence and not config.pad_loop_repeat and position >= total:
            state.paused = True
            state.boundary_beat = None
            self._release(state, self._sample)
            return
        cycle_start = (position // total) * total
        local = position - cycle_start
        start = origin + cycle_start
        index = 0
        for index, length in enumerate(lengths):
            if local < length:
                break
            local -= length
            start += length
        token = sequence[index]
        state.pad_loop_position = index
        state.boundary_beat = start + lengths[index]
        was_paused = state.paused
        state.paused = token < 0
        if state.paused:
            self._release(state, self._sample)
            return
        if reset or token != state.active_pad or state.anchor_beat is None:
            self._release(state, self._sample)
            state.active_pad = token
            # Adjacent occurrences of a pad form one continuous musical phrase.
            run_start = start
            previous = index - 1
            while previous >= 0 and sequence[previous] == token:
                run_start -= lengths[previous]
                previous -= 1
            if all(t == token for t in sequence):
                run_start = origin
            state.anchor_beat = run_start
            state.step_index = self._index_at_or_after(state, beat)
            state.phrase_offset = 0
            state.last_restart = -1
            if config.restart_mode in {"beat", "bar"}:
                interval = self._bar_beats if config.restart_mode == "bar" else 1
                previous = self._step_beat(state, max(0, state.step_index - 1))
                restart_beat = max(run_start, (previous // interval) * interval)
                state.phrase_offset = max(0, math.ceil((restart_beat - run_start) / self._rate(state.pad)))
                state.last_restart = int(previous // interval)
            state.note_index = self._note_cursor_before(state, state.step_index - state.phrase_offset)
        elif was_paused:
            state.step_index = max(state.step_index, self._index_at_or_after(state, beat))
            state.note_index = self._note_cursor_before(state, state.step_index - state.phrase_offset)

    def send_scheduled_message(self, _selector: str, message: list[int], *, delivery_delay_seconds: float | None) -> str:
        self.route_message(message, source="sequencer", delivery_delay_seconds=delivery_delay_seconds)
        return self._output_name

    def send_scheduled_messages(self, _selector: str, messages: list[list[int]], *, delivery_delay_seconds: float | None) -> str:
        for message in messages:
            self.send_scheduled_message(_selector, message, delivery_delay_seconds=delivery_delay_seconds)
        return self._output_name

    def send_scheduled_message_with_context(self, _selector: str, message: list[int], *,
            delivery_delay_seconds: float | None, source_context: MidiSourceContext | None) -> str:
        self.route_message(message, source="sequencer", delivery_delay_seconds=delivery_delay_seconds, source_context=source_context)
        return self._output_name

    def send_scheduled_messages_with_context(self, _selector: str, messages: list[list[int]], *,
            delivery_delay_seconds: float | None, source_context: MidiSourceContext | None) -> str:
        for message in messages:
            self.send_scheduled_message_with_context(_selector, message, delivery_delay_seconds=delivery_delay_seconds,
                                                     source_context=source_context)
        return self._output_name

    def route_message(self, message: list[int], *, source: str, target_engine_sample: int | None = None,
            delivery_delay_seconds: float | None = None, source_timestamp_ns: int | None = None,
            mapped_backend_monotonic_ns: int | None = None, sync_stale: bool = False,
            source_context: MidiSourceContext | None = None) -> bool:
        if len(message) != 3:
            return False
        normalized = tuple(int(v) & 0xFF for v in message)
        with self._lock:
            key = self._input_channel_to_id.get(_midi_channel(normalized))
            if key is not None:
                sample = target_engine_sample
                if sample is None:
                    sample = self._current_engine_sample() + round(max(0, delivery_delay_seconds or 0) * self._sample_rate)
                horizon = self._max_future_sample_horizon()
                if len(self._pending_inputs) >= self._max_pending_inputs or (
                    horizon is not None and sample > self._current_engine_sample() + horizon
                ):
                    return False
                self._sequence += 1
                context = source_context or MidiSourceContext(source_id=source)
                heapq.heappush(self._pending_inputs, PendingInputEvent(max(0, sample), self._sequence, key, normalized, context))
                return True
        return self._enqueue_timestamped_midi(list(normalized), source=f"lane:{source_context.source_id}" if source_context and source_context.source_id else source, target_engine_sample=target_engine_sample,
            delivery_delay_seconds=delivery_delay_seconds, source_timestamp_ns=source_timestamp_ns,
            mapped_backend_monotonic_ns=mapped_backend_monotonic_ns, sync_stale=sync_stale)

    def _max_future_sample_horizon(self) -> int | None:
        value = self._max_future_samples
        return None if value is None else max(0, int(value() if callable(value) else value))

    def discard_future_lane_inputs(self, identities: list[str]) -> None:
        with self._lock:
            now = self._current_engine_sample()
            self._pending_inputs = [event for event in self._pending_inputs
                if event.target_sample <= now or not event.source_context or event.source_context.source_id not in identities]
            heapq.heapify(self._pending_inputs)

    def _inputs(self, sample: int) -> None:
        groups: dict[str, list[PendingInputEvent]] = {}
        while self._pending_inputs and self._pending_inputs[0].target_sample <= sample:
            event = heapq.heappop(self._pending_inputs)
            groups.setdefault(event.arpeggiator_id, []).append(event)
        for key, events in groups.items():
            state = self._states.get(key)
            if state is None or not state.config.enabled:
                continue
            first_note = False
            # Release the old chord before replacing it. A new note's attack and
            # release can share one sample; retain their order to avoid latching it.
            def input_order(event: PendingInputEvent):
                status = event.message[0] & 0xf0
                source = event.source_context.source_id if event.source_context else "input"
                was_held = (source or "input", event.message[1]) in state.physical_notes
                is_release = status == 0x80 or status == 0x90 and event.message[2] == 0
                priority = 0 if is_release and was_held else 1
                return event.target_sample, priority, event.sequence

            events.sort(key=input_order)
            replace_on_attack = False
            for event in events:
                context = event.source_context
                source = f"lane:{context.source_id}" if context and context.source_id and context.source_id not in {"input", "manual", "host"} else "input"
                if self.lane_output and not self.lane_output.allows(source, event.message, stage=f"input:{key}"):
                    continue
                status, note, velocity = event.message[0] & 0xf0, event.message[1], event.message[2]
                source = event.source_context.source_id if event.source_context else "input"
                physical_key = (source or "input", note)
                if status == 0xb0 and note in {120, 123}:
                    self._clear(state, sample)
                    continue
                is_on = status == 0x90 and velocity > 0
                is_off = status == 0x80 or status == 0x90 and velocity == 0
                if is_off:
                    state.physical_notes.pop(physical_key, None)
                    if not state.physical_notes:
                        replace_on_attack = True
                elif is_on:
                    if not state.physical_notes:
                        replace_on_attack = True
                        first_note = True
                    if state.config.hold_mode == "replace" and replace_on_attack:
                        state.held_notes.clear()
                        replace_on_attack = False
                    state.held_order_sequence += 1
                    held = HeldNote(note, velocity, state.held_order_sequence, event.source_context)
                    state.physical_notes[physical_key] = held
                    if state.config.hold_mode == "toggle" and note in state.held_notes:
                        state.held_notes.pop(note)
                    else:
                        state.held_notes[note] = held
                if state.config.processing_mode == "bypass" and self._running(state):
                    if is_on:
                        self._attack(state, note, velocity, sample, None)
                    elif is_off:
                        self._off(state, note, sample)
                    elif status == 0xb0:
                        self._emit([0xb0 + state.config.target_channel - 1, note, velocity], sample, state)
            if state.config.hold_mode == "off":
                state.held_notes = {entry.note: entry for entry in state.physical_notes.values()}
            if not state.held_notes and state.config.processing_mode != "bypass":
                self._release(state, sample)
            if state.held_notes and self._running(state):
                beat = self._beat(sample)
                if state.anchor_beat is None:
                    state.anchor_beat = beat if state.config.playback_mode == "live" else Fraction(0)
                    state.step_index = self._index_at_or_after(state, beat)
                if first_note and state.config.restart_mode == "first_note":
                    state.note_index = 0
                    state.phrase_offset = state.step_index

    def advance_render_block(self, *, block_start_sample: int, block_end_sample: int,
                             sample_rate: int, tempo_bpm: int | None = None) -> None:
        with self._lock:
            if sample_rate != self._sample_rate:
                self._anchor_beat = self._beat(block_start_sample)
                self._anchor_sample = block_start_sample
                self._sample_rate = max(1, sample_rate)
            if tempo_bpm is not None:
                self._set_tempo(tempo_bpm, block_start_sample)
            self._sample = block_start_sample
            if self._status_dirty:
                self._record_status(block_start_sample)
            while True:
                candidates = [block_end_sample]
                if self._pending_inputs:
                    candidates.append(max(block_start_sample, self._pending_inputs[0].target_sample))
                if self._transport_events:
                    candidates.append(max(block_start_sample, self._transport_events[0][0]))
                for state in self._states.values():
                    if state.audition_pending:
                        candidates.append(max(self._sample, self._sample_for(state.audition_pending[2])))
                    if state.outputs:
                        candidates.append(max(block_start_sample, state.outputs[0][0]))
                    if not self._running(state):
                        continue
                    if state.config.playback_mode == "arranger" and state.anchor_beat is None:
                        self._locate(state, self._beat(self._sample), reset=True)
                    if state.boundary_beat is not None and not state.manual_override:
                        candidates.append(max(self._sample, self._sample_for(state.boundary_beat)))
                    if state.queued_beat is not None:
                        candidates.append(max(self._sample, self._sample_for(state.queued_beat)))
                    if state.anchor_beat is not None and not state.paused:
                        candidates.append(max(self._sample, self._sample_for(self._step_beat(state))))
                sample = min(candidates)
                if sample >= block_end_sample:
                    break
                self._sample = sample
                while self._transport_events and self._transport_events[0][0] <= sample:
                    _, _, beat, running, reset = heapq.heappop(self._transport_events)
                    self._apply_transport(sample, beat, running, reset)
                self._inputs(sample)
                beat = self._beat(sample)
                for state in self._states.values():
                    self._apply_audition(state, beat, sample)
                    if self._running(state):
                        if state.queued_beat is not None and self._sample_for(state.queued_beat) <= sample:
                            self._release(state, sample)
                            state.active_pad = int(state.queued_pad or 0)
                            state.anchor_beat = state.queued_beat
                            state.step_index = state.note_index = state.phrase_offset = 0
                            state.queued_pad = state.queued_beat = None
                            state.manual_override = True
                            state.paused = False
                        if state.boundary_beat is not None and not state.manual_override and self._sample_for(state.boundary_beat) <= sample:
                            self._locate(state, state.boundary_beat)
                        if state.anchor_beat is not None and not state.paused and self._sample_for(self._step_beat(state)) <= sample:
                            self._step(state, sample)
                    self._outputs(state, sample)
                self._record_status(sample)
            self._sample = block_end_sample

    def lane_output_changed(self) -> None:
        with self._lock:
            self._record_status(self._current_engine_sample())

    def _record_status(self, sample: int) -> None:
        self._status_dirty = False
        if not self._collect_status_events:
            return
        payload = {"arpeggiators": [status.model_dump(mode="json") for status in self.status()], "auditions": self.audition_status()}
        if self.lane_output:
            payload["lane_output"] = self.lane_output.status()
        if payload != self._last_status_payload:
            self._status_events.append(RenderTransportEvent(engine_sample=sample, kind="arpeggiators", payload=payload))
            self._last_status_payload = payload

    def drain_render_status_events(self) -> list[RenderTransportEvent]:
        with self._lock:
            events = list(self._status_events)
            self._status_events.clear()
            return events

    def _rng(self, state: ArpeggiatorRuntimeState, index: int, salt: int = 0) -> random.Random:
        pad = state.pad
        # Stable integer mixing, independent of device iteration order and Python hash randomization.
        position = index if pad.random_mode == "evolve" else index % len(pad.steps)
        return random.Random((pad.random_seed * 1_000_003 + position * 97_409 + salt * 65_537) & 0xffffffffffffffff)

    def _note_cursor_before(self, state: ArpeggiatorRuntimeState, count: int) -> int:
        pad = state.pad
        def advances(index: int) -> bool:
            step = pad.steps[(index + pad.rotation) % len(pad.steps)]
            if step.kind == "tie":
                return False
            return pad.advance_rests or step.kind != "rest" and self._rng(state, index).random() < pad.probability * step.probability
        if pad.random_mode == "repeat":
            cycles, remainder = divmod(count, len(pad.steps))
            return cycles * sum(advances(i) for i in range(len(pad.steps))) + sum(advances(i) for i in range(remainder))
        return sum(advances(i) for i in range(count))

    def _held_source_blocked(self, held: HeldNote) -> bool:
        return bool(self.lane_output and held.source_context and held.source_context.source_id
                    and lane_id(held.source_context.source_id) in self.lane_output.blocked)

    def _held_pool(self, state: ArpeggiatorRuntimeState) -> list[HeldNote]:
        held_pool = []
        for held in sorted(state.held_notes.values(), key=lambda n: (n.note, n.order)):
            if self._held_source_blocked(held):
                replacement = next((candidate for candidate in state.physical_notes.values()
                                    if candidate.note == held.note and not self._held_source_blocked(candidate)), None)
                if replacement is None:
                    continue
                held = replacement
            held_pool.append(held)
        return held_pool

    def _pool(self, state: ArpeggiatorRuntimeState) -> list[HeldNote]:
        pool: dict[int, HeldNote] = {}
        held_pool = self._held_pool(state)
        for octave in range(state.pad.octaves):
            for held in held_pool:
                note = held.note + octave * 12
                if note <= 127:
                    pool.setdefault(note, HeldNote(note, held.velocity, held.order + octave * 1_000_000, held.source_context))
        return sorted(pool.values(), key=lambda n: n.note)

    @staticmethod
    def _order(notes: list[HeldNote], pattern: str, rng: random.Random) -> list[HeldNote]:
        ascending = sorted(notes, key=lambda n: n.note)
        if pattern == "down":
            return ascending[::-1]
        if pattern == "up_down":
            return ascending + ascending[-2:0:-1]
        if pattern == "down_up":
            return ascending[::-1] + ascending[1:-1]
        if pattern == "as_played":
            return sorted(notes, key=lambda n: n.order)
        if pattern == "random":
            rng.shuffle(ascending)
        elif pattern == "inside_out":
            center = (len(ascending) - 1) / 2
            ascending = [ascending[i] for i in sorted(range(len(ascending)), key=lambda i: (abs(i-center), i))]
        elif pattern == "outside_in":
            ascending = [ascending[i] for i in sorted(range(len(ascending)), key=lambda i: (min(i, len(ascending)-1-i), i))]
        return ascending

    def _select(self, state: ArpeggiatorRuntimeState, kind: str, position: int, index: int) -> list[HeldNote]:
        pool = self._pool(state)
        if not pool:
            return []
        if kind == "position":
            return [pool[(position - 1) % len(pool)]]
        if kind == "chord" or state.pad.pattern == "chord":
            return pool
        if state.pad.octave_traversal == "octave":
            ordered = []
            base = self._held_pool(state)
            for octave in range(state.pad.octaves):
                ordered.extend(self._order([HeldNote(n.note + octave * 12, n.velocity, n.order, n.source_context)
                                            for n in base if n.note + octave * 12 <= 127], state.pad.pattern, self._rng(state, index, 1)))
        else:
            ordered = self._order(pool, state.pad.pattern, self._rng(state, index, 1))
        if state.pad.pattern == "random":
            return [self._rng(state, index - index % state.pad.repeats, 1).choice(pool)]
        return [ordered[(state.note_index // state.pad.repeats) % len(ordered)]] if ordered else []

    @staticmethod
    def _note_scale(state: ArpeggiatorRuntimeState, held: HeldNote) -> tuple[SequencerScaleRoot, SequencerMode] | None:
        if state.pad.scale_mode == "off":
            return None
        context = held.source_context if state.pad.scale_mode == "source" else None
        root = context.scale_root if context and context.scale_root else state.pad.scale_root
        mode = context.mode if context and context.mode else state.pad.mode
        return root, mode

    def _output_note(self, state: ArpeggiatorRuntimeState, held: HeldNote) -> int:
        note = _clamp_midi_note(held.note + state.pad.transpose)
        scale = self._note_scale(state, held)
        return self._quantize_note_to_scale(note, *scale) if scale else note

    def _preview_degree(self, state: ArpeggiatorRuntimeState, held: HeldNote, note: int) -> int | None:
        scale = self._note_scale(state, held)
        if scale is None:
            return None
        root, mode = scale
        interval = (note - _ROOT_PITCH_CLASS[root]) % 12
        intervals = _MODE_INTERVALS[mode]
        return intervals.index(interval) + 1 if interval in intervals else None

    def _step(self, state: ArpeggiatorRuntimeState, sample: int) -> None:
        pad, index = state.pad, state.step_index
        if state.config.restart_mode in {"beat", "bar"}:
            interval = self._bar_beats if state.config.restart_mode == "bar" else 1
            restart = int(self._step_beat(state) // interval)
            if restart != state.last_restart:
                state.note_index = 0
                state.phrase_offset = index
                state.last_restart = restart
        phrase_index = index - state.phrase_offset
        step = pad.steps[(phrase_index + pad.rotation) % len(pad.steps)]
        state.displayed_step = (phrase_index + pad.rotation) % len(pad.steps)
        next_sample = self._sample_for(self._step_beat(state, index + 1))
        interval_samples = max(1, next_sample - sample)
        hit = step.kind not in {"rest", "tie"} and self._rng(state, phrase_index).random() < pad.probability * step.probability
        if self._running(state) and state.config.processing_mode == "active" and state.held_notes:
            if step.kind == "tie":
                for note in state.last_notes:
                    voice = state.active_notes.get(note)
                    if voice is not None:
                        end = next_sample + self._tie_extension(state, index + 1)
                        state.voice_ends[voice] = end
                        heapq.heappush(state.outputs, (end, 0, note, 0, voice))
            elif hit:
                selected = self._select(state, step.kind, step.note_position, phrase_index)
                state.last_notes = []
                for note_index, held in enumerate(selected):
                    note = self._output_note(state, held)
                    if note in state.last_notes:
                        continue
                    state.last_notes.append(note)
                    rng = self._rng(state, phrase_index, 10 + note_index)
                    base = rng.randint(1, pad.fixed_velocity) if pad.velocity_mode == "random" else pad.fixed_velocity if pad.velocity_mode in {"fixed", "accent"} else held.velocity
                    velocity = max(1, min(127, round(base * step.velocity / 100) + rng.randint(-pad.humanize_velocity, pad.humanize_velocity)))
                    for strike in range(step.ratchets):
                        strike_start = sample + round(interval_samples * strike / step.ratchets)
                        strike_end = sample + round(interval_samples * (strike + 1) / step.ratchets)
                        start = strike_start
                        jitter = min(round(pad.humanize_ms * self._sample_rate / 1000), max(0, interval_samples // step.ratchets - 1))
                        start = max(strike_start, min(strike_end - 1, start + rng.randint(-jitter, jitter)))
                        duration = max(1, round(interval_samples / step.ratchets * (step.gate_ratio or pad.gate_ratio)))
                        end = start + duration
                        if strike == step.ratchets - 1:
                            end = max(end, next_sample + self._tie_extension(state, index + 1)) if self._tie_extension(state, index + 1) else end
                        self._sequence += 1
                        voice = self._sequence
                        if held.source_context and held.source_context.source_id:
                            state.voice_sources[voice] = held.source_context.source_id
                        heapq.heappush(state.outputs, (start, 1, note, velocity, voice))
                        heapq.heappush(state.outputs, (end, 0, note, 0, voice))
                        state.voice_ends[voice] = end
        if step.kind != "tie" and (hit or pad.advance_rests):
            state.note_index += 1
        state.step_index += 1

    def _tie_extension(self, state: ArpeggiatorRuntimeState, index: int) -> int:
        # Look ahead through one bounded rhythm cycle so a short gate can lead into a tie.
        pad = state.pad
        count = 0
        while count < len(pad.steps) and pad.steps[(index - state.phrase_offset + count + pad.rotation) % len(pad.steps)].kind == "tie":
            count += 1
        return max(0, self._sample_for(self._step_beat(state, index + count)) - self._sample_for(self._step_beat(state, index)))

    def _attack(self, state: ArpeggiatorRuntimeState, note: int, velocity: int, sample: int, voice: int | None) -> None:
        self._off(state, note, sample)
        if voice is None:
            self._sequence += 1
            voice = self._sequence
        state.active_notes[note] = voice
        state.last_velocity = velocity
        self._emit(_note_on_message(state.config.target_channel, note, velocity), sample, state)

    def _off(self, state: ArpeggiatorRuntimeState, note: int, sample: int) -> None:
        voice = state.active_notes.pop(note, None)
        if voice is not None:
            state.voice_ends.pop(voice, None)
            state.voice_sources.pop(voice, None)
            self._emit(_note_off_message(state.config.target_channel, note), sample, state)

    def _outputs(self, state: ArpeggiatorRuntimeState, sample: int) -> None:
        while state.outputs and state.outputs[0][0] <= sample:
            at, kind, note, velocity, voice = heapq.heappop(state.outputs)
            if kind:
                source = state.voice_sources.get(voice)
                if self.lane_output and source and lane_id(source) in self.lane_output.blocked:
                    state.voice_ends.pop(voice, None)
                    state.voice_sources.pop(voice, None)
                    continue
                self._attack(state, note, velocity, max(at, sample), voice)
            elif state.active_notes.get(note) == voice and state.voice_ends.get(voice) == at:
                self._off(state, note, max(at, sample))

    def _emit(self, message: list[int], sample: int, state: ArpeggiatorRuntimeState) -> None:
        self._enqueue_timestamped_midi(message, source=f"lane:{state.config.arpeggiator_id}" if state.config.playback_mode == "arranger" else "arpeggiator", target_engine_sample=max(0, sample))

    def _release(self, state: ArpeggiatorRuntimeState, sample: int) -> None:
        for note in list(state.active_notes):
            self._off(state, note, sample)
        state.outputs.clear()
        state.voice_ends.clear()
        state.voice_sources.clear()
        state.last_notes.clear()

    def _clear(self, state: ArpeggiatorRuntimeState, sample: int) -> None:
        self._release(state, sample)
        state.held_notes.clear()
        state.physical_notes.clear()
        state.queued_pad = state.queued_beat = None
        self._pending_inputs = [e for e in self._pending_inputs if e.arpeggiator_id != state.config.arpeggiator_id]
        heapq.heapify(self._pending_inputs)

    def status(self) -> list[SessionArpeggiatorStatus]:
        with self._lock:
            result = []
            for state in self._states.values():
                config = state.config
                label = "playing"
                if state.audition_stopped or not config.enabled and not state.audition_sequence:
                    label = "stopped"
                elif config.playback_mode == "arranger" and not self._arranger_running and not state.audition_sequence:
                    label = "waiting_arranger"
                elif config.processing_mode != "active":
                    label = "bypassed" if config.processing_mode == "bypass" else "muted"
                elif state.paused:
                    label = "pause"
                elif not state.held_notes:
                    label = "waiting_notes"
                scale = "off"
                if state.pad.scale_mode != "off":
                    context = next((n.source_context for n in state.held_notes.values() if n.source_context), None)
                    use_source = state.pad.scale_mode == "source" and context is not None
                    root = context.scale_root if use_source and context.scale_root else state.pad.scale_root
                    mode = context.mode if use_source and context.mode else state.pad.mode
                    scale = f"{root} {mode}"
                preview = []
                preview_degrees = []
                cursor = state.note_index
                state.note_index = 0
                for index, step in enumerate(state.pad.steps):
                    notes = [] if step.kind in {"rest", "tie"} else self._select(state, step.kind, step.note_position, index)
                    output_notes = [self._output_note(state, n) for n in notes]
                    preview.append(output_notes)
                    preview_degrees.append([self._preview_degree(state, held, note) for held, note in zip(notes, output_notes)])
                    if step.kind not in {"rest", "tie"} or state.pad.advance_rests:
                        state.note_index += 1
                state.note_index = cursor
                active = sorted(state.active_notes)
                result.append(SessionArpeggiatorStatus(arpeggiator_id=config.arpeggiator_id, enabled=config.enabled,
                    input_channel=config.input_channel, target_channel=config.target_channel,
                    held_notes=sorted(state.held_notes), active_note=active[0] if active else None,
                    active_notes=active, step_index=state.displayed_step, cycle=max(0, state.step_index - 1) // len(state.pad.steps),
                    last_velocity=state.last_velocity, active_pad=state.active_pad, queued_pad=state.queued_pad,
                    pad_loop_position=state.pad_loop_position, manual_override=state.manual_override, state=label,
                    effective_scale=scale, preview_notes=preview, preview_degrees=preview_degrees))
            return result

    def shutdown(self) -> None:
        with self._lock:
            for state in self._states.values():
                self._clear(state, self._current_engine_sample())
            self._pending_inputs.clear()
            self._transport_events.clear()

    def panic(self) -> None:
        self.shutdown()

    @staticmethod
    def _quantize_note_to_scale(note: int, root: SequencerScaleRoot, mode: SequencerMode) -> int:
        root_pc = _ROOT_PITCH_CLASS.get(root, 0)
        allowed = {(root_pc + interval) % 12 for interval in _MODE_INTERVALS.get(mode, _MODE_INTERVALS["aeolian"])}
        candidates = [n for n in range(max(0, note - 6), min(127, note + 6) + 1) if n % 12 in allowed]
        return min(candidates, key=lambda n: (abs(n - note), n)) if candidates else note
