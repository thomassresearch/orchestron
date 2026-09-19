import { expect, it } from "vitest";
import { arpeggiatorPadHasSound, controllerPadHasContent, applyWorkspaceDefinition, deleteWorkspaceDefinition, drummerPadHasSound, groupWorkspaceItems, melodicPadHasSound, moveWorkspaceItems, splitWorkspaceItems, validateWorkspace, workspacePlayingIndex } from "./patternWorkspace";
import { normalizeArpeggiatorSettings } from "../store/appStoreModel";
import { patternPadClass } from "./patternItemPresentation";
import { useAppStore } from "../store/useAppStore";
import type { PadLoopPatternItem, PadLoopPatternState } from "../types";
const pad = (padIndex: number): PadLoopPatternItem => ({ type: "pad", padIndex });
const empty = (): PadLoopPatternState => ({ rootSequence: [pad(7)], groups: [], superGroups: [] });

it("only highlights playable nonzero-velocity attacks, including MIDI note zero", () => {
  const track = structuredClone(useAppStore.getInitialState().sequencer.tracks[0]);
  const p = track.pads[0];
  p.steps.forEach(s => { s.note = null; s.hold = true; });
  expect(melodicPadHasSound(p)).toBe(false);
  p.steps[0].note = 0; p.steps[0].velocity = 0;
  expect(melodicPadHasSound(p)).toBe(false);
  p.steps[0].velocity = 1;
  expect(melodicPadHasSound(p)).toBe(true);
  p.steps[0].note = null;
  p.steps[1].note = 60; p.steps[1].velocity = 127; p.stepCount = 1;
  expect(melodicPadHasSound(p)).toBe(false);
  const drum = { lengthBeats: 1 as const, stepCount: 1, rows: [{ rowId: "kick", steps: [{ active: false, velocity: 127 }, { active: true, velocity: 127 }] }] };
  expect(drummerPadHasSound(drum)).toBe(false);
  drum.rows[0].steps[0] = { active: true, velocity: 0 };
  expect(drummerPadHasSound(drum)).toBe(false);
  drum.rows[0].steps[0].velocity = 1;
  expect(drummerPadHasSound(drum)).toBe(true);
  expect(patternPadClass(true, true, false)).not.toContain("bg-emerald");
  expect(patternPadClass(true, true, false)).toContain("ring-cyan");
  expect(patternPadClass(true, true, false)).toContain("outline-amber");
});

it("gathers separated selections and builds/splits supergroups without editing song order", () => {
  const original = empty();
  const grouped = groupWorkspaceItems(original, [pad(0), pad(1), pad(2), pad(3)], [2, 0], "group");
  expect(grouped.pattern.rootSequence).toEqual(original.rootSequence);
  expect(grouped.pattern.groups[0].sequence).toEqual([pad(0), pad(2)]);
  expect(grouped.items).toEqual([{ type: "group", groupId: "A" }, pad(1), pad(3)]);
  const supergroup = groupWorkspaceItems(grouped.pattern, grouped.items, [0, 2], "super");
  expect(supergroup.items).toEqual([{ type: "super", superGroupId: "I" }, pad(1)]);
  const split = splitWorkspaceItems(supergroup.pattern, supergroup.items, [0]);
  expect(split).toEqual([{ type: "group", groupId: "A" }, pad(3), pad(1)]);
  expect(splitWorkspaceItems(supergroup.pattern, split, [0])).toEqual([pad(0), pad(2), pad(3), pad(1)]);
  expect(supergroup.pattern.groups).toHaveLength(1);
  expect(supergroup.pattern.superGroups).toHaveLength(1);
});

it("moves selections together at insertion boundaries", () => {
  const items = [pad(0), pad(1), pad(2), pad(3)];
  expect(moveWorkspaceItems(items, [0, 2], 4)).toEqual([pad(1), pad(3), pad(0), pad(2)]);
  expect(moveWorkspaceItems(items, [2, 3], 0)).toEqual([pad(2), pad(3), pad(0), pad(1)]);
  expect(moveWorkspaceItems(items, [1, 2], 2)).toEqual(items);
});

it("allows an incomplete draft but rejects empty referenced definitions and over-limit commits", () => {
  const pattern: PadLoopPatternState = { rootSequence: [{ type: "group", groupId: "A" }], groups: [{ id: "A", sequence: [pad(0), pad(1)] }], superGroups: [] };
  const ref = { kind: "group" as const, id: "A" };
  expect(validateWorkspace(pattern, [], ref)).toEqual([]);
  expect(() => applyWorkspaceDefinition(pattern, ref, [])).toThrow();
  expect(() => validateWorkspace(pattern, Array.from({ length: 257 }, () => pad(0)))).toThrow();
  expect(() => validateWorkspace(pattern, [{ type: "group", groupId: "A" }], ref)).toThrow();
  const applied = applyWorkspaceDefinition(pattern, ref, [pad(2)]);
  expect(applied.groups[0].sequence).toEqual([pad(2)]);
  expect(pattern.groups[0].sequence).toEqual([pad(0), pad(1)]);
  expect(applied.rootSequence).toEqual(pattern.rootSequence);
});

it("updates content detection after pad copying and clearing", () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const store = useAppStore.getState();
  const id = store.sequencer.tracks[0].id;
  store.setSequencerTrackStepNote(id, 0, 60);
  store.copySequencerTrackPad(id, 0, 1);
  expect(melodicPadHasSound(useAppStore.getState().sequencer.tracks[0].pads[1])).toBe(true);
  store.selectSequencerEditingPad(id, 1);
  store.clearSequencerTrackSteps(id);
  expect(melodicPadHasSound(useAppStore.getState().sequencer.tracks[0].pads[1])).toBe(false);
  expect(melodicPadHasSound(useAppStore.getState().sequencer.tracks[0].pads[0])).toBe(true);
  store.addDrummerSequencerTrack();
  const drummer = useAppStore.getState().sequencer.drummerTracks[0];
  store.toggleDrummerSequencerCell(drummer.id, drummer.rows[0].id, 0, true);
  store.copyDrummerSequencerPad(drummer.id, 0, 1);
  expect(drummerPadHasSound(useAppStore.getState().sequencer.drummerTracks[0].pads[1])).toBe(true);
  store.selectSequencerEditingPad(drummer.id, 1);
  store.clearDrummerSequencerTrackSteps(drummer.id);
  expect(drummerPadHasSound(useAppStore.getState().sequencer.drummerTracks[0].pads[1])).toBe(false);
});

it("expands deleted definitions in every retained draft and remaps selections", () => {
  const pattern: PadLoopPatternState = { rootSequence: [], groups: [{ id: "A", sequence: [pad(0), pad(1)] }], superGroups: [{ id: "I", sequence: [pad(2)] }] };
  const ref = { type: "group" as const, groupId: "A" };
  const drafts = { free: { items: [pad(7), ref, pad(6), ref], selection: [1, 2] },
    "group:A": { items: [pad(4)], selection: [] }, "super:I": { items: [ref, pad(5)], selection: [1] } };
  const deleted = deleteWorkspaceDefinition(pattern, drafts, { kind: "group", id: "A" });
  expect(deleted.pattern.groups).toEqual([]);
  expect(deleted.drafts.free).toEqual({ items: [pad(7), pad(0), pad(1), pad(6), pad(0), pad(1)], selection: [1, 2, 3] });
  expect(deleted.drafts["super:I"]).toEqual({ items: [pad(0), pad(1), pad(5)], selection: [2] });
  expect(deleted.drafts["group:A"]).toBeUndefined();
  expect(pattern.groups).toHaveLength(1);
  expect(drafts.free.items).toHaveLength(4);
  expect(() => deleteWorkspaceDefinition({ ...pattern, rootSequence: [ref] }, drafts, { kind: "group", id: "A" })).toThrow(/saved material/);
  expect(() => deleteWorkspaceDefinition({ ...pattern, superGroups: [{ id: "I", sequence: [ref] }] }, drafts, { kind: "group", id: "A" })).toThrow(/saved material/);
});

it("deletes supergroups by expanding one level and highlights nested and repeated occurrences", () => {
  const pattern: PadLoopPatternState = { rootSequence: [], groups: [{ id: "A", sequence: [pad(0), pad(1)] }], superGroups: [{ id: "I", sequence: [{ type: "group", groupId: "A" }, pad(2)] }] };
  const items: PadLoopPatternItem[] = [pad(0), { type: "super", superGroupId: "I" }, { type: "group", groupId: "A" }];
  const status = { active: true, queued: null, workspace_gesture: "play", workspace_active: true, workspace_sequence: [0, 0, 1, 2, 0, 1], workspace_position: 2 };
  expect(workspacePlayingIndex(pattern, items, status, "play")).toBe(1);
  expect(workspacePlayingIndex(pattern, items, { ...status, workspace_position: 4 }, "play")).toBe(2);
  expect(workspacePlayingIndex(pattern, items, status, "other")).toBe(-1);
  expect(workspacePlayingIndex(pattern, items, { ...status, workspace_active: false }, "play")).toBe(-1);
  expect(workspacePlayingIndex(pattern, items, { ...status, workspace_position: 99 }, "play")).toBe(-1);
  const result = deleteWorkspaceDefinition(pattern, { free: { items, selection: [1] } }, { kind: "super", id: "I" });
  expect(result.pattern.groups).toEqual(pattern.groups);
  expect(result.pattern.superGroups).toEqual([]);
  expect(result.drafts.free).toEqual({ items: [pad(0), { type: "group", groupId: "A" }, pad(2), { type: "group", groupId: "A" }], selection: [1, 2] });
});


it("uses controller curve content and arpeggiator playable attacks for pad styling", () => {
  const cc = { lengthBeats: 4 as const, stepCount: 16, keypoints: [{ id: "a", position: 0, value: 0 }, { id: "b", position: 1, value: 0 }] };
  expect(controllerPadHasContent(cc)).toBe(false);
  cc.keypoints[0].value = 64;
  expect(controllerPadHasContent(cc)).toBe(true);
  cc.keypoints[0].value = 0; cc.keypoints.push({ id: "c", position: .5, value: 0 });
  expect(controllerPadHasContent(cc)).toBe(true);
  const arp = normalizeArpeggiatorSettings({});
  expect(arpeggiatorPadHasSound(arp)).toBe(true);
  for (const kind of ["rest", "tie"] as const) {
    arp.steps.forEach(step => { step.kind = kind; });
    expect(arpeggiatorPadHasSound(arp)).toBe(false);
  }
  arp.steps[0].kind = "position"; arp.steps[0].velocity = 0;
  expect(arpeggiatorPadHasSound(arp)).toBe(false);
  arp.steps[0].velocity = 100; arp.steps[0].probability = 0;
  expect(arpeggiatorPadHasSound(arp)).toBe(false);
  arp.steps[0].probability = .5;
  expect(arpeggiatorPadHasSound(arp)).toBe(true);
  arp.probability = 0;
  expect(arpeggiatorPadHasSound(arp)).toBe(false);
});
