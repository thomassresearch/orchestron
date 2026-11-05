import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { addClipLane, openClipEditor, removeClipLane, saveClipDraft } from "./clipActions";
import { migrateClipArrangement } from "../lib/clipArranger/migration";
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot } from "./appStoreModel";
import { attachClipSchedules, clipAuditionState, clipRuntimeView, runtimeSchedule } from "../lib/clipArranger/runtime";
import { clipEditorView } from "../lib/clipArranger/editorAdapter";
import { buildDrummerRowTrackConfigs } from "../appOrchestration";
import { addScoreTrack, updateScoreTrack } from "./scoreActions";
import { sourceKeys } from "../lib/clipArranger/migration";
import type { SourceKind } from "../lib/clipArranger/model";
import { buildSequencerPlaybackRange } from "../appOrchestration";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const s = structuredClone(useAppStore.getState().sequencer);
  s.tracks.forEach(t => { t.padLoopEnabled = true; t.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 0 }]; });
  s.clipArrangement = migrateClipArrangement(s).model!;
  useAppStore.setState({ sequencer: s });
});

it("keeps fractional-beat clip loop bounds through playback compilation and reload", () => {
  useAppStore.getState().setSequencerArrangerLoopSelection({ startStep: 2, endStep: 6 });
  const state = useAppStore.getState().sequencer;
  expect(state.arrangerLoopSelection).toEqual({ startStep: 2, endStep: 6 });
  const runtime = clipRuntimeView(state);
  const range = buildSequencerPlaybackRange(runtime, "runtime", true);
  expect(range).toEqual({ playback_start_step: 2, playback_end_step: 6, playback_loop: true });
  const restored = parseSequencerConfigSnapshot(buildSequencerConfigSnapshot(state, []), [], null).sequencer;
  expect(restored.arrangerLoopSelection).toEqual(state.arrangerLoopSelection);
  expect(buildSequencerPlaybackRange(clipRuntimeView(restored), "runtime", true)).toEqual(range);
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

it.each((["sequencer", "score", "controller", "arpeggiator"] as SourceKind[]).flatMap(kind =>
  (["local", "all"] as const).map(scope => ({ kind, scope }))))("preserves $kind edits through audition, $scope scope and reload", ({ kind, scope }) => {
  const actions = useAppStore.getState();
  const create = { sequencer: actions.addSequencerTrack, score: () => addScoreTrack("Score"),
    drummer: actions.addDrummerSequencerTrack, controller: actions.addControllerSequencer, arpeggiator: actions.addArpeggiator };
  addClipLane(kind, create[kind]);
  const initial = useAppStore.getState(), key = initial.clipEditingKey!, target = initial.clipDrafts[key].target;
  const lane = initial.sequencer.clipArrangement!.lanes.find(l => l.id === target.laneId)!;
  const id = lane.id, source = sourceKeys[kind];
  // A second linked clip distinguishes a local save from a shared definition edit.
  lane.clips.push({ ...structuredClone(lane.clips[0]), id: "linked-clip", start: lane.clips[0].length,
    children: lane.clips[0].children.map(item => ({ ...item, id: "linked-child" })) });
  initial.sequencer.clipArrangement!.end = Math.max(initial.sequencer.clipArrangement!.end, lane.clips[0].length * 2);
  const original = structuredClone(lane.definitions[0]);
  const pads = structuredClone(initial.sequencer[source].find(t => t.id === id)!.pads);
  if (kind === "sequencer") {
    actions.setSequencerTrackStepNote(id, 0, 72);
    actions.setSequencerTrackStepChord(id, 0, "maj7");
    actions.setSequencerTrackStepVelocity(id, 0, 89);
    actions.setSequencerTrackStepTimingOffset(id, 0, 20);
  } else if (kind === "score") {
    updateScoreTrack(id, track => ({ ...track, pads: track.pads.map((pad, i) => i ? pad : { ...pad,
      notes: [{ id: "score-note", pitch: 67, velocity: 93, startTicks: 5040, durationTicks: 30240 }] }) }));
  } else if (kind === "controller") {
    actions.setControllerSequencerMode(id, "step");
    actions.setControllerSequencerStep(id, 2, 91);
    actions.setControllerSequencerMode(id, "curve");
    const point = clipEditorView(useAppStore.getState().sequencer, useAppStore.getState().clipDrafts[key]).controllerSequencers.find(t => t.id === id)!.keypoints[0];
    actions.setControllerSequencerKeypoint(id, point.id, 0, 123);
  } else {
    actions.updateArpeggiator(id, { pattern: "down", octaves: 3 });
  }
  const state = useAppStore.getState(), draft = state.clipDrafts[key];
  expect(draft.definition).not.toEqual(original);
  expect(state.sequencer[source].find(t => t.id === id)!.pads).toEqual(pads);
  expect(state.sequencer.clipArrangement!.lanes.find(l => l.id === id)!.definitions[0]).toEqual(original);
  const audition = clipAuditionState(state.sequencer, draft);
  expect(clipRuntimeView(audition.state)[source].find(t => t.id === id)!.pads[audition.sequence[0]]).toEqual(
    draft.definition.kind === "pattern" ? draft.definition.payload : null);
  saveClipDraft(scope, "Edited pattern");
  const saved = useAppStore.getState().sequencer;
  const restored = parseSequencerConfigSnapshot(buildSequencerConfigSnapshot(saved, []), [], null).sequencer;
  expect(restored.clipArrangement).toEqual(saved.clipArrangement);
  const restoredLane = restored.clipArrangement!.lanes.find(l => l.id === id)!;
  const schedule = runtimeSchedule(restored, restoredLane);
  const runtime = clipRuntimeView(restored)[source].find(t => t.id === id)!;
  expect(runtime.pads[schedule.clips[0].content[0].pad!]).toEqual(draft.definition.kind === "pattern" ? draft.definition.payload : null);
  expect(runtime.pads[schedule.clips[1].content[0].pad!]).toEqual(scope === "all" && draft.definition.kind === "pattern"
    ? draft.definition.payload : original.kind === "pattern" ? original.payload : null);
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

it('attaches song and audition schedules to CLI drum rows with more than eight clip patterns', () => {
  addClipLane('drummer', useAppStore.getState().addDrummerSequencerTrack);
  const state = structuredClone(useAppStore.getState().sequencer);
  const track = state.drummerTracks[0];
  const lane = state.clipArrangement!.lanes.find(l => l.id === track.id)!;
  const original = lane.definitions[0];
  if (original.kind !== 'pattern' || original.source !== 'drummer') throw Error('Expected drum pattern');
  const rowId = `${track.id}:key35:generated`;
  const oldRowId = track.rows[0].id;
  track.rows[0] = { id: rowId, key: 35 };
  lane.definitions = Array.from({ length: 12 }, (_, i) => ({
    ...structuredClone(original), id: `pattern-${i}`,
    payload: { ...structuredClone(original.payload), rows: original.payload.rows.map(row => ({
      ...structuredClone(row), rowId: row.rowId === oldRowId ? rowId : row.rowId
    })) }
  }));
  lane.clips[0].children = [{ id: 'last-pattern', definitionId: 'pattern-11' }];
  const compile = (input: typeof state) => {
    const tracks = buildDrummerRowTrackConfigs(clipRuntimeView(input).drummerTracks[0]);
    return attachClipSchedules(input, { timing: tracks[0].timing!, step_count: 8, tracks, controller_tracks: [] });
  };
  const config = compile(state);
  expect(config.tracks.every(t => t.pads?.length === 12)).toBe(true);
  for (const t of config.tracks) expect(t.clip_schedule?.clips[0].content[0].pad).toBe(11);
  const target = { laneId: lane.id, clipId: lane.clips[0].id, path: ['last-pattern'], pass: 0 };
  const audition = clipAuditionState(state, { target, baseRevision: state.clipArrangement!.revision, definition: structuredClone(lane.definitions[11]) });
  for (const t of compile(audition.state).tracks) {
    expect(t.clip_schedule).toBeDefined();
    expect(t.audition_schedule?.clips[0].content[0].pad).toBe(12);
  }
});
