import { beforeEach, describe, expect, it } from "vitest";

import { sequencerTransportSubunitsPerStep } from "../lib/sequencer";
import type { PatchListItem, SequencerInstrumentBinding } from "../types";
import { useAppStore } from "./useAppStore";

const initialState = useAppStore.getInitialState();

const performablePatch: PatchListItem = {
  id: "patch-1",
  name: "Test Instrument",
  description: "",
  is_template: false,
  always_on: false,
  audio_inlet_names: [],
  audio_outlet_names: [],
  schema_version: 1,
  updated_at: "2026-01-01T00:00:00Z"
};

const instrumentBinding: SequencerInstrumentBinding = {
  id: "instrument-1",
  patchId: performablePatch.id,
  midiChannel: 1,
  level: 8,
  effectSourceIds: [],
  effectRoutes: []
};

describe("app store sequencer behavior", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
  });

  it("keeps transport-only synchronization out of sequencer configuration", () => {
    const sequencerBefore = useAppStore.getState().sequencer;
    const trackId = sequencerBefore.tracks[0].id;

    useAppStore.getState().syncSequencerTransportRuntime({
      isPlaying: true,
      transportStepCount: 16,
      playhead: 19,
      cycle: 2,
      transportSubunit: 12_345,
      tracks: [{ trackId, localStep: 7 }]
    });

    const state = useAppStore.getState();
    expect(state.sequencer).toBe(sequencerBefore);
    expect(state.sequencerRuntime).toMatchObject({
      isPlaying: true,
      stepCount: 16,
      playhead: 3,
      cycle: 2,
      transportSubunit: 12_345
    });
    expect(state.sequencerRuntime.trackLocalStepById[trackId]).toBe(7);
  });

  it("clears all runtime positions when transport synchronization stops", () => {
    const trackId = useAppStore.getState().sequencer.tracks[0].id;
    useAppStore.getState().syncSequencerTransportRuntime({
      isPlaying: true,
      tracks: [{ trackId, localStep: 5 }],
      drummerTracks: [{ trackId: "drummer-1", localStep: 6 }],
      controllerTracks: [{ controllerSequencerId: "controller-1", runtimePadStartSubunit: 840 }]
    });

    useAppStore.getState().syncSequencerTransportRuntime({ isPlaying: false });

    const runtime = useAppStore.getState().sequencerRuntime;
    expect(runtime.isPlaying).toBe(false);
    expect(runtime.trackLocalStepById[trackId]).toBeNull();
    expect(runtime.drummerTrackLocalStepById["drummer-1"]).toBeNull();
    expect(runtime.controllerRuntimePadStartSubunitById["controller-1"]).toBeNull();
  });

  it("maps an absolute transport step to playhead, cycle, and subunits", () => {
    const sequencerBefore = useAppStore.getState().sequencer;
    const stepCount = useAppStore.getState().sequencerRuntime.stepCount;
    const absoluteStep = stepCount + 3;

    useAppStore.getState().setSequencerTransportAbsoluteStep(absoluteStep);

    const state = useAppStore.getState();
    expect(state.sequencer).toBe(sequencerBefore);
    expect(state.sequencerRuntime.playhead).toBe(3);
    expect(state.sequencerRuntime.cycle).toBe(1);
    expect(state.sequencerRuntime.transportSubunit).toBe(
      absoluteStep * sequencerTransportSubunitsPerStep()
    );
  });

  it("round-trips a version 10 sequencer configuration and rebuilds runtime state", () => {
    useAppStore.setState({
      patches: [performablePatch],
      sequencerInstruments: [instrumentBinding]
    });
    useAppStore.getState().setSequencerBpm(137);
    const snapshot = useAppStore.getState().buildSequencerConfigSnapshot();

    expect(snapshot.version).toBe(10);
    expect(snapshot.instruments).toEqual([
      expect.objectContaining({
        id: instrumentBinding.id,
        patchId: performablePatch.id,
        midiChannel: 1,
        level: 8
      })
    ]);
    expect(snapshot.sequencer.tracks[0].pads).toHaveLength(8);
    expect(snapshot.sequencer.tracks[0].pads[0].steps).toHaveLength(128);

    useAppStore.getState().setSequencerBpm(80);
    useAppStore.getState().syncSequencerTransportRuntime({ isPlaying: true, playhead: 7, cycle: 4 });
    useAppStore.getState().applySequencerConfigSnapshot(snapshot);

    const state = useAppStore.getState();
    expect(state.error).toBeNull();
    expect(state.sequencer.timing.tempoBPM).toBe(137);
    expect(state.sequencerInstruments).toEqual([instrumentBinding]);
    expect(state.sequencerRuntime.isPlaying).toBe(false);
    expect(state.sequencerRuntime.playhead).toBe(0);
    expect(state.sequencerRuntime.cycle).toBe(0);
  });

  it("rejects invalid snapshots without replacing sequencer configuration", () => {
    const sequencerBefore = useAppStore.getState().sequencer;

    useAppStore.getState().applySequencerConfigSnapshot(null);

    const state = useAppStore.getState();
    expect(state.sequencer).toBe(sequencerBefore);
    expect(state.error).toBe("Invalid sequencer config file.");
  });

  it("caps melodic sequencers at eight tracks", () => {
    for (let index = 1; index < 8; index += 1) {
      useAppStore.getState().addSequencerTrack();
    }
    expect(useAppStore.getState().sequencer.tracks).toHaveLength(8);

    useAppStore.getState().addSequencerTrack();

    expect(useAppStore.getState().sequencer.tracks).toHaveLength(8);
    expect(useAppStore.getState().error).toBe("A maximum of 8 sequencers is supported.");
  });
});
