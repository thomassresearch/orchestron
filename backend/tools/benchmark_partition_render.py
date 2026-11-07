"""Paired native T07 session-render measurements, never a browser qualification.

Fresh process per arm/trial; alternating order; identical 512-frame requests,
sequencing, MIDI, mixer, rates and fixtures. A separate trace verifies exact PCM,
markers, meters and final state. No loop instrumentation in timed trials. Use
--diagnostic-cpus only for local non-Linux experiments; it does not qualify a
deployment or alter production capacity detection.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time

from backend.tools._parallel_render_workload import Workload, build_workload_inputs
from backend.tools.benchmark_parallel_render import ROOT, distribution, fingerprint, provenance

FIXTURE = ROOT / "backend/tests/fixtures/parallel_render/qualification_workloads.json"


def run(args):
    import numpy as np
    from backend.app.engine.render_capacity import MIB, RenderAdmission, RenderCapacity, detect_render_capacity
    from backend.app.engine.renderer_factory import create_realtime_renderer
    from backend.app.engine.render_qualification import runtime_fingerprint
    from backend.app.engine.session_renderer_options import SessionRendererOptions
    from backend.app.models.render_protocol import RendererPolicy
    from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.opcode_service import OpcodeService
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.tests.render_plan_support import synthetic_costs

    specification = next(c for c in json.loads(FIXTURE.read_text())["cases"] if c["id"] == args.cases[0])
    case = Workload.model_validate({key: value for key, value in specification.items() if key != "filter_resonance"})
    compiler = CompilerService(OpcodeService("/static/icons"))
    targets, graph, mixer, request = build_workload_inputs(case, args.ksmps[0])
    if "filter_resonance" in specification:
        # Cascading 32 resonant filters attenuates even the fundamental into
        # silence. The heavy fixture must remain audible, with the same DSP in
        # both arms; don't weaken the trace's nonzero-audio assertion.
        for target in targets:
            for node in target.patch.graph.nodes:
                if node.opcode == "moogladder":
                    node.params["kres"] = specification["filter_resonance"]
    canonical = compiler.compile_patch_bundle(targets, audio_graph=graph, mixer=mixer,
                                              midi_input="internal:loopback", rtmidi_module="null")
    observed = detect_render_capacity()
    probe = detect_render_capacity
    if args.diagnostic_cpus:
        def probe():
            return RenderCapacity(args.diagnostic_cpus, True, 8192 * MIB, 64 * MIB,
                                  ("Operator-supplied local diagnostic budget; not detected/qualified",))
    admission = RenderAdmission(probe)
    options = SessionRendererOptions(policy=RendererPolicy(mode="parallel", max_workers=args.workers),
        costs=synthetic_costs, allow_unqualified=True, admission=admission)
    worker = create_realtime_renderer(renderer_options=options if args.renderer == "parallel" else None)
    if worker.backend != "ctcsound":
        raise RuntimeError("Refusing mock performance evidence")
    if args.renderer == "parallel":
        worker.prepare(compiler, targets, graph, mixer, canonical)
    candidate = worker._candidate if args.renderer == "parallel" else None
    identity = {"runtime": runtime_fingerprint(),
                "plan_hash": candidate[1].plan_hash if candidate else None,
                "artifact_hash": candidate[0].artifact_hash if candidate else None}
    router = PerformanceMidiRouter(enqueue_timestamped_midi=worker.enqueue_timestamped_midi,
                                  current_engine_sample=lambda: worker.render_sample_cursor)
    sequencer = SessionSequencerRuntime(session_id="qualification", midi_service=router,
        midi_input_selector="internal:loopback", clock_mode="render_driven", publish_event=lambda *_: None,
        controller_default_channels=tuple(range(1, case.sources + 1)))

    def before(_index, sample):
        tempo = sequencer.advance_render_block(sample_rate=48000, ksmps=args.ksmps[0], block_start_sample=sample)
        router.advance_render_block(block_start_sample=sample, block_end_sample=sample + args.ksmps[0],
                                    sample_rate=48000, tempo_bpm=tempo)

    wall, cpu, markers, meters = [], [], [], []
    pcm = hashlib.sha256()
    peak = 0.
    started = time.monotonic()
    try:
        worker.start(canonical.csd, "internal:loopback", "null")
        startup = time.monotonic() - started
        worker.configure_mixer(canonical.manifest, canonical.manifest["initialControls"])
        sequencer.configure(request)
        sequencer.start(0)
        worker.render_blocks(block_count=2048 // args.ksmps[0], target_sample_rate=48000, before_block=before)
        worker.drain_mixer_meters()
        sequencer.drain_render_transport_events(engine_sample_start=0, engine_sample_end=2048)
        for _ in range(args.frames // 512):
            start, used = time.perf_counter_ns(), time.process_time_ns()
            result = worker.render_blocks(block_count=512 // args.ksmps[0], target_sample_rate=48000, before_block=before)
            wall.append((time.perf_counter_ns() - start) / 1e6)
            cpu.append((time.process_time_ns() - used) / 1e6)
            if args.trace:
                pcm.update(result.pcm_f32le)
                samples = np.frombuffer(result.pcm_f32le, dtype="<f4")
                if not np.isfinite(samples).all():
                    raise RuntimeError("Nonfinite native PCM")
                peak = max(peak, float(np.max(np.abs(samples))))
                markers.extend(asdict(e) for e in sequencer.drain_render_transport_events(
                    engine_sample_start=result.engine_sample_start, engine_sample_end=result.engine_sample_end))
                meters.extend(worker.drain_mixer_meters())
            else:
                sequencer.drain_render_transport_events(engine_sample_start=result.engine_sample_start,
                                                       engine_sample_end=result.engine_sample_end)
                worker.drain_mixer_meters()
        diagnostics = worker.renderer_diagnostics if args.renderer == "parallel" else {"selected": "single"}
        shared = worker._coordinator._arena.size if args.renderer == "parallel" else 0
        pids = (os.getpid(), *(worker._coordinator.process_ids if args.renderer == "parallel" else ()))
        rss = {}
        for pid in pids:
            path = Path(f"/proc/{pid}/status")
            if path.exists():
                rss[str(pid)] = {line.split(":")[0]: line.split(":")[1].strip() for line in path.read_text().splitlines()
                                 if line.startswith(("VmRSS:", "VmHWM:"))}
        fingerprinted = {"pcm": pcm.hexdigest(), "meters": fingerprint(meters), "markers": fingerprint(markers),
            "status": fingerprint(sequencer.status().model_dump(mode="json")), "sample_end": worker.render_sample_cursor,
            "csd": hashlib.sha256(canonical.csd.encode()).hexdigest()}
    finally:
        stopped = time.monotonic()
        worker.stop()
        stop_seconds = time.monotonic() - stopped
    if args.trace and peak <= .00001:
        raise RuntimeError("No audible PCM in trace")
    if admission.leases:
        raise RuntimeError("Leaked render capacity")
    children = resource.getrusage(resource.RUSAGE_CHILDREN)
    return {"renderer": args.renderer, "identity": identity, "wall_ms": wall if not args.trace else [],
        "parent_cpu_ms": cpu if not args.trace else [], "fingerprints": fingerprinted if args.trace else None,
        "peak": peak if args.trace else None, "startup_seconds": startup, "stop_seconds": stop_seconds,
        "children_cpu_seconds_including_startup": children.ru_utime + children.ru_stime,
        "rss_after_render": rss, "parent_maxrss": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "shared_bytes": shared, "capacity": asdict(observed), "diagnostic_cpu_override": args.diagnostic_cpus,
        "capacity_after": asdict(detect_render_capacity()), "diagnostics": diagnostics, "cleaned": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cases", nargs="+", choices=tuple(c["id"] for c in json.loads(FIXTURE.read_text())["cases"]),
                        default=["two", "realtime_2", "realtime_4", "realtime_8", "heavy_4", "heavy_8"])
    parser.add_argument("--ksmps", nargs="+", type=int, choices=(1, 32), default=[32])
    parser.add_argument("--frames", type=int, default=98304)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--diagnostic-cpus", type=float)
    parser.add_argument("--renderer", choices=("single", "parallel"), default="single")
    parser.add_argument("--child", action="store_true")
    parser.add_argument("--trace", action="store_true")
    args = parser.parse_args()
    if args.frames < 12288 or args.frames % 512 or args.rounds < 1 or not 3 <= args.workers <= 8:
        parser.error("frames >= 12288 in multiples of 512; positive rounds; 3..8 workers")
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
    os.environ["VISUALCSOUND_AUDIO_OUTPUT_MODE"] = "browser_clock"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.child:
        args.output.write_text(json.dumps(run(args), indent=2) + "\n")
        return
    report = {"version": 1, "provenance": provenance(), "fixture_sha256": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
        "benchmark_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "planner_input_hashes": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in (
            ROOT / "backend/tests/render_plan_support.py", ROOT / "backend/tests/fixtures/parallel_render/planner_cases.json")},
        "frames": args.frames, "request_frames": 512, "warmup_frames": 2048, "rounds": args.rounds,
        "qualified": False, "scope": "Native session render calls; excludes API/browser. Synthetic costs select diagnostic plans only.", "cases": {}}
    with tempfile.TemporaryDirectory(prefix="partition-bench-") as directory:
        result_path = Path(directory) / "result.json"
        for ksmps in args.ksmps:
            for case in args.cases:
                arms = {"single": {"runs": []}, "parallel": {"runs": []}}
                for iteration in range(args.rounds + 1):
                    for renderer in (("single", "parallel") if iteration % 2 == 0 else ("parallel", "single")):
                        command = [sys.executable, "-m", "backend.tools.benchmark_partition_render", "--child",
                            "--output", str(result_path), "--cases", case, "--ksmps", str(ksmps), "--frames", str(args.frames),
                            "--workers", str(args.workers), "--renderer", renderer]
                        if iteration == 0:
                            command.append("--trace")
                        if args.diagnostic_cpus:
                            command.extend(["--diagnostic-cpus", str(args.diagnostic_cpus)])
                        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=600)
                        if result.returncode:
                            raise RuntimeError(f"{case}/{renderer} failed: {result.stderr[-3000:]}")
                        data = json.loads(result_path.read_text())
                        if iteration == 0:
                            arms[renderer]["trace"] = data
                        else:
                            arms[renderer]["runs"].append(data)
                if arms["single"]["trace"]["fingerprints"] != arms["parallel"]["trace"]["fingerprints"]:
                    raise RuntimeError(f"{case}/{ksmps}: native behavior differs")
                for arm in arms.values():
                    values = [v for r in arm["runs"] for v in r["wall_ms"]]
                    arm["wall_ms"] = distribution(values)
                    arm["render_audio_ratio"] = distribution([v / (512 / 48) for v in values])
                arms["p95_reduction"] = 1 - arms["parallel"]["wall_ms"]["p95"] / arms["single"]["wall_ms"]["p95"]
                report["cases"][f"{case}/k{ksmps}"] = arms
                print(f"{case}/k{ksmps}: p95 reduction {arms['p95_reduction']:.1%}", flush=True)
    if report["provenance"]["source_hashes"] != provenance()["source_hashes"]:
        raise RuntimeError("Sources changed during measurement")
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
