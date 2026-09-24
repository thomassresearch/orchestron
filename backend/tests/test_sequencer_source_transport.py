from __future__ import annotations

from backend.app.services.sequencer_runtime_constants import TRANSPORT_SUBUNITS_PER_STEP

from copy import deepcopy

import pytest

from backend.app.models.session import SessionAuditionRequest, SessionDeviceTransportRequest, SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.tests.test_sequencer_runtime import _FakeMidiService, _note_on_messages, _preview_command


def runtime(loop=False):
    midi = _FakeMidiService()
    engine = SessionSequencerRuntime(session_id="sources", midi_service=midi, midi_input_selector="test",
        controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
    lead = {"track_id": "lead", "midi_channel": 1, "enabled": False, "pad_loop_enabled": True,
        "pad_loop_repeat": False, "pad_loop_sequence": [0, 1], "pads": [
            {"pad_index": 0, "length_beats": 4, "steps": [60] * 16},
            {"pad_index": 1, "length_beats": 4, "steps": [72] * 16}]}
    backing = {**deepcopy(lead), "track_id": "backing", "midi_channel": 2}
    manual = {**deepcopy(lead), "track_id": "manual", "midi_channel": 3, "pad_loop_enabled": False}
    config = SessionSequencerConfigRequest.model_validate({"playback_start_step": 8 if loop else 0,
        "playback_end_step": 20 if loop else 64, "playback_loop": loop, "tracks": [lead, backing, manual]})
    engine.configure(config)
    return engine, config, midi


def command(engine, action="play", track="lead", **values):
    return engine.device_transport(SessionDeviceTransportRequest(action=action,
        **({"track_ids": [track]} if track else {"arranger": True}), **values))


def advance(engine, steps):
    target = engine._absolute_subunit + steps * TRANSPORT_SUBUNITS_PER_STEP
    while engine._running and engine._absolute_subunit < target:
        next_at = min(target, engine._next_event_subunit_locked(engine._config, engine._absolute_subunit))
        engine._advance_render_to_event_locked(engine._config, next_at)
        if engine._running:
            engine._perform_render_block_events_locked(engine._config, engine._absolute_subunit)


def track(engine, identity):
    return engine._config.tracks[identity]


@pytest.mark.parametrize("preview", [False, True])
def test_arranger_stop_then_device_play_uses_cursor_and_recovers_from_preview(preview):
    engine, _, midi = runtime()
    command(engine, track=None)
    advance(engine, 24)
    command(engine, "stop", track=None)
    if preview:
        engine.audition(_preview_command())
        advance(engine, 3)
        engine.audition(_preview_command("preview_end", 2))
    command(engine, position_step=24)
    engine.advance_render_block(sample_rate=48000, ksmps=16)
    assert engine.status().running and not engine.status().arranger_active
    assert track(engine, "lead").enabled
    assert not track(engine, "backing").enabled
    assert engine.sources.position() >= 24 * TRANSPORT_SUBUNITS_PER_STEP
    assert _note_on_messages(midi)


def test_loop_start_and_join_share_song_position_without_restarting_manual():
    engine, _, _ = runtime(loop=True)
    command(engine, track="manual", pad_index=1)
    advance(engine, 3)
    origin = track(engine, "manual").phase_offset_subunit
    command(engine, position_step=15)
    assert engine.sources.position() == 8 * TRANSPORT_SUBUNITS_PER_STEP
    advance(engine, 5)
    command(engine, track="backing")
    assert track(engine, "lead").phase_offset_subunit == track(engine, "backing").phase_offset_subunit
    assert engine.sources.position() == 13 * TRANSPORT_SUBUNITS_PER_STEP
    advance(engine, 7)
    assert engine.sources.position() == 8 * TRANSPORT_SUBUNITS_PER_STEP
    assert track(engine, "manual").phase_offset_subunit == origin
    assert track(engine, "manual").active_pad == 1
    assert engine.status().tracks[0].runtime_pad_start_subunit is not None


def test_device_start_between_clock_subunits_plays_first_note_without_retriggering_peers():
    engine, _, midi = runtime()
    command(engine)
    engine.advance_render_block(sample_rate=48000, ksmps=64)
    assert engine._render_subunit_remainder > 0
    before = len(_note_on_messages(midi))
    phase = track(engine, "lead").phase_offset_subunit
    remainder = engine._render_subunit_remainder
    command(engine, track="manual", pad_index=1)
    assert engine._render_subunit_remainder == remainder
    engine.advance_render_block(sample_rate=48000, ksmps=64)
    assert _note_on_messages(midi)[before:] == [[0x92, 72, 100]]
    assert track(engine, "lead").phase_offset_subunit == phase


def test_song_end_and_arranger_actions_preserve_manual_playback():
    engine, _, _ = runtime()
    command(engine, track="manual", pad_index=1)
    advance(engine, 3)
    command(engine, track=None, position_step=48)
    advance(engine, 16)
    assert engine.status().running
    assert not engine.status().arranger_active
    assert not engine.sources.arrangement_running
    assert track(engine, "manual").enabled
    assert not track(engine, "lead").enabled
    phase = engine._local_transport_offset_for(track(engine, "manual"), engine._absolute_subunit)
    command(engine, track=None)
    command(engine, "stop", track=None)
    assert engine._local_transport_offset_for(track(engine, "manual"), engine._absolute_subunit) == phase
    assert track(engine, "manual").enabled


@pytest.mark.parametrize("controller", [False, True])
def test_manual_pad_queue_switches_at_its_own_boundary_during_arrangement_loops(controller):
    engine, config, midi = runtime(loop=True)
    if controller:
        config.controller_tracks = SessionSequencerConfigRequest.model_validate({"controller_tracks": [{
            "track_id": "filter", "controller_number": 74, "enabled": False, "pad_loop_enabled": False,
            "pads": [{"pad_index": index, "length_beats": 4,
                "keypoints": [{"position": 0, "value": value}, {"position": 1, "value": value}]}
                for index, value in [(0, 30), (1, 90)]]}]}).controller_tracks
        engine.configure(config)
    identity = "filter" if controller else "manual"
    def get_track():
        return engine._config.controller_tracks[identity] if controller else track(engine, identity)

    command(engine, track=identity, pad_index=0)
    command(engine)
    duration = engine._transport_subunit_count_for_pad(get_track(), 0) // TRANSPORT_SUBUNITS_PER_STEP
    advance(engine, 3)
    engine.queue_pad(identity, 1)
    engine.queue_pad(identity, None)
    assert get_track().queued_pad is None
    engine.queue_pad(identity, 1)
    advance(engine, duration - 4)
    assert get_track().active_pad == 0
    assert get_track().queued_pad == 1
    # A live edit must not discard a pending click or move its boundary.
    engine.apply_prepared(compile_sequencer_runtime_config(config, controller_default_channels=(1,)))
    midi.calls.clear()
    advance(engine, 1)
    assert get_track().active_pad == 1
    assert get_track().queued_pad is None
    assert engine._local_transport_offset_for(get_track(), engine._absolute_subunit) == 0
    messages = [message for _, batch, _ in midi.calls for message in batch]
    assert ([0xB0, 74, 90] if controller else [0x92, 72, 100]) in messages
    assert engine.sources.arrangement_running
    assert engine.sources.manual_pads[identity] == 1


def test_explicit_play_restarts_ended_lane_without_authored_enablement_change():
    engine, config, _ = runtime()
    command(engine)
    advance(engine, 64)
    assert not engine.status().running
    engine.apply_prepared(compile_sequencer_runtime_config(config, controller_default_channels=(1,)))
    command(engine, position_step=64)
    assert engine.sources.position() == 0
    assert track(engine, "lead").enabled


def test_manual_seek_continuity_and_local_stop():
    engine, _, _ = runtime()
    command(engine, track="manual", pad_index=1)
    advance(engine, 5)
    command(engine)
    engine._seek_absolute_subunit_locked(20 * TRANSPORT_SUBUNITS_PER_STEP)
    assert engine._local_transport_offset_for(track(engine, "manual"), engine._absolute_subunit) == 5 * TRANSPORT_SUBUNITS_PER_STEP
    command(engine, "stop")
    assert track(engine, "manual").enabled
    assert not track(engine, "lead").enabled
    command(engine, "stop", "manual")
    assert not engine.status().running


def test_manual_midi_timing_is_identical_with_song_loops_seeks_and_global_controls():
    def play(with_song):
        engine, _, midi = runtime(loop=True)
        command(engine, track="manual", pad_index=1)
        if with_song:
            command(engine)
        events = []
        for block in range(2000):
            if with_song:
                if block == 200:
                    engine._seek_absolute_subunit_locked(15 * TRANSPORT_SUBUNITS_PER_STEP)
                elif block == 400:
                    command(engine, track=None)
                elif block == 800:
                    command(engine, "stop", track=None)
                elif block == 1000:
                    command(engine)
            engine.advance_render_block(sample_rate=48000, ksmps=64)
            for _, messages, delay in midi.calls:
                events.extend((block, message, delay) for message in messages if message[0] & 0xf == 2)
            midi.calls.clear()
        return events
    reference = play(False)
    assert reference
    assert play(True) == reference


def test_prepared_edits_preserve_runtime_playback_intent_and_phase():
    engine, config, _ = runtime(loop=True)
    command(engine, track="manual", pad_index=1)
    command(engine)
    advance(engine, 15)
    at = engine._absolute_subunit
    phase = track(engine, "manual").phase_offset_subunit
    config.tracks[2].pads[1].steps[0] = 77
    engine.configure(config)
    assert engine._absolute_subunit == at
    assert track(engine, "manual").phase_offset_subunit == phase
    assert track(engine, "manual").enabled
    assert not track(engine, "backing").enabled


def test_invalid_target_does_not_partially_launch():
    engine, _, _ = runtime()
    with pytest.raises(ValueError):
        engine.device_transport(SessionDeviceTransportRequest(action="play", track_ids=["lead", "missing"]))
    assert not engine.status().running


def test_manual_workspace_survives_song_end_and_restores_its_underlying_pad():
    engine, _, _ = runtime()
    command(engine, track="manual", pad_index=1)
    engine.audition(SessionAuditionRequest(action="workspace_start", track_ids=["manual"],
        sequence=[0, 1], gesture_id="workspace", revision=1))
    command(engine)
    advance(engine, 64)
    assert engine.status().running
    assert engine.audition_status()["manual"]["workspace_active"]
    engine.audition(SessionAuditionRequest(action="workspace_end", track_ids=["manual"],
        gesture_id="workspace", revision=2))
    assert track(engine, "manual").enabled
    assert track(engine, "manual").active_pad == 1


def test_source_changes_keep_other_device_phase_and_join_song_position():
    engine, config, _ = runtime(loop=True)
    command(engine, track="manual", pad_index=1)
    command(engine)
    advance(engine, 5)
    manual_phase = track(engine, "manual").phase_offset_subunit
    config.tracks[0].pad_loop_enabled = False
    engine.configure(config)
    command(engine, pad_index=1)
    assert not engine.sources.arrangement_running
    assert track(engine, "manual").phase_offset_subunit == manual_phase
    assert track(engine, "lead").active_pad == 1
    config.tracks[0].pad_loop_enabled = True
    engine.configure(config)
    command(engine)
    command(engine, track="backing")
    assert track(engine, "lead").phase_offset_subunit == track(engine, "backing").phase_offset_subunit
    assert track(engine, "manual").phase_offset_subunit == manual_phase


def test_source_switch_without_loop_uses_requested_stopped_cursor():
    engine, config, _ = runtime()
    command(engine, track="manual", pad_index=1)
    advance(engine, 5)
    config.tracks[2].pad_loop_enabled = True
    engine.apply_prepared(compile_sequencer_runtime_config(config, controller_default_channels=(1,)), device_command=True)
    command(engine, track="manual", position_step=24)
    assert engine.sources.position() == 24 * TRANSPORT_SUBUNITS_PER_STEP
    assert track(engine, "manual").active_pad == 0


@pytest.mark.parametrize("repeat", [False, True])
def test_rest_and_short_lane_respect_authored_end_behavior(repeat):
    engine, config, midi = runtime()
    config.tracks[0].pad_loop_sequence = [-1, 0]
    config.tracks[0].pads[0].length_beats = 1
    config.tracks[0].pad_loop_repeat = repeat
    engine.configure(config)
    command(engine)
    engine.advance_render_block(sample_rate=48000, ksmps=64)
    assert not _note_on_messages(midi)
    advance(engine, 8)
    assert _note_on_messages(midi)
    advance(engine, 8)
    assert track(engine, "lead").enabled is repeat
    assert track(engine, "lead").sequence_ended is not repeat


def test_device_play_replaces_preview_and_ignores_its_late_release():
    engine, config, _ = runtime()
    config.tracks[0].enabled = True
    engine.configure(config)
    engine.audition(_preview_command())
    command(engine, position_step=24)
    engine.audition(_preview_command("preview_end", 2))
    assert track(engine, "lead").enabled
    assert not track(engine, "backing").enabled
    assert not engine.audition_status()
    command(engine, "stop")
    command(engine, position_step=24)
    assert track(engine, "lead").enabled


def test_empty_arrangement_never_falls_back_to_a_manual_pad():
    engine, config, midi = runtime()
    config.tracks[0].pad_loop_sequence = []
    engine.configure(config)
    command(engine)
    advance(engine, 16)
    assert not _note_on_messages(midi)
    assert not track(engine, "lead").enabled
    from backend.tests.test_arpeggiator_patterns import Playback
    p = Playback(playback_mode="arranger", pad_loop_enabled=True, pad_loop_sequence=[])
    p.router.source_device_transport(SessionDeviceTransportRequest(action="play", arpeggiator_id="arp"), position=0)
    p.note()
    p.advance(24000)
    assert not p.attacks


def test_shortening_song_stops_only_arrangement_but_atomic_seek_uses_new_range():
    engine, config, _ = runtime()
    command(engine, track="manual", pad_index=1)
    command(engine)
    advance(engine, 30)
    phase = track(engine, "manual").phase_offset_subunit
    config.playback_end_step = 16
    engine.apply_prepared(compile_sequencer_runtime_config(config, controller_default_channels=(1,)), position_step=8)
    assert track(engine, "lead").enabled and engine.sources.position() == 8 * TRANSPORT_SUBUNITS_PER_STEP
    assert track(engine, "manual").phase_offset_subunit == phase
    config.playback_end_step = 4
    engine.configure(config)
    assert not track(engine, "lead").enabled
    assert track(engine, "manual").enabled


def test_controller_tracks_output_while_arranger_stopped_and_restore_after_preview():
    engine, config, midi = runtime(loop=True)
    config.controller_tracks = SessionSequencerConfigRequest.model_validate({"controller_tracks": [{
        "track_id": "filter", "controller_number": 74, "enabled": False, "pad_loop_enabled": True,
        "pad_loop_sequence": [0], "pads": [{"pad_index": 0, "length_beats": 4,
        "keypoints": [{"position": 0, "value": 50}, {"position": 1, "value": 80}]}]}]}).controller_tracks
    engine.configure(config)
    command(engine, track="filter")
    advance(engine, 1)
    assert engine._config.controller_tracks["filter"].enabled
    assert any(message[0] & 0xf0 == 0xb0 for _, batch, _ in midi.calls for message in batch)
    engine.audition(SessionAuditionRequest(action="preview_start", track_ids=["filter"], sequence=[0], gesture_id="cc", revision=1))
    advance(engine, 2)
    engine.audition(SessionAuditionRequest(action="preview_end", track_ids=["filter"], gesture_id="cc", revision=2))
    assert engine._config.controller_tracks["filter"].enabled
    assert engine.sources.position() == 11 * TRANSPORT_SUBUNITS_PER_STEP


@pytest.mark.parametrize("manual", [False, True])
def test_arranger_mode_arpeggiator_plays_independently_with_input_notes(manual):
    from backend.tests.test_arpeggiator_patterns import Playback
    p = Playback(playback_mode="arranger", pad_loop_enabled=not manual, pad_loop_sequence=[0], pad_loop_repeat=True)
    p.router.set_transport(beat=0, running=False, sample=0)
    p.advance(1)
    p.router.source_device_transport(SessionDeviceTransportRequest(action="play", arpeggiator_id="arp", pad_index=1 if manual else None), position=0)
    p.router.source_song_transport(position=0, running=not manual, arranger=False, reset=False)
    p.note(sample=1)
    p.advance(13000)
    assert p.attacks and p.router.status()[0].enabled
    assert not p.router.arranger_running
    if manual:
        assert p.router.status()[0].active_pad == 1
    p.router.source_device_transport(SessionDeviceTransportRequest(action="stop", arpeggiator_id="arp"), position=0)
    before = len(p.attacks)
    p.advance(25000)
    assert len(p.attacks) == before


@pytest.mark.parametrize("mode", ["manual", "live"])
def test_arpeggiator_manual_and_live_phases_ignore_song_wraps(mode):
    from backend.tests.test_arpeggiator_patterns import Playback
    def play(wrap):
        p = Playback(playback_mode="live" if mode == "live" else "arranger", pad_loop_enabled=False)
        if mode == "manual":
            p.router.source_device_transport(SessionDeviceTransportRequest(action="play", arpeggiator_id="arp"), position=0)
        p.note()
        p.advance(7000)
        if wrap:
            p.router.source_song_transport(position=0, running=True, arranger=True, reset=True)
        p.advance(25000)
        return p.attacks
    assert play(True) == play(False)


def test_independent_arpeggiator_keeps_play_intent_through_processing_edits():
    from backend.tests.test_arpeggiator_patterns import Playback
    p = Playback(playback_mode="arranger", pad_loop_enabled=True, pad_loop_sequence=[0])
    p.router.source_device_transport(SessionDeviceTransportRequest(action="play", arpeggiator_id="arp"), position=0)
    p.note()
    p.advance(7000)
    p.router.configure([p.config.model_copy(update={"processing_mode": "mute"})], tempo_bpm=120)
    assert p.router.status()[0].enabled
    p.router.configure([p.config], tempo_bpm=120)
    p.note(sample=7000)
    before = len(p.attacks)
    p.advance(25000)
    assert len(p.attacks) > before


def test_whole_song_loop_live_toggle_preserves_position_and_manual_phase():
    engine, config, _ = runtime()
    command(engine, track="manual", pad_index=1)
    advance(engine, 3)
    command(engine, track=None)
    advance(engine, 10)
    position = engine.sources.position()
    manual_origin = engine.sources.manual_origins["manual"]
    config.playback_loop = True
    engine.configure(config)
    assert engine.sources.position() == position
    assert engine.sources.bounds == (0, 64 * TRANSPORT_SUBUNITS_PER_STEP, True)
    advance(engine, 64)
    assert engine.sources.position() == position
    assert engine.status().arranger_active
    assert engine.sources.manual_origins["manual"] == manual_origin
    assert track(engine, "manual").enabled
    config.playback_loop = False
    engine.configure(config)
    assert engine.sources.position() == position
    advance(engine, 64)
    assert engine.sources.position() == 64 * TRANSPORT_SUBUNITS_PER_STEP
    assert not engine.status().arranger_active
    assert not track(engine, "lead").enabled
    assert track(engine, "manual").enabled
    assert engine.sources.manual_origins["manual"] == manual_origin
    engine.stop()
