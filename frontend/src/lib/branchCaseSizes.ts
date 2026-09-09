import type { JsonObject, PatchGraph } from "../types";

export type CaseSize = { width: number; height: number };
export type ControlFlowCaseSizes = Record<string, Record<string, CaseSize>>;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Presentation is optional: ignore malformed or orphaned entries on read. */
export function readCaseSizes(graph: Pick<PatchGraph, "ui_layout" | "control_flow">): ControlFlowCaseSizes {
  const raw = graph.ui_layout.control_flow_case_sizes;
  const result: ControlFlowCaseSizes = {};
  if (!object(raw)) return result;
  for (const [blockId, block] of Object.entries(graph.control_flow ?? {})) {
    const cases = raw[blockId]; if (!object(cases)) continue;
    for (const item of block.cases) {
      const size = cases[item.id];
      if (!object(size) || typeof size.width !== "number" || !Number.isFinite(size.width) || size.width <= 0 ||
        typeof size.height !== "number" || !Number.isFinite(size.height) || size.height <= 0) continue;
      (result[blockId] ??= {})[item.id] = { width: size.width, height: size.height };
    }
  }
  return result;
}

export function writeCaseSizes(layout: JsonObject, sizes: ControlFlowCaseSizes): JsonObject {
  const next = { ...layout };
  if (Object.keys(sizes).length) next.control_flow_case_sizes = sizes;
  else delete next.control_flow_case_sizes;
  return next;
}

export function pruneCaseSizes(graph: PatchGraph): PatchGraph {
  return { ...graph, ui_layout: writeCaseSizes(graph.ui_layout, readCaseSizes(graph)) };
}
