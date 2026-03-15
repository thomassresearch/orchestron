import { create } from "zustand";

import { api, isApiError } from "../api/client";
import {
  normalizeArrangerLoopSelection,
  transportPositionFromAbsoluteStep
} from "../lib/arrangerTransport";
import { createUntitledPatch } from "../lib/defaultPatch";
import { normalizeGuiLanguage } from "../lib/guiLanguage";
import {
  compilePadLoopPattern,
  createEmptyPadLoopPattern,
  insertPadLoopItem,
  normalizePadLoopPatternState,
  normalizePadLoopSequenceToken,
  removePadLoopItemsFromContainer
} from "../lib/padLoopPattern";
import {
  DEFAULT_SEQUENCER_TIMING_CONFIG,
  STEP_CAPACITY,
  clampControllerCurvePosition,
  clampControllerCurveValue,
  clampControllerSequencerPadLengthBeats,
  normalizeSequencerBeatRate,
  clampSequencerMeterDenominator,
  clampSequencerMeterNumerator,
  clampSequencerPadLengthBeats,
  clampSequencerStepsPerBeat,
  clampSequencerTempoBpm,
  defaultModeForScaleType,
  linkedModeForScaleType,
  linkedScaleTypeForMode,
  normalizeSequencerTimingConfig,
  normalizeControllerCurveKeypoints,
  normalizeSequencerChord,
  normalizeSequencerMode,
  normalizeSequencerScaleRoot,
  normalizeSequencerScaleType,
  resolveDiatonicSequencerChordVariant,
  sequencerPadStepCount,
  sequencerTransportStepCount,
  sequencerTransportSubunitsPerStep,
  sequencerTransportStepsPerBeat,
  transposeSequencerNoteByScaleDegree,
  transposeSequencerTonicByDiatonicStep
} from "../lib/sequencer";
import type {
  ArrangerLoopSelection,
  AppPage,
  CompileResponse,
  ControllerSequencerKeypoint,
  ControllerSequencerPadLengthBeats,
  ControllerSequencerPadState,
  ControllerSequencerState,
  DrummerSequencerCellState,
  DrummerSequencerPadState,
  DrummerSequencerPadRowState,
  DrummerSequencerRowState,
  DrummerSequencerStepCount,
  DrummerSequencerTrackState,
  EngineConfig,
  GuiLanguage,
  MidiInputRef,
  NodeInstance,
  NodePosition,
  OpcodeSpec,
  PadLoopPatternState,
  Patch,
  PatchGraph,
  PatchListItem,
  PerformanceListItem,
  PersistedAppState,
  MidiControllerState,
  PianoRollState,
  SequencerMeterDenominator,
  SequencerMeterNumerator,
  SequencerChord,
  SequencerConfigSnapshot,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerPadState,
  SequencerPadLengthBeats,
  SequencerStepState,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerStepsPerBeat,
  SequencerState,
  SequencerRuntimeState,
  SequencerTimingConfig,
  SequencerTrackState,
  SessionEvent,
  SessionInstrumentAssignment,
  SessionState
} from "../types";

interface EditablePatch {
  id?: string;
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
  created_at?: string;
  updated_at?: string;
}

interface InstrumentTabState {
  id: string;
  patch: EditablePatch;
}

interface AppStore {
  loading: boolean;
  error: string | null;
  hasLoadedBootstrap: boolean;

  activePage: AppPage;
  guiLanguage: GuiLanguage;

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

  addInstrumentTab: () => void;
  closeInstrumentTab: (tabId: string) => void;
  setActiveInstrumentTab: (tabId: string) => void;

  loadBootstrap: () => Promise<void>;
  loadPatch: (patchId: string) => Promise<void>;
  refreshPatches: () => Promise<PatchListItem[]>;
  refreshPerformances: () => Promise<PerformanceListItem[]>;
  newPatch: () => void;
  setCurrentPatchMeta: (name: string, description: string) => void;
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
  buildSequencerConfigSnapshot: () => SequencerConfigSnapshot;
  applySequencerConfigSnapshot: (snapshot: unknown) => void;

  addSequencerTrack: () => void;
  removeSequencerTrack: (trackId: string) => void;
  setSequencerTrackEnabled: (trackId: string, enabled: boolean, queueOnCycle?: boolean) => void;
  setSequencerTrackMidiChannel: (trackId: string, channel: number) => void;
  setSequencerTrackSyncTarget: (trackId: string, syncToTrackId: string | null) => void;
  setSequencerTrackScale: (trackId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
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
  moveSequencerTrack: (sourceTrackId: string, targetTrackId: string, position?: "before" | "after") => void;

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
  toggleDrummerSequencerCell: (trackId: string, rowId: string, stepIndex: number, active?: boolean) => void;
  setDrummerSequencerCellVelocity: (trackId: string, rowId: string, stepIndex: number, velocity: number) => void;
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
  setPianoRollScale: (rollId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
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
  setControllerSequencerQueuedPad: (controllerSequencerId: string, padIndex: number | null) => void;
  copyControllerSequencerPad: (controllerSequencerId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  clearControllerSequencerSteps: (controllerSequencerId: string) => void;
  setControllerSequencerPadLoopEnabled: (controllerSequencerId: string, enabled: boolean) => void;
  setControllerSequencerPadLoopRepeat: (controllerSequencerId: string, repeat: boolean) => void;
  setControllerSequencerPadLoopPattern: (
    controllerSequencerId: string,
    pattern: PadLoopPatternState
  ) => void;
  addControllerSequencerPadLoopStep: (controllerSequencerId: string, padIndex: number) => void;
  removeControllerSequencerPadLoopStep: (controllerSequencerId: string, sequenceIndex: number) => void;
  setControllerSequencerMeterNumerator: (controllerSequencerId: string, numerator: number) => void;
  setControllerSequencerMeterDenominator: (controllerSequencerId: string, denominator: number) => void;
  setControllerSequencerStepsPerBeat: (controllerSequencerId: string, stepsPerBeat: number) => void;
  setControllerSequencerBeatRate: (controllerSequencerId: string, numerator: number, denominator: number) => void;
  setControllerSequencerStepCount: (controllerSequencerId: string, stepCount: number) => void;
  addControllerSequencerKeypoint: (controllerSequencerId: string, position: number, value: number) => void;
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
      activePad?: number;
      queuedPad?: number | null;
      padLoopPosition?: number | null;
      enabled?: boolean;
      queuedEnabled?: boolean | null;
    }>;
  }) => void;
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

const OPCODE_PARAM_DEFAULTS: Record<string, Record<string, string | number | boolean>> = {
  const_a: { value: 0 },
  const_i: { value: 0 },
  const_k: { value: 0 }
};

const DEFAULT_PAD_COUNT = 8;
const MAX_MIDI_CONTROLLERS = 6;
const DEFAULT_DRUMMER_ROW_KEYS = [36, 38, 42, 46] as const;
const APP_STATE_VERSION = 1 as const;
const APP_STATE_PERSIST_DEBOUNCE_MS = 400;
const AUDIO_RATE_MIN = 22000;
const AUDIO_RATE_MAX = 48000;
const CONTROL_RATE_MIN = 25;
const CONTROL_RATE_MAX = 48000;
const ENGINE_BUFFER_MIN = 32;
const ENGINE_BUFFER_MAX = 8192;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight = false;
let pendingPersistSnapshot: PersistedAppState | null = null;
let lastPersistedSignature: string | null = null;
let lastPersistWatchState: PersistWatchState | null = null;
let bootstrapLoadInFlight: Promise<void> | null = null;

type PersistWatchState = {
  activePage: AppPage;
  guiLanguage: GuiLanguage;
  instrumentTabs: InstrumentTabState[];
  activeInstrumentTabId: string;
  sequencer: SequencerState;
  sequencerInstruments: SequencerInstrumentBinding[];
  currentPerformanceId: string | null;
  performanceName: string;
  performanceDescription: string;
  activeMidiInput: string | null;
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeInstrumentLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }
  return clampInt(value, 1, 10);
}

function normalizeSequencerTiming(value: unknown): SequencerTimingConfig {
  return normalizeSequencerTimingConfig(value);
}

function defaultSequencerTiming(): SequencerTimingConfig {
  return { ...DEFAULT_SEQUENCER_TIMING_CONFIG };
}

function normalizeTransportStepCount(value: number): number {
  if (!Number.isFinite(value)) {
    return sequencerTransportStepsPerBeat(DEFAULT_SEQUENCER_TIMING_CONFIG);
  }
  return Math.max(1, Math.round(value));
}

function resolveTransportStepCount(timing: SequencerTimingConfig): number {
  return sequencerTransportStepsPerBeat(timing);
}

function normalizeSequencerPadLengthBeats(value: unknown): SequencerPadLengthBeats {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded >= 1 && rounded <= 8) {
      return clampSequencerPadLengthBeats(rounded);
    }
    if (rounded === 16) {
      return 4;
    }
    if (rounded === 32) {
      return 8;
    }
  }
  return 4;
}

function normalizeSequencerTrackStepCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return resolvedSequencerPadStepCount(4, DEFAULT_SEQUENCER_TIMING_CONFIG);
  }
  return normalizeTransportStepCount(value);
}

function normalizeDrummerSequencerStepCount(value: unknown): number {
  return normalizeSequencerTrackStepCount(value);
}

function normalizeControllerSequencerLengthBeats(value: unknown): ControllerSequencerPadLengthBeats {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if ((rounded >= 1 && rounded <= 8) || rounded === 16) {
      return clampControllerSequencerPadLengthBeats(rounded);
    }
    if (rounded === 32) {
      return 8;
    }
    if (rounded === 64) {
      return 16;
    }
  }
  return 4;
}

function transportStepCountForPerformanceTracks(
  tracks: SequencerTrackState[],
  drummerTracks: DrummerSequencerTrackState[],
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): number {
  void tracks;
  void drummerTracks;
  return resolveTransportStepCount(timing);
}

function resolvedSequencerPadStepCount(lengthBeats: number, timing: SequencerTimingConfig): number {
  return sequencerPadStepCount(timing, clampSequencerPadLengthBeats(lengthBeats));
}

function resolvedControllerPadStepCount(lengthBeats: number, timing: SequencerTimingConfig): number {
  return sequencerPadStepCount(timing, clampControllerSequencerPadLengthBeats(lengthBeats));
}

function normalizeSequencerTempoBpm(value: unknown): number {
  return clampSequencerTempoBpm(typeof value === "number" ? value : DEFAULT_SEQUENCER_TIMING_CONFIG.tempoBPM);
}

function normalizeSequencerMeterNumeratorValue(value: unknown): SequencerMeterNumerator {
  return clampSequencerMeterNumerator(
    typeof value === "number" ? value : DEFAULT_SEQUENCER_TIMING_CONFIG.meterNumerator
  );
}

function normalizeSequencerMeterDenominatorValue(value: unknown): SequencerMeterDenominator {
  return clampSequencerMeterDenominator(
    typeof value === "number" ? value : DEFAULT_SEQUENCER_TIMING_CONFIG.meterDenominator
  );
}

function normalizeSequencerStepsPerBeatValue(value: unknown): SequencerStepsPerBeat {
  return clampSequencerStepsPerBeat(
    typeof value === "number" ? value : DEFAULT_SEQUENCER_TIMING_CONFIG.stepsPerBeat
  );
}

function normalizeSequencerInstanceTiming(
  raw: Record<string, unknown>,
  fallback: SequencerTimingConfig
): SequencerTimingConfig {
  return normalizeSequencerTiming(
    raw.timing ?? {
      tempoBPM: raw.tempoBPM ?? raw.tempo_bpm ?? fallback.tempoBPM,
      meterNumerator: raw.meterNumerator ?? raw.meter_numerator ?? fallback.meterNumerator,
      meterDenominator: raw.meterDenominator ?? raw.meter_denominator ?? fallback.meterDenominator,
      stepsPerBeat: raw.stepsPerBeat ?? raw.steps_per_beat ?? fallback.stepsPerBeat,
      beatRateNumerator: raw.beatRateNumerator ?? raw.beat_rate_numerator ?? fallback.beatRateNumerator,
      beatRateDenominator: raw.beatRateDenominator ?? raw.beat_rate_denominator ?? fallback.beatRateDenominator
    }
  );
}

function createEmptySequencerStep(): SequencerStepState {
  return {
    note: null,
    chord: "none",
    hold: false,
    velocity: 127
  };
}

function cloneSequencerStep(step: SequencerStepState): SequencerStepState {
  return {
    note: step.note,
    chord: normalizeSequencerChord(step.chord),
    hold: step.hold,
    velocity: step.velocity
  };
}

function defaultSequencerSteps(): SequencerStepState[] {
  return Array.from({ length: 128 }, () => createEmptySequencerStep());
}

const DEFAULT_SEQUENCER_STEPS: SequencerStepState[] = defaultSequencerSteps();

function cloneSequencerSteps(steps: SequencerStepState[]): SequencerStepState[] {
  return steps.map((step) => cloneSequencerStep(step));
}

function normalizeStepNote(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clampInt(value, 0, 127);
}

function normalizeStepHold(value: unknown): boolean {
  return value === true;
}

function normalizeStepVelocity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 127;
  }
  return clampInt(value, 0, 127);
}

function createEmptyDrummerSequencerCell(): DrummerSequencerCellState {
  return {
    active: false,
    velocity: 127
  };
}

function cloneDrummerSequencerCell(cell: DrummerSequencerCellState): DrummerSequencerCellState {
  return {
    active: cell.active === true,
    velocity: normalizeStepVelocity(cell.velocity)
  };
}

function defaultDrummerSequencerCells(): DrummerSequencerCellState[] {
  return Array.from({ length: 128 }, () => createEmptyDrummerSequencerCell());
}

const DEFAULT_DRUMMER_SEQUENCER_CELLS: DrummerSequencerCellState[] = defaultDrummerSequencerCells();

function cloneDrummerSequencerCells(cells: DrummerSequencerCellState[]): DrummerSequencerCellState[] {
  return cells.map((cell) => cloneDrummerSequencerCell(cell));
}

function normalizeDrummerSequencerKey(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 36;
  }
  return clampInt(value, 0, 127);
}

function normalizeDrummerSequencerCell(raw: unknown): DrummerSequencerCellState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return {
        active: true,
        velocity: normalizeStepVelocity(raw)
      };
    }
    if (raw === true) {
      return { active: true, velocity: 127 };
    }
    return createEmptyDrummerSequencerCell();
  }
  const cell = raw as Record<string, unknown>;
  return {
    active: cell.active === true || cell.on === true || cell.enabled === true,
    velocity: normalizeStepVelocity(cell.velocity ?? cell.vel)
  };
}

function normalizeDrummerSequencerRowPadState(
  raw: unknown,
  fallbackRowId: string
): DrummerSequencerPadRowState {
  let rowId = fallbackRowId;
  let rawSteps: unknown = null;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    if (typeof row.rowId === "string" && row.rowId.trim().length > 0) {
      rowId = row.rowId;
    } else if (typeof row.row_id === "string" && row.row_id.trim().length > 0) {
      rowId = row.row_id;
    }
    rawSteps = row.steps;
  } else {
    rawSteps = raw;
  }

  const steps = cloneDrummerSequencerCells(DEFAULT_DRUMMER_SEQUENCER_CELLS);
  if (Array.isArray(rawSteps)) {
    for (let index = 0; index < Math.min(STEP_CAPACITY, rawSteps.length); index += 1) {
      steps[index] = normalizeDrummerSequencerCell(rawSteps[index]);
    }
  }

  return {
    rowId,
    steps
  };
}

function defaultDrummerSequencerRows(
  keys: readonly number[] = DEFAULT_DRUMMER_ROW_KEYS
): DrummerSequencerRowState[] {
  return keys.map((key, index) => ({
    id: `drum-row-${index + 1}`,
    key: normalizeDrummerSequencerKey(key)
  }));
}

function cloneDrummerSequencerRows(rows: DrummerSequencerRowState[]): DrummerSequencerRowState[] {
  return rows.map((row, index) => ({
    id: typeof row.id === "string" && row.id.trim().length > 0 ? row.id : `drum-row-${index + 1}`,
    key: normalizeDrummerSequencerKey(row.key)
  }));
}

function buildDefaultDrummerSequencerPad(
  rows: DrummerSequencerRowState[],
  lengthBeats: DrummerSequencerStepCount = 4,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): DrummerSequencerPadState {
  const normalizedLengthBeats = normalizeSequencerPadLengthBeats(lengthBeats);
  return {
    lengthBeats: normalizedLengthBeats,
    stepCount: resolvedSequencerPadStepCount(normalizedLengthBeats, timing),
    rows: rows.map((row) => ({
      rowId: row.id,
      steps: cloneDrummerSequencerCells(DEFAULT_DRUMMER_SEQUENCER_CELLS)
    }))
  };
}

function defaultDrummerSequencerPads(
  rows: DrummerSequencerRowState[],
  lengthBeats: DrummerSequencerStepCount = 4,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): DrummerSequencerPadState[] {
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => buildDefaultDrummerSequencerPad(rows, lengthBeats, timing));
}

function cloneDrummerSequencerPads(pads: DrummerSequencerPadState[]): DrummerSequencerPadState[] {
  return pads.map((pad) => ({
    lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
    stepCount: normalizeTransportStepCount(pad.stepCount),
    rows: Array.isArray(pad.rows)
      ? pad.rows.map((row) => ({
          rowId: row.rowId,
          steps: cloneDrummerSequencerCells(row.steps)
        }))
      : []
  }));
}

function alignDrummerPadRowsToTrackRows(
  pad: DrummerSequencerPadState,
  trackRows: DrummerSequencerRowState[]
): DrummerSequencerPadState {
  const byRowId = new Map(pad.rows.map((row) => [row.rowId, row]));
  return {
    lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
    stepCount: normalizeTransportStepCount(pad.stepCount),
    rows: trackRows.map((trackRow) =>
      normalizeDrummerSequencerRowPadState(byRowId.get(trackRow.id) ?? null, trackRow.id)
    )
  };
}

function normalizeSequencerStep(value: unknown): SequencerStepState {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const step = value as Record<string, unknown>;
    return {
      note: normalizeStepNote(step.note ?? step.notes ?? step.value),
      chord: normalizeSequencerChord(step.chord),
      hold: normalizeStepHold(step.hold),
      velocity: normalizeStepVelocity(step.velocity ?? step.vel)
    };
  }

  return {
    note: normalizeStepNote(value),
    chord: "none",
    hold: false,
    velocity: 127
  };
}

function normalizeControllerNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return clampInt(value, 0, 127);
}

function normalizeControllerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return clampInt(value, 0, 127);
}

function normalizePianoRollVelocity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 110;
  }
  return clampInt(value, 0, 127);
}

function normalizeControllerSequencerKeypoint(raw: unknown, fallbackIndex: number): ControllerSequencerKeypoint | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const point = raw as Record<string, unknown>;
  const id =
    typeof point.id === "string" && point.id.trim().length > 0 ? point.id : `kp-${fallbackIndex + 1}`;
  const rawPosition = point.position ?? point.x ?? point.t;
  const rawValue = point.value ?? point.y;
  const position = typeof rawPosition === "number" ? clampControllerCurvePosition(rawPosition) : null;
  const value = typeof rawValue === "number" ? clampControllerCurveValue(rawValue) : null;

  if (position === null || value === null) {
    return null;
  }

  return { id, position, value };
}

function defaultControllerSequencerKeypoints(): ControllerSequencerKeypoint[] {
  return normalizeControllerCurveKeypoints([
    { id: "kp-start", position: 0, value: 0 },
    { id: "kp-end", position: 1, value: 0 }
  ]);
}

function cloneControllerSequencerPad(pad: ControllerSequencerPadState): ControllerSequencerPadState {
  return {
    lengthBeats: normalizeControllerSequencerLengthBeats(pad.lengthBeats),
    stepCount: normalizeTransportStepCount(pad.stepCount),
    keypoints: normalizeControllerCurveKeypoints(pad.keypoints)
  };
}

function defaultControllerSequencerPad(
  lengthBeats: ControllerSequencerPadLengthBeats = 4,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): ControllerSequencerPadState {
  const normalizedLengthBeats = normalizeControllerSequencerLengthBeats(lengthBeats);
  return {
    lengthBeats: normalizedLengthBeats,
    stepCount: resolvedControllerPadStepCount(normalizedLengthBeats, timing),
    keypoints: defaultControllerSequencerKeypoints()
  };
}

function defaultControllerSequencerPads(
  lengthBeats: ControllerSequencerPadLengthBeats = 4,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): ControllerSequencerPadState[] {
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => defaultControllerSequencerPad(lengthBeats, timing));
}

function normalizeControllerSequencerPadState(
  raw: unknown,
  fallback: ControllerSequencerPadState
): ControllerSequencerPadState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const pad = raw as Record<string, unknown>;
  const lengthBeats = normalizeControllerSequencerLengthBeats(
    pad.lengthBeats ?? pad.length_beats ?? pad.stepCount ?? pad.step_count ?? fallback.lengthBeats
  );
  const keypointsRaw = Array.isArray(pad.keypoints) ? pad.keypoints : [];
  const keypoints = normalizeControllerCurveKeypoints(
    keypointsRaw
      .map((entry, keypointIndex) => normalizeControllerSequencerKeypoint(entry, keypointIndex))
      .filter((point): point is ControllerSequencerKeypoint => point !== null)
  );

  return {
    lengthBeats,
    stepCount: fallback.stepCount,
    keypoints: keypoints.length > 0 ? keypoints : normalizeControllerCurveKeypoints(fallback.keypoints)
  };
}

function fallbackControllerSequencerPadStateForSequencer(
  controllerSequencer: Pick<ControllerSequencerState, "lengthBeats" | "stepCount" | "keypoints">
): ControllerSequencerPadState {
  return {
    lengthBeats: normalizeControllerSequencerLengthBeats(controllerSequencer.lengthBeats),
    stepCount: normalizeTransportStepCount(controllerSequencer.stepCount),
    keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints)
  };
}

function defaultSequencerPads(
  scaleRoot: SequencerScaleRoot = "C",
  scaleType: SequencerScaleType = "minor",
  mode: SequencerMode = "aeolian",
  lengthBeats: SequencerPadLengthBeats = 4,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): SequencerPadState[] {
  const normalizedLengthBeats = normalizeSequencerPadLengthBeats(lengthBeats);
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => ({
    lengthBeats: normalizedLengthBeats,
    stepCount: resolvedSequencerPadStepCount(normalizedLengthBeats, timing),
    steps: defaultSequencerSteps(),
    scaleRoot,
    scaleType,
    mode
  }));
}

function normalizePadIndex(value: number): number {
  return clampInt(value, 0, DEFAULT_PAD_COUNT - 1);
}

function normalizePadLoopSequence(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const sequence: number[] = [];
  for (const entry of raw) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      continue;
    }
    const normalizedToken = normalizePadLoopSequenceToken(entry);
    if (normalizedToken === null) {
      continue;
    }
    sequence.push(normalizedToken);
    if (sequence.length >= 256) {
      break;
    }
  }
  return sequence;
}

function normalizePadLoopPatternBundle(
  rawPattern: unknown,
  rawLegacySequence?: unknown
): { padLoopPattern: PadLoopPatternState; padLoopSequence: number[] } {
  const normalized = normalizePadLoopPatternState(rawPattern, rawLegacySequence);
  return {
    padLoopPattern: normalized.pattern,
    padLoopSequence: normalized.compiledSequence
  };
}

function normalizePadLoopPatternForState(
  pattern: PadLoopPatternState
): { padLoopPattern: PadLoopPatternState; padLoopSequence: number[] } {
  const normalized = normalizePadLoopPatternState(pattern);
  return {
    padLoopPattern: normalized.pattern,
    padLoopSequence: normalized.compiledSequence
  };
}

function normalizeRawArrangerLoopSelection(raw: unknown): ArrangerLoopSelection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const selection = raw as Record<string, unknown>;
  const startStep =
    typeof selection.startStep === "number"
      ? selection.startStep
      : typeof selection.start_step === "number"
        ? selection.start_step
        : null;
  const endStep =
    typeof selection.endStep === "number"
      ? selection.endStep
      : typeof selection.end_step === "number"
        ? selection.end_step
        : null;
  if (startStep === null || endStep === null) {
    return null;
  }
  return {
    startStep: Math.max(0, Math.round(startStep)),
    endStep: Math.max(0, Math.round(endStep))
  };
}

function normalizePadSteps(raw: unknown): SequencerStepState[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const steps = cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS);
  for (let index = 0; index < Math.min(128, raw.length); index += 1) {
    steps[index] = normalizeSequencerStep(raw[index]);
  }
  return steps;
}

function normalizeSequencerPadState(
  raw: unknown,
  fallback: SequencerPadState,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): SequencerPadState | null {
  if (Array.isArray(raw)) {
    const steps = normalizePadSteps(raw);
    if (!steps) {
      return null;
    }
    return {
      ...fallback,
      steps
    };
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const pad = raw as Record<string, unknown>;
  const lengthBeats = normalizeSequencerPadLengthBeats(
    pad.lengthBeats ?? pad.length_beats ?? pad.stepCount ?? pad.step_count ?? fallback.lengthBeats
  );
  const steps = normalizePadSteps(pad.steps) ?? cloneSequencerSteps(fallback.steps);
  const scaleRoot =
    pad.scaleRoot === undefined && pad.scale_root === undefined
      ? fallback.scaleRoot
      : normalizeSequencerScaleRoot(pad.scaleRoot ?? pad.scale_root);
  const scaleType =
    pad.scaleType === undefined && pad.scale_type === undefined
      ? fallback.scaleType
      : normalizeSequencerScaleType(pad.scaleType ?? pad.scale_type);
  const fallbackMode = defaultModeForScaleType(scaleType);
  const mode =
    pad.mode === undefined
      ? scaleType === fallback.scaleType
        ? fallback.mode
        : fallbackMode
      : normalizeSequencerMode(pad.mode);

  return {
    lengthBeats,
    stepCount: resolvedSequencerPadStepCount(lengthBeats, timing),
    steps,
    scaleRoot,
    scaleType,
    mode
  };
}

function fallbackSequencerPadStateForTrack(
  track: Pick<SequencerTrackState, "lengthBeats" | "stepCount" | "scaleRoot" | "scaleType" | "mode">,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): SequencerPadState {
  const lengthBeats = normalizeSequencerPadLengthBeats(track.lengthBeats);
  return {
    lengthBeats,
    stepCount: resolvedSequencerPadStepCount(lengthBeats, timing),
    steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
    scaleRoot: track.scaleRoot,
    scaleType: track.scaleType,
    mode: track.mode
  };
}

function fallbackDrummerSequencerPadStateForTrack(
  track: Pick<DrummerSequencerTrackState, "lengthBeats" | "stepCount" | "rows">,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): DrummerSequencerPadState {
  return buildDefaultDrummerSequencerPad(track.rows, normalizeSequencerPadLengthBeats(track.lengthBeats), timing);
}

function defaultSequencerTrack(
  index = 1,
  midiChannel = 1,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): SequencerTrackState {
  const channel = clampInt(midiChannel, 1, 16);
  const scaleRoot: SequencerScaleRoot = "C";
  const scaleType: SequencerScaleType = "minor";
  const mode: SequencerMode = "aeolian";
  const lengthBeats = 4;
  const pads = defaultSequencerPads(scaleRoot, scaleType, mode, lengthBeats, timing);
  return {
    id: `voice-${index}`,
    name: `Melodic Sequencer ${index}`,
    midiChannel: channel,
    timing: normalizeSequencerTiming(timing),
    lengthBeats,
    stepCount: resolvedSequencerPadStepCount(lengthBeats, timing),
    syncToTrackId: null,
    scaleRoot,
    scaleType,
    mode,
    activePad: 0,
    queuedPad: null,
    padLoopPosition: null,
    padLoopEnabled: false,
    padLoopRepeat: true,
    padLoopSequence: [],
    padLoopPattern: createEmptyPadLoopPattern(),
    pads,
    steps: cloneSequencerSteps(pads[0]?.steps ?? DEFAULT_SEQUENCER_STEPS),
    runtimeLocalStep: null,
    enabled: false,
    queuedEnabled: null
  };
}

function defaultDrummerSequencerTrack(
  index = 1,
  midiChannel = 10,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): DrummerSequencerTrackState {
  const channel = clampInt(midiChannel, 1, 16);
  const rows = defaultDrummerSequencerRows();
  const lengthBeats: SequencerPadLengthBeats = 4;
  return {
    id: `drum-${index}`,
    name: `Drummer Sequencer ${index}`,
    midiChannel: channel,
    timing: normalizeSequencerTiming(timing),
    lengthBeats,
    stepCount: resolvedSequencerPadStepCount(lengthBeats, timing),
    activePad: 0,
    queuedPad: null,
    padLoopPosition: null,
    padLoopEnabled: false,
    padLoopRepeat: true,
    padLoopSequence: [],
    padLoopPattern: createEmptyPadLoopPattern(),
    rows,
    pads: defaultDrummerSequencerPads(rows, lengthBeats, timing),
    runtimeLocalStep: null,
    enabled: false,
    queuedEnabled: null
  };
}

function normalizeMidiInputSelection(selection: string | null | undefined, midiInputs: MidiInputRef[]): string | null {
  if (typeof selection !== "string" || selection.trim().length === 0) {
    return null;
  }

  const match = midiInputs.find(
    (input) => input.id === selection || input.selector === selection || input.name === selection
  );
  return match?.id ?? null;
}

function defaultPianoRoll(index = 1, midiChannel = 2): PianoRollState {
  const channel = clampInt(midiChannel, 1, 16);
  return {
    id: `piano-${index}`,
    name: `Piano Roll ${index}`,
    midiChannel: channel,
    velocity: 110,
    scaleRoot: "C",
    scaleType: "minor",
    mode: "aeolian",
    enabled: false
  };
}

function defaultMidiController(index = 1): MidiControllerState {
  return {
    id: `cc-${index}`,
    name: `Controller ${index}`,
    controllerNumber: clampInt(index - 1, 0, 127),
    value: 0,
    enabled: false
  };
}

function defaultMidiControllers(count = MAX_MIDI_CONTROLLERS): MidiControllerState[] {
  return Array.from({ length: count }, (_, index) => defaultMidiController(index + 1));
}

function defaultControllerSequencer(
  index = 1,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): ControllerSequencerState {
  const pads = defaultControllerSequencerPads(4, timing);
  const activePad = 0;
  const activePadState = pads[activePad] ?? defaultControllerSequencerPad(4, timing);
  return {
    id: `cc-seq-${index}`,
    name: `Controller Sequencer ${index}`,
    controllerNumber: clampInt(index - 1, 0, 127),
    timing: normalizeSequencerTiming(timing),
    lengthBeats: activePadState.lengthBeats,
    stepCount: activePadState.stepCount,
    activePad,
    queuedPad: null,
    padLoopPosition: null,
    padLoopEnabled: false,
    padLoopRepeat: true,
    padLoopSequence: [],
    padLoopPattern: createEmptyPadLoopPattern(),
    pads,
    runtimePadStartSubunit: null,
    enabled: false,
    keypoints: normalizeControllerCurveKeypoints(activePadState.keypoints)
  };
}

function normalizeControllerSequencerState(
  raw: unknown,
  index: number,
  timing: SequencerTimingConfig
): ControllerSequencerState {
  const fallback = defaultControllerSequencer(index, timing);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const controllerSequencer = raw as Record<string, unknown>;
  const controllerTiming = normalizeSequencerInstanceTiming(controllerSequencer, timing);
  const id =
    typeof controllerSequencer.id === "string" && controllerSequencer.id.length > 0
      ? controllerSequencer.id
      : fallback.id;
  const name =
    typeof controllerSequencer.name === "string" && controllerSequencer.name.trim().length > 0
      ? controllerSequencer.name
      : fallback.name;
  const controllerNumber = normalizeControllerNumber(controllerSequencer.controllerNumber);
  const lengthBeats = normalizeControllerSequencerLengthBeats(
    controllerSequencer.lengthBeats ??
      controllerSequencer.length_beats ??
      controllerSequencer.stepCount ??
      controllerSequencer.step_count ??
      fallback.lengthBeats
  );
  const activePadRaw = controllerSequencer.activePad ?? controllerSequencer.active_pad;
  const activePad = typeof activePadRaw === "number" ? normalizePadIndex(activePadRaw) : 0;
  const queuedPadRaw = controllerSequencer.queuedPad ?? controllerSequencer.queued_pad;
  const queuedPad = typeof queuedPadRaw === "number" ? normalizePadIndex(queuedPadRaw) : null;
  const rawPadLoopPosition = controllerSequencer.padLoopPosition ?? controllerSequencer.pad_loop_position;
  const padLoopPosition =
    typeof rawPadLoopPosition === "number" && Number.isFinite(rawPadLoopPosition)
      ? Math.max(0, Math.round(rawPadLoopPosition))
      : null;
  const padLoopEnabled =
    controllerSequencer.padLoopEnabled === undefined && controllerSequencer.pad_loop_enabled === undefined
      ? fallback.padLoopEnabled
      : (controllerSequencer.padLoopEnabled ?? controllerSequencer.pad_loop_enabled) === true;
  const padLoopRepeat =
    controllerSequencer.padLoopRepeat === undefined && controllerSequencer.pad_loop_repeat === undefined
      ? fallback.padLoopRepeat
      : (controllerSequencer.padLoopRepeat ?? controllerSequencer.pad_loop_repeat) !== false;
  const { padLoopPattern, padLoopSequence } = normalizePadLoopPatternBundle(
    controllerSequencer.padLoopPattern ?? controllerSequencer.pad_loop_pattern,
    controllerSequencer.padLoopSequence ?? controllerSequencer.pad_loop_sequence
  );
  const enabled = typeof controllerSequencer.enabled === "boolean" ? controllerSequencer.enabled : fallback.enabled;

  const pads = defaultControllerSequencerPads(lengthBeats, controllerTiming);
  if (Array.isArray(controllerSequencer.pads)) {
    for (let padIndex = 0; padIndex < Math.min(DEFAULT_PAD_COUNT, controllerSequencer.pads.length); padIndex += 1) {
      const normalizedPad = normalizeControllerSequencerPadState(controllerSequencer.pads[padIndex], pads[padIndex]);
      if (normalizedPad) {
        normalizedPad.stepCount = resolvedControllerPadStepCount(normalizedPad.lengthBeats, controllerTiming);
        pads[padIndex] = normalizedPad;
      }
    }
  } else {
    const keypointsRaw = Array.isArray(controllerSequencer.keypoints) ? controllerSequencer.keypoints : [];
    const keypoints = normalizeControllerCurveKeypoints(
      keypointsRaw
        .map((entry, keypointIndex) => normalizeControllerSequencerKeypoint(entry, keypointIndex))
        .filter((point): point is ControllerSequencerKeypoint => point !== null)
    );
    pads[0] = {
      lengthBeats,
      stepCount: resolvedControllerPadStepCount(lengthBeats, controllerTiming),
      keypoints
    };
  }

  const activePadState = pads[activePad] ?? pads[0] ?? defaultControllerSequencerPad(lengthBeats, controllerTiming);
  const runtimePadStartSubunitRaw = controllerSequencer.runtimePadStartSubunit ?? controllerSequencer.runtime_pad_start_subunit;
  const runtimePadStartSubunit =
    typeof runtimePadStartSubunitRaw === "number" && Number.isFinite(runtimePadStartSubunitRaw)
      ? runtimePadStartSubunitRaw
      : null;

  return {
    id,
    name,
    controllerNumber,
    timing: controllerTiming,
    lengthBeats: activePadState.lengthBeats,
    stepCount: activePadState.stepCount,
    activePad,
    queuedPad,
    padLoopPosition,
    padLoopEnabled,
    padLoopRepeat,
    padLoopSequence,
    padLoopPattern,
    pads: pads.map((pad) => cloneControllerSequencerPad(pad)),
    runtimePadStartSubunit,
    enabled,
    keypoints: normalizeControllerCurveKeypoints(activePadState.keypoints)
  };
}

function defaultSequencerState(): SequencerState {
  const timing = defaultSequencerTiming();
  return {
    isPlaying: false,
    timing,
    stepCount: resolveTransportStepCount(timing),
    playhead: 0,
    cycle: 0,
    arrangerLoopSelection: null,
    tracks: [defaultSequencerTrack(1, 1, timing)],
    drummerTracks: [],
    controllerSequencers: [],
    pianoRolls: [defaultPianoRoll(1, 2)],
    midiControllers: defaultMidiControllers()
  };
}

function sequencerRuntimeStateFromSequencer(sequencer: SequencerState): SequencerRuntimeState {
  const trackLocalStepById: Record<string, number | null> = {};
  for (const track of sequencer.tracks) {
    trackLocalStepById[track.id] =
      typeof track.runtimeLocalStep === "number" && Number.isFinite(track.runtimeLocalStep)
        ? Math.max(0, Math.round(track.runtimeLocalStep))
        : null;
  }

  const drummerTrackLocalStepById: Record<string, number | null> = {};
  for (const track of sequencer.drummerTracks) {
    drummerTrackLocalStepById[track.id] =
      typeof track.runtimeLocalStep === "number" && Number.isFinite(track.runtimeLocalStep)
        ? Math.max(0, Math.round(track.runtimeLocalStep))
        : null;
  }

  const controllerRuntimePadStartSubunitById: Record<string, number | null> = {};
  for (const controllerSequencer of sequencer.controllerSequencers) {
    controllerRuntimePadStartSubunitById[controllerSequencer.id] =
      typeof controllerSequencer.runtimePadStartSubunit === "number" && Number.isFinite(controllerSequencer.runtimePadStartSubunit)
        ? Math.max(0, Math.floor(controllerSequencer.runtimePadStartSubunit))
        : null;
  }

  const stepCount = normalizeTransportStepCount(sequencer.stepCount);
  return {
    isPlaying: sequencer.isPlaying === true,
    stepCount,
    playhead: Math.max(0, Math.round(sequencer.playhead)) % stepCount,
    cycle: Math.max(0, Math.round(sequencer.cycle)),
    transportSubunit:
      Math.max(0, Math.round(sequencer.cycle)) * stepCount * sequencerTransportSubunitsPerStep() +
      (Math.max(0, Math.round(sequencer.playhead)) % stepCount) * sequencerTransportSubunitsPerStep(),
    trackLocalStepById,
    drummerTrackLocalStepById,
    controllerRuntimePadStartSubunitById
  };
}

function syncSequencerTrackTiming(track: SequencerTrackState, timing = track.timing): SequencerTrackState {
  const nextTiming = normalizeSequencerTiming(timing);
  const pads = track.pads.map((pad) => ({
    ...pad,
    lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
    stepCount: resolvedSequencerPadStepCount(pad.lengthBeats, nextTiming)
  }));
  const activePad = normalizePadIndex(track.activePad);
  const activePadState = pads[activePad] ?? pads[0] ?? fallbackSequencerPadStateForTrack(track, nextTiming);
  return {
    ...track,
    timing: nextTiming,
    lengthBeats: activePadState.lengthBeats,
    stepCount: activePadState.stepCount,
    scaleRoot: activePadState.scaleRoot,
    scaleType: activePadState.scaleType,
    mode: activePadState.mode,
    pads,
    steps: cloneSequencerSteps(activePadState.steps)
  };
}

function syncDrummerTrackTiming(track: DrummerSequencerTrackState, timing = track.timing): DrummerSequencerTrackState {
  const nextTiming = normalizeSequencerTiming(timing);
  const pads = track.pads.map((pad) =>
    alignDrummerPadRowsToTrackRows(
      {
        ...pad,
        lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
        stepCount: resolvedSequencerPadStepCount(pad.lengthBeats, nextTiming)
      },
      track.rows
    )
  );
  const activePad = normalizePadIndex(track.activePad);
  const activePadState = pads[activePad] ?? pads[0] ?? fallbackDrummerSequencerPadStateForTrack(track, nextTiming);
  return {
    ...track,
    timing: nextTiming,
    lengthBeats: activePadState.lengthBeats,
    stepCount: activePadState.stepCount,
    pads
  };
}

function syncControllerSequencerTiming(
  controllerSequencer: ControllerSequencerState,
  timing = controllerSequencer.timing
): ControllerSequencerState {
  const nextTiming = normalizeSequencerTiming(timing);
  const pads = controllerSequencer.pads.map((pad) => ({
    ...pad,
    lengthBeats: normalizeControllerSequencerLengthBeats(pad.lengthBeats),
    stepCount: resolvedControllerPadStepCount(pad.lengthBeats, nextTiming)
  }));
  const activePad = normalizePadIndex(controllerSequencer.activePad);
  const activePadState =
    pads[activePad] ?? pads[0] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
  return {
    ...controllerSequencer,
    timing: nextTiming,
    lengthBeats: activePadState.lengthBeats,
    stepCount: activePadState.stepCount,
    pads,
    keypoints: normalizeControllerCurveKeypoints(activePadState.keypoints)
  };
}

function syncSequencerTimingState(sequencer: SequencerState, timing: SequencerTimingConfig): SequencerState {
  const absoluteStep = sequencer.cycle * Math.max(1, sequencer.stepCount) + sequencer.playhead;
  const nextStepCount = resolveTransportStepCount(timing);
  const position = transportPositionFromAbsoluteStep(absoluteStep, nextStepCount);
  return {
    ...sequencer,
    timing,
    stepCount: nextStepCount,
    playhead: position.playhead,
    cycle: position.cycle,
    tracks: sequencer.tracks.map((track) =>
      syncSequencerTrackTiming(track, {
        ...track.timing,
        tempoBPM: timing.tempoBPM
      })
    ),
    drummerTracks: sequencer.drummerTracks.map((track) =>
      syncDrummerTrackTiming(track, {
        ...track.timing,
        tempoBPM: timing.tempoBPM
      })
    ),
    controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
      syncControllerSequencerTiming(controllerSequencer, {
        ...controllerSequencer.timing,
        tempoBPM: timing.tempoBPM
      })
    )
  };
}

function mergeSequencerTiming(
  timing: SequencerTimingConfig,
  update: Partial<SequencerTimingConfig>
): SequencerTimingConfig {
  return normalizeSequencerTiming({
    ...timing,
    ...update
  });
}

function updateSequencerTrackTimingState(
  track: SequencerTrackState,
  update: Partial<SequencerTimingConfig>
): SequencerTrackState {
  const nextTiming = mergeSequencerTiming(track.timing, update);
  return syncSequencerTrackTiming({ ...track, timing: nextTiming }, nextTiming);
}

function updateDrummerTrackTimingState(
  track: DrummerSequencerTrackState,
  update: Partial<SequencerTimingConfig>
): DrummerSequencerTrackState {
  const nextTiming = mergeSequencerTiming(track.timing, update);
  return syncDrummerTrackTiming({ ...track, timing: nextTiming }, nextTiming);
}

function updateControllerSequencerTimingState(
  controllerSequencer: ControllerSequencerState,
  update: Partial<SequencerTimingConfig>
): ControllerSequencerState {
  const nextTiming = mergeSequencerTiming(controllerSequencer.timing, update);
  return syncControllerSequencerTiming({ ...controllerSequencer, timing: nextTiming }, nextTiming);
}

function emptyPerformanceSequencerState(): SequencerState {
  return {
    ...defaultSequencerState(),
    isPlaying: false,
    playhead: 0,
    cycle: 0,
    arrangerLoopSelection: null,
    tracks: [],
    drummerTracks: [],
    controllerSequencers: [],
    pianoRolls: [],
    midiControllers: []
  };
}

function performanceDeviceCount(sequencer: SequencerState): number {
  return (
    sequencer.tracks.length +
    sequencer.drummerTracks.length +
    sequencer.controllerSequencers.length +
    sequencer.pianoRolls.length +
    sequencer.midiControllers.length
  );
}

function normalizeSequencerTrack(raw: unknown, index: number): SequencerTrackState {
  return normalizeSequencerTrackWithTiming(raw, index, DEFAULT_SEQUENCER_TIMING_CONFIG);
}

function normalizeSequencerTrackWithTiming(
  raw: unknown,
  index: number,
  timing: SequencerTimingConfig
): SequencerTrackState {
  const fallback = defaultSequencerTrack(index, index, timing);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const track = raw as Record<string, unknown>;
  const trackTiming = normalizeSequencerInstanceTiming(track, timing);
  const id =
    typeof track.id === "string" && track.id.length > 0
      ? track.id
      : typeof track.trackId === "string" && track.trackId.length > 0
        ? track.trackId
        : fallback.id;
  const name = typeof track.name === "string" && track.name.trim().length > 0 ? track.name : fallback.name;
  const midiChannel =
    typeof track.midiChannel === "number" ? clampInt(track.midiChannel, 1, 16) : fallback.midiChannel;
  const scaleRoot = normalizeSequencerScaleRoot(track.scaleRoot);
  const scaleType = normalizeSequencerScaleType(track.scaleType);
  const fallbackMode = defaultModeForScaleType(scaleType);
  const mode = track.mode !== undefined ? normalizeSequencerMode(track.mode) : fallbackMode;
  const lengthBeats = normalizeSequencerPadLengthBeats(
    track.lengthBeats ?? track.length_beats ?? track.stepCount ?? track.step_count ?? fallback.lengthBeats
  );
  const rawSyncToTrackId = track.syncToTrackId ?? track.sync_to_track_id;
  const syncToTrackId =
    typeof rawSyncToTrackId === "string" && rawSyncToTrackId.trim().length > 0 ? rawSyncToTrackId : null;
  const activePad = typeof track.activePad === "number" ? normalizePadIndex(track.activePad) : fallback.activePad;
  const queuedPad = typeof track.queuedPad === "number" ? normalizePadIndex(track.queuedPad) : null;
  const rawPadLoopPosition = track.padLoopPosition ?? track.pad_loop_position;
  const padLoopPosition =
    typeof rawPadLoopPosition === "number" && Number.isFinite(rawPadLoopPosition)
      ? Math.max(0, Math.round(rawPadLoopPosition))
      : null;
  const padLoopEnabled =
    track.padLoopEnabled === undefined && track.pad_loop_enabled === undefined
      ? fallback.padLoopEnabled
      : (track.padLoopEnabled ?? track.pad_loop_enabled) === true;
  const padLoopRepeat =
    track.padLoopRepeat === undefined && track.pad_loop_repeat === undefined
      ? fallback.padLoopRepeat
      : (track.padLoopRepeat ?? track.pad_loop_repeat) !== false;
  const { padLoopPattern, padLoopSequence } = normalizePadLoopPatternBundle(
    track.padLoopPattern ?? track.pad_loop_pattern,
    track.padLoopSequence ?? track.pad_loop_sequence
  );
  const enabled = typeof track.enabled === "boolean" ? track.enabled : fallback.enabled;
  const queuedEnabled = typeof track.queuedEnabled === "boolean" ? track.queuedEnabled : null;

  const pads = defaultSequencerPads(scaleRoot, scaleType, mode, lengthBeats, trackTiming);
  if (Array.isArray(track.pads)) {
    for (let padIndex = 0; padIndex < Math.min(DEFAULT_PAD_COUNT, track.pads.length); padIndex += 1) {
      const normalized = normalizeSequencerPadState(track.pads[padIndex], pads[padIndex], trackTiming);
      if (normalized) {
        pads[padIndex] = normalized;
      }
    }
  } else if (Array.isArray(track.steps)) {
    const legacy = normalizePadSteps(track.steps);
    if (legacy) {
      pads[0] = {
        ...pads[0],
        steps: legacy
      };
    }
  }

  const activePadTheory =
    pads[activePad] ??
    pads[0] ?? {
      lengthBeats,
      stepCount: resolvedSequencerPadStepCount(lengthBeats, trackTiming),
      steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
      scaleRoot,
      scaleType,
      mode
    };

  return {
    id,
    name,
    midiChannel,
    timing: trackTiming,
    lengthBeats: activePadTheory.lengthBeats,
    stepCount: normalizeTransportStepCount(activePadTheory.stepCount),
    syncToTrackId,
    scaleRoot: activePadTheory.scaleRoot,
    scaleType: activePadTheory.scaleType,
    mode: activePadTheory.mode,
    activePad,
    queuedPad,
    padLoopPosition,
    padLoopEnabled,
    padLoopRepeat,
    padLoopSequence,
    padLoopPattern,
    pads,
    steps: cloneSequencerSteps(activePadTheory.steps),
    runtimeLocalStep: null,
    enabled,
    queuedEnabled
  };
}

function normalizeDrummerSequencerTrack(
  raw: unknown,
  index: number,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): DrummerSequencerTrackState {
  const fallback = defaultDrummerSequencerTrack(index, index === 1 ? 10 : index, timing);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const track = raw as Record<string, unknown>;
  const trackTiming = normalizeSequencerInstanceTiming(track, timing);
  const id =
    typeof track.id === "string" && track.id.length > 0
      ? track.id
      : typeof track.trackId === "string" && track.trackId.length > 0
        ? track.trackId
        : fallback.id;
  const name = typeof track.name === "string" && track.name.trim().length > 0 ? track.name : fallback.name;
  const midiChannel =
    typeof track.midiChannel === "number" ? clampInt(track.midiChannel, 1, 16) : fallback.midiChannel;
  const lengthBeats = normalizeSequencerPadLengthBeats(
    track.lengthBeats ?? track.length_beats ?? track.stepCount ?? track.step_count ?? fallback.lengthBeats
  );
  const activePad = typeof track.activePad === "number" ? normalizePadIndex(track.activePad) : fallback.activePad;
  const queuedPad = typeof track.queuedPad === "number" ? normalizePadIndex(track.queuedPad) : null;
  const rawPadLoopPosition = track.padLoopPosition ?? track.pad_loop_position;
  const padLoopPosition =
    typeof rawPadLoopPosition === "number" && Number.isFinite(rawPadLoopPosition)
      ? Math.max(0, Math.round(rawPadLoopPosition))
      : null;
  const padLoopEnabled =
    track.padLoopEnabled === undefined && track.pad_loop_enabled === undefined
      ? fallback.padLoopEnabled
      : (track.padLoopEnabled ?? track.pad_loop_enabled) === true;
  const padLoopRepeat =
    track.padLoopRepeat === undefined && track.pad_loop_repeat === undefined
      ? fallback.padLoopRepeat
      : (track.padLoopRepeat ?? track.pad_loop_repeat) !== false;
  const { padLoopPattern, padLoopSequence } = normalizePadLoopPatternBundle(
    track.padLoopPattern ?? track.pad_loop_pattern,
    track.padLoopSequence ?? track.pad_loop_sequence
  );
  const enabled = typeof track.enabled === "boolean" ? track.enabled : fallback.enabled;
  const queuedEnabled = typeof track.queuedEnabled === "boolean" ? track.queuedEnabled : null;

  const rowsFallback = cloneDrummerSequencerRows(fallback.rows);
  const parsedRows: DrummerSequencerRowState[] = [];
  if (Array.isArray(track.rows)) {
    for (let rowIndex = 0; rowIndex < Math.min(64, track.rows.length); rowIndex += 1) {
      const rawRow = track.rows[rowIndex];
      if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
        continue;
      }
      const row = rawRow as Record<string, unknown>;
      parsedRows.push({
        id:
          typeof row.id === "string" && row.id.trim().length > 0
            ? row.id
            : `drum-row-${rowIndex + 1}`,
        key: normalizeDrummerSequencerKey(row.key ?? row.note ?? row.midiNote ?? row.midi_note)
      });
    }
  }
  const sourceRows = parsedRows.length > 0 ? parsedRows : rowsFallback;
  const rows = (() => {
    const seen = new Set<string>();
    return sourceRows.map((row, rowIndex) => {
      let nextId = row.id.trim().length > 0 ? row.id : `drum-row-${rowIndex + 1}`;
      if (seen.has(nextId)) {
        nextId = `${nextId}-${rowIndex + 1}`;
      }
      seen.add(nextId);
      return {
        id: nextId,
        key: normalizeDrummerSequencerKey(row.key)
      };
    });
  })();

  const pads = defaultDrummerSequencerPads(rows, lengthBeats, trackTiming);
  if (Array.isArray(track.pads)) {
    for (let padIndex = 0; padIndex < Math.min(DEFAULT_PAD_COUNT, track.pads.length); padIndex += 1) {
      const rawPad = track.pads[padIndex];
      let rawPadRows: unknown[] = [];
      let padLengthBeats = normalizeSequencerPadLengthBeats(pads[padIndex]?.lengthBeats ?? lengthBeats);
      if (Array.isArray(rawPad)) {
        rawPadRows = rawPad;
      } else if (rawPad && typeof rawPad === "object" && !Array.isArray(rawPad)) {
        const candidate = rawPad as Record<string, unknown>;
        padLengthBeats = normalizeSequencerPadLengthBeats(
          candidate.lengthBeats ?? candidate.length_beats ?? candidate.stepCount ?? candidate.step_count ?? padLengthBeats
        );
        rawPadRows = Array.isArray(candidate.rows) ? candidate.rows : [];
      }

      const byRowId = new Map<string, unknown>();
      for (let rowIndex = 0; rowIndex < rawPadRows.length; rowIndex += 1) {
        const rawPadRow = rawPadRows[rowIndex];
        let rowId = rows[rowIndex]?.id ?? `drum-row-${rowIndex + 1}`;
        if (rawPadRow && typeof rawPadRow === "object" && !Array.isArray(rawPadRow)) {
          const candidate = rawPadRow as Record<string, unknown>;
          if (typeof candidate.rowId === "string" && candidate.rowId.trim().length > 0) {
            rowId = candidate.rowId;
          } else if (typeof candidate.row_id === "string" && candidate.row_id.trim().length > 0) {
            rowId = candidate.row_id;
          }
        }
        byRowId.set(rowId, rawPadRow);
      }

      pads[padIndex] = {
        lengthBeats: padLengthBeats,
        stepCount: resolvedSequencerPadStepCount(padLengthBeats, trackTiming),
        rows: rows.map((row) => normalizeDrummerSequencerRowPadState(byRowId.get(row.id) ?? null, row.id))
      };
    }
  }

  const activePadState =
    pads[activePad] ??
    pads[0] ??
    fallbackDrummerSequencerPadStateForTrack({ lengthBeats, stepCount: 0, rows }, trackTiming);

  return {
    id,
    name,
    midiChannel,
    timing: trackTiming,
    lengthBeats: activePadState.lengthBeats,
    stepCount: normalizeTransportStepCount(activePadState.stepCount),
    activePad,
    queuedPad,
    padLoopPosition,
    padLoopEnabled,
    padLoopRepeat,
    padLoopSequence,
    padLoopPattern,
    rows,
    pads: pads.map((pad) => alignDrummerPadRowsToTrackRows(pad, rows)),
    runtimeLocalStep: null,
    enabled,
    queuedEnabled
  };
}

function normalizePianoRollState(raw: unknown, index: number): PianoRollState {
  const fallback = defaultPianoRoll(index, index + 1);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const roll = raw as Record<string, unknown>;
  const id = typeof roll.id === "string" && roll.id.length > 0 ? roll.id : fallback.id;
  const name = typeof roll.name === "string" && roll.name.trim().length > 0 ? roll.name : fallback.name;
  const midiChannel =
    typeof roll.midiChannel === "number" ? clampInt(roll.midiChannel, 1, 16) : fallback.midiChannel;
  const velocity = normalizePianoRollVelocity(roll.velocity);
  const scaleRoot = normalizeSequencerScaleRoot(roll.scaleRoot);
  const scaleType = normalizeSequencerScaleType(roll.scaleType);
  const fallbackMode = defaultModeForScaleType(scaleType);
  const mode = roll.mode !== undefined ? normalizeSequencerMode(roll.mode) : fallbackMode;
  const enabled = typeof roll.enabled === "boolean" ? roll.enabled : fallback.enabled;

  return {
    id,
    name,
    midiChannel,
    velocity,
    scaleRoot,
    scaleType,
    mode,
    enabled
  };
}

function normalizeMidiControllerState(raw: unknown, index: number): MidiControllerState {
  const fallback = defaultMidiController(index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const controller = raw as Record<string, unknown>;
  const id = typeof controller.id === "string" && controller.id.length > 0 ? controller.id : fallback.id;
  const name =
    typeof controller.name === "string" && controller.name.trim().length > 0 ? controller.name : fallback.name;
  const controllerNumber = normalizeControllerNumber(controller.controllerNumber);
  const value = normalizeControllerValue(controller.value);
  const enabled = typeof controller.enabled === "boolean" ? controller.enabled : fallback.enabled;

  return {
    id,
    name,
    controllerNumber,
    value,
    enabled
  };
}

function normalizeSequencerState(raw: unknown): SequencerState {
  const defaults = defaultSequencerState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const sequencer = raw as Record<string, unknown>;
  const timing = normalizeSequencerTiming(
    sequencer.timing ?? {
      tempoBPM: sequencer.tempoBPM ?? sequencer.tempo_bpm ?? sequencer.bpm,
      meterNumerator: sequencer.meterNumerator ?? sequencer.meter_numerator,
      meterDenominator: sequencer.meterDenominator ?? sequencer.meter_denominator,
      stepsPerBeat: sequencer.stepsPerBeat ?? sequencer.steps_per_beat
    }
  );
  const playhead = typeof sequencer.playhead === "number" ? Math.max(0, Math.round(sequencer.playhead)) : 0;

  const tracks: SequencerTrackState[] = [];
  const rawTracks = Array.isArray(sequencer.tracks) ? sequencer.tracks : null;
  const hasTracks = rawTracks !== null;
  if (rawTracks) {
    for (let index = 0; index < Math.min(8, rawTracks.length); index += 1) {
      tracks.push(normalizeSequencerTrackWithTiming(rawTracks[index], index + 1, timing));
    }
  } else {
    tracks.push(normalizeSequencerTrackWithTiming(sequencer, 1, timing));
  }
  const validTrackIds = new Set(tracks.map((track) => track.id));
  for (const track of tracks) {
    if (track.syncToTrackId === null) {
      continue;
    }
    if (track.syncToTrackId === track.id || !validTrackIds.has(track.syncToTrackId)) {
      track.syncToTrackId = null;
    }
  }

  const drummerTracks: DrummerSequencerTrackState[] = [];
  if (Array.isArray(sequencer.drummerTracks)) {
    for (let index = 0; index < Math.min(8, sequencer.drummerTracks.length); index += 1) {
      drummerTracks.push(normalizeDrummerSequencerTrack(sequencer.drummerTracks[index], index + 1, timing));
    }
  }

  const pianoRolls: PianoRollState[] = [];
  const rawPianoRolls = Array.isArray(sequencer.pianoRolls) ? sequencer.pianoRolls : null;
  const hasPianoRolls = rawPianoRolls !== null;
  if (rawPianoRolls) {
    for (let index = 0; index < Math.min(8, rawPianoRolls.length); index += 1) {
      pianoRolls.push(normalizePianoRollState(rawPianoRolls[index], index + 1));
    }
  } else {
    pianoRolls.push(
      normalizePianoRollState(
        {
          id: "piano-1",
          name: "Piano Roll 1",
          midiChannel: sequencer.pianoRollMidiChannel,
          scaleRoot: sequencer.pianoRollScaleRoot,
          scaleType: sequencer.pianoRollScaleType,
          mode: sequencer.pianoRollMode,
          enabled: false
        },
        1
      )
    );
  }

  const midiControllers: MidiControllerState[] = [];
  const rawMidiControllers = Array.isArray(sequencer.midiControllers) ? sequencer.midiControllers : null;
  const hasMidiControllers = rawMidiControllers !== null;
  if (rawMidiControllers) {
    for (let index = 0; index < Math.min(MAX_MIDI_CONTROLLERS, rawMidiControllers.length); index += 1) {
      midiControllers.push(normalizeMidiControllerState(rawMidiControllers[index], index + 1));
    }
  }

  const controllerSequencers: ControllerSequencerState[] = [];
  if (Array.isArray(sequencer.controllerSequencers)) {
    for (let index = 0; index < Math.min(8, sequencer.controllerSequencers.length); index += 1) {
      controllerSequencers.push(
        normalizeControllerSequencerState(sequencer.controllerSequencers[index], index + 1, timing)
      );
    }
  }

  const trackList = hasTracks ? tracks : defaults.tracks;
  const seenTrackIds = new Set<string>();
  const normalizedTracks = trackList.map((track, index) => {
    let nextId = track.id.trim().length > 0 ? track.id : `voice-${index + 1}`;
    if (seenTrackIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenTrackIds.add(nextId);
    return {
      ...track,
      id: nextId
    };
  });

  const rollList = hasPianoRolls ? pianoRolls : defaults.pianoRolls;
  const seenRollIds = new Set<string>();
  const normalizedRolls = rollList.map((roll, index) => {
    let nextId = roll.id.trim().length > 0 ? roll.id : `piano-${index + 1}`;
    if (seenRollIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenRollIds.add(nextId);
    return {
      ...roll,
      id: nextId
    };
  });

  const controllerList = hasMidiControllers ? midiControllers : defaults.midiControllers;
  const seenControllerIds = new Set<string>();
  const normalizedControllers = controllerList.map((controller, index) => {
    let nextId = controller.id.trim().length > 0 ? controller.id : `cc-${index + 1}`;
    if (seenControllerIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenControllerIds.add(nextId);
    return {
      ...controller,
      id: nextId
    };
  });

  const seenControllerSequencerIds = new Set<string>();
  const normalizedControllerSequencers = controllerSequencers.map((controllerSequencer, index) => {
    let nextId =
      controllerSequencer.id.trim().length > 0 ? controllerSequencer.id : `cc-seq-${index + 1}`;
    if (seenControllerSequencerIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenControllerSequencerIds.add(nextId);
    return {
      ...controllerSequencer,
      id: nextId,
      keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints)
    };
  });

  const seenDrummerTrackIds = new Set<string>();
  const normalizedDrummerTracks = drummerTracks.map((track, index) => {
    let nextId = track.id.trim().length > 0 ? track.id : `drum-${index + 1}`;
    if (seenDrummerTrackIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenDrummerTrackIds.add(nextId);
    const rows = cloneDrummerSequencerRows(track.rows);
    return {
      ...track,
      id: nextId,
      rows,
      pads: cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, rows))
    };
  });

  const normalizedTransportStepCount = resolveTransportStepCount(timing);
  const rawArrangerLoopSelection = normalizeRawArrangerLoopSelection(
    sequencer.arrangerLoopSelection ?? sequencer.arranger_loop_selection
  );
  const arrangerLoopSelection = normalizeArrangerLoopSelection(
    rawArrangerLoopSelection,
    Number.MAX_SAFE_INTEGER,
    sequencerTransportStepsPerBeat(timing)
  );

  return {
    ...defaults,
    timing,
    stepCount: normalizedTransportStepCount,
    playhead: playhead % normalizedTransportStepCount,
    arrangerLoopSelection,
    tracks: normalizedTracks,
    drummerTracks: normalizedDrummerTracks,
    controllerSequencers: normalizedControllerSequencers,
    pianoRolls: normalizedRolls,
    midiControllers: normalizedControllers
  };
}

function normalizeEngineConfig(raw: Partial<EngineConfig> | undefined): EngineConfig {
  const sr = clampInt(typeof raw?.sr === "number" ? raw.sr : 44100, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
  let controlRate = 1378;

  if (typeof raw?.control_rate === "number" && Number.isFinite(raw.control_rate)) {
    controlRate = clampInt(raw.control_rate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
  } else if (typeof raw?.ksmps === "number" && Number.isFinite(raw.ksmps) && raw.ksmps > 0) {
    const derivedControlRate = Math.round(sr / raw.ksmps);
    if (derivedControlRate >= CONTROL_RATE_MIN && derivedControlRate <= CONTROL_RATE_MAX) {
      controlRate = derivedControlRate;
    }
  }

  const ksmps = Math.max(1, Math.round(sr / controlRate));
  const softwareBuffer = clampInt(
    typeof raw?.software_buffer === "number" ? raw.software_buffer : 128,
    ENGINE_BUFFER_MIN,
    ENGINE_BUFFER_MAX
  );
  const hardwareBuffer = clampInt(
    typeof raw?.hardware_buffer === "number" ? raw.hardware_buffer : 512,
    ENGINE_BUFFER_MIN,
    ENGINE_BUFFER_MAX
  );

  return {
    sr,
    control_rate: controlRate,
    ksmps,
    nchnls: typeof raw?.nchnls === "number" ? Math.max(1, Math.round(raw.nchnls)) : 2,
    software_buffer: softwareBuffer,
    hardware_buffer: hardwareBuffer,
    "0dbfs": typeof raw?.["0dbfs"] === "number" ? raw["0dbfs"] : 1
  };
}

function withNormalizedEngineConfig(graph: PatchGraph): PatchGraph {
  return {
    ...graph,
    engine_config: normalizeEngineConfig(graph.engine_config)
  };
}

function defaultEditablePatch(): EditablePatch {
  const patch = createUntitledPatch();
  return {
    ...patch,
    graph: withNormalizedEngineConfig(patch.graph)
  };
}

function createInstrumentTab(patch = defaultEditablePatch()): InstrumentTabState {
  return {
    id: crypto.randomUUID(),
    patch
  };
}

function updatePatchInTabs(tabs: InstrumentTabState[], tabId: string, patch: EditablePatch): InstrumentTabState[] {
  let found = false;
  const next = tabs.map((tab) => {
    if (tab.id !== tabId) {
      return tab;
    }
    found = true;
    return {
      ...tab,
      patch
    };
  });

  if (found) {
    return next;
  }
  return [...tabs, { id: tabId, patch }];
}

function normalizeAppPage(raw: unknown): AppPage {
  return raw === "instrument" || raw === "sequencer" || raw === "config" ? raw : "instrument";
}

function normalizePersistedPatch(raw: unknown): EditablePatch {
  const fallback = defaultEditablePatch();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const patch = raw as Partial<EditablePatch>;
  const id = typeof patch.id === "string" && patch.id.length > 0 ? patch.id : undefined;
  const name =
    typeof patch.name === "string" && patch.name.trim().length > 0 ? patch.name : fallback.name;
  const description = typeof patch.description === "string" ? patch.description : "";
  const schemaVersion =
    typeof patch.schema_version === "number" && Number.isFinite(patch.schema_version)
      ? Math.max(1, Math.round(patch.schema_version))
      : 1;
  const graph =
    patch.graph && typeof patch.graph === "object" && !Array.isArray(patch.graph)
      ? withNormalizedEngineConfig(patch.graph as PatchGraph)
      : fallback.graph;
  const createdAt = typeof patch.created_at === "string" ? patch.created_at : undefined;
  const updatedAt = typeof patch.updated_at === "string" ? patch.updated_at : undefined;

  return {
    id,
    name,
    description,
    schema_version: schemaVersion,
    graph,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

function normalizePersistedInstrumentTabs(raw: unknown): InstrumentTabState[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const tabs: InstrumentTabState[] = [];
  const seenIds = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    let id = typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : crypto.randomUUID();
    if (seenIds.has(id)) {
      id = crypto.randomUUID();
    }
    seenIds.add(id);

    tabs.push({
      id,
      patch: normalizePersistedPatch(candidate.patch)
    });
  }

  return tabs;
}

function normalizePersistedSequencerInstruments(
  raw: unknown,
  availablePatchIds: Set<string>,
  fallbackPatchId: string | null
): SequencerInstrumentBinding[] {
  const bindings: SequencerInstrumentBinding[] = [];
  const seenChannels = new Set<number>();

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.patchId !== "string" || !availablePatchIds.has(candidate.patchId)) {
        continue;
      }

      const midiChannel =
        typeof candidate.midiChannel === "number" ? clampInt(candidate.midiChannel, 1, 16) : 1;
      if (seenChannels.has(midiChannel)) {
        continue;
      }
      seenChannels.add(midiChannel);

      bindings.push({
        id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : crypto.randomUUID(),
        patchId: candidate.patchId,
        midiChannel,
        level: normalizeInstrumentLevel(candidate.level)
      });
    }
  }

  if (bindings.length === 0 && fallbackPatchId && availablePatchIds.has(fallbackPatchId)) {
    bindings.push({ id: crypto.randomUUID(), patchId: fallbackPatchId, midiChannel: 1, level: 10 });
  }

  return bindings;
}

function sequencerSnapshotForPersistence(sequencer: SequencerState): SequencerState {
  return {
    ...sequencer,
    isPlaying: false,
    playhead: 0,
    cycle: 0,
    tracks: sequencer.tracks.map((track) => ({
      ...track,
      queuedPad: null,
      padLoopPosition: null,
      runtimeLocalStep: null,
      queuedEnabled: null
    })),
    drummerTracks: sequencer.drummerTracks.map((track) => ({
      ...track,
      queuedPad: null,
      padLoopPosition: null,
      runtimeLocalStep: null,
      queuedEnabled: null,
      rows: cloneDrummerSequencerRows(track.rows),
      pads: cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows))
    })),
    controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => ({
      ...controllerSequencer,
      queuedPad: null,
      padLoopPosition: null,
      runtimePadStartSubunit: null,
      pads: controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad)),
      keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints)
    }))
  };
}

function buildPersistedAppStateSnapshot(state: AppStore): PersistedAppState {
  return {
    version: APP_STATE_VERSION,
    activePage: normalizeAppPage(state.activePage),
    guiLanguage: normalizeGuiLanguage(state.guiLanguage),
    instrumentTabs: state.instrumentTabs.map((tab) => ({
      id: tab.id,
      patch: {
        id: tab.patch.id,
        name: tab.patch.name,
        description: tab.patch.description,
        schema_version: tab.patch.schema_version,
        graph: withNormalizedEngineConfig(tab.patch.graph),
        created_at: tab.patch.created_at,
        updated_at: tab.patch.updated_at
      }
    })),
    activeInstrumentTabId: state.activeInstrumentTabId,
    sequencer: sequencerSnapshotForPersistence(state.sequencer),
    sequencerInstruments: state.sequencerInstruments.map((binding) => ({
      id: binding.id,
      patchId: binding.patchId,
      midiChannel: clampInt(binding.midiChannel, 1, 16),
      level: normalizeInstrumentLevel(binding.level)
    })),
    currentPerformanceId: state.currentPerformanceId,
    performanceName: state.performanceName,
    performanceDescription: state.performanceDescription,
    activeMidiInput: state.activeMidiInput
  };
}

function capturePersistWatchState(state: AppStore): PersistWatchState {
  return {
    activePage: state.activePage,
    guiLanguage: state.guiLanguage,
    instrumentTabs: state.instrumentTabs,
    activeInstrumentTabId: state.activeInstrumentTabId,
    sequencer: state.sequencer,
    sequencerInstruments: state.sequencerInstruments,
    currentPerformanceId: state.currentPerformanceId,
    performanceName: state.performanceName,
    performanceDescription: state.performanceDescription,
    activeMidiInput: state.activeMidiInput
  };
}

function hasPersistableStateChange(current: PersistWatchState, previous: PersistWatchState | null): boolean {
  if (!previous) {
    return true;
  }
  return (
    current.activePage !== previous.activePage ||
    current.guiLanguage !== previous.guiLanguage ||
    current.instrumentTabs !== previous.instrumentTabs ||
    current.activeInstrumentTabId !== previous.activeInstrumentTabId ||
    current.sequencer !== previous.sequencer ||
    current.sequencerInstruments !== previous.sequencerInstruments ||
    current.currentPerformanceId !== previous.currentPerformanceId ||
    current.performanceName !== previous.performanceName ||
    current.performanceDescription !== previous.performanceDescription ||
    current.activeMidiInput !== previous.activeMidiInput
  );
}

function isSequencerRuntimeOnlyUpdate(current: PersistWatchState, previous: PersistWatchState | null): boolean {
  if (!previous || !current.sequencer.isPlaying) {
    return false;
  }
  if (
    current.activePage !== previous.activePage ||
    current.guiLanguage !== previous.guiLanguage ||
    current.instrumentTabs !== previous.instrumentTabs ||
    current.activeInstrumentTabId !== previous.activeInstrumentTabId ||
    current.sequencerInstruments !== previous.sequencerInstruments ||
    current.currentPerformanceId !== previous.currentPerformanceId ||
    current.performanceName !== previous.performanceName ||
    current.performanceDescription !== previous.performanceDescription ||
    current.activeMidiInput !== previous.activeMidiInput
  ) {
    return false;
  }
  return current.sequencer !== previous.sequencer;
}

function defaultParams(opcode: OpcodeSpec): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  for (const input of opcode.inputs) {
    if (input.default !== undefined && input.default !== null) {
      params[input.id] = input.default;
    }
  }
  const opcodeDefaults = OPCODE_PARAM_DEFAULTS[opcode.name];
  if (opcodeDefaults) {
    Object.assign(params, opcodeDefaults);
  }
  return params;
}

function randomPosition(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 80 + col * 220, y: 80 + row * 150 };
}

function normalizePatch(patch: Patch): EditablePatch {
  return {
    id: patch.id,
    name: patch.name,
    description: patch.description,
    schema_version: patch.schema_version,
    graph: withNormalizedEngineConfig(patch.graph),
    created_at: patch.created_at,
    updated_at: patch.updated_at
  };
}

type EmbeddedPerformancePatchDefinition = {
  sourcePatchId: string;
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
};

function toPatchListItem(patch: Patch): PatchListItem {
  return {
    id: patch.id,
    name: patch.name,
    description: patch.description,
    schema_version: patch.schema_version,
    updated_at: patch.updated_at
  };
}

function normalizeNameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function findPatchByName(patches: PatchListItem[], name: string): PatchListItem | null {
  const target = normalizeNameKey(name);
  if (target.length === 0) {
    return null;
  }
  return patches.find((patch) => normalizeNameKey(patch.name) === target) ?? null;
}

function parseEmbeddedPerformancePatchDefinition(raw: unknown): EmbeddedPerformancePatchDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const sourcePatchId = typeof record.sourcePatchId === "string" ? record.sourcePatchId.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description : "";
  const schemaVersion =
    typeof record.schema_version === "number" && Number.isFinite(record.schema_version)
      ? Math.max(1, Math.round(record.schema_version))
      : 1;

  if (
    sourcePatchId.length === 0 ||
    name.length === 0 ||
    !record.graph ||
    typeof record.graph !== "object" ||
    Array.isArray(record.graph)
  ) {
    return null;
  }

  return {
    sourcePatchId,
    name,
    description,
    schema_version: schemaVersion,
    graph: withNormalizedEngineConfig(record.graph as PatchGraph)
  };
}

function embeddedPatchDefinitionsFromSnapshot(snapshot: unknown): EmbeddedPerformancePatchDefinition[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [];
  }

  const payload = snapshot as Record<string, unknown>;
  const rawDefinitions =
    Array.isArray(payload.patchDefinitions)
      ? payload.patchDefinitions
      : Array.isArray(payload.patch_definitions)
        ? payload.patch_definitions
        : [];

  const definitions = rawDefinitions
    .map((entry) => parseEmbeddedPerformancePatchDefinition(entry))
    .filter((entry): entry is EmbeddedPerformancePatchDefinition => entry !== null);

  const deduped = new Map<string, EmbeddedPerformancePatchDefinition>();
  for (const definition of definitions) {
    if (!deduped.has(definition.sourcePatchId)) {
      deduped.set(definition.sourcePatchId, definition);
    }
  }
  return [...deduped.values()];
}

function remapSnapshotPatchIds(
  snapshot: SequencerConfigSnapshot,
  patchIdMap: Map<string, string>,
  patches: PatchListItem[]
): SequencerConfigSnapshot {
  return {
    ...snapshot,
    instruments: snapshot.instruments.map((instrument) => {
      const mappedPatchId = patchIdMap.get(instrument.patchId);
      if (mappedPatchId) {
        return {
          ...instrument,
          patchId: mappedPatchId
        };
      }

      if (typeof instrument.patchName === "string" && instrument.patchName.trim().length > 0) {
        const existing = findPatchByName(patches, instrument.patchName);
        if (existing) {
          return {
            ...instrument,
            patchId: existing.id
          };
        }
      }

      return instrument;
    })
  };
}

async function hydrateEmbeddedPerformancePatches(
  snapshot: SequencerConfigSnapshot,
  patches: PatchListItem[]
): Promise<{ snapshot: SequencerConfigSnapshot; patches: PatchListItem[] }> {
  const definitions = embeddedPatchDefinitionsFromSnapshot(snapshot);
  if (definitions.length === 0) {
    return { snapshot, patches };
  }

  const referencedPatchIds = new Set(
    snapshot.instruments.map((instrument) => instrument.patchId.trim()).filter((patchId) => patchId.length > 0)
  );
  const currentPatchIds = new Set(patches.map((patch) => patch.id));
  const patchIdMap = new Map<string, string>();
  let nextPatches = patches;
  let createdAnyPatch = false;

  for (const definition of definitions) {
    if (!referencedPatchIds.has(definition.sourcePatchId)) {
      continue;
    }
    if (currentPatchIds.has(definition.sourcePatchId)) {
      continue;
    }

    const existingByName = findPatchByName(nextPatches, definition.name);
    if (existingByName) {
      patchIdMap.set(definition.sourcePatchId, existingByName.id);
      continue;
    }

    const importedPatch = await api.createPatch({
      name: definition.name,
      description: definition.description,
      schema_version: definition.schema_version,
      graph: definition.graph
    });

    createdAnyPatch = true;
    patchIdMap.set(definition.sourcePatchId, importedPatch.id);
    currentPatchIds.add(importedPatch.id);
    nextPatches = [toPatchListItem(importedPatch), ...nextPatches];
  }

  if (createdAnyPatch) {
    nextPatches = await api.listPatches();
  }

  const patchNameById = new Map(definitions.map((definition) => [definition.sourcePatchId, definition.name]));
  const snapshotWithPatchNames: SequencerConfigSnapshot = {
    ...snapshot,
    instruments: snapshot.instruments.map((instrument) => ({
      ...instrument,
      patchName: patchNameById.get(instrument.patchId) ?? instrument.patchName
    }))
  };

  const remapped = remapSnapshotPatchIds(snapshotWithPatchNames, patchIdMap, nextPatches);

  return {
    snapshot: remapped,
    patches: nextPatches
  };
}

function defaultSequencerInstruments(patches: PatchListItem[], currentPatchId?: string): SequencerInstrumentBinding[] {
  const patchId = patches[0]?.id ?? currentPatchId;
  if (!patchId) {
    return [];
  }
  return [
    {
      id: crypto.randomUUID(),
      patchId,
      midiChannel: 1,
      level: 10
    }
  ];
}

function nextAvailableMidiChannel(bindings: SequencerInstrumentBinding[]): number {
  const occupied = new Set(bindings.map((binding) => clampInt(binding.midiChannel, 1, 16)));
  for (let channel = 1; channel <= 16; channel += 1) {
    if (!occupied.has(channel)) {
      return channel;
    }
  }
  return 1;
}

function nextAvailablePerformanceChannel(sequencer: SequencerState): number {
  const occupied = new Set<number>();
  for (const track of sequencer.tracks) {
    occupied.add(clampInt(track.midiChannel, 1, 16));
  }
  for (const track of sequencer.drummerTracks) {
    occupied.add(clampInt(track.midiChannel, 1, 16));
  }
  for (const roll of sequencer.pianoRolls) {
    occupied.add(clampInt(roll.midiChannel, 1, 16));
  }

  for (let channel = 1; channel <= 16; channel += 1) {
    if (!occupied.has(channel)) {
      return channel;
    }
  }
  return 1;
}

function nextAvailableControllerNumber(controllers: MidiControllerState[]): number {
  const occupied = new Set(controllers.map((controller) => normalizeControllerNumber(controller.controllerNumber)));
  for (let controllerNumber = 0; controllerNumber <= 127; controllerNumber += 1) {
    if (!occupied.has(controllerNumber)) {
      return controllerNumber;
    }
  }
  return 0;
}

function nextAvailableControllerSequencerNumber(controllerSequencers: ControllerSequencerState[]): number {
  const occupied = new Set(
    controllerSequencers.map((controllerSequencer) => normalizeControllerNumber(controllerSequencer.controllerNumber))
  );
  for (let controllerNumber = 0; controllerNumber <= 127; controllerNumber += 1) {
    if (!occupied.has(controllerNumber)) {
      return controllerNumber;
    }
  }
  return 0;
}

function buildSequencerConfigSnapshot(
  sequencer: SequencerState,
  instruments: SequencerInstrumentBinding[]
): SequencerConfigSnapshot {
  const timing = normalizeSequencerTiming(sequencer.timing);
  const transportStepCount = transportStepCountForPerformanceTracks(
    sequencer.tracks,
    sequencer.drummerTracks,
    timing
  );
  return {
    version: 7,
    instruments: instruments
      .filter((instrument) => instrument.patchId.length > 0)
      .map((instrument) => ({
        patchId: instrument.patchId,
        midiChannel: clampInt(instrument.midiChannel, 1, 16),
        level: normalizeInstrumentLevel(instrument.level)
      })),
    sequencer: {
      timing,
      tempoBPM: timing.tempoBPM,
      meterNumerator: timing.meterNumerator,
      meterDenominator: timing.meterDenominator,
      stepsPerBeat: timing.stepsPerBeat,
      stepCount: normalizeTransportStepCount(transportStepCount),
      arrangerLoopSelection: normalizeArrangerLoopSelection(
        sequencer.arrangerLoopSelection,
        Number.MAX_SAFE_INTEGER,
        sequencerTransportStepsPerBeat(timing)
      ),
      tracks: sequencer.tracks.slice(0, 8).map((track, index) => ({
        id: track.id.length > 0 ? track.id : `voice-${index + 1}`,
        name: track.name.trim().length > 0 ? track.name : `Melodic Sequencer ${index + 1}`,
        midiChannel: clampInt(track.midiChannel, 1, 16),
        timing: normalizeSequencerTiming(track.timing),
        lengthBeats: normalizeSequencerPadLengthBeats(track.lengthBeats),
        stepCount: normalizeTransportStepCount(track.stepCount),
        syncToTrackId:
          track.syncToTrackId && track.syncToTrackId !== track.id ? track.syncToTrackId : null,
        scaleRoot: normalizeSequencerScaleRoot(track.scaleRoot),
        scaleType: normalizeSequencerScaleType(track.scaleType),
        mode: normalizeSequencerMode(track.mode),
        activePad: normalizePadIndex(track.activePad),
        queuedPad: track.queuedPad === null ? null : normalizePadIndex(track.queuedPad),
        padLoopEnabled: track.padLoopEnabled === true,
        padLoopRepeat: track.padLoopRepeat !== false,
        padLoopSequence: normalizePadLoopSequence(track.padLoopSequence),
        padLoopPattern: track.padLoopPattern,
        pads: Array.from({ length: DEFAULT_PAD_COUNT }, (_, padIndex) => {
          const sourcePad = track.pads[padIndex];
          const padScaleRoot = normalizeSequencerScaleRoot(sourcePad?.scaleRoot ?? track.scaleRoot);
          const padScaleType = normalizeSequencerScaleType(sourcePad?.scaleType ?? track.scaleType);
          const padMode =
            sourcePad?.mode === undefined ? defaultModeForScaleType(padScaleType) : normalizeSequencerMode(sourcePad.mode);
          return {
            lengthBeats: normalizeSequencerPadLengthBeats(sourcePad?.lengthBeats ?? track.lengthBeats),
            stepCount: normalizeTransportStepCount(sourcePad?.stepCount ?? track.stepCount),
            steps: Array.from({ length: 128 }, (_, stepIndex) => normalizeSequencerStep(sourcePad?.steps?.[stepIndex])),
            scaleRoot: padScaleRoot,
            scaleType: padScaleType,
            mode: padMode
          };
        }),
        enabled: track.enabled === true,
        queuedEnabled:
          track.queuedEnabled === null || typeof track.queuedEnabled === "boolean" ? track.queuedEnabled : null
      })),
      drummerTracks: sequencer.drummerTracks.slice(0, 8).map((track, index) => {
        const rows = cloneDrummerSequencerRows(track.rows).slice(0, 64);
        const pads = cloneDrummerSequencerPads(track.pads)
          .map((pad) => alignDrummerPadRowsToTrackRows(pad, rows))
          .slice(0, DEFAULT_PAD_COUNT)
          .map((pad) => ({
            lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
            stepCount: normalizeTransportStepCount(pad.stepCount),
            rows: rows.map((row) => {
              const padRow = pad.rows.find((candidate) => candidate.rowId === row.id);
              return {
                rowId: row.id,
                steps: Array.from({ length: 128 }, (_, stepIndex) =>
                  cloneDrummerSequencerCell(padRow?.steps?.[stepIndex] ?? createEmptyDrummerSequencerCell())
                )
              };
            })
          }));
        return {
          id: track.id.length > 0 ? track.id : `drum-${index + 1}`,
          name: track.name.trim().length > 0 ? track.name : `Drummer Sequencer ${index + 1}`,
          midiChannel: clampInt(track.midiChannel, 1, 16),
          timing: normalizeSequencerTiming(track.timing),
          lengthBeats: normalizeSequencerPadLengthBeats(track.lengthBeats),
          stepCount: normalizeTransportStepCount(track.stepCount),
          activePad: normalizePadIndex(track.activePad),
          queuedPad: track.queuedPad === null ? null : normalizePadIndex(track.queuedPad),
          padLoopEnabled: track.padLoopEnabled === true,
          padLoopRepeat: track.padLoopRepeat !== false,
          padLoopSequence: normalizePadLoopSequence(track.padLoopSequence),
          padLoopPattern: track.padLoopPattern,
          rows,
          pads,
          enabled: track.enabled === true,
          queuedEnabled:
            track.queuedEnabled === null || typeof track.queuedEnabled === "boolean" ? track.queuedEnabled : null
        };
      }),
      pianoRolls: sequencer.pianoRolls.slice(0, 8).map((roll, index) => ({
        id: roll.id.length > 0 ? roll.id : `piano-${index + 1}`,
        name: roll.name.trim().length > 0 ? roll.name : `Piano Roll ${index + 1}`,
        midiChannel: clampInt(roll.midiChannel, 1, 16),
        velocity: normalizePianoRollVelocity(roll.velocity),
        scaleRoot: normalizeSequencerScaleRoot(roll.scaleRoot),
        scaleType: normalizeSequencerScaleType(roll.scaleType),
        mode: normalizeSequencerMode(roll.mode),
        enabled: roll.enabled === true
      })),
      midiControllers: sequencer.midiControllers.slice(0, MAX_MIDI_CONTROLLERS).map((controller, index) => ({
        id: controller.id.length > 0 ? controller.id : `cc-${index + 1}`,
        name: controller.name.trim().length > 0 ? controller.name : `Controller ${index + 1}`,
        controllerNumber: normalizeControllerNumber(controller.controllerNumber),
        value: normalizeControllerValue(controller.value),
        enabled: controller.enabled === true
      })),
      controllerSequencers: sequencer.controllerSequencers.slice(0, 8).map((controllerSequencer, index) => ({
        id: controllerSequencer.id.length > 0 ? controllerSequencer.id : `cc-seq-${index + 1}`,
        name:
          controllerSequencer.name.trim().length > 0
            ? controllerSequencer.name
            : `Controller Sequencer ${index + 1}`,
        controllerNumber: normalizeControllerNumber(controllerSequencer.controllerNumber),
        timing: normalizeSequencerTiming(controllerSequencer.timing),
        lengthBeats: normalizeControllerSequencerLengthBeats(controllerSequencer.lengthBeats),
        stepCount: normalizeTransportStepCount(controllerSequencer.stepCount),
        activePad: normalizePadIndex(controllerSequencer.activePad),
        queuedPad: controllerSequencer.queuedPad === null ? null : normalizePadIndex(controllerSequencer.queuedPad),
        padLoopEnabled: controllerSequencer.padLoopEnabled === true,
        padLoopRepeat: controllerSequencer.padLoopRepeat !== false,
        padLoopSequence: normalizePadLoopSequence(controllerSequencer.padLoopSequence),
        padLoopPattern: controllerSequencer.padLoopPattern,
        enabled: controllerSequencer.enabled === true,
        pads: Array.from({ length: DEFAULT_PAD_COUNT }, (_, padIndex) => {
          const sourcePad =
            controllerSequencer.pads[padIndex] ??
            (padIndex === normalizePadIndex(controllerSequencer.activePad)
              ? {
                  lengthBeats: normalizeControllerSequencerLengthBeats(controllerSequencer.lengthBeats),
                  stepCount: normalizeTransportStepCount(controllerSequencer.stepCount),
                  keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints)
                }
              : defaultControllerSequencerPad());
          return {
            lengthBeats: normalizeControllerSequencerLengthBeats(sourcePad.lengthBeats),
            stepCount: normalizeTransportStepCount(sourcePad.stepCount),
            keypoints: normalizeControllerCurveKeypoints(sourcePad.keypoints).map((keypoint, keypointIndex) => ({
              id: keypoint.id.length > 0 ? keypoint.id : `kp-${padIndex + 1}-${keypointIndex + 1}`,
              position: clampControllerCurvePosition(keypoint.position),
              value: clampControllerCurveValue(keypoint.value)
            }))
          };
        }),
        keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints).map((keypoint, keypointIndex) => ({
          id: keypoint.id.length > 0 ? keypoint.id : `kp-${keypointIndex + 1}`,
          position: clampControllerCurvePosition(keypoint.position),
          value: clampControllerCurveValue(keypoint.value)
        }))
      }))
    }
  };
}

function parseSequencerConfigSnapshot(
  snapshot: unknown,
  availablePatchIds: Set<string>,
  fallbackPatchId: string | null
): { sequencer: SequencerState; instruments: SequencerInstrumentBinding[] } {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Invalid sequencer config file.");
  }

  const payload = snapshot as Record<string, unknown>;
  if (
    payload.version !== 1 &&
    payload.version !== 2 &&
    payload.version !== 3 &&
    payload.version !== 4 &&
    payload.version !== 5 &&
    payload.version !== 6 &&
    payload.version !== 7
  ) {
    throw new Error("Unsupported sequencer config version.");
  }

  const sequencer = normalizeSequencerState(payload.sequencer);
  const instrumentsRaw = Array.isArray(payload.instruments) ? payload.instruments : [];

  const instruments: SequencerInstrumentBinding[] = [];
  const seenChannels = new Set<number>();
  for (const entry of instrumentsRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.patchId !== "string" || record.patchId.length === 0) {
      continue;
    }
    if (!availablePatchIds.has(record.patchId)) {
      continue;
    }

    const midiChannel =
      typeof record.midiChannel === "number" ? clampInt(record.midiChannel, 1, 16) : 1;
    if (seenChannels.has(midiChannel)) {
      continue;
    }
    seenChannels.add(midiChannel);

    instruments.push({
      id: crypto.randomUUID(),
      patchId: record.patchId,
      midiChannel,
      level: normalizeInstrumentLevel(record.level)
    });
  }

  if (instruments.length === 0 && fallbackPatchId) {
    instruments.push({ id: crypto.randomUUID(), patchId: fallbackPatchId, midiChannel: 1, level: 10 });
  }

  if (instruments.length === 0) {
    throw new Error("No valid instrument assignments found in config.");
  }

  return {
    sequencer,
    instruments
  };
}

function normalizeSessionInstrumentAssignments(
  bindings: SequencerInstrumentBinding[]
): SessionInstrumentAssignment[] {
  const assignments: SessionInstrumentAssignment[] = [];
  const seenChannels = new Set<number>();

  for (const binding of bindings) {
    if (!binding.patchId || binding.patchId.length === 0) {
      continue;
    }

    const midiChannel = clampInt(binding.midiChannel, 1, 16);
    if (seenChannels.has(midiChannel)) {
      throw new Error(`MIDI channel ${midiChannel} is assigned more than once.`);
    }

    seenChannels.add(midiChannel);
    assignments.push({
      patch_id: binding.patchId,
      midi_channel: midiChannel
    });
  }

  if (assignments.length === 0) {
    throw new Error("Add at least one sequencer instrument before starting the engine.");
  }

  return assignments;
}

function sortedAssignments(assignments: SessionInstrumentAssignment[]): SessionInstrumentAssignment[] {
  return [...assignments].sort((a, b) => {
    if (a.midi_channel !== b.midi_channel) {
      return a.midi_channel - b.midi_channel;
    }
    return a.patch_id.localeCompare(b.patch_id);
  });
}

function sameAssignments(a: SessionInstrumentAssignment[], b: SessionInstrumentAssignment[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const aSorted = sortedAssignments(a);
  const bSorted = sortedAssignments(b);
  for (let index = 0; index < aSorted.length; index += 1) {
    if (aSorted[index].midi_channel !== bSorted[index].midi_channel) {
      return false;
    }
    if (aSorted[index].patch_id !== bSorted[index].patch_id) {
      return false;
    }
  }

  return true;
}

const initialPatch = defaultEditablePatch();
const initialTab = createInstrumentTab(initialPatch);
const initialSequencerState = defaultSequencerState();
const initialSequencerRuntimeState = sequencerRuntimeStateFromSequencer(initialSequencerState);

export const useAppStore = create<AppStore>((set, get) => {
  const commitCurrentPatch = (patch: EditablePatch, extra?: Partial<AppStore>) => {
    const state = get();
    const instrumentTabs = updatePatchInTabs(state.instrumentTabs, state.activeInstrumentTabId, patch);
    set({
      ...extra,
      currentPatch: patch,
      instrumentTabs
    });
  };

  return {
    loading: false,
    error: null,
    hasLoadedBootstrap: false,

    activePage: "instrument",
    guiLanguage: "english",

    opcodes: [],
    patches: [],
    performances: [],
    midiInputs: [],

    instrumentTabs: [initialTab],
    activeInstrumentTabId: initialTab.id,
    currentPatch: initialPatch,

    sequencer: initialSequencerState,
    sequencerRuntime: initialSequencerRuntimeState,
    sequencerInstruments: [],
    currentPerformanceId: null,
    performanceName: "Untitled Performance",
    performanceDescription: "",

    activeSessionId: null,
    activeSessionState: "idle",
    activeMidiInput: null,
    activeSessionInstruments: [],
    compileOutput: null,

    events: [],

    setActivePage: (page) => {
      set({ activePage: page });
    },

    setGuiLanguage: (language) => {
      set({ guiLanguage: normalizeGuiLanguage(language) });
    },

    addInstrumentTab: () => {
      const tab = createInstrumentTab();
      set((state) => ({
        instrumentTabs: [...state.instrumentTabs, tab],
        activeInstrumentTabId: tab.id,
        currentPatch: tab.patch
      }));
    },

    closeInstrumentTab: (tabId) => {
      const state = get();
      if (state.instrumentTabs.length <= 1) {
        const replacement = createInstrumentTab();
        set({
          instrumentTabs: [replacement],
          activeInstrumentTabId: replacement.id,
          currentPatch: replacement.patch
        });
        return;
      }

      const index = state.instrumentTabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) {
        return;
      }

      const nextTabs = state.instrumentTabs.filter((tab) => tab.id !== tabId);
      if (state.activeInstrumentTabId !== tabId) {
        set({ instrumentTabs: nextTabs });
        return;
      }

      const nextActive = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      set({
        instrumentTabs: nextTabs,
        activeInstrumentTabId: nextActive.id,
        currentPatch: nextActive.patch
      });
    },

    setActiveInstrumentTab: (tabId) => {
      const tab = get().instrumentTabs.find((candidate) => candidate.id === tabId);
      if (!tab) {
        return;
      }

      set({
        activeInstrumentTabId: tabId,
        currentPatch: tab.patch
      });
    },

    loadBootstrap: async () => {
      if (get().hasLoadedBootstrap) {
        return;
      }
      if (bootstrapLoadInFlight) {
        return bootstrapLoadInFlight;
      }

      const initialState = get();
      const initialActivePage = initialState.activePage;
      const initialGuiLanguage = initialState.guiLanguage;

      bootstrapLoadInFlight = (async () => {
        set({ loading: true, error: null });
        try {
          const [opcodes, patches, performances, midiInputs, persistedState] = await Promise.all([
            api.listOpcodes(),
            api.listPatches(),
            api.listPerformances(),
            api.listMidiInputs(),
            api
              .getAppState()
              .then((response) => response.state)
              .catch((error: unknown) => {
                if (
                  error instanceof Error &&
                  (error.message.includes("API 404") || error.message.includes("App state not found"))
                ) {
                  return null;
                }
                throw error;
              })
          ]);

          let currentPatch = defaultEditablePatch();
          if (patches.length > 0) {
            const full = await api.getPatch(patches[0].id);
            currentPatch = normalizePatch(full);
          }

          let activePage: AppPage = "instrument";
          let instrumentTabs: InstrumentTabState[] = [createInstrumentTab(currentPatch)];
          let activeInstrumentTabId = instrumentTabs[0].id;
          let sequencer = defaultSequencerState();
          let sequencerRuntime = sequencerRuntimeStateFromSequencer(sequencer);
          let sequencerInstruments = defaultSequencerInstruments(patches, currentPatch.id);
          let currentPerformanceId: string | null = null;
          let performanceName = "Untitled Performance";
          let performanceDescription = "";
          let guiLanguage: GuiLanguage = "english";

          const preferredMidi = normalizeMidiInputSelection(get().activeMidiInput, midiInputs);
          let activeMidiInput = preferredMidi ?? midiInputs[0]?.id ?? null;

          if (persistedState && typeof persistedState === "object" && !Array.isArray(persistedState)) {
            const payload = persistedState as Partial<PersistedAppState>;
            if (payload.version === APP_STATE_VERSION) {
              const restoredTabs = normalizePersistedInstrumentTabs(payload.instrumentTabs);
              if (restoredTabs.length > 0) {
                instrumentTabs = restoredTabs;
                activeInstrumentTabId =
                  typeof payload.activeInstrumentTabId === "string" &&
                  instrumentTabs.some((tab) => tab.id === payload.activeInstrumentTabId)
                    ? payload.activeInstrumentTabId
                    : instrumentTabs[0].id;
                currentPatch =
                  instrumentTabs.find((tab) => tab.id === activeInstrumentTabId)?.patch ?? instrumentTabs[0].patch;
              }

              activePage = normalizeAppPage(payload.activePage);
              guiLanguage = normalizeGuiLanguage(payload.guiLanguage);
              sequencer = normalizeSequencerState(payload.sequencer);
              sequencerRuntime = sequencerRuntimeStateFromSequencer(sequencer);

              const availablePatchIds = new Set<string>(patches.map((patch) => patch.id));
              const fallbackPatchId = patches[0]?.id ?? null;
              sequencerInstruments = normalizePersistedSequencerInstruments(
                payload.sequencerInstruments,
                availablePatchIds,
                fallbackPatchId
              );

              currentPerformanceId =
                typeof payload.currentPerformanceId === "string" &&
                performances.some((performance) => performance.id === payload.currentPerformanceId)
                  ? payload.currentPerformanceId
                  : null;
              performanceName =
                typeof payload.performanceName === "string" && payload.performanceName.trim().length > 0
                  ? payload.performanceName
                  : "Untitled Performance";
              performanceDescription =
                typeof payload.performanceDescription === "string" ? payload.performanceDescription : "";

              const persistedMidiInput = normalizeMidiInputSelection(payload.activeMidiInput, midiInputs);
              if (persistedMidiInput) {
                activeMidiInput = persistedMidiInput;
              }
            }
          }

          const latestState = get();
          const activePageChangedDuringBootstrap =
            !latestState.hasLoadedBootstrap && latestState.activePage !== initialActivePage;
          const guiLanguageChangedDuringBootstrap =
            !latestState.hasLoadedBootstrap && latestState.guiLanguage !== initialGuiLanguage;

          const resolvedActivePage = activePageChangedDuringBootstrap ? latestState.activePage : activePage;
          const resolvedGuiLanguage = guiLanguageChangedDuringBootstrap ? latestState.guiLanguage : guiLanguage;

          const baselineSnapshot: PersistedAppState = {
            version: APP_STATE_VERSION,
            activePage: resolvedActivePage,
            guiLanguage: resolvedGuiLanguage,
            instrumentTabs: instrumentTabs.map((tab) => ({
              id: tab.id,
              patch: {
                id: tab.patch.id,
                name: tab.patch.name,
                description: tab.patch.description,
                schema_version: tab.patch.schema_version,
                graph: withNormalizedEngineConfig(tab.patch.graph),
                created_at: tab.patch.created_at,
                updated_at: tab.patch.updated_at
              }
            })),
            activeInstrumentTabId,
            sequencer: sequencerSnapshotForPersistence(sequencer),
            sequencerInstruments: sequencerInstruments.map((binding) => ({
              id: binding.id,
              patchId: binding.patchId,
              midiChannel: clampInt(binding.midiChannel, 1, 16),
              level: normalizeInstrumentLevel(binding.level)
            })),
            currentPerformanceId,
            performanceName,
            performanceDescription,
            activeMidiInput
          };
          lastPersistedSignature = JSON.stringify(baselineSnapshot);
          lastPersistWatchState = {
            activePage: resolvedActivePage,
            guiLanguage: resolvedGuiLanguage,
            instrumentTabs,
            activeInstrumentTabId,
            sequencer,
            sequencerInstruments,
            currentPerformanceId,
            performanceName,
            performanceDescription,
            activeMidiInput
          };

          set({
            opcodes,
            patches,
            performances,
            midiInputs,
            activeMidiInput,
            activePage: resolvedActivePage,
            guiLanguage: resolvedGuiLanguage,
            instrumentTabs,
            activeInstrumentTabId,
            currentPatch,
            sequencer,
            sequencerRuntime,
            sequencerInstruments,
            currentPerformanceId,
            performanceName,
            performanceDescription,
            hasLoadedBootstrap: true,
            loading: false,
            error: null
          });
        } catch (error) {
          set({
            hasLoadedBootstrap: true,
            loading: false,
            error: error instanceof Error ? error.message : "Failed to load bootstrap data"
          });
        } finally {
          bootstrapLoadInFlight = null;
        }
      })();

      return bootstrapLoadInFlight;
    },

    loadPatch: async (patchId) => {
      const existingTab = get().instrumentTabs.find((tab) => tab.patch.id === patchId);
      if (existingTab) {
        set({
          activeInstrumentTabId: existingTab.id,
          currentPatch: existingTab.patch,
          error: null
        });
        return;
      }

      set({ loading: true, error: null });
      try {
        const patch = await api.getPatch(patchId);
        const currentPatch = normalizePatch(patch);
        commitCurrentPatch(currentPatch, { loading: false, error: null });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load patch"
        });
      }
    },

    refreshPatches: async () => {
      const patches = await api.listPatches();
      set({ patches });
      return patches;
    },

    refreshPerformances: async () => {
      const performances = await api.listPerformances();
      set({ performances });
      return performances;
    },

    loadPerformance: async (performanceId) => {
      set({ loading: true, error: null });
      try {
        const performance = await api.getPerformance(performanceId);
        const state = get();
        const hydrated = await hydrateEmbeddedPerformancePatches(performance.config, state.patches);
        const availablePatchIds = new Set(hydrated.patches.map((patch) => patch.id));
        if (state.currentPatch.id) {
          availablePatchIds.add(state.currentPatch.id);
        }
        const fallbackPatchId = hydrated.patches[0]?.id ?? state.currentPatch.id ?? null;
        const parsed = parseSequencerConfigSnapshot(hydrated.snapshot, availablePatchIds, fallbackPatchId);

        set({
          patches: hydrated.patches,
          sequencer: parsed.sequencer,
          sequencerRuntime: sequencerRuntimeStateFromSequencer(parsed.sequencer),
          sequencerInstruments: parsed.instruments,
          currentPerformanceId: performance.id,
          performanceName: performance.name,
          performanceDescription: performance.description,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load performance"
        });
      }
    },

    newPatch: () => {
      commitCurrentPatch(defaultEditablePatch());
    },

    setCurrentPatchMeta: (name, description) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        name,
        description
      });
    },

    setCurrentPerformanceMeta: (name, description) => {
      set({
        performanceName: name,
        performanceDescription: description
      });
    },

    clearCurrentPerformanceSelection: () => {
      set({ currentPerformanceId: null });
    },

    newPerformanceWorkspace: async () => {
      const nextSequencer = emptyPerformanceSequencerState();
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer),
        sequencerInstruments: [],
        currentPerformanceId: null,
        performanceName: "new performance",
        performanceDescription: "new performance",
        compileOutput: null,
        error: null
      });
    },

    setGraph: (graph) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: withNormalizedEngineConfig(graph)
      });
    },

    addNodeFromOpcode: (opcode, position) => {
      const current = get().currentPatch;
      const index = current.graph.nodes.length;

      const node: NodeInstance = {
        id: crypto.randomUUID(),
        opcode: opcode.name,
        params: defaultParams(opcode),
        position: position ?? randomPosition(index)
      };

      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          nodes: [...current.graph.nodes, node]
        }
      });
    },

    removeNode: (nodeId) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          nodes: current.graph.nodes.filter((node) => node.id !== nodeId),
          connections: current.graph.connections.filter(
            (connection) => connection.from_node_id !== nodeId && connection.to_node_id !== nodeId
          )
        }
      });
    },

    removeConnection: (connectionIndex) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          connections: current.graph.connections.filter((_, index) => index !== connectionIndex)
        }
      });
    },

    saveCurrentPatch: async () => {
      const current = {
        ...get().currentPatch,
        graph: withNormalizedEngineConfig(get().currentPatch.graph)
      };

      commitCurrentPatch(current, { loading: true, error: null });

      try {
        const payload = {
          name: current.name,
          description: current.description,
          schema_version: current.schema_version,
          graph: current.graph
        };

        let saved: Patch;
        if (current.id) {
          saved = await api.updatePatch(current.id, payload);
        } else {
          saved = await api.createPatch(payload);
        }

        const patches = await api.listPatches();
        const normalizedPatch = normalizePatch(saved);
        const state = get();

        const hasKnownBindings = state.sequencerInstruments.length > 0;
        const sequencerInstruments = hasKnownBindings
          ? state.sequencerInstruments
          : defaultSequencerInstruments(patches, normalizedPatch.id);

        commitCurrentPatch(normalizedPatch, {
          patches,
          sequencerInstruments,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to save patch"
        });
      }
    },

    saveCurrentPerformance: async () => {
      const state = get();
      const name = state.performanceName.trim();
      if (name.length === 0) {
        set({ error: "Performance name is required." });
        return;
      }

      set({ loading: true, error: null });
      try {
        const snapshot = buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
        const selectedPatchIds = [
          ...new Set(snapshot.instruments.map((instrument) => instrument.patchId.trim()).filter((patchId) => patchId.length > 0))
        ];
        const selectedPatches = await Promise.all(selectedPatchIds.map((patchId) => api.getPatch(patchId)));
        const patchNameById = new Map(selectedPatches.map((patch) => [patch.id, patch.name]));
        const configWithEmbeddedPatches: SequencerConfigSnapshot = {
          ...snapshot,
          instruments: snapshot.instruments.map((instrument) => ({
            ...instrument,
            patchName: patchNameById.get(instrument.patchId) ?? instrument.patchName
          })),
          patchDefinitions: selectedPatches.map((patch) => ({
            sourcePatchId: patch.id,
            name: patch.name,
            description: patch.description,
            schema_version: patch.schema_version,
            graph: patch.graph
          }))
        };

        const payload = {
          name,
          description: state.performanceDescription,
          config: configWithEmbeddedPatches
        };

        const saved = state.currentPerformanceId
          ? await api.updatePerformance(state.currentPerformanceId, payload)
          : await api.createPerformance(payload);
        const performances = await api.listPerformances();

        set({
          performances,
          currentPerformanceId: saved.id,
          performanceName: saved.name,
          performanceDescription: saved.description,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to save performance"
        });
      }
    },

    addSequencerInstrument: () => {
      const state = get();
      const patchId = state.patches[0]?.id ?? state.currentPatch.id;
      if (!patchId) {
        set({ error: "Save at least one instrument patch before adding it to the sequencer." });
        return;
      }

      const binding: SequencerInstrumentBinding = {
        id: crypto.randomUUID(),
        patchId,
        midiChannel: nextAvailableMidiChannel(state.sequencerInstruments),
        level: 10
      };

      set({
        sequencerInstruments: [...state.sequencerInstruments, binding],
        error: null
      });
    },

    removeSequencerInstrument: (bindingId) => {
      const state = get();
      set({
        sequencerInstruments: state.sequencerInstruments.filter((binding) => binding.id !== bindingId)
      });
    },

    updateSequencerInstrumentPatch: (bindingId, patchId) => {
      const state = get();
      set({
        sequencerInstruments: state.sequencerInstruments.map((binding) =>
          binding.id === bindingId ? { ...binding, patchId } : binding
        )
      });
    },

    updateSequencerInstrumentChannel: (bindingId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const state = get();

      const duplicate = state.sequencerInstruments.some(
        (binding) => binding.id !== bindingId && clampInt(binding.midiChannel, 1, 16) === normalizedChannel
      );
      if (duplicate) {
        set({ error: `MIDI channel ${normalizedChannel} is already assigned.` });
        return;
      }

      set({
        sequencerInstruments: state.sequencerInstruments.map((binding) =>
          binding.id === bindingId ? { ...binding, midiChannel: normalizedChannel } : binding
        ),
        error: null
      });
    },

    updateSequencerInstrumentLevel: (bindingId, level) => {
      const normalizedLevel = normalizeInstrumentLevel(level);
      const state = get();
      set({
        sequencerInstruments: state.sequencerInstruments.map((binding) =>
          binding.id === bindingId ? { ...binding, level: normalizedLevel } : binding
        ),
        error: null
      });
    },

    buildSequencerConfigSnapshot: () => {
      const state = get();
      return buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
    },

    applySequencerConfigSnapshot: (snapshot) => {
      try {
        const state = get();
        const availablePatchIds = new Set(state.patches.map((patch) => patch.id));
        if (state.currentPatch.id) {
          availablePatchIds.add(state.currentPatch.id);
        }
        const fallbackPatchId = state.patches[0]?.id ?? state.currentPatch.id ?? null;
        const parsed = parseSequencerConfigSnapshot(snapshot, availablePatchIds, fallbackPatchId);

        set({
          sequencer: parsed.sequencer,
          sequencerRuntime: sequencerRuntimeStateFromSequencer(parsed.sequencer),
          sequencerInstruments: parsed.instruments,
          error: null
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to load sequencer config"
        });
      }
    },

    addSequencerTrack: () => {
      const sequencer = get().sequencer;
      if (sequencer.tracks.length >= 8) {
        set({ error: "A maximum of 8 sequencers is supported." });
        return;
      }

      const nextIndex = sequencer.tracks.length + 1;
      const track = defaultSequencerTrack(nextIndex, nextAvailablePerformanceChannel(sequencer));
      track.id = crypto.randomUUID();
      track.name = `Melodic Sequencer ${nextIndex}`;
      const nextTracks = [...sequencer.tracks, track];

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        },
        error: null
      });
    },

    removeSequencerTrack: (trackId) => {
      const sequencer = get().sequencer;
      if (!sequencer.tracks.some((track) => track.id === trackId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      const nextTracks = sequencer.tracks
        .filter((track) => track.id !== trackId)
        .map((track) =>
          track.syncToTrackId === trackId
            ? {
                ...track,
                syncToTrackId: null
              }
            : track
        );

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        },
        error: null
      });
    },

    moveSequencerTrack: (sourceTrackId, targetTrackId, position = "before") => {
      const sequencer = get().sequencer;
      const sourceIndex = sequencer.tracks.findIndex((track) => track.id === sourceTrackId);
      const targetIndex = sequencer.tracks.findIndex((track) => track.id === targetTrackId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return;
      }

      const sourceTrack = sequencer.tracks[sourceIndex];
      const remainingTracks = sequencer.tracks.filter((track) => track.id !== sourceTrackId);
      const targetIndexInRemaining = remainingTracks.findIndex((track) => track.id === targetTrackId);
      if (targetIndexInRemaining < 0) {
        return;
      }
      const insertionIndex = position === "after" ? targetIndexInRemaining + 1 : targetIndexInRemaining;
      const nextTracks = [...remainingTracks];
      nextTracks.splice(insertionIndex, 0, sourceTrack);

      set({
        sequencer: {
          ...sequencer,
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackEnabled: (trackId, enabled, queueOnCycle) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const shouldQueue = queueOnCycle ?? isPlaying;
      const nextTracks = sequencer.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        if (shouldQueue && isPlaying) {
          if (track.enabled === enabled) {
            return { ...track, queuedEnabled: null };
          }
          return {
            ...track,
            queuedEnabled: enabled
          };
        }
        return {
          ...track,
          enabled,
          queuedEnabled: null
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackMidiChannel: (trackId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId ? { ...track, midiChannel: normalizedChannel } : track
          )
        }
      });
    },

    setSequencerTrackSyncTarget: (trackId, syncToTrackId) => {
      const sequencer = get().sequencer;
      const normalizedSyncTarget =
        typeof syncToTrackId === "string" && syncToTrackId.trim().length > 0 ? syncToTrackId : null;
      const trackIds = new Set(sequencer.tracks.map((track) => track.id));
      if (!trackIds.has(trackId)) {
        return;
      }
      const resolvedSyncTarget =
        normalizedSyncTarget !== null && normalizedSyncTarget !== trackId && trackIds.has(normalizedSyncTarget)
          ? normalizedSyncTarget
          : null;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  syncToTrackId: resolvedSyncTarget
                }
              : track
          )
        }
      });
    },

    setSequencerTrackScale: (trackId, scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      const nextMode = linkedModeForScaleType(normalizedType);

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  ...((): Pick<SequencerTrackState, "scaleRoot" | "scaleType" | "mode" | "pads"> => {
                    const activePad = normalizePadIndex(track.activePad);
                    const pads = track.pads.map((pad, index) =>
                      index === activePad
                        ? {
                            ...pad,
                            scaleRoot: normalizedRoot,
                            scaleType: normalizedType,
                            mode: nextMode ?? pad.mode
                          }
                        : pad
                    );
                    const selectedPad =
                      pads[activePad] ?? {
                        stepCount: normalizeSequencerTrackStepCount(track.stepCount),
                        steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
                        scaleRoot: normalizedRoot,
                        scaleType: normalizedType,
                        mode: nextMode ?? track.mode
                      };
                    return {
                      scaleRoot: selectedPad.scaleRoot,
                      scaleType: selectedPad.scaleType,
                      mode: selectedPad.mode,
                      pads
                    };
                  })()
                }
              : track
          )
        }
      });
    },

    setSequencerTrackMode: (trackId, mode) => {
      const normalizedMode = normalizeSequencerMode(mode);
      const normalizedScaleType = linkedScaleTypeForMode(normalizedMode);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  ...((): Pick<SequencerTrackState, "scaleType" | "mode" | "pads"> => {
                    const activePad = normalizePadIndex(track.activePad);
                    const pads = track.pads.map((pad, index) =>
                      index === activePad
                        ? {
                            ...pad,
                            mode: normalizedMode,
                            scaleType: normalizedScaleType
                          }
                        : pad
                    );
                    const selectedPad =
                      pads[activePad] ?? {
                        stepCount: normalizeSequencerTrackStepCount(track.stepCount),
                        steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
                        scaleRoot: track.scaleRoot,
                        scaleType: normalizedScaleType,
                        mode: normalizedMode
                      };
                    return {
                      scaleType: selectedPad.scaleType,
                      mode: selectedPad.mode,
                      pads
                    };
                  })()
                }
              : track
          )
        }
      });
    },

    setSequencerTrackMeterNumerator: (trackId, numerator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  meterNumerator: clampSequencerMeterNumerator(numerator)
                })
              : track
          )
        }
      });
    },

    setSequencerTrackMeterDenominator: (trackId, denominator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  meterDenominator: clampSequencerMeterDenominator(denominator)
                })
              : track
          )
        }
      });
    },

    setSequencerTrackStepsPerBeat: (trackId, stepsPerBeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
                })
              : track
          )
        }
      });
    },

    setSequencerTrackBeatRate: (trackId, numerator, denominator) => {
      const sequencer = get().sequencer;
      const beatRate = normalizeSequencerBeatRate(numerator, denominator);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  beatRateNumerator: beatRate.numerator,
                  beatRateDenominator: beatRate.denominator
                })
              : track
          )
        }
      });
    },

    setSequencerTrackStepCount: (trackId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedLengthBeats = normalizeSequencerPadLengthBeats(stepCount);
      const nextTracks = sequencer.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        const normalizedStepCount = resolvedSequencerPadStepCount(normalizedLengthBeats, track.timing);
        const activePad = normalizePadIndex(track.activePad);
        const pads = track.pads.map((pad, index) =>
          index === activePad
            ? { ...pad, lengthBeats: normalizedLengthBeats, stepCount: normalizedStepCount }
            : pad
        );
        return {
          ...track,
          lengthBeats: normalizedLengthBeats,
          stepCount: normalizedStepCount,
          pads
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackStepNote: (trackId, index, note) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              note: normalizeStepNote(note)
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    setSequencerTrackStepChord: (trackId, index, chord) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      const normalizedChord = normalizeSequencerChord(chord);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              chord: normalizedChord
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    setSequencerTrackStepHold: (trackId, index, hold) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              hold: hold === true
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    setSequencerTrackStepVelocity: (trackId, index, velocity) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      const normalizedVelocity = normalizeStepVelocity(velocity);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              velocity: normalizedVelocity
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    copySequencerTrackStepSettings: (sourceTrackId, sourceIndex, targetTrackId, targetIndex) => {
      if (
        !Number.isFinite(sourceIndex) ||
        !Number.isFinite(targetIndex) ||
        sourceIndex < 0 ||
        sourceIndex >= STEP_CAPACITY ||
        targetIndex < 0 ||
        targetIndex >= STEP_CAPACITY
      ) {
        return;
      }

      const sequencer = get().sequencer;
      const sourceTrack = sequencer.tracks.find((track) => track.id === sourceTrackId);
      if (!sourceTrack) {
        return;
      }
      const sourcePadIndex = normalizePadIndex(sourceTrack.activePad);
      const sourcePad =
        sourceTrack.pads[sourcePadIndex] ??
        sourceTrack.pads[0] ??
        fallbackSequencerPadStateForTrack(sourceTrack);
      const sourceStep = sourcePad.steps[sourceIndex] ?? createEmptySequencerStep();

      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== targetTrackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const targetStep = steps[targetIndex] ?? createEmptySequencerStep();
            steps[targetIndex] = {
              ...targetStep,
              note: normalizeStepNote(sourceStep.note),
              chord: normalizeSequencerChord(sourceStep.chord),
              velocity: normalizeStepVelocity(sourceStep.velocity)
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    clearSequencerTrackSteps: (trackId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS);
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    copySequencerTrackPad: (trackId, sourcePadIndex, targetPadIndex) => {
      const normalizedSourcePad = normalizePadIndex(sourcePadIndex);
      const normalizedTargetPad = normalizePadIndex(targetPadIndex);
      if (normalizedSourcePad === normalizedTargetPad) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const fallbackPad: SequencerPadState = fallbackSequencerPadStateForTrack(track);
            const sourcePad = pads[normalizedSourcePad] ?? fallbackPad;
            const copiedPad: SequencerPadState = {
              lengthBeats: normalizeSequencerPadLengthBeats(sourcePad.lengthBeats),
              stepCount: normalizeSequencerTrackStepCount(sourcePad.stepCount),
              steps: cloneSequencerSteps(sourcePad.steps),
              scaleRoot: sourcePad.scaleRoot,
              scaleType: sourcePad.scaleType,
              mode: sourcePad.mode
            };
            pads[normalizedTargetPad] = copiedPad;

            const activePad = normalizePadIndex(track.activePad);
            if (activePad !== normalizedTargetPad) {
              return {
                ...track,
                pads
              };
            }

            return {
              ...track,
              pads,
              lengthBeats: copiedPad.lengthBeats,
              stepCount: copiedPad.stepCount,
              scaleRoot: copiedPad.scaleRoot,
              scaleType: copiedPad.scaleType,
              mode: copiedPad.mode,
              steps: cloneSequencerSteps(copiedPad.steps)
            };
          })
        }
      });
    },

    transposeSequencerTrackPadInScale: (trackId, padIndex, direction) => {
      if (direction !== -1 && direction !== 1) {
        return;
      }

      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const fallbackPad: SequencerPadState = fallbackSequencerPadStateForTrack(track);
            const sourcePad = pads[normalizedPad] ?? fallbackPad;
            const nextSteps = cloneSequencerSteps(sourcePad.steps).map((step) => {
              if (step.note === null) {
                return { ...step };
              }

              const nextNote = transposeSequencerNoteByScaleDegree(
                step.note,
                sourcePad.scaleRoot,
                sourcePad.mode,
                direction
              );

              return {
                ...step,
                note: nextNote,
                chord: resolveDiatonicSequencerChordVariant(step.chord, nextNote, sourcePad.scaleRoot, sourcePad.mode)
              };
            });
            const nextPad: SequencerPadState = {
              ...sourcePad,
              steps: nextSteps
            };
            pads[normalizedPad] = nextPad;

            const activePad = normalizePadIndex(track.activePad);
            if (activePad !== normalizedPad) {
              return {
                ...track,
                pads
              };
            }

            return {
              ...track,
              pads,
              steps: cloneSequencerSteps(nextPad.steps),
              scaleRoot: nextPad.scaleRoot,
              scaleType: nextPad.scaleType,
              mode: nextPad.mode
            };
          })
        }
      });
    },

    transposeSequencerTrackPadDiatonic: (trackId, padIndex, direction) => {
      if (direction !== -1 && direction !== 1) {
        return;
      }

      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const fallbackPad: SequencerPadState = fallbackSequencerPadStateForTrack(track);
            const sourcePad = pads[normalizedPad] ?? fallbackPad;
            const { scaleRoot: nextScaleRoot, semitoneOffset } = transposeSequencerTonicByDiatonicStep(
              sourcePad.scaleRoot,
              sourcePad.mode,
              direction
            );
            const nextSteps = cloneSequencerSteps(sourcePad.steps).map((step) => ({
              ...step,
              note: step.note === null ? null : normalizeStepNote(step.note + semitoneOffset)
            }));
            const nextPad: SequencerPadState = {
              ...sourcePad,
              steps: nextSteps,
              scaleRoot: nextScaleRoot
            };
            pads[normalizedPad] = nextPad;

            const activePad = normalizePadIndex(track.activePad);
            if (activePad !== normalizedPad) {
              return {
                ...track,
                pads
              };
            }

            return {
              ...track,
              pads,
              steps: cloneSequencerSteps(nextPad.steps),
              scaleRoot: nextPad.scaleRoot,
              scaleType: nextPad.scaleType,
              mode: nextPad.mode
            };
          })
        }
      });
    },

    setSequencerTrackActivePad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const normalizedPad = normalizePadIndex(padIndex);

      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? (() => {
                  const selectedPad =
                    track.pads[normalizedPad] ??
                    track.pads[0] ??
                    fallbackSequencerPadStateForTrack(track);
                  return {
                    ...track,
                    lengthBeats: normalizeSequencerPadLengthBeats(selectedPad.lengthBeats),
                    stepCount: normalizeSequencerTrackStepCount(selectedPad.stepCount),
                    activePad: normalizedPad,
                    queuedPad: isPlaying && track.enabled ? track.queuedPad : null,
                    scaleRoot: selectedPad.scaleRoot,
                    scaleType: selectedPad.scaleType,
                    mode: selectedPad.mode,
                    steps: cloneSequencerSteps(selectedPad.steps)
                  };
                })()
              : track
          )
        }
      });
    },

    setSequencerTrackQueuedPad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
                }
              : track
          )
        }
      });
    },

    setSequencerTrackPadLoopEnabled: (trackId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopEnabled: enabled === true
                }
              : track
          )
        }
      });
    },

    setSequencerTrackPadLoopRepeat: (trackId, repeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopRepeat: repeat !== false
                }
              : track
          )
        }
      });
    },

    setSequencerTrackPadLoopPattern: (trackId, pattern) => {
      const sequencer = get().sequencer;
      const normalizedPattern = normalizePadLoopPatternForState(pattern);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopPattern: normalizedPattern.padLoopPattern,
                  padLoopSequence: normalizedPattern.padLoopSequence
                }
              : track
          )
        }
      });
    },

    addSequencerTrackPadLoopStep: (trackId, padIndex) => {
      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (track.padLoopSequence.length >= 256) {
              return track;
            }
            const nextPattern = insertPadLoopItem(
              track.padLoopPattern,
              { kind: "root" },
              track.padLoopPattern.rootSequence.length,
              { type: "pad", padIndex: normalizedPad }
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    removeSequencerTrackPadLoopStep: (trackId, sequenceIndex) => {
      if (!Number.isFinite(sequenceIndex)) {
        return;
      }
      const normalizedSequenceIndex = Math.max(0, Math.round(sequenceIndex));
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (
              normalizedSequenceIndex < 0 ||
              normalizedSequenceIndex >= track.padLoopPattern.rootSequence.length
            ) {
              return track;
            }
            const nextPattern = removePadLoopItemsFromContainer(track.padLoopPattern, { kind: "root" }, [
              normalizedSequenceIndex
            ]);
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    addDrummerSequencerTrack: () => {
      const sequencer = get().sequencer;
      if (sequencer.drummerTracks.length >= 8) {
        set({ error: "A maximum of 8 drummer sequencers is supported." });
        return;
      }

      const nextIndex = sequencer.drummerTracks.length + 1;
      const track = defaultDrummerSequencerTrack(nextIndex, nextAvailablePerformanceChannel(sequencer));
      track.id = crypto.randomUUID();
      track.name = `Drummer Sequencer ${nextIndex}`;

      const nextDrummerTracks = [...sequencer.drummerTracks, track];
      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        },
        error: null
      });
    },

    removeDrummerSequencerTrack: (trackId) => {
      const sequencer = get().sequencer;
      if (!sequencer.drummerTracks.some((track) => track.id === trackId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      const nextDrummerTracks = sequencer.drummerTracks.filter((track) => track.id !== trackId);
      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        },
        error: null
      });
    },

    setDrummerSequencerTrackEnabled: (trackId, enabled, queueOnCycle) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const shouldQueue = queueOnCycle ?? isPlaying;
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        if (shouldQueue && isPlaying) {
          if (track.enabled === enabled) {
            return { ...track, queuedEnabled: null };
          }
          return {
            ...track,
            queuedEnabled: enabled
          };
        }
        return {
          ...track,
          enabled,
          queuedEnabled: null
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        }
      });
    },

    setDrummerSequencerTrackMidiChannel: (trackId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId ? { ...track, midiChannel: normalizedChannel } : track
          )
        }
      });
    },

    setDrummerSequencerTrackMeterNumerator: (trackId, numerator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  meterNumerator: clampSequencerMeterNumerator(numerator)
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackMeterDenominator: (trackId, denominator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  meterDenominator: clampSequencerMeterDenominator(denominator)
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackStepsPerBeat: (trackId, stepsPerBeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackBeatRate: (trackId, numerator, denominator) => {
      const sequencer = get().sequencer;
      const beatRate = normalizeSequencerBeatRate(numerator, denominator);
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  beatRateNumerator: beatRate.numerator,
                  beatRateDenominator: beatRate.denominator
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackStepCount: (trackId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedLengthBeats = normalizeSequencerPadLengthBeats(stepCount);
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        const normalizedStepCount = resolvedSequencerPadStepCount(normalizedLengthBeats, track.timing);
        const activePad = normalizePadIndex(track.activePad);
        const nextPads = cloneDrummerSequencerPads(track.pads).map((pad, index) =>
          index === activePad
            ? { ...pad, lengthBeats: normalizedLengthBeats, stepCount: normalizedStepCount }
            : pad
        );
        return {
          ...track,
          lengthBeats: normalizedLengthBeats,
          stepCount: normalizedStepCount,
          pads: nextPads
        };
      });
      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        }
      });
    },

    addDrummerSequencerRow: (trackId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (track.rows.length >= 64) {
              return track;
            }
            const nextKeySeed =
              track.rows.length < DEFAULT_DRUMMER_ROW_KEYS.length
                ? DEFAULT_DRUMMER_ROW_KEYS[track.rows.length]
                : (track.rows[track.rows.length - 1]?.key ?? 35) + 1;
            const newRow: DrummerSequencerRowState = {
              id: crypto.randomUUID(),
              key: normalizeDrummerSequencerKey(nextKeySeed)
            };
            const nextRows = [...cloneDrummerSequencerRows(track.rows), newRow];
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => ({
              lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
              stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
              rows: [
                ...alignDrummerPadRowsToTrackRows(pad, track.rows).rows,
                { rowId: newRow.id, steps: cloneDrummerSequencerCells(DEFAULT_DRUMMER_SEQUENCER_CELLS) }
              ]
            }));
            return {
              ...track,
              rows: nextRows,
              pads: nextPads
            };
          })
        }
      });
    },

    removeDrummerSequencerRow: (trackId, rowId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (!track.rows.some((row) => row.id === rowId) || track.rows.length <= 1) {
              return track;
            }
            const nextRows = track.rows.filter((row) => row.id !== rowId);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => ({
              lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
              stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
              rows: alignDrummerPadRowsToTrackRows(
                {
                  lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
                  stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
                  rows: pad.rows.filter((row) => row.rowId !== rowId)
                },
                nextRows
              ).rows
            }));
            return {
              ...track,
              rows: cloneDrummerSequencerRows(nextRows),
              pads: nextPads
            };
          })
        }
      });
    },

    setDrummerSequencerRowKey: (trackId, rowId, key) => {
      const normalizedKey = normalizeDrummerSequencerKey(key);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  rows: track.rows.map((row) => (row.id === rowId ? { ...row, key: normalizedKey } : row))
                }
              : track
          )
        }
      });
    },

    toggleDrummerSequencerCell: (trackId, rowId, stepIndex, active) => {
      if (stepIndex < 0 || stepIndex >= STEP_CAPACITY) {
        return;
      }
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const activePad = normalizePadIndex(track.activePad);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            const pad = nextPads[activePad] ?? fallbackDrummerSequencerPadStateForTrack(track);
            const nextRows = pad.rows.map((row) => {
              if (row.rowId !== rowId) {
                return row;
              }
              const nextSteps = cloneDrummerSequencerCells(row.steps);
              const current = nextSteps[stepIndex] ?? createEmptyDrummerSequencerCell();
              nextSteps[stepIndex] = {
                ...current,
                active: active === undefined ? current.active !== true : active === true
              };
              return { ...row, steps: nextSteps };
            });
            nextPads[activePad] = { ...pad, rows: nextRows };
            return {
              ...track,
              pads: nextPads
            };
          })
        }
      });
    },

    setDrummerSequencerCellVelocity: (trackId, rowId, stepIndex, velocity) => {
      if (stepIndex < 0 || stepIndex >= STEP_CAPACITY) {
        return;
      }
      const normalizedVelocity = normalizeStepVelocity(velocity);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const activePad = normalizePadIndex(track.activePad);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            const pad = nextPads[activePad] ?? fallbackDrummerSequencerPadStateForTrack(track);
            const nextRows = pad.rows.map((row) => {
              if (row.rowId !== rowId) {
                return row;
              }
              const nextSteps = cloneDrummerSequencerCells(row.steps);
              const current = nextSteps[stepIndex] ?? createEmptyDrummerSequencerCell();
              nextSteps[stepIndex] = {
                ...current,
                velocity: normalizedVelocity
              };
              return { ...row, steps: nextSteps };
            });
            nextPads[activePad] = { ...pad, rows: nextRows };
            return {
              ...track,
              pads: nextPads
            };
          })
        }
      });
    },

    clearDrummerSequencerTrackSteps: (trackId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const activePad = normalizePadIndex(track.activePad);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            nextPads[activePad] = buildDefaultDrummerSequencerPad(track.rows, track.stepCount);
            return {
              ...track,
              pads: nextPads
            };
          })
        }
      });
    },

    copyDrummerSequencerPad: (trackId, sourcePadIndex, targetPadIndex) => {
      const normalizedSourcePad = normalizePadIndex(sourcePadIndex);
      const normalizedTargetPad = normalizePadIndex(targetPadIndex);
      if (normalizedSourcePad === normalizedTargetPad) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            const sourcePad = nextPads[normalizedSourcePad] ?? fallbackDrummerSequencerPadStateForTrack(track);
            nextPads[normalizedTargetPad] = alignDrummerPadRowsToTrackRows(
              {
                lengthBeats: normalizeSequencerPadLengthBeats(sourcePad.lengthBeats),
                stepCount: normalizeDrummerSequencerStepCount(sourcePad.stepCount),
                rows: sourcePad.rows.map((row) => ({
                  rowId: row.rowId,
                  steps: cloneDrummerSequencerCells(row.steps)
                }))
              },
              track.rows
            );
            if (normalizePadIndex(track.activePad) !== normalizedTargetPad) {
              return {
                ...track,
                pads: nextPads
              };
            }
            return {
              ...track,
              lengthBeats: normalizeSequencerPadLengthBeats(nextPads[normalizedTargetPad]?.lengthBeats ?? track.lengthBeats),
              stepCount: normalizeDrummerSequencerStepCount(nextPads[normalizedTargetPad]?.stepCount ?? track.stepCount),
              pads: nextPads
            };
          })
        }
      });
    },

    setDrummerSequencerTrackActivePad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const normalizedPad = normalizePadIndex(padIndex);
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? (() => {
                  const selectedPad =
                    track.pads[normalizedPad] ??
                    track.pads[0] ??
                    fallbackDrummerSequencerPadStateForTrack(track);
                  return {
                    ...track,
                    lengthBeats: normalizeSequencerPadLengthBeats(selectedPad.lengthBeats),
                    stepCount: normalizeDrummerSequencerStepCount(selectedPad.stepCount),
                    activePad: normalizedPad,
                    queuedPad: isPlaying && track.enabled ? track.queuedPad : null
                  };
                })()
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackQueuedPad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
                }
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackPadLoopEnabled: (trackId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopEnabled: enabled === true
                }
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackPadLoopRepeat: (trackId, repeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopRepeat: repeat !== false
                }
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackPadLoopPattern: (trackId, pattern) => {
      const sequencer = get().sequencer;
      const normalizedPattern = normalizePadLoopPatternForState(pattern);
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopPattern: normalizedPattern.padLoopPattern,
                  padLoopSequence: normalizedPattern.padLoopSequence
                }
              : track
          )
        }
      });
    },

    addDrummerSequencerTrackPadLoopStep: (trackId, padIndex) => {
      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (track.padLoopSequence.length >= 256) {
              return track;
            }
            const nextPattern = insertPadLoopItem(
              track.padLoopPattern,
              { kind: "root" },
              track.padLoopPattern.rootSequence.length,
              { type: "pad", padIndex: normalizedPad }
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    removeDrummerSequencerTrackPadLoopStep: (trackId, sequenceIndex) => {
      if (!Number.isFinite(sequenceIndex)) {
        return;
      }
      const normalizedSequenceIndex = Math.max(0, Math.round(sequenceIndex));
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (
              normalizedSequenceIndex < 0 ||
              normalizedSequenceIndex >= track.padLoopPattern.rootSequence.length
            ) {
              return track;
            }
            const nextPattern = removePadLoopItemsFromContainer(track.padLoopPattern, { kind: "root" }, [
              normalizedSequenceIndex
            ]);
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    addPianoRoll: () => {
      const sequencer = get().sequencer;
      if (sequencer.pianoRolls.length >= 8) {
        set({ error: "A maximum of 8 piano rolls is supported." });
        return;
      }

      const nextIndex = sequencer.pianoRolls.length + 1;
      const roll = defaultPianoRoll(nextIndex, nextAvailablePerformanceChannel(sequencer));
      roll.id = crypto.randomUUID();
      roll.name = `Piano Roll ${nextIndex}`;

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: [...sequencer.pianoRolls, roll]
        },
        error: null
      });
    },

    removePianoRoll: (rollId) => {
      const sequencer = get().sequencer;
      if (!sequencer.pianoRolls.some((roll) => roll.id === rollId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.filter((roll) => roll.id !== rollId)
        },
        error: null
      });
    },

    setPianoRollEnabled: (rollId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, enabled } : roll
          )
        }
      });
    },

    setPianoRollMidiChannel: (rollId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, midiChannel: normalizedChannel } : roll
          )
        }
      });
    },

    setPianoRollVelocity: (rollId, velocity) => {
      const normalizedVelocity = clampInt(velocity, 0, 127);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, velocity: normalizedVelocity } : roll
          )
        }
      });
    },

    setPianoRollScale: (rollId, scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      const nextMode = linkedModeForScaleType(normalizedType);
      const sequencer = get().sequencer;

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId
              ? {
                  ...roll,
                  scaleRoot: normalizedRoot,
                  scaleType: normalizedType,
                  mode: nextMode ?? roll.mode
                }
              : roll
          )
        }
      });
    },

    setPianoRollMode: (rollId, mode) => {
      const normalizedMode = normalizeSequencerMode(mode);
      const normalizedScaleType = linkedScaleTypeForMode(normalizedMode);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId
              ? {
                  ...roll,
                  mode: normalizedMode,
                  scaleType: normalizedScaleType
                }
              : roll
          )
        }
      });
    },

    addMidiController: () => {
      const sequencer = get().sequencer;
      if (sequencer.midiControllers.length >= MAX_MIDI_CONTROLLERS) {
        set({ error: `A maximum of ${MAX_MIDI_CONTROLLERS} MIDI controllers is supported.` });
        return;
      }

      const nextIndex = sequencer.midiControllers.length + 1;
      const controller = defaultMidiController(nextIndex);
      controller.id = crypto.randomUUID();
      controller.name = `Controller ${nextIndex}`;
      controller.controllerNumber = nextAvailableControllerNumber(sequencer.midiControllers);

      set({
        sequencer: {
          ...sequencer,
          midiControllers: [...sequencer.midiControllers, controller]
        },
        error: null
      });
    },

    removeMidiController: (controllerId) => {
      const sequencer = get().sequencer;
      if (!sequencer.midiControllers.some((controller) => controller.id === controllerId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.filter((controller) => controller.id !== controllerId)
        },
        error: null
      });
    },

    setMidiControllerEnabled: (controllerId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, enabled } : controller
          )
        }
      });
    },

    setMidiControllerNumber: (controllerId, controllerNumber) => {
      const normalizedNumber = normalizeControllerNumber(controllerNumber);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, controllerNumber: normalizedNumber } : controller
          )
        }
      });
    },

    setMidiControllerValue: (controllerId, value) => {
      const normalizedValue = normalizeControllerValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, value: normalizedValue } : controller
          )
        }
      });
    },

    addControllerSequencer: () => {
      const sequencer = get().sequencer;
      if (sequencer.controllerSequencers.length >= 8) {
        set({ error: "A maximum of 8 controller sequencers is supported." });
        return;
      }

      const nextIndex = sequencer.controllerSequencers.length + 1;
      const controllerSequencer = defaultControllerSequencer(nextIndex);
      controllerSequencer.id = crypto.randomUUID();
      controllerSequencer.name = `Controller Sequencer ${nextIndex}`;
      controllerSequencer.controllerNumber = nextAvailableControllerSequencerNumber(sequencer.controllerSequencers);

      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: [...sequencer.controllerSequencers, controllerSequencer]
        },
        error: null
      });
    },

    removeControllerSequencer: (controllerSequencerId) => {
      const sequencer = get().sequencer;
      if (!sequencer.controllerSequencers.some((controllerSequencer) => controllerSequencer.id === controllerSequencerId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.filter(
            (controllerSequencer) => controllerSequencer.id !== controllerSequencerId
          )
        },
        error: null
      });
    },

    setControllerSequencerEnabled: (controllerSequencerId, enabled) => {
      const sequencer = get().sequencer;
      const runtimeState = get().sequencerRuntime;
      const controllerRuntime = runtimeState.controllerRuntimePadStartSubunitById;
      const nextEnabled = enabled === true;
      const currentController =
        sequencer.controllerSequencers.find((controllerSequencer) => controllerSequencer.id === controllerSequencerId) ??
        null;
      const runtimeResetRequired = currentController ? nextEnabled !== currentController.enabled : false;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            return {
              ...controllerSequencer,
              enabled: nextEnabled,
              queuedPad: !nextEnabled ? null : runtimeResetRequired ? null : controllerSequencer.queuedPad,
              padLoopPosition:
                !nextEnabled || runtimeResetRequired ? null : controllerSequencer.padLoopPosition
            };
          })
        },
        sequencerRuntime: {
          ...runtimeState,
          controllerRuntimePadStartSubunitById: {
            ...controllerRuntime,
            [controllerSequencerId]:
              !nextEnabled || runtimeResetRequired ? null : (controllerRuntime[controllerSequencerId] ?? null)
          }
        }
      });
    },

    setControllerSequencerNumber: (controllerSequencerId, controllerNumber) => {
      const normalizedNumber = normalizeControllerNumber(controllerNumber);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? { ...controllerSequencer, controllerNumber: normalizedNumber }
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerActivePad: (controllerSequencerId, padIndex) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const normalizedPad = normalizePadIndex(padIndex);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const selectedPad =
              controllerSequencer.pads[normalizedPad] ??
              controllerSequencer.pads[0] ??
              fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            return {
              ...controllerSequencer,
              activePad: normalizedPad,
              queuedPad: isPlaying && controllerSequencer.enabled ? controllerSequencer.queuedPad : null,
              lengthBeats: normalizeControllerSequencerLengthBeats(selectedPad.lengthBeats),
              stepCount: normalizeTransportStepCount(selectedPad.stepCount),
              keypoints: normalizeControllerCurveKeypoints(selectedPad.keypoints)
            };
          })
        }
      });
    },

    setControllerSequencerQueuedPad: (controllerSequencerId, padIndex) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
                }
              : controllerSequencer
          )
        }
      });
    },

    copyControllerSequencerPad: (controllerSequencerId, sourcePadIndex, targetPadIndex) => {
      const normalizedSourcePad = normalizePadIndex(sourcePadIndex);
      const normalizedTargetPad = normalizePadIndex(targetPadIndex);
      if (normalizedSourcePad === normalizedTargetPad) {
        return;
      }
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const fallbackPad = fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const sourcePad = pads[normalizedSourcePad] ?? fallbackPad;
            const copiedPad = cloneControllerSequencerPad(sourcePad);
            pads[normalizedTargetPad] = copiedPad;

            if (normalizePadIndex(controllerSequencer.activePad) !== normalizedTargetPad) {
              return {
                ...controllerSequencer,
                pads
              };
            }

            return {
              ...controllerSequencer,
              pads,
              lengthBeats: copiedPad.lengthBeats,
              stepCount: copiedPad.stepCount,
              keypoints: normalizeControllerCurveKeypoints(copiedPad.keypoints)
            };
          })
        }
      });
    },

    clearControllerSequencerSteps: (controllerSequencerId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const nextKeypoints = defaultControllerSequencerKeypoints();
            pads[activePad] = {
              ...sourcePad,
              keypoints: nextKeypoints
            };
            return {
              ...controllerSequencer,
              pads,
              keypoints: nextKeypoints
            };
          })
        }
      });
    },

    setControllerSequencerPadLoopEnabled: (controllerSequencerId, enabled) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const nextEnabled = enabled === true;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  padLoopEnabled: nextEnabled,
                  padLoopPosition:
                    nextEnabled && isPlaying ? controllerSequencer.padLoopPosition : null
                }
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerPadLoopRepeat: (controllerSequencerId, repeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  padLoopRepeat: repeat !== false
                }
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerPadLoopPattern: (controllerSequencerId, pattern) => {
      const sequencer = get().sequencer;
      const normalizedPattern = normalizePadLoopPatternForState(pattern);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  padLoopPattern: normalizedPattern.padLoopPattern,
                  padLoopSequence: normalizedPattern.padLoopSequence
                }
              : controllerSequencer
          )
        }
      });
    },

    addControllerSequencerPadLoopStep: (controllerSequencerId, padIndex) => {
      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            if (controllerSequencer.padLoopSequence.length >= 256) {
              return controllerSequencer;
            }
            const nextPattern = insertPadLoopItem(
              controllerSequencer.padLoopPattern,
              { kind: "root" },
              controllerSequencer.padLoopPattern.rootSequence.length,
              { type: "pad", padIndex: normalizedPad }
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...controllerSequencer,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    removeControllerSequencerPadLoopStep: (controllerSequencerId, sequenceIndex) => {
      if (!Number.isFinite(sequenceIndex)) {
        return;
      }
      const normalizedSequenceIndex = Math.max(0, Math.round(sequenceIndex));
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            if (
              normalizedSequenceIndex < 0 ||
              normalizedSequenceIndex >= controllerSequencer.padLoopPattern.rootSequence.length
            ) {
              return controllerSequencer;
            }
            const nextPattern = removePadLoopItemsFromContainer(
              controllerSequencer.padLoopPattern,
              { kind: "root" },
              [normalizedSequenceIndex]
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...controllerSequencer,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    setControllerSequencerMeterNumerator: (controllerSequencerId, numerator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  meterNumerator: clampSequencerMeterNumerator(numerator)
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerMeterDenominator: (controllerSequencerId, denominator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  meterDenominator: clampSequencerMeterDenominator(denominator)
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerStepsPerBeat: (controllerSequencerId, stepsPerBeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerBeatRate: (controllerSequencerId, numerator, denominator) => {
      const sequencer = get().sequencer;
      const beatRate = normalizeSequencerBeatRate(numerator, denominator);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  beatRateNumerator: beatRate.numerator,
                  beatRateDenominator: beatRate.denominator
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerStepCount: (controllerSequencerId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedLengthBeats = normalizeControllerSequencerLengthBeats(stepCount);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const normalizedStepCount = resolvedControllerPadStepCount(
              normalizedLengthBeats,
              controllerSequencer.timing
            );
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad, index) =>
              index === activePad
                ? { ...pad, lengthBeats: normalizedLengthBeats, stepCount: normalizedStepCount }
                : cloneControllerSequencerPad(pad)
            );
            return {
              ...controllerSequencer,
              lengthBeats: normalizedLengthBeats,
              stepCount: normalizedStepCount,
              pads
            };
          })
        }
      });
    },

    addControllerSequencerKeypoint: (controllerSequencerId, position, value) => {
      const normalizedPosition = clampControllerCurvePosition(position);
      const normalizedValue = clampControllerCurveValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const nextKeypoints = normalizeControllerCurveKeypoints([
              ...sourcePad.keypoints,
              {
                id: crypto.randomUUID(),
                position: normalizedPosition,
                value: normalizedValue
              }
            ]);
            pads[activePad] = {
              ...sourcePad,
              keypoints: nextKeypoints
            };
            return {
              ...controllerSequencer,
              pads,
              keypoints: nextKeypoints
            };
          })
        }
      });
    },

    setControllerSequencerKeypoint: (controllerSequencerId, keypointId, position, value) => {
      const normalizedPosition = clampControllerCurvePosition(position);
      const normalizedValue = clampControllerCurveValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);

            const nextKeypoints = sourcePad.keypoints.map((keypoint) => {
              if (keypoint.id !== keypointId) {
                return keypoint;
              }

              const isStart = keypoint.position <= 1e-6;
              const isEnd = keypoint.position >= 1 - 1e-6;
              return {
                ...keypoint,
                position: isStart ? 0 : isEnd ? 1 : normalizedPosition,
                value: normalizedValue
              };
            });

            const movedPoint = sourcePad.keypoints.find((keypoint) => keypoint.id === keypointId);
            const movedIsBorder =
              (movedPoint?.position ?? 0) <= 1e-6 || (movedPoint?.position ?? 0) >= 1 - 1e-6;
            const linkedKeypoints = movedIsBorder
              ? nextKeypoints.map((keypoint) =>
                  keypoint.position <= 1e-6 || keypoint.position >= 1 - 1e-6
                    ? { ...keypoint, value: normalizedValue }
                    : keypoint
                )
              : nextKeypoints;
            const normalizedKeypoints = normalizeControllerCurveKeypoints(linkedKeypoints);
            pads[activePad] = {
              ...sourcePad,
              keypoints: normalizedKeypoints
            };

            return {
              ...controllerSequencer,
              pads,
              keypoints: normalizedKeypoints
            };
          })
        }
      });
    },

    setControllerSequencerKeypointValue: (controllerSequencerId, keypointId, value) => {
      const normalizedValue = clampControllerCurveValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const target = sourcePad.keypoints.find((keypoint) => keypoint.id === keypointId);
            const isBorderTarget =
              (target?.position ?? 0) <= 1e-6 || (target?.position ?? 0) >= 1 - 1e-6;
            const nextKeypoints = sourcePad.keypoints.map((keypoint) => {
              if (keypoint.id === keypointId) {
                return { ...keypoint, value: normalizedValue };
              }
              if (isBorderTarget && (keypoint.position <= 1e-6 || keypoint.position >= 1 - 1e-6)) {
                return { ...keypoint, value: normalizedValue };
              }
              return keypoint;
            });
            const normalizedKeypoints = normalizeControllerCurveKeypoints(nextKeypoints);
            pads[activePad] = {
              ...sourcePad,
              keypoints: normalizedKeypoints
            };
            return {
              ...controllerSequencer,
              pads,
              keypoints: normalizedKeypoints
            };
          })
        }
      });
    },

    removeControllerSequencerKeypoint: (controllerSequencerId, keypointId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...(() => {
                    const activePad = normalizePadIndex(controllerSequencer.activePad);
                    const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
                    const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
                    const normalizedKeypoints = normalizeControllerCurveKeypoints(
                      sourcePad.keypoints.filter((keypoint) => {
                        const isBorder =
                          keypoint.position <= 1e-6 || keypoint.position >= 1 - 1e-6;
                        if (isBorder) {
                          return true;
                        }
                        return keypoint.id !== keypointId;
                      })
                    );
                    pads[activePad] = {
                      ...sourcePad,
                      keypoints: normalizedKeypoints
                    };
                    return {
                      ...controllerSequencer,
                      pads,
                      keypoints: normalizedKeypoints
                    };
                  })()
                }
              : controllerSequencer
          )
        }
      });
    },

    syncControllerSequencerRuntime: (updates) => {
      const sequencer = get().sequencer;
      const sequencerRuntime = get().sequencerRuntime;
      const byId = new Map(updates.map((update) => [update.controllerSequencerId, update]));
      if (byId.size === 0) {
        return;
      }
      const nextControllerRuntimePadStartSubunitById = { ...sequencerRuntime.controllerRuntimePadStartSubunitById };
      let runtimeChanged = false;
      let controllerSequencersChanged = false;
      const nextControllerSequencers = sequencer.controllerSequencers.map((controllerSequencer) => {
        const update = byId.get(controllerSequencer.id);
        if (!update) {
          return controllerSequencer;
        }

        const nextActivePad =
          update.activePad === undefined ? controllerSequencer.activePad : normalizePadIndex(update.activePad);
        const nextQueuedPad =
          update.queuedPad === undefined
            ? controllerSequencer.queuedPad
            : update.queuedPad === null
              ? null
              : normalizePadIndex(update.queuedPad);
        const nextPadLoopPosition =
          update.padLoopPosition === undefined
            ? controllerSequencer.padLoopPosition
            : update.padLoopPosition === null
              ? null
              : Math.max(0, Math.round(update.padLoopPosition));
        const nextEnabled = update.enabled === undefined ? controllerSequencer.enabled : update.enabled === true;
        const activePadChanged = nextActivePad !== controllerSequencer.activePad;
        const selectedPad =
          controllerSequencer.pads[nextActivePad] ??
          controllerSequencer.pads[0] ??
          fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
        const nextLengthBeats = normalizeControllerSequencerLengthBeats(selectedPad.lengthBeats);
        const nextStepCount = normalizeTransportStepCount(selectedPad.stepCount);
        const nextKeypoints = normalizeControllerCurveKeypoints(selectedPad.keypoints);

        const runtimeCandidate =
          update.runtimePadStartSubunit === undefined
            ? sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null
            : update.runtimePadStartSubunit;
        const normalizedRuntimePadStartSubunit =
          typeof runtimeCandidate === "number" && Number.isFinite(runtimeCandidate)
            ? Math.max(0, Math.floor(runtimeCandidate))
            : null;
        const nextRuntimePadStartSubunit = nextEnabled ? normalizedRuntimePadStartSubunit : null;
        if (
          (nextControllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null) !==
          nextRuntimePadStartSubunit
        ) {
          nextControllerRuntimePadStartSubunitById[controllerSequencer.id] = nextRuntimePadStartSubunit;
          runtimeChanged = true;
        }

        if (
          !activePadChanged &&
          nextQueuedPad === controllerSequencer.queuedPad &&
          nextPadLoopPosition === controllerSequencer.padLoopPosition &&
          nextEnabled === controllerSequencer.enabled &&
          nextLengthBeats === controllerSequencer.lengthBeats &&
          nextStepCount === controllerSequencer.stepCount
        ) {
          return controllerSequencer;
        }

        controllerSequencersChanged = true;
        return {
          ...controllerSequencer,
          activePad: nextActivePad,
          queuedPad: nextEnabled ? nextQueuedPad : null,
          padLoopPosition: nextEnabled ? nextPadLoopPosition : null,
          enabled: nextEnabled,
          lengthBeats: nextLengthBeats,
          stepCount: nextStepCount,
          keypoints: activePadChanged ? nextKeypoints : controllerSequencer.keypoints
        };
      });

      if (!controllerSequencersChanged && !runtimeChanged) {
        return;
      }

      set({
        ...(controllerSequencersChanged
          ? {
              sequencer: {
                ...sequencer,
                controllerSequencers: nextControllerSequencers
              }
            }
          : {}),
        ...(runtimeChanged
          ? {
              sequencerRuntime: {
                ...sequencerRuntime,
                controllerRuntimePadStartSubunitById: nextControllerRuntimePadStartSubunitById
              }
            }
          : {})
      });
    },

    setSequencerBpm: (bpm) => {
      const sequencer = get().sequencer;
      const nextSequencer = syncSequencerTimingState(sequencer, {
        ...sequencer.timing,
        tempoBPM: clampSequencerTempoBpm(bpm)
      });
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerMeterNumerator: (numerator) => {
      const sequencer = get().sequencer;
      const timing = {
        ...sequencer.timing,
        meterNumerator: clampSequencerMeterNumerator(numerator)
      };
      const nextSequencer = syncSequencerTimingState(sequencer, timing);
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerMeterDenominator: (denominator) => {
      const sequencer = get().sequencer;
      const timing = {
        ...sequencer.timing,
        meterDenominator: clampSequencerMeterDenominator(denominator)
      };
      const nextSequencer = syncSequencerTimingState(sequencer, timing);
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerStepsPerBeat: (stepsPerBeat) => {
      const sequencer = get().sequencer;
      const timing = {
        ...sequencer.timing,
        stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
      };
      const nextSequencer = syncSequencerTimingState(sequencer, timing);
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerArrangerLoopSelection: (selection) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          arrangerLoopSelection: normalizeArrangerLoopSelection(
            selection,
            Number.MAX_SAFE_INTEGER,
            sequencerTransportStepsPerBeat(sequencer.timing)
          )
        }
      });
    },

    setSequencerPlaying: (isPlaying) => {
      const sequencer = get().sequencer;
      const sequencerRuntime = get().sequencerRuntime;
      const nextTrackLocalStepById: Record<string, number | null> = {};
      for (const track of sequencer.tracks) {
        nextTrackLocalStepById[track.id] = isPlaying ? (sequencerRuntime.trackLocalStepById[track.id] ?? null) : null;
      }
      const nextDrummerTrackLocalStepById: Record<string, number | null> = {};
      for (const track of sequencer.drummerTracks) {
        nextDrummerTrackLocalStepById[track.id] = isPlaying
          ? (sequencerRuntime.drummerTrackLocalStepById[track.id] ?? null)
          : null;
      }
      const nextControllerRuntimePadStartStepById: Record<string, number | null> = {};
      for (const controllerSequencer of sequencer.controllerSequencers) {
        nextControllerRuntimePadStartStepById[controllerSequencer.id] = isPlaying
          ? (sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null)
          : null;
      }
      set({
        sequencer: {
          ...sequencer,
          isPlaying: isPlaying === true,
          tracks: sequencer.tracks.map((track) => ({
            ...track,
            queuedPad: isPlaying ? track.queuedPad : null,
            padLoopPosition: isPlaying ? track.padLoopPosition : null,
            queuedEnabled: isPlaying ? track.queuedEnabled : null
          })),
          drummerTracks: sequencer.drummerTracks.map((track) => ({
            ...track,
            queuedPad: isPlaying ? track.queuedPad : null,
            padLoopPosition: isPlaying ? track.padLoopPosition : null,
            queuedEnabled: isPlaying ? track.queuedEnabled : null
          })),
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => ({
            ...controllerSequencer,
            queuedPad: isPlaying ? controllerSequencer.queuedPad : null,
            padLoopPosition: isPlaying ? controllerSequencer.padLoopPosition : null
          }))
        },
        sequencerRuntime: {
          ...sequencerRuntime,
          isPlaying: isPlaying === true,
          trackLocalStepById: nextTrackLocalStepById,
          drummerTrackLocalStepById: nextDrummerTrackLocalStepById,
          controllerRuntimePadStartSubunitById: nextControllerRuntimePadStartStepById
        }
      });
    },

    setSequencerPlayhead: (playhead) => {
      const sequencerRuntime = get().sequencerRuntime;
      const boundedStepCount = normalizeTransportStepCount(sequencerRuntime.stepCount);
      const normalizedPlayhead = ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;
      set({
        sequencerRuntime: {
          ...sequencerRuntime,
          playhead: normalizedPlayhead,
          transportSubunit:
            Math.max(0, Math.round(sequencerRuntime.cycle)) * boundedStepCount * sequencerTransportSubunitsPerStep() +
            normalizedPlayhead * sequencerTransportSubunitsPerStep()
        }
      });
    },

    setSequencerTransportAbsoluteStep: (absoluteStep) => {
      const sequencerRuntime = get().sequencerRuntime;
      const boundedStepCount = normalizeTransportStepCount(sequencerRuntime.stepCount);
      const normalizedStep = Math.max(0, Math.round(absoluteStep));
      const { playhead, cycle } = transportPositionFromAbsoluteStep(normalizedStep, boundedStepCount);
      set({
        sequencerRuntime: {
          ...sequencerRuntime,
          playhead,
          cycle,
          transportSubunit: normalizedStep * sequencerTransportSubunitsPerStep()
        }
      });
    },

    syncSequencerRuntime: ({ isPlaying, transportStepCount, playhead, cycle, transportSubunit, tracks, drummerTracks }) => {
      const sequencer = get().sequencer;
      const sequencerRuntime = get().sequencerRuntime;
      const nextIsPlaying = isPlaying === true;
      const boundedStepCount = normalizeTransportStepCount(transportStepCount ?? sequencerRuntime.stepCount);
      const normalizedPlayhead =
        playhead === undefined
          ? sequencerRuntime.playhead
          : ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;
      const normalizedCycle = cycle === undefined ? sequencerRuntime.cycle : Math.max(0, Math.round(cycle));
      const nextTransportSubunit =
        transportSubunit === undefined
          ? normalizedCycle * boundedStepCount * sequencerTransportSubunitsPerStep() +
            normalizedPlayhead * sequencerTransportSubunitsPerStep()
          : Math.max(0, Math.floor(transportSubunit));
      const trackPayload = new Map((tracks ?? []).map((track) => [track.trackId, track]));
      const drummerTrackPayload = new Map((drummerTracks ?? []).map((track) => [track.trackId, track]));
      let sequencerChanged = sequencer.isPlaying !== nextIsPlaying;
      const nextTracks = sequencer.tracks.map((track) => {
        const payload = trackPayload.get(track.id);
        if (!payload) {
          if (!nextIsPlaying) {
            if (track.queuedPad === null && track.padLoopPosition === null && track.queuedEnabled === null) {
              return track;
            }
            sequencerChanged = true;
            return {
              ...track,
              queuedPad: null,
              padLoopPosition: null,
              queuedEnabled: null
            };
          }
          return track;
        }

        const nextActivePad =
          payload.activePad === undefined ? track.activePad : normalizePadIndex(payload.activePad);
        const currentSelectedPad = track.pads[nextActivePad] ?? track.pads[0];
        const nextStepCount = normalizeTransportStepCount(payload.stepCount ?? currentSelectedPad?.stepCount ?? track.stepCount);
        const nextLengthBeats = normalizeSequencerPadLengthBeats(currentSelectedPad?.lengthBeats ?? track.lengthBeats);
        const nextQueuedPad =
          payload.queuedPad === undefined
            ? track.queuedPad
            : payload.queuedPad === null
              ? null
              : normalizePadIndex(payload.queuedPad);
        const nextPadLoopPosition =
          payload.padLoopPosition === undefined
            ? track.padLoopPosition
            : payload.padLoopPosition === null
              ? null
              : Math.max(0, Math.round(payload.padLoopPosition));
        const nextEnabled = payload.enabled === undefined ? track.enabled : payload.enabled;
        const nextQueuedEnabled =
          payload.queuedEnabled === undefined
            ? track.queuedEnabled
            : payload.queuedEnabled === null
              ? null
              : payload.queuedEnabled;
        const selectedPad = track.pads[nextActivePad] ?? track.pads[0];
        const nextScaleRoot = selectedPad?.scaleRoot ?? track.scaleRoot;
        const nextScaleType = selectedPad?.scaleType ?? track.scaleType;
        const nextMode = selectedPad?.mode ?? track.mode;

        if (
          nextActivePad === track.activePad &&
          nextQueuedPad === track.queuedPad &&
          nextPadLoopPosition === track.padLoopPosition &&
          nextLengthBeats === track.lengthBeats &&
          nextStepCount === track.stepCount &&
          nextEnabled === track.enabled &&
          nextQueuedEnabled === track.queuedEnabled &&
          nextScaleRoot === track.scaleRoot &&
          nextScaleType === track.scaleType &&
          nextMode === track.mode
        ) {
          return track;
        }

        sequencerChanged = true;
        return {
          ...track,
          activePad: nextActivePad,
          queuedPad: nextQueuedPad,
          padLoopPosition: nextPadLoopPosition,
          lengthBeats: nextLengthBeats,
          stepCount: nextStepCount,
          enabled: nextEnabled,
          queuedEnabled: nextQueuedEnabled,
          scaleRoot: nextScaleRoot,
          scaleType: nextScaleType,
          mode: nextMode,
          steps:
            nextActivePad === track.activePad
              ? track.steps
              : cloneSequencerSteps(selectedPad?.steps ?? track.steps)
        };
      });
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        const payload = drummerTrackPayload.get(track.id) as
          | {
              stepCount?: DrummerSequencerStepCount;
              localStep?: number;
              activePad?: number;
              queuedPad?: number | null;
              padLoopPosition?: number | null;
              enabled?: boolean;
              queuedEnabled?: boolean | null;
            }
          | undefined;
        if (!payload) {
          if (!nextIsPlaying) {
            if (track.queuedPad === null && track.padLoopPosition === null && track.queuedEnabled === null) {
              return track;
            }
            sequencerChanged = true;
            return {
              ...track,
              queuedPad: null,
              padLoopPosition: null,
              queuedEnabled: null
            };
          }
          return track;
        }

        const nextActivePad =
          payload.activePad === undefined ? track.activePad : normalizePadIndex(payload.activePad);
        const selectedPad = track.pads[nextActivePad] ?? track.pads[0];
        const nextStepCount = normalizeTransportStepCount(payload.stepCount ?? selectedPad?.stepCount ?? track.stepCount);
        const nextLengthBeats = normalizeSequencerPadLengthBeats(selectedPad?.lengthBeats ?? track.lengthBeats);
        const nextQueuedPad =
          payload.queuedPad === undefined
            ? track.queuedPad
            : payload.queuedPad === null
              ? null
              : normalizePadIndex(payload.queuedPad);
        const nextPadLoopPosition =
          payload.padLoopPosition === undefined
            ? track.padLoopPosition
            : payload.padLoopPosition === null
              ? null
              : Math.max(0, Math.round(payload.padLoopPosition));
        const nextEnabled = payload.enabled === undefined ? track.enabled : payload.enabled;
        const nextQueuedEnabled =
          payload.queuedEnabled === undefined
            ? track.queuedEnabled
            : payload.queuedEnabled === null
              ? null
              : payload.queuedEnabled;

        if (
          nextActivePad === track.activePad &&
          nextQueuedPad === track.queuedPad &&
          nextPadLoopPosition === track.padLoopPosition &&
          nextLengthBeats === track.lengthBeats &&
          nextStepCount === track.stepCount &&
          nextEnabled === track.enabled &&
          nextQueuedEnabled === track.queuedEnabled
        ) {
          return track;
        }

        sequencerChanged = true;
        return {
          ...track,
          activePad: nextActivePad,
          queuedPad: nextQueuedPad,
          padLoopPosition: nextPadLoopPosition,
          lengthBeats: nextLengthBeats,
          stepCount: nextStepCount,
          enabled: nextEnabled,
          queuedEnabled: nextQueuedEnabled
        };
      });
      const nextControllerSequencers = sequencer.controllerSequencers.map((controllerSequencer) =>
        nextIsPlaying
          ? controllerSequencer
          : {
              ...controllerSequencer,
              queuedPad: null,
              padLoopPosition: null
            }
      );
      if (
        !nextIsPlaying &&
        nextControllerSequencers.some(
          (controllerSequencer, index) => controllerSequencer !== sequencer.controllerSequencers[index]
        )
      ) {
        sequencerChanged = true;
      }

      const nextTrackLocalStepById: Record<string, number | null> = {};
      for (const track of nextTracks) {
        const payload = trackPayload.get(track.id);
        const normalizedLocalStep =
          !nextIsPlaying || !payload || payload.localStep === undefined
            ? null
            : Math.max(0, Math.round(payload.localStep)) % Math.max(1, normalizeSequencerTrackStepCount(track.stepCount));
        nextTrackLocalStepById[track.id] =
          normalizedLocalStep === null ? sequencerRuntime.trackLocalStepById[track.id] ?? null : normalizedLocalStep;
      }
      if (!nextIsPlaying) {
        for (const trackId of Object.keys(nextTrackLocalStepById)) {
          nextTrackLocalStepById[trackId] = null;
        }
      }

      const nextDrummerTrackLocalStepById: Record<string, number | null> = {};
      for (const track of nextDrummerTracks) {
        const payload = drummerTrackPayload.get(track.id);
        const normalizedLocalStep =
          !nextIsPlaying || !payload || payload.localStep === undefined
            ? null
            : Math.max(0, Math.round(payload.localStep)) % Math.max(1, normalizeDrummerSequencerStepCount(track.stepCount));
        nextDrummerTrackLocalStepById[track.id] =
          normalizedLocalStep === null
            ? sequencerRuntime.drummerTrackLocalStepById[track.id] ?? null
            : normalizedLocalStep;
      }
      if (!nextIsPlaying) {
        for (const trackId of Object.keys(nextDrummerTrackLocalStepById)) {
          nextDrummerTrackLocalStepById[trackId] = null;
        }
      }

      const nextControllerRuntimePadStartStepById: Record<string, number | null> = {};
      for (const controllerSequencer of nextControllerSequencers) {
        nextControllerRuntimePadStartStepById[controllerSequencer.id] = nextIsPlaying
          ? (sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null)
          : null;
      }

      set({
        ...(sequencerChanged
          ? {
              sequencer: {
                ...sequencer,
                isPlaying: nextIsPlaying,
                tracks: nextTracks,
                controllerSequencers: nextControllerSequencers,
                drummerTracks: nextDrummerTracks
              }
            }
          : {}),
        sequencerRuntime: {
          ...sequencerRuntime,
          isPlaying: nextIsPlaying,
          stepCount: boundedStepCount,
          cycle: normalizedCycle,
          playhead: normalizedPlayhead,
          transportSubunit: nextTransportSubunit,
          trackLocalStepById: nextTrackLocalStepById,
          drummerTrackLocalStepById: nextDrummerTrackLocalStepById,
          controllerRuntimePadStartSubunitById: nextControllerRuntimePadStartStepById
        }
      });
    },

    applyEngineConfig: async ({ sr, controlRate, softwareBuffer, hardwareBuffer }) => {
      const currentPatch = get().currentPatch;
      const currentEngine = normalizeEngineConfig(currentPatch.graph.engine_config);
      const nextSr = clampInt(sr, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
      const nextControlRate = clampInt(controlRate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
      const nextSoftwareBuffer = clampInt(softwareBuffer, ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX);
      const nextHardwareBuffer = clampInt(hardwareBuffer, ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX);
      const nextKsmps = Math.max(1, Math.round(nextSr / nextControlRate));

      const nextPatch: EditablePatch = {
        ...currentPatch,
        graph: {
          ...currentPatch.graph,
          engine_config: {
            ...currentEngine,
            sr: nextSr,
            control_rate: nextControlRate,
            ksmps: nextKsmps,
            software_buffer: nextSoftwareBuffer,
            hardware_buffer: nextHardwareBuffer
          }
        }
      };

      commitCurrentPatch(nextPatch, { error: null });

      const normalizedGraph = withNormalizedEngineConfig(nextPatch.graph);

      try {
        let persisted: Patch;
        if (nextPatch.id) {
          persisted = await api.updatePatch(nextPatch.id, { graph: normalizedGraph });
        } else {
          persisted = await api.createPatch({
            name: nextPatch.name,
            description: nextPatch.description,
            schema_version: nextPatch.schema_version,
            graph: normalizedGraph
          });
        }

        const patches = await api.listPatches();
        const persistedNormalized = normalizePatch(persisted);
        const resolvedPatch: EditablePatch = nextPatch.id
          ? {
              ...nextPatch,
              graph: normalizedGraph,
              created_at: persistedNormalized.created_at,
              updated_at: persistedNormalized.updated_at
            }
          : persistedNormalized;

        const state = get();
        const hasKnownBindings = state.sequencerInstruments.length > 0;
        const sequencerInstruments = hasKnownBindings
          ? state.sequencerInstruments
          : defaultSequencerInstruments(patches, resolvedPatch.id);

        commitCurrentPatch(resolvedPatch, {
          patches,
          sequencerInstruments,
          error: null
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to persist engine configuration."
        });
      }
    },

    ensureSession: async () => {
      const requestedAssignments = normalizeSessionInstrumentAssignments(get().sequencerInstruments);
      let sessionId = get().activeSessionId;

      if (sessionId && sameAssignments(requestedAssignments, get().activeSessionInstruments)) {
        try {
          await api.getSession(sessionId);
          return sessionId;
        } catch (error) {
          if (!isApiError(error) || error.status !== 404) {
            throw error;
          }

          set({
            activeSessionId: null,
            activeSessionState: "idle",
            activeSessionInstruments: [],
            compileOutput: null,
            events: []
          });
          sessionId = null;
        }
      }

      if (sessionId && !sameAssignments(requestedAssignments, get().activeSessionInstruments)) {
        try {
          await api.stopSession(sessionId);
        } catch {
          // Ignore if session wasn't running.
        }
        try {
          await api.deleteSession(sessionId);
        } catch {
          // Ignore cleanup failures and continue with a fresh session.
        }

        set({
          activeSessionId: null,
          activeSessionState: "idle",
          activeSessionInstruments: [],
          compileOutput: null,
          events: []
        });
        sessionId = null;
      }

      if (sessionId) {
        return sessionId;
      }

      const session = await api.createSession(requestedAssignments);
      sessionId = session.session_id;

      const midiInput = get().activeMidiInput;
      let boundMidiInput = midiInput;
      if (midiInput) {
        try {
          const boundSession = await api.bindMidiInput(sessionId, midiInput);
          boundMidiInput = boundSession.midi_input ?? midiInput;
        } catch {
          // Keep session creation successful even if MIDI binding fails.
        }
      }

      set({
        activeSessionId: sessionId,
        activeSessionState: session.state,
        activeMidiInput: boundMidiInput,
        activeSessionInstruments: session.instruments.length > 0 ? session.instruments : requestedAssignments
      });

      return sessionId;
    },

    compileSession: async () => {
      set({ loading: true, error: null });
      try {
        const current = {
          ...get().currentPatch,
          graph: withNormalizedEngineConfig(get().currentPatch.graph)
        };

        const patchName = current.name.trim().length > 0 ? current.name.trim() : "Untitled Patch";
        const temporaryPatch = await api.createPatch({
          name: patchName,
          description: current.description,
          schema_version: current.schema_version,
          graph: current.graph
        });

        let compileOutput = null as CompileResponse | null;
        try {
          const compileSession = await api.createSession([
            {
              patch_id: temporaryPatch.id,
              midi_channel: 1
            }
          ]);

          const sessionId = compileSession.session_id;
          try {
            const midiInput = get().activeMidiInput;
            if (midiInput) {
              try {
                await api.bindMidiInput(sessionId, midiInput);
              } catch {
                // Keep compile successful even if MIDI binding fails for temporary validation session.
              }
            }

            compileOutput = await api.compileSession(sessionId);
          } finally {
            try {
              await api.deleteSession(sessionId);
            } catch {
              // Best-effort cleanup for temporary compile sessions.
            }
          }
        } finally {
          try {
            await api.deletePatch(temporaryPatch.id);
          } catch {
            // Best-effort cleanup for temporary compile validation patch.
          }
        }

        if (!compileOutput) {
          throw new Error("Failed to compile current patch.");
        }

        set({
          compileOutput,
          loading: false,
          error: null
        });
        return compileOutput;
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to compile session"
        });
        return null;
      }
    },

    startSession: async () => {
      set({ loading: true, error: null });
      try {
        const sessionId = await get().ensureSession();
        const compileOutput = await api.compileSession(sessionId);
        const response = await api.startSession(sessionId);
        set({ compileOutput, activeSessionState: response.state, loading: false });
      } catch (error) {
        set({
          loading: false,
          activeSessionState: "error",
          error: error instanceof Error ? error.message : "Failed to start session"
        });
      }
    },

    stopSession: async () => {
      const sessionId = get().activeSessionId;
      if (!sessionId) {
        return;
      }

      set({ loading: true, error: null });
      try {
        const response = await api.stopSession(sessionId);
        set({ activeSessionState: response.state, loading: false });
      } catch (error) {
        set({
          loading: false,
          activeSessionState: "error",
          error: error instanceof Error ? error.message : "Failed to stop session"
        });
      }
    },

    panicSession: async () => {
      const sessionId = get().activeSessionId;
      if (!sessionId) {
        return;
      }

      set({ loading: true, error: null });
      try {
        await api.panicSession(sessionId);
        set({ loading: false });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to send panic"
        });
      }
    },

    bindMidiInput: async (midiInput: string) => {
      const sessionId = get().activeSessionId;
      if (!sessionId) {
        set({ activeMidiInput: midiInput });
        return;
      }

      set({ loading: true, error: null });
      try {
        const session = await api.bindMidiInput(sessionId, midiInput);
        set({
          activeSessionState: session.state,
          activeMidiInput: session.midi_input ?? midiInput,
          loading: false
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to bind MIDI input"
        });
      }
    },

    pushEvent: (event: SessionEvent) => {
      const events = get().events;
      set({ events: [...events.slice(-199), event] });
    }
  };
});

async function flushPersistedAppState(): Promise<void> {
  if (persistInFlight) {
    return;
  }

  const snapshot = pendingPersistSnapshot;
  if (!snapshot) {
    return;
  }

  pendingPersistSnapshot = null;
  const signature = JSON.stringify(snapshot);
  if (signature === lastPersistedSignature) {
    return;
  }

  persistInFlight = true;
  try {
    await api.saveAppState(snapshot);
    lastPersistedSignature = signature;
  } catch {
    // Retry failed saves when the next state change occurs.
    pendingPersistSnapshot = snapshot;
  } finally {
    persistInFlight = false;
    if (pendingPersistSnapshot) {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
      }
      persistTimer = setTimeout(() => {
        persistTimer = null;
        void flushPersistedAppState();
      }, APP_STATE_PERSIST_DEBOUNCE_MS);
    }
  }
}

function schedulePersistedAppState(snapshot: PersistedAppState): void {
  pendingPersistSnapshot = snapshot;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersistedAppState();
  }, APP_STATE_PERSIST_DEBOUNCE_MS);
}

useAppStore.subscribe((state) => {
  if (!state.hasLoadedBootstrap) {
    return;
  }

  const watchState = capturePersistWatchState(state);
  if (!hasPersistableStateChange(watchState, lastPersistWatchState)) {
    return;
  }
  if (isSequencerRuntimeOnlyUpdate(watchState, lastPersistWatchState)) {
    // Runtime transport ticks should not trigger full persisted snapshot rebuilds.
    // Sequencer edits made while running are still captured on the next non-runtime transition (e.g. stop).
    return;
  }

  const snapshot = buildPersistedAppStateSnapshot(state);
  lastPersistWatchState = watchState;

  schedulePersistedAppState(snapshot);
});
