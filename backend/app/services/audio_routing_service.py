from __future__ import annotations

from dataclasses import dataclass

from backend.app.services.audio_port_names import audio_port_names
from backend.app.services.compiler_common import CompilationError, PatchInstrumentTarget


@dataclass(frozen=True, slots=True)
class ResolvedAudioRoute:
    source_assignment_id: str
    source_port_name: str
    target_assignment_id: str
    target_port_name: str


def resolve_audio_routes(targets: list[PatchInstrumentTarget]) -> list[ResolvedAudioRoute]:
    targets_by_assignment_id: dict[str, PatchInstrumentTarget] = {}
    diagnostics: list[str] = []

    for index, target in enumerate(targets):
        assignment_id = (target.assignment_id or "").strip()
        if not assignment_id:
            if target.effect_source_ids or target.effect_routes:
                diagnostics.append(f"Instrument assignment at index {index} requires a stable id for audio routing.")
            continue
        if assignment_id in targets_by_assignment_id:
            diagnostics.append(f"Instrument assignment id '{assignment_id}' is assigned more than once.")
            continue
        targets_by_assignment_id[assignment_id] = target

    if diagnostics:
        raise CompilationError(diagnostics)

    routes: list[ResolvedAudioRoute] = []
    route_edges: list[tuple[str, str]] = []
    seen_routes: set[tuple[str, str, str]] = set()

    for target in targets:
        if not target.effect_routes and not target.effect_source_ids:
            continue

        target_id = (target.assignment_id or "").strip()
        if not target.always_on:
            diagnostics.append(
                f"Instrument assignment '{target_id}' is not always-on and cannot receive effect routes."
            )
            continue

        target_inlets = audio_port_names(target.patch.graph, opcode="inleta")
        if not target_inlets:
            diagnostics.append(
                f"Always-on instrument assignment '{target_id}' cannot receive audio because patch "
                f"'{target.patch.name}' has no inleta ports."
            )
            continue

        explicitly_routed_sources: set[str] = set()
        for source_id_raw, source_port_raw in target.effect_routes:
            source_id = source_id_raw.strip()
            source_port = source_port_raw.strip()
            if source_id:
                explicitly_routed_sources.add(source_id)
            _append_resolved_route(
                source_id=source_id,
                source_port=source_port,
                target_id=target_id,
                target_inlets=target_inlets,
                targets_by_assignment_id=targets_by_assignment_id,
                routes=routes,
                route_edges=route_edges,
                seen_routes=seen_routes,
                diagnostics=diagnostics,
            )

        for source_id_raw in target.effect_source_ids:
            source_id = source_id_raw.strip()
            if source_id in explicitly_routed_sources:
                continue
            source_target = targets_by_assignment_id.get(source_id)
            if not source_id:
                diagnostics.append(f"Effect route target '{target_id}' contains an empty source assignment id.")
                continue
            if source_id == target_id:
                diagnostics.append("Effect routing would create an audio feedback loop.")
                continue
            if source_target is None:
                diagnostics.append(
                    f"Effect route target '{target_id}' references unknown source assignment '{source_id}'."
                )
                continue
            source_outlets = audio_port_names(source_target.patch.graph, opcode="outleta")
            if not source_outlets:
                diagnostics.append(
                    f"Effect route source assignment '{source_id}' patch '{source_target.patch.name}' "
                    "has no outleta ports."
                )
                continue
            for source_port in source_outlets:
                _append_resolved_route(
                    source_id=source_id,
                    source_port=source_port,
                    target_id=target_id,
                    target_inlets=target_inlets,
                    targets_by_assignment_id=targets_by_assignment_id,
                    routes=routes,
                    route_edges=route_edges,
                    seen_routes=seen_routes,
                    diagnostics=diagnostics,
                )

    if diagnostics:
        raise CompilationError(diagnostics)
    _validate_audio_route_graph(route_edges)
    return routes


def _append_resolved_route(
    *,
    source_id: str,
    source_port: str,
    target_id: str,
    target_inlets: list[str],
    targets_by_assignment_id: dict[str, PatchInstrumentTarget],
    routes: list[ResolvedAudioRoute],
    route_edges: list[tuple[str, str]],
    seen_routes: set[tuple[str, str, str]],
    diagnostics: list[str],
) -> None:
    if not source_id:
        diagnostics.append(f"Effect route target '{target_id}' contains an empty source assignment id.")
        return
    if not source_port:
        diagnostics.append(
            f"Effect route from source assignment '{source_id}' to target '{target_id}' contains an empty outlet label."
        )
        return
    if source_id == target_id:
        diagnostics.append("Effect routing would create an audio feedback loop.")
        return

    source_target = targets_by_assignment_id.get(source_id)
    if source_target is None:
        diagnostics.append(f"Effect route target '{target_id}' references unknown source assignment '{source_id}'.")
        return

    source_outlets = audio_port_names(source_target.patch.graph, opcode="outleta")
    if source_port not in source_outlets:
        diagnostics.append(
            f"Effect route source assignment '{source_id}' patch '{source_target.patch.name}' "
            f"has no outleta port named '{source_port}'."
        )
        return

    target_port = resolve_sink_inlet_name(source_port, source_outlets, target_inlets)
    if target_port is None:
        diagnostics.append(
            f"Effect route target '{target_id}' has no compatible inleta port for source outlet '{source_port}'."
        )
        return

    route_key = (source_id, source_port, target_id)
    if route_key in seen_routes:
        return
    seen_routes.add(route_key)
    route_edges.append((source_id, target_id))
    routes.append(
        ResolvedAudioRoute(
            source_assignment_id=source_id,
            source_port_name=source_port,
            target_assignment_id=target_id,
            target_port_name=target_port,
        )
    )


def resolve_sink_inlet_name(
    source_port_name: str,
    source_outlets: list[str],
    sink_inlets: list[str],
) -> str | None:
    if not sink_inlets:
        return None
    if source_port_name in sink_inlets:
        return source_port_name

    sink_by_lower = {name.lower(): name for name in sink_inlets}
    source_by_lower = {name.lower(): name for name in source_outlets}
    source_lower = source_port_name.lower()
    side = _stereo_side_for_source_port(source_lower, source_by_lower)
    if side:
        for candidate in ("left", "l") if side == "left" else ("right", "r"):
            sink_name = sink_by_lower.get(candidate)
            if sink_name:
                return sink_name

    if len(source_outlets) == len(sink_inlets):
        source_index_by_name = {name: index for index, name in enumerate(source_outlets)}
        source_index = source_index_by_name.get(source_port_name)
        if source_index is not None and source_index < len(sink_inlets):
            return sink_inlets[source_index]

    return sink_inlets[0]


def _stereo_side_for_source_port(source_lower: str, source_by_lower: dict[str, str]) -> str | None:
    if source_lower in {"left", "l"} or source_lower.endswith("left"):
        return "left"
    if source_lower in {"right", "r"} or source_lower.endswith("right"):
        return "right"
    if source_lower.endswith("l") and f"{source_lower[:-1]}r" in source_by_lower:
        return "left"
    if source_lower.endswith("r") and f"{source_lower[:-1]}l" in source_by_lower:
        return "right"
    return None


def _validate_audio_route_graph(route_edges: list[tuple[str, str]]) -> None:
    adjacency: dict[str, set[str]] = {}
    for source_id, target_id in route_edges:
        if source_id == target_id:
            raise CompilationError(["Effect routing would create an audio feedback loop."])
        adjacency.setdefault(source_id, set()).add(target_id)
        adjacency.setdefault(target_id, set())

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visited:
            return
        if node_id in visiting:
            raise CompilationError(["Effect routing would create an audio feedback loop."])
        visiting.add(node_id)
        for next_id in adjacency.get(node_id, set()):
            visit(next_id)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in adjacency:
        visit(node_id)
