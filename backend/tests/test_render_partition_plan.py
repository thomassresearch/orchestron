from __future__ import annotations

from collections import Counter
import copy
from dataclasses import FrozenInstanceError, asdict, replace
import hashlib
import json
import random
import re

import pytest

from backend.app.models.audio import AudioRoute, MixerSend, MixerStrip
from backend.app.models.patch import NodeInstance
from backend.app.models.render_plan import RenderCoLocation, RenderConnection, RenderResourceAccess, RenderStage, RenderStageCost
from backend.app.models.render_protocol import RendererPolicy
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_mixer import ResolvedMixerGraph, token
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.render_partition_plan import (
    partition_plan_hash, plan_render_partitions, validate_partition_plan,
)
from backend.tests.render_plan_support import CASES, FIXTURE_DIR, FIXTURES, plan_snapshot, planner_inputs, synthetic_costs
from backend.tools._parallel_render_workload import build_workload, load_workloads


@pytest.fixture
def compiler():
    return CompilerService(OpcodeService("/static/icons"))


def analyze(compiler, case="four", ksmps=32):
    targets, graph, _ = planner_inputs(case, ksmps)
    return compiler.analyze_realtime_graph(targets, graph)


def candidate(graph, **kwargs):
    return plan_render_partitions(graph, policy=RendererPolicy(mode="auto", max_workers=4),
                                  costs=synthetic_costs(graph), **kwargs)


def ownership(plan):
    return {stage: p.id for p in plan.partitions for stage in p.stages}


@pytest.mark.parametrize("case", CASES)
@pytest.mark.parametrize("ksmps", [1, 32])
def test_deterministic_complete_plans_match_versioned_snapshots(compiler, case, ksmps):
    inputs = planner_inputs(case, ksmps)
    before = copy.deepcopy(inputs)
    graph = compiler.analyze_realtime_graph(inputs[0], inputs[1])
    plan = candidate(graph)
    repeated = candidate(compiler.analyze_realtime_graph(inputs[0], inputs[1]))
    assert plan == repeated and inputs == before
    assert plan.plan_hash == partition_plan_hash(plan)
    assert plan.selected_renderer == "single" and not plan.execution_eligible
    expected = json.loads((FIXTURE_DIR / "planner_snapshots.json").read_text())[f"{case}/k{ksmps}"]
    assert json.loads(json.dumps(plan_snapshot(plan))) == expected
    validate_partition_plan(plan)
    assert Counter(stage for p in plan.partitions for stage in p.stages) == Counter(s.id for s in graph.stages)
    assert sorted([*plan.local_connections, *(b.connection_index for b in plan.buses)]) == list(range(len(graph.connections)))
    if plan.layout == "coarse":
        assert 3 <= len(plan.partitions) <= 4
        assert all(bus.consumer == "downstream" for bus in plan.buses)
        assert plan.shared_audio_bytes == len(plan.buses) * ksmps * 8 * 2


@pytest.mark.parametrize("case", [c for c in CASES if c not in {"legacy", "asset"}])
def test_port_connections_references_and_meters_match_live_compiler(compiler, case):
    targets, audio_graph, mixer = planner_inputs(case)
    graph = compiler.analyze_realtime_graph(targets, audio_graph)
    resolved = ResolvedMixerGraph(targets, audio_graph)
    artifact = compiler.compile_patch_bundle(targets, "internal:loopback", "null", audio_graph=audio_graph, mixer=mixer)
    emitted = re.findall(r'^connect "([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)"$', artifact.orc, re.MULTILINE)
    assert emitted == [("vcs_mix_" + token(c.source), c.outlet, "vcs_mix_" + token(c.target), c.inlet)
                       for c in graph.connections]
    assert [s.id for s in graph.stages] == resolved.order
    assert set(resolved.edges) <= set(graph.dependencies)
    assert {m for s in graph.stages for m in s.meters} == {
        name for meters in artifact.manifest["meters"].values() for name in meters.values()}
    assert {c for s in graph.stages for c in s.controls} <= set(artifact.manifest["initialControls"])
    for stage in graph.stages:
        if stage.kind == "patch":
            assert stage.instrument_reference == artifact.manifest["instrumentReferences"][stage.instance_id]
            refs = artifact.manifest.get("noteInstrumentReferences", artifact.manifest["instrumentReferences"])
            assert stage.note_reference == refs[stage.instance_id]


def test_default_policy_and_missing_costs_keep_single(compiler):
    graph = analyze(compiler)
    default = plan_render_partitions(graph, costs=synthetic_costs(graph))
    assert default.layout == "single" and default.diagnostics[-1].code == "single_requested"
    missing = plan_render_partitions(graph, policy=RendererPolicy(mode="auto"))
    assert missing.layout == "single" and missing.diagnostics[-1].code == "missing_cost_profile"
    explicit = plan_render_partitions(graph, policy=RendererPolicy(mode="parallel"), costs=synthetic_costs(graph))
    assert explicit.layout == "coarse" and explicit.selected_renderer == "single" and not explicit.execution_eligible


def test_analysis_and_planning_never_construct_native_workers_or_processes(compiler, monkeypatch):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Pure analysis attempted native/process execution")

    monkeypatch.setattr("backend.app.engine.csound_worker.CsoundWorker.__init__", forbidden)
    monkeypatch.setattr("backend.app.engine.ctcsound_loader.load_ctcsound_module", forbidden)
    monkeypatch.setattr("multiprocessing.get_context", forbidden)
    monkeypatch.setattr("subprocess.Popen", forbidden)
    for case in CASES:
        candidate(analyze(compiler, case))


def test_shared_effect_and_direct_fork_have_one_downstream_owner(compiler):
    graph = analyze(compiler, "shared")
    plan = candidate(graph)
    owners = ownership(plan)
    assert owners["patch:shared"] == owners["patch:$master"] == owners["$output"] == "downstream"
    assert len({owners[f"patch:source{i}"] for i in range(4)}) == 3
    for i in range(4):
        assert owners[f"patch:source{i}"] == owners[f"patch:delay{i}"]
    # Last source has a dry Master bypass and shared/private wet paths, all retained.
    cut_targets = {graph.connections[b.connection_index].target for b in plan.buses}
    assert {"patch:shared", "patch:$master", "$output"} <= cut_targets


def test_insert_closure_keeps_dry_wet_and_master_insert_paths(compiler):
    graph = analyze(compiler, "bypass")
    plan = candidate(graph)
    owners = ownership(plan)
    for insert, owner in (("insert0", "source0"), ("masterInsert", "$master")):
        stages = ["patch:" + insert, "bypass:" + insert, "strip:" + insert, "patch:" + owner, "strip:" + owner]
        assert len({owners[s] for s in stages}) == 1
        assert any(c.target == "bypass:" + insert and c.inlet.startswith("dry_") for c in graph.connections)
        assert any(c.target == "bypass:" + insert and c.inlet.startswith("wet_") for c in graph.connections)
    assert owners["patch:masterInsert"] == "downstream"
    assert any(d.code == "colocation_closure" for d in plan.diagnostics)


def test_sidechain_is_a_join_and_custom_ports_keep_each_contribution(compiler):
    graph = analyze(compiler, "sidechain")
    plan = candidate(graph)
    assert ownership(plan)["patch:sidechain"] == "downstream"
    assert {graph.connections[b.connection_index].inlet for b in plan.buses
            if graph.connections[b.connection_index].target == "patch:sidechain"} == {"main", "side"}
    custom = analyze(compiler, "custom_ports")
    # The two outs nodes remain separate contributions to each source strip input.
    inputs = [c for c in custom.connections if c.source == "patch:source0" and c.target == "strip:source0"]
    assert max(Counter(c.inlet for c in inputs).values()) == 2
    assert {c.outlet for c in custom.connections if c.target in {"route:custom-a", "route:custom-b"}} == {"a", "b"}


def test_mute_zero_sends_and_bypass_do_not_change_plan_or_drop_dependencies(compiler):
    targets, graph, mixer = planner_inputs("bypass")
    before = candidate(compiler.analyze_realtime_graph(targets, graph))
    mixer.strips.update({"source0": MixerStrip(mute=True), "insert0": MixerStrip(bypass=True),
                         "$master": MixerStrip(gainDb=None, solo=True)})
    mixer.sends.update({route.id: MixerSend(gainDb=None, tap="pre") for route in graph.routes})
    # Even a fully silent mixer compiles the same live stages/connections.
    artifact = compiler.compile_patch_bundle(targets, "internal:loopback", "null", audio_graph=graph, mixer=mixer)
    after = candidate(compiler.analyze_realtime_graph(targets, graph))
    assert after == before
    assert set(artifact.manifest["edges"]) <= set(after.graph.dependencies)


def test_disconnected_work_is_preserved_in_suffix(compiler):
    plan = candidate(analyze(compiler, "disconnected"))
    assert ownership(plan)["patch:disconnected"] == ownership(plan)["strip:disconnected"] == "downstream"


def test_legato_helpers_allocation_and_midi_initialization_stay_with_consumers(compiler):
    graph = analyze(compiler, "legato")
    plan = candidate(graph)
    owners = ownership(plan)
    assert owners["patch:source0"] == owners["patch:source1"]
    expected = {"legato:panic", "legato:collector:source0", "legato:collector:source1",
                "maxalloc:source0:limit", "maxalloc:source1:limit"}
    assert {h.id for h in graph.helpers} == expected
    partition = next(p for p in plan.partitions if p.id == owners["patch:source0"])
    assert set(partition.helpers) == expected
    assert all(p.midi_delivery == "ordered_broadcast" for p in plan.partitions)
    initialized = candidate(analyze(compiler, "midi_initialization"))
    assert initialized.layout == "single"
    assert any(c.reason == "midi_controller_initialization" for c in initialized.graph.colocations)


def test_performance_controls_are_instance_scoped_host_subscriptions(compiler):
    targets, routes, mixer = planner_inputs("four")
    for target in (targets[0], targets[2]):
        target.patch.graph.nodes.append(NodeInstance(id="setting", opcode="perf_controller"))
        target.performance_controller_midi_ccs = {"setting": 5}
    graph = compiler.analyze_realtime_graph(targets, routes)
    plan = candidate(graph)
    assert plan.layout == "coarse"
    readers = [r for r in graph.resources if r.resource.startswith("channel:")]
    assert len(readers) == 2 and readers[0].resource != readers[1].resource
    assert all(r.scope == "host" and r.access == "read" for r in readers)
    assert ownership(plan)["patch:source0"] != ownership(plan)["patch:source1"]
    artifact = compiler.compile_patch_bundle(targets, "internal:loopback", "null", audio_graph=routes, mixer=mixer)
    for reader in readers:
        name = artifact.manifest["performanceControllers"][reader.stage[6:]]["setting"]["channel"]
        assert reader.resource == "channel:" + name
        assert [p.id for p in plan.partitions if name in p.controls] == [ownership(plan)[reader.stage]]


@pytest.mark.parametrize("case,code", [("unknown", "opcode_unclassified"), ("tables", "table_lifetime_unqualified"),
    ("dynamic_table", "table_access_unqualified"), ("asset", "asset_state_unqualified"), ("legacy", "legacy_compile_path")])
def test_unsafe_resources_have_reasoned_single_fallback(compiler, case, code):
    plan = candidate(analyze(compiler, case))
    assert plan.layout == "single" and not plan.buses
    assert code in {d.code for d in plan.diagnostics}
    if case == "tables":
        accesses = [r for r in plan.graph.resources if r.resource == "table:7"]
        assert {r.stage for r in accesses} == {"patch:source0", "patch:source1"}
        assert {r.access for r in accesses} == {"read", "read_write"}
    if case == "dynamic_table":
        assert any(r.resource == "tables:*" for r in plan.graph.resources)


def test_unknown_plugin_and_changed_audited_definition_cannot_inherit_eligibility(compiler):
    targets, graph, _ = planner_inputs("four")
    service = compiler._opcode_service
    service._opcodes["plugin"] = service.get_opcode("const_a").model_copy(update={"name": "plugin"})
    targets[0].patch.graph.nodes.append(NodeInstance(id="plugin", opcode="plugin"))
    assert "opcode_unclassified" in {d.code for d in candidate(compiler.analyze_realtime_graph(targets, graph)).diagnostics}
    targets[0].patch.graph.nodes.pop()
    service._opcodes["vco2"] = service.get_opcode("vco2").model_copy(update={"template": "changed compiler semantics"})
    changed = candidate(compiler.analyze_realtime_graph(targets, graph))
    assert changed.layout == "single" and "opcode_definition_changed" in {d.code for d in changed.diagnostics}


def test_pure_formulas_validate_and_assets_remain_canonical_compile_errors(compiler):
    targets, graph, _ = planner_inputs("four")
    targets[0].patch.graph.ui_layout["input_formulas"] = {"amp::iscal": {"expression": "sr / 48000 * 0.04"}}
    assert candidate(compiler.analyze_realtime_graph(targets, graph)).layout == "coarse"
    targets[0].patch.graph.ui_layout["input_formulas"]["amp::iscal"]["expression"] = "random(1)"
    with pytest.raises(CompilationError):
        compiler.analyze_realtime_graph(targets, graph)
    targets, graph, mixer = planner_inputs("asset")
    assert candidate(compiler.analyze_realtime_graph(targets, graph)).layout == "single"
    with pytest.raises(CompilationError):
        compiler.compile_patch_bundle(targets, "internal:loopback", "null", audio_graph=graph, mixer=mixer)


def test_real_feedback_and_missing_ports_are_errors_never_fallbacks(compiler):
    targets, graph, _ = planner_inputs("four")
    graph.routes.append(AudioRoute(id="feedback", sourceId="delay0", sourcePort="out", targetId="delay0", targetPort="in"))
    with pytest.raises(CompilationError) as failure:
        compiler.analyze_realtime_graph(targets, graph)
    assert failure.value.audio_diagnostics
    graph.routes[-1] = graph.routes[-1].model_copy(update={"target_port": "missing"})
    with pytest.raises(CompilationError):
        compiler.analyze_realtime_graph(targets, graph)


def test_nonadjacent_colocation_absorbs_intermediate_stages_without_cycles(compiler):
    graph = analyze(compiler)
    graph = replace(graph, colocations=(*graph.colocations,
        RenderCoLocation(("patch:source0", "patch:delay0"), "test_shared_state")))
    plan = candidate(graph)
    owners = ownership(plan)
    assert len({owners[s] for s in ("patch:source0", "strip:source0", "route:private0", "patch:delay0")}) == 1
    assert any(d.code == "colocation_closure" for d in plan.diagnostics)
    all_joined = replace(graph, colocations=(*graph.colocations,
        RenderCoLocation(tuple(["patch:$master", *(f"patch:source{i}" for i in range(4))]), "test_shared_state")))
    assert candidate(all_joined).layout == "single"


def test_resource_accesses_alone_enforce_shared_state_ownership(compiler):
    graph = analyze(compiler)
    graph = replace(graph, resources=(*graph.resources,
        RenderResourceAccess("shared-state", "patch:source0", "writer", "performance", "write"),
        RenderResourceAccess("shared-state", "patch:source1", "reader", "performance", "read")))
    plan = candidate(graph)
    assert plan.layout == "coarse"
    assert ownership(plan)["patch:source0"] == ownership(plan)["patch:source1"]
    original = candidate(analyze(compiler))
    # Neither a removed redundant constraint nor a refreshed digest blesses a split.
    broken = replace(original, graph=graph)
    with pytest.raises(ValueError, match="ownership was split"):
        validate_partition_plan(replace(broken, plan_hash=partition_plan_hash(broken)))


def test_unknown_resource_scope_cannot_be_enabled_by_omitting_diagnostics(compiler):
    graph = replace(analyze(compiler, "unknown"), blockers=())
    plan = candidate(graph)
    assert plan.layout == "single" and plan.diagnostics[-1].code == "resource_scope_unclassified"


def test_worker_and_audio_memory_budgets_include_suffix_and_two_slots(compiler):
    graph = analyze(compiler)
    for workers in (1, 2):
        plan = plan_render_partitions(graph, policy=RendererPolicy(mode="auto", max_workers=workers), costs=synthetic_costs(graph))
        assert plan.layout == "single" and plan.diagnostics[-1].code == "insufficient_capacity"
    plan = plan_render_partitions(graph, policy=RendererPolicy(mode="auto", max_shared_memory_bytes=1024), costs=synthetic_costs(graph))
    assert plan.layout == "single" and plan.diagnostics[-1].code == "boundary_budget_exceeded"
    assert candidate(graph, sample_bytes=4).shared_audio_bytes * 2 == candidate(graph).shared_audio_bytes


def test_dominant_suffix_and_expensive_dispatch_keep_single(compiler):
    graph = analyze(compiler)
    profile = synthetic_costs(graph)
    for expensive in (replace(profile, dispatch_microseconds=10000),
                      replace(profile, stages=tuple(replace(c, microseconds=10000) if c.stage == "patch:$master" else c for c in profile.stages))):
        plan = plan_render_partitions(graph, policy=RendererPolicy(mode="auto"), costs=expensive)
        assert plan.layout == "single" and plan.diagnostics[-1].code == "insufficient_estimated_benefit"


@pytest.mark.parametrize("bad", [-1, float("nan"), float("inf")])
def test_invalid_costs_are_not_used_as_estimates(compiler, bad):
    graph = analyze(compiler)
    profile = replace(synthetic_costs(graph), dispatch_microseconds=bad)
    with pytest.raises(ValueError, match="finite and nonnegative"):
        plan_render_partitions(graph, costs=profile)


def test_costs_require_exact_coverage_and_provenance(compiler):
    graph = analyze(compiler)
    profile = synthetic_costs(graph)
    for broken in (replace(profile, stages=profile.stages[1:]),
                   replace(profile, stages=(*profile.stages, profile.stages[0])), replace(profile, provenance="")):
        with pytest.raises(ValueError):
            plan_render_partitions(graph, costs=broken)
    for mutable in (replace(profile, stages=list(profile.stages)),):
        with pytest.raises(ValueError, match="immutable"):
            plan_render_partitions(graph, costs=mutable)
    with pytest.raises(ValueError, match="immutable"):
        plan_render_partitions(replace(graph, stages=list(graph.stages)))
    reversed_profile = replace(profile, stages=tuple(reversed(profile.stages)))
    policy = RendererPolicy(mode="auto", max_workers=4)
    assert plan_render_partitions(graph, policy=policy, costs=reversed_profile) == candidate(graph)


def test_snapshot_immutability_and_full_performance_engine_selection(compiler):
    targets, routes, _ = planner_inputs("four")
    targets[2].patch.graph.engine_config = targets[2].patch.graph.engine_config.model_copy(update={"sr": 44100, "ksmps": 1})
    graph = compiler.analyze_realtime_graph(targets, routes)
    plan = candidate(graph)
    assert graph.engine.sample_rate == 48000 and graph.engine.ksmps == 32
    before = asdict(plan)
    targets[0].patch.graph.nodes.clear()
    routes.routes.clear()
    assert asdict(plan) == before
    with pytest.raises(FrozenInstanceError):
        plan.layout = "single"
    assert all(bus.frames == 32 for bus in plan.buses)


def test_ordered_contributions_and_semantic_changes_affect_hash(compiler):
    targets, routes, _ = planner_inputs("bypass")
    original = candidate(compiler.analyze_realtime_graph(targets, routes))
    routes.insert_owners = dict(reversed(list(routes.insert_owners.items())))
    assert candidate(compiler.analyze_realtime_graph(targets, routes)) == original
    routes.routes.reverse()
    reordered = candidate(compiler.analyze_realtime_graph(targets, routes))
    assert reordered.plan_hash != original.plan_hash
    assert reordered.graph.connections != original.graph.connections


def test_validator_rejects_missing_duplicate_split_or_misrepresented_ownership(compiler):
    plan = candidate(analyze(compiler, "legato"))
    first, *rest = plan.partitions
    bad_plans = [
        replace(plan, partitions=(replace(first, stages=first.stages[1:]), *rest)),
        replace(plan, partitions=(replace(first, stages=(*first.stages, first.stages[0])), *rest)),
        replace(plan, partitions=(replace(first, helpers=()), *rest)),
        replace(plan, partitions=(replace(first, controls=()), *rest)),
        replace(plan, buses=plan.buses[1:]),
        replace(plan, buses=(replace(plan.buses[0], frames=1), *plan.buses[1:])),
        replace(plan, local_connections=tuple(reversed(plan.local_connections))),
        replace(plan, shared_audio_bytes=1),
        replace(plan, candidate_microseconds=1),
        replace(plan, single_microseconds=1),
        replace(plan, requested_mode="single"),
        replace(plan, execution_eligible=True),
    ]
    for broken in bad_plans:
        # A new digest cannot bless a structurally invalid plan.
        broken = replace(broken, plan_hash=partition_plan_hash(broken))
        with pytest.raises(ValueError):
            validate_partition_plan(broken)
    with pytest.raises(ValueError, match="hash"):
        validate_partition_plan(replace(plan, plan_hash="0" * 64))


@pytest.mark.parametrize("seed", FIXTURES["dag_seeds"])
def test_generated_dags_and_colocation_closures_preserve_accounting(compiler, seed):
    rng = random.Random(seed)
    base = analyze(compiler)
    names = [f"node:{i:02d}" for i in range(12)] + ["output"]
    edges = {(a, b) for i, a in enumerate(names[:-1]) for b in names[i + 1:] if rng.random() < .2}
    edges.add((names[-2], "output"))
    constraints = tuple(RenderCoLocation(tuple(sorted(rng.sample(names[:-1], 2))), "generated") for _ in range(2))
    graph = replace(base, stages=tuple(RenderStage(n, "output" if n == "output" else "patch") for n in names),
        dependencies=tuple(sorted(edges)), connections=tuple(RenderConnection(a, "out", b, "in") for a, b in sorted(edges)),
        colocations=constraints, helpers=(), resources=(), blockers=(), downstream_stages=("output",))
    profile = replace(synthetic_costs(graph), stages=tuple(RenderStageCost(n, 1 if n == "output" else 100) for n in names))
    plan = plan_render_partitions(graph, policy=RendererPolicy(mode="auto", max_workers=4), costs=profile)
    assert plan == plan_render_partitions(copy.deepcopy(graph), policy=RendererPolicy(mode="auto", max_workers=4), costs=profile)
    validate_partition_plan(plan)


@pytest.mark.parametrize("ksmps", [1, 32])
def test_shared_fixture_builder_preserves_t01_canonical_csd_hashes(ksmps, monkeypatch):
    baseline = json.loads((FIXTURE_DIR.parents[3] / "specifications/parallel-csound-rendering/measurements/t01-single-native.json").read_text())
    from types import SimpleNamespace
    # T01 recorded macOS wrapper options; compare that convention on every test host.
    assert baseline['provenance']['platform'].startswith('macOS-')
    monkeypatch.setattr('backend.app.services.compiler_service.sys', SimpleNamespace(platform='darwin'))
    for case in load_workloads().values():
        artifact, _ = build_workload(case, ksmps)
        assert hashlib.sha256(artifact.csd.encode()).hexdigest() == baseline["cases"][f"{case.id}/k{ksmps}"]["reference"]["csd_hash"]
