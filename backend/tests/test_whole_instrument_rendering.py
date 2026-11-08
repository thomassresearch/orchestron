"""Graph selection and native resource ownership, including a real performance."""
from dataclasses import replace

import numpy as np
import pytest

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.render_release import RenderRelease
from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
from backend.app.core.config import Settings
from backend.app.models.patch import NodeInstance
from backend.app.models.render_protocol import RendererPolicy
from backend.app.services.compiler_service import CompilerService
from backend.app.services.compiler_mixer import mixer_control_values
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.render_partition_plan import plan_render_partitions, validate_partition_plan
from backend.tests.lake_render_support import lake_inputs, lake_events
from backend.tests.render_plan_support import planner_inputs
from backend.tests.session_parallel_support import options
from backend.tools._sequential_partition_probe import compare_sequential


def prepare(inputs, workers=8):
    compiler = CompilerService(OpcodeService('/static/icons'))
    targets, graph, mixer = inputs
    dependency = compiler.analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='auto', max_workers=workers))
    return plan, compiler.compile_realtime_partitions(targets, graph, mixer, plan)


def owners(plan):
    return {s: p.id for p in plan.partitions for s in p.stages}


def test_lake_has_whole_instrument_owners_and_shared_effect_suffix_without_catalog():
    inputs = lake_inputs()
    plan, compilation = prepare(inputs)
    assert plan.layout == 'coarse' and len(plan.partitions) == 3
    assert not plan.graph.blockers and plan.cost_profile is None
    assert plan.single_microseconds is None and plan.candidate_microseconds is None
    ownership = owners(plan)
    for target in inputs[0]:
        identity = target.assignment_id
        assert ownership['patch:' + identity] == ownership['strip:' + identity]
    assert len({ownership['patch:' + i] for i in ('tabla', 'shore', 'analog-drums', 'theme')}) == 1
    assert ownership['patch:space'] == ownership['patch:0442aeda-2002-410e-a689-9d4bf3438b0c'] == 'downstream'
    assert ownership['$output'] == 'downstream'
    assert plan.graph.engine.sample_rate == 48000 and plan.graph.engine.ksmps == 32
    assert (plan.graph.engine.software_buffer, plan.graph.engine.hardware_buffer) == (1024, 512)
    assert (plan, compilation) == prepare(inputs)
    validate_partition_plan(plan)
    limited, _ = prepare(inputs, workers=3)
    assert len(limited.partitions) == 3


def test_shared_mutable_table_only_groups_its_users():
    plan, _ = prepare(planner_inputs('tables'))
    ownership = owners(plan)
    assert plan.layout == 'coarse'
    assert ownership['patch:source0'] == ownership['patch:source1']
    assert ownership['patch:source2'] != ownership['patch:source0']
    assert sum(r.memory_bytes for r in plan.graph.resources) > 0


def test_lake_master_insert_keeps_the_same_upstream_split_and_shared_suffix():
    original, _ = prepare(lake_inputs())
    revised, _ = prepare(lake_inputs(master_insert=True))
    assert revised.layout == 'coarse' and len(revised.partitions) == 3
    assert not revised.graph.blockers and revised.graph.engine == original.graph.engine
    assert len(revised.graph.stages) == len(original.graph.stages) + 1
    assert len(revised.buses) == len(original.buses) == 34
    assert [p.stages for p in revised.partitions if p.id != 'downstream'] == [
        p.stages for p in original.partitions if p.id != 'downstream']
    ownership = owners(revised)
    assert {ownership[s] for s in (
        'patch:space', 'patch:$master', 'strip:$master', '$output',
        'patch:4597b710-6b3d-4d50-8af7-34ff32abc9aa',
        'bypass:4597b710-6b3d-4d50-8af7-34ff32abc9aa')} == {'downstream'}
    validate_partition_plan(revised)


def test_builtin_sine_is_replicated_until_a_writer_requires_shared_ownership():
    targets, graph, mixer = planner_inputs('tables')
    for target in [t for t in targets if t.assignment_id.startswith('source')][:2]:
        target.patch.graph.ui_layout['gen_nodes']['table']['tableNumber'] = 1
        next(n for n in target.patch.graph.nodes if n.id == 'amp').params['ifn'] = 1
    plan, _ = prepare((targets, graph, mixer))
    readers = [r for r in plan.graph.resources if r.resource == 'table:1']
    assert readers and all(r.scope == 'performance' for r in readers)
    assert owners(plan)['patch:source0'] == owners(plan)['patch:source1']
    inputs = lake_inputs()
    plan, _ = prepare(inputs)
    assert all(r.scope == 'replicated' for r in plan.graph.resources if r.resource == 'table:1')


def test_dynamic_table_domain_is_colocated_and_unbounded_allocations_fall_back():
    inputs = planner_inputs('dynamic_table')
    plan, _ = prepare(inputs)
    assert plan.layout == 'single'
    assert 'unbounded_table_allocation' in {d.code for d in plan.diagnostics}
    for target in [t for t in inputs[0] if t.assignment_id.startswith('source')][:2]:
        target.patch.graph.ui_layout['gen_nodes']['table']['mode'] = 'ftgenonce'
    plan, _ = prepare(inputs)
    assert plan.layout == 'coarse'
    assert owners(plan)['patch:source0'] == owners(plan)['patch:source1']


def test_writable_resources_cannot_be_declared_replicated():
    targets, graph, _ = planner_inputs('tables')
    dependency = CompilerService(OpcodeService('/static/icons')).analyze_realtime_graph(targets, graph)
    invalid = replace(dependency, resources=tuple(
        replace(r, scope='replicated') if r.resource == 'table:7' and r.access == 'read_write' else r
        for r in dependency.resources))
    with pytest.raises(ValueError, match='read-only'):
        plan_render_partitions(invalid, policy=RendererPolicy(mode='auto'))


def test_shared_random_stream_preserved_without_blocking_ordinary_voice_dsp():
    inputs = planner_inputs('four')
    for target in [t for t in inputs[0] if t.assignment_id.startswith('source')][:2]:
        target.patch.graph.nodes.append(NodeInstance(id='random', opcode='randomi'))
    plan, _ = prepare(inputs)
    assert plan.layout == 'coarse'
    assert owners(plan)['patch:source0'] == owners(plan)['patch:source1']


def test_named_generators_do_not_inherit_numeric_generator_resource_semantics():
    targets, graph, _ = planner_inputs('tables')
    targets[0].patch.graph.ui_layout['gen_nodes']['table']['routineName'] = 'padsynth'
    dependency = CompilerService(OpcodeService('/static/icons')).analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='auto'))
    assert plan.layout == 'single'
    assert 'table_generator_state_unknown' in {d.code for d in plan.diagnostics}


@pytest.mark.parametrize('master_insert', [False, True])
def test_lake_sequential_native_audio_and_meters_match_exactly(master_insert):
    plan, compilation = prepare(lake_inputs(master_insert=master_insert))
    result = compare_sequential(compilation, plan, frames=96000, events=lake_events())
    assert np.max(np.abs(result.canonical)) > .001
    np.testing.assert_array_equal(result.canonical, result.partitioned)
    np.testing.assert_array_equal(result.canonical_meters, result.partitioned_meters)


@pytest.mark.parametrize('case', ['lake', 'lake_master_insert', 'shared_tables'])
@pytest.mark.parametrize('coordination_frames', [32, 128, 256])
def test_public_selection_persistent_processes_and_midi_match_single(monkeypatch, case, coordination_frames):
    from backend.app.engine.parallel_csound_renderer import MAX_REQUEST_FRAMES
    from backend.app.engine.render_capacity import MIB

    monkeypatch.setenv('VISUALCSOUND_FORCE_MOCK_ENGINE', 'false')
    compiler = CompilerService(OpcodeService('/static/icons'))
    targets, graph, mixer = (lake_inputs(master_insert=case == 'lake_master_insert')
                             if case.startswith('lake') else planner_inputs('tables'))
    canonical = compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph, mixer=mixer)
    selected = replace(RenderRelease(Settings(parallel_render_batch_frames=coordination_frames)).options(None),
                       admission=options().admission)
    parallel = ParallelCsoundRenderer(options=selected)
    single = CsoundWorker()
    parallel.prepare(compiler, targets, graph, mixer, canonical)
    try:
        single.start(canonical.csd, 'internal:loopback', 'null')
        parallel.start(canonical.csd, 'internal:loopback', 'null')
        for worker in (single, parallel):
            worker.configure_mixer(canonical.manifest, mixer_control_values(canonical.manifest, mixer))
        assert parallel.renderer_diagnostics['selected'] == 'parallel', parallel.renderer_diagnostics
        assert parallel.renderer_diagnostics['worker_count'] == 3
        resource_bytes = sum(r.memory_bytes for r in parallel._candidate[1].graph.resources)
        assert selected.admission.leases[0].memory_bytes == (
            3 * 128 * MIB + parallel._coordinator._layout.size + MAX_REQUEST_FRAMES * 8 + resource_bytes)
        processes = parallel._coordinator.process_ids
        for worker in (single, parallel):
            for sample, message in lake_events():
                worker.enqueue_timestamped_midi(message, source='lake-parity', target_engine_sample=sample)
        single_audio, parallel_audio = [], []
        for _ in range(32):
            for worker, output in ((single, single_audio), (parallel, parallel_audio)):
                output.append(worker.render_blocks(block_count=48, target_sample_rate=48000).pcm_f32le)
            assert parallel._coordinator.process_ids == processes
            assert parallel.render_sample_cursor == single.render_sample_cursor
        assert b''.join(parallel_audio) == b''.join(single_audio)
    finally:
        single.stop()
        parallel.stop()
    assert not parallel._coordinator.process_ids and parallel._coordinator.shared_memory_name is None
    assert not selected.admission.leases


def test_custom_fft_windows_and_prepared_piano_tables_constrain_ownership():
    compiler = CompilerService(OpcodeService('/static/icons'))
    targets, graph, _ = planner_inputs('tables')
    target = next(t for t in targets if t.assignment_id == 'source2')
    target.patch.graph.nodes.extend([
        NodeInstance(id='fft', opcode='pvsanal', params={'iwintype': -7}),
        NodeInstance(id='piano', opcode='prepiano', params={'irattles': 7, 'irubbers': 7}),
    ])
    dependency = compiler.analyze_realtime_graph(targets, graph)
    readers = [r for r in dependency.resources if r.stage == 'patch:source2' and r.resource == 'table:7']
    assert {r.node for r in readers} == {'fft', 'piano'}
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='auto'))
    assert owners(plan)['patch:source0'] == owners(plan)['patch:source1'] == owners(plan)['patch:source2']


def test_compiler_random_initializers_share_the_same_owner():
    targets, graph, _ = planner_inputs('four')
    for identity, opcode in (('source0', 'waveguide_string'), ('source1', 'swept_gate')):
        next(t for t in targets if t.assignment_id == identity).patch.graph.nodes.append(NodeInstance(id='rng', opcode=opcode))
    dependency = CompilerService(OpcodeService('/static/icons')).analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='auto'))
    assert owners(plan)['patch:source0'] == owners(plan)['patch:source1']


def test_scalar_parameter_expressions_cannot_hide_shared_native_state():
    compiler = CompilerService(OpcodeService('/static/icons'))
    targets, graph, _ = planner_inputs('four')
    sources = [t for t in targets if t.assignment_id.startswith('source')]
    for target in sources[:2]:
        target.patch.graph.nodes.append(NodeInstance(id='expr', opcode='const_i', params={'value': 'rnd(1)'}))
    plan = plan_render_partitions(compiler.analyze_realtime_graph(targets, graph), policy=RendererPolicy(mode='auto'))
    assert owners(plan)['patch:source0'] == owners(plan)['patch:source1']
    sources[0].patch.graph.nodes[-1].params['value'] = 'gi_shared + ftlen(7)'
    plan = plan_render_partitions(compiler.analyze_realtime_graph(targets, graph), policy=RendererPolicy(mode='auto'))
    assert plan.layout == 'single' and 'expression_state_unknown' in {d.code for d in plan.diagnostics}
    sources[0].patch.graph.nodes[-1].params['value'] = '0dbfs * 1e-3 * abs(p4) * sr / 48000'
    assert not compiler.analyze_realtime_graph(targets, graph).blockers
