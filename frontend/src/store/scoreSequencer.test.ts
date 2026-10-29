import { beforeEach, expect, it } from "vitest";
import fixture from "../../../backend/tests/fixtures/sequencers/score.json";
import { useAppStore } from "./useAppStore";
import { addScoreTrack, selectScorePad, updateScoreTrack } from "./scoreActions";
import { buildPersistedAppStateSnapshot, normalizeSequencerState } from "./appStoreModel";
import { normalizeScoreTrack, scoreTrackConfig, scoreHasContent } from "../lib/scoreSequencer";
import { buildPerformanceExportPayload, parsePerformanceExportPayload } from "../lib/bundleImportExport";
import { arrangementRangeLanes, resolveArrangementRange, copyArrangementRange } from "../lib/arrangementRange";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import { parseSequencerPadSwitchesEventPayload } from "../lib/sequencerRuntime";
import { arrangerTransportExtent } from "../lib/arrangerTransport";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
const track = () => useAppStore.getState().sequencer.scoreTracks[0];
const load = () => {
  const sequencer = normalizeSequencerState({ ...useAppStore.getState().sequencer, scoreTracks: [fixture.authored] });
  useAppStore.setState({ sequencer });
};

it("defaults eight independent four-bar sparse pads and migrates old performances", () => {
  expect(normalizeSequencerState({ tracks: [] }).scoreTracks).toEqual([]);
  addScoreTrack("Score Sequencer");
  expect(track().pads).toHaveLength(8);
  expect(track().pads.every(p => p.lengthBeats === 16 && p.notes.length === 0 && p.steps.length === 0)).toBe(true);
  expect(track().pads[0].notes).not.toBe(track().pads[1].notes);
});

it("preserves tick positions and hidden notes through length, grid, scale and tempo changes", () => {
  load(); const original = track().pads[0].notes;
  updateScoreTrack(track().id, t => ({ ...t, timing: { ...t.timing, stepsPerBeat: 3 }, pads: t.pads.map(p => ({ ...p, lengthBeats: 1, scaleRoot: "D" })) }));
  expect(track().pads[0].notes).toEqual(original);
  useAppStore.getState().setSequencerBpm(147);
  expect(track().timing.tempoBPM).toBe(147);
  updateScoreTrack(track().id, t => ({ ...t, pads: t.pads.map(p => ({ ...p, lengthBeats: 1600 })) }));
  expect(track().pads[0].notes).toEqual(original);
  expect(scoreHasContent(track().pads[0], track().timing)).toBe(true);
});

it("separates editing, sounding, queued and saved starting pads", () => {
  load(); const id = track().id;
  useAppStore.getState().syncSequencerRuntime({ isPlaying: true, tracks: [{ trackId: id, activePad: 1, queuedPad: 3, enabled: true }] });
  const revision = useAppStore.getState().sequencerEditRevision;
  selectScorePad(id, 2);
  updateScoreTrack(id, t => ({ ...t, pads: t.pads.map((p, i) => i === t.activePad ? { ...p, lengthBeats: 500 } : p) }));
  expect(track().pads[2].lengthBeats).toBe(500);
  expect(track().pads[0].lengthBeats).toBe(1200);
  expect(track().activePad).toBe(0);
  const s = useAppStore.getState();
  expect(mergedSequencerState(s.sequencer, s.sequencerRuntime).scoreTracks[0]).toMatchObject({ activePad: 1, queuedPad: 3 });
  expect(s.sequencerEditRevision).toBe(revision + 1);
});

it("round trips v21, app-state v4 and native bundles with independent notes and stable IDs", () => {
  load(); const s = useAppStore.getState();
  const snapshot = s.buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(21);
  const exported = buildPerformanceExportPayload({ snapshot, selectedPatches: [], performanceName: "Score", performanceDescription: "" });
  const restored = parsePerformanceExportPayload(JSON.parse(JSON.stringify(exported.payload)))!;
  s.applySequencerConfigSnapshot(restored.performance.config);
  const saved = buildPersistedAppStateSnapshot(useAppStore.getState());
  expect(saved.version).toBe(4);
  expect(normalizeSequencerState(JSON.parse(JSON.stringify(saved.sequencer))).scoreTracks[0].pads[0].notes).toEqual(fixture.authored.pads[0].notes);
  const runtime = scoreTrackConfig(track());
  expect(runtime.pads).toEqual(fixture.runtime.pads);
  expect(runtime.length_beats).toBe(1200);
});

it("keeps a long score indivisible in arranger ranges, variations and history", () => {
  load(); const s = useAppStore.getState(), id = track().id;
  s.commitArrangerEdit("place", [{ kind: "score", id, pattern: { ...track().padLoopPattern, rootSequence: [{ type: "pad", padIndex: 0 }] } }]);
  const state = useAppStore.getState();
  expect(arrangerTransportExtent(state.sequencer)).toBe(1200 * 8);
  const lanes = arrangementRangeLanes(state.sequencer);
  const range = resolveArrangementRange(lanes, { laneIds: [id], startSubunit: 20160, endSubunit: 40320 });
  expect(range).toMatchObject({ startSubunit: 0, endSubunit: 1200 * 20160 });
  expect(copyArrangementRange(lanes, range).lanes[0].rootSequence).toEqual([{ type: "pad", padIndex: 0 }]);
  s.commitArrangerEdit("variation", [{ kind: "score", id, copyPad: { from: 0, to: 2 } }]);
  expect(track().pads[2].notes).toEqual(track().pads[0].notes);
  s.undoArranger(); expect(track().pads[2].notes).toEqual([]);
  s.redoArranger(); expect(track().pads[2].notes).toEqual(track().pads[0].notes);
  updateScoreTrack(id, t => ({ ...t, pads: t.pads.map((p, i) => i === 0 ? { ...p, lengthBeats: 1000 } : p) }));
  expect(useAppStore.getState().arrangerHistory.entries).toEqual([]);
});

it("rejects over-limit edits atomically and rejects duplicate IDs", () => {
  load(); const original = track();
  expect(() => updateScoreTrack(original.id, t => ({ ...t, pads: t.pads.map(p => ({ ...p, notes: Array.from({ length: 10001 }, (_, i) => ({ ...p.notes[0], id: String(i) })) })) }))).toThrow();
  expect(track()).toBe(original);
  expect(() => normalizeScoreTrack({ ...fixture.authored, pads: [{ ...fixture.authored.pads[0], notes: [fixture.authored.pads[0].notes[0], fixture.authored.pads[0].notes[0]] }] }, 1, original.timing)).toThrow();
});


it("clears the queued pad when an audible score launch marker arrives", () => {
  load(); const id = track().id;
  useAppStore.getState().syncSequencerRuntime({ isPlaying: true, tracks: [{ trackId: id, activePad: 0, queuedPad: 1 }] });
  const event = parseSequencerPadSwitchesEventPayload({ session_id: "score", ts: "", type: "sequencer_pad_switches", payload: {
    cycle: 1, current_step: 0, running: true, step_count: 32, transport_subunit: 80640,
    tracks: [{ track_id: id, local_step: 0 }], controller_tracks: [],
    switches: [{ track_id: id, track_kind: "note", active_pad: 1, queued_pad: null, pad_loop_position: null, runtime_pad_start_subunit: 80640 }]
  } })!;
  expect(event.switches[0].queued_pad).toBeNull();
  useAppStore.getState().syncSequencerRuntime({ isPlaying: true, tracks: event.switches.map(t => ({ trackId: t.track_id, activePad: t.active_pad, queuedPad: t.queued_pad, runtimePadStartSubunit: t.runtime_pad_start_subunit })) });
  const state = useAppStore.getState();
  expect(mergedSequencerState(state.sequencer, state.sequencerRuntime).scoreTracks[0]).toMatchObject({ activePad: 1, queuedPad: null });
});
