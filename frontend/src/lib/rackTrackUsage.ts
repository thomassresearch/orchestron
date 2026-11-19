import type { AudioGraph, SequencerInstrumentBinding, SequencerState } from "../types";
import { rackRemovalIds } from "./insertRouting";
import { sourceKeys } from "./clipArranger/migration";
import { deviceRackChannels } from "./midiControllerChannels";

export function tracksUsingRackInstrument(sequencer: SequencerState, bindings: SequencerInstrumentBinding[], insertOwners: AudioGraph["insertOwners"], id: string): string[] {
  const removed = rackRemovalIds(insertOwners, id);
  const channels = new Set(bindings.filter(b => removed.has(b.id) && b.midiChannel > 0).map(b => b.midiChannel));
  const arpOutputs = new Map(sequencer.arpeggiators.map(arp => [arp.inputChannel, arp.targetChannel]));
  const users: string[] = [];
  for (const key of Object.values(sourceKeys)) {
    for (const track of sequencer[key]) {
      const automation = "automationTarget" in track && track.automationTarget;
      if (automation ? removed.has(automation.instrumentId) : deviceRackChannels(track, arpOutputs).some(ch => channels.has(ch))) users.push(track.name);
    }
  }
  return users;
}
