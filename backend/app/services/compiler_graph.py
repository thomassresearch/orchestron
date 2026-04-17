from __future__ import annotations

from collections import defaultdict, deque
from typing import Iterable

from backend.app.models.opcode import PortSpec, SignalType
from backend.app.models.patch import Connection, EngineConfig, NodeInstance, PatchGraph
from backend.app.services.compiler_common import CompiledGraphContext, CompiledNode, CompilationError, PatchInstrumentTarget
from backend.app.services.opcode_service import OpcodeService


def resolve_shared_engine(targets: list[PatchInstrumentTarget]) -> EngineConfig:
    return targets[0].patch.graph.engine_config


def validate_target_channels(targets: list[PatchInstrumentTarget]) -> None:
    seen: set[int] = set()
    for target in targets:
        channel = int(target.midi_channel)
        if channel < 0 or channel > 16:
            raise CompilationError([f"Invalid MIDI channel '{channel}'. Expected values in the range 0..16."])
        if channel == 0:
            continue
        if channel in seen:
            raise CompilationError([f"MIDI channel '{channel}' is assigned to more than one instrument."])
        seen.add(channel)


def compile_graph_context(graph: PatchGraph, opcode_service: OpcodeService) -> CompiledGraphContext:
    if not graph.nodes:
        raise CompilationError(["Patch graph is empty. Add opcode nodes before compiling."])

    diagnostics: list[str] = []
    compiled_nodes: dict[str, CompiledNode] = {}
    for node in graph.nodes:
        spec = opcode_service.get_opcode(node.opcode)
        if not spec:
            diagnostics.append(f"Node '{node.id}' references unknown opcode '{node.opcode}'.")
            continue
        compiled_nodes[node.id] = CompiledNode(node=node, spec=spec)

    if diagnostics:
        raise CompilationError(diagnostics)

    if not any(item.spec.name == "outs" for item in compiled_nodes.values()):
        raise CompilationError(["Patch must include at least one 'outs' output node."])

    inbound_index = build_inbound_index(graph.connections, compiled_nodes)
    errors = validate_connections(graph.connections, compiled_nodes)
    if errors:
        raise CompilationError(errors)

    return CompiledGraphContext(
        compiled_nodes=compiled_nodes,
        inbound_index=inbound_index,
        ordered_ids=topological_sort(graph.nodes, graph.connections),
    )


def validate_connections(
    connections: Iterable[Connection],
    compiled_nodes: dict[str, CompiledNode],
) -> list[str]:
    errors: list[str] = []
    for connection in connections:
        source = compiled_nodes.get(connection.from_node_id)
        target = compiled_nodes.get(connection.to_node_id)

        if not source:
            errors.append(f"Connection source node not found: '{connection.from_node_id}'")
            continue
        if not target:
            errors.append(f"Connection target node not found: '{connection.to_node_id}'")
            continue

        source_port = find_port(source.spec.outputs, connection.from_port_id)
        target_port = find_port(target.spec.inputs, connection.to_port_id)

        if not source_port:
            errors.append(
                f"Unknown source port '{connection.from_port_id}' on node '{source.node.id}' ({source.spec.name})"
            )
            continue
        if not target_port:
            errors.append(
                f"Unknown target port '{connection.to_port_id}' on node '{target.node.id}' ({target.spec.name})"
            )
            continue

        if not is_compatible_type(
            source_port.signal_type,
            target_port.signal_type,
            target_port.accepted_signal_types,
        ):
            errors.append(
                "Signal type mismatch: "
                f"{source.node.id}.{source_port.id} ({source_port.signal_type}) -> "
                f"{target.node.id}.{target_port.id} ({target_port.signal_type})"
            )

    return errors


def is_compatible_type(
    source: SignalType,
    target: SignalType,
    accepted_signal_types: list[SignalType] | None = None,
) -> bool:
    if accepted_signal_types and source in accepted_signal_types:
        return True
    if source == target:
        return True
    return source == SignalType.INIT and target == SignalType.CONTROL


def find_port(ports: Iterable[PortSpec], port_id: str) -> PortSpec | None:
    for port in ports:
        if port.id == port_id:
            return port
    return None


def build_inbound_index(
    connections: Iterable[Connection],
    compiled_nodes: dict[str, CompiledNode],
) -> dict[tuple[str, str], list[Connection]]:
    inbound: dict[tuple[str, str], list[Connection]] = defaultdict(list)
    for connection in connections:
        if connection.to_node_id not in compiled_nodes or connection.from_node_id not in compiled_nodes:
            continue
        inbound[(connection.to_node_id, connection.to_port_id)].append(connection)
    return dict(inbound)


def topological_sort(nodes: list[NodeInstance], connections: list[Connection]) -> list[str]:
    indegree: dict[str, int] = {node.id: 0 for node in nodes}
    adjacency: dict[str, list[str]] = {node.id: [] for node in nodes}

    for connection in connections:
        if connection.from_node_id not in indegree or connection.to_node_id not in indegree:
            continue
        adjacency[connection.from_node_id].append(connection.to_node_id)
        indegree[connection.to_node_id] += 1

    queue = deque(sorted([node_id for node_id, degree in indegree.items() if degree == 0]))
    ordered: list[str] = []

    while queue:
        node_id = queue.popleft()
        ordered.append(node_id)
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    if len(ordered) != len(nodes):
        raise CompilationError(
            ["Graph contains a cycle. Add explicit delay/feedback opcodes to break direct recursion."]
        )

    return ordered
