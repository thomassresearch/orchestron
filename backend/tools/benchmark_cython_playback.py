"""Paired playback timing, PCM parity and separate profiling.

uv run --extra dev python -m backend.tools.benchmark_cython_playback --output output/playback
Use --baseline-source PATH to also compare a frozen pre-extraction checkout.
Requires native Csound and an installed extension; never silently benchmarks fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import statistics
import subprocess
import sys


def run_case(args, arm, suite, mode, name):
    path = args.output / (name + ".json")
    if path.exists() and json.loads(path.read_text()).get("complete"):
        return
    source = args.baseline_source if arm == "baseline" else Path(__file__).resolve().parents[2]
    environment = {
        **os.environ,
        "EVAL_SOURCE": str(source),
        "EVAL_OUTPUT": str(path),
        "EVAL_ARM": arm,
        "EVAL_SUITE": suite,
        "EVAL_MODE": mode,
        "EVAL_ITERATIONS": str(args.iterations),
        "EVAL_WARMUP": str(args.warmup),
        "VISUALCSOUND_SEQUENCER_IMPLEMENTATION": "python" if arm == "baseline" else arm,
    }
    with path.with_suffix(".log").open("w") as log:
        subprocess.run(
            [sys.executable, str(Path(__file__).with_name("_playback_benchmark_cases.py"))],
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )
    print(name, flush=True)


def summarize(args, arms, suites):
    result = []
    rng = random.Random(64190)
    reference = arms[0]
    for suite in suites:
        for arm in arms[1:]:
            pairs = [
                [json.loads((args.output / f"{index}_{suite}_{value}.json").read_text()) for value in (reference, arm)]
                for index in range(args.rounds)
            ]
            for before, after in pairs:
                for key in ("pcm_hashes", "live_pcm_hash", "live_timeline_hash"):
                    if key in before:
                        assert before[key] == after[key], (suite, arm, key)
            for metric in pairs[0][0]["metrics"]:
                for statistic in ("median", "p95", "p99", "max"):
                    before = [a["metrics"][metric][statistic] for a, b in pairs]
                    after = [b["metrics"][metric][statistic] for a, b in pairs]
                    reductions = [100 * (1 - b / a) for a, b in zip(before, after)]
                    boot = sorted(statistics.median(rng.choices(reductions, k=len(reductions))) for _ in range(2000))
                    noise = []
                    for index in range(args.controls):
                        a, b = [
                            json.loads((args.output / f"control_{index}_{suite}_{v}.json").read_text())
                            for v in ("A", "B")
                        ]
                        noise.append(100 * (1 - b["metrics"][metric][statistic] / a["metrics"][metric][statistic]))
                    result.append(
                        {
                            "reference": reference,
                            "candidate": arm,
                            "suite": suite,
                            "metric": metric,
                            "statistic": statistic,
                            "baseline_ms": statistics.median(before),
                            "candidate_ms": statistics.median(after),
                            "reduction_percent": statistics.median(reductions),
                            "paired_reductions_percent": reductions,
                            "bootstrap_95_ci": [boot[49], boot[1949]],
                            "aa_changes_percent": noise,
                        }
                    )
    (args.output / "summary.json").write_text(json.dumps(result, indent=2))
    for item in result:
        if (item["metric"], item["statistic"]) in {
            ("pad_switch_128", "median"),
            ("dense_ratchet_128_512ms", "median"),
            ("live_ratchet_64_4s", "median"),
            ("live_chunk_10.667ms", "p99"),
        }:
            print(
                f"{item['candidate']}: {item['metric']}/{item['statistic']}: "
                f"{item['baseline_ms']:.3f} → {item['candidate_ms']:.3f} ms "
                f"({item['reduction_percent']:.1f}% less time)"
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline-source", type=Path)
    parser.add_argument("--rounds", type=int, default=8)
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--controls", type=int, default=2)
    parser.add_argument("--suite", choices=("all", "runtime", "dense", "live"), default="all")
    parser.add_argument("--profile", action="store_true", help="Separate diagnostic run; no speedup claims")
    parser.add_argument("--check-only", action="store_true", help="MIDI/marker/configuration fingerprints")
    args = parser.parse_args()
    if min(args.rounds, args.iterations) < 1 or min(args.warmup, args.controls) < 0:
        parser.error("rounds/iterations must be positive; warmup/controls must be nonnegative")
    if args.profile and (args.suite == "live" or args.check_only):
        parser.error("profiling supports runtime/dense suites and cannot be combined with check-only")
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.baseline_source:
        args.baseline_source = args.baseline_source.resolve()
        if not (args.baseline_source / "backend/app/services/sequencer_runtime.py").is_file():
            parser.error("baseline-source must contain a backend source checkout")
    arms = (["baseline"] if args.baseline_source else []) + ["python", "cython"]
    suites = ("runtime", "dense", "live") if args.suite == "all" else (args.suite,)
    if args.profile:
        suites = tuple(suite for suite in suites if suite != "live")
    parameters = {**vars(args), "output": str(args.output), "baseline_source": str(args.baseline_source), "arms": arms}
    # Resuming must not mix observations from different source or native builds.
    sources = [Path(__file__).resolve().parents[2]]
    if args.baseline_source:
        sources.append(args.baseline_source)
    parameters["source_hashes"] = {
        str(source): {
            str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted((source / "backend").rglob("*"))
            if path.is_file() and path.suffix in {".py", ".pxd", ".so", ".pyd"}
        }
        for source in sources
    }
    manifest = args.output / "parameters.json"
    if manifest.exists() and json.loads(manifest.read_text()) != parameters:
        parser.error("output already contains a different comparison; use a new output directory")
    manifest.write_text(json.dumps(parameters, indent=2))
    if args.profile:
        for arm in arms:
            for suite in suites:
                run_case(args, arm, suite, "profile", f"profile_{suite}_{arm}")
        return
    # Correctness work is deliberately outside timed processes.
    for arm in arms:
        run_case(args, arm, "runtime", "fingerprint", "fingerprint_" + arm)
    fingerprints = [json.loads((args.output / f"fingerprint_{arm}.json").read_text()) for arm in arms]
    for key in ("fingerprint", "dense_fingerprint"):
        assert len({item[key] for item in fingerprints}) == 1, key
    if args.check_only:
        print("MIDI, markers, status and prepared configuration match.")
        return
    for suite in suites:
        for index in range(args.controls):
            for label in ("A", "B"):
                run_case(args, arms[0], suite, "timing", f"control_{index}_{suite}_{label}")
    for index in range(args.rounds):
        order = arms[index % len(arms) :] + arms[: index % len(arms)]
        if (index // len(arms)) % 2:
            order.reverse()
        for suite in suites:
            for arm in order:
                run_case(args, arm, suite, "timing", f"{index}_{suite}_{arm}")
    summarize(args, arms, suites)


if __name__ == "__main__":
    main()
