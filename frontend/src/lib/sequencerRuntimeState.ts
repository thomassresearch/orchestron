import { transportPositionFromAbsoluteStep } from "./arrangerTransport";
import {
  DEFAULT_SEQUENCER_TIMING_CONFIG,
  sequencerTransportStepsPerBeat,
  sequencerTransportSubunitsPerStep
} from "./sequencer";
import type { SequencerRuntimeState } from "../types";

export interface SequencerTransportRuntimeSync {
  isPlaying: boolean;
  transportStepCount?: number;
  playhead?: number;
  cycle?: number;
  transportSubunit?: number;
  tracks?: Array<{
    trackId: string;
    localStep?: number | null;
  }>;
  drummerTracks?: Array<{
    trackId: string;
    localStep?: number | null;
  }>;
  controllerTracks?: Array<{
    controllerSequencerId: string;
    runtimePadStartSubunit?: number | null;
  }>;
}

function normalizeRuntimeStepCount(value: number): number {
  if (!Number.isFinite(value)) {
    return sequencerTransportStepsPerBeat(DEFAULT_SEQUENCER_TIMING_CONFIG);
  }
  return Math.max(1, Math.round(value));
}

export function sequencerRuntimeAtPlayhead(
  runtime: SequencerRuntimeState,
  playhead: number
): SequencerRuntimeState {
  const stepCount = normalizeRuntimeStepCount(runtime.stepCount);
  const normalizedPlayhead = ((Math.round(playhead) % stepCount) + stepCount) % stepCount;
  return {
    ...runtime,
    playhead: normalizedPlayhead,
    transportSubunit:
      Math.max(0, Math.round(runtime.cycle)) * stepCount * sequencerTransportSubunitsPerStep() +
      normalizedPlayhead * sequencerTransportSubunitsPerStep()
  };
}

export function sequencerRuntimeAtAbsoluteStep(
  runtime: SequencerRuntimeState,
  absoluteStep: number
): SequencerRuntimeState {
  const stepCount = normalizeRuntimeStepCount(runtime.stepCount);
  const normalizedStep = Math.max(0, Math.round(absoluteStep));
  const { playhead, cycle } = transportPositionFromAbsoluteStep(normalizedStep, stepCount);
  return {
    ...runtime,
    playhead,
    cycle,
    transportSubunit: normalizedStep * sequencerTransportSubunitsPerStep()
  };
}

export function syncSequencerTransportRuntimeState(
  runtime: SequencerRuntimeState,
  payload: SequencerTransportRuntimeSync
): SequencerRuntimeState {
  const nextIsPlaying = payload.isPlaying === true;
  const stepCount = normalizeRuntimeStepCount(payload.transportStepCount ?? runtime.stepCount);
  const playhead =
    payload.playhead === undefined
      ? runtime.playhead
      : ((Math.round(payload.playhead) % stepCount) + stepCount) % stepCount;
  const cycle = payload.cycle === undefined ? runtime.cycle : Math.max(0, Math.round(payload.cycle));
  const transportSubunit =
    payload.transportSubunit === undefined
      ? cycle * stepCount * sequencerTransportSubunitsPerStep() +
        playhead * sequencerTransportSubunitsPerStep()
      : Math.max(0, Math.floor(payload.transportSubunit));

  const trackLocalStepById = { ...runtime.trackLocalStepById };
  for (const track of payload.tracks ?? []) {
    trackLocalStepById[track.trackId] =
      !nextIsPlaying || track.localStep === undefined || track.localStep === null
        ? null
        : Math.max(0, Math.round(track.localStep));
  }

  const drummerTrackLocalStepById = { ...runtime.drummerTrackLocalStepById };
  for (const track of payload.drummerTracks ?? []) {
    drummerTrackLocalStepById[track.trackId] =
      !nextIsPlaying || track.localStep === undefined || track.localStep === null
        ? null
        : Math.max(0, Math.round(track.localStep));
  }

  const controllerRuntimePadStartSubunitById = {
    ...runtime.controllerRuntimePadStartSubunitById
  };
  for (const controllerTrack of payload.controllerTracks ?? []) {
    const runtimePadStartSubunit = controllerTrack.runtimePadStartSubunit;
    controllerRuntimePadStartSubunitById[controllerTrack.controllerSequencerId] =
      !nextIsPlaying || runtimePadStartSubunit === undefined || runtimePadStartSubunit === null
        ? null
        : Math.max(0, Math.floor(runtimePadStartSubunit));
  }

  if (!nextIsPlaying) {
    for (const trackId of Object.keys(trackLocalStepById)) {
      trackLocalStepById[trackId] = null;
    }
    for (const trackId of Object.keys(drummerTrackLocalStepById)) {
      drummerTrackLocalStepById[trackId] = null;
    }
    for (const controllerSequencerId of Object.keys(controllerRuntimePadStartSubunitById)) {
      controllerRuntimePadStartSubunitById[controllerSequencerId] = null;
    }
  }

  return {
    ...runtime,
    isPlaying: nextIsPlaying,
    stepCount,
    playhead,
    cycle,
    transportSubunit,
    trackLocalStepById,
    drummerTrackLocalStepById,
    controllerRuntimePadStartSubunitById
  };
}
