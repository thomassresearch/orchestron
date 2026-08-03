import type { StoreApi } from "zustand";

import { effectRouteKey, effectRouteWouldCreateLoop } from "../lib/effectRouting";
import { insertPadLoopItem, removePadLoopItemsFromContainer } from "../lib/padLoopPattern";
import {
  STEP_CAPACITY,
  normalizeSequencerBeatRate,
  clampSequencerMeterDenominator,
  clampSequencerMeterNumerator,
  clampSequencerStepsPerBeat,
  linkedModeForScaleType,
  linkedScaleTypeForMode,
  normalizeSequencerChord,
  normalizeSequencerMode,
  normalizeSequencerScaleRoot,
  normalizeSequencerScaleType,
  resolveDiatonicSequencerChordVariant,
  transposeSequencerNoteByScaleDegree,
  transposeSequencerTonicByDiatonicStep
} from "../lib/sequencer";
import type {
  DrummerSequencerRowState,
  SequencerInstrumentBinding,
  SequencerPadState,
  SequencerTrackState
} from "../types";
import type { AppStore } from "./appStoreTypes";
import {
  DEFAULT_DRUMMER_ROW_KEYS,
  DEFAULT_DRUMMER_SEQUENCER_CELLS,
  DEFAULT_SEQUENCER_STEPS,
  alignDrummerPadRowsToTrackRows,
  buildDefaultDrummerSequencerPad,
  buildSequencerConfigSnapshot,
  clampInt,
  cloneDrummerSequencerCells,
  cloneDrummerSequencerPads,
  cloneDrummerSequencerRows,
  cloneSequencerSteps,
  createEmptyDrummerSequencerCell,
  createEmptySequencerStep,
  defaultDrummerSequencerTrack,
  defaultSequencerTrack,
  fallbackDrummerSequencerPadStateForTrack,
  fallbackSequencerPadStateForTrack,
  nextAvailableMidiChannel,
  nextAvailablePerformanceChannel,
  normalizeDrummerSequencerKey,
  normalizeDrummerSequencerStepCount,
  normalizeEffectRouteSelections,
  normalizeEffectRoutesForBindings,
  normalizeInstrumentLevel,
  normalizePadIndex,
  normalizePadLoopPatternForState,
  normalizeSequencerPadLengthBeats,
  normalizeSequencerTrackStepCount,
  normalizeStepNote,
  normalizeStepVelocity,
  parseSequencerConfigSnapshot,
  performablePatches,
  performanceDeviceCount,
  resolvedSequencerPadStepCount,
  sequencerRuntimeStateFromSequencer,
  sourceIdsFromEffectRoutes,
  transportStepCountForPerformanceTracks,
  updateDrummerTrackTimingState,
  updateSequencerTrackTimingState
} from "./appStoreModel";

type AppStoreSet = StoreApi<AppStore>["setState"];
type AppStoreGet = StoreApi<AppStore>["getState"];

export type SequencerTrackStoreActions = Pick<
  AppStore,
  | "addSequencerInstrument"
  | "removeSequencerInstrument"
  | "updateSequencerInstrumentPatch"
  | "updateSequencerInstrumentChannel"
  | "updateSequencerInstrumentLevel"
  | "updateSequencerInstrumentEffectRoute"
  | "buildSequencerConfigSnapshot"
  | "applySequencerConfigSnapshot"
  | "addSequencerTrack"
  | "removeSequencerTrack"
  | "moveSequencerTrack"
  | "setSequencerTrackEnabled"
  | "setSequencerTrackMidiChannel"
  | "setSequencerTrackSyncTarget"
  | "setSequencerTrackScale"
  | "setSequencerTrackMode"
  | "setSequencerTrackMeterNumerator"
  | "setSequencerTrackMeterDenominator"
  | "setSequencerTrackStepsPerBeat"
  | "setSequencerTrackBeatRate"
  | "setSequencerTrackStepCount"
  | "setSequencerTrackStepNote"
  | "setSequencerTrackStepChord"
  | "setSequencerTrackStepHold"
  | "setSequencerTrackStepVelocity"
  | "copySequencerTrackStepSettings"
  | "clearSequencerTrackSteps"
  | "copySequencerTrackPad"
  | "transposeSequencerTrackPadInScale"
  | "transposeSequencerTrackPadDiatonic"
  | "setSequencerTrackActivePad"
  | "setSequencerTrackQueuedPad"
  | "setSequencerTrackPadLoopEnabled"
  | "setSequencerTrackPadLoopRepeat"
  | "setSequencerTrackPadLoopPattern"
  | "addSequencerTrackPadLoopStep"
  | "removeSequencerTrackPadLoopStep"
  | "addDrummerSequencerTrack"
  | "removeDrummerSequencerTrack"
  | "setDrummerSequencerTrackEnabled"
  | "setDrummerSequencerTrackMidiChannel"
  | "setDrummerSequencerTrackMeterNumerator"
  | "setDrummerSequencerTrackMeterDenominator"
  | "setDrummerSequencerTrackStepsPerBeat"
  | "setDrummerSequencerTrackBeatRate"
  | "setDrummerSequencerTrackStepCount"
  | "addDrummerSequencerRow"
  | "removeDrummerSequencerRow"
  | "setDrummerSequencerRowKey"
  | "toggleDrummerSequencerCell"
  | "setDrummerSequencerCellVelocity"
  | "clearDrummerSequencerTrackSteps"
  | "copyDrummerSequencerPad"
  | "setDrummerSequencerTrackActivePad"
  | "setDrummerSequencerTrackQueuedPad"
  | "setDrummerSequencerTrackPadLoopEnabled"
  | "setDrummerSequencerTrackPadLoopRepeat"
  | "setDrummerSequencerTrackPadLoopPattern"
  | "addDrummerSequencerTrackPadLoopStep"
  | "removeDrummerSequencerTrackPadLoopStep"
>;

export function createSequencerTrackStoreActions(
  set: AppStoreSet,
  get: AppStoreGet,
): SequencerTrackStoreActions {
  return {
    addSequencerInstrument: () => {
      const state = get();
      const availableInstrumentPatches = performablePatches(state.patches);
      const patchId =
        availableInstrumentPatches[0]?.id ?? (state.currentPatch.is_template === true ? undefined : state.currentPatch.id);
      if (!patchId) {
        set({ error: "Save at least one instrument patch before adding it to the sequencer." });
        return;
      }
      const selectedPatch = availableInstrumentPatches.find((patch) => patch.id === patchId);

      const binding: SequencerInstrumentBinding = {
        id: crypto.randomUUID(),
        patchId,
        midiChannel: selectedPatch?.always_on === true ? 0 : nextAvailableMidiChannel(state.sequencerInstruments),
        level: 10,
        effectSourceIds: [],
        effectRoutes: []
      };

      set({
        sequencerInstruments: normalizeEffectRoutesForBindings(
          [...state.sequencerInstruments, binding],
          availableInstrumentPatches
        ),
        error: null
      });
    },

    removeSequencerInstrument: (bindingId) => {
      const state = get();
      set({
        sequencerInstruments: normalizeEffectRoutesForBindings(
          state.sequencerInstruments.filter((binding) => binding.id !== bindingId),
          performablePatches(state.patches)
        )
      });
    },

    updateSequencerInstrumentPatch: (bindingId, patchId) => {
      const state = get();
      const availablePatches = performablePatches(state.patches);
      const patch = availablePatches.find((candidate) => candidate.id === patchId);
      set({
        sequencerInstruments: normalizeEffectRoutesForBindings(
          state.sequencerInstruments.map((binding) =>
            binding.id === bindingId
              ? {
                  ...binding,
                  patchId,
                  midiChannel:
                    patch?.always_on === true
                      ? 0
                      : binding.midiChannel > 0
                        ? binding.midiChannel
                        : nextAvailableMidiChannel(state.sequencerInstruments),
                  effectSourceIds: patch?.always_on === true ? binding.effectSourceIds : [],
                  effectRoutes: patch?.always_on === true ? binding.effectRoutes : []
                }
              : binding
          ),
          availablePatches
        )
      });
    },

    updateSequencerInstrumentChannel: (bindingId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const state = get();
      const currentBinding = state.sequencerInstruments.find((binding) => binding.id === bindingId);
      const currentPatch = state.patches.find((patch) => patch.id === currentBinding?.patchId);
      if (currentPatch?.always_on === true) {
        return;
      }

      const duplicate = state.sequencerInstruments.some(
        (binding) => binding.id !== bindingId && binding.midiChannel > 0 && clampInt(binding.midiChannel, 1, 16) === normalizedChannel
      );
      if (duplicate) {
        set({ error: `MIDI channel ${normalizedChannel} is already assigned.` });
        return;
      }

      set({
        sequencerInstruments: state.sequencerInstruments.map((binding) =>
          binding.id === bindingId ? { ...binding, midiChannel: normalizedChannel } : binding
        ),
        error: null
      });
    },

    updateSequencerInstrumentLevel: (bindingId, level) => {
      const normalizedLevel = normalizeInstrumentLevel(level);
      const state = get();
      set({
        sequencerInstruments: state.sequencerInstruments.map((binding) =>
          binding.id === bindingId ? { ...binding, level: normalizedLevel } : binding
        ),
        error: null
      });
    },

    updateSequencerInstrumentEffectRoute: (bindingId, sourceBindingId, channel, enabled) => {
      const state = get();
      const availablePatches = performablePatches(state.patches);
      const normalizedChannel = channel.trim();
      if (!normalizedChannel) {
        return;
      }
      set({
        sequencerInstruments: normalizeEffectRoutesForBindings(
          state.sequencerInstruments.map((binding) => {
            if (binding.id !== bindingId) {
              return binding;
            }
            const routes = normalizeEffectRouteSelections(binding.effectRoutes);
            const routeKeyValue = effectRouteKey(sourceBindingId, normalizedChannel);
            if (enabled) {
              if (!routes.some((route) => effectRouteKey(route.sourceId, route.channel) === routeKeyValue)) {
                if (effectRouteWouldCreateLoop(state.sequencerInstruments, bindingId, sourceBindingId)) {
                  return binding;
                }
                routes.push({ sourceId: sourceBindingId, channel: normalizedChannel });
              }
            } else {
              const index = routes.findIndex((route) => effectRouteKey(route.sourceId, route.channel) === routeKeyValue);
              if (index >= 0) {
                routes.splice(index, 1);
              }
            }
            return {
              ...binding,
              effectRoutes: routes,
              effectSourceIds: sourceIdsFromEffectRoutes(routes)
            };
          }),
          availablePatches
        ),
        error: null
      });
    },

    buildSequencerConfigSnapshot: () => {
      const state = get();
      return buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
    },

    applySequencerConfigSnapshot: (snapshot) => {
      try {
        const state = get();
        const availableInstrumentPatches = performablePatches(state.patches);
        const fallbackPatchId =
          availableInstrumentPatches[0]?.id ?? (state.currentPatch.is_template === true ? null : state.currentPatch.id ?? null);
        const parsed = parseSequencerConfigSnapshot(snapshot, availableInstrumentPatches, fallbackPatchId);

        set({
          sequencer: parsed.sequencer,
          sequencerRuntime: sequencerRuntimeStateFromSequencer(parsed.sequencer),
          sequencerInstruments: parsed.instruments,
          error: null
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to load sequencer config"
        });
      }
    },

    addSequencerTrack: () => {
      const sequencer = get().sequencer;
      if (sequencer.tracks.length >= 8) {
        set({ error: "A maximum of 8 sequencers is supported." });
        return;
      }

      const nextIndex = sequencer.tracks.length + 1;
      const track = defaultSequencerTrack(nextIndex, nextAvailablePerformanceChannel(sequencer));
      track.id = crypto.randomUUID();
      track.name = `Melodic Sequencer ${nextIndex}`;
      const nextTracks = [...sequencer.tracks, track];

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        },
        error: null
      });
    },

    removeSequencerTrack: (trackId) => {
      const sequencer = get().sequencer;
      if (!sequencer.tracks.some((track) => track.id === trackId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      const nextTracks = sequencer.tracks
        .filter((track) => track.id !== trackId)
        .map((track) =>
          track.syncToTrackId === trackId
            ? {
                ...track,
                syncToTrackId: null
              }
            : track
        );

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        },
        error: null
      });
    },

    moveSequencerTrack: (sourceTrackId, targetTrackId, position = "before") => {
      const sequencer = get().sequencer;
      const sourceIndex = sequencer.tracks.findIndex((track) => track.id === sourceTrackId);
      const targetIndex = sequencer.tracks.findIndex((track) => track.id === targetTrackId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return;
      }

      const sourceTrack = sequencer.tracks[sourceIndex];
      const remainingTracks = sequencer.tracks.filter((track) => track.id !== sourceTrackId);
      const targetIndexInRemaining = remainingTracks.findIndex((track) => track.id === targetTrackId);
      if (targetIndexInRemaining < 0) {
        return;
      }
      const insertionIndex = position === "after" ? targetIndexInRemaining + 1 : targetIndexInRemaining;
      const nextTracks = [...remainingTracks];
      nextTracks.splice(insertionIndex, 0, sourceTrack);

      set({
        sequencer: {
          ...sequencer,
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackEnabled: (trackId, enabled, queueOnCycle) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const shouldQueue = queueOnCycle ?? isPlaying;
      const nextTracks = sequencer.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        if (shouldQueue && isPlaying) {
          if (track.enabled === enabled) {
            return { ...track, queuedEnabled: null };
          }
          return {
            ...track,
            queuedEnabled: enabled
          };
        }
        return {
          ...track,
          enabled,
          queuedEnabled: null
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackMidiChannel: (trackId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId ? { ...track, midiChannel: normalizedChannel } : track
          )
        }
      });
    },

    setSequencerTrackSyncTarget: (trackId, syncToTrackId) => {
      const sequencer = get().sequencer;
      const normalizedSyncTarget =
        typeof syncToTrackId === "string" && syncToTrackId.trim().length > 0 ? syncToTrackId : null;
      const trackIds = new Set(sequencer.tracks.map((track) => track.id));
      if (!trackIds.has(trackId)) {
        return;
      }
      const resolvedSyncTarget =
        normalizedSyncTarget !== null && normalizedSyncTarget !== trackId && trackIds.has(normalizedSyncTarget)
          ? normalizedSyncTarget
          : null;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  syncToTrackId: resolvedSyncTarget
                }
              : track
          )
        }
      });
    },

    setSequencerTrackScale: (trackId, scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      const nextMode = linkedModeForScaleType(normalizedType);

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  ...((): Pick<SequencerTrackState, "scaleRoot" | "scaleType" | "mode" | "pads"> => {
                    const activePad = normalizePadIndex(track.activePad);
                    const pads = track.pads.map((pad, index) =>
                      index === activePad
                        ? {
                            ...pad,
                            scaleRoot: normalizedRoot,
                            scaleType: normalizedType,
                            mode: nextMode ?? pad.mode
                          }
                        : pad
                    );
                    const selectedPad =
                      pads[activePad] ?? {
                        stepCount: normalizeSequencerTrackStepCount(track.stepCount),
                        steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
                        scaleRoot: normalizedRoot,
                        scaleType: normalizedType,
                        mode: nextMode ?? track.mode
                      };
                    return {
                      scaleRoot: selectedPad.scaleRoot,
                      scaleType: selectedPad.scaleType,
                      mode: selectedPad.mode,
                      pads
                    };
                  })()
                }
              : track
          )
        }
      });
    },

    setSequencerTrackMode: (trackId, mode) => {
      const normalizedMode = normalizeSequencerMode(mode);
      const normalizedScaleType = linkedScaleTypeForMode(normalizedMode);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  ...((): Pick<SequencerTrackState, "scaleType" | "mode" | "pads"> => {
                    const activePad = normalizePadIndex(track.activePad);
                    const pads = track.pads.map((pad, index) =>
                      index === activePad
                        ? {
                            ...pad,
                            mode: normalizedMode,
                            scaleType: normalizedScaleType
                          }
                        : pad
                    );
                    const selectedPad =
                      pads[activePad] ?? {
                        stepCount: normalizeSequencerTrackStepCount(track.stepCount),
                        steps: cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS),
                        scaleRoot: track.scaleRoot,
                        scaleType: normalizedScaleType,
                        mode: normalizedMode
                      };
                    return {
                      scaleType: selectedPad.scaleType,
                      mode: selectedPad.mode,
                      pads
                    };
                  })()
                }
              : track
          )
        }
      });
    },

    setSequencerTrackMeterNumerator: (trackId, numerator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  meterNumerator: clampSequencerMeterNumerator(numerator)
                })
              : track
          )
        }
      });
    },

    setSequencerTrackMeterDenominator: (trackId, denominator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  meterDenominator: clampSequencerMeterDenominator(denominator)
                })
              : track
          )
        }
      });
    },

    setSequencerTrackStepsPerBeat: (trackId, stepsPerBeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
                })
              : track
          )
        }
      });
    },

    setSequencerTrackBeatRate: (trackId, numerator, denominator) => {
      const sequencer = get().sequencer;
      const beatRate = normalizeSequencerBeatRate(numerator, denominator);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? updateSequencerTrackTimingState(track, {
                  beatRateNumerator: beatRate.numerator,
                  beatRateDenominator: beatRate.denominator
                })
              : track
          )
        }
      });
    },

    setSequencerTrackStepCount: (trackId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedLengthBeats = normalizeSequencerPadLengthBeats(stepCount);
      const nextTracks = sequencer.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        const normalizedStepCount = resolvedSequencerPadStepCount(normalizedLengthBeats, track.timing);
        const activePad = normalizePadIndex(track.activePad);
        const pads = track.pads.map((pad, index) =>
          index === activePad
            ? { ...pad, lengthBeats: normalizedLengthBeats, stepCount: normalizedStepCount }
            : pad
        );
        return {
          ...track,
          lengthBeats: normalizedLengthBeats,
          stepCount: normalizedStepCount,
          pads
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(nextTracks, sequencer.drummerTracks, sequencer.timing),
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackStepNote: (trackId, index, note) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              note: normalizeStepNote(note)
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    setSequencerTrackStepChord: (trackId, index, chord) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      const normalizedChord = normalizeSequencerChord(chord);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              chord: normalizedChord
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    setSequencerTrackStepHold: (trackId, index, hold) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              hold: hold === true
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    setSequencerTrackStepVelocity: (trackId, index, velocity) => {
      if (index < 0 || index >= STEP_CAPACITY) {
        return;
      }

      const sequencer = get().sequencer;
      const normalizedVelocity = normalizeStepVelocity(velocity);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const stepState = steps[index] ?? createEmptySequencerStep();
            steps[index] = {
              ...stepState,
              velocity: normalizedVelocity
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    copySequencerTrackStepSettings: (sourceTrackId, sourceIndex, targetTrackId, targetIndex) => {
      if (
        !Number.isFinite(sourceIndex) ||
        !Number.isFinite(targetIndex) ||
        sourceIndex < 0 ||
        sourceIndex >= STEP_CAPACITY ||
        targetIndex < 0 ||
        targetIndex >= STEP_CAPACITY
      ) {
        return;
      }

      const sequencer = get().sequencer;
      const sourceTrack = sequencer.tracks.find((track) => track.id === sourceTrackId);
      if (!sourceTrack) {
        return;
      }
      const sourcePadIndex = normalizePadIndex(sourceTrack.activePad);
      const sourcePad =
        sourceTrack.pads[sourcePadIndex] ??
        sourceTrack.pads[0] ??
        fallbackSequencerPadStateForTrack(sourceTrack);
      const sourceStep = sourcePad.steps[sourceIndex] ?? createEmptySequencerStep();

      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== targetTrackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(activePadState.steps);
            const targetStep = steps[targetIndex] ?? createEmptySequencerStep();
            steps[targetIndex] = {
              ...targetStep,
              note: normalizeStepNote(sourceStep.note),
              chord: normalizeSequencerChord(sourceStep.chord),
              velocity: normalizeStepVelocity(sourceStep.velocity)
            };
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    clearSequencerTrackSteps: (trackId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const activePad = normalizePadIndex(track.activePad);
            const activePadState = pads[activePad] ?? fallbackSequencerPadStateForTrack(track);
            const steps = cloneSequencerSteps(DEFAULT_SEQUENCER_STEPS);
            pads[activePad] = {
              ...activePadState,
              steps
            };

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    copySequencerTrackPad: (trackId, sourcePadIndex, targetPadIndex) => {
      const normalizedSourcePad = normalizePadIndex(sourcePadIndex);
      const normalizedTargetPad = normalizePadIndex(targetPadIndex);
      if (normalizedSourcePad === normalizedTargetPad) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const fallbackPad: SequencerPadState = fallbackSequencerPadStateForTrack(track);
            const sourcePad = pads[normalizedSourcePad] ?? fallbackPad;
            const copiedPad: SequencerPadState = {
              lengthBeats: normalizeSequencerPadLengthBeats(sourcePad.lengthBeats),
              stepCount: normalizeSequencerTrackStepCount(sourcePad.stepCount),
              steps: cloneSequencerSteps(sourcePad.steps),
              scaleRoot: sourcePad.scaleRoot,
              scaleType: sourcePad.scaleType,
              mode: sourcePad.mode
            };
            pads[normalizedTargetPad] = copiedPad;

            const activePad = normalizePadIndex(track.activePad);
            if (activePad !== normalizedTargetPad) {
              return {
                ...track,
                pads
              };
            }

            return {
              ...track,
              pads,
              lengthBeats: copiedPad.lengthBeats,
              stepCount: copiedPad.stepCount,
              scaleRoot: copiedPad.scaleRoot,
              scaleType: copiedPad.scaleType,
              mode: copiedPad.mode,
              steps: cloneSequencerSteps(copiedPad.steps)
            };
          })
        }
      });
    },

    transposeSequencerTrackPadInScale: (trackId, padIndex, direction) => {
      if (direction !== -1 && direction !== 1) {
        return;
      }

      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const fallbackPad: SequencerPadState = fallbackSequencerPadStateForTrack(track);
            const sourcePad = pads[normalizedPad] ?? fallbackPad;
            const nextSteps = cloneSequencerSteps(sourcePad.steps).map((step) => {
              if (step.note === null) {
                return { ...step };
              }

              const nextNote = transposeSequencerNoteByScaleDegree(
                step.note,
                sourcePad.scaleRoot,
                sourcePad.mode,
                direction
              );

              return {
                ...step,
                note: nextNote,
                chord: resolveDiatonicSequencerChordVariant(step.chord, nextNote, sourcePad.scaleRoot, sourcePad.mode)
              };
            });
            const nextPad: SequencerPadState = {
              ...sourcePad,
              steps: nextSteps
            };
            pads[normalizedPad] = nextPad;

            const activePad = normalizePadIndex(track.activePad);
            if (activePad !== normalizedPad) {
              return {
                ...track,
                pads
              };
            }

            return {
              ...track,
              pads,
              steps: cloneSequencerSteps(nextPad.steps),
              scaleRoot: nextPad.scaleRoot,
              scaleType: nextPad.scaleType,
              mode: nextPad.mode
            };
          })
        }
      });
    },

    transposeSequencerTrackPadDiatonic: (trackId, padIndex, direction) => {
      if (direction !== -1 && direction !== 1) {
        return;
      }

      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => ({
              ...pad,
              steps: cloneSequencerSteps(pad.steps)
            }));
            const fallbackPad: SequencerPadState = fallbackSequencerPadStateForTrack(track);
            const sourcePad = pads[normalizedPad] ?? fallbackPad;
            const { scaleRoot: nextScaleRoot, semitoneOffset } = transposeSequencerTonicByDiatonicStep(
              sourcePad.scaleRoot,
              sourcePad.mode,
              direction
            );
            const nextSteps = cloneSequencerSteps(sourcePad.steps).map((step) => ({
              ...step,
              note: step.note === null ? null : normalizeStepNote(step.note + semitoneOffset)
            }));
            const nextPad: SequencerPadState = {
              ...sourcePad,
              steps: nextSteps,
              scaleRoot: nextScaleRoot
            };
            pads[normalizedPad] = nextPad;

            const activePad = normalizePadIndex(track.activePad);
            if (activePad !== normalizedPad) {
              return {
                ...track,
                pads
              };
            }

            return {
              ...track,
              pads,
              steps: cloneSequencerSteps(nextPad.steps),
              scaleRoot: nextPad.scaleRoot,
              scaleType: nextPad.scaleType,
              mode: nextPad.mode
            };
          })
        }
      });
    },

    setSequencerTrackActivePad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const normalizedPad = normalizePadIndex(padIndex);

      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? (() => {
                  const selectedPad =
                    track.pads[normalizedPad] ??
                    track.pads[0] ??
                    fallbackSequencerPadStateForTrack(track);
                  return {
                    ...track,
                    lengthBeats: normalizeSequencerPadLengthBeats(selectedPad.lengthBeats),
                    stepCount: normalizeSequencerTrackStepCount(selectedPad.stepCount),
                    activePad: normalizedPad,
                    queuedPad: isPlaying && track.enabled ? track.queuedPad : null,
                    scaleRoot: selectedPad.scaleRoot,
                    scaleType: selectedPad.scaleType,
                    mode: selectedPad.mode,
                    steps: cloneSequencerSteps(selectedPad.steps)
                  };
                })()
              : track
          )
        }
      });
    },

    setSequencerTrackQueuedPad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
                }
              : track
          )
        }
      });
    },

    setSequencerTrackPadLoopEnabled: (trackId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopEnabled: enabled === true
                }
              : track
          )
        }
      });
    },

    setSequencerTrackPadLoopRepeat: (trackId, repeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopRepeat: repeat !== false
                }
              : track
          )
        }
      });
    },

    setSequencerTrackPadLoopPattern: (trackId, pattern) => {
      const sequencer = get().sequencer;
      const normalizedPattern = normalizePadLoopPatternForState(pattern);
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopPattern: normalizedPattern.padLoopPattern,
                  padLoopSequence: normalizedPattern.padLoopSequence
                }
              : track
          )
        }
      });
    },

    addSequencerTrackPadLoopStep: (trackId, padIndex) => {
      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (track.padLoopSequence.length >= 256) {
              return track;
            }
            const nextPattern = insertPadLoopItem(
              track.padLoopPattern,
              { kind: "root" },
              track.padLoopPattern.rootSequence.length,
              { type: "pad", padIndex: normalizedPad }
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    removeSequencerTrackPadLoopStep: (trackId, sequenceIndex) => {
      if (!Number.isFinite(sequenceIndex)) {
        return;
      }
      const normalizedSequenceIndex = Math.max(0, Math.round(sequenceIndex));
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (
              normalizedSequenceIndex < 0 ||
              normalizedSequenceIndex >= track.padLoopPattern.rootSequence.length
            ) {
              return track;
            }
            const nextPattern = removePadLoopItemsFromContainer(track.padLoopPattern, { kind: "root" }, [
              normalizedSequenceIndex
            ]);
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    addDrummerSequencerTrack: () => {
      const sequencer = get().sequencer;
      if (sequencer.drummerTracks.length >= 8) {
        set({ error: "A maximum of 8 drummer sequencers is supported." });
        return;
      }

      const nextIndex = sequencer.drummerTracks.length + 1;
      const track = defaultDrummerSequencerTrack(nextIndex, nextAvailablePerformanceChannel(sequencer));
      track.id = crypto.randomUUID();
      track.name = `Drummer Sequencer ${nextIndex}`;

      const nextDrummerTracks = [...sequencer.drummerTracks, track];
      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        },
        error: null
      });
    },

    removeDrummerSequencerTrack: (trackId) => {
      const sequencer = get().sequencer;
      if (!sequencer.drummerTracks.some((track) => track.id === trackId)) {
        return;
      }
      if (performanceDeviceCount(sequencer) <= 1) {
        set({ error: "At least one performance device is required." });
        return;
      }
      const nextDrummerTracks = sequencer.drummerTracks.filter((track) => track.id !== trackId);
      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        },
        error: null
      });
    },

    setDrummerSequencerTrackEnabled: (trackId, enabled, queueOnCycle) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const shouldQueue = queueOnCycle ?? isPlaying;
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        if (shouldQueue && isPlaying) {
          if (track.enabled === enabled) {
            return { ...track, queuedEnabled: null };
          }
          return {
            ...track,
            queuedEnabled: enabled
          };
        }
        return {
          ...track,
          enabled,
          queuedEnabled: null
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        }
      });
    },

    setDrummerSequencerTrackMidiChannel: (trackId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId ? { ...track, midiChannel: normalizedChannel } : track
          )
        }
      });
    },

    setDrummerSequencerTrackMeterNumerator: (trackId, numerator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  meterNumerator: clampSequencerMeterNumerator(numerator)
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackMeterDenominator: (trackId, denominator) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  meterDenominator: clampSequencerMeterDenominator(denominator)
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackStepsPerBeat: (trackId, stepsPerBeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  stepsPerBeat: clampSequencerStepsPerBeat(stepsPerBeat)
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackBeatRate: (trackId, numerator, denominator) => {
      const sequencer = get().sequencer;
      const beatRate = normalizeSequencerBeatRate(numerator, denominator);
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? updateDrummerTrackTimingState(track, {
                  beatRateNumerator: beatRate.numerator,
                  beatRateDenominator: beatRate.denominator
                })
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackStepCount: (trackId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedLengthBeats = normalizeSequencerPadLengthBeats(stepCount);
      const nextDrummerTracks = sequencer.drummerTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        const normalizedStepCount = resolvedSequencerPadStepCount(normalizedLengthBeats, track.timing);
        const activePad = normalizePadIndex(track.activePad);
        const nextPads = cloneDrummerSequencerPads(track.pads).map((pad, index) =>
          index === activePad
            ? { ...pad, lengthBeats: normalizedLengthBeats, stepCount: normalizedStepCount }
            : pad
        );
        return {
          ...track,
          lengthBeats: normalizedLengthBeats,
          stepCount: normalizedStepCount,
          pads: nextPads
        };
      });
      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForPerformanceTracks(sequencer.tracks, nextDrummerTracks, sequencer.timing),
          drummerTracks: nextDrummerTracks
        }
      });
    },

    addDrummerSequencerRow: (trackId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (track.rows.length >= 64) {
              return track;
            }
            const nextKeySeed =
              track.rows.length < DEFAULT_DRUMMER_ROW_KEYS.length
                ? DEFAULT_DRUMMER_ROW_KEYS[track.rows.length]
                : (track.rows[track.rows.length - 1]?.key ?? 35) + 1;
            const newRow: DrummerSequencerRowState = {
              id: crypto.randomUUID(),
              key: normalizeDrummerSequencerKey(nextKeySeed)
            };
            const nextRows = [...cloneDrummerSequencerRows(track.rows), newRow];
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => ({
              lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
              stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
              rows: [
                ...alignDrummerPadRowsToTrackRows(pad, track.rows).rows,
                { rowId: newRow.id, steps: cloneDrummerSequencerCells(DEFAULT_DRUMMER_SEQUENCER_CELLS) }
              ]
            }));
            return {
              ...track,
              rows: nextRows,
              pads: nextPads
            };
          })
        }
      });
    },

    removeDrummerSequencerRow: (trackId, rowId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (!track.rows.some((row) => row.id === rowId) || track.rows.length <= 1) {
              return track;
            }
            const nextRows = track.rows.filter((row) => row.id !== rowId);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => ({
              lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
              stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
              rows: alignDrummerPadRowsToTrackRows(
                {
                  lengthBeats: normalizeSequencerPadLengthBeats(pad.lengthBeats),
                  stepCount: normalizeDrummerSequencerStepCount(pad.stepCount),
                  rows: pad.rows.filter((row) => row.rowId !== rowId)
                },
                nextRows
              ).rows
            }));
            return {
              ...track,
              rows: cloneDrummerSequencerRows(nextRows),
              pads: nextPads
            };
          })
        }
      });
    },

    setDrummerSequencerRowKey: (trackId, rowId, key) => {
      const normalizedKey = normalizeDrummerSequencerKey(key);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  rows: track.rows.map((row) => (row.id === rowId ? { ...row, key: normalizedKey } : row))
                }
              : track
          )
        }
      });
    },

    toggleDrummerSequencerCell: (trackId, rowId, stepIndex, active) => {
      if (stepIndex < 0 || stepIndex >= STEP_CAPACITY) {
        return;
      }
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const activePad = normalizePadIndex(track.activePad);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            const pad = nextPads[activePad] ?? fallbackDrummerSequencerPadStateForTrack(track);
            const nextRows = pad.rows.map((row) => {
              if (row.rowId !== rowId) {
                return row;
              }
              const nextSteps = cloneDrummerSequencerCells(row.steps);
              const current = nextSteps[stepIndex] ?? createEmptyDrummerSequencerCell();
              nextSteps[stepIndex] = {
                ...current,
                active: active === undefined ? current.active !== true : active === true
              };
              return { ...row, steps: nextSteps };
            });
            nextPads[activePad] = { ...pad, rows: nextRows };
            return {
              ...track,
              pads: nextPads
            };
          })
        }
      });
    },

    setDrummerSequencerCellVelocity: (trackId, rowId, stepIndex, velocity) => {
      if (stepIndex < 0 || stepIndex >= STEP_CAPACITY) {
        return;
      }
      const normalizedVelocity = normalizeStepVelocity(velocity);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const activePad = normalizePadIndex(track.activePad);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            const pad = nextPads[activePad] ?? fallbackDrummerSequencerPadStateForTrack(track);
            const nextRows = pad.rows.map((row) => {
              if (row.rowId !== rowId) {
                return row;
              }
              const nextSteps = cloneDrummerSequencerCells(row.steps);
              const current = nextSteps[stepIndex] ?? createEmptyDrummerSequencerCell();
              nextSteps[stepIndex] = {
                ...current,
                velocity: normalizedVelocity
              };
              return { ...row, steps: nextSteps };
            });
            nextPads[activePad] = { ...pad, rows: nextRows };
            return {
              ...track,
              pads: nextPads
            };
          })
        }
      });
    },

    clearDrummerSequencerTrackSteps: (trackId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const activePad = normalizePadIndex(track.activePad);
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            nextPads[activePad] = buildDefaultDrummerSequencerPad(track.rows, track.stepCount);
            return {
              ...track,
              pads: nextPads
            };
          })
        }
      });
    },

    copyDrummerSequencerPad: (trackId, sourcePadIndex, targetPadIndex) => {
      const normalizedSourcePad = normalizePadIndex(sourcePadIndex);
      const normalizedTargetPad = normalizePadIndex(targetPadIndex);
      if (normalizedSourcePad === normalizedTargetPad) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            const nextPads = cloneDrummerSequencerPads(track.pads).map((pad) => alignDrummerPadRowsToTrackRows(pad, track.rows));
            const sourcePad = nextPads[normalizedSourcePad] ?? fallbackDrummerSequencerPadStateForTrack(track);
            nextPads[normalizedTargetPad] = alignDrummerPadRowsToTrackRows(
              {
                lengthBeats: normalizeSequencerPadLengthBeats(sourcePad.lengthBeats),
                stepCount: normalizeDrummerSequencerStepCount(sourcePad.stepCount),
                rows: sourcePad.rows.map((row) => ({
                  rowId: row.rowId,
                  steps: cloneDrummerSequencerCells(row.steps)
                }))
              },
              track.rows
            );
            if (normalizePadIndex(track.activePad) !== normalizedTargetPad) {
              return {
                ...track,
                pads: nextPads
              };
            }
            return {
              ...track,
              lengthBeats: normalizeSequencerPadLengthBeats(nextPads[normalizedTargetPad]?.lengthBeats ?? track.lengthBeats),
              stepCount: normalizeDrummerSequencerStepCount(nextPads[normalizedTargetPad]?.stepCount ?? track.stepCount),
              pads: nextPads
            };
          })
        }
      });
    },

    setDrummerSequencerTrackActivePad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      const isPlaying = get().sequencerRuntime.isPlaying;
      const normalizedPad = normalizePadIndex(padIndex);
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? (() => {
                  const selectedPad =
                    track.pads[normalizedPad] ??
                    track.pads[0] ??
                    fallbackDrummerSequencerPadStateForTrack(track);
                  return {
                    ...track,
                    lengthBeats: normalizeSequencerPadLengthBeats(selectedPad.lengthBeats),
                    stepCount: normalizeDrummerSequencerStepCount(selectedPad.stepCount),
                    activePad: normalizedPad,
                    queuedPad: isPlaying && track.enabled ? track.queuedPad : null
                  };
                })()
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackQueuedPad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
                }
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackPadLoopEnabled: (trackId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopEnabled: enabled === true
                }
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackPadLoopRepeat: (trackId, repeat) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopRepeat: repeat !== false
                }
              : track
          )
        }
      });
    },

    setDrummerSequencerTrackPadLoopPattern: (trackId, pattern) => {
      const sequencer = get().sequencer;
      const normalizedPattern = normalizePadLoopPatternForState(pattern);
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  padLoopPattern: normalizedPattern.padLoopPattern,
                  padLoopSequence: normalizedPattern.padLoopSequence
                }
              : track
          )
        }
      });
    },

    addDrummerSequencerTrackPadLoopStep: (trackId, padIndex) => {
      const normalizedPad = normalizePadIndex(padIndex);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (track.padLoopSequence.length >= 256) {
              return track;
            }
            const nextPattern = insertPadLoopItem(
              track.padLoopPattern,
              { kind: "root" },
              track.padLoopPattern.rootSequence.length,
              { type: "pad", padIndex: normalizedPad }
            );
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

    removeDrummerSequencerTrackPadLoopStep: (trackId, sequenceIndex) => {
      if (!Number.isFinite(sequenceIndex)) {
        return;
      }
      const normalizedSequenceIndex = Math.max(0, Math.round(sequenceIndex));
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          drummerTracks: sequencer.drummerTracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }
            if (
              normalizedSequenceIndex < 0 ||
              normalizedSequenceIndex >= track.padLoopPattern.rootSequence.length
            ) {
              return track;
            }
            const nextPattern = removePadLoopItemsFromContainer(track.padLoopPattern, { kind: "root" }, [
              normalizedSequenceIndex
            ]);
            const normalizedPattern = normalizePadLoopPatternForState(nextPattern);
            return {
              ...track,
              padLoopPattern: normalizedPattern.padLoopPattern,
              padLoopSequence: normalizedPattern.padLoopSequence
            };
          })
        }
      });
    },

  };
}
