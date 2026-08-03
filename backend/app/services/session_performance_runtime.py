from __future__ import annotations

from collections.abc import Callable
from typing import Any

from backend.app.core.config import Settings
from backend.app.engine.session_runtime import RuntimeSession
from backend.app.models.session import SessionSequencerStatus
from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
from backend.app.services.browser_clock_policy import browser_clock_manual_midi_max_future_samples
from backend.app.services.midi_service import INTERNAL_LOOPBACK_ID
from backend.app.services.sequencer_runtime import SessionSequencerRuntime

PublishRuntimeEvent = Callable[[str, str, dict[str, Any]], None]


class SessionPerformanceRuntimeCoordinator:
    """Creates and connects the sequencer and arpeggiator runtimes for a session."""

    def __init__(self, settings: Settings, publish_event: PublishRuntimeEvent) -> None:
        self._settings = settings
        self._publish_event = publish_event

    def initialize(self, runtime: RuntimeSession) -> None:
        runtime.midi_router = self.create_midi_router(runtime)
        runtime.sequencer = self.create_sequencer(runtime)

    def ensure_sequencer(self, runtime: RuntimeSession) -> SessionSequencerRuntime:
        if runtime.sequencer is None:
            runtime.sequencer = self.create_sequencer(runtime)
        return runtime.sequencer

    def create_sequencer(self, runtime: RuntimeSession) -> SessionSequencerRuntime:
        midi_router = self.ensure_midi_router(runtime)
        return SessionSequencerRuntime(
            session_id=runtime.session_id,
            midi_service=midi_router,
            midi_input_selector=INTERNAL_LOOPBACK_ID,
            controller_default_channels=self.controller_default_channels(runtime),
            clock_mode="render_driven",
            publish_event=lambda event_type, payload, session_id=runtime.session_id: self._publish_event(
                session_id,
                event_type,
                payload,
            ),
        )

    def ensure_midi_router(self, runtime: RuntimeSession) -> PerformanceMidiRouter:
        if runtime.midi_router is None:
            runtime.midi_router = self.create_midi_router(runtime)
        return runtime.midi_router

    def create_midi_router(self, runtime: RuntimeSession) -> PerformanceMidiRouter:
        return PerformanceMidiRouter(
            enqueue_timestamped_midi=runtime.worker.enqueue_timestamped_midi,
            current_engine_sample=lambda runtime=runtime: runtime.worker.render_sample_cursor,
            output_name="engine:internal",
            max_pending_inputs=self._settings.arpeggiator_pending_input_max_events,
            max_future_samples=lambda runtime=runtime: self.manual_midi_max_future_samples(runtime),
        )

    def manual_midi_max_future_samples(self, runtime: RuntimeSession) -> int:
        sample_rate = max(1, int(runtime.worker.runtime_sample_rate or self._settings.default_sr))
        return browser_clock_manual_midi_max_future_samples(
            sample_rate=sample_rate,
            max_future_ms=self._settings.browser_clock_manual_midi_max_future_ms,
        )

    def status_with_arpeggiators(
        self,
        runtime: RuntimeSession,
        status: SessionSequencerStatus,
    ) -> SessionSequencerStatus:
        router = self.ensure_midi_router(runtime)
        return status.model_copy(update={"arpeggiators": router.status()})

    @staticmethod
    def controller_default_channels(runtime: RuntimeSession) -> tuple[int, ...]:
        channels = tuple(
            sorted(
                {
                    max(1, min(16, int(assignment.midi_channel)))
                    for assignment in runtime.instruments
                    if int(assignment.midi_channel) > 0
                }
            )
        )
        return channels if channels else (1,)
