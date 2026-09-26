from fractions import Fraction

import pytest

from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.tests.test_sequencer_note_timing import advance, make_runtime, notes


def hit(count=4, velocity=100, end=None, offset=0):
    return {"note": 36, "velocity": velocity, "ratchets": count,
            "ratchet_end_velocity": end, "timing_offset_percent": offset}


def attacks(capture):
    return [(at, msg[2]) for at, msg in notes(capture) if msg[0] == 0x90]


@pytest.mark.parametrize("mode", ["render_driven", "wall_clock"])
@pytest.mark.parametrize("count", range(1, 9))
def test_even_ratchets_on_shared_clock(mode, count):
    runtime, capture, _ = make_runtime([hit(count), None, None, None], mode=mode)
    advance(runtime, capture, 1000)
    expected = [(round(round(Fraction(5040 * i, count)) / 6), 100) for i in range(count)]
    assert attacks(capture) == expected
    assert notes(capture)[-1] == (840, (0x80, 36, 0))
    for left, right in zip(notes(capture)[1::2], notes(capture)[2::2]):
        assert left[0] == right[0]  # release precedes each retrigger


@pytest.mark.parametrize("velocity,end,expected", [(100, 40, [100, 80, 60, 40]),
    (40, 100, [40, 60, 80, 100]), (100, None, [100] * 4), (90, 0, [90, 60, 30]),
    (0, 90, [30, 60, 90]), (0, 0, [])])
def test_velocity_ramp_and_silent_strikes(velocity, end, expected):
    runtime, capture, _ = make_runtime([hit(velocity=velocity, end=end)])
    advance(runtime, capture, 1000)
    assert [v for _, v in attacks(capture)] == expected
    assert not runtime._active_notes["lead"]
    assert not runtime._ratchet_rolls


@pytest.mark.parametrize("offset", [-50, -20, 20, 50])
def test_whole_roll_moves_with_timing(offset):
    runtime, capture, _ = make_runtime([None, hit(offset=offset)])
    advance(runtime, capture, 2200)
    start = 840 + round(840 * offset / 100)
    assert attacks(capture) == [(start + 210 * i, 100) for i in range(4)]
    assert notes(capture)[-1][0] == start + 840


def test_next_cell_cuts_off_roll_and_wins_equal_time_collision():
    runtime, capture, _ = make_runtime([hit(8, offset=50), hit(2, velocity=60, offset=-25)])
    advance(runtime, capture, 1600)
    assert attacks(capture) == [(420, 100), (525, 100), (630, 60), (1050, 60)]


@pytest.mark.parametrize("mode", ["render_driven", "wall_clock"])
def test_early_first_roll_clamps_as_group_then_anticipates_all_strikes(mode):
    runtime, capture, _ = make_runtime([hit(offset=-50)], mode=mode)
    advance(runtime, capture, 4200)
    assert attacks(capture) == [(210 * i, 100) for i in range(4)] + [(2940 + 210 * i, 100) for i in range(4)]


def test_late_final_roll_survives_same_pad_repeat():
    runtime, capture, _ = make_runtime([None, None, None, hit(offset=50)])
    advance(runtime, capture, 4200)
    assert attacks(capture) == [(2940 + 210 * i, 100) for i in range(4)]
    assert notes(capture)[-1][0] == 3780


@pytest.mark.parametrize("offset", [-50, 50])
def test_song_loop_remaps_roll_without_replaying_strikes(offset):
    steps = [hit(offset=offset)] if offset < 0 else [None, None, None, hit(offset=offset)]
    runtime, capture, config = make_runtime(steps)
    config.playback_end_step = 8
    config.playback_loop = True
    runtime.configure(config)
    advance(runtime, capture, 7400)
    first = 0 if offset < 0 else 2940
    expected = [first + 210 * i for i in range(4)]
    expected += [2940 + 3360 * cycle + 210 * i for cycle in (range(2) if offset < 0 else range(1, 2)) for i in range(4)]
    assert [at for at, _ in attacks(capture)] == expected


@pytest.mark.parametrize("change", ["pad", "stop", "pause", "end"])
def test_transport_transitions_cancel_late_tail(change):
    runtime, capture, config = make_runtime([], pads=[
        {"pad_index": 0, "length_beats": 1, "steps": [None, None, None, hit(offset=50)]},
        {"pad_index": 1, "length_beats": 1, "steps": []}],
        pad_loop_enabled=change == "pause", pad_loop_sequence=[0, -1])
    if change == "pad":
        runtime.queue_pad("lead", 1)
    elif change == "stop":
        runtime._config.tracks["lead"].queued_enabled = False
    elif change == "end":
        config.playback_end_step = 8
        runtime.configure(config)
    advance(runtime, capture, 4300)
    assert attacks(capture) == [(2940, 100), (3150, 100)]
    assert not runtime._ratchet_rolls
    assert not runtime._active_notes["lead"]


@pytest.mark.parametrize("count", [1, 2, 8])
def test_live_edits_snapshot_the_started_roll(count):
    runtime, capture, config = make_runtime([hit(end=40)])
    advance(runtime, capture, 300)
    step = config.tracks[0].pads[0].steps[0]
    step.ratchets, step.ratchet_end_velocity, step.timing_offset_percent = count, 120, 50
    runtime.configure(config)
    advance(runtime, capture, 4700)
    assert attacks(capture)[:4] == [(0, 100), (210, 80), (420, 60), (630, 40)]
    assert attacks(capture)[4:] == [(3780 + round(round(Fraction(5040 * i, count)) / 6),
                                  round(100 + Fraction(20 * i, count - 1)) if count > 1 else 100)
                                 for i in range(count)]


def test_seek_and_stop_clear_remaining_strikes():
    for action in ("seek", "stop"):
        runtime, capture, _ = make_runtime([hit()])
        advance(runtime, capture, 300)
        with runtime._lock:
            if action == "seek":
                runtime._seek_absolute_subunit_locked(3000)
            else:
                runtime.stop()
        advance(runtime, capture, 2000)
        assert attacks(capture) == [(0, 100), (210, 100)]
        assert not runtime._ratchet_rolls


@pytest.mark.parametrize("grid,denominator,rate", [(3, 4, (1, 1)), (6, 8, (3, 2)), (8, 8, (7, 4))])
def test_prepared_strikes_use_rational_positions_and_cache(grid, denominator, rate):
    runtime, capture, config = make_runtime([hit(7, end=40)], timing={
        "steps_per_beat": grid, "meter_denominator": denominator, "beat_unit": "meter",
        "beat_rate_numerator": rate[0], "beat_rate_denominator": rate[1]})
    prepared = compile_sequencer_runtime_config(config, controller_default_channels=(1,))
    pad = prepared.tracks["lead"].pads[0]
    assert pad.ratchet_strikes is runtime._config.tracks["lead"].pads[0].ratchet_strikes
    span = prepared.tracks["lead"].timing.transport_subunits_per_local_step
    assert [strike.offset for strike in pad.ratchet_strikes[0]] == [round(Fraction(span * i, 7)) for i in range(7)]
    config.playback_end_step = 1000
    runtime.configure(config)
    advance(runtime, capture, 15000)
    length = pad.transport_subunit_count
    expected = [round((cycle * length + round(Fraction(span * i, 7))) / 6)
                for cycle in range(100) for i in range(7)
                if cycle * length + round(Fraction(span * i, 7)) < 15000 * 6]
    actual = [at for at, _ in attacks(capture)]
    assert len(actual) == len(expected)
    # Audio blocks can round a half-sample on either side; the musical clock
    # remains exact and the error must never accumulate across cycles.
    assert all(abs(at - wanted) <= 1 for at, wanted in zip(actual, expected))


def test_export_estimates_include_every_ratchet_and_arpeggiator_input():
    from backend.app.models.export import _estimate_note_track_events, _estimate_arpeggiator_events
    from backend.app.models.session import SessionArpeggiatorConfig
    _, _, config = make_runtime([hit(8)])
    bounds = {'playback_start_subunit': 0, 'playback_end_subunit': 20160}
    count, activity = _estimate_note_track_events(config.tracks[0], **bounds)
    assert count == 16
    assert len(activity) == 16
    assert [at for at, kind, _ in activity if kind == 'on'] == [630 * i for i in range(8)]
    arp = SessionArpeggiatorConfig(arpeggiator_id='arp', enabled=True, input_channel=1, target_channel=2,
                                  processing_mode='bypass')
    assert _estimate_arpeggiator_events(arp, activity, **bounds) == 16 + 256


def test_independent_manual_roll_survives_arranger_start_stop_and_seek():
    from backend.app.models.session import SessionDeviceTransportRequest
    runtime, capture, config = make_runtime([hit(end=40)])
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
    roll = runtime._ratchet_rolls['manual']
    for action in ('play', 'stop'):
        runtime.device_transport(SessionDeviceTransportRequest(action=action, arranger=True, position_step=8 if action == 'play' else None))
        assert runtime._ratchet_rolls['manual'] is roll
    advance(runtime, capture, 1000)
    assert attacks(capture) == [(0, 100), (210, 80), (420, 60), (630, 40)]


def test_audition_end_cancels_unfinished_roll():
    from backend.app.models.session import SessionAuditionRequest
    runtime, capture, config = make_runtime([hit()])
    runtime.stop()
    config.tracks[0].enabled = False
    runtime.configure(config)
    runtime.audition(SessionAuditionRequest(action='preview_start', track_ids=['lead'],
        sequence=[0], gesture_id='ratchet-preview', revision=1))
    advance(runtime, capture, 300)
    assert attacks(capture) == [(0, 100), (210, 100)]
    runtime.audition(SessionAuditionRequest(action='preview_end', track_ids=['lead'],
        gesture_id='ratchet-preview', revision=2))
    advance(runtime, capture, 1000)
    assert len(attacks(capture)) == 2
    assert not runtime._ratchet_rolls


def test_ratchets_keep_source_ownership_when_muted_on_shared_pitch():
    from backend.app.engine.lane_output import LaneOutputGate
    runtime, capture, config = make_runtime([hit()])
    other = config.tracks[0].model_copy(deep=True, update={'track_id': 'other'})
    config.tracks.append(other)
    gate = LaneOutputGate()
    gate.configure(config)
    def send(_selector, message, *, delivery_delay_seconds, source_context):
        if gate.allows(f'lane:{source_context.source_id}', message):
            capture.send_scheduled_message(_selector, message, delivery_delay_seconds=delivery_delay_seconds)
    capture.send_scheduled_message_with_context = send
    runtime.configure(config)
    advance(runtime, capture, 300)
    gate.apply(1, {'lead': {'mute': True, 'solo': False}})
    advance(runtime, capture, 1000)
    assert attacks(capture) == [(0, 100), (0, 100), (210, 100), (210, 100), (420, 100), (630, 100)]
    assert notes(capture)[-1] == (840, (0x80, 36, 0))
    assert not runtime._active_notes['lead'] and not runtime._active_notes['other']


def test_export_estimate_includes_early_roll_in_a_partial_step_range():
    from backend.app.models.export import _estimate_note_track_events
    _, _, config = make_runtime([None, hit(8, offset=-50)])
    count, _ = _estimate_note_track_events(config.tracks[0],
        playback_start_subunit=2520, playback_end_subunit=5040)
    assert count >= 8  # Four attacks at 2520, 3150, 3780, 4410, each with a release.


def test_one_hit_ignores_retained_ramp_and_repeats_at_song_loop():
    runtime, capture, config = make_runtime([hit(1, end=0)])
    config.playback_loop, config.playback_end_step = True, 8
    runtime.configure(config)
    advance(runtime, capture, 7400)
    assert attacks(capture) == [(0, 100), (3360, 100), (6720, 100)]
