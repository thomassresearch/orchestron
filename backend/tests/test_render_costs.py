"""Structural per-note costs honor mutually exclusive DSP without hiding resources."""
from dataclasses import replace
from types import SimpleNamespace

import pytest

from backend.app.models.render_plan import RenderResourceAccess
from backend.app.models.render_protocol import RendererPolicy
from backend.app.services.compiler_render_costs import estimate_patch_work
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.render_partition_plan import plan_render_partitions
from backend.tests.grain_render_support import grain_inputs
from backend.tests.render_plan_support import synthetic_costs


def resource(node, scope='voice'):
    return RenderResourceAccess('voice:' + node, 'patch:test', node, scope, 'read_write')


def block(*cases):
    return SimpleNamespace(cases=[SimpleNamespace(node_ids=nodes) for nodes in cases])


def test_common_dsp_plus_heaviest_case_for_every_independent_block():
    graph = SimpleNamespace(control_flow={
        'switch': block(['kick', 'kick_env'], ['snare', 'noise', 'snare_env'], ['silent_result']),
        'if': block(['filter'], ['chorus', 'delay']),
    })
    dsp = ['gain', 'pan', 'kick', 'kick_env', 'snare', 'noise', 'snare_env', 'filter', 'chorus', 'delay']
    resources = [resource(node) for node in dsp] + [resource('noise', 'performance')]
    assert estimate_patch_work(graph, resources) == 1 + 2 + 3 + 2
    assert estimate_patch_work(graph, list(reversed(resources))) == 8
    graph.control_flow = {}
    assert estimate_patch_work(graph, resources) == 1 + len(dsp)


def grain_graph():
    targets, audio, _ = grain_inputs()
    compiler = CompilerService(OpcodeService('/static/icons'))
    return targets, compiler.analyze_realtime_graph(targets, audio)


def test_real_drumkit_branch_cost_retains_all_resource_ownership():
    targets, graph = grain_graph()
    kit = next(t.patch.graph for t in targets if t.assignment_id == 'salt-drums')
    assert len(kit.control_flow['kit'].cases) == 18
    stage = next(s for s in graph.stages if s.id == 'patch:salt-drums')
    accesses = [r for r in graph.resources if r.stage == stage.id]
    assert 1 + sum(r.scope == 'voice' for r in accesses) == 244
    assert stage.estimated_work == 30
    # Mutually exclusive random users remain present for ownership and safety.
    assert {'bass_drum_click', 'snare_wires', 'hihat_open_air'} <= {
        r.node for r in accesses if r.resource == 'engine:random'}
    assert any(r.node == 'snare_wires' and r.scope == 'voice' for r in accesses)
    assert all(s.estimated_work == 18 for s in graph.stages if s.id in {'patch:salt-air', 'patch:salt-theme'})
    plan = plan_render_partitions(graph, policy=RendererPolicy(mode='auto'))
    assert len(plan.partitions) == 6
    ownership = {s: p.id for p in plan.partitions for s in p.stages}
    assert len({ownership['patch:salt-' + n] for n in ('bass', 'theme', 'clouds', 'clockwork', 'glass', 'dust', 'air')}) == 4
    assert plan == plan_render_partitions(graph, policy=RendererPolicy(mode='auto'))
    assert plan_render_partitions(graph).layout == 'single'


@pytest.mark.parametrize('value', [0, -1, True, 1.5, float('nan'), float('inf')])
def test_untrusted_work_estimates_are_rejected(value):
    _, graph = grain_graph()
    graph = replace(graph, stages=(replace(graph.stages[0], estimated_work=value), *graph.stages[1:]))
    with pytest.raises(ValueError, match='work estimate'):
        plan_render_partitions(graph, policy=RendererPolicy(mode='auto'))


def test_supplied_cost_profile_takes_precedence_over_structural_estimates():
    _, graph = grain_graph()
    costs = synthetic_costs(graph)
    policy = RendererPolicy(mode='auto', max_workers=4)
    original = plan_render_partitions(graph, policy=policy, costs=costs)
    exaggerated = replace(graph, stages=tuple(replace(s, estimated_work=100000) for s in graph.stages))
    revised = plan_render_partitions(exaggerated, policy=policy, costs=costs)
    assert original.partitions == revised.partitions
    assert original.single_microseconds == revised.single_microseconds
    assert original.candidate_microseconds == revised.candidate_microseconds
