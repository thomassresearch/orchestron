import type { AutomationTarget, ControllerSequencerState, PatchListItem, PerformanceControllerDefinition, SequencerInstrumentBinding, SequencerState } from "../../types";
import { CLIP_LIMITS, ClipError, type ClipLane } from "./model";
import { arrangementTimings, sourceKeys } from "./migration";
import { validateArrangement } from "./model";

export const AUTOMATION_POINT_LIMIT = 10;

export function readAutomationTarget(raw: unknown): AutomationTarget | undefined {
  if (raw === undefined) return undefined;
  const target = raw as AutomationTarget;
  if (!target || typeof target.instrumentId !== "string" || !target.instrumentId || target.instrumentId.length > 128 ||
      !Array.isArray(target.controllerNodeIds) || !target.controllerNodeIds.length || target.controllerNodeIds.length > 256 ||
      target.controllerNodeIds.some(id => typeof id !== "string" || !id || id.length > 256) || new Set(target.controllerNodeIds).size !== target.controllerNodeIds.length) {
    throw new ClipError("invalid", "Invalid automation target.");
  }
  return { instrumentId: target.instrumentId, controllerNodeIds: [...target.controllerNodeIds] };
}

export function mappedControls(binding: SequencerInstrumentBinding, patches: PatchListItem[]) {
  const patch = patches.find(p => p.id === binding.patchId);
  if (!patch || patch.always_on || binding.midiChannel < 1 || binding.midiChannel > 16) return [];
  return (patch.performance_controllers ?? []).filter(d => !d.error && Number.isInteger(binding.performanceControllerMidiCCs?.[d.node_id]) &&
    binding.performanceControllerMidiCCs![d.node_id] >= 1 && binding.performanceControllerMidiCCs![d.node_id] <= 50);
}

export function automationCandidates(state: SequencerState, laneId: string, bindings: SequencerInstrumentBinding[], patches: PatchListItem[]) {
  const lane = state.clipArrangement?.lanes.find(l => l.id === laneId);
  if (!lane || lane.source === "controller") return [];
  const track = state[sourceKeys[lane.source]].find(t => t.id === laneId);
  let channel = track && ("targetChannel" in track ? track.targetChannel : "midiChannel" in track ? track.midiChannel : null);
  const arp = state.arpeggiators.find(a => a.inputChannel === channel && a.enabled && a.processingMode !== "mute");
  if (arp) channel = arp.targetChannel;
  return bindings.filter(b => b.midiChannel === channel && mappedControls(b, patches).length);
}

export function controllerToMidi(value: number, definition: PerformanceControllerDefinition): number {
  if (definition.controller_type === "bool") return value >= .5 ? 127 : 0;
  const fraction = definition.scale === "logarithmic"
    ? (Math.log(Math.max(definition.min, value)) - Math.log(definition.min)) / (Math.log(definition.max) - Math.log(definition.min))
    : (value - definition.min) / (definition.max - definition.min);
  return Math.max(0, Math.min(127, Math.round(fraction * 127)));
}

/** Routing is derived even after loading or removing a rack instance. Never broadcast a missing target. */
export function automationRouting(track: ControllerSequencerState, bindings: SequencerInstrumentBinding[], patches: PatchListItem[]) {
  const target = track.automationTarget;
  if (!target) return track;
  const binding = bindings.find(b => b.id === target.instrumentId);
  const controls = binding ? mappedControls(binding, patches).filter(d => target.controllerNodeIds.includes(d.node_id)) : [];
  const ccs = new Set(controls.map(d => binding!.performanceControllerMidiCCs![d.node_id]));
  const suspended = ccs.size !== 1 || controls.length !== target.controllerNodeIds.length;
  const cc = suspended ? track.controllerNumber : [...ccs][0];
  const channels = binding && binding.midiChannel > 0 ? [binding.midiChannel] : track.targetChannels.slice(0, 1);
  const patch = patches.find(p => p.id === binding?.patchId);
  const name = !suspended && patch ? `${patch.name} · CC ${cc} · ${controls.map(d => d.label).join(", ")}`.slice(0, 128) : track.name;
  if (track.name === name && track.controllerNumber === cc && track.automationSuspended === suspended && JSON.stringify(track.targetChannels) === JSON.stringify(channels)) return track;
  return { ...track, name, controllerNumber: cc, targetChannels: channels, automationSuspended: suspended };
}

export class AutomationMergeConflict extends Error {
  constructor(public key: string, public candidates: { track: ControllerSequencerState; lane: ClipLane }[]) {
    super("Choose the automation to retain for the merged MIDI CC.");
  }
}
type AutomationEntry = { track: ControllerSequencerState; lane: ClipLane; sourceId: string };

function cloneLane(lane: ClipLane, id: string): ClipLane {
  const ids = new Map<string, string>([[lane.id, id]]);
  const collect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if ("id" in value && typeof value.id === "string" && !ids.has(value.id)) ids.set(value.id, crypto.randomUUID());
    Object.values(value).forEach(collect);
  };
  collect(lane);
  return JSON.parse(JSON.stringify(lane, (key, value) => (key === "id" || key === "definitionId") ? ids.get(value) ?? value : value));
}

function music(track: ControllerSequencerState, lane: ClipLane): string {
  const ids = new Map(lane.definitions.map((d, i) => [d.id, i]));
  return JSON.stringify({ mode: track.controllerMode, reset: track.resetValue, timing: track.timing, definitions: lane.definitions,
    clips: lane.clips, cycle: lane.cycleTicks }, (key, value) => key === "definitionId" ? ids.get(value) : ["id", "name", "revision", "color"].includes(key) ? undefined : value);
}

/** Reconcile by controller identity. Splits copy music; merges require an explicit survivor if music differs. */
export function reconcileAutomation(state: SequencerState, bindings: SequencerInstrumentBinding[], patches: PatchListItem[], choices: Record<string, string> = {}): SequencerState {
  const model = state.clipArrangement;
  if (!model || !state.controllerSequencers.some(t => t.automationTarget)) return state;
  const grouped = new Map<string, AutomationEntry[]>();
  const originals = new Set<string>();
  for (const track of state.controllerSequencers) {
    const target = track.automationTarget, lane = model.lanes.find(l => l.id === track.id);
    if (!target || !lane) continue;
    originals.add(track.id);
    const binding = bindings.find(b => b.id === target.instrumentId);
    const valid = new Set(binding ? mappedControls(binding, patches).map(d => d.node_id) : []);
    const partitions = new Map<number | null, string[]>();
    for (const id of target.controllerNodeIds) {
      const cc = valid.has(id) ? binding!.performanceControllerMidiCCs![id] : null;
      partitions.set(cc, [...partitions.get(cc) ?? [], id]);
    }
    let first = true;
    for (const [cc, nodes] of partitions) {
      let id = first ? track.id : `${track.id.slice(0, 90)}:split:${cc ?? "off"}`;
      // Stable across merge-dialog retries, unique even after repeated split/merge cycles.
      if (!first) { const base = id; let suffix = 1; while (state.controllerSequencers.some(t => t.id === id)) id = `${base}:${suffix++}`; }
      const nextTrack = automationRouting({ ...track, id, automationTarget: { ...target, controllerNodeIds: nodes } }, bindings, patches);
      const nextLane = first ? lane : cloneLane(lane, id);
      const key = cc === null ? `${target.instrumentId}:off:${id}` : `${target.instrumentId}:${cc}`;
      grouped.set(key, [...grouped.get(key) ?? [], { track: nextTrack, lane: nextLane, sourceId: track.id }]);
      first = false;
    }
  }
  const resolved: AutomationEntry[] = [];
  for (const [key, entries] of grouped) {
    let chosen = entries[0];
    if (entries.length > 1 && entries.some(e => music(e.track, e.lane) !== music(chosen.track, chosen.lane))) {
      const selection = entries.find(e => e.track.id === choices[key]);
      if (!selection) throw new AutomationMergeConflict(key, entries);
      chosen = selection;
    }
    const target = chosen.track.automationTarget!;
    const binding = bindings.find(b => b.id === target.instrumentId);
    const nodes = [...new Set(entries.flatMap(e => e.track.automationTarget!.controllerNodeIds))];
    if (binding && !chosen.track.automationSuspended) for (const d of mappedControls(binding, patches)) {
      if (binding.performanceControllerMidiCCs![d.node_id] === chosen.track.controllerNumber && !nodes.includes(d.node_id)) nodes.push(d.node_id);
    }
    resolved.push({ ...chosen, track: automationRouting({ ...chosen.track, automationTarget: { ...target, controllerNodeIds: nodes } }, bindings, patches) });
  }
  const tracks = state.controllerSequencers.flatMap(t => originals.has(t.id) ? resolved.filter(e => e.sourceId === t.id).map(e => e.track) : [t]);
  const lanes: ClipLane[] = [];
  const remaining = [...resolved];
  for (const lane of model.lanes) {
    if (!originals.has(lane.id)) { lanes.push(lane); continue; }
    const matching = remaining.filter(e => e.track.id === lane.id || e.track.automationTarget!.instrumentId === state.controllerSequencers.find(t => t.id === lane.id)?.automationTarget?.instrumentId);
    for (const entry of matching) { lanes.push(entry.lane); remaining.splice(remaining.indexOf(entry), 1); }
  }
  lanes.push(...remaining.map(e => e.lane));
  if (lanes.length > CLIP_LIMITS.lanes) throw new ClipError("limit", "Automation exceeds the 72-lane arranger limit.");
  const sameLanes = JSON.stringify(lanes) === JSON.stringify(model.lanes);
  if (JSON.stringify(tracks) === JSON.stringify(state.controllerSequencers) && sameLanes) return state;
  const next = { ...state, controllerSequencers: tracks, clipArrangement: sameLanes ? model : { ...model, revision: model.revision + 1, lanes }, clipHistory: sameLanes ? state.clipHistory : undefined };
  validateArrangement(next.clipArrangement, arrangementTimings(next));
  return next;
}
