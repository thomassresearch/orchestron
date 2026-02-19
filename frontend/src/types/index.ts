export type SignalType = "a" | "k" | "i" | "S" | "f";
export type AppPage = "instrument" | "sequencer" | "config";

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
  documentation_markdown: string;
  documentation_url: string;
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
  control_rate: number;
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

export type SequencerScaleType = "major" | "minor";
export type SequencerMode = "ionian" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "aeolian" | "locrian";
export type SequencerScaleRoot =
  | "C"
  | "C#"
  | "Db"
  | "D"
  | "D#"
  | "Eb"
  | "E"
  | "F"
  | "F#"
  | "Gb"
  | "G"
  | "G#"
  | "Ab"
  | "A"
  | "A#"
  | "Bb"
  | "B"
  | "Cb";

export interface SequencerState {
  isPlaying: boolean;
  bpm: number;
  midiChannel: number;
  scaleRoot: SequencerScaleRoot;
  scaleType: SequencerScaleType;
  mode: SequencerMode;
  trackId: string;
  stepCount: 16 | 32;
  playhead: number;
  cycle: number;
  activePad: number;
  queuedPad: number | null;
  pads: Array<Array<number | null>>;
  steps: Array<number | null>;
  pianoRollMidiChannel: number;
  pianoRollScaleRoot: SequencerScaleRoot;
  pianoRollScaleType: SequencerScaleType;
  pianoRollMode: SequencerMode;
}

export interface SessionSequencerPadConfig {
  pad_index: number;
  steps: Array<number | Array<number> | null>;
}

export interface SessionSequencerTrackConfig {
  track_id: string;
  midi_channel: number;
  velocity?: number;
  gate_ratio?: number;
  active_pad: number;
  queued_pad?: number | null;
  pads: SessionSequencerPadConfig[];
}

export interface SessionSequencerConfigRequest {
  bpm: number;
  step_count: 16 | 32;
  tracks: SessionSequencerTrackConfig[];
}

export interface SessionSequencerStartRequest {
  config?: SessionSequencerConfigRequest;
}

export interface SessionSequencerQueuePadRequest {
  pad_index: number;
}

export interface SessionSequencerTrackStatus {
  track_id: string;
  midi_channel: number;
  active_pad: number;
  queued_pad: number | null;
  active_notes: number[];
}

export interface SessionSequencerStatus {
  session_id: string;
  running: boolean;
  bpm: number;
  step_count: 16 | 32;
  current_step: number;
  cycle: number;
  tracks: SessionSequencerTrackStatus[];
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
