from __future__ import annotations

import bisect
from dataclasses import dataclass, field
import random
import threading
from typing import Callable, Iterable, Protocol

from backend.app.models.session import (
    SessionArpeggiatorConfig,
    SessionArpeggiatorStatus,
    SequencerMode,
    SequencerScaleRoot,
)


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
    held_notes: dict[int, HeldNote] = field(default_factory=dict)
    active_note: int | None = None
    active_notes: set[int] = field(default_factory=set)
    active_note_off_sample: int | None = None
    next_step_sample: int | None = None
    step_index: int = 0
    held_order_sequence: int = 0
    last_velocity: int | None = None


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


def _all_notes_off_messages(midi_channel: int) -> list[list[int]]:
    channel_byte = (midi_channel - 1) & 0x0F
    return [[0xB0 + channel_byte, 123, 0], [0xB0 + channel_byte, 120, 0]]


class PerformanceMidiRouter:
    def __init__(
        self,
        *,
        enqueue_timestamped_midi: TimestampedMidiEnqueue,
        current_engine_sample: Callable[[], int],
        output_name: str = "engine:internal",
        max_pending_inputs: int = 16_384,
        max_future_samples: int | Callable[[], int] | None = None,
    ) -> None:
        self._enqueue_timestamped_midi = enqueue_timestamped_midi
        self._current_engine_sample = current_engine_sample
        self._output_name = output_name
        self._max_pending_inputs = max(1, int(max_pending_inputs))
        self._max_future_samples = max_future_samples
        self._lock = threading.RLock()
        self._states: dict[str, ArpeggiatorRuntimeState] = {}
        self._state_order: list[str] = []
        self._input_channel_to_id: dict[int, str] = {}
        self._pending_inputs: list[PendingInputEvent] = []
        self._pending_sequence = 0
        self._rng = random.Random(0xA67E)
        self._tempo_bpm = 120

    @property
    def output_name(self) -> str:
        return self._output_name

    def configure(self, configs: Iterable[SessionArpeggiatorConfig], *, tempo_bpm: int) -> None:
        with self._lock:
            self._tempo_bpm = max(1, int(tempo_bpm))
            previous_states = self._states
            next_states: dict[str, ArpeggiatorRuntimeState] = {}
            next_order: list[str] = []
            input_channels: dict[int, str] = {}
            input_channel_set: set[int] = set()

            for config in configs:
                if config.input_channel in input_channel_set:
                    raise ValueError(f"Arpeggiator input channel '{config.input_channel}' is assigned more than once.")
                input_channel_set.add(config.input_channel)

            for config in configs:
                if config.target_channel in input_channel_set:
                    raise ValueError(
                        f"Arpeggiator '{config.arpeggiator_id}' target_channel cannot target another arpeggiator input."
                    )

                previous = previous_states.get(config.arpeggiator_id)
                if previous is None:
                    state = ArpeggiatorRuntimeState(config=config)
                else:
                    state = previous
                    if (
                        previous.config.enabled
                        and (
                            not config.enabled
                            or previous.config.target_channel != config.target_channel
                            or previous.config.input_channel != config.input_channel
                        )
                    ):
                        self._release_active_note_locked(previous, self._current_engine_sample())
                    state.config = config
                    if not config.enabled:
                        state.held_notes.clear()
                        state.next_step_sample = None
                        state.step_index = 0
                next_states[config.arpeggiator_id] = state
                next_order.append(config.arpeggiator_id)
                input_channels[config.input_channel] = config.arpeggiator_id

            for previous_id, previous in previous_states.items():
                if previous_id not in next_states:
                    self._release_active_note_locked(previous, self._current_engine_sample())

            self._states = next_states
            self._state_order = next_order
            self._input_channel_to_id = input_channels
            self._pending_inputs = [
                event for event in self._pending_inputs if event.arpeggiator_id in self._states
            ]

    def send_scheduled_message(
        self,
        _selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        self.route_message(
            message,
            source="sequencer",
            delivery_delay_seconds=delivery_delay_seconds,
        )
        return self._output_name

    def send_scheduled_messages(
        self,
        _selector: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        for message in messages:
            self.route_message(
                message,
                source="sequencer",
                delivery_delay_seconds=delivery_delay_seconds,
            )
        return self._output_name

    def send_scheduled_message_with_context(
        self,
        _selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None,
        source_context: MidiSourceContext | None,
    ) -> str:
        self.route_message(
            message,
            source="sequencer",
            delivery_delay_seconds=delivery_delay_seconds,
            source_context=source_context,
        )
        return self._output_name

    def send_scheduled_messages_with_context(
        self,
        _selector: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
        source_context: MidiSourceContext | None,
    ) -> str:
        for message in messages:
            self.route_message(
                message,
                source="sequencer",
                delivery_delay_seconds=delivery_delay_seconds,
                source_context=source_context,
            )
        return self._output_name

    def route_message(
        self,
        message: list[int],
        *,
        source: str,
        target_engine_sample: int | None = None,
        delivery_delay_seconds: float | None = None,
        source_timestamp_ns: int | None = None,
        mapped_backend_monotonic_ns: int | None = None,
        sync_stale: bool = False,
        source_context: MidiSourceContext | None = None,
    ) -> bool:
        if len(message) != 3:
            return False
        normalized = tuple(int(value) & 0xFF for value in message)
        channel = _midi_channel(normalized)
        with self._lock:
            arpeggiator_id = self._input_channel_to_id.get(channel)
            if arpeggiator_id is not None:
                state = self._states.get(arpeggiator_id)
                if state is None:
                    return True
                if state.config.enabled:
                    event_sample = (
                        max(0, int(target_engine_sample))
                        if target_engine_sample is not None
                        else max(0, int(self._current_engine_sample()))
                    )
                    if len(self._pending_inputs) >= self._max_pending_inputs:
                        return False
                    max_future_samples = self._max_future_sample_horizon()
                    if max_future_samples is not None:
                        current_sample = max(0, int(self._current_engine_sample()))
                        if event_sample > current_sample + max_future_samples:
                            return False
                    self._pending_sequence += 1
                    bisect.insort(
                        self._pending_inputs,
                        PendingInputEvent(
                            target_sample=event_sample,
                            sequence=self._pending_sequence,
                            arpeggiator_id=arpeggiator_id,
                            message=normalized,
                            source_context=source_context,
                        )
                    )
                return True

        return self._enqueue_timestamped_midi(
            list(normalized),
            source=source,
            target_engine_sample=target_engine_sample,
            delivery_delay_seconds=delivery_delay_seconds,
            source_timestamp_ns=source_timestamp_ns,
            mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
            sync_stale=sync_stale,
        )

    def _max_future_sample_horizon(self) -> int | None:
        max_future_samples = self._max_future_samples
        if max_future_samples is None:
            return None
        if callable(max_future_samples):
            max_future_samples = max_future_samples()
        return max(0, int(max_future_samples))

    def advance_render_block(
        self,
        *,
        block_start_sample: int,
        block_end_sample: int,
        sample_rate: int,
        tempo_bpm: int | None = None,
    ) -> None:
        with self._lock:
            if tempo_bpm is not None:
                self._tempo_bpm = max(1, int(tempo_bpm))
            self._apply_pending_inputs_locked(block_start_sample)

            for state_id in list(self._state_order):
                state = self._states.get(state_id)
                if state is None or not state.config.enabled:
                    continue
                self._advance_state_locked(
                    state,
                    block_start_sample=max(0, int(block_start_sample)),
                    block_end_sample=max(0, int(block_end_sample)),
                    sample_rate=max(1, int(sample_rate)),
                )

    def status(self) -> list[SessionArpeggiatorStatus]:
        with self._lock:
            return [
                SessionArpeggiatorStatus(
                    arpeggiator_id=state.config.arpeggiator_id,
                    enabled=state.config.enabled,
                    input_channel=state.config.input_channel,
                    target_channel=state.config.target_channel,
                    held_notes=sorted(state.held_notes),
                    active_note=state.active_note,
                    step_index=state.step_index,
                    last_velocity=state.last_velocity,
                )
                for state_id in self._state_order
                if (state := self._states.get(state_id)) is not None
            ]

    def shutdown(self) -> None:
        with self._lock:
            sample = self._current_engine_sample()
            for state in self._states.values():
                self._release_active_note_locked(state, sample)
                state.held_notes.clear()
                state.next_step_sample = None
            self._pending_inputs.clear()

    def _apply_pending_inputs_locked(self, block_start_sample: int) -> None:
        due: list[PendingInputEvent] = []
        pending: list[PendingInputEvent] = []
        for event in self._pending_inputs:
            if event.target_sample <= block_start_sample:
                due.append(event)
            else:
                pending.append(event)
        self._pending_inputs = pending

        for event in due:
            state = self._states.get(event.arpeggiator_id)
            if state is None or not state.config.enabled:
                continue
            self._apply_input_message_locked(state, event.message, event.target_sample, event.source_context)

    def _apply_input_message_locked(
        self,
        state: ArpeggiatorRuntimeState,
        message: tuple[int, int, int],
        event_sample: int,
        source_context: MidiSourceContext | None,
    ) -> None:
        status = message[0] & 0xF0
        note = _clamp_midi_note(message[1])
        velocity = _clamp_midi_velocity(message[2])

        if status == 0x90 and velocity > 0:
            if state.config.latch and note in state.held_notes:
                state.held_notes.pop(note, None)
            else:
                state.held_order_sequence += 1
                state.held_notes[note] = HeldNote(
                    note=note,
                    velocity=velocity,
                    order=state.held_order_sequence,
                    source_context=source_context,
                )
            if state.held_notes and (
                state.next_step_sample is None
                or state.config.restart_mode == "first_note"
                and len(state.held_notes) == 1
            ):
                state.next_step_sample = max(0, int(event_sample))
                state.step_index = 0
            return

        if status in {0x80, 0x90}:
            if not state.config.latch:
                state.held_notes.pop(note, None)
            if not state.held_notes:
                state.next_step_sample = None
                self._release_active_note_locked(state, event_sample)
            return

        if status == 0xB0 and message[1] in {120, 123}:
            state.held_notes.clear()
            state.next_step_sample = None
            self._release_active_note_locked(state, event_sample)

    def _advance_state_locked(
        self,
        state: ArpeggiatorRuntimeState,
        *,
        block_start_sample: int,
        block_end_sample: int,
        sample_rate: int,
    ) -> None:
        if state.active_note is not None and state.active_note_off_sample is not None:
            if state.active_note_off_sample <= block_start_sample:
                self._release_active_note_locked(state, block_start_sample)
            elif state.active_note_off_sample < block_end_sample:
                self._release_active_note_locked(state, state.active_note_off_sample)

        if not state.held_notes:
            state.next_step_sample = None
            return

        step_samples = self._step_samples(state.config, sample_rate)
        if state.next_step_sample is None:
            state.next_step_sample = block_start_sample
        if state.next_step_sample < block_start_sample:
            missed = ((block_start_sample - state.next_step_sample) // step_samples) + 1
            state.next_step_sample += missed * step_samples
            state.step_index += missed

        while state.next_step_sample is not None and state.next_step_sample < block_end_sample:
            step_sample = state.next_step_sample
            if state.active_note is not None:
                self._release_active_note_locked(state, step_sample)

            if self._rng.random() <= state.config.probability:
                selected_notes = self._select_step_notes(state)
                if selected_notes:
                    start_sample = self._humanized_sample(step_sample, sample_rate, state.config.humanize_ms)
                    output_notes: list[int] = []
                    last_velocity: int | None = None
                    for selected in selected_notes:
                        output_note = self._output_note_for(state, selected)
                        velocity = self._velocity_for(state, selected)
                        self._enqueue_generated_locked(
                            _note_on_message(state.config.target_channel, output_note, velocity),
                            target_sample=start_sample,
                        )
                        output_notes.append(output_note)
                        last_velocity = velocity
                    state.active_notes = set(output_notes)
                    state.active_note = output_notes[0] if output_notes else None
                    state.active_note_off_sample = start_sample + max(
                        1,
                        int(round(step_samples * state.config.gate_ratio)),
                    )
                    state.last_velocity = last_velocity

            state.step_index += 1
            swing_offset = int(round(step_samples * state.config.swing * 0.5)) if state.step_index % 2 == 1 else 0
            state.next_step_sample = step_sample + max(1, step_samples) + swing_offset

    def _select_step_notes(self, state: ArpeggiatorRuntimeState) -> list[HeldNote]:
        notes = list(state.held_notes.values())
        if not notes:
            return []
        ordered = self._ordered_notes(state, notes)
        if not ordered:
            return []
        if state.config.pattern == "chord":
            return ordered
        repeat_count = max(1, state.config.repeats)
        sequence_index = state.step_index // repeat_count
        return [ordered[sequence_index % len(ordered)]]

    def _ordered_notes(self, state: ArpeggiatorRuntimeState, notes: list[HeldNote]) -> list[HeldNote]:
        expanded: list[HeldNote] = []
        base = self._base_ordered_notes(state.config.pattern, notes)
        for octave in range(max(1, state.config.octaves)):
            for note in base:
                expanded_note = _clamp_midi_note(note.note + (12 * octave))
                expanded.append(
                    HeldNote(
                        note=expanded_note,
                        velocity=note.velocity,
                        order=note.order,
                        source_context=note.source_context,
                    )
                )
        return expanded

    def _base_ordered_notes(self, pattern: str, notes: list[HeldNote]) -> list[HeldNote]:
        ascending = sorted(notes, key=lambda entry: (entry.note, entry.order))
        descending = list(reversed(ascending))
        played = sorted(notes, key=lambda entry: entry.order)

        if pattern == "down":
            return descending
        if pattern == "up_down":
            return ascending + descending[1:-1]
        if pattern == "down_up":
            return descending + ascending[1:-1]
        if pattern == "as_played":
            return played
        if pattern == "random":
            shuffled = played[:]
            self._rng.shuffle(shuffled)
            return shuffled
        if pattern == "chord":
            return ascending
        if pattern == "inside_out":
            center = len(ascending) // 2
            result: list[HeldNote] = []
            for offset in range(len(ascending)):
                for index in (center - offset, center + offset):
                    if 0 <= index < len(ascending) and ascending[index] not in result:
                        result.append(ascending[index])
            return result
        if pattern == "outside_in":
            result = []
            left = 0
            right = len(ascending) - 1
            while left <= right:
                result.append(ascending[left])
                if right != left:
                    result.append(ascending[right])
                left += 1
                right -= 1
            return result
        return ascending

    def _output_note_for(self, state: ArpeggiatorRuntimeState, held_note: HeldNote) -> int:
        note = _clamp_midi_note(held_note.note + state.config.transpose)
        if not state.config.scale_quantize:
            return note
        context = held_note.source_context
        root = context.scale_root if context and context.scale_root else state.config.scale_root
        mode = context.mode if context and context.mode else state.config.mode
        return self._quantize_note_to_scale(note, root, mode)

    def _velocity_for(self, state: ArpeggiatorRuntimeState, held_note: HeldNote) -> int:
        mode = state.config.velocity_mode
        if mode == "fixed":
            base = state.config.fixed_velocity
        elif mode == "random":
            low = max(1, state.config.fixed_velocity - state.config.humanize_velocity)
            high = min(127, state.config.fixed_velocity + state.config.humanize_velocity)
            base = self._rng.randint(low, high)
        elif mode == "accent" and state.config.accent_cycle:
            base = state.config.accent_cycle[state.step_index % len(state.config.accent_cycle)]
        else:
            base = held_note.velocity

        if state.config.humanize_velocity > 0 and mode != "random":
            base += self._rng.randint(-state.config.humanize_velocity, state.config.humanize_velocity)
        return _clamp_midi_velocity(base)

    def _release_active_note_locked(self, state: ArpeggiatorRuntimeState, target_sample: int) -> None:
        notes = sorted(state.active_notes) if state.active_notes else ([] if state.active_note is None else [state.active_note])
        if not notes:
            return
        for note in notes:
            self._enqueue_generated_locked(
                _note_off_message(state.config.target_channel, note),
                target_sample=max(0, int(target_sample)),
            )
        state.active_note = None
        state.active_notes.clear()
        state.active_note_off_sample = None

    def _enqueue_generated_locked(self, message: list[int], *, target_sample: int) -> bool:
        return self._enqueue_timestamped_midi(
            message,
            source="arpeggiator",
            target_engine_sample=max(0, int(target_sample)),
        )

    def _step_samples(self, config: SessionArpeggiatorConfig, sample_rate: int) -> int:
        beat_seconds = 60.0 / float(max(1, self._tempo_bpm))
        rate_beats = _RATE_BEATS.get(config.rate, 0.25)
        return max(1, int(round(beat_seconds * rate_beats * max(1, sample_rate))))

    def _humanized_sample(self, target_sample: int, sample_rate: int, humanize_ms: float) -> int:
        if humanize_ms <= 0:
            return max(0, int(target_sample))
        max_offset = int(round((humanize_ms / 1000.0) * sample_rate))
        if max_offset <= 0:
            return max(0, int(target_sample))
        return max(0, int(target_sample) + self._rng.randint(-max_offset, max_offset))

    @staticmethod
    def _quantize_note_to_scale(note: int, root: SequencerScaleRoot, mode: SequencerMode) -> int:
        root_pc = _ROOT_PITCH_CLASS.get(root, 0)
        intervals = _MODE_INTERVALS.get(mode, _MODE_INTERVALS["aeolian"])
        allowed = {((root_pc + interval) % 12) for interval in intervals}
        if note % 12 in allowed:
            return _clamp_midi_note(note)
        candidates = range(max(0, note - 6), min(127, note + 6) + 1)
        allowed_candidates = [candidate for candidate in candidates if candidate % 12 in allowed]
        if not allowed_candidates:
            return _clamp_midi_note(note)
        return min(allowed_candidates, key=lambda candidate: (abs(candidate - note), candidate))

    def panic(self) -> None:
        with self._lock:
            sample = self._current_engine_sample()
            for state in self._states.values():
                self._release_active_note_locked(state, sample)
                for message in _all_notes_off_messages(state.config.target_channel):
                    self._enqueue_generated_locked(message, target_sample=sample)
                state.held_notes.clear()
                state.next_step_sample = None
            self._pending_inputs.clear()
