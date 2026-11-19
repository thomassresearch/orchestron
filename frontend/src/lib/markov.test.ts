import { describe, expect, it } from "vitest";
import { durationStates, generateMarkov, initialChain, phraseLengths, redistribute } from "./markov";
import { writeMarkovPattern, scalePitches } from "./markovPattern";
import {
  defaultSequencerTrack,
  defaultDrummerSequencerTrack,
  defaultSequencerTiming,
} from "../store/appStoreModel";
import { defaultScoreTrack } from "./scoreSequencer";

const recipe = (pitchLength: number, rhythmLength: number) => ({
  pitchLength,
  rhythmLength,
  seed: 123,
  pitch: initialChain(5, "pitch"),
  rhythm: initialChain(3, "rhythm"),
});

describe("independent Markov phrases", () => {
  it.each([
    [16, 8, 4],
    [16, 4, 8],
    [12, 6, 4],
    [15, 5, 3],
    [1, 1, 1],
  ])("fills %i steps with %i-step pitches and %i-step rhythms", (steps, p, r) => {
    const take = generateMarkov(steps, [1, 2, 4], recipe(p, r));
    expect(take).toEqual(generateMarkov(steps, [1, 2, 4], recipe(p, r)));
    expect(take[take.length - 1].start + take[take.length - 1].length).toBe(steps);
    const window = (pos: number, length: number) => take.filter((e) => e.start >= pos && e.start < pos + length);
    for (let pos = 0; pos < steps; pos += p)
      expect(window(pos, p).map((e) => e.state)).toEqual(window(0, p).map((e) => e.state));
    for (let pos = 0; pos < steps; pos += r)
      expect(window(pos, r).map((e) => [e.length, e.state === 4])).toEqual(
        window(0, r).map((e) => [e.length, e.state === 4]),
      );
  });
  it("honours deterministic edges and rejects forbidden loop seams and impossible exact fills", () => {
    const r = {
      ...recipe(4, 4),
      pitch: [
        [0, 100, 0],
        [100, 0, 0],
        [0, 0, 100],
        [100, 0, 0],
      ],
      rhythm: [[100], [100]],
    };
    expect(generateMarkov(8, [1], r).map((e) => e.state)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(() => generateMarkov(3, [1], { ...r, pitchLength: 3, rhythmLength: 3 })).toThrow("pitchPath");
    expect(() => generateMarkov(4, [3], r)).toThrow("rhythmPath");
  });
  it("accepts triplet durations, integer divisors and reversible proportional edits", () => {
    expect(phraseLengths(15)).toEqual([15, 5, 3, 1]);
    expect(durationStates(3, 9)).toContain(3);
    expect(redistribute([50, 30, 20], 0, 80)).toEqual([80, 12, 8]);
    expect(redistribute([50, 30, 20], 0, 100)).toEqual([100, 0, 0]);
    expect(redistribute([100, 0], 0, 10)).toEqual([100, 0]);
  });
  it("handles long scores iteratively", () => {
    const r = { ...recipe(32768, 32768), rhythm: [[100], [100]] };
    expect(generateMarkov(32768, [8], r)).toHaveLength(4096);
  });
});
const timing = defaultSequencerTiming();
const notes = [
  { start: 0, length: 2, state: 0, durationState: 1 },
  { start: 2, length: 2, state: 1, durationState: 1 },
];
it("writes a native melodic attack, HOLD and rest and keeps hidden steps", () => {
  const pad = defaultSequencerTrack(1, 1, timing).pads[0],
    pitches = scalePitches({ ...pad, scaleRoot: "D", mode: "dorian" }, 4);
  expect(pitches).toEqual([62, 64, 65, 67, 69, 71, 72, 74]);
  const result = writeMarkovPattern({ source: "sequencer", payload: pad }, timing, notes, [62], []);
  if (result.source !== "sequencer") throw Error();
  expect(result.payload.steps.slice(0, 4).map((s) => [s.note, s.hold])).toEqual([
    [62, false],
    [null, true],
    [null, false],
    [null, false],
  ]);
  expect(result.payload.steps.slice(pad.stepCount)).toEqual(pad.steps.slice(pad.stepCount));
});
it("preserves hidden score notes and crossing tails with exact meter-relative grid ticks", () => {
  const t = { ...timing, meterDenominator: 8 as const, stepsPerBeat: 3 as const };
  const pad = {
    ...defaultScoreTrack(1, t).pads[0],
    lengthBeats: 1,
    notes: [
      { id: "tail", pitch: 55, startTicks: 10000, durationTicks: 100, velocity: 70 },
      { id: "later", pitch: 44, startTicks: 15000, durationTicks: 300, velocity: 85 },
    ],
  };
  const result = writeMarkovPattern(
    { source: "score", payload: pad },
    t,
    notes.slice(0, 1),
    [64],
    [],
    () => "new",
  );
  if (result.source !== "score") throw Error();
  expect(result.payload.notes.map((n) => [n.id, n.startTicks, n.durationTicks])).toEqual([
    ["new", 0, 6720],
    ["tail", 10080, 20],
    ["later", 15000, 300],
  ]);
});
it("layers hits and keeps nonparticipating rows intact", () => {
  const track = defaultDrummerSequencerTrack(1, 1, timing),
    pad = track.pads[0];
  const result = writeMarkovPattern(
    { source: "drummer", payload: pad },
    timing,
    notes,
    [],
    [pad.rows.slice(0, 2).map((r) => r.rowId)],
  );
  if (result.source !== "drummer") throw Error();
  expect(
    result.payload.rows.slice(0, 2).every((r) => r.steps[0].active && !r.steps[1].active && !r.steps[2].active),
  ).toBe(true);
  expect(result.payload.rows[2]).toBe(pad.rows[2]);
});

it("reports a score boundary that cannot store a hidden tail", () => {
  const end = 8192 * 20160;
  const pad = {
    ...defaultScoreTrack(1, timing).pads[0],
    lengthBeats: 8192,
    notes: [{ id: "tail", startTicks: end - 1, durationTicks: 2, pitch: 60, velocity: 100 }],
  };
  expect(() => writeMarkovPattern({ source: "score", payload: pad }, timing, [], [], [])).toThrow("scoreRange");
});
