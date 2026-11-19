import type { ArpeggiatorState, ControllerSequencerState, DrummerSequencerTrackState, ScoreTrackState, SequencerTrackState } from "../types";
import { DEFAULT_PAD_COUNT, normalizeArpeggiatorSettings } from "../store/appStoreModel";
import { physicalPadDefinitionId } from "./clipArranger/migration";
import type { ClipLane } from "./clipArranger/model";
import { arpeggiatorPadHasSound, controllerPadHasContent, drummerPadHasSound, melodicPadHasSound } from "./patternWorkspace";
import { scoreHasContent } from "./scoreSequencer";

export type LiveDevice = SequencerTrackState | DrummerSequencerTrackState | ControllerSequencerState | ScoreTrackState | ArpeggiatorState;
export type LivePatternNames = {
  pads: (string | undefined)[];
  arrangementOnly: { id: string; name: string }[];
};

export function livePatternNames(lane: ClipLane): LivePatternNames {
  const patterns = new Map(lane.definitions.filter(d => d.kind === "pattern").map(d => [d.id, d]));
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
  const pads = Array.from({ length: DEFAULT_PAD_COUNT }, (_, i) => {
    const id = physicalPadDefinitionId(lane.id, i);
    const pattern = patterns.get(id);
    if (!pattern) return undefined;
    patterns.delete(id);
    const name = pattern.name === `#${i + 1}` ? titles.get(id) : pattern.name;
    return name && name !== `#${i + 1}` ? name : undefined;
  });
  const arrangementOnly = [...patterns.values()].map(({ id, name }) => ({
    id, name: /^#\d+$/.test(name) ? titles.get(id) ?? name : name
  }));
  return { pads, arrangementOnly };
}

export function livePadLabel(index: number, name?: string) {
  return name ? `Pad ${index + 1} · ${name}` : `Pad ${index + 1}`;
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
