"""On-demand Linux CPU observations, entirely outside PCM/rendering callbacks."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import threading
import time


def read_cpu_ticks():
    result = {}
    for line in Path("/proc/stat").read_text().splitlines():
        name, *values = line.split()
        if name.startswith("cpu") and name[3:].isdigit():
            ticks = list(map(int, values[:8]))  # Guest time is already in user/nice.
            if len(ticks) != 8:
                raise ValueError("Incomplete CPU counters")
            result[int(name[3:])] = (sum(ticks), ticks[3] + ticks[4])
    return result


def read_process_ticks():
    # comm may contain spaces and parentheses. Fields after its final ')' start
    # with field 3; utime/stime are fields 14/15, starttime is field 22.
    fields = Path("/proc/self/stat").read_text().rsplit(")", 1)[1].split()
    return int(fields[19]), int(fields[11]) + int(fields[12])


class EngineStatsSampler:
    def __init__(self, *, clock=time.monotonic, cpu_reader=read_cpu_ticks, process_reader=read_process_ticks):
        self.clock, self.cpu_reader, self.process_reader = clock, cpu_reader, process_reader
        self._lock = threading.Lock()
        self._last = None
        self._cached = None
        self._cached_at = 0.
        self._identity = None

    def sample(self, *, running, assignments=()):
        with self._lock:
            identity = (running, assignments)
            now = self.clock()
            if self._cached is not None and identity == self._identity and now - self._cached_at < 1.:
                return self._cached
            empty = dict(available=False, scope="unavailable", cpus=[], process_percent=None, sample_seconds=None)
            if identity != self._identity:
                self._last = None
            self._identity = identity
            try:
                if not running or sys.platform != "linux":
                    self._last = None
                    result = empty
                elif assignments:
                    if any(cpu is None or os.sched_getaffinity(pid) != {cpu} for pid, cpu in assignments):
                        raise ValueError("Renderer CPU assignment changed")
                    ids = sorted({cpu for _, cpu in assignments})
                    ticks = self.cpu_reader()
                    elapsed = now - self._last[0] if self._last is not None else None
                    cpus = []
                    for cpu in ids:
                        total, idle = ticks[cpu]
                        percent = None
                        if self._last is not None and cpu in self._last[1]:
                            before_total, before_idle = self._last[1][cpu]
                            delta, idle_delta = total - before_total, idle - before_idle
                            if delta > 0 and 0 <= idle_delta <= delta:
                                percent = round(100 * (delta - idle_delta) / delta, 1)
                        cpus.append(dict(cpu=cpu, percent=percent))
                    self._last = (now, ticks)
                    result = dict(available=True, scope="renderer_cpus", cpus=cpus,
                                  process_percent=None, sample_seconds=elapsed)
                else:
                    started, ticks = self.process_reader()
                    percent = None
                    elapsed = now - self._last[0] if self._last is not None else None
                    if self._last is not None and started == self._last[1] and ticks >= self._last[2] and elapsed > 0:
                        percent = round(100 * (ticks - self._last[2]) / os.sysconf("SC_CLK_TCK") / elapsed, 1)
                    self._last = (now, started, ticks)
                    result = dict(available=True, scope="server_process", cpus=[],
                                  process_percent=percent, sample_seconds=elapsed)
            except (OSError, ValueError, KeyError, IndexError):
                self._last = None
                result = empty
            self._cached, self._cached_at = result, now
            return result
