from __future__ import annotations

from types import SimpleNamespace
from typing import cast

from backend.app.core.config import Settings
from backend.app.engine.session_runtime import RuntimeSession
from backend.app.services.session_performance_runtime import SessionPerformanceRuntimeCoordinator


def _coordinator(**settings: object) -> SessionPerformanceRuntimeCoordinator:
    return SessionPerformanceRuntimeCoordinator(Settings(**settings), lambda *_args: None)


def test_controller_default_channels_are_sorted_deduplicated_and_bounded() -> None:
    runtime = cast(
        RuntimeSession,
        SimpleNamespace(
            instruments=[
                SimpleNamespace(midi_channel=16),
                SimpleNamespace(midi_channel=2),
                SimpleNamespace(midi_channel=2),
                SimpleNamespace(midi_channel=0),
            ]
        ),
    )

    assert SessionPerformanceRuntimeCoordinator.controller_default_channels(runtime) == (2, 16)


def test_manual_midi_horizon_uses_runtime_sample_rate() -> None:
    runtime = cast(
        RuntimeSession,
        SimpleNamespace(worker=SimpleNamespace(runtime_sample_rate=48_000)),
    )

    assert _coordinator(browser_clock_manual_midi_max_future_ms=10.0).manual_midi_max_future_samples(runtime) == 480
