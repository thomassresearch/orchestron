import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/rack_ordering.json";
import { api } from "../api/client";
import { groupRackInstruments } from "../lib/rackOrdering";
import { buildPerformanceExportPayload, parsePerformanceExportPayload, planPatchImports, resolveImportedPerformanceConfig } from "../lib/bundleImportExport";
import type { Patch, PatchListItem, Performance } from "../types";
import { buildPersistedAppStateSnapshot, normalizePersistedSequencerInstruments, normalizeSessionInstrumentAssignments } from "./appStoreModel";
import { useAppStore } from "./useAppStore";

const patches = fixture.patches as PatchListItem[];
const ids = () => useAppStore.getState().sequencerInstruments.map(binding => binding.id);
const groups = () => {
  const grouped = groupRackInstruments(useAppStore.getState().sequencerInstruments, new Map(patches.map(patch => [patch.id, patch])));
  return [grouped.standard, grouped.alwaysOn].map(rows => rows.map(row => row.binding.id));
};
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ patches });
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("moves duplicate instances in both directions within either group without changing other state", () => {
  const before = useAppStore.getState();
  const move = before.moveSequencerInstrument;
  move("note-2", "note-1", "before");
  move("continuous-1", "continuous-3", "after");
  expect(groups()).toEqual([["note-2", "note-1", "note-3"], ["continuous-2", "continuous-3", "continuous-1"]]);
  move("note-2", "note-3", "after");
  move("continuous-1", "continuous-2", "before");
  expect(groups()).toEqual([["note-1", "note-3", "note-2"], ["continuous-1", "continuous-2", "continuous-3"]]);
  const after = useAppStore.getState();
  for (const binding of after.sequencerInstruments) expect(binding).toBe(before.sequencerInstruments.find(b => b.id === binding.id));
  expect(after.audioGraph).toBe(before.audioGraph);
  expect(after.mixer).toBe(before.mixer);
  expect(after.sequencer).toBe(before.sequencer);
  expect(after.sequencerRuntime).toBe(before.sequencerRuntime);
  expect(after.arrangerHistory).toBe(before.arrangerHistory);
});

it("ignores cross-group, missing, self and visually unchanged moves even with interleaved bindings", () => {
  const before = useAppStore.getState();
  before.moveSequencerInstrument("note-1", "continuous-1");
  before.moveSequencerInstrument("missing", "note-1");
  before.moveSequencerInstrument("note-1", "missing");
  before.moveSequencerInstrument("note-1", "note-1");
  before.moveSequencerInstrument("note-1", "note-2", "before");
  before.moveSequencerInstrument("note-2", "note-1", "after");
  expect(useAppStore.getState()).toBe(before);
  useAppStore.setState({ activeSessionState: "running" });
  const running = useAppStore.getState();
  running.moveSequencerInstrument("note-2", "note-1");
  expect(useAppStore.getState()).toBe(running);
});

it("keeps order and per-instance values through app-state restoration and native bundle ID remapping", () => {
  useAppStore.getState().moveSequencerInstrument("note-3", "note-1");
  useAppStore.getState().moveSequencerInstrument("continuous-2", "continuous-1");
  const state = useAppStore.getState();
  const expected = ids();
  const saved = JSON.parse(JSON.stringify(buildPersistedAppStateSnapshot(state)));
  expect(normalizePersistedSequencerInstruments(saved.sequencerInstruments, patches, null).map(b => b.id)).toEqual(expected);
  const payload = buildPerformanceExportPayload({ snapshot: state.buildSequencerConfigSnapshot(), selectedPatches: fixture.patches as Patch[], performanceName: "Rack", performanceDescription: "" }).payload;
  const parsed = parsePerformanceExportPayload(JSON.parse(JSON.stringify(payload)));
  if (!parsed) throw new Error("Expected a native performance bundle");
  const { patchIdMap, catalog } = planPatchImports(parsed.patch_definitions, [], new Map());
  const imported = resolveImportedPerformanceConfig(parsed, patchIdMap, catalog);
  useAppStore.setState({ patches: catalog });
  useAppStore.getState().applySequencerConfigSnapshot(imported);
  expect(ids()).toEqual(expected);
  expect(useAppStore.getState().sequencerInstruments.map(b => b.performanceControllerValues)).toEqual(state.sequencerInstruments.map(b => b.performanceControllerValues));
  expect(useAppStore.getState().audioGraph).toEqual(state.audioGraph);
  expect(useAppStore.getState().mixer).toEqual(state.mixer);
});

it("autosaves the changed order and round-trips Save/Load and a cloned performance", async () => {
  vi.useFakeTimers();
  const autosave = vi.spyOn(api, "saveAppState").mockResolvedValue(undefined);
  vi.spyOn(api, "getPatch").mockImplementation(async id => fixture.patches.find(patch => patch.id === id) as Patch);
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  let saved!: Performance;
  vi.spyOn(api, "createPerformance").mockImplementation(async payload => (saved = { ...payload, id: "saved", created_at: "2026-09-29", updated_at: "2026-09-29" }));
  vi.spyOn(api, "getPerformance").mockImplementation(async () => saved);
  useAppStore.setState({ hasLoadedBootstrap: true, performanceName: "Rack" });
  useAppStore.getState().moveSequencerInstrument("note-3", "note-1");
  const expected = ids();
  await vi.advanceTimersByTimeAsync(400);
  expect(autosave.mock.calls[autosave.mock.calls.length - 1][0].sequencerInstruments.map(b => b.id)).toEqual(expected);
  useAppStore.setState({ hasLoadedBootstrap: false });
  await useAppStore.getState().saveCurrentPerformance();
  expect(saved.config.instruments.map(b => b.id)).toEqual(expected);
  useAppStore.getState().moveSequencerInstrument("note-3", "note-2", "after");
  await useAppStore.getState().loadPerformance(saved.id);
  expect(ids()).toEqual(expected);
  // Clone uses the same public snapshot/create/load path as App.
  const clone = await api.createPerformance({ name: "Rack (copy)", description: "", config: useAppStore.getState().buildSequencerConfigSnapshot() });
  await useAppStore.getState().loadPerformance(clone.id);
  expect(ids()).toEqual(expected);
  vi.clearAllTimers();
});

it("reuses the existing stopped engine session after a display-order change", async () => {
  const before = useAppStore.getState();
  const instruments = normalizeSessionInstrumentAssignments(before.sequencerInstruments);
  useAppStore.setState({ activeSessionId: "existing", activeSessionState: "compiled", activeSessionInstruments: instruments,
    activeSessionAudioSignature: JSON.stringify({ graph: before.audioGraph, patches: patches.map(patch => [patch.id, patch.updated_at]) }) });
  vi.spyOn(api, "getSession").mockResolvedValue({ session_id: "existing", patch_id: "lead", instruments, state: "compiled", midi_input: null, created_at: "2026-09-29", started_at: null });
  vi.spyOn(useAppStore.getState(), "flushMixer").mockResolvedValue(undefined);
  vi.spyOn(useAppStore.getState(), "flushPerformanceControllers").mockResolvedValue(undefined);
  const create = vi.spyOn(api, "createSession");
  const remove = vi.spyOn(api, "deleteSession");
  useAppStore.getState().moveSequencerInstrument("note-2", "note-1");
  expect(await useAppStore.getState().ensureSession()).toBe("existing");
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
