// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { api } from "../api/client";
import { audioTemplate } from "../lib/audioTemplates";
import { toPatchListItem } from "../lib/patchCatalog";
import { MASTER, emptyAudioGraph, audioGraphDiagnostics, defaultStrip } from "../lib/audioRouting";
import { wireInsertChain, insertChain } from "../lib/insertRouting";
import { PerformMixer } from "../components/PerformMixer";
import { useAppStore } from "./useAppStore";
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot } from "./appStoreModel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); useAppStore.setState(useAppStore.getInitialState(), true); });

it("repeated new performances route guided instruments without saving or assigning Master patches", async () => {
  const source = toPatchListItem(audioTemplate("instrument"));
  useAppStore.setState({ patches: [source], activeSessionState: "idle" });
  const create = vi.spyOn(api, "createPatch");
  const list = vi.spyOn(api, "listPatches");
  for (let index = 0; index < 6; index++) {
    await useAppStore.getState().newPerformanceWorkspace();
    useAppStore.getState().addSequencerInstrument();
    const state = useAppStore.getState();
    expect(state.sequencerInstruments).toHaveLength(1);
    expect(state.patches).toEqual([source]);
    expect(state.audioGraph.masterId).toBe(MASTER);
    expect(state.audioGraph.routes.map(r => r.targetId)).toEqual([MASTER, MASTER]);
    expect(state.ensureMaster()).toBe(MASTER);
    expect(useAppStore.getState().audioGraph.routes).toHaveLength(2);
  }
  expect(create).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});

it("preserves Master inserts and controls through v14 snapshots without a Master assignment", () => {
  const effect = toPatchListItem(audioTemplate("effect"));
  const bindings = [{ id: "insert", patchId: effect.id, midiChannel: 0, level: 10, effectSourceIds: [], effectRoutes: [] }];
  const graph = wireInsertChain(emptyAudioGraph(), bindings, [effect], MASTER, ["insert"]);
  expect(insertChain(graph, MASTER)).toEqual(["insert"]);
  expect(audioGraphDiagnostics(bindings, [effect], graph)).toEqual([]);
  const mixer = { strips: { [MASTER]: { ...defaultStrip(), gainDb: -8.7, mute: true } }, sends: {} };
  const snapshot = buildSequencerConfigSnapshot(useAppStore.getState().sequencer, bindings, graph, mixer);
  const restored = parseSequencerConfigSnapshot(snapshot, [effect], null);
  expect(restored.audioGraph).toEqual(graph);
  expect(restored.mixer).toEqual(mixer);
  expect(snapshot.instruments.map(b => b.patchId)).toEqual([effect.id]);
});

it("shows a fixed Master with meters and controls but no patch editing or replacement", () => {
  render(<PerformMixer onStop={() => undefined} />);
  const header = screen.getByRole("button", { name: "Master" });
  const master = within(header.closest("article")!);
  expect(master.getByLabelText("Master meter")).toBeTruthy();
  expect(master.getByRole("button", { name: "Mute" })).toBeTruthy();
  expect(master.queryByRole("button", { name: "Edit patch" })).toBeNull();
  expect(master.queryByRole("button", { name: "Solo" })).toBeNull();
  expect(screen.queryByText("Create neutral Master")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Master" })).toBeNull();
});
