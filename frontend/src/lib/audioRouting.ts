import type { AudioGraph, AudioInterface, AudioRoute, MixerState, MixerStrip, PatchListItem, SequencerInstrumentBinding } from "../types";

export const emptyAudioGraph = (): AudioGraph => ({ routes: [], masterId: null, insertOwners: {} });
export const emptyMixer = (): MixerState => ({ strips: {}, sends: {} });
export const defaultStrip = (): MixerStrip => ({ gainDb: 0, balance: 0, mute: false, solo: false });
export const legacyGainDb = (level?: number): number => 20 * Math.log10(Math.max(1, Math.min(10, level ?? 10)) / 10);
export const newRoute = (route: Omit<AudioRoute, "id">): AudioRoute => ({ ...route, id: crypto.randomUUID() });
export function outputPorts(patch?: PatchListItem): string[] {
  return [...(patch?.audio_outlet_names ?? []), ...(patch?.has_direct_output ? ["$direct.left", "$direct.right"] : [])];
}
export function mainPorts(patch: PatchListItem | undefined, direction: "input" | "output"): string[] {
  const info = patch?.audio_interface;
  const group = info?.groups.find((g) => g.id === (direction === "input" ? info.mainInput : info.mainOutput));
  return group?.ports ?? (direction === "input" ? patch?.audio_inlet_names ?? [] : outputPorts(patch));
}
export function stereoSide(name: string, names: string[]): "left" | "right" | null {
  const n = name.toLowerCase();
  if (n === "l" || n.endsWith("left") || (n.endsWith("l") && names.some((s) => s.toLowerCase() === n.slice(0, -1) + "r"))) return "left";
  if (n === "r" || n.endsWith("right") || (n.endsWith("r") && names.some((s) => s.toLowerCase() === n.slice(0, -1) + "l"))) return "right";
  return null;
}
/** This compatibility resolver is used only when upgrading an old document. */
export function legacyInlet(source: string, outlets: string[], inlets: string[]): string {
  if (inlets.includes(source)) return source;
  const side = stereoSide(source, outlets);
  const matching = side && (inlets.find((p) => p.toLowerCase() === side) ?? inlets.find((p) => p.toLowerCase() === side[0]));
  return matching || (outlets.length === inlets.length ? inlets[outlets.indexOf(source)] : undefined) || inlets[0] || "$missing";
}
/** Validate shape and scalars on import; keep unresolved references for repair. */
export function validateAudioState(graph: AudioGraph, mixer: MixerState): void {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  if (!object(graph) || !Array.isArray(graph.routes) || graph.routes.length > 1024 || !object(graph.insertOwners) || (graph.masterId != null && typeof graph.masterId !== "string")) throw new Error("Invalid audio graph");
  const ids = new Set<string>();
  for (const route of graph.routes) {
    if (!object(route) || [route.id, route.sourceId, route.sourcePort, route.targetId, route.targetPort].some((v) => typeof v !== "string" || !v || v.length > 128) || ids.has(route.id) || !["main", "send", "insert", "custom"].includes(route.kind) || !["raw", "strip"].includes(route.sourceStage) || !["input", "strip"].includes(route.targetStage)) throw new Error("Invalid or duplicate audio route");
    ids.add(route.id);
  }
  if (!object(mixer) || !object(mixer.strips) || !object(mixer.sends) || Object.keys(mixer.strips).length > 64 || Object.keys(mixer.sends).length > 1024) throw new Error("Invalid mixer state");
  const gain = (value: unknown, max: number) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= -60 && value <= max);
  for (const strip of Object.values(mixer.strips)) if (!object(strip) || !gain(strip.gainDb, 12) || !Number.isFinite(strip.balance) || Math.abs(strip.balance) > 1 || typeof strip.mute !== "boolean" || typeof strip.solo !== "boolean") throw new Error("Invalid mixer strip");
  for (const send of Object.values(mixer.sends)) if (!object(send) || !gain(send.gainDb, 6) || !["pre", "post"].includes(send.tap)) throw new Error("Invalid mixer send");
}
export function migrateAudio(bindings: SequencerInstrumentBinding[], patches: PatchListItem[], graph?: AudioGraph, mixer?: MixerState) {
  if (graph) validateAudioState(graph, mixer ?? emptyMixer());
  if (graph) return { audioGraph: structuredClone(graph), mixer: structuredClone(mixer ?? emptyMixer()), migrationNotice: false };
  const audioGraph = emptyAudioGraph();
  const result = emptyMixer();
  const byId = new Map(bindings.map((b) => [b.id, patches.find((p) => p.id === b.patchId)]));
  for (const binding of bindings) {
    result.strips[binding.id] = { ...defaultStrip(), gainDb: legacyGainDb(binding.level) };
    const routes = [...binding.effectRoutes];
    for (const sourceId of binding.effectSourceIds) {
      if (!routes.some((r) => r.sourceId === sourceId)) {
        for (const channel of byId.get(sourceId)?.audio_outlet_names ?? ["$missing"]) routes.push({ sourceId, channel });
      }
    }
    for (const route of routes) {
      const r = newRoute({ sourceId: route.sourceId, sourcePort: route.channel, targetId: binding.id,
        targetPort: legacyInlet(route.channel, byId.get(route.sourceId)?.audio_outlet_names ?? [], byId.get(binding.id)?.audio_inlet_names ?? []),
        kind: "custom", sourceStage: "strip", targetStage: "input" });
      audioGraph.routes.push(r);
      result.sends[r.id] = { gainDb: 0, tap: "post" };
    }
  }
  return { audioGraph, mixer: result, migrationNotice: bindings.length > 0 };
}
export function cleanBindings(bindings: SequencerInstrumentBinding[]) {
  return bindings.map((b) => ({ id: b.id, patchId: b.patchId, midiChannel: b.midiChannel }));
}
/** Display projection only. Editors always write the explicit graph. */
export function bindingsWithIncomingRoutes(bindings: SequencerInstrumentBinding[], graph: AudioGraph) {
  return bindings.map((binding) => ({ ...binding,
    effectSourceIds: [...new Set(graph.routes.filter((r) => r.targetId === binding.id).map((r) => r.sourceId))],
    effectRoutes: graph.routes.filter((r) => r.targetId === binding.id).map((r) => ({ sourceId: r.sourceId, channel: r.sourcePort }))
  }));
}
export function suggestedInterface(patch: PatchListItem): AudioInterface {
  const groups = (["input", "output"] as const).flatMap((direction) => {
    const ports = direction === "input" ? patch.audio_inlet_names : outputPorts(patch);
    const left = ports.find((p) => stereoSide(p, ports) === "left");
    const right = ports.find((p) => stereoSide(p, ports) === "right");
    return left && right ? [{ id: `${direction}-stereo`, name: `Stereo ${direction}`, direction, layout: "stereo" as const, ports: [left, right], purpose: "main" as const }] : [];
  });
  return { role: "custom", groups, mainInput: groups.find((g) => g.direction === "input")?.id, mainOutput: groups.find((g) => g.direction === "output")?.id };
}

/** Structural preview; backend resolution remains authoritative for playback/export. */
export function audioGraphDiagnostics(bindings: SequencerInstrumentBinding[], patches: PatchListItem[], graph: AudioGraph): import("../types").AudioDiagnostic[] {
  const byId = new Map(bindings.map((b) => [b.id, patches.find((p) => p.id === b.patchId)]));
  const result: import("../types").AudioDiagnostic[] = [];
  const edges: [string,string][] = [];
  for (const binding of bindings) {
    const patch = byId.get(binding.id);
    if (!patch) result.push({code:"missing_patch",severity:"error",instanceId:binding.id,message:binding.patchId});
    if (outputPorts(patch).some((p) => !graph.routes.some((r) => r.targetId === binding.id && r.targetStage === "strip" && r.targetPort === p))) edges.push([`raw:${binding.id}`,`strip:${binding.id}`]);
  }
  for (const route of graph.routes) {
    const source = byId.get(route.sourceId), target = byId.get(route.targetId);
    if (!source || !outputPorts(source).includes(route.sourcePort) || (route.targetId === "$output" ? !["left","right"].includes(route.targetPort) : !target || !(route.targetStage === "strip" ? outputPorts(target) : target.audio_inlet_names).includes(route.targetPort))) {
      result.push({code:"broken_route",severity:"error",instanceId:route.sourceId,routeId:route.id,message:`${route.sourcePort} → ${route.targetPort}`});
    }
    edges.push([`${route.sourceStage}:${route.sourceId}`,`${route.targetStage === "input" ? "raw" : "strip"}:${route.targetId}`]);
  }
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (done.has(node)) return false;
    visiting.add(node);
    const cycle = edges.filter(([from]) => from === node).some(([,to]) => visit(to));
    visiting.delete(node); done.add(node); return cycle;
  };
  if ([...byId.keys()].some((id) => visit(`raw:${id}`))) result.push({code:"feedback",severity:"error",message:""});
  return result;
}
