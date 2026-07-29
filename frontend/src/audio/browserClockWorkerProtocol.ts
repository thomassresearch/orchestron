import type {
  BrowserClockLatencySettings,
  BrowserClockTransportEvent,
  SessionMidiEventRequest,
  SessionSequencerConfigRequest,
  SessionSequencerStatus
} from "../types";

export const BROWSER_CLOCK_STATE_READ_FRAME = 0;
export const BROWSER_CLOCK_STATE_WRITE_FRAME = 1;
export const BROWSER_CLOCK_STATE_UNDERRUN_COUNT = 2;
export const BROWSER_CLOCK_STATE_REFILL_EPOCH = 3;
export const BROWSER_CLOCK_STATE_PLAYBACK_ENABLED = 4;
export const BROWSER_CLOCK_STATE_OVERRUN_COUNT = 5;
export const BROWSER_CLOCK_STATE_TRANSPORT_SUBUNIT = 6;
export const BROWSER_CLOCK_STATE_TRANSPORT_VERSION = 7;
export const BROWSER_CLOCK_STATE_LENGTH = 8;

export type BrowserClockWorkerSequencerRequest =
  | {
      type: "sequencer_start";
      request_id: string;
      config?: SessionSequencerConfigRequest | null;
      position_step?: number | null;
    }
  | {
      type: "sequencer_stop" | "sequencer_rewind" | "sequencer_forward";
      request_id: string;
    }
  | {
      type: "queue_pad";
      request_id: string;
      track_id: string;
      pad_index: number | null;
    };

export type BrowserClockMainToWorkerMessage =
  | {
      type: "connect";
      sessionId: string;
      websocketUrl: string;
      sampleRate: number;
      channels: number;
      capacityFrames: number;
      sampleBuffer: SharedArrayBuffer;
      stateBuffer: SharedArrayBuffer;
      latencySettings: BrowserClockLatencySettings;
    }
  | { type: "disconnect" }
  | { type: "latency_settings"; latencySettings: BrowserClockLatencySettings }
  | { type: "sequencer_request"; request: BrowserClockWorkerSequencerRequest }
  | { type: "manual_midi"; midi: SessionMidiEventRequest; eventEpochMs: number }
  | { type: "visual_ack" };

export type AudibleBrowserClockTransportEvent = BrowserClockTransportEvent & {
  target_frame: number;
};

export type BrowserClockWorkerDiagnostics = {
  sampleRate: number;
  queuedFrames: number;
  pendingRenderFrames: number;
  underrunCount: number;
  overrunCount: number;
  renderTimeRatio: number | null;
};

export type BrowserClockWorkerToMainMessage =
  | { type: "status"; status: "off" | "connecting" | "primed" | "error"; error?: string | null }
  | { type: "connected"; sessionId: string; sequencerStatus: SessionSequencerStatus }
  | { type: "sequencer_status"; requestId: string; sequencerStatus: SessionSequencerStatus }
  | { type: "audible_events"; events: AudibleBrowserClockTransportEvent[] }
  | { type: "diagnostics"; diagnostics: BrowserClockWorkerDiagnostics }
  | { type: "error"; message: string };
