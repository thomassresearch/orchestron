from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.app.models.session import (
    SessionArpeggiatorConfig,
    SessionSequencerConfigRequest,
)
from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
from backend.app.services.sequencer_runtime import SessionSequencerRuntime


class _CaptureMidi:
    def __init__(self) -> None:
        self.current_sample = 0
        self.messages: list[tuple[list[int], int | None]] = []

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
    ) -> bool:
        _ = (
            source,
            delivery_delay_seconds,
            source_timestamp_ns,
            mapped_backend_monotonic_ns,
            sync_stale,
        )
        self.messages.append((list(message), target_engine_sample))
        return True


def _router(
    capture: _CaptureMidi,
    *,
    max_pending_inputs: int = 16_384,
    max_future_samples: int | None = None,
) -> PerformanceMidiRouter:
    return PerformanceMidiRouter(
        enqueue_timestamped_midi=capture.enqueue_timestamped_midi,
        current_engine_sample=lambda: capture.current_sample,
        max_pending_inputs=max_pending_inputs,
        max_future_samples=max_future_samples,
    )


def _arp_config(*, enabled: bool = True, input_channel: int = 2, target_channel: int = 1) -> SessionArpeggiatorConfig:
    return SessionArpeggiatorConfig.model_validate(
        {
            "arpeggiator_id": "arp",
            "enabled": enabled,
            "input_channel": input_channel,
            "target_channel": target_channel,
            "rate": "1/16",
            "gate_ratio": 0.7,
            "octaves": 1,
            "pattern": "up",
        }
    )


def _advance_router(router: PerformanceMidiRouter, *, start: int = 0, end: int = 64) -> None:
    router.advance_render_block(
        block_start_sample=start,
        block_end_sample=end,
        sample_rate=48_000,
        tempo_bpm=120,
    )


def test_arpeggiator_consumes_input_and_emits_target_channel_note() -> None:
    capture = _CaptureMidi()
    router = _router(capture)
    router.configure([_arp_config()], tempo_bpm=120)

    queued = router.route_message([0x91, 60, 100], source="test")
    assert queued is True
    assert capture.messages == []

    _advance_router(router)

    assert capture.messages[0][0] == [0x90, 60, 100]
    assert router.status()[0].held_notes == [60]
    assert router.status()[0].active_note == 60


def test_disabled_arpeggiator_consumes_input_without_output() -> None:
    capture = _CaptureMidi()
    router = _router(capture)
    router.configure([_arp_config(enabled=False)], tempo_bpm=120)

    queued = router.route_message([0x91, 60, 100], source="test")
    _advance_router(router)

    assert queued is True
    assert capture.messages == []
    assert router.status()[0].held_notes == []


def test_arpeggiator_rejects_pending_input_above_cap() -> None:
    capture = _CaptureMidi()
    router = _router(capture, max_pending_inputs=1)
    router.configure([_arp_config()], tempo_bpm=120)

    assert router.route_message([0x91, 60, 100], source="test", target_engine_sample=1_000) is True
    assert router.route_message([0x91, 62, 100], source="test", target_engine_sample=1_001) is False

    _advance_router(router, start=1_000, end=1_064)

    assert router.status()[0].held_notes == [60]


def test_arpeggiator_rejects_pending_input_beyond_future_horizon() -> None:
    capture = _CaptureMidi()
    capture.current_sample = 10_000
    router = _router(capture, max_future_samples=4_800)
    router.configure([_arp_config()], tempo_bpm=120)

    assert router.route_message([0x91, 60, 100], source="test", target_engine_sample=14_800) is True
    assert router.route_message([0x91, 62, 100], source="test", target_engine_sample=14_801) is False

    _advance_router(router, start=14_800, end=14_864)

    assert router.status()[0].held_notes == [60]


def test_arpeggiator_input_channels_must_be_unique() -> None:
    with pytest.raises(ValidationError):
        SessionSequencerConfigRequest.model_validate(
            {
                "timing": {"tempo_bpm": 120},
                "step_count": 8,
                "playback_end_step": 8,
                "tracks": [
                    {
                        "track_id": "transport",
                        "midi_channel": 1,
                        "enabled": False,
                        "pads": [{"pad_index": 0, "steps": [None]}],
                    }
                ],
                "arpeggiators": [
                    {"arpeggiator_id": "arp-a", "enabled": True, "input_channel": 3, "target_channel": 1},
                    {"arpeggiator_id": "arp-b", "enabled": True, "input_channel": 3, "target_channel": 1},
                ],
            }
        )


def test_sequencer_notes_can_drive_arpeggiator_target_instrument() -> None:
    capture = _CaptureMidi()
    router = _router(capture)
    router.configure([_arp_config()], tempo_bpm=120)
    runtime = SessionSequencerRuntime(
        session_id="session-arpeggiator",
        midi_service=router,  # type: ignore[arg-type]
        midi_input_selector="mido:test",
        controller_default_channels=(1,),
        clock_mode="render_driven",
        publish_event=lambda _event_type, _payload: None,
    )
    config = SessionSequencerConfigRequest.model_validate(
        {
            "timing": {"tempo_bpm": 120},
            "step_count": 8,
            "playback_end_step": 8,
            "tracks": [
                {
                    "track_id": "lead",
                    "midi_channel": 2,
                    "scale_root": "C",
                    "scale_type": "minor",
                    "mode": "aeolian",
                    "length_beats": 1,
                    "active_pad": 0,
                    "enabled": True,
                    "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60]}],
                }
            ],
            "arpeggiators": [_arp_config().model_dump(mode="json")],
        }
    )

    runtime.configure(config)
    runtime.start(position_step=0)
    runtime.advance_render_block(sample_rate=48_000, ksmps=64)
    _advance_router(router)

    assert [message for message, _sample in capture.messages if message[0] & 0xF0 == 0x90] == [[0x90, 60, 100]]
