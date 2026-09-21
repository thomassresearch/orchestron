import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import { useAppStore } from "./useAppStore";
import { historyMatches, playingArrangerSourceChanges, readArrangerHistory, type ArrangerActionCode } from "./arrangerHistory";
import { buildPersistedAppStateSnapshot, capturePersistWatchState, parseSequencerConfigSnapshot, normalizeSequencerState, shouldDeferSequencerPersistence } from "./appStoreModel";
import { arrangementRangeLanes } from "../lib/arrangementRange";
import { groupArrangementSelection, removeArrangementItems } from "../lib/arrangementEditing";
import { api } from "../api/client";

const store = () => useAppStore.getState();
const pad = (padIndex: number) => ({ type: "pad" as const, padIndex });
const lane = () => store().sequencer.tracks[0];
const root = () => lane().padLoopPattern.rootSequence;
function place(index: number) {
  store().commitArrangerEdit("place", [{ id: lane().id, kind: "sequencer", pattern: { ...lane().padLoopPattern, rootSequence: [pad(index)] } }]);
}
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  store().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("keeps 25 actions across both directions, jumps atomically and branches from the cursor", () => {
  for (let i = 0; i < 30; i++) place(i % 8);
  expect(store().arrangerHistory.entries).toHaveLength(25);
  const before = store(), notify = vi.fn(), unsubscribe = useAppStore.subscribe(notify);
  store().goToArrangerHistory(3);
  unsubscribe();
  expect(notify).toHaveBeenCalledTimes(1);
  expect(store().sequencerEditRevision).toBe(before.sequencerEditRevision + 1);
  expect(root()).toEqual([pad(7)]);
  expect(store().arrangerHistory.entries).toHaveLength(25);
  store().redoArranger(); expect(root()).toEqual([pad(0)]);
  place(6);
  expect(store().arrangerHistory.entries).toHaveLength(5);
  expect(store().arrangerHistory.cursor).toBe(5);
  const final = store(); store().redoArranger(); expect(store()).toBe(final);
  store().goToArrangerHistory(0); expect(root()).toEqual([pad(4)]);
});

it("does not record no-ops and rejects a whole invalid batch without losing redo", () => {
  place(2); store().undoArranger();
  const before = store();
  store().commitArrangerEdit("place", [{ id: lane().id, kind: "sequencer", pattern: structuredClone(lane().padLoopPattern) }]);
  expect(store()).toBe(before);
  expect(() => store().commitArrangerEdit("place", [
    { id: lane().id, kind: "sequencer", pattern: { ...lane().padLoopPattern, rootSequence: [pad(3)] } },
    { id: "missing", kind: "sequencer", source: true }
  ])).toThrow();
  expect(store()).toBe(before);
  expect(() => store().commitArrangerEdit("place", [{ id: lane().id, kind: "sequencer", pattern: { ...lane().padLoopPattern, rootSequence: [{ type: "group", groupId: "MISSING" }] } }])).toThrow();
  expect(store()).toBe(before);
});

it("groups, varies and deletes definitions, resizes rests and removes material through one timeline", () => {
  const initial = structuredClone(lane().padLoopPattern);
  const commit = (action: ArrangerActionCode, pattern: typeof initial) => store().commitArrangerEdit(action, [{ id: lane().id, kind: "sequencer", pattern }]);
  commit("place", { ...initial, rootSequence: [pad(0), pad(2)] });
  commit("group", groupArrangementSelection(lane().padLoopPattern, [0, 1], "group").pattern);
  const grouped = structuredClone(lane().padLoopPattern);
  commit("ungroup", { ...grouped, rootSequence: grouped.groups[0].sequence });
  commit("deleteDefinition", { ...lane().padLoopPattern, groups: [] });
  commit("remove", removeArrangementItems(lane().padLoopPattern, [0], () => 4));
  commit("rest", { ...lane().padLoopPattern, rootSequence: [{ type: "pause", lengthBeats: 8 }, pad(1)] });
  commit("closeGap", { ...lane().padLoopPattern, rootSequence: [pad(1)] });
  store().goToArrangerHistory(2); expect(lane().padLoopPattern).toEqual(grouped);
  store().goToArrangerHistory(0); expect(lane().padLoopPattern).toEqual(initial);
  store().goToArrangerHistory(7); expect(root()).toEqual([pad(1)]);
});

it("records colours without audio preparation and preserves unrelated notes, mixer and transport", () => {
  place(2);
  const revision = store().sequencerEditRevision;
  store().commitArrangerEdit("color", [{ id: lane().id, kind: "sequencer", pattern: { ...lane().padLoopPattern, definitionColors: { "pad:2": "#123456" } } }]);
  expect(store().sequencerEditRevision).toBe(revision);
  store().selectSequencerEditingPad(lane().id, 1);
  store().setSequencerTrackStepNote(lane().id, 0, 75);
  store().syncSequencerRuntime({ isPlaying: true, playhead: 11, cycle: 3, tracks: [{ trackId: lane().id, activePad: 4, queuedPad: 6, enabled: true, runtimePadStartSubunit: -6720 }] });
  const before = store();
  store().undoArranger();
  expect(store().sequencerEditRevision).toBe(before.sequencerEditRevision);
  store().undoArranger();
  expect(store().sequencerRuntime).toEqual(before.sequencerRuntime);
  expect(store().sequencer.tracks[0].pads).toEqual(before.sequencer.tracks[0].pads);
  expect(store().mixer).toBe(before.mixer);
  expect(store().sequencer.arrangerLoopSelection).toEqual(before.sequencer.arrangerLoopSelection);
  expect(historyMatches(store().sequencer, store().arrangerHistory)).toBe(true);
});

it.each(["sequencer", "drummer", "controller", "arpeggiator"] as const)("restores a complete %s pad variation and round-trips future history", kind => {
  store().addDrummerSequencerTrack(); store().addControllerSequencer(); store().addArpeggiator();
  const arp = store().sequencer.arpeggiators[0];
  store().updateArpeggiator(arp.id, { playbackMode: "arranger" });
  const target = arrangementRangeLanes(store().sequencer).find(l => l.kind === kind)!;
  const key = { sequencer: "tracks", drummer: "drummerTracks", controller: "controllerSequencers", arpeggiator: "arpeggiators" }[kind] as "tracks";
  const sequencer = store().sequencer;
  useAppStore.setState({ sequencer: normalizeSequencerState({ ...sequencer, [key]: sequencer[key].map(t => t.id === target.id ? { ...t, pads: t.pads.map((p, i) => i === 0 ? { ...p, lengthBeats: 2 } : p) } : t) }) });
  const before = structuredClone(store().sequencer);
  store().commitArrangerEdit("variation", [{ id: target.id, kind, pattern: { ...target.pattern, rootSequence: [pad(1)], definitionColors: { "pad:1": "#123456" } }, source: true, copyPad: { from: 0, to: 1 } }]);
  const after = structuredClone(store().sequencer);
  store().undoArranger();
  expect(store().sequencer).toEqual(before);
  const saved = JSON.parse(JSON.stringify(store().buildSequencerConfigSnapshot()));
  store().applySequencerConfigSnapshot(saved);
  expect(store().arrangerHistoryNotice).toBe(false);
  expect(store().arrangerHistory.cursor).toBe(0);
  store().redoArranger();
  expect(arrangementRangeLanes(store().sequencer).map(l => l.pattern)).toEqual(arrangementRangeLanes(after).map(l => l.pattern));
  expect(historyMatches(store().sequencer, store().arrangerHistory)).toBe(true);
});

it("invalidates only when an affected lane or copied pad dependency changes", () => {
  place(2);
  store().addSequencerTrack();
  expect(store().arrangerHistory.entries).toHaveLength(1);
  store().setSequencerTrackPadLoopRepeat(lane().id, !lane().padLoopRepeat);
  expect(store().arrangerHistoryNotice).toBe(true);
  expect(store().arrangerHistory.entries).toHaveLength(0);
  store().selectSequencerEditingPad(lane().id, 0);
  store().setSequencerTrackStepNote(lane().id, 0, 56);
  store().commitArrangerEdit("variation", [{ id: lane().id, kind: "sequencer", copyPad: { from: 0, to: 1 }, pattern: { ...lane().padLoopPattern, rootSequence: [pad(1)] } }]);
  store().selectSequencerEditingPad(lane().id, 1);
  store().setSequencerTrackStepNote(lane().id, 0, 77);
  expect(store().arrangerHistory.entries).toHaveLength(0);
});

it("persists the cursor, defers autosave during playback, and accepts legacy files without metadata", () => {
  const before = capturePersistWatchState(store());
  place(2); place(3); store().undoArranger();
  const saved = store().buildSequencerConfigSnapshot();
  expect(saved.version).toBe(16);
  const app = buildPersistedAppStateSnapshot(store());
  expect(app.version).toBe(2);
  expect(readArrangerHistory(JSON.parse(JSON.stringify(app.arrangerHistory)), store().sequencer).arrangerHistory).toEqual(store().arrangerHistory);
  expect(shouldDeferSequencerPersistence(capturePersistWatchState(store()), before, true)).toBe(true);
  expect(parseSequencerConfigSnapshot(saved, [], null).arrangerHistory.cursor).toBe(1);
  delete saved.arrangerHistory;
  expect(parseSequencerConfigSnapshot(saved, [], null).arrangerHistory.entries).toHaveLength(0);
});

it("restores history through bootstrap recovery, named performance loading and New", async () => {
  vi.useFakeTimers();
  place(2); place(3); store().undoArranger();
  const saved = store().buildSequencerConfigSnapshot(), app = buildPersistedAppStateSnapshot(store());
  vi.spyOn(api, "listOpcodes").mockResolvedValue([]);
  vi.spyOn(api, "listPatches").mockResolvedValue([]);
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  vi.spyOn(api, "listMidiInputs").mockResolvedValue([]);
  vi.spyOn(api, "getAppState").mockResolvedValue({ state: app, updated_at: "2026-09-20" });
  vi.spyOn(api, "saveAppState").mockResolvedValue(undefined);
  vi.spyOn(api, "getPerformance").mockResolvedValue({ id: "history", name: "History", description: "", config: saved, created_at: "2026-09-20", updated_at: "2026-09-20" });
  useAppStore.setState(useAppStore.getInitialState(), true);
  await store().loadBootstrap();
  expect(store().error).toBeNull();
  expect(store().arrangerHistory.cursor).toBe(1);
  store().redoArranger(); expect(root()).toEqual([pad(3)]);
  await store().newPerformanceWorkspace(); expect(store().arrangerHistory.entries).toHaveLength(0);
  await store().loadPerformance("history");
  expect(store().arrangerHistory.cursor).toBe(1);
  store().undoArranger(); expect(store().arrangerHistory.cursor).toBe(0);
  vi.clearAllTimers();
});

it("accepts equivalent JSON metadata regardless of object key ordering", () => {
  place(2);
  const raw = JSON.parse(JSON.stringify(store().buildSequencerConfigSnapshot(), (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
  expect(parseSequencerConfigSnapshot(raw, [], null).arrangerHistoryNotice).toBe(false);
});

it("retargets only running devices whose source changed on commit or undo", () => {
  store().addSequencerTrack();
  const id = lane().id;
  useAppStore.setState({ activeSessionState: "running" });
  store().syncSequencerRuntime({ isPlaying: true, tracks: [{ trackId: id, enabled: true }] });
  const before = store();
  store().commitArrangerEdit("source", [{ id, kind: "sequencer", source: !lane().padLoopEnabled }]);
  const after = store();
  expect(playingArrangerSourceChanges(after, before)).toEqual([id]);
  store().undoArranger();
  expect(playingArrangerSourceChanges(store(), after)).toEqual([id]);
  const restored = store(); place(2);
  expect(playingArrangerSourceChanges(store(), restored)).toEqual([]);
  expect(store().sequencerRuntime).toEqual(before.sequencerRuntime);
});

it.each(["cursor", "limit", "lane", "field", "basis", "action"])("discards invalid %s metadata without changing authored content", problem => {
  place(2);
  const saved = store().buildSequencerConfigSnapshot(), h = saved.arrangerHistory!;
  if (problem === "cursor") h.cursor = 99;
  if (problem === "limit") h.entries = Array(26).fill(h.entries[0]);
  if (problem === "lane") h.entries[0].changes[0].id = "missing";
  if (problem === "field") Object.assign(h.entries[0].changes[0].after, { enabled: true });
  if (problem === "basis") h.basis = [];
  if (problem === "action") Object.assign(h.entries[0], { action: "unknown" });
  const parsed = parseSequencerConfigSnapshot(saved, [], null);
  expect(parsed.arrangerHistory.entries).toHaveLength(0);
  expect(parsed.arrangerHistoryNotice).toBe(true);
  expect(parsed.sequencer.tracks[0].padLoopPattern).toEqual(lane().padLoopPattern);
});

it("saves song looping while keeping it outside undo history and preserving transport", () => {
  place(2);
  const before = store();
  before.setSequencerArrangerSongLoopEnabled(true);
  expect(store().sequencerEditRevision).toBe(before.sequencerEditRevision + 1);
  expect(store().sequencerRuntime).toEqual(before.sequencerRuntime);
  expect(store().arrangerHistory).toEqual(before.arrangerHistory);
  const saved = store().buildSequencerConfigSnapshot();
  const persisted = buildPersistedAppStateSnapshot(store());
  expect(persisted.sequencer.arrangerSongLoopEnabled).toBe(true);
  store().undoArranger();
  expect(store().sequencer.arrangerSongLoopEnabled).toBe(true);
  store().redoArranger();
  expect(store().sequencer.arrangerSongLoopEnabled).toBe(true);
  store().setSequencerArrangerSongLoopEnabled(false);
  store().applySequencerConfigSnapshot(saved);
  expect(store().sequencer.arrangerSongLoopEnabled).toBe(true);
});
