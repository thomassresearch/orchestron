"""T04 internal realtime programs: structure, non-activation and native parity."""
from __future__ import annotations

from dataclasses import replace
import hashlib
import json

import numpy as np
import pytest

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.render_protocol import RendererPolicy
from backend.app.services.compiler_common import CompilationError, CompilationProfile
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.render_partition_plan import plan_render_partitions
from backend.tests.render_plan_support import FIXTURE_DIR, planner_inputs, synthetic_costs
from backend.tools._sequential_partition_probe import compare_sequential


@pytest.fixture
def compiler():
    return CompilerService(OpcodeService('/static/icons'))


@pytest.fixture(scope='module')
def native_module():
    try:
        return load_ctcsound_module()
    except RuntimeError as exc:
        pytest.skip(f'Native Csound unavailable: {exc}')


def prepare(compiler, case='two', ksmps=32):
    targets, graph, mixer = planner_inputs(case, ksmps)
    dependency = compiler.analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='parallel', max_workers=4),
                                 costs=synthetic_costs(dependency))
    return targets, graph, mixer, plan, compiler.compile_realtime_partitions(targets, graph, mixer, plan)


SCRIPT = json.loads((FIXTURE_DIR / 'partition_parity.json').read_text())
CANONICAL_SOURCE = json.loads((FIXTURE_DIR / 't04_canonical_csd_hashes.json').read_text())
CANONICAL = CANONICAL_SOURCE['sha256']


def events_for(targets):
    return sorted([(sample, [status + target.midi_channel - 1, first, second])
                   for target in targets if target.midi_channel
                   for sample, status, first, second in SCRIPT['source_events']], key=lambda event: event[0])


@pytest.mark.parametrize('ksmps', [1, 32])
@pytest.mark.parametrize('case', ['two', 'four', 'eight', 'shared', 'bypass', 'sidechain', 'custom_ports', 'disconnected', 'legato', 'tables'])
def test_native_partition_audio_and_meter_parity(compiler, native_module, case, ksmps):
    targets, _, _, plan, compilation = prepare(compiler, case, ksmps)
    assert compilation.programs
    result = compare_sequential(compilation, plan, frames=SCRIPT["frames"], events=events_for(targets), module=native_module)
    assert np.max(np.abs(result.canonical)) > .0001
    # Frozen before measurements: unchanged summation order requires exact samples.
    np.testing.assert_array_equal(result.partitioned, result.canonical)
    np.testing.assert_array_equal(result.partitioned_meters, result.canonical_meters)
    assert result.event_blocks[0][0] == 0
    assert result.event_blocks[1][0] == (511 // ksmps) * ksmps


@pytest.mark.parametrize('case', ['two', 'shared', 'bypass', 'custom_ports', 'legato'])
def test_partition_artifacts_are_deterministic_and_owned(compiler, case):
    targets, graph, mixer, plan, result = prepare(compiler, case)
    assert result == compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    assert result.selected_renderer == 'single' and result.execution_eligible is False
    assert sum(p.owns_output for p in result.programs) == 1
    assert sorted(s for p in result.programs for s in p.stages) == sorted(s.id for s in plan.graph.stages)
    assert sorted(b for p in result.programs for b, _ in p.inputs) == sorted(b.id for b in plan.buses)
    assert sorted(b for p in result.programs for b, _ in p.outputs) == sorted(b.id for b in plan.buses)
    for program, partition in zip(result.programs, plan.partitions, strict=True):
        assert program.controls == partition.controls
        assert program.meters == partition.meters
        assert list(dict(program.instrument_references)) == list(program.stages)
    assert result.canonical == compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph, mixer=mixer)


@pytest.mark.parametrize('case', ['tiny', 'serial', 'unsupported', 'dynamic_table', 'legacy', 'midi_initialization'])
def test_single_plans_keep_canonical_artifact_without_partition_programs(compiler, case):
    *_, compilation = prepare(compiler, case)
    assert not compilation.programs
    assert compilation.fallback_reasons
    assert compilation.selected_renderer == 'single'


def test_stale_plan_and_invalid_assets_are_not_fallback_success(compiler):
    targets, graph, mixer, plan, _ = prepare(compiler)
    targets[0].patch.graph.nodes[0].params['unused'] = 2
    with pytest.raises(CompilationError, match='Patch compilation failed'):
        compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    targets, graph, mixer = planner_inputs('asset')
    with pytest.raises(CompilationError):
        compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    with pytest.raises(ValueError):
        compiler.compile_realtime_partitions(*planner_inputs('two'), replace(plan, plan_hash='wrong'))


@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_partition_lowering_does_not_change_offline_compilation(compiler, mode):
    targets, graph, mixer = planner_inputs('bypass')
    before = compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph, mixer=mixer,
                                           profile=CompilationProfile.OFFLINE, performance_input_mode=mode)
    prepare(compiler, 'bypass')
    after = compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph, mixer=mixer,
                                          profile=CompilationProfile.OFFLINE, performance_input_mode=mode)
    assert after == before
    assert '__vcs_partition_' not in after.csd


@pytest.mark.parametrize('key', CANONICAL)
def test_canonical_csd_bytes_match_pre_t04_compiler(compiler, key, monkeypatch):
    from types import SimpleNamespace
    # Freeze the recorded wrapper option convention, not the test host's MIDI backend.
    monkeypatch.setattr('backend.app.services.compiler_service.sys',
                        SimpleNamespace(platform=CANONICAL_SOURCE['runtime_platform']))
    case, ksmps, profile, mode = key.split('/')
    targets, graph, mixer = planner_inputs(case, int(ksmps))
    result = compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph, mixer=mixer,
        profile=CompilationProfile(profile), performance_input_mode=mode)
    assert hashlib.sha256(result.csd.encode()).hexdigest() == CANONICAL[key]


@pytest.mark.parametrize('ksmps', [1, 32])
@pytest.mark.parametrize('case', ['bypass', 'sidechain', 'custom_ports'])
def test_live_mixer_and_bypass_controls_preserve_audio_and_meter_state(compiler, native_module, case, ksmps):
    from backend.app.models.audio import MixerSend, MixerStrip
    from backend.app.services.compiler_mixer import mixer_control_values
    targets, _, mixer, plan, compilation = prepare(compiler, case, ksmps)
    writes = []
    actions = [(sample, 'strip', identity, field, value) for sample, identity, field, value in SCRIPT['mixer_changes']]
    actions += [(sample, 'send', identity, field, value) for sample, identity, field, value in SCRIPT['send_changes']]
    if case == 'bypass':
        actions += [(sample, 'strip', identity, 'bypass', value) for sample, identity, value in SCRIPT['bypass_changes']]
    for sample, kind, identity, field, value in sorted(actions, key=lambda a: a[0]):
        mapping, default = (mixer.strips, MixerStrip()) if kind == 'strip' else (mixer.sends, MixerSend())
        mapping[identity] = mapping.get(identity, default).model_copy(update={field: value})
        writes.extend((sample, name, value) for name, value in mixer_control_values(compilation.canonical.manifest, mixer).items())
    result = compare_sequential(compilation, plan, frames=SCRIPT['frames'], events=events_for(targets), controls=writes,
                                module=native_module)
    np.testing.assert_array_equal(result.partitioned, result.canonical)
    np.testing.assert_array_equal(result.partitioned_meters, result.canonical_meters)


@pytest.mark.parametrize('ksmps', [1, 32])
def test_native_instance_controls_and_cross_channel_midi_readers(compiler, native_module, ksmps):
    from backend.app.models.patch import NodeInstance
    from backend.tools._parallel_render_workload import connection
    targets, graph, mixer = planner_inputs('two', ksmps)
    for target in targets:
        if not target.midi_channel:
            continue
        patch = target.patch.graph
        patch.nodes += [NodeInstance(id='setting', opcode='perf_controller', params={'min': 0, 'max': 1, 'default': .04}),
                        NodeInstance(id='cc', opcode='ctrl7', params={'ichan': 8, 'ictlno': 74, 'kmin': 300, 'kmax': 3000})]
        patch.connections = [c for c in patch.connections if not (c.to_node_id == 'osc' and c.to_port_id == 'kamp')]
        patch.connections += [connection('setting', 'iout', 'osc', 'kamp'), connection('cc', 'kout', 'filter0', 'kcf')]
        target.performance_controller_values = {'setting': .02 * target.midi_channel}
        target.performance_controller_midi_ccs = {'setting': 5}
    dependency = compiler.analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='parallel', max_workers=4), costs=synthetic_costs(dependency))
    compilation = compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    channel = compilation.canonical.manifest['performanceControllers']['source0']['setting']['channel']
    # Host maps CC -> instance channel once; each instance only consumes its writes.
    events = sorted(events_for(targets) + [(256, [0xb7, 74, 20]), (768, [0xb7, 74, 110])], key=lambda e: e[0])
    result = compare_sequential(compilation, plan, frames=SCRIPT['frames'], events=events,
                               controls=[(512, channel, .1)], module=native_module)
    np.testing.assert_array_equal(result.partitioned, result.canonical)
    np.testing.assert_array_equal(result.partitioned_meters, result.canonical_meters)
    assert sum(channel in p.controls for p in compilation.programs) == 1


@pytest.mark.parametrize('ksmps', [1, 32])
def test_legato_helpers_allocation_and_same_boundary_panic_retrigger(compiler, native_module, ksmps):
    targets, graph, mixer = planner_inputs('legato', ksmps)
    from backend.tools._parallel_render_workload import connection
    for target in targets:
        if target.assignment_id not in {'source0', 'source1'}:
            continue
        patch = target.patch.graph
        next(n for n in patch.nodes if n.id == 'limit').params['icount'] = 1
        next(n for n in patch.nodes if n.id == 'envelope').params['irel'] = .02
        # Exercise the actual phrase gate and release, not a detached envelope.
        patch.connections = [c for c in patch.connections if not (c.to_node_id == 'osc' and c.to_port_id == 'kamp')]
        patch.connections.append(connection('envelope', 'kenv', 'osc', 'kamp'))
    dependency = compiler.analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='parallel', max_workers=4), costs=synthetic_costs(dependency))
    compilation = compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    events = events_for(targets) + [(sample, [status, first, second]) for sample, status, first, second in SCRIPT['panic_retrigger']]
    result = compare_sequential(compilation, plan, frames=SCRIPT['frames'], events=sorted(events, key=lambda e: e[0]), module=native_module)
    np.testing.assert_array_equal(result.partitioned, result.canonical)
    np.testing.assert_array_equal(result.partitioned_meters, result.canonical_meters)
    assert sum('; legato note-event collector' in p.csd for p in compilation.programs) == 1
    assert sum('VCS_LEGATO_MIDI:' in p.csd for p in compilation.programs) == 1


def test_full_performance_engine_settings_retained(compiler, native_module):
    targets, graph, mixer = planner_inputs('two')
    targets[0].patch.graph.engine_config.sr = 44100
    targets[0].patch.graph.engine_config.zero_dbfs = 2
    dependency = compiler.analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='parallel', max_workers=4), costs=synthetic_costs(dependency))
    compilation = compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    result = compare_sequential(compilation, plan, frames=SCRIPT['frames'], events=events_for(targets), module=native_module)
    np.testing.assert_array_equal(result.partitioned, result.canonical)
    assert all('sr = 44100' in p.csd and '0dbfs = 2' in p.csd for p in compilation.programs)


def test_partition_compilation_does_not_load_native_or_start_processes(compiler, monkeypatch):
    def unexpected(*_args, **_kwargs):
        pytest.fail('Partition compilation must remain text-only')

    monkeypatch.setattr('backend.app.engine.ctcsound_loader.load_ctcsound_module', unexpected)
    monkeypatch.setattr('multiprocessing.Process.start', unexpected)
    monkeypatch.setattr('subprocess.Popen', unexpected)
    assert prepare(compiler)[-1].programs


@pytest.mark.parametrize('case', ['two', 'legato'])
def test_local_instrument_references_match_native_assignment(compiler, native_module, case):
    from backend.app.services.compiler_mixer import token
    from backend.tools._sequential_partition_probe import NativeProbe
    *_, plan, compilation = prepare(compiler, case)
    for program in compilation.programs:
        # Add diagnostic channels to the test copy; emitted programs are unchanged.
        probes = '\n'.join(f'chnset nstrnum("vcs_mix_{token(stage)}"), "__probe_{index}"'
                           for index, (stage, _) in enumerate(program.instrument_references))
        csd = program.csd.replace('</CsInstruments>', probes + '\n</CsInstruments>')
        native = NativeProbe(native_module, csd, plan.graph.engine, plan.sample_bytes)
        try:
            for index, (_, reference) in enumerate(program.instrument_references):
                assert native.cs.controlChannel(f'__probe_{index}')[0] == int(reference)
        finally:
            native.close()


def test_probe_native_abi_mismatch_cleans_partial_start(compiler):
    from types import SimpleNamespace
    from unittest.mock import Mock
    from backend.tools._sequential_partition_probe import NativeProbe
    *_, plan, compilation = prepare(compiler)
    native = Mock()
    native.sizeOfMYFLT.return_value = 4
    module = SimpleNamespace(Csound=lambda: native)
    with pytest.raises(RuntimeError, match='ABI mismatch'):
        NativeProbe(module, compilation.programs[0].csd, plan.graph.engine, plan.sample_bytes)
    native.compileCsdText.assert_not_called()
    native.stop.assert_called_once()
    native.cleanup.assert_called_once()
    native.reset.assert_called_once()


def test_probe_partial_partition_start_cleans_all_instances(compiler, native_module, monkeypatch):
    from backend.tools import _sequential_partition_probe as probe
    *_, plan, compilation = prepare(compiler)
    real, started = probe.NativeProbe, []

    def fail_third(*args):
        if len(started) == 2:
            raise RuntimeError('injected native start failure')
        instance = real(*args)
        started.append(instance)
        return instance

    monkeypatch.setattr(probe, 'NativeProbe', fail_third)
    with pytest.raises(RuntimeError, match='injected'):
        probe.compare_sequential(compilation, plan, frames=32, module=native_module)
    assert len(started) == 2 and all(instance.cs is None for instance in started)


@pytest.mark.parametrize('ksmps', [1, 32])
def test_silence_polyphonic_allocation_and_shared_nonlinear_state(compiler, native_module, ksmps):
    from backend.app.models.patch import NodeInstance
    from backend.tools._parallel_render_workload import connection
    targets, graph, mixer = planner_inputs('shared', ksmps)
    targets[0].patch.graph.nodes.append(NodeInstance(id='limit', opcode='maxalloc', params={'icount': 2}))
    shared = next(t.patch.graph for t in targets if t.assignment_id == 'shared')
    shared.nodes.append(NodeInstance(id='filter', opcode='moogladder', params={'kcf': 1200, 'kres': .5}))
    # Put the nonlinear processor before the shared delay, after the upstream sum.
    incoming = next(c for c in shared.connections if c.to_node_id == 'delay')
    shared.connections.remove(incoming)
    shared.connections += [connection(incoming.from_node_id, incoming.from_port_id, 'filter', 'ain'),
                           connection('filter', 'aout', 'delay', 'asig')]
    dependency = compiler.analyze_realtime_graph(targets, graph)
    plan = plan_render_partitions(dependency, policy=RendererPolicy(mode='parallel', max_workers=4), costs=synthetic_costs(dependency))
    compilation = compiler.compile_realtime_partitions(targets, graph, mixer, plan)
    # Start silent, finish after voices and ordinary delay buffers have drained.
    events = [(sample + 512, event) for sample, event in events_for(targets)]
    result = compare_sequential(compilation, plan, frames=SCRIPT['frames'], events=events, module=native_module)
    np.testing.assert_array_equal(result.partitioned, result.canonical)
    np.testing.assert_array_equal(result.partitioned_meters, result.canonical_meters)
    assert not np.any(result.partitioned[:512 * 2])
    assert np.max(np.abs(result.partitioned[-512 * 2:])) < 1e-15


@pytest.mark.parametrize('change', ['csd', 'control', 'owner', 'missing', 'plan'])
def test_corrupt_artifacts_are_rejected_before_native_start(compiler, monkeypatch, change):
    *_, plan, compilation = prepare(compiler)
    first = compilation.programs[0]
    if change == 'csd':
        first = replace(first, csd=first.csd + '\n; changed')
    elif change == 'control':
        first = replace(first, controls=())
    elif change == 'owner':
        first = replace(first, owns_output=True)
    programs = (first, *compilation.programs[1:]) if change != 'missing' else compilation.programs[1:]
    compilation = replace(compilation, programs=programs, plan_hash='wrong' if change == 'plan' else compilation.plan_hash)

    def unexpected(*_args, **_kwargs):
        pytest.fail('Invalid artifacts must not reach native startup')

    monkeypatch.setattr('backend.tools._sequential_partition_probe.NativeProbe', unexpected)
    with pytest.raises(ValueError, match='integrity'):
        compare_sequential(compilation, plan, frames=32)


@pytest.mark.parametrize('case', ['tiny', 'two'])
def test_unspecified_mixer_uses_canonical_defaults(compiler, case):
    targets, graph, _, plan, _ = prepare(compiler, case)
    compilation = compiler.compile_realtime_partitions(targets, graph, None, plan)
    expected = compiler.compile_patch_bundle(targets, 'internal:loopback', 'null', audio_graph=graph)
    assert compilation.canonical == expected


def test_matching_nonfinite_audio_is_not_parity(compiler, native_module, monkeypatch):
    from backend.tools import _sequential_partition_probe as probe
    *_, plan, compilation = prepare(compiler)
    perform = probe.NativeProbe.perform

    def corrupt(instance, midi, controls):
        perform(instance, midi, controls)
        instance.cs.spout()[0] = np.nan

    monkeypatch.setattr(probe.NativeProbe, 'perform', corrupt)
    with pytest.raises(RuntimeError, match='nonfinite'):
        probe.compare_sequential(compilation, plan, frames=32, module=native_module)
