import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { audioTemplate } from "../lib/audioTemplates";
import { toPatchListItem } from "../lib/patchCatalog";
import { setMixerTransport } from "../lib/mixerRuntime";
import type { MixerState, PerformanceControllerSnapshot } from "../types";
import type { AppStore } from "./appStoreTypes";
import { useAppStore } from "./useAppStore";

let workspaceGeneration = 0;

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ ...useAppStore.getInitialState(),
    performanceWorkspaceGeneration: ++workspaceGeneration }, true);
});
afterEach(() => {
  setMixerTransport(undefined);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup(parallelPlaybackEnabled: boolean) {
  const patch = { ...toPatchListItem(audioTemplate("empty")), performance_controllers: [{
    node_id: "setting", min: 0, max: 1, default: .5, label: "Setting", scale: "linear" as const
  }] };
  useAppStore.setState({ patches: [patch], activeMidiInput: null, parallelPlaybackEnabled,
    sequencerInstruments: [{ id: "one", patchId: patch.id, midiChannel: 1, level: 10,
      effectRoutes: [], effectSourceIds: [], performanceControllerValues: {}, performanceControllerMidiCCs: {} }] });
  const id = `session-${workspaceGeneration}`;
  vi.spyOn(api, "createSession").mockResolvedValue({ session_id: id, state: "idle", patch_id: patch.id,
    instruments: [{ id: "one", patch_id: patch.id, midi_channel: 1 }] });
  // Exercise the production signature writer instead of constructing a signature in the fixture.
  await useAppStore.getState().ensureSession();
  useAppStore.setState({ activeSessionState: "running" });

  const remote: PerformanceControllerSnapshot = { values: {}, midi_ccs: {}, revisions: { setting: 0 } };
  vi.spyOn(api, "getPerformanceControllers").mockImplementation(async () => ({ one: structuredClone(remote) }));
  const updateController = vi.spyOn(api, "patchPerformanceControllers").mockImplementation(async (_id, _assignment, delta) => {
    for (const key of ["values", "midi_ccs"] as const) {
      for (const [node, value] of Object.entries(delta[key] ?? {})) {
        if (value === null) delete remote[key][node]; else remote[key][node] = value;
      }
    }
    remote.revisions.setting++;
    return structuredClone(remote);
  });
  vi.spyOn(api, "getMixer").mockResolvedValue({ mixer: useAppStore.getState().mixer, revision: 3 });
  const updateMixer = vi.spyOn(api, "updateMixer").mockImplementation(async (_id, mixer, revision) =>
    ({ mixer, revision: (revision ?? 0) + 1 }));
  return { id, remote, updateController, updateMixer };
}

describe.each([false, true])("session synchronization with parallel playback=%s", parallel => {
  it("sends rack values, MIDI mappings and resets after creating the session", async () => {
    const { id, updateController } = await setup(parallel);
    const actions = useAppStore.getState();
    actions.setPerformanceControllerValue("one", "setting", .2);
    actions.setPerformanceControllerValue("one", "setting", .8);
    actions.setPerformanceControllerMidiCC("one", "setting", 21);
    await vi.advanceTimersByTimeAsync(34);
    expect(updateController).toHaveBeenCalledExactlyOnceWith(id, "one", {
      values: { setting: .8 }, midi_ccs: { setting: 21 }, revisions: { setting: 0 }
    });
    actions.setPerformanceControllerValue("one", "setting", null);
    await actions.flushPerformanceControllers();
    expect(updateController).toHaveBeenLastCalledWith(id, "one", {
      values: { setting: null }, midi_ccs: {}, revisions: { setting: 1 }
    });
    expect(useAppStore.getState().sequencerInstruments[0]).toMatchObject({
      performanceControllerValues: {}, performanceControllerMidiCCs: { setting: 21 }
    });
    expect(useAppStore.getState().performanceControllerSyncError).toBeNull();
  });

  it("accepts controller snapshots and uses their revision for the next rack edit", async () => {
    const { id, remote, updateController } = await setup(parallel);
    Object.assign(remote, { values: { setting: .9 }, midi_ccs: { setting: 21 }, revisions: { setting: 7 } });
    useAppStore.getState().receivePerformanceControllers(id, { one: structuredClone(remote) });
    expect(useAppStore.getState().sequencerInstruments[0]).toMatchObject({
      performanceControllerValues: { setting: .9 }, performanceControllerMidiCCs: { setting: 21 }
    });
    useAppStore.getState().setPerformanceControllerValue("one", "setting", .4);
    await useAppStore.getState().flushPerformanceControllers();
    expect(updateController).toHaveBeenCalledExactlyOnceWith(id, "one", {
      values: { setting: .4 }, midi_ccs: {}, revisions: { setting: 7 }
    });
  });

  it.each(["http", "websocket"])("sends live mixer changes over %s", async transport => {
    const { id, updateMixer } = await setup(parallel);
    const send = vi.fn(async (mixer: MixerState, revision?: number) => ({ mixer, revision: (revision ?? 0) + 1 }));
    if (transport === "websocket") setMixerTransport({ id, send });
    useAppStore.getState().setMixerStrip("one", { gainDb: -6, balance: .25 });
    useAppStore.getState().setMixerStrip("$master", { mute: true });
    await useAppStore.getState().flushMixer();
    const expectedMixer = useAppStore.getState().mixer;
    if (transport === "websocket") {
      expect(send).toHaveBeenCalledExactlyOnceWith(expectedMixer, 3);
      expect(updateMixer).not.toHaveBeenCalled();
    } else {
      expect(updateMixer).toHaveBeenCalledExactlyOnceWith(id, expectedMixer, 3);
    }
    expect(useAppStore.getState().mixerSyncError).toBeNull();
  });
});

const staleSetups: [string, (state: AppStore) => Partial<AppStore>][] = [
  ["patch revision", state => ({ patches: state.patches.map(p => ({ ...p, updated_at: "2026-11-10T23:00:00Z" })) })],
  ["routing", state => ({ audioGraph: { ...state.audioGraph, masterId: "changed-master" } })],
  ["parallel opt-in", () => ({ parallelPlaybackEnabled: false })],
  ["batch size", () => ({ parallelRenderBatchFrames: 512 })],
  ["browser settings", state => ({ browserClockLatencySettings: { ...state.browserClockLatencySettings,
    steadyHighWaterMs: state.browserClockLatencySettings.steadyHighWaterMs + 10 } })]
];

it.each(staleSetups)("rejects controller and mixer synchronization after a changed %s", async (_label, change) => {
  const { id, updateController, updateMixer } = await setup(true);
  useAppStore.setState(change(useAppStore.getState()));
  useAppStore.getState().receivePerformanceControllers(id, {
    one: { values: { setting: .9 }, midi_ccs: {}, revisions: { setting: 7 } }
  });
  expect(useAppStore.getState().sequencerInstruments[0].performanceControllerValues).toEqual({});
  useAppStore.getState().setPerformanceControllerValue("one", "setting", .8);
  useAppStore.getState().setMixerStrip("one", { gainDb: -6 });
  await useAppStore.getState().flushPerformanceControllers();
  await useAppStore.getState().flushMixer();
  expect(updateController).not.toHaveBeenCalled();
  expect(updateMixer).not.toHaveBeenCalled();
});
