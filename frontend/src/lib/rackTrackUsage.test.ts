import { expect, it } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { defaultArpeggiator, defaultControllerSequencer, defaultPianoRoll, defaultSequencerTrack } from "../store/appStoreModel";
import type { SequencerInstrumentBinding } from "../types";
import { tracksUsingRackInstrument } from "./rackTrackUsage";

it("resolves stopped and Live tracks, shared channels, arpeggiators and explicit automation by instance", () => {
  const base = useAppStore.getInitialState().sequencer;
  const binding = (id: string, midiChannel: number): SequencerInstrumentBinding =>
    ({ id, midiChannel, patchId: "piano", level: 10, effectRoutes: [], effectSourceIds: [] });
  const rack = [binding("a", 2), binding("b", 2), binding("fx", 0), binding("keys-only", 6)];
  const sequencer = {
    ...base, tracks: [{ ...defaultSequencerTrack(1, 3), name: "Chords" }], drummerTracks: [], scoreTracks: [],
    arpeggiators: [{ ...defaultArpeggiator(1, 3, 2), name: "Live arp", playbackMode: "live" as const }],
    controllerSequencers: [
      { ...defaultControllerSequencer(), name: "Pedal", targetChannels: [2, 4] },
      { ...defaultControllerSequencer(), name: "Automation", targetChannels: [6], automationTarget: { instrumentId: "fx", controllerNodeIds: ["gain"] } }
    ], pianoRolls: [defaultPianoRoll(1, 6)]
  };
  const users = (id: string) => tracksUsingRackInstrument(sequencer, rack, { fx: "a" }, id).sort();
  expect(users("a")).toEqual(["Automation", "Chords", "Live arp", "Pedal"]);
  expect(users("b")).toEqual(["Chords", "Live arp", "Pedal"]);
  expect(users("fx")).toEqual(["Automation"]);
  expect(users("keys-only")).toEqual([]);
});
