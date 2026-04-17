import { wsBaseUrl } from "../api/client";
import { resolveDefaultBrowserClockLatencySettings } from "./browserClockLatencyConfig";
import type {
  BrowserClockClaimControllerRequest,
  BrowserClockClockSyncMessage,
  BrowserClockClockSyncRequest,
  BrowserClockLatencySettings,
  BrowserClockEngineErrorMessage,
  BrowserClockManualMidiRequest,
  BrowserClockQueuePadControlRequest,
  BrowserClockRenderChunkMessage,
  BrowserClockReleaseControllerRequest,
  BrowserClockRequestRenderRequest,
  BrowserClockSequencerCommandRequest,
  BrowserClockSequencerStartControlRequest,
  BrowserClockSequencerStatusMessage,
  BrowserClockServerMessage,
  BrowserClockStreamConfigMessage,
  BrowserClockTimingReportRequest,
  SessionMidiEventRequest,
  SessionSequencerConfigRequest,
  SessionSequencerStatus
} from "../types";

type BrowserAudioStatus = "off" | "connecting" | "live" | "error";

type BrowserClockCallbacks = {
  onStatusChange: (status: BrowserAudioStatus) => void;
  onErrorChange: (message: string | null) => void;
  onSequencerStatus: (status: SessionSequencerStatus) => void;
  getLatencySettings?: () => BrowserClockLatencySettings;
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
const RENDER_REFILL_FALLBACK_INTERVAL_MS = 100;
const CLOCK_SYNC_INTERVAL_MS = 500;
const CLOCK_SYNC_MAX_AGE_MS = 2_000;
const SEQUENCER_REQUEST_TIMEOUT_MS = 5_000;
const AUDIO_UNLOCK_MESSAGE = "Tap anywhere to enable browser audio.";
const UNDERRUN_RECOVERY_WINDOW_MS = 5_000;

type PendingRenderChunk = {
  metadata: BrowserClockRenderChunkMessage;
  request: PendingRenderRequest;
};

type QueueTargets = {
  lowWaterFrames: number;
  highWaterFrames: number;
  maxParallelRequests: number;
};

type RenderRequestPriority = "steady" | "interactive";

type PendingRenderRequest = {
  estimatedFrames: number;
  priority: RenderRequestPriority;
  requestId: string;
  clientPerfMs: number;
};

type BrowserClockWorkletMessage = {
  type: "need_refill";
  available_frames: number;
};

type PlaybackTimelineSegment = {
  targetFrameStart: number;
  targetFrameEnd: number;
  transportSubunitStart: number;
  transportSubunitEnd: number;
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

function latencyMsToFrames(sampleRate: number, valueMs: number): number {
  return Math.round((sampleRate * valueMs) / 1000);
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
  private timingReportTimer: number | null = null;
  private clockSyncTimer: number | null = null;
  private pendingChunk: PendingRenderChunk | null = null;
  private streamConfig: BrowserClockStreamConfigMessage | null = null;
  private inFlightRenderRequests = 0;
  private inFlightImmediateRenderRequests = 0;
  private pendingRenderFrames = 0;
  private pendingRenderRequests: PendingRenderRequest[] = [];
  private pendingClockSyncRequests = new Set<string>();
  private latestClockSyncOffsetNs: number | null = null;
  private latestClockSyncRttMs: number | null = null;
  private lastClockSyncAtPerfMs = 0;
  private startupPrimed = false;
  private lastUnderrunCount = 0;
  private underrunBoostFrames = 0;
  private underrunRecoveryUntil = 0;
  private lastImmediateRenderAtMs = 0;
  private closedByClient = false;
  private unlockHandler: (() => void) | null = null;
  private playbackTimeline: PlaybackTimelineSegment[] = [];
  private nextChunkTransportSubunitStart: number | null = null;
  private lastPlaybackTransportSubunit: number | null = null;

  constructor(callbacks: BrowserClockCallbacks) {
    this.callbacks = callbacks;
  }

  refreshLatencySettings(): void {
    if (!this.streamConfig || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.sendClaimController();
    this.requestRefill();
    this.syncWorkletRefillThreshold();
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
    this.stopTimingReportLoop();
    this.stopClockSyncLoop();
    this.pendingChunk = null;
    this.streamConfig = null;
    this.syncWorkletRefillThreshold(0);
    this.resetRenderPipelineState();
    this.resetClockSyncState();
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
        audioNode.port.onmessage = null;
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
    this.clearPlaybackTimeline();
    this.sessionId = null;
    this.callbacks.onStatusChange("off");
    this.callbacks.onErrorChange(null);
  }

  async sendManualMidi(sessionId: string, midi: SessionMidiEventRequest): Promise<void> {
    await this.connect(sessionId);
    this.sendJson({
      type: "manual_midi",
      midi,
      event_perf_ms: performance.now()
    } satisfies BrowserClockManualMidiRequest);
    if (midi.type === "note_on") {
      this.requestImmediateNoteRender();
    }
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

  private currentLatencySettings(): BrowserClockLatencySettings {
    return this.callbacks.getLatencySettings?.() ?? resolveDefaultBrowserClockLatencySettings();
  }

  private sendClaimController(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const sampleRate = Math.max(
      1,
      Math.round(this.audioContext?.sampleRate ?? this.streamConfig?.target_sample_rate ?? 48_000)
    );
    const latencySettings = this.currentLatencySettings();
    const claimTargets = this.buildClaimTargets(sampleRate, latencySettings);
    const claim: BrowserClockClaimControllerRequest = {
      type: "claim_controller",
      audio_context_sample_rate: sampleRate,
      queue_low_water_frames: claimTargets.lowWaterFrames,
      queue_high_water_frames: claimTargets.highWaterFrames,
      max_blocks_per_request: latencySettings.maxBlocksPerRequest
    };

    try {
      socket.send(JSON.stringify(claim));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to claim browser-clock control.";
      this.handleFatalError(message, { closeSocket: true });
    }
  }

  getPlaybackTransportSubunit(): number | null {
    const stateBuffer = this.stateBuffer;
    if (!stateBuffer) {
      return null;
    }

    const readFrame = Atomics.load(stateBuffer, 0);
    this.prunePlaybackTimeline(readFrame);

    const activeSegment = this.playbackTimeline.find((segment) => readFrame < segment.targetFrameEnd) ?? null;
    if (!activeSegment) {
      return this.lastPlaybackTransportSubunit ?? this.nextChunkTransportSubunitStart;
    }

    if (readFrame <= activeSegment.targetFrameStart) {
      this.lastPlaybackTransportSubunit = activeSegment.transportSubunitStart;
      return activeSegment.transportSubunitStart;
    }

    const spanFrames = Math.max(1, activeSegment.targetFrameEnd - activeSegment.targetFrameStart);
    const progress = Math.max(0, Math.min(1, (readFrame - activeSegment.targetFrameStart) / spanFrames));
    const transportSubunit =
      activeSegment.transportSubunitStart +
      progress * (activeSegment.transportSubunitEnd - activeSegment.transportSubunitStart);
    this.lastPlaybackTransportSubunit = transportSubunit;
    return transportSubunit;
  }

  private async connectInternal(sessionId: string): Promise<void> {
    await this.prepareAudioPipeline();
    this.clearRingBuffer();
    this.clearPlaybackTimeline();

    const socket = new WebSocket(`${wsBaseUrl()}/ws/sessions/${sessionId}/browser-clock`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.pendingChunk = null;
    this.streamConfig = null;
    this.resetRenderPipelineState();
    this.resetClockSyncState();

    socket.onopen = () => {
      this.sendClaimController();
    };

    socket.onmessage = (event) => {
      void this.handleSocketMessage(socket, event.data);
    };

    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.stopRefillLoop();
      this.stopTimingReportLoop();
      this.stopClockSyncLoop();
      this.pendingChunk = null;
      this.syncWorkletRefillThreshold(0);
      this.resetRenderPipelineState();
      this.resetClockSyncState();
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
          this.clearPlaybackTimeline();
          this.nextChunkTransportSubunitStart = parsed.sequencer_status.transport_subunit;
          this.lastPlaybackTransportSubunit = parsed.sequencer_status.transport_subunit;
          this.lastUnderrunCount = this.readUnderrunCount();
          this.callbacks.onSequencerStatus(parsed.sequencer_status);
          this.finishPendingConnect(null);
          this.syncWorkletRefillThreshold();
          this.startRefillLoop();
          this.startTimingReportLoop();
          this.startClockSyncLoop();
          this.syncStatusFromState();
          this.requestRefill();
          return;
        case "clock_sync":
          this.handleClockSyncMessage(parsed);
          return;
        case "render_chunk":
          this.pendingChunk = {
            metadata: parsed,
            request: this.pendingRenderRequests.shift() ?? {
              estimatedFrames: parsed.target_frame_count,
              priority: "steady",
              requestId: parsed.telemetry.request_id ?? nextRequestId(),
              clientPerfMs: 0
            }
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
    this.pendingRenderFrames = Math.max(0, this.pendingRenderFrames - metadata.request.estimatedFrames);
    if (metadata.request.priority === "interactive") {
      this.inFlightImmediateRenderRequests = Math.max(0, this.inFlightImmediateRenderRequests - 1);
    }

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
      | BrowserClockClockSyncRequest
      | BrowserClockTimingReportRequest
      | BrowserClockSequencerStartControlRequest
      | BrowserClockSequencerCommandRequest
      | BrowserClockQueuePadControlRequest
      | BrowserClockManualMidiRequest
  ): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Browser-clock controller socket is not connected.");
    }
    socket.send(JSON.stringify(payload));
  }

  private dispatchRenderRequest(
    streamConfig: BrowserClockStreamConfigMessage,
    requestedBlocks: number,
    priority: RenderRequestPriority
  ): number | null {
    const estimatedFrames = requestedBlocks * this.estimateFramesPerBlock(streamConfig);
    const requestId = nextRequestId();
    const clientPerfMs = performance.now();

    try {
      this.sendJson({
        type: "request_render",
        block_count: requestedBlocks,
        request_id: requestId,
        client_perf_ms: clientPerfMs,
        priority
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to request browser-clock audio.";
      this.handleFatalError(message, { closeSocket: true });
      return null;
    }

    this.inFlightRenderRequests += 1;
    this.pendingRenderFrames += estimatedFrames;
    this.pendingRenderRequests.push({ estimatedFrames, priority, requestId, clientPerfMs });
    return estimatedFrames;
  }

  private requestRefill(): void {
    const streamConfig = this.streamConfig;
    if (!streamConfig) {
      return;
    }

    const latencySettings = this.currentLatencySettings();
    this.observeUnderruns(streamConfig);
    this.updateStartupPrimed();

    const queueTargets = this.currentQueueTargets(streamConfig);
    const availableFrames = this.availableFrames();
    let projectedFrames = availableFrames + this.pendingRenderFrames;
    const refillThreshold = this.startupPrimed ? queueTargets.lowWaterFrames : queueTargets.highWaterFrames;
    this.syncWorkletRefillThreshold(refillThreshold);
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
        Math.min(
          streamConfig.max_blocks_per_request,
          latencySettings.maxBlocksPerRequest,
          Math.ceil(deficitFrames / framesPerBlock)
        )
      );
      const estimatedFrames = this.dispatchRenderRequest(streamConfig, requestedBlocks, "steady");
      if (estimatedFrames === null) {
        return;
      }
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
    node.port.onmessage = (event: MessageEvent<BrowserClockWorkletMessage>) => {
      this.handleWorkletMessage(event.data);
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

  private clearPlaybackTimeline(): void {
    this.playbackTimeline = [];
    this.nextChunkTransportSubunitStart = null;
    this.lastPlaybackTransportSubunit = null;
  }

  private prunePlaybackTimeline(readFrame: number): void {
    while (this.playbackTimeline.length > 0 && readFrame >= this.playbackTimeline[0].targetFrameEnd) {
      const consumed = this.playbackTimeline.shift();
      if (consumed) {
        this.lastPlaybackTransportSubunit = consumed.transportSubunitEnd;
      }
    }
  }

  private buildClaimTargets(sampleRate: number, latencySettings: BrowserClockLatencySettings): QueueTargets {
    const steadyLowWaterFrames = this.clampBufferedFrames(
      latencyMsToFrames(sampleRate, latencySettings.steadyLowWaterMs)
    );
    const steadyHighWaterFrames = this.clampBufferedFrames(
      Math.max(steadyLowWaterFrames + 1024, latencyMsToFrames(sampleRate, latencySettings.steadyHighWaterMs))
    );
    const startupLowWaterFrames = this.clampBufferedFrames(
      Math.max(steadyLowWaterFrames + 1024, latencyMsToFrames(sampleRate, latencySettings.startupLowWaterMs))
    );
    const startupHighWaterFrames = this.clampBufferedFrames(
      Math.max(startupLowWaterFrames + 2048, latencyMsToFrames(sampleRate, latencySettings.startupHighWaterMs))
    );
    return {
      lowWaterFrames: startupLowWaterFrames,
      highWaterFrames: startupHighWaterFrames,
      maxParallelRequests: latencySettings.startupMaxParallelRequests
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

    const writeOffsetFrames = writeFrame % this.capacityFrames;
    const firstChunkFrames = Math.min(metadata.target_frame_count, this.capacityFrames - writeOffsetFrames);
    const firstChunkSamples = firstChunkFrames * RING_BUFFER_CHANNELS;
    this.sampleBuffer.set(source.subarray(0, firstChunkSamples), writeOffsetFrames * RING_BUFFER_CHANNELS);
    if (firstChunkFrames < metadata.target_frame_count) {
      this.sampleBuffer.set(source.subarray(firstChunkSamples), 0);
    }

    Atomics.store(this.stateBuffer, 1, writeFrame + metadata.target_frame_count);
    const transportSubunitStart = this.nextChunkTransportSubunitStart ?? metadata.sequencer_status.transport_subunit;
    this.playbackTimeline.push({
      targetFrameStart: writeFrame,
      targetFrameEnd: writeFrame + metadata.target_frame_count,
      transportSubunitStart,
      transportSubunitEnd: metadata.sequencer_status.transport_subunit
    });
    this.nextChunkTransportSubunitStart = metadata.sequencer_status.transport_subunit;
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
    const latencySettings = this.currentLatencySettings();
    const claimTargets = this.buildClaimTargets(streamConfig.target_sample_rate, latencySettings);
    const steadyLowWaterFrames = this.clampBufferedFrames(
      latencyMsToFrames(streamConfig.target_sample_rate, latencySettings.steadyLowWaterMs)
    );
    const steadyHighWaterFrames = this.clampBufferedFrames(
      Math.max(steadyLowWaterFrames + 1024, latencyMsToFrames(streamConfig.target_sample_rate, latencySettings.steadyHighWaterMs))
    );
    const recoveryBoostFrames = this.underrunBoostFrames;

    if (!this.startupPrimed) {
      return {
        lowWaterFrames: this.clampBufferedFrames(claimTargets.lowWaterFrames + recoveryBoostFrames),
        highWaterFrames: this.clampBufferedFrames(claimTargets.highWaterFrames + recoveryBoostFrames),
        maxParallelRequests:
          recoveryBoostFrames > 0 ? latencySettings.recoveryMaxParallelRequests : claimTargets.maxParallelRequests
      };
    }

    const lowWaterFrames = this.clampBufferedFrames(steadyLowWaterFrames + recoveryBoostFrames);
    const highWaterFrames = this.clampBufferedFrames(
      Math.max(lowWaterFrames + 1024, steadyHighWaterFrames + recoveryBoostFrames)
    );
    return {
      lowWaterFrames,
      highWaterFrames,
      maxParallelRequests:
        recoveryBoostFrames > 0 ? latencySettings.recoveryMaxParallelRequests : latencySettings.steadyMaxParallelRequests
    };
  }

  private updateStartupPrimed(): void {
    if (!this.streamConfig) {
      this.startupPrimed = false;
      return;
    }
    const startupHighWaterFrames = this.buildClaimTargets(
      this.streamConfig.target_sample_rate,
      this.currentLatencySettings()
    ).highWaterFrames;
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
    const latencySettings = this.currentLatencySettings();
    const currentUnderrunCount = this.readUnderrunCount();
    if (currentUnderrunCount > this.lastUnderrunCount) {
      const delta = currentUnderrunCount - this.lastUnderrunCount;
      const boostFramesPerUnderrun = latencyMsToFrames(
        streamConfig.target_sample_rate,
        latencySettings.underrunRecoveryBoostMs
      );
      const maxBoostFrames = latencyMsToFrames(streamConfig.target_sample_rate, latencySettings.maxUnderrunBoostMs);
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
    }, RENDER_REFILL_FALLBACK_INTERVAL_MS);
  }

  private stopRefillLoop(): void {
    if (this.refillTimer !== null) {
      window.clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
  }

  private handleWorkletMessage(message: BrowserClockWorkletMessage | null | undefined): void {
    if (!message || message.type !== "need_refill") {
      return;
    }
    this.requestRefill();
  }

  private syncWorkletRefillThreshold(explicitThresholdFrames?: number): void {
    const node = this.audioNode;
    if (!node) {
      return;
    }

    let lowWaterFrames = 0;
    if (typeof explicitThresholdFrames === "number") {
      lowWaterFrames = Math.max(0, Math.round(explicitThresholdFrames));
    } else if (this.streamConfig) {
      const queueTargets = this.currentQueueTargets(this.streamConfig);
      lowWaterFrames = this.startupPrimed ? queueTargets.lowWaterFrames : queueTargets.highWaterFrames;
    }

    node.port.postMessage({
      type: "set_refill_threshold",
      low_water_frames: lowWaterFrames,
    });
  }

  private startTimingReportLoop(): void {
    this.stopTimingReportLoop();
    const intervalMs = Math.max(25, this.streamConfig?.timing_report_interval_ms ?? 100);
    this.timingReportTimer = window.setInterval(() => {
      this.sendTimingReport();
    }, intervalMs);
    this.sendTimingReport();
  }

  private stopTimingReportLoop(): void {
    if (this.timingReportTimer !== null) {
      window.clearInterval(this.timingReportTimer);
      this.timingReportTimer = null;
    }
  }

  private startClockSyncLoop(): void {
    this.stopClockSyncLoop();
    this.requestClockSync();
    this.clockSyncTimer = window.setInterval(() => {
      this.requestClockSync();
    }, CLOCK_SYNC_INTERVAL_MS);
  }

  private stopClockSyncLoop(): void {
    if (this.clockSyncTimer !== null) {
      window.clearInterval(this.clockSyncTimer);
      this.clockSyncTimer = null;
    }
  }

  private requestClockSync(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const requestId = nextRequestId();
    this.pendingClockSyncRequests.add(requestId);
    try {
      this.sendJson({
        type: "clock_sync",
        request_id: requestId,
        client_send_perf_ms: performance.now(),
      } satisfies BrowserClockClockSyncRequest);
    } catch {
      this.pendingClockSyncRequests.delete(requestId);
    }
  }

  private handleClockSyncMessage(message: BrowserClockClockSyncMessage): void {
    if (!this.pendingClockSyncRequests.delete(message.request_id)) {
      return;
    }

    const clientReceivePerfMs = performance.now();
    const clientSendNs = Math.round(message.client_send_perf_ms * 1_000_000.0);
    const clientReceiveNs = Math.round(clientReceivePerfMs * 1_000_000.0);
    const serverReceiveNs = message.server_received_monotonic_ns;
    const serverSendNs = message.server_sent_monotonic_ns;
    const serverProcessingNs = Math.max(0, serverSendNs - serverReceiveNs);
    const roundTripNs = Math.max(0, clientReceiveNs - clientSendNs - serverProcessingNs);
    const estimatedOffsetNs = Math.round(
      ((serverReceiveNs - clientSendNs) + (serverSendNs - clientReceiveNs)) / 2
    );

    this.latestClockSyncOffsetNs = estimatedOffsetNs;
    this.latestClockSyncRttMs = roundTripNs / 1_000_000.0;
    this.lastClockSyncAtPerfMs = clientReceivePerfMs;
  }

  private currentClockSyncMeasurement(): { offsetNs: number | null; rttMs: number | null } {
    if (this.latestClockSyncOffsetNs === null || this.latestClockSyncRttMs === null) {
      return { offsetNs: null, rttMs: null };
    }
    if (performance.now() - this.lastClockSyncAtPerfMs > CLOCK_SYNC_MAX_AGE_MS) {
      return { offsetNs: null, rttMs: null };
    }
    return {
      offsetNs: this.latestClockSyncOffsetNs,
      rttMs: this.latestClockSyncRttMs,
    };
  }

  private sendTimingReport(): void {
    const streamConfig = this.streamConfig;
    const context = this.audioContext;
    if (!streamConfig || !context) {
      return;
    }
    const clockSync = this.currentClockSyncMeasurement();

    try {
      this.sendJson({
        type: "timing_report",
        client_perf_ms: performance.now(),
        audio_context_time_s: context.currentTime,
        queued_frames: this.availableFrames(),
        sample_rate: Math.max(1, Math.round(context.sampleRate)),
        pending_render_frames: this.pendingRenderFrames,
        underrun_count: this.readUnderrunCount(),
        clock_sync_offset_ns: clockSync.offsetNs,
        clock_sync_rtt_ms: clockSync.rttMs,
      } satisfies BrowserClockTimingReportRequest);
    } catch {
      // Ignore timing-report send failures; socket shutdown paths already report fatal errors.
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
    this.stopTimingReportLoop();
    this.stopClockSyncLoop();
    this.pendingChunk = null;
    this.syncWorkletRefillThreshold(0);
    this.resetRenderPipelineState();
    this.resetClockSyncState();
    this.clearPlaybackTimeline();
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
    this.inFlightImmediateRenderRequests = 0;
    this.pendingRenderFrames = 0;
    this.pendingRenderRequests = [];
    this.startupPrimed = false;
    this.underrunBoostFrames = 0;
    this.underrunRecoveryUntil = 0;
    this.lastImmediateRenderAtMs = 0;
  }

  private resetClockSyncState(): void {
    this.pendingClockSyncRequests.clear();
    this.latestClockSyncOffsetNs = null;
    this.latestClockSyncRttMs = null;
    this.lastClockSyncAtPerfMs = 0;
  }

  private requestImmediateNoteRender(): void {
    const streamConfig = this.streamConfig;
    if (!streamConfig) {
      return;
    }

    const latencySettings = this.currentLatencySettings();
    const now = Date.now();
    if (
      this.inFlightImmediateRenderRequests > 0 ||
      now - this.lastImmediateRenderAtMs < latencySettings.immediateRenderCooldownMs
    ) {
      return;
    }

    const requestedBlocks = Math.max(
      1,
      Math.min(streamConfig.max_blocks_per_request, latencySettings.immediateRenderBlocks)
    );
    const estimatedFrames = this.dispatchRenderRequest(streamConfig, requestedBlocks, "interactive");
    if (estimatedFrames === null) {
      return;
    }

    this.inFlightImmediateRenderRequests += 1;
    this.lastImmediateRenderAtMs = now;
  }
}
