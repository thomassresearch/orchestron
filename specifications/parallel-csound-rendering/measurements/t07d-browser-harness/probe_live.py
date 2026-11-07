"""Bounded native live-voice control; instrumented runs are never qualification."""

import argparse
import cProfile
from functools import partial
import json
from pathlib import Path
import tempfile
import time

from backend.app.engine.parallel_csound_renderer import PartitionRenderCoordinator
from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
from backend.app.engine.session_renderer_options import SessionRendererOptions
from backend.app.models.render_protocol import RendererPolicy
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tools._parallel_render_workload import Workload, build_workload_inputs
from backend.tools.profile_partition_render import profiled_child, summary
from backend.tests.render_plan_support import synthetic_costs
from backend.tools.benchmark_parallel_render import distribution


class HybridSemaphore:
    def __init__(self, semaphore, spin_ns):
        self.semaphore = semaphore
        self.spin_ns = spin_ns

    def release(self):
        return self.semaphore.release()

    def acquire(self, block=True, timeout=None):
        if not block or self.semaphore.acquire(False):
            return not block and self.semaphore.acquire(False) or block
        start = time.monotonic_ns()
        end = start + self.spin_ns
        if timeout is not None:
            end = min(end, start + int(max(0, timeout) * 1e9))
        while time.monotonic_ns() < end:
            for _ in range(8):
                if self.semaphore.acquire(False):
                    return True
        return self.semaphore.acquire(
            True, None if timeout is None else max(0, timeout - (time.monotonic_ns() - start) / 1e9)
        )


class HybridContext:
    def __init__(self, context, spin_ns):
        self.context = context
        self.spin_ns = spin_ns

    def Semaphore(self, *args):
        return HybridSemaphore(self.context.Semaphore(*args), self.spin_ns)

    def Process(self, *args, **kwargs):
        return self.context.Process(*args, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--spin-micros", type=int, default=0)
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--reverse", action="store_true")
    parser.add_argument("--requests", type=int, default=100)
    args = parser.parse_args()
    spec = {"id": "realtime_4", "sources": 4, "voices": 4, "filter_count": 6, "topology": "private"}
    targets, graph, mixer, request = build_workload_inputs(Workload.model_validate(spec), 32)
    for target in targets:
        for node in target.patch.graph.nodes:
            if node.opcode == "moogladder":
                node.params["kres"] = 0
    compiler = CompilerService(OpcodeService("/static/icons"))
    canonical = compiler.compile_patch_bundle(
        targets, audio_graph=graph, mixer=mixer, midi_input="internal:loopback", rtmidi_module="null"
    )
    options = SessionRendererOptions(
        policy=RendererPolicy(mode="parallel", max_workers=4), costs=synthetic_costs, allow_unqualified=True
    )
    with tempfile.TemporaryDirectory() as directory:
        coordinator = PartitionRenderCoordinator(
            policy=options.policy,
            _worker_target=partial(profiled_child, directory=directory)
            if args.profile
            else __import__("backend.app.engine.csound_process", fromlist=["run_csound_process"]).run_csound_process,
        )
        if args.spin_micros:
            coordinator._context = HybridContext(coordinator._context, args.spin_micros * 1000)
        if args.reverse:
            collect = coordinator._collect
            coordinator._collect = lambda expected, deadline: collect(dict(reversed(tuple(expected.items()))), deadline)
        worker = ParallelCsoundRenderer(options=options, coordinator_factory=lambda **_: coordinator)
        worker.prepare(compiler, targets, graph, mixer, canonical)
        wall = []
        cpu = []
        profile = cProfile.Profile()
        try:
            worker.start(canonical.csd, "internal:loopback", "null")
            worker.configure_mixer(canonical.manifest, canonical.manifest["initialControls"])
            for channel in range(4):
                for voice in range(4):
                    worker.enqueue_timestamped_midi([0x90 + channel, 48 + voice, 100], source="live-probe")
            worker.render_blocks(block_count=96, target_sample_rate=48000)
            if args.profile:
                profile.enable()
            for i in range(args.requests):
                started = time.perf_counter_ns()
                used = time.process_time_ns()
                _result = worker.render_blocks(block_count=96, target_sample_rate=48000)
                wall.append((time.perf_counter_ns() - started) / 1e6)
                cpu.append((time.process_time_ns() - used) / 1e6)
                worker.drain_mixer_meters()
            if args.profile:
                profile.disable()
                profile.dump_stats(str(Path(directory) / "parent.prof"))
            diagnostics = worker.renderer_diagnostics
        finally:
            worker.stop()
        report = {
            "scope": __doc__,
            "specification": spec,
            "spin_micros": args.spin_micros,
            "reverse": args.reverse,
            "instrumented": args.profile,
            "request_frames": 3072,
            "audio_ms": 64,
            "requests": args.requests,
            "wall_ms": wall,
            "parent_cpu_ms": cpu,
            "wall_summary": distribution(wall),
            "parent_summary": distribution(cpu),
            "diagnostics": diagnostics,
            "profiles": {p.stem: summary(p) for p in Path(directory).glob("*.prof")},
            "cleaned": not coordinator.process_ids,
        }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"wall": report["wall_summary"], "parent": report["parent_summary"]}))


if __name__ == "__main__":
    main()
