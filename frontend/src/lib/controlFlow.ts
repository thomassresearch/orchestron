import { parseFormulaTargetKey, readInputFormulaMap, writeInputFormulaMap } from "./graphFormula";
import { transferBranchNodes } from "./branchTransfer";
import { readGraphEditorState, writeGraphEditorState } from "./graphEditorState";
import { pruneCaseSizes } from "./branchCaseSizes";
import type { Connection, ControlFlowBlock, ControlFlowCase, NodeInstance, NodePosition, OpcodeSpec, PatchGraph, PortSpec } from "../types";

export const BRANCH_OPCODES = new Set(["If", "Switch"]);
export const CASE_RESULT = "CaseResult";
export const ROOT_ONLY_OPCODES = new Set(["outs", "inleta", "outleta", "sfload", "maxalloc", "If", "Switch", "CaseResult"]);
export const branchChannels = (block: ControlFlowBlock) => block.output_format === "stereo" ? ["left", "right"] : ["left"];
export const branchCollapsed = (graph: PatchGraph, id: string) => (graph.ui_layout.control_flow_blocks as Record<string, boolean> | undefined)?.[id] === true;

export function controlFlowOwners(graph: PatchGraph): Map<string, { blockId: string; caseId: string }> {
  return new Map(Object.entries(graph.control_flow ?? {}).flatMap(([blockId, block]) =>
    block.cases.flatMap((item) => item.node_ids.map((id) => [id, { blockId, caseId: item.id }] as const))));
}

export function controlFlowIssues(graph: PatchGraph, checkConnections = true): string[] {
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) return ["Graph nodes and connections must be arrays."];
  if (graph.control_flow !== undefined && (graph.control_flow === null || typeof graph.control_flow !== "object" || Array.isArray(graph.control_flow))) return ["control_flow must be a map of block IDs."];
  const errors: string[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const owned = new Set<string>();
  const results = new Set<string>();
  for (const [id, block] of Object.entries(graph.control_flow ?? {})) {
    if (!block || !["if", "switch"].includes(block.kind) || !["mono", "stereo"].includes(block.output_format) ||
        !["==", "!=", "<", "<=", ">", ">="].includes(block.operator) || !Array.isArray(block.cases) || block.cases.length < 2 || block.cases.length > 128 ||
        block.cases.some((item) => !item || typeof item !== "object" || !Array.isArray(item.node_ids)) ||
        nodes.get(id)?.opcode !== (block.kind === "if" ? "If" : "Switch")) {
      errors.push(`Invalid control flow block: ${id}`); continue;
    }
    const ids = block.cases.map((item) => item.id);
    if (new Set(ids).size !== ids.length) errors.push(`Duplicate case IDs: ${id}`);
    if (block.kind === "if" && (block.cases.length !== 2 || block.cases.some((item) => item.value !== null))) errors.push(`Invalid If cases: ${id}`);
    if (block.kind === "switch") {
      const values = block.cases.slice(0, -1).map((item) => item.value);
      if (values.some((value) => typeof value !== "number" || !Number.isFinite(value)) || new Set(values).size !== values.length || block.cases[block.cases.length - 1]?.value !== null) errors.push(`Duplicate or invalid Switch values: ${id}`);
    }
    for (const item of block.cases) {
      if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || item.name.length > 128 ||
          typeof item.silence !== "boolean" || item.node_ids.some((member) => typeof member !== "string")) { errors.push(`Invalid case: ${id}`); continue; }
      if (!item.node_ids.includes(item.result_node_id) || nodes.get(item.result_node_id)?.opcode !== CASE_RESULT) errors.push(`Missing Case Result: ${item.name}`);
      if (item.silence && item.node_ids.some((member) => member !== item.result_node_id)) errors.push(`Silence case contains nodes: ${item.name}`);
      for (const member of item.node_ids) {
        const node = nodes.get(member);
        if (owned.has(member) || !node || (ROOT_ONLY_OPCODES.has(node.opcode) && member !== item.result_node_id)) errors.push(`Invalid case membership: ${member}`);
        owned.add(member);
      }
      results.add(item.result_node_id);
    }
  }
  for (const node of graph.nodes) {
    if (BRANCH_OPCODES.has(node.opcode) && !graph.control_flow?.[node.id]) errors.push(`Missing control flow configuration: ${node.id}`);
    if (node.opcode === CASE_RESULT && !results.has(node.id)) errors.push(`Unowned Case Result: ${node.id}`);
  }
  if (errors.length || !checkConnections || !Object.keys(graph.control_flow ?? {}).length) return errors;
  const owners = controlFlowOwners(graph);
  const silent = new Set(Object.values(graph.control_flow ?? {}).flatMap((b) => b.cases.filter((c) => c.silence).map((c) => c.result_node_id)));
  const rootEdges = new Map<string, Set<string>>();
  graph.nodes.filter((n) => !owners.has(n.id)).forEach((n) => rootEdges.set(n.id, new Set()));
  for (const link of graph.connections) {
    const source = owners.get(link.from_node_id); const target = owners.get(link.to_node_id);
    if ((source && (source.blockId !== target?.blockId || source.caseId !== target.caseId)) || silent.has(link.to_node_id)) {
      errors.push(`${link.from_node_id}.${link.from_port_id} → ${link.to_node_id}.${link.to_port_id}`);
    }
    if (!source) rootEdges.get(link.from_node_id)?.add(target?.blockId ?? link.to_node_id);
  }
  const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const next of rootEdges.get(id) ?? []) if (!visit(next)) return false;
    visiting.delete(id); visited.add(id); return true;
  };
  if ([...rootEdges.keys()].some((id) => !visit(id))) errors.push("Control flow dependency cycle");
  return errors;
}

export function assertControlFlow(graph: PatchGraph): PatchGraph {
  const issues = controlFlowIssues(graph);
  if (issues.length) throw new Error(issues.join("\n"));
  return graph;
}

function createCase(name: string, value: number | null, silence: boolean, position: NodePosition): { item: ControlFlowCase; result: NodeInstance } {
  const id = crypto.randomUUID(); const resultId = crypto.randomUUID();
  return { item: { id, name, value, silence, node_ids: [resultId], result_node_id: resultId },
    result: { id: resultId, opcode: CASE_RESULT, params: {}, position } };
}

export function addControlFlowBlock(graph: PatchGraph, kind: "if" | "switch", position = { x: 100, y: 100 }, names = ["True", "False", "Default"]): PatchGraph {
  const id = crypto.randomUUID();
  const first = createCase(kind === "if" ? names[0] : "36", kind === "if" ? null : 36, false, { x: position.x + 760, y: position.y + 220 });
  const last = createCase(kind === "if" ? names[1] : names[2], null, true, { x: position.x + 760, y: position.y + 570 });
  return { ...graph, nodes: [...graph.nodes,
    { id, opcode: kind === "if" ? "If" : "Switch", params: kind === "if" ? { lhs: 0, rhs: 0 } : { selector: 0 }, position }, first.result, last.result],
    control_flow: { ...graph.control_flow, [id]: { kind, output_format: "stereo", operator: "==", cases: [first.item, last.item] } } };
}

export function updateControlFlowBlock(graph: PatchGraph, id: string, update: Partial<ControlFlowBlock>): PatchGraph {
  const block = graph.control_flow?.[id];
  if (!block) throw new Error(`Missing block: ${id}`);
  return assertControlFlow({ ...graph, control_flow: { ...graph.control_flow, [id]: { ...block, ...update } } });
}

export function addControlFlowCase(graph: PatchGraph, blockId: string): PatchGraph {
  const block = graph.control_flow![blockId];
  const origin = graph.nodes.find((n) => n.id === blockId)!.position;
  const values = new Set(block.cases.map((c) => c.value)); let value = 36;
  while (values.has(value)) value++;
  const { item, result } = createCase(String(value), value, false, { x: origin.x + 760, y: origin.y + 220 + (block.cases.length - 1) * 350 });
  const cases = [...block.cases.slice(0, -1), item, block.cases[block.cases.length - 1]];
  return updateControlFlowBlock({ ...graph, nodes: [...graph.nodes, result] }, blockId, { cases });
}

export function setBranchCollapsed(graph: PatchGraph, id: string, collapsed: boolean): PatchGraph {
  return { ...graph, ui_layout: { ...graph.ui_layout, control_flow_blocks: { ...(graph.ui_layout.control_flow_blocks as Record<string, boolean> ?? {}), [id]: collapsed } } };
}

/** Prune all node-bound metadata together with nodes, never on ordinary loading. */
export function removeGraphNodes(graph: PatchGraph, removed: Set<string>): PatchGraph {
  const formulas = Object.fromEntries(Object.entries(readInputFormulaMap(graph.ui_layout)).filter(([key, formula]) =>
    !removed.has(parseFormulaTargetKey(key)!.toNodeId) && !formula.inputs.some((input) => removed.has(input.from_node_id))));
  let layout = writeInputFormulaMap(graph.ui_layout, formulas);
  for (const key of ["gen_nodes", "sfload_nodes", "control_flow_blocks", "control_flow_case_sizes"]) {
    const map = layout[key];
    if (map && typeof map === "object" && !Array.isArray(map)) layout = { ...layout, [key]: Object.fromEntries(Object.entries(map).filter(([id]) => !removed.has(id))) };
  }
  const state = readGraphEditorState(layout);
  if (state.selection) layout = writeGraphEditorState(layout, { ...state, selection: {
    nodeIds: state.selection.nodeIds.filter((id) => !removed.has(id)),
    connections: state.selection.connections.filter((c) => !removed.has(c.from_node_id) && !removed.has(c.to_node_id))
  } });
  return { ...graph, nodes: graph.nodes.filter((n) => !removed.has(n.id)),
    connections: graph.connections.filter((c) => !removed.has(c.from_node_id) && !removed.has(c.to_node_id)), ui_layout: layout };
}

export function expandControlFlowDeletion(graph: PatchGraph, nodeIds: string[]): string[] {
  const removed = new Set(nodeIds);
  const protectedResults = new Set(Object.values(graph.control_flow ?? {}).flatMap((b) => b.cases.map((c) => c.result_node_id)));
  for (const id of protectedResults) removed.delete(id);
  for (const [id, block] of Object.entries(graph.control_flow ?? {})) if (removed.has(id)) block.cases.forEach((c) => c.node_ids.forEach((n) => removed.add(n)));
  return [...removed];
}

export function reconcileControlFlow(before: PatchGraph, next: PatchGraph): PatchGraph {
  const present = new Set(next.nodes.map((n) => n.id));
  const removed = new Set(before.nodes.filter((n) => !present.has(n.id)).map((n) => n.id));
  if (!removed.size) return next;
  const blocks = { ...next.control_flow };
  for (const [id, block] of Object.entries(before.control_flow ?? {})) if (removed.has(id)) {
    block.cases.forEach((c) => c.node_ids.forEach((n) => removed.add(n))); delete blocks[id];
  }
  for (const [id, block] of Object.entries(blocks)) blocks[id] = { ...block, cases: block.cases.map((c) => ({ ...c, node_ids: c.node_ids.filter((n) => !removed.has(n)) })) };
  return removeGraphNodes({ ...next, control_flow: blocks }, removed);
}

export function deleteControlFlowCase(graph: PatchGraph, blockId: string, caseId: string): PatchGraph {
  const block = graph.control_flow![blockId]; const item = block.cases.find((c) => c.id === caseId)!;
  if (block.kind !== "switch" || block.cases[block.cases.length - 1] === item || block.cases.length <= 2) throw new Error("A Switch needs one numeric case and Default.");
  const next = removeGraphNodes(graph, new Set(item.node_ids));
  return pruneCaseSizes(updateControlFlowBlock(next, blockId, { cases: block.cases.filter((c) => c.id !== caseId) }));
}

export function silenceControlFlowCase(graph: PatchGraph, blockId: string, caseId: string, silence: boolean): PatchGraph {
  const block = graph.control_flow![blockId]; const item = block.cases.find((c) => c.id === caseId)!;
  let next = silence ? removeGraphNodes(graph, new Set(item.node_ids.filter((id) => id !== item.result_node_id))) : graph;
  if (silence) {
    next = { ...next, connections: next.connections.filter((c) => c.to_node_id !== item.result_node_id),
      nodes: next.nodes.map((n) => n.id === item.result_node_id ? { ...n, params: {} } : n),
      ui_layout: writeInputFormulaMap(next.ui_layout, Object.fromEntries(Object.entries(readInputFormulaMap(next.ui_layout)).filter(([key]) => parseFormulaTargetKey(key)!.toNodeId !== item.result_node_id))) };
  }
  return updateControlFlowBlock(next, blockId, { cases: block.cases.map((c) => c.id === caseId ? { ...c, silence, node_ids: silence ? [c.result_node_id] : c.node_ids } : c) });
}

export function changeControlFlowFormat(graph: PatchGraph, blockId: string, output_format: ControlFlowBlock["output_format"]): PatchGraph {
  const block = graph.control_flow![blockId]; const resultIds = new Set(block.cases.map((c) => c.result_node_id));
  let next = graph;
  if (output_format === "mono") next = { ...graph,
    connections: graph.connections.filter((c) => !(c.from_node_id === blockId && c.from_port_id === "right") && !(resultIds.has(c.to_node_id) && c.to_port_id === "right")),
    nodes: graph.nodes.map((n) => { if (!resultIds.has(n.id)) return n; const params = { ...n.params }; delete params.right; return { ...n, params }; }),
    ui_layout: writeInputFormulaMap(graph.ui_layout, Object.fromEntries(Object.entries(readInputFormulaMap(graph.ui_layout)).filter(([key, formula]) => {
      const target = parseFormulaTargetKey(key)!;
      return !(resultIds.has(target.toNodeId) && target.toPortId === "right") && !formula.inputs.some((input) => input.from_node_id === blockId && input.from_port_id === "right");
    }))) };
  return updateControlFlowBlock(next, blockId, { output_format });
}

export function moveNodesToCase(graph: PatchGraph, nodeIds: string[], target: { blockId: string; caseId: string } | null): PatchGraph {
  const selected = new Set(nodeIds);
  const destination = target && graph.control_flow?.[target.blockId]?.cases.find((c) => c.id === target.caseId);
  let next = transferBranchNodes(graph, nodeIds, target);
  if (!selected.size || next === graph) return next;
  if (target) {
    const result = graph.nodes.find((n) => n.id === destination!.result_node_id)!;
    const chosen = graph.nodes.filter((n) => selected.has(n.id));
    const existing = graph.nodes.filter((n) => destination!.node_ids.includes(n.id) && n.id !== destination!.result_node_id && !selected.has(n.id));
    const origin = graph.nodes.find((n) => n.id === target.blockId)!.position;
    const targetY = Math.min(result.position.y, ...existing.map((n) => n.position.y));
    const minX = Math.min(...chosen.map((n) => n.position.x)); const minY = Math.min(...chosen.map((n) => n.position.y));
    next = { ...next, nodes: next.nodes.map((n) => selected.has(n.id) ? { ...n, position: { x: origin.x + 24 + n.position.x - minX, y: targetY + n.position.y - minY } } : n) };
  }
  return next;
}

export function controlFlowSpecs(graph: PatchGraph, catalog: OpcodeSpec[]): OpcodeSpec[] {
  const specs = [...catalog];
  for (const [id, block] of Object.entries(graph.control_flow ?? {})) {
    const base = catalog.find((s) => s.name === (block.kind === "if" ? "If" : "Switch"));
    if (!base) continue;
    const ports: PortSpec[] = branchChannels(block).map((name) => ({ id: name, name: block.output_format === "mono" ? "Audio" : name, signal_type: "a", required: true, description: "" }));
    specs.push({ ...base, name: `__branch_${id}`, outputs: ports });
    for (const item of block.cases) specs.push({ ...base, name: `__result_${item.result_node_id}`, inputs: item.silence ? [] : ports, outputs: [] });
  }
  return specs;
}

export function connectionText(link: Connection): string {
  return `${link.from_node_id}.${link.from_port_id} → ${link.to_node_id}.${link.to_port_id}`;
}

export function patchSchemaVersion(version: number, graph: PatchGraph): number {
  if (version !== 1 && version !== 2) throw new Error(`Unsupported patch schema version: ${version}`);
  return Object.keys(graph.control_flow ?? {}).length ? 2 : version;
}

export function defaultAuditionNote(graph: PatchGraph): number {
  const noteNodes = new Set(graph.nodes.filter((n) => n.opcode === "notnum").map((n) => n.id));
  for (const [id, block] of Object.entries(graph.control_flow ?? {})) {
    if (block.kind !== "switch" || !graph.connections.some((c) => c.to_node_id === id && c.to_port_id === "selector" && noteNodes.has(c.from_node_id))) continue;
    const value = block.cases[0]?.value;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 127) return value;
  }
  return 60;
}

/** Human-readable condition; connections and formulas have the same precedence as compilation. */
export function controlFlowConditionLabel(graph: PatchGraph, blockId: string): string {
  const block = graph.control_flow![blockId];
  const node = graph.nodes.find((n) => n.id === blockId)!;
  const formulas = readInputFormulaMap(graph.ui_layout);
  const source = (nodeId: string, portId: string) => `${graph.nodes.find((n) => n.id === nodeId)?.opcode ?? nodeId}.${portId}`;
  const operand = (port: string) => {
    const formula = formulas[`${blockId}::${port}`];
    if (formula) return formula.expression.replace(/\b[a-zA-Z_]\w*\b/g, (token) => {
      const binding = formula.inputs.find((input) => input.token === token);
      return binding ? source(binding.from_node_id, binding.from_port_id) : token;
    });
    const links = graph.connections.filter((c) => c.to_node_id === blockId && c.to_port_id === port);
    return links.length ? links.map((c) => source(c.from_node_id, c.from_port_id)).join(" + ") : String(node.params[port] ?? 0);
  };
  return block.kind === "if" ? `If: ${operand("lhs")} ${block.operator} ${operand("rhs")}` : `Switch: ${operand("selector")}`;
}
