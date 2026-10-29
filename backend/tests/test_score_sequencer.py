"""Independent score voices, transport transitions and prepared live edits."""
import pytest
from pydantic import ValidationError
from backend.app.models.session import SessionSequencerConfigRequest, SessionScoreNoteConfig
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.tests.test_sequencer_note_timing import Capture, advance, notes


def note(identity, pitch=60, start=0, duration=20160, velocity=100):
    return dict(id=identity, pitch=pitch, start_ticks=start, duration_ticks=duration, velocity=velocity)


def runtime_for(events, **options):
    capture = Capture()
    runtime = SessionSequencerRuntime('score', capture, 'internal:loopback', (1,), lambda *_: None, clock_mode='render_driven')
    config = SessionSequencerConfigRequest(score_tracks=[dict(track_id='score', length_beats=16,
        pads=[dict(pad_index=0, length_beats=16, notes=events), dict(pad_index=1, notes=[note('other',72)])], **options)], playback_end_step=128)
    runtime.configure(config)
    runtime._running = True
    return runtime, capture, config


def test_independent_durations_and_retrigger_release_ownership():
    r,c,_ = runtime_for([note('long',60,duration=40320),note('short',64,start=5040,duration=5040),note('again',60,start=20160,duration=5040)])
    advance(r,c,7000)
    assert notes(c) == [(0,(144,60,100)),(840,(144,64,100)),(1680,(128,64,0)),
                        (3360,(128,60,0)),(3360,(144,60,100)),(4200,(128,60,0))]


def test_seek_chases_remaining_duration():
    r,c,_=runtime_for([note('long',duration=40320)])
    with r._lock:
        r._seek_absolute_subunit_locked(20160)
    advance(r,c,4000)
    assert notes(c)==[(0,(144,60,100)),(3360,(128,60,0))]


def test_live_delete_release_and_past_insert_not_replayed():
    r,c,config=runtime_for([note('long',duration=40320)])
    advance(r,c,1000)
    config.score_tracks[0].pads[0].notes=[]
    r.configure(config)
    config.score_tracks[0].pads[0].notes=[SessionScoreNoteConfig(**note('new',64))]
    # Validate dictionary inputs just like a fresh API configuration.
    config=SessionSequencerConfigRequest.model_validate(config.model_dump())
    r.configure(config)
    advance(r,c,4000)
    assert notes(c)==[(0,(144,60,100)),(1000,(128,60,0))]


def test_next_bar_launch_and_score_status():
    r,c,_=runtime_for([note('long',duration=20160*12)])
    advance(r,c,1000)
    r.queue_pad('score',1)
    advance(r,c,15000)
    assert (13440,(128,60,0)) in notes(c)
    assert (13440,(144,72,100)) in notes(c)
    status=r.status()
    assert status.score_tracks[0].active_pad==1
    assert status.tracks==[]


def test_score_end_launch_waits_and_hidden_notes_survive():
    r,c,config=runtime_for([note('hidden',start=20160*20)],launch_quantization='score')
    r.queue_pad('score',1)
    advance(r,c,15000)
    assert notes(c)==[]
    assert len(config.score_tracks[0].pads[0].notes)==1


def test_score_limits_and_duplicate_ids():
    with pytest.raises(ValidationError):
        runtime_for([note('same'),note('same',64)])
    with pytest.raises(ValidationError):
        runtime_for([note('bad',duration=0)])


def test_unchanged_sustain_retains_attack_and_live_duration_updates_release():
    r, c, config = runtime_for([note("long", duration=40320)])
    advance(r, c, 1000)
    config.score_tracks[0].pads[0].notes[0].duration_ticks = 60480
    r.configure(config)
    advance(r, c, 11000)
    assert notes(c) == [(0, (144, 60, 100)), (10080, (128, 60, 0))]


def test_moving_a_sounding_note_releases_and_waits_for_future_attack():
    r, c, config = runtime_for([note("long", duration=40320)])
    advance(r, c, 1000)
    config.score_tracks[0].pads[0].notes[0].start_ticks = 20160
    r.configure(config)
    advance(r, c, 4000)
    assert notes(c) == [(0, (144, 60, 100)), (1000, (128, 60, 0)), (3360, (144, 60, 100))]


@pytest.mark.parametrize("start", [0, 5040])
def test_inserting_past_retrigger_preserves_unchanged_sounding_voice(start):
    r, c, config = runtime_for([note("long", duration=40320)])
    advance(r, c, 1000)
    config.score_tracks[0].pads[0].notes.append(SessionScoreNoteConfig(**note("new", start=start, duration=5040)))
    r.configure(config)
    advance(r, c, 7000)
    assert notes(c) == [(0, (144, 60, 100)), (6720, (128, 60, 0))]


@pytest.mark.parametrize("denominator,rate_n,rate_d", [(4, 1, 1), (8, 3, 2), (4, 7, 4)])
def test_score_ticks_ignore_editing_grid_and_follow_rational_speed(denominator, rate_n, rate_d):
    r, c, config = runtime_for([note("one", start=20160, duration=10080)], timing={
        "meter_denominator": denominator, "steps_per_beat": 3, "beat_rate_numerator": rate_n, "beat_rate_denominator": rate_d})
    advance(r, c, 9000)
    assert notes(c)[:2] == [(round(3360 * rate_d / rate_n), (144, 60, 100)),
                           (round(5040 * rate_d / rate_n), (128, 60, 0))]
    assert config.score_tracks[0].pads[0].notes[0].start_ticks == 20160


def test_queue_replacement_and_earlier_score_end():
    r, c, config = runtime_for([note("long", duration=40320)])
    config.score_tracks[0].pads[0].length_beats = 2
    r.configure(config)
    advance(r, c, 1000)
    r.queue_pad("score", 2)
    r.queue_pad("score", 1)
    advance(r, c, 7500)
    assert (6720, (144, 72, 100)) in notes(c)
    assert r.status().score_tracks[0].active_pad == 1


def test_loop_clips_release_and_chases_sustain_at_loop_start():
    r, c, config = runtime_for([note("long", duration=80640)])
    config.playback_start_step = 8
    config.playback_end_step = 16
    config.playback_loop = True
    r.configure(config)
    with r._lock:
        r._seek_absolute_subunit_locked(20160)
    advance(r, c, 7500)
    assert [at for at, msg in notes(c) if msg[0] == 144] == [0, 3360, 6720]
    assert [at for at, msg in notes(c) if msg[0] == 128] == [3360, 6720]


def test_stop_releases_all_voices_and_restart_chases_remaining_notes():
    r, c, _ = runtime_for([note("long", duration=40320), note("other", 64, duration=60480)])
    advance(r, c, 1000)
    r.stop()
    assert not r._score_states and not r._active_notes["score"]
    r.start(position_step=8)
    advance(r, c, 5000)
    assert [msg[1] for at, msg in notes(c) if at == 1000 and msg[0] == 144] == [60, 64]


def test_manual_score_retains_phase_during_arranger_seek_and_stop():
    from backend.app.models.session import SessionDeviceTransportRequest
    from backend.tests.test_sequencer_source_transport import command, advance as advance_steps
    r, _, config = runtime_for([note("long", duration=20160 * 12)])
    r._running = False
    config.tracks = SessionSequencerConfigRequest(tracks=[dict(track_id="lead", enabled=False,
        pad_loop_enabled=True, pad_loop_repeat=False, pad_loop_sequence=[0], pads=[dict(pad_index=0, steps=[67])])]).tracks
    r.configure(config)
    command(r, track="score")
    advance_steps(r, 3)
    origin = r._config.tracks["score"].phase_offset_subunit
    command(r, track=None)
    r._seek_absolute_subunit_locked(9 * 2520)
    assert r._config.tracks["score"].phase_offset_subunit == origin
    r.device_transport(SessionDeviceTransportRequest(action="stop", arranger=True))
    assert r._config.tracks["score"].enabled
    assert r._config.tracks["score"].phase_offset_subunit == origin


def test_preview_return_chases_sustain_without_restarting_manual_source():
    from backend.app.models.session import SessionAuditionRequest
    r, c, _ = runtime_for([note("long", duration=20160 * 12)])
    from backend.tests.test_sequencer_source_transport import command
    r._running = False
    command(r, track="score")
    advance(r, c, 1000)
    r.audition(SessionAuditionRequest(action="preview_start", track_ids=["score"], sequence=[1], gesture_id="score-preview", revision=1))
    advance(r, c, 2000)
    assert r.status().auditions["score"]["preview_active"]
    r.audition(SessionAuditionRequest(action="preview_end", track_ids=["score"], gesture_id="score-preview", revision=2))
    advance(r, c, 3000)
    assert [msg[1] for _, msg in notes(c) if msg[0] == 144] == [60, 72, 60]
    assert r._config.tracks["score"].phase_offset_subunit == 0


def test_shrinking_finite_arrangement_past_playhead_stops_without_rewind():
    r, c, config = runtime_for([note("long", duration=20160 * 12)], pad_loop_enabled=True, pad_loop_repeat=False, pad_loop_sequence=[0])
    advance(r, c, 12000)
    position = r._absolute_subunit
    config.score_tracks[0].pads[0].length_beats = 2
    config.playback_end_step = 16
    r.configure(config)
    assert not r.status().running
    assert r._absolute_subunit == position
    assert not r._active_notes["score"]


def test_score_lane_mute_ownership_and_arpeggiator_dependencies():
    from backend.app.engine.lane_output import LaneOutputGate
    _, _, config = runtime_for([note("long")])
    config.tracks = SessionSequencerConfigRequest(tracks=[dict(track_id="other", midi_channel=1)]).tracks
    config.arpeggiators = SessionSequencerConfigRequest(arpeggiators=[dict(arpeggiator_id="arp", input_channel=1, target_channel=2)]).arpeggiators
    gate = LaneOutputGate()
    gate.configure(config)
    assert gate.allows("lane:score", [144, 60, 100])
    assert gate.allows("lane:other", [144, 60, 100])
    gate.apply(1, {"score": {"mute": True, "solo": False}})
    assert not gate.allows("lane:score", [128, 60, 0])
    assert gate.allows("lane:other", [128, 60, 0])
    gate.apply(2, {"score": {"mute": False, "solo": True}})
    assert "arp" not in gate.blocked


def test_score_notes_route_into_arpeggiator_with_pad_harmonic_context():
    from backend.tests.test_arpeggiator_runtime import _CaptureMidi, _router, _arp_config, _advance_router
    capture = _CaptureMidi()
    router = _router(capture)
    router.configure([_arp_config(input_channel=1, target_channel=2)], tempo_bpm=120)
    _, _, config = runtime_for([note("root", 62, duration=40320), note("third", 65)])
    config.timing.tempo_bpm = 120
    config.score_tracks[0].pads[0].scale_root = "D"
    config.score_tracks[0].pads[0].mode = "dorian"
    runtime = SessionSequencerRuntime("routed-score", router, "internal:loopback", (1,), lambda *_: None, clock_mode="render_driven")
    runtime.configure(config)
    runtime.start()
    runtime.advance_render_block(sample_rate=48000, ksmps=64, block_start_sample=0)
    _advance_router(router)
    assert capture.messages[0][0] == [0x91, 62, 100]
    assert router.status()[0].held_notes == [62, 65]
    held = router._pool(router._states["arp"])[0]
    assert held.source_context.source_id == "score"
    assert held.source_context.scale_root == "D"
    assert held.source_context.mode == "dorian"
