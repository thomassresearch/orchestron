"""Deterministic cycle witnesses on the compiler's processing-stage graph."""
from __future__ import annotations

from collections import defaultdict, deque
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from backend.app.services.compiler_common import PatchInstrumentTarget

from backend.app.models.audio import AudioDiagnostic, AudioFeedbackStep, AudioRoute, AudioRoutingEndpoint

FEEDBACK_MESSAGE = "Effect routing would create an audio feedback loop."


def cyclic_components(edges: list[tuple[str, str]]) -> list[set[str]]:
    """Iterative Kosaraju: route-node chains can exceed Python's recursion limit."""
    adjacency: dict[str, set[str]] = defaultdict(set)
    reverse: dict[str, set[str]] = defaultdict(set)
    for source, target in edges:
        adjacency[source].add(target)
        adjacency.setdefault(target, set())
        reverse[target].add(source)
    visited, finished = set(), []
    for start in sorted(adjacency):
        if start in visited:
            continue
        visited.add(start)
        stack = [(start, iter(sorted(adjacency[start])))]
        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                finished.append(node)
                stack.pop()
            elif child not in visited:
                visited.add(child)
                stack.append((child, iter(sorted(adjacency[child]))))
    assigned, components = set(), []
    for start in reversed(finished):
        if start in assigned:
            continue
        component, todo = set(), [start]
        assigned.add(start)
        while todo:
            node = todo.pop()
            component.add(node)
            for child in reverse[node] - assigned:
                assigned.add(child)
                todo.append(child)
        if len(component) > 1 or start in adjacency[start]:
            components.append(component)
    return sorted(components, key=lambda c: min(c))


def feedback_diagnostics(
    edges: list[tuple[str, str]], routes: list[AudioRoute], targets: dict[str, PatchInstrumentTarget],
    insert_owners: dict[str, str] | None = None,
) -> list[AudioDiagnostic]:
    """Report every cyclic connection, plus one real closed path per component.

    Nodes left behind by topological sorting can also be innocent downstream
    consumers. Only routes inside strongly connected components are highlighted.
    Parallel stereo routes are grouped in the witness, without inventing edges.
    """
    insert_owners = insert_owners or {}
    adjacency: dict[str, set[str]] = defaultdict(set)
    for source, target in edges:
        adjacency[source].add(target)
    by_route = {"route:" + r.id: r for r in routes}
    diagnostics = []
    for component in cyclic_components(edges):
        cyclic_routes = sorted((by_route[n] for n in component if n in by_route), key=lambda r: r.id)
        if not cyclic_routes:
            continue
        start = "route:" + cyclic_routes[0].id
        # Breadth-first search finds a short closed witness, with stable tie breaks.
        parents = {}
        todo = deque([(start, child) for child in sorted(adjacency[start] & component)])
        while todo:
            parent, node = todo.popleft()
            if node in parents:
                continue
            parents[node] = parent
            if node == start:
                break
            todo.extend((node, child) for child in sorted(adjacency[node] & component) if child not in parents)
        walk = [start]
        current = parents[start]
        while current != start:
            walk.append(current)
            current = parents[current]
        walk.append(start)
        walk.reverse()

        def key(route: AudioRoute):
            return (route.source_id, route.target_id, route.source_stage, route.target_stage, route.kind)

        def endpoint(identity: str, stage: Literal["raw", "strip", "input"], ports: list[str]) -> AudioRoutingEndpoint:
            target = targets[identity]
            return AudioRoutingEndpoint(id=identity, name=target.patch.name, midiChannel=target.midi_channel,
                                        stage=stage, ports=ports, insertOwnerId=insert_owners.get(identity))

        path = []
        for node in walk[:-1]:
            if node not in by_route:
                continue
            route = by_route[node]
            parallel = sorted((r for r in cyclic_routes if key(r) == key(route)),
                              key=lambda r: (r.source_port, r.target_port, r.id))
            path.append(AudioFeedbackStep(
                source=endpoint(route.source_id, route.source_stage, [r.source_port for r in parallel]),
                target=endpoint(route.target_id, route.target_stage, [r.target_port for r in parallel]),
                kind=route.kind, routeIds=[r.id for r in parallel],
            ))

        def label(endpoint: AudioRoutingEndpoint) -> str:
            channel = f", MIDI Ch. {endpoint.midi_channel}" if endpoint.midi_channel else ""
            return f"{endpoint.name} [{endpoint.id}{channel}] ({endpoint.stage})"

        message = "Audio feedback path: " + label(path[0].source)
        for step in path:
            mapping = "/".join(step.source.ports) + " → " + "/".join(step.target.ports)
            message += f" — {step.kind} ({mapping}) → " + label(step.target)
        diagnostics.append(AudioDiagnostic(
            code="feedback", severity="error", message=message,
            instanceId=path[0].source.id, routeId=path[0].route_ids[0],
            routeIds=[r.id for r in cyclic_routes],
            instanceIds=sorted({identity for r in cyclic_routes for identity in (r.source_id, r.target_id)}),
            routingPath=path,
        ))
    return diagnostics
