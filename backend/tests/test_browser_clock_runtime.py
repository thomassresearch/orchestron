from __future__ import annotations

from types import SimpleNamespace

from backend.app.services.browser_clock_runtime import BrowserClockRuntimeCoordinator


def test_transport_timeline_splits_at_loop_discontinuity() -> None:
    segments, events = BrowserClockRuntimeCoordinator.transport_timeline(
        engine_sample_start=1_000,
        engine_sample_end=1_100,
        engine_sample_rate=48_000,
        target_frame_count=200,
        initial_transport_subunit=1_260,
        final_transport_subunit=840,
        transport_events=[
            SimpleNamespace(
                engine_sample=1_050,
                kind="loop",
                payload={
                    "previous_transport_subunit": 1_680,
                    "transport_subunit": 420,
                },
            )
        ],
    )

    assert segments == [
        {
            "target_frame_start": 0,
            "target_frame_end": 100,
            "transport_subunit_start": 1_260,
            "transport_subunit_end": 1_680,
        },
        {
            "target_frame_start": 100,
            "target_frame_end": 200,
            "transport_subunit_start": 420,
            "transport_subunit_end": 840,
        },
    ]
    assert events == [
        {
            "target_frame_offset": 100,
            "kind": "loop",
            "payload": {
                "previous_transport_subunit": 1_680,
                "transport_subunit": 420,
            },
        }
    ]
