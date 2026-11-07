"""Bounded native process correctness probe, never a performance benchmark.

Run with python -m backend.tools.probe_partition_process --case shared --ksmps 32.
Uses only versioned fixtures; emits machine-readable evidence after cleanup.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.engine.midi_scheduler import EngineMidiScheduler
from backend.app.engine.parallel_csound_renderer import BlockInputs, PartitionRenderCoordinator
from backend.app.models.render_protocol import MidiDelivery
from backend.tests.render_plan_support import FIXTURE_DIR, prepared_partition
from backend.tools._sequential_partition_probe import compare_sequential


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("two", "four", "eight", "shared", "bypass", "sidechain", "custom_ports", "legato"), default="shared")
    parser.add_argument("--ksmps", type=int, choices=(1, 32), default=32)
    parser.add_argument("--frames", type=int, default=8192)
    args = parser.parse_args()
    if not 0 < args.frames <= 192000 or args.frames % args.ksmps:
        parser.error("frames must be a bounded whole number of engine blocks")
    native = load_ctcsound_module()  # Missing native support is an error, never a mock pass.
    targets, plan, compilation = prepared_partition(args.case, args.ksmps)
    fixture = (FIXTURE_DIR / "partition_parity.json").read_bytes()
    events = sorted([(s, (status + t.midi_channel - 1, a, b))
                     for s, status, a, b in json.loads(fixture)["source_events"]
                     for t in targets if t.midi_channel], key=lambda event: event[0])
    reference = compare_sequential(compilation, plan, frames=args.frames, events=events, module=native)
    scheduler = EngineMidiScheduler()
    for sample, event in events:
        scheduler.enqueue(event, source="fixture", target_engine_sample=sample)

    def prepare(_index, sample):
        return BlockInputs(midi=tuple(MidiDelivery(sequence=e.sequence, source=e.source,
            target_engine_sample=e.target_engine_sample, message=tuple(e.message), late=e.late)
            for e in scheduler.drain_block(block_start_sample=sample, block_end_sample=sample + args.ksmps)))

    renderer = PartitionRenderCoordinator()
    try:
        renderer.start(compilation, plan)
        processes = len(renderer.process_ids)
        result = renderer.render_blocks(block_count=args.frames // args.ksmps, target_sample_rate=plan.graph.engine.sample_rate,
                                        prepare_block=prepare)
        pcm = np.frombuffer(result.pcm_f32le, dtype="<f4").reshape(-1, 2)
        np.testing.assert_array_equal(pcm, reference.canonical.reshape(-1, 2).astype(np.float32))
        np.testing.assert_array_equal(reference.partitioned, reference.canonical)
        meter_names = [m for s in plan.graph.stages for m in s.meters]
        np.testing.assert_array_equal([renderer.last_meters[m] for m in meter_names], reference.canonical_meters[-1])
        if np.max(np.abs(pcm)) <= .0001:
            raise RuntimeError("Probe has no audible native signal")
        assert renderer.committed_sample == renderer.published_sample == args.frames
    finally:
        renderer.stop()
    print(json.dumps({"case": args.case, "ksmps": args.ksmps, "frames": args.frames,
        "platform": platform.platform(), "python": platform.python_version(), "architecture": platform.machine(),
        "binding": reference.binding, "sample_bytes": reference.sample_bytes, "processes": processes,
        "plan_hash": plan.plan_hash, "artifact_hash": compilation.artifact_hash,
        "fixture_sha256": hashlib.sha256(fixture).hexdigest(), "pcm_sha256": hashlib.sha256(result.pcm_f32le).hexdigest(),
        "exact_audio": True, "exact_last_meters": True, "cleaned": not renderer.process_ids and renderer.shared_memory_name is None,
        "performance_qualified": False}, indent=2))


if __name__ == "__main__":
    main()
