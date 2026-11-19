import type { ArpeggiatorState, AutomationTarget, PatchListItem, SequencerInstrumentBinding } from "../types";

export const MIDI_CHANNELS = Array.from({ length: 16 }, (_, index) => index + 1);

/** Missing or unusable legacy selections retain OMNI behavior. */
export function normalizeControllerTargetChannels(value: unknown): number[] {
  const channels = Array.isArray(value)
    ? [...new Set(value.filter((channel): channel is number =>
      typeof channel === "number" && Number.isInteger(channel) && channel >= 1 && channel <= 16))]
      .sort((a, b) => a - b)
    : [];
  return channels.length > 0 ? channels : [...MIDI_CHANNELS];
}

export type MidiDevice = { midiChannel: number } | { targetChannels: number[]; automationTarget?: AutomationTarget } | { inputChannel: number; targetChannel: number };

export function laneMidiLabel(track: MidiDevice) {
  if ("targetChannel" in track) return `MIDI ${track.inputChannel} → ${track.targetChannel}`;
  if ("targetChannels" in track) {
    const channels = normalizeControllerTargetChannels(track.targetChannels);
    return `MIDI ${channels.length === MIDI_CHANNELS.length ? "1–16" : channels.join(", ")}`;
  }
  return `MIDI ${track.midiChannel}`;
}

/** Rack destinations, including devices that send MIDI to an arpeggiator input. */
export function deviceRackChannels(device: MidiDevice, arpOutputs: ReadonlyMap<number, number>) {
  if ("targetChannel" in device) return [device.targetChannel];
  const channels = "targetChannels" in device ? normalizeControllerTargetChannels(device.targetChannels) : [device.midiChannel];
  return channels.map(channel => arpOutputs.get(channel) ?? channel);
}

export function createMidiInstrumentLookup(
  bindings: readonly Pick<SequencerInstrumentBinding, "id" | "patchId" | "midiChannel">[],
  patches: ReadonlyMap<string, Pick<PatchListItem, "always_on" | "name">>,
  arps: readonly Pick<ArpeggiatorState, "inputChannel" | "targetChannel">[]
) {
  const namesByChannel = new Map<number, string[]>();
  const namesByInstance = new Map<string, string>();
  for (const binding of bindings) {
    const patch = patches.get(binding.patchId);
    if (!patch) continue;
    namesByInstance.set(binding.id, patch.name);
    if (patch.always_on || binding.midiChannel <= 0) continue;
    const names = namesByChannel.get(binding.midiChannel) ?? [];
    names.push(patch.name);
    namesByChannel.set(binding.midiChannel, names);
  }
  const arpOutputs = new Map(arps.map(arp => [arp.inputChannel, arp.targetChannel]));
  return (device: MidiDevice) => {
    if ("automationTarget" in device && device.automationTarget) return namesByInstance.get(device.automationTarget.instrumentId) ?? "";
    const names = deviceRackChannels(device, arpOutputs).flatMap(channel => namesByChannel.get(channel) ?? []);
    return [...new Set(names)].join(", ");
  };
}
