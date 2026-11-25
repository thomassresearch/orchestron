import { mergeClips, splitClip } from "./clipWindows";
import { runtimeSchedule } from "./runtime";
import { describe, expect, it } from "vitest";
import { DEFAULT_SEQUENCER_TIMING_CONFIG, SEQUENCER_BEAT_RATE_OPTIONS } from "../sequencer";
import { defaultSequencerState } from "../../store/appStoreModel";
import { beginDraft, duplicateClip, copyClipRange, pasteClipRange, convertLaneCycle, deleteClip, editTime, emptyClipHistory, fitClip, recordClipEdit, replayClipEdit, saveDraft, trimClip, updateClip } from "./operations";
import { migrateClipArrangement } from "./migration";
import { QUARTER_TICKS as Q, CLIP_LIMITS, clipWindows, contentLength, localBeatTicks, resolveClip, validateArrangement, type ClipArrangement, type PatternDefinition } from "./model";

function fixture(): ClipArrangement {
  const payload = defaultSequencerState().tracks[0].pads[0];
  const pattern: PatternDefinition = { id: "p", name: "Pulse", revision: 0, kind: "pattern", source: "sequencer", payload: { ...payload, lengthBeats: 4 } };
  return { version: 1, revision: 0, end: 40 * Q, lanes: [{ id: "lane", source: "sequencer", cycleTicks: null, definitions: [pattern,
    { id: "g", name: "Group", revision: 0, kind: "group", children: [{ id: "gp1", definitionId: "p" }, { id: "gp2", definitionId: "p" }] },
    { id: "s", name: "Supergroup", revision: 0, kind: "supergroup", children: [{ id: "sg", definitionId: "g" }] }], clips: [
    { id: "c", name: "Verse", start: 0, length: 20 * Q, offset: 2 * Q, mode: "loop", children: [{ id: "cs", definitionId: "s" }] },
    { id: "c2", name: "Return", start: 24 * Q, length: 8 * Q, offset: 0, mode: "once", children: [{ id: "c2s", definitionId: "s" }] }
  ] }] };
}
const ids = () => { let n = 0; return () => `new-${n++}`; };
const target = { laneId: "lane", clipId: "c", path: ["cs", "sg", "gp2"], pass: 1 };

describe("fixed clip windows", () => {
  it("uses exact integer timing for every supported ratio and meter", () => {
    for (const rate of SEQUENCER_BEAT_RATE_OPTIONS) for (const meter of [4, 8] as const) {
      const ticks = localBeatTicks({ ...DEFAULT_SEQUENCER_TIMING_CONFIG, meterDenominator: meter, beatRateNumerator: rate.numerator, beatRateDenominator: rate.denominator });
      expect(Number.isSafeInteger(ticks)).toBe(true);
      expect(ticks * rate.numerator * meter).toBe(Q * 4 * rate.denominator);
    }
  });
  it("resolves partial first/last passes without moving subsequent clips", () => {
    const model = fixture(), lane = model.lanes[0], clip = lane.clips[0];
    validateArrangement(model);
    const segments = resolveClip(lane, clip, 0, 20 * Q);
    expect(segments.map(s => [s.start / Q, s.length / Q, s.pass, s.sourceOffset / Q])).toEqual([
      [0, 2, 0, 2], [2, 4, 0, 0], [6, 4, 1, 0], [10, 4, 1, 0], [14, 4, 2, 0], [18, 2, 2, 0]
    ]);
    expect(resolveClip(lane, { ...clip, mode: "once" }, 0, 20 * Q).map(s => s.length / Q)).toEqual([2, 4]);
    expect(resolveClip(lane, { ...clip, offset: 20 * Q, mode: "once" }, 0, 20 * Q)).toEqual([]);
  });
  it("keeps source alignment on left trim and rejects collisions atomically", () => {
    const model = fixture();
    const trimmed = trimClip(model, "lane", "c", "left", Q);
    expect(trimmed.lanes[0].clips[0]).toMatchObject({ start: Q, length: 19 * Q, offset: 3 * Q });
    expect(() => updateClip(model, "lane", "c", { length: 25 * Q })).toThrow(/overlap/);
    expect(model.lanes[0].clips[0].length).toBe(20 * Q);
    expect(fitClip(model, "lane", "c").lanes[0].clips[0].length).toBe(6 * Q);
    expect(deleteClip(model, "lane", "c").end).toBe(model.end);
  });
  it("resolves only the viewport of a very long loop", () => {
    const lane = fixture().lanes[0], clip = { ...lane.clips[0], length: Q * 900000 };
    expect(resolveClip(lane, clip, Q * 800000, Q * 800001)).toHaveLength(1);
    expect(() => resolveClip(lane, clip, 0, clip.length)).toThrow(/smaller/);
  });
});

describe("transactional scope saves", () => {
  it("isolates the selected duplicate child of one generated pass and preserves all other uses", () => {
    const model = fixture(), draft = beginDraft(model, target);
    draft.definition.name = "Variation";
    const next = saveDraft(model, draft, "local", {}, ids());
    expect(next.lanes[0].clips.map(c => [c.start / Q, c.length / Q, c.offset / Q])).toEqual([[0, 6, 2], [6, 8, 0], [14, 6, 16], [24, 8, 0]]);
    const defs = next.lanes[0].definitions;
    expect(defs.find(d => d.id === "p")?.name).toBe("Pulse");
    const middle = next.lanes[0].clips[1];
    expect(resolveClip(next.lanes[0], middle, 0, 40 * Q).map(s => s.definition?.name)).toEqual(["Pulse", "Variation"]);
    expect(resolveClip(next.lanes[0], next.lanes[0].clips[3], 0, 40 * Q).map(s => s.definition?.name)).toEqual(["Pulse", "Pulse"]);
    expect(model).toEqual(fixture());
  });
  it("updates all links while preserving clip geometry even when content duration changes", () => {
    const model = fixture(), draft = beginDraft(model, target);
    if (draft.definition.kind === "pattern") draft.definition.payload.lengthBeats = 2;
    const next = saveDraft(model, draft, "all");
    expect(next.lanes[0].clips).toEqual(model.lanes[0].clips);
    expect(contentLength(next.lanes[0], next.lanes[0].clips[0].children)).toBe(4 * Q);
    expect(() => saveDraft(next, draft, "all")).toThrow(/changed after/);
  });
  it("forks groups and supergroups without deep copying unrelated child definitions", () => {
    for (const path of [["cs"], ["cs", "sg"]]) {
      const model = fixture(), draft = beginDraft(model, { ...target, path });
      draft.definition.name = "Container variation";
      const next = saveDraft(model, draft, "local", {}, ids());
      expect(next.lanes[0].definitions.filter(d => d.kind === "pattern")).toHaveLength(1);
      expect(next.lanes[0].definitions.find(d => d.name === "Container variation")).toBeTruthy();
    }
  });
  it("undo/redo restores complete repeat split and identities in one atomic action", () => {
    const before = fixture(), draft = beginDraft(before, target);
    const after = saveDraft(before, draft, "local", {}, ids());
    const history = recordClipEdit(emptyClipHistory(), before, after, "Variation");
    const undone = replayClipEdit(history, after, false);
    expect(undone.model).toEqual(before);
    expect(replayClipEdit(undone.history, undone.model, true).model).toEqual(after);
  });
  it("retains more than eight independent definitions", () => {
    let model = fixture();
    for (let i = 0; i < 12; i++) {
      const draft = beginDraft(model, { ...target, clipId: "c2", path: ["c2s", "sg", "gp1"], pass: 0 });
      // Global saves keep this stable path; independent unused variations remain in the library.
      const copy = structuredClone(draft.definition); copy.id = `unused-${i}`;
      model.lanes[0].definitions.push(copy);
    }
    model = JSON.parse(JSON.stringify(model)); validateArrangement(model);
    expect(model.lanes[0].definitions).toHaveLength(15);
  });
});

it("inserts/closes explicit time across cropped clips without losing source alignment", () => {
  const model = fixture();
  const inserted = editTime(model, ["lane"], 3 * Q, 2 * Q, "insert", {}, ids());
  expect(inserted.lanes[0].clips.slice(0, 2).map(c => [c.start / Q, c.length / Q, c.offset / Q])).toEqual([[0, 3, 2], [5, 17, 5]]);
  const closed = editTime(inserted, ["lane"], 3 * Q, 2 * Q, "close", {}, ids());
  expect(closed.lanes[0].clips[1]).toMatchObject({ start: 3 * Q, offset: 5 * Q });
});
it("rejects bad references, cycles, duplicates and zero-duration containers", () => {
  for (const mutate of [(m: ClipArrangement) => { m.lanes[0].definitions[0].id = "g"; },
    (m: ClipArrangement) => { m.lanes[0].clips[0].children = [{ id: "broken", definitionId: "missing" }]; },
    (m: ClipArrangement) => { const g = m.lanes[0].definitions[1]; if (g.kind !== "pattern") g.children = [{ id: "cycle", definitionId: "g" }]; },
    (m: ClipArrangement) => { const g = m.lanes[0].definitions[1]; if (g.kind !== "pattern") g.children = []; }]) {
    const model = fixture(); mutate(model); expect(() => validateArrangement(model)).toThrow();
  }
});
it("migrates deterministically, retaining all pad payloads and independent repeat cycles", () => {
  const state = defaultSequencerState();
  state.tracks.forEach(t => { t.padLoopEnabled = true; t.padLoopRepeat = true; t.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }, { type: "pause", lengthBeats: 2 }, { type: "pad", padIndex: 0 }]; });
  const report = migrateClipArrangement(state);
  expect(report.reasons).toEqual([]);
  expect(report.model).toEqual(migrateClipArrangement(state).model);
  expect(report.model?.lanes[0].definitions.filter(d => d.kind === "pattern").map(d => d.payload)).toEqual(state.tracks[0].pads);
  expect(report.model?.lanes[0].cycleTicks).toBe(10 * Q);
  state.pianoRolls.push({ ...state.pianoRolls[0], id: "extra" });
  expect(migrateClipArrangement(state)).toMatchObject({ model: null, reasons: ["multiple-keyboards"] });
});

it("copies cropped multi-lane sections and previews atomic insert/overwrite without altering source definitions", () => {
  const model = fixture();
  const section = copyClipRange(model, ["lane"], 3 * Q, 5 * Q, ids());
  const pasted = pasteClipRange(model, section, 30 * Q, "overwrite", {}, ids());
  validateArrangement(pasted);
  const clip = pasted.lanes[0].clips.find(c => c.start === 30 * Q)!;
  expect(clip).toMatchObject({ length: 5 * Q, offset: 5 * Q });
  expect(pasted.lanes[0].definitions).toEqual(model.lanes[0].definitions);
  const inserted = pasteClipRange(model, section, 3 * Q, "insert", {}, ids());
  expect(inserted.end).toBe(45 * Q);
  expect(inserted.lanes[0].clips.some(c => c.start === 29 * Q)).toBe(true);
});
it("materializes legacy repeats only within the fixed song extent", () => {
  const model = fixture(); model.lanes[0].clips = model.lanes[0].clips.slice(0, 1); model.lanes[0].cycleTicks = 20 * Q;
  const next = convertLaneCycle(model, "lane", {}, ids());
  expect(next.lanes[0].cycleTicks).toBeNull();
  expect(next.lanes[0].clips.map(c => c.start)).toEqual([0, 20 * Q]);
  expect(next.end).toBe(model.end);
});

it("rejects a draft when undo and a new branch reuse a revision number", () => {
  const model = fixture(), draft = beginDraft(model, target);
  const changed = structuredClone(model);
  changed.lanes[0].definitions[0].name = "A different branch";
  expect(() => saveDraft(changed, draft, "all")).toThrow(/changed after editing/);
});

describe("arranger clip merge and split", () => {
  it("joins whole linked content and intervening rests in one normal clip", () => {
    const model = fixture();
    Object.assign(model.lanes[0].clips[0], { mode: "once", offset: 0, length: 8 * Q });
    const merged = mergeClips(model, "lane", ["c", "c2"]).model;
    expect(merged.lanes[0].clips).toHaveLength(1);
    expect(merged.lanes[0].clips[0]).toMatchObject({start: 0, length: 32 * Q, children: [
      {definitionId:"s"}, {restTicks:16 * Q}, {definitionId:"s"}]});
    expect(merged.lanes[0].definitions).toEqual(model.lanes[0].definitions);
    expect(merged.end).toBe(model.end);
  });

  it("preserves cropped loops, nested content, real rests and window ownership through section copies", () => {
    const model = fixture(), merged = mergeClips(model, "lane", ["c", "c2"]).model;
    const windows = clipWindows(merged.lanes[0]);
    expect(windows).toHaveLength(1);
    const [a, gap, b] = windows[0].parts;
    expect(a).toMatchObject({start:0, offset:2*Q, mode:"loop", length:20*Q});
    expect(gap).toMatchObject({start:20*Q, length:4*Q, children:[{restTicks:4*Q}]});
    expect(b).toMatchObject({start:24*Q, length:8*Q});
    const section = copyClipRange(merged, ["lane"], 0, 32*Q);
    const repeated = pasteClipRange(merged, section, 32*Q, "overwrite", {});
    expect(clipWindows(repeated.lanes[0]).map(w=>[w.clip.start,w.end,w.parts.length])).toEqual([[0,32*Q,3],[32*Q,64*Q,3]]);
    const cut = splitClip(merged, "lane", "c", 21*Q);
    expect(clipWindows(cut.model.lanes[0]).map(w=>[w.clip.start,w.end])).toEqual([[0,21*Q],[21*Q,32*Q]]);
    const copied = duplicateClip(merged, "lane", "c");
    const removed = deleteClip(copied.model, "lane", "c");
    expect(clipWindows(removed.lanes[0])).toHaveLength(1);
    expect(clipWindows(removed.lanes[0])[0].parts.map(c => c.start / Q)).toEqual([32,52,56]);
  });

  it("cuts a loop near the source-offset limit without overflowing or changing its logical pass", () => {
    const model = fixture();
    model.version = 3;
    model.lanes[0].clips[0].offset = CLIP_LIMITS.ticks;
    const state = defaultSequencerState();
    const before = runtimeSchedule({...state, clipArrangement: model}, model.lanes[0]);
    const {model: split} = splitClip(model, "lane", "c", 2*Q);
    expect(runtimeSchedule({...state, clipArrangement: split}, split.lanes[0])).toEqual(before);
  });

  it("keeps a split transparent to the scheduler, including transposed loop passes, then separates moved halves", () => {
    const model = fixture(), lane = model.lanes[0];
    model.version = 3;
    lane.clips[0].transposePlacements = [{path:["cs","sg","gp2"],plan:{base:{diatonicSteps:0,chromaticSemitones:0},repetitions:[{index:1,offset:{diatonicSteps:0,chromaticSemitones:7}}]}}];
    const state = defaultSequencerState();
    const schedule = (m: ClipArrangement) => runtimeSchedule({...state,clipArrangement:m}, m.lanes[0]);
    const first = splitClip(model,"lane","c",3*Q), second = splitClip(first.model,"lane",first.selected,7*Q+1);
    expect(schedule(second.model)).toEqual(schedule(model));
    expect(clipWindows(second.model.lanes[0])).toHaveLength(4);
    const rejoined = mergeClips(second.model,"lane",["c",first.selected,second.selected]);
    expect(rejoined.model.lanes[0].clips).toHaveLength(2);
    expect(schedule(rejoined.model)).toEqual(schedule(model));
    const moved = updateClip(second.model,"lane",second.selected,{start:8*Q});
    expect(schedule(moved).clips).toHaveLength(3);
    for (const beat of [0,20]) expect(()=>splitClip(model,"lane","c",beat*Q)).toThrow(/inside/);
    expect(()=>mergeClips(second.model,"lane",["c",second.selected])).toThrow(/consecutive/);
  });
});
