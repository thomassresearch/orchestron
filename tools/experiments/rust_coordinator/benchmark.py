"""Matched, fresh-process coordinator trials using the retained worker workload."""
from __future__ import annotations

import argparse
from functools import partial
import hashlib
import itertools
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

from backend.experiments.rust_worker.benchmark import run as worker_workload
from backend.experiments.rust_worker.build import default_library
from backend.tools.benchmark_parallel_render import distribution, provenance
from .bridge import LIBRARY, OUTPUT, ROOT, SOURCE, RustCoordinator

MODULE = "tools.experiments.rust_coordinator.benchmark"
CASES = ["realtime_2:32", "realtime_4:32", "lake:32", "two:1"]
ORDERS = list(itertools.permutations(("python_a", "python_b", "rust")))
GATE = ("Exact traces and matching plan, workers and batch size; at least 10% lower median and p95, "
        "at most 5% p99 regression and 5% Python A/A median drift; 10% median gain in >=80% of rounds.")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity():
    files = [*SOURCE.glob("*.py"), *SOURCE.glob("*.rs"), SOURCE / "Cargo.toml", SOURCE / "Cargo.lock",
             *ROOT.glob("backend/experiments/rust_worker/*.py"), *ROOT.glob("backend/tests/fixtures/parallel_render/*"),
             ROOT / "backend/tests/lake_render_support.py", ROOT / "backend/tests/render_plan_support.py"]
    return {str(f.relative_to(ROOT)): digest(f) for f in files if f.is_file()}


def native_stamp():
    return {"sources": {p.name: digest(p) for p in (SOURCE / n for n in ("lib.rs", "sync.rs", "Cargo.toml", "Cargo.lock"))},
            "library": digest(LIBRARY)}


def trial(args):
    from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
    from backend.app.engine.parallel_csound_renderer import PartitionRenderCoordinator
    native = args.arm == "rust"
    coordinators = []

    def create(policy):
        coordinator = (RustCoordinator if native else PartitionRenderCoordinator)(policy=policy)
        coordinators.append(coordinator)
        return coordinator

    # The old probe selects the explicit Rust worker target in every arm. Only
    # the coordinator factory passed to the real session renderer varies.
    with patch("backend.app.engine.session_parallel_renderer.ParallelCsoundRenderer",
               partial(ParallelCsoundRenderer, coordinator_factory=create)):
        data = worker_workload(SimpleNamespace(**{**vars(args), "arm": "rust", "library": default_library()}))
    coordinator, = coordinators
    data["arm"] = args.arm
    data["native_batches"] = getattr(coordinator, "native_batches", 0)
    if native != (data["native_batches"] > 0):
        raise RuntimeError("Wrong coordinator executed")
    return data


def summarize(runs):
    def pooled(names, key):
        return distribution([v for name in names for r in runs[name] for v in r[key]])
    python = ["python_a", "python_b"]
    baseline = pooled(python, "wall_ms")
    candidate = pooled(["rust"], "wall_ms")
    gain = {k: 1 - candidate[k] / v for k, v in baseline.items()}
    drift = abs(1 - pooled(python[:1], "wall_ms")["median"] / pooled(python[1:], "wall_ms")["median"])
    paired = [1 - statistics.median(r["wall_ms"]) / statistics.mean(statistics.median(runs[a][i]["wall_ms"]) for a in python)
              for i, r in enumerate(runs["rust"])]
    cpu_base, cpu_rust = pooled(python, "parent_cpu_ms"), pooled(["rust"], "parent_cpu_ms")
    return dict(python_ms=baseline, rust_ms=candidate, gain=gain, aa_drift=drift, paired=paired,
                parent_cpu_median_ms=[cpu_base["median"], cpu_rust["median"]],
                passes=gain["median"] >= .10 and gain["p95"] >= .10 and gain["p99"] >= -.05 and drift <= .05
                       and sum(g >= .10 for g in paired) >= .8 * len(paired))


def run(args):
    stamp = native_stamp()
    if stamp != json.loads(LIBRARY.with_suffix(".stamp.json").read_text()):
        raise RuntimeError("Rebuild this coordinator before benchmarking")
    original = provenance()
    sources = identity()
    report = dict(gate=GATE, coordinator=stamp, worker_library_sha256=digest(default_library()), sources=sources,
                  provenance=original, settings=vars(args) | {"output": str(args.output)}, cases={})
    for case in args.scenarios:
        runs = {arm: [] for arm in ORDERS[0]}
        trace = None
        layout = None
        for i in range(-1, args.rounds):
            order = ("python_a", "rust") if i < 0 else ORDERS[i % 6]
            for arm in order:
                path = args.output.parent / f"{case.replace(':', '-')}-{arm}-{i}.json"
                cmd = [sys.executable, "-m", MODULE, "--child", "--arm", arm, "--output", str(path),
                       "--scenarios", case, "--frames", str(args.frames), "--batch-frames", str(args.batch_frames),
                       "--request-frames", str(args.request_frames), "--diagnostic-cpus", str(args.diagnostic_cpus)]
                if i < 0:
                    cmd.append("--trace")
                result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=360)
                if result.returncode:
                    raise RuntimeError(f"{case}/{arm}: {result.stderr[-4000:]}")
                data = json.loads(path.read_text())
                diagnostics = data["diagnostics"]
                actual = (data["plan_hash"], data["artifact_hash"], diagnostics["worker_count"], diagnostics["coordination_frames"])
                if layout is not None and layout != actual:
                    raise RuntimeError(f"Layout changed in {case}: {actual}")
                layout = actual
                if i < 0:
                    if trace is not None and trace != data["fingerprints"]:
                        raise RuntimeError(f"Trace mismatch in {case}: {trace} vs {data['fingerprints']}")
                    trace = data["fingerprints"]
                else:
                    runs[arm].append(data)
            print(f"{case}: " + ("exact trace matched" if i < 0 else f"round {i + 1}/{args.rounds}"), flush=True)
        report["cases"][case] = dict(trace=trace, layout=layout, **summarize(runs))
        print(f"{case}: {report['cases'][case]['gain']}", flush=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    if (sources != identity() or original["source_hashes"] != provenance()["source_hashes"]
            or stamp != native_stamp() or report["worker_library_sha256"] != digest(default_library())):
        raise RuntimeError("Source or native library changed during measurement")
    report["verified"] = True
    args.output.write_text(json.dumps(report, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT / sys.platform / "report.json")
    parser.add_argument("--scenarios", nargs="+", choices=CASES, default=CASES)
    parser.add_argument("--frames", type=int, default=98304)
    parser.add_argument("--request-frames", type=int, default=512)
    parser.add_argument("--batch-frames", type=int, default=256)
    parser.add_argument("--diagnostic-cpus", type=float, default=4.)
    parser.add_argument("--rounds", type=int, default=6)
    parser.add_argument("--arm", choices=ORDERS[0], default="python_a")
    parser.add_argument("--child", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--build", action="store_true", help="build the experiment and exit")
    args = parser.parse_args()
    if args.build:
        subprocess.run(["cargo", "build", "--locked", "--offline", "--release", "--manifest-path", str(SOURCE / "Cargo.toml"),
                        "--target-dir", str(LIBRARY.parents[1])], check=True)
        LIBRARY.with_suffix(".stamp.json").write_text(json.dumps(native_stamp()) + "\n")
        return
    if args.frames < args.request_frames or min(args.request_frames, args.rounds) <= 0:
        parser.error("Expected positive rounds/requests and at least one full request")
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
    os.environ["VISUALCSOUND_PARALLEL_WORKER"] = "rust"
    args.output = args.output.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.child:
        args.output.write_text(json.dumps(trial(args)) + "\n")
    else:
        run(args)


if __name__ == "__main__":
    main()
