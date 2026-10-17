from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.models.session import SessionDeviceTransportRequest, SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.app.services.sequencer_runtime_constants import TRANSPORT_SUBUNITS_PER_BEAT
from backend.tests.test_sequencer_runtime import _FakeMidiService, _preview_command, _workspace_command


def setup(**changes):
    payload = json.loads((Path(__file__).parent / "fixtures/sequencers/controller_steps.json").read_text())
    payload["controller_tracks"][0].update(changes)
    request = SessionSequencerConfigRequest.model_validate(payload)
    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime(session_id="steps", midi_service=midi, midi_input_selector="test",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    runtime.configure(request)
    return runtime, midi, request


def values(midi, channel=2, cc=74):
    return [message[2] for _, batch, _ in midi.calls for message in batch if message[:2] == [0xb0 + channel - 1, cc]]


def at(runtime, position):
    runtime._advance_render_to_event_locked(runtime._config, position)
    if runtime._running:
        runtime._perform_render_block_events_locked(runtime._config, runtime._absolute_subunit)


def play(runtime):
    runtime.start()
    runtime.advance_render_block(sample_rate=48000, ksmps=0)


@pytest.mark.parametrize("block", [1, 64, 4096])
def test_sparse_steps_repeat_identical_values_and_never_interpolate(block):
    runtime, midi, _ = setup()
    runtime.start()
    sample = 0
    while runtime._running:
        runtime.advance_render_block(sample_rate=48000, ksmps=block, block_start_sample=sample)
        sample += block
    assert values(midi) == [12, 0, 64, 64, 127, 0, 64, 64, 127, 12]
    assert values(midi, channel=5) == values(midi)
    assert not values(midi, channel=1)
    runtime.stop()
    assert values(midi)[-2:] == [127, 12]  # Stop after a finite end does not reset twice.


def test_reset_precedes_step_and_note_and_restart_at_empty_position_waits():
    runtime, midi, request = setup(pads=[{"pad_index": 0, "steps": [0, None, 127]}])
    request.tracks = SessionSequencerConfigRequest.model_validate({"tracks": [{"track_id": "notes", "pads": [
        {"pad_index": 0, "steps": [60]}]}]}).tracks
    runtime.configure(request)
    play(runtime)
    messages = [message for _, batch, _ in midi.calls for message in batch]
    assert messages[:4] == [[0xb1, 74, 12], [0xb4, 74, 12], [0xb1, 74, 0], [0xb4, 74, 0]]
    assert next(i for i, m in enumerate(messages) if m[0] == 0x90) >= 4
    at(runtime, 5040)
    runtime.stop()
    assert values(midi) == [12, 0, 12]
    play(runtime)
    assert values(midi) == [12, 0, 12, 12]
    at(runtime, 10080)
    assert values(midi)[-1] == 127


def test_all_start_resets_precede_steps_on_shared_targets():
    runtime, midi, request = setup(pads=[{"pad_index": 0, "steps": [64]}])
    other = request.controller_tracks[0].model_copy(deep=True)
    other.track_id, other.reset_value = "other", 7
    other.pads[0].steps = [90]
    request.controller_tracks.append(other)
    runtime.configure(request)
    play(runtime)
    assert values(midi) == [12, 7, 64, 90]


def test_empty_pad_only_emits_lifecycle_values_and_stopped_seek_is_silent():
    runtime, midi, _ = setup(pads=[])
    runtime._seek_absolute_subunit_locked(5040)
    assert values(midi) == []
    play(runtime)
    at(runtime, 10080)
    runtime.stop()
    assert values(midi) == [12, 12]


def test_running_seek_resets_without_chasing_previous_steps():
    runtime, midi, _ = setup()
    play(runtime)
    at(runtime, 10080)
    assert values(midi) == [12, 64]
    runtime._seek_absolute_subunit_locked(20160)
    runtime._perform_render_block_events_locked(runtime._config, runtime._absolute_subunit)
    assert values(midi) == [12, 64, 12]
    at(runtime, 25200)
    assert values(midi)[-1] == 127


def test_live_edits_keep_occurrence_guard_and_reset_value_is_deferred():
    runtime, midi, request = setup()
    play(runtime)
    at(runtime, 10080)
    request.controller_tracks[0].pads[0].steps[2] = 90
    request.controller_tracks[0].reset_value = 7
    runtime.configure(request)
    runtime._perform_render_block_events_locked(runtime._config, 10080)
    runtime._perform_render_block_events_locked(runtime._config, 10080)
    assert values(midi) == [12, 64]
    at(runtime, 15120)
    assert values(midi)[-1] == 64
    runtime.stop()
    assert values(midi)[-1] == 7


def test_mode_and_route_changes_clean_departing_pairs_and_preserve_continuing_ones():
    runtime, midi, request = setup()
    play(runtime)
    at(runtime, 10080)
    request.controller_tracks[0].target_channels = [5, 6]
    runtime.configure(request)
    assert values(midi, 2) == [12, 64, 12]
    assert values(midi, 5) == [12, 64]
    assert values(midi, 6) == [12]
    request.controller_tracks[0].controller_number = 75
    runtime.configure(request)
    assert values(midi, 5)[-1] == 12
    assert values(midi, 5, 75) == [12]
    request.controller_tracks[0].controller_mode = "curve"
    runtime.configure(request)
    assert values(midi, 5, 75)[-2:] == [12, 0]
    request.controller_tracks[0].controller_mode = "step"
    runtime.configure(request)
    runtime._perform_render_block_events_locked(runtime._config, 10080)
    assert values(midi, 5, 75)[-2:] == [0, 12]


def test_leaving_step_mode_reestablishes_curve_even_when_it_equals_the_last_step():
    runtime, midi, request = setup(pads=[{"pad_index": 0, "steps": [64], "keypoints": [
        {"position": 0, "value": 64}, {"position": 1, "value": 64}]}])
    play(runtime)
    request.controller_tracks[0].controller_mode = "curve"
    runtime.configure(request)
    assert values(midi) == [12, 64, 12, 64]


def test_preview_return_with_due_workspace_edit_initializes_only_once():
    runtime, midi, _ = setup()
    play(runtime)
    midi.arranger_running = False
    runtime.audition(_workspace_command(targets=["cc-steps"]))
    runtime.audition(_preview_command(targets=["cc-steps"]))
    runtime.audition(_workspace_command(revision=2, sequence=[1], targets=["cc-steps"]))
    at(runtime, 40320)
    before = len(values(midi))
    runtime.audition(_preview_command("preview_end", 2, targets=["cc-steps"]))
    assert values(midi)[before:] == [12]
    assert runtime._config.controller_tracks["cc-steps"].active_pad == 1


@pytest.mark.parametrize("change", ["disable", "remove", "shorten"])
def test_configuration_stops_cleanup_once(change):
    runtime, midi, request = setup()
    play(runtime)
    at(runtime, 10080)
    if change == "disable":
        request.controller_tracks[0].enabled = False
    elif change == "remove":
        request.controller_tracks.clear()
    else:
        request.playback_end_step = 1
    runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)))
    assert values(midi) == [12, 64, 12]
    runtime.stop()
    assert values(midi) == [12, 64, 12]


@pytest.mark.parametrize("denominator,subdivision,ratio", [(4, 3, (1, 1)), (8, 6, (3, 2)), (8, 8, (7, 4))])
def test_step_timing_is_exact_and_compilation_does_not_synthesize_empty_values(denominator, subdivision, ratio):
    _, _, request = setup(timing={"meter_denominator": denominator, "steps_per_beat": subdivision,
        "beat_unit": "meter", "beat_rate_numerator": ratio[0], "beat_rate_denominator": ratio[1]})
    compiled = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    pad = compiled.controller_tracks["cc-steps"].pads[0]
    step = TRANSPORT_SUBUNITS_PER_BEAT * 4 * ratio[1] // (denominator * subdivision * ratio[0])
    assert [(e.offset_subunit, e.value) for e in pad.events] == [(step, 0), (2 * step, 64), (3 * step, 64), (5 * step, 127)]
    assert not compiled.controller_tracks["cc-steps"].pads[1].events


def test_song_loop_has_no_reset_but_emits_same_values_again():
    runtime, midi, request = setup(pads=[{"pad_index": 0, "length_beats": 1, "steps": [64, None, None, None]}])
    request.playback_end_step = 8
    request.playback_loop = True
    runtime.configure(request)
    play(runtime)
    at(runtime, 20160)
    at(runtime, 20160)
    assert values(midi) == [12, 64, 64, 64]


def test_independent_sources_seek_and_stop_leave_manual_controller_running():
    runtime, midi, request = setup(enabled=False, pad_loop_enabled=True, pad_loop_sequence=[0], pad_loop_repeat=True)
    manual = request.controller_tracks[0].model_copy(deep=True)
    manual.track_id, manual.controller_number, manual.pad_loop_enabled = "manual", 75, False
    request.controller_tracks.append(manual)
    request.playback_loop = True
    runtime.configure(request)
    runtime.device_transport(SessionDeviceTransportRequest(action="play", track_ids=["manual"]))
    runtime.advance_render_block(sample_rate=48000, ksmps=0)
    runtime.device_transport(SessionDeviceTransportRequest(action="play", arranger=True))
    runtime.advance_render_block(sample_rate=48000, ksmps=0)
    at(runtime, 10080)
    runtime._seek_absolute_subunit_locked(20160)
    assert values(midi, cc=75) == [12, 64]
    assert values(midi) == [12, 64, 12]
    runtime.device_transport(SessionDeviceTransportRequest(action="stop", arranger=True))
    assert runtime._config.controller_tracks["manual"].enabled
    assert values(midi, cc=75) == [12, 64]
    runtime.stop()
    assert values(midi, cc=75) == [12, 64, 12]


def test_preview_initializes_then_restores_phase_with_reset():
    runtime, midi, _ = setup()
    play(runtime)
    at(runtime, 10080)
    command = _preview_command().model_copy(update={"track_ids": ["cc-steps"]})
    runtime.audition(command)
    at(runtime, 40320)
    assert values(midi)[-1] == 12
    command = _preview_command("preview_end", 2).model_copy(update={"track_ids": ["cc-steps"]})
    runtime.audition(command)
    assert values(midi)[-2:] == [12, 12]
    assert runtime._config.controller_tracks["cc-steps"].enabled


def test_finite_pad_sequence_stops_at_its_boundary_once():
    runtime, midi, _ = setup(pad_loop_enabled=True, pad_loop_repeat=False, pad_loop_sequence=[0])
    play(runtime)
    at(runtime, 10080)
    at(runtime, 40320)
    assert values(midi) == [12, 64, 12]
    runtime.stop()
    assert values(midi) == [12, 64, 12]


def test_export_estimate_counts_repeats_resets_and_channels():
    from backend.app.models.export import _estimate_controller_track_events
    _, _, request = setup()
    count = _estimate_controller_track_events(request.controller_tracks[0], fallback_channels={1},
        consumed_input_channels=set(), playback_start_subunit=0, playback_end_subunit=4 * TRANSPORT_SUBUNITS_PER_BEAT)
    assert count == 20  # Two pads × four cells × two channels, plus start/stop on both channels.


def test_source_song_loop_and_pad_changes_hold_value_through_empty_steps():
    runtime, midi, request = setup(enabled=False, pad_loop_enabled=True, pad_loop_sequence=[0, 1], pad_loop_repeat=True)
    request.playback_end_step = 32
    request.playback_loop = True
    runtime.configure(request)
    runtime.device_transport(SessionDeviceTransportRequest(action="play", arranger=True))
    runtime.advance_render_block(sample_rate=48000, ksmps=0)
    at(runtime, 10080)
    at(runtime, 40320)  # Empty pad 1
    at(runtime, 80640)  # Song loop, empty first step of pad 0
    assert values(midi) == [12, 64]
    at(runtime, 90720)
    assert values(midi) == [12, 64, 64]


def test_step_messages_including_resets_retain_lane_output_gating():
    from backend.app.engine.midi_scheduler import EngineMidiScheduler
    from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
    _, _, request = setup()
    scheduler = EngineMidiScheduler()
    gate = scheduler.lane_output
    gate.configure(request)
    def enqueue(message, *, source, **_kwargs):
        return scheduler.enqueue(message, source=source, target_engine_sample=0)[0]
    router = PerformanceMidiRouter(enqueue_timestamped_midi=enqueue,
                                  current_engine_sample=lambda: 0)
    router.lane_output = gate
    runtime = SessionSequencerRuntime(session_id="gated", midi_service=router, midi_input_selector="internal:loopback",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    runtime.configure(request)
    gate.apply(1, {"cc-steps": {"mute": True, "solo": False}})
    play(runtime)
    at(runtime, 10080)
    runtime.stop()
    assert scheduler.drain_block(block_start_sample=0, block_end_sample=1) == []
    gate.apply(2, {})
    play(runtime)
    output = scheduler.drain_block(block_start_sample=0, block_end_sample=1)
    assert output
    assert all(event.source == "lane:cc-steps" for event in output)
