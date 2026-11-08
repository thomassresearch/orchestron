"""Coordination intervals preserve synthesis steps, event offsets and publication."""
from functools import partial
import json

import numpy as np
import pytest

from backend.app.engine.midi_scheduler import EngineMidiScheduler
from backend.app.engine.parallel_csound_renderer import BlockInputs, PartitionRenderCoordinator, PartitionRuntimeError
from backend.app.engine.render_block_codec import SteadyBlockCodec
from backend.app.engine.render_ipc import MailboxCapacityError, build_layout, coordination_blocks, expected_done, slots_for, validate_render
from backend.app.models.render_protocol import ControlWrite, MidiDelivery, Render, RenderBatch, RendererPolicy
from backend.tests.partition_process_support import controlled_process
from backend.tests.render_plan_support import prepared_partition
from backend.tests.test_parallel_csound_renderer import assert_released
from backend.tools._sequential_partition_probe import compare_sequential


@pytest.mark.parametrize("ksmps,frames,blocks", [(1, 128, 128), (32, 128, 4), (32, 256, 8), (48, 128, 2), (256, 128, 1)])
def test_coordination_capacity_uses_whole_unchanged_synthesis_blocks(ksmps, frames, blocks):
    assert coordination_blocks(ksmps, frames) == blocks


def test_batched_layout_charges_audio_and_each_step_meter_storage():
    _, plan, compilation = prepared_partition()
    small = build_layout(compilation, plan, 1, limit=64 * 1024 * 1024, coordination_frames=32)
    large = build_layout(compilation, plan, 1, limit=64 * 1024 * 1024, coordination_frames=256)
    assert large.size > small.size
    for name, region in small.audio.items():
        assert large.audio[name].frames == region.frames * (1 if name == '$final-f32-mode' else 8)
    for name, worker in large.workers.items():
        assert worker.meters.frames == small.workers[name].meters.frames * 8
        assert json.loads(large.bootstraps[name])['batch_blocks'] == 8
        assert worker.bootstrap_hash != small.workers[name].bootstrap_hash
    with pytest.raises(ValueError, match='capacity'):
        build_layout(compilation, plan, 1, limit=small.size, coordination_frames=256)


def test_compact_batch_acknowledgement_binds_count_and_capacity():
    codec = SteadyBlockCodec('a' * 64)
    batch = codec.render(2, 128, 9, 8)
    assert codec.validate(batch, sequence=2, sample=128, revision=7, max_blocks=8) == (9, 8)
    assert codec.done(batch) != codec.done(codec.render(2, 128, 9, 4))
    with pytest.raises(ValueError, match='mismatch'):
        codec.validate(batch, sequence=2, sample=128, revision=7, max_blocks=4)


def batch_message():
    identity = dict(protocol_version=1, epoch=1, partition_id='upstream-0', plan_hash='a' * 64)
    slots = slots_for(('bus:1',), 2)
    blocks = tuple(Render(**identity, sequence=2, sample_start=128 + index * 32, frame_count=32,
        control_revision=index, slots=slots, midi=(MidiDelivery(sequence=index + 1, source='notes',
        target_engine_sample=128 + index * 32 + 7, message=(0x90, 60 + index, 90), late=False),),
        controls=(ControlWrite(channel='gain', value=index / 4),)) for index in range(4))
    return RenderBatch(**identity, sequence=2, sample_start=128, frame_count=128, control_revision=3,
                       slots=slots, blocks=blocks), identity


@pytest.mark.parametrize('corruption', ['gap', 'frame_count', 'identity', 'revision', 'slot', 'foreign_control', 'event_offset'])
def test_event_batches_reject_corrupt_timing_ownership_and_revisions(corruption):
    batch, identity = batch_message()
    options = dict(sequence=2, sample=128, frames=32, revision=0, buses=('bus:1',), controls=('gain',), max_blocks=4)
    validate_render(batch, identity, **options)
    assert expected_done(batch).frame_count == 128
    broken = batch.model_dump(mode='json')
    block = broken['blocks'][2]
    if corruption == 'gap':
        block['sample_start'] += 1
    elif corruption == 'frame_count':
        broken['frame_count'] = 96
    elif corruption == 'identity':
        block['epoch'] += 1
    elif corruption == 'revision':
        block['control_revision'] = 0
    elif corruption == 'slot':
        block['slots'][0]['slot'] = 1
    elif corruption == 'foreign_control':
        block['controls'][0]['channel'] = 'foreign'
    else:
        block['midi'][0]['target_engine_sample'] = 128
    with pytest.raises(ValueError):
        validate_render(RenderBatch.model_validate_json(json.dumps(broken)), identity, **options)


@pytest.mark.parametrize('frames', [32, 128, 256])
@pytest.mark.parametrize('case,ksmps', [('two', 1), ('four', 32), ('bypass', 32), ('tables', 32)])
def test_batched_native_audio_controls_meters_and_partial_requests_match_single(frames, case, ksmps):
    targets, plan, compilation = prepared_partition(case, ksmps)
    events = sorted((sample, (status + target.midi_channel - 1, note, value))
        for sample, status, note, value in [(0, 0x90, 60, 90), (31, 0x90, 64, 70), (63, 0x80, 60, 0),
            (95, 0xB0, 64, 127), (127, 0x80, 64, 0), (159, 0xB0, 64, 0), (191, 0x90, 67, 110), (255, 0xB0, 120, 0)]
        for target in targets if target.midi_channel)
    gain = next(name for program in compilation.programs for name in program.controls if 'gain' in name.lower())
    controls = [(32, gain, .3), (64, gain, .8), (128, gain, .5), (192, gain, .9)]
    reference = compare_sequential(compilation, plan, frames=8192, events=events, controls=controls)
    scheduler = EngineMidiScheduler()
    for sample, event in events:
        scheduler.enqueue(event, source='fixture', target_engine_sample=sample)
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(coordination_frames=frames))
    cursor = revision = 0
    trace, audio, meter_frames = [], [], []

    def prepare(index, sample):
        nonlocal cursor, revision
        trace.append((sample, renderer.render_sample_cursor))
        writes = {}
        while cursor < len(controls) and controls[cursor][0] < sample + ksmps:
            _, name, value = controls[cursor]
            writes[name] = value
            revision += 1
            cursor += 1
        return BlockInputs(control_revision=revision, controls=tuple(ControlWrite(channel=k, value=v) for k, v in writes.items()),
            midi=tuple(MidiDelivery(sequence=e.sequence, source=e.source, target_engine_sample=e.target_engine_sample,
                message=tuple(e.message), late=e.late) for e in scheduler.drain_block(block_start_sample=sample,
                                                                                   block_end_sample=sample + ksmps)))

    try:
        renderer.start(compilation, plan)
        pids, name = renderer.process_ids, renderer.shared_memory_name
        request_sizes = (1, 3, 7, 19, 63, 257)
        index = 0
        while renderer.committed_sample < 8192:
            count = min(request_sizes[index % len(request_sizes)], (8192 - renderer.committed_sample) // ksmps)
            result = renderer.render_blocks(block_count=count, target_sample_rate=48000, prepare_block=prepare)
            audio.append(np.frombuffer(result.pcm_f32le, dtype='<f4').reshape(-1, 2))
            meter_frames.extend(renderer.drain_meter_frames())
            index += 1
        np.testing.assert_array_equal(np.concatenate(audio), reference.canonical.astype(np.float32).reshape(-1, 2))
        assert trace == [(sample, sample) for sample in range(0, 8192, ksmps)]
        meter_names = [m for stage in plan.graph.stages for m in stage.meters]
        for frame in meter_frames:
            np.testing.assert_array_equal([frame['channels'][m] for m in meter_names],
                                          reference.canonical_meters[frame['engineSample'] // ksmps - 1])
        assert renderer.committed_sample == renderer.published_sample == renderer.sealed_sample == 8192
        if frames > ksmps:
            assert renderer._sequence < 8192 // ksmps
    finally:
        renderer.stop()
    assert_released(renderer, name, pids)


@pytest.mark.parametrize('frames', [128, 256])
def test_failure_inside_batch_publishes_no_partial_audio(frames):
    _, plan, compilation = prepared_partition()
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(coordination_frames=frames, stop_timeout_seconds=.5),
        _worker_target=partial(controlled_process, mode='second_block_error'))
    renderer.start(compilation, plan)
    pids, name = renderer.process_ids, renderer.shared_memory_name
    try:
        with pytest.raises(PartitionRuntimeError, match='injected'):
            renderer.render_blocks(block_count=frames // 32, target_sample_rate=48000)
        assert renderer.committed_sample == renderer.published_sample == 0
        assert renderer.sealed_sample == frames
    finally:
        renderer.stop()
    assert_released(renderer, name, pids)


def test_dense_commands_split_before_dispatch_without_redraining_events(monkeypatch):
    _, plan, compilation = prepared_partition()
    renderer = PartitionRenderCoordinator(policy=RendererPolicy(coordination_frames=256), _worker_target=controlled_process)
    original = renderer._descriptors
    calls, descriptors = [], []

    def bounded(sample, inputs):
        if len(inputs) > 2:
            raise MailboxCapacityError('injected mailbox capacity')
        descriptors.append((sample, len(inputs)))
        return original(sample, inputs)

    monkeypatch.setattr(renderer, '_descriptors', bounded)
    try:
        renderer.start(compilation, plan)
        renderer.render_blocks(block_count=9, target_sample_rate=48000,
            prepare_block=lambda index, sample: (calls.append((index, sample)) or BlockInputs()))
        assert calls == [(index, index * 32) for index in range(9)]
        assert sum(count for _, count in descriptors) == 9
        assert all(count <= 2 for _, count in descriptors)
        assert renderer.committed_sample == renderer.published_sample == 288
    finally:
        renderer.stop()
