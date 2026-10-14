import { describe, expect, it } from "vitest";
import { pianoRollChordNotes } from "./pianoRollChord";
import type { SequencerMode } from "../types";

const major = [{ scaleRoot: "C", mode: "ionian" }] as const;
describe("piano roll scale chords", () => {
  it.each([3, 4, 5] as const)("includes the base in a %i-note chord", size => {
    expect(pianoRollChordNotes(60, size, major)).toEqual([60, 64, 67, 71, 74].slice(0, size));
  });
  it.each<[SequencerMode, number[]]>([
    ["ionian", [60, 64, 67, 71, 74]], ["dorian", [60, 63, 67, 70, 74]],
    ["phrygian", [60, 63, 67, 70, 73]], ["lydian", [60, 64, 67, 71, 74]],
    ["mixolydian", [60, 64, 67, 70, 74]], ["aeolian", [60, 63, 67, 70, 74]],
    ["locrian", [60, 63, 66, 70, 73]]
  ])("uses %s scale thirds", (mode, expected) => {
    expect(pianoRollChordNotes(60, 5, [{ scaleRoot: "C", mode }])).toEqual(expected);
  });
  it("builds from non-tonic and accidental roots across octaves", () => {
    expect(pianoRollChordNotes(71, 5, major)).toEqual([71, 74, 77, 81, 84]);
    expect(pianoRollChordNotes(66, 4, [{ scaleRoot: "D", mode: "ionian" }])).toEqual([66, 69, 73, 76]);
    expect(pianoRollChordNotes(61, 3, [{ scaleRoot: "Db", mode: "ionian" }])).toEqual([61, 65, 68]);
  });
  it("stacks common notes in mixed scales and ignores theory order and duplicates", () => {
    const mixed = [...major, { scaleRoot: "G", mode: "ionian" }] as const;
    expect(pianoRollChordNotes(60, 5, mixed)).toEqual([60, 64, 69, 72, 76]);
    expect(pianoRollChordNotes(60, 5, [...mixed].reverse())).toEqual([60, 64, 69, 72, 76]);
    expect(pianoRollChordNotes(60, 5, [...mixed, ...mixed])).toEqual([60, 64, 69, 72, 76]);
    expect(pianoRollChordNotes(65, 3, mixed)).toEqual([65]);
  });
  it("handles a sparse or empty intersection without inventing pitches", () => {
    const sparse = [...major, { scaleRoot: "F#", mode: "ionian" }] as const; // B and F only
    expect(pianoRollChordNotes(65, 5, sparse)).toEqual([65, 77, 89, 101, 113]);
    const onePitch = [...sparse, { scaleRoot: "C#", mode: "ionian" }] as const;
    expect(pianoRollChordNotes(65, 3, onePitch)).toEqual([65, 89, 113]);
    expect(pianoRollChordNotes(65, 3, [...onePitch, { scaleRoot: "G", mode: "ionian" }])).toEqual([65]);
    expect(pianoRollChordNotes(60, 3, [])).toEqual([60]);
  });
  it("keeps out-of-scale keys single and stops at the MIDI ceiling, not the visible keyboard", () => {
    expect(pianoRollChordNotes(61, 5, major)).toEqual([61]);
    expect(pianoRollChordNotes(107, 5, major)).toEqual([107, 110, 113, 117, 120]);
    expect(pianoRollChordNotes(120, 5, major)).toEqual([120, 124, 127]);
    expect(pianoRollChordNotes(127, 5, major)).toEqual([127]);
    expect(pianoRollChordNotes(128, 3, major)).toEqual([]);
  });
});
