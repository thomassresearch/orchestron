"""Real-Csound K=1 render-loop timings and deterministic behavior fingerprints.

Run with the same interpreter and --source-root for each checkout. Compilation,
warmup, hashing and event tracing are outside timed render calls. No mock fallback.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
CSD_PATH = ROOT / "backend/tests/fixtures/csound/render_loop.csd"


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def run_case(scenario, frames, *, trace=False):
    import numpy as np
    from backend.app.engine.csound_worker import CsoundWorker
    from backend.app.models.session import SessionSequencerConfigRequest
    from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime

    worker = CsoundWorker()
    if worker.backend != "ctcsound":
        raise RuntimeError("Real Csound is required; refusing to benchmark a mock.")
    worker.start(CSD_PATH.read_text(), "internal:loopback", "null")
    assert worker.runtime_ksmps == 1 and worker.runtime_sample_rate == 48000
    worker.configure_mixer({"meters": {"voice": {"peak": "peak"}}}, {"gain": 1.0})
    midi = []
    if trace:
        drain = worker._midi_scheduler.drain_block

        def observed_drain(**kwargs):
            events = drain(**kwargs)
            midi.extend((kwargs["block_start_sample"], e.target_engine_sample, e.sequence,
                         e.source, list(e.message), e.late) for e in events)
            return events

        worker._midi_scheduler.drain_block = observed_drain

    router = PerformanceMidiRouter(enqueue_timestamped_midi=worker.enqueue_timestamped_midi,
                                  current_engine_sample=lambda: worker.render_sample_cursor)
    sequencer = SessionSequencerRuntime(
        session_id="render-loop-benchmark", midi_service=router,
        midi_input_selector="internal:loopback", controller_default_channels=(1,),
        publish_event=lambda *_: None, clock_mode="render_driven",
    )
    request = SessionSequencerConfigRequest.model_validate({
        "timing": {"tempo_bpm": 240, "steps_per_beat": 4},
        "step_count": 16, "playback_end_step": 10000,
        "tracks": [{"track_id": f"voice-{i}", "midi_channel": 1, "length_beats": 1,
                    "pads": [{"pad_index": 0, "length_beats": 1,
                              "steps": [48 + i, 60 + i, None, 55 + i]}]} for i in range(8)],
    })
    sequencer.configure(request)
    if scenario == "sequenced":
        sequencer.start(0)
    elif scenario == "sustained":
        for note in range(48, 72):
            worker.enqueue_timestamped_midi([0x90, note, 80], source="manual", target_engine_sample=0)

    def before_block(_, sample):
        tempo = sequencer.advance_render_block(sample_rate=48000, ksmps=1, block_start_sample=sample)
        router.advance_render_block(block_start_sample=sample, block_end_sample=sample + 1,
                                    sample_rate=48000, tempo_bpm=tempo)

    chunks, cpu, pcm, markers, meters, edits = [], [], hashlib.sha256(), [], [], []
    peak = 0.0
    try:
        # Same warmup and initial DSP state in every run, outside measurement.
        worker.render_blocks(block_count=2048, target_sample_rate=48000, before_block=before_block)
        if trace:
            midi.clear()
        worker.drain_mixer_meters()
        sequencer.drain_render_transport_events(engine_sample_start=0, engine_sample_end=2048)
        for offset in range(0, frames, 512):
            if scenario == "sequenced" and offset == 4096:
                updated = request.model_copy(deep=True)
                updated.timing.tempo_bpm = 137
                updated.tracks[0].pads[0].steps[0] = 77
                from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
                prepared = compile_sequencer_runtime_config(updated, controller_default_channels=(1,))
                worker.run_at_render_boundary(lambda: sequencer.apply_prepared(prepared))
                edits.append(worker.render_sample_cursor)
            if offset == 8192:
                worker.queue_control_channels({"gain": 0.5})
                worker.enqueue_timestamped_midi([0xB0, 74, 99], source="manual",
                                                target_engine_sample=worker.render_sample_cursor + 17)
            started, used = time.perf_counter_ns(), time.process_time_ns()
            result = worker.render_blocks(block_count=min(512, frames - offset), target_sample_rate=48000,
                                          before_block=before_block)
            cpu.append((time.process_time_ns() - used) / 1e6)
            chunks.append((time.perf_counter_ns() - started) / 1e6)
            pcm.update(result.pcm_f32le)
            peak = max(peak, float(np.max(np.abs(np.frombuffer(result.pcm_f32le, dtype=np.float32)))))
            markers.extend(asdict(e) for e in sequencer.drain_render_transport_events(
                engine_sample_start=result.engine_sample_start, engine_sample_end=result.engine_sample_end))
            meters.extend(worker.drain_mixer_meters())
        if scenario != "idle":
            assert peak > 0.00001, "The native render must contain actual audio."
        return {
            "chunks_ms": chunks, "cpu_ms": cpu,
            "fingerprints": {"pcm": pcm.hexdigest(), "midi": fingerprint(midi),
                             "markers": fingerprint(markers), "meters": fingerprint(meters),
                             "status": fingerprint(sequencer.status().model_dump(mode="json")),
                             "edit_samples": edits, "sample_end": worker.render_sample_cursor},
            "midi_event_count": len(midi), "peak": peak,
            "binding": type(worker._csound).__name__,
        }
    finally:
        worker.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--frames", type=int, default=24576)
    parser.add_argument("--compare", type=Path, help="Require identical fingerprints to this baseline report")
    args = parser.parse_args()
    if args.rounds < 1 or args.frames < 12288 or args.frames % 512:
        parser.error("rounds must be positive; frames must be a multiple of 512 and at least 12288")
    sys.path.insert(0, str(args.source_root.resolve()))
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
    os.environ["VISUALCSOUND_AUDIO_OUTPUT_MODE"] = "browser_clock"
    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.app.services.sequencer_playback import implementation
    report = {"source": str(args.source_root.resolve()), "python": sys.version,
              "platform": platform.platform(), "csound_version": load_ctcsound_module().libcsound.csoundGetVersion(),
              "sequencer": implementation, "ksmps": 1, "frames": args.frames, "rounds": args.rounds,
              "scenarios": {}}
    report["source_hashes"] = {
        name: hashlib.sha256((args.source_root / "backend/app/engine" / name).read_bytes()).hexdigest()
        for name in ("csound_worker.py", "midi_scheduler.py", "browser_audio_pcm.py")
    }
    report["fixture_hash"] = hashlib.sha256(CSD_PATH.read_bytes()).hexdigest()
    for scenario in ("idle", "sustained", "sequenced"):
        traced = run_case(scenario, args.frames, trace=True)
        runs = [run_case(scenario, args.frames) for _ in range(args.rounds)]
        for run in runs:
            for key in ("pcm", "markers", "meters", "status", "edit_samples", "sample_end"):
                assert run["fingerprints"][key] == traced["fingerprints"][key], (scenario, key)
        chunks = sorted(t for run in runs for t in run["chunks_ms"])
        totals = [sum(run["chunks_ms"]) for run in runs]
        result = {"fingerprints": traced["fingerprints"], "midi_event_count": traced["midi_event_count"],
                  "peak": traced["peak"], "binding": traced["binding"], "runs": runs,
                  "median_total_ms": statistics.median(totals),
                  "median_cpu_ms": statistics.median(sum(run["cpu_ms"]) for run in runs),
                  "chunk_p99_ms": chunks[min(len(chunks) - 1, int(len(chunks) * .99))]}
        report["scenarios"][scenario] = result
        print(scenario, {k: result[k] for k in ("median_total_ms", "median_cpu_ms", "chunk_p99_ms")}, flush=True)
    if args.compare:
        baseline = json.loads(args.compare.read_text())
        for key in ("python", "platform", "csound_version", "sequencer", "ksmps", "frames", "fixture_hash"):
            assert report[key] == baseline[key], f"Incompatible benchmark setting: {key}"
        report["comparison"] = {}
        for scenario, result in report["scenarios"].items():
            before = baseline["scenarios"][scenario]
            assert result["fingerprints"] == before["fingerprints"], f"Behavior changed: {scenario}"
            reduction = 100 * (1 - result["median_total_ms"] / before["median_total_ms"])
            report["comparison"][scenario] = {"fingerprints_identical": True, "render_time_reduction_percent": reduction}
            print(f"{scenario}: identical PCM/MIDI/live-edit fingerprints; {reduction:.1f}% less render time", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
