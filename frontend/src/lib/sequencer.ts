import type { MidiInputRef } from "../types";

export const STEP_CAPACITY = 32;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function clampSequencerBpm(bpm: number): number {
  return clampInt(bpm, 30, 300);
}

export function clampSequencerChannel(channel: number): number {
  return clampInt(channel, 1, 16);
}

export function clampSequencerNote(note: number): number {
  return clampInt(note, 0, 127);
}

export function sequencerStepDurationMs(bpm: number): number {
  return 60000 / clampSequencerBpm(bpm) / 4;
}

export function sequencerGateDurationMs(stepDurationMs: number): number {
  return Math.max(10, Math.round(stepDurationMs * 0.8));
}

export function nextSequencerStep(currentStep: number, stepCount: 16 | 32): number {
  const next = (Math.round(currentStep) + 1) % stepCount;
  return next < 0 ? next + stepCount : next;
}

export function noteOnMessage(note: number, midiChannel: number, velocity = 100): [number, number, number] {
  const channel = clampSequencerChannel(midiChannel) - 1;
  return [0x90 + channel, clampSequencerNote(note), clampInt(velocity, 1, 127)];
}

export function noteOffMessage(note: number, midiChannel: number): [number, number, number] {
  const channel = clampSequencerChannel(midiChannel) - 1;
  return [0x80 + channel, clampSequencerNote(note), 0];
}

export function allNotesOffMessages(midiChannel: number): [number, number, number][] {
  const channel = clampSequencerChannel(midiChannel) - 1;
  return [
    [0xb0 + channel, 123, 0],
    [0xb0 + channel, 120, 0]
  ];
}

export function resolveMidiInputName(midiInputId: string | null, midiInputs: MidiInputRef[]): string | null {
  if (!midiInputId) {
    return null;
  }
  const selected = midiInputs.find((input) => input.id === midiInputId);
  return selected?.name ?? null;
}

export function findMatchingMidiOutput(access: MIDIAccess, targetName: string): MIDIOutput | null {
  const outputs = Array.from(access.outputs.values());
  if (outputs.length === 0) {
    return null;
  }

  const normalizedTarget = normalizeName(targetName);

  return (
    outputs.find((output) => normalizeName(output.name ?? "") === normalizedTarget) ??
    outputs.find((output) => {
      const normalizedOutputName = normalizeName(output.name ?? "");
      return (
        normalizedOutputName.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedOutputName)
      );
    }) ??
    null
  );
}
