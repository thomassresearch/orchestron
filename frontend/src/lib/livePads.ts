import type { ArpeggiatorState, ControllerSequencerState, DrummerSequencerTrackState, ScoreTrackState, SequencerTrackState } from "../types";
import { normalizeArpeggiatorSettings } from "../store/appStoreModel";
import { arpeggiatorPadHasSound, controllerPadHasContent, drummerPadHasSound, melodicPadHasSound } from "./patternWorkspace";
import { scoreHasContent } from "./scoreSequencer";

export type LiveDevice = SequencerTrackState | DrummerSequencerTrackState | ControllerSequencerState | ScoreTrackState | ArpeggiatorState;

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
