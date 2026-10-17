import type { AudioDiagnostic, AudioFeedbackStep, AudioGraph, AudioRoutingEndpoint, PatchListItem, SequencerInstrumentBinding } from "../types";

/** The same raw/strip split as playback. An ordinary insert return is not a loop. */
export function audioFeedbackDiagnostics(bindings: SequencerInstrumentBinding[], patches: PatchListItem[], graph: AudioGraph, edges: [string, string][]): AudioDiagnostic[] {
  const adjacency = new Map<string, Set<string>>();
  for (const [source, target] of edges) {
    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)!.add(target);
  }
  // Tarjan traverses at most two stage nodes per instance, not one node per route.
  let index = 0;
  const indexes = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), components: Set<string>[] = [];
  const visit = (node: string) => {
    indexes.set(node, index); low.set(node, index++); stack.push(node); active.add(node);
    for (const next of [...adjacency.get(node)!].sort()) {
      if (!indexes.has(next)) { visit(next); low.set(node, Math.min(low.get(node)!, low.get(next)!)); }
      else if (active.has(next)) low.set(node, Math.min(low.get(node)!, indexes.get(next)!));
    }
    if (low.get(node) === indexes.get(node)) {
      const component = new Set<string>();
      let next: string;
      do { next = stack.pop()!; active.delete(next); component.add(next); } while (next !== node);
      if (component.size > 1 || adjacency.get(node)!.has(node)) components.push(component);
    }
  };
  [...adjacency.keys()].sort().forEach(node => { if (!indexes.has(node)) visit(node); });
  const stagePair = (route: AudioGraph["routes"][number]) => [
    `${route.sourceStage}:${route.sourceId}`, `${route.targetStage === "input" ? "raw" : "strip"}:${route.targetId}`
  ];
  const endpoint = (id: string, stage: AudioRoutingEndpoint["stage"], ports: string[]): AudioRoutingEndpoint => {
    const binding = bindings.find(b => b.id === id);
    return { id, name: id === "$master" ? "Master" : patches.find(p => p.id === binding?.patchId)?.name ?? id,
      midiChannel: binding?.midiChannel ?? 0, stage, ports, insertOwnerId: graph.insertOwners[id] };
  };
  return components.map(component => {
    const routes = graph.routes.filter(r => stagePair(r).every(n => component.has(n))).sort((a,b) => a.id.localeCompare(b.id));
    const first = routes[0];
    const [source, target] = stagePair(first);
    const parents = new Map<string, string | null>([[target, null]]), queue = [target];
    for (let i = 0; i < queue.length && !parents.has(source); i++) {
      for (const next of [...adjacency.get(queue[i])!].sort()) if (component.has(next) && !parents.has(next)) {
        parents.set(next, queue[i]); queue.push(next);
      }
    }
    const walk = [source];
    while (walk[walk.length - 1] !== target) walk.push(parents.get(walk[walk.length - 1])!);
    walk.reverse(); walk.unshift(source);
    const path: AudioFeedbackStep[] = [];
    for (let i = 0; i + 1 < walk.length; i++) {
      const matches = routes.filter(r => { const pair = stagePair(r); return pair[0] === walk[i] && pair[1] === walk[i + 1]; });
      if (!matches.length) continue; // Internal input → strip processing.
      const representative = i === 0 ? first : matches[0];
      const parallel = matches.filter(r => r.kind === representative.kind).sort((a,b) => a.sourcePort.localeCompare(b.sourcePort) || a.targetPort.localeCompare(b.targetPort) || a.id.localeCompare(b.id));
      path.push({ source: endpoint(representative.sourceId, representative.sourceStage, parallel.map(r => r.sourcePort)),
        target: endpoint(representative.targetId, representative.targetStage, parallel.map(r => r.targetPort)),
        kind: representative.kind, routeIds: parallel.map(r => r.id) });
    }
    return { code: "feedback", severity: "error" as const, message: "", instanceId: first.sourceId, routeId: first.id,
      routeIds: routes.map(r => r.id), instanceIds: [...new Set(routes.flatMap(r => [r.sourceId, r.targetId]))].sort(), routingPath: path };
  }).sort((a,b) => a.routeIds[0].localeCompare(b.routeIds[0]));
}
