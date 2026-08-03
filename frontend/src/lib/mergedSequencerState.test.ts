import { describe, expect, it } from "vitest";

import { useAppStore } from "../store/useAppStore";
import { mergedSequencerState } from "./mergedSequencerState";

describe("merged sequencer state", () => {
  it("preserves the configuration reference when runtime values are unchanged", () => {
    const { sequencer, sequencerRuntime } = useAppStore.getInitialState();

    expect(mergedSequencerState(sequencer, sequencerRuntime)).toBe(sequencer);
  });

  it("updates only runtime-bearing branches", () => {
    const { sequencer, sequencerRuntime } = useAppStore.getInitialState();
    const trackId = sequencer.tracks[0].id;
    const runtime = {
      ...sequencerRuntime,
      isPlaying: true,
      playhead: sequencerRuntime.stepCount + 3,
      cycle: 2,
      trackLocalStepById: {
        ...sequencerRuntime.trackLocalStepById,
        [trackId]: 5
      }
    };

    const merged = mergedSequencerState(sequencer, runtime);

    expect(merged).not.toBe(sequencer);
    expect(merged.isPlaying).toBe(true);
    expect(merged.playhead).toBe(3);
    expect(merged.cycle).toBe(2);
    expect(merged.tracks[0]).not.toBe(sequencer.tracks[0]);
    expect(merged.tracks[0].runtimeLocalStep).toBe(5);
    expect(merged.drummerTracks).toBe(sequencer.drummerTracks);
    expect(merged.controllerSequencers).toBe(sequencer.controllerSequencers);
    expect(merged.arpeggiators).toBe(sequencer.arpeggiators);
  });

  it("treats an explicit null runtime position as newer than stale config", () => {
    const initial = useAppStore.getInitialState();
    const track = { ...initial.sequencer.tracks[0], runtimeLocalStep: 4 };
    const sequencer = {
      ...initial.sequencer,
      tracks: [track]
    };
    const sequencerRuntime = {
      ...initial.sequencerRuntime,
      trackLocalStepById: { [track.id]: null }
    };

    const merged = mergedSequencerState(sequencer, sequencerRuntime);

    expect(merged.tracks[0].runtimeLocalStep).toBeNull();
  });
});
