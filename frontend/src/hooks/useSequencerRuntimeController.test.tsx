import { sequencerTransportSubunitsPerStep } from "../lib/sequencer";
// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import configFixture from "../../../backend/tests/fixtures/sequencers/arranger_seek.json";
import { api } from "../api/client";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import { buildPerformanceExportPayload } from "../lib/bundleImportExport";
import { buildSequencerPlaybackRange, buildBackendArpeggiatorConfigs } from "../appOrchestration";
import { arrangementRangeLanes } from "../lib/arrangementRange";
import { useAppStore } from "../store/useAppStore";
import type { SequencerState, SessionSequencerConfigRequest, SessionSequencerStatus } from "../types";
import { useBrowserClockAudioController } from "./useBrowserClockAudioController";
import { useSequencerRuntimeController } from "./useSequencerRuntimeController";

vi.mock("./useBrowserClockAudioController");
const noop = () => {};
const config = configFixture as SessionSequencerConfigRequest;
const buildConfig = vi.fn(() => config);
const buildArpeggiators = vi.fn(() => ({ tempo_bpm: 120, arpeggiators: [] }));
const setError = vi.fn();
const audition = vi.fn();
const startSequencer = vi.fn();
const deviceTransport = vi.fn();
let audioParams: Parameters<typeof useBrowserClockAudioController>[0];
const errors = { noActiveRuntimeSession: "Missing runtime", startInstrumentsFirstForSequencer: "Start first",
  noActiveInstrumentSessionForSequencer: "Missing session", failedToStartSequencer: "Start failed",
  failedToSyncSequencerStatus: "Sync failed", failedToUpdateSequencerConfig: "Config failed",
  sessionNotRunningSequencerStopped: "Stopped" };

function status(step: number, running = true): SessionSequencerStatus {
  return { running, current_step: step % 32, cycle: Math.floor(step / 32), step_count: 32,
    transport_subunit: step * sequencerTransportSubunitsPerStep(), tracks: [], controller_tracks: [], arpeggiators: [] } as unknown as SessionSequencerStatus;
}
function setup(playing: boolean, builders?: {
  sequencer: (state?: SequencerState) => SessionSequencerConfigRequest;
  arpeggiators: (state?: SequencerState) => ReturnType<typeof buildBackendArpeggiatorRequest>;
}) {
  useAppStore.getState().setSequencerPlaying(playing);
  return renderHook(() => {
    const store = useAppStore();
    return useSequencerRuntimeController({ ...store, activePage: "sequencer",
      sequencer: mergedSequencerState(store.sequencer, store.sequencerRuntime), sequencerConfig: store.sequencer,
      buildBackendSequencerConfig: builders?.sequencer ?? buildConfig, buildBackendArpeggiatorConfig: builders?.arpeggiators ?? buildArpeggiators,
      errors, setSequencerError: setError });
  });
}

function buildBackendArpeggiatorRequest(state = useAppStore.getState().sequencer) {
  return { tempo_bpm: state.timing.tempoBPM, arpeggiators: buildBackendArpeggiatorConfigs(state) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", class { close() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  useAppStore.setState({ activeSessionId: "session", activeSessionState: "running" });
  audition.mockReset().mockResolvedValue({ ...status(0), auditions: {} });
  startSequencer.mockReset().mockImplementation(async (_session, request) => ({ ...status(request.positionStep), arranger_active: request.arrangerActive }));
  deviceTransport.mockReset().mockImplementation(async (_session, request) => ({ ...status(0, request.action === "play"),
    independent_sources: true, arranger_active: !!request.arranger && request.action === "play",
    arrangement_running: request.action === "play", arrangement_transport_subunit: (request.position_step ?? 0) * sequencerTransportSubunitsPerStep() }));
  const client = { audition, startSequencer, deviceTransport, prime: vi.fn().mockResolvedValue(undefined), connect: vi.fn().mockResolvedValue(undefined), stopSequencer: vi.fn().mockResolvedValue(status(0, false)) };
  const browser = { browserClockClientRef: { current: client as unknown as ReturnType<typeof useBrowserClockAudioController>["browserClockClientRef"]["current"] }, browserAudioError: null, browserAudioDiagnostics: null,
    browserAudioStatus: "live" as const, browserAudioTransport: "browser_clock" as const,
    disconnectBrowserAudio: noop, disconnectBrowserClockAudio: noop, displayedSequencerTransportSubunit: 0, readPlaybackTransportSubunit: () => null,
    effectiveAudioOutputMode: "browser_clock" as const, effectiveAudioOutputModeRef: { current: "browser_clock" as const },
    onApplyBrowserClockLatencySettings: noop, reportBrowserAudioConnectionError: noop, resetBrowserAudioState: noop,
    runtimeAudioOutputMode: "browser_clock" as const };
  vi.mocked(useBrowserClockAudioController).mockImplementation(params => { audioParams = params; return { ...browser, displayedSequencer: params.sequencer }; });
  vi.spyOn(api, "seekSessionSequencer").mockImplementation(async (_session, request) => status(request.position_step));
  vi.spyOn(api, "configureSessionSequencer").mockResolvedValue(status(0));
  vi.spyOn(api, "configureSessionArpeggiators").mockResolvedValue([]);
  setError.mockClear();
  buildConfig.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([false, true])("sends a range edit with arpeggiators as one live configuration, including preparation failure=%s", async fail => {
  useAppStore.getState().addArpeggiator();
  const arp = useAppStore.getState().sequencer.arpeggiators[0];
  useAppStore.getState().updateArpeggiator(arp.id, { playbackMode: "arranger", padLoopEnabled: true });
  const build = vi.fn((state = useAppStore.getState().sequencer): SessionSequencerConfigRequest => ({ ...config,
    timing: { ...config.timing, tempo_bpm: state.timing.tempoBPM },
    tracks: config.tracks.map((track, index) => ({ ...track, pad_loop_sequence: state.tracks[index]?.padLoopSequence ?? track.pad_loop_sequence })),
    arpeggiators: buildBackendArpeggiatorConfigs(state) }));
  const { result } = setup(false, { sequencer: build, arpeggiators: buildBackendArpeggiatorRequest });
  await act(() => result.current.transportDevice(null, true));
  await act(() => vi.advanceTimersByTimeAsync(100));
  vi.mocked(api.configureSessionSequencer).mockClear();
  vi.mocked(api.configureSessionArpeggiators).mockClear();
  startSequencer.mockClear(); deviceTransport.mockClear();
  if (fail) vi.mocked(api.configureSessionSequencer).mockRejectedValueOnce(new Error("Preparation failed"));
  else vi.mocked(api.configureSessionSequencer).mockResolvedValueOnce(status(0));
  const before = useAppStore.getState();
  const updates = arrangementRangeLanes(before.sequencer).map(lane => ({ id: lane.id, kind: lane.kind,
    rootSequence: [{ type: "pad" as const, padIndex: 0 }, { type: "pad" as const, padIndex: 0 }, { type: "pad" as const, padIndex: 1 }] }));
  act(() => before.applyArrangementRangeEdit(updates));
  const edited = useAppStore.getState().sequencer;
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(api.configureSessionSequencer).toHaveBeenCalledTimes(1);
  expect(api.configureSessionSequencer).toHaveBeenLastCalledWith("session", expect.objectContaining({
    tracks: expect.arrayContaining([expect.objectContaining({ pad_loop_sequence: [0, 0, 1] })]),
    arpeggiators: buildBackendArpeggiatorConfigs(edited) }));
  expect(api.configureSessionArpeggiators).not.toHaveBeenCalled();
  expect(startSequencer).not.toHaveBeenCalled(); expect(deviceTransport).not.toHaveBeenCalled();
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(before.sequencerRuntime.transportSubunit);
  expect(arrangementRangeLanes(useAppStore.getState().sequencer).map(lane => lane.pattern.rootSequence)).toEqual(updates.map(update => update.rootSequence));
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(api.configureSessionSequencer).toHaveBeenCalledTimes(1);
  if (fail) expect(setError).toHaveBeenCalledWith(expect.stringContaining("Preparation failed"));
  // Once the arranger stops, restoring an earlier arp configuration must still
  // reach independently running devices, even if it matches the last block edit.
  await act(() => result.current.stopSequencerTransport(false));
  vi.mocked(api.configureSessionArpeggiators).mockClear();
  act(() => useAppStore.getState().updateArpeggiator(arp.id, { gateRatio: 0.65 }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  act(() => useAppStore.getState().updateArpeggiator(arp.id, { gateRatio: arp.gateRatio }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(api.configureSessionArpeggiators).toHaveBeenCalledTimes(2);
  // Live-mode arp changes still use their dedicated endpoint because they do not
  // increment the authored arrangement revision.
  act(() => useAppStore.getState().updateArpeggiator(arp.id, { playbackMode: "live" }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  vi.mocked(api.configureSessionArpeggiators).mockClear();
  act(() => useAppStore.getState().updateArpeggiator(arp.id, { gateRatio: 0.65 }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(api.configureSessionArpeggiators).toHaveBeenCalledTimes(1);
});

it("moves stopped playback locally without starting or contacting the runtime", async () => {
  const { result } = setup(false);
  await act(() => result.current.seekSequencerTransport(24));
  const { sequencerRuntime } = useAppStore.getState();
  expect(sequencerRuntime.transportSubunit).toBe(24 * sequencerTransportSubunitsPerStep());
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
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(8 * sequencerTransportSubunitsPerStep());
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
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(24 * sequencerTransportSubunitsPerStep());
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


it("cancels a launch that is still preparing without sending a stale audition", async () => {
  let prepared!: (value: SessionSequencerStatus) => void;
  vi.mocked(api.configureSessionSequencer).mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const { result } = setup(true);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  let start!: Promise<void>;
  act(() => { start = result.current.auditionDevice(id, { type: "pad", padIndex: 1 }); });
  await act(() => result.current.auditionDevice(id, "cancel"));
  await act(async () => { prepared(status(0)); await start; });
  expect(audition).toHaveBeenCalledExactlyOnceWith("session", { action: "cancel", track_ids: [id] });
  expect(useAppStore.getState().performanceAuditions).toEqual({});
});

it("ignores audition responses from a replaced performance workspace", async () => {
  let respond!: (value: SessionSequencerStatus) => void;
  audition.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
  const { result } = setup(true);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  let start!: Promise<void>;
  await act(async () => { start = result.current.auditionDevice(id, { type: "pad", padIndex: 1 }); await Promise.resolve(); });
  act(() => { useAppStore.setState(state => ({ performanceWorkspaceGeneration: state.performanceWorkspaceGeneration + 1 })); });
  await act(async () => { respond({ ...status(24), auditions: { [id]: { active: true, queued: null } } }); await start; });
  expect(useAppStore.getState().performanceAuditions).toEqual({});
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).not.toBe(24 * sequencerTransportSubunitsPerStep());
});

it("releases a momentary gesture during preparation and suppresses its late launch", async () => {
  let prepared!: (value: SessionSequencerStatus) => void;
  vi.mocked(api.configureSessionSequencer).mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const { result } = setup(true);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  let start!: Promise<void>;
  act(() => { start = result.current.auditionDevice(id, { action: "preview_start", gestureId: "hold", item: { type: "pad", padIndex: 1 } }); });
  await act(() => result.current.auditionDevice(id, { action: "preview_end", gestureId: "hold" }));
  await act(async () => { prepared(status(0)); await start; });
  expect(audition).toHaveBeenCalledExactlyOnceWith("session", { action: "preview_end", gesture_id: "hold", revision: 2, track_ids: [id] });
});

it("transport stop cancels a prepared preview and its later release cannot resume a lane", async () => {
  let prepared!: (value: SessionSequencerStatus) => void;
  vi.mocked(api.configureSessionSequencer).mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const { result } = setup(true);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  let start!: Promise<void>;
  act(() => { start = result.current.auditionDevice(id, { action: "preview_start", gestureId: "hold", item: { type: "pad", padIndex: 1 } }); });
  await act(() => result.current.stopSequencerTransport(false));
  await act(async () => { prepared(status(0)); await start; });
  await act(() => result.current.auditionDevice(id, { action: "preview_end", gestureId: "hold" }));
  expect(audition).not.toHaveBeenCalled();
});

it("keeps the stopped song cursor through preview status and audible clock updates, then resumes there", async () => {
  const { result } = setup(false);
  await act(() => result.current.seekSequencerTransport(8));
  audition.mockResolvedValueOnce({ ...status(16), arranger_active: false, auditions: {} });
  const id = useAppStore.getState().sequencer.tracks[0].id;
  await act(() => result.current.auditionDevice(id, { action: "preview_start", gestureId: "hold", item: { type: "pad", padIndex: 1 } }));
  expect(useAppStore.getState().sequencerRuntime).toMatchObject({
    isPlaying: true, arrangerActive: false, transportSubunit: 16 * sequencerTransportSubunitsPerStep(), arrangerTransportSubunit: 8 * sequencerTransportSubunitsPerStep()
  });
  act(() => audioParams.applyBrowserClockTransportEventsRef.current([{
    kind: "step", target_frame: 48000, target_frame_offset: 0, payload: { ...status(24), previous_step: 16, arranger_active: false }
  }]));
  expect(useAppStore.getState().sequencerRuntime).toMatchObject({
    transportSubunit: 24 * sequencerTransportSubunitsPerStep(), arrangerTransportSubunit: 8 * sequencerTransportSubunitsPerStep(), arrangerActive: false
  });
  await act(() => result.current.transportDevice(null, true));
  expect(buildConfig).toHaveBeenLastCalledWith(useAppStore.getState().sequencer, "runtime", true);
  expect(deviceTransport).toHaveBeenCalledWith("session", expect.objectContaining({ position_step: 8, arranger: true }));
  expect(useAppStore.getState().sequencerRuntime.arrangerActive).toBe(true);
});

it("compiles temporary workspace items without changing authored song order", async () => {
  const { result } = setup(false);
  const track = useAppStore.getState().sequencer.tracks[0];
  const original = structuredClone(track.padLoopPattern);
  await act(() => result.current.auditionDevice(track.id, { action: "workspace_start", gestureId: "workspace", items: [{ type: "pad", padIndex: 1 }, { type: "pause", lengthBeats: 2 }] }));
  expect(audition).toHaveBeenCalledWith("session", expect.objectContaining({ action: "workspace_start", sequence: [1, -2], track_ids: [track.id] }));
  expect(useAppStore.getState().sequencer.tracks[0].padLoopPattern).toEqual(original);
  await act(() => result.current.auditionDevice(track.id, { action: "workspace_end", gestureId: "workspace" }));
  expect(audition).toHaveBeenLastCalledWith("session", expect.objectContaining({ action: "workspace_end", revision: 2 }));
});

it("cancels workspace preparation without allowing a late launch", async () => {
  let prepared!: (value: SessionSequencerStatus) => void;
  vi.mocked(api.configureSessionSequencer).mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  let start!: Promise<void>;
  act(() => { start = result.current.auditionDevice(id, { action: "workspace_start", gestureId: "workspace", items: [{ type: "pad", padIndex: 0 }] }); });
  await act(() => result.current.auditionDevice(id, { action: "workspace_end", gestureId: "workspace" }));
  await act(async () => { prepared(status(0)); await start; });
  expect(audition).toHaveBeenCalledExactlyOnceWith("session", expect.objectContaining({ action: "workspace_end", revision: 2 }));
});

it("keeps speaker commands independent from workspace updates and ends all drummer rows together", async () => {
  useAppStore.getState().addDrummerSequencerTrack();
  const { result } = setup(false);
  const track = useAppStore.getState().sequencer.drummerTracks[0];
  const start = { action: "workspace_start" as const, gestureId: "workspace", items: [{ type: "pad" as const, padIndex: 0 }] };
  await act(() => result.current.auditionDevice(track.id, start));
  await act(() => result.current.auditionDevice(track.id, { action: "preview_start", gestureId: "speaker", item: { type: "pad", padIndex: 1 } }));
  await act(() => result.current.auditionDevice(track.id, { ...start, items: [{ type: "pad", padIndex: 2 }] }));
  await act(() => result.current.auditionDevice(track.id, { action: "preview_end", gestureId: "speaker" }));
  expect(audition.mock.calls.map(call => call[1].action)).toEqual(["workspace_start", "preview_start", "workspace_start", "preview_end"]);
  expect(audition.mock.calls.every(call => call[1].track_ids.length === track.rows.length)).toBe(true);
  expect(audition.mock.calls.map(call => call[1].revision)).toEqual([1, 2, 2, 3]);
});

it("retains a playing workspace after failed preparation and can still stop it", async () => {
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  const command = { action: "workspace_start" as const, gestureId: "workspace", items: [{ type: "pad" as const, padIndex: 0 }] };
  await act(() => result.current.auditionDevice(id, command));
  vi.mocked(api.configureSessionSequencer).mockRejectedValueOnce(new Error("Preparation failed"));
  await act(async () => { await expect(result.current.auditionDevice(id, { ...command, items: [{ type: "pad", padIndex: 1 }] })).rejects.toThrow("Preparation failed"); });
  expect(audition).toHaveBeenCalledTimes(1);
  expect(setError).toHaveBeenLastCalledWith("Preparation failed");
  await act(() => result.current.auditionDevice(id, { action: "workspace_end", gestureId: "workspace" }));
  expect(audition).toHaveBeenLastCalledWith("session", expect.objectContaining({ action: "workspace_end", revision: 3 }));
});

it("advances workspace highlighting only from audible markers, not render-ahead acknowledgments", async () => {
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  const initial = { active: true, queued: null, workspace_gesture: "workspace", workspace_active: true, workspace_sequence: [0, 1], workspace_position: 1 };
  audition.mockResolvedValueOnce({ ...status(0), auditions: { [id]: initial } });
  await act(() => result.current.auditionDevice(id, { action: "workspace_start", gestureId: "workspace", items: [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 1 }] }));
  expect(useAppStore.getState().performanceAuditions[id].workspace_position).toBeNull();
  const emit = (value: typeof initial) => act(() => audioParams.applyBrowserClockTransportEventsRef.current([{
    kind: "step", target_frame: 48000, target_frame_offset: 0, payload: { ...status(0), previous_step: 0, auditions: { [id]: value } }
  }]));
  emit(initial);
  expect(useAppStore.getState().performanceAuditions[id].workspace_position).toBe(1);
  const replacement = { ...initial, workspace_sequence: [1, 0], workspace_position: 0 };
  audition.mockResolvedValueOnce({ ...status(0), auditions: { [id]: replacement } });
  await act(() => result.current.auditionDevice(id, { action: "workspace_start", gestureId: "workspace", items: [{ type: "pad", padIndex: 1 }, { type: "pad", padIndex: 0 }] }));
  expect(useAppStore.getState().performanceAuditions[id]).toMatchObject({ workspace_position: 1, workspace_sequence: [0, 1] });
  emit(replacement);
  expect(useAppStore.getState().performanceAuditions[id]).toMatchObject({ workspace_position: 0, workspace_sequence: [1, 0] });
});

it.each(["transport", "performance"])("cancels workspace preparation on %s changes without late restoration", async reason => {
  let prepared!: (value: SessionSequencerStatus) => void;
  vi.mocked(api.configureSessionSequencer).mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const { result } = setup(true);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  let start!: Promise<void>;
  act(() => { start = result.current.auditionDevice(id, { action: "workspace_start", gestureId: "workspace", items: [{ type: "pad", padIndex: 0 }] }); });
  if (reason === "transport") await act(() => result.current.stopSequencerTransport(false));
  else act(() => { useAppStore.setState(state => ({ performanceWorkspaceGeneration: state.performanceWorkspaceGeneration + 1 })); });
  await act(async () => { prepared(status(0)); await start; });
  await act(() => result.current.auditionDevice(id, { action: "workspace_end", gestureId: "workspace" }));
  expect(audition).not.toHaveBeenCalled();
});


it.each(["controller", "arpeggiator"])("targets %s workspaces and preserves authored definitions", async kind => {
  if (kind === "controller") useAppStore.getState().addControllerSequencer();
  else useAppStore.getState().addArpeggiator();
  const { result } = setup(false);
  const device = kind === "controller" ? useAppStore.getState().sequencer.controllerSequencers[0] : useAppStore.getState().sequencer.arpeggiators[0];
  const before = structuredClone(device.padLoopPattern);
  await act(() => result.current.auditionDevice(device.id, { action: "workspace_start", gestureId: "workspace", items: [{ type: "pad", padIndex: 0 }, { type: "pause", lengthBeats: 1 }] }));
  expect(audition).toHaveBeenCalledWith("session", expect.objectContaining({ sequence: [0, -1], ...(kind === "controller" ? { track_ids: [device.id] } : { arpeggiator_id: device.id }) }));
  expect(device.padLoopPattern).toEqual(before);
  await act(() => result.current.auditionDevice(device.id, { action: "workspace_end", gestureId: "workspace" }));
});

it.each(["workspace_start", "preview_start"] as const)("rejects prepared arpeggiator %s after a mode change", async action => {
  useAppStore.getState().addArpeggiator();
  let prepared!: (value: SessionSequencerStatus) => void;
  vi.mocked(api.configureSessionSequencer).mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.arpeggiators[0].id;
  let start!: Promise<void>;
  act(() => { start = result.current.auditionDevice(id, action === "workspace_start"
    ? { action, gestureId: "pending", items: [{ type: "pad", padIndex: 0 }] }
    : { action, gestureId: "pending", item: { type: "pad", padIndex: 0 } }); });
  act(() => useAppStore.setState(state => ({ sequencer: { ...state.sequencer, arpeggiators: state.sequencer.arpeggiators.map(arp => ({ ...arp, playbackMode: "live" })) } })));
  await act(async () => { prepared(status(0)); await start; });
  expect(audition).not.toHaveBeenCalled();
});

it("starts independent device transport with shared song bounds", async () => {
  const { result } = setup(false);
  await act(() => result.current.transportDevice(useAppStore.getState().sequencer.tracks[0].id, true));
  expect(buildConfig).toHaveBeenLastCalledWith(useAppStore.getState().sequencer, "runtime", true);
  expect(deviceTransport).toHaveBeenLastCalledWith("session", expect.objectContaining({ track_ids: [useAppStore.getState().sequencer.tracks[0].id] }));
});

it("uses explicit device Play after arranger Play/Stop without changing authored enablement", async () => {
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  const authored = useAppStore.getState().sequencer;
  const saved = useAppStore.getState().buildSequencerConfigSnapshot();
  await act(() => result.current.transportDevice(null, true));
  await act(() => result.current.transportDevice(null, false));
  await act(() => result.current.transportDevice(id, true));
  expect(deviceTransport.mock.calls.map(([, request]) => request.action)).toEqual(["play", "stop", "play"]);
  expect(deviceTransport).toHaveBeenLastCalledWith("session", expect.objectContaining({ track_ids: [id], action: "play", config }));
  expect(useAppStore.getState().sequencer).toBe(authored);
  expect(useAppStore.getState().sequencerRuntime.arrangerActive).toBe(false);
  expect(startSequencer).not.toHaveBeenCalled();
  const after = useAppStore.getState().buildSequencerConfigSnapshot();
  expect(after).toEqual(saved);
  const exported = buildPerformanceExportPayload({ snapshot: after, selectedPatches: [], performanceName: "Test", performanceDescription: "" });
  expect(JSON.stringify(exported.payload)).not.toMatch(/independentSources|arrangementPlaybackSubunit|pending_starts|source_origin/);
});

it("continues device Play when starting the engine replaces the stopped rack session", async () => {
  useAppStore.setState({ activeSessionState: "compiled" });
  const startSession = vi.fn(async () => {
    useAppStore.setState({ activeSessionId: null, activeSessionState: "idle" });
    await Promise.resolve();
    useAppStore.setState({ activeSessionId: "new-session", activeSessionState: "running" });
  });
  useAppStore.setState({ startSession });
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  await act(() => result.current.transportDevice(id, true));
  expect(startSession).toHaveBeenCalledOnce();
  expect(deviceTransport).toHaveBeenCalledWith("new-session", expect.objectContaining({ track_ids: [id], action: "play" }));
});

it("plays the editing pad in Manual pads mode without changing saved pad selection", async () => {
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  act(() => {
    useAppStore.getState().setSequencerTrackPadLoopEnabled(id, false);
    useAppStore.getState().selectSequencerEditingPad(id, 3);
  });
  const original = useAppStore.getState().sequencer.tracks[0].activePad;
  await act(() => result.current.transportDevice(id, true));
  expect(deviceTransport).toHaveBeenLastCalledWith("session", expect.objectContaining({ pad_index: 3 }));
  expect(useAppStore.getState().sequencer.tracks[0].activePad).toBe(original);
});

it("serializes backing-device starts and batches every drummer row", async () => {
  useAppStore.getState().addDrummerSequencerTrack();
  const { result } = setup(false);
  const store = useAppStore.getState();
  const melody = store.sequencer.tracks[0].id;
  const drummer = store.sequencer.drummerTracks[0];
  await act(async () => { await Promise.all([result.current.transportDevice(melody, true), result.current.transportDevice(drummer.id, true)]); });
  expect(deviceTransport).toHaveBeenCalledTimes(2);
  expect(deviceTransport.mock.calls[1][1].track_ids).toEqual(drummer.rows.map(row => `drumrow:${drummer.id}:${row.id}`));
});

it("Stop bypasses pending Play and ignores its late acknowledgment", async () => {
  const { result } = setup(false);
  const id = useAppStore.getState().sequencer.tracks[0].id;
  let resolve!: (value: SessionSequencerStatus) => void;
  deviceTransport.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  let play!: Promise<void>;
  await act(async () => { play = result.current.transportDevice(id, true); await Promise.resolve(); });
  await act(() => result.current.transportDevice(id, false));
  expect(deviceTransport.mock.calls[1][1].action).toBe("stop");
  await act(async () => { resolve(status(16)); await play; });
  expect(useAppStore.getState().sequencerRuntime.isPlaying).toBe(false);
});

it("uses the song marker for the arranger cursor and retains it during independent playback", async () => {
  setup(true);
  act(() => audioParams.applySequencerStatusRef.current({ ...status(100), independent_sources: true,
    arranger_active: true, arrangement_running: true, arrangement_transport_subunit: 8 * sequencerTransportSubunitsPerStep() }));
  expect(useAppStore.getState().sequencerRuntime.arrangerTransportSubunit).toBe(8 * sequencerTransportSubunitsPerStep());
  act(() => audioParams.applySequencerStatusRef.current({ ...status(101), independent_sources: true,
    arranger_active: false, arrangement_running: false, arrangement_transport_subunit: 9 * sequencerTransportSubunitsPerStep() }));
  act(() => audioParams.applySequencerStatusRef.current({ ...status(110), independent_sources: true,
    arranger_active: false, arrangement_running: true, arrangement_transport_subunit: 16 * sequencerTransportSubunitsPerStep() }));
  expect(useAppStore.getState().sequencerRuntime.arrangerTransportSubunit).toBe(9 * sequencerTransportSubunitsPerStep());
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(110 * sequencerTransportSubunitsPerStep());
});

it("applies song-loop toggles during playback without seeking or restarting", async () => {
  const build = (state = useAppStore.getState().sequencer) => ({ ...config, ...buildSequencerPlaybackRange(state, "runtime", true) });
  const { result } = setup(false, { sequencer: build, arpeggiators: buildBackendArpeggiatorRequest });
  await act(() => result.current.transportDevice(null, true));
  await act(() => vi.advanceTimersByTimeAsync(100));
  startSequencer.mockClear(); deviceTransport.mockClear();
  for (const enabled of [true, false]) {
    vi.mocked(api.configureSessionSequencer).mockClear();
    const before = useAppStore.getState().sequencerRuntime;
    act(() => useAppStore.getState().setSequencerArrangerSongLoopEnabled(enabled));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(api.configureSessionSequencer).toHaveBeenCalledExactlyOnceWith("session", expect.objectContaining({ playback_loop: enabled }));
    expect(useAppStore.getState().sequencerRuntime).toEqual(before);
    expect(api.seekSessionSequencer).not.toHaveBeenCalled();
    expect(startSequencer).not.toHaveBeenCalled();
    expect(deviceTransport).not.toHaveBeenCalled();
  }
});
