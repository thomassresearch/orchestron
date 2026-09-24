from unittest.mock import patch

import pytest

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime import SessionSequencerRuntime


class Capture:
    output_name = "test"

    def __init__(self):
        self.sample = 0
        self.events = []

    def send_scheduled_messages(self, _selector, messages, *, delivery_delay_seconds):
        at = self.sample + round((delivery_delay_seconds or 0) * 6720)
        self.events.extend((at, tuple(message)) for message in messages)
        return self.output_name

    def send_scheduled_message(self, selector, message, *, delivery_delay_seconds):
        return self.send_scheduled_messages(selector, [message], delivery_delay_seconds=delivery_delay_seconds)


def make_runtime(steps, *, mode="render_driven", pads=None, **track_options):
    capture = Capture()
    runtime = SessionSequencerRuntime("timing", capture, "internal:loopback", (1,), lambda *_: None, clock_mode=mode)
    config = SessionSequencerConfigRequest.model_validate({
        "playback_end_step": 24,
        "tracks": [{"track_id": "lead", "length_beats": 1,
                    "pads": pads or [{"pad_index": 0, "length_beats": 1, "steps": steps}], **track_options}],
    })
    runtime.configure(config)
    with runtime._lock:
        runtime._apply_absolute_subunit_locked(runtime._config, 0)
        runtime._running = True
    return runtime, capture, config


def advance(runtime, capture, until):
    if runtime._clock_mode == "render_driven":
        while runtime._running and capture.sample < until:
            count = min(137, until - capture.sample)
            runtime.advance_render_block(sample_rate=6720, ksmps=count, block_start_sample=capture.sample)
            capture.sample += count
    else:
        with patch("backend.app.services.sequencer_runtime.time.perf_counter", side_effect=lambda: capture.sample / 6720):
            while runtime._running and runtime._absolute_subunit < until * 6:
                capture.sample = runtime._absolute_subunit / 6
                runtime._perform_subunit_event(runtime._config, runtime._absolute_subunit, scheduled_time=capture.sample / 6720)


def notes(capture):
    return [(at, message) for at, message in capture.events if message[0] & 0xF0 in (0x90, 0x80)]


@pytest.mark.parametrize("mode", ["render_driven", "wall_clock"])
@pytest.mark.parametrize("offset", [-50, -20, 20, 50])
def test_offsets_move_attack_and_release_together(mode, offset):
    runtime, capture, _ = make_runtime([None, {"note": [60, 64], "timing_offset_percent": offset}, None, None], mode=mode)
    advance(runtime, capture, 2500)
    shift = round(840 * offset / 100)
    assert notes(capture) == [(840 + shift, (0x90, 60, 100)), (840 + shift, (0x90, 64, 100)),
                              (1680 + shift, (0x80, 60, 0)), (1680 + shift, (0x80, 64, 0))]


def test_hold_length_and_earlier_next_attack_clip_previous_note():
    runtime, capture, _ = make_runtime([{"note": 60, "timing_offset_percent": 20}, {"hold": True},
                                       {"note": 64, "timing_offset_percent": -20}, None])
    advance(runtime, capture, 2800)
    assert notes(capture) == [(168, (0x90, 60, 100)), (1512, (0x80, 60, 0)),
                              (1512, (0x90, 64, 100)), (2352, (0x80, 64, 0))]


@pytest.mark.parametrize("mode", ["render_driven", "wall_clock"])
def test_early_first_note_clamps_on_start_and_anticipates_repeat_once(mode):
    runtime, capture, _ = make_runtime([{"note": 60, "timing_offset_percent": -25}, None, None, None], mode=mode)
    advance(runtime, capture, 5000)
    assert notes(capture) == [(0, (0x90, 60, 100)), (840, (0x80, 60, 0)),
                              (3150, (0x90, 60, 100)), (3990, (0x80, 60, 0))]


@pytest.mark.parametrize("action", ["pad", "stop", "pause", "end"])
def test_early_first_note_does_not_anticipate_a_different_pad_or_stop(action):
    runtime, capture, config = make_runtime([], pads=[
        {"pad_index": 0, "length_beats": 1, "steps": [{"note": 60, "timing_offset_percent": -25}]},
        {"pad_index": 1, "length_beats": 1, "steps": [{"note": 72, "timing_offset_percent": -25}]},
    ], pad_loop_enabled=action == "pause", pad_loop_sequence=[0, -1])
    if action == "pad":
        runtime.queue_pad("lead", 1)
    elif action == "stop":
        runtime._config.tracks["lead"].queued_enabled = False
    elif action == "end":
        config.playback_end_step = 8
        runtime.configure(config)
    advance(runtime, capture, 4000)
    attacks = [(at, msg[1]) for at, msg in notes(capture) if msg[0] == 0x90]
    assert attacks == ([(0, 60), (3360, 72)] if action == "pad" else [(0, 60)])


def test_equal_time_neighboring_notes_use_later_step():
    runtime, capture, _ = make_runtime([None, {"note": 60, "timing_offset_percent": 50},
                                       {"note": 64, "timing_offset_percent": -50}, None])
    advance(runtime, capture, 2500)
    assert notes(capture) == [(1260, (0x90, 64, 100)), (2100, (0x80, 64, 0))]


def test_live_edit_does_not_replay_a_shifted_note_or_release_its_successor():
    runtime, capture, config = make_runtime([None, {"note": 60, "timing_offset_percent": -20},
                                            {"note": 64, "timing_offset_percent": -20}, None])
    advance(runtime, capture, 750)
    config.tracks[0].pads[0].steps[1].timing_offset_percent = 20
    runtime.configure(config)
    advance(runtime, capture, 3000)
    assert [msg[1] for _, msg in notes(capture) if msg[0] == 0x90] == [60, 64]
    assert notes(capture)[-1] == (2352, (0x80, 64, 0))


@pytest.mark.parametrize("grid,numerator,denominator", [(2, 1, 1), (4, 3, 2), (8, 7, 4)])
def test_musical_timing_with_grid_and_beat_ratios_does_not_drift(grid, numerator, denominator):
    runtime, capture, _ = make_runtime([None, {"note": 60, "timing_offset_percent": -20}],
        timing={"steps_per_beat": grid, "beat_rate_numerator": numerator, "beat_rate_denominator": denominator})
    advance(runtime, capture, 10000)
    span = 3360 * denominator // (numerator * grid)
    length = 3360 * denominator // numerator
    attacks = [at for at, msg in notes(capture) if msg[0] == 0x90]
    assert attacks == [span - round(span / 5) + length * i for i in range(len(attacks))]


def test_hold_duration_across_pad_change():
    runtime, capture, _ = make_runtime([], pad_loop_enabled=True, pad_loop_sequence=[0, 1], pads=[
        {"pad_index": 0, "length_beats": 1, "steps": [None, None, {"note": 60, "timing_offset_percent": 20}, {"hold": True}]},
        {"pad_index": 1, "length_beats": 1, "steps": [{"hold": True}, None, None, None]},
    ])
    advance(runtime, capture, 5000)
    assert notes(capture) == [(1848, (0x90, 60, 100)), (4368, (0x80, 60, 0))]


def test_early_first_note_across_arranger_loop_does_not_double_trigger():
    runtime, capture, config = make_runtime([{"note": 60, "timing_offset_percent": -25}, None, None, None])
    config.playback_end_step = 8
    config.playback_loop = True
    runtime.configure(config)
    advance(runtime, capture, 7500)
    assert [at for at, msg in notes(capture) if msg[0] == 0x90] == [0, 3150, 6510]


def test_removing_offset_during_playback_preserves_owned_release():
    runtime, capture, config = make_runtime([None, {"note": 60, "timing_offset_percent": -20}, None, None])
    advance(runtime, capture, 750)
    config.tracks[0].pads[0].steps[1].timing_offset_percent = 0
    runtime.configure(config)
    advance(runtime, capture, 2500)
    assert notes(capture) == [(672, (0x90, 60, 100)), (1512, (0x80, 60, 0))]


def test_seek_cancels_owned_release_and_does_not_chase_past_attack():
    runtime, capture, _ = make_runtime([None, {"note": 60, "timing_offset_percent": -20}, None, None])
    advance(runtime, capture, 750)
    with runtime._lock:
        runtime._seek_absolute_subunit_locked(1800 * 6)
    capture.sample = 1800
    advance(runtime, capture, 3000)
    assert [msg[1] for _, msg in notes(capture) if msg[0] == 0x90] == [60]
    assert not runtime._timed_notes
