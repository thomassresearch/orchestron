import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { buildPersistedAppStateSnapshot, defaultSequencerState } from "./appStoreModel";
import { useAppStore } from "./useAppStore";

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.spyOn(api, "listOpcodes").mockResolvedValue([]);
  vi.spyOn(api, "listPatches").mockResolvedValue([]);
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  vi.spyOn(api, "listMidiInputs").mockResolvedValue([]);
  vi.spyOn(api, "getAppState").mockRejectedValue(new Error("App state not found"));
  vi.spyOn(api, "saveAppState").mockResolvedValue(undefined);
});

afterEach(() => {
  useAppStore.setState({ hasLoadedBootstrap: false });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([undefined, "1", "0"])("selects the arranger on fresh startup and New with VITE_CLIP_ARRANGER=%s", async flag => {
  vi.stubEnv("VITE_CLIP_ARRANGER", flag);
  await useAppStore.getState().loadBootstrap();
  expect(useAppStore.getState().error).toBeNull();
  const startup = useAppStore.getState().sequencer;
  expect(Boolean(startup.clipArrangement)).toBe(flag !== "0");
  if (flag !== "0") {
    expect(startup.clipArrangement?.lanes).toEqual([]);
    expect(startup.tracks).toEqual([]);
    expect(startup.pianoRolls).toHaveLength(1);
  } else {
    expect(startup.tracks).toHaveLength(1);
  }

  await useAppStore.getState().newPerformanceWorkspace();
  const created = useAppStore.getState().sequencer;
  expect(Boolean(created.clipArrangement)).toBe(flag !== "0");
  expect(created.tracks).toEqual([]);
  expect(created.pianoRolls).toHaveLength(flag === "0" ? 0 : 1);
  const snapshot = useAppStore.getState().buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(flag === "0" ? 22 : 23);
});

it.each([undefined, "0"])("preserves saved legacy and clip formats regardless of VITE_CLIP_ARRANGER=%s", async flag => {
  vi.stubEnv("VITE_CLIP_ARRANGER", flag);
  for (const clips of [false, true]) {
    const sequencer = defaultSequencerState();
    if (clips) {
      sequencer.tracks = [];
      sequencer.clipArrangement = { version: 1, revision: 0, end: 322560, lanes: [] };
    }
    useAppStore.setState({ sequencer, hasLoadedBootstrap: false });
    const saved = useAppStore.getState().buildSequencerConfigSnapshot();
    const persisted = buildPersistedAppStateSnapshot(useAppStore.getState());
    vi.mocked(api.getAppState).mockResolvedValue({ state: persisted, updated_at: "2026-11-06" });
    await useAppStore.getState().newPerformanceWorkspace();
    await useAppStore.getState().loadBootstrap();
    expect(useAppStore.getState().error).toBeNull();
    expect(Boolean(useAppStore.getState().sequencer.clipArrangement)).toBe(clips);
    expect(useAppStore.getState().buildSequencerConfigSnapshot()).toEqual(saved);

    await useAppStore.getState().newPerformanceWorkspace();
    useAppStore.getState().applySequencerConfigSnapshot(saved);
    expect(useAppStore.getState().error).toBeNull();
    expect(useAppStore.getState().buildSequencerConfigSnapshot()).toEqual(saved);
  }
});
