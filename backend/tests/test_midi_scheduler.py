from __future__ import annotations

from backend.app.engine.midi_scheduler import ClockDomainMapping, EngineMidiScheduler


def test_engine_midi_scheduler_drains_events_in_block_order() -> None:
    scheduler = EngineMidiScheduler()

    assert scheduler.enqueue([0x90, 60, 100], source="test", target_engine_sample=192)[0] is True
    assert scheduler.enqueue([0x80, 60, 0], source="test", target_engine_sample=128)[0] is True
    assert scheduler.enqueue([0xB0, 1, 64], source="test", target_engine_sample=128)[0] is True

    drained = scheduler.drain_block(block_start_sample=128, block_end_sample=193)

    assert [list(event.message) for event in drained] == [
        [0x80, 60, 0],
        [0xB0, 1, 64],
        [0x90, 60, 100],
    ]


def test_engine_midi_scheduler_marks_late_events_when_block_has_advanced() -> None:
    scheduler = EngineMidiScheduler()

    assert scheduler.enqueue([0x90, 60, 100], source="test", target_engine_sample=64)[0] is True

    drained = scheduler.drain_block(block_start_sample=128, block_end_sample=192)

    assert len(drained) == 1
    assert drained[0].late is True
    assert drained[0].target_engine_sample == 128


def test_engine_midi_scheduler_rejects_overflow_and_counts_it() -> None:
    scheduler = EngineMidiScheduler(max_events=1)

    assert scheduler.enqueue([0x90, 60, 100], source="test", target_engine_sample=0)[0] is True
    assert scheduler.enqueue([0x80, 60, 0], source="test", target_engine_sample=1)[0] is False
    assert scheduler.overflow_count == 1


def test_clock_domain_mapping_detects_stale_sync_samples() -> None:
    mapping = ClockDomainMapping()

    mapping.update(remote_timestamp_ns=1_000, server_timestamp_ns=2_000)
    mapped, stale = mapping.map_to_server_time(1_500, now_server_ns=2_200)
    assert mapped == 2_500
    assert stale is False

    mapped, stale = mapping.map_to_server_time(1_500, now_server_ns=2_000_000_500)
    assert mapped == 2_500
    assert stale is True
