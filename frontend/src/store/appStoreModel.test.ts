import { describe, expect, it } from "vitest";

import {
  defaultArpeggiator,
  defaultSequencerState,
  normalizeEngineConfig,
  sequencerSnapshotForPersistence
} from "./appStoreModel";

describe("app store model normalization", () => {
  it("normalizes engine timing and buffer values at the persistence boundary", () => {
    expect(
      normalizeEngineConfig({
        sr: 96_000,
        control_rate: 1,
        ksmps: 999,
        nchnls: 0,
        software_buffer: 1,
        hardware_buffer: 99_999,
        "0dbfs": 2
      })
    ).toEqual({
      sr: 48_000,
      control_rate: 25,
      ksmps: 1_920,
      nchnls: 1,
      software_buffer: 32,
      hardware_buffer: 8_192,
      "0dbfs": 2
    });
  });

  it("removes transport-only state from persisted sequencer snapshots", () => {
    const sequencer = defaultSequencerState();
    sequencer.isPlaying = true;
    sequencer.playhead = 7;
    sequencer.cycle = 3;
    sequencer.tracks[0].queuedPad = 2;
    sequencer.tracks[0].runtimeLocalStep = 5;
    sequencer.arpeggiators = [defaultArpeggiator()];
    sequencer.arpeggiators[0].heldNotes = [60, 64];
    sequencer.arpeggiators[0].activeNote = 64;

    const snapshot = sequencerSnapshotForPersistence(sequencer);

    expect(snapshot).not.toBe(sequencer);
    expect(snapshot.isPlaying).toBe(false);
    expect(snapshot.playhead).toBe(0);
    expect(snapshot.cycle).toBe(0);
    expect(snapshot.tracks[0]).toMatchObject({ queuedPad: null, runtimeLocalStep: null });
    expect(snapshot.arpeggiators[0]).toMatchObject({ heldNotes: [], activeNote: null, stepIndex: 0 });
  });
});
