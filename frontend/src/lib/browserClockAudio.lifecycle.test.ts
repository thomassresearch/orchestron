// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { BrowserClockMainToWorkerMessage, BrowserClockWorkerToMainMessage } from "../audio/browserClockWorkerProtocol";
import { normalizeSessionInstrumentAssignments } from "../store/appStoreModel";
import { useAppStore } from "../store/useAppStore";
import type { SessionSequencerStatus } from "../types";
import { BrowserClockAudioClient } from "./browserClockAudio";
import { clearMeters, sendMixerUpdate, setMixerTransport } from "./mixerRuntime";

// Keep the real mixer registry: mocking it hides stale registrations after Stop.
const workers: FakeWorker[] = [];
const clients: BrowserClockAudioClient[] = [];

class FakeContext {
  state = "running";
  sampleRate = 48000;
  destination = {};
  onstatechange = null;
  audioWorklet = { addModule: async () => {} };
  async close() {}
  async resume() {}
}

class FakeNode {
  port = {};
  connect() {}
  disconnect() {}
}

class FakeWorker {
  onmessage: ((event: { data: BrowserClockWorkerToMainMessage }) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: BrowserClockMainToWorkerMessage[] = [];
  connected = false;

  constructor() { workers.push(this); }
  terminate() { this.connected = false; }
  emit(message: BrowserClockWorkerToMainMessage) {
    if (message.type === "error") this.connected = false;
    this.onmessage?.({ data: message });
  }
  postMessage(message: BrowserClockMainToWorkerMessage) {
    this.messages.push(message);
    if (message.type === "connect") {
      this.connected = true;
      queueMicrotask(() => this.emit({ type: "connected", sessionId: message.sessionId,
        sequencerStatus: { session_id: message.sessionId } as SessionSequencerStatus }));
    } else if (message.type === "mixer_request") {
      queueMicrotask(() => this.emit(this.connected
        ? { type: "mixer_ack", requestId: message.requestId,
            result: { mixer: message.mixer, revision: (message.revision ?? 0) + 1 } }
        : { type: "mixer_error", requestId: message.requestId, detail: "Browser controller disconnected" }));
    }
  }
}

function audioClient() {
  const onErrorChange = vi.fn();
  const client = new BrowserClockAudioClient({
    onStatusChange: vi.fn(), onErrorChange, onSequencerStatus: vi.fn(),
    getLatencySettings: () => useAppStore.getState().browserClockLatencySettings
  });
  clients.push(client);
  return { client, onErrorChange };
}

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeNode);
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(async () => {
  for (const client of clients) await client.disconnect();
  clients.length = 0;
  workers.length = 0;
  setMixerTransport(undefined);
  clearMeters();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("removes the mixer registration on a stop error and tolerates repeated cleanup", async () => {
  const { client } = audioClient();
  await client.connect("stopped-session");
  workers[0].emit({ type: "error", message: "Session stopped." });
  // The worker reports both an error and its resulting status.
  workers[0].emit({ type: "status", status: "error", error: "Session stopped." });
  const mixer = useAppStore.getState().mixer;
  const transportAfterError = sendMixerUpdate("stopped-session", mixer);
  await transportAfterError?.catch(() => undefined);
  await client.disconnect();
  await client.disconnect();
  const transportAfterDisconnect = sendMixerUpdate("stopped-session", mixer);
  await transportAfterDisconnect?.catch(() => undefined);
  expect(transportAfterError).toBeUndefined();
  expect(transportAfterDisconnect).toBeUndefined();
});

it.each([false, true])("restarts the same session through HTTP mixer sync after Stop (prime audio: %s)", async (prime) => {
  const sessionId = `restart-${prime}`;
  const { audioGraph, mixer } = useAppStore.getState();
  const bindings = [{ id: "instrument", patchId: "patch", midiChannel: 1, level: 8, effectSourceIds: [], effectRoutes: [] }];
  const instruments = normalizeSessionInstrumentAssignments(bindings);
  useAppStore.setState({
    patches: [], sequencerInstruments: bindings, activeSessionId: sessionId, activeSessionState: "running",
    activeSessionInstruments: instruments, activeSessionAudioSignature: JSON.stringify({ graph: audioGraph, patches: [] })
  });
  const { client } = audioClient();
  await client.connect(sessionId);
  vi.spyOn(api, "stopSession").mockImplementation(async () => {
    workers[0].emit({ type: "error", message: "Session stopped." });
    return { session_id: sessionId, state: "compiled", detail: "stopped" };
  });
  vi.spyOn(api, "getSession").mockResolvedValue({ session_id: sessionId, patch_id: "patch", instruments,
    state: "compiled", midi_input: null, created_at: "2026-01-01", started_at: null });
  vi.spyOn(api, "getMixer").mockResolvedValue({ mixer, revision: 0 });
  const update = vi.spyOn(api, "updateMixer").mockResolvedValue({ mixer, revision: 1 });
  const compile = vi.spyOn(api, "compileSession").mockResolvedValue({ session_id: sessionId, state: "compiled", orc: "", csd: "", diagnostics: [] });
  const start = vi.spyOn(api, "startSession").mockResolvedValue({ session_id: sessionId, state: "running", detail: "started" });
  const create = vi.spyOn(api, "createSession").mockRejectedValue(new Error("Restart must reuse the session"));

  await useAppStore.getState().stopSession();
  await client.disconnect();
  if (prime) await client.prime();
  await useAppStore.getState().startSession();

  expect(useAppStore.getState().error).toBeNull();
  expect(update).toHaveBeenCalledExactlyOnceWith(sessionId, mixer, 0);
  expect(compile).toHaveBeenCalledExactlyOnceWith(sessionId);
  expect(start).toHaveBeenCalledExactlyOnceWith(sessionId);
  expect(create).not.toHaveBeenCalled();
  expect(useAppStore.getState().activeSessionState).toBe("running");
});

it("ignores stale worker errors after reconnecting the same session", async () => {
  const { client, onErrorChange } = audioClient();
  await client.connect("reconnected-session");
  const oldWorker = workers[0];
  oldWorker.emit({ type: "error", message: "Session stopped." });
  await client.disconnect();
  await client.connect("reconnected-session");
  onErrorChange.mockClear();

  oldWorker.emit({ type: "error", message: "stale failure" });
  oldWorker.onerror?.();
  const mixer = useAppStore.getState().mixer;
  await expect(sendMixerUpdate("reconnected-session", mixer, 2)).resolves.toEqual({ mixer, revision: 3 });
  expect(onErrorChange).not.toHaveBeenCalled();
  expect(workers[1].messages[workers[1].messages.length - 1]).toMatchObject({ type: "mixer_request" });
});
