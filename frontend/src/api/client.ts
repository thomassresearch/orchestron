import { withLaneOutput } from "../lib/laneOutput";
import type { InstrumentType } from "../types";
import type { SessionInstrumentAssignment } from "../types";
import type { AudioGraph, MixerState, MixerResponse } from "../types";
import type {
  AppStateResponse,
  CompileResponse,
  GenAudioAssetUploadResponse,
  MidiInputRef,
  OpcodeSpec,
  Patch,
  PatchGraph,
  PatchListItem,
  Performance,
  PerformanceListItem,
  PersistedAppState,
  RuntimeConfigResponse,
  SequencerConfigSnapshot,
  SessionActionResponse,
  SessionArpeggiatorConfigRequest,
  SessionArpeggiatorStatus,
  SessionCreateResponse,
  SessionSequencerConfigRequest,
  SessionSequencerQueuePadRequest,
  SessionAuditionRequest,
  SessionSequencerStartRequest,
  SessionSequencerSeekRequest,
  SessionSequencerStatus,
  SessionMidiEventRequest,
  SessionInfo
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`API ${status} ${statusText}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

async function request<T>(path: string, init?: RequestInit, discardResponse = false): Promise<T> {
  const providedHeaders = new Headers(init?.headers ?? {});
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isFormDataBody && !providedHeaders.has("Content-Type")) {
    providedHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: providedHeaders
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, response.statusText, text);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (discardResponse) {
    await response.body?.cancel();
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function requestBlob(path: string, init?: RequestInit): Promise<{ blob: Blob; headers: Headers }> {
  const providedHeaders = new Headers(init?.headers ?? {});
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isFormDataBody && init?.body && !providedHeaders.has("Content-Type")) {
    providedHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: providedHeaders
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, response.statusText, text);
  }

  return { blob: await response.blob(), headers: response.headers };
}

export const api = {
  repairPerformanceMaster: (config: SequencerConfigSnapshot) => request<SequencerConfigSnapshot>("/performances/repair-master", { method: "POST", body: JSON.stringify({ config }) }),
  listOpcodes: () => request<OpcodeSpec[]>("/opcodes"),
  exportPatchBundle: (payload: Record<string, unknown>) =>
    requestBlob("/bundles/export/patch", { method: "POST", body: JSON.stringify(payload) }),
  exportPerformanceBundle: (payload: Record<string, unknown>) =>
    requestBlob("/bundles/export/performance", { method: "POST", body: JSON.stringify(payload) }),
  exportPerformanceCsdBundle: (payload: Record<string, unknown>) =>
    requestBlob("/bundles/export/performance-csd", { method: "POST", body: JSON.stringify(payload) }),
  expandImportBundle: async (file: File) => {
    const response = await fetch(`${API_BASE}/bundles/import/expand`, {
      method: "POST",
      headers: {
        "X-File-Name": file.name,
        "Content-Type": file.type && file.type.trim().length > 0 ? file.type : "application/octet-stream"
      },
      body: file
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(response.status, response.statusText, text);
    }

    return (await response.json()) as unknown;
  },
  uploadGenAudioAsset: async (file: File) => {
    const response = await fetch(`${API_BASE}/assets/gen-audio`, {
      method: "POST",
      headers: {
        "X-File-Name": file.name,
        "Content-Type": file.type && file.type.trim().length > 0 ? file.type : "application/octet-stream"
      },
      body: file
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(response.status, response.statusText, text);
    }

    return (await response.json()) as GenAudioAssetUploadResponse;
  },
  getRuntimeConfig: () => request<RuntimeConfigResponse>("/runtime-config"),
  getAppState: () => request<AppStateResponse>("/app-state"),
  saveAppState: (state: PersistedAppState) =>
    request<void>("/app-state", {
      method: "PUT",
      body: JSON.stringify({ state })
    }, true),
  listPatches: () => request<PatchListItem[]>("/patches"),
  listPerformances: () => request<PerformanceListItem[]>("/performances"),
  getPatch: (patchId: string) => request<Patch>(`/patches/${patchId}`),
  getPerformance: (performanceId: string) => request<Performance>(`/performances/${performanceId}`),
  createPatch: (payload: {
    name: string;
    description: string;
    is_template: boolean;
    always_on: boolean;
    instrument_type: InstrumentType;
    schema_version: number;
    graph: PatchGraph;
  }) => request<Patch>("/patches", { method: "POST", body: JSON.stringify(payload) }),
  deletePatch: (patchId: string) => request<void>(`/patches/${patchId}`, { method: "DELETE" }),
  createPerformance: (payload: { name: string; description: string; config: SequencerConfigSnapshot }) =>
    request<Performance>("/performances", { method: "POST", body: JSON.stringify(payload) }),
  deletePerformance: (performanceId: string) => request<void>(`/performances/${performanceId}`, { method: "DELETE" }),
  updatePatch: (
    patchId: string,
    payload: {
      name?: string;
      description?: string;
      is_template?: boolean;
      always_on?: boolean;
      instrument_type?: InstrumentType;
      schema_version?: number;
      graph?: PatchGraph;
    }
  ) => request<Patch>(`/patches/${patchId}`, { method: "PUT", body: JSON.stringify(payload) }),
  updatePerformance: (
    performanceId: string,
    payload: { name?: string; description?: string; config?: SequencerConfigSnapshot }
  ) => request<Performance>(`/performances/${performanceId}`, { method: "PUT", body: JSON.stringify(payload) }),
  createSession: (
    instruments: Array<{
      id?: string;
      patch_id: string;
      midi_channel: number;
      performance_controller_values?: Record<string, number>;
      effect_source_ids?: string[];
      effect_routes?: Array<{ source_id: string; channel: string }>;
    }>, audio_graph?: AudioGraph, mixer?: MixerState
  ) =>
    request<SessionCreateResponse>("/sessions", {
      method: "POST",
      body: JSON.stringify({ instruments, audio_graph, mixer })
    }),
  createPreview: (payload: { patches: Patch[]; session: { instruments: SessionInstrumentAssignment[]; audio_graph: AudioGraph; mixer: MixerState } }) => request<SessionCreateResponse>("/sessions/preview", { method: "POST", body: JSON.stringify(payload) }),
  updatePerformanceControllers: (id: string, assignmentId: string, values: Record<string, number>) =>
    request<{ values: Record<string, number> }>(`/sessions/${encodeURIComponent(id)}/instruments/${encodeURIComponent(assignmentId)}/performance-controllers`, { method: "PUT", body: JSON.stringify({ values }) }),
  getMixer: (id: string) => request<MixerResponse>(`/sessions/${id}/mixer`),
  updateMixer: (id: string, mixer: MixerState, revision?: number) => request<MixerResponse>(`/sessions/${id}/mixer`, { method: "PUT", body: JSON.stringify({ ...mixer, revision }) }),
  validateAudio: (instruments: SessionInstrumentAssignment[], audio_graph: AudioGraph, mixer: MixerState) => request<{ diagnostics: import("../types").AudioDiagnostic[] }>("/sessions/validate-instruments", { method: "POST", body: JSON.stringify({ instruments, audio_graph, mixer }) }),
  getSession: (sessionId: string) => request<SessionInfo>(`/sessions/${sessionId}`),
  compileSession: (sessionId: string) =>
    request<CompileResponse>(`/sessions/${sessionId}/compile`, { method: "POST" }),
  startSession: (sessionId: string) =>
    request<SessionActionResponse>(`/sessions/${sessionId}/start`, { method: "POST" }),
  stopSession: (sessionId: string) =>
    request<SessionActionResponse>(`/sessions/${sessionId}/stop`, { method: "POST" }),
  panicSession: (sessionId: string) =>
    request<SessionActionResponse>(`/sessions/${sessionId}/panic`, { method: "POST" }),
  sendSessionMidiEvent: (sessionId: string, payload: SessionMidiEventRequest) =>
    request<SessionActionResponse>(`/sessions/${sessionId}/midi-event`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  configureSessionSequencer: (sessionId: string, payload: SessionSequencerConfigRequest) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/config`, {
      method: "PUT",
      body: JSON.stringify(withLaneOutput(payload))
    }),
  commandArpeggiator: (sessionId: string, arpeggiatorId: string, payload: import("../types").ArpeggiatorCommand) =>
    request<SessionArpeggiatorStatus[]>(`/sessions/${sessionId}/arpeggiators/${arpeggiatorId}/command`, {
      method: "POST", body: JSON.stringify(payload)
    }),
  setArrangerActive: (sessionId: string, active: boolean) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/arranger`, {
      method: "PUT", body: JSON.stringify({ active })
    }),
  configureSessionArpeggiators: (sessionId: string, payload: SessionArpeggiatorConfigRequest) =>
    request<SessionArpeggiatorStatus[]>(`/sessions/${sessionId}/arpeggiators/config`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  startSessionSequencer: (sessionId: string, payload: SessionSequencerStartRequest) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/start`, {
      method: "POST",
      body: JSON.stringify({ ...payload, config: payload.config ? withLaneOutput(payload.config) : payload.config })
    }),
  stopSessionSequencer: (sessionId: string) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/stop`, { method: "POST" }),
  getSessionSequencerStatus: (sessionId: string) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/status`),
  seekSessionSequencer: (sessionId: string, payload: SessionSequencerSeekRequest) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/seek`, {
      method: "POST",
      body: JSON.stringify({ ...payload, config: payload.config ? withLaneOutput(payload.config) : payload.config })
    }),
  rewindSessionSequencerCycle: (sessionId: string) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/rewind`, { method: "POST" }),
  forwardSessionSequencerCycle: (sessionId: string) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/forward`, { method: "POST" }),
  setLaneOutput: (sessionId: string, payload: import("../types").SessionLaneOutputRequest) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/lane-output`, { method: "PUT", body: JSON.stringify(payload) }),
  auditionSequence: (sessionId: string, payload: SessionAuditionRequest) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/audition`, { method: "POST", body: JSON.stringify(payload) }),
  queueSessionSequencerPad: (sessionId: string, trackId: string, payload: SessionSequencerQueuePadRequest) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/tracks/${trackId}/queue-pad`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  bindMidiInput: (sessionId: string, midiInput: string) =>
    request<SessionInfo>(`/sessions/${sessionId}/midi-input`, {
      method: "PUT",
      body: JSON.stringify({ midi_input: midiInput })
    }),
  deleteSession: (sessionId: string) => request<void>(`/sessions/${sessionId}`, { method: "DELETE" }),
  listMidiInputs: () => request<MidiInputRef[]>("/midi/inputs")
};

export function wsBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_BASE as string | undefined;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  return "ws://localhost:8000";
}
