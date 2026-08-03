import type {
  AppPage,
  ArpeggiatorState,
  ArrangerLoopSelection,
  BrowserClockLatencySettings,
  CompileResponse,
  DrummerSequencerStepCount,
  GuiLanguage,
  MidiInputRef,
  NodePosition,
  OpcodeSpec,
  PadLoopPatternState,
  Patch,
  PatchGraph,
  PatchListItem,
  PerformanceListItem,
  SequencerChord,
  SequencerConfigSnapshot,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerRuntimeState,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SessionEvent,
  SessionInstrumentAssignment,
  SessionState
} from "../types";
import type { SequencerTransportRuntimeSync } from "../lib/sequencerRuntimeState";

export interface EditablePatch {
  id?: string;
  name: string;
  description: string;
  is_template: boolean;
  always_on: boolean;
  schema_version: number;
  graph: PatchGraph;
  created_at?: string;
  updated_at?: string;
}

export interface InstrumentTabState {
  id: string;
  patch: EditablePatch;
}

export interface AppStore {
  loading: boolean;
  error: string | null;
  hasLoadedBootstrap: boolean;

  activePage: AppPage;
  guiLanguage: GuiLanguage;
  browserClockLatencySettings: BrowserClockLatencySettings;

  opcodes: OpcodeSpec[];
  patches: PatchListItem[];
  performances: PerformanceListItem[];
  midiInputs: MidiInputRef[];

  instrumentTabs: InstrumentTabState[];
  activeInstrumentTabId: string;
  currentPatch: EditablePatch;

  sequencer: SequencerState;
  sequencerRuntime: SequencerRuntimeState;
  sequencerInstruments: SequencerInstrumentBinding[];
  currentPerformanceId: string | null;
  performanceName: string;
  performanceDescription: string;

  activeSessionId: string | null;
  activeSessionState: SessionState;
  activeMidiInput: string | null;
  activeSessionInstruments: SessionInstrumentAssignment[];
  compileOutput: CompileResponse | null;

  events: SessionEvent[];

  setActivePage: (page: AppPage) => void;
  setGuiLanguage: (language: GuiLanguage) => void;
  setBrowserClockLatencySettings: (settings: BrowserClockLatencySettings) => void;

  addInstrumentTab: () => void;
  closeInstrumentTab: (tabId: string) => void;
  setActiveInstrumentTab: (tabId: string) => void;

  loadBootstrap: () => Promise<void>;
  loadPatch: (patchId: string) => Promise<void>;
  refreshPatches: () => Promise<PatchListItem[]>;
  refreshPerformances: () => Promise<PerformanceListItem[]>;
  newPatch: () => void;
  newPatchFromTemplate: (template: Patch) => void;
  setCurrentPatchMeta: (name: string, description: string) => void;
  setCurrentPatchTemplate: (isTemplate: boolean) => void;
  setCurrentPatchAlwaysOn: (alwaysOn: boolean) => void;
  setGraph: (graph: PatchGraph) => void;
  addNodeFromOpcode: (opcode: OpcodeSpec, position?: NodePosition) => void;
  removeNode: (nodeId: string) => void;
  removeConnection: (connectionIndex: number) => void;
  saveCurrentPatch: () => Promise<void>;
  loadPerformance: (performanceId: string) => Promise<void>;
  setCurrentPerformanceMeta: (name: string, description: string) => void;
  clearCurrentPerformanceSelection: () => void;
  newPerformanceWorkspace: () => Promise<void>;
  saveCurrentPerformance: () => Promise<void>;

  addSequencerInstrument: () => void;
  removeSequencerInstrument: (bindingId: string) => void;
  updateSequencerInstrumentPatch: (bindingId: string, patchId: string) => void;
  updateSequencerInstrumentChannel: (bindingId: string, channel: number) => void;
  updateSequencerInstrumentLevel: (bindingId: string, level: number) => void;
  updateSequencerInstrumentEffectRoute: (
    bindingId: string,
    sourceBindingId: string,
    channel: string,
    enabled: boolean
  ) => void;
  buildSequencerConfigSnapshot: () => SequencerConfigSnapshot;
  applySequencerConfigSnapshot: (snapshot: unknown) => void;

  addSequencerTrack: () => void;
  removeSequencerTrack: (trackId: string) => void;
  setSequencerTrackEnabled: (trackId: string, enabled: boolean, queueOnCycle?: boolean) => void;
  setSequencerTrackMidiChannel: (trackId: string, channel: number) => void;
  setSequencerTrackSyncTarget: (trackId: string, syncToTrackId: string | null) => void;
  setSequencerTrackScale: (
    trackId: string,
    scaleRoot: SequencerScaleRoot,
    scaleType: SequencerScaleType
  ) => void;
  setSequencerTrackMode: (trackId: string, mode: SequencerMode) => void;
  setSequencerTrackMeterNumerator: (trackId: string, numerator: number) => void;
  setSequencerTrackMeterDenominator: (trackId: string, denominator: number) => void;
  setSequencerTrackStepsPerBeat: (trackId: string, stepsPerBeat: number) => void;
  setSequencerTrackBeatRate: (trackId: string, numerator: number, denominator: number) => void;
  setSequencerTrackStepCount: (trackId: string, stepCount: number) => void;
  setSequencerTrackStepNote: (trackId: string, index: number, note: number | null) => void;
  setSequencerTrackStepChord: (trackId: string, index: number, chord: SequencerChord) => void;
  setSequencerTrackStepHold: (trackId: string, index: number, hold: boolean) => void;
  setSequencerTrackStepVelocity: (trackId: string, index: number, velocity: number) => void;
  copySequencerTrackStepSettings: (
    sourceTrackId: string,
    sourceIndex: number,
    targetTrackId: string,
    targetIndex: number
  ) => void;
  clearSequencerTrackSteps: (trackId: string) => void;
  copySequencerTrackPad: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  transposeSequencerTrackPadInScale: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  transposeSequencerTrackPadDiatonic: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  setSequencerTrackActivePad: (trackId: string, padIndex: number) => void;
  setSequencerTrackQueuedPad: (trackId: string, padIndex: number | null) => void;
  setSequencerTrackPadLoopEnabled: (trackId: string, enabled: boolean) => void;
  setSequencerTrackPadLoopRepeat: (trackId: string, repeat: boolean) => void;
  setSequencerTrackPadLoopPattern: (trackId: string, pattern: PadLoopPatternState) => void;
  addSequencerTrackPadLoopStep: (trackId: string, padIndex: number) => void;
  removeSequencerTrackPadLoopStep: (trackId: string, sequenceIndex: number) => void;
  moveSequencerTrack: (
    sourceTrackId: string,
    targetTrackId: string,
    position?: "before" | "after"
  ) => void;

  addDrummerSequencerTrack: () => void;
  removeDrummerSequencerTrack: (trackId: string) => void;
  setDrummerSequencerTrackEnabled: (trackId: string, enabled: boolean, queueOnCycle?: boolean) => void;
  setDrummerSequencerTrackMidiChannel: (trackId: string, channel: number) => void;
  setDrummerSequencerTrackMeterNumerator: (trackId: string, numerator: number) => void;
  setDrummerSequencerTrackMeterDenominator: (trackId: string, denominator: number) => void;
  setDrummerSequencerTrackStepsPerBeat: (trackId: string, stepsPerBeat: number) => void;
  setDrummerSequencerTrackBeatRate: (trackId: string, numerator: number, denominator: number) => void;
  setDrummerSequencerTrackStepCount: (trackId: string, stepCount: DrummerSequencerStepCount) => void;
  addDrummerSequencerRow: (trackId: string) => void;
  removeDrummerSequencerRow: (trackId: string, rowId: string) => void;
  setDrummerSequencerRowKey: (trackId: string, rowId: string, key: number) => void;
  toggleDrummerSequencerCell: (
    trackId: string,
    rowId: string,
    stepIndex: number,
    active?: boolean
  ) => void;
  setDrummerSequencerCellVelocity: (
    trackId: string,
    rowId: string,
    stepIndex: number,
    velocity: number
  ) => void;
  clearDrummerSequencerTrackSteps: (trackId: string) => void;
  copyDrummerSequencerPad: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  setDrummerSequencerTrackActivePad: (trackId: string, padIndex: number) => void;
  setDrummerSequencerTrackQueuedPad: (trackId: string, padIndex: number | null) => void;
  setDrummerSequencerTrackPadLoopEnabled: (trackId: string, enabled: boolean) => void;
  setDrummerSequencerTrackPadLoopRepeat: (trackId: string, repeat: boolean) => void;
  setDrummerSequencerTrackPadLoopPattern: (trackId: string, pattern: PadLoopPatternState) => void;
  addDrummerSequencerTrackPadLoopStep: (trackId: string, padIndex: number) => void;
  removeDrummerSequencerTrackPadLoopStep: (trackId: string, sequenceIndex: number) => void;

  addPianoRoll: () => void;
  removePianoRoll: (rollId: string) => void;
  setPianoRollEnabled: (rollId: string, enabled: boolean) => void;
  setPianoRollMidiChannel: (rollId: string, channel: number) => void;
  setPianoRollVelocity: (rollId: string, velocity: number) => void;
  setPianoRollScale: (
    rollId: string,
    scaleRoot: SequencerScaleRoot,
    scaleType: SequencerScaleType
  ) => void;
  setPianoRollMode: (rollId: string, mode: SequencerMode) => void;

  addMidiController: () => void;
  removeMidiController: (controllerId: string) => void;
  setMidiControllerEnabled: (controllerId: string, enabled: boolean) => void;
  setMidiControllerNumber: (controllerId: string, controllerNumber: number) => void;
  setMidiControllerValue: (controllerId: string, value: number) => void;

  addControllerSequencer: () => void;
  removeControllerSequencer: (controllerSequencerId: string) => void;
  setControllerSequencerEnabled: (controllerSequencerId: string, enabled: boolean) => void;
  setControllerSequencerNumber: (controllerSequencerId: string, controllerNumber: number) => void;
  setControllerSequencerActivePad: (controllerSequencerId: string, padIndex: number) => void;
  setControllerSequencerQueuedPad: (
    controllerSequencerId: string,
    padIndex: number | null
  ) => void;
  copyControllerSequencerPad: (
    controllerSequencerId: string,
    sourcePadIndex: number,
    targetPadIndex: number
  ) => void;
  clearControllerSequencerSteps: (controllerSequencerId: string) => void;
  setControllerSequencerPadLoopEnabled: (controllerSequencerId: string, enabled: boolean) => void;
  setControllerSequencerPadLoopRepeat: (controllerSequencerId: string, repeat: boolean) => void;
  setControllerSequencerPadLoopPattern: (
    controllerSequencerId: string,
    pattern: PadLoopPatternState
  ) => void;
  addControllerSequencerPadLoopStep: (controllerSequencerId: string, padIndex: number) => void;
  removeControllerSequencerPadLoopStep: (
    controllerSequencerId: string,
    sequenceIndex: number
  ) => void;
  setControllerSequencerMeterNumerator: (controllerSequencerId: string, numerator: number) => void;
  setControllerSequencerMeterDenominator: (
    controllerSequencerId: string,
    denominator: number
  ) => void;
  setControllerSequencerStepsPerBeat: (
    controllerSequencerId: string,
    stepsPerBeat: number
  ) => void;
  setControllerSequencerBeatRate: (
    controllerSequencerId: string,
    numerator: number,
    denominator: number
  ) => void;
  setControllerSequencerStepCount: (controllerSequencerId: string, stepCount: number) => void;
  addControllerSequencerKeypoint: (
    controllerSequencerId: string,
    position: number,
    value: number
  ) => void;
  setControllerSequencerKeypoint: (
    controllerSequencerId: string,
    keypointId: string,
    position: number,
    value: number
  ) => void;
  setControllerSequencerKeypointValue: (
    controllerSequencerId: string,
    keypointId: string,
    value: number
  ) => void;
  removeControllerSequencerKeypoint: (controllerSequencerId: string, keypointId: string) => void;
  syncControllerSequencerRuntime: (
    updates: Array<{
      controllerSequencerId: string;
      activePad?: number;
      queuedPad?: number | null;
      padLoopPosition?: number | null;
      runtimePadStartSubunit?: number | null;
      enabled?: boolean;
    }>
  ) => void;

  addArpeggiator: () => void;
  removeArpeggiator: (arpeggiatorId: string) => void;
  setArpeggiatorEnabled: (arpeggiatorId: string, enabled: boolean) => void;
  updateArpeggiator: (arpeggiatorId: string, update: Partial<ArpeggiatorState>) => void;
  applyArpeggiatorPreset: (arpeggiatorId: string, presetId: string) => void;
  saveArpeggiatorPreset: (arpeggiatorId: string, presetName: string) => void;
  syncArpeggiatorRuntime: (
    updates: Array<{
      arpeggiatorId: string;
      heldNotes?: number[];
      activeNote?: number | null;
      stepIndex?: number;
      lastVelocity?: number | null;
    }>
  ) => void;

  setSequencerBpm: (bpm: number) => void;
  setSequencerMeterNumerator: (numerator: number) => void;
  setSequencerMeterDenominator: (denominator: number) => void;
  setSequencerStepsPerBeat: (stepsPerBeat: number) => void;
  setSequencerArrangerLoopSelection: (selection: ArrangerLoopSelection | null) => void;
  syncSequencerRuntime: (payload: {
    isPlaying: boolean;
    transportStepCount?: number;
    playhead?: number;
    cycle?: number;
    transportSubunit?: number;
    tracks?: Array<{
      trackId: string;
      stepCount?: number;
      localStep?: number;
      runtimePadStartSubunit?: number | null;
      activePad?: number;
      queuedPad?: number | null;
      padLoopPosition?: number | null;
      enabled?: boolean;
      queuedEnabled?: boolean | null;
    }>;
    drummerTracks?: Array<{
      trackId: string;
      stepCount?: number;
      localStep?: number;
      runtimePadStartSubunit?: number | null;
      activePad?: number;
      queuedPad?: number | null;
      padLoopPosition?: number | null;
      enabled?: boolean;
      queuedEnabled?: boolean | null;
    }>;
  }) => void;
  syncSequencerTransportRuntime: (payload: SequencerTransportRuntimeSync) => void;
  setSequencerPlaying: (isPlaying: boolean) => void;
  setSequencerPlayhead: (playhead: number) => void;
  setSequencerTransportAbsoluteStep: (absoluteStep: number) => void;
  applyEngineConfig: (config: {
    sr: number;
    controlRate: number;
    softwareBuffer: number;
    hardwareBuffer: number;
  }) => Promise<void>;

  ensureSession: () => Promise<string>;
  compileSession: () => Promise<CompileResponse | null>;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  panicSession: () => Promise<void>;
  bindMidiInput: (midiInput: string) => Promise<void>;

  pushEvent: (event: SessionEvent) => void;
}
