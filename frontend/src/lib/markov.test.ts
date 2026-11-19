import { describe, expect, it } from "vitest";
import {
  durationLabel,
  durationStates,
  editableRow,
  generateMarkov,
  initialChain,
  learnChain,
  phraseLengths,
  redistribute,
  replaceRow,
} from "./markov";
import { patternVocabulary, writeMarkovPattern, scalePitches } from "./markovPattern";
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
    expect(redistribute([100, 0, 0], 0, 10)).toEqual([10, 45, 45]);
    expect(redistribute([0, 100], 0, 10)).toEqual([10, 90]);
    expect(redistribute([100], 0, 10)).toEqual([100]);
  });
  it("handles long scores iteratively", () => {
    const r = { ...recipe(32768, 32768), rhythm: [[100], [100]] };
    expect(generateMarkov(32768, [8], r)).toHaveLength(4096);
  });
  it("preserves other pitch edits and the hidden Rest when editing a drum row with exact spacing", () => {
    const full = [
      [80, 0, 20],
      [0, 100, 0],
      [30, 40, 30],
      [0, 75, 25],
    ];
    const edited = replaceRow(full, 2, [20, 80], true); // Start in the two-hit graph
    expect(edited[3]).toEqual([15, 60, 25]);
    expect(edited[0]).toBe(full[0]);
    expect(edited[2]).toBe(full[2]);
    expect(replaceRow(full, 0, [25, 75], true)[0]).toEqual([20, 60, 20]);
  });
  it("checks Score capacity before expanding a short native-tick phrase across a long score", () => {
    const r = { ...recipe(1, 1), pitch: [[100], [100]], rhythm: [[100], [100]], maxNotes: 10000, restState: -1 };
    expect(() => generateMarkov(160000000, [1], r)).toThrow("capacity");
    expect(() => generateMarkov(160000000, [1], { ...r, restState: 0 })).toThrow("searchLimit");
  });
});
const timing = defaultSequencerTiming();

describe("source pattern filters", () => {
  it("learns conditional frequencies including Start, zero edges and the loop seam", () => {
    const keys = ["C", "D", "E", "rest"];
    const chain = learnChain(keys, [["C"], ["D"], ["C"], ["D"], ["C"], ["E"], ["D"]]);
    const rows = chain.map((row) => editableRow(row, keys.length));
    expect(rows[0][1]).toBeCloseTo(200 / 3);
    expect(rows[0][2]).toBeCloseTo(100 / 3);
    expect(rows[1]).toEqual([100, 0, 0, 0]);
    expect(rows[2]).toEqual([0, 100, 0, 0]);
    expect(rows[3][0]).toBeCloseTo(300 / 7);
    expect(rows[4]).toEqual([100, 0, 0, 0]);
    const solo = learnChain([7], [[7]]);
    expect(solo.map((row) => editableRow(row, 1))).toEqual([[100], [100]]);
  });

  it("shares sparse rows for a score with thousands of simultaneous distinct note lengths", () => {
    const keys = Array.from({ length: 10000 }, (_, i) => i + 1);
    const chain = learnChain(keys, [keys.slice(0, 5000), keys.slice(5000)]);
    expect(chain[0]).toBe(chain[4999]);
    expect(chain[5000]).toBe(chain[10000]);
    expect(editableRow(chain[5000], keys.length)[0]).toBeCloseTo(100 / 5000);
    const voices = keys.slice(0, 2500);
    const mixed = learnChain(keys, [voices, keys.slice(2500, 5000), voices, keys.slice(5000)]);
    const row = editableRow(mixed[0], keys.length);
    expect(row[0]).toBe(0);
    expect(row[2500]).toBeCloseTo(100 / 7500, 8);
    expect(row[9999]).toBeCloseTo(100 / 7500, 8);
  });

  it("reads exact chord pitches and attack lengths including HOLDs only inside the melodic pad", () => {
    const pad = defaultSequencerTrack(1, 1, timing).pads[0];
    const cell = { note: null, hold: false, chord: "none" as const, velocity: 100 };
    pad.lengthBeats = 1;
    pad.steps = [
      { ...cell, note: 72, chord: "maj" },
      { ...cell, hold: true },
      { ...cell, hold: true },
      { ...cell, note: 49, hold: true },
      { ...cell, note: 100 },
    ];
    const source = patternVocabulary({ source: "sequencer", payload: pad }, timing);
    expect(source.pitches).toEqual([49, 72, 76, 79]);
    expect(source.durations).toEqual([1, 3]);
    expect(source.pitchEvents).toEqual([[72, 76, 79], [49]]);
    expect(source.durationEvents).toEqual([[3], [1]]);
  });

  it("reads native Score ticks and preserves sub-step lengths exactly", () => {
    const pad = defaultScoreTrack(1, timing).pads[0];
    pad.lengthBeats = 1;
    pad.notes = [
      { id: "a", pitch: 91, startTicks: 0, durationTicks: 1680, velocity: 91 },
      { id: "b", pitch: 48, startTicks: 1000, durationTicks: 3360, velocity: 82 },
      { id: "hidden", pitch: 40, startTicks: 20160, durationTicks: 9, velocity: 75 },
    ];
    const material = patternVocabulary({ source: "score", payload: pad }, timing);
    expect(material.pitches).toEqual([48, 91]);
    expect(material.durations.map((n) => durationLabel(n, material.unitsPerStep))).toEqual(["1/3", "2/3"]);
  });

  it("groups unordered simultaneous Score notes and counts a wrapping silence once", () => {
    const pad = defaultScoreTrack(1, timing).pads[0];
    pad.lengthBeats = 1;
    pad.notes = [
      { id: "b", pitch: 67, startTicks: 1000, durationTicks: 500, velocity: 90 },
      { id: "c", pitch: 62, startTicks: 2000, durationTicks: 750, velocity: 90 },
      { id: "a", pitch: 60, startTicks: 1000, durationTicks: 1000, velocity: 90 },
      { id: "silent", pitch: 77, startTicks: 5000, durationTicks: 200, velocity: 0 },
    ];
    const m = patternVocabulary({ source: "score", payload: pad }, timing);
    expect(m.pitchEvents).toEqual([["rest"], [60, 67], [62]]);
    expect(m.durationEvents).toEqual([[500, 1000], [750]]);
    const keys = [...m.pitches, "rest"];
    const rows = learnChain(keys, m.pitchEvents).map((r) => editableRow(r, keys.length));
    expect(rows).toEqual([
      [0, 100, 0, 0],
      [0, 0, 0, 100],
      [0, 100, 0, 0],
      [50, 0, 50, 0],
      [0, 0, 0, 100],
    ]);
    const rhythm = learnChain(m.durations, m.durationEvents).map((r) => editableRow(r, 3));
    expect(rhythm).toEqual([
      [0, 100, 0],
      [50, 0, 50],
      [0, 100, 0],
      [50, 0, 50],
    ]);
  });

  it("measures drum hit spacings around the loop and uses only the participating rows", () => {
    const pad = defaultDrummerSequencerTrack(1, 1, timing).pads[0];
    pad.lengthBeats = 2;
    pad.rows.forEach((r) =>
      r.steps.forEach((step) => {
        step.active = false;
      }),
    );
    const [kick, hat, other] = pad.rows;
    for (const [row, i] of [
      [kick, 2],
      [hat, 2],
      [hat, 5],
      [other, 1],
      [kick, 9],
    ] as const)
      row.steps[i].active = true;
    const source = patternVocabulary({ source: "drummer", payload: pad }, timing, [kick.rowId, hat.rowId]);
    expect([...source.drumRows]).toEqual([kick.rowId, hat.rowId]);
    expect(source.combinations).toEqual([[kick.rowId, hat.rowId]]);
    expect(source.durations).toEqual([3, 5]);
    expect(source.durationEvents).toEqual([[3], [5]]);
    expect(source.pitchEvents).toEqual([
      [JSON.stringify([kick.rowId, hat.rowId].sort())],
      [JSON.stringify([hat.rowId])],
    ]);
  });
});
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
