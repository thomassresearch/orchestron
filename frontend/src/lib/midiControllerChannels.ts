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

export function laneMidiLabel(track: { midiChannel: number } | { targetChannels: number[] } | { inputChannel: number; targetChannel: number }) {
  if ("targetChannel" in track) return `MIDI ${track.inputChannel} → ${track.targetChannel}`;
  if ("targetChannels" in track) {
    const channels = normalizeControllerTargetChannels(track.targetChannels);
    return `MIDI ${channels.length === MIDI_CHANNELS.length ? "1–16" : channels.join(", ")}`;
  }
  return `MIDI ${track.midiChannel}`;
}
