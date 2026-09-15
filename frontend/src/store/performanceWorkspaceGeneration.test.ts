import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/collapsed_gui.json";
import { api } from "../api/client";
import { buildPersistedAppStateSnapshot, parseSequencerConfigSnapshot, buildSequencerConfigSnapshot } from "./appStoreModel";
import { useAppStore } from "./useAppStore";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
afterEach(() => vi.restoreAllMocks());
const parsed = parseSequencerConfigSnapshot(fixture.config, [], null);
const config = buildSequencerConfigSnapshot(parsed.sequencer, parsed.instruments, parsed.audioGraph, parsed.mixer);
const generation = () => useAppStore.getState().performanceWorkspaceGeneration;
it("advances only after successful replacements, including loading the same ID twice", async () => {
  const saved = { id: "same", name: "Audit", description: "", config, created_at: "2026-09-15", updated_at: "2026-09-15" };
  vi.spyOn(api, "getPerformance").mockResolvedValue(saved as Awaited<ReturnType<typeof api.getPerformance>>);
  await useAppStore.getState().loadPerformance("same"); expect(generation()).toBe(1);
  await useAppStore.getState().loadPerformance("same"); expect(generation()).toBe(2);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config); expect(generation()).toBe(3);
  useAppStore.getState().applySequencerConfigSnapshot(null); expect(generation()).toBe(3);
  vi.mocked(api.getPerformance).mockRejectedValueOnce(new Error("offline"));
  await useAppStore.getState().loadPerformance("other"); expect(generation()).toBe(3);
  await useAppStore.getState().newPerformanceWorkspace(); expect(generation()).toBe(4);
  await useAppStore.getState().newPerformanceWorkspace(); expect(generation()).toBe(5);
  useAppStore.setState({ activeSessionState: "running" });
  await useAppStore.getState().newPerformanceWorkspace(); expect(generation()).toBe(5);
});
it("does not advance on transport, edits or first save, and never persists the counter", async () => {
  await useAppStore.getState().newPerformanceWorkspace(); const before = generation();
  useAppStore.getState().setSequencerBpm(130);
  useAppStore.getState().syncSequencerTransportRuntime({ isPlaying: true, playhead: 2 });
  vi.spyOn(api, "createPerformance").mockResolvedValue({ id: "saved", name: "Audit", description: "", config, created_at: "2026-09-15", updated_at: "2026-09-15" } as Awaited<ReturnType<typeof api.createPerformance>>);
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  await useAppStore.getState().saveCurrentPerformance();
  expect(useAppStore.getState().currentPerformanceId).toBe("saved"); expect(generation()).toBe(before);
  expect(buildPersistedAppStateSnapshot(useAppStore.getState())).not.toHaveProperty("performanceWorkspaceGeneration");
  expect(useAppStore.getState().buildSequencerConfigSnapshot()).not.toHaveProperty("performanceWorkspaceGeneration");
});
