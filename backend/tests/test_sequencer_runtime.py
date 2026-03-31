from __future__ import annotations

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services import sequencer_runtime
from backend.app.services.sequencer_runtime import SessionSequencerRuntime


class _FakeMidiService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[list[int]], float | None]] = []

    def send_scheduled_message(
        self,
        selector: str,
        message: list[int],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        self.calls.append((selector, [list(message)], delivery_delay_seconds))
        return "fake-output"

    def send_scheduled_messages(
        self,
        selector: str,
        messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        self.calls.append((selector, [list(message) for message in messages], delivery_delay_seconds))
        return "fake-output"


def test_midi_schedule_lead_is_100ms() -> None:
    assert sequencer_runtime._MIDI_SCHEDULE_LEAD_S == 0.100


def test_render_driven_sequencer_only_advances_when_render_blocks_arrive() -> None:
    midi_service = _FakeMidiService()
    runtime = SessionSequencerRuntime(
        session_id="session-render",
        midi_service=midi_service,  # type: ignore[arg-type]
        midi_input_selector="mido:test",
        controller_default_channels=(1,),
        clock_mode="render_driven",
        publish_event=lambda _event_type, _payload: None,
    )
    config = SessionSequencerConfigRequest.model_validate(
        {
            "timing": {
                "tempo_bpm": 120,
                "meter_numerator": 4,
                "meter_denominator": 4,
                "steps_per_beat": 4,
                "beat_rate_numerator": 1,
                "beat_rate_denominator": 1,
            },
            "step_count": 8,
            "playback_end_step": 8,
            "tracks": [
                {
                    "track_id": "lead",
                    "midi_channel": 1,
                    "length_beats": 1,
                    "active_pad": 0,
                    "enabled": True,
                    "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60]}],
                }
            ],
        }
    )

    runtime.configure(config)
    started = runtime.start(position_step=0)

    assert started.running is True
    assert started.transport_subunit == 0
    assert midi_service.calls == []

    advanced = runtime.advance_render_block(sample_rate=48_000, ksmps=64)

    assert advanced.running is True
    assert advanced.transport_subunit > 0
    assert midi_service.calls != []
    selector, messages, delivery_delay_seconds = midi_service.calls[0]
    assert selector == "mido:test"
    assert messages == [[0x90, 60, 100]]
    assert delivery_delay_seconds is None

    next_status = runtime.advance_render_block(sample_rate=48_000, ksmps=64)
    assert next_status.transport_subunit > advanced.transport_subunit
