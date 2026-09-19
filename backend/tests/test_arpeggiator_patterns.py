from __future__ import annotations

from fractions import Fraction

import pytest

from backend.app.models.session import ArpeggiatorCommand, SessionArpeggiatorConfig
from backend.app.services.arpeggiator_runtime import MidiSourceContext, PerformanceMidiRouter


class Playback:
    def __init__(self, *, collect_status_events=False, **settings):
        self.sample = 0
        self.events = []
        self.router = PerformanceMidiRouter(enqueue_timestamped_midi=self.capture,
                                            current_engine_sample=lambda: self.sample,
                                            collect_status_events=collect_status_events)
        self.config = SessionArpeggiatorConfig(arpeggiator_id="arp", input_channel=2, target_channel=1,
                                              enabled=True, **settings)
        self.router.configure([self.config], tempo_bpm=120)
        if self.config.playback_mode == "arranger":
            self.router.set_transport(beat=0, running=True, sample=0)

    def capture(self, message, **kwargs):
        self.events.append((message, kwargs["target_engine_sample"]))
        return True

    def note(self, notes=(60, 64, 67), sample=0, on=True):
        for note in notes:
            self.router.route_message([0x91 if on else 0x81, note, 100 if on else 0],
                                       source="test", target_engine_sample=sample)

    def advance(self, end, block=64):
        while self.sample < end:
            stop = min(end, self.sample + block)
            self.router.advance_render_block(block_start_sample=self.sample, block_end_sample=stop, sample_rate=48000)
            self.sample = stop

    @property
    def attacks(self):
        return [(m[1], at) for m, at in self.events if m[0] == 0x90]


def test_master_sync_enters_on_next_step_and_chords_preserve_phase():
    p = Playback()
    p.note(sample=1000)
    p.note(sample=7000, on=False)
    p.note((62, 65, 69), sample=7500)
    p.advance(19000)
    assert p.attacks == [(64, 6000), (69, 12000), (62, 18000)]


@pytest.mark.parametrize("block", [1, 64, 511, 30000])
def test_swing_keeps_pair_duration_and_is_block_independent(block):
    p = Playback(swing=.5)
    p.note()
    p.advance(25000, block)
    assert [at for _, at in p.attacks] == [0, 7500, 12000, 19500, 24000]


@pytest.mark.parametrize("rate,beats", [("1/8T", Fraction(1, 3)), ("1/16T", Fraction(1, 6)), ("1/8D", Fraction(3, 4))])
def test_rational_rates_do_not_accumulate_rounding(rate, beats):
    p = Playback(rate=rate)
    p.router.configure([p.config], tempo_bpm=137)
    p.note()
    p.advance(480000, 4096)
    assert [at for _, at in p.attacks] == [round(i * beats * 48000 * 60 / 137) for i in range(len(p.attacks))]


def test_hold_replace_repeated_chord_never_toggles_off():
    p = Playback(hold_mode="replace")
    p.note()
    p.note(sample=500, on=False)
    p.note(sample=7000)
    p.note(sample=7500, on=False)
    p.note((62, 65, 69), sample=13000)
    p.advance(19000)
    assert p.router.status()[0].held_notes == [62, 65, 69]
    assert len(p.attacks) == 4


def test_hold_off_silences_rests_and_clear_cancels_pending_notes():
    p = Playback(gate_ratio=2)
    p.note()
    p.note(sample=1000, on=False)
    p.advance(7000)
    assert p.attacks == [(60, 0)]
    assert not p.router.status()[0].active_notes
    p.note(sample=12000)
    p.router.command("arp", ArpeggiatorCommand(command="clear"))
    p.advance(19000)
    assert p.attacks == [(60, 0)]


def test_same_sample_key_tap_does_not_leave_a_physically_held_note():
    p = Playback(playback_mode="live")
    p.note((60,), sample=100)
    p.note((60,), sample=100, on=False)
    p.advance(12000)
    assert p.router.status()[0].held_notes == []
    assert not p.attacks


def test_audible_status_marks_notes_and_pad_launch_at_their_engine_samples():
    p = Playback(collect_status_events=True, pads=[{"steps": [{"kind": "next"}] * 4}, {"pattern": "down"}])
    p.note(sample=1000)
    p.advance(2000)
    p.router.command("arp", ArpeggiatorCommand(command="launch", pad_index=1))
    p.advance(25000)
    markers = p.router.drain_render_status_events()
    statuses = [(event.engine_sample, event.payload["arpeggiators"][0]) for event in markers]
    assert any(sample == 6000 and status["active_notes"] for sample, status in statuses)
    assert any(status["queued_pad"] == 1 for _, status in statuses)
    assert any(sample == 24000 and status["active_pad"] == 1 and status["manual_override"] for sample, status in statuses)
    assert p.router.drain_render_status_events() == []


def test_down_orders_complete_octave_range():
    p = Playback(pattern="down", octaves=2)
    p.note()
    p.advance(31000)
    assert [note for note, _ in p.attacks] == [79, 76, 72, 67, 64, 60]


def test_rhythm_rests_ties_positions_and_ratchets():
    p = Playback(pads=[{"steps": [{"kind": "position", "note_position": 2}, {"kind": "tie"},
                                  {"kind": "rest"}, {"kind": "chord", "ratchets": 2}]}])
    p.note()
    p.advance(24000)
    assert p.attacks == [(64, 0), (60, 18000), (64, 18000), (67, 18000),
                         (60, 21000), (64, 21000), (67, 21000)]
    assert ([0x80, 64, 0], 12000) in p.events


def test_rhythm_wrap_does_not_reset_note_order_and_same_pad_continues():
    p = Playback(pads=[{"length_beats": 1, "steps": [{"kind": "next"}] * 5}], pad_loop_sequence=[0, 0])
    p.note()
    p.advance(61000)
    assert [n for n, _ in p.attacks] == [60, 64, 67, 60, 64, 67, 60, 64, 67, 60, 64]


def test_changed_pad_and_pause_boundaries_apply_within_large_block():
    p = Playback(pads=[{"length_beats": 1}, {"length_beats": 1, "pattern": "down"}], pad_loop_sequence=[0, -1, 1])
    p.note()
    p.advance(61000, 61000)
    assert p.attacks == [(60, 0), (64, 6000), (67, 12000), (60, 18000), (67, 48000), (64, 54000), (60, 60000)]


def test_launch_takes_over_and_return_restores_arrangement():
    p = Playback(pads=[{"steps": [{"kind": "next"}] * 4}, {"pattern": "down"}])
    p.note()
    p.advance(1000)
    p.router.command("arp", ArpeggiatorCommand(command="launch", pad_index=1))
    p.advance(25000)
    assert p.attacks[-1] == (67, 24000)
    assert p.router.status()[0].manual_override
    p.router.command("arp", ArpeggiatorCommand(command="arrangement"))
    p.advance(31000)
    assert p.router.status()[0].active_pad == 0
    assert not p.router.status()[0].manual_override


def test_arranger_stop_releases_hold_but_live_arp_keeps_running():
    for mode in ("live", "arranger"):
        p = Playback(playback_mode=mode, hold_mode="replace")
        p.note()
        p.advance(1000)
        p.router.set_transport(beat=Fraction(1, 24), running=False, sample=1000)
        p.advance(13000)
        assert len(p.attacks) == (3 if mode == "live" else 1)


def test_seed_is_reproducible_and_preview_does_not_change_music():
    outputs = []
    for block, read_preview in ((64, False), (64, True), (4096, True)):
        p = Playback(pattern="random", probability=.7, humanize_ms=4, humanize_velocity=10,
                     scale_mode="custom", scale_root="D", mode="dorian")
        p.note()
        p.advance(1)
        if read_preview:
            for _ in range(3):
                assert p.router.status()[0].preview_degrees
        p.advance(193000, block)
        outputs.append(p.events)
    assert outputs[0] == outputs[1] == outputs[2]


@pytest.mark.parametrize("mode,notes", [
    ("ionian", [60, 62, 64, 65, 67, 69, 71]),
    ("dorian", [60, 62, 63, 65, 67, 69, 70]),
    ("phrygian", [60, 61, 63, 65, 67, 68, 70]),
    ("lydian", [60, 62, 64, 66, 67, 69, 71]),
    ("mixolydian", [60, 62, 64, 65, 67, 69, 70]),
    ("aeolian", [60, 62, 63, 65, 67, 68, 70]),
    ("locrian", [60, 61, 63, 65, 66, 68, 70]),
])
def test_preview_degrees_cover_every_mode_and_repeat_across_octaves(mode, notes):
    p = Playback(pads=[{"scale_mode": "custom", "scale_root": "C", "mode": mode,
                        "octaves": 2, "steps": [{"kind": "next"}] * 14}])
    p.note(notes)
    p.advance(1)
    status = p.router.status()[0]
    assert status.preview_notes == [[note] for note in notes + [note + 12 for note in notes]]
    assert status.preview_degrees == [[degree] for degree in list(range(1, 8)) * 2]


@pytest.mark.parametrize("transpose,notes,expected_notes,expected_degrees", [
    (1, [60, 61, 66], [60, 62, 67], [1, 2, 5]),
    (24, [127], [127], [5]),
    (-24, [0], [0], [1]),
])
def test_preview_degrees_use_final_transposed_quantized_pitch(transpose, notes, expected_notes, expected_degrees):
    p = Playback(pads=[{"scale_mode": "custom", "scale_root": "C", "mode": "ionian",
                        "transpose": transpose, "steps": [{"kind": "chord"}]}])
    p.note(notes)
    p.advance(1)
    status = p.router.status()[0]
    assert status.preview_notes == [expected_notes]
    assert status.preview_degrees == [expected_degrees]


@pytest.mark.parametrize("scale_mode,expected_degrees", [
    ("source", [1, 1, 4]), ("custom", [5, 1, 5]), ("off", [None, None, None]),
])
def test_preview_degrees_follow_each_source_or_use_the_pad_scale(scale_mode, expected_degrees):
    p = Playback(pads=[{"scale_mode": scale_mode, "scale_root": "F", "mode": "lydian",
                        "steps": [{"kind": "chord"}, {"kind": "rest"}, {"kind": "tie"}]}])
    for note, context in [(60, MidiSourceContext(source_id="a", scale_root="C", mode="ionian")),
                          (65, None),
                          (72, MidiSourceContext(source_id="b", scale_root="G", mode="mixolydian"))]:
        p.router.route_message([0x91, note, 100], source="test", target_engine_sample=0, source_context=context)
    p.advance(1)
    status = p.router.status()[0]
    assert status.preview_notes == [[60, 65, 72], [], []]
    assert status.preview_degrees == [expected_degrees, [], []]
    p.router.command("arp", ArpeggiatorCommand(command="clear"))
    assert p.router.status()[0].preview_notes == [[], [], []]
    assert p.router.status()[0].preview_degrees == [[], [], []]


def test_preview_degrees_change_with_the_playing_pad():
    p = Playback(pads=[{"scale_mode": "custom", "scale_root": "C", "mode": "ionian",
                        "steps": [{"kind": "next"}]},
                       {"scale_mode": "custom", "scale_root": "F", "mode": "lydian",
                        "steps": [{"kind": "next"}]}])
    p.note([60])
    p.advance(1)
    assert p.router.status()[0].preview_degrees == [[1]]
    p.router.command("arp", ArpeggiatorCommand(command="launch", pad_index=1))
    p.advance(6001)
    status = p.router.status()[0]
    assert status.active_pad == 1
    assert status.preview_notes == [[60]]
    assert status.preview_degrees == [[5]]


def test_bypass_balances_notes_on_mode_change():
    p = Playback(processing_mode="bypass")
    p.note(sample=1000)
    p.advance(2000)
    assert p.attacks == [(60, 1000), (64, 1000), (67, 1000)]
    p.router.configure([p.config.model_copy(update={"processing_mode": "mute"})], tempo_bpm=120)
    p.advance(7000)
    assert sum(m[0] == 0x80 for m, _ in p.events) == 3


def test_seek_with_swing_joins_delayed_subdivision_and_loop_reconstructs_phrase():
    p = Playback(swing=.5)
    p.note()
    p.advance(1000)
    p.router.set_transport(beat=Fraction(3, 10), running=True, sample=1000)
    p.advance(8000)
    assert p.attacks[1] == (64, 1300)  # Beat .3125 remains ahead of the seek.
    p.router.set_transport(beat=0, running=True, sample=8000)
    p.advance(16000)
    assert (60, 8000) in p.attacks
    assert (64, 15500) in p.attacks


def test_first_note_restart_changes_rhythm_without_moving_clock():
    p = Playback(restart_mode="first_note", pads=[{"steps": [{"kind": "chord"}, {"kind": "rest"}, {"kind": "next"}]}])
    p.note(sample=1000)
    p.note(sample=7000, on=False)
    p.note((62, 65), sample=9000)
    p.advance(13000)
    assert p.attacks == [(60, 6000), (64, 6000), (67, 6000), (62, 12000), (65, 12000)]


def test_beat_restart_and_pause_resume_do_not_emit_overdue_bursts():
    p = Playback(restart_mode="beat", pads=[{"length_beats": 1, "steps": [{"kind": "position", "note_position": 3}, {"kind": "rest"}]}], pad_loop_sequence=[0, -1, 0])
    p.note()
    p.advance(61000, 61000)
    assert p.attacks == [(67, 0), (67, 12000), (67, 48000), (67, 60000)]


def test_live_stop_restarts_clock_on_next_input_and_rate_edit_keeps_subdivisions():
    p = Playback(playback_mode="live")
    p.note()
    p.advance(7000)
    p.router.configure([p.config.model_copy(update={"enabled": False})], tempo_bpm=120)
    p.advance(80000)
    p.router.configure([p.config], tempo_bpm=120)
    p.note((65,), sample=81000)
    p.advance(82000)
    assert p.attacks[-1] == (65, 81000)
    pads = [pad.model_copy(update={"rate": "1/4"}) for pad in p.config.pads]
    p.router.configure([p.config.model_copy(update={"pads": pads})], tempo_bpm=120)
    p.advance(110000)
    assert p.attacks[-1] == (65, 105000)


def test_tempo_change_preserves_beat_and_random_repeat_is_per_cycle():
    p = Playback(pattern="random")
    p.note()
    p.advance(192000)
    assert [n for n, _ in p.attacks[:16]] == [n for n, _ in p.attacks[16:32]]
    p.router.configure([p.config], tempo_bpm=60)
    p.advance(217000)
    assert [at for _, at in p.attacks[-3:]] == [192000, 204000, 216000]


def test_scale_and_toggle_hold_use_incoming_pitches():
    p = Playback(hold_mode="toggle", pads=[{"scale_mode": "custom", "scale_root": "C", "mode": "ionian", "steps": [{"kind": "position", "note_position": 5}]}])
    p.note((61, 66))
    p.note((61, 66), sample=1000, on=False)
    p.note((61,), sample=2000)
    p.advance(7000)
    assert p.router.status()[0].held_notes == [66]
    assert p.attacks == [(60, 0), (65, 6000)]


def test_arranger_definition_audition_boundary_pause_return_and_stop():
    from backend.app.models.session import SessionAuditionRequest
    p = Playback(playback_mode="arranger", pad_loop_enabled=True, pad_loop_repeat=False,
                 pad_loop_sequence=[0, -4, 0], collect_status_events=True)
    p.note()
    p.advance(24000)
    original = p.config.model_dump()
    p.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[1, -2]))
    assert p.router.audition_status()["arp"]["queued"] == "start"
    p.advance(96001)
    assert p.router.status()[0].active_pad == 1
    assert p.router.audition_status()["arp"]["active"]
    p.router.audition(SessionAuditionRequest(action="return", arpeggiator_id="arp"))
    p.advance(192001)
    assert not p.router.audition_status()
    assert p.router.status()[0].active_pad == 0
    assert p.config.model_dump() == original
    p.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[0]))
    p.router.audition(SessionAuditionRequest(action="stop", arpeggiator_id="arp"))
    p.advance(200001)
    assert p.router.status()[0].state == "stopped"
    assert not p.router.audition_status()


def test_arranger_momentary_preview_returns_immediately_into_rest_and_preserves_latched_audition():
    from backend.app.models.session import SessionAuditionRequest
    p = Playback(playback_mode="arranger", pad_loop_enabled=True, pad_loop_repeat=False, pad_loop_sequence=[0, -4, 0])
    p.note()
    p.advance(24000)
    start = SessionAuditionRequest(action="preview_start", arpeggiator_id="arp", sequence=[1], gesture_id="hold", revision=1)
    end = SessionAuditionRequest(action="preview_end", arpeggiator_id="arp", gesture_id="hold", revision=2)
    p.router.audition(start)
    assert p.router.status()[0].active_pad == 0
    assert p.router.audition_status()["arp"]["queued"] == "start"
    assert not p.router.audition_status()["arp"]["preview_active"]
    p.advance(96001)
    assert p.router.status()[0].active_pad == 1
    assert p.router.audition_status()["arp"]["preview_gesture"] == "hold"
    p.advance(120000)
    p.router.audition(end)
    assert p.router._states["arp"].paused
    assert not p.router.audition_status()
    p.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[2]))
    p.advance(192001)
    p.router.audition(start.model_copy(update={"revision": 3}))
    p.router.audition(end.model_copy(update={"revision": 4}))
    assert p.router._states["arp"].audition_sequence == (2,)
    assert p.router.status()[0].active_pad == 2
    with pytest.raises(ValueError, match="Stale"):
        p.router.audition(start)
    p.router.clear_auditions(stop=True)
    p.router.audition(end.model_copy(update={"revision": 5}))
    assert p.router.status()[0].state == "stopped"


def test_stopped_arranger_audition_uses_shared_seek_and_keeps_live_mode_separate():
    from backend.app.models.session import SessionAuditionRequest
    p = Playback(playback_mode="arranger")
    p.router.set_transport(beat=0, running=False, sample=0)
    p.advance(1)
    p.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[1, -2]))
    p.note()
    p.advance(24001)
    p.router.transport_discontinuity(10, sample=p.sample)
    p.advance(24002)
    assert p.router.status()[0].active_pad == 1
    assert p.router.status()[0].pad_loop_position == 0
    live = Playback(playback_mode="live")
    with pytest.raises(ValueError, match="Arranger"):
        live.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[0]))


def test_disabled_arranger_audition_waits_for_shared_boundary():
    from backend.app.models.session import SessionAuditionRequest
    p = Playback(playback_mode="arranger")
    p.router.configure([p.config.model_copy(update={"enabled": False})], tempo_bpm=120)
    p.advance(24000)
    p.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[1]))
    assert p.router.audition_status()["arp"] == {"active": False, "queued": "start"}
    p.advance(96001)
    assert p.router.audition_status()["arp"] == {"active": True, "queued": None}
    assert p.router.status()[0].active_pad == 1


def test_seek_applies_queued_audition_replacement_at_destination():
    from backend.app.models.session import SessionAuditionRequest
    p = Playback(playback_mode="arranger")
    p.advance(24000)
    p.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[1, -2]))
    p.router.transport_discontinuity(10, sample=p.sample)
    p.advance(24001)
    assert p.router.audition_status()["arp"] == {"active": True, "queued": None}
    assert p.router.status()[0].active_pad == 1
    p.router.audition(SessionAuditionRequest(action="start", arpeggiator_id="arp", sequence=[2]))
    p.router.transport_discontinuity(12, sample=p.sample)
    p.advance(24002)
    assert p.router.status()[0].active_pad == 2


def test_cancel_queued_preview_preserves_arpeggiator_then_stopped_preview_launches_immediately():
    from backend.app.models.session import SessionAuditionRequest
    p = Playback(playback_mode="arranger")
    p.note()
    p.advance(24000)
    before = list(p.events)
    start = SessionAuditionRequest(action="preview_start", arpeggiator_id="arp", sequence=[1], gesture_id="hold", revision=1)
    end = SessionAuditionRequest(action="preview_end", arpeggiator_id="arp", gesture_id="hold", revision=2)
    p.router.audition(start)
    p.router.audition(end)
    assert p.events == before
    assert not p.router.audition_status()
    p.router.set_transport(beat=1, running=False, sample=p.sample)
    p.advance(24001)
    p.router.audition(start.model_copy(update={"revision": 3}))
    assert not p.router.arranger_running
    assert p.router.audition_status()["arp"]["preview_active"]
    assert p.router.status()[0].active_pad == 1
    p.router.audition(end.model_copy(update={"revision": 4}))
    assert p.router.status()[0].state == "stopped"


def temporary(action="workspace_start", revision=1, sequence=(1, -1, 2), gesture="workspace"):
    from backend.app.models.session import SessionAuditionRequest
    return SessionAuditionRequest(action=action, revision=revision, sequence=list(sequence) if action.endswith("start") else [],
                                  gesture_id=gesture, arpeggiator_id="arp")


@pytest.mark.parametrize("quantize,boundary", [("cycle", 96000), ("bar", 96000)])
@pytest.mark.parametrize("action", ["workspace_start", "preview_start"])
def test_live_temporary_launch_quantizes_and_cancel_does_not_release(quantize, boundary, action):
    p = Playback(playback_mode="live", launch_quantize=quantize)
    # A two-beat rhythm distinguishes cycle from bar without changing pad duration.
    if quantize == "cycle":
        pads = list(p.config.pads)
        pads[0] = pads[0].model_copy(update={"steps": pads[0].steps[:8]})
        p.config = p.config.model_copy(update={"pads": pads})
        p.router.configure([p.config], tempo_bpm=120)
        boundary = 48000
    p.note()
    p.advance(12000)
    before = list(p.events)
    p.router.audition(temporary(action))
    assert p.router.audition_status()["arp"]["queued"] == "start"
    p.router.audition(temporary(action.replace("start", "end"), 2))
    assert p.events == before
    p.router.audition(temporary(action, 3))
    p.advance(boundary)
    assert p.router.status()[0].active_pad == 0
    p.advance(boundary + 1)
    assert p.router.status()[0].active_pad == 1


@pytest.mark.parametrize("mode", ["live", "arranger"])
def test_workspace_nested_restore_keeps_phase_current_chord_and_saved_config(mode):
    p = Playback(playback_mode=mode)
    p.note()
    p.advance(12000)
    original = p.config.model_dump()
    p.router.audition(temporary())
    p.advance(96001)
    assert p.router.audition_status()["arp"]["workspace_active"]
    p.router.audition(temporary("preview_start", sequence=(3,), gesture="speaker"))
    p.advance(192001)
    assert p.router.status()[0].active_pad == 3
    assert p.router.audition_status()["arp"]["workspace_position"] is None
    p.note(sample=193000, on=False)
    p.note((62, 65), sample=193001)
    p.advance(230000)
    p.router.audition(temporary("preview_end", 2, gesture="speaker"))
    assert p.router.status()[0].active_pad == 2
    assert p.router.audition_status()["arp"]["workspace_position"] == 2
    assert p.router.status()[0].held_notes == [62, 65]
    p.router.audition(temporary("workspace_end", 2))
    assert p.router.status()[0].active_pad == 0
    assert p.router._states["arp"].anchor_beat == 0
    assert p.router.status()[0].held_notes == [62, 65]
    assert p.router._states["arp"].config.model_dump() == original
    p.advance(240001)
    assert p.attacks[-1][1] == 240000
    assert not p.router.audition_status()


@pytest.mark.parametrize("mode", ["live", "arranger"])
def test_stopped_workspace_accepts_notes_without_authored_enablement(mode):
    p = Playback(playback_mode=mode)
    p.config = p.config.model_copy(update={"enabled": False})
    p.router.configure([p.config], tempo_bpm=120)
    p.router.set_transport(beat=0, running=False)
    p.advance(1)
    p.router.audition(temporary(sequence=(1,)))
    p.note(sample=10)
    p.advance(12001)
    assert p.attacks and p.router.status()[0].held_notes == [60, 64, 67]
    assert not p.router.status()[0].enabled
    p.router.audition(temporary("workspace_end", 2))
    assert p.router.status()[0].state == "stopped"
    count = len(p.attacks)
    p.advance(24001)
    assert len(p.attacks) == count
    p.router.configure([p.config.model_copy(update={"enabled": True})], tempo_bpm=120)
    if mode == "live":
        assert p.router._running(p.router._states["arp"])


def test_hidden_workspace_edits_use_hidden_boundary_and_audible_markers_include_repeats():
    p = Playback(playback_mode="live", collect_status_events=True)
    p.router.audition(temporary(sequence=(-1, 0)))  # No established clock: immediate.
    p.router.audition(temporary("preview_start", sequence=(3,), gesture="speaker"))
    p.advance(24001)
    p.router.audition(temporary(revision=2, sequence=(1, 1, -1)))
    p.advance(120001)  # Hidden edit applies at beat five.
    p.router.audition(temporary(revision=3, sequence=(2, -1)))
    p.advance(220000)
    p.router.audition(temporary("preview_end", 2, gesture="speaker"))
    state = p.router._states["arp"]
    assert state.audition_sequence == (2, -1)
    assert state.audition_origin == 9
    assert state.pad_loop_position == 0
    p.router.audition(temporary("workspace_end", 4))
    p.router.audition(temporary(revision=5, sequence=(1, 1, -1)))
    p.advance(440001)
    positions = [event.payload.get("auditions", {}).get("arp", {}).get("workspace_position") for event in p.router.drain_render_status_events()]
    assert 0 in positions and 1 in positions and 2 in positions


def test_workspace_stop_transport_and_configuration_cancel_without_late_restore():
    for change in ("workspace", "transport", "routing", "mode"):
        p = Playback(playback_mode="live")
        p.note()
        p.advance(1)
        p.router.audition(temporary())
        p.advance(96001)
        p.router.audition(temporary("preview_start", gesture="speaker"))
        p.advance(192001)
        if change == "workspace":
            p.router.audition(temporary("workspace_end", 2))
        elif change == "transport":
            p.router.clear_auditions(stop=True)
        else:
            updates = {"target_channel": 3} if change == "routing" else {"playback_mode": "arranger"}
            p.router.configure([p.config.model_copy(update=updates)], tempo_bpm=120)
        p.router.audition(temporary("preview_end", 2, gesture="speaker"))
        p.router.audition(temporary("workspace_end", 3))
        assert not p.router.audition_status()
        if change in {"workspace", "transport"}:
            assert p.router._running(p.router._states["arp"])
            assert p.router._states["arp"].anchor_beat == 0
        with pytest.raises(ValueError, match="Stale"):
            p.router.audition(temporary())


def test_zero_velocity_is_silent_in_arpeggiator_workspace():
    p = Playback(playback_mode="live")
    pads = [pad.model_copy(update={"steps": [step.model_copy(update={"velocity": 0}) for step in pad.steps]}) for pad in p.config.pads]
    p.router.configure([p.config.model_copy(update={"pads": pads})], tempo_bpm=120)
    p.router.audition(temporary(sequence=(0,)))
    p.note()
    p.advance(30000)
    assert not p.attacks


def test_first_live_note_during_preview_establishes_restored_pulse():
    p = Playback(playback_mode="live")
    p.router.audition(temporary())
    p.note((60,), sample=1000)
    p.advance(12000)
    p.router.audition(temporary("workspace_end", 2))
    assert p.router._states["arp"].anchor_beat == Fraction(1, 24)
    p.advance(19001)
    assert p.attacks[-1] == (60, 19000)


def test_disabled_device_consumes_note_releases_after_audition():
    p = Playback(playback_mode="live")
    p.router.configure([p.config.model_copy(update={"enabled": False})], tempo_bpm=120)
    p.router.audition(temporary())
    p.note((60,))
    p.advance(1000)
    p.router.audition(temporary("workspace_end", 2))
    p.note((60,), sample=1001, on=False)
    p.advance(2000)
    assert not p.router._states["arp"].physical_notes
    assert not p.router.status()[0].held_notes


def test_live_workspace_output_owns_notes_independently_on_shared_channel():
    from backend.app.engine.midi_scheduler import EngineMidiScheduler
    scheduler = EngineMidiScheduler()
    p = Playback(playback_mode="live")
    p.router._enqueue_timestamped_midi = lambda message, **kwargs: scheduler.enqueue(message, **kwargs)[0]
    p.router.audition(temporary())
    scheduler.enqueue([0x90, 60, 100], source="lane:other", target_engine_sample=0)
    p.note((60,))
    p.advance(1)
    attacks = scheduler.drain_block(block_start_sample=0, block_end_sample=1)
    assert {event.source for event in attacks} == {"lane:other", "lane:arp"}
    p.router.audition(temporary("workspace_end", 2))
    scheduler.release_sources({"lane:arp"}, sample=1)
    assert scheduler.drain_block(block_start_sample=1, block_end_sample=2) == []
    scheduler.enqueue([0x80, 60, 0], source="lane:other", target_engine_sample=2)
    assert len(scheduler.drain_block(block_start_sample=2, block_end_sample=3)) == 1


def test_workspace_edits_apply_while_speaker_is_still_waiting_for_live_cycle():
    p = Playback(playback_mode="live")
    pads = [pad.model_copy(update={"length_beats": 1}) for pad in p.config.pads]
    p.router.configure([p.config.model_copy(update={"pads": pads})], tempo_bpm=120)
    p.router.audition(temporary(sequence=(0, 0)))
    p.note((60,))
    p.advance(1000)
    p.router.audition(temporary("preview_start", sequence=(3,), gesture="speaker"))
    p.router.audition(temporary(revision=2, sequence=(1,)))
    p.advance(24001)
    assert p.router.status()[0].active_pad == 1
    status = p.router.audition_status()["arp"]
    assert not status["preview_active"] and status["workspace_sequence"] == [1]
    p.router.audition(temporary("preview_end", 2, gesture="speaker"))
    assert p.router.status()[0].active_pad == 1
    assert p.router._states["arp"].audition_origin == 1
