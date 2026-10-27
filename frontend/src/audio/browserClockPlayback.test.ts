import { afterEach, expect, it, vi } from "vitest";
import { LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS as settings } from "../lib/browserClockLatencyConfig";
import type { BrowserClockMainToWorkerMessage } from "./browserClockWorkerProtocol";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

async function connect(armed = false) {
  vi.useFakeTimers();
  const scope = { onmessage: (_: { data: BrowserClockMainToWorkerMessage }) => {}, postMessage: vi.fn(), setInterval, clearInterval };
  const sent: Array<Record<string, number | string>> = [];
  const renders: Array<Record<string, number | string>> = [];
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1; static CLOSING = 2;
    readyState = 1; binaryType = "";
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
    send(value: string) { const data = JSON.parse(value); sent.push(data); if (data.type === "request_render") renders.push(data); }
    close() { this.readyState = 3; }
    constructor() { sockets.push(this); }
  }
  vi.stubGlobal("self", scope); vi.stubGlobal("WebSocket", Socket);
  await import("./browserClockWorker");
  const state = new Uint32Array(new SharedArrayBuffer(32));
  const samples = new Float32Array(new SharedArrayBuffer(48000 * 6 * 2 * 4));
  const send = (data: BrowserClockMainToWorkerMessage) => scope.onmessage({ data });
  send({ type: "connect", sessionId: "session", websocketUrl: "ws://localhost", sampleRate: 48000, channels: 2,
    capacityFrames: 48000 * 6, stateBuffer: state.buffer as SharedArrayBuffer, sampleBuffer: samples.buffer as SharedArrayBuffer, latencySettings: settings });
  if (armed) send({ type: "live_input", source: "piano:a", action: "start" });
  sockets[0].onopen!();
  const receive = (data: object) => sockets[0].onmessage!({ data: JSON.stringify(data) });
  receive({ type: "stream_config", ksmps: 32, engine_sample_rate: 48000, target_sample_rate: 48000,
    max_blocks_per_request: 512, sequencer_status: { transport_subunit: 7 } });
  const fill = () => {
    let count = 0;
    while (renders.length) {
      expect(++count).toBeLessThan(100);
      const request = renders.shift()!;
      const frames = Number(request.block_count) * 32;
      receive({ type: "render_chunk", channels: 2, target_frame_count: frames, target_sample_rate: 48000,
        engine_sample_rate: 48000, engine_sample_start: 0, engine_sample_end: frames,
        telemetry: { request_id: request.request_id, render_service_time_ms: 1 } });
      sockets[0].onmessage!({ data: new Float32Array(frames * 2).fill(0.25).buffer });
    }
  };
  const diagnostics = () => {
    const messages = scope.postMessage.mock.calls.filter(([m]) => m.type === "diagnostics");
    return messages[messages.length - 1]?.[0].diagnostics;
  };
  return { send, receive, state, samples, fill, sent, renders, diagnostics };
}

it("preserves queued samples, counters, playback and transport through Auto and forced transitions", async () => {
  const h = await connect();
  h.fill();
  expect(h.state[4]).toBe(1);
  expect(h.state[1]).toBe(86400); // Listening primes 1.8 seconds.
  const queued = h.samples.slice(0, h.state[1] * 2);
  h.send({ type: "live_input", source: "piano:a", action: "start" });
  expect(h.diagnostics().playbackState).toBe("switching_to_live");
  expect(h.renders).toHaveLength(0);
  expect([...h.state.slice(0, 5)]).toEqual([0, 86400, 0, 0, 1]);
  expect(h.state[6]).toBe(7);
  expect(h.samples.slice(0, queued.length)).toEqual(queued);
  vi.advanceTimersByTime(10020);
  expect(h.diagnostics().playbackState).toBe("listening");
  h.send({ type: "latency_settings", latencySettings: { ...settings, playbackMode: "live" } });
  expect(h.sent.filter(m => m.type === "claim_controller")).toHaveLength(1);
  expect(h.state[1]).toBe(86400);
  // Consume naturally, then verify smaller Live requests resume without rewinding.
  h.state[0] = 86400 - 4000;
  vi.advanceTimersByTime(20);
  expect(h.renders.length).toBeGreaterThan(0);
  expect(h.renders.every(r => Number(r.block_count) <= settings.maxBlocksPerRequest)).toBe(true);
  h.send({ type: "disconnect" });
});

it("ignores initialization and sequencer commands, but detects external input and manual CCs", async () => {
  const h = await connect(); h.fill();
  const midi = { type: "control_change", channel: 1, controller: 74, value: 90 } as const;
  h.send({ type: "manual_midi", midi, activity: { activity: false }, eventEpochMs: 0 });
  expect(h.diagnostics().playbackState).toBe("listening");
  h.send({ type: "sequencer_request", request: { type: "sequencer_start", request_id: "start" } });
  vi.advanceTimersByTime(500);
  expect(h.diagnostics().playbackState).toBe("listening");
  h.receive({ type: "live_input_activity", activity: true, held: true });
  vi.advanceTimersByTime(20000);
  expect(h.diagnostics().playbackState).toBe("switching_to_live");
  h.receive({ type: "live_input_activity", activity: false, held: false });
  expect(h.diagnostics().playbackState).toBe("listening");
  h.send({ type: "manual_midi", midi, activity: { source: "controller:a" }, eventEpochMs: 0 });
  expect(h.diagnostics().playbackState).toBe("switching_to_live");
  h.receive({ type: "live_input_activity", activity: false, held: false, reset: true });
  expect(h.diagnostics().playbackState).toBe("listening");
  h.send({ type: "disconnect" });
});

it("primes the Live target when a keyboard is armed before the stream starts", async () => {
  const h = await connect(true);
  h.fill();
  expect(h.state[1]).toBe(15360);
  expect(h.state[4]).toBe(1);
  h.send({ type: "disconnect" });
});
