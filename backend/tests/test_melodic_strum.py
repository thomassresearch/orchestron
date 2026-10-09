from fractions import Fraction

import pytest

from backend.app.services.sequencer_strum import prepared_strum_attacks
from backend.tests.test_sequencer_note_timing import advance, make_runtime, notes


def chord(direction="up", spread=100, offset=0, pitches=None):
    return {"note": pitches or [60, 64, 67], "strum_direction": direction,
            "strum_spread_percent": spread, "timing_offset_percent": offset}


def ons(capture):
    return [(at, msg[1]) for at, msg in notes(capture) if msg[0] == 0x90]


@pytest.mark.parametrize("mode", ["render_driven", "wall_clock"])
@pytest.mark.parametrize("direction,pitches", [("up", [60, 64, 67]), ("down", [67, 64, 60])])
@pytest.mark.parametrize("spread", [0, 40, 100])
def test_strum_positions_and_equal_note_lengths(mode, direction, pitches, spread):
    runtime, capture, _ = make_runtime([chord(direction, spread), None, None, None], mode=mode)
    advance(runtime, capture, 2000)
    if spread == 0:
        pitches = [60, 64, 67]  # zero retains the ordinary chord path
    starts = [round(Fraction(840 * spread * i, 200)) for i in range(3)]
    assert ons(capture) == list(zip(starts, pitches))
    assert [(at, msg[1]) for at, msg in notes(capture) if msg[0] == 0x80] == list(zip([t + 840 for t in starts], pitches))


def test_last_note_at_next_step_is_audible_and_releases_independently():
    runtime, capture, _ = make_runtime([chord(), 62, None, None])
    advance(runtime, capture, 2100)
    assert ons(capture) == [(0, 60), (420, 64), (840, 67), (840, 62)]
    assert (1260, (0x80, 64, 0)) in notes(capture)
    assert (1680, (0x80, 67, 0)) in notes(capture)
    assert not runtime._active_notes['lead']


def test_same_pitch_retrigger_replaces_old_release_and_equal_time_prefers_new_step():
    runtime, capture, _ = make_runtime([chord(), {"note": [64, 67], "velocity": 70}, {"hold": True}, None])
    advance(runtime, capture, 3000)
    assert [(at, msg[1], msg[2]) for at, msg in notes(capture) if msg[0] == 0x90] == [
        (0, 60, 100), (420, 64, 100), (840, 67, 70), (840, 64, 70)]
    assert (1260, (0x80, 64, 0)) not in notes(capture)
    assert (2520, (0x80, 64, 0)) in notes(capture)


@pytest.mark.parametrize("offset", [-50, -20, 20, 50])
def test_timing_shifts_the_whole_strum(offset):
    runtime, capture, _ = make_runtime([None, chord(offset=offset), None, None])
    advance(runtime, capture, 3100)
    start = 840 + round(840 * offset / 100)
    assert ons(capture) == [(start, 60), (start + 420, 64), (start + 840, 67)]
    assert (start + 1680, (0x80, 67, 0)) in notes(capture)


def test_hold_extends_each_note_and_live_edits_do_not_replace_started_attacks():
    runtime, capture, config = make_runtime([chord(), {"hold": True}, None, None])
    advance(runtime, capture, 300)
    config.tracks[0].pads[0].steps[0].strum_direction = "down"
    config.tracks[0].pads[0].steps[0].strum_spread_percent = 40
    runtime.configure(config)
    advance(runtime, capture, 3100)
    assert ons(capture) == [(0, 60), (420, 64), (840, 67)]
    assert [(at, msg[1]) for at, msg in notes(capture) if msg[0] == 0x80] == [(1680, 60), (2100, 64), (2520, 67)]


def test_late_final_strum_crosses_same_pad_repeat():
    runtime, capture, _ = make_runtime([None, None, None, chord(offset=50)])
    advance(runtime, capture, 4800)
    assert ons(capture) == [(2940, 60), (3360, 64), (3780, 67)]
    assert (4620, (0x80, 67, 0)) in notes(capture)


def test_song_loop_remaps_strum_once():
    runtime, capture, config = make_runtime([None, None, None, chord(offset=50)])
    config.playback_end_step = 8
    config.playback_loop = True
    runtime.configure(config)
    advance(runtime, capture, 8100)
    assert ons(capture) == [(2940, 60), (3360, 64), (3780, 67), (6300, 60), (6720, 64), (7140, 67)]


@pytest.mark.parametrize("action", ["pad", "stop", "pause", "end"])
def test_transitions_cancel_remaining_notes(action):
    runtime, capture, config = make_runtime([], pads=[
        {"pad_index": 0, "length_beats": 1, "steps": [None, None, None, chord(offset=50)]},
        {"pad_index": 1, "length_beats": 1, "steps": [72]},
    ], pad_loop_enabled=action == "pause", pad_loop_sequence=[0, -1])
    if action == "pad":
        runtime.queue_pad("lead", 1)
    elif action == "stop":
        runtime._config.tracks['lead'].queued_enabled = False
    elif action == "end":
        config.playback_end_step = 8
        runtime.configure(config)
    advance(runtime, capture, 4200)
    assert ons(capture) == ([(2940, 60), (3360, 72)] if action == "pad" else [(2940, 60)])


def test_seek_cancels_pending_strum():
    runtime, capture, _ = make_runtime([chord(), None, None, None])
    advance(runtime, capture, 200)
    with runtime._lock:
        runtime._seek_absolute_subunit_locked(1800 * 6)
    capture.sample = 1800
    advance(runtime, capture, 2500)
    assert ons(capture) == [(0, 60)]
    assert not runtime._strum_states


@pytest.mark.parametrize("grid,denominator,rate", [(3, 4, (1, 1)), (6, 8, (3, 2)), (8, 8, (7, 4))])
@pytest.mark.parametrize("pitches", [[60, 67], [60, 64, 67, 71]])
def test_prepared_offsets_are_absolute_rational_positions(grid, denominator, rate, pitches):
    runtime, _, _ = make_runtime([chord(spread=73, pitches=pitches)], timing={"beat_unit": "meter", "steps_per_beat": grid,
        "meter_denominator": denominator, "beat_rate_numerator": rate[0], "beat_rate_denominator": rate[1]})
    track = runtime._config.tracks['lead']
    pad = track.pads[0]
    span = track.timing.transport_subunits_per_local_step
    assert pad.strum_attacks[0] == tuple((round(Fraction(span * 73 * i, 100 * (len(pitches) - 1))), note) for i, note in enumerate(pitches))
    assert prepared_strum_attacks(pad.steps[0], span) is pad.strum_attacks[0]


def test_enabling_and_disabling_strum_live_adopts_and_finishes_owned_notes():
    runtime, capture, config = make_runtime([{ "note": [60, 64, 67]}, None, None, None])
    advance(runtime, capture, 200)
    config.tracks[0].pads[0].steps[0].strum_direction = "up"
    config.tracks[0].pads[0].steps[0].strum_spread_percent = 100
    runtime.configure(config)
    advance(runtime, capture, 3600)
    config.tracks[0].pads[0].steps[0].strum_direction = "off"
    runtime.configure(config)
    advance(runtime, capture, 5200)
    assert ons(capture) == [(0, 60), (0, 64), (0, 67), (3360, 60), (3780, 64), (4200, 67)]
    assert not runtime._active_notes['lead']


def test_independent_manual_strum_survives_arranger_controls():
    from backend.app.models.session import SessionDeviceTransportRequest
    runtime, capture, config = make_runtime([chord()])
    runtime.stop()
    manual = config.tracks[0].model_copy(deep=True, update={'track_id': 'manual', 'enabled': False})
    config.tracks[0].enabled = False
    config.tracks[0].midi_channel = 2
    config.tracks[0].pad_loop_enabled = True
    config.tracks[0].pad_loop_sequence = [0]
    config.tracks.append(manual)
    runtime.configure(config)
    runtime.device_transport(SessionDeviceTransportRequest(action='play', track_ids=['manual']))
    advance(runtime, capture, 300)
    state = runtime._strum_states['manual']
    for action in ('play', 'stop'):
        runtime.device_transport(SessionDeviceTransportRequest(action=action, arranger=True,
            position_step=8 if action == 'play' else None))
        assert runtime._strum_states['manual'] is state
    advance(runtime, capture, 1800)
    assert ons(capture) == [(0, 60), (420, 64), (840, 67)]


def test_audition_end_cancels_strum():
    from backend.app.models.session import SessionAuditionRequest
    runtime, capture, config = make_runtime([chord()])
    runtime.stop()
    config.tracks[0].enabled = False
    runtime.configure(config)
    runtime.audition(SessionAuditionRequest(action='preview_start', track_ids=['lead'],
        sequence=[0], gesture_id='strum-preview', revision=1))
    advance(runtime, capture, 300)
    runtime.audition(SessionAuditionRequest(action='preview_end', track_ids=['lead'],
        gesture_id='strum-preview', revision=2))
    advance(runtime, capture, 1200)
    assert ons(capture) == [(0, 60)]
    assert not runtime._strum_states


def test_muted_strum_keeps_clock_and_other_source_notes():
    from backend.app.engine.lane_output import LaneOutputGate
    runtime, capture, config = make_runtime([chord()])
    config.tracks.append(config.tracks[0].model_copy(deep=True, update={'track_id': 'other'}))
    gate = LaneOutputGate()
    gate.configure(config)

    def send(selector, message, *, delivery_delay_seconds, source_context):
        if gate.allows(f'lane:{source_context.source_id}', message):
            capture.send_scheduled_message(selector, message, delivery_delay_seconds=delivery_delay_seconds)

    capture.send_scheduled_message_with_context = send
    runtime.configure(config)
    advance(runtime, capture, 300)
    gate.apply(1, {'lead': {'mute': True, 'solo': False}})
    advance(runtime, capture, 1800)
    assert ons(capture) == [(0, 60), (0, 60), (420, 64), (840, 67)]
    assert not runtime._active_notes['lead'] and not runtime._active_notes['other']


def test_estimate_includes_strum_tail_and_overlapping_arp_input():
    from backend.app.models.export import _estimate_note_track_events
    _, _, config = make_runtime([chord(), 62, None, None])
    count, events = _estimate_note_track_events(config.tracks[0], playback_start_subunit=0, playback_end_subunit=20160)
    assert count == 8
    assert (5040, 'on', (67,)) in events
    assert (10080, 'off', (67,)) in events
    assert (7560, 'off', (64,)) in events


def test_bypass_export_estimate_counts_retriggers_after_merging_pitch_lifetimes():
    from backend.app.models.export import _estimate_arpeggiator_events, _estimate_note_track_events
    from backend.app.models.session import SessionArpeggiatorConfig
    _, _, config = make_runtime([chord(), chord(), chord(), chord()])
    count, events = _estimate_note_track_events(config.tracks[0], playback_start_subunit=0, playback_end_subunit=20160)
    assert count > len(events)
    arp = SessionArpeggiatorConfig(arpeggiator_id='arp', input_channel=1, target_channel=2, enabled=True, processing_mode='bypass')
    assert _estimate_arpeggiator_events(arp, events, playback_start_subunit=0,
        playback_end_subunit=20160, input_event_count=count) == count + 256


def test_early_first_strum_clamps_as_a_group_and_preserves_spacing():
    runtime, capture, _ = make_runtime([chord(offset=-50), None, None, None])
    advance(runtime, capture, 4000)
    assert ons(capture) == [(0, 60), (420, 64), (840, 67), (2940, 60), (3360, 64), (3780, 67)]


def test_zero_velocity_and_single_notes_do_not_create_strum_attacks():
    runtime, capture, _ = make_runtime([dict(chord(), velocity=0), dict(chord(), note=72), None, None])
    advance(runtime, capture, 2200)
    assert ons(capture) == [(840, 72)]
    assert not runtime._active_notes['lead']
