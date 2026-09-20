import { describe, expect, it } from "vitest";
import type { PadLoopPatternItem, PadLoopPatternState } from "../types";
import { arrangementSpans } from "./arrangementEditing";
import { copyArrangementRange, placeArrangementRange, resolveArrangementRange, type RangeLane } from "./arrangementRange";
import { sequencerTransportSubunitsPerBeat } from "./sequencer";

const beat = sequencerTransportSubunitsPerBeat();
const pad = (padIndex = 0): PadLoopPatternItem => ({ type: "pad", padIndex });
const rest = (lengthBeats: 1 | 2 | 4 | 8 | 16): PadLoopPatternItem => ({ type: "pause", lengthBeats });
const pattern = (rootSequence: PadLoopPatternItem[]): PadLoopPatternState => ({ rootSequence, groups: [], superGroups: [] });
const lane = (id: string, items: PadLoopPatternItem[], beatSubunits = beat): RangeLane => ({ id, kind: "sequencer", pattern: pattern(items), padBeats: [8, 8, 4, 2, 1, 3, 7, 6], beatSubunits });
const range = (start: number, end: number, laneIds = ["a", "b"]) => ({ startSubunit: start * beat, endSubunit: end * beat, laneIds });
const musicalStarts = (value: PadLoopPatternState, source: RangeLane) => arrangementSpans(value, source.padBeats).filter(s => s.item.type !== "pause").map(s => s.start * source.beatSubunits / beat);

describe("multitrack range editing", () => {
  it("duplicates the first 16 beats on all lanes as A–A–B without changing definitions", () => {
    const lanes = [lane("a", [pad(), pad(), pad(1), pad(1)]), lane("b", [pad(2), rest(4), pad(), pad(1), pad(1)])];
    const original = structuredClone(lanes);
    const copy = copyArrangementRange(lanes, range(0, 16));
    const changes = placeArrangementRange(lanes, copy, 16 * beat, "insert-all");
    expect(changes[0].rootSequence).toEqual([pad(), pad(), pad(), pad(), pad(1), pad(1)]);
    expect(changes[1].rootSequence).toEqual([pad(2), rest(4), pad(), pad(2), rest(4), pad(), pad(1), pad(1)]);
    expect(lanes).toEqual(original);
    expect(musicalStarts({ ...lanes[0].pattern, rootSequence: changes[0].rootSequence }, lanes[0])).toEqual([0, 8, 16, 24, 32, 40]);
  });
  it("distinguishes overwrite, selected-lane insertion and all-lane insertion", () => {
    const lanes = [lane("a", [pad(), pad(1), pad(2)]), lane("b", [pad(), pad(1), pad(2)]), lane("empty", [])];
    const copy = copyArrangementRange(lanes, range(0, 8, ["a"]));
    expect(placeArrangementRange(lanes, copy, 8 * beat, "overwrite")).toEqual([{ id: "a", kind: "sequencer", rootSequence: [pad(), pad(), pad(2)] }]);
    expect(placeArrangementRange(lanes, copy, 8 * beat, "insert-selected")).toEqual([{ id: "a", kind: "sequencer", rootSequence: [pad(), pad(), pad(1), pad(2)] }]);
    const changes = placeArrangementRange(lanes, copy, 8 * beat, "insert-all");
    expect(changes.map(c => c.id)).toEqual(["a", "b"]);
    expect(changes[1].rootSequence).toEqual([pad(), rest(8), pad(1), pad(2)]);
  });
  it("copies leading, internal and trailing silence, including implicit silence on short lanes", () => {
    const lanes = [lane("a", [rest(2), pad(3), rest(4)]), lane("b", [pad(3)])];
    const copy = copyArrangementRange(lanes, range(0, 8));
    expect(copy.lanes.map(c => c.rootSequence)).toEqual([[rest(2), pad(3), rest(4)], [pad(3), rest(4), rest(2)]]);
    const changes = placeArrangementRange(lanes, copy, 12 * beat, "overwrite");
    expect(changes[1].rootSequence).toEqual([pad(3), rest(8), rest(2), pad(3), rest(4), rest(2)]);
  });
  it("expands across staggered whole elements until all selected boundaries agree", () => {
    const lanes = [lane("a", [pad(), pad()]), lane("b", [pad(2), pad(), pad(2)])];
    expect(resolveArrangementRange(lanes, range(5, 9))).toEqual(range(0, 16));
    expect(resolveArrangementRange(lanes, range(5, 9, ["b"]))).toEqual(range(4, 12, ["b"]));
  });
  it("preserves whole group and supergroup references and splits only rests", () => {
    const a = lane("a", [{ type: "super", superGroupId: "I" }, rest(8)]);
    a.pattern.groups = [{ id: "A", sequence: [pad(2), pad(3)] }];
    a.pattern.superGroups = [{ id: "I", sequence: [{ type: "group", groupId: "A" }, rest(2)] }];
    const selected = resolveArrangementRange([a], range(2, 11, ["a"]));
    expect(selected).toEqual(range(0, 11, ["a"]));
    const copy = copyArrangementRange([a], selected);
    expect(copy.lanes[0].rootSequence).toEqual([{ type: "super", superGroupId: "I" }, rest(2), rest(1)]);
    const changes = placeArrangementRange([a], copy, 9 * beat, "insert-selected");
    expect(changes[0].rootSequence.slice(0, 3)).toEqual([{ type: "super", superGroupId: "I" }, rest(1), { type: "super", superGroupId: "I" }]);
  });
  it("uses exact integer subunits for rational beat ratios and common rest boundaries", () => {
    const lanes = [lane("a", [pad(5), pad(5)], beat * 2 / 3), lane("b", [pad(6), pad(6)], beat * 2 / 7)];
    const selection = resolveArrangementRange(lanes, range(0, 1));
    expect(selection).toEqual(range(0, 2));
    const changes = placeArrangementRange(lanes, copyArrangementRange(lanes, selection), 2 * beat, "insert-all");
    expect(changes.map(c => c.rootSequence.length)).toEqual([3, 3]);
    expect(() => placeArrangementRange(lanes, copyArrangementRange(lanes, selection), beat, "insert-all")).toThrow("timing");
  });
  it("rejects cutting either destination edge or an unselected lane during global insertion", () => {
    const lanes = [lane("a", [pad(2), pad(2), pad(2)]), lane("b", [pad(), pad()])];
    const copy = copyArrangementRange(lanes, range(0, 4, ["a"]));
    expect(() => placeArrangementRange(lanes, copy, 2 * beat, "overwrite")).toThrow("boundary");
    expect(() => placeArrangementRange(lanes, copy, 4 * beat, "insert-all")).toThrow("boundary");
    expect(placeArrangementRange(lanes, copy, 4 * beat, "insert-selected")).toHaveLength(1);
    const short = copyArrangementRange([lane("a", [pad(3)])], range(0, 2, ["a"]));
    const target = lane("a", [pad(), pad()]);
    expect(() => placeArrangementRange([target], short, 0, "overwrite")).toThrow("boundary");
  });
  it("rejects missing lanes, changed definitions and sequence overflow without mutation", () => {
    const lanes = [lane("a", [pad()]), lane("b", Array.from({ length: 256 }, () => pad()))];
    const copy = copyArrangementRange(lanes, range(0, 8));
    expect(() => placeArrangementRange(lanes, copy, 0, "insert-all")).toThrow("limit");
    expect(lanes[0].pattern.rootSequence).toEqual([pad()]);
    expect(() => placeArrangementRange(lanes.slice(0, 1), copy, 0, "overwrite")).toThrow("missing");
    lanes[0].padBeats[0] = 4;
    expect(() => placeArrangementRange(lanes, copy, 0, "overwrite")).toThrow("changed");
  });
  it("copies a rest-only interval and handles overlapping source and destination from a snapshot", () => {
    const a = lane("a", [rest(16), pad(), pad(1)]);
    const copy = copyArrangementRange([a], range(8, 24, ["a"]));
    expect(placeArrangementRange([a], copy, 16 * beat, "overwrite")[0].rootSequence).toEqual([rest(16), rest(8), pad()]);
    const silence = copyArrangementRange([a], range(4, 8, ["a"]));
    expect(placeArrangementRange([a], silence, 0, "insert-all")[0].rootSequence).toEqual([rest(16), rest(4), pad(), pad(1)]);
  });
});
