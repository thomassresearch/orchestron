"""Capacity detection is hermetic; leases are shared across concurrent starters."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import threading

import pytest

from backend.app.engine.render_capacity import MIB, RenderAdmission, RenderAdmissionError, RenderCapacity, detect_render_capacity


def v2():
    files = {
        "/proc/self/cgroup": "0::/tenant/session\n",
        "/proc/self/mountinfo": "1 0 0:1 / /cg rw - cgroup2 cgroup rw\n",
        "/proc/meminfo": "MemAvailable: 8388608 kB\n",
    }
    for path in ("/cg", "/cg/tenant", "/cg/tenant/session"):
        files.update({path + "/cpu.max": "max 100000", path + "/cpu.stat": "nr_periods 40\nnr_throttled 2\n",
            path + "/cpuset.cpus.effective": "0-11", path + "/memory.max": "max",
            path + "/memory.high": "max", path + "/memory.current": str(256 * MIB)})
    return files


def detect(files):
    def read(path):
        if path not in files:
            raise FileNotFoundError(path)
        value = files[path]
        if isinstance(value, Exception):
            raise value
        return value
    return detect_render_capacity(read=read, affinity=set(range(12)), platform="linux",
                                  shared_available=64 * MIB, descriptors_available=512)


def test_v2_uses_all_visible_parents_affinity_cpuset_and_memory_high():
    files = v2()
    files["/cg/tenant/cpu.max"] = "450000 100000"
    files["/cg/tenant/session/cpu.max"] = "800000 100000"
    files["/cg/tenant/cpuset.cpus.effective"] = "2-6,9"
    files["/cg/tenant/memory.max"] = str(2 * 1024 * MIB)
    files["/cg/tenant/memory.current"] = str(1024 * MIB)
    files["/cg/tenant/session/memory.high"] = str(768 * MIB)
    result = detect(files)
    assert result.known and result.effective_cpus == 4.5
    assert result.memory_available == 512 * MIB
    assert result.throttling[0] == ("/cg/tenant/session", 40, 2)
    assert any("quota=450000" in item for item in result.provenance)


@pytest.mark.parametrize("missing", ["cpu.max", "memory.max", "memory.high", "cpuset.cpus.effective"])
@pytest.mark.parametrize("value", [None, PermissionError("denied"), "broken"])
def test_missing_unreadable_or_malformed_capacity_fails_closed(missing, value):
    files = v2()
    path = "/cg/tenant/" + missing
    if value is None:
        del files[path]
    else:
        files[path] = value
    result = detect(files)
    assert not result.known and result.effective_cpus <= 1
    assert "capacity unknown" in result.provenance[-1]


def test_namespaced_mount_at_nonstandard_escaped_path_and_root_membership():
    files = v2()
    files["/proc/self/cgroup"] = "0::/\n"
    files["/proc/self/mountinfo"] = r"1 0 0:1 /docker/123 /cg\040space rw - cgroup2 cgroup rw" + "\n"
    for name in ("cpu.max", "cpu.stat", "memory.max", "memory.high", "memory.current", "cpuset.cpus.effective"):
        files["/cg space/" + name] = files["/cg/" + name]
    files["/cg space/cpu.max"] = "200000 100000"
    result = detect(files)
    assert result.known and result.effective_cpus == 2
    assert any("hidden" in item for item in result.provenance)


def test_v2_global_root_membership_without_root_quota_files():
    files = v2()
    files["/proc/self/cgroup"] = "0::/\n"
    for name in ("cpu.max", "memory.max", "memory.high", "memory.current"):
        del files["/cg/" + name]
    result = detect(files)
    assert result.known and result.effective_cpus == 12
    assert result.memory_available == 8192 * MIB


@pytest.mark.parametrize("missing", [None, "cpu.max", "memory.max"])
def test_v2_namespace_root_retains_limits_and_requires_quota_files(missing):
    files = v2()
    files["/proc/self/cgroup"] = "0::/\n"
    files["/cg/cgroup.type"] = "domain\n"
    files["/cg/cpu.max"] = "400000 100000"
    files["/cg/memory.max"] = str(1024 * MIB)
    if missing:
        del files["/cg/" + missing]
    result = detect(files)
    assert result.known is (missing is None)
    if missing is None:
        assert result.effective_cpus == 4
        assert result.memory_available == 768 * MIB


def test_v2_root_type_permission_error_fails_closed():
    files = v2()
    files["/proc/self/cgroup"] = "0::/\n"
    files["/cg/cgroup.type"] = PermissionError("denied")
    assert not detect(files).known


def test_v1_split_controllers_parent_quotas_and_inherited_cpuset():
    files = {"/proc/meminfo": "MemAvailable: 8388608 kB\n", "/proc/self/cgroup":
        "2:cpu,cpuacct:/a/b\n3:cpuset:/a/b\n4:memory:/a/b\n", "/proc/self/mountinfo": "\n".join(
            f"{i} 0 0:1 /a /{kind} rw - cgroup cgroup rw,{kind}" for i, kind in enumerate(("cpu", "cpuset", "memory")))}
    for suffix in ("", "/b"):
        files.update({f"/cpu{suffix}/cpu.cfs_quota_us": "-1", f"/cpu{suffix}/cpu.cfs_period_us": "100000",
            f"/cpuset{suffix}/cpuset.cpus": "0-7" if not suffix else "",
            f"/memory{suffix}/memory.limit_in_bytes": str(2 * 1024 * MIB),
            f"/memory{suffix}/memory.usage_in_bytes": str(512 * MIB)})
    files["/cpu/cpu.cfs_quota_us"] = "350000"
    result = detect(files)
    assert result.known and result.effective_cpus == 3.5
    assert result.memory_available == 1536 * MIB
    del files["/cpu/cpu.cfs_quota_us"]
    assert not detect(files).known


def test_non_linux_uses_conservative_provenance_instead_of_host_core_count():
    result = detect_render_capacity(platform="darwin")
    assert not result.known and result.effective_cpus == 1


def roomy(cpus=8.):
    return RenderCapacity(cpus, True, 4096 * MIB, 64 * MIB)


def acquire(admission, owner):
    return admission.acquire(owner, workers=3, memory_bytes=400 * MIB, shared_bytes=4 * MIB)


@pytest.mark.parametrize("cpus,accepted", [(1., False), (2., False), (3.99, False), (4., True), (8., True)])
def test_minimum_is_two_branches_plus_suffix_and_one_cpu_headroom(cpus, accepted):
    admission = RenderAdmission(lambda: roomy(cpus))
    if accepted:
        assert acquire(admission, object()).workers == 3
    else:
        with pytest.raises(RenderAdmissionError, match="insufficient_cpu"):
            acquire(admission, object())


def test_concurrent_leases_cannot_each_claim_container_and_single_remains_available():
    admission = RenderAdmission(lambda: roomy(4))
    owners = [object() for _ in range(8)]
    barrier = threading.Barrier(len(owners))
    def start(owner):
        barrier.wait()
        try:
            acquire(admission, owner)
            return owner
        except RenderAdmissionError:
            return None
    with ThreadPoolExecutor(len(owners)) as executor:
        winners = [r for r in executor.map(start, owners) if r is not None]
    assert len(winners) == 1
    admission.reserve_single(owners[-1])
    admission.release(winners[0])
    for owner in owners:
        admission.release(owner)
    assert not admission.leases


def test_dynamic_limits_do_not_resize_existing_leases_and_account_for_preparers():
    current = roomy(8)
    admission = RenderAdmission(lambda: current)
    a, b, single = object(), object(), object()
    admission.reserve_single(single)
    assert admission.planning_limit(a, 8) == 6
    acquire(admission, a)
    current = roomy(4)
    with pytest.raises(RenderAdmissionError, match="insufficient_cpu"):
        acquire(admission, b)
    assert sorted(lease.workers for lease in admission.leases) == [1, 3]
    admission.release(a)
    admission.release(single)
    admission.register_preparer(a)
    admission.register_preparer(b)
    with pytest.raises(RenderAdmissionError, match="insufficient_cpu"):
        acquire(admission, single)
    admission.release_preparer(b)
    assert acquire(admission, single).workers == 3


@pytest.mark.parametrize("change,reason", [({"known": False}, "capacity_unknown"),
    ({"memory_available": 655 * MIB}, "insufficient_memory"),
    ({"shared_available": 3 * MIB}, "insufficient_shared"),
    ({"descriptors_available": 50}, "insufficient_descriptor")])
def test_resource_denial_preserves_existing_single_reservation(change, reason):
    admission = RenderAdmission(lambda: replace(roomy(), **change))
    owner = object()
    admission.reserve_single(owner)
    with pytest.raises(RenderAdmissionError, match=reason):
        acquire(admission, owner)
    assert admission.leases[0].workers == 1


def test_throttling_and_slow_requests_suppress_only_future_starts_until_cooldown():
    now = 10.
    current = replace(roomy(), throttling=(("/cg", 100, 90),))
    admission = RenderAdmission(lambda: current, clock=lambda: now)
    a, b = object(), object()
    acquire(admission, a)  # Historical throttling alone is not pressure now.
    current = replace(current, throttling=(("/cg", 120, 95),))
    with pytest.raises(RenderAdmissionError, match="recent_render_pressure"):
        acquire(admission, b)
    assert len(admission.leases) == 1
    now += 31
    acquire(admission, b)
    admission.release(b)
    admission.report_pressure()
    with pytest.raises(RenderAdmissionError, match="recent_render_pressure"):
        acquire(admission, b)
