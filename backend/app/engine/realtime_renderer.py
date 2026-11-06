"""Session-facing renderer contract; no native engine or process selection here."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol, runtime_checkable

from backend.app.engine.lane_output import LaneOutputGate
from backend.app.engine.midi_scheduler import EngineMidiOutputAdapter
from backend.app.engine.performance_controllers import PerformanceControllers


@dataclass(slots=True)
class EngineStartResult:
    backend: str
    detail: str
    audio_mode: str = "browser_clock"


@dataclass(slots=True)
class EngineRenderResult:
    """One completed request's ordered, interleaved float32 little-endian PCM."""

    engine_sample_start: int
    engine_sample_end: int
    engine_sample_rate: int
    target_sample_rate: int
    channels: int
    block_count: int
    target_frame_count: int
    pcm_f32le: bytes


@runtime_checkable
class RealtimeRenderer(Protocol):
    """Operations used by session, browser-clock and performance services.

    Implementations own rendering synchronization, MIDI ordering and controls.
    Session lifecycle/leases and sequencer/arpeggiator advancement stay in the
    parent. CsoundWorker conforms structurally: no forwarding layer or runtime
    protocol checks are needed on the render path.

    Timing and failure semantics: specifications/parallel-csound-rendering/contracts.md.
    The existing mock backend conforms too; it does not imply native audio readiness.
    """

    @property
    def backend(self) -> str: ...

    @property
    def audio_output_mode(self) -> str: ...

    @property
    def is_running(self) -> bool: ...

    @property
    def browser_clock_ready(self) -> bool: ...

    @property
    def runtime_sample_rate(self) -> int: ...

    @property
    def runtime_channels(self) -> int: ...

    @property
    def runtime_ksmps(self) -> int: ...

    @property
    def render_sample_cursor(self) -> int:
        """End of completed engine work, not the browser's audible position."""
        ...

    @property
    def accepts_direct_midi(self) -> bool: ...

    @property
    def midi_output(self) -> EngineMidiOutputAdapter: ...

    @property
    def midi_overflow_count(self) -> int: ...

    @property
    def lane_output(self) -> LaneOutputGate: ...

    @property
    def performance_controllers(self) -> PerformanceControllers: ...

    def start(self, csd: str, midi_input: str, rtmidi_module: str) -> EngineStartResult: ...

    def stop(self) -> str: ...

    def panic(self) -> str: ...

    def queue_midi_message(
        self, message: list[int], delivery_delay_seconds: float | None = None,
    ) -> bool: ...

    def enqueue_timestamped_midi(
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

    def release_lane_events(self, identities: list[str]) -> None: ...

    def configure_mixer(self, manifest: dict, controls: dict[str, float]) -> None: ...

    def queue_mixer_controls(self, controls: dict[str, float]) -> None: ...

    def queue_control_channels(self, controls: dict[str, float]) -> None: ...

    def drain_mixer_meters(self) -> list[dict]: ...

    def render_blocks(
        self,
        *,
        block_count: int,
        target_sample_rate: int,
        before_block: Callable[..., None] | None = None,
    ) -> EngineRenderResult:
        """Render contiguous blocks and resample the completed request once.

        before_block accepts (index, start_sample), or the legacy (index).
        It runs after boundary actions and before MIDI/control delivery, with
        render ownership held and the cursor still at the block's start.
        Exceptions propagate; completed native work cannot be replayed by a
        different renderer. Stop serializes with an outstanding request.
        """
        ...

    def run_at_render_boundary(self, action: Callable[[], Any]) -> Any:
        """Apply in the parent at a block boundary, or immediately while idle.

        Wait for completion and propagate the action's result or exception.
        Returning may wait for ownership of the entire active render request.
        """
        ...
