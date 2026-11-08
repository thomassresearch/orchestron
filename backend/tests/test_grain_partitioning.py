"""Private cache ownership, deterministic grain RNG and unchanged canonical DSP."""
from dataclasses import replace

import numpy as np
import pytest

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.render_release import RenderRelease
from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
from backend.app.core.config import Settings
from backend.app.services.compiler_service import CompilerService
from backend.app.services.compiler_mixer import mixer_control_values
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_controller_service import controller_bindings
from backend.tests.grain_render_support import grain_inputs, grain_events
from backend.tests.session_parallel_support import options
from backend.tests.test_whole_instrument_rendering import prepare, owners
from backend.tools._sequential_partition_probe import compare_sequential


def test_grain_ownership_and_sequential_parity():
    inputs = grain_inputs()
    plan, compilation = prepare(inputs)
    assert plan.layout == 'coarse' and len(plan.partitions) == 6
    assert plan == prepare(grain_inputs())[0]
    assert not plan.graph.blockers
    assert {r.stage for r in plan.graph.resources if r.resource == 'engine:random'} == {'patch:salt-drums'}
    assert not any(c.reason == 'dynamic_table_domain' for c in plan.graph.colocations)
    assert owners(plan)['patch:salt-bass'] == owners(plan)['patch:fd2534f7-148b-4919-9586-bd7f9699eff7']
    assert all('exitnow' in p.csd for p in compilation.programs if 'patch:salt-theme' in p.stages)
    assert 'exitnow' not in compilation.canonical.csd
    result = compare_sequential(compilation, plan, frames=96000, events=grain_events())
    assert np.max(np.abs(result.canonical)) > .001
    np.testing.assert_array_equal(result.canonical, result.partitioned)
    np.testing.assert_array_equal(result.canonical_meters, result.partitioned_meters)


@pytest.mark.parametrize('frames', [32, 256, 1024])
def test_grain_persistent_workers_exact_pcm(monkeypatch, frames):
    monkeypatch.setenv('VISUALCSOUND_FORCE_MOCK_ENGINE', 'false')
    compiler = CompilerService(OpcodeService('/static/icons'))
    targets, graph, mixer = grain_inputs()
    canonical = compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph, mixer=mixer)
    selected = replace(RenderRelease(Settings()).options(parallel_batch_frames=frames), admission=options().admission)
    parallel, single = ParallelCsoundRenderer(options=selected), CsoundWorker()
    parallel.prepare(compiler, targets, graph, mixer, canonical)
    try:
        for worker in (single, parallel):
            worker.start(canonical.csd, 'internal:loopback', 'null')
            worker.configure_mixer(canonical.manifest, mixer_control_values(canonical.manifest, mixer))
            for sample, message in grain_events():
                worker.enqueue_timestamped_midi(message, source='grain-parity', target_engine_sample=sample)
        assert parallel.renderer_diagnostics['selected'] == 'parallel', parallel.renderer_diagnostics
        assert parallel.renderer_diagnostics['worker_count'] == 6
        processes = parallel._coordinator.process_ids
        controls = controller_bindings(targets[0], targets[0].assignment_id)
        def before(renderer):
            def apply(index, sample):
                if sample == 16000:
                    renderer.queue_control_channels({controls['gs_harmonics']['channel']: .37,
                                                     controls['gs_seed']['channel']: 777})
            return apply
        for _ in range(64):
            a = single.render_blocks(block_count=48, target_sample_rate=48000, before_block=before(single))
            b = parallel.render_blocks(block_count=48, target_sample_rate=48000, before_block=before(parallel))
            assert a.pcm_f32le == b.pcm_f32le
            assert parallel.render_sample_cursor == single.render_sample_cursor
            assert parallel._coordinator.process_ids == processes
    finally:
        single.stop()
        parallel.stop()
    assert not parallel._coordinator.process_ids and not selected.admission.leases


@pytest.mark.parametrize('change,code', [
    ('seed_zero', 'grain3_seed_unproven'), ('seed_unknown', 'grain3_seed_unproven'),
    ('size_dynamic', 'ftgenonce_ownership_unknown'), ('gen_random', 'ftgenonce_ownership_unknown'),
    ('numbered', 'ftgenonce_ownership_unknown'), ('handle_math', 'ftgenonce_ownership_unknown'),
    ('numeric_alias', 'private_table_alias_unknown'),
])
def test_unsafe_resource_variants_keep_single(change, code):
    targets, graph, mixer = grain_inputs()
    patch = targets[0].patch
    nodes = {n.id: n for n in patch.graph.nodes}
    formulas = patch.graph.ui_layout['input_formulas']
    if change.startswith('seed_'):
        formulas.pop('gs_grain_l::iseed')
        patch.graph.connections = [c for c in patch.graph.connections if (c.to_node_id, c.to_port_id) != ('gs_grain_l', 'iseed')]
        nodes['gs_grain_l'].params['iseed'] = 0 if change == 'seed_zero' else 'p4'
    elif change == 'size_dynamic':
        nodes['gs_wave'].params['isize'] = 'p4'
    elif change == 'gen_random':
        nodes['gs_wave'].params['igen'] = 21
    elif change == 'numbered':
        nodes['gs_wave'].params['ip1'] = 7
    elif change == 'handle_math':
        formulas['gs_grain_l::kfn']['expression'] = 'value + 1'
    elif change == 'numeric_alias':
        formulas.pop('gs_grain_l::kfn')
        patch.graph.connections = [c for c in patch.graph.connections if (c.to_node_id, c.to_port_id) != ('gs_grain_l', 'kfn')]
        nodes['gs_grain_l'].params['kfn'] = 101
    plan, _ = prepare((targets, graph, mixer))
    assert plan.layout == 'single'
    assert code in {d.code for d in plan.diagnostics}


def test_independent_granular_instances_can_have_distinct_owners_and_exact_audio():
    from backend.app.models.render_plan import RenderCostProfile, RenderStageCost
    from backend.app.models.render_protocol import RendererPolicy
    from backend.app.services.render_partition_plan import plan_render_partitions
    compiler = CompilerService(OpcodeService('/static/icons'))
    targets, graph, mixer = grain_inputs()
    dependency = compiler.analyze_realtime_graph(targets, graph)
    # Test ownership freedom explicitly, independent of the production node-count heuristic.
    costs = RenderCostProfile('test balanced branches, not performance evidence',
        tuple(RenderStageCost(s.id, 100 if s.kind == 'patch' else .01) for s in dependency.stages), 0, 0, 0)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='auto', max_workers=8), costs=costs)
    ownership = owners(plan)
    assert len({ownership['patch:salt-' + n] for n in ('bass', 'theme', 'clouds', 'clockwork', 'glass', 'dust', 'air')}) >= 6
    compilation = compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    result = compare_sequential(compilation, plan, frames=64000, events=grain_events())
    np.testing.assert_array_equal(result.canonical, result.partitioned)
    np.testing.assert_array_equal(result.canonical_meters, result.partitioned_meters)


def test_private_table_budget_exhaustion_fails_without_publishing(monkeypatch):
    from backend.app.engine.parallel_csound_renderer import PartitionRuntimeError
    monkeypatch.setenv('VISUALCSOUND_FORCE_MOCK_ENGINE', 'false')
    monkeypatch.setattr('backend.app.services.compiler_partitioned.TABLE_CACHE_ENTRIES', 1)
    compiler = CompilerService(OpcodeService('/static/icons'))
    targets, graph, mixer = grain_inputs()
    canonical = compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph, mixer=mixer)
    selected = replace(RenderRelease(Settings()).options(), admission=options().admission)
    parallel = ParallelCsoundRenderer(options=selected)
    parallel.prepare(compiler, targets, graph, mixer, canonical)
    try:
        parallel.start(canonical.csd, 'internal:loopback', 'null')
        for sample, message in grain_events():
            parallel.enqueue_timestamped_midi(message, source='budget', target_engine_sample=sample)
        with pytest.raises(PartitionRuntimeError):
            parallel.render_blocks(block_count=2048, target_sample_rate=48000)
        assert parallel.renderer_diagnostics['failed']
        assert parallel.renderer_diagnostics['published_sample'] == 0
    finally:
        parallel.stop()
    assert not parallel._coordinator.process_ids and not selected.admission.leases
