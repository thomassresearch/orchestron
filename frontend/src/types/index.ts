export type SignalType = "a" | "k" | "i" | "S" | "f";
export type AppPage = "instrument" | "sequencer";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface PortSpec {
  id: string;
  name: string;
  signal_type: SignalType;
  required: boolean;
  default?: string | number | null;
  description: string;
}

export interface OpcodeSpec {
  name: string;
  category: string;
  description: string;
  icon: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  template: string;
  tags: string[];
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeInstance {
  id: string;
  opcode: string;
  params: Record<string, string | number | boolean>;
  position: NodePosition;
}

export interface Connection {
  from_node_id: string;
  from_port_id: string;
  to_node_id: string;
  to_port_id: string;
}

export interface EngineConfig {
  sr: number;
  ksmps: number;
  nchnls: number;
  "0dbfs": number;
}

export interface PatchGraph {
  nodes: NodeInstance[];
  connections: Connection[];
  ui_layout: JsonObject;
  engine_config: EngineConfig;
}

export interface SequencerState {
  isPlaying: boolean;
  bpm: number;
  midiChannel: number;
  stepCount: 16 | 32;
  playhead: number;
  steps: Array<number | null>;
}

export interface Patch {
  id: string;
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
  created_at: string;
  updated_at: string;
}

export interface PatchListItem {
  id: string;
  name: string;
  description: string;
  schema_version: number;
  updated_at: string;
}

export type SessionState = "idle" | "compiled" | "running" | "error";

export interface SessionInfo {
  session_id: string;
  patch_id: string;
  state: SessionState;
  midi_input: string | null;
  created_at: string;
  started_at: string | null;
}

export interface SessionCreateResponse {
  session_id: string;
  patch_id: string;
  state: SessionState;
}

export interface CompileResponse {
  session_id: string;
  state: SessionState;
  orc: string;
  csd: string;
  diagnostics: string[];
}

export interface SessionActionResponse {
  session_id: string;
  state: SessionState;
  detail: string;
}

export interface SessionMidiEventRequest {
  type: "note_on" | "note_off" | "all_notes_off";
  channel: number;
  note?: number;
  velocity?: number;
}

export interface MidiInputRef {
  id: string;
  name: string;
  backend: string;
}

export interface SessionEvent {
  session_id: string;
  ts: string;
  type: string;
  payload: Record<string, string | number | boolean | null>;
}
