"""Read-only snapshot of LIVE compiler structure for the pure partition planner.

It does not compile native Csound or replace canonical compilation/asset validation.
Port metadata uses the same structured connection lowering as CSD emission.
"""
from __future__ import annotations

from dataclasses import asdict

from backend.app.models.render_plan import (
    RenderCoLocation, RenderConnection, RenderDependencyGraph, RenderEngineSettings,
    RenderPlanDiagnostic, RenderStage,
)
from backend.app.services.audio_routing_service import resolve_audio_routes
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_graph import resolve_shared_engine, validate_target_channels
from backend.app.services.compiler_mixer import OUTPUT, ResolvedMixerGraph, channel
from backend.app.services.compiler_render_resources import CAPABILITY_VERSION, analyze_render_resources, stable_hash
from backend.app.services.compiler_stage_lowering import live_audio_connections
from backend.app.services.render_graph_order import topological_order


def analyze_render_graph(targets, audio_graph, opcode_service) -> RenderDependencyGraph:
    if not targets:
        raise CompilationError(["At least one patch must be provided for render analysis."])
    validate_target_channels(targets)
    identities = [t.assignment_id or f"instrument-{i}" for i, t in enumerate(targets, 1)]
    if len(set(identities)) != len(identities):
        raise CompilationError(["Render analysis requires unique instance IDs."])
    # Preserve the full performance's first-target engine rule BEFORE any sorting.
    config = resolve_shared_engine(targets)
    engine = RenderEngineSettings(config.sr, config.ksmps, config.nchnls, config.zero_dbfs,
                                  config.software_buffer, config.hardware_buffer)
    resolved = ResolvedMixerGraph(targets, audio_graph) if audio_graph is not None else None
    resources = analyze_render_resources(targets, opcode_service)
    legato = {h.stages[0]: h.instrument_reference for h in resources.helpers if h.id.startswith("legato:collector:")}
    offset = len(legato) + bool(legato)
    colocations, blockers = list(resources.colocations), list(resources.blockers)
    stages, downstream = [], []

    def patch_controls(stage):
        return tuple(sorted(r.resource.removeprefix("channel:") for r in resources.accesses
                            if r.stage == stage and r.resource.startswith("channel:")))

    if resolved is None:
        blockers.append(RenderPlanDiagnostic("legacy_compile_path", "No explicit mixer graph; retain canonical legacy compilation."))
        connections = tuple(RenderConnection("patch:" + r.source_assignment_id, r.source_port_name,
                            "patch:" + r.target_assignment_id, r.target_port_name) for r in resolve_audio_routes(targets))
        dependencies = tuple(sorted({(c.source, c.target) for c in connections}))
        by_stage = {}
        for index, (identity, target) in enumerate(zip(identities, targets, strict=True), 1):
            stage = "patch:" + identity
            reference = str(index + offset)
            by_stage[stage] = RenderStage(stage, "patch", identity, reference, legato.get(stage, reference),
                                         target.midi_channel, target.always_on, patch_controls(stage))
        stages = [by_stage[s] for s in topological_order(by_stage, dependencies)]
    else:
        connections = live_audio_connections(resolved)
        dependencies = tuple(sorted(set(resolved.edges) | {(c.source, c.target) for c in connections}))
        # Supplementing dry bypass edges must not reorder the canonical compiler.
        order = topological_order(resolved.order, dependencies)
        if order != tuple(resolved.order):
            raise ValueError("Live connection metadata disagrees with compiler stage order.")
        routes = {r.id: r for r in resolved.routes}
        for index, stage in enumerate(order, 1):
            kind, _, identity = stage.partition(":")
            controls, meters = [], []
            target = resolved.by_id.get(identity) if kind in {"patch", "strip", "bypass"} else None
            if kind == "patch":
                controls.extend(patch_controls(stage))
            elif kind == "strip":
                controls.extend(channel("strip", identity, f) for f in ("gain", "left", "right", "mute"))
                for side in ("left", "right"):
                    representative = next((r for r in resolved.routes if r.source_id == identity
                                           and resolved.route_pans.get(r.id) == side), None)
                    if representative:
                        controls.append(channel("route", representative.id, "pan"))
            elif kind == "bypass":
                controls.append(channel("strip", identity, "bypass"))
            elif kind == "route":
                controls.extend(channel("route", identity, f) for f in
                                (("gain",) if routes[identity].source_stage == "raw" else ("gain", "post", "pan")))
            if kind == "strip" or stage == OUTPUT:
                meters.extend(channel("meter", identity if kind == "strip" else OUTPUT, f)
                              for f in ("peakL", "peakR", "rmsL", "rmsR"))
            reference = str(index + offset)
            stages.append(RenderStage(stage, "output" if stage == OUTPUT else kind,
                identity if target else None, reference,
                legato.get(stage, reference) if kind == "patch" else None,
                target.midi_channel if target and kind == "patch" else 0,
                not target or kind != "patch" or target.always_on or stage in legato,
                tuple(sorted(set(controls))), tuple(meters)))
        for identity in resolved.by_id:
            colocations.append(RenderCoLocation(tuple(sorted({"patch:" + identity, "strip:" + identity,
                                                              resolved.raw_stage(identity)})), "instance_processing"))
        for insert, owner in sorted(audio_graph.insert_owners.items()):
            colocations.append(RenderCoLocation(tuple(sorted(("patch:" + insert, "patch:" + owner))), "private_insert"))
        downstream = [OUTPUT]
        if audio_graph.master_id is not None:
            downstream.append("patch:" + audio_graph.master_id)

    fingerprint = stable_hash({
        "capability": CAPABILITY_VERSION, "engine": asdict(engine),
        "targets": [{"identity": identity, "patch_id": t.patch.id, "graph": t.patch.graph.model_dump(mode="json"),
                     "midi_channel": t.midi_channel, "always_on": t.always_on,
                     "controllers": t.performance_controller_values, "ccs": t.performance_controller_midi_ccs,
                     "legacy_sources": t.effect_source_ids, "legacy_routes": t.effect_routes}
                    for identity, t in zip(identities, targets, strict=True)],
        "audio_graph": audio_graph.model_dump(mode="json") if audio_graph is not None else None,
        "opcode_hashes": resources.opcode_hashes,
    })
    return RenderDependencyGraph(CAPABILITY_VERSION, fingerprint, "explicit" if resolved else "legacy", engine,
        tuple(stages), connections, dependencies, resources.accesses,
        tuple(sorted(colocations, key=lambda c: (c.reason, c.stages))), resources.helpers,
        tuple(sorted(blockers, key=lambda d: (d.code, d.stages, d.detail))), tuple(sorted(downstream)))
