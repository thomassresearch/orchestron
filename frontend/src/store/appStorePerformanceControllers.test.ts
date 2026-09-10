import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand";
import { api } from "../api/client";
import { emptyAudioGraph } from "../lib/audioRouting";
import { audioTemplate } from "../lib/audioTemplates";
import { toPatchListItem } from "../lib/patchCatalog";
import { createPerformanceControllerActions } from "./appStorePerformanceControllers";
import type { AppStore } from "./appStoreTypes";
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
  const update = vi.spyOn(api, "updatePerformanceControllers").mockImplementation(async (_id, _assignment, values) => ({ values }));
  return { store, actions, update };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("performance controller synchronization", () => {
  it("coalesces rapid changes and flushes the last precise value", async () => {
    const { store, actions, update } = setup();
    for (let i = 0; i < 100; i++) actions.setPerformanceControllerValue("one", "setting", i / 100);
    expect(update).not.toHaveBeenCalled();
    await actions.flushPerformanceControllers();
    expect(update).toHaveBeenCalledExactlyOnceWith("session", "one", { setting: 0.99 });
    expect(store.getState().activeSessionState).toBe("running");
    expect(store.getState().activeSessionId).toBe("session");
    actions.setPerformanceControllerValue("one", "setting", 0.5);
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: 0.5 });
    actions.setPerformanceControllerValue("one", "setting", null);
    await actions.flushPerformanceControllers();
    expect(update).toHaveBeenLastCalledWith("session", "one", {});
  });
  it("serializes writes and sends edits received during an acknowledgment", async () => {
    const { actions, update } = setup();
    let acknowledge!: () => void;
    update.mockImplementationOnce(async (_id, _assignment, values) => {
      await new Promise<void>((resolve) => { acknowledge = resolve; });
      return { values };
    });
    actions.setPerformanceControllerValue("one", "setting", 0.1);
    const flushing = actions.flushPerformanceControllers();
    actions.setPerformanceControllerValue("one", "setting", 0.2);
    actions.setPerformanceControllerValue("one", "setting", 0.3);
    expect(update).toHaveBeenCalledTimes(1);
    acknowledge();
    await flushing;
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith("session", "one", { setting: 0.3 });
  });
  it("retains local settings on failure and retries without restarting", async () => {
    const { store, actions, update } = setup();
    update.mockRejectedValueOnce(new Error("Unavailable"));
    actions.setPerformanceControllerValue("one", "setting", 0.37);
    await expect(actions.flushPerformanceControllers()).rejects.toThrow("Unavailable");
    expect(store.getState().performanceControllerSyncError).toBe("Unavailable");
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: 0.37 });
    await actions.flushPerformanceControllers();
    expect(store.getState().performanceControllerSyncError).toBeNull();
    expect(store.getState().activeSessionId).toBe("session");
  });
  it("keeps edits local when the active session belongs to an older patch graph", async () => {
    const { store, actions, update } = setup();
    store.setState({ activeSessionAudioSignature: "old" });
    actions.setPerformanceControllerValue("one", "setting", 0.2);
    await actions.flushPerformanceControllers();
    expect(update).not.toHaveBeenCalled();
    expect(store.getState().sequencerInstruments[0].performanceControllerValues).toEqual({ setting: 0.2 });
  });
});
