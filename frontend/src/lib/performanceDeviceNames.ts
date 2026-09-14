import type { SequencerState } from "../types";

export const performanceDeviceKinds = [
  "tracks", "drummerTracks", "controllerSequencers", "arpeggiators", "pianoRolls", "midiControllers"
] as const;
export type PerformanceDeviceKind = typeof performanceDeviceKinds[number];
export type PerformanceDeviceNameError = "empty" | "tooLong" | "html" | "duplicate" | "missing";
export type PerformanceDeviceNameResult =
  | { ok: true; name: string }
  | { ok: false; error: PerformanceDeviceNameError };
export type RenamePerformanceDevice = (
  kind: PerformanceDeviceKind, id: string, name: string
) => PerformanceDeviceNameResult;

export const MAX_PERFORMANCE_DEVICE_NAME_LENGTH = 65;

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function performanceDeviceDisplayName(name: string, fallback: string): string {
  return name.trim() ? name : fallback;
}

export function validatePerformanceDeviceName(
  sequencer: SequencerState, kind: PerformanceDeviceKind, id: string, draft: string
): PerformanceDeviceNameResult {
  if (!sequencer[kind].some((device) => device.id === id)) return { ok: false, error: "missing" };
  const name = draft.trim();
  if (!name) return { ok: false, error: "empty" };
  if (Array.from(name).length > MAX_PERFORMANCE_DEVICE_NAME_LENGTH) return { ok: false, error: "tooLong" };
  if (/[<>]/.test(name)) return { ok: false, error: "html" };
  const duplicate = performanceDeviceKinds.some((candidateKind) => sequencer[candidateKind].some((device) =>
    !(candidateKind === kind && device.id === id) && nameKey(device.name) === nameKey(name)
  ));
  return duplicate ? { ok: false, error: "duplicate" } : { ok: true, name };
}

export function nextPerformanceDeviceName(sequencer: SequencerState, prefix: string, startIndex: number): string {
  const taken = new Set(performanceDeviceKinds.flatMap((kind) => sequencer[kind].map((device) => nameKey(device.name))));
  let index = startIndex;
  while (taken.has(nameKey(`${prefix} ${index}`))) index += 1;
  return `${prefix} ${index}`;
}
