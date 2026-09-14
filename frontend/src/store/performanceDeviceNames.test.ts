import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/device_names.json";
import { api } from "../api/client";
import { buildPerformanceExportPayload, parsePerformanceExportPayload, resolveImportedPerformanceConfig } from "../lib/bundleImportExport";
import { performanceDeviceKinds, validatePerformanceDeviceName } from "../lib/performanceDeviceNames";
import { buildPersistedAppStateSnapshot, normalizeSequencerState, parseSequencerConfigSnapshot } from "./appStoreModel";
import { useAppStore } from "./useAppStore";

const names = (sequencer: ReturnType<typeof normalizeSequencerState>) =>
  performanceDeviceKinds.map((kind) => sequencer[kind].map((device) => device.name));
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(structuredClone(fixture.config));
});
afterEach(() => vi.restoreAllMocks());

describe("performance device names", () => {
  it.each(performanceDeviceKinds)("renames %s without altering playback or other devices", (kind) => {
    const before = useAppStore.getState();
    useAppStore.setState({ sequencerRuntime: { ...before.sequencerRuntime, isPlaying: true, transportSubunit: 12345 } });
    const runtime = useAppStore.getState().sequencerRuntime;
    const device = before.sequencer[kind][0];
    expect(before.renamePerformanceDevice(kind, device.id, "  New Name 🎹  ")).toEqual({ ok: true, name: "New Name 🎹" });
    const after = useAppStore.getState();
    expect(after.sequencer[kind][0]).toEqual({ ...device, name: "New Name 🎹" });
    expect(after.sequencerRuntime).toBe(runtime);
    expect(after.audioGraph).toBe(before.audioGraph);
    expect(after.sequencerInstruments).toBe(before.sequencerInstruments);
    for (const other of performanceDeviceKinds.filter((candidate) => candidate !== kind)) {
      expect(after.sequencer[other]).toBe(before.sequencer[other]);
    }
  });

  it.each([
    ["", "empty"], [" \t ", "empty"], ["a".repeat(66), "tooLong"], ["🎹".repeat(66), "tooLong"],
    ["<b>Lead</b>", "html"], ["Lead > Bass", "html"], ["Lead <", "html"], ["  broken BEAT  ", "duplicate"]
  ])("rejects %j without changing state", (name, error) => {
    const before = useAppStore.getState().sequencer;
    expect(useAppStore.getState().renamePerformanceDevice("tracks", before.tracks[0].id, name)).toEqual({ ok: false, error });
    expect(useAppStore.getState().sequencer).toBe(before);
  });

  it("accepts 65 code points, own names, case changes, and literal HTML entities", () => {
    const { sequencer, renamePerformanceDevice } = useAppStore.getState();
    const id = sequencer.tracks[0].id;
    expect(renamePerformanceDevice("tracks", id, sequencer.tracks[0].name).ok).toBe(true);
    expect(useAppStore.getState().sequencer).toBe(sequencer);
    for (const name of ["warm lead", "a".repeat(65), "🎹".repeat(65), "Lead &amp; Bass"]) {
      expect(renamePerformanceDevice("tracks", id, name)).toEqual({ ok: true, name });
    }
    expect(renamePerformanceDevice("tracks", "removed", "Any")).toEqual({ ok: false, error: "missing" });
  });

  it("checks cross-type duplicates even when device IDs match", () => {
    const sequencer = useAppStore.getState().sequencer;
    const id = sequencer.tracks[0].id;
    sequencer.drummerTracks[0].id = id;
    expect(validatePerformanceDeviceName(sequencer, "tracks", id, sequencer.drummerTracks[0].name))
      .toEqual({ ok: false, error: "duplicate" });
  });

  it.each([
    ["tracks", "addSequencerTrack", "removeSequencerTrack", "Melodic Sequencer"],
    ["drummerTracks", "addDrummerSequencerTrack", "removeDrummerSequencerTrack", "Drummer Sequencer"],
    ["controllerSequencers", "addControllerSequencer", "removeControllerSequencer", "Controller Sequencer"],
    ["arpeggiators", "addArpeggiator", "removeArpeggiator", "Arpeggiator"],
    ["pianoRolls", "addPianoRoll", "removePianoRoll", "Piano Roll"],
    ["midiControllers", "addMidiController", "removeMidiController", "Controller"]
  ] as const)("creates unique defaults for %s after custom names and deletion", (kind, add, remove, prefix) => {
    const state = useAppStore.getState();
    const otherKind = kind === "tracks" ? "drummerTracks" : "tracks";
    state.renamePerformanceDevice(otherKind, state.sequencer[otherKind][0].id, `${prefix.toLowerCase()} 2`);
    state[add]();
    expect(useAppStore.getState().sequencer[kind][1].name).toBe(`${prefix} 3`);
    state[remove](state.sequencer[kind][0].id);
    state[add]();
    expect(useAppStore.getState().sequencer[kind][1].name).toBe(`${prefix} 4`);
  });

  it.each([false, true])("preserves names through persistence and native import/export (legacy=%s)", (legacy) => {
    const config = structuredClone(fixture.config);
    if (legacy) for (const kind of performanceDeviceKinds) config.sequencer[kind][0].name = fixture.legacyNames[kind];
    useAppStore.getState().applySequencerConfigSnapshot(config);
    const state = useAppStore.getState();
    const expected = names(state.sequencer);
    expect(expected).toEqual(performanceDeviceKinds.map((kind) => [config.sequencer[kind][0].name]));
    const persisted = JSON.parse(JSON.stringify(buildPersistedAppStateSnapshot(state)));
    expect(names(normalizeSequencerState(persisted.sequencer))).toEqual(expected);
    const snapshot = state.buildSequencerConfigSnapshot();
    expect(names(parseSequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot)), [], null).sequencer)).toEqual(expected);
    const exported = buildPerformanceExportPayload({ snapshot, selectedPatches: [], performanceName: "Test", performanceDescription: "" });
    const imported = parsePerformanceExportPayload(JSON.parse(JSON.stringify(exported.payload)))!;
    state.applySequencerConfigSnapshot(resolveImportedPerformanceConfig(imported, new Map(), []));
    expect(names(useAppStore.getState().sequencer)).toEqual(expected);
    if (legacy) {
      const device = state.sequencer.controllerSequencers[0];
      expect(state.renamePerformanceDevice("controllerSequencers", device.id, device.name)).toEqual({ ok: false, error: "html" });
      expect(state.renamePerformanceDevice("controllerSequencers", device.id, "Clean Filter").ok).toBe(true);
    }
  });

  it("retains all six names when loading a saved performance", async () => {
    vi.spyOn(api, "getPerformance").mockResolvedValue({
      id: "saved", name: "Saved Set", description: "", config: useAppStore.getState().buildSequencerConfigSnapshot(),
      created_at: "", updated_at: ""
    });
    await useAppStore.getState().loadPerformance("saved");
    expect(useAppStore.getState().error).toBeNull();
    expect(names(useAppStore.getState().sequencer)).toEqual(performanceDeviceKinds.map((kind) => [fixture.config.sequencer[kind][0].name]));
  });

  it("saves edited names through the performance API", async () => {
    const create = vi.spyOn(api, "createPerformance").mockImplementation(async (payload) => ({
      ...payload, id: "saved", created_at: "", updated_at: ""
    }));
    vi.spyOn(api, "listPerformances").mockResolvedValue([]);
    useAppStore.setState({ currentPerformanceId: null, performanceName: "Named Set", sequencerInstruments: [] });
    const state = useAppStore.getState();
    for (const kind of performanceDeviceKinds) state.renamePerformanceDevice(kind, state.sequencer[kind][0].id, `Saved ${kind}`);
    await state.saveCurrentPerformance();
    expect(useAppStore.getState().error).toBeNull();
    expect(create).toHaveBeenCalledOnce();
    expect(performanceDeviceKinds.map((kind) => create.mock.calls[0][0].config.sequencer[kind]![0].name))
      .toEqual(performanceDeviceKinds.map((kind) => `Saved ${kind}`));
  });
});
