import { expect, it } from 'vitest';
import vectors from '../../../../backend/tests/fixtures/clip_transposition/pitches.json';
import { MODE_INTERVALS, SEQUENCER_SCALE_ROOTS } from '../sequencer';
import { transposePitch, offsetAt, sumPlans, validateOffsetPlan, type OffsetPlan } from './transposition';
import type { SequencerMode, SequencerScaleRoot } from '../../types';

for (const v of vectors) it(v.id, () => {
  expect(v.pitches.map(p => transposePitch(p, v.root as SequencerScaleRoot, v.mode as SequencerMode, v.offset))).toEqual(v.expected);
});
it('identity and octaves across every root/mode/pitch', () => {
  for (const root of SEQUENCER_SCALE_ROOTS) for (const mode of Object.keys(MODE_INTERVALS) as SequencerMode[]) for (let p=0; p<128; p++) {
    expect(transposePitch(p,root.value,mode,{diatonicSteps:0,chromaticSemitones:0})).toBe(p);
    expect(transposePitch(p,root.value,mode,{diatonicSteps:7,chromaticSemitones:0})).toBe(p<=115?p+12:null);
    expect(transposePitch(p,root.value,mode,{diatonicSteps:-7,chromaticSemitones:0})).toBe(p>=12?p-12:null);
  }
});
it('sparse replacement, explicit zero, equal-to-base retention and scope composition', () => {
  const plan: OffsetPlan = {base:{diatonicSteps:2,chromaticSemitones:0},repetitions:[{index:0,offset:{diatonicSteps:0,chromaticSemitones:0}},{index:1,offset:{diatonicSteps:2,chromaticSemitones:0}}]};
  const sum = sumPlans([plan,{base:{diatonicSteps:0,chromaticSemitones:12},repetitions:[]}]);
  expect(sum.repetitions).toHaveLength(2);
  expect(offsetAt(sum,0)).toEqual({diatonicSteps:0,chromaticSemitones:12});
  expect(offsetAt(sum,999999)).toEqual({diatonicSteps:2,chromaticSemitones:12});
  sum.base.diatonicSteps=5;
  expect(offsetAt(sum,1).diatonicSteps).toBe(2);
});
it('strict values and sorted unique indices', () => {
  for (const amount of [true,NaN,Infinity,1.5,128,-128,'1']) expect(() => validateOffsetPlan({base:{diatonicSteps:amount,chromaticSemitones:0},repetitions:[]})).toThrow();
  for (const indices of [[1,1],[2,1],[-1],[40320000001]]) expect(() => validateOffsetPlan({base:{diatonicSteps:0,chromaticSemitones:0},repetitions:indices.map(index=>({index,offset:{diatonicSteps:0,chromaticSemitones:0}}))})).toThrow();
});
