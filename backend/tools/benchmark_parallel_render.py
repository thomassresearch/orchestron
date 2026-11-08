"""T01 native baseline and T02 factory comparison. No parallel renderer is activated.

Run: .venv/bin/python -m backend.tools.benchmark_parallel_render --output output/parallel-baseline.json
Traces run separately from uninstrumented timings. Each trial uses a fresh process.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time

from backend.tools._parallel_render_workload import FIXTURE, build_workload, load_workloads

ROOT = Path(__file__).resolve().parents[2]


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def distribution(values):
    ordered = sorted(values)
    return {"median": statistics.median(ordered),
            **{f"p{p}": ordered[max(0, math.ceil(len(ordered) * p / 100) - 1)] for p in (95, 99)},
            "max": ordered[-1]}


def run_case(case_id, ksmps, frames, *, trace=False):
    import numpy as np
    from backend.app.engine.csound_worker import CsoundWorker
    from backend.app.engine.renderer_factory import create_realtime_renderer
    from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
    from backend.app.services.compiler_mixer import channel
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    artifact, request = build_workload(load_workloads()[case_id], ksmps)
    worker = create_realtime_renderer()
    if type(worker) is not CsoundWorker:
        raise RuntimeError("This baseline requires the original single renderer")
    if worker.backend != "ctcsound":
        raise RuntimeError("Native Csound is required; refusing mock baseline")
    midi, markers, meters, edits, controls = [], [], [], [], []
    block_trace = hashlib.sha256()
    if trace:
        drain = worker._midi_scheduler.drain_block

        def observed_drain(**kwargs):
            events = drain(**kwargs)
            midi.extend({"block": kwargs["block_start_sample"], "sample": e.target_engine_sample,
                         "sequence": e.sequence, "source": e.source, "message": list(e.message), "late": e.late}
                        for e in events)
            return events

        worker._midi_scheduler.drain_block = observed_drain
    router = PerformanceMidiRouter(enqueue_timestamped_midi=worker.enqueue_timestamped_midi,
                                  current_engine_sample=lambda: worker.render_sample_cursor)
    sequencer = SessionSequencerRuntime(session_id="parallel-baseline", midi_service=router,
                                       midi_input_selector="internal:loopback", clock_mode="render_driven",
                                       controller_default_channels=tuple(range(1, load_workloads()[case_id].sources + 1)),
                                       publish_event=lambda *_: None)

    def before_block(_, sample):
        if trace:
            block_trace.update(f"{sample}:{worker.render_sample_cursor}\n".encode())
        tempo = sequencer.advance_render_block(sample_rate=48000, ksmps=ksmps, block_start_sample=sample)
        router.advance_render_block(block_start_sample=sample, block_end_sample=sample + ksmps,
                                    sample_rate=48000, tempo_bpm=tempo)

    wall, cpu, pcm = [], [], hashlib.sha256()
    peak = 0.0
    try:
        worker.start(artifact.csd, "internal:loopback", "null")
        if (worker.runtime_ksmps, worker.runtime_sample_rate) != (ksmps, 48000):
            raise RuntimeError("Unexpected native engine settings")
        worker.configure_mixer(artifact.manifest, artifact.manifest["initialControls"])
        sequencer.configure(request)
        sequencer.start(0)
        worker.render_blocks(block_count=2048 // ksmps, target_sample_rate=48000, before_block=before_block)
        native = worker._csound
        capabilities = {name: callable(getattr(native, name, None)) for name in
                        ("audioChannel", "setAudioChannel", "spin", "spout", "sizeOfMYFLT", "setControlChannel")}
        native_dtype = str(np.asarray(native.spout()).dtype)
        midi.clear()
        block_trace = hashlib.sha256()
        worker.drain_mixer_meters()
        sequencer.drain_render_transport_events(engine_sample_start=0, engine_sample_end=2048)
        for offset in range(0, frames, 512):
            if offset == 4096:
                changed = request.model_copy(deep=True)
                changed.timing.tempo_bpm = 137
                changed.tracks[0].pads[0].steps[0] = 77
                prepared = compile_sequencer_runtime_config(changed, controller_default_channels=(1,))
                worker.run_at_render_boundary(lambda: sequencer.apply_prepared(prepared))
                edits.append(worker.render_sample_cursor)
            if offset == 8192:
                values = {channel("strip", "source0", "gain"): .5}
                worker.queue_control_channels(values)
                controls.append({"sample": worker.render_sample_cursor, "values": values})
                worker.enqueue_timestamped_midi([0xB0, 74, 99], source="manual",
                                                target_engine_sample=worker.render_sample_cursor + 17)
            started, used = time.perf_counter_ns(), time.process_time_ns()
            result = worker.render_blocks(block_count=512 // ksmps, target_sample_rate=48000,
                                          before_block=before_block)
            wall.append((time.perf_counter_ns() - started) / 1e6)
            cpu.append((time.process_time_ns() - used) / 1e6)
            pcm.update(result.pcm_f32le)
            samples = np.frombuffer(result.pcm_f32le, dtype=np.float32)
            if not np.isfinite(samples).all():
                raise RuntimeError("Native baseline contains nonfinite PCM")
            peak = max(peak, float(np.max(np.abs(samples))))
            markers.extend(asdict(e) for e in sequencer.drain_render_transport_events(
                engine_sample_start=result.engine_sample_start, engine_sample_end=result.engine_sample_end))
            meters.extend(worker.drain_mixer_meters())
        if not math.isfinite(peak) or peak <= .00001:
            raise RuntimeError("Native baseline must contain finite, audible PCM")
        return {"renderer": "single", "binding": type(native).__name__, "capabilities": capabilities,
                "native_sample_dtype": native_dtype, "csd_hash": hashlib.sha256(artifact.csd.encode()).hexdigest(),
                "peak": peak, "wall_ms": wall if not trace else [], "cpu_ms": cpu if not trace else [],
                "fingerprints": {"pcm": pcm.hexdigest(), "markers": fingerprint(markers), "meters": fingerprint(meters),
                                 "status": fingerprint(sequencer.status().model_dump(mode="json")),
                                 "edits": edits, "controls": controls, "sample_end": worker.render_sample_cursor},
                "trace": {"blocks_hash": block_trace.hexdigest(), "blocks": frames // ksmps,
                          "midi": midi, "markers": markers, "meters": meters} if trace else None}
    finally:
        worker.stop()


def provenance():
    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.app.services.sequencer_playback import implementation
    def git(*args):
        try:
            result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True)
        except FileNotFoundError:
            return None  # Minimal runtime images need not contain Git.
        return result.stdout.strip() if result.returncode == 0 else None
    sources = sorted([*ROOT.glob("backend/app/**/*.py"), *ROOT.glob("backend/app/**/*.pxd"),
                      *ROOT.glob("backend/app/**/*.so"), *ROOT.glob("backend/app/data/*.json"),
                      Path(__file__), Path(__file__).with_name("_parallel_render_workload.py"),
                      ROOT / "pyproject.toml", ROOT / "uv.lock", ROOT / "Dockerfile"])
    return {"captured_utc": datetime.now(timezone.utc).isoformat(),
            "revision": git("rev-parse", "HEAD"), "dirty_status": git("status", "--porcelain"),
            "source_hashes": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources if p.is_file()},
            "unavailable_sources": [str(p.relative_to(ROOT)) for p in sources if not p.is_file()],
            "fixture_hash": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(), "python": sys.version,
            "platform": platform.platform(), "architecture": platform.machine(), "cpu_count": os.cpu_count(),
            "affinity": sorted(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
            "csound_version": load_ctcsound_module().libcsound.csoundGetVersion(), "sequencer": implementation,
            "binding_package": importlib.metadata.version("ctcsound"),
            "container_image_digest": os.getenv("ORCHESTRON_BASELINE_IMAGE_DIGEST"),
            "cgroup_observation": {p: Path(p).read_text() for p in
                ("/proc/self/cgroup", "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/cpuset.cpus.effective",
                 "/sys/fs/cgroup/memory.max") if Path(p).is_file()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--frames", type=int, default=24576)
    parser.add_argument("--cases", nargs="+", choices=list(load_workloads()), default=list(load_workloads()))
    parser.add_argument("--ksmps", nargs="+", type=int, choices=(1, 32), default=[1, 32])
    parser.add_argument("--compare", type=Path)
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--trace", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.rounds < 1 or args.frames < 12288 or args.frames % 512:
        parser.error("rounds must be positive; frames must be a multiple of 512 and at least 12288")
    # Only this standalone command overrides mock mode; imports/tests do not mutate the environment.
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
    os.environ["VISUALCSOUND_AUDIO_OUTPUT_MODE"] = "browser_clock"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.child:
        result = run_case(args.cases[0], args.ksmps[0], args.frames, trace=args.trace)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
        return
    import tempfile
    report = {"version": 1, "provenance": provenance(), "frames": args.frames, "rounds": args.rounds,
              "sample_rate": 48000, "request_frames": 512, "warmup_frames": 2048, "cases": {},
              "measurement_scope": "Native single render calls including sequencing; excludes API, browser, startup and compile"}
    with tempfile.TemporaryDirectory(prefix="orchestron-baseline-") as directory:
        output = Path(directory) / "run.json"
        for ksmps in args.ksmps:
            for case in args.cases:
                results = []
                for iteration in range(args.rounds + 2):
                    traced = iteration < 2
                    command = [sys.executable, "-m", "backend.tools.benchmark_parallel_render", "--child",
                               "--output", str(output), "--frames", str(args.frames), "--cases", case,
                               "--ksmps", str(ksmps)] + (["--trace"] if traced else [])
                    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=180)
                    if completed.returncode:
                        raise RuntimeError(f"Baseline child failed: {completed.stderr[-4000:]}")
                    results.append(json.loads(output.read_text()))
                reference, repeated, *runs = results
                if reference["trace"] != repeated["trace"]:
                    raise RuntimeError(f"Nondeterministic trace: {case}/{ksmps}")
                if any(r["fingerprints"] != reference["fingerprints"] or r["csd_hash"] != reference["csd_hash"]
                       for r in results[1:]):
                    raise RuntimeError(f"Nondeterministic audio/state: {case}/{ksmps}")
                wall = [value for run in runs for value in run["wall_ms"]]
                result = {"reference": reference, "runs": runs, "wall_ms": distribution(wall),
                          "render_audio_ratio": distribution([v / (512 / 48) for v in wall])}
                report["cases"][f"{case}/k{ksmps}"] = result
                print(f"{case}/k{ksmps}: {result['wall_ms']}", flush=True)
    if args.compare:
        baseline = json.loads(args.compare.read_text())
        for key in ("version", "frames", "sample_rate", "request_frames", "warmup_frames"):
            if baseline[key] != report[key]:
                raise ValueError(f"Incompatible baseline: {key}")
        for key in ("fixture_hash", "python", "platform", "csound_version", "sequencer", "binding_package"):
            if baseline["provenance"][key] != report["provenance"][key]:
                raise ValueError(f"Incompatible runtime: {key}")
        if baseline["cases"].keys() != report["cases"].keys():
            raise ValueError("Incompatible workload selection")
        for key, result in report["cases"].items():
            old = baseline["cases"][key]
            for field in ("fingerprints", "trace", "csd_hash", "binding", "native_sample_dtype"):
                if old["reference"][field] != result["reference"][field]:
                    raise ValueError(f"Behavior changed: {key}/{field}")
        report["comparison"] = {"behavior_identical": True, "baseline": str(args.compare),
                                "note": "No speedup assertion; A/A timing noise must be evaluated separately"}
    if report["provenance"]["source_hashes"] != provenance()["source_hashes"]:
        raise RuntimeError("Sources changed during measurement; discard this timing run and retry")
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
