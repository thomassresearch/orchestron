import { branchCollapsed, controlFlowOwners, controlFlowSpecs } from "./controlFlow";
import { parseFormulaTargetKey, readInputFormulaMap, writeInputFormulaMap } from "./graphFormula";
import type { Connection, OpcodeSpec, PatchGraph, PortSpec } from "../types";

/** View-only opcodes and capture sockets always restore to canonical node/port IDs. */
export function projectControlFlow(graph: PatchGraph, catalog: OpcodeSpec[]) {
  const specs = controlFlowSpecs(graph, catalog);
  const owners = controlFlowOwners(graph);
  const hidden = new Map<string, string>();
  const opcodes = new Map<string, string>();
  const captures = new Map<string, { nodeId: string; portId: string }>();
  const captureTargets = new Map<string, { nodeId: string; portId: string }>();
  const readOnlyInputs = new Set<string>();
  for (const [id, block] of Object.entries(graph.control_flow ?? {})) {
    opcodes.set(id, `__branch_${id}`);
    for (const item of block.cases) {
      opcodes.set(item.result_node_id, `__result_${item.result_node_id}`);
      if (branchCollapsed(graph, id)) item.node_ids.forEach((nodeId) => hidden.set(nodeId, id));
    }
  }
  for (const link of graph.connections) {
    const blockId = hidden.get(link.to_node_id);
    if (!blockId || hidden.has(link.from_node_id)) continue;
    const key = `${link.to_node_id}::${link.to_port_id}`;
    if (captureTargets.has(key)) continue;
    const proxyPort = `capture_${encodeURIComponent(link.to_node_id)}_${encodeURIComponent(link.to_port_id)}`;
    captures.set(`${blockId}::${proxyPort}`, { nodeId: link.to_node_id, portId: link.to_port_id });
    captureTargets.set(key, { nodeId: blockId, portId: proxyPort });
    readOnlyInputs.add(`${blockId}::${proxyPort}`);
    const target = graph.nodes.find((n) => n.id === link.to_node_id)!;
    const spec = specs.find((s) => s.name === (opcodes.get(target.id) ?? target.opcode));
    const port = spec?.inputs.find((p) => p.id === link.to_port_id);
    const blockSpec = specs.find((s) => s.name === opcodes.get(blockId))!;
    if (port) {
      const owner = owners.get(target.id)!;
      const item = graph.control_flow![blockId].cases.find((c) => c.id === owner.caseId)!;
      const captured: PortSpec = { ...port, id: proxyPort, name: `${item.name} · ${target.opcode} · ${port.name}` };
      blockSpec.inputs = [...blockSpec.inputs, captured];
    }
  }
  const project = (link: Connection): Connection => {
    const target = captureTargets.get(`${link.to_node_id}::${link.to_port_id}`);
    return target ? { ...link, to_node_id: target.nodeId, to_port_id: target.portId } : link;
  };
  const restoreConnection = (link: Connection): Connection => {
    const target = captures.get(`${link.to_node_id}::${link.to_port_id}`);
    return target ? { ...link, to_node_id: target.nodeId, to_port_id: target.portId } : link;
  };
  const mapFormulas = (layout: PatchGraph["ui_layout"], map: (c: Connection) => Connection) => writeInputFormulaMap(layout,
    Object.fromEntries(Object.entries(readInputFormulaMap(layout)).map(([key, formula]) => {
      const target = parseFormulaTargetKey(key)!;
      const mapped = map({ from_node_id: "", from_port_id: "", to_node_id: target.toNodeId, to_port_id: target.toPortId });
      return [`${mapped.to_node_id}::${mapped.to_port_id}`, formula];
    })));
  const invisibleLinks = graph.connections.filter((c) => hidden.has(c.from_node_id));
  return {
    graph: { ...graph, nodes: graph.nodes.filter((n) => !hidden.has(n.id)).map((n) => ({ ...n, opcode: opcodes.get(n.id) ?? n.opcode })),
      connections: graph.connections.filter((c) => !hidden.has(c.from_node_id)).map(project), ui_layout: mapFormulas(graph.ui_layout, project) },
    opcodes: specs, projectConnection: project, restoreConnection, readOnlyInputs,
    restore(next: PatchGraph): PatchGraph {
      const visible = new Map(next.nodes.map((n) => [n.id, n]));
      const originals = new Map(graph.nodes.map((n) => [n.id, n]));
      const restored = next.nodes.map((n) => ({ ...n, opcode: opcodes.has(n.id) ? originals.get(n.id)!.opcode : n.opcode }));
      restored.push(...graph.nodes.filter((n) => hidden.has(n.id) && visible.has(hidden.get(n.id)!)));
      const nodes = restored.map((n) => {
        const owner = owners.get(n.id); if (!owner) return n;
        const originalBlock = originals.get(owner.blockId); const movedBlock = visible.get(owner.blockId);
        if (!originalBlock || !movedBlock) return n;
        return { ...n, position: { x: n.position.x + movedBlock.position.x - originalBlock.position.x,
          y: n.position.y + movedBlock.position.y - originalBlock.position.y } };
      });
      const present = new Set(nodes.map((n) => n.id));
      return { ...next, nodes, connections: [...invisibleLinks.filter((c) => present.has(c.from_node_id) && present.has(c.to_node_id)), ...next.connections.map(restoreConnection)],
        ui_layout: mapFormulas(next.ui_layout, restoreConnection) };
    }
  };
}
