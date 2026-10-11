import { beforeEach, expect, it } from "vitest";
import { buildPerformanceExportPayload, parsePerformanceExportPayload } from "../lib/bundleImportExport";
import { MAX_SEQUENCERS_PER_TYPE } from "../lib/sequencer";
import {
  buildPersistedAppStateSnapshot,
  defaultControllerSequencer,
  defaultDrummerSequencerTrack,
  defaultSequencerTrack,
  normalizeSequencerState
} from "./appStoreModel";
import { useAppStore } from "./useAppStore";

const deviceKeys = ["tracks", "drummerTracks", "controllerSequencers"] as const;

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

function populateDevices(count: number) {
  const sequencer = useAppStore.getState().sequencer;
  const indices = Array.from({ length: count }, (_, index) => index + 1);
  const tracks = indices.map(index => {
    const track = defaultSequencerTrack(index, (index - 1) % 16 + 1, sequencer.timing);
    track.pads[0].steps[0].note = 48 + index;
    track.pads[0].steps[0].velocity = 70 + index;
    track.padLoopEnabled = true;
    track.padLoopRepeat = false;
    track.padLoopPattern.rootSequence = [{ type: "pause", lengthBeats: 4 }, { type: "pad", padIndex: 0 }];
    track.padLoopSequence = [-4, 0];
    return track;
  });
  // A reference to a late track must survive normalization, too.
  tracks[0].syncToTrackId = tracks[count - 1].id;
  const drummerTracks = indices.map(index => {
    const track = defaultDrummerSequencerTrack(index, 10, sequencer.timing);
    track.pads[0].rows[0].steps[0].active = true;
    track.pads[0].rows[0].steps[0].velocity = 80 + index;
    return track;
  });
  const controllerSequencers = indices.map(index => {
    const track = defaultControllerSequencer(index, sequencer.timing);
    track.controllerNumber = index;
    track.targetChannels = [(index - 1) % 16 + 1];
    track.pads[0].keypoints = track.pads[0].keypoints.map(point => ({ ...point, value: 40 + index }));
    track.keypoints = structuredClone(track.pads[0].keypoints);
    return track;
  });
  useAppStore.setState({ sequencer: { ...sequencer, tracks, drummerTracks, controllerSequencers } });
}

it.each([9, 14, 16])("preserves all %i devices of each type through native import and autosave reload", count => {
  populateDevices(count);
  const expected = useAppStore.getState().buildSequencerConfigSnapshot();
  const native = buildPerformanceExportPayload({ snapshot: expected, selectedPatches: [], performanceName: "Many voices", performanceDescription: "" });
  const imported = parsePerformanceExportPayload(JSON.parse(JSON.stringify(native.payload)));
  expect(imported).not.toBeNull();
  useAppStore.getState().applySequencerConfigSnapshot(imported!.performance.config);
  expect(useAppStore.getState().error).toBeNull();
  const actual = useAppStore.getState().buildSequencerConfigSnapshot();
  for (const key of deviceKeys) {
    expect(actual.sequencer[key]).toHaveLength(count);
    expect(actual.sequencer[key]).toEqual(expected.sequencer[key]);
  }

  const persisted = JSON.parse(JSON.stringify(buildPersistedAppStateSnapshot(useAppStore.getState())));
  const reloaded = normalizeSequencerState(persisted.sequencer);
  for (const key of deviceKeys) {
    expect(reloaded[key]).toHaveLength(count);
    expect(reloaded[key]).toEqual(useAppStore.getState().sequencer[key]);
  }
});

it("enforces the supported device limit on imports without reducing it to the pad limit", () => {
  populateDevices(MAX_SEQUENCERS_PER_TYPE + 1);
  const input = useAppStore.getState().sequencer;
  const loaded = normalizeSequencerState(input);
  for (const key of deviceKeys) {
    expect(loaded[key]).toHaveLength(MAX_SEQUENCERS_PER_TYPE);
    expect(loaded[key].map(track => track.id)).toEqual(input[key].slice(0, MAX_SEQUENCERS_PER_TYPE).map(track => track.id));
  }
  expect(loaded.tracks[0].syncToTrackId).toBeNull();
});
