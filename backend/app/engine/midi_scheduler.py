from __future__ import annotations

from dataclasses import dataclass, field
import heapq
import threading
from typing import Callable


@dataclass(order=True, slots=True)
class EngineMidiEvent:
    target_engine_sample: int
    sequence: int
    source: str = field(compare=False)
    message: bytes = field(compare=False)
    source_timestamp_ns: int | None = field(default=None, compare=False)
    mapped_backend_monotonic_ns: int | None = field(default=None, compare=False)
    late: bool = field(default=False, compare=False)
    sync_stale: bool = field(default=False, compare=False)


class EngineMidiScheduler:
    def __init__(self, *, max_events: int = 16_384) -> None:
        self._max_events = max(1, int(max_events))
        self._lock = threading.Lock()
        self._events: list[EngineMidiEvent] = []
        self._sequence = 0
        self._overflow_count = 0
        self._engine_sample_rate = 0

    @property
    def overflow_count(self) -> int:
        with self._lock:
            return self._overflow_count

    @property
    def pending_count(self) -> int:
        with self._lock:
            return len(self._events)

    def set_engine_sample_rate(self, sample_rate: int) -> None:
        with self._lock:
            self._engine_sample_rate = max(0, int(sample_rate))

    def reset(self) -> None:
        with self._lock:
            self._events.clear()
            self._sequence = 0
            self._overflow_count = 0
            self._engine_sample_rate = 0

    def enqueue(
        self,
        message: bytes | bytearray | list[int],
        *,
        source: str,
        target_engine_sample: int,
        source_timestamp_ns: int | None = None,
        mapped_backend_monotonic_ns: int | None = None,
        late: bool = False,
        sync_stale: bool = False,
    ) -> tuple[bool, EngineMidiEvent | None]:
        raw = bytes(int(value) & 0xFF for value in message)
        if len(raw) != 3:
            return (False, None)

        event = EngineMidiEvent(
            target_engine_sample=max(0, int(target_engine_sample)),
            sequence=0,
            source=source,
            message=raw,
            source_timestamp_ns=source_timestamp_ns,
            mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
            late=late,
            sync_stale=sync_stale,
        )

        with self._lock:
            if len(self._events) >= self._max_events:
                self._overflow_count += 1
                return (False, None)
            self._sequence += 1
            event.sequence = self._sequence
            heapq.heappush(self._events, event)
        return (True, event)

    def enqueue_after_delay(
        self,
        message: bytes | bytearray | list[int],
        *,
        source: str,
        delivery_delay_seconds: float | None,
        current_engine_sample: int,
        source_timestamp_ns: int | None = None,
        mapped_backend_monotonic_ns: int | None = None,
    ) -> tuple[bool, EngineMidiEvent | None]:
        with self._lock:
            sample_rate = self._engine_sample_rate
        delay_seconds = max(0.0, float(delivery_delay_seconds or 0.0))
        delay_samples = 0
        if sample_rate > 0:
            delay_samples = int(round(delay_seconds * sample_rate))
        return self.enqueue(
            message,
            source=source,
            target_engine_sample=max(0, int(current_engine_sample)) + delay_samples,
            source_timestamp_ns=source_timestamp_ns,
            mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
        )

    def drain_block(self, *, block_start_sample: int, block_end_sample: int) -> list[EngineMidiEvent]:
        drained: list[EngineMidiEvent] = []
        with self._lock:
            while self._events and self._events[0].target_engine_sample < block_end_sample:
                event = heapq.heappop(self._events)
                if event.target_engine_sample < block_start_sample:
                    event.late = True
                    event.target_engine_sample = block_start_sample
                drained.append(event)
        return drained


class ClockDomainMapping:
    _STALE_AFTER_NS = 1_000_000_000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._offset_ns: int | None = None
        self._last_server_ns: int | None = None
        self._last_remote_ns: int | None = None

    def update(self, *, remote_timestamp_ns: int, server_timestamp_ns: int) -> None:
        sample_offset = int(server_timestamp_ns) - int(remote_timestamp_ns)
        with self._lock:
            if self._offset_ns is None:
                self._offset_ns = sample_offset
            else:
                # Smooth noisy one-way samples without hiding larger drift.
                self._offset_ns = int(round((self._offset_ns * 0.8) + (sample_offset * 0.2)))
            self._last_server_ns = int(server_timestamp_ns)
            self._last_remote_ns = int(remote_timestamp_ns)

    def map_to_server_time(self, remote_timestamp_ns: int, *, now_server_ns: int) -> tuple[int | None, bool]:
        with self._lock:
            offset_ns = self._offset_ns
            last_server_ns = self._last_server_ns
        if offset_ns is None or last_server_ns is None:
            return (None, True)
        stale = (int(now_server_ns) - last_server_ns) > self._STALE_AFTER_NS
        return (int(remote_timestamp_ns) + offset_ns, stale)


class EngineMidiOutputAdapter:
    def __init__(
        self,
        *,
        enqueue_message: Callable[[list[int], float | None], bool],
        output_name: str = "internal",
    ) -> None:
        self._enqueue_message = enqueue_message
        self._output_name = output_name

    def send_scheduled_message(
        self,
        _selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        if not self._enqueue_message(list(message), delivery_delay_seconds):
            raise RuntimeError("Engine MIDI scheduler rejected message.")
        return self._output_name

    def send_scheduled_messages(
        self,
        _selector: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        for message in messages:
            if not self._enqueue_message(list(message), delivery_delay_seconds):
                raise RuntimeError("Engine MIDI scheduler rejected message batch.")
        return self._output_name
