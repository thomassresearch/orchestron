import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { buildPersistedAppStateSnapshot, parseSequencerConfigSnapshot } from "./appStoreModel";

const keys = { sequencer: "tracks", drummer: "drummerTracks", controller: "controllerSequencers", arpeggiator: "arpeggiators" } as const;
const store = () => useAppStore.getState();
const pad = (padIndex: number) => ({ type: "pad" as const, padIndex });

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  store().addDrummerSequencerTrack();
  store().addControllerSequencer();
  store().addArpeggiator();
});

it.each(Object.keys(keys) as (keyof typeof keys)[])("defaults %s to Manual pads, selects Arrangement on first placement, and persists later choices", kind => {
  const key = keys[kind];
  const track = () => store().sequencer[key][0];
  const id = track().id;
  expect(track().padLoopEnabled).toBe(false);
  expect(track().padLoopPattern.rootSequence).toEqual([]);
  // Range paste shares the same first-placement default as an individual drop.
  store().applyArrangementRangeEdit([{ id, kind, rootSequence: [pad(0)] }]);
  expect(track().padLoopEnabled).toBe(true);
  store().undoArranger();
  expect(track().padLoopEnabled).toBe(false);
  expect(track().padLoopPattern.rootSequence).toEqual([]);
  store().redoArranger();
  expect(track().padLoopEnabled).toBe(true);

  const choose = (enabled: boolean) => {
    if (kind === "sequencer") store().setSequencerTrackPadLoopEnabled(id, enabled);
    else if (kind === "drummer") store().setDrummerSequencerTrackPadLoopEnabled(id, enabled);
    else if (kind === "controller") store().setControllerSequencerPadLoopEnabled(id, enabled);
    else store().updateArpeggiator(id, { padLoopEnabled: enabled });
  };
  for (const enabled of [false, true]) {
    choose(enabled);
    store().commitArrangerEdit("place", [{ id, kind, pattern: { ...track().padLoopPattern, rootSequence: [pad(0), pad(1)] } }]);
    store().applyArrangementRangeEdit([{ id, kind, rootSequence: [pad(1), pad(0)] }]);
    expect(track().padLoopEnabled).toBe(enabled);
    const saved = JSON.parse(JSON.stringify(store().buildSequencerConfigSnapshot()));
    expect(parseSequencerConfigSnapshot(saved, [], null).sequencer[key][0].padLoopEnabled).toBe(enabled);
    store().applySequencerConfigSnapshot(saved);
    expect(track().padLoopEnabled).toBe(enabled);
    expect(buildPersistedAppStateSnapshot(store()).sequencer?.[key][0].padLoopEnabled).toBe(enabled);
  }
});
