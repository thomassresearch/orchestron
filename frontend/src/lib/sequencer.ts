import type {
  ControllerSequencerKeypoint,
  MidiInputRef,
  SequencerChord,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType
} from "../types";

export const STEP_CAPACITY = 32;
export const CONTROLLER_SEQUENCER_STEP_OPTIONS = [8, 16, 32, 64] as const;

interface SequencerScaleRootOption {
  value: SequencerScaleRoot;
  label: string;
  pitchClass: number;
  preferFlats: boolean;
}

interface SequencerScaleDefinition {
  root: SequencerScaleRoot;
  type: SequencerScaleType;
  value: string;
  label: string;
}

interface SequencerModeDefinition {
  value: SequencerMode;
  label: string;
}

type SequencerChordFamily = "tertian" | "sus";

interface SequencerChordDefinition {
  value: Exclude<SequencerChord, "none">;
  label: string;
  family: SequencerChordFamily;
  intervals: readonly number[];
}

export interface SequencerNoteOption {
  note: number;
  label: string;
  degree: number | null;
  inScale: boolean;
}

export type SequencerChordOptionGroup = "none" | "diatonic" | "chromatic";
export type SequencerChordColorClass = "neutral" | "green" | "orange" | "red";

export interface SequencerChordOption {
  value: SequencerChord;
  label: string;
  group: SequencerChordOptionGroup;
  color: SequencerChordColorClass;
  notes: number[];
  inScaleToneCount: number;
}

const DEFAULT_SCALE_ROOT: SequencerScaleRoot = "C";
const DEFAULT_SCALE_TYPE: SequencerScaleType = "minor";
const DEFAULT_MODE: SequencerMode = "aeolian";

const MODE_INTERVALS: Record<SequencerMode, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10]
};

const SEQUENCER_SCALE_ROOTS: SequencerScaleRootOption[] = [
  { value: "C", label: "C", pitchClass: 0, preferFlats: false },
  { value: "C#", label: "C#", pitchClass: 1, preferFlats: false },
  { value: "Db", label: "Db", pitchClass: 1, preferFlats: true },
  { value: "D", label: "D", pitchClass: 2, preferFlats: false },
  { value: "D#", label: "D#", pitchClass: 3, preferFlats: false },
  { value: "Eb", label: "Eb", pitchClass: 3, preferFlats: true },
  { value: "E", label: "E", pitchClass: 4, preferFlats: false },
  { value: "F", label: "F", pitchClass: 5, preferFlats: true },
  { value: "F#", label: "F#", pitchClass: 6, preferFlats: false },
  { value: "Gb", label: "Gb", pitchClass: 6, preferFlats: true },
  { value: "G", label: "G", pitchClass: 7, preferFlats: false },
  { value: "G#", label: "G#", pitchClass: 8, preferFlats: false },
  { value: "Ab", label: "Ab", pitchClass: 8, preferFlats: true },
  { value: "A", label: "A", pitchClass: 9, preferFlats: false },
  { value: "A#", label: "A#", pitchClass: 10, preferFlats: false },
  { value: "Bb", label: "Bb", pitchClass: 10, preferFlats: true },
  { value: "B", label: "B", pitchClass: 11, preferFlats: false },
  { value: "Cb", label: "Cb", pitchClass: 11, preferFlats: true }
];

const SCALE_ROOT_MAP = new Map<SequencerScaleRoot, SequencerScaleRootOption>(
  SEQUENCER_SCALE_ROOTS.map((option) => [option.value, option])
);

const SHARP_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SPECIAL_ENHARMONIC_ALIASES: Partial<Record<number, { name: string; octaveOffset: number }>> = {
  0: { name: "B#", octaveOffset: -1 },
  4: { name: "Fb", octaveOffset: 0 },
  5: { name: "E#", octaveOffset: 0 },
  11: { name: "Cb", octaveOffset: 1 }
};

export const SEQUENCER_SCALE_OPTIONS: SequencerScaleDefinition[] = SEQUENCER_SCALE_ROOTS.flatMap((root) => [
  {
    root: root.value,
    type: "major",
    value: `${root.value}:major`,
    label: `${root.label} major`
  },
  {
    root: root.value,
    type: "neutral",
    value: `${root.value}:neutral`,
    label: root.label
  },
  {
    root: root.value,
    type: "minor",
    value: `${root.value}:minor`,
    label: `${root.label} minor`
  }
]);

export const SEQUENCER_MODE_OPTIONS: SequencerModeDefinition[] = [
  { value: "ionian", label: "Ionian" },
  { value: "dorian", label: "Dorian" },
  { value: "phrygian", label: "Phrygian" },
  { value: "lydian", label: "Lydian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "aeolian", label: "Aeolian" },
  { value: "locrian", label: "Locrian" }
];

export const SEQUENCER_CHORD_OPTIONS: readonly SequencerChordDefinition[] = [
  { value: "maj", label: "maj", family: "tertian", intervals: [0, 4, 7] },
  { value: "min", label: "min", family: "tertian", intervals: [0, 3, 7] },
  { value: "dim", label: "dim", family: "tertian", intervals: [0, 3, 6] },
  { value: "aug", label: "aug", family: "tertian", intervals: [0, 4, 8] },
  { value: "sus2", label: "sus2", family: "sus", intervals: [0, 2, 7] },
  { value: "sus4", label: "sus4", family: "sus", intervals: [0, 5, 7] },
  { value: "maj7", label: "maj7", family: "tertian", intervals: [0, 4, 7, 11] },
  { value: "min7", label: "min7", family: "tertian", intervals: [0, 3, 7, 10] },
  { value: "dom7", label: "dom7", family: "tertian", intervals: [0, 4, 7, 10] },
  { value: "m7b5", label: "m7b5", family: "tertian", intervals: [0, 3, 6, 10] },
  { value: "dim7", label: "dim7", family: "tertian", intervals: [0, 3, 6, 9] },
  { value: "minmaj7", label: "minmaj7", family: "tertian", intervals: [0, 3, 7, 11] }
] as const;

const SEQUENCER_CHORD_MAP = new Map<Exclude<SequencerChord, "none">, SequencerChordDefinition>(
  SEQUENCER_CHORD_OPTIONS.map((definition) => [definition.value, definition])
);

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function clampSequencerBpm(bpm: number): number {
  return clampInt(bpm, 30, 300);
}

export function clampSequencerChannel(channel: number): number {
  return clampInt(channel, 1, 16);
}

export function clampSequencerNote(note: number): number {
  return clampInt(note, 0, 127);
}

export function clampControllerSequencerStepCount(value: number): 8 | 16 | 32 | 64 {
  const rounded = Math.round(value);
  if (rounded === 8 || rounded === 16 || rounded === 32 || rounded === 64) {
    return rounded;
  }
  return 16;
}

export function clampControllerCurvePosition(value: number): number {
  return clampFloat(Number.isFinite(value) ? value : 0, 0, 1);
}

export function clampControllerCurveValue(value: number): number {
  return clampInt(Number.isFinite(value) ? value : 0, 0, 127);
}

export function normalizeControllerCurveKeypoints(raw: ControllerSequencerKeypoint[]): ControllerSequencerKeypoint[] {
  const epsilon = 1e-6;
  const normalized = raw
    .map((point, index) => ({
      id:
        typeof point.id === "string" && point.id.trim().length > 0
          ? point.id
          : `kp-${index}-${Math.round(clampControllerCurvePosition(point.position) * 1000)}`,
      position: clampControllerCurvePosition(point.position),
      value: clampControllerCurveValue(point.value)
    }))
    .sort((a, b) => (a.position === b.position ? a.id.localeCompare(b.id) : a.position - b.position));

  let startPoint: ControllerSequencerKeypoint | null = null;
  let endPoint: ControllerSequencerKeypoint | null = null;
  const interior: ControllerSequencerKeypoint[] = [];

  for (const point of normalized) {
    if (point.position <= epsilon) {
      startPoint = { ...point, position: 0 };
      continue;
    }
    if (point.position >= 1 - epsilon) {
      endPoint = { ...point, position: 1 };
      continue;
    }

    const previous = interior[interior.length - 1];
    if (previous && Math.abs(previous.position - point.position) <= epsilon) {
      interior[interior.length - 1] = point;
    } else {
      interior.push(point);
    }
  }

  if (!startPoint) {
    startPoint = { id: "kp-start", position: 0, value: 0 };
  }
  if (!endPoint) {
    endPoint = { id: "kp-end", position: 1, value: 0 };
  }

  const boundaryValue = clampControllerCurveValue(startPoint?.value ?? endPoint?.value ?? 0);
  startPoint.value = boundaryValue;
  endPoint.value = boundaryValue;

  return [startPoint, ...interior, endPoint];
}

type ControllerCurvePoint = { position: number; value: number };

function controllerCurveControlPoints(keypoints: ControllerCurvePoint[]): ControllerCurvePoint[] {
  const clamped = keypoints
    .map((point) => ({
      position: clampControllerCurvePosition(point.position),
      value: clampControllerCurveValue(point.value)
    }))
    .sort((a, b) => a.position - b.position);
  const normalized = normalizeControllerCurveKeypoints(
    clamped.map((point, index) => ({
      id: `curve-${index}`,
      position: point.position,
      value: point.value
    }))
  );

  return normalized.map((point) => ({
    position: point.position,
    value: point.value
  }));
}

function catmullRom1d(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function sampleControllerCurveValue(
  keypoints: Array<Pick<ControllerCurvePoint, "position" | "value">>,
  normalizedPosition: number
): number {
  const t = clampControllerCurvePosition(normalizedPosition);
  const points = controllerCurveControlPoints(keypoints);

  if (points.length <= 1) {
    return 0;
  }

  if (t <= 0) {
    return clampControllerCurveValue(points[0]?.value ?? 0);
  }
  if (t >= 1) {
    return clampControllerCurveValue(points[points.length - 1]?.value ?? 0);
  }

  let segmentIndex = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    if (t <= points[index + 1].position) {
      segmentIndex = index;
      break;
    }
  }

  const p1 = points[segmentIndex];
  const p2 = points[Math.min(points.length - 1, segmentIndex + 1)];
  const p0 = points[Math.max(0, segmentIndex - 1)];
  const p3 = points[Math.min(points.length - 1, segmentIndex + 2)];
  const span = Math.max(1e-6, p2.position - p1.position);
  const localT = clampFloat((t - p1.position) / span, 0, 1);
  const value = catmullRom1d(p0.value, p1.value, p2.value, p3.value, localT);
  return clampControllerCurveValue(value);
}

export function buildControllerCurvePath(
  keypoints: Array<Pick<ControllerCurvePoint, "position" | "value">>,
  width: number,
  height: number,
  samples = 160
): string {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const count = Math.max(8, Math.round(samples));
  const points: string[] = [];

  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const value = sampleControllerCurveValue(keypoints, t);
    const x = t * safeWidth;
    const y = safeHeight - (value / 127) * safeHeight;
    points.push(`${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  return points.join(" ");
}

export function normalizeSequencerScaleRoot(value: unknown): SequencerScaleRoot {
  if (typeof value === "string" && SCALE_ROOT_MAP.has(value as SequencerScaleRoot)) {
    return value as SequencerScaleRoot;
  }
  return DEFAULT_SCALE_ROOT;
}

export function normalizeSequencerScaleType(value: unknown): SequencerScaleType {
  if (value === "major" || value === "neutral" || value === "minor") {
    return value;
  }
  return DEFAULT_SCALE_TYPE;
}

export function normalizeSequencerMode(value: unknown): SequencerMode {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(MODE_INTERVALS, value)) {
    return value as SequencerMode;
  }
  return DEFAULT_MODE;
}

export function normalizeSequencerChord(value: unknown): SequencerChord {
  if (value === "none") {
    return "none";
  }
  if (typeof value === "string" && SEQUENCER_CHORD_MAP.has(value as Exclude<SequencerChord, "none">)) {
    return value as Exclude<SequencerChord, "none">;
  }
  return "none";
}

export function sequencerChordLabel(chord: SequencerChord): string {
  if (chord === "none") {
    return "none";
  }
  return SEQUENCER_CHORD_MAP.get(chord)?.label ?? chord;
}

function scalePitchClassesForMode(scaleRoot: SequencerScaleRoot, mode: SequencerMode): number[] {
  const rootPitchClass = resolveScaleRoot(scaleRoot).pitchClass;
  return MODE_INTERVALS[mode].map((interval) => normalizePitchClass(rootPitchClass + interval));
}

function scalePitchClassSetForMode(scaleRoot: SequencerScaleRoot, mode: SequencerMode): Set<number> {
  return new Set(scalePitchClassesForMode(scaleRoot, mode));
}

function arraysEqualNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function diatonicTertianIntervalsForRoot(
  rootPitchClass: number,
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode,
  toneCount: number
): number[] | null {
  const rootPitchClassNormalized = normalizePitchClass(rootPitchClass);
  const modeIntervals = MODE_INTERVALS[mode];
  const scalePitchClasses = scalePitchClassesForMode(scaleRoot, mode);
  const rootDegreeIndex = scalePitchClasses.findIndex((pitchClass) => pitchClass === rootPitchClassNormalized);
  if (rootDegreeIndex < 0) {
    return null;
  }

  const rootModeInterval = modeIntervals[rootDegreeIndex];
  const intervals: number[] = [];
  for (let toneIndex = 0; toneIndex < Math.max(1, Math.round(toneCount)); toneIndex += 1) {
    const scaleIndex = rootDegreeIndex + toneIndex * 2;
    const wrappedIndex = scaleIndex % modeIntervals.length;
    const octaveOffset = Math.floor(scaleIndex / modeIntervals.length);
    intervals.push(modeIntervals[wrappedIndex] - rootModeInterval + octaveOffset * 12);
  }
  return intervals;
}

function fixedIntervalMidiNotes(rootNote: number, intervals: readonly number[]): number[] {
  const root = clampSequencerNote(rootNote);
  const notes: number[] = [];
  for (const interval of intervals) {
    const note = clampSequencerNote(root + interval);
    if (!notes.includes(note)) {
      notes.push(note);
    }
  }
  return notes;
}

function diatonicTertianMidiNotes(
  rootNote: number,
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode,
  toneCount: number
): number[] {
  const intervals = diatonicTertianIntervalsForRoot(rootNote, scaleRoot, mode, toneCount);
  if (!intervals) {
    return [clampSequencerNote(rootNote)];
  }
  return fixedIntervalMidiNotes(rootNote, intervals);
}

function resolveChordOption(
  chord: SequencerChord,
  rootNote: number | null,
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode
): SequencerChordOption {
  if (chord === "none") {
    const notes = typeof rootNote === "number" ? [clampSequencerNote(rootNote)] : [];
    const inScaleToneCount =
      typeof rootNote === "number" && scaleDegreeForNote(rootNote, scaleRoot, mode) !== null ? 1 : 0;
    return {
      value: "none",
      label: "none",
      group: "none",
      color: "neutral",
      notes,
      inScaleToneCount
    };
  }

  const definition = SEQUENCER_CHORD_MAP.get(chord);
  if (!definition) {
    return resolveChordOption("none", rootNote, scaleRoot, mode);
  }

  if (typeof rootNote !== "number") {
    return {
      value: chord,
      label: definition.label,
      group: "chromatic",
      color: "neutral",
      notes: [],
      inScaleToneCount: 0
    };
  }

  const root = clampSequencerNote(rootNote);
  const rootPitchClass = normalizePitchClass(root);
  const scalePitchClassSet = scalePitchClassSetForMode(scaleRoot, mode);
  const rootInScale = scalePitchClassSet.has(rootPitchClass);

  let isDiatonic = false;
  if (rootInScale) {
    if (definition.family === "tertian") {
      const diatonicIntervals = diatonicTertianIntervalsForRoot(rootPitchClass, scaleRoot, mode, definition.intervals.length);
      isDiatonic = diatonicIntervals !== null && arraysEqualNumbers(diatonicIntervals, definition.intervals);
    } else {
      isDiatonic = definition.intervals.every((interval) => scalePitchClassSet.has(normalizePitchClass(rootPitchClass + interval)));
    }
  }

  const notes =
    isDiatonic && definition.family === "tertian"
      ? diatonicTertianMidiNotes(root, scaleRoot, mode, definition.intervals.length)
      : fixedIntervalMidiNotes(root, definition.intervals);

  let inScaleToneCount = 0;
  for (const note of notes) {
    if (scalePitchClassSet.has(normalizePitchClass(note))) {
      inScaleToneCount += 1;
    }
  }

  return {
    value: chord,
    label: definition.label,
    group: isDiatonic ? "diatonic" : "chromatic",
    color: isDiatonic ? "green" : inScaleToneCount > 0 ? "orange" : "red",
    notes,
    inScaleToneCount
  };
}

export function buildSequencerChordOptions(
  rootNote: number | null,
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode
): SequencerChordOption[] {
  const options: SequencerChordOption[] = [resolveChordOption("none", rootNote, scaleRoot, mode)];
  for (const definition of SEQUENCER_CHORD_OPTIONS) {
    options.push(resolveChordOption(definition.value, rootNote, scaleRoot, mode));
  }
  return options;
}

export function buildSequencerStepChordMidiNotes(
  rootNote: number | null,
  chord: SequencerChord,
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode
): number[] {
  if (typeof rootNote !== "number") {
    return [];
  }
  return resolveChordOption(normalizeSequencerChord(chord), rootNote, scaleRoot, mode).notes;
}

export function resolveDiatonicSequencerChordVariant(
  chord: SequencerChord,
  rootNote: number | null,
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode
): SequencerChord {
  const normalizedChord = normalizeSequencerChord(chord);
  if (normalizedChord === "none" || typeof rootNote !== "number") {
    return normalizedChord;
  }

  const definition = SEQUENCER_CHORD_MAP.get(normalizedChord);
  if (!definition) {
    return normalizedChord;
  }

  const root = clampSequencerNote(rootNote);
  const candidates: SequencerChord[] = [];
  const pushCandidate = (candidate: SequencerChord) => {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  pushCandidate(normalizedChord);

  for (const option of SEQUENCER_CHORD_OPTIONS) {
    if (option.family === definition.family && option.intervals.length === definition.intervals.length) {
      pushCandidate(option.value);
    }
  }

  // Sus voicings can become non-diatonic on some degrees (for example a Locrian tonic with b5).
  // In that case, fall back to the diatonic tertian chord with the same tone count.
  if (definition.family !== "tertian") {
    for (const option of SEQUENCER_CHORD_OPTIONS) {
      if (option.family === "tertian" && option.intervals.length === definition.intervals.length) {
        pushCandidate(option.value);
      }
    }
  }

  for (const candidate of candidates) {
    if (resolveChordOption(candidate, root, scaleRoot, mode).group === "diatonic") {
      return candidate;
    }
  }

  return normalizedChord;
}

export function defaultModeForScaleType(scaleType: SequencerScaleType): SequencerMode {
  switch (scaleType) {
    case "major":
      return "ionian";
    case "minor":
      return "aeolian";
    default:
      return DEFAULT_MODE;
  }
}

export function linkedModeForScaleType(scaleType: SequencerScaleType): SequencerMode | null {
  if (scaleType === "major") {
    return "ionian";
  }
  if (scaleType === "minor") {
    return "aeolian";
  }
  return null;
}

export function linkedScaleTypeForMode(mode: SequencerMode): SequencerScaleType {
  if (mode === "ionian") {
    return "major";
  }
  if (mode === "aeolian") {
    return "minor";
  }
  return "neutral";
}

export function sequencerScaleLabel(scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType): string {
  if (scaleType === "neutral") {
    return scaleRoot;
  }
  return `${scaleRoot} ${scaleType}`;
}

export function sequencerModeLabel(mode: SequencerMode): string {
  return SEQUENCER_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function parseSequencerScaleValue(value: string): { root: SequencerScaleRoot; type: SequencerScaleType } | null {
  const [rawRoot, rawType] = value.split(":");
  const root = normalizeSequencerScaleRoot(rawRoot);
  if (rawRoot !== root) {
    return null;
  }
  if (rawType !== "major" && rawType !== "neutral" && rawType !== "minor") {
    return null;
  }
  return { root, type: rawType };
}

function normalizePitchClass(value: number): number {
  const rounded = Math.round(value);
  const modulo = rounded % 12;
  return modulo < 0 ? modulo + 12 : modulo;
}

function midiNoteLabel(note: number, preferFlats: boolean): string {
  const clampedNote = clampSequencerNote(note);
  const pitchClass = normalizePitchClass(clampedNote);
  const octave = Math.floor(clampedNote / 12) - 1;

  const primaryName = preferFlats ? FLAT_NOTE_NAMES[pitchClass] : SHARP_NOTE_NAMES[pitchClass];
  const secondaryName = preferFlats ? SHARP_NOTE_NAMES[pitchClass] : FLAT_NOTE_NAMES[pitchClass];

  const primary = `${primaryName}${octave}`;
  const aliases: string[] = [];

  if (secondaryName !== primaryName) {
    aliases.push(`${secondaryName}${octave}`);
  }

  const specialAlias = SPECIAL_ENHARMONIC_ALIASES[pitchClass];
  if (specialAlias) {
    const special = `${specialAlias.name}${octave + specialAlias.octaveOffset}`;
    if (special !== primary && !aliases.includes(special)) {
      aliases.push(special);
    }
  }

  if (aliases.length === 0) {
    return primary;
  }
  return `${primary} / ${aliases.join(" / ")}`;
}

function resolveScaleRoot(root: SequencerScaleRoot): SequencerScaleRootOption {
  return SCALE_ROOT_MAP.get(root) ?? SCALE_ROOT_MAP.get(DEFAULT_SCALE_ROOT)!;
}

function resolveScaleRootByPitchClass(pitchClass: number, preferFlats: boolean): SequencerScaleRoot {
  const normalizedPitchClass = normalizePitchClass(pitchClass);
  const preferred =
    SEQUENCER_SCALE_ROOTS.find(
      (option) => option.pitchClass === normalizedPitchClass && option.preferFlats === preferFlats
    ) ??
    SEQUENCER_SCALE_ROOTS.find((option) => option.pitchClass === normalizedPitchClass);
  return preferred?.value ?? DEFAULT_SCALE_ROOT;
}

export function transposeSequencerTonicByDiatonicStep(
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode,
  direction: -1 | 1
): { scaleRoot: SequencerScaleRoot; semitoneOffset: number } {
  const rootMeta = resolveScaleRoot(scaleRoot);
  const intervals = MODE_INTERVALS[mode];
  const semitoneOffset = direction === 1 ? intervals[1] : intervals[intervals.length - 1] - 12;

  return {
    scaleRoot: resolveScaleRootByPitchClass(rootMeta.pitchClass + semitoneOffset, rootMeta.preferFlats),
    semitoneOffset
  };
}

export function transposeSequencerNoteByScaleDegree(
  note: number,
  scaleRoot: SequencerScaleRoot,
  mode: SequencerMode,
  direction: -1 | 1
): number {
  const clampedNote = clampSequencerNote(note);
  const rootPitchClass = resolveScaleRoot(scaleRoot).pitchClass;
  const intervals = MODE_INTERVALS[mode];
  const relative = clampedNote - rootPitchClass;
  const relativePitchClass = normalizePitchClass(relative);

  let degreeIndex = 0;
  for (let index = 0; index < intervals.length; index += 1) {
    if (intervals[index] <= relativePitchClass) {
      degreeIndex = index;
      continue;
    }
    break;
  }

  const currentInterval = intervals[degreeIndex];
  const targetInterval =
    direction === 1
      ? (() => {
          const nextIndex = (degreeIndex + 1) % intervals.length;
          return intervals[nextIndex] + (nextIndex <= degreeIndex ? 12 : 0);
        })()
      : (() => {
          const previousIndex = (degreeIndex - 1 + intervals.length) % intervals.length;
          return intervals[previousIndex] + (previousIndex >= degreeIndex ? -12 : 0);
        })();

  return clampSequencerNote(clampedNote + (targetInterval - currentInterval));
}

export function scaleDegreeForNote(note: number, scaleRoot: SequencerScaleRoot, mode: SequencerMode): number | null {
  const rootPitchClass = resolveScaleRoot(scaleRoot).pitchClass;
  const pitchClass = normalizePitchClass(note);
  const intervals = MODE_INTERVALS[mode];

  for (let index = 0; index < intervals.length; index += 1) {
    if (normalizePitchClass(rootPitchClass + intervals[index]) === pitchClass) {
      return index + 1;
    }
  }

  return null;
}

export function buildSequencerNoteOptions(scaleRoot: SequencerScaleRoot, mode: SequencerMode): SequencerNoteOption[] {
  const rootMeta = resolveScaleRoot(scaleRoot);
  const options: SequencerNoteOption[] = [];

  for (let note = 0; note <= 127; note += 1) {
    const degree = scaleDegreeForNote(note, scaleRoot, mode);
    const inScale = degree !== null;
    const label = inScale
      ? `${midiNoteLabel(note, rootMeta.preferFlats)} (${degree})`
      : midiNoteLabel(note, rootMeta.preferFlats);

    options.push({
      note,
      label,
      degree,
      inScale
    });
  }

  return options;
}

export function sequencerStepDurationMs(bpm: number): number {
  return 60000 / clampSequencerBpm(bpm) / 4;
}

export function sequencerGateDurationMs(stepDurationMs: number): number {
  return Math.max(10, Math.round(stepDurationMs * 0.8));
}

export function nextSequencerStep(currentStep: number, stepCount: 16 | 32): number {
  const next = (Math.round(currentStep) + 1) % stepCount;
  return next < 0 ? next + stepCount : next;
}

export function noteOnMessage(note: number, midiChannel: number, velocity = 100): [number, number, number] {
  const channel = clampSequencerChannel(midiChannel) - 1;
  return [0x90 + channel, clampSequencerNote(note), clampInt(velocity, 1, 127)];
}

export function noteOffMessage(note: number, midiChannel: number): [number, number, number] {
  const channel = clampSequencerChannel(midiChannel) - 1;
  return [0x80 + channel, clampSequencerNote(note), 0];
}

export function allNotesOffMessages(midiChannel: number): [number, number, number][] {
  const channel = clampSequencerChannel(midiChannel) - 1;
  return [
    [0xb0 + channel, 123, 0],
    [0xb0 + channel, 120, 0]
  ];
}

export function resolveMidiInputName(midiInputId: string | null, midiInputs: MidiInputRef[]): string | null {
  if (!midiInputId) {
    return null;
  }
  const selected = midiInputs.find((input) => input.id === midiInputId);
  return selected?.name ?? null;
}

export function findMatchingMidiOutput(access: MIDIAccess, targetName: string): MIDIOutput | null {
  const outputs = Array.from(access.outputs.values());
  if (outputs.length === 0) {
    return null;
  }

  const normalizedTarget = normalizeName(targetName);

  return (
    outputs.find((output) => normalizeName(output.name ?? "") === normalizedTarget) ??
    outputs.find((output) => {
      const normalizedOutputName = normalizeName(output.name ?? "");
      return (
        normalizedOutputName.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedOutputName)
      );
    }) ??
    null
  );
}
