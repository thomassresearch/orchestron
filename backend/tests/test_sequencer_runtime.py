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


def _note_on_messages(midi_service: _FakeMidiService) -> list[list[int]]:
    note_ons: list[list[int]] = []
    for _selector, messages, _delivery_delay_seconds in midi_service.calls:
        for message in messages:
            if len(message) == 3 and (message[0] & 0xF0) == 0x90 and message[2] > 0:
                note_ons.append(message)
    return note_ons


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

    tempo_bpm = runtime.advance_render_block(sample_rate=48_000, ksmps=64)
    advanced = runtime.status()

    assert tempo_bpm == 120
    assert advanced.running is True
    assert advanced.transport_subunit > 0
    assert midi_service.calls != []
    selector, messages, delivery_delay_seconds = midi_service.calls[0]
    assert selector == "mido:test"
    assert messages == [[0x90, 60, 100]]
    assert delivery_delay_seconds is None

    runtime.advance_render_block(sample_rate=48_000, ksmps=64)
    next_status = runtime.status()
    assert next_status.transport_subunit > advanced.transport_subunit


def test_render_driven_sequencer_emits_step_hits_crossed_inside_block() -> None:
    midi_service = _FakeMidiService()
    runtime = SessionSequencerRuntime(
        session_id="session-render-steps",
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
                    "track_id": "drums",
                    "midi_channel": 1,
                    "length_beats": 1,
                    "active_pad": 0,
                    "enabled": True,
                    "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60, 61, 62, 63]}],
                }
            ],
        }
    )

    runtime.configure(config)
    runtime.start(position_step=0)

    for _ in range(5):
        runtime.advance_render_block(sample_rate=1_000, ksmps=100)

    assert _note_on_messages(midi_service) == [
        [0x90, 60, 100],
        [0x90, 61, 100],
        [0x90, 62, 100],
        [0x90, 63, 100],
    ]


def test_sequencer_step_event_carries_lightweight_runtime_delta() -> None:
    midi_service = _FakeMidiService()
    published_events: list[tuple[str, dict[str, object]]] = []
    runtime = SessionSequencerRuntime(
        session_id="session-render-events",
        midi_service=midi_service,  # type: ignore[arg-type]
        midi_input_selector="mido:test",
        controller_default_channels=(1,),
        clock_mode="render_driven",
        publish_event=lambda event_type, payload: published_events.append((event_type, payload)),
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
                    "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60, 61, 62, 63]}],
                }
            ],
        }
    )

    runtime.configure(config)
    runtime.start(position_step=0)
    runtime.advance_render_block(sample_rate=1_000, ksmps=100)

    sequencer_step_events = [payload for event_type, payload in published_events if event_type == "sequencer_step"]
    assert sequencer_step_events

    payload = sequencer_step_events[0]
    assert payload["previous_step"] == 0
    assert payload["current_step"] == 1
    assert payload["cycle"] == 0
    assert payload["running"] is True
    assert payload["step_count"] == 8
    assert payload["transport_subunit"] == 420
    assert "sequencer_status" not in payload

    tracks = payload["tracks"]
    assert isinstance(tracks, list)
    assert tracks == [{"track_id": "lead", "local_step": 0}]

    controller_tracks = payload["controller_tracks"]
    assert isinstance(controller_tracks, list)
    assert controller_tracks == []


def test_render_driven_advancement_does_not_construct_status_snapshots_per_block() -> None:
    midi_service = _FakeMidiService()
    runtime = SessionSequencerRuntime(
        session_id="session-render-status-hot-path",
        midi_service=midi_service,  # type: ignore[arg-type]
        midi_input_selector="mido:test",
        controller_default_channels=(1,),
        clock_mode="render_driven",
        publish_event=lambda _event_type, _payload: None,
    )
    runtime.configure(
        SessionSequencerConfigRequest.model_validate(
            {
                "timing": {"tempo_bpm": 120, "steps_per_beat": 4},
                "step_count": 8,
                "playback_end_step": 8,
                "tracks": [
                    {
                        "track_id": "lead",
                        "midi_channel": 1,
                        "length_beats": 1,
                        "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60]}],
                    }
                ],
            }
        )
    )
    runtime.start(position_step=0)

    original_status_locked = runtime._status_locked
    status_call_count = 0

    def count_status_calls():
        nonlocal status_call_count
        status_call_count += 1
        return original_status_locked()

    runtime._status_locked = count_status_calls  # type: ignore[method-assign]
    for _ in range(96):
        assert runtime.advance_render_block(sample_rate=48_000, ksmps=32) == 120

    assert status_call_count == 0
    assert runtime.status().running is True
    assert status_call_count == 1


def test_render_driven_pad_boundary_batches_switches_without_status_snapshots() -> None:
    midi_service = _FakeMidiService()
    published_events: list[tuple[str, dict[str, object]]] = []
    runtime = SessionSequencerRuntime(
        session_id="session-render-pad-switch-batch",
        midi_service=midi_service,  # type: ignore[arg-type]
        midi_input_selector="mido:test",
        controller_default_channels=(1,),
        clock_mode="render_driven",
        publish_event=lambda event_type, payload: published_events.append((event_type, payload)),
    )
    track_count = 64
    runtime.configure(
        SessionSequencerConfigRequest.model_validate(
            {
                "timing": {"tempo_bpm": 120, "steps_per_beat": 4},
                "step_count": 16,
                "playback_end_step": 16,
                "tracks": [
                    {
                        "track_id": f"track-{index}",
                        "midi_channel": (index % 16) + 1,
                        "length_beats": 1,
                        "active_pad": 0,
                        "enabled": True,
                        "pad_loop_enabled": True,
                        "pad_loop_sequence": [0, 1],
                        "pads": [
                            {"pad_index": 0, "length_beats": 1, "steps": [60]},
                            {"pad_index": 1, "length_beats": 1, "steps": [60]},
                        ],
                    }
                    for index in range(track_count)
                ],
                "controller_tracks": [
                    {
                        "track_id": "controller-1",
                        "controller_number": 74,
                        "length_beats": 1,
                        "active_pad": 0,
                        "enabled": True,
                        "pad_loop_enabled": True,
                        "pad_loop_sequence": [0, 1],
                        "pads": [
                            {"pad_index": 0, "length_beats": 1, "keypoints": [{"position": 0.0, "value": 20}]},
                            {"pad_index": 1, "length_beats": 1, "keypoints": [{"position": 0.0, "value": 20}]},
                        ],
                    }
                ],
            }
        )
    )
    runtime.start(position_step=0)

    original_status_locked = runtime._status_locked
    status_call_count = 0

    def count_status_calls():
        nonlocal status_call_count
        status_call_count += 1
        return original_status_locked()

    runtime._status_locked = count_status_calls  # type: ignore[method-assign]
    for _ in range(6):
        runtime.advance_render_block(sample_rate=1_000, ksmps=100)

    pad_switch_events = [
        payload for event_type, payload in published_events if event_type == "sequencer_pad_switches"
    ]
    assert len(pad_switch_events) == 1
    assert status_call_count == 0

    payload = pad_switch_events[0]
    switches = payload["switches"]
    assert isinstance(switches, list)
    assert len(switches) == track_count + 1
    assert {switch["track_id"] for switch in switches if isinstance(switch, dict)} == {
        *(f"track-{index}" for index in range(track_count)),
        "controller-1",
    }
    assert any(
        isinstance(switch, dict)
        and switch["track_id"] == "controller-1"
        and switch["track_kind"] == "controller"
        for switch in switches
    )
    assert payload["tracks"]
