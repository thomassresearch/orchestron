"""Spawn-importable deterministic native stand-in and fault injection, tests only."""
from __future__ import annotations

import functools
import os
import threading

import numpy as np

from backend.app.engine.csound_process import _exit_with_parent, _serve
from backend.app.engine.render_ipc import SharedArena
from backend.app.models.render_protocol import Done, Ready


class FakeNative:
    def __init__(self, program, engine, width, *, mode, entered, release, barrier):
        self.cs = self
        self.program = program
        self.frames = engine.ksmps
        self.dtype = np.float64 if width == 8 else np.float32
        self.sequence = -1
        self.inputs = {}
        self.controls = {}
        self.mode, self.entered, self.release, self.barrier = mode, entered, release, barrier
        self.value = 0.0
        if mode == "compile_error":
            raise RuntimeError("injected compile failure")
        if mode == "hang_compile":
            entered.set()
            release.wait()

    def perform(self, midi, controls):
        self.sequence += 1
        if self.mode == "barrier" and not self.program.owns_output:
            self.barrier.wait(timeout=10)
        if self.mode == "hang":
            self.entered.set()
            self.release.wait()
        if self.mode == "crash":
            os._exit(17)
        if self.mode == "second_block_error" and self.sequence == 1:
            raise RuntimeError("injected render failure")
        if self.mode == "hold_once" and self.sequence == 0:
            self.entered.set()
            if not self.release.wait(10):
                raise RuntimeError("test release timed out")
        self.controls.update(controls)
        # Each upstream writes the same deterministic block/MIDI fingerprint.
        # Suffix output also depends on every input's CURRENT buffer contents.
        self.value = float(self.sequence + 1 + sum(sum(m) for m in midi) + sum(self.controls.values()))
        if self.program.owns_output:
            self.value += sum(float(values[0]) for values in self.inputs.values())
        if self.mode == "nonfinite":
            self.value = float("nan")
        if self.mode == "float32_overflow":
            self.value = 1e100

    def setAudioChannel(self, channel, values):
        self.inputs[channel] = values.copy()

    def audioChannel(self, channel, values):
        values[:] = self.value

    def spout(self):
        return np.full((self.frames, 2), self.value, dtype=self.dtype)

    def controlChannel(self, channel):
        return self.value, 0

    def close(self):
        if self.mode == "hang_close":
            self.entered.set()
            self.release.wait()


def controlled_process(*args, mode="normal", entered=None, release=None, barrier=None):
    threading.Thread(target=_exit_with_parent, daemon=True).start()
    _serve(*args, native_factory=functools.partial(FakeNative, mode=mode, entered=entered, release=release, barrier=barrier))


def corrupt_process(*args, corruption):
    from backend.app.engine import csound_process
    from backend.app.engine.render_ipc import MESSAGE

    class CorruptArena(SharedArena):
        def send(self, region, data):
            message = MESSAGE.validate_json(data)
            if isinstance(message, Ready) and corruption == "ready":
                message = message.model_copy(update={"artifact_hash": "0" * 64})
            if isinstance(message, Done):
                fields = {
                    "sequence": {"sequence": message.sequence + 1},
                    "sample": {"sample_start": message.sample_start + 1},
                    "epoch": {"epoch": message.epoch + 1},
                    "revision": {"control_revision": message.control_revision + 1},
                    "slots": {"slots": ()},
                }
                message = message.model_copy(update=fields.get(corruption, {}))
            super().send(region, self.encode(message, region))
            if isinstance(message, Done) and corruption == "duplicate":
                args[-1].release()

    csound_process.SharedArena = CorruptArena
    controlled_process(*args)


def parent_exit_probe(report):
    """Standalone parent gives the resource tracker its own lifetime in this test."""
    from concurrent.futures import ThreadPoolExecutor
    import json
    import multiprocessing
    from pathlib import Path

    from backend.app.engine.parallel_csound_renderer import PartitionRenderCoordinator
    from backend.tests.render_plan_support import prepared_partition

    context = multiprocessing.get_context("spawn")
    entered, release = context.Event(), context.Event()
    renderer = PartitionRenderCoordinator(_worker_target=functools.partial(
        controlled_process, mode="hang", entered=entered, release=release))
    _, plan, compilation = prepared_partition()
    renderer.start(compilation, plan)
    executor = ThreadPoolExecutor()
    executor.submit(renderer.render_blocks, block_count=1, target_sample_rate=48000)
    if not entered.wait(10):
        raise RuntimeError("Parent-exit probe did not reach native wait")
    path = Path(report)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"pids": renderer.process_ids, "name": renderer.shared_memory_name}))
    temporary.replace(path)
    # The test kills this standalone parent. A long local wait, not a renderer
    # timeout, keeps its lifetime under explicit test control.
    release.wait(60)


def subnormal_pcm_probe(mode, connection, rate=48000, amplitude=1e-39):
    """Fresh executables avoid inheriting a reference Csound thread's FP mode."""
    import os
    from backend.app.engine.csound_worker import CsoundWorker
    from backend.app.engine.render_ipc import FINAL_BUS
    from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.opcode_service import OpcodeService
    from backend.tests.render_plan_support import planner_inputs
    from backend.tests.session_parallel_support import options

    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
    targets, graph, mixer = planner_inputs("two", 32)
    for target in targets:
        for node in target.patch.graph.nodes:
            if node.opcode == "ampmidi":
                node.params["iscal"] = amplitude
    compiler = CompilerService(OpcodeService("/static/icons"))
    artifact = compiler.compile_patch_bundle(targets, audio_graph=graph, mixer=mixer,
                                              midi_input="internal:loopback", rtmidi_module="null")
    worker = CsoundWorker() if mode == "single" else ParallelCsoundRenderer(options=options("parallel"))
    try:
        if mode == "parallel":
            worker.prepare(compiler, targets, graph, mixer, artifact)
        worker.start(artifact.csd, "internal:loopback", "null")
        worker.configure_mixer(artifact.manifest, artifact.manifest["initialControls"])
        for target in targets:
            if target.midi_channel:
                worker.enqueue_timestamped_midi([0x90 + target.midi_channel - 1, 60, 100], source="subnormal")
        result = worker.render_blocks(block_count=8, target_sample_rate=rate)
        if mode == "single":
            native = worker._csound.spout()
        else:
            renderer = worker._coordinator
            native = renderer._arena.audio(renderer._layout.audio[FINAL_BUS], (renderer._sequence - 1) % 2)
        peak = float(np.max(np.abs(native)))
        connection.send((result.pcm_f32le, peak))
    finally:
        worker.stop()
        connection.close()


if __name__ == "__main__":
    import sys
    parent_exit_probe(sys.argv[1])
