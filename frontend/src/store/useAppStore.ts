import { create } from "zustand";

import { api, isApiError } from "../api/client";
import { createUntitledPatch } from "../lib/defaultPatch";
import { normalizeGuiLanguage } from "../lib/guiLanguage";
import {
  clampControllerCurvePosition,
  clampControllerCurveValue,
  clampControllerSequencerStepCount,
  defaultModeForScaleType,
  linkedModeForScaleType,
  linkedScaleTypeForMode,
  normalizeControllerCurveKeypoints,
  normalizeSequencerChord,
  normalizeSequencerMode,
  normalizeSequencerScaleRoot,
  normalizeSequencerScaleType,
  resolveDiatonicSequencerChordVariant,
  transposeSequencerNoteByScaleDegree,
  transposeSequencerTonicByDiatonicStep
} from "../lib/sequencer";
import type {
  AppPage,
  CompileResponse,
  ControllerSequencerKeypoint,
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
  Patch,
  PatchGraph,
  PatchListItem,
  PerformanceListItem,
  PersistedAppState,
  MidiControllerState,
  PianoRollState,
  SequencerChord,
  SequencerConfigSnapshot,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerPadState,
  SequencerStepState,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
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
  saveCurrentPerformance: () => Promise<void>;

  addSequencerInstrument: () => void;
  removeSequencerInstrument: (bindingId: string) => void;
  updateSequencerInstrumentPatch: (bindingId: string, patchId: string) => void;
  updateSequencerInstrumentChannel: (bindingId: string, channel: number) => void;
  buildSequencerConfigSnapshot: () => SequencerConfigSnapshot;
  applySequencerConfigSnapshot: (snapshot: unknown) => void;

  addSequencerTrack: () => void;
  removeSequencerTrack: (trackId: string) => void;
  setSequencerTrackEnabled: (trackId: string, enabled: boolean, queueOnCycle?: boolean) => void;
  setSequencerTrackMidiChannel: (trackId: string, channel: number) => void;
  setSequencerTrackSyncTarget: (trackId: string, syncToTrackId: string | null) => void;
  setSequencerTrackScale: (trackId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  setSequencerTrackMode: (trackId: string, mode: SequencerMode) => void;
  setSequencerTrackStepCount: (trackId: string, stepCount: 16 | 32) => void;
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
  addSequencerTrackPadLoopStep: (trackId: string, padIndex: number) => void;
  removeSequencerTrackPadLoopStep: (trackId: string, sequenceIndex: number) => void;
  moveSequencerTrack: (sourceTrackId: string, targetTrackId: string, position?: "before" | "after") => void;

  addDrummerSequencerTrack: () => void;
  removeDrummerSequencerTrack: (trackId: string) => void;
  setDrummerSequencerTrackEnabled: (trackId: string, enabled: boolean, queueOnCycle?: boolean) => void;
  setDrummerSequencerTrackMidiChannel: (trackId: string, channel: number) => void;
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
  addDrummerSequencerTrackPadLoopStep: (trackId: string, padIndex: number) => void;
  removeDrummerSequencerTrackPadLoopStep: (trackId: string, sequenceIndex: number) => void;

  addPianoRoll: () => void;
  removePianoRoll: (rollId: string) => void;
  setPianoRollEnabled: (rollId: string, enabled: boolean) => void;
  setPianoRollMidiChannel: (rollId: string, channel: number) => void;
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
  addControllerSequencerPadLoopStep: (controllerSequencerId: string, padIndex: number) => void;
  removeControllerSequencerPadLoopStep: (controllerSequencerId: string, sequenceIndex: number) => void;
  setControllerSequencerStepCount: (controllerSequencerId: string, stepCount: 8 | 16 | 32 | 64) => void;
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
      runtimePadStartStep?: number | null;
      enabled?: boolean;
    }>
  ) => void;

  setSequencerBpm: (bpm: number) => void;
  syncSequencerRuntime: (payload: {
    isPlaying: boolean;
    transportStepCount?: 16 | 32;
    playhead?: number;
    cycle?: number;
    tracks?: Array<{
      trackId: string;
      stepCount?: 4 | 8 | 16 | 32;
      localStep?: number;
      activePad?: number;
      queuedPad?: number | null;
      padLoopPosition?: number | null;
      enabled?: boolean;
      queuedEnabled?: boolean | null;
    }>;
    drummerTracks?: Array<{
      trackId: string;
      stepCount?: DrummerSequencerStepCount;
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
let bootstrapLoadInFlight: Promise<void> | null = null;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeStepCount(value: number): 16 | 32 {
  return value === 32 ? 32 : 16;
}

function sequencerTrackHas32StepPad(track: SequencerTrackState): boolean {
  if (Array.isArray(track.pads) && track.pads.some((pad) => normalizeStepCount(pad.stepCount ?? track.stepCount) === 32)) {
    return true;
  }
  return normalizeStepCount(track.stepCount) === 32;
}

function transportStepCountForTracks(tracks: SequencerTrackState[]): 16 | 32 {
  if (tracks.some((track) => sequencerTrackHas32StepPad(track))) {
    return 32;
  }
  return 16;
}

function normalizeDrummerSequencerStepCount(value: unknown): DrummerSequencerStepCount {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 16;
  }
  const normalized = Math.round(value);
  if (normalized === 4 || normalized === 8 || normalized === 16 || normalized === 32) {
    return normalized;
  }
  return 16;
}

function drummerTrackHas32StepPad(track: DrummerSequencerTrackState): boolean {
  if (Array.isArray(track.pads) && track.pads.some((pad) => normalizeDrummerSequencerStepCount(pad.stepCount) === 32)) {
    return true;
  }
  return normalizeDrummerSequencerStepCount(track.stepCount) === 32;
}

function transportStepCountForPerformanceTracks(
  tracks: SequencerTrackState[],
  drummerTracks: DrummerSequencerTrackState[]
): 16 | 32 {
  if (tracks.some((track) => sequencerTrackHas32StepPad(track))) {
    return 32;
  }
  if (drummerTracks.some((track) => drummerTrackHas32StepPad(track))) {
    return 32;
  }
  return 16;
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
  return Array.from({ length: 32 }, () => createEmptySequencerStep());
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
  return Array.from({ length: 32 }, () => createEmptyDrummerSequencerCell());
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
    for (let index = 0; index < Math.min(32, rawSteps.length); index += 1) {
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
  stepCount: DrummerSequencerStepCount = 16
): DrummerSequencerPadState {
  return {
    stepCount: normalizeDrummerSequencerStepCount(stepCount),
    rows: rows.map((row) => ({
      rowId: row.id,
      steps: cloneDrummerSequencerCells(DEFAULT_DRUMMER_SEQUENCER_CELLS)
    }))
  };
}

function defaultDrummerSequencerPads(
  rows: DrummerSequencerRowState[],
  stepCount: DrummerSequencerStepCount = 16
): DrummerSequencerPadState[] {
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => buildDefaultDrummerSequencerPad(rows, stepCount));
}

function cloneDrummerSequencerPads(pads: DrummerSequencerPadState[]): DrummerSequencerPadState[] {
  return pads.map((pad) => ({
    stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
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
    stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
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

function normalizeControllerSequencerStepCount(value: unknown): 8 | 16 | 32 | 64 {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 16;
  }
  return clampControllerSequencerStepCount(value);
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
    stepCount: normalizeControllerSequencerStepCount(pad.stepCount),
    keypoints: normalizeControllerCurveKeypoints(pad.keypoints)
  };
}

function defaultControllerSequencerPad(stepCount: 8 | 16 | 32 | 64 = 16): ControllerSequencerPadState {
  return {
    stepCount: normalizeControllerSequencerStepCount(stepCount),
    keypoints: defaultControllerSequencerKeypoints()
  };
}

function defaultControllerSequencerPads(stepCount: 8 | 16 | 32 | 64 = 16): ControllerSequencerPadState[] {
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => defaultControllerSequencerPad(stepCount));
}

function normalizeControllerSequencerPadState(
  raw: unknown,
  fallback: ControllerSequencerPadState
): ControllerSequencerPadState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const pad = raw as Record<string, unknown>;
  const stepCount = normalizeControllerSequencerStepCount(pad.stepCount ?? pad.step_count ?? fallback.stepCount);
  const keypointsRaw = Array.isArray(pad.keypoints) ? pad.keypoints : [];
  const keypoints = normalizeControllerCurveKeypoints(
    keypointsRaw
      .map((entry, keypointIndex) => normalizeControllerSequencerKeypoint(entry, keypointIndex))
      .filter((point): point is ControllerSequencerKeypoint => point !== null)
  );

  return {
    stepCount,
    keypoints: keypoints.length > 0 ? keypoints : normalizeControllerCurveKeypoints(fallback.keypoints)
  };
}

function fallbackControllerSequencerPadStateForSequencer(
  controllerSequencer: Pick<ControllerSequencerState, "stepCount" | "keypoints">
): ControllerSequencerPadState {
  return {
    stepCount: normalizeControllerSequencerStepCount(controllerSequencer.stepCount),
    keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints)
  };
}

function defaultSequencerPads(
  scaleRoot: SequencerScaleRoot = "C",
  scaleType: SequencerScaleType = "minor",
  mode: SequencerMode = "aeolian",
  stepCount: 16 | 32 = 16
): SequencerPadState[] {
  const normalizedStepCount = normalizeStepCount(stepCount);
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => ({
    stepCount: normalizedStepCount,
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
    sequence.push(normalizePadIndex(entry));
    if (sequence.length >= 256) {
      break;
    }
  }
  return sequence;
}

function normalizePadSteps(raw: unknown): SequencerStepState[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const steps = cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS);
  for (let index = 0; index < Math.min(32, raw.length); index += 1) {
    steps[index] = normalizeSequencerStep(raw[index]);
  }
  return steps;
}

function normalizeSequencerPadState(raw: unknown, fallback: SequencerPadState): SequencerPadState | null {
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
  const stepCount = normalizeStepCount((pad.stepCount ?? pad.step_count ?? fallback.stepCount) as number);
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
    stepCount,
    steps,
    scaleRoot,
    scaleType,
    mode
  };
}

function fallbackSequencerPadStateForTrack(
  track: Pick<SequencerTrackState, "stepCount" | "scaleRoot" | "scaleType" | "mode">
): SequencerPadState {
  return {
    stepCount: normalizeStepCount(track.stepCount),
    steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
    scaleRoot: track.scaleRoot,
    scaleType: track.scaleType,
    mode: track.mode
  };
}

function fallbackDrummerSequencerPadStateForTrack(
  track: Pick<DrummerSequencerTrackState, "stepCount" | "rows">
): DrummerSequencerPadState {
  return buildDefaultDrummerSequencerPad(track.rows, normalizeDrummerSequencerStepCount(track.stepCount));
}

function defaultSequencerTrack(index = 1, midiChannel = 1): SequencerTrackState {
  const channel = clampInt(midiChannel, 1, 16);
  const scaleRoot: SequencerScaleRoot = "C";
  const scaleType: SequencerScaleType = "minor";
  const mode: SequencerMode = "aeolian";
  const pads = defaultSequencerPads(scaleRoot, scaleType, mode, 16);
  return {
    id: `voice-${index}`,
    name: `Sequencer ${index}`,
    midiChannel: channel,
    stepCount: 16,
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
    pads,
    steps: cloneSequencerSteps(pads[0]?.steps ?? DEFAULT_SEQUENCER_STEPS),
    runtimeLocalStep: null,
    enabled: false,
    queuedEnabled: null
  };
}

function defaultDrummerSequencerTrack(index = 1, midiChannel = 10): DrummerSequencerTrackState {
  const channel = clampInt(midiChannel, 1, 16);
  const rows = defaultDrummerSequencerRows();
  const stepCount: DrummerSequencerStepCount = 16;
  return {
    id: `drum-${index}`,
    name: `Drummer Sequencer ${index}`,
    midiChannel: channel,
    stepCount,
    activePad: 0,
    queuedPad: null,
    padLoopPosition: null,
    padLoopEnabled: false,
    padLoopRepeat: true,
    padLoopSequence: [],
    rows,
    pads: defaultDrummerSequencerPads(rows, stepCount),
    runtimeLocalStep: null,
    enabled: false,
    queuedEnabled: null
  };
}

function defaultPianoRoll(index = 1, midiChannel = 2): PianoRollState {
  const channel = clampInt(midiChannel, 1, 16);
  return {
    id: `piano-${index}`,
    name: `Piano Roll ${index}`,
    midiChannel: channel,
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

function defaultControllerSequencer(index = 1): ControllerSequencerState {
  const pads = defaultControllerSequencerPads(16);
  const activePad = 0;
  const activePadState = pads[activePad] ?? defaultControllerSequencerPad(16);
  return {
    id: `cc-seq-${index}`,
    name: `Controller Sequencer ${index}`,
    controllerNumber: clampInt(index - 1, 0, 127),
    stepCount: activePadState.stepCount,
    activePad,
    queuedPad: null,
    padLoopPosition: null,
    padLoopEnabled: false,
    padLoopRepeat: true,
    padLoopSequence: [],
    pads,
    runtimePadStartStep: null,
    enabled: false,
    keypoints: normalizeControllerCurveKeypoints(activePadState.keypoints)
  };
}

function normalizeControllerSequencerState(raw: unknown, index: number): ControllerSequencerState {
  const fallback = defaultControllerSequencer(index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const controllerSequencer = raw as Record<string, unknown>;
  const id =
    typeof controllerSequencer.id === "string" && controllerSequencer.id.length > 0
      ? controllerSequencer.id
      : fallback.id;
  const name =
    typeof controllerSequencer.name === "string" && controllerSequencer.name.trim().length > 0
      ? controllerSequencer.name
      : fallback.name;
  const controllerNumber = normalizeControllerNumber(controllerSequencer.controllerNumber);
  const legacyStepCount = normalizeControllerSequencerStepCount(
    controllerSequencer.stepCount ?? controllerSequencer.step_count
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
  const padLoopSequence = normalizePadLoopSequence(
    controllerSequencer.padLoopSequence ?? controllerSequencer.pad_loop_sequence
  );
  const enabled = typeof controllerSequencer.enabled === "boolean" ? controllerSequencer.enabled : fallback.enabled;

  const pads = defaultControllerSequencerPads(legacyStepCount);
  if (Array.isArray(controllerSequencer.pads)) {
    for (let padIndex = 0; padIndex < Math.min(DEFAULT_PAD_COUNT, controllerSequencer.pads.length); padIndex += 1) {
      const normalizedPad = normalizeControllerSequencerPadState(controllerSequencer.pads[padIndex], pads[padIndex]);
      if (normalizedPad) {
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
      stepCount: legacyStepCount,
      keypoints
    };
  }

  const activePadState = pads[activePad] ?? pads[0] ?? defaultControllerSequencerPad(legacyStepCount);
  const runtimePadStartStepRaw = controllerSequencer.runtimePadStartStep ?? controllerSequencer.runtime_pad_start_step;
  const runtimePadStartStep =
    typeof runtimePadStartStepRaw === "number" && Number.isFinite(runtimePadStartStepRaw)
      ? runtimePadStartStepRaw
      : null;

  return {
    id,
    name,
    controllerNumber,
    stepCount: activePadState.stepCount,
    activePad,
    queuedPad,
    padLoopPosition,
    padLoopEnabled,
    padLoopRepeat,
    padLoopSequence,
    pads: pads.map((pad) => cloneControllerSequencerPad(pad)),
    runtimePadStartStep,
    enabled,
    keypoints: normalizeControllerCurveKeypoints(activePadState.keypoints)
  };
}

function defaultSequencerState(): SequencerState {
  return {
    isPlaying: false,
    bpm: 120,
    stepCount: 16,
    playhead: 0,
    cycle: 0,
    tracks: [defaultSequencerTrack(1, 1)],
    drummerTracks: [],
    controllerSequencers: [],
    pianoRolls: [defaultPianoRoll(1, 2)],
    midiControllers: defaultMidiControllers()
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
  const fallback = defaultSequencerTrack(index, index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const track = raw as Record<string, unknown>;
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
  const stepCount =
    typeof track.stepCount === "number"
      ? normalizeStepCount(track.stepCount)
      : typeof track.step_count === "number"
        ? normalizeStepCount(track.step_count)
        : fallback.stepCount;
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
  const padLoopSequence = normalizePadLoopSequence(track.padLoopSequence ?? track.pad_loop_sequence);
  const enabled = typeof track.enabled === "boolean" ? track.enabled : fallback.enabled;
  const queuedEnabled = typeof track.queuedEnabled === "boolean" ? track.queuedEnabled : null;

  const pads = defaultSequencerPads(scaleRoot, scaleType, mode, stepCount);
  if (Array.isArray(track.pads)) {
    for (let padIndex = 0; padIndex < Math.min(DEFAULT_PAD_COUNT, track.pads.length); padIndex += 1) {
      const normalized = normalizeSequencerPadState(track.pads[padIndex], pads[padIndex]);
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
      stepCount,
      steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
      scaleRoot,
      scaleType,
      mode
    };

  return {
    id,
    name,
    midiChannel,
    stepCount: normalizeStepCount(activePadTheory.stepCount),
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
    pads,
    steps: cloneSequencerSteps(activePadTheory.steps),
    runtimeLocalStep: null,
    enabled,
    queuedEnabled
  };
}

function normalizeDrummerSequencerTrack(raw: unknown, index: number): DrummerSequencerTrackState {
  const fallback = defaultDrummerSequencerTrack(index, index === 1 ? 10 : index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const track = raw as Record<string, unknown>;
  const id =
    typeof track.id === "string" && track.id.length > 0
      ? track.id
      : typeof track.trackId === "string" && track.trackId.length > 0
        ? track.trackId
        : fallback.id;
  const name = typeof track.name === "string" && track.name.trim().length > 0 ? track.name : fallback.name;
  const midiChannel =
    typeof track.midiChannel === "number" ? clampInt(track.midiChannel, 1, 16) : fallback.midiChannel;
  const stepCount = normalizeDrummerSequencerStepCount(track.stepCount ?? track.step_count);
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
  const padLoopSequence = normalizePadLoopSequence(track.padLoopSequence ?? track.pad_loop_sequence);
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

  const pads = defaultDrummerSequencerPads(rows, stepCount);
  if (Array.isArray(track.pads)) {
    for (let padIndex = 0; padIndex < Math.min(DEFAULT_PAD_COUNT, track.pads.length); padIndex += 1) {
      const rawPad = track.pads[padIndex];
      let rawPadRows: unknown[] = [];
      let padStepCount: DrummerSequencerStepCount = pads[padIndex]?.stepCount ?? stepCount;
      if (Array.isArray(rawPad)) {
        rawPadRows = rawPad;
      } else if (rawPad && typeof rawPad === "object" && !Array.isArray(rawPad)) {
        const candidate = rawPad as Record<string, unknown>;
        padStepCount = normalizeDrummerSequencerStepCount(candidate.stepCount ?? candidate.step_count ?? padStepCount);
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
        stepCount: padStepCount,
        rows: rows.map((row) => normalizeDrummerSequencerRowPadState(byRowId.get(row.id) ?? null, row.id))
      };
    }
  }

  const activePadState = pads[activePad] ?? pads[0] ?? fallbackDrummerSequencerPadStateForTrack({ stepCount, rows });

  return {
    id,
    name,
    midiChannel,
    stepCount: normalizeDrummerSequencerStepCount(activePadState.stepCount),
    activePad,
    queuedPad,
    padLoopPosition,
    padLoopEnabled,
    padLoopRepeat,
    padLoopSequence,
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
  const scaleRoot = normalizeSequencerScaleRoot(roll.scaleRoot);
  const scaleType = normalizeSequencerScaleType(roll.scaleType);
  const fallbackMode = defaultModeForScaleType(scaleType);
  const mode = roll.mode !== undefined ? normalizeSequencerMode(roll.mode) : fallbackMode;
  const enabled = typeof roll.enabled === "boolean" ? roll.enabled : fallback.enabled;

  return {
    id,
    name,
    midiChannel,
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
  const bpm = typeof sequencer.bpm === "number" ? clampInt(sequencer.bpm, 30, 300) : defaults.bpm;
  const rawStepCount =
    typeof sequencer.stepCount === "number" ? normalizeStepCount(sequencer.stepCount) : defaults.stepCount;
  const playhead = typeof sequencer.playhead === "number" ? Math.max(0, Math.round(sequencer.playhead)) : 0;

  const tracks: SequencerTrackState[] = [];
  const rawTracks = Array.isArray(sequencer.tracks) ? sequencer.tracks : null;
  const hasTracks = rawTracks !== null;
  if (rawTracks) {
    for (let index = 0; index < Math.min(8, rawTracks.length); index += 1) {
      tracks.push(normalizeSequencerTrack(rawTracks[index], index + 1));
    }
  } else {
    tracks.push(normalizeSequencerTrack(sequencer, 1));
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
      drummerTracks.push(normalizeDrummerSequencerTrack(sequencer.drummerTracks[index], index + 1));
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
      controllerSequencers.push(normalizeControllerSequencerState(sequencer.controllerSequencers[index], index + 1));
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

  const normalizedTransportStepCount = normalizeStepCount(
    typeof sequencer.stepCount === "number"
      ? rawStepCount
      : transportStepCountForPerformanceTracks(normalizedTracks, normalizedDrummerTracks)
  );

  return {
    ...defaults,
    bpm,
    stepCount: normalizedTransportStepCount,
    playhead: playhead % normalizedTransportStepCount,
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
        midiChannel
      });
    }
  }

  if (bindings.length === 0 && fallbackPatchId && availablePatchIds.has(fallbackPatchId)) {
    bindings.push({ id: crypto.randomUUID(), patchId: fallbackPatchId, midiChannel: 1 });
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
      runtimePadStartStep: null,
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
      midiChannel: clampInt(binding.midiChannel, 1, 16)
    })),
    currentPerformanceId: state.currentPerformanceId,
    performanceName: state.performanceName,
    performanceDescription: state.performanceDescription,
    activeMidiInput: state.activeMidiInput
  };
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

function defaultSequencerInstruments(patches: PatchListItem[], currentPatchId?: string): SequencerInstrumentBinding[] {
  const patchId = patches[0]?.id ?? currentPatchId;
  if (!patchId) {
    return [];
  }
  return [
    {
      id: crypto.randomUUID(),
      patchId,
      midiChannel: 1
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
  return {
    version: 3,
    instruments: instruments
      .filter((instrument) => instrument.patchId.length > 0)
      .map((instrument) => ({
        patchId: instrument.patchId,
        midiChannel: clampInt(instrument.midiChannel, 1, 16)
      })),
    sequencer: {
      bpm: clampInt(sequencer.bpm, 30, 300),
      stepCount: normalizeStepCount(sequencer.stepCount),
      tracks: sequencer.tracks.slice(0, 8).map((track, index) => ({
        id: track.id.length > 0 ? track.id : `voice-${index + 1}`,
        name: track.name.trim().length > 0 ? track.name : `Sequencer ${index + 1}`,
        midiChannel: clampInt(track.midiChannel, 1, 16),
        stepCount: normalizeStepCount(track.stepCount),
        syncToTrackId:
          track.syncToTrackId && track.syncToTrackId !== track.id ? track.syncToTrackId : null,
        scaleRoot: normalizeSequencerScaleRoot(track.scaleRoot),
        scaleType: normalizeSequencerScaleType(track.scaleType),
        mode: normalizeSequencerMode(track.mode),
        activePad: normalizePadIndex(track.activePad),
        queuedPad: track.queuedPad === null ? null : normalizePadIndex(track.queuedPad),
        padLoopEnabled: track.padLoopEnabled === true,
        padLoopRepeat: track.padLoopRepeat !== false,
        padLoopSequence: track.padLoopSequence.slice(0, 256).map((padIndex) => normalizePadIndex(padIndex)),
        pads: Array.from({ length: DEFAULT_PAD_COUNT }, (_, padIndex) => {
          const sourcePad = track.pads[padIndex];
          const padScaleRoot = normalizeSequencerScaleRoot(sourcePad?.scaleRoot ?? track.scaleRoot);
          const padScaleType = normalizeSequencerScaleType(sourcePad?.scaleType ?? track.scaleType);
          const padMode =
            sourcePad?.mode === undefined ? defaultModeForScaleType(padScaleType) : normalizeSequencerMode(sourcePad.mode);
          return {
            stepCount: normalizeStepCount(sourcePad?.stepCount ?? track.stepCount),
            steps: Array.from({ length: 32 }, (_, stepIndex) => normalizeSequencerStep(sourcePad?.steps?.[stepIndex])),
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
            stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
            rows: rows.map((row) => {
              const padRow = pad.rows.find((candidate) => candidate.rowId === row.id);
              return {
                rowId: row.id,
                steps: Array.from({ length: 32 }, (_, stepIndex) =>
                  cloneDrummerSequencerCell(padRow?.steps?.[stepIndex] ?? createEmptyDrummerSequencerCell())
                )
              };
            })
          }));
        return {
          id: track.id.length > 0 ? track.id : `drum-${index + 1}`,
          name: track.name.trim().length > 0 ? track.name : `Drummer Sequencer ${index + 1}`,
          midiChannel: clampInt(track.midiChannel, 1, 16),
          stepCount: normalizeDrummerSequencerStepCount(track.stepCount),
          activePad: normalizePadIndex(track.activePad),
          queuedPad: track.queuedPad === null ? null : normalizePadIndex(track.queuedPad),
          padLoopEnabled: track.padLoopEnabled === true,
          padLoopRepeat: track.padLoopRepeat !== false,
          padLoopSequence: track.padLoopSequence.slice(0, 256).map((padIndex) => normalizePadIndex(padIndex)),
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
        stepCount: clampControllerSequencerStepCount(controllerSequencer.stepCount),
        activePad: normalizePadIndex(controllerSequencer.activePad),
        queuedPad: controllerSequencer.queuedPad === null ? null : normalizePadIndex(controllerSequencer.queuedPad),
        padLoopEnabled: controllerSequencer.padLoopEnabled === true,
        padLoopRepeat: controllerSequencer.padLoopRepeat !== false,
        padLoopSequence: controllerSequencer.padLoopSequence.slice(0, 256).map((padIndex) => normalizePadIndex(padIndex)),
        enabled: controllerSequencer.enabled === true,
        pads: Array.from({ length: DEFAULT_PAD_COUNT }, (_, padIndex) => {
          const sourcePad =
            controllerSequencer.pads[padIndex] ??
            (padIndex === normalizePadIndex(controllerSequencer.activePad)
              ? {
                  stepCount: clampControllerSequencerStepCount(controllerSequencer.stepCount),
                  keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints)
                }
              : defaultControllerSequencerPad());
          return {
            stepCount: clampControllerSequencerStepCount(sourcePad.stepCount),
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
  if (payload.version !== 1 && payload.version !== 2 && payload.version !== 3) {
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
      midiChannel
    });
  }

  if (instruments.length === 0 && fallbackPatchId) {
    instruments.push({ id: crypto.randomUUID(), patchId: fallbackPatchId, midiChannel: 1 });
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

    sequencer: defaultSequencerState(),
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
          let sequencerInstruments = defaultSequencerInstruments(patches, currentPatch.id);
          let currentPerformanceId: string | null = null;
          let performanceName = "Untitled Performance";
          let performanceDescription = "";
          let guiLanguage: GuiLanguage = "english";

          const preferredMidi = get().activeMidiInput;
          let activeMidiInput =
            preferredMidi && midiInputs.some((input) => input.id === preferredMidi)
              ? preferredMidi
              : midiInputs[0]?.id ?? null;

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

              if (
                typeof payload.activeMidiInput === "string" &&
                midiInputs.some((input) => input.id === payload.activeMidiInput)
              ) {
                activeMidiInput = payload.activeMidiInput;
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
              midiChannel: clampInt(binding.midiChannel, 1, 16)
            })),
            currentPerformanceId,
            performanceName,
            performanceDescription,
            activeMidiInput
          };
          lastPersistedSignature = JSON.stringify(baselineSnapshot);

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
        const availablePatchIds = new Set(state.patches.map((patch) => patch.id));
        if (state.currentPatch.id) {
          availablePatchIds.add(state.currentPatch.id);
        }
        const fallbackPatchId = state.patches[0]?.id ?? state.currentPatch.id ?? null;
        const parsed = parseSequencerConfigSnapshot(performance.config, availablePatchIds, fallbackPatchId);

        set({
          sequencer: parsed.sequencer,
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

      const snapshot = buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
      set({ loading: true, error: null });
      try {
        const payload = {
          name,
          description: state.performanceDescription,
          config: snapshot
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
        midiChannel: nextAvailableMidiChannel(state.sequencerInstruments)
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
      track.name = `Sequencer ${nextIndex}`;
      const nextTracks = [...sequencer.tracks, track];

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks),
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
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks),
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
      const shouldQueue = queueOnCycle ?? sequencer.isPlaying;
      const nextTracks = sequencer.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        if (shouldQueue && sequencer.isPlaying) {
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
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks),
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
                        stepCount: normalizeStepCount(track.stepCount),
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
                        stepCount: normalizeStepCount(track.stepCount),
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

    setSequencerTrackStepCount: (trackId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedStepCount = normalizeStepCount(stepCount);
      const nextTracks = sequencer.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        const activePad = normalizePadIndex(track.activePad);
        const pads = track.pads.map((pad, index) =>
          index === activePad ? { ...pad, stepCount: normalizedStepCount } : pad
        );
        return {
          ...track,
          stepCount: normalizedStepCount,
          pads
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks),
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackStepNote: (trackId, index, note) => {
      if (index < 0 || index >= 32) {
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
      if (index < 0 || index >= 32) {
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
      if (index < 0 || index >= 32) {
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
      if (index < 0 || index >= 32) {
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
        sourceIndex >= 32 ||
        targetIndex < 0 ||
        targetIndex >= 32
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
              stepCount: normalizeStepCount(sourcePad.stepCount),
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
                    stepCount: normalizeStepCount(selectedPad.stepCount),
                    activePad: normalizedPad,
                    queuedPad: sequencer.isPlaying ? track.queuedPad : null,
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
            return {
              ...track,
              padLoopSequence: [...track.padLoopSequence, normalizedPad]
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
              normalizedSequenceIndex >= track.padLoopSequence.length
            ) {
              return track;
            }
            return {
              ...track,
              padLoopSequence: track.padLoopSequence.filter((_, index) => index !== normalizedSequenceIndex)
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
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks),
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
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks),
          drummerTracks: nextDrummerTracks
        },
        error: null
      });
    },

    setDrummerSequencerTrackEnabled: (trackId, enabled, queueOnCycle) => {
      const sequencer = get().sequencer;
      const shouldQueue = queueOnCycle ?? sequencer.isPlaying;
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        if (shouldQueue && sequencer.isPlaying) {
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
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks),
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

    setDrummerSequencerTrackStepCount: (trackId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedStepCount = normalizeDrummerSequencerStepCount(stepCount);
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        const activePad = normalizePadIndex(track.activePad);
        const nextPads = cloneDrummerSequencerPads(track.pads).map((pad, index) =>
          index === activePad ? { ...pad, stepCount: normalizedStepCount } : pad
        );
        return {
          ...track,
          stepCount: normalizedStepCount,
          pads: nextPads
        };
      });
      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks),
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
              stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
              rows: alignDrummerPadRowsToTrackRows(
                {
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
      if (stepIndex < 0 || stepIndex >= 32) {
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
      if (stepIndex < 0 || stepIndex >= 32) {
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
              stepCount: normalizeDrummerSequencerStepCount(nextPads[normalizedTargetPad]?.stepCount ?? track.stepCount),
              pads: nextPads
            };
          })
        }
      });
    },

    setDrummerSequencerTrackActivePad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
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
                    stepCount: normalizeDrummerSequencerStepCount(selectedPad.stepCount),
                    activePad: normalizedPad,
                    queuedPad: sequencer.isPlaying ? track.queuedPad : null
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
            return {
              ...track,
              padLoopSequence: [...track.padLoopSequence, normalizedPad]
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
              normalizedSequenceIndex >= track.padLoopSequence.length
            ) {
              return track;
            }
            return {
              ...track,
              padLoopSequence: track.padLoopSequence.filter((_, index) => index !== normalizedSequenceIndex)
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
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const wasEnabled = controllerSequencer.enabled;
            const nextEnabled = enabled === true;
            const runtimeResetRequired = nextEnabled !== wasEnabled;
            return {
              ...controllerSequencer,
              enabled: nextEnabled,
              queuedPad: !nextEnabled ? null : runtimeResetRequired ? null : controllerSequencer.queuedPad,
              padLoopPosition:
                !nextEnabled || runtimeResetRequired ? null : controllerSequencer.padLoopPosition,
              runtimePadStartStep:
                !nextEnabled || runtimeResetRequired ? null : controllerSequencer.runtimePadStartStep
            };
          })
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
              queuedPad: sequencer.isPlaying ? controllerSequencer.queuedPad : null,
              stepCount: normalizeControllerSequencerStepCount(selectedPad.stepCount),
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
                    nextEnabled && sequencer.isPlaying ? controllerSequencer.padLoopPosition : null
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
            return {
              ...controllerSequencer,
              padLoopSequence: [...controllerSequencer.padLoopSequence, normalizedPad]
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
              normalizedSequenceIndex >= controllerSequencer.padLoopSequence.length
            ) {
              return controllerSequencer;
            }
            return {
              ...controllerSequencer,
              padLoopSequence: controllerSequencer.padLoopSequence.filter(
                (_, index) => index !== normalizedSequenceIndex
              )
            };
          })
        }
      });
    },

    setControllerSequencerStepCount: (controllerSequencerId, stepCount) => {
      const normalizedStepCount = clampControllerSequencerStepCount(stepCount);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad, index) =>
              index === activePad ? { ...pad, stepCount: normalizedStepCount } : cloneControllerSequencerPad(pad)
            );
            return {
              ...controllerSequencer,
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
      const byId = new Map(updates.map((update) => [update.controllerSequencerId, update]));
      if (byId.size === 0) {
        return;
      }
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
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
            const nextRuntimePadStartStep =
              update.runtimePadStartStep === undefined
                ? controllerSequencer.runtimePadStartStep
                : update.runtimePadStartStep;
            const nextEnabled = update.enabled === undefined ? controllerSequencer.enabled : update.enabled === true;
            const activePadChanged = nextActivePad !== controllerSequencer.activePad;
            const selectedPad =
              controllerSequencer.pads[nextActivePad] ??
              controllerSequencer.pads[0] ??
              fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const nextStepCount = normalizeControllerSequencerStepCount(selectedPad.stepCount);
            const nextKeypoints = normalizeControllerCurveKeypoints(selectedPad.keypoints);

            if (
              !activePadChanged &&
              nextQueuedPad === controllerSequencer.queuedPad &&
              nextPadLoopPosition === controllerSequencer.padLoopPosition &&
              nextRuntimePadStartStep === controllerSequencer.runtimePadStartStep &&
              nextEnabled === controllerSequencer.enabled &&
              nextStepCount === controllerSequencer.stepCount
            ) {
              return controllerSequencer;
            }

            return {
              ...controllerSequencer,
              activePad: nextActivePad,
              queuedPad: nextEnabled ? nextQueuedPad : null,
              padLoopPosition: nextEnabled ? nextPadLoopPosition : null,
              runtimePadStartStep: nextEnabled ? nextRuntimePadStartStep : null,
              enabled: nextEnabled,
              stepCount: activePadChanged ? nextStepCount : controllerSequencer.stepCount,
              keypoints: activePadChanged ? nextKeypoints : controllerSequencer.keypoints
            };
          })
        }
      });
    },

    setSequencerBpm: (bpm) => {
      set({
        sequencer: {
          ...get().sequencer,
          bpm: clampInt(bpm, 30, 300)
        }
      });
    },

    setSequencerPlaying: (isPlaying) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          isPlaying,
          tracks: sequencer.tracks.map((track) => ({
            ...track,
            queuedPad: isPlaying ? track.queuedPad : null,
            padLoopPosition: isPlaying ? track.padLoopPosition : null,
            runtimeLocalStep: isPlaying ? track.runtimeLocalStep : null,
            queuedEnabled: isPlaying ? track.queuedEnabled : null
          })),
          drummerTracks: sequencer.drummerTracks.map((track) => ({
            ...track,
            queuedPad: isPlaying ? track.queuedPad : null,
            padLoopPosition: isPlaying ? track.padLoopPosition : null,
            runtimeLocalStep: isPlaying ? track.runtimeLocalStep : null,
            queuedEnabled: isPlaying ? track.queuedEnabled : null
          })),
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => ({
            ...controllerSequencer,
            queuedPad: isPlaying ? controllerSequencer.queuedPad : null,
            padLoopPosition: isPlaying ? controllerSequencer.padLoopPosition : null,
            runtimePadStartStep: isPlaying ? controllerSequencer.runtimePadStartStep : null
          }))
        }
      });
    },

    setSequencerPlayhead: (playhead) => {
      const sequencer = get().sequencer;
      const boundedStepCount = normalizeStepCount(sequencer.stepCount);
      const normalizedPlayhead = ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;
      set({
        sequencer: {
          ...sequencer,
          playhead: normalizedPlayhead
        }
      });
    },

    syncSequencerRuntime: ({ isPlaying, transportStepCount, playhead, cycle, tracks, drummerTracks }) => {
      const sequencer = get().sequencer;
      const boundedStepCount = normalizeStepCount(transportStepCount ?? sequencer.stepCount);
      const normalizedPlayhead =
        playhead === undefined
          ? sequencer.playhead
          : ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;
      const trackPayload = new Map((tracks ?? []).map((track) => [track.trackId, track]));
      const drummerTrackPayload = new Map((drummerTracks ?? []).map((track) => [track.trackId, track]));

      set({
        sequencer: {
          ...sequencer,
          isPlaying,
          stepCount: boundedStepCount,
          cycle: cycle === undefined ? sequencer.cycle : Math.max(0, Math.round(cycle)),
          playhead: normalizedPlayhead,
          tracks: sequencer.tracks.map((track) => {
            const payload = trackPayload.get(track.id);
            if (!payload) {
              if (!isPlaying) {
                return {
                  ...track,
                  queuedPad: null,
                  padLoopPosition: null,
                  runtimeLocalStep: null,
                  queuedEnabled: null
                };
              }
              return track;
            }

            const nextActivePad =
              payload.activePad === undefined ? track.activePad : normalizePadIndex(payload.activePad);
            const currentSelectedPad = track.pads[nextActivePad] ?? track.pads[0];
            const nextStepCount =
              payload.stepCount === undefined
                ? normalizeStepCount(currentSelectedPad?.stepCount ?? track.stepCount)
                : normalizeStepCount(payload.stepCount);
            const nextRuntimeLocalStep =
              payload.localStep === undefined
                ? track.runtimeLocalStep
                : Math.max(0, Math.round(payload.localStep)) % Math.max(1, nextStepCount);
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
            const nextPads =
              payload.stepCount === undefined
                ? track.pads
                : track.pads.map((pad, index) =>
                    index === nextActivePad ? { ...pad, stepCount: nextStepCount } : pad
                  );
            const nextScaleRoot = selectedPad?.scaleRoot ?? track.scaleRoot;
            const nextScaleType = selectedPad?.scaleType ?? track.scaleType;
            const nextMode = selectedPad?.mode ?? track.mode;

            if (
              nextActivePad === track.activePad &&
              nextRuntimeLocalStep === track.runtimeLocalStep &&
              nextQueuedPad === track.queuedPad &&
              nextPadLoopPosition === track.padLoopPosition &&
              nextStepCount === track.stepCount &&
              nextPads === track.pads &&
              nextEnabled === track.enabled &&
              nextQueuedEnabled === track.queuedEnabled &&
              nextScaleRoot === track.scaleRoot &&
              nextScaleType === track.scaleType &&
              nextMode === track.mode
            ) {
              return track;
            }

            return {
              ...track,
              activePad: nextActivePad,
              runtimeLocalStep: nextRuntimeLocalStep,
              queuedPad: nextQueuedPad,
              padLoopPosition: nextPadLoopPosition,
              stepCount: nextStepCount,
              pads: nextPads,
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
          }),
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            isPlaying
              ? controllerSequencer
              : {
                  ...controllerSequencer,
                  queuedPad: null,
                  padLoopPosition: null,
                  runtimePadStartStep: null
                }
          ),
          drummerTracks: sequencer.drummerTracks.map((track) => {
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
              if (!isPlaying) {
                return {
                  ...track,
                  queuedPad: null,
                  padLoopPosition: null,
                  runtimeLocalStep: null,
                  queuedEnabled: null
                };
              }
              return track;
            }

            const nextActivePad =
              payload.activePad === undefined ? track.activePad : normalizePadIndex(payload.activePad);
            const nextStepCount =
              payload.stepCount === undefined
                ? normalizeDrummerSequencerStepCount((track.pads[nextActivePad] ?? track.pads[0])?.stepCount ?? track.stepCount)
                : normalizeDrummerSequencerStepCount(payload.stepCount);
            const nextRuntimeLocalStep =
              payload.localStep === undefined
                ? track.runtimeLocalStep
                : Math.max(0, Math.round(payload.localStep)) % Math.max(1, nextStepCount);
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
            const nextPads =
              payload.stepCount === undefined
                ? track.pads
                : track.pads.map((pad, index) =>
                    index === nextActivePad ? { ...pad, stepCount: nextStepCount } : pad
                  );

            if (
              nextActivePad === track.activePad &&
              nextRuntimeLocalStep === track.runtimeLocalStep &&
              nextQueuedPad === track.queuedPad &&
              nextPadLoopPosition === track.padLoopPosition &&
              nextStepCount === track.stepCount &&
              nextPads === track.pads &&
              nextEnabled === track.enabled &&
              nextQueuedEnabled === track.queuedEnabled
            ) {
              return track;
            }

            return {
              ...track,
              activePad: nextActivePad,
              runtimeLocalStep: nextRuntimeLocalStep,
              queuedPad: nextQueuedPad,
              padLoopPosition: nextPadLoopPosition,
              stepCount: nextStepCount,
              pads: nextPads,
              enabled: nextEnabled,
              queuedEnabled: nextQueuedEnabled
            };
          })
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
      if (midiInput) {
        try {
          await api.bindMidiInput(sessionId, midiInput);
        } catch {
          // Keep session creation successful even if MIDI binding fails.
        }
      }

      set({
        activeSessionId: sessionId,
        activeSessionState: session.state,
        activeMidiInput: midiInput,
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
          activeMidiInput: midiInput,
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

  const snapshot = buildPersistedAppStateSnapshot(state);
  const signature = JSON.stringify(snapshot);
  if (signature === lastPersistedSignature) {
    return;
  }

  schedulePersistedAppState(snapshot);
});
