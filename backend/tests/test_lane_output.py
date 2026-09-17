from types import SimpleNamespace

import pytest

from backend.app.engine.lane_output import LaneOutputGate
from backend.app.engine.midi_scheduler import EngineMidiScheduler


def config():
    return SimpleNamespace(tracks=[SimpleNamespace(track_id=key, midi_channel=channel) for key, channel in
        [("lead", 1), ("other", 1), ("feeder", 3), ("drumrow:drums:kick", 10), ("drumrow:drums:snare", 10)]],
        controller_tracks=[SimpleNamespace(track_id="cc", target_channels=[1])],
        arpeggiators=[SimpleNamespace(arpeggiator_id="arp", target_channel=1, input_channel=3, playback_mode="arranger"),
                      SimpleNamespace(arpeggiator_id="live", target_channel=2, input_channel=4, playback_mode="live")])


def controls(**kwargs):
    return {key: {"mute": value == "mute", "solo": value == "solo"} for key, value in kwargs.items()}


def test_gate_solos_dependencies_and_atomic_drummer_rows():
    gate = LaneOutputGate()
    gate.configure(config())
    gate.apply(1, controls(feeder="solo"))
    assert gate.blocked == {"lead", "other", "drums", "cc"}
    gate.apply(2, controls(arp="solo", lead="solo", feeder="mute"))
    assert gate.blocked == {"other", "drums", "cc", "feeder"}
    gate.apply(3, controls(drums="mute"))
    assert not gate.allows("lane:drumrow:drums:kick", [0x99, 36, 100])
    assert not gate.allows("lane:drumrow:drums:snare", [0x99, 38, 100])
    assert gate.allows("external", [0x90, 72, 100])
    assert gate.allows("arpeggiator", [0x91, 64, 100])


def test_pending_attacks_and_unmatched_releases_do_not_cut_shared_channel():
    scheduler = EngineMidiScheduler()
    scheduler.lane_output.configure(config())
    for message, source, sample in [([0x90, 60, 100], "other", 0), ([0x90, 60, 100], "lead", 64),
                                    ([0x80, 60, 0], "lead", 128), ([0x80, 60, 0], "other", 256)]:
        scheduler.enqueue(message, source=f"lane:{source}", target_engine_sample=sample)
    assert len(scheduler.drain_block(block_start_sample=0, block_end_sample=64)) == 1
    scheduler.lane_output.apply(1, controls(lead="mute"))
    assert scheduler.drain_block(block_start_sample=64, block_end_sample=129) == []
    assert [list(e.message) for e in scheduler.drain_block(block_start_sample=129, block_end_sample=257)] == [[0x80, 60, 0]]


def test_sounding_notes_release_while_muted_and_controls_do_not_reset_transport():
    gate = LaneOutputGate()
    gate.configure(config())
    assert gate.allows("lane:lead", [0x90, 60, 100])
    assert gate.allows("lane:other", [0x90, 60, 100])
    gate.apply(1, controls(lead="mute", cc="mute"))
    assert not gate.allows("lane:lead", [0x80, 60, 0])  # Other lane still owns this pitch.
    assert gate.allows("lane:other", [0x80, 60, 0])
    assert not gate.allows("lane:cc", [0xb0, 1, 64])
    gate.apply(2, {})
    assert gate.allows("lane:cc", [0xb0, 1, 70])
    assert gate.allows("lane:lead", [0x90, 61, 100])
    gate.apply(3, controls(lead="mute"))
    assert gate.allows("lane:lead", [0x80, 61, 0])


def test_invalid_or_stale_batch_has_no_effect_and_configuration_prunes_deleted_lanes():
    gate = LaneOutputGate()
    gate.configure(config())
    gate.apply(4, controls(lead="mute"))
    before = gate.status()
    for revision, lanes in [(3, {}), (4, {}), (5, controls(lead="solo", missing="mute"))]:
        with pytest.raises(ValueError):
            gate.apply(revision, lanes)
        assert gate.status() == before
    gate.apply(4, controls(lead="mute"))  # Idempotent retry.
    next_config = config()
    next_config.tracks = [t for t in next_config.tracks if t.track_id != "lead"]
    gate.configure(next_config)
    assert "lead" not in gate.controls
    assert not gate.blocked


def test_scheduler_reset_keeps_desired_controls_and_clears_old_notes():
    scheduler = EngineMidiScheduler()
    scheduler.lane_output.configure(config())
    scheduler.lane_output.apply(1, controls(lead="mute"))
    scheduler.reset()
    assert scheduler.lane_output.blocked == {"lead"}
    assert not scheduler.lane_output.allows("lane:lead", [0x80, 60, 0])


def test_muted_render_progress_seek_loop_and_audition_match_unmuted_tracks():
    import json
    from pathlib import Path
    from backend.app.models.session import SessionAuditionRequest, SessionSequencerConfigRequest
    from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    request = SessionSequencerConfigRequest.model_validate(json.loads(
        (Path(__file__).parent / "fixtures/sequencers/arranger_seek.json").read_text()))
    request.tracks.append(request.tracks[0].model_copy(update={"track_id": "other"}))
    request.playback_loop = True
    request.playback_end_step = 32
    rendered = []
    for muted in (False, True):
        scheduler = EngineMidiScheduler()
        scheduler.set_engine_sample_rate(48000)
        gate = scheduler.lane_output
        gate.configure(request)
        gate.apply(1, controls(lead="mute") if muted else {})
        cursor = 0
        def enqueue(message, *, source, target_engine_sample=None, delivery_delay_seconds=None, **_kwargs):
            sample = target_engine_sample if target_engine_sample is not None else cursor + round((delivery_delay_seconds or 0) * 48000)
            return scheduler.enqueue(message, source=source, target_engine_sample=sample)[0]
        router = PerformanceMidiRouter(enqueue_timestamped_midi=enqueue, current_engine_sample=lambda: cursor)
        router.lane_output = gate
        runtime = SessionSequencerRuntime(session_id="lane-test", midi_service=router, midi_input_selector="internal:loopback",
            controller_default_channels=(1,), clock_mode="render_driven", publish_event=lambda *_: None)
        runtime.configure(request)
        runtime.start()
        runtime.audition(SessionAuditionRequest(action="start", track_ids=["lead"], sequence=[1, -1]))
        events = []
        for cursor in range(0, 240000, 64):
            runtime.advance_render_block(sample_rate=48000, ksmps=64, block_start_sample=cursor)
            events.extend(scheduler.drain_block(block_start_sample=cursor, block_end_sample=cursor + 64))
        position = runtime.status().transport_subunit
        gate.apply(2, {})
        assert runtime.status().transport_subunit == position
        runtime.apply_prepared(compile_sequencer_runtime_config(request, controller_default_channels=(1,)), position_step=9)
        assert runtime.status().transport_subunit == 9 * 420
        rendered.append((runtime.status().model_dump(exclude={"session_id"}), events))
    assert rendered[0][0] == rendered[1][0]
    def other_attacks(events):
        return [(e.target_engine_sample, e.message) for e in events if e.source == "lane:other" and e.message[0] & 0xf0 == 0x90]
    assert other_attacks(rendered[0][1]) == other_attacks(rendered[1][1])
    assert other_attacks(rendered[1][1])
    assert not any(e.source == "lane:lead" and e.message[0] & 0xf0 == 0x90 for e in rendered[1][1])
