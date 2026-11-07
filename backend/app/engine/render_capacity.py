"""Conservative, visible-hierarchy cgroup admission. No probes in the DSP loop.

The singleton leases capacity across all SessionService instances in this Python
process. A deployment with multiple API processes still needs external admission;
no local lease can reserve CPUs against unrelated containers or host processes.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import logging
import os
from pathlib import Path, PurePosixPath
import re
import sys
import threading
import time

MIB = 1024 * 1024
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RenderCapacity:
    effective_cpus: float
    known: bool
    memory_available: int
    shared_available: int
    provenance: tuple[str, ...] = ()
    throttling: tuple[tuple[str, int, int], ...] = ()
    descriptors_available: int = 256


def _cpu_set(text):
    values = set()
    for part in text.strip().split(","):
        if not part:
            continue
        ends = [int(n) for n in part.split("-")]
        first, last = ends[0], ends[-1]
        if len(ends) > 2 or first < 0 or last < first or last > 1_000_000:
            raise ValueError("Invalid cpuset")
        values.update(range(first, last + 1))
    return values


def _unescape(path):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), path)


def detect_render_capacity(*, read=None, affinity=None, platform=None, shared_available=None, descriptors_available=None):
    """Read mount/membership paths, not an assumed /sys/fs/cgroup layout.

    Missing/malformed required observations fail closed. Namespace-hidden parents
    cannot be read; record that limitation, honor every visible ancestor and the
    kernel's effective cpuset/affinity, and monitor throttling at later starts.
    Injection makes v1/v2, delegated mounts and permission failures testable.
    """
    read = read or (lambda path: Path(path).read_text())
    platform = platform or sys.platform
    notes, throttling = [], []
    cpus, memory, shared = 1., 0, 0
    try:
        if platform != "linux":
            raise ValueError("platform capacity unavailable; conservative one-CPU fallback")
        import resource
        allowed = set(affinity if affinity is not None else os.sched_getaffinity(0))
        if not allowed:
            raise ValueError("empty affinity")
        cpus = float(len(allowed))
        notes.append(f"affinity={len(allowed)}")
        info = dict(line.split(":", 1) for line in read("/proc/meminfo").splitlines() if ":" in line)
        memory = int(info["MemAvailable"].split()[0]) * 1024
        if shared_available is None:
            stat = os.statvfs("/dev/shm")
            shared_available = stat.f_bavail * stat.f_frsize
        shared = max(0, shared_available)
        if descriptors_available is None:
            limit = resource.getrlimit(resource.RLIMIT_NOFILE)[0]
            descriptors_available = (1_000_000 if limit == resource.RLIM_INFINITY else limit) - len(os.listdir("/proc/self/fd"))
        memberships = {}
        for line in read("/proc/self/cgroup").splitlines():
            _, controllers, group = line.split(":", 2)
            for controller in controllers.split(","):
                memberships[controller] = group
        mounts = []
        for line in read("/proc/self/mountinfo").splitlines():
            left, right = line.split(" - ", 1)
            fields, options = left.split(), right.split()
            if options[0] in {"cgroup", "cgroup2"}:
                mounts.append((options[0], _unescape(fields[3]), _unescape(fields[4]), set(options[2].split(","))))

        def hierarchy(controller):
            # Hybrid hosts may use v1 for individual controllers.
            v1 = controller in memberships
            group = memberships.get(controller if v1 else "")
            for kind, root, mount, controllers in mounts:
                if (v1 and (kind != "cgroup" or controller not in controllers)) or (not v1 and kind != "cgroup2"):
                    continue
                if group is None or ".." in PurePosixPath(group).parts:
                    continue
                try:
                    relative = PurePosixPath(group).relative_to(root)
                except ValueError:
                    if group != "/":
                        continue
                    relative = PurePosixPath(".")  # namespace-relative membership
                base = PurePosixPath(mount)
                leaf = base / relative
                notes.append(f"{controller}:{kind}:{leaf}; visible mount root={root}")
                if root != "/" or group == "/":
                    notes.append(f"{controller}: ancestors outside mount/namespace may be hidden")
                levels = [leaf, *list(leaf.parents)[:len(leaf.parts) - len(base.parts)]]
                # The global v2 root has no cpu.max or memory.max by definition.
                global_root = kind == "cgroup2" and root == "/" and group != "/"
                return kind, levels, base if global_root else None
            raise ValueError(f"{controller} hierarchy unavailable")

        kind, levels, root = hierarchy("cpu")
        for path in levels:
            try:
                if kind == "cgroup2":
                    quota, period = read(str(path / "cpu.max")).split()
                    limit = None if quota == "max" else int(quota)
                else:
                    quota = read(str(path / "cpu.cfs_quota_us")).strip()
                    period = read(str(path / "cpu.cfs_period_us")).strip()
                    limit = None if quota == "-1" else int(quota)
            except FileNotFoundError:
                if path == root:
                    continue
                raise
            period = int(period)
            if period <= 0 or (limit is not None and limit <= 0):
                raise ValueError("invalid CPU quota")
            if limit is not None:
                cpus = min(cpus, limit / period)
            notes.append(f"{path}:quota={quota}/{period}")
            try:
                stat = dict(line.split() for line in read(str(path / "cpu.stat")).splitlines())
                throttling.append((str(path), int(stat.get("nr_periods", 0)), int(stat.get("nr_throttled", 0))))
            except (OSError, ValueError):
                notes.append(f"{path}:throttling unavailable")
        kind, levels, _ = hierarchy("cpuset")
        for path in levels:
            name = "cpuset.cpus.effective" if kind == "cgroup2" else "cpuset.effective_cpus"
            try:
                value = read(str(path / name))
            except FileNotFoundError:
                value = read(str(path / "cpuset.cpus"))
            mask = _cpu_set(value)
            if mask:
                allowed &= mask
        cpus = min(cpus, len(allowed))
        kind, levels, root = hierarchy("memory")
        for path in levels:
            names = ("memory.max", "memory.current") if kind == "cgroup2" else ("memory.limit_in_bytes", "memory.usage_in_bytes")
            try:
                limit = read(str(path / names[0])).strip()
            except FileNotFoundError:
                if path == root:
                    continue
                raise
            used = int(read(str(path / names[1])).strip())
            if used < 0:
                raise ValueError("invalid memory usage")
            if limit != "max":
                memory = min(memory, max(0, int(limit) - used))
            if kind == "cgroup2":
                high = read(str(path / "memory.high")).strip()
                if high != "max":
                    memory = min(memory, max(0, int(high) - used))
            notes.append(f"{path}:memory_limit={limit},used={used}")
        if not math.isfinite(cpus) or cpus <= 0:
            raise ValueError("no effective CPU capacity")
        return RenderCapacity(cpus, True, memory, shared, tuple(notes), tuple(throttling), max(0, descriptors_available))
    except (OSError, ValueError, KeyError, IndexError, AttributeError) as exc:
        notes.append(f"capacity unknown: {exc}")
        return RenderCapacity(min(cpus, 1.), False, max(0, memory), shared, tuple(notes), tuple(throttling))


class RenderAdmissionError(RuntimeError):
    pass


@dataclass(frozen=True)
class RenderLease:
    workers: int
    memory_bytes: int = 0
    shared_bytes: int = 0
    capacity: RenderCapacity | None = None


class RenderAdmission:
    # One CPU and 256 MiB are reserved for API/coordinators and the persistent
    # preparation process together. These are conservative diagnostic budgets,
    # not a claim that arbitrary preparation workloads fit in this headroom.
    def __init__(self, probe=detect_render_capacity, *, clock=time.monotonic):
        self.probe, self.clock = probe, clock
        self._lock = threading.Lock()
        self._leases = {}
        self._suppressed_until = 0.
        self._last_throttling = {}
        self.last_capacity = None
        self._preparers = set()

    def register_preparer(self, owner):
        with self._lock:
            self._preparers.add(owner)

    def release_preparer(self, owner):
        with self._lock:
            self._preparers.discard(owner)

    def _cpu_headroom(self):
        return max(1., .5 + .5 * len(self._preparers))

    def planning_limit(self, owner, configured_limit):
        with self._lock:
            capacity = self.last_capacity = self.probe()
            logger.info("Render capacity: cpus=%s known=%s memory=%s shared=%s sources=%s",
                        capacity.effective_cpus, capacity.known, capacity.memory_available,
                        capacity.shared_available, capacity.provenance)
            if not capacity.known:
                raise RenderAdmissionError("capacity_unknown")
            available = math.floor(capacity.effective_cpus - self._cpu_headroom())
            available -= sum(lease.workers for key, lease in self._leases.items() if key is not owner)
            if available < 3:
                raise RenderAdmissionError("insufficient_cpu_capacity")
            return min(8, configured_limit, available)

    @property
    def leases(self):
        with self._lock:
            return tuple(self._leases.values())

    def reserve_single(self, owner):
        # Single playback always remains available. It still consumes headroom
        # from future parallel admissions, including while its Start is pending.
        with self._lock:
            self._leases.setdefault(owner, RenderLease(1, memory_bytes=128 * MIB))

    def release(self, owner):
        # Caller must have stopped/reaped every owner before releasing its lease.
        with self._lock:
            self._leases.pop(owner, None)

    def report_pressure(self):
        with self._lock:
            self._suppressed_until = self.clock() + 30.

    def acquire(self, owner, *, workers, memory_bytes, shared_bytes, minimum_cpus=0.):
        if not 3 <= workers <= 8 or memory_bytes <= 0 or shared_bytes <= 0:
            raise RenderAdmissionError("invalid_resource_estimate")
        with self._lock:
            capacity = self.last_capacity = self.probe()
            for path, periods, throttled in capacity.throttling:
                previous = self._last_throttling.get(path)
                if previous and periods > previous[0] and throttled >= previous[1]:
                    if (throttled - previous[1]) / (periods - previous[0]) > .1:
                        self._suppressed_until = self.clock() + 30.
                self._last_throttling[path] = (periods, throttled)
            others = [lease for key, lease in self._leases.items() if key is not owner]
            reason = None
            if not capacity.known:
                reason = "capacity_unknown"
            elif self.clock() < self._suppressed_until:
                reason = "recent_render_pressure"
            elif capacity.effective_cpus < minimum_cpus:
                reason = "qualification_capacity_changed"
            elif workers + sum(lease.workers for lease in others) > math.floor(capacity.effective_cpus - self._cpu_headroom()):
                reason = "insufficient_cpu_capacity"
            elif memory_bytes + sum(lease.memory_bytes for lease in others) + (128 * (1 + max(1, len(self._preparers)))) * MIB > capacity.memory_available:
                reason = "insufficient_memory_capacity"
            elif shared_bytes + sum(lease.shared_bytes for lease in others) > capacity.shared_available:
                reason = "insufficient_shared_memory_capacity"
            elif 32 + 8 * (workers + sum(lease.workers for lease in others)) > capacity.descriptors_available:
                reason = "insufficient_descriptor_capacity"
            if reason:
                raise RenderAdmissionError(reason)
            lease = RenderLease(workers, memory_bytes, shared_bytes, capacity)
            self._leases[owner] = lease
            return lease


PROCESS_RENDER_ADMISSION = RenderAdmission()
