import { useAppStore } from "./useAppStore";
import { defaultControllerSequencer, defaultControllerSequencerPad } from "./appStoreModel";
import { mappedControls, automationCandidates, controllerToMidi, readAutomationTarget } from "../lib/clipArranger/automation";
import { arrangementTimings } from "../lib/clipArranger/migration";
import { validateArrangement, type ClipLane, type PatternDefinition } from "../lib/clipArranger/model";
import { commitClipArrangement } from "./clipActions";

export function generateAutomation(laneId: string, clipId: string, instrumentId: string) {
  const state = useAppStore.getState(), model = state.sequencer.clipArrangement;
  const source = model?.lanes.find(l => l.id === laneId), clip = source?.clips.find(c => c.id === clipId);
  const binding = automationCandidates(state.sequencer, laneId, state.sequencerInstruments, state.patches).find(b => b.id === instrumentId);
  if (!model || !clip || !binding) throw new Error("No mapped instrument for this clip.");
  const next = structuredClone(state.sequencer), arrangement = next.clipArrangement!;
  arrangement.version = arrangement.version === 3 ? 3 : 2;
  arrangement.revision++;
  const groups = new Map<number, ReturnType<typeof mappedControls>>();
  for (const control of mappedControls(binding, state.patches)) {
    const cc = binding.performanceControllerMidiCCs![control.node_id];
    groups.set(cc, [...groups.get(cc) ?? [], control]);
  }
  const patch = state.patches.find(p => p.id === binding.patchId)!;
  let created = 0, topology = false;
  for (const [cc, controls] of groups) {
    let track = next.controllerSequencers.find(t => t.automationTarget?.instrumentId === binding.id && !t.automationSuspended && t.controllerNumber === cc);
    const label = `${patch.name} · CC ${cc} · ${controls.map(d => d.label).join(", ")}`.slice(0, 128);
    let lane: ClipLane | undefined;
    if (!track) {
      track = { ...defaultControllerSequencer(next.controllerSequencers.length, next.timing), id: crypto.randomUUID(), name: label,
        controllerNumber: cc, targetChannels: [binding.midiChannel], automationTarget: { instrumentId: binding.id, controllerNodeIds: controls.map(d => d.node_id) },
        automationSuspended: false, padLoopEnabled: true, padLoopRepeat: false, enabled: true };
      next.controllerSequencers.push(track);
      lane = { id: track.id, source: "controller", definitions: [], clips: [], cycleTicks: null };
      const existing = arrangement.lanes.map((l, i) => next.controllerSequencers.find(t => t.id === l.id)?.automationTarget?.instrumentId === binding.id ? i : -1);
      const index = Math.max(arrangement.lanes.findIndex(l => l.id === laneId), ...existing);
      arrangement.lanes.splice(index + 1, 0, lane);
      topology = true;
    } else { const id = track.id; lane = arrangement.lanes.find(l => l.id === id); }
    if (!lane) throw new Error("Missing automation lane.");
    if (lane.clips.some(c => c.start === clip.start && c.length === clip.length)) continue;
    if (track.controllerMode !== "curve") throw new Error("Switch this automation lane to Curve Mode before generating another curve.");
    if (lane.clips.some(c => c.start < clip.start + clip.length && c.start + c.length > clip.start)) throw new Error("Automation overlaps an existing clip. Move or trim it before generating.");
    const first = controls[0], value = controllerToMidi(binding.performanceControllerValues?.[first.node_id] ?? first.default, first);
    const payload = { ...defaultControllerSequencerPad(4, track.timing), curveDurationTicks: clip.length,
      keypoints: [{ id: crypto.randomUUID(), position: 0, value }, { id: crypto.randomUUID(), position: 1, value }] };
    const definition: PatternDefinition = { kind: "pattern", source: "controller", id: crypto.randomUUID(), name: label, revision: 0, payload };
    lane.definitions.push(definition);
    lane.clips.push({ id: crypto.randomUUID(), name: label, start: clip.start, length: clip.length, offset: 0, mode: "once", children: [{ id: crypto.randomUUID(), definitionId: definition.id }] });
    created++;
  }
  if (!created) return;
  next.controllerSequencers.forEach(t => readAutomationTarget(t.automationTarget));
  validateArrangement(arrangement, arrangementTimings(next));
  if (topology) {
    next.clipHistory = undefined;
    useAppStore.setState({ sequencer: next, sequencerEditRevision: state.sequencerEditRevision + 1 });
  } else commitClipArrangement(arrangement, "Generate automation");
}

export function setAutomationCurveDuration(ticks: number) {
  const state = useAppStore.getState(), key = state.clipEditingKey, draft = key ? state.clipDrafts[key] : undefined;
  if (!key || !draft || draft.definition.kind !== "pattern" || draft.definition.source !== "controller") return;
  if (!state.sequencer.controllerSequencers.find(t => t.id === draft.target.laneId)?.automationTarget) return;
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 20160000000) return;
  const definition = { ...draft.definition, payload: { ...draft.definition.payload, curveDurationTicks: ticks } };
  useAppStore.setState({ clipDrafts: { ...state.clipDrafts, [key]: { ...draft, definition } } });
}
