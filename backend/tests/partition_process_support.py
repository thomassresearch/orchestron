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


if __name__ == "__main__":
    import sys
    parent_exit_probe(sys.argv[1])
