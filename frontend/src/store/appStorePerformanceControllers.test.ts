import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand";
import { api, ApiError } from "../api/client";
import { emptyAudioGraph } from "../lib/audioRouting";
import { audioTemplate } from "../lib/audioTemplates";
import { toPatchListItem } from "../lib/patchCatalog";
import { createPerformanceControllerActions } from "./appStorePerformanceControllers";
import type { AppStore } from "./appStoreTypes";
import type { PerformanceControllerSnapshot } from "../types";
import { useAppStore } from "./useAppStore";

function setup() {
  vi.useFakeTimers();
  const graph = emptyAudioGraph();
  const patch = { ...toPatchListItem(audioTemplate("empty")), performance_controllers: [{ node_id: "setting", min: 0, max: 1, default: 0.5, label: "Setting", scale: "linear" as const }] };
  const store = createStore<AppStore>(() => ({ ...useAppStore.getInitialState(), audioGraph: graph, patches: [patch], activeSessionId: "session", activeSessionState: "running",
    activeSessionAudioSignature: JSON.stringify({ graph, patches: [[patch.id, patch.updated_at]] }),
    sequencerInstruments: [{ id: "one", patchId: patch.id, midiChannel: 1, level: 10, effectRoutes: [], effectSourceIds: [] }],
    activeSessionInstruments: [{ id: "one", patch_id: patch.id, midi_channel: 1 }] }));
  const actions = createPerformanceControllerActions(store.setState, store.getState);
  const remote: PerformanceControllerSnapshot = { values: {}, midi_ccs: {}, revisions: { setting: 0 } };
  const read = vi.spyOn(api, "getPerformanceControllers").mockImplementation(async () => ({ one: structuredClone(remote) }));
  const update = vi.spyOn(api, "patchPerformanceControllers").mockImplementation(async (_id, _assignment, delta) => {
    for (const node of new Set([...Object.keys(delta.values ?? {}), ...Object.keys(delta.midi_ccs ?? {})])) {
      for (const key of ["values", "midi_ccs"] as const) {
        const value = delta[key]?.[node];
        if (value === null) delete remote[key][node]; else if (value !== undefined) remote[key][node] = value;
      }
      remote.revisions[node]++;
    }
    return structuredClone(remote);
  });
  actions.receivePerformanceControllers("session", { one: structuredClone(remote) });
  return { store, actions, update, read, remote };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("performance controller synchronization", () => {
  it("coalesces edits, keeps assignment through reset, and sends only changed fields", async () => {
    const { store, actions, update } = setup();
    for (let i = 0; i < 100; i++) actions.setPerformanceControllerValue("one", "setting", i / 100);
    actions.setPerformanceControllerMidiCC("one", "setting", 21);
    expect(update).not.toHaveBeenCalled();
    await actions.flushPerformanceControllers();
    expect(update).toHaveBeenCalledExactlyOnceWith("session", "one", { values: { setting: .99 }, midi_ccs: { setting: 21 }, revisions: { setting: 0 } });
    actions.setPerformanceControllerValue("one", "setting", null);
    await actions.flushPerformanceControllers();
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({});
    expect(store.getState().sequencerInstruments[0].performanceControllerMidiCCs).toEqual({ setting: 21 });
    expect(store.getState().activeSessionState).toBe("running");
  });
  it.each(["integer", "bool"] as const)("normalizes %s", async controller_type => {
    const { store, actions } = setup();
    store.setState(s => ({ patches: s.patches.map(p => ({ ...p, performance_controllers: p.performance_controllers?.map(d => ({ ...d, controller_type, default: 0 })) })) }));
    actions.setPerformanceControllerValue("one", "setting", .5);
    await actions.flushPerformanceControllers();
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: 1 });
  });
  it("receives MIDI without echo and rejects stale replies and other sessions", async () => {
    const { store, actions, update } = setup();
    actions.receivePerformanceControllers("session", { one: { values: { setting: .8 }, midi_ccs: { setting: 1 }, revisions: { setting: 5 } } });
    actions.receivePerformanceControllers("session", { one: { values: { setting: .2 }, midi_ccs: {}, revisions: { setting: 4 } } });
    actions.receivePerformanceControllers("old", { one: { values: {}, midi_ccs: {}, revisions: { setting: 9 } } });
    await actions.flushPerformanceControllers();
    expect(update).not.toHaveBeenCalled();
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: .8 });
  });
  it("resolves a stale edit with the authoritative MIDI snapshot", async () => {
    const { store, actions, update } = setup();
    actions.setPerformanceControllerValue("one", "setting", .3);
    const snapshot = { values: { setting: .9 }, midi_ccs: { setting: 21 }, revisions: { setting: 2 } };
    update.mockRejectedValueOnce(new ApiError(409, "Conflict", JSON.stringify({ detail: { snapshot } })));
    await actions.flushPerformanceControllers();
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: .9 });
    expect(update).toHaveBeenCalledTimes(1);
  });
  it("serializes edits made while a request is in flight", async () => {
    const { actions, update } = setup();
    let resolve!: (value: PerformanceControllerSnapshot) => void;
    update.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    actions.setPerformanceControllerValue("one", "setting", .1);
    const flushing = actions.flushPerformanceControllers();
    actions.setPerformanceControllerValue("one", "setting", .3);
    resolve({ values: { setting: .1 }, midi_ccs: {}, revisions: { setting: 1 } });
    await flushing;
    expect(update).toHaveBeenLastCalledWith("session", "one", { values: { setting: .3 }, midi_ccs: {}, revisions: { setting: 1 } });
  });
  it("retains edits on failure, refreshes on reconnect and ignores a replaced workspace", async () => {
    const { store, actions, update, read } = setup();
    update.mockRejectedValueOnce(new Error("Unavailable"));
    actions.setPerformanceControllerValue("one", "setting", .37);
    await expect(actions.flushPerformanceControllers()).rejects.toThrow("Unavailable");
    expect(store.getState().performanceControllerSyncError).toBe("Unavailable");
    await actions.flushPerformanceControllers();
    expect(store.getState().performanceControllerSyncError).toBeNull();
    let resolve!: (snapshots: Record<string, PerformanceControllerSnapshot>) => void;
    read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const refresh = actions.refreshPerformanceControllers("session");
    store.setState({ performanceWorkspaceGeneration: 1 });
    resolve({ one: { values: { setting: 1 }, midi_ccs: {}, revisions: { setting: 100 } } });
    await refresh;
    actions.receivePerformanceControllers("session", { one: { values: { setting: 1 }, midi_ccs: { setting: 50 }, revisions: { setting: 101 } } });
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: .37 });
    expect(store.getState().sequencerInstruments[0].performanceControllerMidiCCs).toEqual({});
  });
  it("keeps edits local for an older active patch and rejects invalid CCs", async () => {
    const { store, actions, update } = setup();
    for (const cc of [0, 51, 1.5]) actions.setPerformanceControllerMidiCC("one", "setting", cc);
    await actions.flushPerformanceControllers();
    expect(update).not.toHaveBeenCalled();
    store.setState({ activeSessionAudioSignature: "old" });
    actions.setPerformanceControllerValue("one", "setting", .2);
    actions.receivePerformanceControllers("session", { one: { values: { setting: .9 }, midi_ccs: { setting: 50 }, revisions: { setting: 99 } } });
    await actions.flushPerformanceControllers();
    expect(update).not.toHaveBeenCalled();
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: .2 });
    expect(store.getState().sequencerInstruments[0].performanceControllerMidiCCs).toEqual({});
  });
});
