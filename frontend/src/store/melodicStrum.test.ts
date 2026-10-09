import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { normalizeSequencerStep, parseSequencerConfigSnapshot } from "./appStoreModel";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
it("preserves inactive strums, hidden steps, copies and v19 round trips, then clears them", () => {
  const store = useAppStore.getState(); store.addSequencerTrack();
  const id = useAppStore.getState().sequencer.tracks[0].id;
  store.setSequencerTrackStepNote(id, 1, 60); store.setSequencerTrackStepChord(id, 1, "maj");
  store.setSequencerTrackStepStrum(id, 1, "down", 100);
  store.setSequencerTrackStepTimingOffset(id, 1, -20);
  store.copySequencerTrackStepSettings(id, 1, id, 100);
  store.setSequencerTrackStepChord(id, 1, "none"); store.setSequencerTrackStepNote(id, 1, null);
  const snapshot = store.buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(19);
  const restored = parseSequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot)), [], null);
  expect(restored.sequencer.tracks[0].pads[0].steps[1]).toMatchObject({ note: null, chord: "none", strumDirection: "down", strumSpreadPercent: 100 });
  expect(restored.sequencer.tracks[0].pads[0].steps[100]).toMatchObject({ note: 60, chord: "maj", timingOffsetPercent: -20, strumDirection: "down", strumSpreadPercent: 100 });
  store.clearSequencerTrackSteps(id);
  expect(useAppStore.getState().sequencer.tracks[0].steps[100]).toMatchObject({ strumDirection: "off", strumSpreadPercent: 0 });
});
it("targets the editing pad without changing the sounding pad", () => {
  const store = useAppStore.getState(); store.addSequencerTrack();
  const id = useAppStore.getState().sequencer.tracks[0].id;
  store.selectSequencerEditingPad(id, 2);
  store.setSequencerTrackStepStrum(id, 0, "up", 40);
  const track = useAppStore.getState().sequencer.tracks[0];
  expect(track.activePad).toBe(0);
  expect(track.pads[2].steps[0]).toMatchObject({ note: null, strumDirection: "up", strumSpreadPercent: 40 });
  expect(track.pads[0].steps[0].strumDirection).toBe("off");
});
it("defaults legacy steps and normalizes persisted values", () => {
  expect(normalizeSequencerStep(60)).toMatchObject({ strumDirection: "off", strumSpreadPercent: 0 });
  expect(normalizeSequencerStep({ note: 60, strumDirection: "other", strumSpreadPercent: 101 })).toMatchObject({ strumDirection: "off", strumSpreadPercent: 100 });
  expect(normalizeSequencerStep({ strum_direction: "down", strum_spread_percent: 40 })).toMatchObject({ strumDirection: "down", strumSpreadPercent: 40 });
});
