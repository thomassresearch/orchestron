import type { SequencerInstrumentBinding } from "../types";

export function effectRouteKey(sourceId: string, channel: string): string {
  return `${sourceId}\u0000${channel}`;
}

export function effectRouteWouldCreateLoop(
  bindings: SequencerInstrumentBinding[],
  sinkBindingId: string,
  sourceBindingId: string
): boolean {
  const sinkId = sinkBindingId.trim();
  const sourceId = sourceBindingId.trim();
  if (!sinkId || !sourceId) {
    return false;
  }
  if (sinkId === sourceId) {
    return true;
  }

  const adjacency = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const routeSinkId = binding.id.trim();
    if (!routeSinkId) {
      continue;
    }
    for (const route of binding.effectRoutes) {
      const routeSourceId = route.sourceId.trim();
      if (!routeSourceId) {
        continue;
      }
      const targets = adjacency.get(routeSourceId) ?? new Set<string>();
      targets.add(routeSinkId);
      adjacency.set(routeSourceId, targets);
    }
  }

  const pending = [sinkId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === sourceId) {
      return true;
    }
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      pending.push(next);
    }
  }

  return false;
}
