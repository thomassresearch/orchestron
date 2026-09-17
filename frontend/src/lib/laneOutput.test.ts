import { beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import config from "../../../backend/tests/fixtures/sequencers/arranger_seek.json";
import { useAppStore } from "../store/useAppStore";
import { capturePersistWatchState, buildPersistedAppStateSnapshot } from "../store/appStoreModel";
import { laneOutputSuppressed, reconcileLaneOutput, setLaneOutputSender, toggleLaneOutput, useLaneOutput, withLaneOutput } from "./laneOutput";
import type { SessionSequencerConfigRequest, SessionSequencerStatus } from "../types";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  reconcileLaneOutput(useAppStore.getState().sequencer, true);
});

it("never changes authored data, mixer, autosave watch state or export snapshots", () => {
  const store = useAppStore.getState(), id = store.sequencer.tracks[0].id;
  const snapshot = store.buildSequencerConfigSnapshot(), watch = capturePersistWatchState(store);
  const appState = buildPersistedAppStateSnapshot(store);
  toggleLaneOutput(id, "mute");
  toggleLaneOutput(id, "solo");
  expect(useAppStore.getState().buildSequencerConfigSnapshot()).toEqual(snapshot);
  expect(buildPersistedAppStateSnapshot(useAppStore.getState())).toEqual(appState);
  expect(capturePersistWatchState(useAppStore.getState())).toEqual(watch);
  expect(useAppStore.getState().mixer).toBe(store.mixer);
  expect(useAppStore.getState().sequencerEditRevision).toBe(store.sequencerEditRevision);
});

it("retains controls through playback and session changes but resets on load", () => {
  const store = useAppStore.getState(), id = store.sequencer.tracks[0].id;
  toggleLaneOutput(id, "mute");
  store.syncSequencerRuntime({ isPlaying: true });
  useAppStore.setState({ activeSessionId: "replacement" });
  expect(useLaneOutput.getState().lanes[id].mute).toBe(true);
  store.applySequencerConfigSnapshot(fixture.config);
  expect(useLaneOutput.getState().lanes).toEqual({});
});

it("adds temporary controls only to runtime requests and prunes removed lanes", () => {
  toggleLaneOutput("lead", "mute");
  const request = withLaneOutput(config as SessionSequencerConfigRequest);
  expect(request.lane_output?.lanes.lead.mute).toBe(true);
  expect(config).not.toHaveProperty("lane_output");
  reconcileLaneOutput({ ...useAppStore.getState().sequencer, tracks: [] });
  expect(useLaneOutput.getState().lanes).toEqual({});
});

it("resolves solo dependencies, multiple solos and explicit mute precedence", () => {
  const routes = { a: { channels: [3] }, b: { channels: [3] }, arp: { channels: [1], input: 3 }, other: { channels: [1] } };
  expect(laneOutputSuppressed("arp", { a: { mute: false, solo: true } }, routes)).toBe(false);
  expect(laneOutputSuppressed("b", { a: { mute: false, solo: true } }, routes)).toBe(true);
  expect(laneOutputSuppressed("a", { arp: { mute: false, solo: true } }, routes)).toBe(false);
  expect(laneOutputSuppressed("other", { a: { mute: false, solo: true }, other: { mute: false, solo: true } }, routes)).toBe(false);
  expect(laneOutputSuppressed("a", { a: { mute: true, solo: true } }, routes)).toBe(true);
});

it("ignores failures from superseded commands and previous sessions", async () => {
  let reject!: (reason: Error) => void;
  const send = vi.fn(() => new Promise<SessionSequencerStatus>((_, fail) => { reject = fail; }));
  const clear = setLaneOutputSender(send);
  toggleLaneOutput("lead", "mute");
  expect(send).toHaveBeenCalledOnce();
  clear();
  reject(new Error("old session"));
  await Promise.resolve(); await Promise.resolve();
  expect(useLaneOutput.getState().error).toBeNull();
});
