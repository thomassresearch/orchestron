import { describe, expect, it } from "vitest";
import cases from "../../../backend/tests/fixtures/sequencers/timing_migration.json";
import { migrateSequencerTiming } from "./sequencerTimingMigration";
import { DEFAULT_SEQUENCER_TIMING_CONFIG as base, SEQUENCER_STEPS_PER_BEAT_OPTIONS as grids, SEQUENCER_BEAT_RATE_OPTIONS as ratios, sequencerTransportSubunitsPerLocalStep, sequencerTransportSubunitCount, timingOffsetMilliseconds } from "./sequencer";
import { sequencerBeatGroups, subdivisionLabel, timingSummary } from "./sequencerTimingPresentation";
import { normalizeArpeggiatorSettings, normalizeSequencerState, updateSequencerTrackTimingState, updateControllerSequencerTimingState } from "../store/appStoreModel";
import { arrangerTransportExtent } from "./arrangerTransport";
import type { SequencerMeterDenominator } from "../types";

describe("meter timing", () => {
  for (const test of cases) it(`migrates ${test.name} identically to backend and CLI`, () => {
    const before = structuredClone(test.input);
    const actual = migrateSequencerTiming(before, test.appState);
    expect(before).toEqual(test.input);
    expect(actual).toEqual(test.expected);
    expect(migrateSequencerTiming(actual, test.appState)).toBe(actual);
  });
  for (const grid of grids) for (const denominator of [4,8] as SequencerMeterDenominator[]) for (const ratio of ratios) {
    it(`has exact boundaries: ${grid} per /${denominator} at ${ratio.label}`, () => {
      const timing = { ...base, stepsPerBeat: grid, meterDenominator: denominator, beatRateNumerator: ratio.numerator, beatRateDenominator: ratio.denominator };
      const step = sequencerTransportSubunitsPerLocalStep(timing);
      expect(Number.isInteger(step)).toBe(true);
      expect(step * grid * 5).toBe(sequencerTransportSubunitCount(timing, 5));
      expect(step * grid * 5 * 100000).toBe(sequencerTransportSubunitCount(timing, 5) * 100000);
    });
  }
  it("groups triplets and partial bars without adding steps", () => {
    const timing = { ...base, stepsPerBeat: 3 as const };
    expect(sequencerBeatGroups(timing, 12).map(g => g.count)).toEqual([3,3,3,3]);
    expect(sequencerBeatGroups(timing, 15).map(g => [g.bar,g.beat])).toEqual([[1,1],[1,2],[1,3],[1,4],[2,1]]);
    expect(sequencerBeatGroups(timing, 14)[4]?.count).toBe(2);
    expect(subdivisionLabel(3, 4, "english")).toContain("Eighth");
    expect(subdivisionLabel(3, 8, "english")).toContain("Sixteenth");
    expect(timingSummary(timing, 4, "english")).toContain("12 steps");
    expect(timingSummary({...timing, beatRateNumerator:2},4,"english")).toContain("2 quarter-note song beats");
    expect(timingOffsetMilliseconds(50, {...timing,meterDenominator:8})).toBeCloseTo(1000/24);
  });
  it("keeps indexed notes and hidden content through subdivision and meter changes", () => {
    const track = normalizeSequencerState({ tracks:[{id:"lead",lengthBeats:4,pads:[{lengthBeats:4,steps:Array.from({length:128},(_,i)=>({note:60+i%12,velocity:93,hold:i===13,timingOffsetPercent:17}))}]}] }).tracks[0];
    const triplets = updateSequencerTrackTimingState(track,{stepsPerBeat:3});
    expect(triplets.pads[0].stepCount).toBe(12);
    expect(triplets.pads[0].steps).toEqual(track.pads[0].steps);
    const restored = updateSequencerTrackTimingState(triplets,{stepsPerBeat:4,meterNumerator:6,meterDenominator:8});
    expect(restored.pads[0].lengthBeats).toBe(4);
    expect(restored.pads[0].steps).toEqual(track.pads[0].steps);
  });
  it("preserves normalized curves and rejects subdivisions exceeding capacity on any pad", () => {
    const track = normalizeSequencerState({controllerSequencers:[{id:"cc",timing:{...base,stepsPerBeat:4},pads:[{lengthBeats:32,keypoints:[{id:"start",position:0,value:0},{id:"mid",position:.37,value:90},{id:"end",position:1,value:0}]}]}]}).controllerSequencers[0];
    expect(updateControllerSequencerTimingState(track,{stepsPerBeat:8})).toBe(track);
    expect(updateControllerSequencerTimingState(track,{stepsPerBeat:3}).pads[0].keypoints).toEqual(track.pads[0].keypoints);
  });
  it("counts pads and rests in eighth-note beats in the arranger", () => {
    const state = normalizeSequencerState({ tracks:[{id:"six",timing:{...base,meterNumerator:6,meterDenominator:8},lengthBeats:6,pads:[{lengthBeats:6}],padLoopEnabled:true,padLoopSequence:[0,-2]}] });
    expect(arrangerTransportExtent(state)).toBe(32);
  });
});

it("keeps arpeggiator durations and legacy normalization independent of sequencer length extensions", () => {
  expect(normalizeArpeggiatorSettings({lengthBeats:16}).lengthBeats).toBe(16);
  expect(normalizeArpeggiatorSettings({lengthBeats:32}).lengthBeats).toBe(8);
  expect(normalizeArpeggiatorSettings({lengthBeats:9}).lengthBeats).toBe(4);
});
