import type { StoreApi } from "zustand";

import { normalizeArrangerLoopSelection } from "../lib/arrangerTransport";
import {
  clampSequencerMeterDenominator,
  clampSequencerMeterNumerator,
  clampSequencerStepsPerBeat,
  clampSequencerTempoBpm,
  sequencerTransportSubunitsPerStep,
  sequencerTransportStepsPerBeat
} from "../lib/sequencer";
import {
  sequencerRuntimeAtAbsoluteStep,
  sequencerRuntimeAtPlayhead,
  syncSequencerTransportRuntimeState
} from "../lib/sequencerRuntimeState";
import type { DrummerSequencerStepCount } from "../types";
import type { AppStore } from "./appStoreTypes";
import {
  cloneSequencerSteps,
  normalizeDrummerSequencerStepCount,
  normalizePadIndex,
  normalizeSequencerPadLengthBeats,
  normalizeSequencerTrackStepCount,
  normalizeTransportStepCount,
  sequencerRuntimeStateFromSequencer,
  syncSequencerTimingState
} from "./appStoreModel";

type AppStoreSet = StoreApi<AppStore>["setState"];
type AppStoreGet = StoreApi<AppStore>["getState"];

export type TransportStoreActions = Pick<
  AppStore,
  | "setSequencerBpm"
  | "setSequencerMeterNumerator"
  | "setSequencerMeterDenominator"
  | "setSequencerStepsPerBeat"
  | "setSequencerArrangerLoopSelection"
  | "setSequencerPlaying"
  | "setSequencerPlayhead"
  | "setSequencerTransportAbsoluteStep"
  | "syncSequencerTransportRuntime"
  | "syncSequencerRuntime"
>;

export function createTransportStoreActions(
  set: AppStoreSet,
  get: AppStoreGet,
): TransportStoreActions {
  return {
    setSequencerBpm: (bpm) => {
      const sequencer = get().sequencer;
      const nextSequencer = syncSequencerTimingState(sequencer, {
        ...sequencer.timing,
        tempoBPM: clampSequencerTempoBpm(bpm)
      });
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerMeterNumerator: (numerator) => {
      const sequencer = get().sequencer;
      const timing = {
        ...sequencer.timing,
        meterNumerator: clampSequencerMeterNumerator(numerator)
      };
      const nextSequencer = syncSequencerTimingState(sequencer, timing);
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerMeterDenominator: (denominator) => {
      const sequencer = get().sequencer;
      const timing = {
        ...sequencer.timing,
        meterDenominator: clampSequencerMeterDenominator(denominator)
      };
      const nextSequencer = syncSequencerTimingState(sequencer, timing);
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerStepsPerBeat: (stepsPerBeat) => {
      const sequencer = get().sequencer;
      const timing = {
        ...sequencer.timing,
        stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
      };
      const nextSequencer = syncSequencerTimingState(sequencer, timing);
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer)
      });
    },

    setSequencerArrangerLoopSelection: (selection) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          arrangerLoopSelection: normalizeArrangerLoopSelection(
            selection,
            Number.MAX_SAFE_INTEGER,
            sequencerTransportStepsPerBeat(sequencer.timing)
          )
        }
      });
    },

    setSequencerPlaying: (isPlaying) => {
      const sequencer = get().sequencer;
      const sequencerRuntime = get().sequencerRuntime;
      const nextTrackLocalStepById: Record<string, number | null> = {};
      for (const track of sequencer.tracks) {
        nextTrackLocalStepById[track.id] = isPlaying ? (sequencerRuntime.trackLocalStepById[track.id] ?? null) : null;
      }
      const nextDrummerTrackLocalStepById: Record<string, number | null> = {};
      for (const track of sequencer.drummerTracks) {
        nextDrummerTrackLocalStepById[track.id] = isPlaying
          ? (sequencerRuntime.drummerTrackLocalStepById[track.id] ?? null)
          : null;
      }
      const nextControllerRuntimePadStartStepById: Record<string, number | null> = {};
      for (const controllerSequencer of sequencer.controllerSequencers) {
        nextControllerRuntimePadStartStepById[controllerSequencer.id] = isPlaying
          ? (sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null)
          : null;
      }
      set({
        sequencer: {
          ...sequencer,
          isPlaying: isPlaying === true,
          tracks: sequencer.tracks.map((track) => ({
            ...track,
            queuedPad: isPlaying ? track.queuedPad : null,
            padLoopPosition: isPlaying ? track.padLoopPosition : null,
            queuedEnabled: isPlaying ? track.queuedEnabled : null
          })),
          drummerTracks: sequencer.drummerTracks.map((track) => ({
            ...track,
            queuedPad: isPlaying ? track.queuedPad : null,
            padLoopPosition: isPlaying ? track.padLoopPosition : null,
            queuedEnabled: isPlaying ? track.queuedEnabled : null
          })),
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => ({
            ...controllerSequencer,
            queuedPad: isPlaying ? controllerSequencer.queuedPad : null,
            padLoopPosition: isPlaying ? controllerSequencer.padLoopPosition : null
          }))
        },
        sequencerRuntime: {
          ...sequencerRuntime,
          isPlaying: isPlaying === true,
          trackLocalStepById: nextTrackLocalStepById,
          drummerTrackLocalStepById: nextDrummerTrackLocalStepById,
          controllerRuntimePadStartSubunitById: nextControllerRuntimePadStartStepById
        }
      });
    },

    setSequencerPlayhead: (playhead) => {
      set({
        sequencerRuntime: sequencerRuntimeAtPlayhead(get().sequencerRuntime, playhead)
      });
    },

    setSequencerTransportAbsoluteStep: (absoluteStep) => {
      set({
        sequencerRuntime: sequencerRuntimeAtAbsoluteStep(get().sequencerRuntime, absoluteStep)
      });
    },

    syncSequencerTransportRuntime: (payload) => {
      set({
        sequencerRuntime: syncSequencerTransportRuntimeState(get().sequencerRuntime, payload)
      });
    },

    syncSequencerRuntime: ({ isPlaying, transportStepCount, playhead, cycle, transportSubunit, tracks, drummerTracks }) => {
      const sequencer = get().sequencer;
      const sequencerRuntime = get().sequencerRuntime;
      const nextIsPlaying = isPlaying === true;
      const boundedStepCount = normalizeTransportStepCount(transportStepCount ?? sequencerRuntime.stepCount);
      const normalizedPlayhead =
        playhead === undefined
          ? sequencerRuntime.playhead
          : ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;
      const normalizedCycle = cycle === undefined ? sequencerRuntime.cycle : Math.max(0, Math.round(cycle));
      const nextTransportSubunit =
        transportSubunit === undefined
          ? normalizedCycle * boundedStepCount * sequencerTransportSubunitsPerStep() +
            normalizedPlayhead * sequencerTransportSubunitsPerStep()
          : Math.max(0, Math.floor(transportSubunit));
      const trackPayload = new Map((tracks ?? []).map((track) => [track.trackId, track]));
      const drummerTrackPayload = new Map((drummerTracks ?? []).map((track) => [track.trackId, track]));
      let sequencerChanged = sequencer.isPlaying !== nextIsPlaying;
      const nextTracks = sequencer.tracks.map((track) => {
        const payload = trackPayload.get(track.id);
        if (!payload) {
          if (!nextIsPlaying) {
            if (track.queuedPad === null && track.padLoopPosition === null && track.queuedEnabled === null) {
              return track;
            }
            sequencerChanged = true;
            return {
              ...track,
              queuedPad: null,
              padLoopPosition: null,
              queuedEnabled: null
            };
          }
          return track;
        }

        const nextActivePad =
          payload.activePad === undefined ? track.activePad : normalizePadIndex(payload.activePad);
        const currentSelectedPad = track.pads[nextActivePad] ?? track.pads[0];
        const nextStepCount = normalizeTransportStepCount(payload.stepCount ?? currentSelectedPad?.stepCount ?? track.stepCount);
        const nextLengthBeats = normalizeSequencerPadLengthBeats(currentSelectedPad?.lengthBeats ?? track.lengthBeats);
        const nextQueuedPad =
          payload.queuedPad === undefined
            ? track.queuedPad
            : payload.queuedPad === null
              ? null
              : normalizePadIndex(payload.queuedPad);
        const nextPadLoopPosition =
          payload.padLoopPosition === undefined
            ? track.padLoopPosition
            : payload.padLoopPosition === null
              ? null
              : Math.max(0, Math.round(payload.padLoopPosition));
        const nextEnabled = payload.enabled === undefined ? track.enabled : payload.enabled;
        const nextQueuedEnabled =
          payload.queuedEnabled === undefined
            ? track.queuedEnabled
            : payload.queuedEnabled === null
              ? null
              : payload.queuedEnabled;
        const nextRuntimePadStartSubunit =
          payload.runtimePadStartSubunit === undefined
            ? track.runtimePadStartSubunit
            : payload.runtimePadStartSubunit === null
              ? null
              : Math.max(0, Math.floor(payload.runtimePadStartSubunit));
        const selectedPad = track.pads[nextActivePad] ?? track.pads[0];
        const nextScaleRoot = selectedPad?.scaleRoot ?? track.scaleRoot;
        const nextScaleType = selectedPad?.scaleType ?? track.scaleType;
        const nextMode = selectedPad?.mode ?? track.mode;

        if (
          nextActivePad === track.activePad &&
          nextQueuedPad === track.queuedPad &&
          nextPadLoopPosition === track.padLoopPosition &&
          nextLengthBeats === track.lengthBeats &&
          nextStepCount === track.stepCount &&
          nextEnabled === track.enabled &&
          nextQueuedEnabled === track.queuedEnabled &&
          nextRuntimePadStartSubunit === track.runtimePadStartSubunit &&
          nextScaleRoot === track.scaleRoot &&
          nextScaleType === track.scaleType &&
          nextMode === track.mode
        ) {
          return track;
        }

        sequencerChanged = true;
        return {
          ...track,
          activePad: nextActivePad,
          queuedPad: nextQueuedPad,
          padLoopPosition: nextPadLoopPosition,
          lengthBeats: nextLengthBeats,
          stepCount: nextStepCount,
          enabled: nextEnabled,
          queuedEnabled: nextQueuedEnabled,
          runtimePadStartSubunit: nextRuntimePadStartSubunit,
          scaleRoot: nextScaleRoot,
          scaleType: nextScaleType,
          mode: nextMode,
          steps:
            nextActivePad === track.activePad
              ? track.steps
              : cloneSequencerSteps(selectedPad?.steps ?? track.steps)
        };
      });
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        const payload = drummerTrackPayload.get(track.id) as
          | {
              stepCount?: DrummerSequencerStepCount;
              localStep?: number;
              runtimePadStartSubunit?: number | null;
              activePad?: number;
              queuedPad?: number | null;
              padLoopPosition?: number | null;
              enabled?: boolean;
              queuedEnabled?: boolean | null;
            }
          | undefined;
        if (!payload) {
          if (!nextIsPlaying) {
            if (track.queuedPad === null && track.padLoopPosition === null && track.queuedEnabled === null) {
              return track;
            }
            sequencerChanged = true;
            return {
              ...track,
              queuedPad: null,
              padLoopPosition: null,
              queuedEnabled: null
            };
          }
          return track;
        }

        const nextActivePad =
          payload.activePad === undefined ? track.activePad : normalizePadIndex(payload.activePad);
        const selectedPad = track.pads[nextActivePad] ?? track.pads[0];
        const nextStepCount = normalizeTransportStepCount(payload.stepCount ?? selectedPad?.stepCount ?? track.stepCount);
        const nextLengthBeats = normalizeSequencerPadLengthBeats(selectedPad?.lengthBeats ?? track.lengthBeats);
        const nextQueuedPad =
          payload.queuedPad === undefined
            ? track.queuedPad
            : payload.queuedPad === null
              ? null
              : normalizePadIndex(payload.queuedPad);
        const nextPadLoopPosition =
          payload.padLoopPosition === undefined
            ? track.padLoopPosition
            : payload.padLoopPosition === null
              ? null
              : Math.max(0, Math.round(payload.padLoopPosition));
        const nextEnabled = payload.enabled === undefined ? track.enabled : payload.enabled;
        const nextQueuedEnabled =
          payload.queuedEnabled === undefined
            ? track.queuedEnabled
            : payload.queuedEnabled === null
              ? null
              : payload.queuedEnabled;
        const nextRuntimePadStartSubunit =
          payload.runtimePadStartSubunit === undefined
            ? track.runtimePadStartSubunit
            : payload.runtimePadStartSubunit === null
              ? null
              : Math.max(0, Math.floor(payload.runtimePadStartSubunit));

        if (
          nextActivePad === track.activePad &&
          nextQueuedPad === track.queuedPad &&
          nextPadLoopPosition === track.padLoopPosition &&
          nextLengthBeats === track.lengthBeats &&
          nextStepCount === track.stepCount &&
          nextEnabled === track.enabled &&
          nextQueuedEnabled === track.queuedEnabled &&
          nextRuntimePadStartSubunit === track.runtimePadStartSubunit
        ) {
          return track;
        }

        sequencerChanged = true;
        return {
          ...track,
          activePad: nextActivePad,
          queuedPad: nextQueuedPad,
          padLoopPosition: nextPadLoopPosition,
          lengthBeats: nextLengthBeats,
          stepCount: nextStepCount,
          enabled: nextEnabled,
          queuedEnabled: nextQueuedEnabled,
          runtimePadStartSubunit: nextRuntimePadStartSubunit
        };
      });
      const nextControllerSequencers = sequencer.controllerSequencers.map((controllerSequencer) =>
        nextIsPlaying
          ? controllerSequencer
          : {
              ...controllerSequencer,
              queuedPad: null,
              padLoopPosition: null
            }
      );
      if (
        !nextIsPlaying &&
        nextControllerSequencers.some(
          (controllerSequencer, index) => controllerSequencer !== sequencer.controllerSequencers[index]
        )
      ) {
        sequencerChanged = true;
      }

      const nextTrackLocalStepById: Record<string, number | null> = {};
      for (const track of nextTracks) {
        const payload = trackPayload.get(track.id);
        const normalizedLocalStep =
          !nextIsPlaying || !payload || payload.localStep === undefined
            ? null
            : Math.max(0, Math.round(payload.localStep)) % Math.max(1, normalizeSequencerTrackStepCount(track.stepCount));
        nextTrackLocalStepById[track.id] =
          normalizedLocalStep === null ? sequencerRuntime.trackLocalStepById[track.id] ?? null : normalizedLocalStep;
      }
      if (!nextIsPlaying) {
        for (const trackId of Object.keys(nextTrackLocalStepById)) {
          nextTrackLocalStepById[trackId] = null;
        }
      }

      const nextDrummerTrackLocalStepById: Record<string, number | null> = {};
      for (const track of nextDrummerTracks) {
        const payload = drummerTrackPayload.get(track.id);
        const normalizedLocalStep =
          !nextIsPlaying || !payload || payload.localStep === undefined
            ? null
            : Math.max(0, Math.round(payload.localStep)) % Math.max(1, normalizeDrummerSequencerStepCount(track.stepCount));
        nextDrummerTrackLocalStepById[track.id] =
          normalizedLocalStep === null
            ? sequencerRuntime.drummerTrackLocalStepById[track.id] ?? null
            : normalizedLocalStep;
      }
      if (!nextIsPlaying) {
        for (const trackId of Object.keys(nextDrummerTrackLocalStepById)) {
          nextDrummerTrackLocalStepById[trackId] = null;
        }
      }

      const nextControllerRuntimePadStartStepById: Record<string, number | null> = {};
      for (const controllerSequencer of nextControllerSequencers) {
        nextControllerRuntimePadStartStepById[controllerSequencer.id] = nextIsPlaying
          ? (sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null)
          : null;
      }

      set({
        ...(sequencerChanged
          ? {
              sequencer: {
                ...sequencer,
                isPlaying: nextIsPlaying,
                tracks: nextTracks,
                controllerSequencers: nextControllerSequencers,
                drummerTracks: nextDrummerTracks
              }
            }
          : {}),
        sequencerRuntime: {
          ...sequencerRuntime,
          isPlaying: nextIsPlaying,
          stepCount: boundedStepCount,
          cycle: normalizedCycle,
          playhead: normalizedPlayhead,
          transportSubunit: nextTransportSubunit,
          trackLocalStepById: nextTrackLocalStepById,
          drummerTrackLocalStepById: nextDrummerTrackLocalStepById,
          controllerRuntimePadStartSubunitById: nextControllerRuntimePadStartStepById
        }
      });
    },
  };
}
