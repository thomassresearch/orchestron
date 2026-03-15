import { compilePadLoopPattern, decodePadLoopPauseToken, normalizePadIndex } from "./padLoopPattern";
import { sequencerTransportStepCount, sequencerTransportStepsPerBeat } from "./sequencer";
import type {
  ArrangerLoopSelection,
  ControllerSequencerState,
  DrummerSequencerTrackState,
  PadLoopPatternState,
  SequencerState,
  SequencerTrackState
} from "../types";

export const ARRANGER_STEP_QUANTUM: number = sequencerTransportStepsPerBeat();

function normalizeArrangerStepQuantum(stepQuantum: number): number {
  if (!Number.isFinite(stepQuantum)) {
    return ARRANGER_STEP_QUANTUM;
  }
  return Math.max(1, Math.round(stepQuantum));
}

export function arrangerStepQuantum(
  sequencer: Pick<SequencerState, "timing"> | SequencerState["timing"]
): number {
  return normalizeArrangerStepQuantum(sequencerTransportStepsPerBeat("timing" in sequencer ? sequencer.timing : sequencer));
}

function quantizeStep(step: number, stepQuantum: number = ARRANGER_STEP_QUANTUM): number {
  if (!Number.isFinite(step)) {
    return 0;
  }
  const normalizedStepQuantum = normalizeArrangerStepQuantum(stepQuantum);
  return Math.max(0, Math.round(Math.round(step) / normalizedStepQuantum) * normalizedStepQuantum);
}

export function absoluteTransportStep(
  playhead: number,
  cycle: number,
  transportStepCount: number
): number {
  const boundedStepCount = Math.max(1, Math.round(transportStepCount));
  const normalizedCycle = Math.max(0, Math.round(cycle));
  const normalizedPlayhead = Math.max(0, Math.round(playhead));
  return normalizedCycle * boundedStepCount + normalizedPlayhead;
}

export function transportPositionFromAbsoluteStep(
  step: number,
  transportStepCount: number
): { playhead: number; cycle: number } {
  const boundedStepCount = Math.max(1, Math.round(transportStepCount));
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
  padTransportStepCounts: number[],
  defaultPadTransportStepCount: number,
  transportStepsPerBeat: number = ARRANGER_STEP_QUANTUM
): number {
  if (token >= 0) {
    const candidate = padTransportStepCounts[Math.round(token)];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.max(1, Math.round(candidate));
    }
    return Math.max(1, Math.round(defaultPadTransportStepCount));
  }
  const pauseStepCount = decodePadLoopPauseToken(token);
  if (pauseStepCount !== null) {
    return pauseStepCount * Math.max(1, Math.round(transportStepsPerBeat));
  }
  return Math.max(1, Math.round(defaultPadTransportStepCount));
}

export function transportSequenceStepCount(
  sequence: number[],
  padTransportStepCounts: number[],
  defaultPadTransportStepCount: number,
  transportStepsPerBeat: number = ARRANGER_STEP_QUANTUM
): number {
  return sequence.reduce(
    (sum, token) =>
      sum + stepCountForTransportToken(token, padTransportStepCounts, defaultPadTransportStepCount, transportStepsPerBeat),
    0
  );
}

function trackTransportExtent(track: SequencerTrackState): number {
  const sequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
  return transportSequenceStepCount(
    sequence,
    track.pads.map((pad) => sequencerTransportStepCount(track.timing, pad.lengthBeats)),
    sequencerTransportStepCount(track.timing, track.lengthBeats),
    sequencerTransportStepsPerBeat(track.timing)
  );
}

function drummerTrackTransportExtent(track: DrummerSequencerTrackState): number {
  const sequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
  return transportSequenceStepCount(
    sequence,
    track.pads.map((pad) => sequencerTransportStepCount(track.timing, pad.lengthBeats)),
    sequencerTransportStepCount(track.timing, track.lengthBeats),
    sequencerTransportStepsPerBeat(track.timing)
  );
}

function controllerSequencerTransportExtent(track: ControllerSequencerState): number {
  const sequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
  return transportSequenceStepCount(
    sequence,
    track.pads.map((pad) => sequencerTransportStepCount(track.timing, pad.lengthBeats)),
    sequencerTransportStepCount(track.timing, track.lengthBeats),
    sequencerTransportStepsPerBeat(track.timing)
  );
}

export function arrangerTransportExtent(
  sequencer: Pick<SequencerState, "tracks" | "drummerTracks" | "controllerSequencers" | "timing">
): number {
  const stepQuantum = arrangerStepQuantum(sequencer);
  let maxStep = stepQuantum;
  for (const track of sequencer.tracks) {
    maxStep = Math.max(maxStep, trackTransportExtent(track));
  }
  for (const track of sequencer.drummerTracks) {
    maxStep = Math.max(maxStep, drummerTrackTransportExtent(track));
  }
  for (const track of sequencer.controllerSequencers) {
    maxStep = Math.max(maxStep, controllerSequencerTransportExtent(track));
  }
  return quantizeStep(maxStep, stepQuantum);
}

export function normalizeArrangerLoopSelection(
  selection: ArrangerLoopSelection | null | undefined,
  arrangementEndStep: number,
  stepQuantum: number = ARRANGER_STEP_QUANTUM
): ArrangerLoopSelection | null {
  if (!selection) {
    return null;
  }
  const normalizedStepQuantum = normalizeArrangerStepQuantum(stepQuantum);
  const boundedEnd = Math.max(normalizedStepQuantum, quantizeStep(arrangementEndStep, normalizedStepQuantum));
  const rawStart = quantizeStep(selection.startStep, normalizedStepQuantum);
  const rawEnd = quantizeStep(selection.endStep, normalizedStepQuantum);
  const startStep = Math.max(0, Math.min(rawStart, boundedEnd - normalizedStepQuantum));
  const endStep = Math.max(
    startStep + normalizedStepQuantum,
    Math.min(Math.max(rawEnd, startStep + normalizedStepQuantum), boundedEnd)
  );
  if (endStep <= startStep) {
    return null;
  }
  return { startStep, endStep };
}

export function arrangerPlaybackBounds(
  sequencer: Pick<SequencerState, "arrangerLoopSelection" | "tracks" | "drummerTracks" | "controllerSequencers" | "timing">
): {
  arrangementEndStep: number;
  selection: ArrangerLoopSelection | null;
  playbackStartStep: number;
  playbackEndStep: number;
  playbackLoop: boolean;
} {
  const stepQuantum = arrangerStepQuantum(sequencer);
  const arrangementEndStep = arrangerTransportExtent(sequencer);
  const selection = normalizeArrangerLoopSelection(sequencer.arrangerLoopSelection, arrangementEndStep, stepQuantum);
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
  arrangementEndStep: number,
  stepQuantum: number = ARRANGER_STEP_QUANTUM
): number {
  const normalizedStepQuantum = normalizeArrangerStepQuantum(stepQuantum);
  const rangeStart = selection?.startStep ?? 0;
  const rangeEnd = selection?.endStep ?? Math.max(normalizedStepQuantum, quantizeStep(arrangementEndStep, normalizedStepQuantum));
  return Math.max(rangeStart, Math.min(Math.round(nextStep), rangeEnd));
}
