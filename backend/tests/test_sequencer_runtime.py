from __future__ import annotations

import json
from pathlib import Path

import pytest

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


@pytest.mark.parametrize("change", ["notes", "remove", "disable", "channel", "shorten"])
def test_prepared_edit_preserves_transport_and_releases_only_affected_notes(change: str) -> None:
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime(session_id="edit", midi_service=midi, midi_input_selector="test",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    payload = {"playback_end_step": 10000, "tracks": [{
        "track_id": "lead", "midi_channel": 2, "length_beats": 4,
        "pads": [{"pad_index": 0, "length_beats": 4, "steps": [{"note": 60, "hold": True}]}],
    }]}
    request = SessionSequencerConfigRequest.model_validate(payload)
    runtime.configure(request)
    runtime.start()
    runtime.advance_render_block(sample_rate=48000, ksmps=16)
    position, remainder = runtime._absolute_subunit, runtime._render_subunit_remainder
    assert runtime._active_notes["lead"] == {60}
    midi.calls.clear()
    if change == "notes":
        request.tracks[0].pads[0].steps[0].note = 72
    elif change == "remove":
        request.tracks.clear()
    elif change == "disable":
        request.tracks[0].enabled = False
    elif change == "channel":
        request.tracks[0].midi_channel = 3
    else:
        runtime._absolute_subunit = 10000
        position = runtime._absolute_subunit
        request.playback_end_step = 1
    runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)))
    assert runtime._absolute_subunit == position
    assert runtime._render_subunit_remainder == remainder
    messages = [message for _, batch, _ in midi.calls for message in batch]
    if change == "notes":
        assert runtime._active_notes["lead"] == {60}
        assert messages == []
    elif change == "shorten":
        assert not runtime.status().running
        assert runtime._active_notes["lead"] == set()
    else:
        assert [0x81, 60, 0] in messages
        assert not runtime._active_notes.get("lead")


def test_constant_controller_edit_is_audible_at_application_without_waiting_for_loop() -> None:
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime(session_id="curve-edit", midi_service=midi, midi_input_selector="test",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    request = SessionSequencerConfigRequest.model_validate({"playback_end_step": 10000, "controller_tracks": [{
        "track_id": "filter", "controller_number": 74, "pads": [{"pad_index": 0, "length_beats": 16,
        "keypoints": [{"position": 0, "value": 30}, {"position": 1, "value": 30}]}],
    }]})
    runtime.configure(request)
    runtime.start()
    runtime.advance_render_block(sample_rate=48000, ksmps=16)
    midi.calls.clear()
    request.controller_tracks[0].pads[0].keypoints[0].value = 90
    runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)))
    assert [0xB0, 74, 90] in [message for _, batch, _ in midi.calls for message in batch]


def test_changed_synced_timing_matches_transport_position_without_history_replay(monkeypatch) -> None:
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    def new_runtime():
        return SessionSequencerRuntime(session_id="sync-edit", midi_service=_FakeMidiService(), midi_input_selector="test",
            controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)

    request = SessionSequencerConfigRequest.model_validate({"playback_end_step": 10000, "tracks": [
        {"track_id": "master", "midi_channel": 1, "length_beats": 2},
        {"track_id": "follower", "midi_channel": 2, "length_beats": 4, "sync_to_track_id": "master"},
    ]})
    runtime = new_runtime()
    runtime.configure(request)
    runtime.start(position_step=83)
    request.tracks[1].timing = request.timing.model_copy(update={"beat_rate_numerator": 3, "beat_rate_denominator": 2})
    reference = new_runtime()
    reference.configure(request)
    reference.start(position_step=83)
    monkeypatch.setattr(runtime, "_apply_absolute_subunit_locked", lambda *_: pytest.fail("history replay during apply"))
    runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)))
    assert runtime.status().transport_subunit == reference.status().transport_subunit
    actual = runtime._config.tracks["follower"]
    expected = reference._config.tracks["follower"]
    assert (actual.active_pad, actual.phase_offset_subunit, actual.enabled) == (expected.active_pad, expected.phase_offset_subunit, expected.enabled)


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


@pytest.mark.parametrize("playing", [False, True])
def test_seek_applies_new_loop_bounds_and_position_together(playing: bool) -> None:
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime(session_id="seek", midi_service=midi, midi_input_selector="test",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    request = SessionSequencerConfigRequest.model_validate(json.loads(
        (Path(__file__).parent / "fixtures/sequencers/arranger_seek.json").read_text()
    ))
    runtime.configure(request)
    runtime.start(position_step=48)
    runtime.advance_render_block(sample_rate=48000, ksmps=64)
    if not playing:
        runtime.stop()
    midi.calls.clear()

    request.playback_start_step = 32
    request.playback_end_step = 40
    request.playback_loop = True
    status = runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)),
        position_step=32)
    assert status.running is playing
    assert status.transport_subunit == 32 * 420
    assert status.tracks[0].active_pad == 1
    if playing:
        assert [0x80, 67, 0] in [message for _, batch, _ in midi.calls for message in batch]
        midi.calls.clear()
        runtime.advance_render_block(sample_rate=48000, ksmps=64)
        assert [0x90, 67, 100] in _note_on_messages(midi), "seek must play the note at the target beat"
        positions = []
        for _ in range(800):
            runtime.advance_render_block(sample_rate=48000, ksmps=64)
            positions.append(runtime.status().transport_subunit)
        assert all(32 * 420 <= position < 40 * 420 for position in positions)
        assert any(after < before for before, after in zip(positions, positions[1:]))

    # Clearing a late loop and jumping back must not stop at the new end first.
    request.playback_start_step = 0
    request.playback_end_step = 32
    request.playback_loop = False
    status = runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)),
        position_step=4)
    assert status.running is playing
    assert status.transport_subunit == 4 * 420
    assert status.tracks[0].active_pad == 0
    if playing:
        runtime.advance_render_block(sample_rate=48000, ksmps=64)
        assert runtime.status().transport_subunit > 4 * 420


def test_controller_channel_edit_sends_current_value_and_preserves_transport_and_queue() -> None:
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime(session_id="channel-edit", midi_service=midi, midi_input_selector="test",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    request = SessionSequencerConfigRequest.model_validate({"playback_end_step": 10000, "controller_tracks": [{
        "track_id": "filter", "controller_number": 74, "target_channels": [1, 16],
        "pads": [{"pad_index": index, "length_beats": 4,
            "keypoints": [{"position": 0, "value": 30}, {"position": 1, "value": 30}]} for index in (0, 1)],
    }]})
    runtime.configure(request)
    runtime.start()
    runtime.advance_render_block(sample_rate=48000, ksmps=16)
    assert {tuple(message) for _, batch, _ in midi.calls for message in batch if message[0] & 0xF0 == 0xB0} == {
        (0xB0, 74, 30), (0xBF, 74, 30)}
    runtime.queue_pad("filter", 1)
    position = runtime._absolute_subunit
    midi.calls.clear()
    request.controller_tracks[0].target_channels = [2, 16]
    runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)))
    assert runtime._absolute_subunit == position
    assert runtime.status().running
    assert runtime.status().controller_tracks[0].queued_pad == 1
    assert [message for _, batch, _ in midi.calls for message in batch] == [[0xB1, 74, 30], [0xBF, 74, 30]]


def _audition_runtime(*, repeat=False):
    runtime = SessionSequencerRuntime(session_id="audition", midi_service=_FakeMidiService(), midi_input_selector="test",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    request = SessionSequencerConfigRequest.model_validate({"playback_end_step": 256, "tracks": [
        {"track_id": identity, "midi_channel": channel, "pad_loop_enabled": True,
         "pad_loop_repeat": repeat, "pad_loop_sequence": [0, -4, 1],
         "pads": [{"pad_index": index, "length_beats": 4, "steps": [{"note": 60 + index}]} for index in range(2)]}
        for identity, channel in [("lead", 1), ("other", 2)]]})
    runtime.configure(request)
    return runtime, request


def test_audition_boundary_return_into_rest_and_finite_end_preserves_other_track():
    from backend.app.models.session import SessionAuditionRequest
    runtime, request = _audition_runtime()
    runtime.start()
    runtime._absolute_subunit = 3360
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[1, -2]))
    assert runtime.status().auditions == {"lead": {"active": False, "queued": "start"}}
    runtime._advance_render_to_event_locked(runtime._config, 4 * 3360)
    lead = runtime._config.tracks["lead"]
    other = runtime._config.tracks["other"]
    assert (lead.active_pad, lead.pad_loop_position, lead.phase_offset_subunit) == (1, 0, 4 * 3360)
    assert (other.pad_loop_position, other.phase_offset_subunit) == (1, 4 * 3360)
    runtime.audition(SessionAuditionRequest(action="return", track_ids=["lead"]))
    runtime._advance_render_to_event_locked(runtime._config, 8 * 3360)
    assert lead.active_pad == 1 and lead.pad_loop_position == 2
    assert not runtime.status().auditions
    # Returning past an authored finite end leaves the track ended.
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[1]))
    runtime._advance_render_to_event_locked(runtime._config, 12 * 3360)
    runtime.audition(SessionAuditionRequest(action="return", track_ids=["lead"]))
    runtime._advance_render_to_event_locked(runtime._config, 16 * 3360)
    assert not lead.enabled and lead.sequence_ended
    assert request.tracks[0].pad_loop_sequence == [0, -4, 1]
    assert not request.tracks[0].pad_loop_repeat


def test_stopped_audition_only_starts_target_and_seek_restarts_first_token():
    from backend.app.models.session import SessionAuditionRequest
    runtime, request = _audition_runtime()
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[1, -2]))
    assert runtime.status().running
    assert runtime._config.tracks["lead"].enabled
    assert not runtime._config.tracks["other"].enabled
    runtime._seek_absolute_subunit_locked(48 * 420)
    lead = runtime._config.tracks["lead"]
    assert lead.active_pad == 1 and lead.pad_loop_position == 0
    assert lead.phase_offset_subunit == runtime._absolute_subunit
    assert not runtime._config.tracks["other"].enabled
    runtime.configure(request)
    assert runtime._config.tracks["lead"].pad_loop_sequence == (1, -2)
    runtime.stop()
    assert runtime.status().auditions == {}
    assert runtime._config.tracks["lead"].pad_loop_sequence == (0, -4, 1)


def test_audition_rejects_invalid_drummer_batch_atomically_and_cancels_pending():
    from backend.app.models.session import SessionAuditionRequest
    runtime, _ = _audition_runtime()
    runtime.start()
    with pytest.raises(ValueError):
        runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead", "missing"], sequence=[1]))
    assert not runtime.status().auditions
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead", "other"], sequence=[1, -1]))
    assert runtime._auditions["lead"]["boundary"] == runtime._auditions["other"]["boundary"]
    runtime.audition(SessionAuditionRequest(action="cancel", track_ids=["lead", "other"]))
    assert not runtime.status().auditions


def test_audition_waits_for_disabled_track_boundary_and_returns_into_rest():
    from backend.app.models.session import SessionAuditionRequest
    runtime, request = _audition_runtime()
    request.tracks[0].enabled = False
    runtime.configure(request)
    runtime.start()
    runtime._absolute_subunit = 3360
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[-1, 1]))
    assert runtime.status().auditions["lead"] == {"active": False, "queued": "start"}
    runtime._advance_render_to_event_locked(runtime._config, 4 * 3360)
    assert runtime._config.tracks["lead"].pad_loop_position == 0
    runtime.audition(SessionAuditionRequest(action="return", track_ids=["lead"]))
    runtime._advance_render_to_event_locked(runtime._config, 5 * 3360)
    assert not runtime._config.tracks["lead"].enabled
    assert not runtime.status().auditions

    # An enabled arrangement resumes in its authored silence at beat five.
    runtime, request = _audition_runtime()
    runtime.start()
    runtime._absolute_subunit = 3360
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[-1, 1]))
    runtime._advance_render_to_event_locked(runtime._config, 4 * 3360)
    runtime.audition(SessionAuditionRequest(action="return", track_ids=["lead"]))
    runtime._advance_render_to_event_locked(runtime._config, 5 * 3360)
    lead = runtime._config.tracks["lead"]
    assert lead.enabled and lead.pad_loop_position == 1
    assert runtime._current_pad_loop_token(lead) == -4
    assert lead.phase_offset_subunit == 4 * 3360
    assert runtime._config.tracks["other"].pad_loop_position == 1


def test_controller_audition_keeps_rational_boundaries_and_restarts_on_song_loop():
    from backend.app.models.session import SessionAuditionRequest
    runtime, request = _audition_runtime()
    payload = request.model_dump()
    payload.update(playback_loop=True, playback_end_step=64, controller_tracks=[{
        "track_id": "filter", "controller_number": 74, "enabled": True,
        "timing": {**request.timing.model_dump(), "beat_rate_numerator": 3, "beat_rate_denominator": 2},
        "pad_loop_enabled": True, "pad_loop_repeat": False, "pad_loop_sequence": [0, -4],
        "pads": [{"pad_index": index, "length_beats": 4,
            "keypoints": [{"position": 0, "value": 30 + index}, {"position": 1, "value": 30 + index}]} for index in (0, 1)],
    }])
    runtime.configure(SessionSequencerConfigRequest.model_validate(payload))
    runtime.start()
    runtime._absolute_subunit = 3360
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["filter"], sequence=[1, -1]))
    boundary = 4 * 3360 * 2 // 3
    assert runtime._auditions["filter"]["boundary"] == boundary
    runtime._advance_render_to_event_locked(runtime._config, boundary)
    track = runtime._config.controller_tracks["filter"]
    assert track.active_pad == 1 and track.phase_offset_subunit == boundary
    runtime._advance_render_to_event_locked(runtime._config, 64 * 420)
    assert runtime._absolute_subunit == 0
    assert track.active_pad == 1 and track.pad_loop_position == 0 and track.phase_offset_subunit == 0
    runtime.audition(SessionAuditionRequest(action="stop", track_ids=["filter"]))
    assert not track.enabled and not runtime.status().auditions
    assert runtime._config.tracks["other"].enabled


def test_seek_applies_pending_audition_replacement_and_return_at_destination():
    from backend.app.models.session import SessionAuditionRequest
    runtime, _ = _audition_runtime()
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[0]))
    runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[1, -2]))
    runtime._seek_absolute_subunit_locked(5 * 3360)
    lead = runtime._config.tracks["lead"]
    assert lead.active_pad == 1 and lead.phase_offset_subunit == 5 * 3360
    assert runtime.audition_status()["lead"] == {"active": True, "queued": None}
    runtime.audition(SessionAuditionRequest(action="return", track_ids=["lead"]))
    runtime._seek_absolute_subunit_locked(6 * 3360)
    assert not runtime.audition_status()
    assert runtime._current_pad_loop_token(lead) == -4
