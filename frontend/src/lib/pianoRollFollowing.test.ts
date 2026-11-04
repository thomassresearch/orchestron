import { describe, expect, it } from "vitest";
import { defaultSequencerState, sequencerRuntimeStateFromSequencer } from "../store/appStoreModel";
import { migrateClipArrangement } from "./clipArranger/migration";
import { beginDraft } from "./clipArranger/operations";
import { clipAuditionState } from "./clipArranger/runtime";
import { pianoRollFollowingTheories } from "./pianoRollFollowing";
import type { PerformanceAuditionStatus } from "../types";

const Q = 20160;
function fixture() {
  const state = defaultSequencerState();
  state.tracks = state.tracks.slice(0, 1);
  state.scoreTracks = []; state.drummerTracks = []; state.controllerSequencers = []; state.arpeggiators = [];
  state.pianoRolls = state.pianoRolls.slice(0, 1);
  const track = state.tracks[0];
  track.padLoopEnabled = true;
  track.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }];
  state.clipArrangement = migrateClipArrangement(state).model!;
  const lane = state.clipArrangement.lanes[0], clip = lane.clips[0];
  const definition = lane.definitions[0];
  if (definition.kind !== "pattern" || definition.source !== "sequencer") throw Error("Expected melodic pattern");
  definition.payload = { ...definition.payload, scaleRoot: "E", scaleType: "minor", mode: "aeolian" };
  const runtime = sequencerRuntimeStateFromSequencer(state);
  Object.assign(runtime, { isPlaying: true, independentSources: true, arrangementRunning: true, arrangementPlaybackSubunit: 0,
    trackStateById: { [track.id]: { enabled: true, activePad: 0, runtimePadStartSubunit: 0 } } });
  return { state, track, lane, clip, definition, runtime };
}
const eMinor = [{ scaleRoot: "E", scaleType: "minor", mode: "aeolian" }];

describe("piano roll harmonic following", () => {
  it("reads the playing clip, ignores legacy C pads and unused definitions, and follows changes", () => {
    const { state, runtime, lane, clip, definition } = fixture();
    const next = { ...structuredClone(definition), id: "next", payload: { ...definition.payload, scaleRoot: "G" as const, scaleType: "major" as const, mode: "ionian" as const } };
    lane.definitions.push(next);
    clip.children.push({ id: "next-use", definitionId: next.id }); clip.length = 8 * Q;
    state.clipArrangement!.end = 8 * Q;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual(eMinor);
    runtime.arrangementPlaybackSubunit = 4 * Q;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual([{ scaleRoot: "G", scaleType: "major", mode: "ionian" }]);
  });

  it("drops harmonic guidance while stopped, paused, disabled, in gaps, rests, or past song end", () => {
    const { state, runtime, track, clip } = fixture();
    expect(pianoRollFollowingTheories(state, { ...runtime, isPlaying: false }, {}, null)).toEqual([]);
    expect(pianoRollFollowingTheories(state, { ...runtime, arrangementRunning: false }, {}, null)).toEqual([]);
    expect(pianoRollFollowingTheories(state, { ...runtime, trackStateById: {} }, {}, null)).toEqual([]);
    runtime.trackStateById[track.id].enabled = false;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual([]);
    runtime.trackStateById[track.id].enabled = true;
    clip.start = Q;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual([]);
    clip.start = 0; clip.children.unshift({ id: "rest", restTicks: Q });
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual([]);
    runtime.arrangementPlaybackSubunit = Q;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual(eMinor);
    runtime.arrangementPlaybackSubunit = clip.length;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual([]);
    runtime.arrangementPlaybackSubunit = state.clipArrangement!.end;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual([]);
  });

  it("resolves trimmed looping clips and lane cycles in song coordinates", () => {
    const { state, runtime, lane, clip } = fixture();
    clip.children.unshift({ id: "rest", restTicks: Q });
    clip.offset = Q; clip.mode = "loop"; clip.length = 10 * Q;
    lane.cycleTicks = 12 * Q; state.clipArrangement!.end = 30 * Q;
    runtime.transportSubunit = 100 * Q;
    runtime.arrangementPlaybackSubunit = 12 * Q;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual(eMinor);
    runtime.arrangementPlaybackSubunit = 16 * Q;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual([]);
  });

  it("waits for an audible audition, resolves slots beyond eight, and restores arranged theory", () => {
    const { state, runtime, lane, clip, track } = fixture();
    const draft = beginDraft(state.clipArrangement!, { laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 });
    if (draft.definition.kind !== "pattern" || draft.definition.source !== "sequencer") throw Error("Expected melodic pattern");
    draft.definition.payload = { ...draft.definition.payload, scaleRoot: "D", scaleType: "neutral", mode: "dorian" };
    const compiled = clipAuditionState(state, draft);
    expect(compiled.sequence[0]).toBe(8);
    const auditions: PerformanceAuditionStatus = { [lane.id]: { active: false, queued: null, workspace_queued: true, workspace_active: false } };
    expect(pianoRollFollowingTheories(state, runtime, auditions, draft)).toEqual(eMinor);
    Object.assign(auditions[lane.id], { active: true, workspace_active: true, workspace_queued: false, workspace_sequence: compiled.sequence, workspace_position: 0 });
    runtime.arrangementRunning = false;
    // Legacy activePad may be clamped; workspace status retains the actual compiled slot.
    runtime.trackStateById[track.id].activePad = 7;
    expect(pianoRollFollowingTheories(state, runtime, auditions, draft)).toEqual([{ scaleRoot: "D", scaleType: "neutral", mode: "dorian" }]);
    auditions[lane.id].workspace_sequence = [-1, ...compiled.sequence];
    expect(pianoRollFollowingTheories(state, runtime, auditions, draft)).toEqual([]);
    auditions[lane.id].workspace_position = 1;
    expect(pianoRollFollowingTheories(state, runtime, auditions, draft)[0]?.scaleRoot).toBe("D");
    runtime.arrangementRunning = true;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual(eMinor);
  });

  it("uses playing legacy pads rather than editor selection and ignores stopped peers", () => {
    const { state, runtime, track } = fixture();
    delete state.clipArrangement;
    track.pads[1] = { ...track.pads[1], scaleRoot: "E" };
    runtime.trackStateById[track.id].activePad = 1;
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual(eMinor);
    state.tracks.push({ ...track, id: "stopped" });
    runtime.trackStateById.stopped = { enabled: false, activePad: 0 };
    expect(pianoRollFollowingTheories(state, runtime, {}, null)).toEqual(eMinor);
  });
});
