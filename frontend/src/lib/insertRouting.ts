import { MASTER, masterEndpoint, mainPorts, newRoute } from "./audioRouting";
import type { AudioGraph, MixerState, PatchListItem, SequencerInstrumentBinding } from "../types";

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
  // Only replace this owner's chain. A processor can have its own nested inserts.
  const routes = graph.routes.filter((r) => !(r.kind === "insert" && (
    (r.sourceId === owner && r.sourceStage === "raw" && involved.has(r.targetId) && r.targetStage === "input") ||
    (involved.has(r.sourceId) && r.sourceStage === "strip" && (
      (involved.has(r.targetId) && r.targetStage === "input") || (r.targetId === owner && r.targetStage === "strip")
    ))
  )));
  const patch = (id: string) => id === MASTER ? masterEndpoint : patches.find((p) => p.id === bindings.find((b) => b.id === id)?.patchId);
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

/** Explicit rack deletion removes dedicated inserts too, without rewriting custom paths. */
export function removeRackInstrument(
  graph: AudioGraph, mixer: MixerState, bindings: SequencerInstrumentBinding[], patches: PatchListItem[], id: string
) {
  const removed = new Set([id]);
  for (const owner of removed) {
    for (const [processor, parent] of Object.entries(graph.insertOwners)) {
      if (parent === owner && processor !== MASTER) removed.add(processor);
    }
  }
  let audioGraph = graph;
  const owner = graph.insertOwners[id];
  if (owner && !removed.has(owner)) {
    const chain = insertChain(graph, owner);
    if (chain) {
      try {
        audioGraph = wireInsertChain(graph, bindings, patches, owner, chain.filter(processor => !removed.has(processor)));
      } catch {
        // Changed/missing patch ports cannot be rewired safely. Keep surviving routes for repair.
      }
    }
  }
  const routes = audioGraph.routes.filter(route => !removed.has(route.sourceId) && !removed.has(route.targetId));
  const routeIds = new Set(routes.map(route => route.id));
  return {
    bindings: bindings.filter(binding => !removed.has(binding.id)),
    audioGraph: {
      ...audioGraph,
      masterId: audioGraph.masterId && removed.has(audioGraph.masterId) ? MASTER : audioGraph.masterId,
      routes,
      insertOwners: Object.fromEntries(Object.entries(audioGraph.insertOwners).filter(([processor, parent]) =>
        !removed.has(processor) && !removed.has(parent)))
    },
    mixer: {
      strips: Object.fromEntries(Object.entries(mixer.strips).filter(([strip]) => !removed.has(strip))),
      sends: Object.fromEntries(Object.entries(mixer.sends).filter(([route]) => routeIds.has(route)))
    }
  };
}
