import type { NodeInstance, PatchGraph } from "../types";
import type { BranchTarget } from "./branchLayout";
import { controlFlowOwners, ROOT_ONLY_OPCODES } from "./controlFlow";
import { parseFormulaTargetKey, readInputFormulaMap } from "./graphFormula";
import { stereoOpcodeDirection } from "./stereoCatalog";

export function branchOpcodeAllowed(opcode: string): boolean {
  return !ROOT_ONLY_OPCODES.has(opcode) && !stereoOpcodeDirection(opcode) && !opcode.startsWith("__");
}

/** Validate transfers, not deliberate shared-input wiring or existing patch structure. */
export function branchTransferIssues(graph: PatchGraph, nodeIds: string[], target: BranchTarget | null): string[] {
  const selected = new Set(nodeIds); const owners = controlFlowOwners(graph);
  const destination = target && graph.control_flow?.[target.blockId]?.cases.find((c) => c.id === target.caseId);
  if (target && !destination) return ["Missing destination case"];
  const sameScope = (id: string) => {
    const owner = owners.get(id);
    return target ? owner?.blockId === target.blockId && owner.caseId === target.caseId : !owner;
  };
  // Moving a root-only construct around the main canvas is not a transfer.
  if (!target && nodeIds.every((id) => graph.nodes.some((n) => n.id === id) && sameScope(id))) return [];
  const issues = nodeIds.flatMap((id) => {
    const node = graph.nodes.find((n) => n.id === id);
    return !node || !branchOpcodeAllowed(node.opcode) ? [`${node?.opcode ?? "Missing node"} · ${id}`] : [];
  });
  if (issues.length) return issues;
  // A panel move back to the same scope is a no-op, including existing shared inputs.
  if (nodeIds.length && nodeIds.every(sameScope)) return [];
  const describe = (id: string) => `${graph.nodes.find((n) => n.id === id)?.opcode ?? "?"} (${id})`;
  const check = (source: string, sourcePort: string, dest: string, destPort: string, formula = false) => {
    if (!selected.has(source) && !selected.has(dest)) return;
    const unmoved = [source, dest].filter((id) => !selected.has(id) && !sameScope(id));
    if (unmoved.length) issues.push(`${formula ? "ƒ " : ""}${source}.${sourcePort} → ${dest}.${destPort} [${unmoved.map(describe).join(", ")}]`);
  };
  graph.connections.forEach((c) => check(c.from_node_id, c.from_port_id, c.to_node_id, c.to_port_id));
  for (const [key, formula] of Object.entries(readInputFormulaMap(graph.ui_layout))) {
    const dest = parseFormulaTargetKey(key); if (!dest) continue;
    formula.inputs.forEach((i) => check(i.from_node_id, i.from_port_id, dest.toNodeId, dest.toPortId, true));
  }
  return [...new Set(issues)];
}

export function transferBranchNodes(graph: PatchGraph, nodeIds: string[], target: BranchTarget | null): PatchGraph {
  const errors = branchTransferIssues(graph, nodeIds, target);
  if (errors.length) throw new Error(errors.join("\n"));
  const selected = new Set(nodeIds);
  if (!selected.size) return graph;
  const owners = controlFlowOwners(graph);
  if (nodeIds.every((id) => target ? owners.get(id)?.blockId === target.blockId && owners.get(id)?.caseId === target.caseId : !owners.has(id))) return graph;
  return { ...graph, control_flow: Object.fromEntries(Object.entries(graph.control_flow ?? {}).map(([id, block]) => [id, { ...block,
    cases: block.cases.map((item) => {
      const enters = id === target?.blockId && item.id === target.caseId;
      return { ...item, silence: enters ? false : item.silence,
        node_ids: [...item.node_ids.filter((n) => !selected.has(n)), ...(enters ? nodeIds : [])] };
    }) }])) };
}

export function addBranchNode(graph: PatchGraph, node: NodeInstance, target?: BranchTarget): PatchGraph {
  if (target && !branchOpcodeAllowed(node.opcode)) throw new Error(`${node.opcode} must remain in the main graph.`);
  const next = { ...graph, nodes: [...graph.nodes, node] };
  return target ? transferBranchNodes(next, [node.id], target) : next;
}
