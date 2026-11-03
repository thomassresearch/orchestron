import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { addClipLane, openClipEditor, removeClipLane, saveClipDraft } from "./clipActions";
import { migrateClipArrangement } from "../lib/clipArranger/migration";
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot } from "./appStoreModel";
import { attachClipSchedules, clipAuditionState, clipRuntimeView, runtimeSchedule } from "../lib/clipArranger/runtime";
import { clipEditorView } from "../lib/clipArranger/editorAdapter";
import { buildDrummerRowTrackConfigs } from "../appOrchestration";
import { addScoreTrack } from "./scoreActions";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const s = structuredClone(useAppStore.getState().sequencer);
  s.tracks.forEach(t => { t.padLoopEnabled = true; t.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 0 }]; });
  s.clipArrangement = migrateClipArrangement(s).model!;
  useAppStore.setState({ sequencer: s });
});

it("keeps real melodic edits out of authored data and runtime until scoped save", () => {
  const before = structuredClone(useAppStore.getState().sequencer), lane = before.clipArrangement!.lanes[0], clip = lane.clips[0];
  openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 });
  const actions = useAppStore.getState();
  actions.setSequencerTrackStepNote(lane.id, 0, 77);
  actions.setSequencerTrackStepChord(lane.id, 0, "maj7");
  actions.setSequencerTrackStepStrum(lane.id, 0, "down", 75);
  actions.setSequencerTrackStepTimingOffset(lane.id, 0, 20);
  const state = useAppStore.getState(), draft = state.clipDrafts[state.clipEditingKey!];
  expect(state.sequencer.clipArrangement).toEqual(before.clipArrangement);
  expect(state.sequencer.tracks[0].pads).toEqual(before.tracks[0].pads);
  expect(draft.definition).toMatchObject({ payload: { steps: [expect.objectContaining({ note: 77, chord: "maj7", strumDirection: "down", strumSpreadPercent: 75, timingOffsetPercent: 20 }), ...before.tracks[0].pads[0].steps.slice(1)] } });
  const audition = clipAuditionState(state.sequencer, draft);
  expect(clipRuntimeView(audition.state).tracks[0].pads[audition.sequence[0]].steps[0].note).toBe(77);
  expect(buildSequencerConfigSnapshot(state.sequencer, []).sequencer.clipArrangement).toEqual(before.clipArrangement);
  saveClipDraft("local", "Variation");
  const next = useAppStore.getState().sequencer;
  const children = next.clipArrangement!.lanes[0].clips[0].children;
  expect(children[0]).not.toEqual(children[1]);
  expect(next.clipArrangement!.lanes[0].definitions).toHaveLength(9);
  const snapshot = buildSequencerConfigSnapshot(next, []);
  const restored = parseSequencerConfigSnapshot(snapshot, [], null).sequencer;
  expect(restored.clipArrangement).toEqual(next.clipArrangement);
  expect(restored.tracks[0].padLoopEnabled).toBe(true);
  expect(runtimeSchedule(restored, restored.clipArrangement!.lanes[0]).clips[0].content[0].pad).toBe(8);
});

it("creates each source type with one placed pattern and captures real curve edits", () => {
  const state = useAppStore.getState();
  for (const [kind, create] of [["score", () => addScoreTrack("Score")], ["drummer", state.addDrummerSequencerTrack], ["arpeggiator", state.addArpeggiator], ["controller", state.addControllerSequencer]] as const) {
    addClipLane(kind, create);
    expect(useAppStore.getState().sequencer.clipArrangement!.lanes.slice(-1)[0]).toMatchObject({ source: kind, definitions: [expect.objectContaining({ kind: "pattern" })], clips: [expect.objectContaining({ mode: "loop" })] });
  }
  const before = useAppStore.getState(), draft = before.clipDrafts[before.clipEditingKey!];
  if (draft.definition.kind !== "pattern" || draft.definition.source !== "controller") throw new Error("Expected controller");
  const point = draft.definition.payload.keypoints[0];
  before.setControllerSequencerKeypoint(draft.target.laneId, point.id, 0, 127);
  const current = useAppStore.getState();
  expect(current.clipDrafts[current.clipEditingKey!].definition).toMatchObject({ payload: { keypoints: expect.arrayContaining([expect.objectContaining({ id: point.id, value: 127 })]) } });
  expect(current.sequencer.clipArrangement).toEqual(before.sequencer.clipArrangement);
});

it("removes a source and its drafts without leaving dependent sync references", () => {
  const state = useAppStore.getState(), original = state.sequencer.tracks[0].id;
  addClipLane("sequencer", state.addSequencerTrack);
  const next = useAppStore.getState(), added = next.sequencer.tracks.slice(-1)[0].id;
  useAppStore.setState({ sequencer: { ...next.sequencer, tracks: next.sequencer.tracks.map(t => t.id === original ? { ...t, syncToTrackId: added } : t) } });
  removeClipLane(added);
  expect(useAppStore.getState().sequencer.tracks[0].syncToTrackId).toBeNull();
  expect(useAppStore.getState().clipEditingKey).toBeNull();
  expect(useAppStore.getState().sequencer.clipArrangement!.lanes.some(l => l.id === added)).toBe(false);
});


it.each(["local", "all"] as const)("keeps kick/snare rows independent through clip editing, audition and %s save", scope => {
  addClipLane("drummer", useAppStore.getState().addDrummerSequencerTrack);
  const current = useAppStore.getState(), key = current.clipEditingKey!;
  const originalTrack = structuredClone(current.sequencer.drummerTracks[0]);
  const id = originalTrack.id, [kick, snare, ...others] = originalTrack.rows;
  const view = () => {
    const state = useAppStore.getState();
    return clipEditorView(state.sequencer, state.clipDrafts[key]).drummerTracks[0];
  };
  // The real UI reads row IDs and MIDI keys from this exact projection.
  expect(view().rows).toEqual(originalTrack.rows);
  current.setDrummerSequencerRowKey(id, view().rows[0].id, 35);
  current.setDrummerSequencerRowKey(id, view().rows[1].id, 38);
  others.forEach(row => current.removeDrummerSequencerRow(id, row.id));
  expect(view().rows).toEqual([{ id: kick.id, key: 35 }, { id: snare.id, key: 38 }]);
  current.toggleDrummerSequencerCell(id, kick.id, 0, true);
  current.toggleDrummerSequencerCell(id, snare.id, 4, true);
  current.toggleDrummerSequencerCell(id, kick.id, 0, false);
  expect(view().pads[0].rows.map(row => row.steps[0].active)).toEqual([false, false]);
  expect(view().pads[0].rows.map(row => row.steps[4].active)).toEqual([false, true]);
  current.toggleDrummerSequencerCell(id, kick.id, 0, true);
  current.setDrummerSequencerCellVelocity(id, kick.id, 0, 96);
  expect(view().pads[0].rows[1].steps[4].velocity).toBe(127);

  const state = useAppStore.getState(), draft = state.clipDrafts[key];
  expect(state.sequencer.drummerTracks[0].pads).toEqual(originalTrack.pads);
  const authoredDefinition = state.sequencer.clipArrangement!.lanes.find(l => l.id === id)!.definitions[0];
  expect(authoredDefinition).toMatchObject({ payload: originalTrack.pads[0] });
  const audition = clipAuditionState(state.sequencer, draft);
  const runtime = clipRuntimeView(audition.state);
  const tracks = buildDrummerRowTrackConfigs(runtime.drummerTracks[0]);
  expect(tracks.map(t => t.track_id)).toEqual([`drumrow:${id}:${kick.id}`, `drumrow:${id}:${snare.id}`]);
  expect(new Set(tracks.map(t => t.track_id)).size).toBe(2);
  const pad = audition.sequence[0];
  expect(tracks[0].pads![pad].steps[0]).toMatchObject({ note: 35, velocity: 96 });
  expect(tracks[0].pads![pad].steps[4]).toMatchObject({ note: null });
  expect(tracks[1].pads![pad].steps[0]).toMatchObject({ note: null });
  expect(tracks[1].pads![pad].steps[4]).toMatchObject({ note: 38 });
  const config = attachClipSchedules(audition.state, { timing: tracks[0].timing!, step_count: 8, tracks, controller_tracks: [], score_tracks: [] });
  expect(config.tracks.every(t => t.clip_schedule?.clips.length === 1)).toBe(true);
  saveClipDraft(scope, "Kick and snare");
  const saved = useAppStore.getState().sequencer;
  const restored = parseSequencerConfigSnapshot(buildSequencerConfigSnapshot(saved, []), [], null).sequencer;
  expect(restored.drummerTracks[0].rows).toEqual(view().rows);
  const played = buildDrummerRowTrackConfigs(clipRuntimeView(restored).drummerTracks[0]);
  const lane = restored.clipArrangement!.lanes.find(l => l.id === id)!;
  const savedPad = runtimeSchedule(restored, lane).clips[0].content[0].pad!;
  expect(played[0].pads![savedPad].steps[0]).toMatchObject({ note: 35, velocity: 96 });
  expect(played[1].pads![savedPad].steps[4]).toMatchObject({ note: 38 });
});
