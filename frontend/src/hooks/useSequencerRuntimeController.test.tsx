// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import configFixture from "../../../backend/tests/fixtures/sequencers/arranger_seek.json";
import { api } from "../api/client";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import { useAppStore } from "../store/useAppStore";
import type { SessionSequencerConfigRequest, SessionSequencerStatus } from "../types";
import { useBrowserClockAudioController } from "./useBrowserClockAudioController";
import { useSequencerRuntimeController } from "./useSequencerRuntimeController";

vi.mock("./useBrowserClockAudioController");
const noop = () => {};
const config = configFixture as SessionSequencerConfigRequest;
const buildConfig = vi.fn(() => config);
const buildArpeggiators = vi.fn(() => ({ tempo_bpm: 120, arpeggiators: [] }));
const setError = vi.fn();
const errors = { noActiveRuntimeSession: "Missing runtime", startInstrumentsFirstForSequencer: "Start first",
  noActiveInstrumentSessionForSequencer: "Missing session", failedToStartSequencer: "Start failed",
  failedToSyncSequencerStatus: "Sync failed", failedToUpdateSequencerConfig: "Config failed",
  sessionNotRunningSequencerStopped: "Stopped" };

function status(step: number, running = true): SessionSequencerStatus {
  return { running, current_step: step % 32, cycle: Math.floor(step / 32), step_count: 32,
    transport_subunit: step * 420, tracks: [], controller_tracks: [], arpeggiators: [] } as unknown as SessionSequencerStatus;
}
function setup(playing: boolean) {
  useAppStore.getState().setSequencerPlaying(playing);
  return renderHook(() => {
    const store = useAppStore();
    return useSequencerRuntimeController({ ...store, activePage: "sequencer",
      sequencer: mergedSequencerState(store.sequencer, store.sequencerRuntime), sequencerConfig: store.sequencer,
      buildBackendSequencerConfig: buildConfig, buildBackendArpeggiatorConfig: buildArpeggiators,
      errors, setSequencerError: setError });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", class { close() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  useAppStore.setState({ activeSessionId: "session", activeSessionState: "running" });
  const client = { connect: vi.fn().mockResolvedValue(undefined), stopSequencer: vi.fn().mockResolvedValue(status(0, false)) };
  const browser = { browserClockClientRef: { current: client as unknown as ReturnType<typeof useBrowserClockAudioController>["browserClockClientRef"]["current"] }, browserAudioError: null, browserAudioDiagnostics: null,
    browserAudioStatus: "live" as const, browserAudioTransport: "browser_clock" as const,
    disconnectBrowserAudio: noop, disconnectBrowserClockAudio: noop, displayedSequencerTransportSubunit: 0, readPlaybackTransportSubunit: () => null,
    effectiveAudioOutputMode: "browser_clock" as const, effectiveAudioOutputModeRef: { current: "browser_clock" as const },
    onApplyBrowserClockLatencySettings: noop, reportBrowserAudioConnectionError: noop, resetBrowserAudioState: noop,
    runtimeAudioOutputMode: "browser_clock" as const };
  vi.mocked(useBrowserClockAudioController).mockImplementation(params => ({ ...browser, displayedSequencer: params.sequencer }));
  vi.spyOn(api, "seekSessionSequencer").mockImplementation(async (_session, request) => status(request.position_step));
  vi.spyOn(api, "configureSessionSequencer").mockResolvedValue(status(0));
  vi.spyOn(api, "configureSessionArpeggiators").mockResolvedValue([]);
  setError.mockClear();
  buildConfig.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("moves stopped playback locally without starting or contacting the runtime", async () => {
  const { result } = setup(false);
  await act(() => result.current.seekSequencerTransport(24));
  const { sequencerRuntime } = useAppStore.getState();
  expect(sequencerRuntime.transportSubunit).toBe(24 * 420);
  expect(sequencerRuntime.isPlaying).toBe(false);
  expect(api.seekSessionSequencer).not.toHaveBeenCalled();
});

it("seeks running playback with the newly cleared loop and suppresses its debounced config request", async () => {
  useAppStore.getState().setSequencerArrangerLoopSelection({ startStep: 32, endStep: 40 });
  const { result } = setup(true);
  await act(async () => {
    useAppStore.getState().setSequencerArrangerLoopSelection(null);
    await result.current.seekSequencerTransport(8);
  });
  expect(buildConfig).toHaveBeenLastCalledWith(expect.objectContaining({ arrangerLoopSelection: null }));
  expect(api.seekSessionSequencer).toHaveBeenCalledExactlyOnceWith("session", { config, position_step: 8 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(api.configureSessionSequencer).not.toHaveBeenCalled();
  expect(useAppStore.getState().sequencerRuntime.isPlaying).toBe(true);
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(8 * 420);
});

it("ignores an older seek response after a newer click", async () => {
  const responses: Array<(value: SessionSequencerStatus) => void> = [];
  vi.mocked(api.seekSessionSequencer).mockImplementation(() => new Promise(resolve => responses.push(resolve)));
  const { result } = setup(true);
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => { first = result.current.seekSequencerTransport(8); second = result.current.seekSequencerTransport(24); });
  await act(async () => { responses[1](status(24)); await second; });
  await act(async () => { responses[0](status(8)); await first; });
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(24 * 420);
});

it("ignores a seek response after Stop", async () => {
  let respond!: (value: SessionSequencerStatus) => void;
  vi.mocked(api.seekSessionSequencer).mockImplementation(() => new Promise(resolve => { respond = resolve; }));
  const { result } = setup(true);
  let seek!: Promise<void>;
  act(() => { seek = result.current.seekSequencerTransport(24); });
  await act(() => result.current.stopSequencerTransport(false));
  await act(async () => { respond(status(24)); await seek; });
  expect(useAppStore.getState().sequencerRuntime.isPlaying).toBe(false);
});
