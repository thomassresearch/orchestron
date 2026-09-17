import { describe, expect, it } from "vitest";
import { arrangementSpans, createDefinition, deleteDefinition, definitionUses, firstUnusedPad, moveArrangementItems, placeArrangementItems, removeArrangementItems, validateArrangementEdit } from "./arrangementEditing";
import { compilePadLoopPattern, normalizePadLoopPatternState, ungroupPadLoopItemsInContainer } from "./padLoopPattern";
import type { PadLoopPatternItem, PadLoopPatternState } from "../types";
const pad = (padIndex = 0): PadLoopPatternItem => ({ type: "pad", padIndex });
const rest = (lengthBeats: 1 | 2 | 4 | 8 | 16): PadLoopPatternItem => ({ type: "pause", lengthBeats });
const pattern = (rootSequence: PadLoopPatternItem[] = []): PadLoopPatternState => ({ rootSequence, groups: [], superGroups: [] });
const durations = [4, 2, 8, 4, 4, 4, 4, 4];

describe("arrangement occurrences and reusable definitions", () => {
  it("retains unused and empty definitions and direct supergroup rests", () => {
    const value: PadLoopPatternState = { rootSequence: [{ type: "super", superGroupId: "I" }], groups: [{ id: "A", sequence: [] }, { id: "B", sequence: [pad(1)] }], superGroups: [{ id: "I", sequence: [rest(2), pad(), rest(4)] }, { id: "II", sequence: [] }] };
    expect(normalizePadLoopPatternState(value).pattern).toEqual(value);
    expect(compilePadLoopPattern(value).sequence).toEqual([-2, 0, -4]);
    expect(arrangementSpans(value, durations)[0].duration).toBe(10);
  });
  it("prevents emptying a referenced phrase and deleting a referenced library entry", () => {
    const value = { ...pattern([{ type: "group", groupId: "A" }]), groups: [{ id: "A", sequence: [pad()] }] };
    expect(definitionUses(value, { kind: "group", id: "A" })).toEqual(["Arrangement"]);
    expect(deleteDefinition(value, { kind: "group", id: "A" })).toBe(value);
    expect(() => validateArrangementEdit(value, { ...value, groups: [{ id: "A", sequence: [] }] })).toThrow();
    expect(createDefinition(pattern(), "group").pattern.groups).toHaveLength(1);
    expect(() => placeArrangementItems({ ...pattern(), groups: [{ id: "A", sequence: [] }] }, [{ type: "group", groupId: "A" }], 0, durations)).toThrow();
  });
  it("leaves duration on delete, aggregates rests and closes multiple gaps atomically", () => {
    const value = pattern([pad(), rest(2), pad(1), rest(8)]);
    const deleted = removeArrangementItems(value, [0, 2], item => item.type === "pad" ? durations[item.padIndex] : 0);
    expect(arrangementSpans(deleted, durations)).toMatchObject([{ start: 0, duration: 16, indexes: [0, 1, 2, 3] }]);
    expect(removeArrangementItems(value, [0, 2], () => 0, true).rootSequence).toEqual([rest(2), rest(8)]);
  });
  it("moves into silence without changing unselected positions and rejects collisions", () => {
    const value = pattern([pad(), pad(1), rest(8), pad(2)]);
    const moved = moveArrangementItems(value, [0], 8, durations);
    expect(arrangementSpans(moved, durations).filter(s => s.item.type !== "pause").map(s => s.start)).toEqual([4, 8, 14]);
    expect(() => moveArrangementItems(value, [0], 4, durations)).toThrow();
    expect(value.rootSequence).toEqual([pad(), pad(1), rest(8), pad(2)]);
    expect(() => placeArrangementItems(value, [pad()], 1, durations, true)).toThrow();
    expect(arrangementSpans(placeArrangementItems(value, [pad()], 4, durations, true), durations)[2].start).toBe(8);
  });
  it("rejects expanded limits without dropping notes", () => {
    const value = pattern(Array.from({ length: 256 }, () => pad()));
    expect(() => placeArrangementItems(value, [pad()], 1024, durations)).toThrow();
    expect(() => normalizePadLoopPatternState(pattern([...value.rootSequence, pad()]))).toThrow();
    expect(value.rootSequence).toHaveLength(256);
  });
  it("ungroups each occurrence in place and retains its library definition", () => {
    const value = { ...pattern([{ type: "group", groupId: "A" }, pad(2), { type: "group", groupId: "A" }]), groups: [{ id: "A", sequence: [pad(), rest(1)] }] };
    const next = ungroupPadLoopItemsInContainer(value, { kind: "root" }, [0, 2]);
    expect(next.rootSequence).toEqual([pad(), rest(1), pad(2), pad(), rest(1)]);
    expect(next.groups).toEqual(value.groups);
    expect(firstUnusedPad(value, Array(8).fill(true))).toBe(1);
  });
});
