import { describe, expect, it } from "vitest";
import { audioTemplate } from "./audioTemplates";
import { projectAudioBlocks } from "./audioBlocks";
import { emptyAudioGraph, defaultStrip, migrateAudio, validateAudioState } from "./audioRouting";
import { insertChain, wireInsertChain } from "./insertRouting";
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot, normalizePersistedSequencerInstruments } from "../store/appStoreModel";
import { useAppStore } from "../store/useAppStore";
import type { PatchListItem, SequencerInstrumentBinding } from "../types";
const source: PatchListItem = { id: "source", name: "Source", description: "", always_on: false, is_template: false, schema_version: 1, updated_at: "", audio_inlet_names: [], audio_outlet_names: ["dryl", "dryr"] };
const effect: PatchListItem = { ...source, id: "fx", always_on: true, audio_inlet_names: ["left", "right"], audio_outlet_names: ["left", "right"] };
const bindings: SequencerInstrumentBinding[] = [{ id: "one", patchId: "source", midiChannel: 1, level: 5, effectSourceIds: [], effectRoutes: [] }, { id: "two", patchId: "fx", midiChannel: 0, level: 8, effectSourceIds: ["one"], effectRoutes: [] }];
describe("performance audio persistence", () => {
  it.each([1,2,3,4,5,6,7,8,9,10])("upgrades version %i once with exact mappings and effect gain", (version) => {
    const parsed = parseSequencerConfigSnapshot({ version, instruments: bindings, sequencer: {} }, [source,effect], null);
    expect(parsed.mixer.strips.one.gainDb).toBeCloseTo(-6.0205999);
    expect(parsed.mixer.strips.two.gainDb).toBeCloseTo(-1.93820026);
    expect(parsed.audioGraph.routes.map((r) => [r.sourcePort,r.targetPort])).toEqual([["dryl","left"],["dryr","right"]]);
    const state = { strips: { ...parsed.mixer.strips, one: { ...defaultStrip(), gainDb: null, solo: true } }, sends: { [parsed.audioGraph.routes[0].id]: { gainDb: -3, tap: "pre" as const } } };
    const snapshot = buildSequencerConfigSnapshot(parsed.sequencer, parsed.instruments, parsed.audioGraph, state);
    expect(snapshot.version).toBe(12);
    expect(snapshot.instruments.every((b) => !("level" in b) && !("effectRoutes" in b) && !("effectSourceIds" in b))).toBe(true);
    const reloaded = parseSequencerConfigSnapshot(snapshot,[source,effect],null);
    expect(reloaded.mixer).toEqual(state); expect(reloaded.audioGraph).toEqual(parsed.audioGraph); expect(reloaded.migrationNotice).toBe(false);
  });
  it("preserves missing patch and port references for repair", () => {
    const b = normalizePersistedSequencerInstruments(bindings, [], null);
    expect(b).toHaveLength(2);
    expect(migrateAudio(b,[]).audioGraph.routes[0].targetPort).toBe("$missing");
  });
  it("rejects malformed mixer scalars without discarding routes", () => {
    expect(() => validateAudioState(emptyAudioGraph(), {strips:{one:{...defaultStrip(),gainDb:NaN}},sends:{}})).toThrow();
  });
  it("does not change authored velocity when adjusting gain", () => {
    const before = useAppStore.getState().sequencer;
    useAppStore.getState().setMixerStrip("one", {gainDb:-6});
    expect(useAppStore.getState().sequencer).toBe(before);
  });
});
describe("stereo blocks and inserts", () => {
  it("round-trips real nodes, wiring and formulas through collapsed blocks", () => {
    const graph = audioTemplate("effect").graph;
    const input = graph.nodes.find((n) => n.opcode === "inleta")!;
    const output = graph.nodes.find((n) => n.opcode === "outleta")!;
    graph.ui_layout.input_formulas = { [`${output.id}::asignal`]: { expression: "0.5 * in1", inputs: [{ token: "in1", from_node_id: input.id, from_port_id: "asignal" }] } };
    const projected = projectAudioBlocks(graph,{input:"Input",output:"Output"},[]);
    expect(projected.graph.nodes).toHaveLength(2);
    const restored = projected.restore(projected.graph);
    expect(restored.ui_layout).toEqual(graph.ui_layout);
    expect(restored.connections).toEqual(graph.connections);
    expect(restored.nodes.every((n) => ["inleta","outleta"].includes(n.opcode))).toBe(true);
  });
  it("creates dedicated insert chains and recognizes custom branches", () => {
    const b = [...bindings, {...bindings[1],id:"three"}];
    const graph = wireInsertChain(emptyAudioGraph(), b, [source,effect], "one", ["two","three"]);
    expect(insertChain(graph,"one")).toEqual(["two","three"]);
    expect(graph.routes.some((r) => r.sourceId === "three" && r.targetId === "one" && r.targetStage === "strip")).toBe(true);
    graph.routes.push({...graph.routes[0],id:"branch",kind:"custom"});
    expect(insertChain(graph,"one")).toBeNull();
  });
});
