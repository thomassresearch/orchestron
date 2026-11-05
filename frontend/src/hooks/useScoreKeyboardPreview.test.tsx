// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import { useScoreKeyboardPreview } from "./useScoreKeyboardPreview";
import type { ScoreKeyboardNote } from "../components/sequencer/ScoreTransportContext";

const note: ScoreKeyboardNote = { trackId: "score", midiChannel: 3, pitch: 60, scaleRoot: "D", scaleType: "minor", mode: "aeolian" };
const prime = vi.fn(), sendManualMidi = vi.fn(), error = vi.fn();
const client = { current: { prime, sendManualMidi } };
const setup = () => renderHook(() => useScoreKeyboardPreview(client, error));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ activeSessionId: "session", activeSessionState: "running" });
  prime.mockReset().mockResolvedValue(undefined);
  sendManualMidi.mockReset().mockResolvedValue(undefined);
  error.mockReset();
  vi.spyOn(api, "sendSessionMidiEvent").mockResolvedValue({ session_id: "session", state: "running", detail: "sent" });
});
afterEach(async () => { await act(async () => cleanup()); vi.restoreAllMocks(); });

it("primes immediately and auditions through manual MIDI without editing or moving transport", async () => {
  const before = useAppStore.getState(), ended = vi.fn(), { result } = setup();
  let release!: () => void;
  act(() => { release = result.current(note, ended); expect(prime).toHaveBeenCalledOnce(); });
  await act(async () => {});
  expect(sendManualMidi).toHaveBeenCalledExactlyOnceWith("session", {
    type: "note_on", channel: 3, note: 60, velocity: 100, source_id: "score-keyboard:score",
    source_scale_root: "D", source_scale_type: "minor", source_mode: "aeolian"
  }, { source: "score-keyboard:score" });
  expect(useAppStore.getState().sequencer).toBe(before.sequencer);
  expect(useAppStore.getState().sequencerRuntime).toBe(before.sequencerRuntime);
  await act(async () => { release(); release(); });
  expect(ended).toHaveBeenCalledOnce();
  expect(sendManualMidi).toHaveBeenLastCalledWith("session", { type: "note_off", channel: 3, note: 60, source_id: "score-keyboard:score" }, { source: "score-keyboard:score" });
  expect(useAppStore.getState().activeSessionState).toBe("running");
});

it("keeps overlapping presses of the same pitch held until the last release", async () => {
  const { result } = setup(), ends = [vi.fn(), vi.fn()];
  let one!: () => void, two!: () => void;
  await act(async () => { one = result.current(note, ends[0]); two = result.current(note, ends[1]); });
  expect(sendManualMidi).toHaveBeenCalledTimes(1);
  await act(async () => one());
  expect(ends[0]).toHaveBeenCalledOnce(); expect(ends[1]).not.toHaveBeenCalled();
  expect(sendManualMidi).toHaveBeenCalledTimes(1);
  await act(async () => two());
  expect(ends[1]).toHaveBeenCalledOnce(); expect(sendManualMidi).toHaveBeenCalledTimes(2);
});

it("shares concurrent engine starts, adopts the new session and leaves transport stopped", async () => {
  useAppStore.setState({ activeSessionState: "compiled", ensureSession: vi.fn(async () => "session") });
  const compile = deferred();
  vi.spyOn(api, "compileSession").mockImplementation(async () => {
    await compile.promise; return { session_id: "session", state: "compiled", orc: "", csd: "", diagnostics: [] };
  });
  vi.spyOn(api, "startSession").mockResolvedValue({ session_id: "session", state: "running", detail: "started" });
  const before = useAppStore.getState().sequencerRuntime, { result } = setup();
  let one!: () => void, two!: () => void;
  await act(async () => { one = result.current(note, vi.fn()); two = result.current({ ...note, pitch: 64 }, vi.fn()); });
  expect(api.compileSession).toHaveBeenCalledOnce();
  expect(sendManualMidi).not.toHaveBeenCalled();
  await act(async () => compile.resolve());
  expect(api.startSession).toHaveBeenCalledOnce(); expect(sendManualMidi).toHaveBeenCalledTimes(2);
  expect(useAppStore.getState().sequencerRuntime).toBe(before);
  await act(async () => { one(); two(); });
  expect(sendManualMidi.mock.calls.map(call => call[1].type)).toEqual(["note_on", "note_on", "note_off", "note_off"]);
});

it.each(["release", "workspace", "unmount"])("cancels a pending startup on %s without a delayed note", async reason => {
  const starting = deferred();
  useAppStore.setState({ activeSessionState: "compiled", startSession: vi.fn(async () => {
    useAppStore.setState({ activeSessionId: null, activeSessionState: "idle" });
    await starting.promise;
    useAppStore.setState({ activeSessionId: "new", activeSessionState: "running" });
  }) });
  const { result, unmount } = setup(), ended = vi.fn(); let release!: () => void;
  await act(async () => { release = result.current(note, ended); });
  await act(async () => {
    if (reason === "release") release();
    else if (reason === "workspace") useAppStore.setState({ performanceWorkspaceGeneration: 1 });
    else unmount();
    starting.resolve();
  });
  expect(sendManualMidi).not.toHaveBeenCalled(); expect(ended).toHaveBeenCalledOnce();
});

it("survives replacement of a stopped session by its own engine startup", async () => {
  useAppStore.setState({ activeSessionState: "compiled", startSession: vi.fn(async () => {
    useAppStore.setState({ activeSessionId: null, activeSessionState: "idle" });
    await Promise.resolve(); useAppStore.setState({ activeSessionId: "new", activeSessionState: "running" });
  }) });
  const { result } = setup(); let release!: () => void;
  await act(async () => { release = result.current(note, vi.fn()); });
  expect(sendManualMidi).toHaveBeenCalledWith("new", expect.objectContaining({ type: "note_on" }), expect.anything());
  await act(async () => release());
  expect(sendManualMidi).toHaveBeenLastCalledWith("new", expect.objectContaining({ type: "note_off" }), expect.anything());
});

it("orders a delayed note-on, its release, and a rapid retrigger", async () => {
  const sending = deferred(); sendManualMidi.mockReturnValueOnce(sending.promise);
  const { result } = setup(); let first!: () => void, second!: () => void;
  await act(async () => { first = result.current(note, vi.fn()); });
  await act(async () => { first(); second = result.current(note, vi.fn()); });
  expect(sendManualMidi).toHaveBeenCalledTimes(1);
  await act(async () => sending.resolve());
  expect(sendManualMidi.mock.calls.map(call => call[1].type)).toEqual(["note_on", "note_off", "note_on"]);
  await act(async () => second());
  expect(sendManualMidi.mock.calls.map(call => call[1].type)).toEqual(["note_on", "note_off", "note_on", "note_off"]);
});

it.each(["stop", "replace", "workspace"])("releases sounding notes on session %s without reconnecting old audio", async reason => {
  const { result } = setup(), ended = vi.fn();
  await act(async () => { result.current(note, ended); });
  await act(async () => useAppStore.setState(reason === "stop" ? { activeSessionState: "compiled" } :
    reason === "replace" ? { activeSessionId: "replacement" } : { performanceWorkspaceGeneration: 1 }));
  expect(ended).toHaveBeenCalledOnce();
  if (reason === "workspace") expect(sendManualMidi).toHaveBeenLastCalledWith("session", expect.objectContaining({ type: "note_off" }), expect.anything());
  else {
    expect(sendManualMidi).toHaveBeenCalledTimes(1);
    expect(api.sendSessionMidiEvent).toHaveBeenCalledExactlyOnceWith("session", expect.objectContaining({ type: "note_off" }));
  }
});

it("reports startup failures and clears held-key feedback without sending notes", async () => {
  useAppStore.setState({ activeSessionState: "compiled", startSession: vi.fn(async () => {
    useAppStore.setState({ activeSessionState: "error", error: "Instrument compilation failed" });
  }) });
  const { result } = setup(), ended = vi.fn();
  await act(async () => { result.current(note, ended); });
  expect(error).toHaveBeenLastCalledWith("Instrument compilation failed");
  expect(ended).toHaveBeenCalledOnce(); expect(sendManualMidi).not.toHaveBeenCalled();
});

it("reports audio priming failure without starting instruments", async () => {
  prime.mockRejectedValueOnce(new Error("Audio unavailable"));
  const start = vi.fn(); useAppStore.setState({ activeSessionState: "compiled", startSession: start });
  const { result } = setup(), ended = vi.fn();
  await act(async () => { result.current(note, ended); });
  expect(error).toHaveBeenLastCalledWith("Audio unavailable");
  expect(start).not.toHaveBeenCalled(); expect(ended).toHaveBeenCalledOnce();
});
