import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "./useAppStore";
import type { Patch, SessionCreateResponse } from "../types";

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
