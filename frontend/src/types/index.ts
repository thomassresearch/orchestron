export type SignalType = "a" | "k" | "i" | "S" | "f";
export type AppPage = "instrument" | "sequencer" | "config";
export type GuiLanguage = "english" | "german" | "french" | "spanish";
export type HelpDocId =
  | "instrument_patch_toolbar"
  | "instrument_opcode_catalog"
  | "instrument_graph_editor"
  | "instrument_runtime_panel"
  | "sequencer_instrument_rack"
  | "sequencer_tracks"
  | "sequencer_track_editor"
  | "sequencer_controller_sequencer"
  | "sequencer_piano_rolls"
  | "sequencer_midi_controllers"
  | "config_audio_engine"
  | "config_engine_values";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface PortSpec {
  id: string;
  name: string;
  signal_type: SignalType;
  accepted_signal_types?: SignalType[];
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
  software_buffer: number;
  hardware_buffer: number;
  "0dbfs": number;
}

export interface PatchGraph {
  nodes: NodeInstance[];
  connections: Connection[];
  ui_layout: JsonObject;
  engine_config: EngineConfig;
}

export type SequencerScaleType = "major" | "neutral" | "minor";
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

export type SequencerChord =
  | "none"
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "maj7"
  | "min7"
  | "dom7"
  | "m7b5"
  | "dim7"
  | "minmaj7";

export interface SequencerStepState {
  note: number | null;
  chord: SequencerChord;
  hold: boolean;
  velocity: number;
}

export interface SequencerPadState {
  steps: SequencerStepState[];
  scaleRoot: SequencerScaleRoot;
  scaleType: SequencerScaleType;
  mode: SequencerMode;
}

export interface SequencerTrackState {
  id: string;
  name: string;
  midiChannel: number;
  stepCount: 16 | 32;
  syncToTrackId: string | null;
  scaleRoot: SequencerScaleRoot;
  scaleType: SequencerScaleType;
  mode: SequencerMode;
  activePad: number;
  queuedPad: number | null;
  padLoopPosition: number | null;
  padLoopEnabled: boolean;
  padLoopRepeat: boolean;
  padLoopSequence: number[];
  pads: SequencerPadState[];
  steps: SequencerStepState[];
  runtimeLocalStep: number | null;
  enabled: boolean;
  queuedEnabled: boolean | null;
}

export interface PianoRollState {
  id: string;
  name: string;
  midiChannel: number;
  scaleRoot: SequencerScaleRoot;
  scaleType: SequencerScaleType;
  mode: SequencerMode;
  enabled: boolean;
}

export interface MidiControllerState {
  id: string;
  name: string;
  controllerNumber: number;
  value: number;
  enabled: boolean;
}

export interface ControllerSequencerKeypoint {
  id: string;
  position: number; // normalized 0..1
  value: number; // MIDI CC 0..127
}

export interface ControllerSequencerState {
  id: string;
  name: string;
  controllerNumber: number;
  stepCount: 8 | 16 | 32 | 64;
  enabled: boolean;
  keypoints: ControllerSequencerKeypoint[];
}

export interface SequencerState {
  isPlaying: boolean;
  bpm: number;
  stepCount: 16 | 32;
  playhead: number;
  cycle: number;
  tracks: SequencerTrackState[];
  controllerSequencers: ControllerSequencerState[];
  pianoRolls: PianoRollState[];
  midiControllers: MidiControllerState[];
}

export interface SessionInstrumentAssignment {
  patch_id: string;
  midi_channel: number;
}

export interface SequencerInstrumentBinding {
  id: string;
  patchId: string;
  midiChannel: number;
}

export interface SequencerConfigSnapshot {
  version: 1 | 2;
  instruments: Array<{
    patchId: string;
    patchName?: string;
    midiChannel: number;
  }>;
  sequencer: {
    bpm: number;
    stepCount: 16 | 32;
    tracks: Array<{
      id: string;
      name: string;
      midiChannel: number;
      stepCount: 16 | 32;
      syncToTrackId: string | null;
      scaleRoot: SequencerScaleRoot;
      scaleType: SequencerScaleType;
      mode: SequencerMode;
      activePad: number;
      queuedPad: number | null;
      padLoopEnabled: boolean;
      padLoopRepeat: boolean;
      padLoopSequence: number[];
      pads: SequencerPadState[];
      enabled: boolean;
      queuedEnabled: boolean | null;
    }>;
    pianoRolls: Array<{
      id: string;
      name: string;
      midiChannel: number;
      scaleRoot: SequencerScaleRoot;
      scaleType: SequencerScaleType;
      mode: SequencerMode;
      enabled: boolean;
    }>;
    midiControllers: Array<{
      id: string;
      name: string;
      controllerNumber: number;
      value: number;
      enabled: boolean;
    }>;
    controllerSequencers: Array<{
      id: string;
      name: string;
      controllerNumber: number;
      stepCount: 8 | 16 | 32 | 64;
      enabled: boolean;
      keypoints: Array<{
        id: string;
        position: number;
        value: number;
      }>;
    }>;
  };
}

export interface EditablePatchSnapshot {
  id?: string;
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
  created_at?: string;
  updated_at?: string;
}

export interface InstrumentTabSnapshot {
  id: string;
  patch: EditablePatchSnapshot;
}

export interface PersistedAppState {
  version: 1;
  activePage: AppPage;
  guiLanguage: GuiLanguage;
  instrumentTabs: InstrumentTabSnapshot[];
  activeInstrumentTabId: string;
  sequencer: SequencerState;
  sequencerInstruments: SequencerInstrumentBinding[];
  currentPerformanceId: string | null;
  performanceName: string;
  performanceDescription: string;
  activeMidiInput: string | null;
}

export interface AppStateResponse {
  state: PersistedAppState;
  updated_at: string;
}

export interface WebRtcIceServerConfig {
  urls: string | string[];
  username?: string | null;
  credential?: string | null;
}

export interface RuntimeConfigResponse {
  webrtc_browser_ice_servers: WebRtcIceServerConfig[];
}

export interface GenAudioAssetUploadResponse {
  asset_id: string;
  original_name: string;
  stored_name: string;
  content_type: string;
  size_bytes: number;
}

export interface Performance {
  id: string;
  name: string;
  description: string;
  config: SequencerConfigSnapshot;
  created_at: string;
  updated_at: string;
}

export interface PerformanceListItem {
  id: string;
  name: string;
  description: string;
  updated_at: string;
}

export interface SessionSequencerStepConfig {
  note: number | Array<number> | null;
  hold: boolean;
  velocity?: number;
}

export interface SessionSequencerPadConfig {
  pad_index: number;
  steps: Array<number | Array<number> | null | SessionSequencerStepConfig>;
}

export interface SessionSequencerTrackConfig {
  track_id: string;
  midi_channel: number;
  step_count: 16 | 32;
  velocity?: number;
  gate_ratio?: number;
  sync_to_track_id?: string | null;
  active_pad: number;
  queued_pad?: number | null;
  pad_loop_enabled?: boolean;
  pad_loop_repeat?: boolean;
  pad_loop_sequence?: number[];
  enabled?: boolean;
  queued_enabled?: boolean | null;
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
  step_count: 16 | 32;
  local_step: number;
  active_pad: number;
  queued_pad: number | null;
  pad_loop_position: number | null;
  enabled: boolean;
  queued_enabled: boolean | null;
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
  instruments: SessionInstrumentAssignment[];
  state: SessionState;
  midi_input: string | null;
  created_at: string;
  started_at: string | null;
}

export interface SessionCreateResponse {
  session_id: string;
  patch_id: string;
  instruments: SessionInstrumentAssignment[];
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

export interface SessionAudioWebRtcOfferRequest {
  type: "offer";
  sdp: string;
}

export interface SessionAudioWebRtcAnswerResponse {
  type: "answer";
  sdp: string;
  sample_rate: number;
}

export type SessionMidiEventRequest =
  | {
      type: "note_on";
      channel: number;
      note: number;
      velocity?: number;
    }
  | {
      type: "note_off";
      channel: number;
      note: number;
    }
  | {
      type: "all_notes_off";
      channel: number;
    }
  | {
      type: "control_change";
      channel: number;
      controller: number;
      value: number;
    };

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
