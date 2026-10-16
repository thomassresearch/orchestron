"""Insert input/output correspondence, shared by live mixing and offline export."""

from backend.app.models.patch import NodeInstance, PatchGraph
from backend.app.services.audio_port_names import audio_port_names


def bypass_ports(graph: PatchGraph) -> dict[str, str]:
    """Map main outputs to main inputs in their declared channel order."""
    interface = graph.audio_interface
    groups = {group.id: group for group in interface.groups} if interface else {}
    inputs = audio_port_names(graph, opcode="inleta")
    outputs = audio_port_names(graph, opcode="outleta")
    if any(node.opcode == "outs" for node in graph.nodes):
        outputs += ["$direct.left", "$direct.right"]
    if interface and interface.main_input in groups:
        inputs = groups[interface.main_input].ports
    if interface and interface.main_output in groups:
        outputs = groups[interface.main_output].ports
    return dict(zip(outputs, inputs, strict=True)) if inputs and len(inputs) == len(outputs) else {}


def routing_only_graph(graph: PatchGraph) -> PatchGraph:
    """Retain port metadata without synthesis, controllers or asset references.

    These nodes are never compiled: offline lowering connects the incoming routes
    directly to consumers. Strip/routing settings and nested inserts still apply.
    """
    nodes = [
        NodeInstance(id=f"{opcode}-{index}", opcode=opcode, params={"sname": name})
        for opcode in ("inleta", "outleta")
        for index, name in enumerate(audio_port_names(graph, opcode=opcode))
    ]
    if any(node.opcode == "outs" for node in graph.nodes):
        nodes.append(NodeInstance(id="direct-output", opcode="outs"))
    return PatchGraph(nodes=nodes, connections=[], audio_interface=graph.audio_interface,
                      engine_config=graph.engine_config)
