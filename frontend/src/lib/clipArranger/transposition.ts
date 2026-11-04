import { MODE_INTERVALS, SEQUENCER_SCALE_ROOTS } from '../sequencer';
import type { SequencerMode, SequencerScaleRoot } from '../../types';

export type PitchOffset = { diatonicSteps: number; chromaticSemitones: number };
export type OffsetPlan = { base: PitchOffset; repetitions: { index: number; offset: PitchOffset }[] };
export type TransposeProfile = { id: string; revision: number; plan: OffsetPlan };
export const TRANSPOSE_LIMITS = { amount: 127, profiles: 1024, entries: 4096, totalEntries: 65536, placements: 1024, totalPlacements: 65536, index: 40320000000, variants: 256, totalVariants: 1024, scoreNotes: 200000 } as const;
export const ZERO_OFFSET: Readonly<PitchOffset> = Object.freeze({ diatonicSteps: 0, chromaticSemitones: 0 });
export const emptyOffsetPlan = (): OffsetPlan => ({ base: { ...ZERO_OFFSET }, repetitions: [] });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(k => k in value);
export function validateOffset(value: unknown): asserts value is PitchOffset {
  if (!record(value) || !keys(value, ['diatonicSteps', 'chromaticSemitones']) || Object.values(value).some(n => typeof n !== 'number' || !Number.isSafeInteger(n) || Math.abs(n) > TRANSPOSE_LIMITS.amount)) throw Error('Transpose amounts must be integers from −127 to +127.');
}
export function validateOffsetPlan(value: unknown): asserts value is OffsetPlan {
  if (!record(value) || !keys(value, ['base', 'repetitions']) || !Array.isArray(value.repetitions) || value.repetitions.length > TRANSPOSE_LIMITS.entries) throw Error('Invalid or oversized transpose plan.');
  validateOffset(value.base);
  let previous = -1;
  for (const entry of value.repetitions) {
    if (!record(entry) || !keys(entry, ['index', 'offset']) || typeof entry.index !== 'number' || !Number.isSafeInteger(entry.index) || entry.index <= previous || entry.index > TRANSPOSE_LIMITS.index) throw Error('Transpose repetition indices must be bounded, unique and sorted.');
    validateOffset(entry.offset); previous = entry.index;
  }
}
export function offsetAt(plan: OffsetPlan | undefined, index: number): PitchOffset {
  if (!plan) return ZERO_OFFSET;
  let low = 0, high = plan.repetitions.length;
  while (low < high) { const mid = (low + high) >>> 1; if (plan.repetitions[mid].index < index) low = mid + 1; else high = mid; }
  return plan.repetitions[low]?.index === index ? plan.repetitions[low].offset : plan.base;
}
export function addOffsets(offsets: readonly PitchOffset[]): PitchOffset {
  return offsets.reduce((sum, value) => ({ diatonicSteps: sum.diatonicSteps + value.diatonicSteps, chromaticSemitones: sum.chromaticSemitones + value.chromaticSemitones }), { ...ZERO_OFFSET });
}
/** Snapshot a removed level without enumerating time. Authored range limits still apply. */
export function sumPlans(plans: readonly OffsetPlan[]): OffsetPlan {
  const indices = new Set<number>();
  for (const plan of plans) for (const entry of plan.repetitions) { indices.add(entry.index); if (indices.size > TRANSPOSE_LIMITS.entries) throw Error('Combined transpose plan exceeds the repetition limit.'); }
  const result = { base: addOffsets(plans.map(p => p.base)), repetitions: [...indices].sort((a,b) => a-b).map(index => ({ index, offset: addOffsets(plans.map(p => offsetAt(p, index))) })) };
  validateOffsetPlan(result); return result;
}
export function transposePitch(pitch: number, root: SequencerScaleRoot, mode: SequencerMode, offset: PitchOffset): number | null {
  const r = SEQUENCER_SCALE_ROOTS.find(s => s.value === root)?.pitchClass;
  const intervals = MODE_INTERVALS[mode];
  if (r === undefined || !intervals) throw Error('Unsupported transposition scale.');
  const octave = Math.floor((pitch-r)/12), pc = pitch-r-12*octave;
  let degree = 0;
  for (let i=1; i<7; i++) if (intervals[i] <= pc) degree = i;
  const target = 7*octave+degree+offset.diatonicSteps, targetOctave = Math.floor(target/7);
  const result = r+12*targetOctave+intervals[target-7*targetOctave]+pc-intervals[degree]+offset.chromaticSemitones;
  return result >= 0 && result <= 127 ? result : null;
}
