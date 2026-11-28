import { sessionAudioSignature } from "./sessionSignature";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "./useAppStore";
import type { Patch, SessionCreateResponse } from "../types";
import { buildPersistedAppStateSnapshot, normalizeSessionInstrumentAssignments } from "./appStoreModel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.spyOn(api, "listPatches").mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

it("stops the active runtime on renderer failure and ignores another session's failure", () => {
  useAppStore.setState({ activeSessionId: "current", activeSessionState: "running" });
  useAppStore.getState().syncSequencerRuntime({ isPlaying: true });
  const failure = { session_id: "old", type: "renderer_failed", ts: "2026-11-07T00:00:00Z", payload: { detail: "Worker exited" } };
  useAppStore.getState().pushEvent(failure);
  expect(useAppStore.getState().activeSessionState).toBe("running");
  useAppStore.getState().pushEvent({ ...failure, session_id: "current" });
  expect(useAppStore.getState().activeSessionState).toBe("error");
  expect(useAppStore.getState().sequencer.isPlaying).toBe(false);
  expect(useAppStore.getState().error).toBe("Worker exited");
});

function savedPatch(id = "saved"): Patch {
  return { ...useAppStore.getState().currentPatch, id, name: "Saved",
    created_at: "2026-01-01", updated_at: "2026-01-02" };
}

it("applies a delayed load to its original tab after switching tabs", async () => {
  const pending = deferred<Patch>();
  vi.spyOn(api, "getPatch").mockReturnValue(pending.promise);
  const originalTab = useAppStore.getState().activeInstrumentTabId;
  const patch = savedPatch();
  const loading = useAppStore.getState().loadPatch(patch.id);
  useAppStore.getState().addInstrumentTab();
  const other = useAppStore.getState().currentPatch;
  pending.resolve(patch);
  await loading;
  expect(useAppStore.getState().currentPatch).toBe(other);
  expect(useAppStore.getState().instrumentTabs.find(tab => tab.id === originalTab)?.patch.id).toBe(patch.id);
});

it("keeps edits made during a save, including the new server identity", async () => {
  const pending = deferred<Patch>();
  vi.spyOn(api, "createPatch").mockReturnValue(pending.promise);
  const patch = savedPatch();
  const saving = useAppStore.getState().saveCurrentPatch();
  useAppStore.getState().setCurrentPatchMeta("Newer draft", "More changes");
  pending.resolve(patch);
  await saving;
  expect(useAppStore.getState().currentPatch).toMatchObject({ id: patch.id, name: "Newer draft", description: "More changes" });
});

it("does not replace a new draft with a delayed load", async () => {
  const pending = deferred<Patch>();
  vi.spyOn(api, "getPatch").mockReturnValue(pending.promise);
  const patch = savedPatch();
  const loading = useAppStore.getState().loadPatch(patch.id);
  useAppStore.getState().newPatch();
  useAppStore.getState().setCurrentPatchMeta("Replacement draft", "");
  pending.resolve(patch);
  await loading;
  expect(useAppStore.getState().currentPatch.name).toBe("Replacement draft");
});

it("retries the newest autosave after an older in-flight save fails", async () => {
  const pending = deferred<void>();
  const save = vi.spyOn(api, "saveAppState").mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(undefined);
  useAppStore.setState({ hasLoadedBootstrap: true });
  useAppStore.getState().setCurrentPatchMeta("A", "");
  await vi.advanceTimersByTimeAsync(400);
  expect(save).toHaveBeenCalledTimes(1);
  useAppStore.getState().setCurrentPatchMeta("B", "");
  pending.reject(new Error("offline"));
  await vi.advanceTimersByTimeAsync(800);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].instrumentTabs.some(tab => tab.patch.name === "B")).toBe(true);
  useAppStore.setState({ hasLoadedBootstrap: false });
});

it("finishes the newest recovery snapshot on explicit Save while an older autosave is in flight", async () => {
  const older = deferred<void>();
  const recover = vi.spyOn(api, "saveAppState").mockReturnValueOnce(older.promise).mockResolvedValue(undefined);
  vi.spyOn(api, "createPerformance").mockImplementation(async payload => ({
    ...payload, id: "saved-performance", created_at: "", updated_at: ""
  }));
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  useAppStore.setState({ hasLoadedBootstrap: true, performanceName: "First draft" });
  await vi.advanceTimersByTimeAsync(400);
  useAppStore.setState({ performanceName: "Two cartridges" });
  const saving = useAppStore.getState().saveCurrentPerformance();
  await vi.advanceTimersByTimeAsync(0);
  expect(recover).toHaveBeenCalledTimes(1);
  older.resolve();
  expect(await saving).toBe(true);
  expect(recover).toHaveBeenCalledTimes(2);
  expect(recover.mock.calls[1][0]).toMatchObject({
    performanceName: "Two cartridges", currentPerformanceId: "saved-performance"
  });
  useAppStore.setState({ hasLoadedBootstrap: false });
});

it("does not autosave every automation value and flushes the latest rack value on stop", async () => {
  const save = vi.spyOn(api, "saveAppState").mockResolvedValue(undefined);
  useAppStore.setState({ hasLoadedBootstrap: true, sequencerInstruments: [{ id: "bass", patchId: "patch",
    midiChannel: 1, level: 10, effectRoutes: [], effectSourceIds: [], performanceControllerValues: { tone: 100 } }] });
  await vi.advanceTimersByTimeAsync(400);
  save.mockClear();
  useAppStore.getState().syncSequencerRuntime({ isPlaying: true });
  for (const tone of [200, 300, 400]) {
    useAppStore.setState(state => ({ sequencerInstruments: state.sequencerInstruments.map(binding => ({
      ...binding, performanceControllerValues: { tone }
    })) }));
    await vi.advanceTimersByTimeAsync(400);
  }
  expect(save).not.toHaveBeenCalled();
  useAppStore.getState().syncSequencerRuntime({ isPlaying: false });
  await vi.advanceTimersByTimeAsync(400);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].sequencerInstruments[0].performanceControllerValues).toEqual({ tone: 400 });
  useAppStore.setState({ hasLoadedBootstrap: false });
});

it("shares concurrent session creation and deletes a creation cancelled by Stop", async () => {
  useAppStore.setState({ sequencerInstruments: [{ id: "instrument", patchId: "patch", midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [] }] });
  const pending = deferred<SessionCreateResponse>();
  const create = vi.spyOn(api, "createSession").mockReturnValue(pending.promise);
  const remove = vi.spyOn(api, "deleteSession").mockResolvedValue(undefined);
  const one = useAppStore.getState().ensureSession();
  const two = useAppStore.getState().ensureSession();
  const settled = Promise.allSettled([one, two]);
  await useAppStore.getState().stopSession();
  pending.resolve({ session_id: "cancelled", instruments: [], state: "idle", patch_id: "patch" });
  expect((await settled).map(result => result.status)).toEqual(["rejected", "rejected"]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledExactlyOnceWith("cancelled");
  expect(useAppStore.getState().activeSessionId).toBeNull();
});

it("shares overlapping engine starts and sends compile/start only once", async () => {
  useAppStore.setState({ sequencerInstruments: [{ id: "instrument", patchId: "patch", midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [] }] });
  const creating = deferred<SessionCreateResponse>();
  const create = vi.spyOn(api, "createSession").mockReturnValue(creating.promise);
  const compile = vi.spyOn(api, "compileSession").mockResolvedValue({ session_id: "shared", state: "compiled", orc: "", csd: "", diagnostics: [] });
  const start = vi.spyOn(api, "startSession").mockResolvedValue({ session_id: "shared", state: "running", detail: "started" });
  const first = useAppStore.getState().startSession();
  const second = useAppStore.getState().startSession();
  creating.resolve({ session_id: "shared", instruments: [], state: "idle", patch_id: "patch" });
  await Promise.all([first, second]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(compile).toHaveBeenCalledExactlyOnceWith("shared");
  expect(start).toHaveBeenCalledExactlyOnceWith("shared");
  expect(useAppStore.getState().activeSessionState).toBe("running");
});

it("creates a fresh session for a loaded performance even when its rack IDs match", async () => {
  const instruments = [{ id: "instrument", patchId: "patch", midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [],
    performanceControllerValues: { setting: .3 }, performanceControllerMidiCCs: { setting: 21 } }];
  const assignments = normalizeSessionInstrumentAssignments(instruments);
  const state = useAppStore.getState();
  useAppStore.setState({ sequencerInstruments: instruments, activeSessionId: "previous", activeSessionState: "compiled",
    activeSessionInstruments: assignments, performanceWorkspaceGeneration: 1,
    activeSessionAudioSignature: sessionAudioSignature(state) });
  vi.spyOn(api, "stopSession").mockResolvedValue({ session_id: "previous", state: "compiled", detail: "stopped" });
  const remove = vi.spyOn(api, "deleteSession").mockResolvedValue(undefined);
  const create = vi.spyOn(api, "createSession").mockResolvedValue({ session_id: "fresh", instruments: assignments, state: "idle", patch_id: "patch" });
  expect(await useAppStore.getState().ensureSession()).toBe("fresh");
  expect(remove).toHaveBeenCalledWith("previous");
  expect(create).toHaveBeenCalledWith({ instruments: assignments, audio_graph: state.audioGraph, mixer: state.mixer, engine_config: state.engineConfig, renderer_mode: "auto", browser_settings: state.browserClockLatencySettings, parallel_batch_frames: 256 });
  expect(useAppStore.getState().activeSessionWorkspaceGeneration).toBe(1);
});


it("retains clip app-state v5 when bootstrap saves a legacy mixer migration", async () => {
  const patch = { ...savedPatch(), is_template: false, instrument_type: "melody" as const };
  const app = buildPersistedAppStateSnapshot(useAppStore.getState());
  app.version = 5;
  delete app.audioGraph;
  delete app.mixer;
  app.sequencer.clipArrangement = { version: 1, revision: 0, end: 322560, lanes: [] };
  app.sequencerInstruments = [{ id: "drum-instrument", patchId: patch.id, midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [] }];
  vi.spyOn(api, "listOpcodes").mockResolvedValue([]);
  vi.mocked(api.listPatches).mockResolvedValue([{ ...patch, audio_inlet_names: [], audio_outlet_names: [] }]);
  vi.spyOn(api, "getPatch").mockResolvedValue(patch);
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  vi.spyOn(api, "listMidiInputs").mockResolvedValue([]);
  vi.spyOn(api, "getAppState").mockResolvedValue({ state: app, updated_at: "2026-11-03" });
  const save = vi.spyOn(api, "saveAppState").mockResolvedValue(undefined);
  await useAppStore.getState().loadBootstrap();
  expect(useAppStore.getState().error).toBeNull();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ version: 5, sequencer: expect.objectContaining({ clipArrangement: app.sequencer.clipArrangement }) }));
  useAppStore.setState({ hasLoadedBootstrap: false });
});

it("keeps the renderer choice out of saved state and recreates a stopped session when it changes", async () => {
  useAppStore.setState({ sequencerInstruments: [{ id: "instrument", patchId: "patch", midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [] }] });
  useAppStore.getState().setParallelPlaybackEnabled(false);
  const create = vi.spyOn(api, "createSession").mockResolvedValueOnce({ session_id: "single", state: "idle", patch_id: "patch", instruments: [] })
    .mockResolvedValueOnce({ session_id: "auto", state: "idle", patch_id: "patch", instruments: [] });
  vi.spyOn(api, "stopSession").mockResolvedValue({ session_id: "single", state: "compiled", detail: "stopped" });
  const remove = vi.spyOn(api, "deleteSession").mockResolvedValue(undefined);
  await useAppStore.getState().ensureSession();
  expect(create.mock.calls[0][0].renderer_mode).toBeUndefined();
  useAppStore.getState().setParallelPlaybackEnabled(true);
  expect(JSON.stringify(buildPersistedAppStateSnapshot(useAppStore.getState()))).not.toContain("parallelPlaybackEnabled");
  await useAppStore.getState().ensureSession();
  expect(remove).toHaveBeenCalledWith("single");
  expect(create.mock.calls[1][0]).toMatchObject({ renderer_mode: "auto", browser_settings: useAppStore.getState().browserClockLatencySettings, parallel_batch_frames: 256 });
  useAppStore.setState({ activeSessionState: "running" });
  useAppStore.getState().setParallelPlaybackEnabled(false);
  expect(useAppStore.getState().parallelPlaybackEnabled).toBe(true);
});

it("discards an in-flight session created for a superseded renderer preference", async () => {
  useAppStore.setState({ sequencerInstruments: [{ id: "instrument", patchId: "patch", midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [] }] });
  const pending = deferred<SessionCreateResponse>();
  vi.spyOn(api, "createSession").mockReturnValue(pending.promise);
  const remove = vi.spyOn(api, "deleteSession").mockResolvedValue(undefined);
  const creating = useAppStore.getState().ensureSession();
  useAppStore.getState().setParallelPlaybackEnabled(false);
  pending.resolve({ session_id: "old", state: "idle", patch_id: "patch", instruments: [] });
  await expect(creating).rejects.toThrow("setup changed");
  expect(remove).toHaveBeenCalledWith("old");
  expect(useAppStore.getState().activeSessionId).toBeNull();
});

it("saves batch size separately from opt-in and replaces a stopped parallel session on change", async () => {
  useAppStore.setState({ parallelPlaybackEnabled: true,
    sequencerInstruments: [{ id: "instrument", patchId: "patch", midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [] }] });
  const create = vi.spyOn(api, "createSession")
    .mockResolvedValueOnce({ session_id: "first", state: "idle", patch_id: "patch", instruments: [] })
    .mockResolvedValueOnce({ session_id: "second", state: "idle", patch_id: "patch", instruments: [] });
  const stop = vi.spyOn(api, "stopSession").mockResolvedValue({ session_id: "first", state: "compiled", detail: "stopped" });
  const remove = vi.spyOn(api, "deleteSession").mockResolvedValue(undefined);
  await useAppStore.getState().ensureSession();
  useAppStore.setState({ activeSessionState: "running" });
  useAppStore.getState().setParallelRenderBatchFrames(1024);
  expect(useAppStore.getState().parallelRenderBatchFrames).toBe(256);
  expect(stop).not.toHaveBeenCalled();
  useAppStore.setState({ activeSessionState: "compiled" });
  useAppStore.getState().setParallelRenderBatchFrames(1024);
  expect(buildPersistedAppStateSnapshot(useAppStore.getState()).parallelRenderBatchFrames).toBe(1024);
  await useAppStore.getState().ensureSession();
  expect(remove).toHaveBeenCalledWith("first");
  expect(create.mock.calls[1][0]).toMatchObject({ renderer_mode: "auto", parallel_batch_frames: 1024 });
});

it.each([undefined, 32, 255, 1024, 31, 1025, 128.5, "512"])("restores batch preference safely (%s)", async value => {
  const app = buildPersistedAppStateSnapshot(useAppStore.getState());
  Object.assign(app, { parallelRenderBatchFrames: value });
  vi.spyOn(api, "listOpcodes").mockResolvedValue([]);
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  vi.spyOn(api, "listMidiInputs").mockResolvedValue([]);
  vi.spyOn(api, "getAppState").mockResolvedValue({ state: app, updated_at: "2026-11-08" });
  vi.spyOn(api, "saveAppState").mockResolvedValue(undefined);
  await useAppStore.getState().loadBootstrap();
  const expected = [32, 255, 1024].includes(value as number) ? value : 256;
  expect(useAppStore.getState().parallelRenderBatchFrames).toBe(expected);
  expect(useAppStore.getState().parallelPlaybackEnabled).toBe(true);
  expect(useAppStore.getState().error).toBeNull();
  useAppStore.setState({ hasLoadedBootstrap: false });
});

it("keeps engine settings with the project across instrument edits, recovery and project replacement", async () => {
  const state = useAppStore.getState();
  const defaults = state.engineConfig;
  const patch = savedPatch();
  patch.graph = { ...patch.graph, engine_config: { ...defaults, sr: 32000 } };
  vi.spyOn(api, "getPatch").mockResolvedValue(patch);
  const createPatch = vi.spyOn(api, "createPatch");
  const updatePatch = vi.spyOn(api, "updatePatch");

  state.applyEngineConfig({ sr: 44100, controlRate: 2205, softwareBuffer: 256, hardwareBuffer: 1024 });
  const project = { ...defaults, sr: 44100, control_rate: 2205, ksmps: 20, software_buffer: 256, hardware_buffer: 1024 };
  expect(useAppStore.getState().currentPatch).toBe(state.currentPatch);
  await state.loadPatch(patch.id);
  state.addInstrumentTab();
  expect(useAppStore.getState().engineConfig).toEqual(project);
  expect(createPatch).not.toHaveBeenCalled();
  expect(updatePatch).not.toHaveBeenCalled();

  const snapshot = state.buildSequencerConfigSnapshot();
  expect(snapshot.engineConfig).toEqual(project);
  expect(buildPersistedAppStateSnapshot(useAppStore.getState()).engineConfig).toEqual(project);
  await state.newPerformanceWorkspace();
  expect(useAppStore.getState().engineConfig).toEqual(defaults);
  state.applySequencerConfigSnapshot(snapshot);
  expect(useAppStore.getState().engineConfig).toEqual(project);
  delete snapshot.engineConfig;
  state.applySequencerConfigSnapshot(snapshot);
  expect(useAppStore.getState().engineConfig).toEqual(defaults);
});
