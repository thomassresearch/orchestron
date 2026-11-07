"""Import-safe spawn target. Each child exclusively owns one native Csound instance."""
from __future__ import annotations

import hashlib
import json
import multiprocessing
from multiprocessing.connection import wait
import os
import threading
from types import SimpleNamespace

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.engine.partition_native import NativeCsoundPartition
from backend.app.engine.render_ipc import (
    FINAL_BUS, FINAL_PCM_BUS, FINAL_F32_MODE_BUS, Region, SharedArena, decode_audio, expected_done, validate_envelope, validate_render,
)
from backend.app.models.render_protocol import EngineFormat, Error, Init, Ready, Stop, Stopped


def _exit_with_parent():
    # A native call can hang indefinitely. Do not rely on the render loop polling
    # getppid(): the sentinel also detects death while compiling or performing.
    parent = multiprocessing.parent_process()
    if parent is not None:
        wait([parent.sentinel])
        os._exit(1)


def run_csound_process(name, size, bootstrap, digest, command_ready, reply_ready):
    """Small spawn arguments; CSD/metadata live in the pre-provisioned arena.

    No queue feeder threads, callbacks, schedulers or Python service objects cross
    the control channel. Darwin uses a bounded nonblocking wakeup datagram in
    addition to the semaphore publication fence. The only thread watches parent
    liveness.
    """
    threading.Thread(target=_exit_with_parent, daemon=True, name="csound-parent-watch").start()
    # Native Csound can write directly to file descriptors, bypassing Python's
    # streams. Report bounded errors through the mailbox, never through a pipe
    # whose reader could stop draining during realtime work.
    with open(os.devnull, "wb") as quiet:
        os.dup2(quiet.fileno(), 1)
        os.dup2(quiet.fileno(), 2)
    _serve(name, size, bootstrap, digest, command_ready, reply_ready)


def _serve(name, size, bootstrap, digest, command_ready, reply_ready, *, native_factory=None):
    """The injected native factory is only for spawn-based fault/barrier tests."""
    arena = SharedArena(size=size, name=name)
    instance = None
    identity = reply = None
    sequence, sample, revision = 0, 0, 0
    phase = "protocol"
    flush_float32 = None
    try:
        raw = arena.read(bootstrap)
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("Partition bootstrap digest mismatch.")
        config = json.loads(raw)
        program = SimpleNamespace(**config["program"])
        engine = SimpleNamespace(**config["engine"])
        identity = dict(protocol_version=1, epoch=config["epoch"], partition_id=program.id,
                        plan_hash=config["plan_hash"])
        command, reply = Region(**config["command"]), Region(**config["reply"])
        audio = {bus: decode_audio(value) for bus, value in config["audio"].items()}
        meters = decode_audio(config["meters"])
        # Pre-create all native-width views; none points into a Csound instance.
        for region in (*audio.values(), meters):
            for slot in (0, 1):
                arena.audio(region, slot)
        native_format = EngineFormat(sample_rate=engine.sample_rate, ksmps=engine.ksmps,
            zero_dbfs=engine.zero_dbfs, native_sample_type="float64" if config["sample_bytes"] == 8 else "float32")
        command_ready.acquire()
        message = arena.receive(command)
        validate_envelope(message, identity)
        if (not isinstance(message, Init) or message.artifact_hash != config["artifact_hash"]
                or message.engine != native_format):
            raise ValueError("Partition INIT does not match provisioned artifact/engine.")
        phase = "compile"
        if native_factory is None:
            instance = NativeCsoundPartition(load_ctcsound_module(), program.csd, engine, config["sample_bytes"])
        else:
            instance = native_factory(program, engine, config["sample_bytes"])
        ready = Ready(**identity, artifact_hash=config["artifact_hash"], engine=native_format)
        arena.send(reply, arena.encode(ready, reply))
        reply_ready.release()
        while True:
            command_ready.acquire()
            phase = "protocol"
            message = arena.receive(command)
            validate_envelope(message, identity)
            if isinstance(message, Stop):
                phase = "shutdown"
                instance.close()
                instance = None
                arena.send(reply, arena.encode(Stopped(**identity), reply))
                reply_ready.release()
                break
            validate_render(message, identity, sequence=sequence, sample=sample, frames=engine.ksmps,
                            revision=revision, buses=tuple(audio), controls=program.controls)
            phase = "render"
            slot = sequence % 2
            for bus, channel in program.inputs:
                instance.cs.setAudioChannel(channel, arena.audio(audio[bus], slot))
            instance.perform([event.message for event in message.midi], [(c.channel, c.value) for c in message.controls])
            for bus, channel in program.outputs:
                instance.cs.audioChannel(channel, arena.audio(audio[bus], slot))
            if program.owns_output:
                np.copyto(arena.audio(audio[FINAL_BUS], slot), np.asarray(instance.cs.spout()).reshape(engine.ksmps, 2))
                # Csound may set thread-local flush-to-zero behavior. Convert
                # beside performKsmps, as the single worker does, not in a parent
                # thread with a different floating-point environment. Retain the
                # native-width final bus for bridge validation and diagnostics.
                with np.errstate(over="ignore"):
                    arena.audio(audio[FINAL_PCM_BUS], slot)[:] = arena.audio(audio[FINAL_BUS], slot)
                if not np.isfinite(arena.audio(audio[FINAL_PCM_BUS], slot)).all():
                    raise RuntimeError("Partition output exceeds float32 PCM range.")
                if flush_float32 is None:
                    flush_float32 = int(np.asarray([1e-40], dtype=np.float32).view(np.uint32)[0] == 0)
                arena.audio(audio[FINAL_F32_MODE_BUS], slot)[0] = flush_float32
            for index, channel in enumerate(program.meters):
                arena.audio(meters, slot)[index] = instance.cs.controlChannel(channel)[0]
            if (any(not np.isfinite(arena.audio(audio[bus], slot)).all() for bus, _ in program.outputs)
                    or (program.owns_output and not np.isfinite(arena.audio(audio[FINAL_BUS], slot)).all())
                    or not np.isfinite(arena.audio(meters, slot)).all()):
                raise RuntimeError("Native partition produced nonfinite audio/meters.")
            arena.send(reply, arena.encode(expected_done(message), reply))
            reply_ready.release()
            sequence += 1
            sample += engine.ksmps
            revision = message.control_revision
    except BaseException as exc:
        if identity is not None and reply is not None:
            error = Error(**identity, code=getattr(exc, "code", phase), detail=str(exc)[:2048], last_complete_sequence=sequence - 1)
            arena.send(reply, arena.encode(error, reply))
            reply_ready.release()
    finally:
        try:
            if instance is not None:
                instance.close()
        finally:
            arena.close()
