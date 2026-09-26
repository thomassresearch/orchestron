import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { parseSequencerConfigSnapshot, normalizeSequencerStep } from "./appStoreModel";
import { buildDrummerRowTrackConfigs } from "../appOrchestration";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
it("preserves timing through step/pad copy, saved JSON and runtime drum conversion, then clears it", () => {
  const store = useAppStore.getState();
  store.addSequencerTrack(); store.addDrummerSequencerTrack();
  const lead = useAppStore.getState().sequencer.tracks[0];
  const drums = useAppStore.getState().sequencer.drummerTracks[0];
  store.setSequencerTrackStepNote(lead.id, 1, 60);
  store.setSequencerTrackStepTimingOffset(lead.id, 1, -20);
  store.copySequencerTrackStepSettings(lead.id, 1, lead.id, 3);
  store.setDrummerSequencerCellTimingOffset(drums.id, drums.rows[0].id, 1, 25);
  store.toggleDrummerSequencerCell(drums.id, drums.rows[0].id, 1, true);
  store.copyDrummerSequencerPad(drums.id, 0, 1);
  const snapshot = store.buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(18);
  const restored = parseSequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot)), [], null);
  expect(restored.sequencer.tracks[0].pads[0].steps[3].timingOffsetPercent).toBe(-20);
  expect(restored.sequencer.drummerTracks[0].pads[1].rows[0].steps[1].timingOffsetPercent).toBe(25);
  const runtime = buildDrummerRowTrackConfigs(restored.sequencer.drummerTracks[0]);
  expect(runtime[0].pads[0].steps[1]).toMatchObject({ timing_offset_percent: 25 });
  store.clearSequencerTrackSteps(lead.id); store.clearDrummerSequencerTrackSteps(drums.id);
  expect(useAppStore.getState().sequencer.tracks[0].steps[1].timingOffsetPercent).toBe(0);
  expect(useAppStore.getState().sequencer.drummerTracks[0].pads[0].rows[0].steps[1].timingOffsetPercent).toBe(0);
});
it("defaults legacy steps to zero and clamps malformed persisted offsets", () => {
  expect(normalizeSequencerStep(60).timingOffsetPercent).toBe(0);
  expect(normalizeSequencerStep({ note: 60, timingOffsetPercent: 999 }).timingOffsetPercent).toBe(50);
  expect(normalizeSequencerStep({ note: 60, timingOffsetPercent: Number.NaN }).timingOffsetPercent).toBe(0);
  expect(normalizeSequencerStep({ note: 60, timing_offset_percent: -20 }).timingOffsetPercent).toBe(-20);
});
