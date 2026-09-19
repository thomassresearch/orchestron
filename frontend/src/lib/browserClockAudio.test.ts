// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { BrowserClockAudioClient } from "./browserClockAudio";
import type { BrowserClockMainToWorkerMessage } from "../audio/browserClockWorkerProtocol";
import type { BrowserClockLatencySettings, SessionSequencerStatus } from "../types";

vi.mock("./mixerRuntime", () => ({ publishMeters: vi.fn(), releaseMixerTransport: vi.fn(), setMixerTransport: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("shares audio preparation and connection when prime, engine startup and arranger Play overlap", async () => {
  let release!: () => void;
  const moduleReady = new Promise<void>(resolve => { release = resolve; });
  const contexts: unknown[] = []; const workers: FakeWorker[] = [];
  const status = { running: true, arranger_active: true } as SessionSequencerStatus;
  class FakeContext {
    state = "running"; sampleRate = 48000; destination = {}; onstatechange = null;
    audioWorklet = { addModule: () => moduleReady };
    constructor() { contexts.push(this); }
    async close() {} async resume() {}
  }
  class FakeNode { port = {}; connect() {} disconnect() {} }
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    messages: BrowserClockMainToWorkerMessage[] = [];
    constructor() { workers.push(this); }
    terminate() {}
    postMessage(message: BrowserClockMainToWorkerMessage) {
      this.messages.push(message);
      if (message.type === "connect") queueMicrotask(() => this.onmessage?.({ data: { type: "connected", sessionId: message.sessionId, sequencerStatus: status } }));
      if (message.type === "sequencer_request") queueMicrotask(() => this.onmessage?.({ data: { type: "sequencer_status", requestId: message.request.request_id, sequencerStatus: status } }));
    }
  }
  vi.stubGlobal("AudioContext", FakeContext); vi.stubGlobal("AudioWorkletNode", FakeNode); vi.stubGlobal("Worker", FakeWorker);
  const onSequencerStatus = vi.fn();
  const client = new BrowserClockAudioClient({ onStatusChange: vi.fn(), onErrorChange: vi.fn(), onSequencerStatus,
    getLatencySettings: () => ({} as BrowserClockLatencySettings) });
  const prime = client.prime(); const automatic = client.connect("session");
  const play = client.startSequencer("session", { arrangerActive: true });
  release();
  await Promise.all([prime, automatic]);
  expect((await play).arranger_active).toBe(true);
  expect(contexts).toHaveLength(1); expect(workers).toHaveLength(1);
  expect(workers[0].messages.filter(m => m.type === "connect")).toHaveLength(1);
  expect(workers[0].messages.find(m => m.type === "sequencer_request")).toMatchObject({ request: { type: "sequencer_start", arranger_active: true } });
  onSequencerStatus.mockClear();
  // Scoped commands are applied by their owner's generation guard, not a second
  // unguarded callback that could resurrect an obsolete Play after Stop.
  expect(await client.deviceTransport("session", { action: "play", track_ids: ["lead"] })).toBe(status);
  workers[0].onmessage?.({ data: { type: "sequencer_status", requestId: "expired", sequencerStatus: status } });
  expect(onSequencerStatus).not.toHaveBeenCalled();
  await client.disconnect();
});
