import { wsBaseUrl } from "../api/client";
import {
  BROWSER_CLOCK_STATE_LENGTH,
  BROWSER_CLOCK_STATE_PLAYBACK_ENABLED,
  BROWSER_CLOCK_STATE_TRANSPORT_SUBUNIT,
  type AudibleBrowserClockTransportEvent,
  type BrowserClockMainToWorkerMessage,
  type BrowserClockWorkerDiagnostics,
  type BrowserClockWorkerSequencerRequest,
  type BrowserClockWorkerToMainMessage
} from "../audio/browserClockWorkerProtocol";
import type {
  BrowserClockLatencySettings,
  SessionMidiEventRequest,
  SessionSequencerConfigRequest,
  SessionSequencerStatus
} from "../types";

type BrowserAudioStatus = "off" | "connecting" | "live" | "error";

type BrowserClockCallbacks = {
  onStatusChange: (status: BrowserAudioStatus) => void;
  onErrorChange: (message: string | null) => void;
  onSequencerStatus: (status: SessionSequencerStatus) => void;
  onTransportEvents?: (events: AudibleBrowserClockTransportEvent[]) => void;
  onDiagnostics?: (diagnostics: BrowserClockWorkerDiagnostics) => void;
  getLatencySettings: () => BrowserClockLatencySettings;
};

type PendingSequencerRequest = {
  resolve: (status: SessionSequencerStatus) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

const WORKLET_MODULE_URL = new URL("../audio/browserClockProcessor.js", import.meta.url).href;
const CHANNELS = 2;
const RING_BUFFER_DURATION_SECONDS = 6;
const SEQUENCER_REQUEST_TIMEOUT_MS = 5_000;
const AUDIO_UNLOCK_MESSAGE = "Tap anywhere to enable browser audio.";

function nextRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type { BrowserClockWorkerDiagnostics } from "../audio/browserClockWorkerProtocol";

export class BrowserClockAudioClient {
  private readonly callbacks: BrowserClockCallbacks;
  private worker: Worker | null = null;
  private audioContext: AudioContext | null = null;
  private audioNode: AudioWorkletNode | null = null;
  private sampleBufferSab: SharedArrayBuffer | null = null;
  private stateBufferSab: SharedArrayBuffer | null = null;
  private stateBuffer: Uint32Array | null = null;
  private capacityFrames = 0;
  private sessionId: string | null = null;
  private connectedSessionId: string | null = null;
  private pendingConnect: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private connectPromise: Promise<void> | null = null;
  private pendingSequencerRequests = new Map<string, PendingSequencerRequest>();
  private workerPrimed = false;
  private fatalError: string | null = null;
  private unlockHandler: (() => void) | null = null;

  constructor(callbacks: BrowserClockCallbacks) {
    this.callbacks = callbacks;
  }

  async prime(): Promise<void> {
    await this.prepareAudioPipeline();
  }

  async connect(sessionId: string): Promise<void> {
    if (this.connectedSessionId === sessionId && this.worker && this.stateBuffer) {
      this.syncStatus();
      return;
    }
    if (this.connectPromise && this.sessionId === sessionId) {
      return this.connectPromise;
    }
    if (this.sessionId && this.sessionId !== sessionId) {
      await this.disconnect();
    }

    await this.prepareAudioPipeline();
    const context = this.audioContext;
    if (!context || !this.sampleBufferSab || !this.stateBufferSab) {
      throw new Error("Browser audio pipeline is unavailable.");
    }
    this.sessionId = sessionId;
    this.connectedSessionId = null;
    this.workerPrimed = false;
    this.fatalError = null;
    this.callbacks.onStatusChange("connecting");
    this.callbacks.onErrorChange(null);

    const promise = new Promise<void>((resolve, reject) => {
      this.pendingConnect = { resolve, reject };
    });
    this.connectPromise = promise;
    this.postWorker({
      type: "connect",
      sessionId,
      websocketUrl: `${wsBaseUrl()}/ws/sessions/${sessionId}/browser-clock`,
      sampleRate: Math.max(1, Math.round(context.sampleRate)),
      channels: CHANNELS,
      capacityFrames: this.capacityFrames,
      sampleBuffer: this.sampleBufferSab,
      stateBuffer: this.stateBufferSab,
      latencySettings: this.callbacks.getLatencySettings()
    });

    try {
      await promise;
    } finally {
      if (this.connectPromise === promise) {
        this.connectPromise = null;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.postWorker({ type: "disconnect" }, true);
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending(new Error("Browser-clock connection closed."));
    this.finishConnect(new Error("Browser-clock connection closed."));
    this.sessionId = null;
    this.connectedSessionId = null;
    this.workerPrimed = false;
    this.fatalError = null;
    this.removeUnlockListeners();

    if (this.audioNode) {
      this.audioNode.port.onmessage = null;
      this.audioNode.disconnect();
      this.audioNode = null;
    }
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // Browser shutdown is best effort.
      }
      this.audioContext = null;
    }
    this.sampleBufferSab = null;
    this.stateBufferSab = null;
    this.stateBuffer = null;
    this.capacityFrames = 0;
    this.callbacks.onStatusChange("off");
    this.callbacks.onErrorChange(null);
  }

  refreshLatencySettings(): void {
    this.postWorker(
      { type: "latency_settings", latencySettings: this.callbacks.getLatencySettings() },
      true
    );
  }

  getPlaybackTransportSubunit(): number | null {
    if (!this.stateBuffer) {
      return null;
    }
    return Atomics.load(this.stateBuffer, BROWSER_CLOCK_STATE_TRANSPORT_SUBUNIT) >>> 0;
  }

  async sendManualMidi(sessionId: string, midi: SessionMidiEventRequest): Promise<void> {
    await this.connect(sessionId);
    this.postWorker({
      type: "manual_midi",
      midi,
      eventPerfMs: performance.now()
    });
  }

  async startSequencer(
    sessionId: string,
    payload: { config?: SessionSequencerConfigRequest | null; positionStep?: number | null }
  ): Promise<SessionSequencerStatus> {
    return this.sendSequencerRequest(sessionId, {
      type: "sequencer_start",
      request_id: nextRequestId(),
      config: payload.config ?? null,
      position_step: payload.positionStep ?? null
    });
  }

  async stopSequencer(sessionId: string): Promise<SessionSequencerStatus> {
    return this.sendSequencerRequest(sessionId, {
      type: "sequencer_stop",
      request_id: nextRequestId()
    });
  }

  async rewindSequencer(sessionId: string): Promise<SessionSequencerStatus> {
    return this.sendSequencerRequest(sessionId, {
      type: "sequencer_rewind",
      request_id: nextRequestId()
    });
  }

  async forwardSequencer(sessionId: string): Promise<SessionSequencerStatus> {
    return this.sendSequencerRequest(sessionId, {
      type: "sequencer_forward",
      request_id: nextRequestId()
    });
  }

  async queuePad(sessionId: string, trackId: string, padIndex: number | null): Promise<SessionSequencerStatus> {
    return this.sendSequencerRequest(sessionId, {
      type: "queue_pad",
      request_id: nextRequestId(),
      track_id: trackId,
      pad_index: padIndex
    });
  }

  private async sendSequencerRequest(
    sessionId: string,
    request: BrowserClockWorkerSequencerRequest
  ): Promise<SessionSequencerStatus> {
    await this.connect(sessionId);
    return new Promise<SessionSequencerStatus>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingSequencerRequests.delete(request.request_id);
        reject(new Error("Timed out waiting for browser-clock sequencer response."));
      }, SEQUENCER_REQUEST_TIMEOUT_MS);
      this.pendingSequencerRequests.set(request.request_id, { resolve, reject, timeoutId });
      this.postWorker({ type: "sequencer_request", request });
    });
  }

  private async prepareAudioPipeline(): Promise<void> {
    if (typeof SharedArrayBuffer === "undefined") {
      throw new Error("SharedArrayBuffer is unavailable. Browser-clock audio requires COOP/COEP isolation.");
    }
    if (this.audioContext && this.audioNode && this.worker && this.stateBuffer) {
      await this.resumeAudioContextIfNeeded();
      return;
    }

    const context = new AudioContext({ latencyHint: "interactive" });
    await context.audioWorklet.addModule(WORKLET_MODULE_URL);
    const capacityFrames = Math.max(16_384, Math.round(context.sampleRate * RING_BUFFER_DURATION_SECONDS));
    const sampleSab = new SharedArrayBuffer(capacityFrames * CHANNELS * Float32Array.BYTES_PER_ELEMENT);
    const stateSab = new SharedArrayBuffer(BROWSER_CLOCK_STATE_LENGTH * Uint32Array.BYTES_PER_ELEMENT);
    const stateBuffer = new Uint32Array(stateSab);
    const node = new AudioWorkletNode(context, "browser-clock-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [CHANNELS],
      processorOptions: {
        channels: CHANNELS,
        capacityFrames,
        sampleBuffer: sampleSab,
        stateBuffer: stateSab
      }
    });
    node.onprocessorerror = () => this.handleFatalError("Browser audio processor failed.");
    node.connect(context.destination);

    const worker = new Worker(new URL("../audio/browserClockWorker.ts", import.meta.url), {
      type: "module",
      name: "browser-clock-audio"
    });
    worker.onmessage = (event: MessageEvent<BrowserClockWorkerToMainMessage>) => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = () => this.handleFatalError("Browser audio worker failed.");

    context.onstatechange = () => this.syncStatus();
    this.audioContext = context;
    this.audioNode = node;
    this.worker = worker;
    this.sampleBufferSab = sampleSab;
    this.stateBufferSab = stateSab;
    this.stateBuffer = stateBuffer;
    this.capacityFrames = capacityFrames;
    this.installUnlockListeners();
    await this.resumeAudioContextIfNeeded();
  }

  private handleWorkerMessage(message: BrowserClockWorkerToMainMessage): void {
    switch (message.type) {
      case "connected":
        this.connectedSessionId = message.sessionId;
        this.callbacks.onSequencerStatus(message.sequencerStatus);
        this.finishConnect(null);
        this.syncStatus();
        return;
      case "sequencer_status": {
        const pending = this.pendingSequencerRequests.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeoutId);
          this.pendingSequencerRequests.delete(message.requestId);
          pending.resolve(message.sequencerStatus);
        }
        this.callbacks.onSequencerStatus(message.sequencerStatus);
        return;
      }
      case "audible_events":
        this.callbacks.onTransportEvents?.(message.events);
        this.postWorker({ type: "visual_ack" }, true);
        return;
      case "diagnostics":
        this.callbacks.onDiagnostics?.(message.diagnostics);
        return;
      case "status":
        if (message.status === "primed") {
          this.workerPrimed = true;
          this.syncStatus();
        } else if (message.status === "connecting") {
          this.callbacks.onStatusChange("connecting");
        } else if (message.status === "off") {
          this.callbacks.onStatusChange("off");
        } else if (message.status === "error") {
          this.handleFatalError(message.error ?? "Browser audio worker failed.");
        }
        return;
      case "error":
        this.handleFatalError(message.message);
    }
  }

  private syncStatus(): void {
    if (this.fatalError) {
      this.callbacks.onStatusChange("error");
      this.callbacks.onErrorChange(this.fatalError);
      return;
    }
    if (!this.sessionId) {
      this.callbacks.onStatusChange("off");
      return;
    }
    if (this.workerPrimed && this.audioContext?.state === "running") {
      this.callbacks.onStatusChange("live");
      this.callbacks.onErrorChange(null);
      this.removeUnlockListeners();
      return;
    }
    this.callbacks.onStatusChange("connecting");
    if (this.audioContext?.state === "suspended") {
      this.callbacks.onErrorChange(AUDIO_UNLOCK_MESSAGE);
      this.installUnlockListeners();
    }
  }

  private handleFatalError(message: string): void {
    this.fatalError = message;
    this.connectedSessionId = null;
    this.workerPrimed = false;
    if (this.stateBuffer) {
      Atomics.store(this.stateBuffer, BROWSER_CLOCK_STATE_PLAYBACK_ENABLED, 0);
    }
    const error = new Error(message);
    this.finishConnect(error);
    this.rejectPending(error);
    this.callbacks.onStatusChange("error");
    this.callbacks.onErrorChange(message);
  }

  private finishConnect(error: Error | null): void {
    const pending = this.pendingConnect;
    this.pendingConnect = null;
    if (!pending) {
      return;
    }
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve();
    }
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pendingSequencerRequests) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingSequencerRequests.delete(requestId);
    }
  }

  private postWorker(message: BrowserClockMainToWorkerMessage, optional = false): void {
    if (!this.worker) {
      if (!optional) {
        throw new Error("Browser audio worker is unavailable.");
      }
      return;
    }
    this.worker.postMessage(message);
  }

  private async resumeAudioContextIfNeeded(): Promise<void> {
    const context = this.audioContext;
    if (!context || context.state !== "suspended") {
      return;
    }
    try {
      await context.resume();
    } catch {
      // Autoplay policy will permit a later user gesture.
    }
    this.syncStatus();
  }

  private installUnlockListeners(): void {
    if (this.unlockHandler) {
      return;
    }
    this.unlockHandler = () => {
      void this.resumeAudioContextIfNeeded();
    };
    window.addEventListener("pointerdown", this.unlockHandler);
    window.addEventListener("keydown", this.unlockHandler);
  }

  private removeUnlockListeners(): void {
    if (!this.unlockHandler) {
      return;
    }
    window.removeEventListener("pointerdown", this.unlockHandler);
    window.removeEventListener("keydown", this.unlockHandler);
    this.unlockHandler = null;
  }
}
