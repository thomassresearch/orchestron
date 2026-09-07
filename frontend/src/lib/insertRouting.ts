import { mainPorts, newRoute } from "./audioRouting";
import type { AudioGraph, PatchListItem, SequencerInstrumentBinding } from "../types";

export function insertChain(graph: AudioGraph, owner: string): string[] | null {
  const owned = Object.keys(graph.insertOwners).filter((id) => graph.insertOwners[id] === owner);
  if (!owned.length) return [];
  const chain: string[] = [];
  let source = owner;
  while (chain.length < owned.length) {
    const next = [...new Set(graph.routes.filter((r) => r.kind === "insert" && r.sourceId === source && owned.includes(r.targetId) && !chain.includes(r.targetId)).map((r) => r.targetId))];
    if (next.length !== 1) return null;
    chain.push(next[0]); source = next[0];
  }
  if (graph.routes.some((r) => (owned.includes(r.sourceId) || owned.includes(r.targetId)) && r.kind !== "insert")) return null;
  if (!graph.routes.some((r) => r.sourceId === source && r.targetId === owner && r.targetStage === "strip")) return null;
  return chain;
}
export function wireInsertChain(graph: AudioGraph, bindings: SequencerInstrumentBinding[], patches: PatchListItem[], owner: string, chain: string[]): AudioGraph {
  const owned = Object.keys(graph.insertOwners).filter((id) => graph.insertOwners[id] === owner);
  const involved = new Set([...owned, ...chain]);
  const routes = graph.routes.filter((r) => !(r.kind === "insert" && (involved.has(r.sourceId) || involved.has(r.targetId))));
  const patch = (id: string) => patches.find((p) => p.id === bindings.find((b) => b.id === id)?.patchId);
  for (let i = 0; i <= chain.length && chain.length > 0; i++) {
    const sourceId = i === 0 ? owner : chain[i - 1];
    const targetId = i === chain.length ? owner : chain[i];
    const outputs = mainPorts(patch(sourceId), "output");
    const inputs = mainPorts(patch(targetId), i === chain.length ? "output" : "input");
    if (outputs.length !== inputs.length || !outputs.length) throw new Error("Insert requires explicit, matching main input and output groups.");
    outputs.forEach((sourcePort, index) => routes.push(newRoute({ sourceId, sourcePort, targetId, targetPort: inputs[index], kind: "insert", sourceStage: i === 0 ? "raw" : "strip", targetStage: i === chain.length ? "strip" : "input" })));
  }
  const insertOwners = { ...graph.insertOwners };
  for (const id of owned) delete insertOwners[id];
  for (const id of chain) insertOwners[id] = owner;
  return { ...graph, routes, insertOwners };
}
