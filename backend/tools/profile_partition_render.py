"""Separate instrumented parent/child profile; never used for timing qualification.

Profiles a bounded native K=32 run. Child profiles include startup/idle waits;
performKsmps/perform, channel copies and mailbox calls expose steady DSP/IPC work.
The parent profile covers rendering only. Use the paired benchmark for service
latencies, and actual browser diagnostics for underruns.
"""
from __future__ import annotations

import argparse
import cProfile
from functools import partial
import json
import os
from pathlib import Path
import pstats
import tempfile


def profiled_child(*args, directory):
    from backend.app.engine.csound_process import run_csound_process
    profile = cProfile.Profile()
    try:
        profile.runcall(run_csound_process, *args)
    finally:
        profile.dump_stats(str(Path(directory) / f"child-{os.getpid()}.prof"))


def summary(path):
    profile = pstats.Stats(str(path))
    rows = [{"file": file, "line": line, "function": name, "calls": nc,
             "own_seconds": own, "cumulative_seconds": cumulative}
            for (file, line, name), (_, nc, own, cumulative, _) in profile.stats.items()]
    return {"total_seconds": profile.total_tt, "functions": sorted(rows, key=lambda row: -row["own_seconds"])}


def main():
    from backend.app.engine.parallel_csound_renderer import BlockInputs, PartitionRenderCoordinator
    from backend.app.models.render_protocol import MidiDelivery
    from backend.tests.render_plan_support import prepared_partition

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    targets, plan, compilation = prepared_partition("two", 32)
    def prepare(_index, sample):
        return BlockInputs(midi=tuple(MidiDelivery(sequence=i + 1, source="profile", target_engine_sample=0,
            message=(0x90 + target.midi_channel - 1, 60, 100), late=False)
            for i, target in enumerate(t for t in targets if t.midi_channel)) if sample == 0 else ())
    with tempfile.TemporaryDirectory(prefix="partition-profile-") as directory:
        coordinator = PartitionRenderCoordinator(_worker_target=partial(profiled_child, directory=directory))
        try:
            coordinator.start(compilation, plan)
            parent = cProfile.Profile()
            result = parent.runcall(coordinator.render_blocks, block_count=1024, target_sample_rate=48000, prepare_block=prepare)
            parent.dump_stats(str(Path(directory) / "parent.prof"))
        finally:
            coordinator.stop()
        report = {"scope": __doc__, "frames": result.engine_sample_end, "ksmps": 32,
            "plan_hash": plan.plan_hash, "artifact_hash": compilation.artifact_hash, "qualified": False,
            "cleaned": not coordinator.process_ids and coordinator.shared_memory_name is None,
            "profiles": {path.stem: summary(path) for path in sorted(Path(directory).glob("*.prof"))}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
