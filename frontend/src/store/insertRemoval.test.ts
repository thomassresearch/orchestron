import { afterEach, expect, it } from "vitest";
import { emptyAudioGraph, defaultStrip, MASTER, newRoute } from "../lib/audioRouting";
import { insertChain, wireInsertChain } from "../lib/insertRouting";
import { useAppStore } from "./useAppStore";
import type { AudioGraph, PatchListItem } from "../types";

const source: PatchListItem = {
  id: "source-patch", name: "Source", description: "", always_on: false, instrument_type: "melody",
  is_template: false, schema_version: 1, updated_at: "", audio_inlet_names: [], audio_outlet_names: ["left", "right"]
};
const effect: PatchListItem = { ...source, id: "effect-patch", name: "Effect", always_on: true, instrument_type: "continuous", audio_inlet_names: ["left", "right"] };
const bindings = ["source", "first", "second", "nested", "return"].map((id, index) => ({
  id, patchId: index ? effect.id : source.id, midiChannel: index ? 0 : 1, level: 10, effectRoutes: [], effectSourceIds: []
}));
const output = newRoute({ sourceId: "source", sourcePort: "left", targetId: MASTER, targetPort: "left", kind: "main", sourceStage: "strip", targetStage: "input" });
const send = newRoute({ ...output, targetId: "return", kind: "send" });
const sendValue = { gainDb: -12, tap: "pre" as const };

function setup(graph?: AudioGraph) {
  graph ??= wireInsertChain({ ...emptyAudioGraph(), routes: [output, send] }, bindings, [source, effect], "source", ["first", "second"]);
  useAppStore.setState({
    patches: [source, effect], sequencerInstruments: bindings, audioGraph: graph, activeSessionState: "idle",
    mixer: { strips: Object.fromEntries([...bindings.map(b => b.id), MASTER].map(id => [id, defaultStrip()])), sends: { [send.id]: sendValue } }
  });
}
afterEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

it("removes an owner and its nested inserts atomically, preserving the independent return and Master", () => {
  setup();
  const graph = wireInsertChain(useAppStore.getState().audioGraph, bindings, [source, effect], "first", ["nested"]);
  setup(graph);
  let updates = 0;
  const unsubscribe = useAppStore.subscribe(() => updates++);
  useAppStore.getState().removeSequencerInstrument("source");
  unsubscribe();
  const state = useAppStore.getState();
  expect(updates).toBe(1);
  expect(state.sequencerInstruments.map(b => b.id)).toEqual(["return"]);
  expect(state.audioGraph).toEqual(emptyAudioGraph());
  expect(Object.keys(state.mixer.strips)).toEqual(["return", MASTER]);
  expect(state.mixer.sends).toEqual({});
});

it.each(["first", "second"])("reconnects a simple chain when %s is removed through the rack", id => {
  setup();
  const remaining = id === "first" ? "second" : "first";
  const graph = wireInsertChain(useAppStore.getState().audioGraph, bindings, [source, effect], remaining, ["nested"]);
  setup(graph);
  useAppStore.getState().removeSequencerInstrument(id);
  const state = useAppStore.getState();
  expect(insertChain(state.audioGraph, "source")).toEqual([remaining]);
  expect(insertChain(state.audioGraph, remaining)).toEqual(["nested"]);
  expect(state.audioGraph.insertOwners).toEqual({ [remaining]: "source", nested: remaining });
  expect(state.audioGraph.routes).toContainEqual(output);
  expect(state.audioGraph.routes).toContainEqual(send);
  expect(state.audioGraph.routes.some(r => r.sourceId === id || r.targetId === id)).toBe(false);
  expect(state.mixer.sends).toEqual({ [send.id]: sendValue });
  expect(state.mixer.strips[remaining]).toEqual(defaultStrip());
  expect(state.mixer.strips[id]).toBeUndefined();
});

it("removes the last Master insert without removing Master or its controls", () => {
  setup(wireInsertChain(emptyAudioGraph(), bindings, [source, effect], MASTER, ["first"]));
  useAppStore.getState().removeSequencerInstrument("first");
  const state = useAppStore.getState();
  expect(state.audioGraph).toEqual(emptyAudioGraph());
  expect(state.mixer.strips[MASTER]).toEqual(defaultStrip());
});

it("preserves custom paths between surviving instances while cleaning removed references", () => {
  setup();
  const graph = useAppStore.getState().audioGraph;
  const branch = newRoute({ ...send, sourceId: "first", kind: "custom" });
  const survivor = newRoute({ ...send, sourceId: "second", kind: "custom" });
  setup({ ...graph, routes: [...graph.routes, branch, survivor] });
  useAppStore.getState().removeSequencerInstrument("first");
  const state = useAppStore.getState();
  expect(state.audioGraph.routes).toEqual([...graph.routes, branch, survivor].filter(r => r.sourceId !== "first" && r.targetId !== "first"));
  expect(state.audioGraph.insertOwners).toEqual({ second: "source" });
  expect(state.sequencerInstruments.some(b => b.id === "second")).toBe(true);
});

it("still cleans ownership when changed patch ports prevent chain rewiring", () => {
  setup();
  useAppStore.setState({ patches: [source, { ...effect, audio_inlet_names: ["mono"] }] });
  useAppStore.getState().removeSequencerInstrument("first");
  const state = useAppStore.getState();
  expect(state.audioGraph.insertOwners).toEqual({ second: "source" });
  expect(state.audioGraph.routes.some(r => r.sourceId === "first" || r.targetId === "first")).toBe(false);
});

it("cleans only the removed return's routes and send values", () => {
  setup();
  useAppStore.getState().removeSequencerInstrument("return");
  const state = useAppStore.getState();
  expect(insertChain(state.audioGraph, "source")).toEqual(["first", "second"]);
  expect(state.audioGraph.routes).toContainEqual(output);
  expect(state.audioGraph.routes).not.toContainEqual(send);
  expect(state.mixer.sends).toEqual({});
});

it("does not remove rack instances while running", () => {
  setup();
  useAppStore.setState({ activeSessionState: "running" });
  const before = useAppStore.getState();
  before.removeSequencerInstrument("source");
  expect(useAppStore.getState()).toBe(before);
});
