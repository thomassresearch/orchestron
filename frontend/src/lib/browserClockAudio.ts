import { wsBaseUrl } from "../api/client";
import type {
  BrowserClockClaimControllerRequest,
  BrowserClockEngineErrorMessage,
  BrowserClockQueuePadControlRequest,
  BrowserClockRenderChunkMessage,
  BrowserClockReleaseControllerRequest,
  BrowserClockRequestRenderRequest,
  BrowserClockSequencerCommandRequest,
  BrowserClockSequencerStartControlRequest,
  BrowserClockSequencerStatusMessage,
  BrowserClockServerMessage,
  BrowserClockStreamConfigMessage,
  SessionMidiEventRequest,
  SessionSequencerConfigRequest,
  SessionSequencerStatus
} from "../types";

type BrowserAudioStatus = "off" | "connecting" | "live" | "error";

type BrowserClockCallbacks = {
  onStatusChange: (status: BrowserAudioStatus) => void;
  onErrorChange: (message: string | null) => void;
  onSequencerStatus: (status: SessionSequencerStatus) => void;
};

type PendingSequencerRequest = {
  resolve: (status: SessionSequencerStatus) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

type PendingConnect = {
  resolve: () => void;
  reject: (error: Error) => void;
};

const WORKLET_MODULE_URL = new URL("../audio/browserClockProcessor.js", import.meta.url).href;
const RING_BUFFER_CHANNELS = 2;
const RING_BUFFER_DURATION_SECONDS = 6;
const RENDER_REFILL_INTERVAL_MS = 20;
const SEQUENCER_REQUEST_TIMEOUT_MS = 5_000;
const AUDIO_UNLOCK_MESSAGE = "Tap anywhere to enable browser audio.";
const STEADY_LOW_WATER_SECONDS = 0.45;
const STEADY_HIGH_WATER_SECONDS = 0.9;
const STARTUP_LOW_WATER_SECONDS = 0.75;
const STARTUP_HIGH_WATER_SECONDS = 1.5;
const UNDERRUN_RECOVERY_BOOST_SECONDS = 0.3;
const UNDERRUN_RECOVERY_WINDOW_MS = 5_000;
const MAX_UNDERRUN_BOOST_SECONDS = 1.2;
const MAX_BLOCKS_PER_REQUEST = 768;
const STEADY_MAX_PARALLEL_REQUESTS = 3;
const STARTUP_MAX_PARALLEL_REQUESTS = 4;
const RECOVERY_MAX_PARALLEL_REQUESTS = 5;

type PendingRenderChunk = {
  metadata: BrowserClockRenderChunkMessage;
  estimatedFrames: number;
};

type QueueTargets = {
  lowWaterFrames: number;
  highWaterFrames: number;
  maxParallelRequests: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBrowserClockServerMessage(value: unknown): value is BrowserClockServerMessage {
  return isObjectRecord(value) && typeof value.type === "string";
}

function nextRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class BrowserClockAudioClient {
  private readonly callbacks: BrowserClockCallbacks;
  private connectPromise: Promise<void> | null = null;
  private pendingConnect: PendingConnect | null = null;
  private pendingSequencerRequests = new Map<string, PendingSequencerRequest>();
  private sessionId: string | null = null;
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private audioNode: AudioWorkletNode | null = null;
  private sampleBuffer: Float32Array | null = null;
  private stateBuffer: Int32Array | null = null;
  private capacityFrames = 0;
  private refillTimer: number | null = null;
  private pendingChunk: PendingRenderChunk | null = null;
  private streamConfig: BrowserClockStreamConfigMessage | null = null;
  private inFlightRenderRequests = 0;
  private pendingRenderFrames = 0;
  private pendingRenderEstimates: number[] = [];
  private startupPrimed = false;
  private lastUnderrunCount = 0;
  private underrunBoostFrames = 0;
  private underrunRecoveryUntil = 0;
  private closedByClient = false;
  private unlockHandler: (() => void) | null = null;

  constructor(callbacks: BrowserClockCallbacks) {
    this.callbacks = callbacks;
  }

  async prime(): Promise<void> {
    await this.prepareAudioPipeline();
  }

  async connect(sessionId: string): Promise<void> {
    if (
      this.sessionId === sessionId &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.streamConfig !== null &&
      this.connectPromise === null
    ) {
      this.syncStatusFromState();
      this.requestRefill();
      return;
    }

    if (this.connectPromise && this.sessionId === sessionId) {
      return this.connectPromise;
    }

    if (this.sessionId !== null && this.sessionId !== sessionId) {
      await this.disconnect();
    }

    this.sessionId = sessionId;
    this.closedByClient = false;
    this.callbacks.onStatusChange("connecting");
    this.callbacks.onErrorChange(null);

    const pending = new Promise<void>((resolve, reject) => {
      this.pendingConnect = { resolve, reject };
    });
    this.connectPromise = pending;

    void this.connectInternal(sessionId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to start browser-clock audio.";
      this.handleFatalError(message, { closeSocket: true });
    });

    try {
      await pending;
    } finally {
      if (this.connectPromise === pending) {
        this.connectPromise = null;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.closedByClient = true;
    this.stopRefillLoop();
    this.pendingChunk = null;
    this.streamConfig = null;
    this.resetRenderPipelineState();
    this.rejectPendingSequencerRequests(new Error("Browser-clock connection closed."));
    this.finishPendingConnect(new Error("Browser-clock connection closed."));
    this.removeUnlockListeners();

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        const release: BrowserClockReleaseControllerRequest = { type: "release_controller" };
        socket.send(JSON.stringify(release));
      } catch {
        // Ignore release failures during shutdown.
      }
    }
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try {
        socket.close(1000, "client_disconnect");
      } catch {
        // Ignore browser websocket close failures during shutdown.
      }
    }

    const audioNode = this.audioNode;
    this.audioNode = null;
    if (audioNode) {
      try {
        audioNode.disconnect();
      } catch {
        // Ignore audio node disconnect failures during shutdown.
      }
    }

    const context = this.audioContext;
    this.audioContext = null;
    if (context) {
      try {
        await context.close();
      } catch {
        // Ignore audio context close failures during shutdown.
      }
    }

    this.sampleBuffer = null;
    this.stateBuffer = null;
    this.capacityFrames = 0;
    this.sessionId = null;
    this.callbacks.onStatusChange("off");
    this.callbacks.onErrorChange(null);
  }

  async sendManualMidi(sessionId: string, midi: SessionMidiEventRequest): Promise<void> {
    await this.connect(sessionId);
    this.sendJson({
      type: "manual_midi",
      midi
    });
  }

  async startSequencer(
    sessionId: string,
    payload: {
      config?: SessionSequencerConfigRequest | null;
      positionStep?: number | null;
    }
  ): Promise<SessionSequencerStatus> {
    const request: BrowserClockSequencerStartControlRequest = {
      type: "sequencer_start",
      request_id: nextRequestId(),
      config: payload.config ?? null,
      position_step: payload.positionStep ?? null
    };
    return this.sendSequencerRequest(sessionId, request);
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
    const request: BrowserClockQueuePadControlRequest = {
      type: "queue_pad",
      request_id: nextRequestId(),
      track_id: trackId,
      pad_index: padIndex
    };
    return this.sendSequencerRequest(sessionId, request);
  }

  private async connectInternal(sessionId: string): Promise<void> {
    await this.prepareAudioPipeline();
    this.clearRingBuffer();

    const socket = new WebSocket(`${wsBaseUrl()}/ws/sessions/${sessionId}/browser-clock`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.pendingChunk = null;
    this.streamConfig = null;
    this.resetRenderPipelineState();

    socket.onopen = () => {
      const context = this.audioContext;
      const sampleRate = context ? Math.max(1, Math.round(context.sampleRate)) : 48_000;
      const claimTargets = this.buildClaimTargets(sampleRate);
      const claim: BrowserClockClaimControllerRequest = {
        type: "claim_controller",
        audio_context_sample_rate: sampleRate,
        queue_low_water_frames: claimTargets.lowWaterFrames,
        queue_high_water_frames: claimTargets.highWaterFrames,
        max_blocks_per_request: MAX_BLOCKS_PER_REQUEST
      };
      try {
        socket.send(JSON.stringify(claim));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to claim browser-clock control.";
        this.handleFatalError(message, { closeSocket: true });
      }
    };

    socket.onmessage = (event) => {
      void this.handleSocketMessage(socket, event.data);
    };

    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.stopRefillLoop();
      this.pendingChunk = null;
      this.resetRenderPipelineState();
      if (this.closedByClient) {
        this.finishPendingConnect(new Error("Browser-clock connection closed."));
        this.rejectPendingSequencerRequests(new Error("Browser-clock connection closed."));
        return;
      }
      const reason = event.reason?.trim().length ? event.reason : "Browser-clock connection closed.";
      this.handleFatalError(reason, { closeSocket: false });
    };

    socket.onerror = () => {
      if (!this.closedByClient) {
        this.callbacks.onStatusChange("error");
        this.callbacks.onErrorChange("Browser-clock websocket error.");
      }
    };
  }

  private async handleSocketMessage(socket: WebSocket, payload: string | ArrayBuffer | Blob): Promise<void> {
    if (this.socket !== socket) {
      return;
    }

    if (typeof payload === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        this.handleFatalError("Browser-clock server sent invalid JSON.", { closeSocket: true });
        return;
      }

      if (!isBrowserClockServerMessage(parsed)) {
        this.handleFatalError("Browser-clock server sent an unknown control payload.", { closeSocket: true });
        return;
      }

      switch (parsed.type) {
        case "stream_config":
          this.streamConfig = parsed;
          this.pendingChunk = null;
          this.resetRenderPipelineState();
          this.lastUnderrunCount = this.readUnderrunCount();
          this.callbacks.onSequencerStatus(parsed.sequencer_status);
          this.finishPendingConnect(null);
          this.startRefillLoop();
          this.syncStatusFromState();
          this.requestRefill();
          return;
        case "render_chunk":
          this.pendingChunk = {
            metadata: parsed,
            estimatedFrames: this.pendingRenderEstimates.shift() ?? parsed.target_frame_count
          };
          return;
        case "sequencer_status":
          this.resolveSequencerRequest(parsed);
          this.callbacks.onSequencerStatus(parsed.sequencer_status);
          return;
        case "controller_revoked":
          this.handleFatalError(parsed.reason, { closeSocket: true });
          return;
        case "engine_error":
          this.handleEngineError(parsed);
          return;
        default:
          this.handleFatalError("Browser-clock server sent an unsupported message.", { closeSocket: true });
      }
      return;
    }

    const metadata = this.pendingChunk;
    if (!metadata) {
      this.handleFatalError("Received PCM data without matching render metadata.", { closeSocket: true });
      return;
    }

    const arrayBuffer = payload instanceof Blob ? await payload.arrayBuffer() : payload;
    this.pendingChunk = null;
    this.inFlightRenderRequests = Math.max(0, this.inFlightRenderRequests - 1);
    this.pendingRenderFrames = Math.max(0, this.pendingRenderFrames - metadata.estimatedFrames);

    try {
      this.enqueuePcmChunk(metadata.metadata, arrayBuffer);
      this.updateStartupPrimed();
      this.syncStatusFromState();
      this.requestRefill();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to buffer browser-clock audio.";
      this.handleFatalError(message, { closeSocket: true });
    }
  }

  private handleEngineError(message: BrowserClockEngineErrorMessage): void {
    const error = new Error(message.detail);
    this.resetRenderPipelineState();
    this.pendingChunk = null;
    if (this.pendingConnect) {
      this.finishPendingConnect(error);
      this.callbacks.onStatusChange("error");
      this.callbacks.onErrorChange(message.detail);
      return;
    }
    this.rejectPendingSequencerRequests(error);
    this.callbacks.onStatusChange("error");
    this.callbacks.onErrorChange(message.detail);
  }

  private resolveSequencerRequest(message: BrowserClockSequencerStatusMessage): void {
    const pending = this.pendingSequencerRequests.get(message.request_id);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeoutId);
    this.pendingSequencerRequests.delete(message.request_id);
    pending.resolve(message.sequencer_status);
  }

  private async sendSequencerRequest(
    sessionId: string,
    request:
      | BrowserClockSequencerStartControlRequest
      | BrowserClockSequencerCommandRequest
      | BrowserClockQueuePadControlRequest
  ): Promise<SessionSequencerStatus> {
    await this.connect(sessionId);
    return new Promise<SessionSequencerStatus>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingSequencerRequests.delete(request.request_id);
        reject(new Error("Timed out waiting for browser-clock sequencer response."));
      }, SEQUENCER_REQUEST_TIMEOUT_MS);

      this.pendingSequencerRequests.set(request.request_id, { resolve, reject, timeoutId });

      try {
        this.sendJson(request);
      } catch (error) {
        window.clearTimeout(timeoutId);
        this.pendingSequencerRequests.delete(request.request_id);
        reject(error instanceof Error ? error : new Error("Failed to send browser-clock sequencer request."));
      }
    });
  }

  private sendJson(
    payload:
      | BrowserClockRequestRenderRequest
      | BrowserClockSequencerStartControlRequest
      | BrowserClockSequencerCommandRequest
      | BrowserClockQueuePadControlRequest
      | { type: "manual_midi"; midi: SessionMidiEventRequest }
  ): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Browser-clock controller socket is not connected.");
    }
    socket.send(JSON.stringify(payload));
  }

  private requestRefill(): void {
    const streamConfig = this.streamConfig;
    if (!streamConfig) {
      return;
    }

    this.observeUnderruns(streamConfig);
    this.updateStartupPrimed();

    const queueTargets = this.currentQueueTargets(streamConfig);
    const availableFrames = this.availableFrames();
    let projectedFrames = availableFrames + this.pendingRenderFrames;
    const refillThreshold = this.startupPrimed ? queueTargets.lowWaterFrames : queueTargets.highWaterFrames;
    if (projectedFrames >= refillThreshold) {
      return;
    }

    const framesPerBlock = this.estimateFramesPerBlock(streamConfig);
    while (
      projectedFrames < queueTargets.highWaterFrames &&
      this.inFlightRenderRequests < queueTargets.maxParallelRequests
    ) {
      const deficitFrames = Math.max(0, queueTargets.highWaterFrames - projectedFrames);
      const requestedBlocks = Math.max(
        1,
        Math.min(streamConfig.max_blocks_per_request, Math.ceil(deficitFrames / framesPerBlock))
      );
      const estimatedFrames = requestedBlocks * framesPerBlock;

      try {
        this.sendJson({
          type: "request_render",
          block_count: requestedBlocks
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to request browser-clock audio.";
        this.handleFatalError(message, { closeSocket: true });
        return;
      }

      this.inFlightRenderRequests += 1;
      this.pendingRenderFrames += estimatedFrames;
      this.pendingRenderEstimates.push(estimatedFrames);
      projectedFrames += estimatedFrames;
    }
  }

  private async prepareAudioPipeline(): Promise<void> {
    if (typeof SharedArrayBuffer === "undefined") {
      throw new Error("SharedArrayBuffer is unavailable. Browser-clock audio requires COOP/COEP isolation.");
    }

    if (this.audioContext && this.audioNode && this.sampleBuffer && this.stateBuffer) {
      await this.resumeAudioContextIfNeeded();
      this.syncStatusFromState();
      return;
    }

    const context = new AudioContext({ latencyHint: "interactive" });
    context.onstatechange = () => {
      this.syncStatusFromState();
      if (context.state === "running") {
        this.requestRefill();
      }
    };
    await context.audioWorklet.addModule(WORKLET_MODULE_URL);

    const capacityFrames = Math.max(16_384, Math.round(context.sampleRate * RING_BUFFER_DURATION_SECONDS));
    const sampleSab = new SharedArrayBuffer(
      capacityFrames * RING_BUFFER_CHANNELS * Float32Array.BYTES_PER_ELEMENT
    );
    const stateSab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
    const stateBuffer = new Int32Array(stateSab);
    const node = new AudioWorkletNode(context, "browser-clock-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [RING_BUFFER_CHANNELS],
      processorOptions: {
        channels: RING_BUFFER_CHANNELS,
        capacityFrames,
        sampleBuffer: sampleSab,
        stateBuffer: stateSab
      }
    });
    node.onprocessorerror = () => {
      this.handleFatalError("Browser audio processor failed.", { closeSocket: true });
    };
    node.connect(context.destination);

    this.audioContext = context;
    this.audioNode = node;
    this.sampleBuffer = new Float32Array(sampleSab);
    this.stateBuffer = stateBuffer;
    this.capacityFrames = capacityFrames;
    this.installUnlockListeners();
    await this.resumeAudioContextIfNeeded();
    this.syncStatusFromState();
  }

  private async resumeAudioContextIfNeeded(): Promise<void> {
    const context = this.audioContext;
    if (!context || context.state !== "suspended") {
      return;
    }
    try {
      await context.resume();
    } catch {
      // Keep listening for the next user interaction if autoplay policies block resume.
    }
    this.syncStatusFromState();
  }

  private installUnlockListeners(): void {
    if (typeof window === "undefined" || this.unlockHandler !== null) {
      return;
    }
    this.unlockHandler = () => {
      void this.resumeAudioContextIfNeeded();
    };
    window.addEventListener("pointerdown", this.unlockHandler);
    window.addEventListener("keydown", this.unlockHandler);
  }

  private removeUnlockListeners(): void {
    if (typeof window === "undefined" || this.unlockHandler === null) {
      return;
    }
    window.removeEventListener("pointerdown", this.unlockHandler);
    window.removeEventListener("keydown", this.unlockHandler);
    this.unlockHandler = null;
  }

  private clearRingBuffer(): void {
    const stateBuffer = this.stateBuffer;
    if (!stateBuffer) {
      return;
    }
    Atomics.store(stateBuffer, 0, 0);
    Atomics.store(stateBuffer, 1, 0);
    Atomics.store(stateBuffer, 2, 0);
    Atomics.store(stateBuffer, 3, 0);
  }

  private buildClaimTargets(sampleRate: number): QueueTargets {
    const steadyLowWaterFrames = this.clampBufferedFrames(Math.round(sampleRate * STEADY_LOW_WATER_SECONDS));
    const steadyHighWaterFrames = this.clampBufferedFrames(
      Math.max(steadyLowWaterFrames + 1024, Math.round(sampleRate * STEADY_HIGH_WATER_SECONDS))
    );
    const startupLowWaterFrames = this.clampBufferedFrames(
      Math.max(steadyLowWaterFrames + 1024, Math.round(sampleRate * STARTUP_LOW_WATER_SECONDS))
    );
    const startupHighWaterFrames = this.clampBufferedFrames(
      Math.max(startupLowWaterFrames + 2048, Math.round(sampleRate * STARTUP_HIGH_WATER_SECONDS))
    );
    return {
      lowWaterFrames: startupLowWaterFrames,
      highWaterFrames: startupHighWaterFrames,
      maxParallelRequests: STARTUP_MAX_PARALLEL_REQUESTS
    };
  }

  private enqueuePcmChunk(metadata: BrowserClockRenderChunkMessage, buffer: ArrayBuffer): void {
    if (metadata.channels !== RING_BUFFER_CHANNELS) {
      throw new Error(`Expected ${RING_BUFFER_CHANNELS} output channels, received ${metadata.channels}.`);
    }
    if (!this.sampleBuffer || !this.stateBuffer || this.capacityFrames < 1) {
      throw new Error("Browser-clock audio buffer is not initialized.");
    }

    const source = new Float32Array(buffer);
    const expectedSamples = metadata.target_frame_count * metadata.channels;
    if (source.length !== expectedSamples) {
      throw new Error("Browser-clock PCM payload length did not match render metadata.");
    }

    const readFrame = Atomics.load(this.stateBuffer, 0);
    const writeFrame = Atomics.load(this.stateBuffer, 1);
    const availableFrames = writeFrame - readFrame;
    const freeFrames = this.capacityFrames - availableFrames;
    if (metadata.target_frame_count > freeFrames) {
      throw new Error("Browser-clock audio ring buffer overflowed.");
    }

    for (let frameIndex = 0; frameIndex < metadata.target_frame_count; frameIndex += 1) {
      const ringFrame = (writeFrame + frameIndex) % this.capacityFrames;
      const sampleBase = frameIndex * metadata.channels;
      const ringBase = ringFrame * RING_BUFFER_CHANNELS;
      this.sampleBuffer[ringBase] = source[sampleBase];
      this.sampleBuffer[ringBase + 1] = source[sampleBase + 1];
    }

    Atomics.store(this.stateBuffer, 1, writeFrame + metadata.target_frame_count);
  }

  private availableFrames(): number {
    const stateBuffer = this.stateBuffer;
    if (!stateBuffer) {
      return 0;
    }
    const readFrame = Atomics.load(stateBuffer, 0);
    const writeFrame = Atomics.load(stateBuffer, 1);
    return Math.max(0, writeFrame - readFrame);
  }

  private clampBufferedFrames(frames: number): number {
    const maxBufferedFrames = Math.max(4096, this.capacityFrames - 4096);
    return Math.max(1024, Math.min(frames, maxBufferedFrames));
  }

  private estimateFramesPerBlock(streamConfig: BrowserClockStreamConfigMessage): number {
    return Math.max(
      1,
      Math.round((streamConfig.ksmps * streamConfig.target_sample_rate) / streamConfig.engine_sample_rate)
    );
  }

  private currentQueueTargets(streamConfig: BrowserClockStreamConfigMessage): QueueTargets {
    const claimTargets = this.buildClaimTargets(streamConfig.target_sample_rate);
    const steadyLowWaterFrames = this.clampBufferedFrames(Math.round(streamConfig.target_sample_rate * STEADY_LOW_WATER_SECONDS));
    const steadyHighWaterFrames = this.clampBufferedFrames(
      Math.max(steadyLowWaterFrames + 1024, Math.round(streamConfig.target_sample_rate * STEADY_HIGH_WATER_SECONDS))
    );
    const recoveryBoostFrames = this.underrunBoostFrames;

    if (!this.startupPrimed) {
      return {
        lowWaterFrames: this.clampBufferedFrames(claimTargets.lowWaterFrames + recoveryBoostFrames),
        highWaterFrames: this.clampBufferedFrames(claimTargets.highWaterFrames + recoveryBoostFrames),
        maxParallelRequests:
          recoveryBoostFrames > 0 ? RECOVERY_MAX_PARALLEL_REQUESTS : claimTargets.maxParallelRequests
      };
    }

    const lowWaterFrames = this.clampBufferedFrames(steadyLowWaterFrames + recoveryBoostFrames);
    const highWaterFrames = this.clampBufferedFrames(
      Math.max(lowWaterFrames + 1024, steadyHighWaterFrames + recoveryBoostFrames)
    );
    return {
      lowWaterFrames,
      highWaterFrames,
      maxParallelRequests: recoveryBoostFrames > 0 ? RECOVERY_MAX_PARALLEL_REQUESTS : STEADY_MAX_PARALLEL_REQUESTS
    };
  }

  private updateStartupPrimed(): void {
    if (!this.streamConfig) {
      this.startupPrimed = false;
      return;
    }
    const startupHighWaterFrames = this.buildClaimTargets(this.streamConfig.target_sample_rate).highWaterFrames;
    if (this.availableFrames() >= startupHighWaterFrames) {
      this.startupPrimed = true;
    }
  }

  private readUnderrunCount(): number {
    if (!this.stateBuffer) {
      return 0;
    }
    return Math.max(0, Atomics.load(this.stateBuffer, 2));
  }

  private observeUnderruns(streamConfig: BrowserClockStreamConfigMessage): void {
    const currentUnderrunCount = this.readUnderrunCount();
    if (currentUnderrunCount > this.lastUnderrunCount) {
      const delta = currentUnderrunCount - this.lastUnderrunCount;
      const boostFramesPerUnderrun = Math.round(streamConfig.target_sample_rate * UNDERRUN_RECOVERY_BOOST_SECONDS);
      const maxBoostFrames = Math.round(streamConfig.target_sample_rate * MAX_UNDERRUN_BOOST_SECONDS);
      this.underrunBoostFrames = Math.min(
        maxBoostFrames,
        this.underrunBoostFrames + delta * boostFramesPerUnderrun
      );
      this.underrunRecoveryUntil = Date.now() + UNDERRUN_RECOVERY_WINDOW_MS;
      this.startupPrimed = false;
      this.lastUnderrunCount = currentUnderrunCount;
      return;
    }

    if (this.underrunBoostFrames > 0 && Date.now() >= this.underrunRecoveryUntil) {
      this.underrunBoostFrames = 0;
    }
  }

  private startRefillLoop(): void {
    this.stopRefillLoop();
    this.refillTimer = window.setInterval(() => {
      this.requestRefill();
    }, RENDER_REFILL_INTERVAL_MS);
  }

  private stopRefillLoop(): void {
    if (this.refillTimer !== null) {
      window.clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
  }

  private finishPendingConnect(error: Error | null): void {
    if (!this.pendingConnect) {
      return;
    }
    const pending = this.pendingConnect;
    this.pendingConnect = null;
    if (error) {
      pending.reject(error);
      return;
    }
    pending.resolve();
  }

  private rejectPendingSequencerRequests(error: Error): void {
    for (const [requestId, pending] of this.pendingSequencerRequests.entries()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingSequencerRequests.delete(requestId);
    }
  }

  private syncStatusFromState(): void {
    if (this.closedByClient || this.sessionId === null) {
      this.callbacks.onStatusChange("off");
      this.callbacks.onErrorChange(null);
      return;
    }

    const context = this.audioContext;
    if (!context || !this.streamConfig) {
      this.callbacks.onStatusChange("connecting");
      return;
    }

    if (context.state === "running") {
      this.callbacks.onStatusChange("live");
      this.callbacks.onErrorChange(null);
      this.removeUnlockListeners();
      return;
    }

    this.callbacks.onStatusChange("connecting");
    this.callbacks.onErrorChange(AUDIO_UNLOCK_MESSAGE);
    this.installUnlockListeners();
  }

  private handleFatalError(message: string, options: { closeSocket: boolean }): void {
    this.stopRefillLoop();
    this.pendingChunk = null;
    this.resetRenderPipelineState();
    const error = new Error(message);
    this.finishPendingConnect(error);
    this.rejectPendingSequencerRequests(error);
    this.callbacks.onStatusChange("error");
    this.callbacks.onErrorChange(message);

    if (!options.closeSocket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try {
        socket.close(1011, "browser_clock_error");
      } catch {
        // Ignore browser websocket close failures during fatal shutdown.
      }
    }
  }

  private resetRenderPipelineState(): void {
    this.inFlightRenderRequests = 0;
    this.pendingRenderFrames = 0;
    this.pendingRenderEstimates = [];
    this.startupPrimed = false;
    this.underrunBoostFrames = 0;
    this.underrunRecoveryUntil = 0;
  }
}
