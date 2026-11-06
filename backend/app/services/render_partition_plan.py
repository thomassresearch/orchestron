"""Pure coarse branch/suffix planning. No native engine, OS probes or child processes."""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, fields, is_dataclass, replace
import hashlib
import json
import math

from backend.app.models.render_plan import (
    RenderBoundaryBus, RenderCoLocation, RenderCostProfile, RenderDependencyGraph, RenderPartition,
    RenderPartitionPlan, RenderPlanDiagnostic,
)
from backend.app.models.render_protocol import RendererPolicy
from backend.app.services.render_graph_order import reachable, strongly_connected_components, topological_order

# Conservative whole-plan ceiling, no larger than the frozen v1 per-message limit.
MAX_BOUNDARY_BUSES = 2048


def partition_plan_hash(plan: RenderPartitionPlan) -> str:
    payload = asdict(plan)
    payload.pop("plan_hash")
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _require_immutable(value):
    if is_dataclass(value):
        if not type(value).__dataclass_params__.frozen:
            raise ValueError("Planning records require immutable dataclasses.")
        for field in fields(value):
            _require_immutable(getattr(value, field.name))
    elif isinstance(value, tuple):
        for item in value:
            _require_immutable(item)
    elif not isinstance(value, (str, int, float, bool, type(None))):
        raise ValueError("Planning records require immutable dataclasses, tuples and scalar values.")


def _validate_graph(graph):
    _require_immutable(graph)
    if graph.source_kind not in {"explicit", "legacy"}:
        raise ValueError("Unknown graph source kind.")
    stages = [s.id for s in graph.stages]
    if not stages or len(set(stages)) != len(stages):
        raise ValueError("Stage identities must be nonempty and unique.")
    order = topological_order(stages, graph.dependencies)
    positions = {stage: i for i, stage in enumerate(stages)}
    if any(positions[a] >= positions[b] for a, b in graph.dependencies):
        raise ValueError("Stages must retain dependency order.")
    if len(set(graph.dependencies)) != len(graph.dependencies):
        raise ValueError("Duplicate dependency edge.")
    edges = set(graph.dependencies)
    for connection in graph.connections:
        if (connection.source, connection.target) not in edges or not connection.outlet or not connection.inlet:
            raise ValueError("Audio connection is missing its dependency or port.")
    for constraint in (*graph.colocations, *graph.helpers):
        if not constraint.stages or set(constraint.stages) - set(stages):
            raise ValueError("Resource/helper references unknown stages.")
    if len({h.id for h in graph.helpers}) != len(graph.helpers):
        raise ValueError("Duplicate helper identity.")
    if any(r.stage not in positions for r in graph.resources) or set(graph.downstream_stages) - set(stages):
        raise ValueError("Resource/downstream ownership references unknown stages.")
    if any(r.scope not in {"voice", "instance", "performance", "host", "unknown"}
           or r.access not in {"read", "write", "read_write", "subscribe"} for r in graph.resources):
        raise ValueError("Unknown resource scope or access declaration.")
    if (graph.engine.sample_rate < 1 or graph.engine.ksmps < 1 or graph.engine.channels < 1
            or not math.isfinite(graph.engine.zero_dbfs) or graph.engine.zero_dbfs <= 0):
        raise ValueError("Invalid full-performance engine settings.")
    return order


def _costs(graph, profile):
    if profile is None:
        return None
    _require_immutable(profile)
    values = {c.stage: c.microseconds for c in profile.stages}
    if len(values) != len(profile.stages) or set(values) != {s.id for s in graph.stages}:
        raise ValueError("Cost profile must cover every stage exactly once.")
    if not profile.provenance.strip():
        raise ValueError("Cost profile requires provenance.")
    for value in (*values.values(), profile.dispatch_microseconds, profile.copy_microseconds_per_sample):
        if not math.isfinite(value) or value < 0:
            raise ValueError("Cost estimates must be finite and nonnegative.")
    if not math.isfinite(sum(values.values())):
        raise ValueError("Total estimated cost must be finite.")
    if not math.isfinite(profile.minimum_reduction) or not 0 <= profile.minimum_reduction < 1:
        raise ValueError("Minimum estimated reduction must be in [0, 1).")
    return {s.id: values[s.id] for s in graph.stages}


def _ownership_constraints(graph):
    # Resource declarations themselves constrain ownership. A missing redundant
    # co-location record must never permit shared instance/performance state to split.
    yield from graph.colocations
    yield from graph.helpers
    users = {}
    for resource in graph.resources:
        if resource.scope in {"instance", "performance"}:
            users.setdefault(resource.resource, set()).add(resource.stage)
    for key, stages in sorted(users.items()):
        yield RenderCoLocation(tuple(sorted(stages)), "resource:" + key)


def _groups(graph):
    owners = {s.id: s.id for s in graph.stages}

    def merge(stages):
        roots = {owners[s] for s in stages}
        root = min(roots)
        for stage, owner in owners.items():
            if owner in roots:
                owners[stage] = root

    def quotient():
        return {(owners[a], owners[b]) for a, b in graph.dependencies if owners[a] != owners[b]}

    for constraint in _ownership_constraints(graph):
        merge(constraint.stages)
    closures = []
    for component in strongly_connected_components(set(owners.values()), quotient()):
        if len(component) > 1:
            members = tuple(sorted(s for s, owner in owners.items() if owner in component))
            merge(members)
            closures.append(RenderPlanDiagnostic("colocation_closure", "Absorbed intervening stages to keep co-location acyclic.", members))
    edges = quotient()
    order = topological_order(set(owners.values()), edges)
    members = {root: tuple(s.id for s in graph.stages if owners[s.id] == root) for root in order}
    return owners, members, edges, order, closures


def plan_render_partitions(
    graph: RenderDependencyGraph,
    *,
    policy: RendererPolicy | None = None,
    costs: RenderCostProfile | None = None,
    sample_bytes: int = 8,
) -> RenderPartitionPlan:
    """Return one complete immutable proposal; default policy stays single.

    Auto/parallel are diagnostic planning requests only. Every returned plan
    selects single and is ineligible for execution. sample_bytes is an explicit
    bus-memory estimate, never a native ABI probe or allocation permission.
    """
    policy = policy or RendererPolicy()
    _validate_graph(graph)
    if sample_bytes not in (4, 8):
        raise ValueError("Bus estimates require 4- or 8-byte native samples.")
    weights = _costs(graph, costs)
    if costs is not None:
        by_stage = {c.stage: c for c in costs.stages}
        costs = replace(costs, stages=tuple(by_stage[s.id] for s in graph.stages))
    diagnostics = list(graph.blockers)
    if not diagnostics and any(r.scope == "unknown" for r in graph.resources):
        diagnostics.append(RenderPlanDiagnostic("resource_scope_unclassified", "Unknown resource scope requires single rendering."))
    single = {s.id: "single" for s in graph.stages}

    def finish(owners, candidate_us=None):
        return _finish(graph, policy, costs, weights, sample_bytes, owners, diagnostics, candidate_us)

    if policy.mode == "single":
        diagnostics.append(RenderPlanDiagnostic("single_requested", "Single renderer requested."))
        return finish(single)
    if graph.source_kind == "legacy" and not any(d.code == "legacy_compile_path" for d in diagnostics):
        diagnostics.append(RenderPlanDiagnostic("legacy_compile_path", "Legacy compilation stays single."))
    if graph.engine.channels != 2:
        diagnostics.append(RenderPlanDiagnostic("engine_channels_unqualified", "Only stereo output is a planning candidate."))
    if diagnostics:
        return finish(single)
    if weights is None:
        diagnostics.append(RenderPlanDiagnostic("missing_cost_profile", "No full-stage cost evidence; automatic planning stays single."))
        return finish(single)
    if policy.max_workers < 3:
        diagnostics.append(RenderPlanDiagnostic("insufficient_capacity", "Two upstream workers plus the shared suffix require at least three slots."))
        return finish(single)

    owners, members, edges, order, closures = _groups(graph)
    diagnostics.extend(closures)
    predecessors, successors = {g: set() for g in order}, {g: set() for g in order}
    for source, target in edges:
        predecessors[target].add(source)
        successors[source].add(target)
    origins = {}
    for group in order:
        origins[group] = set().union(*(origins[p] for p in predecessors[group])) if predecessors[group] else {group}
    suffix_seeds = {g for g in order if len(origins[g]) > 1}
    suffix_seeds.update(owners[s] for s in graph.downstream_stages)
    # Disconnected/silent work remains present and is conservatively downstream.
    output_groups = {owners[s.id] for s in graph.stages if s.kind == "output"}
    suffix_seeds.update(set(order) - reachable(output_groups, predecessors))
    suffix = reachable(suffix_seeds, successors)
    branches = {}
    for group in order:
        if group not in suffix:
            root = next(iter(origins[group]))  # Non-joins have exactly one origin.
            branches.setdefault(root, []).extend(members[group])
    branch_costs = {root: sum(weights[s] for s in stages) for root, stages in branches.items()}
    useful = sum(value > 0 for value in branch_costs.values())
    if useful < 2:
        diagnostics.append(RenderPlanDiagnostic("insufficient_concurrency", "Fewer than two independent upstream domains with nonzero work remain."))
        return finish(single)
    bins = [0.0] * min(policy.max_workers - 1, useful)
    assignment = {stage: "downstream" for group in suffix for stage in members[group]}
    for branch in sorted(branches, key=lambda b: (-branch_costs[b], b)):
        index = min(range(len(bins)), key=lambda i: (bins[i], i))
        bins[index] += branch_costs[branch]
        assignment.update((stage, f"upstream-{index}") for stage in branches[branch])
    cuts = sum(assignment[c.source] != assignment[c.target] for c in graph.connections)
    byte_count = cuts * graph.engine.ksmps * sample_bytes * 2
    if cuts > MAX_BOUNDARY_BUSES or byte_count > policy.max_shared_memory_bytes:
        diagnostics.append(RenderPlanDiagnostic("boundary_budget_exceeded", f"Candidate needs {cuts} buses and {byte_count} shared audio bytes."))
        return finish(single)
    suffix_cost = sum(weights[stage] for stage, owner in assignment.items() if owner == "downstream")
    predicted = (max(bins) + suffix_cost + costs.dispatch_microseconds * (len(bins) + 1)
                 + costs.copy_microseconds_per_sample * cuts * graph.engine.ksmps)
    total = sum(weights.values())
    if predicted >= total or predicted > total * (1 - costs.minimum_reduction):
        diagnostics.append(RenderPlanDiagnostic("insufficient_estimated_benefit",
            f"Estimated candidate {predicted:.6g} us versus single {total:.6g} us per block."))
        return finish(single)
    diagnostics.append(RenderPlanDiagnostic("parallel_execution_unavailable", "Candidate ownership only; native lowering, qualification and admission remain pending."))
    return finish(assignment, predicted)


def _finish(graph, policy, costs, weights, sample_bytes, owners, diagnostics, predicted):
    edges = {(owners[a], owners[b]) for a, b in graph.dependencies if owners[a] != owners[b]}
    partitions = []
    for identity in topological_order(set(owners.values()), edges):
        stages = [s for s in graph.stages if owners[s.id] == identity]
        partitions.append(RenderPartition(identity, tuple(s.id for s in stages),
            tuple(h.id for h in graph.helpers if owners[h.stages[0]] == identity),
            tuple(sorted(a for a, b in edges if b == identity)), tuple(sorted(b for a, b in edges if a == identity)),
            tuple(sorted({c for s in stages for c in s.controls})), tuple(c for s in stages for c in s.meters)))
    buses, local = [], []
    for index, connection in enumerate(graph.connections):
        source, target = owners[connection.source], owners[connection.target]
        if source == target:
            local.append(index)
        else:
            # Separate ordered contributions; never pre-sum across a cut.
            buses.append(RenderBoundaryBus(f"bus:{index}", index, source, target, graph.engine.ksmps, sample_bytes))
    plan = RenderPartitionPlan(version=1, graph=graph, layout="coarse" if len(partitions) > 1 else "single",
        requested_mode=policy.mode, partitions=tuple(partitions), buses=tuple(buses), local_connections=tuple(local),
        diagnostics=tuple(diagnostics), cost_profile=costs, single_microseconds=sum(weights.values()) if weights else None,
        candidate_microseconds=predicted, shared_audio_bytes=sum(b.frames * b.sample_bytes * b.slots for b in buses),
        worker_limit=policy.max_workers, shared_audio_limit=policy.max_shared_memory_bytes,
        sample_bytes=sample_bytes, plan_hash="")
    plan = replace(plan, plan_hash=partition_plan_hash(plan))
    validate_partition_plan(plan)
    return plan


def validate_partition_plan(plan: RenderPartitionPlan) -> None:
    """Independent accounting/integrity gate, also usable by later compiler lowering."""
    graph = plan.graph
    _validate_graph(graph)
    weights = _costs(graph, plan.cost_profile)
    if plan.version != 1 or plan.requested_mode not in {"single", "auto", "parallel"}:
        raise ValueError("Unknown plan version or policy.")
    if plan.sample_bytes not in (4, 8):
        raise ValueError("Unsupported native sample estimate.")
    RendererPolicy(mode=plan.requested_mode, max_workers=plan.worker_limit,
                   max_shared_memory_bytes=plan.shared_audio_limit)
    if plan.single_microseconds != (sum(weights.values()) if weights is not None else None):
        raise ValueError("Single cost estimate mismatch.")
    if plan.selected_renderer != "single" or plan.execution_eligible is not False:
        raise ValueError("Planning cannot authorize parallel execution.")
    ids = [p.id for p in plan.partitions]
    if not ids or len(set(ids)) != len(ids) or len(ids) > plan.worker_limit:
        raise ValueError("Invalid partition count/identity.")
    expected_stages = [s.id for s in graph.stages]
    if Counter(s for p in plan.partitions for s in p.stages) != Counter(expected_stages):
        raise ValueError("Every stage must have exactly one owner.")
    owners = {s: p.id for p in plan.partitions for s in p.stages}
    for constraint in _ownership_constraints(graph):
        if len({owners[s] for s in constraint.stages}) != 1:
            raise ValueError("Co-location/helper ownership was split.")
    if Counter(h for p in plan.partitions for h in p.helpers) != Counter(h.id for h in graph.helpers):
        raise ValueError("Every helper must have exactly one owner.")
    edges = {(owners[a], owners[b]) for a, b in graph.dependencies if owners[a] != owners[b]}
    if tuple(ids) != topological_order(ids, edges):
        raise ValueError("Partitions must be in dependency order.")
    for partition in plan.partitions:
        stages = [s for s in graph.stages if owners[s.id] == partition.id]
        if not stages or partition.stages != tuple(s.id for s in stages):
            raise ValueError("Partition lost canonical stage order.")
        if (partition.helpers != tuple(h.id for h in graph.helpers if owners[h.stages[0]] == partition.id)
                or partition.predecessors != tuple(sorted(a for a, b in edges if b == partition.id))
                or partition.successors != tuple(sorted(b for a, b in edges if a == partition.id))):
            raise ValueError("Partition helper/dependency manifest mismatch.")
        if (partition.controls != tuple(sorted({c for s in stages for c in s.controls}))
                or partition.meters != tuple(c for s in stages for c in s.meters)
                or partition.midi_delivery != "ordered_broadcast"):
            raise ValueError("Control, meter or MIDI ownership mismatch.")
    if len({m for p in plan.partitions for m in p.meters}) != sum(len(p.meters) for p in plan.partitions):
        raise ValueError("A meter has multiple owners.")
    expected_cuts = [i for i, c in enumerate(graph.connections) if owners[c.source] != owners[c.target]]
    if (tuple(i for i in range(len(graph.connections)) if i not in set(expected_cuts)) != plan.local_connections
            or [b.connection_index for b in plan.buses] != expected_cuts):
        raise ValueError("Every ordered connection must be represented once as local or cut.")
    for bus in plan.buses:
        connection = graph.connections[bus.connection_index]
        if (bus.id != f"bus:{bus.connection_index}" or bus.producer != owners[connection.source]
                or bus.consumer != owners[connection.target] or bus.frames != graph.engine.ksmps
                or bus.sample_bytes != plan.sample_bytes or plan.sample_bytes not in (4, 8)
                or bus.channels != 1 or bus.slots != 2 or bus.source_semantics != "summed_outlet"):
            raise ValueError("Boundary bus format/ownership mismatch.")
    byte_count = sum(b.frames * b.sample_bytes * b.slots for b in plan.buses)
    if byte_count != plan.shared_audio_bytes or byte_count > plan.shared_audio_limit or len(plan.buses) > MAX_BOUNDARY_BUSES:
        raise ValueError("Shared audio budget mismatch.")
    if plan.layout == "single":
        if len(ids) != 1 or plan.buses or plan.candidate_microseconds is not None:
            raise ValueError("Single fallback must have one owner and no cut buses.")
    elif plan.layout == "coarse":
        if (len(ids) < 3 or ids[-1] != "downstream" or graph.blockers or graph.source_kind != "explicit"
                or plan.cost_profile is None or plan.candidate_microseconds is None
                or plan.requested_mode == "single" or graph.engine.channels != 2
                or any(r.scope == "unknown" for r in graph.resources)
                or any(b != "downstream" for _, b in edges)
                or any(owners[s] != "downstream" for s in graph.downstream_stages)):
            raise ValueError("Invalid branch-plus-shared-suffix candidate.")
        loads = {p.id: sum(weights[s] for s in p.stages) for p in plan.partitions}
        if sum(load > 0 for owner, load in loads.items() if owner != "downstream") < 2:
            raise ValueError("Candidate lacks useful upstream work.")
        predicted = (max(load for owner, load in loads.items() if owner != "downstream") + loads["downstream"]
                     + plan.cost_profile.dispatch_microseconds * len(ids)
                     + plan.cost_profile.copy_microseconds_per_sample * len(plan.buses) * graph.engine.ksmps)
        if (not math.isclose(predicted, plan.candidate_microseconds, rel_tol=1e-12, abs_tol=1e-9)
                or predicted >= plan.single_microseconds
                or predicted > plan.single_microseconds * (1 - plan.cost_profile.minimum_reduction)):
            raise ValueError("Candidate cost/benefit estimate mismatch.")
    else:
        raise ValueError("Unknown plan layout.")
    if plan.plan_hash != partition_plan_hash(plan):
        raise ValueError("Plan hash mismatch.")
