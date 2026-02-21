import type {
  MidiInputRef,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType
} from "../types";

export const STEP_CAPACITY = 32;

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

export interface SequencerNoteOption {
  note: number;
  label: string;
  degree: number | null;
  inScale: boolean;
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

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
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
