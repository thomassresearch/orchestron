import type {
  AppStateResponse,
  CompileResponse,
  MidiInputRef,
  OpcodeSpec,
  Patch,
  PatchGraph,
  PatchListItem,
  Performance,
  PerformanceListItem,
  PersistedAppState,
  SequencerConfigSnapshot,
  SessionActionResponse,
  SessionCreateResponse,
  SessionSequencerConfigRequest,
  SessionSequencerQueuePadRequest,
  SessionSequencerStartRequest,
  SessionSequencerStatus,
  SessionMidiEventRequest,
  SessionInfo
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status} ${response.statusText}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  listOpcodes: () => request<OpcodeSpec[]>("/opcodes"),
  getAppState: () => request<AppStateResponse>("/app-state"),
  saveAppState: (state: PersistedAppState) =>
    request<AppStateResponse>("/app-state", {
      method: "PUT",
      body: JSON.stringify({ state })
    }),
  listPatches: () => request<PatchListItem[]>("/patches"),
  listPerformances: () => request<PerformanceListItem[]>("/performances"),
  getPatch: (patchId: string) => request<Patch>(`/patches/${patchId}`),
  getPerformance: (performanceId: string) => request<Performance>(`/performances/${performanceId}`),
  createPatch: (payload: {
    name: string;
    description: string;
    schema_version: number;
    graph: PatchGraph;
  }) => request<Patch>("/patches", { method: "POST", body: JSON.stringify(payload) }),
  createPerformance: (payload: { name: string; description: string; config: SequencerConfigSnapshot }) =>
    request<Performance>("/performances", { method: "POST", body: JSON.stringify(payload) }),
  updatePatch: (
    patchId: string,
    payload: {
      name?: string;
      description?: string;
      schema_version?: number;
      graph?: PatchGraph;
    }
  ) => request<Patch>(`/patches/${patchId}`, { method: "PUT", body: JSON.stringify(payload) }),
  updatePerformance: (
    performanceId: string,
    payload: { name?: string; description?: string; config?: SequencerConfigSnapshot }
  ) => request<Performance>(`/performances/${performanceId}`, { method: "PUT", body: JSON.stringify(payload) }),
  createSession: (instruments: Array<{ patch_id: string; midi_channel: number }>) =>
    request<SessionCreateResponse>("/sessions", {
      method: "POST",
      body: JSON.stringify({ instruments })
    }),
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
      body: JSON.stringify(payload)
    }),
  startSessionSequencer: (sessionId: string, payload: SessionSequencerStartRequest) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/start`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  stopSessionSequencer: (sessionId: string) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/stop`, { method: "POST" }),
  getSessionSequencerStatus: (sessionId: string) =>
    request<SessionSequencerStatus>(`/sessions/${sessionId}/sequencer/status`),
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
