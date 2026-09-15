import { beforeEach, describe, expect, it } from "vitest";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import { useAppStore } from "./useAppStore";
import { consumeSequencerEnablementCommands } from "./sequencerEdits";
import type { SessionSequencerConfigRequest } from "../types";
import { capturePersistWatchState, shouldDeferSequencerPersistence } from "./appStoreModel";

describe("authored configuration and sounding pads", () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

  it("keeps playback, queue acknowledgments, enablement and controller status out of authorship", () => {
    useAppStore.getState().addControllerSequencer();
    const before = useAppStore.getState();
    const trackId = before.sequencer.tracks[0].id;
    const controllerSequencerId = before.sequencer.controllerSequencers[0].id;
    for (let tick = 0; tick < 1000; tick++) {
      useAppStore.getState().syncSequencerRuntime({ isPlaying: true, playhead: tick % 16, cycle: tick,
        tracks: [{ trackId, activePad: tick % 8, queuedPad: (tick + 1) % 8, enabled: tick % 2 === 0, padLoopPosition: tick % 4 }] });
      useAppStore.getState().syncControllerSequencerRuntime([{ controllerSequencerId,
        activePad: tick % 8, queuedPad: null, enabled: tick % 2 === 0, padLoopPosition: tick % 3,
        runtimePadStartSubunit: tick * 840 }]);
    }
    expect(useAppStore.getState().sequencer).toBe(before.sequencer);
    expect(useAppStore.getState().sequencerEditRevision).toBe(before.sequencerEditRevision);
  });

  it("edits the sounding note pad while preserving the saved starting pad and transport", () => {
    const original = useAppStore.getState().sequencer.tracks[0];
    useAppStore.getState().syncSequencerRuntime({ isPlaying: true, playhead: 7, cycle: 2,
      tracks: [{ trackId: original.id, activePad: 2, enabled: true, queuedPad: 3 }] });
    const revision = useAppStore.getState().sequencerEditRevision;
    useAppStore.getState().setSequencerTrackStepNote(original.id, 0, 77);
    const state = useAppStore.getState();
    const track = state.sequencer.tracks[0];
    expect(track.activePad).toBe(original.activePad);
    expect(track.pads[0]).toEqual(original.pads[0]);
    expect(track.pads[2].steps[0].note).toBe(77);
    expect(state.sequencerEditRevision).toBe(revision + 1);
    const view = mergedSequencerState(state.sequencer, state.sequencerRuntime);
    expect(view).toMatchObject({ isPlaying: true, playhead: 7, cycle: 2 });
    expect(view.tracks[0]).toMatchObject({ activePad: 2, queuedPad: 3 });
    expect(view.tracks[0].steps).toBe(track.pads[2].steps);
    expect(state.buildSequencerConfigSnapshot().sequencer.tracks[0].activePad).toBe(2);
  });

  it("edits controller curves and observes arpeggiator arrangement additions", () => {
    useAppStore.getState().addControllerSequencer();
    const controller = useAppStore.getState().sequencer.controllerSequencers[0];
    useAppStore.getState().syncControllerSequencerRuntime([{ controllerSequencerId: controller.id, activePad: 3 }]);
    const revision = useAppStore.getState().sequencerEditRevision;
    const point = controller.pads[3].keypoints[0];
    useAppStore.getState().setControllerSequencerKeypointValue(controller.id, point.id, 71);
    expect(useAppStore.getState().sequencer.controllerSequencers[0].pads[3].keypoints[0].value).toBe(71);
    expect(useAppStore.getState().sequencer.controllerSequencers[0].pads[0]).toEqual(controller.pads[0]);
    expect(useAppStore.getState().sequencerEditRevision).toBe(revision + 1);
    useAppStore.getState().renamePerformanceDevice("controllerSequencers", controller.id, "Renamed");
    useAppStore.getState().addArpeggiator();
    expect(useAppStore.getState().sequencerEditRevision).toBe(revision + 2);
  });

  it("discards playback overlays when the engine session is replaced", () => {
    useAppStore.setState({ activeSessionId: "old" });
    const track = useAppStore.getState().sequencer.tracks[0];
    useAppStore.getState().syncSequencerRuntime({ isPlaying: true, playhead: 12,
      tracks: [{ trackId: track.id, activePad: 5, queuedPad: 6, enabled: true }] });
    const authored = useAppStore.getState().sequencer;
    useAppStore.setState({ activeSessionId: "new" });
    const state = useAppStore.getState();
    expect(state.sequencer).toBe(authored);
    expect(state.sequencerRuntime.isPlaying).toBe(false);
    expect(state.sequencerRuntime.trackStateById).toEqual({});
    expect(mergedSequencerState(state.sequencer, state.sequencerRuntime).tracks[0].activePad).toBe(track.activePad);
  });

  it("consumes queued enablement on dispatch so later edits cannot replay it", () => {
    const id = useAppStore.getState().sequencer.tracks[0].id;
    useAppStore.getState().syncSequencerRuntime({ isPlaying: true, tracks: [{ trackId: id, enabled: false }] });
    useAppStore.getState().setSequencerTrackEnabled(id, true, true);
    const revision = useAppStore.getState().sequencerEditRevision;
    consumeSequencerEnablementCommands(useAppStore.setState, useAppStore.getState,
      { tracks: [{ track_id: id, queued_enabled: true }] } as SessionSequencerConfigRequest);
    let state = useAppStore.getState();
    expect(state.sequencer.tracks[0]).toMatchObject({ enabled: true, queuedEnabled: null });
    expect(mergedSequencerState(state.sequencer, state.sequencerRuntime).tracks[0]).toMatchObject({ enabled: false, queuedEnabled: true });
    expect(state.sequencerEditRevision).toBe(revision);
    state.syncSequencerRuntime({ isPlaying: true, tracks: [{ trackId: id, enabled: false, queuedEnabled: null }] });
    useAppStore.getState().setSequencerTrackEnabled(id, true, true);
    state = useAppStore.getState();
    expect(state.sequencerEditRevision).toBe(revision + 1);
  });

  it("preserves sequencer autosave deferral during playback and saves on stop or other changes", () => {
    const before = capturePersistWatchState(useAppStore.getState());
    useAppStore.getState().setSequencerBpm(137);
    const edited = capturePersistWatchState(useAppStore.getState());
    expect(shouldDeferSequencerPersistence(edited, before, true)).toBe(true);
    expect(shouldDeferSequencerPersistence(edited, before, false)).toBe(false);
    expect(shouldDeferSequencerPersistence({ ...edited, performanceName: "Renamed performance" }, before, true)).toBe(false);
  });
});
