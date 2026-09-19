import type { SequencerRuntimeState, SequencerState, SequencerTrackPlaybackState } from "../types";

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Only runtime-owned values are overlaid; pad contents always come from authorship. */
export function playbackTrack<T extends { activePad: number; pads: Array<object> }>(
  track: T, runtime?: SequencerTrackPlaybackState
): T {
  if (!runtime || !Object.keys(runtime).some((key) => runtime[key as keyof SequencerTrackPlaybackState] !== track[key as keyof T])) return track;
  const activePad = runtime.activePad ?? track.activePad;
  const pad = track.pads[activePad] ?? track.pads[0];
  const values = pad ? Object.fromEntries(Object.entries(pad).filter(([key]) =>
    ["steps", "lengthBeats", "stepCount", "scaleRoot", "scaleType", "mode", "keypoints"].includes(key))) : {};
  return { ...track, ...runtime, ...values, activePad };
}

export function playbackValues(track: SequencerTrackPlaybackState): SequencerTrackPlaybackState {
  return {
    activePad: track.activePad, queuedPad: track.queuedPad, enabled: track.enabled,
    padLoopPosition: track.padLoopPosition, runtimePadStartSubunit: track.runtimePadStartSubunit,
    ...(track.queuedEnabled === undefined ? {} : { queuedEnabled: track.queuedEnabled })
  };
}

/**
 * Projects volatile runtime values onto persisted sequencer configuration for rendering.
 * Unchanged branches retain their references so transport ticks do not invalidate unrelated UI.
 */
export function mergedSequencerState(
  sequencerConfig: SequencerState,
  sequencerRuntime: SequencerRuntimeState
): SequencerState {
  const runtimeStepCount = Math.max(1, Math.round(sequencerRuntime.stepCount));
  const runtimePlayhead =
    ((Math.round(sequencerRuntime.playhead) % runtimeStepCount) + runtimeStepCount) % runtimeStepCount;
  const runtimeCycle = Math.max(0, Math.round(sequencerRuntime.cycle));

  let trackRuntimeChanged = false;
  const tracks = sequencerConfig.tracks.map((authored) => {
    const track = playbackTrack(authored, sequencerRuntime.trackStateById?.[authored.id]);
    if (track !== authored) trackRuntimeChanged = true;
    const runtimeRecord = sequencerRuntime.trackLocalStepById as Record<string, unknown>;
    const runtimeValue = hasOwnRecordKey(runtimeRecord, track.id)
      ? sequencerRuntime.trackLocalStepById[track.id]
      : track.runtimeLocalStep;
    const runtimeLocalStep =
      typeof runtimeValue === "number" && Number.isFinite(runtimeValue)
        ? Math.max(0, Math.round(runtimeValue))
        : null;
    if (runtimeLocalStep === track.runtimeLocalStep) {
      return track;
    }
    trackRuntimeChanged = true;
    return {
      ...track,
      runtimeLocalStep
    };
  });

  let drummerRuntimeChanged = false;
  const drummerTracks = sequencerConfig.drummerTracks.map((authored) => {
    const track = playbackTrack(authored, sequencerRuntime.drummerStateById?.[authored.id]);
    if (track !== authored) drummerRuntimeChanged = true;
    const runtimeRecord = sequencerRuntime.drummerTrackLocalStepById as Record<string, unknown>;
    const runtimeValue = hasOwnRecordKey(runtimeRecord, track.id)
      ? sequencerRuntime.drummerTrackLocalStepById[track.id]
      : track.runtimeLocalStep;
    const runtimeLocalStep =
      typeof runtimeValue === "number" && Number.isFinite(runtimeValue)
        ? Math.max(0, Math.round(runtimeValue))
        : null;
    if (runtimeLocalStep === track.runtimeLocalStep) {
      return track;
    }
    drummerRuntimeChanged = true;
    return {
      ...track,
      runtimeLocalStep
    };
  });

  let controllerRuntimeChanged = false;
  const controllerSequencers = sequencerConfig.controllerSequencers.map((authored) => {
    const controllerSequencer = playbackTrack(authored, sequencerRuntime.controllerStateById?.[authored.id]);
    if (controllerSequencer !== authored) controllerRuntimeChanged = true;
    const runtimeRecord = sequencerRuntime.controllerRuntimePadStartSubunitById as Record<string, unknown>;
    const runtimeValue = hasOwnRecordKey(runtimeRecord, controllerSequencer.id)
      ? sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id]
      : controllerSequencer.runtimePadStartSubunit;
    const runtimePadStartSubunit =
      typeof runtimeValue === "number" && Number.isFinite(runtimeValue)
        ? Math.floor(runtimeValue)
        : null;
    if (runtimePadStartSubunit === controllerSequencer.runtimePadStartSubunit) {
      return controllerSequencer;
    }
    controllerRuntimeChanged = true;
    return {
      ...controllerSequencer,
      runtimePadStartSubunit
    };
  });

  let arpeggiatorRuntimeChanged = false;
  const arpeggiators = sequencerConfig.arpeggiators.map((arpeggiator) => {
    const runtime = sequencerRuntime.arpeggiatorStatusById[arpeggiator.id];
    if (!runtime) {
      return arpeggiator;
    }
    if (
      arpeggiator.heldNotes === runtime.heldNotes &&
      arpeggiator.activeNote === runtime.activeNote &&
      arpeggiator.stepIndex === runtime.stepIndex &&
      arpeggiator.lastVelocity === runtime.lastVelocity && arpeggiator.runtimeStatus === runtime.status
    ) {
      return arpeggiator;
    }
    arpeggiatorRuntimeChanged = true;
    return {
      ...arpeggiator,
      runtimeStatus: runtime.status,
      heldNotes: runtime.heldNotes,
      activeNote: runtime.activeNote,
      stepIndex: runtime.stepIndex,
      lastVelocity: runtime.lastVelocity
    };
  });

  if (
    sequencerConfig.isPlaying === sequencerRuntime.isPlaying &&
    sequencerConfig.stepCount === runtimeStepCount &&
    sequencerConfig.playhead === runtimePlayhead &&
    sequencerConfig.cycle === runtimeCycle &&
    !trackRuntimeChanged &&
    !drummerRuntimeChanged &&
    !controllerRuntimeChanged &&
    !arpeggiatorRuntimeChanged
  ) {
    return sequencerConfig;
  }

  return {
    ...sequencerConfig,
    isPlaying: sequencerRuntime.isPlaying,
    stepCount: runtimeStepCount,
    playhead: runtimePlayhead,
    cycle: runtimeCycle,
    tracks: trackRuntimeChanged ? tracks : sequencerConfig.tracks,
    drummerTracks: drummerRuntimeChanged ? drummerTracks : sequencerConfig.drummerTracks,
    controllerSequencers: controllerRuntimeChanged
      ? controllerSequencers
      : sequencerConfig.controllerSequencers,
    arpeggiators: arpeggiatorRuntimeChanged ? arpeggiators : sequencerConfig.arpeggiators
  };
}
