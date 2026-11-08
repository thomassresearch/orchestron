from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.app.engine import render_cpu_placement as placement


def test_sparse_allowed_cpus_are_disjoint_across_live_coordinators_and_reused_after_stop():
    pool = placement.RenderCpuPlacement(lambda: {9, 2, 5, 7})
    first, second, third = object(), object(), object()
    assert pool.acquire(first, 2) == (2, 5)
    assert pool.acquire(second, 2) == (7, 9)
    with pytest.raises(RuntimeError, match="Insufficient"):
        pool.acquire(third, 1)
    with pytest.raises(RuntimeError, match="still owned"):
        pool.acquire(first, 1)
    pool.release(first)
    assert pool.acquire(third, 2) == (2, 5)
    assert pool._owners[second] == (7, 9)


def test_changed_cpuset_affects_new_starts_without_reassigning_live_owners():
    allowed = {1, 3, 5, 7}
    pool = placement.RenderCpuPlacement(lambda: allowed)
    first, second = object(), object()
    assert pool.acquire(first, 2) == (1, 3)
    allowed = {3, 5}
    with pytest.raises(RuntimeError, match="Insufficient"):
        pool.acquire(second, 2)
    assert pool._owners == {first: (1, 3)}
    pool.release(first)
    assert pool.acquire(second, 2) == (3, 5)


def test_concurrent_starts_reserve_distinct_cpus_atomically():
    pool = placement.RenderCpuPlacement(lambda: set(range(8)))
    owners = [object() for _ in range(4)]
    with ThreadPoolExecutor(4) as executor:
        leases = list(executor.map(lambda owner: pool.acquire(owner, 2), owners))
    assert sorted(cpu for lease in leases for cpu in lease) == list(range(8))


def test_unsupported_platform_keeps_existing_scheduler_behavior():
    pool = placement.RenderCpuPlacement(lambda: None)
    assert pool.acquire(object(), 3) == (None, None, None)
    assert not pool._owners


def test_unreadable_linux_affinity_does_not_guess():
    def fail():
        raise OSError("denied")
    pool = placement.RenderCpuPlacement(fail)
    with pytest.raises(OSError, match="denied"):
        pool.acquire(object(), 3)
    assert not pool._owners


def test_child_pins_only_its_current_render_thread_and_verifies_result(monkeypatch):
    mask = {2, 5, 9}
    calls = []
    def get(pid):
        assert pid == 0
        return mask
    def set_mask(pid, values):
        nonlocal mask
        calls.append((pid, values))
        mask = values
    monkeypatch.setattr(placement.os, "sched_getaffinity", get, raising=False)
    monkeypatch.setattr(placement.os, "sched_setaffinity", set_mask, raising=False)
    placement.apply_worker_cpu(5)
    assert calls == [(0, {5})]


@pytest.mark.parametrize("cpu", [False, -1, 3, 2.5])
def test_child_rejects_invalid_or_no_longer_allowed_cpu(monkeypatch, cpu):
    monkeypatch.setattr(placement.os, "sched_getaffinity", lambda _: {2, 5}, raising=False)
    with pytest.raises(RuntimeError, match="no longer allowed"):
        placement.apply_worker_cpu(cpu)


def test_none_placement_never_queries_or_changes_affinity(monkeypatch):
    def unexpected(*_):
        raise AssertionError("Affinity must not be queried")
    monkeypatch.setattr(placement.os, "sched_getaffinity", unexpected, raising=False)
    placement.apply_worker_cpu(None)


def test_child_rejects_unapplied_placement(monkeypatch):
    monkeypatch.setattr(placement.os, "sched_getaffinity", lambda _: {2, 5}, raising=False)
    monkeypatch.setattr(placement.os, "sched_setaffinity", lambda *_: None, raising=False)
    with pytest.raises(RuntimeError, match="could not be verified"):
        placement.apply_worker_cpu(2)
