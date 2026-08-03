import { api } from "../api/client";
import {
  normalizeArrangerLoopSelection,
  transportPositionFromAbsoluteStep
} from "../lib/arrangerTransport";
import {
  normalizeBrowserClockLatencySettings,
  resolveDefaultBrowserClockLatencySettings
} from "../lib/browserClockLatencyConfig";
import { createUntitledPatch } from "../lib/defaultPatch";
import { effectRouteKey, effectRouteWouldCreateLoop } from "../lib/effectRouting";
import { normalizeGuiLanguage } from "../lib/guiLanguage";
import {
  findPatchByName,
  remapSnapshotPatchIds,
  toPatchListItem
} from "../lib/patchCatalog";
import {
  createEmptyPadLoopPattern,
  normalizePadLoopPatternState,
  normalizePadLoopSequenceToken
} from "../lib/padLoopPattern";
import {
  DEFAULT_SEQUENCER_TIMING_CONFIG,
  STEP_CAPACITY,
  clampControllerCurvePosition,
  clampControllerCurveValue,
  clampControllerSequencerPadLengthBeats,
  clampSequencerPadLengthBeats,
  defaultModeForScaleType,
  normalizeSequencerTimingConfig,
  normalizeControllerCurveKeypoints,
  normalizeSequencerChord,
  normalizeSequencerMode,
  normalizeSequencerScaleRoot,
  normalizeSequencerScaleType,
  sequencerPadStepCount,
  sequencerTransportSubunitsPerStep,
  sequencerTransportStepsPerBeat,
} from "../lib/sequencer";
import type {
  ArrangerLoopSelection,
  AppPage,
  ArpeggiatorPattern,
  ArpeggiatorPresetState,
  ArpeggiatorRate,
  ArpeggiatorRestartMode,
  ArpeggiatorState,
  ArpeggiatorVelocityMode,
  BrowserClockLatencySettings,
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
  EffectRouteSelection,
  GuiLanguage,
  MidiInputRef,
  OpcodeSpec,
  PadLoopPatternState,
  Patch,
  PatchGraph,
  PatchListItem,
  PersistedAppState,
  MidiControllerState,
  PianoRollState,
  SequencerConfigSnapshot,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerPadState,
  SequencerPadLengthBeats,
  SequencerStepState,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SequencerRuntimeState,
  SequencerTimingConfig,
  SequencerTrackState,
  SessionInstrumentAssignment
} from "../types";
import type { AppStore, EditablePatch, InstrumentTabState } from "./appStoreTypes";

export const OPCODE_PARAM_DEFAULTS: Record<string, Record<string, string | number | boolean>> = {
  const_a: { value: 0 },
  const_i: { value: 0 },
  const_k: { value: 0 },
  const_s: { value: "string" }
};

export const ALWAYS_ON_REQUIRES_INLETA_MESSAGE = 'always on instruments require at least one "inleta" instance';

export const DEFAULT_PAD_COUNT = 8;
export const MAX_MIDI_CONTROLLERS = 6;
export const MAX_ARPEGGIATORS = 8;
export const DEFAULT_DRUMMER_ROW_KEYS = [36, 38, 42, 46] as const;
export const APP_STATE_VERSION = 1 as const;
export const APP_STATE_PERSIST_DEBOUNCE_MS = 400;
export const AUDIO_RATE_MIN = 22000;
export const AUDIO_RATE_MAX = 48000;
export const CONTROL_RATE_MIN = 25;
export const CONTROL_RATE_MAX = 48000;
export const ENGINE_BUFFER_MIN = 32;
export const ENGINE_BUFFER_MAX = 8192;
export const ARPEGGIATOR_RATES: readonly ArpeggiatorRate[] = ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32", "1/8T", "1/16T", "1/8D", "1/16D"];
export const ARPEGGIATOR_PATTERNS: readonly ArpeggiatorPattern[] = [
  "up",
  "down",
  "up_down",
  "down_up",
  "as_played",
  "random",
  "chord",
  "inside_out",
  "outside_in"
];
export const ARPEGGIATOR_VELOCITY_MODES: readonly ArpeggiatorVelocityMode[] = ["input", "fixed", "accent", "random"];
export const ARPEGGIATOR_RESTART_MODES: readonly ArpeggiatorRestartMode[] = ["free", "first_note"];

export type ArpeggiatorPresetSettings = ArpeggiatorPresetState["settings"];

export const DEFAULT_ARPEGGIATOR_SETTINGS: ArpeggiatorPresetSettings = {
  rate: "1/16",
  gateRatio: 0.72,
  swing: 0,
  octaves: 1,
  pattern: "up",
  latch: false,
  velocityMode: "input",
  fixedVelocity: 100,
  accentCycle: [127, 96, 112, 96],
  probability: 1,
  repeats: 1,
  humanizeMs: 0,
  humanizeVelocity: 0,
  transpose: 0,
  scaleQuantize: false,
  scaleRoot: "C",
  scaleType: "minor",
  mode: "aeolian",
  restartMode: "first_note"
};

export const BUILTIN_ARPEGGIATOR_PRESETS: ArpeggiatorPresetState[] = [
  {
    id: "builtin-classic-up",
    name: "Classic Up",
    builtin: true,
    settings: { ...DEFAULT_ARPEGGIATOR_SETTINGS }
  },
  {
    id: "builtin-down-octaves",
    name: "Down Octaves",
    builtin: true,
    settings: { ...DEFAULT_ARPEGGIATOR_SETTINGS, pattern: "down", octaves: 2, rate: "1/8" }
  },
  {
    id: "builtin-up-down-swing",
    name: "Up Down Swing",
    builtin: true,
    settings: { ...DEFAULT_ARPEGGIATOR_SETTINGS, pattern: "up_down", swing: 0.34, gateRatio: 0.62 }
  },
  {
    id: "builtin-trance-gate",
    name: "Trance Gate",
    builtin: true,
    settings: {
      ...DEFAULT_ARPEGGIATOR_SETTINGS,
      rate: "1/16",
      gateRatio: 0.42,
      octaves: 3,
      pattern: "up_down",
      velocityMode: "accent",
      accentCycle: [127, 72, 96, 72, 116, 72, 96, 72]
    }
  },
  {
    id: "builtin-random-spark",
    name: "Random Spark",
    builtin: true,
    settings: {
      ...DEFAULT_ARPEGGIATOR_SETTINGS,
      pattern: "random",
      rate: "1/16T",
      octaves: 2,
      probability: 0.82,
      humanizeMs: 8,
      humanizeVelocity: 10
    }
  },
  {
    id: "builtin-inside-out",
    name: "Inside Out",
    builtin: true,
    settings: { ...DEFAULT_ARPEGGIATOR_SETTINGS, pattern: "inside_out", rate: "1/8D", gateRatio: 0.7 }
  },
  {
    id: "builtin-chord-pulse",
    name: "Chord Pulse",
    builtin: true,
    settings: {
      ...DEFAULT_ARPEGGIATOR_SETTINGS,
      pattern: "chord",
      rate: "1/8",
      gateRatio: 0.86,
      velocityMode: "fixed",
      fixedVelocity: 112
    }
  },
  {
    id: "builtin-scale-lock",
    name: "Scale Lock",
    builtin: true,
    settings: {
      ...DEFAULT_ARPEGGIATOR_SETTINGS,
      scaleQuantize: true,
      scaleRoot: "C",
      scaleType: "minor",
      mode: "aeolian",
      transpose: 12
    }
  }
];

export type PersistWatchState = {
  activePage: AppPage;
  guiLanguage: GuiLanguage;
  browserClockLatencySettings: BrowserClockLatencySettings;
  instrumentTabs: InstrumentTabState[];
  activeInstrumentTabId: string;
  sequencer: SequencerState;
  sequencerInstruments: SequencerInstrumentBinding[];
  currentPerformanceId: string | null;
  performanceName: string;
  performanceDescription: string;
  activeMidiInput: string | null;
};

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeInstrumentLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }
  return clampInt(value, 1, 10);
}

export function patchGraphHasOpcode(graph: PatchGraph, opcode: string): boolean {
  return graph.nodes.some((node) => node.opcode === opcode);
}

export function normalizeEffectSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const sourceId = entry.trim();
    if (!sourceId || seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    result.push(sourceId);
  }
  return result.slice(0, 16);
}

export function normalizeEffectRouteSelections(value: unknown): EffectRouteSelection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: EffectRouteSelection[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const sourceId =
      typeof record.sourceId === "string"
        ? record.sourceId.trim()
        : typeof record.source_id === "string"
          ? record.source_id.trim()
          : "";
    const channel = typeof record.channel === "string" ? record.channel.trim() : "";
    const key = `${sourceId}\u0000${channel}`;
    if (!sourceId || !channel || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ sourceId, channel });
  }
  return result.slice(0, 64);
}

export function normalizeSequencerTiming(value: unknown): SequencerTimingConfig {
  return normalizeSequencerTimingConfig(value);
}

export function defaultSequencerTiming(): SequencerTimingConfig {
  return { ...DEFAULT_SEQUENCER_TIMING_CONFIG };
}

export function normalizeTransportStepCount(value: number): number {
  if (!Number.isFinite(value)) {
    return sequencerTransportStepsPerBeat(DEFAULT_SEQUENCER_TIMING_CONFIG);
  }
  return Math.max(1, Math.round(value));
}

export function resolveTransportStepCount(timing: SequencerTimingConfig): number {
  return sequencerTransportStepsPerBeat(timing);
}

export function normalizeSequencerPadLengthBeats(value: unknown): SequencerPadLengthBeats {
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

export function normalizeSequencerTrackStepCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return resolvedSequencerPadStepCount(4, DEFAULT_SEQUENCER_TIMING_CONFIG);
  }
  return normalizeTransportStepCount(value);
}

export function normalizeDrummerSequencerStepCount(value: unknown): number {
  return normalizeSequencerTrackStepCount(value);
}

export function normalizeControllerSequencerLengthBeats(value: unknown): ControllerSequencerPadLengthBeats {
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

export function transportStepCountForPerformanceTracks(
  tracks: SequencerTrackState[],
  drummerTracks: DrummerSequencerTrackState[],
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): number {
  void tracks;
  void drummerTracks;
  return resolveTransportStepCount(timing);
}

export function resolvedSequencerPadStepCount(lengthBeats: number, timing: SequencerTimingConfig): number {
  return sequencerPadStepCount(timing, clampSequencerPadLengthBeats(lengthBeats));
}

export function resolvedControllerPadStepCount(lengthBeats: number, timing: SequencerTimingConfig): number {
  return sequencerPadStepCount(timing, clampControllerSequencerPadLengthBeats(lengthBeats));
}

export function normalizeSequencerInstanceTiming(
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

export function createEmptySequencerStep(): SequencerStepState {
  return {
    note: null,
    chord: "none",
    hold: false,
    velocity: 127
  };
}

export function cloneSequencerStep(step: SequencerStepState): SequencerStepState {
  return {
    note: step.note,
    chord: normalizeSequencerChord(step.chord),
    hold: step.hold,
    velocity: step.velocity
  };
}

export function defaultSequencerSteps(): SequencerStepState[] {
  return Array.from({ length: 128 }, () => createEmptySequencerStep());
}

export const DEFAULT_SEQUENCER_STEPS: SequencerStepState[] = defaultSequencerSteps();

export function cloneSequencerSteps(steps: SequencerStepState[]): SequencerStepState[] {
  return steps.map((step) => cloneSequencerStep(step));
}

export function normalizeStepNote(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clampInt(value, 0, 127);
}

export function normalizeStepHold(value: unknown): boolean {
  return value === true;
}

export function normalizeStepVelocity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 127;
  }
  return clampInt(value, 0, 127);
}

export function normalizeArpeggiatorRate(value: unknown): ArpeggiatorRate {
  return typeof value === "string" && ARPEGGIATOR_RATES.includes(value as ArpeggiatorRate)
    ? (value as ArpeggiatorRate)
    : DEFAULT_ARPEGGIATOR_SETTINGS.rate;
}

export function normalizeArpeggiatorPattern(value: unknown): ArpeggiatorPattern {
  return typeof value === "string" && ARPEGGIATOR_PATTERNS.includes(value as ArpeggiatorPattern)
    ? (value as ArpeggiatorPattern)
    : DEFAULT_ARPEGGIATOR_SETTINGS.pattern;
}

export function normalizeArpeggiatorVelocityMode(value: unknown): ArpeggiatorVelocityMode {
  return typeof value === "string" && ARPEGGIATOR_VELOCITY_MODES.includes(value as ArpeggiatorVelocityMode)
    ? (value as ArpeggiatorVelocityMode)
    : DEFAULT_ARPEGGIATOR_SETTINGS.velocityMode;
}

export function normalizeArpeggiatorRestartMode(value: unknown): ArpeggiatorRestartMode {
  return typeof value === "string" && ARPEGGIATOR_RESTART_MODES.includes(value as ArpeggiatorRestartMode)
    ? (value as ArpeggiatorRestartMode)
    : DEFAULT_ARPEGGIATOR_SETTINGS.restartMode;
}

export function normalizeArpeggiatorSettings(raw: unknown): ArpeggiatorPresetSettings {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const scaleType = normalizeSequencerScaleType(source.scaleType ?? source.scale_type ?? DEFAULT_ARPEGGIATOR_SETTINGS.scaleType);
  const mode =
    source.mode === undefined
      ? defaultModeForScaleType(scaleType)
      : normalizeSequencerMode(source.mode);
  const accentRaw = Array.isArray(source.accentCycle ?? source.accent_cycle)
    ? ((source.accentCycle ?? source.accent_cycle) as unknown[])
    : DEFAULT_ARPEGGIATOR_SETTINGS.accentCycle;
  return {
    rate: normalizeArpeggiatorRate(source.rate),
    gateRatio: typeof source.gateRatio === "number" ? Math.max(0.05, Math.min(1, source.gateRatio)) : typeof source.gate_ratio === "number" ? Math.max(0.05, Math.min(1, source.gate_ratio)) : DEFAULT_ARPEGGIATOR_SETTINGS.gateRatio,
    swing: typeof source.swing === "number" ? Math.max(0, Math.min(0.75, source.swing)) : DEFAULT_ARPEGGIATOR_SETTINGS.swing,
    octaves: typeof source.octaves === "number" ? clampInt(source.octaves, 1, 4) : DEFAULT_ARPEGGIATOR_SETTINGS.octaves,
    pattern: normalizeArpeggiatorPattern(source.pattern),
    latch: source.latch === true,
    velocityMode: normalizeArpeggiatorVelocityMode(source.velocityMode ?? source.velocity_mode),
    fixedVelocity: normalizeStepVelocity(source.fixedVelocity ?? source.fixed_velocity ?? DEFAULT_ARPEGGIATOR_SETTINGS.fixedVelocity),
    accentCycle: accentRaw.slice(0, 32).map((value) => normalizeStepVelocity(value)),
    probability:
      typeof source.probability === "number" && Number.isFinite(source.probability)
        ? Math.max(0, Math.min(1, source.probability))
        : DEFAULT_ARPEGGIATOR_SETTINGS.probability,
    repeats: typeof source.repeats === "number" ? clampInt(source.repeats, 1, 4) : DEFAULT_ARPEGGIATOR_SETTINGS.repeats,
    humanizeMs:
      typeof source.humanizeMs === "number"
        ? Math.max(0, Math.min(50, source.humanizeMs))
        : typeof source.humanize_ms === "number"
          ? Math.max(0, Math.min(50, source.humanize_ms))
          : DEFAULT_ARPEGGIATOR_SETTINGS.humanizeMs,
    humanizeVelocity:
      typeof source.humanizeVelocity === "number"
        ? clampInt(source.humanizeVelocity, 0, 32)
        : typeof source.humanize_velocity === "number"
          ? clampInt(source.humanize_velocity, 0, 32)
          : DEFAULT_ARPEGGIATOR_SETTINGS.humanizeVelocity,
    transpose: typeof source.transpose === "number" ? clampInt(source.transpose, -24, 24) : DEFAULT_ARPEGGIATOR_SETTINGS.transpose,
    scaleQuantize: (source.scaleQuantize ?? source.scale_quantize) === true,
    scaleRoot: normalizeSequencerScaleRoot(source.scaleRoot ?? source.scale_root ?? DEFAULT_ARPEGGIATOR_SETTINGS.scaleRoot),
    scaleType,
    mode,
    restartMode: normalizeArpeggiatorRestartMode(source.restartMode ?? source.restart_mode)
  };
}

export function normalizeArpeggiatorPreset(raw: unknown, index: number): ArpeggiatorPresetState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const id =
    typeof source.id === "string" && source.id.trim().length > 0 ? source.id : `user-arp-preset-${index + 1}`;
  const name =
    typeof source.name === "string" && source.name.trim().length > 0 ? source.name.trim() : `Arp Preset ${index + 1}`;
  return {
    id,
    name,
    builtin: source.builtin === true,
    settings: normalizeArpeggiatorSettings(source.settings ?? source)
  };
}

export function createEmptyDrummerSequencerCell(): DrummerSequencerCellState {
  return {
    active: false,
    velocity: 127
  };
}

export function cloneDrummerSequencerCell(cell: DrummerSequencerCellState): DrummerSequencerCellState {
  return {
    active: cell.active === true,
    velocity: normalizeStepVelocity(cell.velocity)
  };
}

export function defaultDrummerSequencerCells(): DrummerSequencerCellState[] {
  return Array.from({ length: 128 }, () => createEmptyDrummerSequencerCell());
}

export const DEFAULT_DRUMMER_SEQUENCER_CELLS: DrummerSequencerCellState[] = defaultDrummerSequencerCells();

export function cloneDrummerSequencerCells(cells: DrummerSequencerCellState[]): DrummerSequencerCellState[] {
  return cells.map((cell) => cloneDrummerSequencerCell(cell));
}

export function normalizeDrummerSequencerKey(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 36;
  }
  return clampInt(value, 0, 127);
}

export function normalizeDrummerSequencerCell(raw: unknown): DrummerSequencerCellState {
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

export function normalizeDrummerSequencerRowPadState(
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

export function defaultDrummerSequencerRows(
  keys: readonly number[] = DEFAULT_DRUMMER_ROW_KEYS
): DrummerSequencerRowState[] {
  return keys.map((key, index) => ({
    id: `drum-row-${index + 1}`,
    key: normalizeDrummerSequencerKey(key)
  }));
}

export function cloneDrummerSequencerRows(rows: DrummerSequencerRowState[]): DrummerSequencerRowState[] {
  return rows.map((row, index) => ({
    id: typeof row.id === "string" && row.id.trim().length > 0 ? row.id : `drum-row-${index + 1}`,
    key: normalizeDrummerSequencerKey(row.key)
  }));
}

export function buildDefaultDrummerSequencerPad(
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

export function defaultDrummerSequencerPads(
  rows: DrummerSequencerRowState[],
  lengthBeats: DrummerSequencerStepCount = 4,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): DrummerSequencerPadState[] {
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => buildDefaultDrummerSequencerPad(rows, lengthBeats, timing));
}

export function cloneDrummerSequencerPads(pads: DrummerSequencerPadState[]): DrummerSequencerPadState[] {
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

export function alignDrummerPadRowsToTrackRows(
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

export function normalizeSequencerStep(value: unknown): SequencerStepState {
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

export function normalizeControllerNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return clampInt(value, 0, 127);
}

export function normalizeControllerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return clampInt(value, 0, 127);
}

export function normalizePianoRollVelocity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 110;
  }
  return clampInt(value, 0, 127);
}

export function normalizeControllerSequencerKeypoint(raw: unknown, fallbackIndex: number): ControllerSequencerKeypoint | null {
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

export function defaultControllerSequencerKeypoints(): ControllerSequencerKeypoint[] {
  return normalizeControllerCurveKeypoints([
    { id: "kp-start", position: 0, value: 0 },
    { id: "kp-end", position: 1, value: 0 }
  ]);
}

export function cloneControllerSequencerPad(pad: ControllerSequencerPadState): ControllerSequencerPadState {
  return {
    lengthBeats: normalizeControllerSequencerLengthBeats(pad.lengthBeats),
    stepCount: normalizeTransportStepCount(pad.stepCount),
    keypoints: normalizeControllerCurveKeypoints(pad.keypoints)
  };
}

export function defaultControllerSequencerPad(
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

export function defaultControllerSequencerPads(
  lengthBeats: ControllerSequencerPadLengthBeats = 4,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): ControllerSequencerPadState[] {
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => defaultControllerSequencerPad(lengthBeats, timing));
}

export function normalizeControllerSequencerPadState(
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

export function fallbackControllerSequencerPadStateForSequencer(
  controllerSequencer: Pick<ControllerSequencerState, "lengthBeats" | "stepCount" | "keypoints">
): ControllerSequencerPadState {
  return {
    lengthBeats: normalizeControllerSequencerLengthBeats(controllerSequencer.lengthBeats),
    stepCount: normalizeTransportStepCount(controllerSequencer.stepCount),
    keypoints: normalizeControllerCurveKeypoints(controllerSequencer.keypoints)
  };
}

export function defaultSequencerPads(
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

export function normalizePadIndex(value: number): number {
  return clampInt(value, 0, DEFAULT_PAD_COUNT - 1);
}

export function normalizePadLoopSequence(raw: unknown): number[] {
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

export function normalizePadLoopPatternBundle(
  rawPattern: unknown,
  rawLegacySequence?: unknown
): { padLoopPattern: PadLoopPatternState; padLoopSequence: number[] } {
  const normalized = normalizePadLoopPatternState(rawPattern, rawLegacySequence);
  return {
    padLoopPattern: normalized.pattern,
    padLoopSequence: normalized.compiledSequence
  };
}

export function normalizePadLoopPatternForState(
  pattern: PadLoopPatternState
): { padLoopPattern: PadLoopPatternState; padLoopSequence: number[] } {
  const normalized = normalizePadLoopPatternState(pattern);
  return {
    padLoopPattern: normalized.pattern,
    padLoopSequence: normalized.compiledSequence
  };
}

export function normalizeRawArrangerLoopSelection(raw: unknown): ArrangerLoopSelection | null {
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

export function normalizePadSteps(raw: unknown): SequencerStepState[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const steps = cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS);
  for (let index = 0; index < Math.min(128, raw.length); index += 1) {
    steps[index] = normalizeSequencerStep(raw[index]);
  }
  return steps;
}

export function normalizeSequencerPadState(
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

export function fallbackSequencerPadStateForTrack(
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

export function fallbackDrummerSequencerPadStateForTrack(
  track: Pick<DrummerSequencerTrackState, "lengthBeats" | "stepCount" | "rows">,
  timing: SequencerTimingConfig = DEFAULT_SEQUENCER_TIMING_CONFIG
): DrummerSequencerPadState {
  return buildDefaultDrummerSequencerPad(track.rows, normalizeSequencerPadLengthBeats(track.lengthBeats), timing);
}

export function defaultSequencerTrack(
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
    runtimePadStartSubunit: null,
    enabled: false,
    queuedEnabled: null
  };
}

export function defaultDrummerSequencerTrack(
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
    runtimePadStartSubunit: null,
    enabled: false,
    queuedEnabled: null
  };
}

export function normalizeMidiInputSelection(selection: string | null | undefined, midiInputs: MidiInputRef[]): string | null {
  if (typeof selection !== "string" || selection.trim().length === 0) {
    return null;
  }

  const match = midiInputs.find(
    (input) => input.id === selection || input.selector === selection || input.name === selection
  );
  return match?.id ?? null;
}

export function defaultPianoRoll(index = 1, midiChannel = 2): PianoRollState {
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

export function defaultMidiController(index = 1): MidiControllerState {
  return {
    id: `cc-${index}`,
    name: `Controller ${index}`,
    controllerNumber: clampInt(index - 1, 0, 127),
    value: 0,
    enabled: false
  };
}

export function defaultMidiControllers(count = MAX_MIDI_CONTROLLERS): MidiControllerState[] {
  return Array.from({ length: count }, (_, index) => defaultMidiController(index + 1));
}

export function defaultControllerSequencer(
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

export function defaultArpeggiator(
  index = 1,
  inputChannel = 3,
  targetChannel = 1
): ArpeggiatorState {
  const preset = BUILTIN_ARPEGGIATOR_PRESETS[0];
  const settings = normalizeArpeggiatorSettings(preset?.settings ?? DEFAULT_ARPEGGIATOR_SETTINGS);
  return {
    id: `arp-${index}`,
    name: `Arpeggiator ${index}`,
    enabled: false,
    inputChannel: clampInt(inputChannel, 1, 16),
    targetChannel: clampInt(targetChannel, 1, 16),
    presetId: preset?.id ?? null,
    ...settings,
    heldNotes: [],
    activeNote: null,
    stepIndex: 0,
    lastVelocity: null
  };
}

export function normalizeArpeggiatorState(raw: unknown, index: number): ArpeggiatorState {
  const fallback = defaultArpeggiator(index, index + 2, 1);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const source = raw as Record<string, unknown>;
  const settings = normalizeArpeggiatorSettings(source);
  const heldNotesRaw = Array.isArray(source.heldNotes ?? source.held_notes) ? ((source.heldNotes ?? source.held_notes) as unknown[]) : [];
  return {
    id: typeof source.id === "string" && source.id.trim().length > 0 ? source.id : fallback.id,
    name: typeof source.name === "string" && source.name.trim().length > 0 ? source.name.trim() : fallback.name,
    enabled: source.enabled === true,
    inputChannel:
      typeof source.inputChannel === "number"
        ? clampInt(source.inputChannel, 1, 16)
        : typeof source.input_channel === "number"
          ? clampInt(source.input_channel, 1, 16)
          : fallback.inputChannel,
    targetChannel:
      typeof source.targetChannel === "number"
        ? clampInt(source.targetChannel, 1, 16)
        : typeof source.target_channel === "number"
          ? clampInt(source.target_channel, 1, 16)
          : fallback.targetChannel,
    presetId: typeof source.presetId === "string" ? source.presetId : typeof source.preset_id === "string" ? source.preset_id : null,
    ...settings,
    heldNotes: heldNotesRaw.map((value) => normalizeStepNote(value)).filter((value): value is number => value !== null),
    activeNote: normalizeStepNote(source.activeNote ?? source.active_note),
    stepIndex: typeof source.stepIndex === "number" ? Math.max(0, Math.round(source.stepIndex)) : typeof source.step_index === "number" ? Math.max(0, Math.round(source.step_index)) : 0,
    lastVelocity:
      typeof source.lastVelocity === "number"
        ? normalizeStepVelocity(source.lastVelocity)
        : typeof source.last_velocity === "number"
          ? normalizeStepVelocity(source.last_velocity)
          : null
  };
}

export function normalizeArpeggiatorPresets(raw: unknown): ArpeggiatorPresetState[] {
  const userPresets = Array.isArray(raw)
    ? raw
        .map((entry, index) => normalizeArpeggiatorPreset(entry, index))
        .filter((entry): entry is ArpeggiatorPresetState => entry !== null && entry.builtin !== true)
    : [];
  const seen = new Set(BUILTIN_ARPEGGIATOR_PRESETS.map((preset) => preset.id));
  const uniqueUserPresets = userPresets.filter((preset) => {
    if (seen.has(preset.id)) {
      return false;
    }
    seen.add(preset.id);
    return true;
  });
  return [
    ...BUILTIN_ARPEGGIATOR_PRESETS.map((preset) => ({
      ...preset,
      settings: normalizeArpeggiatorSettings(preset.settings)
    })),
    ...uniqueUserPresets
  ];
}

export function normalizeControllerSequencerState(
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

export function defaultSequencerState(): SequencerState {
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
    arpeggiators: [],
    arpeggiatorPresets: normalizeArpeggiatorPresets([]),
    pianoRolls: [defaultPianoRoll(1, 2)],
    midiControllers: defaultMidiControllers()
  };
}

export function sequencerRuntimeStateFromSequencer(sequencer: SequencerState): SequencerRuntimeState {
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

  const arpeggiatorStatusById: SequencerRuntimeState["arpeggiatorStatusById"] = {};
  for (const arpeggiator of sequencer.arpeggiators) {
    arpeggiatorStatusById[arpeggiator.id] = {
      heldNotes: arpeggiator.heldNotes,
      activeNote: arpeggiator.activeNote,
      stepIndex: arpeggiator.stepIndex,
      lastVelocity: arpeggiator.lastVelocity
    };
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
    controllerRuntimePadStartSubunitById,
    arpeggiatorStatusById
  };
}

export function syncSequencerTrackTiming(track: SequencerTrackState, timing = track.timing): SequencerTrackState {
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

export function syncDrummerTrackTiming(track: DrummerSequencerTrackState, timing = track.timing): DrummerSequencerTrackState {
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

export function syncControllerSequencerTiming(
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

export function syncSequencerTimingState(sequencer: SequencerState, timing: SequencerTimingConfig): SequencerState {
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

export function mergeSequencerTiming(
  timing: SequencerTimingConfig,
  update: Partial<SequencerTimingConfig>
): SequencerTimingConfig {
  return normalizeSequencerTiming({
    ...timing,
    ...update
  });
}

export function updateSequencerTrackTimingState(
  track: SequencerTrackState,
  update: Partial<SequencerTimingConfig>
): SequencerTrackState {
  const nextTiming = mergeSequencerTiming(track.timing, update);
  return syncSequencerTrackTiming({ ...track, timing: nextTiming }, nextTiming);
}

export function updateDrummerTrackTimingState(
  track: DrummerSequencerTrackState,
  update: Partial<SequencerTimingConfig>
): DrummerSequencerTrackState {
  const nextTiming = mergeSequencerTiming(track.timing, update);
  return syncDrummerTrackTiming({ ...track, timing: nextTiming }, nextTiming);
}

export function updateControllerSequencerTimingState(
  controllerSequencer: ControllerSequencerState,
  update: Partial<SequencerTimingConfig>
): ControllerSequencerState {
  const nextTiming = mergeSequencerTiming(controllerSequencer.timing, update);
  return syncControllerSequencerTiming({ ...controllerSequencer, timing: nextTiming }, nextTiming);
}

export function emptyPerformanceSequencerState(): SequencerState {
  return {
    ...defaultSequencerState(),
    isPlaying: false,
    playhead: 0,
    cycle: 0,
    arrangerLoopSelection: null,
    tracks: [],
    drummerTracks: [],
    controllerSequencers: [],
    arpeggiators: [],
    pianoRolls: [],
    midiControllers: []
  };
}

export function performanceDeviceCount(sequencer: SequencerState): number {
  return (
    sequencer.tracks.length +
    sequencer.drummerTracks.length +
    sequencer.controllerSequencers.length +
    sequencer.arpeggiators.length +
    sequencer.pianoRolls.length +
    sequencer.midiControllers.length
  );
}

export function normalizeSequencerTrackWithTiming(
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
  const rawRuntimePadStartSubunit = track.runtimePadStartSubunit ?? track.runtime_pad_start_subunit;

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
    runtimePadStartSubunit:
      typeof rawRuntimePadStartSubunit === "number" && Number.isFinite(rawRuntimePadStartSubunit)
        ? Math.max(0, Math.floor(rawRuntimePadStartSubunit))
        : null,
    enabled,
    queuedEnabled
  };
}

export function normalizeDrummerSequencerTrack(
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
  const rawRuntimePadStartSubunit = track.runtimePadStartSubunit ?? track.runtime_pad_start_subunit;

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
    runtimePadStartSubunit:
      typeof rawRuntimePadStartSubunit === "number" && Number.isFinite(rawRuntimePadStartSubunit)
        ? Math.max(0, Math.floor(rawRuntimePadStartSubunit))
        : null,
    enabled,
    queuedEnabled
  };
}

export function normalizePianoRollState(raw: unknown, index: number): PianoRollState {
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

export function normalizeMidiControllerState(raw: unknown, index: number): MidiControllerState {
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

export function normalizeSequencerState(raw: unknown): SequencerState {
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

  const arpeggiators: ArpeggiatorState[] = [];
  if (Array.isArray(sequencer.arpeggiators)) {
    for (let index = 0; index < Math.min(MAX_ARPEGGIATORS, sequencer.arpeggiators.length); index += 1) {
      arpeggiators.push(normalizeArpeggiatorState(sequencer.arpeggiators[index], index + 1));
    }
  }
  const arpeggiatorPresets = normalizeArpeggiatorPresets(sequencer.arpeggiatorPresets ?? sequencer.arpeggiator_presets);

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

  const seenArpeggiatorIds = new Set<string>();
  const normalizedArpeggiators = arpeggiators.map((arpeggiator, index) => {
    let nextId = arpeggiator.id.trim().length > 0 ? arpeggiator.id : `arp-${index + 1}`;
    if (seenArpeggiatorIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenArpeggiatorIds.add(nextId);
    return {
      ...arpeggiator,
      id: nextId
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
    arpeggiators: normalizedArpeggiators,
    arpeggiatorPresets,
    pianoRolls: normalizedRolls,
    midiControllers: normalizedControllers
  };
}

export function normalizeEngineConfig(raw: Partial<EngineConfig> | undefined): EngineConfig {
  const sr = clampInt(typeof raw?.sr === "number" ? raw.sr : 48000, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
  let controlRate = 1500;

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

export function withNormalizedEngineConfig(graph: PatchGraph): PatchGraph {
  return {
    ...graph,
    engine_config: normalizeEngineConfig(graph.engine_config)
  };
}

export function defaultEditablePatch(): EditablePatch {
  const patch = createUntitledPatch();
  return {
    ...patch,
    graph: withNormalizedEngineConfig(patch.graph)
  };
}

export function createInstrumentTab(patch = defaultEditablePatch()): InstrumentTabState {
  return {
    id: crypto.randomUUID(),
    patch
  };
}

export function updatePatchInTabs(tabs: InstrumentTabState[], tabId: string, patch: EditablePatch): InstrumentTabState[] {
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

export function normalizeAppPage(raw: unknown): AppPage {
  return raw === "instrument" || raw === "sequencer" || raw === "config" ? raw : "instrument";
}

export function normalizePersistedPatch(raw: unknown): EditablePatch {
  const fallback = defaultEditablePatch();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const patch = raw as Partial<EditablePatch>;
  const id = typeof patch.id === "string" && patch.id.length > 0 ? patch.id : undefined;
  const name =
    typeof patch.name === "string" && patch.name.trim().length > 0 ? patch.name : fallback.name;
  const description = typeof patch.description === "string" ? patch.description : "";
  const isTemplate = patch.is_template === true;
  const alwaysOn = patch.always_on === true;
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
    is_template: isTemplate,
    always_on: alwaysOn,
    schema_version: schemaVersion,
    graph,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

export function normalizePersistedInstrumentTabs(raw: unknown): InstrumentTabState[] {
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

export function normalizePersistedSequencerInstruments(
  raw: unknown,
  patches: PatchListItem[],
  fallbackPatchId: string | null
): SequencerInstrumentBinding[] {
  const bindings: SequencerInstrumentBinding[] = [];
  const seenChannels = new Set<number>();
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.patchId !== "string" || !patchById.has(candidate.patchId)) {
        continue;
      }

      const patch = patchById.get(candidate.patchId);
      const isAlwaysOn = patch?.always_on === true;
      const midiChannel =
        isAlwaysOn ? 0 : typeof candidate.midiChannel === "number" ? clampInt(candidate.midiChannel, 1, 16) : 1;
      if (!isAlwaysOn) {
        if (seenChannels.has(midiChannel)) {
          continue;
        }
        seenChannels.add(midiChannel);
      }

      bindings.push({
        id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : crypto.randomUUID(),
        patchId: candidate.patchId,
        midiChannel,
        level: normalizeInstrumentLevel(candidate.level),
        effectSourceIds: isAlwaysOn ? normalizeEffectSourceIds(candidate.effectSourceIds) : [],
        effectRoutes: isAlwaysOn ? normalizeEffectRouteSelections(candidate.effectRoutes) : []
      });
    }
  }

  if (bindings.length === 0 && fallbackPatchId && patchById.has(fallbackPatchId)) {
    const fallbackPatch = patchById.get(fallbackPatchId);
    bindings.push({
      id: crypto.randomUUID(),
      patchId: fallbackPatchId,
      midiChannel: fallbackPatch?.always_on === true ? 0 : 1,
      level: 10,
      effectSourceIds: [],
      effectRoutes: []
    });
  }

  return normalizeEffectRoutesForBindings(bindings, patches);
}

export function sequencerSnapshotForPersistence(sequencer: SequencerState): SequencerState {
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
    })),
    arpeggiators: sequencer.arpeggiators.map((arpeggiator) => ({
      ...arpeggiator,
      heldNotes: [],
      activeNote: null,
      stepIndex: 0,
      lastVelocity: null
    }))
  };
}

export function buildPersistedAppStateSnapshot(state: AppStore): PersistedAppState {
  return {
    version: APP_STATE_VERSION,
    activePage: normalizeAppPage(state.activePage),
    guiLanguage: normalizeGuiLanguage(state.guiLanguage),
    browserClockLatencySettings: normalizeBrowserClockLatencySettings(state.browserClockLatencySettings),
    instrumentTabs: state.instrumentTabs.map((tab) => ({
      id: tab.id,
      patch: {
        id: tab.patch.id,
        name: tab.patch.name,
        description: tab.patch.description,
        is_template: tab.patch.is_template,
        always_on: tab.patch.always_on,
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
      midiChannel: clampInt(binding.midiChannel, 0, 16),
      level: normalizeInstrumentLevel(binding.level),
      effectSourceIds: normalizeEffectSourceIds(binding.effectSourceIds),
      effectRoutes: normalizeEffectRouteSelections(binding.effectRoutes)
    })),
    currentPerformanceId: state.currentPerformanceId,
    performanceName: state.performanceName,
    performanceDescription: state.performanceDescription,
    activeMidiInput: state.activeMidiInput
  };
}

export function capturePersistWatchState(state: AppStore): PersistWatchState {
  return {
    activePage: state.activePage,
    guiLanguage: state.guiLanguage,
    browserClockLatencySettings: state.browserClockLatencySettings,
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

export function hasPersistableStateChange(current: PersistWatchState, previous: PersistWatchState | null): boolean {
  if (!previous) {
    return true;
  }
  return (
    current.activePage !== previous.activePage ||
    current.guiLanguage !== previous.guiLanguage ||
    current.browserClockLatencySettings !== previous.browserClockLatencySettings ||
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

export function isSequencerRuntimeOnlyUpdate(current: PersistWatchState, previous: PersistWatchState | null): boolean {
  if (!previous || !current.sequencer.isPlaying) {
    return false;
  }
  if (
    current.activePage !== previous.activePage ||
    current.guiLanguage !== previous.guiLanguage ||
    current.browserClockLatencySettings !== previous.browserClockLatencySettings ||
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

export function defaultParams(opcode: OpcodeSpec): Record<string, string | number | boolean> {
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

export function randomPosition(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 80 + col * 220, y: 80 + row * 150 };
}

export function normalizePatch(patch: Patch): EditablePatch {
  return {
    id: patch.id,
    name: patch.name,
    description: patch.description,
    is_template: patch.is_template === true,
    always_on: patch.always_on === true,
    schema_version: patch.schema_version,
    graph: withNormalizedEngineConfig(patch.graph),
    created_at: patch.created_at,
    updated_at: patch.updated_at
  };
}

export type EmbeddedPerformancePatchDefinition = {
  sourcePatchId: string;
  name: string;
  description: string;
  is_template: boolean;
  always_on: boolean;
  schema_version: number;
  graph: PatchGraph;
};

export function parseEmbeddedPerformancePatchDefinition(raw: unknown): EmbeddedPerformancePatchDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const sourcePatchId = typeof record.sourcePatchId === "string" ? record.sourcePatchId.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description : "";
  const isTemplate = record.isTemplate === true || record.is_template === true;
  const alwaysOn = record.alwaysOn === true || record.always_on === true;
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
    is_template: isTemplate,
    always_on: alwaysOn,
    schema_version: schemaVersion,
    graph: withNormalizedEngineConfig(record.graph as PatchGraph)
  };
}

export function embeddedPatchDefinitionsFromSnapshot(snapshot: unknown): EmbeddedPerformancePatchDefinition[] {
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

export async function hydrateEmbeddedPerformancePatches(
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
      is_template: definition.is_template,
      always_on: definition.always_on,
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

export function performablePatches(patches: PatchListItem[]): PatchListItem[] {
  return patches.filter((patch) => patch.is_template !== true);
}

export function patchHasAudioOutlets(patch: PatchListItem | undefined): boolean {
  return Array.isArray(patch?.audio_outlet_names) && patch.audio_outlet_names.length > 0;
}

export function sourceIdsFromEffectRoutes(routes: EffectRouteSelection[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.sourceId)) {
      continue;
    }
    seen.add(route.sourceId);
    result.push(route.sourceId);
  }
  return result.slice(0, 16);
}

export function availableEffectRoutesForBinding(
  binding: SequencerInstrumentBinding,
  bindings: SequencerInstrumentBinding[],
  patchById: Map<string, PatchListItem>
): EffectRouteSelection[] {
  const effectPatch = patchById.get(binding.patchId);
  if (effectPatch?.always_on !== true) {
    return [];
  }

  if ((effectPatch.audio_inlet_names ?? []).length === 0) {
    return [];
  }

  const routes: EffectRouteSelection[] = [];
  for (const sourceBinding of bindings) {
    if (sourceBinding.id === binding.id) {
      continue;
    }
    const sourcePatch = patchById.get(sourceBinding.patchId);
    if (!sourcePatch || !patchHasAudioOutlets(sourcePatch)) {
      continue;
    }
    if (effectRouteWouldCreateLoop(bindings, binding.id, sourceBinding.id)) {
      continue;
    }
    for (const channel of sourcePatch.audio_outlet_names ?? []) {
      routes.push({ sourceId: sourceBinding.id, channel });
    }
  }
  return routes;
}

export function normalizeEffectRoutesForBindings(
  bindings: SequencerInstrumentBinding[],
  patches: PatchListItem[]
): SequencerInstrumentBinding[] {
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));
  const normalized = bindings.map((binding) => {
    const patch = patchById.get(binding.patchId);
    const isAlwaysOn = patch?.always_on === true;
    return {
      ...binding,
      midiChannel: isAlwaysOn ? 0 : clampInt(binding.midiChannel || 1, 1, 16),
      effectSourceIds: isAlwaysOn ? normalizeEffectSourceIds(binding.effectSourceIds) : [],
      effectRoutes: isAlwaysOn ? normalizeEffectRouteSelections(binding.effectRoutes) : []
    };
  });
  return normalized.map((binding) => {
    const patch = patchById.get(binding.patchId);
    if (patch?.always_on !== true) {
      return { ...binding, effectSourceIds: [], effectRoutes: [] };
    }
    const availableRoutes = availableEffectRoutesForBinding(binding, normalized, patchById);
    const availableKeys = new Set(availableRoutes.map((route) => effectRouteKey(route.sourceId, route.channel)));
    const expandedRoutes = [...binding.effectRoutes];
    if (binding.effectRoutes.length === 0) {
      const selectedSourceIds = new Set(binding.effectSourceIds);
      for (const route of availableRoutes) {
        if (selectedSourceIds.has(route.sourceId)) {
          expandedRoutes.push(route);
        }
      }
    }
    const effectRoutes = normalizeEffectRouteSelections(expandedRoutes).filter((route) =>
      availableKeys.has(effectRouteKey(route.sourceId, route.channel))
    );
    return {
      ...binding,
      effectRoutes,
      effectSourceIds: sourceIdsFromEffectRoutes(effectRoutes)
    };
  });
}

export function defaultSequencerInstruments(patches: PatchListItem[], currentPatch?: EditablePatch): SequencerInstrumentBinding[] {
  const availablePatches = performablePatches(patches);
  const patchId = availablePatches[0]?.id ?? (currentPatch?.is_template === true ? undefined : currentPatch?.id);
  if (!patchId) {
    return [];
  }
  const patch = availablePatches.find((candidate) => candidate.id === patchId);
  return [
    {
      id: crypto.randomUUID(),
      patchId,
      midiChannel: patch?.always_on === true ? 0 : 1,
      level: 10,
      effectSourceIds: [],
      effectRoutes: []
    }
  ];
}

export function sequencerInstrumentsForPerformablePatches(
  bindings: SequencerInstrumentBinding[],
  patches: PatchListItem[]
): SequencerInstrumentBinding[] {
  const availablePatchIds = new Set(performablePatches(patches).map((patch) => patch.id));
  return normalizeEffectRoutesForBindings(
    bindings.filter((binding) => availablePatchIds.has(binding.patchId)),
    performablePatches(patches)
  );
}

export function nextAvailableMidiChannel(bindings: SequencerInstrumentBinding[]): number {
  const occupied = new Set(
    bindings
      .filter((binding) => binding.midiChannel > 0)
      .map((binding) => clampInt(binding.midiChannel, 1, 16))
  );
  for (let channel = 1; channel <= 16; channel += 1) {
    if (!occupied.has(channel)) {
      return channel;
    }
  }
  return 1;
}

export function nextAvailablePerformanceChannel(sequencer: SequencerState): number {
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
  for (const arpeggiator of sequencer.arpeggiators) {
    occupied.add(clampInt(arpeggiator.inputChannel, 1, 16));
  }

  for (let channel = 1; channel <= 16; channel += 1) {
    if (!occupied.has(channel)) {
      return channel;
    }
  }
  return 1;
}

export function nextAvailableArpeggiatorInputChannel(sequencer: SequencerState, instruments: SequencerInstrumentBinding[]): number {
  const occupied = new Set<number>();
  for (const instrument of instruments) {
    if (instrument.midiChannel <= 0) {
      continue;
    }
    occupied.add(clampInt(instrument.midiChannel, 1, 16));
  }
  if (instruments.length === 0) {
    occupied.add(1);
  }
  for (const arpeggiator of sequencer.arpeggiators) {
    occupied.add(clampInt(arpeggiator.inputChannel, 1, 16));
  }
  for (let channel = 1; channel <= 16; channel += 1) {
    if (!occupied.has(channel)) {
      return channel;
    }
  }
  return 16;
}

export function defaultArpeggiatorTargetChannel(instruments: SequencerInstrumentBinding[]): number {
  return clampInt(instruments.find((instrument) => instrument.midiChannel > 0)?.midiChannel ?? 1, 1, 16);
}

export function arpeggiatorTargetChannelAvoidingInputs(
  requestedChannel: number,
  inputChannels: Set<number>,
  instruments: SequencerInstrumentBinding[],
  fallbackChannel = 1
): number {
  const normalizedRequested = clampInt(requestedChannel, 1, 16);
  if (!inputChannels.has(normalizedRequested)) {
    return normalizedRequested;
  }
  for (const instrument of instruments) {
    if (instrument.midiChannel <= 0) {
      continue;
    }
    const channel = clampInt(instrument.midiChannel, 1, 16);
    if (!inputChannels.has(channel)) {
      return channel;
    }
  }
  const normalizedFallback = clampInt(fallbackChannel, 1, 16);
  if (!inputChannels.has(normalizedFallback)) {
    return normalizedFallback;
  }
  for (let channel = 1; channel <= 16; channel += 1) {
    if (!inputChannels.has(channel)) {
      return channel;
    }
  }
  return normalizedRequested;
}

export function nextAvailableControllerNumber(controllers: MidiControllerState[]): number {
  const occupied = new Set(controllers.map((controller) => normalizeControllerNumber(controller.controllerNumber)));
  for (let controllerNumber = 0; controllerNumber <= 127; controllerNumber += 1) {
    if (!occupied.has(controllerNumber)) {
      return controllerNumber;
    }
  }
  return 0;
}

export function nextAvailableControllerSequencerNumber(controllerSequencers: ControllerSequencerState[]): number {
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

export function buildSequencerConfigSnapshot(
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
    version: 10,
    instruments: instruments
      .filter((instrument) => instrument.patchId.length > 0)
      .map((instrument) => ({
        patchId: instrument.patchId,
        id: instrument.id,
        midiChannel: clampInt(instrument.midiChannel, 0, 16),
        level: normalizeInstrumentLevel(instrument.level),
        effectSourceIds: normalizeEffectSourceIds(instrument.effectSourceIds),
        effectRoutes: normalizeEffectRouteSelections(instrument.effectRoutes)
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
      })),
      arpeggiators: sequencer.arpeggiators.slice(0, MAX_ARPEGGIATORS).map((arpeggiator, index) => ({
        id: arpeggiator.id.length > 0 ? arpeggiator.id : `arp-${index + 1}`,
        name: arpeggiator.name.trim().length > 0 ? arpeggiator.name : `Arpeggiator ${index + 1}`,
        enabled: arpeggiator.enabled === true,
        inputChannel: clampInt(arpeggiator.inputChannel, 1, 16),
        targetChannel: clampInt(arpeggiator.targetChannel, 1, 16),
        presetId: arpeggiator.presetId,
        ...normalizeArpeggiatorSettings(arpeggiator)
      })),
      arpeggiatorPresets: sequencer.arpeggiatorPresets
        .filter((preset) => preset.builtin !== true)
        .map((preset, index) => ({
          id: preset.id.trim().length > 0 ? preset.id : `user-arp-preset-${index + 1}`,
          name: preset.name.trim().length > 0 ? preset.name : `Arp Preset ${index + 1}`,
          settings: normalizeArpeggiatorSettings(preset.settings)
        }))
    }
  };
}

export function parseSequencerConfigSnapshot(
  snapshot: unknown,
  availablePatches: PatchListItem[],
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
    payload.version !== 7 &&
    payload.version !== 8 &&
    payload.version !== 9 &&
    payload.version !== 10
  ) {
    throw new Error("Unsupported sequencer config version.");
  }

  const sequencer = normalizeSequencerState(payload.sequencer);
  const instrumentsRaw = Array.isArray(payload.instruments) ? payload.instruments : [];
  const patchById = new Map(availablePatches.map((patch) => [patch.id, patch]));

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
    if (!patchById.has(record.patchId)) {
      continue;
    }

    const patch = patchById.get(record.patchId);
    const isAlwaysOn = patch?.always_on === true;
    const midiChannel =
      isAlwaysOn ? 0 : typeof record.midiChannel === "number" ? clampInt(record.midiChannel, 1, 16) : 1;
    if (!isAlwaysOn) {
      if (seenChannels.has(midiChannel)) {
        continue;
      }
      seenChannels.add(midiChannel);
    }

    instruments.push({
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : crypto.randomUUID(),
      patchId: record.patchId,
      midiChannel,
      level: normalizeInstrumentLevel(record.level),
      effectSourceIds: isAlwaysOn ? normalizeEffectSourceIds(record.effectSourceIds) : [],
      effectRoutes: isAlwaysOn ? normalizeEffectRouteSelections(record.effectRoutes) : []
    });
  }

  if (instruments.length === 0 && fallbackPatchId) {
    const fallbackPatch = patchById.get(fallbackPatchId);
    instruments.push({
      id: crypto.randomUUID(),
      patchId: fallbackPatchId,
      midiChannel: fallbackPatch?.always_on === true ? 0 : 1,
      level: 10,
      effectSourceIds: [],
      effectRoutes: []
    });
  }

  if (instruments.length === 0) {
    throw new Error("No valid instrument assignments found in config.");
  }

  return {
    sequencer,
    instruments: normalizeEffectRoutesForBindings(instruments, availablePatches)
  };
}

export function normalizeSessionInstrumentAssignments(
  bindings: SequencerInstrumentBinding[]
): SessionInstrumentAssignment[] {
  const assignments: SessionInstrumentAssignment[] = [];
  const seenChannels = new Set<number>();

  for (const binding of bindings) {
    if (!binding.patchId || binding.patchId.length === 0) {
      continue;
    }

    const midiChannel = clampInt(binding.midiChannel, 0, 16);
    if (midiChannel > 0) {
      if (seenChannels.has(midiChannel)) {
        throw new Error(`MIDI channel ${midiChannel} is assigned more than once.`);
      }
      seenChannels.add(midiChannel);
    }

    assignments.push({
      id: binding.id,
      patch_id: binding.patchId,
      midi_channel: midiChannel,
      effect_source_ids: sourceIdsFromEffectRoutes(normalizeEffectRouteSelections(binding.effectRoutes)),
      effect_routes: normalizeEffectRouteSelections(binding.effectRoutes).map((route) => ({
        source_id: route.sourceId,
        channel: route.channel
      }))
    });
  }

  if (assignments.length === 0) {
    throw new Error("Add at least one sequencer instrument before starting the engine.");
  }

  return assignments;
}

export function sortedAssignments(assignments: SessionInstrumentAssignment[]): SessionInstrumentAssignment[] {
  return [...assignments].sort((a, b) => {
    if (a.midi_channel !== b.midi_channel) {
      return a.midi_channel - b.midi_channel;
    }
    const idCompare = (a.id ?? "").localeCompare(b.id ?? "");
    if (idCompare !== 0) {
      return idCompare;
    }
    return a.patch_id.localeCompare(b.patch_id);
  });
}

export function sameAssignments(a: SessionInstrumentAssignment[], b: SessionInstrumentAssignment[]): boolean {
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
    if ((aSorted[index].id ?? "") !== (bSorted[index].id ?? "")) {
      return false;
    }
    const aSources = normalizeEffectSourceIds(aSorted[index].effect_source_ids).sort();
    const bSources = normalizeEffectSourceIds(bSorted[index].effect_source_ids).sort();
    if (aSources.length !== bSources.length) {
      return false;
    }
    for (let sourceIndex = 0; sourceIndex < aSources.length; sourceIndex += 1) {
      if (aSources[sourceIndex] !== bSources[sourceIndex]) {
        return false;
      }
    }
    const aRoutes = normalizeEffectRouteSelections(aSorted[index].effect_routes)
      .map((route) => effectRouteKey(route.sourceId, route.channel))
      .sort();
    const bRoutes = normalizeEffectRouteSelections(bSorted[index].effect_routes)
      .map((route) => effectRouteKey(route.sourceId, route.channel))
      .sort();
    if (aRoutes.length !== bRoutes.length) {
      return false;
    }
    for (let routeIndex = 0; routeIndex < aRoutes.length; routeIndex += 1) {
      if (aRoutes[routeIndex] !== bRoutes[routeIndex]) {
        return false;
      }
    }
  }

  return true;
}

export const initialPatch = defaultEditablePatch();
export const initialTab = createInstrumentTab(initialPatch);
export const initialSequencerState = defaultSequencerState();
export const initialSequencerRuntimeState = sequencerRuntimeStateFromSequencer(initialSequencerState);
export const initialBrowserClockLatencySettings = resolveDefaultBrowserClockLatencySettings();

