import { compilePadLoopPattern, decodePadLoopPauseToken, normalizePadIndex } from "./padLoopPattern";
import type {
  ArrangerLoopSelection,
  ControllerSequencerState,
  DrummerSequencerTrackState,
  PadLoopPatternState,
  SequencerState,
  SequencerTrackState
} from "../types";

export const ARRANGER_STEP_QUANTUM = 4;

function quantizeStep(step: number): number {
  if (!Number.isFinite(step)) {
    return 0;
  }
  return Math.max(0, Math.round(Math.round(step) / ARRANGER_STEP_QUANTUM) * ARRANGER_STEP_QUANTUM);
}

export function absoluteTransportStep(
  playhead: number,
  cycle: number,
  transportStepCount: number
): number {
  const boundedStepCount = Math.max(ARRANGER_STEP_QUANTUM, Math.round(transportStepCount));
  const normalizedCycle = Math.max(0, Math.round(cycle));
  const normalizedPlayhead = Math.max(0, Math.round(playhead));
  return normalizedCycle * boundedStepCount + normalizedPlayhead;
}

export function transportPositionFromAbsoluteStep(
  step: number,
  transportStepCount: number
): { playhead: number; cycle: number } {
  const boundedStepCount = Math.max(ARRANGER_STEP_QUANTUM, Math.round(transportStepCount));
  const normalizedStep = Math.max(0, Math.round(step));
  return {
    playhead: normalizedStep % boundedStepCount,
    cycle: Math.floor(normalizedStep / boundedStepCount)
  };
}

export function compileArrangerTransportSequence(
  pattern: PadLoopPatternState,
  fallbackPadIndex: number
): number[] {
  const compiled = compilePadLoopPattern(pattern).sequence;
  if (compiled.length > 0) {
    return compiled;
  }
  return [normalizePadIndex(fallbackPadIndex)];
}

export function stepCountForTransportToken(
  token: number,
  padStepCounts: number[],
  defaultPadStepCount: number
): number {
  if (token >= 0) {
    const candidate = padStepCounts[Math.round(token)];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.max(1, Math.round(candidate));
    }
    return Math.max(1, Math.round(defaultPadStepCount));
  }
  const pauseStepCount = decodePadLoopPauseToken(token);
  if (pauseStepCount !== null) {
    return pauseStepCount;
  }
  return Math.max(1, Math.round(defaultPadStepCount));
}

export function transportSequenceStepCount(
  sequence: number[],
  padStepCounts: number[],
  defaultPadStepCount: number
): number {
  return sequence.reduce(
    (sum, token) => sum + stepCountForTransportToken(token, padStepCounts, defaultPadStepCount),
    0
  );
}

function trackTransportExtent(track: SequencerTrackState): number {
  const sequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
  return transportSequenceStepCount(
    sequence,
    track.pads.map((pad) => pad.stepCount),
    track.stepCount
  );
}

function drummerTrackTransportExtent(track: DrummerSequencerTrackState): number {
  const sequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
  return transportSequenceStepCount(
    sequence,
    track.pads.map((pad) => pad.stepCount),
    track.stepCount
  );
}

function controllerSequencerTransportExtent(track: ControllerSequencerState): number {
  const sequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
  return transportSequenceStepCount(
    sequence,
    track.pads.map((pad) => pad.stepCount),
    track.stepCount
  );
}

export function arrangerTransportExtent(sequencer: Pick<SequencerState, "tracks" | "drummerTracks" | "controllerSequencers">): number {
  let maxStep = ARRANGER_STEP_QUANTUM;
  for (const track of sequencer.tracks) {
    maxStep = Math.max(maxStep, trackTransportExtent(track));
  }
  for (const track of sequencer.drummerTracks) {
    maxStep = Math.max(maxStep, drummerTrackTransportExtent(track));
  }
  for (const track of sequencer.controllerSequencers) {
    maxStep = Math.max(maxStep, controllerSequencerTransportExtent(track));
  }
  return quantizeStep(maxStep);
}

export function normalizeArrangerLoopSelection(
  selection: ArrangerLoopSelection | null | undefined,
  arrangementEndStep: number
): ArrangerLoopSelection | null {
  if (!selection) {
    return null;
  }
  const boundedEnd = Math.max(ARRANGER_STEP_QUANTUM, quantizeStep(arrangementEndStep));
  const rawStart = quantizeStep(selection.startStep);
  const rawEnd = quantizeStep(selection.endStep);
  const startStep = Math.max(0, Math.min(rawStart, boundedEnd - ARRANGER_STEP_QUANTUM));
  const endStep = Math.max(
    startStep + ARRANGER_STEP_QUANTUM,
    Math.min(Math.max(rawEnd, startStep + ARRANGER_STEP_QUANTUM), boundedEnd)
  );
  if (endStep <= startStep) {
    return null;
  }
  return { startStep, endStep };
}

export function arrangerPlaybackBounds(
  sequencer: Pick<SequencerState, "arrangerLoopSelection" | "tracks" | "drummerTracks" | "controllerSequencers">
): {
  arrangementEndStep: number;
  selection: ArrangerLoopSelection | null;
  playbackStartStep: number;
  playbackEndStep: number;
  playbackLoop: boolean;
} {
  const arrangementEndStep = arrangerTransportExtent(sequencer);
  const selection = normalizeArrangerLoopSelection(sequencer.arrangerLoopSelection, arrangementEndStep);
  return {
    arrangementEndStep,
    selection,
    playbackStartStep: selection?.startStep ?? 0,
    playbackEndStep: selection?.endStep ?? arrangementEndStep,
    playbackLoop: selection !== null
  };
}

export function clampArrangerSeekStep(
  nextStep: number,
  selection: ArrangerLoopSelection | null,
  arrangementEndStep: number
): number {
  const rangeStart = selection?.startStep ?? 0;
  const rangeEnd = selection?.endStep ?? Math.max(ARRANGER_STEP_QUANTUM, quantizeStep(arrangementEndStep));
  return Math.max(rangeStart, Math.min(Math.round(nextStep), rangeEnd));
}
