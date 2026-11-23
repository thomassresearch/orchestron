import type { ArpeggiatorState, ControllerSequencerState, DrummerSequencerTrackState, ScoreTrackState, SequencerTrackState } from "../types";
import { DEFAULT_PAD_COUNT, normalizeArpeggiatorSettings } from "../store/appStoreModel";
import { physicalPadDefinitionId } from "./clipArranger/migration";
import type { ClipLane, PatternDefinition } from "./clipArranger/model";
import { arpeggiatorPadHasSound, controllerPadHasContent, drummerPadHasSound, melodicPadHasSound } from "./patternWorkspace";
import { scoreHasContent } from "./scoreSequencer";

export type LiveDevice = SequencerTrackState | DrummerSequencerTrackState | ControllerSequencerState | ScoreTrackState | ArpeggiatorState;
export const LIVE_LAUNCH_GESTURE = "live-launcher";

export type LivePatternNames = {
  pads: (string | undefined)[];
  definitions: { pattern: PatternDefinition; label: string; physicalPad?: number }[];
};

export function livePatternNames(lane: ClipLane): LivePatternNames {
  const patterns = lane.definitions.filter(d => d.kind === "pattern");
  // A numbered pattern can take its clip's title if the clip contains just this
  // pattern and every use gives it the same title.
  const titles = new Map<string, string | null>();
  for (const group of lane.definitions) {
    if (group.kind !== "pattern") {
      for (const item of group.children) if ("definitionId" in item) titles.set(item.definitionId, null);
    }
  }
  for (const clip of lane.clips) {
    for (const item of clip.children) {
      if (!("definitionId" in item)) continue;
      const previous = titles.get(item.definitionId);
      const unique = clip.children.length === 1 && (previous === undefined || previous === clip.name);
      titles.set(item.definitionId, unique ? clip.name : null);
    }
  }
  const physical = new Map(Array.from({ length: DEFAULT_PAD_COUNT }, (_, i) => [physicalPadDefinitionId(lane.id, i), i]));
  const pads: (string | undefined)[] = [];
  const definitions = patterns.map(pattern => {
    const physicalPad = physical.get(pattern.id);
    const label = (/^#\d+$/.test(pattern.name) && titles.get(pattern.id)) || pattern.name;
    if (physicalPad !== undefined && label !== `#${physicalPad + 1}`) pads[physicalPad] = label;
    return { pattern, label, physicalPad };
  });
  return { pads, definitions };
}

export function livePadLabel(index: number, name?: string) {
  return name ?? `Pad ${index + 1}`;
}

export function livePatternHasContent(pattern: PatternDefinition, device: LiveDevice) {
  switch (pattern.source) {
    case "sequencer": return melodicPadHasSound(pattern.payload);
    case "drummer": return drummerPadHasSound(pattern.payload);
    case "arpeggiator": return arpeggiatorPadHasSound(pattern.payload);
    case "controller": return "controllerMode" in device && controllerPadHasContent(pattern.payload, device.controllerMode);
    case "score": return "launchQuantization" in device && scoreHasContent(pattern.payload, device.timing);
  }
}

export function livePadHasContent(device: LiveDevice, index: number) {
  if ("playbackMode" in device) return arpeggiatorPadHasSound(device.pads[index]);
  if ("launchQuantization" in device) return scoreHasContent(device.pads[index], device.timing);
  if ("controllerMode" in device) return controllerPadHasContent(device.pads[index], device.controllerMode);
  if ("rows" in device) return drummerPadHasSound(device.pads[index]);
  return melodicPadHasSound(device.pads[index]);
}

// Silent or out-of-range events still need confirmation before overwriting.
export function livePadNeedsReplacement(device: LiveDevice, index: number) {
  if ("launchQuantization" in device) return device.pads[index].notes.length > 0;
  if ("rows" in device) return device.pads[index].rows.some(row => row.steps.some(step => step.active));
  if ("controllerMode" in device) {
    const pad = device.pads[index];
    return !!pad.steps?.some(value => value !== null) || pad.keypoints.length > 2 || pad.keypoints.some(point => point.value !== 0);
  }
  if ("playbackMode" in device) return true;
  return device.pads[index].steps.some(step => step.note !== null || step.hold);
}

// The destination retains its preset association, as in the arpeggiator editor.
export function copyArpeggiatorPad(device: ArpeggiatorState, from: number, to: number) {
  return { pads: device.pads.map((pad, i) => i === to ? normalizeArpeggiatorSettings(device.pads[from]) : pad) };
}
