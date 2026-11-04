import { beforeEach, expect, it } from "vitest";
import fixture from "../../../backend/tests/fixtures/sequencers/instrument_automation.json";
import { useAppStore } from "./useAppStore";
import { generateAutomation, setAutomationCurveDuration } from "./automationActions";
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot, buildPersistedAppStateSnapshot } from "./appStoreModel";
import { migrateClipArrangement, arrangementTimings } from "../lib/clipArranger/migration";
import { automationCandidates, AutomationMergeConflict, reconcileAutomation } from "../lib/clipArranger/automation";
import { runtimeSchedule, clipRuntimeView } from "../lib/clipArranger/runtime";
import { openClipEditor, saveClipDraft } from "./clipActions";
import { audioTemplate } from "../lib/audioTemplates";
import { toPatchListItem } from "../lib/patchCatalog";
import type { PerformanceControllerDefinition } from "../types";
import { contentLength, validateArrangement } from "../lib/clipArranger/model";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const patch = { ...toPatchListItem(audioTemplate("empty")), id: "synth", name: "Test synth", performance_controllers: fixture.controls as PerformanceControllerDefinition[] };
  const state = structuredClone(useAppStore.getState().sequencer);
  state.tracks = [state.tracks[0]];
  state.tracks[0].midiChannel = 3;
  state.tracks[0].padLoopEnabled = true;
  state.tracks[0].padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }];
  state.clipArrangement = migrateClipArrangement(state).model!;
  state.clipArrangement.end = fixture.durationTicks;
  state.clipArrangement.lanes[0].clips[0].length = fixture.durationTicks;
  useAppStore.setState({ sequencer: state, patches: [patch], sequencerInstruments: [{ id: "rack", patchId: "synth", midiChannel: 3, level: 1, effectRoutes: [], effectSourceIds: [], performanceControllerMidiCCs: fixture.mappings }] });
});
function generate() {
  const source = useAppStore.getState().sequencer.clipArrangement!.lanes[0];
  generateAutomation(source.id, source.clips[0].id, "rack");
}

it("generates one independent song-length clip per CC at the current rack value and is idempotent", () => {
  generate();
  const state = useAppStore.getState().sequencer;
  expect(state.controllerSequencers.map(t => [t.controllerNumber, t.targetChannels])).toEqual([[21, [3]], [22, [3]]]);
  expect(state.controllerSequencers[0].automationTarget?.controllerNodeIds).toEqual(["cutoff", "resonance"]);
  const lane = state.clipArrangement!.lanes[1];
  expect(lane.clips[0]).toMatchObject({ start: 0, length: fixture.durationTicks, mode: "once", offset: 0 });
  expect(lane.definitions[0]).toMatchObject({ payload: { curveDurationTicks: fixture.durationTicks, keypoints: [{ value: 72 }, { value: 72 }] } });
  expect(runtimeSchedule(state, lane).clips[0].content[0].length).toBe(fixture.durationTicks);
  generate();
  expect(useAppStore.getState().sequencer).toBe(state);
});

it("rejects overlapping generation atomically", () => {
  generate();
  const state = structuredClone(useAppStore.getState().sequencer);
  state.clipArrangement!.lanes[1].clips[0].length -= 20160;
  useAppStore.setState({ sequencer: state });
  expect(generate).toThrow(/overlap/);
  expect(useAppStore.getState().sequencer).toBe(state);
});

it("keeps more than 16 bound lanes through performance and app-state round trips", () => {
  const s = useAppStore.getState(), controls = Array.from({ length: 20 }, (_, i) => ({ ...fixture.controls[0], node_id: `control-${i}` })) as PerformanceControllerDefinition[];
  useAppStore.setState({ patches: [{ ...s.patches[0], performance_controllers: controls }], sequencerInstruments: [{ ...s.sequencerInstruments[0], performanceControllerMidiCCs: Object.fromEntries(controls.map((c, i) => [c.node_id, i + 1])) }] });
  generate();
  const state = useAppStore.getState();
  const snapshot = buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
  expect(snapshot.version).toBe(24);
  const restored = parseSequencerConfigSnapshot(snapshot, state.patches, null).sequencer;
  expect(restored.controllerSequencers).toHaveLength(20);
  expect(restored.controllerSequencers.every(t => t.automationTarget)).toBe(true);
  expect(restored.clipArrangement).toEqual(state.sequencer.clipArrangement);
  expect(buildPersistedAppStateSnapshot(state).version).toBe(6);
});

it("locks routing, follows rack channels and suspends missing instances", () => {
  generate();
  const s = useAppStore.getState(), id = s.sequencer.controllerSequencers[0].id;
  s.setControllerSequencerNumber(id, 49); s.setControllerSequencerTargetChannels(id, [4, 5]);
  expect(useAppStore.getState().sequencer.controllerSequencers[0]).toMatchObject({ controllerNumber: 21, targetChannels: [3] });
  useAppStore.setState({ sequencerInstruments: [{ ...s.sequencerInstruments[0], midiChannel: 7 }] });
  expect(useAppStore.getState().sequencer.controllerSequencers[0].targetChannels).toEqual([7]);
  useAppStore.setState({ sequencerInstruments: [] });
  expect(useAppStore.getState().sequencer.controllerSequencers.every(t => t.automationSuspended)).toBe(true);
});

it("splits by control identity and requires a survivor for different merged music", () => {
  generate();
  const s = useAppStore.getState(), binding = s.sequencerInstruments[0];
  const splitBindings = [{ ...binding, performanceControllerMidiCCs: { ...fixture.mappings, resonance: 23 } }];
  const split = reconcileAutomation(s.sequencer, splitBindings, s.patches);
  expect(split.controllerSequencers.map(t => t.controllerNumber).sort()).toEqual([21, 22, 23]);
  const lane = split.clipArrangement!.lanes.find(l => split.controllerSequencers.find(t => t.id === l.id)?.controllerNumber === 23)!;
  const pattern = lane.definitions[0];
  if (pattern.kind === "pattern" && pattern.source === "controller") pattern.payload.keypoints[0].value = 90;
  expect(() => reconcileAutomation(split, [binding], s.patches)).toThrow(AutomationMergeConflict);
  const merged = reconcileAutomation(split, [binding], s.patches, { "rack:21": lane.id });
  expect(merged.controllerSequencers).toHaveLength(2);
  expect(merged.clipArrangement!.lanes.find(l => l.id === lane.id)?.definitions[0]).toMatchObject({ payload: { keypoints: [{ value: 90 }, { value: 72 }] } });
  validateArrangement(merged.clipArrangement!, arrangementTimings(merged));
});

it("keeps Off controls suspended and restores them on reassignment", () => {
  generate();
  const s = useAppStore.getState(), binding = s.sequencerInstruments[0];
  const off = reconcileAutomation(s.sequencer, [{ ...binding, performanceControllerMidiCCs: { accent: 22 } }], s.patches);
  expect(off.controllerSequencers.find(t => t.controllerNumber === 21)?.automationSuspended).toBe(true);
  const restored = reconcileAutomation(off, [binding], s.patches);
  expect(restored.controllerSequencers.every(t => !t.automationSuspended)).toBe(true);
});

it("limits draft points to ten and preserves independent curve/step lengths and cells", () => {
  generate();
  const s = useAppStore.getState(), lane = s.sequencer.clipArrangement!.lanes[1], clip = lane.clips[0];
  openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 });
  for (let i = 1; i <= 12; i++) useAppStore.getState().addControllerSequencerKeypoint(lane.id, i / 14, i);
  setAutomationCurveDuration(20160 * 1024);
  const state = useAppStore.getState(), draft = state.clipDrafts[state.clipEditingKey!];
  expect(draft.definition).toMatchObject({ payload: { keypoints: expect.any(Array), curveDurationTicks: 20160 * 1024 } });
  if (draft.definition.kind === "pattern" && draft.definition.source === "controller") expect(draft.definition.payload.keypoints).toHaveLength(10);
  expect(state.sequencer.clipArrangement).toBe(s.sequencer.clipArrangement);
  saveClipDraft("all", "Sweep");
  useAppStore.getState().setControllerSequencerMode(lane.id, "step");
  const step = useAppStore.getState().sequencer;
  const stepLane = step.clipArrangement!.lanes[1];
  expect(contentLength(stepLane, stepLane.clips[0].children, arrangementTimings(step)[lane.id])).toBe(4 * 20160);
  expect(clipRuntimeView(step).controllerSequencers[0].pads[0].steps).toHaveLength(128);
  useAppStore.getState().setControllerSequencerMode(lane.id, "curve");
  const curve = useAppStore.getState().sequencer;
  expect(runtimeSchedule(curve, curve.clipArrangement!.lanes[1]).clips[0].content[0].length).toBe(20160 * 1024);
});

it("resolves only eligible instruments on the source output channel", () => {
  const state = useAppStore.getState(), lane = state.sequencer.clipArrangement!.lanes[0];
  expect(automationCandidates(state.sequencer, lane.id, state.sequencerInstruments, state.patches).map(b => b.id)).toEqual(["rack"]);
  expect(automationCandidates(state.sequencer, lane.id, state.sequencerInstruments, [{ ...state.patches[0], always_on: true }])).toEqual([]);
});

it("rejects generation over the lane limit without partially adding lanes", () => {
  const s = useAppStore.getState(), seq = structuredClone(s.sequencer), source = seq.clipArrangement!.lanes[0];
  for (let i = 1; i < 71; i++) seq.clipArrangement!.lanes.push({ ...source, id: `empty-${i}`, definitions: [], clips: [] });
  useAppStore.setState({ sequencer: seq });
  expect(generate).toThrow(/lanes/i);
  expect(useAppStore.getState().sequencer).toBe(seq);
});

it("keeps automation when its source lane is deleted", async () => {
  generate();
  const { removeClipLane } = await import("./clipActions");
  const s = useAppStore.getState().sequencer;
  removeClipLane(s.clipArrangement!.lanes[0].id);
  expect(useAppStore.getState().sequencer.controllerSequencers).toEqual(s.controllerSequencers);
  expect(useAppStore.getState().sequencer.clipArrangement!.lanes).toHaveLength(2);
});

it.each(["drummer", "score", "arpeggiator"] as const)("generates automation from %s clips and exposes multiple matching rack instances", source => {
  const s = useAppStore.getState(), seq = structuredClone(s.sequencer);
  const lane = seq.clipArrangement!.lanes[0];
  lane.source = source;
  const track = { ...seq.tracks[0], ...(source === "arpeggiator" ? { targetChannel: 3 } : { midiChannel: 3 }) };
  // The generator only reads source routing; empty definitions avoid unrelated editor data.
  lane.definitions = []; lane.clips[0].children = [{ id: "source-rest", restTicks: lane.clips[0].length }];
  Object.assign(seq, { [source === "drummer" ? "drummerTracks" : source === "score" ? "scoreTracks" : "arpeggiators"]: [track] });
  const bindings = [...s.sequencerInstruments, { ...s.sequencerInstruments[0], id: "second" }];
  useAppStore.setState({ sequencer: seq, sequencerInstruments: bindings });
  expect(automationCandidates(seq, lane.id, bindings, s.patches)).toHaveLength(2);
  generateAutomation(lane.id, lane.clips[0].id, "second");
  expect(useAppStore.getState().sequencer.controllerSequencers.every(t => t.automationTarget?.instrumentId === "second")).toBe(true);
});

it("cancels conflicting merges without changing mapping or music", async () => {
  const { useAutomationMerge } = await import("../lib/clipArranger/automationMerge");
  generate();
  const s = useAppStore.getState();
  s.setPerformanceControllerMidiCC("rack", "resonance", 23);
  await s.flushPerformanceControllers();
  const seq = structuredClone(useAppStore.getState().sequencer);
  const track = seq.controllerSequencers.find(t => t.controllerNumber === 23)!;
  const def = seq.clipArrangement!.lanes.find(l => l.id === track.id)!.definitions[0];
  if (def.kind === "pattern" && def.source === "controller") def.payload.keypoints[0].value = 111;
  useAppStore.setState({ sequencer: seq });
  const before = useAppStore.getState();
  before.setPerformanceControllerMidiCC("rack", "resonance", 21);
  await Promise.resolve(); await Promise.resolve();
  expect(useAutomationMerge.getState().conflict).toBeTruthy();
  useAutomationMerge.getState().resolve!(null);
  await before.flushPerformanceControllers();
  expect(useAppStore.getState().sequencer).toBe(before.sequencer);
  expect(useAppStore.getState().sequencerInstruments).toBe(before.sequencerInstruments);
});

it("separates removed controls into suspended lanes without losing their music", () => {
  generate();
  const s = useAppStore.getState();
  useAppStore.setState({ patches: s.patches.map(p => ({ ...p, performance_controllers: p.performance_controllers!.filter(c => c.node_id !== "resonance") })) });
  const seq = useAppStore.getState().sequencer;
  const suspended = seq.controllerSequencers.find(t => t.automationSuspended)!;
  expect(suspended.automationTarget?.controllerNodeIds).toEqual(["resonance"]);
  expect(seq.clipArrangement!.lanes.find(l => l.id === suspended.id)?.definitions[0]).toMatchObject({ payload: { keypoints: [{ value: 72 }, { value: 72 }] } });
  expect(seq.controllerSequencers.find(t => t.controllerNumber === 21 && !t.automationSuspended)?.automationTarget?.controllerNodeIds).toEqual(["cutoff"]);
});

it("preserves generic controller delivery order when bound mappings change", () => {
  generate();
  const s = useAppStore.getState(), seq = structuredClone(s.sequencer);
  const generic = { ...seq.controllerSequencers[0], id: "generic", automationTarget: undefined };
  seq.controllerSequencers.push(generic);
  seq.clipArrangement!.lanes.push({ id: generic.id, source: "controller", definitions: [], clips: [], cycleTicks: null });
  const next = reconcileAutomation(seq, [{ ...s.sequencerInstruments[0], performanceControllerMidiCCs: { ...fixture.mappings, accent: 24 } }], s.patches);
  expect(next.controllerSequencers.map(t => t.id)).toEqual(seq.controllerSequencers.map(t => t.id));
});
