"""Fail-closed, exact-build/workload qualification for internal renderer selection.

No production evidence is registered: T07 measurements must pass before entries
can be reviewed for release. Synthetic planner costs never establish eligibility.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import importlib.metadata
import math
from pathlib import Path
import platform
import sys


def runtime_fingerprint():
    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.app.services.sequencer_playback import implementation

    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.suffix in {".py", ".pxd", ".so", ".json"}):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(path.read_bytes())
    digest.update(repr((sys.version, platform.platform(), platform.machine(), implementation,
                        load_ctcsound_module().libcsound.csoundGetVersion())).encode())
    for package in ("ctcsound", "numpy", "pydantic"):
        digest.update(f"{package}:{importlib.metadata.version(package)}".encode())
    if sys.platform == "linux":
        # Keep changing MHz/processor counts out of this hardware identity. CPU
        # quotas/cpusets are checked independently at admission.
        cpu = Path("/proc/cpuinfo").read_text()
        digest.update(repr(sorted({line for line in cpu.splitlines() if line.startswith(
            ("model name", "Hardware", "CPU architecture", "CPU implementer", "CPU part"))})).encode())
        libraries = {line.split()[-1] for line in Path("/proc/self/maps").read_text().splitlines()
                     if "libcsound" in line and line.split()[-1].startswith("/")}
        if not libraries:
            raise RuntimeError("Cannot fingerprint the loaded native Csound build")
        for library in sorted(libraries):
            digest.update(Path(library).read_bytes())
    return digest.hexdigest()


@dataclass(frozen=True)
class QualificationEvidence:
    runtime: str
    artifact_hash: str
    plan_hash: str
    workload: str
    # Reviewable measurements, including the exact browser settings in both arms.
    report_digest: str
    single_settings: str
    parallel_settings: str
    effective_cpus: float
    single_p95_ms: float
    parallel_p95_ms: float
    single_p99_ms: float
    parallel_p99_ms: float
    single_browser_seconds: float
    parallel_browser_seconds: float
    single_underruns: int
    parallel_underruns: int
    stress_single_underruns: int
    stress_parallel_underruns: int
    stress_single_recovery_ms: float
    stress_parallel_recovery_ms: float
    private_memory_bytes: int
    native_correctness: bool
    final_image: bool

    def rejection(self):
        numbers = (self.effective_cpus, self.single_p95_ms, self.parallel_p95_ms,
                   self.single_p99_ms, self.parallel_p99_ms, self.single_browser_seconds,
                   self.parallel_browser_seconds, self.stress_single_recovery_ms, self.stress_parallel_recovery_ms)
        if any(not math.isfinite(value) or value < 0 for value in numbers):
            return "invalid_measurement"
        if (not self.native_correctness or not self.final_image or self.effective_cpus < 4
                or type(self.private_memory_bytes) is not int or self.private_memory_bytes <= 0
                or len(self.report_digest) != 64 or not self.workload
                or not self.single_settings or self.single_settings != self.parallel_settings):
            return "incomplete_qualification"
        if (self.single_p95_ms <= 0 or self.single_p99_ms <= 0
                or self.parallel_p95_ms > self.single_p95_ms * .8
                or self.parallel_p99_ms > self.single_p99_ms):
            return "insufficient_measured_benefit"
        if min(self.single_browser_seconds, self.parallel_browser_seconds) < 1800:
            return "browser_soak_incomplete"
        if (self.single_underruns != 0 or self.parallel_underruns != 0
                or self.stress_single_underruns < 0 or self.stress_parallel_underruns < 0
                or self.stress_parallel_underruns > self.stress_single_underruns
                or self.stress_parallel_recovery_ms > self.stress_single_recovery_ms):
            return "browser_underruns_or_recovery"
        return None


def select_qualification(records, *, runtime, compilation, plan):
    valid = [r for r in records if r.runtime == runtime and r.rejection() is None]
    if len({r.workload for r in valid}) < 2:
        return None  # G7 requires two representative heavy independent workloads.
    return next((r for r in valid if r.artifact_hash == compilation.artifact_hash and r.plan_hash == plan.plan_hash), None)
