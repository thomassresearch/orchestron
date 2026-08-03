import type { StoreApi } from "zustand";

import { insertPadLoopItem, removePadLoopItemsFromContainer } from "../lib/padLoopPattern";
import {
  clampControllerCurvePosition,
  clampControllerCurveValue,
  normalizeSequencerBeatRate,
  clampSequencerMeterDenominator,
  clampSequencerMeterNumerator,
  clampSequencerStepsPerBeat,
  linkedModeForScaleType,
  linkedScaleTypeForMode,
  normalizeControllerCurveKeypoints,
  normalizeSequencerMode,
  normalizeSequencerScaleRoot,
  normalizeSequencerScaleType
} from "../lib/sequencer";
import type { ArpeggiatorPresetState } from "../types";
import type { AppStore } from "./appStoreTypes";
import {
  MAX_ARPEGGIATORS,
  MAX_MIDI_CONTROLLERS,
  arpeggiatorTargetChannelAvoidingInputs,
  clampInt,
  cloneControllerSequencerPad,
  defaultArpeggiator,
  defaultArpeggiatorTargetChannel,
  defaultControllerSequencer,
  defaultControllerSequencerKeypoints,
  defaultMidiController,
  defaultPianoRoll,
  fallbackControllerSequencerPadStateForSequencer,
  nextAvailableArpeggiatorInputChannel,
  nextAvailableControllerNumber,
  nextAvailableControllerSequencerNumber,
  nextAvailablePerformanceChannel,
  normalizeArpeggiatorPresets,
  normalizeArpeggiatorSettings,
  normalizeArpeggiatorState,
  normalizeControllerNumber,
  normalizeControllerSequencerLengthBeats,
  normalizeControllerValue,
  normalizePadIndex,
  normalizePadLoopPatternForState,
  normalizeStepNote,
  normalizeStepVelocity,
  normalizeTransportStepCount,
  performanceDeviceCount,
  resolvedControllerPadStepCount,
  sequencerRuntimeStateFromSequencer,
  updateControllerSequencerTimingState
} from "./appStoreModel";

type AppStoreSet = StoreApi<AppStore>["setState"];
type AppStoreGet = StoreApi<AppStore>["getState"];

export type PerformanceControlStoreActions = Pick<
  AppStore,
  | "addPianoRoll"
  | "removePianoRoll"
  | "setPianoRollEnabled"
  | "setPianoRollMidiChannel"
  | "setPianoRollVelocity"
  | "setPianoRollScale"
  | "setPianoRollMode"
  | "addMidiController"
  | "removeMidiController"
  | "setMidiControllerEnabled"
  | "setMidiControllerNumber"
  | "setMidiControllerValue"
  | "addControllerSequencer"
  | "removeControllerSequencer"
  | "setControllerSequencerEnabled"
  | "setControllerSequencerNumber"
  | "setControllerSequencerActivePad"
  | "setControllerSequencerQueuedPad"
  | "copyControllerSequencerPad"
  | "clearControllerSequencerSteps"
  | "setControllerSequencerPadLoopEnabled"
  | "setControllerSequencerPadLoopRepeat"
  | "setControllerSequencerPadLoopPattern"
  | "addControllerSequencerPadLoopStep"
  | "removeControllerSequencerPadLoopStep"
  | "setControllerSequencerMeterNumerator"
  | "setControllerSequencerMeterDenominator"
  | "setControllerSequencerStepsPerBeat"
  | "setControllerSequencerBeatRate"
  | "setControllerSequencerStepCount"
  | "addControllerSequencerKeypoint"
  | "setControllerSequencerKeypoint"
  | "setControllerSequencerKeypointValue"
  | "removeControllerSequencerKeypoint"
  | "syncControllerSequencerRuntime"
  | "addArpeggiator"
  | "removeArpeggiator"
  | "setArpeggiatorEnabled"
  | "updateArpeggiator"
  | "applyArpeggiatorPreset"
  | "saveArpeggiatorPreset"
  | "syncArpeggiatorRuntime"
>;

export function createPerformanceControlStoreActions(
  set: AppStoreSet,
  get: AppStoreGet,
): PerformanceControlStoreActions {
  return {
    addPianoRoll: () => {
      const sequencer = get().sequencer;
      if (sequencer.pianoRolls.length >= 8) {
        set({ error: "A maximum of 8 piano rolls is supported." });
        return;
      }

      const nextIndex = sequencer.pianoRolls.length + 1;
      const roll = defaultPianoRoll(nextIndex, nextAvailablePerformanceChannel(sequencer));
      roll.id = crypto.randomUUID();
      roll.name = `Piano Roll ${nextIndex}`;

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: [...sequencer.pianoRolls, roll]
        },
        error: null
      });
    },

    removePianoRoll: (rollId) => {
      const sequencer = get().sequencer;
      if (!sequencer.pianoRolls.some((roll) => roll.id === rollId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.filter((roll) => roll.id !== rollId)
        },
        error: null
      });
    },

    setPianoRollEnabled: (rollId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, enabled } : roll
          )
        }
      });
    },

    setPianoRollMidiChannel: (rollId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, midiChannel: normalizedChannel } : roll
          )
        }
      });
    },

    setPianoRollVelocity: (rollId, velocity) => {
      const normalizedVelocity = clampInt(velocity, 0, 127);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, velocity: normalizedVelocity } : roll
          )
        }
      });
    },

    setPianoRollScale: (rollId, scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      const nextMode = linkedModeForScaleType(normalizedType);
      const sequencer = get().sequencer;

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId
              ? {
                  ...roll,
                  scaleRoot: normalizedRoot,
                  scaleType: normalizedType,
                  mode: nextMode ?? roll.mode
                }
              : roll
          )
        }
      });
    },

    setPianoRollMode: (rollId, mode) => {
      const normalizedMode = normalizeSequencerMode(mode);
      const normalizedScaleType = linkedScaleTypeForMode(normalizedMode);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId
              ? {
                  ...roll,
                  mode: normalizedMode,
                  scaleType: normalizedScaleType
                }
              : roll
          )
        }
      });
    },

    addMidiController: () => {
      const sequencer = get().sequencer;
      if (sequencer.midiControllers.length >= MAX_MIDI_CONTROLLERS) {
        set({ error: `A maximum of ${MAX_MIDI_CONTROLLERS} MIDI controllers is supported.` });
        return;
      }

      const nextIndex = sequencer.midiControllers.length + 1;
      const controller = defaultMidiController(nextIndex);
      controller.id = crypto.randomUUID();
      controller.name = `Controller ${nextIndex}`;
      controller.controllerNumber = nextAvailableControllerNumber(sequencer.midiControllers);

      set({
        sequencer: {
          ...sequencer,
          midiControllers: [...sequencer.midiControllers, controller]
        },
        error: null
      });
    },

    removeMidiController: (controllerId) => {
      const sequencer = get().sequencer;
      if (!sequencer.midiControllers.some((controller) => controller.id === controllerId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.filter((controller) => controller.id !== controllerId)
        },
        error: null
      });
    },

    setMidiControllerEnabled: (controllerId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, enabled } : controller
          )
        }
      });
    },

    setMidiControllerNumber: (controllerId, controllerNumber) => {
      const normalizedNumber = normalizeControllerNumber(controllerNumber);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, controllerNumber: normalizedNumber } : controller
          )
        }
      });
    },

    setMidiControllerValue: (controllerId, value) => {
      const normalizedValue = normalizeControllerValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, value: normalizedValue } : controller
          )
        }
      });
    },

    addControllerSequencer: () => {
      const sequencer = get().sequencer;
      if (sequencer.controllerSequencers.length >= 8) {
        set({ error: "A maximum of 8 controller sequencers is supported." });
        return;
      }

      const nextIndex = sequencer.controllerSequencers.length + 1;
      const controllerSequencer = defaultControllerSequencer(nextIndex);
      controllerSequencer.id = crypto.randomUUID();
      controllerSequencer.name = `Controller Sequencer ${nextIndex}`;
      controllerSequencer.controllerNumber = nextAvailableControllerSequencerNumber(sequencer.controllerSequencers);

      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: [...sequencer.controllerSequencers, controllerSequencer]
        },
        error: null
      });
    },

    removeControllerSequencer: (controllerSequencerId) => {
      const sequencer = get().sequencer;
      if (!sequencer.controllerSequencers.some((controllerSequencer) => controllerSequencer.id === controllerSequencerId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.filter(
            (controllerSequencer) => controllerSequencer.id !== controllerSequencerId
          )
        },
        error: null
      });
    },

    setControllerSequencerEnabled: (controllerSequencerId, enabled) => {
      const sequencer = get().sequencer;
      const runtimeState = get().sequencerRuntime;
      const controllerRuntime = runtimeState.controllerRuntimePadStartSubunitById;
      const nextEnabled = enabled === true;
      const currentController =
        sequencer.controllerSequencers.find((controllerSequencer) => controllerSequencer.id === controllerSequencerId) ??
        null;
      const runtimeResetRequired = currentController ? nextEnabled !== currentController.enabled : false;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            return {
              ...controllerSequencer,
              enabled: nextEnabled,
              queuedPad: !nextEnabled ? null : runtimeResetRequired ? null : controllerSequencer.queuedPad,
              padLoopPosition:
                !nextEnabled || runtimeResetRequired ? null : controllerSequencer.padLoopPosition
            };
          })
        },
        sequencerRuntime: {
          ...runtimeState,
          controllerRuntimePadStartSubunitById: {
            ...controllerRuntime,
            [controllerSequencerId]:
              !nextEnabled || runtimeResetRequired ? null : (controllerRuntime[controllerSequencerId] ?? null)
          }
        }
      });
    },

    setControllerSequencerNumber: (controllerSequencerId, controllerNumber) => {
      const normalizedNumber = normalizeControllerNumber(controllerNumber);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? { ...controllerSequencer, controllerNumber: normalizedNumber }
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerActivePad: (controllerSequencerId, padIndex) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const normalizedPad = normalizePadIndex(padIndex);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const selectedPad =
              controllerSequencer.pads[normalizedPad] ??
              controllerSequencer.pads[0] ??
              fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            return {
              ...controllerSequencer,
              activePad: normalizedPad,
              queuedPad: isPlaying && controllerSequencer.enabled ? controllerSequencer.queuedPad : null,
              lengthBeats: normalizeControllerSequencerLengthBeats(selectedPad.lengthBeats),
              stepCount: normalizeTransportStepCount(selectedPad.stepCount),
              keypoints: normalizeControllerCurveKeypoints(selectedPad.keypoints)
            };
          })
        }
      });
    },

    setControllerSequencerQueuedPad: (controllerSequencerId, padIndex) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
                }
              : controllerSequencer
          )
        }
      });
    },

    copyControllerSequencerPad: (controllerSequencerId, sourcePadIndex, targetPadIndex) => {
      const normalizedSourcePad = normalizePadIndex(sourcePadIndex);
      const normalizedTargetPad = normalizePadIndex(targetPadIndex);
      if (normalizedSourcePad === normalizedTargetPad) {
        return;
      }
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const fallbackPad = fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const sourcePad = pads[normalizedSourcePad] ?? fallbackPad;
            const copiedPad = cloneControllerSequencerPad(sourcePad);
            pads[normalizedTargetPad] = copiedPad;

            if (normalizePadIndex(controllerSequencer.activePad) !== normalizedTargetPad) {
              return {
                ...controllerSequencer,
                pads
              };
            }

            return {
              ...controllerSequencer,
              pads,
              lengthBeats: copiedPad.lengthBeats,
              stepCount: copiedPad.stepCount,
              keypoints: normalizeControllerCurveKeypoints(copiedPad.keypoints)
            };
          })
        }
      });
    },

    clearControllerSequencerSteps: (controllerSequencerId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const nextKeypoints = defaultControllerSequencerKeypoints();
            pads[activePad] = {
              ...sourcePad,
              keypoints: nextKeypoints
            };
            return {
              ...controllerSequencer,
              pads,
              keypoints: nextKeypoints
            };
          })
        }
      });
    },

    setControllerSequencerPadLoopEnabled: (controllerSequencerId, enabled) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const nextEnabled = enabled === true;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  padLoopEnabled: nextEnabled,
                  padLoopPosition:
                    nextEnabled && isPlaying ? controllerSequencer.padLoopPosition : null
                }
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerPadLoopRepeat: (controllerSequencerId, repeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  padLoopRepeat: repeat !== false
                }
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerPadLoopPattern: (controllerSequencerId, pattern) => {
      const sequencer = get().sequencer;
      const normalizedPattern = normalizePadLoopPatternForState(pattern);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...controllerSequencer,
                  padLoopPattern: normalizedPattern.padLoopPattern,
                  padLoopSequence: normalizedPattern.padLoopSequence
                }
              : controllerSequencer
          )
        }
      });
    },

    addControllerSequencerPadLoopStep: (controllerSequencerId, padIndex) => {
      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            if (controllerSequencer.padLoopSequence.length >= 256) {
              return controllerSequencer;
            }
            const nextPattern = insertPadLoopItem(
              controllerSequencer.padLoopPattern,
              { kind: "root" },
              controllerSequencer.padLoopPattern.rootSequence.length,
              { type: "pad", padIndex: normalizedPad }
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...controllerSequencer,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    removeControllerSequencerPadLoopStep: (controllerSequencerId, sequenceIndex) => {
      if (!Number.isFinite(sequenceIndex)) {
        return;
      }
      const normalizedSequenceIndex = Math.max(0, Math.round(sequenceIndex));
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            if (
              normalizedSequenceIndex < 0 ||
              normalizedSequenceIndex >= controllerSequencer.padLoopPattern.rootSequence.length
            ) {
              return controllerSequencer;
            }
            const nextPattern = removePadLoopItemsFromContainer(
              controllerSequencer.padLoopPattern,
              { kind: "root" },
              [normalizedSequenceIndex]
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...controllerSequencer,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    setControllerSequencerMeterNumerator: (controllerSequencerId, numerator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  meterNumerator: clampSequencerMeterNumerator(numerator)
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerMeterDenominator: (controllerSequencerId, denominator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  meterDenominator: clampSequencerMeterDenominator(denominator)
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerStepsPerBeat: (controllerSequencerId, stepsPerBeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerBeatRate: (controllerSequencerId, numerator, denominator) => {
      const sequencer = get().sequencer;
      const beatRate = normalizeSequencerBeatRate(numerator, denominator);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? updateControllerSequencerTimingState(controllerSequencer, {
                  beatRateNumerator: beatRate.numerator,
                  beatRateDenominator: beatRate.denominator
                })
              : controllerSequencer
          )
        }
      });
    },

    setControllerSequencerStepCount: (controllerSequencerId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedLengthBeats = normalizeControllerSequencerLengthBeats(stepCount);
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const normalizedStepCount = resolvedControllerPadStepCount(
              normalizedLengthBeats,
              controllerSequencer.timing
            );
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad, index) =>
              index === activePad
                ? { ...pad, lengthBeats: normalizedLengthBeats, stepCount: normalizedStepCount }
                : cloneControllerSequencerPad(pad)
            );
            return {
              ...controllerSequencer,
              lengthBeats: normalizedLengthBeats,
              stepCount: normalizedStepCount,
              pads
            };
          })
        }
      });
    },

    addControllerSequencerKeypoint: (controllerSequencerId, position, value) => {
      const normalizedPosition = clampControllerCurvePosition(position);
      const normalizedValue = clampControllerCurveValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const nextKeypoints = normalizeControllerCurveKeypoints([
              ...sourcePad.keypoints,
              {
                id: crypto.randomUUID(),
                position: normalizedPosition,
                value: normalizedValue
              }
            ]);
            pads[activePad] = {
              ...sourcePad,
              keypoints: nextKeypoints
            };
            return {
              ...controllerSequencer,
              pads,
              keypoints: nextKeypoints
            };
          })
        }
      });
    },

    setControllerSequencerKeypoint: (controllerSequencerId, keypointId, position, value) => {
      const normalizedPosition = clampControllerCurvePosition(position);
      const normalizedValue = clampControllerCurveValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);

            const nextKeypoints = sourcePad.keypoints.map((keypoint) => {
              if (keypoint.id !== keypointId) {
                return keypoint;
              }

              const isStart = keypoint.position <= 1e-6;
              const isEnd = keypoint.position >= 1 - 1e-6;
              return {
                ...keypoint,
                position: isStart ? 0 : isEnd ? 1 : normalizedPosition,
                value: normalizedValue
              };
            });

            const movedPoint = sourcePad.keypoints.find((keypoint) => keypoint.id === keypointId);
            const movedIsBorder =
              (movedPoint?.position ?? 0) <= 1e-6 || (movedPoint?.position ?? 0) >= 1 - 1e-6;
            const linkedKeypoints = movedIsBorder
              ? nextKeypoints.map((keypoint) =>
                  keypoint.position <= 1e-6 || keypoint.position >= 1 - 1e-6
                    ? { ...keypoint, value: normalizedValue }
                    : keypoint
                )
              : nextKeypoints;
            const normalizedKeypoints = normalizeControllerCurveKeypoints(linkedKeypoints);
            pads[activePad] = {
              ...sourcePad,
              keypoints: normalizedKeypoints
            };

            return {
              ...controllerSequencer,
              pads,
              keypoints: normalizedKeypoints
            };
          })
        }
      });
    },

    setControllerSequencerKeypointValue: (controllerSequencerId, keypointId, value) => {
      const normalizedValue = clampControllerCurveValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) => {
            if (controllerSequencer.id !== controllerSequencerId) {
              return controllerSequencer;
            }
            const activePad = normalizePadIndex(controllerSequencer.activePad);
            const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
            const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
            const target = sourcePad.keypoints.find((keypoint) => keypoint.id === keypointId);
            const isBorderTarget =
              (target?.position ?? 0) <= 1e-6 || (target?.position ?? 0) >= 1 - 1e-6;
            const nextKeypoints = sourcePad.keypoints.map((keypoint) => {
              if (keypoint.id === keypointId) {
                return { ...keypoint, value: normalizedValue };
              }
              if (isBorderTarget && (keypoint.position <= 1e-6 || keypoint.position >= 1 - 1e-6)) {
                return { ...keypoint, value: normalizedValue };
              }
              return keypoint;
            });
            const normalizedKeypoints = normalizeControllerCurveKeypoints(nextKeypoints);
            pads[activePad] = {
              ...sourcePad,
              keypoints: normalizedKeypoints
            };
            return {
              ...controllerSequencer,
              pads,
              keypoints: normalizedKeypoints
            };
          })
        }
      });
    },

    removeControllerSequencerKeypoint: (controllerSequencerId, keypointId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          controllerSequencers: sequencer.controllerSequencers.map((controllerSequencer) =>
            controllerSequencer.id === controllerSequencerId
              ? {
                  ...(() => {
                    const activePad = normalizePadIndex(controllerSequencer.activePad);
                    const pads = controllerSequencer.pads.map((pad) => cloneControllerSequencerPad(pad));
                    const sourcePad = pads[activePad] ?? fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
                    const normalizedKeypoints = normalizeControllerCurveKeypoints(
                      sourcePad.keypoints.filter((keypoint) => {
                        const isBorder =
                          keypoint.position <= 1e-6 || keypoint.position >= 1 - 1e-6;
                        if (isBorder) {
                          return true;
                        }
                        return keypoint.id !== keypointId;
                      })
                    );
                    pads[activePad] = {
                      ...sourcePad,
                      keypoints: normalizedKeypoints
                    };
                    return {
                      ...controllerSequencer,
                      pads,
                      keypoints: normalizedKeypoints
                    };
                  })()
                }
              : controllerSequencer
          )
        }
      });
    },

    syncControllerSequencerRuntime: (updates) => {
      const sequencer = get().sequencer;
      const sequencerRuntime = get().sequencerRuntime;
      const byId = new Map(updates.map((update) => [update.controllerSequencerId, update]));
      if (byId.size === 0) {
        return;
      }
      const nextControllerRuntimePadStartSubunitById = { ...sequencerRuntime.controllerRuntimePadStartSubunitById };
      let runtimeChanged = false;
      let controllerSequencersChanged = false;
      const nextControllerSequencers = sequencer.controllerSequencers.map((controllerSequencer) => {
        const update = byId.get(controllerSequencer.id);
        if (!update) {
          return controllerSequencer;
        }

        const nextActivePad =
          update.activePad === undefined ? controllerSequencer.activePad : normalizePadIndex(update.activePad);
        const nextQueuedPad =
          update.queuedPad === undefined
            ? controllerSequencer.queuedPad
            : update.queuedPad === null
              ? null
              : normalizePadIndex(update.queuedPad);
        const nextPadLoopPosition =
          update.padLoopPosition === undefined
            ? controllerSequencer.padLoopPosition
            : update.padLoopPosition === null
              ? null
              : Math.max(0, Math.round(update.padLoopPosition));
        const nextEnabled = update.enabled === undefined ? controllerSequencer.enabled : update.enabled === true;
        const activePadChanged = nextActivePad !== controllerSequencer.activePad;
        const selectedPad =
          controllerSequencer.pads[nextActivePad] ??
          controllerSequencer.pads[0] ??
          fallbackControllerSequencerPadStateForSequencer(controllerSequencer);
        const nextLengthBeats = normalizeControllerSequencerLengthBeats(selectedPad.lengthBeats);
        const nextStepCount = normalizeTransportStepCount(selectedPad.stepCount);
        const nextKeypoints = normalizeControllerCurveKeypoints(selectedPad.keypoints);

        const runtimeCandidate =
          update.runtimePadStartSubunit === undefined
            ? sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null
            : update.runtimePadStartSubunit;
        const normalizedRuntimePadStartSubunit =
          typeof runtimeCandidate === "number" && Number.isFinite(runtimeCandidate)
            ? Math.max(0, Math.floor(runtimeCandidate))
            : null;
        const nextRuntimePadStartSubunit = nextEnabled ? normalizedRuntimePadStartSubunit : null;
        if (
          (nextControllerRuntimePadStartSubunitById[controllerSequencer.id] ?? null) !==
          nextRuntimePadStartSubunit
        ) {
          nextControllerRuntimePadStartSubunitById[controllerSequencer.id] = nextRuntimePadStartSubunit;
          runtimeChanged = true;
        }

        if (
          !activePadChanged &&
          nextQueuedPad === controllerSequencer.queuedPad &&
          nextPadLoopPosition === controllerSequencer.padLoopPosition &&
          nextEnabled === controllerSequencer.enabled &&
          nextLengthBeats === controllerSequencer.lengthBeats &&
          nextStepCount === controllerSequencer.stepCount
        ) {
          return controllerSequencer;
        }

        controllerSequencersChanged = true;
        return {
          ...controllerSequencer,
          activePad: nextActivePad,
          queuedPad: nextEnabled ? nextQueuedPad : null,
          padLoopPosition: nextEnabled ? nextPadLoopPosition : null,
          enabled: nextEnabled,
          lengthBeats: nextLengthBeats,
          stepCount: nextStepCount,
          keypoints: activePadChanged ? nextKeypoints : controllerSequencer.keypoints
        };
      });

      if (!controllerSequencersChanged && !runtimeChanged) {
        return;
      }

      set({
        ...(controllerSequencersChanged
          ? {
              sequencer: {
                ...sequencer,
                controllerSequencers: nextControllerSequencers
              }
            }
          : {}),
        ...(runtimeChanged
          ? {
              sequencerRuntime: {
                ...sequencerRuntime,
                controllerRuntimePadStartSubunitById: nextControllerRuntimePadStartSubunitById
              }
            }
          : {})
      });
    },

    addArpeggiator: () => {
      const sequencer = get().sequencer;
      const instruments = get().sequencerInstruments;
      if (sequencer.arpeggiators.length >= MAX_ARPEGGIATORS) {
        set({ error: "A maximum of 8 arpeggiators is supported." });
        return;
      }

      const nextIndex = sequencer.arpeggiators.length + 1;
      const inputChannel = nextAvailableArpeggiatorInputChannel(sequencer, instruments);
      const targetChannel = arpeggiatorTargetChannelAvoidingInputs(
        defaultArpeggiatorTargetChannel(instruments),
        new Set([...sequencer.arpeggiators.map((arpeggiator) => clampInt(arpeggiator.inputChannel, 1, 16)), inputChannel]),
        instruments
      );
      const arpeggiator = defaultArpeggiator(nextIndex, inputChannel, targetChannel);
      arpeggiator.id = crypto.randomUUID();
      arpeggiator.name = `Arpeggiator ${nextIndex}`;

      const nextSequencer = {
        ...sequencer,
        arpeggiators: [...sequencer.arpeggiators, arpeggiator]
      };

      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer),
        error: null
      });
    },

    removeArpeggiator: (arpeggiatorId) => {
      const sequencer = get().sequencer;
      if (!sequencer.arpeggiators.some((arpeggiator) => arpeggiator.id === arpeggiatorId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      const nextSequencer = {
        ...sequencer,
        arpeggiators: sequencer.arpeggiators.filter((arpeggiator) => arpeggiator.id !== arpeggiatorId)
      };
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer),
        error: null
      });
    },

    setArpeggiatorEnabled: (arpeggiatorId, enabled) => {
      const sequencer = get().sequencer;
      const nextSequencer = {
        ...sequencer,
        arpeggiators: sequencer.arpeggiators.map((arpeggiator) =>
          arpeggiator.id === arpeggiatorId ? { ...arpeggiator, enabled: enabled === true } : arpeggiator
        )
      };
      set({
        sequencer: nextSequencer,
        sequencerRuntime: {
          ...get().sequencerRuntime,
          arpeggiatorStatusById: sequencerRuntimeStateFromSequencer(nextSequencer).arpeggiatorStatusById
        },
        error: null
      });
    },

    updateArpeggiator: (arpeggiatorId, update) => {
      const sequencer = get().sequencer;
      const instruments = get().sequencerInstruments;
      const existing = sequencer.arpeggiators.find((arpeggiator) => arpeggiator.id === arpeggiatorId);
      if (!existing) {
        return;
      }

      const otherArpeggiatorInputChannels = new Set(
        sequencer.arpeggiators
          .filter((arpeggiator) => arpeggiator.id !== arpeggiatorId)
          .map((arpeggiator) => clampInt(arpeggiator.inputChannel, 1, 16))
      );
      const unavailableInputChannels = new Set(otherArpeggiatorInputChannels);
      for (const instrument of instruments) {
        if (instrument.midiChannel <= 0) {
          continue;
        }
        const channel = clampInt(instrument.midiChannel, 1, 16);
        if (channel !== existing.inputChannel) {
          unavailableInputChannels.add(channel);
        }
      }
      const requestedInput =
        typeof update.inputChannel === "number" ? clampInt(update.inputChannel, 1, 16) : existing.inputChannel;
      const nextInputChannel = unavailableInputChannels.has(requestedInput) ? existing.inputChannel : requestedInput;
      const arpeggiatorInputChannels = new Set([...otherArpeggiatorInputChannels, nextInputChannel]);
      const requestedTarget =
        typeof update.targetChannel === "number" ? clampInt(update.targetChannel, 1, 16) : existing.targetChannel;
      const nextTargetChannel = arpeggiatorTargetChannelAvoidingInputs(
        requestedTarget,
        arpeggiatorInputChannels,
        instruments,
        existing.targetChannel
      );

      const nextSequencer = {
        ...sequencer,
        arpeggiators: sequencer.arpeggiators.map((arpeggiator, index) => {
          if (arpeggiator.id !== arpeggiatorId) {
            return arpeggiator;
          }
          return {
            ...normalizeArpeggiatorState(
              {
                ...arpeggiator,
                ...update,
                id: arpeggiator.id,
                inputChannel: nextInputChannel,
                targetChannel: nextTargetChannel
              },
              index + 1
            ),
            heldNotes: arpeggiator.heldNotes,
            activeNote: arpeggiator.activeNote,
            stepIndex: arpeggiator.stepIndex,
            lastVelocity: arpeggiator.lastVelocity
          };
        })
      };

      set({
        sequencer: nextSequencer,
        error: null
      });
    },

    applyArpeggiatorPreset: (arpeggiatorId, presetId) => {
      const sequencer = get().sequencer;
      const preset = sequencer.arpeggiatorPresets.find((entry) => entry.id === presetId);
      if (!preset) {
        return;
      }
      const settings = normalizeArpeggiatorSettings(preset.settings);
      set({
        sequencer: {
          ...sequencer,
          arpeggiators: sequencer.arpeggiators.map((arpeggiator) =>
            arpeggiator.id === arpeggiatorId
              ? {
                  ...arpeggiator,
                  ...settings,
                  presetId: preset.id
                }
              : arpeggiator
          )
        },
        error: null
      });
    },

    saveArpeggiatorPreset: (arpeggiatorId, presetName) => {
      const sequencer = get().sequencer;
      const arpeggiator = sequencer.arpeggiators.find((entry) => entry.id === arpeggiatorId);
      const name = presetName.trim();
      if (!arpeggiator || name.length === 0) {
        return;
      }
      const preset: ArpeggiatorPresetState = {
        id: crypto.randomUUID(),
        name,
        builtin: false,
        settings: normalizeArpeggiatorSettings(arpeggiator)
      };
      set({
        sequencer: {
          ...sequencer,
          arpeggiators: sequencer.arpeggiators.map((entry) =>
            entry.id === arpeggiatorId ? { ...entry, presetId: preset.id } : entry
          ),
          arpeggiatorPresets: normalizeArpeggiatorPresets([...sequencer.arpeggiatorPresets, preset])
        },
        error: null
      });
    },

    syncArpeggiatorRuntime: (updates) => {
      const sequencer = get().sequencer;
      const sequencerRuntime = get().sequencerRuntime;
      if (updates.length === 0) {
        return;
      }

      const byId = new Map(updates.map((update) => [update.arpeggiatorId, update]));
      const nextStatusById = { ...sequencerRuntime.arpeggiatorStatusById };
      for (const arpeggiator of sequencer.arpeggiators) {
        const update = byId.get(arpeggiator.id);
        if (!update) {
          continue;
        }

        const nextHeldNotes =
          update.heldNotes === undefined
            ? arpeggiator.heldNotes
            : update.heldNotes.map((value) => normalizeStepNote(value)).filter((value): value is number => value !== null);
        const nextActiveNote = update.activeNote === undefined ? arpeggiator.activeNote : normalizeStepNote(update.activeNote);
        const nextStepIndex =
          update.stepIndex === undefined ? arpeggiator.stepIndex : Math.max(0, Math.round(update.stepIndex));
        const nextLastVelocity =
          update.lastVelocity === undefined
            ? arpeggiator.lastVelocity
            : update.lastVelocity === null
              ? null
              : normalizeStepVelocity(update.lastVelocity);
        nextStatusById[arpeggiator.id] = {
          heldNotes: nextHeldNotes,
          activeNote: nextActiveNote,
          stepIndex: nextStepIndex,
          lastVelocity: nextLastVelocity
        };
      }

      set({
        sequencerRuntime: {
          ...sequencerRuntime,
          arpeggiatorStatusById: nextStatusById
        }
      });
    },

  };
}
