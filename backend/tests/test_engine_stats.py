import pytest

from backend.app.engine import engine_stats
from backend.app.engine.engine_stats import EngineStatsSampler


def test_cpu_deltas_guest_exclusion_caching_and_stop_reset(monkeypatch):
    monkeypatch.setattr(engine_stats.sys, "platform", "linux")
    monkeypatch.setattr(engine_stats.os, "sched_getaffinity", lambda pid: {pid}, raising=False)
    now = [0.]
    counters = [{0: (100, 40), 3: (200, 50)}]
    calls = []
    def read():
        calls.append(True)
        return counters[0]
    sampler = EngineStatsSampler(clock=lambda: now[0], cpu_reader=read)
    first = sampler.sample(running=True, assignments=((0, 0), (3, 3)))
    assert first["cpus"] == [{"cpu": 0, "percent": None}, {"cpu": 3, "percent": None}]
    assert sampler.sample(running=True, assignments=((0, 0), (3, 3))) == first
    assert len(calls) == 1
    now[0] = 1.
    counters[0] = {0: (200, 80), 3: (300, 73)}
    assert sampler.sample(running=True, assignments=((0, 0), (3, 3)))["cpus"] == [
        {"cpu": 0, "percent": 60.}, {"cpu": 3, "percent": 77.}]
    assert sampler.sample(running=False)["cpus"] == []
    assert sampler.sample(running=True, assignments=((0, 0),))["cpus"][0]["percent"] is None


def test_single_process_percent_is_not_a_per_core_claim(monkeypatch):
    monkeypatch.setattr(engine_stats.sys, "platform", "linux")
    monkeypatch.setattr(engine_stats.os, "sysconf", lambda _: 100)
    now, ticks = [10.], [150]
    sampler = EngineStatsSampler(clock=lambda: now[0], process_reader=lambda: (42, ticks[0]))
    assert sampler.sample(running=True)["process_percent"] is None
    now[0], ticks[0] = 12., 300
    sample = sampler.sample(running=True)
    assert sample["scope"] == "server_process" and sample["cpus"] == []
    assert sample["process_percent"] == 75.
    assert sample["sample_seconds"] == 2.


@pytest.mark.parametrize("platform", ["darwin", "win32"])
def test_unsupported_platform_does_not_sample_or_invent_zero(monkeypatch, platform):
    monkeypatch.setattr(engine_stats.sys, "platform", platform)
    def unexpected():
        raise AssertionError("No procfs on this platform")
    result = EngineStatsSampler(cpu_reader=unexpected, process_reader=unexpected).sample(running=True)
    assert not result["available"] and result["process_percent"] is None and result["cpus"] == []


def test_missing_process_and_changed_affinity_are_unavailable(monkeypatch):
    monkeypatch.setattr(engine_stats.sys, "platform", "linux")
    def gone():
        raise FileNotFoundError()
    assert not EngineStatsSampler(process_reader=gone).sample(running=True)["available"]
    monkeypatch.setattr(engine_stats.os, "sched_getaffinity", lambda _: {1, 2}, raising=False)
    assert not EngineStatsSampler().sample(running=True, assignments=((1, 1),))["available"]


def test_counter_reset_does_not_emit_negative_or_over_100_percent(monkeypatch):
    monkeypatch.setattr(engine_stats.sys, "platform", "linux")
    monkeypatch.setattr(engine_stats.os, "sched_getaffinity", lambda _: {0}, raising=False)
    now, ticks = [0.], [{0: (100, 50)}]
    sampler = EngineStatsSampler(clock=lambda: now[0], cpu_reader=lambda: ticks[0])
    sampler.sample(running=True, assignments=((1, 0),))
    now[0], ticks[0] = 1., {0: (50, 10)}
    assert sampler.sample(running=True, assignments=((1, 0),))["cpus"][0]["percent"] is None


def test_proc_stat_does_not_double_count_guest(monkeypatch):
    monkeypatch.setattr(engine_stats.Path, "read_text", lambda _: "cpu 0 0 0 0\ncpu0 10 2 3 20 5 1 2 7 9 4\n")
    assert engine_stats.read_cpu_ticks() == {0: (50, 25)}
