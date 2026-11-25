import { clipWindows } from "./model";
import type { SequencerState } from "../../types";
import { sequencerTransportSubunitsPerStep } from "../sequencer";
import { arrangementTimings } from "./migration";
import { resolveContent } from "./model";
import type { StructureFocus, StructureSelection } from "./structure";

export type ClipSelection = { laneId: string; clipId?: string };

export function clipLoopTarget(sequencer: SequencerState, selected?: ClipSelection | null,
  focus?: StructureFocus | null, selection?: StructureSelection | null) {
  const model = sequencer.clipArrangement;
  if (!model) return null;
  const lane = model.lanes.find(l => l.id === selected?.laneId);
  const clip = lane?.clips.find(c => c.id === selected?.clipId);
  const ticksPerStep = sequencerTransportSubunitsPerStep();
  const range = (label: "loopSong" | "loopClip" | "loopPatterns", start: number, end: number) =>
    ({ label, range: { startStep: start / ticksPerStep, endStep: end / ticksPerStep } });
  if (!lane || !clip) return range("loopSong", 0, model.end);

  if (selection && focus?.laneId === lane.id && focus.clipId === clip.id) {
    // Resolve the saved music once, even for a range spanning thousands of repetitions.
    const leaves = resolveContent(lane, clip.children, arrangementTimings(sequencer)[lane.id]);
    const cycle = leaves.length ? leaves[leaves.length - 1].start + leaves[leaves.length - 1].length : 0;
    const occurrence = (id: string, pass: number) => {
      const path = [...selection.parent, id];
      const leaf = leaves.find(l => l.definition && l.path.length === path.length && path.every((part, i) => part === l.path[i]));
      if (!leaf) return;
      const start = clip.start - clip.offset + pass * cycle + leaf.start;
      return { start, end: start + leaf.length };
    };
    const anchor = occurrence(selection.anchor, selection.anchorPass ?? focus.pass);
    const tip = occurrence(selection.tip?.id ?? selection.anchor, selection.tip?.pass ?? focus.pass);
    if (anchor && tip) {
      const start = Math.max(clip.start, Math.min(anchor.start, tip.start));
      const end = Math.min(clip.start + clip.length, Math.max(anchor.end, tip.end));
      if (end > start) return range("loopPatterns", start, end);
    }
  }
  const window = clipWindows(lane).find(w => w.parts.some(part => part.id === clip.id))!;
  return range("loopClip", window.clip.start, window.end);
}
