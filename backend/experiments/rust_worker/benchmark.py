"""Fresh-process Python/Python/Rust comparisons; native service timing, not browser latency."""
from __future__ import annotations

import argparse
from dataclasses import asdict
from functools import partial
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time

from backend.tools.benchmark_parallel_render import ROOT, distribution, fingerprint, provenance


def source_hashes():
    files = [*Path(__file__).parent.glob("*.py"), Path(__file__).with_name("lib.rs"),
             Path(__file__).with_name("Cargo.toml"), *ROOT.glob("backend/tests/fixtures/parallel_render/*")]
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}


def run(args):
    import numpy as np
    from backend.app.engine.render_capacity import MIB, RenderAdmission, RenderCapacity, detect_render_capacity
    from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
    from backend.app.engine.session_renderer_options import SessionRendererOptions
    from backend.app.models.render_protocol import RendererPolicy
    from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.opcode_service import OpcodeService
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.experiments.rust_worker.bridge import run_python_worker, run_rust_worker
    from backend.tests.lake_render_support import lake_events, lake_inputs
    from backend.tests.render_plan_support import synthetic_costs
    from backend.tools._parallel_render_workload import Workload, build_workload_inputs

    case, ksmps = args.scenarios[0].split(":")
    ksmps = int(ksmps)
    if args.request_frames % ksmps or args.frames % args.request_frames:
        raise ValueError("Request/total frames must contain complete steps/requests")
    request = None
    if case == "lake":
        if ksmps != 32:
            raise ValueError("Lake retains its original K=32")
        targets, graph, mixer = lake_inputs(master_insert=True)
    else:
        fixture = ROOT / "backend/tests/fixtures/parallel_render/qualification_workloads.json"
        spec = next(c for c in json.loads(fixture.read_text())["cases"] if c["id"] == case)
        workload = Workload.model_validate({k: v for k, v in spec.items() if k != "filter_resonance"})
        targets, graph, mixer, request = build_workload_inputs(workload, ksmps)
        for target in targets:
            for node in target.patch.graph.nodes:
                if node.opcode == "moogladder" and "filter_resonance" in spec:
                    node.params["kres"] = spec["filter_resonance"]
    observed = detect_render_capacity()
    probe = detect_render_capacity if not args.diagnostic_cpus else lambda: RenderCapacity(
        args.diagnostic_cpus, True, 8192 * MIB, 64 * MIB, ("Explicit local diagnostic capacity",))
    admission = RenderAdmission(probe)
    options = SessionRendererOptions(policy=RendererPolicy(mode="parallel", max_workers=4,
        coordination_frames=args.batch_frames), costs=None if case == "lake" else synthetic_costs,
        allow_unqualified=True, admission=admission)
    worker = ParallelCsoundRenderer(options=options)
    if worker.backend != "ctcsound":
        raise RuntimeError("Native Csound required")
    if args.arm == "rust":
        worker._coordinator._target = partial(run_rust_worker, library=str(args.library.resolve()))
    else:
        # The application now defaults to Rust. Keep both control arms truly Python.
        worker._coordinator._target = run_python_worker
    compiler = CompilerService(OpcodeService("/static/icons"))
    canonical = compiler.compile_patch_bundle(targets, audio_graph=graph, mixer=mixer,
                                             midi_input="internal:loopback", rtmidi_module="null")
    worker.prepare(compiler, targets, graph, mixer, canonical)
    router = PerformanceMidiRouter(enqueue_timestamped_midi=worker.enqueue_timestamped_midi,
                                  current_engine_sample=lambda: worker.render_sample_cursor)
    sequencer = SessionSequencerRuntime(session_id="rust-experiment", midi_service=router,
        midi_input_selector="internal:loopback", clock_mode="render_driven", publish_event=lambda *_: None,
        controller_default_channels=tuple(t.midi_channel for t in targets if t.midi_channel))

    def before(_index, sample):
        tempo = sequencer.advance_render_block(sample_rate=48000, ksmps=ksmps, block_start_sample=sample)
        router.advance_render_block(block_start_sample=sample, block_end_sample=sample + ksmps,
                                    sample_rate=48000, tempo_bpm=tempo)

    midi = []
    if args.trace:
        drain = worker._midi_scheduler.drain_block

        def observed_drain(**kwargs):
            events = drain(**kwargs)
            midi.extend((kwargs["block_start_sample"], e.target_engine_sample, e.sequence, e.source,
                         list(e.message), e.late) for e in events)
            return events

        worker._midi_scheduler.drain_block = observed_drain
    pcm, meters, markers = hashlib.sha256(), [], []
    wall, cpu = [], []
    peak = 0.
    started = time.monotonic()
    try:
        worker.start(canonical.csd, "internal:loopback", "null")
        startup = time.monotonic() - started
        worker.configure_mixer(canonical.manifest, canonical.manifest["initialControls"])
        if request is not None:
            sequencer.configure(request)
            sequencer.start(0)
        else:
            # Real instruments/routing with a fixed nine-channel probe, NOT the saved arrangement.
            for offset in range(0, args.frames + 2048, 48000):
                for sample, message in lake_events():
                    worker.enqueue_timestamped_midi(message, source="lake-probe", target_engine_sample=offset + sample)
        callback = before if request is not None else None
        worker.render_blocks(block_count=2048 // ksmps, target_sample_rate=48000, before_block=callback)
        worker.drain_mixer_meters()
        sequencer.drain_render_transport_events(engine_sample_start=0, engine_sample_end=2048)
        for _ in range(args.frames // args.request_frames):
            started, used = time.perf_counter_ns(), time.process_time_ns()
            result = worker.render_blocks(block_count=args.request_frames // ksmps, target_sample_rate=48000,
                                          before_block=callback)
            wall.append((time.perf_counter_ns() - started) / 1e6)
            cpu.append((time.process_time_ns() - used) / 1e6)
            frame_meters = worker.drain_mixer_meters()
            frame_markers = sequencer.drain_render_transport_events(
                engine_sample_start=result.engine_sample_start, engine_sample_end=result.engine_sample_end)
            if args.trace:
                pcm.update(result.pcm_f32le)
                samples = np.frombuffer(result.pcm_f32le, dtype="<f4")
                if not np.isfinite(samples).all():
                    raise RuntimeError("Nonfinite PCM")
                peak = max(peak, float(np.max(np.abs(samples))))
                meters.extend(frame_meters)
                markers.extend(asdict(m) for m in frame_markers)
        diagnostics = worker.renderer_diagnostics
        if diagnostics["selected"] != "parallel":
            raise RuntimeError(f"Refusing fallback: {diagnostics}")
        compilation, plan = worker._candidate
        fingerprints = {"pcm": pcm.hexdigest(), "meters": fingerprint(meters), "midi": fingerprint(midi),
            "markers": fingerprint(markers), "status": fingerprint(sequencer.status().model_dump(mode="json")),
            "sample_end": worker.render_sample_cursor, "csd": hashlib.sha256(canonical.csd.encode()).hexdigest()}
    finally:
        worker.stop()
    if admission.leases or worker._coordinator.process_ids or worker._coordinator.shared_memory_name:
        raise RuntimeError("Leaked experiment resources")
    if args.trace and peak <= .00001:
        raise RuntimeError("No audible trace")
    return {"arm": args.arm, "scenario": args.scenarios[0], "wall_ms": [] if args.trace else wall,
        "parent_cpu_ms": [] if args.trace else cpu, "fingerprints": fingerprints if args.trace else None,
        "peak": peak if args.trace else None, "startup_seconds": startup, "diagnostics": diagnostics,
        "plan_hash": plan.plan_hash, "artifact_hash": compilation.artifact_hash, "cleaned": True,
        "observed_capacity": asdict(observed)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scenarios", nargs="+", default=["realtime_2:32", "realtime_4:32", "lake:32", "two:1"])
    parser.add_argument("--rounds", type=int, default=6)
    parser.add_argument("--frames", type=int, default=196608)
    parser.add_argument("--request-frames", type=int, default=512)
    parser.add_argument("--batch-frames", type=int, default=256)
    parser.add_argument("--diagnostic-cpus", type=float, default=0.)
    parser.add_argument("--child", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--arm", choices=["python_a", "python_b", "rust"], default="python_a")
    args = parser.parse_args()
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
    if args.frames < 512 or args.rounds < 1 or args.request_frames < 1:
        parser.error("Positive frames, request frames and rounds required")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.child:
        args.output.write_text(json.dumps(run(args), indent=2) + "\n")
        return
    stamp = json.loads(args.library.with_suffix(args.library.suffix + ".json").read_text())
    if stamp["library_sha256"] != hashlib.sha256(args.library.read_bytes()).hexdigest() or any(
        stamp["sources"][name] != hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
        for name in ("lib.rs", "Cargo.toml")):
        raise RuntimeError("Stale experiment binary; rebuild before measuring")
    report = {"scope": __doc__, "provenance": provenance(), "experiment_sources": source_hashes(), "build": stamp,
        "settings": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
        "criterion": "At least 10% lower median and p95; p99 regression <=5%; A/A median drift <=5%; exact traces.",
        "cases": {}}
    orders = [("python_a", "python_b", "rust"), ("rust", "python_b", "python_a"),
              ("python_b", "rust", "python_a"), ("python_a", "rust", "python_b"),
              ("rust", "python_a", "python_b"), ("python_b", "python_a", "rust")]
    for scenario in args.scenarios:
        arms = {arm: {"runs": []} for arm in orders[0]}
        for iteration in range(-1, args.rounds):
            order = ("python_a", "rust") if iteration < 0 else orders[iteration % len(orders)]
            for arm in order:
                destination = args.output.parent / f"{scenario.replace(':', '-')}-{arm}-{iteration}.json"
                command = [sys.executable, "-m", "backend.experiments.rust_worker.benchmark", "--child",
                    "--library", str(args.library.resolve()), "--output", str(destination), "--scenarios", scenario,
                    "--arm", arm, "--frames", str(args.frames), "--request-frames", str(args.request_frames),
                    "--batch-frames", str(args.batch_frames), "--diagnostic-cpus", str(args.diagnostic_cpus)]
                if iteration < 0:
                    command.append("--trace")
                result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=600)
                if result.returncode:
                    raise RuntimeError(f"{scenario}/{arm}: {result.stderr[-5000:]}")
                data = json.loads(destination.read_text())
                if iteration < 0:
                    arms[arm]["trace"] = data
                else:
                    arms[arm]["runs"].append(data)
            if iteration < 0:
                if arms["python_a"]["trace"]["fingerprints"] != arms["rust"]["trace"]["fingerprints"]:
                    raise RuntimeError(f"Exact parity failed for {scenario}; no timing accepted")
            else:
                print(f"{scenario}: round {iteration + 1}/{args.rounds} finished", flush=True)
        for arm in arms.values():
            arm["wall"] = distribution([v for run in arm["runs"] for v in run["wall_ms"]])
        baseline = distribution([v for name in ("python_a", "python_b") for r in arms[name]["runs"] for v in r["wall_ms"]])
        gains = {key: 1 - arms["rust"]["wall"][key] / baseline[key] for key in baseline}
        drift = abs(arms["python_a"]["wall"]["median"] / arms["python_b"]["wall"]["median"] - 1)
        paired = [1 - statistics.median(r["wall_ms"]) / statistics.mean(
            statistics.median(arms[name]["runs"][i]["wall_ms"]) for name in ("python_a", "python_b"))
            for i, r in enumerate(arms["rust"]["runs"])]
        report["cases"][scenario] = {"arms": arms, "baseline": baseline, "reduction": gains,
            "aa_median_drift": drift, "paired_median_reductions": paired,
            "passes_provisional_gate": gains["median"] >= .1 and gains["p95"] >= .1 and gains["p99"] >= -.05
                and drift <= .05 and sum(g >= .1 for g in paired) >= args.rounds * .8}
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(f"{scenario}: median {gains['median']:.1%}, p95 {gains['p95']:.1%}, p99 {gains['p99']:.1%}, A/A {drift:.1%}", flush=True)
    if report["experiment_sources"] != source_hashes() or report["provenance"]["source_hashes"] != provenance()["source_hashes"]:
        raise RuntimeError("Sources changed during measurement; reject this report")
    report["source_stability_verified"] = True
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
