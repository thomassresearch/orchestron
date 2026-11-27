"""Compare the production live mixer and the frozen reference with native Csound."""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time
from unittest.mock import patch

from backend.app.services import compiler_mixer

MODULE = "tools.experiments.mixer_ramps.probe"
ROOT = Path(__file__).resolve().parents[3]
if Path(compiler_mixer.__file__).resolve() != ROOT / "backend/app/services/compiler_mixer.py":
    raise RuntimeError("Run the probe against the compiler in this checkout")
REFERENCE = (ROOT / "backend/tests/fixtures/csound/mixer_ramp_reference.orc").read_text().rstrip("\n")
CANDIDATE = compiler_mixer.SETTLED_RAMP_OPCODE
CASES = ("settled", "moving", "dense", "small")
RENDERERS = ("single", "parallel")
FRAMES = 512
RATE = 48000


def waveform():
    """Both algorithms in the same native instance; compare every double as bits."""
    import numpy as np
    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.tests.test_mixer_audio import engine
    from types import SimpleNamespace
    native = load_ctcsound_module()
    checked = []
    for rate, k in ((48000, 1), (44100, 32), (48000, 32), (96000, 32), (48000, 1920)):
        emitted = compiler_mixer.RAMP_OPCODE if k == 1 else CANDIDATE
        orc = f"""sr={rate}
ksmps={k}
nchnls=2
0dbfs=1
{REFERENCE}
{emitted.replace('opcode vcs_mixer_ramp,', 'opcode vcs_probe_ramp,')}
instr 1
 kTarget chnget "target"
 aRef vcs_mixer_ramp kTarget, 0.25
 aFast vcs_probe_ramp kTarget, 0.25
 outs aRef,aFast
endin"""
        span = max(1, (rate + 50*k - 1)//(50*k))
        # Include a different first target, mid-ramp reversal, repeated writes,
        # changes around the end of a ramp, a long settled gap and exact zero.
        for initial in (.25, .7):
            moves = {0: initial, 3: 1.5, 4: .4, 5: .4, 5+span: .9,
                     6+2*span: .3, 11+4*span: .9, 14+5*span: 0.}
            blocks = max(moves) + 3*span + 4
            with engine(SimpleNamespace(orc=orc), score="i 1 0 60") as cs:
                for i in range(blocks):
                    if i in moves:
                        cs.setControlChannel("target", moves[i])
                    assert cs.performKsmps() == 0
                    a, b = np.asarray(cs.spout()).reshape(-1, 2).T
                    if a.tobytes() != b.tobytes():
                        raise ValueError(f"Coefficient mismatch at {rate=} {k=} {initial=} block {i}; max {max(abs(a-b))}")
                assert np.all(a == 0.)
            checked.append([rate, k, initial, blocks*k])
    return {"csound": native.libcsound.csoundGetVersion(), "waveforms": checked}


def cpu_seconds(worker_pids):
    """Aggregate coordinator and live worker CPU seconds, outside request timing."""
    total = time.process_time()
    if not worker_pids:
        return total
    if sys.platform == "linux":
        ticks = os.sysconf("SC_CLK_TCK")
        for pid in worker_pids:
            fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            total += (int(fields[11]) + int(fields[12])) / ticks
    else:
        times = subprocess.check_output(
            ["ps", "-p", ",".join(map(str, worker_pids)), "-o", "time="], text=True).split()
        assert len(times) == len(worker_pids)
        for value in times:
            total += sum(float(part) * 60**i for i, part in enumerate(reversed(value.split(":"))))
    return total


def dense_controls(initial):
    """Simultaneous gains, stereo balance, tap selection and insert bypasses."""
    low, high = {}, {}
    for name, value in initial.items():
        if not name.startswith(("__vcs_mixer_strip_", "__vcs_mixer_route_")):
            continue
        field = name.rsplit("_", 1)[1]
        if field in ("bypass", "post"):
            low[name], high[name] = 0., 1.
        elif field == "gain":
            low[name], high[name] = .8 * value, value
        elif field in ("pan", "left", "right"):
            low[name], high[name] = (.9, .65) if field == "right" else (.65, .9)
    assert any(name.endswith("_bypass") for name in low)
    return low, high


def run_arm(renderer, movement, variant, requests):
    import numpy as np
    from backend.app.engine.csound_worker import CsoundWorker
    from backend.app.engine.render_capacity import MIB, RenderAdmission, RenderCapacity
    from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
    from backend.app.engine.session_renderer_options import SessionRendererOptions
    from backend.app.models.render_protocol import RendererPolicy
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.opcode_service import OpcodeService
    from backend.tests.lake_render_support import lake_events, lake_inputs
    from backend.tests.render_plan_support import planner_inputs, synthetic_costs
    from backend.tools.benchmark_parallel_render import fingerprint

    parallel = renderer == "parallel"
    admission = RenderAdmission(lambda: RenderCapacity(4., True, 2048*MIB, 64*MIB, ("Four-CPU diagnostic budget",)))
    if parallel:
        options = SessionRendererOptions(
            policy=RendererPolicy(mode="parallel", coordination_frames=256, max_workers=4),
            allow_unqualified=True, admission=admission,
            costs=synthetic_costs if movement == "small" else None,
        )
        worker = ParallelCsoundRenderer(options=options)
    else:
        worker = CsoundWorker()
    if worker.backend != "ctcsound":
        raise RuntimeError("Native Csound required")
    targets, graph, mixer = planner_inputs("two", 32) if movement == "small" else lake_inputs(master_insert=True)
    compiler = CompilerService(OpcodeService("/icons"))
    started = time.perf_counter()
    definition = nullcontext() if variant == "fast" else patch.object(compiler_mixer, "SETTLED_RAMP_OPCODE", REFERENCE)
    with definition:
        canonical = compiler.compile_patch_bundle(targets, audio_graph=graph, mixer=mixer,
                                                  midi_input="internal:loopback", rtmidi_module="null")
        if parallel:
            worker.prepare(compiler, targets, graph, mixer, canonical)
    compile_seconds = time.perf_counter() - started
    initial = canonical.manifest["initialControls"]
    control = compiler_mixer.channel("strip", "$master", "gain")
    assert targets[0].patch.graph.engine_config.ksmps == 32
    if movement != "small":
        assert control in initial
    actual_definition = CANDIDATE if variant == "fast" else REFERENCE
    assert canonical.orc.count(actual_definition) == 1
    layout = None
    if parallel:
        assert worker._candidate is not None, worker.renderer_diagnostics
        compilation, plan = worker._candidate
        assert all(program.csd.count(actual_definition) == 1 for program in compilation.programs)
        layout = [list(p.stages) for p in plan.partitions]

    dense = dense_controls(initial) if movement == "dense" else None

    def before(index, sample):
        # Two writes eight blocks apart reverse the fader before 20 ms elapses.
        if dense is not None and sample % FRAMES == 0:
            worker.queue_mixer_controls(dense[(sample // FRAMES) % 2])
        offset = sample % 4096
        if movement == "moving" and offset in (1024, 1280):
            worker.queue_mixer_controls({control: .2 if offset == 1024 else 1.})

    warmup = 2048
    pcm, meters, wall = hashlib.sha256(), [], []
    peak = 0.
    notes = lake_events() if movement != "small" else [(0, [0x90 + n, 60 + n, 90]) for n in range(2)] + [
        (32000, [0x80 + n, 60 + n, 0]) for n in range(2)]
    cpu_samples = []
    pids = ()
    try:
        started = time.perf_counter()
        worker.start(canonical.csd, "internal:loopback", "null")
        worker.configure_mixer(canonical.manifest, initial)
        startup_ms = 1000 * (compile_seconds + time.perf_counter() - started)
        if parallel:
            pids = worker._coordinator.process_ids
            info = worker.renderer_diagnostics
            assert (info["selected"], info["worker_count"], info["coordination_frames"]) == ("parallel", len(layout), 256)
            assert len(pids) == len(layout) and (movement == "small" or len(pids) == 3)
        for start in range(0, warmup + requests * FRAMES, RATE):
            for sample, msg in notes:
                worker.enqueue_timestamped_midi(msg, source="lake-probe", target_engine_sample=start+sample)
        for i in range(warmup // FRAMES + requests):
            t0 = time.perf_counter_ns()
            result = worker.render_blocks(block_count=FRAMES // 32, target_sample_rate=RATE, before_block=before)
            duration = (time.perf_counter_ns() - t0)/1e6
            if i >= warmup // FRAMES:
                wall.append(duration)
            assert (result.engine_sample_start, result.engine_sample_end) == (FRAMES * i, FRAMES * (i + 1))
            assert len(result.pcm_f32le) == FRAMES * 2 * 4 and result.target_frame_count == FRAMES
            pcm.update(result.pcm_f32le)
            values = np.frombuffer(result.pcm_f32le, dtype="<f4")
            assert np.isfinite(values).all()
            peak = max(peak, float(np.max(abs(values))))
            meters.extend(worker.drain_mixer_meters())
            count = i + 1 - warmup // FRAMES
            if count >= 0 and (count % 64 == 0 or count == requests):
                cpu_samples.append((cpu_seconds(pids), time.monotonic()))
    finally:
        worker.stop()
    assert peak > .00001 and meters
    if parallel:
        assert not admission.leases and not worker._coordinator.process_ids and worker._coordinator.shared_memory_name is None
    cpu_windows = [(cpu1 - cpu0) / (time1 - time0)
                   for (cpu0, time0), (cpu1, time1) in zip(cpu_samples, cpu_samples[1:])]
    cpu_per_audio_second = (cpu_samples[-1][0] - cpu_samples[0][0]) / (requests * FRAMES / RATE)
    ramp_inputs = [line.split('"')[1] for line in canonical.orc.splitlines() if ' chnget "__vcs_mixer_' in line]
    changed = sum(dense[0].get(name) != dense[1].get(name) for name in ramp_inputs) if dense else 0
    return {"pcm": pcm.hexdigest(), "meters": fingerprint(meters), "layout": layout,
            "ramp_calls": sum(" vcs_mixer_ramp " in line for line in canonical.orc.splitlines()),
            "dense_channels": len(dense[0]) if dense else 0, "active_calls": changed, "peak": peak,
            "startup_ms": startup_ms, "peak_cpu_cores": max(cpu_windows),
            "cpu_per_audio_second": cpu_per_audio_second, "wall_ms": wall}


def benchmark(args):
    import itertools
    import platform
    from backend.tools.benchmark_parallel_render import distribution
    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.experiments.rust_worker.build import default_library

    args.output.mkdir(parents=True, exist_ok=True)
    report = {"platform": platform.platform(), "python": sys.version, "requests": args.requests,
              "csound": load_ctcsound_module().libcsound.csoundGetVersion(),
              "format": {"rate": RATE, "ksmps": 32, "request_frames": FRAMES, "batch_frames": 256,
                         "warmup_frames": 2048, "cpu_window_requests": 64},
              "fixtures": {name: hashlib.sha256((ROOT / "backend/tests/fixtures/parallel_render" / name).read_bytes()).hexdigest()
                           for name in ("evening_at_the_lake.json", "evening_at_the_lake_master_insert.json",
                                        "workloads.json", "planner_cases.json")},
              "worker_sha256": hashlib.sha256(default_library().read_bytes()).hexdigest(),
              "probe_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "compiler_sha256": hashlib.sha256(Path(compiler_mixer.__file__).read_bytes()).hexdigest(),
              "candidate_sha256": hashlib.sha256(CANDIDATE.encode()).hexdigest(),
              "reference_sha256": hashlib.sha256(REFERENCE.encode()).hexdigest(), "cases": {}}
    for renderer in args.renderers:
        for movement in args.cases:
            case = f"{renderer}-{movement}"
            runs = {v: [] for v in ("a", "b", "fast")}
            trace = None
            for i, order in enumerate(itertools.permutations(runs)):
                for arm in order:
                    dest = args.output / f"{case}-{i+1}-{arm}.json"
                    cmd = [sys.executable, "-m", MODULE, "--child", renderer, movement, arm, "--output", str(dest),
                           "--requests", str(args.requests)]
                    completed = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                    if completed.returncode:
                        raise RuntimeError(f"{case}/{arm}: {completed.stderr[-3000:]}")
                    data = json.loads(dest.read_text())
                    actual = [data[k] for k in ("pcm", "meters", "layout", "ramp_calls", "dense_channels", "active_calls")]
                    if trace is not None and trace != actual:
                        raise ValueError(f"Parity or layout mismatch in {case}, round {i+1}, arm {arm}")
                    trace = actual
                    runs[arm].append(data)
                print(f"{case}: {i+1}/6", flush=True)
            def summarize(trials):
                wall = [ms for trial in trials for ms in trial["wall_ms"]]
                return {**distribution(wall), "deadline_misses": sum(ms > 1000 * FRAMES / RATE for ms in wall),
                        "requests": len(wall), "startup_median_ms": statistics.median(t["startup_ms"] for t in trials),
                        "peak_cpu_cores": max(t["peak_cpu_cores"] for t in trials),
                        "cpu_per_audio_second": statistics.median(t["cpu_per_audio_second"] for t in trials)}

            arms = {arm: summarize(trials) for arm, trials in runs.items()}
            baseline, fast = summarize(runs["a"] + runs["b"]), arms["fast"]
            pairs = []
            for trials in zip(runs["a"], runs["b"], runs["fast"], strict=True):
                a, b, candidate = (distribution(trial["wall_ms"]) for trial in trials)
                pairs.append({k: 1 - candidate[k] / statistics.mean((a[k], b[k])) for k in ("median", "p95", "p99")})
            drift = abs(1 - arms["a"]["median"] / arms["b"]["median"])
            if drift > .05:
                assessment = "repeat: baseline median drift exceeds 5%"
            elif movement in ("settled", "moving"):
                gain_pass = all(fast[k] <= .90 * baseline[k] for k in ("median", "p95"))
                enough_rounds = sum(pair["median"] >= .10 for pair in pairs) >= 5
                assessment = "pass" if gain_pass and enough_rounds else "below adoption threshold"
            else:
                slower = [k for k in ("p95", "p99") if fast[k] > 1.05 * baseline[k]]
                assessment = f"review/repeat: {', '.join(slower)} above baseline by >5%" if slower else "pass"
            report["cases"][case] = {"baseline_ms": baseline, "fast_ms": fast, "round_gains": pairs,
                                     "assessment": assessment, "aa_drift": drift,
                                     "reference_arms": [arms["a"], arms["b"]],
                                     "pcm": trace[0], "meters": trace[1], "layout": trace[2],
                                     "ramp_calls": trace[3], "dense_channels": trace[4], "active_calls": trace[5]}
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            print(case, baseline, fast, flush=True)
        for gesture in ("moving", "dense"):
            if gesture in args.cases and "settled" in args.cases:
                assert report["cases"][f"{renderer}-{gesture}"]["pcm"] != report["cases"][f"{renderer}-settled"]["pcm"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("output/mixer-ramps/qualification/macos"))
    parser.add_argument("--requests", type=int, default=192)
    parser.add_argument("--cases", choices=CASES, nargs="+", default=CASES)
    parser.add_argument("--renderers", choices=RENDERERS, nargs="+", default=RENDERERS)
    parser.add_argument("--child", nargs=3, metavar=("RENDERER", "MOVEMENT", "ARM"))
    parser.add_argument("--waveform", action="store_true")
    args = parser.parse_args()
    if args.requests < 1:
        parser.error("--requests must be positive")
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
    os.environ["VISUALCSOUND_PARALLEL_WORKER"] = "rust"
    if args.waveform:
        print(json.dumps(waveform()))
    elif args.child:
        args.output.write_text(json.dumps(run_arm(*args.child, args.requests)))
    else:
        benchmark(args)


if __name__ == "__main__":
    main()
