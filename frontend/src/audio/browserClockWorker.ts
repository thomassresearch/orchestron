/// <reference lib="webworker" />

import type {
  BrowserClockClockSyncMessage,
  BrowserClockLatencySettings,
  BrowserClockRenderChunkMessage,
  BrowserClockServerMessage,
  BrowserClockStreamConfigMessage
} from "../types";
import {
  BROWSER_CLOCK_STATE_LENGTH,
  BROWSER_CLOCK_STATE_OVERRUN_COUNT,
  BROWSER_CLOCK_STATE_PLAYBACK_ENABLED,
  BROWSER_CLOCK_STATE_READ_FRAME,
  BROWSER_CLOCK_STATE_REFILL_EPOCH,
  BROWSER_CLOCK_STATE_TRANSPORT_SUBUNIT,
  BROWSER_CLOCK_STATE_TRANSPORT_VERSION,
  BROWSER_CLOCK_STATE_UNDERRUN_COUNT,
  BROWSER_CLOCK_STATE_WRITE_FRAME,
  type AudibleBrowserClockTransportEvent,
  type BrowserClockMainToWorkerMessage,
  type BrowserClockWorkerDiagnostics,
  type BrowserClockWorkerToMainMessage
} from "./browserClockWorkerProtocol";
import { availableRingFrames, coalesceAudibleTransportEvents, unsignedCounterDistance } from "./browserClockShared";

const CHANNELS = 2;
const REFILL_INTERVAL_MS = 20;
const TIMING_REPORT_INTERVAL_MS = 100;
const CLOCK_SYNC_INTERVAL_MS = 500;
const CLOCK_SYNC_MAX_AGE_MS = 2_000;
const UNDERRUN_RECOVERY_WINDOW_MS = 5_000;
const MAX_READY_VISUAL_EVENTS = 512;

type RenderPriority = "steady" | "interactive";

type PendingRenderRequest = {
  estimatedFrames: number;
  priority: RenderPriority;
  requestId: string;
};

type PendingChunk = {
  metadata: BrowserClockRenderChunkMessage;
  request: PendingRenderRequest;
};

type AbsoluteTimelineSegment = {
  targetFrameStart: number;
  targetFrameEnd: number;
  transportSubunitStart: number;
  transportSubunitEnd: number;
};

function nextRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `worker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isServerMessage(value: unknown): value is BrowserClockServerMessage {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function latencyMsToFrames(sampleRate: number, milliseconds: number): number {
  return Math.round((Math.max(1, sampleRate) * Math.max(0, milliseconds)) / 1000);
}

class BrowserClockWorkerRuntime {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private sampleRate = 48_000;
  private capacityFrames = 0;
  private sampleBuffer: Float32Array | null = null;
  private stateBuffer: Uint32Array | null = null;
  private latencySettings: BrowserClockLatencySettings | null = null;
  private streamConfig: BrowserClockStreamConfigMessage | null = null;
  private pendingChunk: PendingChunk | null = null;
  private pendingRequests: PendingRenderRequest[] = [];
  private inFlightRequests = 0;
  private inFlightInteractiveRequests = 0;
  private pendingRenderFrames = 0;
  private startupPrimed = false;
  private lastUnderrunCount = 0;
  private underrunBoostFrames = 0;
  private underrunRecoveryUntil = 0;
  private refillTimer: number | null = null;
  private timingTimer: number | null = null;
  private clockSyncTimer: number | null = null;
  private diagnosticTimer: number | null = null;
  private lastRefillEpoch = 0;
  private writeFrameTotal = 0;
  private readFrameTotal = 0;
  private lastReadCounter = 0;
  private timeline: AbsoluteTimelineSegment[] = [];
  private pendingAudibleEvents: AudibleBrowserClockTransportEvent[] = [];
  private readyVisualEvents: AudibleBrowserClockTransportEvent[] = [];
  private visualUpdateInFlight = false;
  private pendingClockSync = new Set<string>();
  private latestClockOffsetNs: number | null = null;
  private latestClockRttMs: number | null = null;
  private latestClockSyncAt = 0;
  private lastImmediateRenderAt = 0;
  private latestRenderTimeRatio: number | null = null;

  handleMessage(message: BrowserClockMainToWorkerMessage): void {
    switch (message.type) {
      case "connect":
        this.connect(message);
        return;
      case "disconnect":
        this.disconnect(true);
        return;
      case "latency_settings":
        this.latencySettings = message.latencySettings;
        this.sendClaim();
        this.requestRefill();
        return;
      case "sequencer_request":
        this.sendJson(message.request);
        return;
      case "manual_midi":
        this.sendJson({
          type: "manual_midi",
          midi: message.midi,
          event_perf_ms: message.eventPerfMs
        });
        if (message.midi.type === "note_on") {
          this.requestImmediateRender();
        }
        return;
      case "visual_ack":
        this.visualUpdateInFlight = false;
        this.flushVisualEvents();
    }
  }

  private connect(message: Extract<BrowserClockMainToWorkerMessage, { type: "connect" }>): void {
    this.disconnect(false);
    if (message.channels !== CHANNELS) {
      this.fail(`Expected ${CHANNELS} browser audio channels.`);
      return;
    }
    const stateBuffer = new Uint32Array(message.stateBuffer);
    if (stateBuffer.length < BROWSER_CLOCK_STATE_LENGTH) {
      this.fail("Browser-clock shared state buffer is too small.");
      return;
    }

    this.sessionId = message.sessionId;
    this.sampleRate = Math.max(1, Math.round(message.sampleRate));
    this.capacityFrames = Math.max(1, Math.round(message.capacityFrames));
    this.sampleBuffer = new Float32Array(message.sampleBuffer);
    this.stateBuffer = stateBuffer;
    this.latencySettings = message.latencySettings;
    this.resetPipeline();
    this.post({ type: "status", status: "connecting", error: null });

    const socket = new WebSocket(message.websocketUrl);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => this.sendClaim();
    socket.onmessage = (event) => this.handleSocketPayload(socket, event.data);
    socket.onerror = () => this.fail("Browser-clock websocket error.");
    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.sessionId !== null) {
        this.fail(event.reason?.trim() || "Browser-clock connection closed.");
      }
    };
  }

  private disconnect(notify: boolean): void {
    this.stopTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "release_controller" }));
      } catch {
        // Best-effort release.
      }
    }
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "worker_disconnect");
    }
    this.sessionId = null;
    this.streamConfig = null;
    this.resetPipeline();
    if (notify) {
      this.post({ type: "status", status: "off", error: null });
    }
  }

  private resetPipeline(): void {
    if (this.stateBuffer) {
      for (let index = 0; index < BROWSER_CLOCK_STATE_LENGTH; index += 1) {
        Atomics.store(this.stateBuffer, index, 0);
      }
    }
    this.pendingChunk = null;
    this.pendingRequests = [];
    this.inFlightRequests = 0;
    this.inFlightInteractiveRequests = 0;
    this.pendingRenderFrames = 0;
    this.startupPrimed = false;
    this.lastUnderrunCount = 0;
    this.underrunBoostFrames = 0;
    this.underrunRecoveryUntil = 0;
    this.lastRefillEpoch = 0;
    this.writeFrameTotal = 0;
    this.readFrameTotal = 0;
    this.lastReadCounter = 0;
    this.timeline = [];
    this.pendingAudibleEvents = [];
    this.readyVisualEvents = [];
    this.visualUpdateInFlight = false;
    this.pendingClockSync.clear();
    this.latestClockOffsetNs = null;
    this.latestClockRttMs = null;
    this.latestClockSyncAt = 0;
    this.lastImmediateRenderAt = 0;
    this.latestRenderTimeRatio = null;
  }

  private sendClaim(): void {
    if (!this.latencySettings || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const targets = this.claimTargets();
    this.sendJson({
      type: "claim_controller",
      audio_context_sample_rate: this.sampleRate,
      queue_low_water_frames: targets.low,
      queue_high_water_frames: targets.high,
      max_blocks_per_request: this.latencySettings.maxBlocksPerRequest
    });
  }

  private handleSocketPayload(socket: WebSocket, payload: string | ArrayBuffer | Blob): void {
    if (this.socket !== socket) {
      return;
    }
    if (typeof payload === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        this.fail("Browser-clock server sent invalid JSON.");
        return;
      }
      if (!isServerMessage(parsed)) {
        this.fail("Browser-clock server sent an unsupported message.");
        return;
      }
      this.handleServerMessage(parsed);
      return;
    }
    if (payload instanceof Blob) {
      void payload.arrayBuffer().then((buffer) => this.handlePcm(buffer)).catch(() => this.fail("Failed to decode PCM."));
      return;
    }
    this.handlePcm(payload);
  }

  private handleServerMessage(message: BrowserClockServerMessage): void {
    switch (message.type) {
      case "stream_config":
        this.streamConfig = message;
        this.lastUnderrunCount = this.underrunCount();
        Atomics.store(
          this.requireState(),
          BROWSER_CLOCK_STATE_TRANSPORT_SUBUNIT,
          Math.max(0, Math.floor(message.sequencer_status.transport_subunit)) >>> 0
        );
        this.post({
          type: "connected",
          sessionId: this.sessionId ?? "",
          sequencerStatus: message.sequencer_status
        });
        this.startTimers();
        this.requestRefill();
        return;
      case "render_chunk": {
        const fallback: PendingRenderRequest = {
          estimatedFrames: message.target_frame_count,
          priority: "steady",
          requestId: message.telemetry.request_id ?? nextRequestId()
        };
        this.pendingChunk = { metadata: message, request: this.pendingRequests.shift() ?? fallback };
        return;
      }
      case "sequencer_status":
        this.post({
          type: "sequencer_status",
          requestId: message.request_id,
          sequencerStatus: message.sequencer_status
        });
        return;
      case "clock_sync":
        this.handleClockSync(message);
        return;
      case "controller_revoked":
        this.fail(message.reason);
        return;
      case "engine_error":
        this.fail(message.detail);
    }
  }

  private handlePcm(buffer: ArrayBuffer): void {
    const pending = this.pendingChunk;
    this.pendingChunk = null;
    if (!pending) {
      this.fail("Received PCM without matching metadata.");
      return;
    }
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    this.pendingRenderFrames = Math.max(0, this.pendingRenderFrames - pending.request.estimatedFrames);
    if (pending.request.priority === "interactive") {
      this.inFlightInteractiveRequests = Math.max(0, this.inFlightInteractiveRequests - 1);
    }
    try {
      this.enqueueChunk(pending.metadata, buffer);
      this.requestRefill();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Failed to buffer browser-clock PCM.");
    }
  }

  private enqueueChunk(metadata: BrowserClockRenderChunkMessage, buffer: ArrayBuffer): void {
    if (metadata.channels !== CHANNELS) {
      throw new Error(`Expected ${CHANNELS} channels, received ${metadata.channels}.`);
    }
    const samples = new Float32Array(buffer);
    if (samples.length !== metadata.target_frame_count * CHANNELS) {
      throw new Error("PCM payload length does not match render metadata.");
    }
    const state = this.requireState();
    const sampleBuffer = this.requireSamples();
    const available = this.availableFrames();
    const free = this.capacityFrames - available;
    if (metadata.target_frame_count > free) {
      Atomics.add(state, BROWSER_CLOCK_STATE_OVERRUN_COUNT, 1);
      throw new Error("Browser-clock ring buffer overflowed.");
    }

    const writeCounter = Atomics.load(state, BROWSER_CLOCK_STATE_WRITE_FRAME) >>> 0;
    const writeOffset = writeCounter % this.capacityFrames;
    const firstFrames = Math.min(metadata.target_frame_count, this.capacityFrames - writeOffset);
    const firstSamples = firstFrames * CHANNELS;
    sampleBuffer.set(samples.subarray(0, firstSamples), writeOffset * CHANNELS);
    if (firstFrames < metadata.target_frame_count) {
      sampleBuffer.set(samples.subarray(firstSamples), 0);
    }

    const absoluteWriteStart = this.writeFrameTotal;
    this.writeFrameTotal += metadata.target_frame_count;
    Atomics.store(
      state,
      BROWSER_CLOCK_STATE_WRITE_FRAME,
      (writeCounter + metadata.target_frame_count) >>> 0
    );

    for (const segment of metadata.timeline_segments ?? []) {
      const start = Math.max(0, Math.min(metadata.target_frame_count, Math.round(segment.target_frame_start)));
      const end = Math.max(start, Math.min(metadata.target_frame_count, Math.round(segment.target_frame_end)));
      if (end <= start) {
        continue;
      }
      this.timeline.push({
        targetFrameStart: absoluteWriteStart + start,
        targetFrameEnd: absoluteWriteStart + end,
        transportSubunitStart: segment.transport_subunit_start,
        transportSubunitEnd: segment.transport_subunit_end
      });
    }
    for (const event of metadata.transport_events ?? []) {
      this.pendingAudibleEvents.push({
        ...event,
        target_frame: absoluteWriteStart + Math.max(0, Math.round(event.target_frame_offset))
      });
    }
    const chunkDurationMs = (metadata.target_frame_count / Math.max(1, metadata.target_sample_rate)) * 1000;
    this.latestRenderTimeRatio =
      chunkDurationMs > 0 ? metadata.telemetry.render_service_time_ms / chunkDurationMs : null;

    const startupHigh = this.claimTargets().high;
    if (!this.startupPrimed && this.availableFrames() >= startupHigh) {
      this.startupPrimed = true;
      Atomics.store(state, BROWSER_CLOCK_STATE_PLAYBACK_ENABLED, 1);
      this.post({ type: "status", status: "primed", error: null });
    }
  }

  private requestRefill(): void {
    const stream = this.streamConfig;
    const settings = this.latencySettings;
    if (!stream || !settings || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.observeUnderruns();
    const targets = this.queueTargets();
    let projected = this.availableFrames() + this.pendingRenderFrames;
    const threshold = this.startupPrimed ? targets.low : targets.high;
    if (projected >= threshold) {
      return;
    }
    const framesPerBlock = Math.max(
      1,
      Math.round((stream.ksmps * stream.target_sample_rate) / stream.engine_sample_rate)
    );
    while (projected < targets.high && this.inFlightRequests < targets.parallel) {
      const freeProjected = Math.max(0, this.capacityFrames - projected);
      if (freeProjected < framesPerBlock) {
        return;
      }
      const deficit = Math.max(1, Math.min(targets.high - projected, freeProjected));
      const blocks = Math.max(
        1,
        Math.min(
          stream.max_blocks_per_request,
          settings.maxBlocksPerRequest,
          Math.ceil(deficit / framesPerBlock)
        )
      );
      const estimated = this.dispatchRender(blocks, "steady");
      if (estimated === null) {
        return;
      }
      projected += estimated;
    }
  }

  private requestImmediateRender(): void {
    const stream = this.streamConfig;
    const settings = this.latencySettings;
    if (!stream || !settings || this.inFlightInteractiveRequests > 0) {
      return;
    }
    const now = Date.now();
    if (now - this.lastImmediateRenderAt < settings.immediateRenderCooldownMs) {
      return;
    }
    const framesPerBlock = Math.max(1, Math.round((stream.ksmps * stream.target_sample_rate) / stream.engine_sample_rate));
    const freeProjected = this.capacityFrames - this.availableFrames() - this.pendingRenderFrames;
    const blocks = Math.max(
      0,
      Math.min(
        stream.max_blocks_per_request,
        settings.immediateRenderBlocks,
        Math.floor(freeProjected / framesPerBlock)
      )
    );
    if (blocks < 1) {
      return;
    }
    if (this.dispatchRender(blocks, "interactive") !== null) {
      this.inFlightInteractiveRequests += 1;
      this.lastImmediateRenderAt = now;
    }
  }

  private dispatchRender(blockCount: number, priority: RenderPriority): number | null {
    const stream = this.streamConfig;
    if (!stream) {
      return null;
    }
    const requestId = nextRequestId();
    const estimatedFrames = blockCount * Math.max(
      1,
      Math.round((stream.ksmps * stream.target_sample_rate) / stream.engine_sample_rate)
    );
    try {
      this.sendJson({
        type: "request_render",
        block_count: blockCount,
        request_id: requestId,
        client_perf_ms: performance.now(),
        priority
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Failed to request browser-clock audio.");
      return null;
    }
    this.inFlightRequests += 1;
    this.pendingRenderFrames += estimatedFrames;
    this.pendingRequests.push({ estimatedFrames, priority, requestId });
    return estimatedFrames;
  }

  private startTimers(): void {
    this.stopTimers();
    this.refillTimer = self.setInterval(() => this.tick(), REFILL_INTERVAL_MS);
    this.timingTimer = self.setInterval(() => this.sendTimingReport(), TIMING_REPORT_INTERVAL_MS);
    this.clockSyncTimer = self.setInterval(() => this.requestClockSync(), CLOCK_SYNC_INTERVAL_MS);
    this.diagnosticTimer = self.setInterval(() => this.sendDiagnostics(), 500);
    this.requestClockSync();
  }

  private stopTimers(): void {
    for (const timer of [this.refillTimer, this.timingTimer, this.clockSyncTimer, this.diagnosticTimer]) {
      if (timer !== null) {
        self.clearInterval(timer);
      }
    }
    this.refillTimer = null;
    this.timingTimer = null;
    this.clockSyncTimer = null;
    this.diagnosticTimer = null;
  }

  private tick(): void {
    const state = this.stateBuffer;
    if (!state) {
      return;
    }
    const refillEpoch = Atomics.load(state, BROWSER_CLOCK_STATE_REFILL_EPOCH) >>> 0;
    if (refillEpoch !== this.lastRefillEpoch) {
      this.lastRefillEpoch = refillEpoch;
    }
    this.updateReadFrameTotal();
    this.updatePlaybackTransport();
    this.drainAudibleEvents();
    this.requestRefill();
  }

  private updateReadFrameTotal(): void {
    const current = Atomics.load(this.requireState(), BROWSER_CLOCK_STATE_READ_FRAME) >>> 0;
    const delta = unsignedCounterDistance(current, this.lastReadCounter);
    if (delta <= this.capacityFrames) {
      this.readFrameTotal += delta;
    }
    this.lastReadCounter = current;
  }

  private updatePlaybackTransport(): void {
    while (this.timeline.length > 0 && this.readFrameTotal >= this.timeline[0].targetFrameEnd) {
      const consumed = this.timeline.shift();
      if (consumed) {
        Atomics.store(
          this.requireState(),
          BROWSER_CLOCK_STATE_TRANSPORT_SUBUNIT,
          Math.max(0, Math.floor(consumed.transportSubunitEnd)) >>> 0
        );
      }
    }
    const segment = this.timeline[0];
    if (!segment) {
      return;
    }
    const span = Math.max(1, segment.targetFrameEnd - segment.targetFrameStart);
    const progress = Math.max(0, Math.min(1, (this.readFrameTotal - segment.targetFrameStart) / span));
    const transport = segment.transportSubunitStart + progress * (segment.transportSubunitEnd - segment.transportSubunitStart);
    Atomics.store(
      this.requireState(),
      BROWSER_CLOCK_STATE_TRANSPORT_SUBUNIT,
      Math.max(0, Math.floor(transport)) >>> 0
    );
    Atomics.add(this.requireState(), BROWSER_CLOCK_STATE_TRANSPORT_VERSION, 1);
  }

  private drainAudibleEvents(): void {
    while (this.pendingAudibleEvents.length > 0 && this.pendingAudibleEvents[0].target_frame <= this.readFrameTotal + 1) {
      const event = this.pendingAudibleEvents.shift();
      if (event) {
        this.readyVisualEvents.push(event);
      }
    }
    if (this.readyVisualEvents.length > MAX_READY_VISUAL_EVENTS) {
      this.readyVisualEvents = coalesceAudibleTransportEvents(this.readyVisualEvents).slice(
        -MAX_READY_VISUAL_EVENTS
      );
    }
    this.flushVisualEvents();
  }

  private flushVisualEvents(): void {
    if (this.visualUpdateInFlight || this.readyVisualEvents.length === 0) {
      return;
    }
    const events = this.readyVisualEvents;
    this.readyVisualEvents = [];
    const delivered = coalesceAudibleTransportEvents(events);
    this.visualUpdateInFlight = true;
    this.post({ type: "audible_events", events: delivered });
  }

  private sendTimingReport(): void {
    if (!this.streamConfig) {
      return;
    }
    const syncFresh = performance.now() - this.latestClockSyncAt <= CLOCK_SYNC_MAX_AGE_MS;
    this.sendJson({
      type: "timing_report",
      client_perf_ms: performance.now(),
      audio_context_time_s: this.readFrameTotal / Math.max(1, this.sampleRate),
      queued_frames: this.availableFrames(),
      sample_rate: this.sampleRate,
      pending_render_frames: this.pendingRenderFrames,
      underrun_count: this.underrunCount(),
      clock_sync_offset_ns: syncFresh ? this.latestClockOffsetNs : null,
      clock_sync_rtt_ms: syncFresh ? this.latestClockRttMs : null
    });
  }

  private requestClockSync(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const requestId = nextRequestId();
    this.pendingClockSync.add(requestId);
    this.sendJson({
      type: "clock_sync",
      request_id: requestId,
      client_send_perf_ms: performance.now()
    });
  }

  private handleClockSync(message: BrowserClockClockSyncMessage): void {
    if (!this.pendingClockSync.delete(message.request_id)) {
      return;
    }
    const receiveMs = performance.now();
    const clientSendNs = Math.round(message.client_send_perf_ms * 1_000_000);
    const clientReceiveNs = Math.round(receiveMs * 1_000_000);
    const processingNs = Math.max(0, message.server_sent_monotonic_ns - message.server_received_monotonic_ns);
    const roundTripNs = Math.max(0, clientReceiveNs - clientSendNs - processingNs);
    this.latestClockOffsetNs = Math.round(
      ((message.server_received_monotonic_ns - clientSendNs) +
        (message.server_sent_monotonic_ns - clientReceiveNs)) /
        2
    );
    this.latestClockRttMs = roundTripNs / 1_000_000;
    this.latestClockSyncAt = receiveMs;
  }

  private sendDiagnostics(): void {
    const diagnostics: BrowserClockWorkerDiagnostics = {
      sampleRate: this.sampleRate,
      queuedFrames: this.availableFrames(),
      pendingRenderFrames: this.pendingRenderFrames,
      underrunCount: this.underrunCount(),
      overrunCount: this.stateBuffer
        ? Atomics.load(this.stateBuffer, BROWSER_CLOCK_STATE_OVERRUN_COUNT) >>> 0
        : 0,
      renderTimeRatio: this.latestRenderTimeRatio
    };
    this.post({ type: "diagnostics", diagnostics });
  }

  private observeUnderruns(): void {
    const settings = this.latencySettings;
    if (!settings) {
      return;
    }
    const current = this.underrunCount();
    if (current > this.lastUnderrunCount) {
      const delta = current - this.lastUnderrunCount;
      const perUnderrun = latencyMsToFrames(this.sampleRate, settings.underrunRecoveryBoostMs);
      const maximum = latencyMsToFrames(this.sampleRate, settings.maxUnderrunBoostMs);
      this.underrunBoostFrames = Math.min(maximum, this.underrunBoostFrames + delta * perUnderrun);
      this.underrunRecoveryUntil = Date.now() + UNDERRUN_RECOVERY_WINDOW_MS;
      this.lastUnderrunCount = current;
      return;
    }
    if (this.underrunBoostFrames > 0 && Date.now() >= this.underrunRecoveryUntil) {
      this.underrunBoostFrames = 0;
    }
  }

  private claimTargets(): { low: number; high: number } {
    const settings = this.requireSettings();
    const low = this.clampFrames(latencyMsToFrames(this.sampleRate, settings.startupLowWaterMs));
    const high = this.clampFrames(Math.max(low + 2048, latencyMsToFrames(this.sampleRate, settings.startupHighWaterMs)));
    return { low, high };
  }

  private queueTargets(): { low: number; high: number; parallel: number } {
    const settings = this.requireSettings();
    if (!this.startupPrimed) {
      const startup = this.claimTargets();
      return {
        low: this.clampFrames(startup.low + this.underrunBoostFrames),
        high: this.clampFrames(startup.high + this.underrunBoostFrames),
        parallel: this.underrunBoostFrames > 0
          ? settings.recoveryMaxParallelRequests
          : settings.startupMaxParallelRequests
      };
    }
    const low = this.clampFrames(
      latencyMsToFrames(this.sampleRate, settings.steadyLowWaterMs) + this.underrunBoostFrames
    );
    const high = this.clampFrames(
      Math.max(low + 1024, latencyMsToFrames(this.sampleRate, settings.steadyHighWaterMs) + this.underrunBoostFrames)
    );
    return {
      low,
      high,
      parallel: this.underrunBoostFrames > 0
        ? settings.recoveryMaxParallelRequests
        : settings.steadyMaxParallelRequests
    };
  }

  private clampFrames(frames: number): number {
    return Math.max(1024, Math.min(Math.max(1024, this.capacityFrames - 4096), Math.round(frames)));
  }

  private availableFrames(): number {
    if (!this.stateBuffer) {
      return 0;
    }
    const read = Atomics.load(this.stateBuffer, BROWSER_CLOCK_STATE_READ_FRAME) >>> 0;
    const write = Atomics.load(this.stateBuffer, BROWSER_CLOCK_STATE_WRITE_FRAME) >>> 0;
    return availableRingFrames(read, write, this.capacityFrames);
  }

  private underrunCount(): number {
    return this.stateBuffer
      ? Atomics.load(this.stateBuffer, BROWSER_CLOCK_STATE_UNDERRUN_COUNT) >>> 0
      : 0;
  }

  private sendJson(payload: object): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Browser-clock controller socket is not connected.");
    }
    this.socket.send(JSON.stringify(payload));
  }

  private fail(message: string): void {
    // Tear down the socket before reporting the failure.  Clearing sessionId
    // first also prevents the resulting close event from recursively failing.
    this.disconnect(false);
    this.post({ type: "error", message });
    this.post({ type: "status", status: "error", error: message });
  }

  private post(message: BrowserClockWorkerToMainMessage): void {
    self.postMessage(message);
  }

  private requireState(): Uint32Array {
    if (!this.stateBuffer) {
      throw new Error("Browser-clock state buffer is not initialized.");
    }
    return this.stateBuffer;
  }

  private requireSamples(): Float32Array {
    if (!this.sampleBuffer) {
      throw new Error("Browser-clock sample buffer is not initialized.");
    }
    return this.sampleBuffer;
  }

  private requireSettings(): BrowserClockLatencySettings {
    if (!this.latencySettings) {
      throw new Error("Browser-clock latency settings are not initialized.");
    }
    return this.latencySettings;
  }
}

const runtime = new BrowserClockWorkerRuntime();

self.onmessage = (event: MessageEvent<BrowserClockMainToWorkerMessage>) => {
  runtime.handleMessage(event.data);
};
