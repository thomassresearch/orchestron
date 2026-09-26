import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { normalizeDrummerSequencerCell, parseSequencerConfigSnapshot } from "./appStoreModel";
import { buildDrummerRowTrackConfigs } from "../appOrchestration";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

it("edits the displayed pad and preserves ratchets in copies, saved data and runtime requests", () => {
  const store = useAppStore.getState();
  store.addDrummerSequencerTrack();
  const drum = useAppStore.getState().sequencer.drummerTracks[0];
  const row = drum.rows[0].id;
  store.selectSequencerEditingPad(drum.id, 1);
  store.setDrummerSequencerCellRatchets(drum.id, row, 2, 4, 40);
  expect(useAppStore.getState().sequencer.drummerTracks[0].pads[0].rows[0].steps[2].ratchets).toBe(1);
  expect(useAppStore.getState().sequencer.drummerTracks[0].pads[1].rows[0].steps[2]).toMatchObject({ active: false, ratchets: 4, ratchetEndVelocity: 40 });
  store.toggleDrummerSequencerCell(drum.id, row, 2, true);
  store.copyDrummerSequencerPad(drum.id, 1, 2);
  const snapshot = store.buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(18);
  const restored = parseSequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot)), [], null);
  const loaded = restored.sequencer.drummerTracks[0];
  expect(loaded.pads[2].rows[0].steps[2]).toMatchObject({ active: true, ratchets: 4, ratchetEndVelocity: 40 });
  expect(buildDrummerRowTrackConfigs(loaded)[0].pads[2].steps[2]).toMatchObject({ ratchets: 4, ratchet_end_velocity: 40 });
  store.toggleDrummerSequencerCell(drum.id, row, 2, false);
  expect(useAppStore.getState().sequencer.drummerTracks[0].pads[1].rows[0].steps[2]).toMatchObject({ active: false, ratchets: 4, ratchetEndVelocity: 40 });
  store.clearDrummerSequencerTrackSteps(drum.id);
  expect(useAppStore.getState().sequencer.drummerTracks[0].pads[1].rows[0].steps[2]).toMatchObject({ ratchets: 1, ratchetEndVelocity: null });
});

it("defaults legacy cells and normalizes invalid persisted values", () => {
  for (const raw of [null, false, true, 100, { active: true, velocity: 90 }]) {
    expect(normalizeDrummerSequencerCell(raw)).toMatchObject({ ratchets: 1, ratchetEndVelocity: null });
  }
  expect(normalizeDrummerSequencerCell({ ratchets: 10.5, ratchetEndVelocity: -30 })).toMatchObject({ ratchets: 8, ratchetEndVelocity: 0 });
  expect(normalizeDrummerSequencerCell({ ratchets: NaN, ratchetEndVelocity: Infinity })).toMatchObject({ ratchets: 1, ratchetEndVelocity: null });
});

it("keeps v17 meter timing unchanged while upgrading the saved version", () => {
  const store = useAppStore.getState();
  store.addDrummerSequencerTrack();
  const drum = useAppStore.getState().sequencer.drummerTracks[0];
  store.setDrummerSequencerTrackMeterDenominator(drum.id, 8);
  const before = store.buildSequencerConfigSnapshot();
  before.version = 17;
  store.applySequencerConfigSnapshot(before);
  const after = store.buildSequencerConfigSnapshot();
  expect(after.version).toBe(18);
  expect(after.sequencer.drummerTracks).toEqual(before.sequencer.drummerTracks);
});


it("retains ratchets on hidden steps through grid changes and saved restoration", () => {
  const store = useAppStore.getState();
  store.addDrummerSequencerTrack();
  const drum = useAppStore.getState().sequencer.drummerTracks[0];
  store.setDrummerSequencerCellRatchets(drum.id, drum.rows[0].id, 63, 8, 0);
  store.setDrummerSequencerTrackStepsPerBeat(drum.id, 1);
  store.applySequencerConfigSnapshot(store.buildSequencerConfigSnapshot());
  store.setDrummerSequencerTrackStepCount(drum.id, 16);
  store.setDrummerSequencerTrackStepsPerBeat(drum.id, 8);
  const restored = useAppStore.getState().sequencer.drummerTracks[0];
  expect(restored.stepCount).toBe(128);
  expect(restored.pads[0].rows[0].steps[63]).toMatchObject({ active: false, ratchets: 8, ratchetEndVelocity: 0 });
});
