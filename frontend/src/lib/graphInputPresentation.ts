import { readInputFormulaMap, type InputFormulaConfig } from "./graphFormula";
import type { PatchGraph } from "../types";

export function inputFormulasByNode(layout: PatchGraph["ui_layout"]): Map<string, Array<[string, InputFormulaConfig]>> {
  const byNode = new Map<string, Array<[string, InputFormulaConfig]>>();
  for (const entry of Object.entries(readInputFormulaMap(layout))) {
    // Match the existing node-id prefix rule, including imported IDs containing "::".
    for (let separator = entry[0].indexOf("::"); separator >= 0; separator = entry[0].indexOf("::", separator + 1)) {
      const nodeId = entry[0].slice(0, separator);
      const entries = byNode.get(nodeId) ?? [];
      entries.push(entry);
      byNode.set(nodeId, entries);
    }
  }
  return byNode;
}

export function nodeInputPresentation(nodes: PatchGraph["nodes"], formulas: ReturnType<typeof inputFormulasByNode>): Map<string, string> {
  return new Map(nodes.map(node => [node.id, JSON.stringify([node.params, formulas.get(node.id) ?? []])]));
}
