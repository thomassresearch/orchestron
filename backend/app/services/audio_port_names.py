from __future__ import annotations

from backend.app.models.patch import PatchGraph


def audio_port_names(graph: PatchGraph, *, opcode: str) -> list[str]:
    names: set[str] = set()
    nodes_by_id = {node.id: node for node in graph.nodes}
    connections_by_target: dict[str, list[tuple[str, str]]] = {}
    for connection in graph.connections:
        if connection.to_port_id == "sname":
            connections_by_target.setdefault(connection.to_node_id, []).append(
                (connection.from_node_id, connection.from_port_id)
            )

    for node in graph.nodes:
        if node.opcode != opcode:
            continue

        connected_names: set[str] = set()
        for source_node_id, source_port_id in connections_by_target.get(node.id, []):
            source_node = nodes_by_id.get(source_node_id)
            if source_port_id == "sout" and source_node and source_node.opcode == "const_s":
                raw_value = source_node.params.get("value")
                if isinstance(raw_value, str) and raw_value.strip():
                    connected_names.add(raw_value.strip())

        if connected_names:
            names.update(connected_names)
            continue

        if node.id in connections_by_target:
            continue

        raw_name = node.params.get("sname")
        if isinstance(raw_name, str) and raw_name.strip():
            names.add(raw_name.strip())

    return sorted(names)
