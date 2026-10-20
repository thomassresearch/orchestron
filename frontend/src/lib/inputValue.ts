import type { NodeInstance, PatchGraph, PortSpec } from "../types";
import {
  formulaTargetKey, readInputFormulaMap, setInputFormulaConfig, validateGraphFormulaExpression,
  type InputFormulaBinding
} from "./graphFormula";

export type InputValueSource = "formula" | "connections" | "parameter" | "default" | "unset";
export type InputEditorMode = "expression" | "number" | "string" | "coefficients" | "managed";
export interface InputValueState {
  source: InputValueSource;
  expression: string;
  bindings: InputFormulaBinding[];
  highlighted: boolean;
  storedValue?: string | number | boolean;
  mode: InputEditorMode;
}

export function numericInputLiteral(text: string): number | null {
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function literalText(value: string | number | boolean): string {
  return typeof value === "boolean" ? (value ? "1" : "0") : String(value);
}

/** A view of the compiler's input precedence; reading never migrates the graph. */
export function resolveInputValue(graph: PatchGraph, node: NodeInstance, port: PortSpec): InputValueState {
  const formula = readInputFormulaMap(graph.ui_layout)[formulaTargetKey(node.id, port.id)];
  const links = graph.connections.filter((c) => c.to_node_id === node.id && c.to_port_id === port.id);
  const bindings: InputFormulaBinding[] = [];
  const sources = new Set<string>();
  const tokens = new Set<string>();
  const sourceKey = (item: { from_node_id: string; from_port_id: string }) => JSON.stringify([item.from_node_id, item.from_port_id]);
  for (const binding of formula?.inputs ?? []) {
    const key = sourceKey(binding);
    if (links.some((link) => sourceKey(link) === key) && !sources.has(key) && !tokens.has(binding.token)) {
      bindings.push(binding); sources.add(key); tokens.add(binding.token);
    }
  }
  for (const link of links) {
    const key = sourceKey(link);
    if (sources.has(key)) continue;
    let index = 1;
    while (tokens.has(`in${index}`)) index++;
    const token = `in${index}`;
    bindings.push({ token, from_node_id: link.from_node_id, from_port_id: link.from_port_id });
    sources.add(key); tokens.add(token);
  }
  const storedValue = Object.prototype.hasOwnProperty.call(node.params, port.id) ? node.params[port.id] : undefined;
  const source: InputValueSource = formula ? "formula" : links.length ? "connections" : storedValue !== undefined ? "parameter"
    : port.default !== undefined && port.default !== null ? "default" : "unset";
  const connectedExpression = bindings.map((binding) => binding.token).join(" + ");
  const expression = source === "formula" ? formula!.expression.trim() || connectedExpression
    : source === "connections" ? connectedExpression : source === "parameter" ? literalText(storedValue!)
    : source === "default" ? literalText(port.default!) : "";
  const managedName = port.id === "sname" && graph.audio_interface?.groups.some((group) =>
    group.layout === "stereo" && node.opcode === (group.direction === "input" ? "inleta" : "outleta") &&
    typeof node.params.sname === "string" && group.ports.includes(node.params.sname));
  const mode: InputEditorMode = managedName ? "managed" : node.opcode === "zfilter2" && port.id === "icoeffs" ? "coefficients"
    : node.opcode === "maxalloc" && port.id === "icount" ? "number" : port.signal_type === "S" ? "string" : "expression";
  return { source, expression, bindings, storedValue, mode, highlighted: source === "formula" || source === "parameter" };
}

export type InputValueError = "number" | "connectedLiteral" | "specialized";
export function validateInputValue(state: InputValueState, expression: string): { isValid: boolean; errors: string[]; error?: InputValueError } {
  if (state.mode === "managed" || state.mode === "coefficients") return { isValid: false, errors: [], error: "specialized" };
  if (state.mode === "string" || state.mode === "number") {
    if (state.bindings.length) return { isValid: false, errors: [], error: "connectedLiteral" };
    if (state.mode === "string") return { isValid: true, errors: [] };
    return numericInputLiteral(expression) === null ? { isValid: false, errors: [], error: "number" } : { isValid: true, errors: [] };
  }
  if (!state.bindings.length && numericInputLiteral(expression) !== null) return { isValid: true, errors: [] };
  return validateGraphFormulaExpression(expression, new Set(state.bindings.map((binding) => binding.token)));
}

export function resetInputValue(graph: PatchGraph, nodeId: string, portId: string): PatchGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const params = { ...node.params }; delete params[portId];
      return { ...node, params };
    }),
    ui_layout: setInputFormulaConfig(graph.ui_layout, formulaTargetKey(nodeId, portId), null)
  };
}

export function saveInputValue(graph: PatchGraph, nodeId: string, port: PortSpec, expression: string): PatchGraph {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return graph;
  const state = resolveInputValue(graph, node, port);
  if (!validateInputValue(state, expression).isValid) return graph;
  const next = resetInputValue(graph, nodeId, port.id);
  const number = numericInputLiteral(expression);
  if (state.mode === "string" || (!state.bindings.length && number !== null)) {
    const value = state.mode === "string" ? expression : number!;
    next.nodes = next.nodes.map((item) => item.id === nodeId ? { ...item, params: { ...item.params, [port.id]: value } } : item);
  } else {
    next.ui_layout = setInputFormulaConfig(next.ui_layout, formulaTargetKey(nodeId, port.id), { expression: expression.trim(), inputs: state.bindings });
  }
  return next;
}
