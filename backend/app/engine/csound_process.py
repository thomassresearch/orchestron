"""Import-safe spawn target. Each child exclusively owns one native Csound instance."""
from __future__ import annotations

import hashlib
from functools import partial
import json
import multiprocessing
from multiprocessing.connection import wait
import os
import threading
from types import SimpleNamespace

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.engine.partition_native import NativeCsoundPartition
from backend.app.engine.render_block_codec import RENDER_MAGIC, SteadyBlockCodec
from backend.app.engine.render_cpu_placement import apply_worker_cpu
from backend.app.engine.render_ipc import (
    FINAL_BUS, FINAL_PCM_BUS, FINAL_F32_MODE_BUS, MESSAGE, Region, SharedArena, decode_audio, expected_done, validate_envelope, validate_render,
)
from backend.app.models.render_protocol import EngineFormat, Error, Init, Ready, RenderBatch, Stop, Stopped


def _exit_with_parent():
    # A native call can hang indefinitely. Do not rely on the render loop polling
    # getppid(): the sentinel also detects death while compiling or performing.
    parent = multiprocessing.parent_process()
    if parent is not None:
        wait([parent.sentinel])
        os._exit(1)


def run_csound_process(name, size, bootstrap, digest, command_ready, reply_ready, *, predecessor_ready=(), successor_ready=(), cpu_affinity=None):
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
    _serve(name, size, bootstrap, digest, command_ready, reply_ready,
           predecessor_ready=predecessor_ready, successor_ready=successor_ready, cpu_affinity=cpu_affinity)


def _serve(name, size, bootstrap, digest, command_ready, reply_ready, *, native_factory=None,
           predecessor_ready=(), successor_ready=(), cpu_affinity=None):
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
        if len(predecessor_ready) != len(config["predecessors"]) or len(successor_ready) != len(config["successors"]):
            raise ValueError("Dependency barriers do not match provisioned graph.")
        program = SimpleNamespace(**config["program"])
        engine = SimpleNamespace(**config["engine"])
        batch_blocks = config["batch_blocks"]
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
        phase = "start"
        apply_worker_cpu(cpu_affinity)
        phase = "compile"
        if native_factory is None:
            instance = NativeCsoundPartition(load_ctcsound_module(), program.csd, engine, config["sample_bytes"])
        else:
            instance = native_factory(program, engine, config["sample_bytes"])
        codec = SteadyBlockCodec(digest)
        # Layout and ownership are immutable for this epoch. Validate/view once,
        # rather than hash AudioRegion dataclasses for each channel every block.
        def block_views(connections):
            return tuple(tuple(tuple((channel, arena.audio(audio[bus], slot)[
                index * engine.ksmps:(index + 1) * engine.ksmps]) for bus, channel in connections)
                for index in range(batch_blocks)) for slot in (0, 1))

        inputs, outputs = block_views(program.inputs), block_views(program.outputs)
        meter_views = tuple(arena.audio(meters, slot).reshape(batch_blocks, len(program.meters)) for slot in (0, 1))
        final_views = tuple(arena.audio(audio[FINAL_BUS], slot) for slot in (0, 1)) if program.owns_output else ()
        pcm_views = tuple(arena.audio(audio[FINAL_PCM_BUS], slot) for slot in (0, 1)) if program.owns_output else ()
        mode_views = tuple(arena.audio(audio[FINAL_F32_MODE_BUS], slot) for slot in (0, 1)) if program.owns_output else ()
        if native_factory is None:
            input_copies = tuple(tuple(tuple(instance.bind_audio_transfer(channel, values, into_csound=True)
                                            for channel, values in block) for block in slot) for slot in inputs)
            output_copies = tuple(tuple(tuple(instance.bind_audio_transfer(channel, values, into_csound=False)
                                             for channel, values in block) for block in slot) for slot in outputs)
            meter_readers = tuple(instance.bind_meter_reader(channel) for channel in program.meters)
        else:
            input_copies = tuple(tuple(tuple(partial(instance.cs.setAudioChannel, channel, values)
                                            for channel, values in block) for block in slot) for slot in inputs)
            output_copies = tuple(tuple(tuple(partial(instance.cs.audioChannel, channel, values)
                                             for channel, values in block) for block in slot) for slot in outputs)
            meter_readers = tuple(partial(instance.cs.controlChannel, channel) for channel in program.meters)
        ready = Ready(**identity, artifact_hash=config["artifact_hash"], engine=native_format)
        arena.send(reply, arena.encode(ready, reply))
        reply_ready.release()
        while True:
            command_ready.acquire()
            phase = "protocol"
            data = arena.receive_bytes(command)
            if data.startswith(RENDER_MAGIC):
                next_revision, block_count = codec.validate(data, sequence=sequence, sample=sample,
                                                            revision=revision, max_blocks=batch_blocks)
                deliveries = None
                completion = codec.done(data)
            else:
                message = MESSAGE.validate_json(data)
                validate_envelope(message, identity)
                if isinstance(message, Stop):
                    phase = "shutdown"
                    instance.close()
                    instance = None
                    arena.send(reply, arena.encode(Stopped(**identity), reply))
                    reply_ready.release()
                    break
                validate_render(message, identity, sequence=sequence, sample=sample, frames=engine.ksmps,
                                revision=revision, buses=tuple(audio), controls=program.controls, max_blocks=batch_blocks)
                next_revision = message.control_revision
                deliveries = message.blocks if isinstance(message, RenderBatch) else (message,)
                block_count = len(deliveries)
                completion = arena.encode(expected_done(message), reply)
            phase = "render"
            # Parent has sealed this batch for every partition. Wait directly on
            # each predecessor's publication fence, without a parent wakeup and
            # redispatch between waves. No next batch is issued until *all* DONEs
            # are validated. Cancellation/error uses bounded parent reaping, and
            # the watchdog still handles parent death even while blocked here.
            for predecessor in predecessor_ready:
                predecessor.acquire()
                if predecessor.acquire(False):
                    raise ValueError("Duplicate dependency publication.")
            slot = sequence % 2
            for block_index in range(block_count):
                delivery = deliveries[block_index] if deliveries is not None else None
                midi = [event.message for event in delivery.midi] if delivery else ()
                controls = [(c.channel, c.value) for c in delivery.controls] if delivery else ()
                for copy in input_copies[slot][block_index]:
                    copy()
                instance.perform(midi, controls)
                for copy in output_copies[slot][block_index]:
                    copy()
                if program.owns_output:
                    span = slice(block_index * engine.ksmps, (block_index + 1) * engine.ksmps)
                    output = (instance.output_buffer if native_factory is None else
                              np.asarray(instance.cs.spout()).reshape(engine.ksmps, 2))
                    np.copyto(final_views[slot][span], output)
                    del output  # No borrowed native view survives shutdown/reset.
                    # Retain the native thread's float32/subnormal behavior.
                    with np.errstate(over="ignore"):
                        pcm_views[slot][span] = final_views[slot][span]
                    if not np.isfinite(pcm_views[slot][span]).all():
                        raise RuntimeError("Partition output exceeds float32 PCM range.")
                    if flush_float32 is None:
                        # Probe NumPy's double-array cast, as used by PCM and
                        # interpolation. Python-float packing can preserve tiny
                        # values even when the native thread flushes array casts.
                        probe = np.full(32, 1e-40, dtype=np.float64).astype(np.float32)
                        flush_float32 = int(not np.any(probe.view(np.uint32)))
                    mode_views[slot][0] = flush_float32
                for index, read_meter in enumerate(meter_readers):
                    value = read_meter()
                    meter_views[slot][block_index, index] = value if native_factory is None else value[0]
                if (any(not np.isfinite(values).all() for _, values in outputs[slot][block_index])
                        or not np.isfinite(meter_views[slot][block_index]).all()):
                    raise RuntimeError("Native partition produced nonfinite audio/meters.")
            arena.send(reply, completion)
            for successor in successor_ready:
                successor.release()
            # Publish the parent acknowledgement last. Once all acknowledgements
            # arrive, every edge has been both released and consumed, so a
            # leftover edge count is an invalid duplicate, not a late valid write.
            reply_ready.release()
            sequence += 1
            sample += block_count * engine.ksmps
            revision = next_revision
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
