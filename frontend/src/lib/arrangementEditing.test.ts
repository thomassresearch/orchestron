import { describe, expect, it } from "vitest";
import { restTokens, arrangementSpans, createDefinition, deleteDefinition, definitionUses, firstUnusedPad, moveArrangementItems, placeArrangementItems, removeArrangementItems, resolveArrangementDrop, groupArrangementSelection, validateArrangementEdit } from "./arrangementEditing";
import { compilePadLoopPattern, normalizePadLoopPatternState, ungroupPadLoopItemsInContainer } from "./padLoopPattern";
import type { PadLoopPatternItem, PadLoopPatternState } from "../types";
const pad = (padIndex = 0): PadLoopPatternItem => ({ type: "pad", padIndex });
const rest = (lengthBeats: 1 | 2 | 4 | 8 | 16): PadLoopPatternItem => ({ type: "pause", lengthBeats });
const pattern = (rootSequence: PadLoopPatternItem[] = []): PadLoopPatternState => ({ rootSequence, groups: [], superGroups: [] });
const durations = [4, 2, 8, 4, 4, 4, 4, 4];

describe("arrangement occurrences and reusable definitions", () => {
  it("resolves boundary insertion, silence placement and tail gaps using the same edit as the preview", () => {
    const value = pattern([pad(), pad(1), rest(8), pad(2)]);
    const inserted = resolveArrangementDrop(value, [pad(1)], 4.05, durations, 72);
    expect(inserted).toMatchObject({ position: 4, duration: 2, insert: true });
    expect(arrangementSpans(inserted.pattern, durations).filter(s => s.item.type !== "pause").map(s => s.start)).toEqual([0, 4, 6, 16]);
    const moved = resolveArrangementDrop(value, [pad()], 4, durations, 72, [0]);
    expect(moved.pattern.rootSequence[0]).toEqual(rest(4));
    expect(arrangementSpans(moved.pattern, durations).filter(s => s.item.type !== "pause").map(s => s.start)).toEqual([4, 8, 18]);
    expect(resolveArrangementDrop(value, [pad()], 0, durations, 72, [0]).pattern).toBe(value);
    expect(() => resolveArrangementDrop(value, [pad()], 2, durations, 72)).toThrow("Occupied destination");
    expect(resolveArrangementDrop(value, [pad()], 8, durations, 72).pattern.rootSequence).toEqual([pad(), pad(1), rest(2), pad(), rest(2), pad(2)]);
    const tail = resolveArrangementDrop(value, [pad()], 25, durations, 72);
    expect(tail.pattern.rootSequence.slice(-3)).toEqual([rest(2), rest(1), pad()]);
    expect(() => resolveArrangementDrop(value, [rest(1)], 9, durations, 72)).toThrow();
    expect(() => resolveArrangementDrop(value, [pad(), pad(2)], 25, durations, 72, [0, 3])).toThrow();
  });
  it("regroups into new or existing definitions atomically and permits mixed supergroup contents", () => {
    const value = { ...pattern([pad(), rest(2), { type: "group" as const, groupId: "A" }]), groups: [{ id: "A", sequence: [pad(1)] }] };
    const updated = groupArrangementSelection(value, [0, 1], "group", "A");
    expect(updated.pattern.rootSequence).toEqual([{ type: "group", groupId: "A" }, { type: "group", groupId: "A" }]);
    expect(compilePadLoopPattern(updated.pattern).sequence).toEqual([0, -2, 0, -2]);
    const created = groupArrangementSelection(value, [0, 1], "group");
    expect(created.ref.id).toBe("B");
    expect(created.pattern.groups[0]).toEqual(value.groups[0]);
    expect(groupArrangementSelection(value, [0, 1, 2], "super").pattern.superGroups[0].sequence).toEqual(value.rootSequence);
    expect(() => groupArrangementSelection(value, [0, 2], "super")).toThrow();
    expect(() => groupArrangementSelection(value, [0, 1, 2], "group")).toThrow();
  });
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

it.each(["pad", "group", "super", "selection"])("moves %s symmetrically through its vacated span and adjacent rests", kind => {
  const items: PadLoopPatternItem[] = kind === "pad" ? [pad()]
    : kind === "group" ? [{ type: "group", groupId: "A" }]
    : kind === "super" ? [{ type: "super", superGroupId: "I" }] : [pad(), pad(1)];
  const length = kind === "selection" ? 6 : 4;
  const value: PadLoopPatternState = { rootSequence: [rest(8), ...items, rest(8), pad(2)],
    groups: [{ id: "A", sequence: [pad()] }], superGroups: [{ id: "I", sequence: [{ type: "group", groupId: "A" }] }] };
  const original = structuredClone(value);
  const indexes = items.map((_, i) => i + 1);
  for (const position of [7, 9, 13, 16]) {
    const moved = resolveArrangementDrop(value, items, position, durations, 72, indexes);
    expect(moved.insert).toBe(false);
    const spans = arrangementSpans(moved.pattern, durations);
    expect(spans.filter(s => s.item.type !== "pause").map(s => s.start)).toEqual(
      kind === "selection" ? [position, position + 4, 16 + length] : [position, 16 + length]);
    expect(spans[0]).toMatchObject({ start: 0, duration: position, item: { type: "pause" } });
    if (position < 16) expect(spans[spans.length - 2]).toMatchObject({ start: position + length, duration: 16 - position, item: { type: "pause" } });
  }
  expect(() => resolveArrangementDrop(value, items, 17, durations, 72, indexes)).toThrow("Occupied destination");
  expect(value).toEqual(original);
});

it("retains a 32-beat rest as one item when filling or removing a long pattern", () => {
  expect(restTokens(32)).toEqual([{type:"pause",lengthBeats:32}]);
});
