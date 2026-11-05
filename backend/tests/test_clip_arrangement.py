import pytest
from pydantic import ValidationError

from backend.app.models.clip_arrangement import ClipSchedule, PreparedClipSchedule

Q = 20160


def schedule(**changes):
    value = {"version": 1, "end": 40 * Q, "clips": [
        {"id": "verse", "start": 0, "length": 20 * Q, "offset": 2 * Q, "mode": "loop",
         "content": [{"pad": 0, "length": 4 * Q}, {"pad": 9, "length": 4 * Q}]},
        {"id": "return", "start": 24 * Q, "length": 8 * Q, "mode": "once", "content": [{"pad": 9, "length": 4 * Q}]},
    ]}
    value.update(changes)
    return ClipSchedule.model_validate(value)


def test_clip_window_offsets_repeats_gaps_and_once_silence():
    prepared = PreparedClipSchedule(schedule())
    assert [(prepared.locate(t * Q).pad, prepared.locate(t * Q).source_start // Q,
             prepared.locate(t * Q).boundary // Q) for t in [0, 2, 6, 10, 14, 18, 20, 24, 28]] == [
        (0, -2, 2), (9, 2, 6), (0, 6, 10), (9, 10, 14), (0, 14, 18), (9, 18, 20),
        (None, 20, 24), (9, 24, 28), (None, 28, 32)]


def test_lane_cycle_preserves_independent_legacy_phase():
    prepared = PreparedClipSchedule(schedule(cycle_ticks=32 * Q))
    assert prepared.locate(32 * Q).pad == 0
    assert prepared.locate(32 * Q).source_start == 30 * Q
    assert prepared.locate(52 * Q).boundary == 56 * Q


def test_large_loop_is_not_expanded():
    value = schedule().model_dump()
    value["clips"] = value["clips"][:1]
    value["clips"][0]["length"] = value["end"] = Q * 900000
    prepared = PreparedClipSchedule(ClipSchedule.model_validate(value))
    assert len(prepared.content_ends[0]) == 2
    assert prepared.locate(800000 * Q).boundary > 800000 * Q


def test_silent_gaps_have_stable_origins_and_finite_song_end_has_no_next_boundary():
    prepared = PreparedClipSchedule(schedule())
    assert prepared.locate(21 * Q) == prepared.locate(23 * Q)
    assert prepared.locate(29 * Q) == prepared.locate(31 * Q)
    ended = prepared.locate(40 * Q)
    assert ended.pad is None and ended.boundary is None
    assert prepared.locate(800000 * Q) == ended
    cyclic = PreparedClipSchedule(schedule(cycle_ticks=40 * Q))
    assert cyclic.locate(39 * Q).boundary == 40 * Q
    assert cyclic.locate(40 * Q).pad == 0


@pytest.mark.parametrize("peer", ["note", "score", "controller"])
def test_standalone_audition_past_song_end_does_not_flood_transport_events(peer):
    from backend.app.models.session import SessionAuditionRequest, SessionSequencerConfigRequest
    from backend.tests.test_sequencer_note_timing import make_runtime, advance, notes
    wire = {"end": Q, "clips": [{"id": "clip", "start": 0, "length": Q,
                               "content": [{"pad": 0, "length": Q}]}]}
    runtime, capture, config = make_runtime([60, None, 62, None], pad_loop_enabled=True, clip_schedule=wire)
    payload = config.model_dump()
    if peer == "note":
        payload["tracks"].append({**payload["tracks"][0], "track_id": "inactive"})
    elif peer == "score":
        payload["score_tracks"] = [{"track_id": "inactive", "length_beats": 1, "enabled": False,
            "pad_loop_enabled": True, "pads": [{"pad_index": 0, "length_beats": 1, "notes": []}], "clip_schedule": wire}]
    else:
        payload["controller_tracks"] = [{"track_id": "inactive", "controller_number": 1, "length_beats": 1, "enabled": False,
            "pad_loop_enabled": True, "pads": [{"pad_index": 0, "length_beats": 1}], "clip_schedule": wire}]
    runtime.stop()
    runtime.configure(SessionSequencerConfigRequest.model_validate(payload))
    runtime.audition(SessionAuditionRequest(action="workspace_start", track_ids=["lead"],
        sequence=[0], gesture_id="edit", revision=1))
    advance(runtime, capture, 7500)  # Over twice the finite song length.
    assert runtime.status().running
    assert any(at >= 6720 and message[0] == 0x90 for at, message in notes(capture))
    inactive = (runtime._config.controller_tracks if peer == "controller" else runtime._config.tracks)["inactive"]
    assert inactive.clip_boundary is None
    # There should be audible step/cycle markers, never one update per 20,160th beat.
    assert len(runtime._render_transport_events) < 30


@pytest.mark.parametrize("change", [
    {"version": 3}, {"end": 0}, {"cycle_ticks": 8 * Q},
    {"clips": [{"id": "bad", "start": 0.5, "length": Q, "content": [{"pad": 0, "length": Q}]}]},
    {"clips": [{"id": "bad", "start": 0, "length": Q, "content": [{"pad": 1024, "length": Q}]}]},
])
def test_invalid_schedules_are_rejected(change):
    with pytest.raises(ValidationError):
        schedule(**change)


def test_overlap_rejected():
    value = schedule().model_dump()
    value["clips"][1]["start"] = Q
    with pytest.raises(ValidationError, match="overlap"):
        ClipSchedule.model_validate(value)


def test_note_clip_crop_and_gap_release_only_source_notes():
    from backend.tests.test_sequencer_note_timing import make_runtime, advance, notes
    wire = {"end": 3 * Q, "clips": [
        {"id": "crop", "start": 0, "length": Q // 8, "content": [{"pad": 0, "length": Q}]},
        {"id": "offset", "start": Q, "length": Q // 2, "offset": Q // 2, "content": [{"pad": 0, "length": Q}]},
    ]}
    r, c, _ = make_runtime([60, 62, 64, 65], pad_loop_enabled=True, clip_schedule=wire)
    advance(r, c, 7000)
    assert notes(c) == [(0, (144, 60, 100)), (420, (128, 60, 0)),
                        (3360, (144, 64, 100)), (4200, (128, 64, 0)),
                        (4200, (144, 65, 100)), (5040, (128, 65, 0))]


def test_clip_schedule_can_reference_more_than_eight_patterns():
    from backend.tests.test_sequencer_note_timing import make_runtime, advance, notes
    wire = {"end": 3 * Q, "clips": [{"id": "ninth", "start": 0, "length": Q, "content": [{"pad": 9, "length": Q}]}]}
    r, c, _ = make_runtime([], pads=[{"pad_index": 0, "length_beats": 1, "steps": []},
                                   {"pad_index": 9, "length_beats": 1, "steps": [72]}],
                           pad_loop_enabled=True, clip_schedule=wire)
    advance(r, c, 4000)
    assert [(at, msg[1]) for at, msg in notes(c) if msg[0] == 144] == [(0, 72)]


def test_clip_span_must_use_native_pattern_duration():
    from backend.tests.test_sequencer_note_timing import make_runtime
    wire = {"end": Q, "clips": [{"id": "invalid", "start": 0, "length": Q, "content": [{"pad": 0, "length": Q // 2}]}]}
    with pytest.raises(ValueError, match="native pattern duration"):
        make_runtime([60], pad_loop_enabled=True, clip_schedule=wire)


def test_score_clip_chases_offset_and_releases_at_window_end():
    from backend.tests.test_score_sequencer import runtime_for, note
    from backend.tests.test_sequencer_note_timing import advance, notes
    wire = {"end": 3 * Q, "clips": [{"id": "score-cut", "start": 0, "length": Q // 2,
        "offset": Q // 2, "content": [{"pad": 0, "length": 16 * Q}]}]}
    r, c, _ = runtime_for([note("sustain", duration=2 * Q)], pad_loop_enabled=True, clip_schedule=wire)
    advance(r, c, 7000)
    assert notes(c) == [(0, (144, 60, 100)), (1680, (128, 60, 0))]


def test_controller_clips_hold_value_through_gaps_and_restart_at_source_offset():
    from backend.tests.test_controller_steps import setup, play, at, values
    wire = {"end": 4 * Q, "clips": [
        {"id": "first", "start": 0, "length": Q // 2, "content": [{"pad": 0, "length": 2 * Q}]},
        {"id": "later", "start": 2 * Q, "length": Q // 2, "offset": Q // 2, "content": [{"pad": 0, "length": 2 * Q}]},
    ]}
    runtime, midi, _ = setup(pad_loop_enabled=True, pad_loop_sequence=[], clip_schedule=wire)
    play(runtime)
    at(runtime, Q // 4)
    at(runtime, Q // 2)
    at(runtime, Q)
    assert values(midi) == [12, 0]
    at(runtime, 2 * Q)
    assert values(midi) == [12, 0, 64]


def test_clip_editor_audition_survives_song_start_stop_seek_and_restores_authored_source():
    from backend.app.models.session import SessionAuditionRequest, SessionSequencerConfigRequest
    from backend.tests.test_sequencer_source_transport import runtime, command, advance, track
    engine, config, _ = runtime()
    wire = {"end": 8 * Q, "clips": [{"id": "clip", "start": 0, "length": 8 * Q, "mode": "loop", "content": [{"pad": 0, "length": 4 * Q}]}]}
    payload = config.model_dump()
    for t in payload["tracks"]:
        if t["track_id"] != "manual":
            t.update(clip_schedule=wire, pad_loop_sequence=[])
    engine.configure(SessionSequencerConfigRequest.model_validate(payload))
    engine.audition(SessionAuditionRequest(action="workspace_start", track_ids=["lead"], sequence=[1], gesture_id="draft", revision=1))
    advance(engine, 4)
    phase = track(engine, "lead").phase_offset_subunit
    command(engine, track=None)
    advance(engine, 4)
    engine.sources.seek(5 * Q)
    assert track(engine, "lead").active_pad == 1
    assert track(engine, "lead").phase_offset_subunit == phase
    command(engine, "stop", track=None)
    assert engine.audition_status()["lead"]["workspace_active"]
    assert track(engine, "lead").enabled
    engine.audition(SessionAuditionRequest(action="workspace_end", track_ids=["lead"], gesture_id="draft", revision=2))
    assert track(engine, "lead").clip_schedule is not None
    assert not track(engine, "lead").enabled


@pytest.mark.parametrize("clock", ["arranger", "live"])
def test_arpeggiator_clip_has_no_future_boundary_after_finite_song_end(clock):
    from backend.app.models.session import SessionArpeggiatorConfig, SessionDeviceTransportRequest
    from backend.tests.test_arpeggiator_runtime import _CaptureMidi, _router, _advance_router
    capture = _CaptureMidi()
    router = _router(capture)
    wire = {"end": Q, "clips": [{"id": "clip", "start": 0, "length": Q,
                               "content": [{"pad": 0, "length": 4 * Q}]}]}
    router.configure([SessionArpeggiatorConfig(arpeggiator_id="arp", enabled=True, input_channel=2,
        target_channel=1, playback_mode=clock, pads=[{}], clip_schedule=wire)], tempo_bpm=120)
    router.source_device_transport(SessionDeviceTransportRequest(action="play", arranger=True), position=0)
    router.route_message([0x91, 60, 100], source="keyboard")
    _advance_router(router, end=48000)
    state = router._states["arp"]
    assert state.paused and state.boundary_beat is None
    attacks = [message for message, _ in capture.messages if message[0] == 0x90]
    assert attacks
    capture.current_sample = 48000
    _advance_router(router, start=48000, end=96000)
    assert [message for message, _ in capture.messages if message[0] == 0x90] == attacks


@pytest.mark.parametrize("clock", ["arranger", "live"])
def test_arpeggiator_clip_gate_and_audition_coexist_with_song_transport(clock):
    from backend.app.models.session import SessionArpeggiatorConfig, SessionAuditionRequest, SessionDeviceTransportRequest
    from backend.tests.test_arpeggiator_runtime import _CaptureMidi, _router, _advance_router
    capture = _CaptureMidi()
    router = _router(capture)
    wire = {"end": 4 * Q, "clips": [{"id": "arp-clip", "start": Q, "length": Q, "content": [{"pad": 0, "length": 4 * Q}]}]}
    config = SessionArpeggiatorConfig(arpeggiator_id="arp", enabled=True, input_channel=2, target_channel=1,
        playback_mode=clock, pads=[{}, {"octaves": 2}], pad_loop_sequence=[], clip_schedule=wire)
    router.configure([config], tempo_bpm=120)
    router.source_device_transport(SessionDeviceTransportRequest(action="play", arranger=True), position=0)
    router.route_message([0x91, 60, 100], source="keyboard")
    _advance_router(router, end=24000)
    assert not [message for message, _ in capture.messages if message[0] == 0x90]
    capture.current_sample = 24000
    _advance_router(router, start=24000, end=30000)
    assert any(message[0] == 0x90 for message, _ in capture.messages)
    router.audition(SessionAuditionRequest(action="workspace_start", arpeggiator_id="arp", sequence=[1], gesture_id="draft", revision=1))
    router.source_device_transport(SessionDeviceTransportRequest(action="stop", arranger=True), position=1)
    state = router._states["arp"]
    assert state.workspace is not None
    router.source_song_transport(position=1, running=False, arranger=False, reset=False, sample=30000)
    _advance_router(router, start=30000, end=150000)
    assert state.workspace is not None and router._running(state)
    router.audition(SessionAuditionRequest(action="workspace_end", arpeggiator_id="arp", gesture_id="draft", revision=2))
    assert not router._running(state)


def repetition_expansion_schedule(expanded, duration=4 * Q):
    """Complete source passes retain the crop and a later independent clip."""
    content = [{"pad": 0, "length": duration}, {"pad": None, "length": duration // 4}]
    return {"version": 2, "transpose_plans": [], "end": duration * 5, "clips": [
        {"id": "grouped", "start": 0, "offset": duration // 4, "length": duration * 3,
         "mode": "once" if expanded else "loop", "content": content * (3 if expanded else 1)},
        {"id": "neighbor", "start": duration * 4, "length": duration, "mode": "once",
         "content": [{"pad": 0, "length": duration}]},
    ]}


@pytest.mark.parametrize("source", ["melodic", "drummer", "score", "controller"])
def test_grouped_repetitions_preserve_every_source_event_with_rests_crop_and_rational_timing(source):
    from backend.app.models.session import SessionSequencerConfigRequest
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.tests.test_sequencer_note_timing import Capture, advance

    captures = []
    for expanded in (False, True):
        capture = Capture()
        runtime = SessionSequencerRuntime("grouping", capture, "internal:loopback", (1,), lambda *_: None, clock_mode="render_driven")
        duration = 8 * Q // 3
        common = dict(track_id="drumrow:kit:one" if source == "drummer" else source,
            timing=dict(beat_rate_numerator=3, beat_rate_denominator=2), length_beats=4,
            pad_loop_enabled=True, clip_schedule=repetition_expansion_schedule(expanded, duration))
        pad = dict(pad_index=0, length_beats=4)
        field = "tracks"
        if source == "score":
            field = "score_tracks"
            pad["notes"] = [dict(id="sustain", pitch=60, velocity=100, start_ticks=0, duration_ticks=2 * Q)]
        elif source == "controller":
            field = "controller_tracks"
            common.update(controller_number=74, controller_mode="step", target_channels=[1])
            pad["steps"] = [0, 64, 127, None]
        else:
            pad["steps"] = [60, None, 62, None]
        request = SessionSequencerConfigRequest.model_validate({field: [{**common, "pads": [pad]}], "playback_end_step": 128})
        runtime.configure(request)
        runtime._running = True
        advance(runtime, capture, 55000)
        captures.append(capture.events)
    assert captures[0]
    assert captures[1] == captures[0]


def test_grouped_arpeggiator_repetitions_preserve_scheduled_attacks_and_releases():
    from backend.app.models.session import SessionArpeggiatorConfig, SessionDeviceTransportRequest
    from backend.tests.test_arpeggiator_runtime import _CaptureMidi, _router, _advance_router

    captures = []
    for expanded in (False, True):
        capture = _CaptureMidi()
        router = _router(capture)
        router.configure([SessionArpeggiatorConfig(arpeggiator_id="arp", enabled=True, input_channel=2,
            target_channel=1, playback_mode="arranger", pads=[{}],
            clip_schedule=repetition_expansion_schedule(expanded))], tempo_bpm=120)
        router.source_device_transport(SessionDeviceTransportRequest(action="play", arranger=True), position=0)
        router.route_message([0x91, 60, 100], source="keyboard")
        router.route_message([0x91, 67, 100], source="keyboard")
        _advance_router(router, end=48000 * 11)
        captures.append(capture.messages)
    assert captures[0]
    assert captures[1] == captures[0]


def test_empty_clip_and_timed_content_rests_keep_exact_boundaries():
    empty = {"id": "empty", "start": 0, "length": 4 * Q, "mode": "once",
             "content": [{"pad": None, "length": 4 * Q}]}
    prepared = PreparedClipSchedule(schedule(end=4 * Q, clips=[empty]))
    assert prepared.locate(0).pad is None
    assert prepared.locate(Q).boundary == 4 * Q
    assert prepared.locate(4 * Q).boundary is None
    empty["content"] = [{"pad": None, "length": Q}, {"pad": 0, "length": 3 * Q}]
    prepared = PreparedClipSchedule(schedule(end=4 * Q, clips=[empty]))
    assert prepared.locate(Q - 1).pad is None
    assert prepared.locate(Q).pad == 0
    assert prepared.locate(Q).source_start == Q
    assert prepared.locate(4 * Q).pad is None


def capacity_audition_config():
    """512 authored patterns plus one session-only edited pattern."""
    return {"tracks": [{"track_id": "lead", "enabled": True, "length_beats": 1,
        "pad_loop_enabled": True,
        "pads": [{"pad_index": i, "length_beats": 1, "steps": [72 if i == 512 else 60, None, None, None]}
                 for i in range(513)],
        "clip_schedule": {"end": Q, "clips": [{"id": "song", "start": 0, "length": Q,
            "content": [{"pad": 0, "length": Q}]}]},
        "audition_schedule": {"end": Q + 1, "cycle_ticks": Q + 1,
            "clips": [{"id": "edit", "start": 0, "length": Q + 1,
                "content": [{"pad": 512, "length": Q}, {"pad": None, "length": 1}]}]}}]}


def test_capacity_audition_plays_edited_pitch_and_restores_authored_schedule():
    from backend.app.models.session import SessionAuditionRequest, SessionSequencerConfigRequest
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.tests.test_sequencer_note_timing import Capture, advance, notes
    capture = Capture()
    runtime = SessionSequencerRuntime("capacity", capture, "internal:loopback", (2,), lambda *_: None, clock_mode="render_driven")
    config = SessionSequencerConfigRequest.model_validate(capacity_audition_config())
    runtime.configure(config)
    runtime.audition(SessionAuditionRequest(action="workspace_start", track_ids=["lead"],
        sequence=[512], clip_context=True, gesture_id="capacity", revision=1))
    advance(runtime, capture, 7000)
    assert [m[1] for _, m in notes(capture) if m[0] == 144] == [72, 72, 72]
    runtime.audition(SessionAuditionRequest(action="workspace_end", track_ids=["lead"], gesture_id="capacity", revision=2))
    assert runtime._config.tracks["lead"].clip_schedule.schedule == config.tracks[0].clip_schedule


@pytest.mark.parametrize("change", ["no_audition", "authored_extra", "unused_extra", "over_budget"])
def test_extra_runtime_pads_are_only_available_to_bounded_auditions(change):
    from backend.app.models.session import SessionSequencerConfigRequest
    config = capacity_audition_config()
    track = config["tracks"][0]
    if change == "no_audition":
        del track["audition_schedule"]
    elif change == "authored_extra":
        track["clip_schedule"]["clips"][0]["content"][0]["pad"] = 512
    elif change == "unused_extra":
        track["audition_schedule"]["clips"][0]["content"][0]["pad"] = 0
    else:
        track["pads"] += [{**track["pads"][0], "pad_index": i} for i in range(513, 1025)]
    with pytest.raises(ValidationError):
        SessionSequencerConfigRequest.model_validate(config)


@pytest.mark.parametrize("source", ["score_tracks", "controller_tracks", "arpeggiators", "drummer"])
def test_each_source_reserves_extra_slots_for_exact_auditions(source):
    from copy import deepcopy
    import json
    from pathlib import Path
    from backend.app.models.session import SessionSequencerConfigRequest
    wire = json.loads((Path(__file__).parent / "fixtures/performance_creator/all_sources.json").read_text())["wire"]
    key = "tracks" if source == "drummer" else source
    track = deepcopy(wire[key][1 if source == "drummer" else 0])
    pad = deepcopy(track["pads"][0])
    track["pads"] = [deepcopy(pad) for _ in range(513)]
    if source != "arpeggiators":
        for i, item in enumerate(track["pads"]):
            item["pad_index"] = i
    track["audition_schedule"] = deepcopy(track["clip_schedule"])
    for clip in track["audition_schedule"]["clips"]:
        for span in clip["content"]:
            if span["pad"] is not None:
                span["pad"] = 512
    payload = {key: [track]}
    SessionSequencerConfigRequest.model_validate(payload)
    del track["audition_schedule"]
    with pytest.raises(ValidationError, match="reserved for the audition"):
        SessionSequencerConfigRequest.model_validate(payload)
