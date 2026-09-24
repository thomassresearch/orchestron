import { afterEach, expect, it, vi } from "vitest";
import { LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS } from "../lib/browserClockLatencyConfig";
import type { BrowserClockMainToWorkerMessage } from "./browserClockWorkerProtocol";

afterEach(() => vi.unstubAllGlobals());

it("ignores open, close and error events from a replaced websocket", async () => {
  const scope = { onmessage: (_: { data: BrowserClockMainToWorkerMessage }) => {}, postMessage: vi.fn() };
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1; static CLOSING = 2;
    readyState = 1; binaryType = "arraybuffer";
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason: string }) => void) | null = null;
    send = vi.fn();
    constructor() { sockets.push(this); }
    close() { this.readyState = 3; }
  }
  vi.stubGlobal("self", scope); vi.stubGlobal("WebSocket", FakeSocket);
  await import("./browserClockWorker");
  function connect(sessionId: string) {
    scope.onmessage({ data: { type: "connect", sessionId, websocketUrl: "ws://localhost", sampleRate: 48000, channels: 2,
      capacityFrames: 32, sampleBuffer: new SharedArrayBuffer(256), stateBuffer: new SharedArrayBuffer(32),
      latencySettings: LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS } });
  }
  connect("old"); connect("new");
  scope.postMessage.mockClear();
  sockets[0].onopen?.(); sockets[0].onerror?.(); sockets[0].onclose?.({ reason: "late close" });
  expect(scope.postMessage).not.toHaveBeenCalled();
  expect(sockets[1].send).not.toHaveBeenCalled();
  sockets[1].onopen?.();
  expect(sockets[1].send).toHaveBeenCalledWith(expect.stringContaining("claim_controller"));
  scope.onmessage({ data: { type: "disconnect" } });
});
