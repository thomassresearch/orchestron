"""Bounded mailboxes and two-slot native audio storage for explicit T05 execution.

Only the parent creates/unlinks the arena. A semaphore release/acquire publishes
each mailbox and its associated samples; an ordinary shared counter is not a
memory fence. There is at most one outstanding command per worker.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import mmap
import os
from multiprocessing.shared_memory import SharedMemory
import struct
import sys

import numpy as np
from pydantic import TypeAdapter

from backend.app.models.render_protocol import BusSlot, Done, Render, RenderMessage

COMMAND_BYTES = 1024 * 1024
REPLY_BYTES = 256 * 1024
FINAL_BUS = "$final"
FINAL_PCM_BUS = "$final-pcm"
FINAL_F32_MODE_BUS = "$final-f32-mode"
MESSAGE = TypeAdapter(RenderMessage)
LENGTH = struct.Struct("<I")


@dataclass(frozen=True)
class Region:
    offset: int
    size: int


@dataclass(frozen=True)
class AudioRegion:
    region: Region
    frames: int
    channels: int
    sample_bytes: int


@dataclass(frozen=True)
class WorkerRegions:
    command: Region
    reply: Region
    meters: AudioRegion
    bootstrap: Region
    bootstrap_hash: str


@dataclass(frozen=True)
class ArenaLayout:
    size: int
    audio: dict[str, AudioRegion]
    workers: dict[str, WorkerRegions]
    bootstraps: dict[str, bytes]


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def build_layout(compilation, plan, epoch, *, limit, command_bytes=COMMAND_BYTES):
    """Account for audio, meters, mailboxes AND CSD bootstrap before allocating."""
    position = 0

    def allocate(size):
        nonlocal position
        start = (position + 63) & ~63
        position = start + size
        if position > limit:
            raise ValueError("Partition shared-memory capacity exceeded.")
        return Region(start, size)

    def audio_region(frames, channels, width):
        return AudioRegion(allocate(2 * frames * channels * width), frames, channels, width)

    if command_bytes < 1024 or command_bytes > COMMAND_BYTES:
        raise ValueError("Invalid command mailbox capacity.")
    audio = {b.id: audio_region(b.frames, b.channels, b.sample_bytes) for b in plan.buses}
    audio[FINAL_BUS] = audio_region(plan.graph.engine.ksmps, 2, plan.sample_bytes)
    audio[FINAL_PCM_BUS] = audio_region(plan.graph.engine.ksmps, 2, 4)
    audio[FINAL_F32_MODE_BUS] = audio_region(1, 1, 8)
    workers, bootstraps = {}, {}
    for program in compilation.programs:
        command, reply = allocate(command_bytes), allocate(REPLY_BYTES)
        meters = audio_region(len(program.meters), 1, 8)
        owned = tuple(b for b, _ in (*program.inputs, *program.outputs))
        if program.owns_output:
            owned += (FINAL_BUS, FINAL_PCM_BUS, FINAL_F32_MODE_BUS)
        if len(owned) > 2048:
            raise ValueError("Partition exceeds protocol bus capacity.")
        data = json_bytes({
            "epoch": epoch, "plan_hash": plan.plan_hash, "artifact_hash": compilation.artifact_hash,
            "engine": asdict(plan.graph.engine), "sample_bytes": plan.sample_bytes,
            "program": asdict(program), "audio": {b: asdict(audio[b]) for b in owned},
            "predecessors": next(p.predecessors for p in plan.partitions if p.id == program.id),
            "successors": tuple(p.id for p in plan.partitions if program.id in p.predecessors),
            "command": asdict(command), "reply": asdict(reply), "meters": asdict(meters),
        })
        bootstrap = allocate(len(data))
        workers[program.id] = WorkerRegions(command, reply, meters, bootstrap, hashlib.sha256(data).hexdigest())
        bootstraps[program.id] = data
    # POSIX implementations can round allocations up to a memory page. Charge
    # that space too (notably 16 KiB pages on Apple Silicon).
    size = (position + mmap.PAGESIZE - 1) // mmap.PAGESIZE * mmap.PAGESIZE
    if size > limit:
        raise ValueError("Partition shared-memory capacity exceeded.")
    return ArenaLayout(size, audio, workers, bootstraps)


def decode_audio(value):
    return AudioRegion(Region(**value["region"]), value["frames"], value["channels"], value["sample_bytes"])


class SharedArena:
    def __init__(self, *, size, name=None):
        self.owner = name is None
        self.memory = SharedMemory(name=name, create=self.owner, size=size, track=self.owner)
        self.name = self.memory.name
        self.size = size
        self._views = {}
        self.closed = False
        rounded = (size + mmap.PAGESIZE - 1) // mmap.PAGESIZE * mmap.PAGESIZE
        if not size <= self.memory.size <= rounded:
            self.close()
            raise ValueError("Shared arena size mismatch.")
        if self.owner and sys.platform.startswith("linux"):
            # shm_open/ftruncate alone do not reserve tmpfs pages: first write
            # can SIGBUS if /dev/shm is full. Linux fallocate reports ENOSPC here
            # instead, before any bootstrap/audio writes or child startup.
            try:
                fd = os.open("/dev/shm/" + self.name, os.O_RDWR)
                try:
                    os.posix_fallocate(fd, 0, self.memory.size)
                finally:
                    os.close(fd)
            except BaseException:
                self.close()
                raise

    def check(self, region):
        if region.offset < 0 or region.size < 0 or region.offset + region.size > self.size:
            raise ValueError("Shared region is outside its arena.")

    def write(self, region, data):
        self.check(region)
        if len(data) != region.size:
            raise ValueError("Shared region size mismatch.")
        self.memory.buf[region.offset:region.offset + region.size] = data

    def read(self, region):
        self.check(region)
        return bytes(self.memory.buf[region.offset:region.offset + region.size])

    @staticmethod
    def encode(message, region):
        data = message.model_dump_json().encode()
        if len(data) + LENGTH.size > region.size:
            raise ValueError("Partition descriptor exceeds mailbox capacity.")
        return data

    def send(self, region, data):
        self.check(region)
        if not data or len(data) + LENGTH.size > region.size:
            raise ValueError("Partition descriptor exceeds mailbox capacity.")
        start = region.offset
        self.memory.buf[start + LENGTH.size:start + LENGTH.size + len(data)] = data
        LENGTH.pack_into(self.memory.buf, start, len(data))

    def receive(self, region):
        return MESSAGE.validate_json(self.receive_bytes(region))

    def receive_bytes(self, region):
        self.check(region)
        size, = LENGTH.unpack_from(self.memory.buf, region.offset)
        if not 0 < size <= region.size - LENGTH.size:
            raise ValueError("Invalid partition mailbox length.")
        start = region.offset + LENGTH.size
        return bytes(self.memory.buf[start:start + size])

    def audio(self, region, slot):
        self.check(region.region)
        if (slot not in (0, 1) or region.sample_bytes not in (4, 8) or region.frames < 0
                or region.channels < 1 or region.region.offset % region.sample_bytes
                or region.region.size != 2 * region.frames * region.channels * region.sample_bytes):
            raise ValueError("Invalid native shared audio layout.")
        key = (region, slot)
        if key not in self._views:
            dtype = np.float64 if region.sample_bytes == 8 else np.float32
            shape = (region.frames,) if region.channels == 1 else (region.frames, region.channels)
            self._views[key] = np.ndarray(shape, dtype=dtype, buffer=self.memory.buf,
                offset=region.region.offset + slot * region.region.size // 2)
        return self._views[key]

    def close(self):
        if self.closed:
            return
        self._views.clear()
        if self.owner:
            self.memory.unlink()
        self.memory.close()
        self.closed = True


def slots_for(buses, sequence):
    return tuple(BusSlot(bus_id=b, slot=sequence % 2, generation=sequence // 2) for b in sorted(buses))


def validate_envelope(message, identity):
    if any(getattr(message, key) != value for key, value in identity.items()):
        raise ValueError("Partition epoch/identity mismatch.")


def validate_render(message, identity, *, sequence, sample, frames, revision, buses, controls):
    validate_envelope(message, identity)
    if (not isinstance(message, Render) or message.sequence != sequence or message.sample_start != sample
            or message.frame_count != frames or message.control_revision < revision
            or message.slots != slots_for(buses, sequence)
            or any(c.channel not in controls for c in message.controls)):
        raise ValueError("Partition block sequence/range/revision/ownership mismatch.")


def expected_done(message):
    return Done(**message.model_dump(exclude={"type", "midi", "controls"}))
