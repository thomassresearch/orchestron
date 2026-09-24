import { beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import { useAppStore } from "./useAppStore";
import { arrangementRangeLanes, copyArrangementRange, placeArrangementRange } from "../lib/arrangementRange";
import { sequencerTransportSubunitsPerBeat } from "../lib/sequencer";
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot } from "./appStoreModel";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  useAppStore.getState().addDrummerSequencerTrack();
  useAppStore.getState().addControllerSequencer();
  useAppStore.getState().addArpeggiator();
  const sequencer = useAppStore.getState().sequencer;
  const pattern = { rootSequence: [{ type: "pad" as const, padIndex: 0 }, { type: "pad" as const, padIndex: 1 }], groups: [], superGroups: [] };
  const configure = <T extends { pads: { lengthBeats: number }[] }>(track: T) => ({ ...track, padLoopEnabled: false, padLoopRepeat: true,
    padLoopPattern: structuredClone(pattern), padLoopSequence: [0, 1], pads: track.pads.map(p => ({ ...p, lengthBeats: 4 as const })) });
  useAppStore.setState({ sequencer: { ...sequencer, tracks: sequencer.tracks.map(configure), drummerTracks: sequencer.drummerTracks.map(configure),
    controllerSequencers: sequencer.controllerSequencers.map(configure), arpeggiators: sequencer.arpeggiators.map(t => ({ ...configure(t), playbackMode: "arranger" })) } });
});

it("commits all four lane types as one revision and one notification while preserving live transport and Manual pads", () => {
  const initial = useAppStore.getState();
  const id = initial.sequencer.tracks[0].id;
  initial.syncSequencerRuntime({ isPlaying: true, playhead: 9, cycle: 3, transportSubunit: 44200,
    tracks: [{ trackId: id, activePad: 3, queuedPad: 4, enabled: true, runtimePadStartSubunit: -6720 }] });
  const before = useAppStore.getState();
  const lanes = arrangementRangeLanes(before.sequencer);
  const range = { startSubunit: 0, endSubunit: 4 * sequencerTransportSubunitsPerBeat(), laneIds: lanes.map(l => l.id) };
  const update = placeArrangementRange(lanes, copyArrangementRange(lanes, range), range.endSubunit, "insert-all");
  const notify = vi.fn();
  const unsubscribe = useAppStore.subscribe(notify);
  before.applyArrangementRangeEdit(update);
  unsubscribe();
  const after = useAppStore.getState();
  expect(notify).toHaveBeenCalledTimes(1);
  expect(after.sequencerEditRevision).toBe(before.sequencerEditRevision + 1);
  expect(after.sequencerRuntime).toEqual(before.sequencerRuntime);
  expect(after.sequencer.arrangerLoopSelection).toEqual(before.sequencer.arrangerLoopSelection);
  for (const key of ["tracks", "drummerTracks", "controllerSequencers", "arpeggiators"] as const) {
    expect(after.sequencer[key][0].padLoopPattern.rootSequence).toEqual([{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 0 }, { type: "pad", padIndex: 1 }]);
    if (key !== "arpeggiators") expect(after.sequencer[key][0].padLoopSequence).toEqual([0, 0, 1]);
    expect(after.sequencer[key][0].padLoopEnabled).toBe(false);
    expect(after.sequencer[key][0].padLoopRepeat).toBe(true);
    expect(after.sequencer[key][0].activePad).toBe(before.sequencer[key][0].activePad);
    expect(after.sequencer[key][0].pads).toEqual(before.sequencer[key][0].pads);
  }
});

it("validates the entire batch before applying any lane", () => {
  const before = useAppStore.getState();
  const lanes = arrangementRangeLanes(before.sequencer);
  expect(() => before.applyArrangementRangeEdit(lanes.map((lane, index) => ({ id: lane.id, kind: lane.kind,
    rootSequence: index === lanes.length - 1 ? [{ type: "group", groupId: "MISSING" }] : [{ type: "pause", lengthBeats: 16 }] })))).toThrow();
  expect(useAppStore.getState()).toBe(before);
  expect(() => before.applyArrangementRangeEdit([{ id: "deleted", kind: "sequencer", rootSequence: [] }])).toThrow();
  expect(useAppStore.getState()).toBe(before);
});

it("round-trips batch edits in the existing v16 format without session editor data", () => {
  const before = useAppStore.getState();
  const lanes = arrangementRangeLanes(before.sequencer);
  before.applyArrangementRangeEdit(lanes.map(lane => ({ id: lane.id, kind: lane.kind, rootSequence: [{ type: "pad", padIndex: 0 }, { type: "pause", lengthBeats: 16 }, { type: "pad", padIndex: 1 }] })));
  const after = useAppStore.getState();
  const saved = buildSequencerConfigSnapshot(after.sequencer, after.sequencerInstruments, after.audioGraph, after.mixer);
  expect(saved.version).toBe(17);
  const restored = parseSequencerConfigSnapshot(saved, [], "fixture-patch").sequencer;
  expect(arrangementRangeLanes(restored).map(l => l.pattern)).toEqual(arrangementRangeLanes(after.sequencer).map(l => l.pattern));
  expect(JSON.stringify(saved)).not.toMatch(/rangeClipboard|rangeHistory|editCursor|editRange/);
});
