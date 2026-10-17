import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { buildPerformanceExportPayload, parsePerformanceExportPayload, resolveImportedPerformanceConfig } from "../lib/bundleImportExport";
import { buildPersistedAppStateSnapshot, normalizePianoRollState, normalizeSequencerState } from "./appStoreModel";
import { useAppStore } from "./useAppStore";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
afterEach(() => vi.restoreAllMocks());
const settings = () => useAppStore.getState().sequencer.pianoRolls.map(roll => [roll.autoChordEnabled, roll.autoChordSize]);
it.each([undefined, null, 2, 6, 3.5, "5", true])( "defaults invalid or missing settings (%j) to off/3", value => {
  expect(normalizePianoRollState({ autoChordEnabled: "true", autoChordSize: value }, 1))
    .toMatchObject({ autoChordEnabled: false, autoChordSize: 3 });
});
it("edits rolls independently without changing the audio revision or runtime", () => {
  const store = useAppStore.getState(); store.addPianoRoll();
  const before = useAppStore.getState(), [first, second] = before.sequencer.pianoRolls;
  store.setPianoRollAutoChordEnabled(first.id, true); store.setPianoRollAutoChordSize(first.id, 5);
  expect(settings()).toEqual([[true, 5], [false, 3]]);
  store.setPianoRollAutoChordSize(second.id, 4);
  store.setPianoRollAutoChordEnabled(first.id, false);
  expect(settings()).toEqual([[false, 5], [false, 4]]);
  expect(useAppStore.getState().sequencerEditRevision).toBe(before.sequencerEditRevision);
  expect(useAppStore.getState().sequencerRuntime).toEqual(before.sequencerRuntime);
  store.setPianoRollAutoChordSize(first.id, 9);
  expect(settings()[0]).toEqual([false, 3]);
});
it.each([3, 4, 5] as const)("retains %i-note settings through autosave, save/load, clone and native JSON", async size => {
  const store = useAppStore.getState();
  const id = store.sequencer.pianoRolls[0].id;
  store.setPianoRollAutoChordEnabled(id, true); store.setPianoRollAutoChordSize(id, size);
  const current = useAppStore.getState();
  const persisted = buildPersistedAppStateSnapshot(current);
  expect(normalizeSequencerState(JSON.parse(JSON.stringify(persisted.sequencer))).pianoRolls[0])
    .toMatchObject({ autoChordEnabled: true, autoChordSize: size });
  const snapshot = current.buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(20); expect(persisted.version).toBe(3);
  const exported = buildPerformanceExportPayload({ snapshot, selectedPatches: [], performanceName: "Chords", performanceDescription: "" });
  const imported = parsePerformanceExportPayload(JSON.parse(JSON.stringify(exported.payload)))!;
  current.applySequencerConfigSnapshot(resolveImportedPerformanceConfig(imported, new Map(), []));
  expect(settings()).toEqual([[true, size]]);
  const saved = { id: "saved", name: "Chords", description: "", config: snapshot, created_at: "", updated_at: "" };
  const create = vi.spyOn(api, "createPerformance").mockResolvedValue(saved);
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  vi.spyOn(api, "getPerformance").mockResolvedValue(saved);
  useAppStore.setState({ currentPerformanceId: null, performanceName: "Chords", sequencerInstruments: [] });
  await store.saveCurrentPerformance();
  expect(create.mock.calls[0][0].config.sequencer.pianoRolls[0]).toMatchObject({ autoChordEnabled: true, autoChordSize: size });
  store.setPianoRollAutoChordEnabled(id, false);
  await store.loadPerformance("saved"); expect(settings()).toEqual([[true, size]]);
  // Clone uses the same save operation with the current performance ID cleared.
  useAppStore.setState({ currentPerformanceId: null, performanceName: "Chords copy" });
  await store.saveCurrentPerformance();
  expect(create.mock.calls[1][0].config.sequencer.pianoRolls[0]).toMatchObject({ autoChordEnabled: true, autoChordSize: size });
  expect(useAppStore.getState().error).toBeNull();
});
