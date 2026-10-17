import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { buildPersistedAppStateSnapshot, normalizeControllerSteps, normalizeSequencerState } from "./appStoreModel";
import { buildPerformanceExportPayload, parsePerformanceExportPayload } from "../lib/bundleImportExport";
import { controllerPadHasContent } from "../lib/patternWorkspace";
import fixture from "../../../backend/tests/fixtures/sequencers/controller_steps.json";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().addControllerSequencer();
});
const track = () => useAppStore.getState().sequencer.controllerSequencers[0];

it("defaults to curves and normalizes 128 independent nullable cells", () => {
  expect(track().controllerMode).toBe("curve");
  expect(track().resetValue).toBe(0);
  expect(track().pads.every(pad => pad.steps.length === 128 && pad.steps.every(v => v === null))).toBe(true);
  expect(track().pads[0].steps).not.toBe(track().pads[1].steps);
  expect(normalizeControllerSteps([0, 127, null, -1, 128, 1.5, true, "4"]).slice(0, 8)).toEqual([0, 127, null, null, null, null, null, null]);
});

it("preserves both modes through pad copy and clears only the displayed mode", () => {
  const s = useAppStore.getState(), id = track().id;
  s.addControllerSequencerKeypoint(id, .5, 90);
  const curve = track().pads[0].keypoints;
  s.setControllerSequencerMode(id, "step");
  s.setControllerSequencerStep(id, 0, 0);
  expect(controllerPadHasContent(track().pads[0], "step")).toBe(true);
  s.copyControllerSequencerPad(id, 0, 1);
  expect(track().pads[1].steps[0]).toBe(0);
  expect(track().pads[1].keypoints).toEqual(curve);
  s.clearControllerSequencerSteps(id);
  expect(track().pads[0].steps.every(v => v === null)).toBe(true);
  expect(track().pads[0].keypoints).toEqual(curve);
  expect(track().pads[1].steps[0]).toBe(0);
  s.setControllerSequencerMode(id, "curve");
  s.clearControllerSequencerSteps(id);
  expect(track().pads[0].keypoints).toHaveLength(2);
  expect(track().pads[1].keypoints).toEqual(curve);
});

it("edits the displayed pad during playback and keeps hidden cells on resize", () => {
  const s = useAppStore.getState(), id = track().id;
  s.syncSequencerTransportRuntime({ isPlaying: true, transportSubunit: 1000, playhead: 3 });
  s.selectSequencerEditingPad(id, 2);
  s.setControllerSequencerQueuedPad(id, 3);
  s.setControllerSequencerMode(id, "step");
  s.setControllerSequencerStep(id, 15, 73);
  expect(track().pads[2].steps[15]).toBe(73);
  expect(track().pads[0].steps[15]).toBeNull();
  s.setControllerSequencerStepCount(id, 1);
  s.setControllerSequencerStepCount(id, 4);
  expect(track().pads[2].steps[15]).toBe(73);
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(1000);
  expect(track().queuedPad).toBe(3);
});

it("round trips v20 and legacy defaults through native bundles and app-state v3", () => {
  const s = useAppStore.getState(), id = track().id;
  s.setControllerSequencerMode(id, "step");
  s.setControllerSequencerResetValue(id, fixture.controller_tracks[0].reset_value);
  fixture.controller_tracks[0].pads[0].steps.forEach((v, index) => s.setControllerSequencerStep(id, index, v));
  const snapshot = useAppStore.getState().buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(20);
  const native = buildPerformanceExportPayload({ snapshot, selectedPatches: [], performanceName: "Steps", performanceDescription: "" });
  const restored = parsePerformanceExportPayload(JSON.parse(JSON.stringify(native.payload)))!;
  s.applySequencerConfigSnapshot(restored.performance.config);
  const saved = buildPersistedAppStateSnapshot(useAppStore.getState());
  expect(saved.version).toBe(3);
  const loaded = normalizeSequencerState(JSON.parse(JSON.stringify(saved.sequencer))).controllerSequencers[0];
  expect(loaded.controllerMode).toBe("step");
  expect(loaded.resetValue).toBe(12);
  expect(loaded.pads[0].steps.slice(0, 8)).toEqual(fixture.controller_tracks[0].pads[0].steps);
  const legacy = JSON.parse(JSON.stringify(snapshot));
  legacy.version = 19;
  delete legacy.sequencer.controllerSequencers[0].controllerMode;
  delete legacy.sequencer.controllerSequencers[0].resetValue;
  legacy.sequencer.controllerSequencers[0].pads.forEach((p: Record<string, unknown>) => delete p.steps);
  s.applySequencerConfigSnapshot(legacy);
  expect(track().controllerMode).toBe("curve");
  expect(track().resetValue).toBe(0);
  expect(track().pads[0].steps.every(v => v === null)).toBe(true);
});

it.each([false, true])("retains controller variation history, including legacy snapshots: %s", legacy => {
  const s = useAppStore.getState(), id = track().id;
  s.addControllerSequencerKeypoint(id, .5, 90);
  if (!legacy) {
    s.setControllerSequencerMode(id, "step");
    s.setControllerSequencerStep(id, 0, 64);
  }
  s.commitArrangerEdit("variation", [{ id, kind: "controller", copyPad: { from: 0, to: 1 } }]);
  s.undoArranger();
  const saved = JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()));
  if (legacy) {
    saved.version = 19;
    const stripSteps = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if ("keypoints" in object) delete object.steps;
      Object.values(object).forEach(stripSteps);
    };
    stripSteps(saved);
  }
  s.applySequencerConfigSnapshot(saved);
  expect(useAppStore.getState().arrangerHistoryNotice).toBe(false);
  expect(useAppStore.getState().arrangerHistory.cursor).toBe(0);
  s.redoArranger();
  expect(track().pads[1].keypoints).toEqual(track().pads[0].keypoints);
  expect(track().pads[1].steps[0]).toBe(legacy ? null : 64);
});
