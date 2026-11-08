from __future__ import annotations

from multiprocessing.shared_memory import SharedMemory

import numpy as np
import pytest

from backend.app.engine.render_ipc import (
    LENGTH, AudioRegion, Region, SharedArena, build_layout, expected_done, slots_for, validate_render,
)
from backend.app.models.render_protocol import ControlWrite, Render
from backend.tests.render_plan_support import prepared_partition as prepared


IDENTITY = dict(protocol_version=1, epoch=1, partition_id="upstream-0", plan_hash="a" * 64)


def test_compact_empty_block_binds_exact_epoch_layout_and_counters():
    from backend.app.engine.render_block_codec import BLOCK, DONE_MAGIC, SteadyBlockCodec

    _, plan, compilation = prepared()
    layouts = [build_layout(compilation, plan, epoch, limit=64 * 1024 * 1024) for epoch in (1, 2)]
    first = next(iter(layouts[0].workers.values()))
    codec = SteadyBlockCodec(first.bootstrap_hash)
    data = codec.render(2, 64, 3)
    assert codec.validate(data, sequence=2, sample=64, revision=2) == (3, 1)
    assert codec.done(data) == DONE_MAGIC + data[4:]
    # Digest binds epoch and every worker's distinct identity/bus ownership.
    for layout in layouts:
        for regions in layout.workers.values():
            if regions.bootstrap_hash != first.bootstrap_hash:
                with pytest.raises(ValueError, match="ownership"):
                    SteadyBlockCodec(regions.bootstrap_hash).validate(data, sequence=2, sample=64, revision=3)
    for index, replacement in [(0, DONE_MAGIC), (1, bytes(32)), (2, 1), (3, 63), (4, 2), (5, 0), (5, 2)]:
        fields = list(BLOCK.unpack(data))
        fields[index] = replacement
        with pytest.raises(ValueError, match="mismatch"):
            codec.validate(BLOCK.pack(*fields), sequence=2, sample=64, revision=3)
    for broken in (data[:-1], data + b"x", b""):
        with pytest.raises(ValueError, match="length"):
            codec.validate(broken, sequence=2, sample=64, revision=3)


def descriptor(**updates):
    return Render(**(dict(**IDENTITY, sequence=2, sample_start=64, frame_count=32, control_revision=3,
                          slots=slots_for(("bus:1", "bus:2"), 2)) | updates))


def test_shared_layout_is_bounded_aligned_and_disjoint():
    _, plan, compilation = prepared()
    layout = build_layout(compilation, plan, 1, limit=64 * 1024 * 1024)
    regions = [v.region for v in layout.audio.values()]
    for worker in layout.workers.values():
        regions.extend((worker.command, worker.reply, worker.meters.region, worker.bootstrap))
    regions.sort(key=lambda r: r.offset)
    assert all(r.offset % 64 == 0 for r in regions)
    assert all(a.offset + a.size <= b.offset for a, b in zip(regions, regions[1:]))
    assert regions[-1].offset + regions[-1].size <= layout.size
    assert layout.size > plan.shared_audio_bytes  # mailboxes, final PCM, meters, CSD included
    assert build_layout(compilation, plan, 1, limit=layout.size) == layout
    with pytest.raises(ValueError, match="capacity"):
        build_layout(compilation, plan, 1, limit=layout.size - 1)


@pytest.mark.parametrize("width", [4, 8])
def test_native_audio_slots_share_samples_but_not_ownership(width):
    owner = SharedArena(size=4096)
    child = SharedArena(size=4096, name=owner.name)
    region = AudioRegion(Region(0, 2 * 32 * width), 32, 1, width)
    owner.audio(region, 0)[:] = np.arange(32)
    owner.audio(region, 1)[:] = -1
    np.testing.assert_array_equal(child.audio(region, 0), np.arange(32))
    assert child.audio(region, 0).dtype.itemsize == width
    child.audio(region, 1)[:] = 123
    assert np.all(owner.audio(region, 1) == 123)
    child.close()
    attachment = SharedMemory(name=owner.name, track=False)
    assert attachment.size >= 4096
    attachment.close()
    owner.close()
    owner.close()
    with pytest.raises(FileNotFoundError):
        SharedMemory(name=owner.name, track=False)


def test_mailbox_roundtrip_and_corruption_bounds():
    arena = SharedArena(size=4096)
    try:
        region = Region(0, 2048)
        message = descriptor()
        arena.send(region, arena.encode(message, region))
        assert arena.receive(region) == message
        assert expected_done(message).sequence == message.sequence
        with pytest.raises(ValueError, match="capacity"):
            arena.encode(message, Region(0, 16))
        for length in (0, 2048, 2**32 - 1):
            LENGTH.pack_into(arena.memory.buf, 0, length)
            with pytest.raises(ValueError, match="length"):
                arena.receive(region)
        for invalid in (Region(-1, 1), Region(4090, 10)):
            with pytest.raises(ValueError, match="outside"):
                arena.read(invalid)
        with pytest.raises(ValueError, match="layout"):
            arena.audio(AudioRegion(Region(0, 16), 32, 1, 8), 0)
    finally:
        arena.close()


@pytest.mark.parametrize("change", [
    {"sequence": 1}, {"sample_start": 63}, {"frame_count": 1}, {"epoch": 2},
    {"control_revision": 2}, {"slots": ()}, {"slots": slots_for(("bus:1", "bus:2"), 3)},
    {"slots": slots_for(("bus:1", "bus:2"), 4)}, {"slots": slots_for(("bus:1", "foreign"), 2)},
    {"controls": (ControlWrite(channel="foreign", value=1.),)}, {"plan_hash": "b" * 64},
])
def test_stateful_block_validation_rejects_stale_or_foreign_ownership(change):
    kwargs = dict(sequence=2, sample=64, frames=32, revision=3, buses=("bus:1", "bus:2"), controls=("gain",))
    validate_render(descriptor(), IDENTITY, **kwargs)
    with pytest.raises(ValueError, match="mismatch"):
        validate_render(descriptor(**change), IDENTITY, **kwargs)


def test_bootstrap_contains_only_owned_audio_regions():
    import json
    _, plan, compilation = prepared()
    layout = build_layout(compilation, plan, 7, limit=64 * 1024 * 1024)
    for program in compilation.programs:
        data = json.loads(layout.bootstraps[program.id])
        assert set(data["audio"]) == {b for b, _ in (*program.inputs, *program.outputs)} | ({"$final", "$final-pcm", "$final-f32-mode"} if program.owns_output else set())


@pytest.mark.parametrize("width", [4, 8])
def test_stock_binding_audio_pointer_declarations_use_verified_myflt(width):
    import ctypes
    from types import SimpleNamespace
    from unittest.mock import Mock
    from backend.app.engine.partition_native import configure_audio_abi

    library = SimpleNamespace(csoundGetAudioChannel=Mock(), csoundSetAudioChannel=Mock(), csoundGet0dBFS=Mock())
    library.csoundGetAudioChannel.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]
    configure_audio_abi(library, width)
    scalar = ctypes.c_double if width == 8 else ctypes.c_float
    for function in (library.csoundGetAudioChannel, library.csoundSetAudioChannel):
        assert function.argtypes == [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(scalar)]
        assert function.restype is None
    assert library.csoundGet0dBFS.restype is scalar
