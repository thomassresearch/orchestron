import { expect, it } from "vitest";
import fixture from "../../../../backend/tests/fixtures/performances/device_names.json";
import { parseSequencerConfigSnapshot } from "../../store/appStoreModel";
import { draftKey } from "./editorAdapter";
import { arrangementTimings, migrateClipArrangement, sourceKeys } from "./migration";
import { patternDuration, resolveClip, type ClipLane, type DefinitionDraft } from "./model";
import { beginDraft } from "./operations";
import { clipRuntimeView, runtimeSchedule } from "./runtime";
import { clipSongPlayback, songDraftPlayback, songPatternEdits } from "./songDrafts";

function setup() {
  const state = parseSequencerConfigSnapshot(fixture.config, [], null).sequencer;
  state.pianoRolls = state.pianoRolls.slice(0, 1);
  for (const key of Object.values(sourceKeys)) {
    for (const device of state[key]) {
      device.padLoopEnabled = true;
      if ("playbackMode" in device) device.playbackMode = "arranger";
    }
  }
  const model = migrateClipArrangement(state).model!;
  state.clipArrangement = model;
  for (const lane of model.lanes) {
    const pattern = lane.definitions.find(d => d.kind === "pattern")!;
    const duration = patternDuration(pattern, arrangementTimings(state)[lane.id]);
    lane.cycleTicks = null;
    lane.definitions = [pattern];
    lane.clips = [{ id: lane.id + "-clip", name: "Verse", mode: "loop", offset: 0, start: 0,
      length: 4 * duration, children: [{ id: lane.id + "-use", definitionId: pattern.id }] }];
  }
  model.end = Math.max(...model.lanes.map(l => l.clips[0].length));
  return state;
}

function edit(state: ReturnType<typeof setup>, lane: ClipLane, pass: number, scope: "local" | "all", length: number) {
  const clip = lane.clips[0];
  const draft = beginDraft(state.clipArrangement!, { laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass });
  draft.editIntent = { scope, explicit: true };
  if (draft.definition.kind !== "pattern") throw Error("Expected a pattern");
  draft.definition.payload.lengthBeats = length;
  return draft;
}
const keyed = (...drafts: DefinitionDraft[]) => Object.fromEntries(drafts.map(draft => [draftKey(draft), draft]));

it("plays pending patterns across all five source types and leaves the authored configuration intact", () => {
  const state = setup(), lanes = state.clipArrangement!.lanes, before = structuredClone(state);
  const drafts = lanes.map(lane => edit(state, lane, 0, "all", 3));
  drafts[0].definition.name = ""; // An unfinished rename can accompany a valid musical edit.
  const projected = songDraftPlayback(state, keyed(...drafts)), runtime = clipRuntimeView(projected);
  expect(new Set(lanes.map(l => l.source)).size).toBe(5);
  for (const lane of lanes) {
    const device = runtime[sourceKeys[lane.source]].find(t => t.id === lane.id)!;
    expect(device.pads[0].lengthBeats).toBe(3);
    expect(runtimeSchedule(projected, projected.clipArrangement!.lanes.find(l => l.id === lane.id)!).clips[0].mode).toBe("loop");
  }
  expect(state).toEqual(before);
  expect(songDraftPlayback(state, {})).toBe(state);
});

it("isolates multiple local passes, with stable IDs, and restores just the discarded variation", () => {
  const state = setup(), lane = state.clipArrangement!.lanes[0], duration = lane.clips[0].length / 4;
  const first = edit(state, lane, 1, "local", 2), second = edit(state, lane, 3, "local", 3);
  const drafts = keyed(first, second), projected = songDraftPlayback(state, drafts);
  expect(songDraftPlayback(state, drafts).clipArrangement).toEqual(projected.clipArrangement);
  const lengths = (preview: typeof state) => {
    const track = preview.clipArrangement!.lanes[0], timing = arrangementTimings(state)[track.id];
    return [0, 1, 2, 3].map(pass => {
      const at = pass * duration;
      const clip = track.clips.find(c => c.start <= at && at < c.start + c.length)!;
      return resolveClip(track, clip, at, at + 1, timing)[0].definition?.payload.lengthBeats;
    });
  };
  const original = lengths(state)[0];
  expect(lengths(projected)).toEqual([original, 2, original, 3]);
  expect(lengths(songDraftPlayback(state, keyed(second)))).toEqual([original, original, original, 3]);
  expect(lane.clips).toHaveLength(1);
});

it.each(["all", "local"] as const)("keeps a %s edit within the 512 arranged slots during Play edit", scope => {
  const state = setup(), lane = state.clipArrangement!.lanes[0];
  const original = lane.definitions[0];
  const extraCount = scope === "local" ? 510 : 511;
  lane.definitions.push(...Array.from({ length: extraCount }, (_, i) => ({ ...structuredClone(original), id: "extra-" + i })));
  const draft = edit(state, lane, 0, scope, 3);
  const audition = clipSongPlayback(state, keyed(draft), draft);
  const runtime = clipRuntimeView(audition.state);
  const pads = runtime[sourceKeys[lane.source]].find(t => t.id === lane.id)!.pads;
  const schedule = runtimeSchedule(runtime, runtime.clipArrangement!.lanes[0]);
  expect(pads).toHaveLength(513);
  expect(audition.sequence).toEqual([512]);
  const songSlot = schedule.clips[0].content[0].pad!;
  expect(songSlot).toBe(scope === "all" ? 0 : 511);
  expect(pads[songSlot]).toEqual(pads[512]);
  expect(pads[songSlot].lengthBeats).toBe(3);
});

it("excludes clean, unscoped, stale and name-only drafts from playback", () => {
  const state = setup(), lane = state.clipArrangement!.lanes[0], draft = edit(state, lane, 0, "all", 3);
  const clean = beginDraft(state.clipArrangement!, draft.target);
  clean.editIntent = draft.editIntent;
  expect(songPatternEdits(state, keyed(clean))).toEqual([]);
  clean.definition.name = "Working title";
  expect(songPatternEdits(state, keyed(clean))).toEqual([]);
  expect(songPatternEdits(state, keyed({ ...draft, editIntent: { scope: null, explicit: false } }))).toEqual([]);
  expect(songPatternEdits(state, keyed({ ...draft, baseRevision: 999 }))).toEqual([]);
  const missingPass = edit(state, lane, 99, "local", 2);
  expect(songDraftPlayback(state, keyed(missingPass))).toBe(state);
  lane.clips = [];
  expect(songDraftPlayback(state, keyed(draft))).toBe(state);
});
