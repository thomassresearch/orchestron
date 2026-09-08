from __future__ import annotations

from backend.app.models.control_flow import CASE_RESULT
from backend.app.models.opcode import OpcodeSpec, PortSpec, SignalType
from backend.app.models.patch import PatchGraph


def control_flow_owners(graph: PatchGraph) -> dict[str, tuple[str, str]]:
    return {
        node_id: (block_id, case.id)
        for block_id, block in graph.control_flow.items()
        for case in block.cases
        for node_id in case.node_ids
    }


def resolve_control_flow_spec(graph: PatchGraph, node_id: str, base: OpcodeSpec | None) -> OpcodeSpec | None:
    block = graph.control_flow.get(node_id)
    is_result = False
    if block is None:
        block = next((block for block in graph.control_flow.values()
                      if any(case.result_node_id == node_id for case in block.cases)), None)
        is_result = block is not None
    if block is None:
        return base
    audio_ports = [PortSpec(id=name, name="Audio" if block.output_format == "mono" else name.title(),
                            signal_type=SignalType.AUDIO) for name in block.channels]
    if is_result:
        return OpcodeSpec(name=CASE_RESULT, category="control_flow", icon="/static/icons/branch.svg",
                          inputs=audio_ports, documentation_url="https://csound.com/docs/manual/if.html")
    if base is None:
        return None
    return base.model_copy(update={"outputs": audio_ports})


def validate_control_flow_connections(graph: PatchGraph) -> list[str]:
    owners = control_flow_owners(graph)
    silent_results = {case.result_node_id for block in graph.control_flow.values() for case in block.cases if case.silence}
    errors = []
    formulas = graph.ui_layout.get("input_formulas", {})
    for node in graph.nodes:
        if node.id in silent_results and (node.params or any(str(key).startswith(f"{node.id}::") for key in formulas)):
            errors.append(f"Silence result '{node.id}' cannot have parameters or formulas.")
    for link in graph.connections:
        source = owners.get(link.from_node_id)
        target = owners.get(link.to_node_id)
        if source is not None and source != target:
            errors.append(f"Case-local connection {link.from_node_id}.{link.from_port_id} -> "
                          f"{link.to_node_id}.{link.to_port_id} crosses a case boundary. Use the block's audio result.")
        if link.to_node_id in silent_results:
            errors.append(f"Silence result '{link.to_node_id}' cannot have incoming connections.")
    return errors
