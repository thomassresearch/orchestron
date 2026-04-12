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
  | "sequencer_multitrack_arranger"
  | "sequencer_drummer_sequencer"
  | "sequencer_controller_sequencer"
  | "sequencer_piano_rolls"
  | "sequencer_midi_controllers"
  | "config_audio_engine"
  | "config_browser_clock_latency"
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

export type SequencerMeterNumerator = 2 | 3 | 4 | 5 | 6 | 7;
export type SequencerMeterDenominator = 4 | 8;
export type SequencerStepsPerBeat = 2 | 4 | 8;
export type SequencerBeatRateNumerator = 1 | 2 | 3 | 4 | 5 | 7;
export type SequencerBeatRateDenominator = 1 | 2 | 3 | 4 | 5;
export type SequencerPadLengthBeats = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type ControllerSequencerPadLengthBeats = SequencerPadLengthBeats | 16;
export type PadLoopPauseBeatCount = 1 | 2 | 4 | 8 | 16;
export type DrummerSequencerStepCount = number;
export type PadLoopPauseStepCount = PadLoopPauseBeatCount;

export interface SequencerTimingConfig {
  tempoBPM: number;
  meterNumerator: SequencerMeterNumerator;
  meterDenominator: SequencerMeterDenominator;
  stepsPerBeat: SequencerStepsPerBeat;
  beatRateNumerator: SequencerBeatRateNumerator;
  beatRateDenominator: SequencerBeatRateDenominator;
}

export interface DrummerSequencerCellState {
  active: boolean;
  velocity: number;
}

export interface DrummerSequencerRowState {
  id: string;
  key: number;
}

export interface DrummerSequencerPadRowState {
  rowId: string;
  steps: DrummerSequencerCellState[];
}

export interface DrummerSequencerPadState {
  lengthBeats: SequencerPadLengthBeats;
  stepCount: number;
  rows: DrummerSequencerPadRowState[];
}

export interface SequencerPadState {
  lengthBeats: SequencerPadLengthBeats;
  stepCount: number;
  steps: SequencerStepState[];
  scaleRoot: SequencerScaleRoot;
  scaleType: SequencerScaleType;
  mode: SequencerMode;
}

export type PadLoopPatternItem =
  | {
      type: "pad";
      padIndex: number;
    }
  | {
      type: "pause";
      lengthBeats: PadLoopPauseBeatCount;
    }
  | {
      type: "group";
      groupId: string;
    }
  | {
      type: "super";
      superGroupId: string;
    };

export interface PadLoopGroupPatternState {
  id: string;
  sequence: PadLoopPatternItem[];
}

export interface PadLoopSuperGroupPatternState {
  id: string;
  sequence: PadLoopPatternItem[];
}

export interface PadLoopPatternState {
  rootSequence: PadLoopPatternItem[];
  groups: PadLoopGroupPatternState[];
  superGroups: PadLoopSuperGroupPatternState[];
}

export interface SequencerTrackState {
  id: string;
  name: string;
  midiChannel: number;
  timing: SequencerTimingConfig;
  lengthBeats: SequencerPadLengthBeats;
  stepCount: number;
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
  padLoopPattern: PadLoopPatternState;
  pads: SequencerPadState[];
  steps: SequencerStepState[];
  runtimeLocalStep: number | null;
  runtimePadStartSubunit: number | null;
  enabled: boolean;
  queuedEnabled: boolean | null;
}

export interface DrummerSequencerTrackState {
  id: string;
  name: string;
  midiChannel: number;
  timing: SequencerTimingConfig;
  lengthBeats: SequencerPadLengthBeats;
  stepCount: number;
  activePad: number;
  queuedPad: number | null;
  padLoopPosition: number | null;
  padLoopEnabled: boolean;
  padLoopRepeat: boolean;
  padLoopSequence: number[];
  padLoopPattern: PadLoopPatternState;
  rows: DrummerSequencerRowState[];
  pads: DrummerSequencerPadState[];
  runtimeLocalStep: number | null;
  runtimePadStartSubunit: number | null;
  enabled: boolean;
  queuedEnabled: boolean | null;
}

export interface PianoRollState {
  id: string;
  name: string;
  midiChannel: number;
  velocity: number;
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

export interface ControllerSequencerPadState {
  lengthBeats: ControllerSequencerPadLengthBeats;
  stepCount: number;
  keypoints: ControllerSequencerKeypoint[];
}

export interface ControllerSequencerState {
  id: string;
  name: string;
  controllerNumber: number;
  timing: SequencerTimingConfig;
  lengthBeats: ControllerSequencerPadLengthBeats;
  stepCount: number;
  activePad: number;
  queuedPad: number | null;
  padLoopPosition: number | null;
  padLoopEnabled: boolean;
  padLoopRepeat: boolean;
  padLoopSequence: number[];
  padLoopPattern: PadLoopPatternState;
  pads: ControllerSequencerPadState[];
  runtimePadStartSubunit: number | null;
  enabled: boolean;
  keypoints: ControllerSequencerKeypoint[];
}

export interface ArrangerLoopSelection {
  startStep: number;
  endStep: number;
}

export interface SequencerState {
  isPlaying: boolean;
  timing: SequencerTimingConfig;
  stepCount: number;
  playhead: number;
  cycle: number;
  arrangerLoopSelection: ArrangerLoopSelection | null;
  tracks: SequencerTrackState[];
  drummerTracks: DrummerSequencerTrackState[];
  controllerSequencers: ControllerSequencerState[];
  pianoRolls: PianoRollState[];
  midiControllers: MidiControllerState[];
}

export interface SequencerRuntimeState {
  isPlaying: boolean;
  stepCount: number;
  playhead: number;
  cycle: number;
  transportSubunit: number;
  trackLocalStepById: Record<string, number | null>;
  drummerTrackLocalStepById: Record<string, number | null>;
  controllerRuntimePadStartSubunitById: Record<string, number | null>;
}

export interface SessionInstrumentAssignment {
  patch_id: string;
  midi_channel: number;
}

export interface SequencerInstrumentBinding {
  id: string;
  patchId: string;
  midiChannel: number;
  level: number;
}

export interface SequencerConfigSnapshot {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  instruments: Array<{
    patchId: string;
    patchName?: string;
    midiChannel: number;
    level?: number;
  }>;
  patchDefinitions?: Array<{
    sourcePatchId: string;
    name: string;
    description: string;
    schema_version: number;
    graph: PatchGraph;
  }>;
  sequencer: {
    timing?: SequencerTimingConfig;
    tempoBPM?: number;
    meterNumerator?: SequencerMeterNumerator;
    meterDenominator?: SequencerMeterDenominator;
    stepsPerBeat?: SequencerStepsPerBeat;
    stepCount?: number;
    arrangerLoopSelection?: ArrangerLoopSelection | null;
    tracks: Array<{
      id: string;
      name: string;
      midiChannel: number;
      lengthBeats?: SequencerPadLengthBeats;
      stepCount?: number;
      syncToTrackId: string | null;
      scaleRoot: SequencerScaleRoot;
      scaleType: SequencerScaleType;
      mode: SequencerMode;
      activePad: number;
      queuedPad: number | null;
      padLoopEnabled: boolean;
      padLoopRepeat: boolean;
      padLoopSequence: number[];
      padLoopPattern?: PadLoopPatternState;
      pads: SequencerPadState[];
      enabled: boolean;
      queuedEnabled: boolean | null;
    }>;
    drummerTracks: Array<{
      id: string;
      name: string;
      midiChannel: number;
      lengthBeats?: SequencerPadLengthBeats;
      stepCount?: number;
      activePad: number;
      queuedPad: number | null;
      padLoopEnabled: boolean;
      padLoopRepeat: boolean;
      padLoopSequence: number[];
      padLoopPattern?: PadLoopPatternState;
      rows: DrummerSequencerRowState[];
      pads: DrummerSequencerPadState[];
      enabled: boolean;
      queuedEnabled: boolean | null;
    }>;
    pianoRolls: Array<{
      id: string;
      name: string;
      midiChannel: number;
      velocity: number;
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
      lengthBeats?: ControllerSequencerPadLengthBeats;
      stepCount?: number;
      activePad: number;
      queuedPad: number | null;
      padLoopEnabled: boolean;
      padLoopRepeat: boolean;
      padLoopSequence: number[];
      padLoopPattern?: PadLoopPatternState;
      enabled: boolean;
      pads: ControllerSequencerPadState[];
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

export interface BrowserClockLatencySettings {
  steadyLowWaterMs: number;
  steadyHighWaterMs: number;
  startupLowWaterMs: number;
  startupHighWaterMs: number;
  underrunRecoveryBoostMs: number;
  maxUnderrunBoostMs: number;
  maxBlocksPerRequest: number;
  steadyMaxParallelRequests: number;
  startupMaxParallelRequests: number;
  recoveryMaxParallelRequests: number;
  immediateRenderBlocks: number;
  immediateRenderCooldownMs: number;
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
  browserClockLatencySettings: BrowserClockLatencySettings;
}

export interface AppStateResponse {
  state: PersistedAppState;
  updated_at: string;
}

export type SessionAudioOutputMode = "local" | "browser_clock";

export interface RuntimeConfigResponse {
  audio_output_mode: SessionAudioOutputMode;
  browser_clock_enabled: boolean;
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

export interface SessionSequencerTimingConfig {
  tempo_bpm: number;
  meter_numerator: SequencerMeterNumerator;
  meter_denominator: SequencerMeterDenominator;
  steps_per_beat: SequencerStepsPerBeat;
  beat_rate_numerator: SequencerBeatRateNumerator;
  beat_rate_denominator: SequencerBeatRateDenominator;
}

export interface SessionSequencerPadConfig {
  pad_index: number;
  length_beats?: SequencerPadLengthBeats | ControllerSequencerPadLengthBeats;
  steps: Array<number | Array<number> | null | SessionSequencerStepConfig>;
}

export interface SessionControllerSequencerKeypointConfig {
  position: number;
  value: number;
}

export interface SessionControllerSequencerPadConfig {
  pad_index: number;
  length_beats?: ControllerSequencerPadLengthBeats;
  keypoints: SessionControllerSequencerKeypointConfig[];
}

export interface SessionSequencerTrackConfig {
  track_id: string;
  midi_channel: number;
  timing: SessionSequencerTimingConfig;
  length_beats?: SequencerPadLengthBeats;
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

export interface SessionControllerSequencerTrackConfig {
  track_id: string;
  controller_number: number;
  timing: SessionSequencerTimingConfig;
  length_beats?: ControllerSequencerPadLengthBeats;
  active_pad: number;
  queued_pad?: number | null;
  pad_loop_enabled?: boolean;
  pad_loop_repeat?: boolean;
  pad_loop_sequence?: number[];
  enabled?: boolean;
  pads: SessionControllerSequencerPadConfig[];
  target_channels?: number[];
}

export interface SessionSequencerConfigRequest {
  timing: SessionSequencerTimingConfig;
  step_count: number;
  playback_start_step?: number;
  playback_end_step?: number;
  playback_loop?: boolean;
  tracks: SessionSequencerTrackConfig[];
  controller_tracks: SessionControllerSequencerTrackConfig[];
}

export interface SessionSequencerStartRequest {
  config?: SessionSequencerConfigRequest;
  position_step?: number;
}

export interface SessionSequencerQueuePadRequest {
  pad_index: number | null;
}

export interface SessionSequencerTrackStatus {
  track_id: string;
  midi_channel: number;
  timing: SessionSequencerTimingConfig;
  length_beats: number;
  step_count: number;
  local_step: number;
  active_pad: number;
  queued_pad: number | null;
  pad_loop_position: number | null;
  enabled: boolean;
  queued_enabled: boolean | null;
  runtime_pad_start_subunit: number | null;
  active_notes: number[];
}

export interface SessionControllerSequencerTrackStatus {
  track_id: string;
  controller_number: number;
  timing: SessionSequencerTimingConfig;
  length_beats: number;
  step_count: number;
  active_pad: number;
  queued_pad: number | null;
  pad_loop_position: number | null;
  enabled: boolean;
  runtime_pad_start_subunit: number | null;
  last_value: number | null;
  target_channels: number[];
}

export interface SessionSequencerStatus {
  session_id: string;
  running: boolean;
  timing: SessionSequencerTimingConfig;
  step_count: number;
  current_step: number;
  cycle: number;
  transport_subunit: number;
  tracks: SessionSequencerTrackStatus[];
  controller_tracks: SessionControllerSequencerTrackStatus[];
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

export interface BrowserClockClaimControllerRequest {
  type: "claim_controller";
  audio_context_sample_rate: number;
  queue_low_water_frames: number;
  queue_high_water_frames: number;
  max_blocks_per_request: number;
}

export interface BrowserClockRequestRenderRequest {
  type: "request_render";
  block_count: number;
}

export interface BrowserClockReleaseControllerRequest {
  type: "release_controller";
}

export interface BrowserClockManualMidiRequest {
  type: "manual_midi";
  midi: SessionMidiEventRequest;
  event_perf_ms?: number | null;
}

export interface BrowserClockTimingReportRequest {
  type: "timing_report";
  client_perf_ms: number;
  audio_context_time_s: number;
  queued_frames: number;
  sample_rate: number;
  pending_render_frames?: number;
}

export interface BrowserClockSequencerStartControlRequest {
  type: "sequencer_start";
  request_id: string;
  config?: SessionSequencerConfigRequest | null;
  position_step?: number | null;
}

export interface BrowserClockSequencerCommandRequest {
  type: "sequencer_stop" | "sequencer_rewind" | "sequencer_forward";
  request_id: string;
}

export interface BrowserClockQueuePadControlRequest {
  type: "queue_pad";
  request_id: string;
  track_id: string;
  pad_index: number | null;
}

export interface BrowserClockStreamConfigMessage {
  type: "stream_config";
  engine_sample_rate: number;
  ksmps: number;
  channels: number;
  target_sample_rate: number;
  engine_sample_cursor: number;
  queue_low_water_frames: number;
  queue_high_water_frames: number;
  max_blocks_per_request: number;
  server_monotonic_ns: number;
  timing_report_interval_ms: number;
  engine_ksmps_latency_frames: number;
  sequencer_status: SessionSequencerStatus;
}

export interface BrowserClockRenderChunkMessage {
  type: "render_chunk";
  chunk_id: string;
  engine_block_count: number;
  engine_sample_start: number;
  engine_sample_end: number;
  engine_sample_rate: number;
  target_sample_rate: number;
  target_frame_count: number;
  channels: number;
  sequencer_status: SessionSequencerStatus;
}

export interface BrowserClockControllerRevokedMessage {
  type: "controller_revoked";
  reason: string;
}

export interface BrowserClockSequencerStatusMessage {
  type: "sequencer_status";
  request_id: string;
  action: string;
  sequencer_status: SessionSequencerStatus;
}

export interface BrowserClockEngineErrorMessage {
  type: "engine_error";
  detail: string;
}

export type BrowserClockServerMessage =
  | BrowserClockStreamConfigMessage
  | BrowserClockRenderChunkMessage
  | BrowserClockControllerRevokedMessage
  | BrowserClockSequencerStatusMessage
  | BrowserClockEngineErrorMessage;

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
  selector: string;
}

export interface SessionEvent {
  session_id: string;
  ts: string;
  type: string;
  payload: JsonObject;
}
