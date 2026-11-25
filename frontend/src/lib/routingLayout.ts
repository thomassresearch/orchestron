import type { AudioGraph, RoutingLayout, SequencerInstrumentBinding } from "../types";
import { MASTER } from "./audioRouting";

/** Layout is optional display metadata. Restore positions only for nodes in this performance. */
export function readRoutingLayout(raw: unknown, bindings: SequencerInstrumentBinding[], graph: AudioGraph): RoutingLayout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const ids = new Set([MASTER, "$output", ...bindings.map(b => b.id), ...Object.keys(graph.insertOwners), ...Object.values(graph.insertOwners)]);
  if (graph.masterId) ids.add(graph.masterId);
  for (const r of graph.routes) { ids.add(r.sourceId); ids.add(r.targetId); }
  const points: [string, { x: number; y: number }][] = [];
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const point = (raw as Record<string, unknown>)[id];
    if (!point || typeof point !== "object" || !("x" in point && "y" in point)) continue;
    const { x, y } = point;
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) &&
      Math.abs(x) <= 1e7 && Math.abs(y) <= 1e7) points.push([id, { x, y }]);
  }
  return Object.fromEntries(points);
}
