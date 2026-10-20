import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { buildPersistedAppStateSnapshot, normalizeSequencerState } from "./appStoreModel";
import { buildPerformanceExportPayload, parsePerformanceExportPayload } from "../lib/bundleImportExport";
import { normalizeControllerCurveKeypoints, sampleControllerCurveValue } from "../lib/sequencer";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().addControllerSequencer();
});
const track = () => useAppStore.getState().sequencer.controllerSequencers[0];

it("keeps numeric entries exact near the opposite endpoint, without linking either end", () => {
  const s = useAppStore.getState(), id = track().id;
  const [start, end] = track().keypoints;
  s.setControllerSequencerKeypointValue(id, start.id, 50);
  s.setControllerSequencerKeypointValue(id, end.id, 52);
  expect(track().keypoints.map(p => p.value)).toEqual([50, 52]);
  s.setControllerSequencerKeypointValue(id, start.id, 53);
  expect(track().keypoints.map(p => p.value)).toEqual([53, 52]);
  s.setControllerSequencerKeypoint(id, end.id, .7, 90);
  expect(track().keypoints.map(p => [p.position, p.value])).toEqual([[0, 53], [1, 90]]);
});

it("preserves open curves through copying, native bundles, snapshots and autosave restoration", () => {
  const s = useAppStore.getState(), id = track().id;
  const [start, end] = track().keypoints;
  s.setControllerSequencerKeypointValue(id, start.id, 20);
  s.setControllerSequencerKeypointValue(id, end.id, 90);
  s.copyControllerSequencerPad(id, 0, 1);
  const snapshot = useAppStore.getState().buildSequencerConfigSnapshot();
  const native = buildPerformanceExportPayload({ snapshot, selectedPatches: [], performanceName: "Open curves", performanceDescription: "" });
  const restored = parsePerformanceExportPayload(JSON.parse(JSON.stringify(native.payload)))!;
  s.applySequencerConfigSnapshot(restored.performance.config);
  const saved = buildPersistedAppStateSnapshot(useAppStore.getState());
  const loaded = normalizeSequencerState(JSON.parse(JSON.stringify(saved.sequencer))).controllerSequencers[0];
  for (const pad of loaded.pads.slice(0, 2)) {
    expect(pad.keypoints.map(p => p.value)).toEqual([20, 90]);
    expect(sampleControllerCurveValue(pad.keypoints, 0)).toBe(20);
    expect(sampleControllerCurveValue(pad.keypoints, .5)).toBe(55);
    expect(sampleControllerCurveValue(pad.keypoints, 1)).toBe(90);
  }
});

it("retains closed curves and legacy missing-end defaults", () => {
  const start = { id: "start", position: 0, value: 42 };
  expect(normalizeControllerCurveKeypoints([start]).map(p => p.value)).toEqual([42, 42]);
  expect(normalizeControllerCurveKeypoints([]).map(p => p.value)).toEqual([0, 0]);
  const closed = [start, { id: "middle", position: .5, value: 100 }, { id: "end", position: 1, value: 42 }];
  expect(normalizeControllerCurveKeypoints(closed)).toEqual(closed);
});
