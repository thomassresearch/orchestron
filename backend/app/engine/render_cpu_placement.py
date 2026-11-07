"""Startup-only Linux CPU placement for persistent native rendering owners.

Short barrier-driven tasks can repeatedly wake on the same CPU. Reserve distinct
allowed logical CPUs across coordinators in this API process; capacity admission
still owns quota/headroom accounting. Nothing pins the parent, compiler or single
renderer, and no affinity operations enter the audio loop.
"""
from __future__ import annotations

import os
import sys
import threading


def _allowed_cpus():
    return os.sched_getaffinity(0) if sys.platform == "linux" else None


class RenderCpuPlacement:
    def __init__(self, allowed_cpus=_allowed_cpus):
        self._allowed_cpus = allowed_cpus
        self._lock = threading.Lock()
        self._owners = {}

    def acquire(self, owner, workers):
        allowed = self._allowed_cpus()
        if allowed is None:
            return (None,) * workers
        with self._lock:
            if owner in self._owners:
                raise RuntimeError("Rendering CPU placement is still owned by the previous epoch.")
            occupied = {cpu for lease in self._owners.values() for cpu in lease}
            free = sorted(set(allowed) - occupied)
            if len(free) < workers:
                raise RuntimeError("Insufficient distinct allowed CPUs for rendering workers.")
            lease = tuple(free[:workers])
            self._owners[owner] = lease
            return lease

    def release(self, owner):
        # Only after every native owner has been stopped/reaped.
        with self._lock:
            self._owners.pop(owner, None)


def apply_worker_cpu(cpu):
    if cpu is None:
        return
    if type(cpu) is not int or cpu < 0 or cpu not in os.sched_getaffinity(0):
        raise RuntimeError("Rendering CPU is no longer allowed at child startup.")
    os.sched_setaffinity(0, {cpu})
    if os.sched_getaffinity(0) != {cpu}:
        raise RuntimeError("Rendering CPU placement could not be verified.")


PROCESS_RENDER_CPU_PLACEMENT = RenderCpuPlacement()
