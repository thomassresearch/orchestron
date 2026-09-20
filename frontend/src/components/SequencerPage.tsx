import { transportStartButtonClass, transportStopButtonClass } from "./sequencer/transportButtonStyles";
import { PatternWorkspace } from "./sequencer/PatternWorkspace";
import { ArrangerSpeaker } from "./sequencer/ArrangerSpeaker";
import { melodicPadHasSound, drummerPadHasSound, controllerPadHasContent } from "../lib/patternWorkspace";
import { PATTERN_ITEM_COLORS, patternPadClass } from "../lib/patternItemPresentation";
import { PerformanceAuditionControls } from "./sequencer/PerformanceAudition";
import { sequencerEditingView } from "../store/sequencerEdits";
import { NoteTimingControl, noteTimingCopy, timingDescription } from "./sequencer/NoteTimingControl";
import { normalizeTimingOffset } from "../lib/sequencer";
import { ArpeggiatorEditor } from "./sequencer/ArpeggiatorEditor";
import { MidiChannelSelector } from "./sequencer/MidiChannelSelector";
import { useAppStore } from "../store/useAppStore";
import { OpenArrangerContext, PerformanceEditorProvider, usePerformanceEditorState, RetainedScroll, type EditorOwner } from "./sequencer/PerformanceEditorState";
import { PerformanceDeviceName } from "./sequencer/PerformanceDeviceName";
import { performanceDeviceDisplayName, type PerformanceDeviceKind } from "../lib/performanceDeviceNames";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { PatchPicker } from "./PatchPicker";
import { PerformanceControllerRack, PerformanceControllerSyncStatus } from "./sequencer/PerformanceControllerRack";
import { PerformMixer } from "./PerformMixer";
import { audioCopy } from "../lib/audioCopy";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import {
  buildSequencerChordOptions,
  buildSequencerNoteOptions,
  controllerSequencerPadLengthBeatOptions,
  parseSequencerScaleValue,
  SEQUENCER_BEAT_RATE_OPTIONS,
  SEQUENCER_MODE_OPTIONS,
  SEQUENCER_SCALE_OPTIONS,
  sequencerPadLengthBeatOptions,
  sequencerTransportSubunitCount,
  sequencerTransportSubunitDurationSeconds,
  sequencerTransportSubunitsPerLocalStep,
  sequencerTransportSubunitsPerStep,
  sequencerTransportStepsPerBeat,
} from "../lib/sequencer";
import { HelpIconButton } from "./HelpIconButton";
import { MultitrackArranger } from "./MultitrackArranger";
import {
  MODE_LABELS,
  SCALE_TYPE_LABELS,
  SEQUENCER_UI_COPY,
  type SequencerUiCopy
} from "./sequencer/sequencerUiCopy";
import { MidiControllerKnob } from "./sequencer/MidiControllerKnob";
import { ControllerSequencerCurveEditor } from "./sequencer/ControllerSequencerCurveEditor";
import type { SequencerPageProps } from "./sequencer/sequencerPageContracts";
import {
  PianoRollKeyboard,
  buildSequencerPitchClassOptions,
  chordColorBorderClass,
  chordColorTextClass,
  chordOptionInlineStyle,
  midiNoteOctave,
  midiNotePitchClass,
  pianoKeyNoteName,
  sequencerMidiNoteFromPitchClassOctave,
  type PianoRollHighlightTheory
} from "./sequencer/PianoRollKeyboard";
import type {
  DrummerSequencerTrackState,
  SequencerInstrumentBinding,
  SequencerChord,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SequencerStepState,
  SequencerTrackState
} from "../types";

const MIXED_SELECT_VALUE = "__mixed__";
const SEQUENCER_PAD_DRAG_MIME = "application/x-visualcsound-sequencer-pad";
const SEQUENCER_TRACK_DRAG_MIME = "application/x-visualcsound-sequencer-track";
const SEQUENCER_STEP_DRAG_MIME = "application/x-visualcsound-sequencer-step";
const PAD_TRANSPOSE_LONG_PRESS_MS = 350;


type SequencerPadDragPayload = {
  trackId: string;
  padIndex: number;
};

type SequencerTrackDragPayload = {
  trackId: string;
};

type SequencerStepDragPayload = {
  trackId: string;
  stepIndex: number;
};

type DrummerVelocityDragState = {
  trackId: string;
  rowId: string;
  stepIndex: number;
  velocity: number;
};

type RackInstrumentBindingRow = {
  binding: SequencerInstrumentBinding;
  index: number;
};


function trackStateLabel(
  track: Pick<SequencerTrackState, "enabled" | "queuedEnabled">,
  isPlaying: boolean,
  ui: Pick<SequencerUiCopy, "trackQueuedStart" | "trackQueuedStop" | "running" | "stopped">
): string {
  if (isPlaying && track.queuedEnabled === true) {
    return ui.trackQueuedStart;
  }
  if (isPlaying && track.queuedEnabled === false) {
    return ui.trackQueuedStop;
  }
  return isPlaying && track.enabled ? ui.running : ui.stopped;
}

function previousNonRestNote(steps: SequencerStepState[], fromIndex: number): number | null {
  for (let index = fromIndex - 1;index >= 0;index -= 1) {
    const note = steps[index]?.note;
    if (typeof note === "number") {
      return note;
    }
  }
  return null;
}

function parseSequencerPadDragPayload(event: ReactDragEvent): SequencerPadDragPayload | null {
  const raw =
    event.dataTransfer.getData(SEQUENCER_PAD_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SequencerPadDragPayload>;
    if (typeof parsed.trackId !== "string" || typeof parsed.padIndex !== "number" || !Number.isFinite(parsed.padIndex)) {
      return null;
    }
    return {
      trackId: parsed.trackId,
      padIndex: Math.round(parsed.padIndex)
    };
  } catch {
    return null;
  }
}

function dragEventHasMimeType(event: ReactDragEvent, mimeType: string): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes(mimeType);
}

function parseSequencerTrackDragPayload(event: ReactDragEvent): SequencerTrackDragPayload | null {
  const raw =
    event.dataTransfer.getData(SEQUENCER_TRACK_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<
      SequencerTrackDragPayload & { padIndex?: unknown; stepIndex?: unknown }
    >;
    if (
      typeof parsed.trackId !== "string" ||
      parsed.trackId.trim().length === 0 ||
      parsed.padIndex !== undefined ||
      parsed.stepIndex !== undefined
    ) {
      return null;
    }
    return { trackId: parsed.trackId };
  } catch {
    return null;
  }
}

function parseSequencerStepDragPayload(event: ReactDragEvent): SequencerStepDragPayload | null {
  const raw =
    event.dataTransfer.getData(SEQUENCER_STEP_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SequencerStepDragPayload>;
    if (
      typeof parsed.trackId !== "string" ||
      typeof parsed.stepIndex !== "number" ||
      !Number.isFinite(parsed.stepIndex)
    ) {
      return null;
    }
    return {
      trackId: parsed.trackId,
      stepIndex: Math.round(parsed.stepIndex)
    };
  } catch {
    return null;
  }
}

function sequencerAbsoluteTransportStepValue(sequencer: Pick<SequencerState, "playhead" | "cycle" | "stepCount">): number {
  return Math.max(0, Math.floor(sequencer.cycle) * Math.max(1, Math.floor(sequencer.stepCount)) + Math.floor(sequencer.playhead));
}

function localStepFromTransportPosition(
  track:
    | Pick<SequencerTrackState, "timing" | "lengthBeats" | "stepCount">
    | Pick<DrummerSequencerTrackState, "timing" | "lengthBeats" | "stepCount">,
  absoluteTransportSubunit: number,
  runtimePadStartSubunit?: number | null
): number {
  const boundedStepCount = Math.max(1, Math.round(track.stepCount));
  const boundedTransportSubunitCount = Math.max(
    1,
    Math.round(sequencerTransportSubunitCount(track.timing, track.lengthBeats))
  );
  const anchorSubunit =
    typeof runtimePadStartSubunit === "number" && Number.isFinite(runtimePadStartSubunit)
      ? Math.floor(runtimePadStartSubunit)
      : 0;
  const transportOffset =
    (((Math.floor(absoluteTransportSubunit) - anchorSubunit) % boundedTransportSubunitCount) +
      boundedTransportSubunitCount) %
    boundedTransportSubunitCount;
  const transportSubunitsPerLocalStep = Math.max(1, Math.round(sequencerTransportSubunitsPerLocalStep(track.timing)));
  return Math.min(boundedStepCount - 1, Math.floor(transportOffset / transportSubunitsPerLocalStep));
}

function displayedLocalStepFromPlayback(
  track:
    | Pick<
      SequencerTrackState,
      "timing" | "lengthBeats" | "stepCount" | "runtimeLocalStep" | "runtimePadStartSubunit"
    >
    | Pick<
      DrummerSequencerTrackState,
      "timing" | "lengthBeats" | "stepCount" | "runtimeLocalStep" | "runtimePadStartSubunit"
    >,
  absoluteTransportSubunit: number,
  isPlaying: boolean
): number {
  if (isPlaying && typeof track.runtimePadStartSubunit === "number" && Number.isFinite(track.runtimePadStartSubunit)) {
    return localStepFromTransportPosition(track, absoluteTransportSubunit, track.runtimePadStartSubunit);
  }
  if (typeof track.runtimeLocalStep === "number" && Number.isFinite(track.runtimeLocalStep)) {
    return ((Math.round(track.runtimeLocalStep) % Math.max(1, Math.round(track.stepCount))) +
      Math.max(1, Math.round(track.stepCount))) %
      Math.max(1, Math.round(track.stepCount));
  }
  return localStepFromTransportPosition(track, absoluteTransportSubunit);
}

function parseBeatRateValue(value: string): { numerator: number; denominator: number } | null {
  const [rawNumerator, rawDenominator] = value.split(":");
  const numerator = Number(rawNumerator);
  const denominator = Number(rawDenominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return {
    numerator: Math.round(numerator),
    denominator: Math.round(denominator)
  };
}

interface RunningSequencerTheory {
  scaleRoot: SequencerScaleRoot;
  scaleType: SequencerScaleType;
  mode: SequencerMode;
}

function scaleLabelFor(
  scaleRoot: SequencerScaleRoot,
  scaleType: SequencerScaleType,
  scaleTypeLabels: Record<SequencerScaleType, string>
): string {
  return scaleTypeLabels[scaleType].length > 0 ? `${scaleRoot} ${scaleTypeLabels[scaleType]}` : scaleRoot;
}


function useSequencerPageContext({
  collapsedPanels,
  onPanelCollapsedChange,
  data,
  instrumentActions,
  performanceActions,
  transportActions,
  melodicTrackActions,
  drummerTrackActions,
  pianoRollActions,
  midiControllerActions,
  controllerSequencerActions,
  arpeggiatorActions,
  onHelpRequest
}: SequencerPageProps) {
  const {
    guiLanguage,
    patches,
    performances,
    instrumentBindings,
    sequencer: suppliedSequencer,
    sequencerTransportSubunit: suppliedTransportSubunit,
    currentPerformanceId,
    performanceName,
    performanceDescription,
    instrumentsRunning,
    sessionState,
    midiInputName,
    transportError
  } = data;
  const audibleSubunit = suppliedSequencer.isPlaying ? data.readPlaybackTransportSubunit?.() : null;
  const sequencerTransportSubunit = audibleSubunit ?? suppliedTransportSubunit;
  const absoluteStep = Math.floor(sequencerTransportSubunit / sequencerTransportSubunitsPerStep());
  const sequencer = audibleSubunit == null ? suppliedSequencer : {
    ...suppliedSequencer,
    playhead: absoluteStep % Math.max(1, suppliedSequencer.stepCount),
    cycle: Math.floor(absoluteStep / Math.max(1, suppliedSequencer.stepCount))
  };
  const {
    onAddInstrument,
    onRemoveInstrument,
    onInstrumentPatchChange,
    onInstrumentChannelChange,
    onStartInstruments,
    onStopInstruments
  } = instrumentActions;
  const {
    onRenamePerformanceDevice,
    onPerformanceNameChange,
    onPerformanceDescriptionChange,
    onNewPerformance,
    onSavePerformance,
    onClonePerformance,
    onDeletePerformance,
    onLoadPerformance,
    onExportConfig,
    onExportCsdMidi,
    onExportCsdScore,
    onImportConfig
  } = performanceActions;
  const {
    onBpmChange,
    onSequencerCycleRewind,
    onSequencerCycleForward,
    onSequencerTransportStart,
    onSequencerTransportStop,
    onSequencerArrangerLoopSelectionChange
  } = transportActions;
  const {
    onAddSequencerTrack,
    onRemoveSequencerTrack,
    onSequencerTrackEnabledChange,
    onSequencerTrackChannelChange,
    onSequencerTrackSyncTargetChange,
    onSequencerTrackScaleChange,
    onSequencerTrackModeChange,
    onSequencerTrackMeterNumeratorChange,
    onSequencerTrackMeterDenominatorChange,
    onSequencerTrackStepsPerBeatChange,
    onSequencerTrackBeatRateChange,
    onSequencerTrackStepCountChange,
    onSequencerTrackStepNoteChange,
    onSequencerTrackStepChordChange,
    onSequencerTrackStepHoldChange,
    onSequencerTrackStepVelocityChange,
    onSequencerTrackStepTimingOffsetChange,
    onSequencerTrackStepCopy,
    onSequencerTrackClearSteps,
    onSequencerTrackReorder,
    onSequencerPadPress,
    onSequencerPadCopy,
    onSequencerPadTransposeShort,
    onSequencerPadTransposeLong,
    onSequencerTrackPadLoopEnabledChange,
    onSequencerTrackPadLoopRepeatChange,
    onSequencerTrackPadLoopPatternChange
  } = melodicTrackActions;
  const {
    onAddDrummerSequencerTrack,
    onRemoveDrummerSequencerTrack,
    onDrummerSequencerTrackEnabledChange,
    onDrummerSequencerTrackChannelChange,
    onDrummerSequencerTrackMeterNumeratorChange,
    onDrummerSequencerTrackMeterDenominatorChange,
    onDrummerSequencerTrackStepsPerBeatChange,
    onDrummerSequencerTrackBeatRateChange,
    onDrummerSequencerTrackStepCountChange,
    onDrummerSequencerRowAdd,
    onDrummerSequencerRowRemove,
    onDrummerSequencerRowKeyChange,
    onDrummerSequencerRowKeyPreview,
    onDrummerSequencerCellToggle,
    onDrummerSequencerCellVelocityChange,
    onDrummerSequencerCellTimingOffsetChange,
    onDrummerSequencerTrackClearSteps,
    onDrummerSequencerPadPress,
    onDrummerSequencerPadCopy,
    onDrummerSequencerTrackPadLoopEnabledChange,
    onDrummerSequencerTrackPadLoopRepeatChange,
    onDrummerSequencerTrackPadLoopPatternChange
  } = drummerTrackActions;
  const {
    onAddPianoRoll,
    onRemovePianoRoll,
    onPianoRollEnabledChange,
    onPianoRollMidiChannelChange,
    onPianoRollVelocityChange,
    onPianoRollScaleChange,
    onPianoRollModeChange,
    onPianoRollNoteOn,
    onPianoRollNoteOff
  } = pianoRollActions;
  const {
    onAddMidiController,
    onRemoveMidiController,
    onMidiControllerEnabledChange,
    onMidiControllerNumberChange,
    onMidiControllerTargetChannelsChange,
    onMidiControllerValueChange
  } = midiControllerActions;
  const {
    onAddControllerSequencer,
    onRemoveControllerSequencer,
    onControllerSequencerEnabledChange,
    onControllerSequencerNumberChange,
    onControllerSequencerTargetChannelsChange,
    onControllerSequencerMeterNumeratorChange,
    onControllerSequencerMeterDenominatorChange,
    onControllerSequencerStepsPerBeatChange,
    onControllerSequencerBeatRateChange,
    onControllerSequencerPadPress,
    onControllerSequencerPadCopy,
    onControllerSequencerClearSteps,
    onControllerSequencerPadLoopEnabledChange,
    onControllerSequencerPadLoopRepeatChange,
    onControllerSequencerPadLoopPatternChange,
    onControllerSequencerStepCountChange,
    onControllerSequencerKeypointAdd,
    onControllerSequencerKeypointChange,
    onControllerSequencerKeypointRemove
  } = controllerSequencerActions;
  const {
    onAddArpeggiator,
    onRemoveArpeggiator,
    onArpeggiatorCommand,
    onArpeggiatorEnabledChange,
    onArpeggiatorChange,
    onArpeggiatorPresetApply,
    onArpeggiatorPresetSave
  } = arpeggiatorActions;
  const ui = SEQUENCER_UI_COPY[guiLanguage];
  const modeLabels = MODE_LABELS[guiLanguage];
  const scaleTypeLabels = SCALE_TYPE_LABELS[guiLanguage];
  const modeOptions = useMemo(
    () =>
      SEQUENCER_MODE_OPTIONS.map((option) => ({
        ...option,
        label: modeLabels[option.value]
      })),
    [modeLabels]
  );
  const scaleOptions = useMemo(
    () =>
      SEQUENCER_SCALE_OPTIONS.map((option) => ({
        ...option,
        label: scaleTypeLabels[option.type].length > 0 ? `${option.root} ${scaleTypeLabels[option.type]}` : option.root
      })),
    [scaleTypeLabels]
  );
  const localizedSessionState = useMemo(() => {
    if (sessionState === "running") {
      return ui.running;
    }
    if (sessionState === "idle") {
      return ui.stopped;
    }
    return sessionState;
  }, [sessionState, ui.running, ui.stopped]);
  const patchById = useMemo(() => new Map(patches.map((patch) => [patch.id, patch])), [patches]);
  const rackInstrumentRows = useMemo(() => {
    const standard: RackInstrumentBindingRow[] = [];
    const alwaysOn: RackInstrumentBindingRow[] = [];

    instrumentBindings.forEach((binding, index) => {
      const row = { binding, index };
      const patch = patchById.get(binding.patchId);
      if (patch?.always_on === true) {
        alwaysOn.push(row);
      } else {
        standard.push(row);
      }
    });

    return { standard, alwaysOn };
  }, [instrumentBindings, patchById]);
  const totalPerformDevices =
    sequencer.tracks.length +
    sequencer.drummerTracks.length +
    sequencer.controllerSequencers.length +
    sequencer.arpeggiators.length +
    sequencer.pianoRolls.length +
    sequencer.midiControllers.length;
  const canRemovePerformDevice = totalPerformDevices > 1;
  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === currentPerformanceId) ?? null,
    [currentPerformanceId, performances]
  );
  const deletePerformanceTargetName =
    selectedPerformance?.name.trim() ||
    performanceName.trim() ||
    (currentPerformanceId ? `#${currentPerformanceId}` : ui.current);
  const renderDeviceName = (kind: PerformanceDeviceKind, device: { id: string; name: string }, fallback: string) => (
    <PerformanceDeviceName key={`${kind}:${device.id}`} kind={kind}
      device={device} fallback={fallback} sequencer={sequencer} guiLanguage={guiLanguage} onRename={onRenamePerformanceDevice} />
  );
  const configFileInputRef = useRef<HTMLInputElement | null>(null);
  const [deletePerformanceDialogOpen, setDeletePerformanceDialogOpen] = useState(false);
  useEffect(() => { if (collapsedPanels.rack) setDeletePerformanceDialogOpen(false); }, [collapsedPanels.rack]);
  const [linkedPadLoopStepPosition, setLinkedPadLoopStepPosition] = usePerformanceEditorState<number | null>("page", "linkedPadLoopStepPosition", null);
  const triggerConfigLoad = useCallback(() => {
    configFileInputRef.current?.click();
  }, []);
  useEffect(() => {
    if (!deletePerformanceDialogOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDeletePerformanceDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deletePerformanceDialogOpen]);
  useEffect(() => {
    if (currentPerformanceId) {
      return;
    }
    setDeletePerformanceDialogOpen(false);
  }, [currentPerformanceId]);
  const handleStartAll = useCallback(() => {
    onSequencerTransportStart();
  }, [onSequencerTransportStart]);
  const handleStopAll = useCallback(() => {
    onSequencerTransportStop(false);
  }, [onSequencerTransportStop]);
  const handleStopAllAndResetTransport = useCallback(() => {
    onSequencerTransportStop(true);
  }, [onSequencerTransportStop]);
  const arrangerCopy = useMemo(
    () => ({
      title: ui.multitrackArrangerTitle,
      deviceSummary: ui.multitrackArrangerDeviceSummary,
      zoomFit: ui.zoomFit,
      zoomOut: ui.zoomOut,
      zoomIn: ui.zoomIn,
      instrumentColumn: ui.multitrackArrangerInstrumentColumn,
      timelineColumn: ui.multitrackArrangerTimelineColumn,
      transportRewind: ui.multitrackArrangerTransportRewind,
      transportStop: ui.multitrackArrangerTransportStop,
      transportPlay: ui.multitrackArrangerTransportPlay,
      transportFastForward: ui.multitrackArrangerTransportFastForward,
      selectionRuler: ui.multitrackArrangerSelectionRuler,
      selectionHint: ui.multitrackArrangerSelectionHint,
      clearSelection: ui.multitrackArrangerClearSelection,
      dragToken: ui.multitrackArrangerDragToken,
      melodicSequencerWithIndex: ui.sequencerWithIndex,
      drummerSequencerWithIndex: ui.drummerSequencerWithIndex,
      controllerSequencerWithIndex: ui.controllerSequencerWithIndex,
      contextMenuAddPad: ui.multitrackArrangerContextMenuAddPad,
      contextMenuAddGroup: ui.multitrackArrangerContextMenuAddGroup,
      contextMenuAddSuperGroup: ui.multitrackArrangerContextMenuAddSuperGroup,
      contextMenuCopy: ui.multitrackArrangerContextMenuCopy,
      contextMenuPaste: ui.multitrackArrangerContextMenuPaste,
      contextMenuGroup: ui.multitrackArrangerContextMenuGroup,
      contextMenuSuperGroup: ui.multitrackArrangerContextMenuSuperGroup,
      contextMenuUngroup: ui.multitrackArrangerContextMenuUngroup,
      contextMenuRemove: ui.multitrackArrangerContextMenuRemove,
      contextMenuNoGroups: ui.multitrackArrangerContextMenuNoGroups,
      contextMenuNoSuperGroups: ui.multitrackArrangerContextMenuNoSuperGroups,
      contextMenuPasteDisabled: ui.multitrackArrangerContextMenuPasteDisabled,
      contextMenuInsertAtEnd: ui.multitrackArrangerContextMenuInsertHint
    }),
    [ui]
  );
  const handleConfigFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      onImportConfig(file);
      event.target.value = "";
    },
    [onImportConfig]
  );
  const openDeletePerformanceDialog = useCallback(() => {
    if (!currentPerformanceId) {
      return;
    }
    setDeletePerformanceDialogOpen(true);
  }, [currentPerformanceId]);
  const closeDeletePerformanceDialog = useCallback(() => {
    setDeletePerformanceDialogOpen(false);
  }, []);
  const confirmDeletePerformance = useCallback(() => {
    setDeletePerformanceDialogOpen(false);
    onDeletePerformance();
  }, [onDeletePerformance]);
  const transportStateClass =
    "rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-300";
  const controlLabelClass = "text-[10px] uppercase tracking-[0.18em] text-slate-400";
  const controlFieldClass =
    "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring";
  const rackAssignmentButtonClass =
    "rounded-md border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800/60 disabled:text-slate-500";
  const rackAssignmentSelectClass =
    "rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500";
  const rackAssignmentNumberInputClass =
    "w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500";
  return {
    rackInstrumentRows,
    guiLanguage,
    ui,
    performanceName,
    onPerformanceNameChange,
    performanceDescription,
    onPerformanceDescriptionChange,
    currentPerformanceId,
    instrumentsRunning,
    onLoadPerformance,
    performances,
    onNewPerformance,
    onClonePerformance,
    onSavePerformance,
    onExportConfig,
    onExportCsdMidi,
    onExportCsdScore,
    triggerConfigLoad,
    openDeletePerformanceDialog,
    instrumentBindings,
    patchById,
    patches,
    onInstrumentPatchChange,
    rackAssignmentSelectClass,
    onInstrumentChannelChange,
    rackAssignmentNumberInputClass,
    onRemoveInstrument,
    rackAssignmentButtonClass,
    sequencer,
    scaleTypeLabels,
    modeLabels,
    sequencerTransportSubunit,
    onSequencerTrackReorder,
    onHelpRequest,
    renderDeviceName,
    transportStateClass,
    onSequencerTrackEnabledChange,
    transportStopButtonClass,
    transportStartButtonClass,
    onSequencerTrackClearSteps,
    onRemoveSequencerTrack,
    canRemovePerformDevice,
    controlLabelClass,
    onSequencerTrackChannelChange,
    controlFieldClass,
    onSequencerTrackSyncTargetChange,
    onSequencerTrackScaleChange,
    scaleOptions,
    onSequencerTrackModeChange,
    modeOptions,
    onSequencerTrackMeterNumeratorChange,
    onSequencerTrackMeterDenominatorChange,
    onSequencerTrackStepsPerBeatChange,
    onSequencerTrackBeatRateChange,
    onSequencerTrackStepCountChange,
    linkedPadLoopStepPosition,
    setLinkedPadLoopStepPosition,
    onSequencerTrackPadLoopEnabledChange,
    onSequencerTrackPadLoopRepeatChange,
    onSequencerTrackPadLoopPatternChange,
    onSequencerPadPress,
    onSequencerPadCopy,
    onSequencerPadTransposeShort,
    onSequencerTrackStepCopy,
    onSequencerTrackStepHoldChange,
    onSequencerTrackStepNoteChange,
    onSequencerTrackStepChordChange,
    onSequencerTrackStepVelocityChange,
    onSequencerTrackStepTimingOffsetChange,
    onSequencerPadTransposeLong,
    onDrummerSequencerTrackEnabledChange,
    onDrummerSequencerTrackClearSteps,
    onDrummerSequencerRowAdd,
    onRemoveDrummerSequencerTrack,
    onDrummerSequencerTrackChannelChange,
    onDrummerSequencerTrackMeterNumeratorChange,
    onDrummerSequencerTrackMeterDenominatorChange,
    onDrummerSequencerTrackStepsPerBeatChange,
    onDrummerSequencerTrackBeatRateChange,
    onDrummerSequencerTrackStepCountChange,
    onDrummerSequencerTrackPadLoopEnabledChange,
    onDrummerSequencerTrackPadLoopRepeatChange,
    onDrummerSequencerTrackPadLoopPatternChange,
    onDrummerSequencerPadPress,
    onDrummerSequencerPadCopy,
    onDrummerSequencerRowKeyChange,
    onDrummerSequencerRowKeyPreview,
    onDrummerSequencerRowRemove,
    onDrummerSequencerCellToggle,
    onDrummerSequencerCellVelocityChange,
    onDrummerSequencerCellTimingOffsetChange,
    onControllerSequencerEnabledChange,
    onControllerSequencerClearSteps,
    onRemoveControllerSequencer,
    onControllerSequencerNumberChange,
    onControllerSequencerTargetChannelsChange,
    onControllerSequencerMeterNumeratorChange,
    onControllerSequencerMeterDenominatorChange,
    onControllerSequencerStepsPerBeatChange,
    onControllerSequencerBeatRateChange,
    onControllerSequencerStepCountChange,
    onControllerSequencerPadLoopEnabledChange,
    onControllerSequencerPadLoopRepeatChange,
    onControllerSequencerPadLoopPatternChange,
    onControllerSequencerPadPress,
    onControllerSequencerPadCopy,
    onControllerSequencerKeypointAdd,
    onControllerSequencerKeypointChange,
    onControllerSequencerKeypointRemove,
    onArpeggiatorCommand,
    onArpeggiatorEnabledChange,
    onRemoveArpeggiator,
    onArpeggiatorChange,
    onArpeggiatorPresetApply,
    onArpeggiatorPresetSave,
    onPianoRollEnabledChange,
    onRemovePianoRoll,
    onPianoRollMidiChannelChange,
    onPianoRollScaleChange,
    onPianoRollModeChange,
    onPianoRollVelocityChange,
    onPianoRollNoteOn,
    onPianoRollNoteOff,
    onMidiControllerNumberChange,
    onMidiControllerTargetChannelsChange,
    onMidiControllerEnabledChange,
    onRemoveMidiController,
    onMidiControllerValueChange,
    configFileInputRef,
    handleConfigFileChange,
    collapsedPanels,
    onPanelCollapsedChange,
    localizedSessionState,
    onAddInstrument,
    onStartInstruments,
    onStopInstruments,
    transportError,
    onBpmChange,
    onAddSequencerTrack,
    onAddDrummerSequencerTrack,
    onAddControllerSequencer,
    onAddArpeggiator,
    onAddPianoRoll,
    onAddMidiController,
    arrangerCopy,
    handleStartAll,
    handleStopAll,
    handleStopAllAndResetTransport,
    onSequencerCycleRewind,
    onSequencerCycleForward,
    onSequencerArrangerLoopSelectionChange,
    midiInputName,
    deletePerformanceDialogOpen,
    closeDeletePerformanceDialog,
    deletePerformanceTargetName,
    confirmDeletePerformance,
  };
}
export function SequencerPage(props: SequencerPageProps) {
  const generation = useAppStore(state => state.performanceWorkspaceGeneration);
  const routes = useAppStore(state => state.audioGraph.routes);
  const owners: EditorOwner[] = ['page', 'rack', 'arranger', 'mixer',
    ...[...props.data.sequencer.tracks, ...props.data.sequencer.drummerTracks, ...props.data.sequencer.controllerSequencers, ...props.data.sequencer.arpeggiators, ...props.data.sequencer.pianoRolls, ...props.data.sequencer.midiControllers].map(device => `device:${device.id}` as const),
    ...props.data.instrumentBindings.map(binding => `binding:${binding.id}` as const),
    ...routes.map(route => `route:${route.id}` as const)];
  return <PerformanceEditorProvider key={generation} owners={owners} retainedStore={props.editorStore}><OpenArrangerContext.Provider value={() => props.onPanelCollapsedChange("arranger", false)}><SequencerPageContent {...props} /></OpenArrangerContext.Provider></PerformanceEditorProvider>;
}
function SequencerPageContent(props: SequencerPageProps) {
  const context = useSequencerPageContext(props);
  const {
    instrumentBindings,
    configFileInputRef,
    handleConfigFileChange,
    ui,
    collapsedPanels,
    onPanelCollapsedChange,
    onHelpRequest,
    guiLanguage,
    transportStateClass,
    localizedSessionState,
    onAddInstrument,
    instrumentsRunning,
    rackAssignmentButtonClass,
    onStartInstruments,
    transportStartButtonClass,
    onStopInstruments,
    transportStopButtonClass,
    transportError,
    sequencer,
    controlLabelClass,
    onBpmChange,
    controlFieldClass,
    onAddSequencerTrack,
    onAddDrummerSequencerTrack,
    onAddControllerSequencer,
    onAddArpeggiator,
    onAddPianoRoll,
    onAddMidiController,
    arrangerCopy,
    patches,
    handleStartAll,
    handleStopAll,
    handleStopAllAndResetTransport,
    onSequencerCycleRewind,
    onSequencerCycleForward,
    onSequencerArrangerLoopSelectionChange,
    onSequencerTrackPadLoopPatternChange,
    onDrummerSequencerTrackPadLoopPatternChange,
    onControllerSequencerPadLoopPatternChange,
    midiInputName,
    deletePerformanceDialogOpen,
    closeDeletePerformanceDialog,
    deletePerformanceTargetName,
    confirmDeletePerformance,
  } = context;
  return (
    <>
      <section className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-3 shadow-glow">
        <input
          ref={configFileInputRef}
          type="file"
          accept="application/json,.json,.orch.json,.zip,.orch.zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={handleConfigFileChange}
        />

        <CollapsiblePanel unmountOnCollapse
          title={ui.instrumentRack}
          collapsed={collapsedPanels.rack}
          onCollapsedChange={(collapsed) => onPanelCollapsedChange("rack", collapsed)}
          className="rounded-xl border border-cyan-800/45 bg-slate-950/85 p-3"
          titleClassName="text-cyan-200"
          help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_instrument_rack")} /> : null}
          actions={<>
            <span className={transportStateClass}>{ui.state}: {localizedSessionState}</span>
            <button
              type="button"
              onClick={() => { onPanelCollapsedChange("rack", false); onAddInstrument(); }}
              disabled={instrumentsRunning}
              className={`${rackAssignmentButtonClass} border-accent/60 bg-accent/15 text-accent hover:bg-accent/25`}
            >
              {ui.addInstrument}
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onStartInstruments}
                disabled={instrumentsRunning}
                className={transportStartButtonClass}
              >
                {ui.startInstruments}
              </button>
              <button
                type="button"
                onClick={onStopInstruments}
                disabled={!instrumentsRunning}
                className={transportStopButtonClass}
              >
                {ui.stopInstruments}
              </button>
            </div>
          </>}
          collapsedSummary={<RackSummary context={context} />}
        >
          <RackBody context={context} />
        </CollapsiblePanel>

        <PerformMixer onStop={onStopInstruments} />

        {transportError && (
          <div className="mt-3 rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
            {transportError}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-sky-900/55 bg-slate-900/65 p-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{ui.globalSequencerClock}</div>
            <span className={transportStateClass}>{sequencer.isPlaying ? ui.running : ui.stopped}</span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={controlLabelClass}>{ui.bpm}</span>
              <input
                type="number"
                min={30}
                max={300}
                value={sequencer.timing.tempoBPM}
                onChange={(event) => onBpmChange(Number(event.target.value))}
                className={`${controlFieldClass} w-24`}
              />
            </label>
          </div>
        </div>

        <CollapsiblePanel unmountOnCollapse
          title={ui.sequencers}
          collapsed={collapsedPanels.melodic}
          onCollapsedChange={(collapsed) => onPanelCollapsedChange("melodic", collapsed)}
          className="mt-4 rounded-xl border border-sky-800/45 bg-slate-950/85 p-3"
          titleClassName="text-sky-200"
          help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_tracks")} /> : null}
          actions={<button
            type="button"
            onClick={() => { onPanelCollapsedChange("melodic", false); onAddSequencerTrack(); }}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            {ui.addSequencer}
          </button>}
        >
          <MelodicSequencersBody context={context} />
        </CollapsiblePanel>

        <CollapsiblePanel unmountOnCollapse
          title={ui.drummerSequencers}
          collapsed={collapsedPanels.drummer}
          onCollapsedChange={(collapsed) => onPanelCollapsedChange("drummer", collapsed)}
          className="mt-4 rounded-xl border border-rose-800/45 bg-slate-950/85 p-3"
          titleClassName="text-rose-200"
          help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_drummer_sequencer")} /> : null}
          actions={<button
            type="button"
            onClick={() => { onPanelCollapsedChange("drummer", false); onAddDrummerSequencerTrack(); }}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            {ui.addDrummerSequencer}
          </button>}
        >
          <DrummerSequencersBody context={context} />
        </CollapsiblePanel>

        <CollapsiblePanel unmountOnCollapse
          title={ui.controllerSequencers}
          collapsed={collapsedPanels.controller}
          onCollapsedChange={(collapsed) => onPanelCollapsedChange("controller", collapsed)}
          className="mt-4 rounded-xl border border-teal-800/45 bg-slate-950/85 p-3"
          titleClassName="text-teal-200"
          help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_controller_sequencer")} /> : null}
          actions={<button
            type="button"
            onClick={() => { onPanelCollapsedChange("controller", false); onAddControllerSequencer(); }}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            {ui.addControllerSequencer}
          </button>}
        >
          <ControllerSequencersBody context={context} />
        </CollapsiblePanel>

        <CollapsiblePanel unmountOnCollapse
          title={ui.arpeggiators}
          collapsed={collapsedPanels.arpeggiators}
          onCollapsedChange={(collapsed) => onPanelCollapsedChange("arpeggiators", collapsed)}
          className="mt-4 rounded-xl border border-cyan-800/45 bg-slate-950/85 p-3"
          titleClassName="text-cyan-200"
          help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_arpeggiator")} /> : null}
          actions={<button
            type="button"
            onClick={() => { onPanelCollapsedChange("arpeggiators", false); onAddArpeggiator(); }}
            disabled={sequencer.arpeggiators.length >= 8}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ui.addArpeggiator}
          </button>}
        >
          <ArpeggiatorsBody context={context} />
        </CollapsiblePanel>

        <CollapsiblePanel unmountOnCollapse
          title={ui.pianoRolls}
          collapsed={collapsedPanels.piano}
          onCollapsedChange={(collapsed) => onPanelCollapsedChange("piano", collapsed)}
          className="mt-4 rounded-xl border border-emerald-800/45 bg-slate-950/85 p-3"
          titleClassName="text-emerald-200"
          help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_piano_rolls")} /> : null}
          actions={<button
            type="button"
            onClick={() => { onPanelCollapsedChange("piano", false); onAddPianoRoll(); }}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            {ui.addPianoRoll}
          </button>}
        >
          <PianoRollsBody context={context} />
        </CollapsiblePanel>

        <CollapsiblePanel unmountOnCollapse
          title={ui.midiControllers(sequencer.midiControllers.length)}
          collapsed={collapsedPanels.midi}
          onCollapsedChange={(collapsed) => onPanelCollapsedChange("midi", collapsed)}
          className="mt-4 rounded-xl border border-violet-800/45 bg-slate-950/85 p-3"
          titleClassName="text-violet-200"
          help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_midi_controllers")} /> : null}
          actions={<button
            type="button"
            onClick={() => { onPanelCollapsedChange("midi", false); onAddMidiController(); }}
            disabled={sequencer.midiControllers.length >= 6}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ui.addController}
          </button>}
        >
          <MidiControllersBody context={context} />
        </CollapsiblePanel>

        {sequencer.tracks.length + sequencer.drummerTracks.length + sequencer.controllerSequencers.length + sequencer.arpeggiators.length > 0 ? (
          <MultitrackArranger
            collapsed={collapsedPanels.arranger}
            onCollapsedChange={(collapsed) => onPanelCollapsedChange("arranger", collapsed)}
            guiLanguage={guiLanguage}
            copy={arrangerCopy}
            sequencer={sequencer}
            patches={patches}
            instrumentBindings={instrumentBindings}
            onTransportPlay={handleStartAll}
            onTransportStop={handleStopAll}
            onTransportStopDoubleClick={handleStopAllAndResetTransport}
            onTransportRewind={onSequencerCycleRewind}
            onTransportFastForward={onSequencerCycleForward}
            onArrangerLoopSelectionChange={onSequencerArrangerLoopSelectionChange}
            onArrangementRangeChange={updates => useAppStore.getState().applyArrangementRangeEdit(updates)}
            onSequencerTrackPadLoopPatternChange={onSequencerTrackPadLoopPatternChange}
            onDrummerSequencerTrackPadLoopPatternChange={onDrummerSequencerTrackPadLoopPatternChange}
            onControllerSequencerPadLoopPatternChange={onControllerSequencerPadLoopPatternChange}
            onArpeggiatorPadLoopPatternChange={(id, pattern) => context.onArpeggiatorChange(id, { padLoopPattern: pattern })}
            onPlaybackChange={(kind, id, source, repeat) => {
              if (kind === "sequencer") { context.onSequencerTrackPadLoopEnabledChange(id, source); context.onSequencerTrackPadLoopRepeatChange(id, repeat); }
              else if (kind === "drummer") { context.onDrummerSequencerTrackPadLoopEnabledChange(id, source); context.onDrummerSequencerTrackPadLoopRepeatChange(id, repeat); }
              else if (kind === "controller") { context.onControllerSequencerPadLoopEnabledChange(id, source); context.onControllerSequencerPadLoopRepeatChange(id, repeat); }
              else context.onArpeggiatorChange(id, { padLoopEnabled: source, padLoopRepeat: repeat });
            }}
            onEditPad={kind => onPanelCollapsedChange(kind === "sequencer" ? "melodic" : kind === "drummer" ? "drummer" : kind === "controller" ? "controller" : "arpeggiators", false)}
            onPadCopy={(kind, id, from, to) => {
              if (kind === "sequencer") context.onSequencerPadCopy(id, from, to);
              else if (kind === "drummer") context.onDrummerSequencerPadCopy(id, from, to);
              else if (kind === "controller") context.onControllerSequencerPadCopy(id, from, to);
              else { const arp = context.sequencer.arpeggiators.find(a => a.id === id); if (arp) context.onArpeggiatorChange(id, { pads: arp.pads.map((p, i) => i === to ? structuredClone(arp.pads[from]) : p) }); }
            }}
            onHelpRequest={onHelpRequest}
          />
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/80 px-2.5 py-1.5 text-xs text-slate-300">
          <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
            {ui.playhead(sequencer.playhead, sequencer.stepCount)}
          </span>
          <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
            {ui.cycle(sequencer.cycle)}
          </span>
          <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono">
            {ui.midiInput(midiInputName ?? ui.none)}
          </span>
        </div>
      </section>

      {deletePerformanceDialogOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          onClick={closeDeletePerformanceDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-performance-dialog-title"
            className="w-full max-w-md rounded-2xl border border-rose-500/35 bg-slate-900/95 p-4 shadow-[0_24px_80px_rgba(2,6,23,0.65)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-rose-200">
              {ui.deletePerformanceDialogTitle}
            </div>
            <div
              id="delete-performance-dialog-title"
              className="mb-2 rounded-lg border border-slate-700 bg-slate-950/85 px-3 py-2 text-sm text-slate-100"
            >
              {deletePerformanceTargetName}
            </div>
            <p className="mb-4 text-xs text-slate-300">
              {ui.deletePerformanceDialogMessage(deletePerformanceTargetName)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeletePerformanceDialog}
                className="rounded-md border border-slate-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
              >
                {ui.cancel}
              </button>
              <button
                type="button"
                onClick={confirmDeletePerformance}
                className="rounded-md border border-rose-500/60 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25"
              >
                {ui.deletePerformance}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
function RackBody({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const {
    rackInstrumentRows,
    guiLanguage,
    ui,
    performanceName,
    onPerformanceNameChange,
    performanceDescription,
    onPerformanceDescriptionChange,
    currentPerformanceId,
    instrumentsRunning,
    onLoadPerformance,
    performances,
    onNewPerformance,
    onClonePerformance,
    onSavePerformance,
    onExportConfig,
    onExportCsdMidi,
    onExportCsdScore,
    triggerConfigLoad,
    openDeletePerformanceDialog,
    instrumentBindings,
    patchById,
    patches,
    onInstrumentPatchChange,
    rackAssignmentSelectClass,
    onInstrumentChannelChange,
    rackAssignmentNumberInputClass,
    onRemoveInstrument,
    rackAssignmentButtonClass,
  } = context;
  const renderRackInstrumentRow = ({ binding, index }: RackInstrumentBindingRow) => {
    const selectedPatch = patchById.get(binding.patchId);
    const isAlwaysOn = selectedPatch?.always_on === true;
    const cardClassName = isAlwaysOn
      ? "rounded-lg border border-blue-800/80 bg-[#020817] px-2 py-2 shadow-[inset_0_1px_0_rgba(59,130,246,0.16)]"
      : "rounded-lg border border-slate-600/80 bg-slate-800/75 px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";

    return (
      <div key={binding.id} className={cardClassName}>
        <div className="grid grid-cols-[minmax(0,_1fr)_110px_auto] items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{ui.patch(index + 1)}</span>
            <PatchPicker
              patches={patches}
              guiLanguage={guiLanguage}
              label={selectedPatch?.name ?? `${audioCopy(guiLanguage)("missing")}: ${binding.patchId}`}
              ariaLabel={ui.patch(index + 1)}
              onSelectPatch={(patchId) => onInstrumentPatchChange(binding.id, patchId)}
              disabled={instrumentsRunning}
              align="left"
              triggerClassName={rackAssignmentSelectClass}
            />
          </div>
          {isAlwaysOn ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{ui.channel}</span>
              <span className="rounded-md border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
                {audioCopy(guiLanguage)("continuous")}
              </span>
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{ui.channel}</span>
              <input
                type="number"
                min={1}
                max={16}
                value={binding.midiChannel}
                onChange={(event) => onInstrumentChannelChange(binding.id, Number(event.target.value))}
                disabled={instrumentsRunning}
                className={rackAssignmentNumberInputClass}
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => onRemoveInstrument(binding.id)}
            disabled={instrumentsRunning}
            className={`${rackAssignmentButtonClass} justify-self-end border-rose-500/60 bg-rose-500/15 px-2 text-rose-200 hover:bg-rose-500/25`}
          >
            {ui.remove}
          </button>
        </div>
        <PerformanceControllerRack binding={binding} patch={selectedPatch} language={guiLanguage} />
      </div>
    );
  };
  return <>
    <PerformanceControllerSyncStatus language={guiLanguage} />
    <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-5">
      <label className="flex flex-col gap-1 lg:col-span-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{ui.performanceName}</span>
        <input
          value={performanceName}
          onChange={(event) => onPerformanceNameChange(event.target.value)}
          placeholder={ui.performanceNamePlaceholder}
          className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
        />
      </label>

      <label className="flex min-w-0 flex-col gap-1 lg:col-span-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{ui.description}</span>
        <textarea
          value={performanceDescription}
          onChange={(event) => onPerformanceDescriptionChange(event.target.value)}
          placeholder={ui.performanceDescriptionPlaceholder}
          rows={3}
          wrap="soft"
          title={performanceDescription}
          className="w-full resize-none overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{ui.loadPerformance}</span>
        <select
          value={currentPerformanceId ?? ""}
          disabled={instrumentsRunning}
          onChange={(event) => {
            if (event.target.value.length > 0) {
              onLoadPerformance(event.target.value);
            }
          }}
          className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-accent/40 transition focus:ring"
        >
          <option value="">{ui.current}</option>
          {performances.map((performance) => (
            <option key={performance.id} value={performance.id}>
              {performance.name}
            </option>
          ))}
        </select>
      </label>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onNewPerformance}
        disabled={instrumentsRunning}
        className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
      >
        {ui.newPerformance}
      </button>
      <button
        type="button"
        onClick={onClonePerformance}
        disabled={instrumentsRunning}
        className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
      >
        {ui.clonePerformance}
      </button>

      <button
        type="button"
        onClick={onSavePerformance}
        className="rounded-md border border-mint/55 bg-mint/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-mint transition hover:bg-mint/25"
      >
        {ui.savePerformance}
      </button>
      <button
        type="button"
        onClick={onExportConfig}
        className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
      >
        {ui.export}
      </button>
      <button
        type="button"
        onClick={onExportCsdMidi}
        className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
      >
        {ui.exportCsdMidi}
      </button>
      <button
        type="button"
        onClick={onExportCsdScore}
        className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
      >
        {ui.exportCsdScore}
      </button>
      <button
        type="button"
        onClick={triggerConfigLoad}
        disabled={instrumentsRunning}
        className="rounded-md border border-slate-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
      >
        {ui.import}
      </button>
      <button
        type="button"
        onClick={openDeletePerformanceDialog}
        disabled={!currentPerformanceId}
        className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {ui.deletePerformance}
      </button>
    </div>

    <div className="mt-3 space-y-2">
      {instrumentBindings.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
          {ui.noInstrumentHint}
        </div>
      ) : (
        <>
          {rackInstrumentRows.standard.length > 0 ? (
            <div className="grid items-start gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {rackInstrumentRows.standard.map(renderRackInstrumentRow)}
            </div>
          ) : null}
          {rackInstrumentRows.alwaysOn.length > 0 ? (
            <div className="grid items-start gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {rackInstrumentRows.alwaysOn.map(renderRackInstrumentRow)}
            </div>
          ) : null}
        </>
      )}
    </div>

  </>;
}

function MelodicSequencersBody({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const {
    sequencer: playbackSequencer,
    scaleTypeLabels,
    modeLabels,
    ui,
    sequencerTransportSubunit,
    onSequencerTrackReorder,
    onHelpRequest,
    guiLanguage,
    renderDeviceName,
    transportStateClass,
    onSequencerTrackEnabledChange,
    instrumentsRunning,
    transportStopButtonClass,
    transportStartButtonClass,
    onSequencerTrackClearSteps,
    onRemoveSequencerTrack,
    canRemovePerformDevice,
    controlLabelClass,
    onSequencerTrackChannelChange,
    controlFieldClass,
    onSequencerTrackSyncTargetChange,
    onSequencerTrackScaleChange,
    scaleOptions,
    onSequencerTrackModeChange,
    modeOptions,
    onSequencerTrackMeterNumeratorChange,
    onSequencerTrackMeterDenominatorChange,
    onSequencerTrackStepsPerBeatChange,
    onSequencerTrackBeatRateChange,
    onSequencerTrackStepCountChange,
    onSequencerTrackPadLoopEnabledChange,
    onSequencerTrackPadLoopPatternChange,
    onSequencerPadPress,
    onSequencerPadCopy,
    onSequencerPadTransposeShort,
    onSequencerTrackStepCopy,
    onSequencerTrackStepHoldChange,
    onSequencerTrackStepNoteChange,
    onSequencerTrackStepChordChange,
    onSequencerTrackStepVelocityChange,
    onSequencerTrackStepTimingOffsetChange,
    onSequencerPadTransposeLong,
  } = context;
  const editingPads = useAppStore(state => state.sequencerEditingPads);
  const selectEditingPad = useAppStore(state => state.selectSequencerEditingPad);
  const authored = useAppStore(state => state.sequencer);
  const sequencer = sequencerEditingView(playbackSequencer, editingPads);
  useEffect(() => {
    for (const track of [...authored.tracks, ...authored.drummerTracks, ...authored.controllerSequencers]) {
      if (editingPads[track.id] === undefined) selectEditingPad(track.id, track.activePad);
    }
  }, [authored, editingPads, selectEditingPad]);

  const [stepSelectPreview, setStepSelectPreview] = usePerformanceEditorState<Record<string, string>>("page", "stepSelectPreview", {});
  const padTransposePressRef = useRef<Record<string, { timerId: number; longPressTriggered: boolean }>>({});
  const padTransposePressKey = useCallback((trackId: string, padIndex: number, direction: -1 | 1) => {
    return `${trackId}:${padIndex}:${direction}`;
  }, []);
  const cancelPadTransposePress = useCallback((trackId: string, padIndex: number, direction: -1 | 1) => {
    const key = padTransposePressKey(trackId, padIndex, direction);
    const activePress = padTransposePressRef.current[key];
    if (!activePress) {
      return;
    }
    window.clearTimeout(activePress.timerId);
    delete padTransposePressRef.current[key];
  }, [padTransposePressKey]);
  const handlePadTransposePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, trackId: string, padIndex: number, direction: -1 | 1) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();

      const key = padTransposePressKey(trackId, padIndex, direction);
      const existing = padTransposePressRef.current[key];
      if (existing) {
        window.clearTimeout(existing.timerId);
      }

      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      const timerId = window.setTimeout(() => {
        const activePress = padTransposePressRef.current[key];
        if (!activePress || activePress.longPressTriggered) {
          return;
        }
        activePress.longPressTriggered = true;
        onSequencerPadTransposeLong(trackId, padIndex, direction);
      }, PAD_TRANSPOSE_LONG_PRESS_MS);

      padTransposePressRef.current[key] = {
        timerId,
        longPressTriggered: false
      };
    },
    [onSequencerPadTransposeLong, padTransposePressKey]
  );
  const handlePadTransposePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, trackId: string, padIndex: number, direction: -1 | 1) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();

      const key = padTransposePressKey(trackId, padIndex, direction);
      const activePress = padTransposePressRef.current[key];
      if (!activePress) {
        return;
      }
      window.clearTimeout(activePress.timerId);
      delete padTransposePressRef.current[key];

      if (!activePress.longPressTriggered) {
        onSequencerPadTransposeShort(trackId, padIndex, direction);
      }
    },
    [onSequencerPadTransposeShort, padTransposePressKey]
  );
  useEffect(() => { const presses = padTransposePressRef.current; return () => { for (const press of Object.values(presses)) window.clearTimeout(press.timerId); }; }, []);
  return <>
    <div className="space-y-3">
      {sequencer.tracks.map((track, trackIndex) => {
        const noteOptions = buildSequencerNoteOptions(track.scaleRoot, track.mode);
        const noteOptionsByNote = new Map(noteOptions.map((option) => [option.note, option]));
        const tonicPitchClass = (() => {
          const tonic = noteOptions.find((option) => option.degree === 1);
          return tonic ? midiNotePitchClass(tonic.note) : 0;
        })();
        const pitchClassOptions = buildSequencerPitchClassOptions(noteOptions);
        const inScalePitchClassOptions = pitchClassOptions.filter((option) => option.inScale);
        const outOfScalePitchClassOptions = pitchClassOptions.filter((option) => !option.inScale);
        const scaleLabel =
          scaleTypeLabels[track.scaleType].length > 0
            ? `${track.scaleRoot} ${scaleTypeLabels[track.scaleType]}`
            : track.scaleRoot;
        const modeLabel = modeLabels[track.mode];
        const scaleValue = `${track.scaleRoot}:${track.scaleType}`;
        const stepIndices = Array.from({ length: track.stepCount }, (_, index) => index);
        const trackDisplayLabel = performanceDeviceDisplayName(track.name, ui.sequencerWithIndex(trackIndex + 1));
        const syncTargetValue = track.syncToTrackId ?? "";
        const trackIsRunning = sequencer.isPlaying && track.enabled;
        const manualPlayback = trackIsRunning && !track.padLoopEnabled;
        const playingPad = playbackSequencer.tracks.find(t => t.id === track.id)?.activePad;
        const absoluteTransportSubunit = sequencer.isPlaying
          ? sequencerTransportSubunit
          : sequencerAbsoluteTransportStepValue(sequencer) * sequencerTransportSubunitsPerStep();
        const localPlayhead = sequencer.isPlaying && playbackSequencer.tracks.find(t => t.id === track.id)?.activePad !== track.activePad ? -1 : displayedLocalStepFromPlayback(
          track,
          absoluteTransportSubunit,
          sequencer.isPlaying && playbackSequencer.tracks.find(t => t.id === track.id)?.activePad === track.activePad
        );

        return (
          <article
            key={track.id}
            id={`sequencer-${track.id}`}
            onDragOver={(event) => {
              if (!dragEventHasMimeType(event, SEQUENCER_TRACK_DRAG_MIME)) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              const payload = parseSequencerTrackDragPayload(event);
              if (!payload || payload.trackId === track.id) {
                return;
              }
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const position = event.clientY >= rect.top + rect.height / 2 ? "after" : "before";
              onSequencerTrackReorder(payload.trackId, track.id, position);
            }}
            className="relative rounded-xl border border-slate-700 bg-slate-900/65 p-2.5 pr-10"
          >
            {onHelpRequest ? (
              <HelpIconButton
                guiLanguage={guiLanguage}
                onClick={() => onHelpRequest("sequencer_track_editor")}
                className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
              />
            ) : null}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div
                draggable
                onDragStart={(event) => {
                  event.stopPropagation();
                  const payload = JSON.stringify({ trackId: track.id });
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(SEQUENCER_TRACK_DRAG_MIME, payload);
                  event.dataTransfer.setData("text/plain", payload);
                }}
                className="inline-flex cursor-grab select-none items-center rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 active:cursor-grabbing"
                aria-label={`${trackDisplayLabel}: drag to reorder`}
                title="Drag to reorder sequencers"
              >
                ::
              </div>
              {renderDeviceName("tracks", track, ui.sequencerWithIndex(trackIndex + 1))}
              <span className={transportStateClass}>{trackStateLabel(track, sequencer.isPlaying, ui)}</span>
              <button
                type="button"
                onClick={() => onSequencerTrackEnabledChange(track.id, !trackIsRunning)}
                disabled={!instrumentsRunning && !trackIsRunning}
                className={trackIsRunning ? transportStopButtonClass : transportStartButtonClass}
              >
                {trackIsRunning ? ui.stop : ui.start}
              </button>
              <button
                type="button"
                onClick={() => onSequencerTrackClearSteps(track.id)}
                className="ml-2 rounded-md border border-slate-500/70 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400 hover:bg-slate-700"
              >
                {ui.clearSteps}
              </button>
              <button
                type="button"
                onClick={() => onRemoveSequencerTrack(track.id)}
                disabled={!canRemovePerformDevice}
                className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ui.remove}
              </button>
            </div>

            <div className="mb-2 grid gap-2 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:items-start">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.midiChannel}</span>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={track.midiChannel}
                      onChange={(event) => onSequencerTrackChannelChange(track.id, Number(event.target.value))}
                      className={`${controlFieldClass} w-24`}
                    />
                  </label>

                  <label className="flex min-w-[170px] flex-1 flex-col gap-1">
                    <span className={controlLabelClass}>{ui.syncToSequencer}</span>
                    <select
                      value={syncTargetValue}
                      onChange={(event) =>
                        onSequencerTrackSyncTargetChange(
                          track.id,
                          event.target.value.trim().length > 0 ? event.target.value : null
                        )
                      }
                      className={controlFieldClass}
                    >
                      <option value="">{ui.none}</option>
                      {sequencer.tracks.map((candidateTrack, candidateIndex) => {
                        if (candidateTrack.id === track.id) {
                          return null;
                        }
                        return (
                          <option key={`${track.id}-sync-${candidateTrack.id}`} value={candidateTrack.id}>
                            {performanceDeviceDisplayName(candidateTrack.name, ui.sequencerWithIndex(candidateIndex + 1))}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-[180px] flex-1 flex-col gap-1">
                    <span className={controlLabelClass}>{ui.scale}</span>
                    <select
                      value={scaleValue}
                      onChange={(event) => {
                        const selected = parseSequencerScaleValue(event.target.value);
                        if (selected) {
                          onSequencerTrackScaleChange(track.id, selected.root, selected.type);
                        }
                      }}
                      className={controlFieldClass}
                    >
                      {scaleOptions.map((option) => (
                        <option key={`${track.id}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-w-[160px] flex-1 flex-col gap-1">
                    <span className={controlLabelClass}>{ui.mode}</span>
                    <select
                      value={track.mode}
                      onChange={(event) => onSequencerTrackModeChange(track.id, event.target.value as SequencerMode)}
                      className={controlFieldClass}
                    >
                      {modeOptions.map((option) => (
                        <option key={`${track.id}-mode-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.meter}</span>
                    <div className="flex items-center gap-1">
                      <select
                        value={track.timing.meterNumerator}
                        onChange={(event) =>
                          onSequencerTrackMeterNumeratorChange(track.id, Number(event.target.value))
                        }
                        className={`${controlFieldClass} w-20`}
                      >
                        {[2, 3, 4, 5, 6, 7].map((value) => (
                          <option key={`${track.id}-meter-numerator-${value}`} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <span className="text-slate-400">/</span>
                      <select
                        value={track.timing.meterDenominator}
                        onChange={(event) =>
                          onSequencerTrackMeterDenominatorChange(track.id, Number(event.target.value))
                        }
                        className={`${controlFieldClass} w-20`}
                      >
                        {[4, 8].map((value) => (
                          <option key={`${track.id}-meter-denominator-${value}`} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.grid}</span>
                    <select
                      value={track.timing.stepsPerBeat}
                      onChange={(event) =>
                        onSequencerTrackStepsPerBeatChange(track.id, Number(event.target.value))
                      }
                      className={`${controlFieldClass} w-24`}
                    >
                      {[2, 4, 8].map((value) => (
                        <option key={`${track.id}-steps-per-beat-${value}`} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.beatRate}</span>
                    <select
                      value={`${track.timing.beatRateNumerator}:${track.timing.beatRateDenominator}`}
                      onChange={(event) => {
                        const beatRate = parseBeatRateValue(event.target.value);
                        if (beatRate) {
                          onSequencerTrackBeatRateChange(track.id, beatRate.numerator, beatRate.denominator);
                        }
                      }}
                      className={`${controlFieldClass} w-28`}
                    >
                      {SEQUENCER_BEAT_RATE_OPTIONS.map((option) => (
                        <option
                          key={`${track.id}-beat-rate-${option.label}`}
                          value={`${option.numerator}:${option.denominator}`}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className={controlLabelClass}>{ui.beats}</span>
                    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-600 bg-slate-950 p-1">
                      {sequencerPadLengthBeatOptions(track.timing.meterNumerator, track.lengthBeats).map((count) => (
                        <button
                          key={`${track.id}-steps-${count}`}
                          type="button"
                          onClick={() => onSequencerTrackStepCountChange(track.id, count)}
                          className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${track.lengthBeats === count
                              ? "bg-accent/30 text-accent"
                              : "text-slate-300 hover:bg-slate-800"
                            }`}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-w-0 space-y-2">
              <PerformanceAuditionControls compact id={track.id} language={guiLanguage} editingPad={track.activePad} playingPad={playbackSequencer.tracks.find(t => t.id === track.id)?.activePad} queuedPad={track.queuedPad} playing={sequencer.isPlaying && track.enabled} item={{ type: "pad", padIndex: track.activePad }} manualLaunch={track.padLoopEnabled ? undefined : () => { onSequencerPadPress(track.id, track.activePad); if (!sequencer.isPlaying || !track.enabled) onSequencerTrackEnabledChange(track.id, true); }} />
              <PatternWorkspace track={track} padHasContent={index => melodicPadHasSound(track.pads[index])} language={guiLanguage}
                onSourceChange={enabled => onSequencerTrackPadLoopEnabledChange(track.id, enabled)}
                onPatternChange={pattern => onSequencerTrackPadLoopPatternChange(track.id, pattern)} />
              </div>
            </div>

            <div className="mb-2 text-[11px] text-slate-500">
              {ui.notesInScaleMode(scaleLabel, modeLabel)}
            </div>

            <div className="mb-2">
              <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">{ui.patternPads}</div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {Array.from({ length: 8 }, (_, padIndex) => {
                  const isActivePad = track.activePad === padIndex;
                  const isQueuedPad = track.queuedPad === padIndex;
                  const padHasContent = melodicPadHasSound(track.pads[padIndex]);
                  const padAccentClass = `${PATTERN_ITEM_COLORS[padHasContent ? "pad" : "pause"]} hover:border-emerald-400`;
                  return (
                    <div key={`${track.id}-pad-${padIndex}`} className="relative">
                      <button
                        type="button"
                        draggable
                        aria-pressed={isActivePad}
                        onClick={() => {
                          selectEditingPad(track.id, padIndex);
                          if (manualPlayback) onSequencerPadPress(track.id, padIndex);
                        }}
                        onDragStart={(event) => {
                          const payload = JSON.stringify({ trackId: track.id, padIndex });
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData(SEQUENCER_PAD_DRAG_MIME, payload);
                          event.dataTransfer.setData("text/plain", payload);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const payload = parseSequencerPadDragPayload(event);
                          if (!payload || payload.trackId !== track.id || payload.padIndex === padIndex) {
                            return;
                          }
                          onSequencerPadCopy(track.id, payload.padIndex, padIndex);
                        }}
                        className={`w-full rounded-md border py-1.5 pl-5 pr-10 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${patternPadClass(manualPlayback ? playingPad === padIndex : isActivePad, isQueuedPad, padHasContent)}`}
                      >
                        #{padIndex + 1}
                      </button>
                      <div className="absolute right-4 top-0.5 z-20">
                        <ArrangerSpeaker id={track.id} item={{ type: "pad", padIndex }} label={`#${padIndex + 1}`} language={guiLanguage} />
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) => handlePadTransposePointerDown(event, track.id, padIndex, -1)}
                        onPointerUp={(event) => handlePadTransposePointerUp(event, track.id, padIndex, -1)}
                        onPointerCancel={() => cancelPadTransposePress(track.id, padIndex, -1)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          onSequencerPadTransposeShort(track.id, padIndex, -1);
                        }}
                        className={`absolute inset-y-0 left-0 z-10 flex w-4 items-center justify-center rounded-l-md border text-[10px] font-bold transition ${padAccentClass}`}
                        aria-label={`Transpose pattern pad #${padIndex + 1} down (click: in-scale, hold: key-step)`}
                        title="Short: transpose notes in scale | Long: move key down by degree"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) => handlePadTransposePointerDown(event, track.id, padIndex, 1)}
                        onPointerUp={(event) => handlePadTransposePointerUp(event, track.id, padIndex, 1)}
                        onPointerCancel={() => cancelPadTransposePress(track.id, padIndex, 1)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          onSequencerPadTransposeShort(track.id, padIndex, 1);
                        }}
                        className={`absolute inset-y-0 right-0 z-10 flex w-4 items-center justify-center rounded-r-md border text-[10px] font-bold transition ${padAccentClass}`}
                        aria-label={`Transpose pattern pad #${padIndex + 1} up (click: in-scale, hold: key-step)`}
                        title="Short: transpose notes in scale | Long: move key up by degree"
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <RetainedScroll owner={`device:${track.id}`} field="grid" className="overflow-x-auto pb-1">
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${track.stepCount}, minmax(112px, 1fr))`,
                  minWidth: `${Math.max(760, track.stepCount * 116)}px`
                }}
              >
                {stepIndices.map((step) => {
                  const stepState = track.steps[step];
                  const noteValue = stepState?.note ?? null;
                  const holdActive = stepState?.hold === true;
                  const stepVelocity = stepState?.velocity ?? 127;
                  const isActive = track.enabled && sequencer.isPlaying && localPlayhead === step;
                  const selectedNote = noteValue === null ? null : noteOptionsByNote.get(noteValue) ?? null;
                  const isInScale = selectedNote?.inScale ?? false;
                  const degree = selectedNote?.degree ?? null;
                  const notePitchClass = noteValue === null ? null : midiNotePitchClass(noteValue);
                  const noteOctave = noteValue === null ? null : midiNoteOctave(noteValue, tonicPitchClass);
                  const chordValue = stepState?.chord ?? "none";
                  const chordOptions = buildSequencerChordOptions(noteValue, track.scaleRoot, track.mode);
                  const chordNoneOptions = chordOptions.filter((option) => option.group === "none");
                  const chordDiatonicOptions = chordOptions.filter((option) => option.group === "diatonic");
                  const chordChromaticOptions = chordOptions.filter((option) => option.group === "chromatic");
                  const selectedChordOption =
                    chordOptions.find((option) => option.value === chordValue) ??
                    chordOptions.find((option) => option.value === "none") ??
                    chordOptions[0];
                  const selectedChordLabel = selectedChordOption?.label ?? "none";
                  const selectedChordColor = selectedChordOption?.color ?? "neutral";
                  const chordStatusText =
                    noteValue === null || chordValue === "none"
                      ? null
                      : selectedChordOption?.group === "diatonic"
                        ? "diatonic"
                        : selectedChordOption?.inScaleToneCount && selectedChordOption.inScaleToneCount > 0
                          ? "chromatic / partial in-scale"
                          : "chromatic / out of scale";
                  const stepKey = `${track.id}:${step}`;
                  const selectValue =
                    stepSelectPreview[stepKey] ?? (notePitchClass === null ? "" : String(notePitchClass));
                  const selectedLabel =
                    noteValue === null
                      ? ui.rest
                      : isInScale && degree !== null
                        ? `${pianoKeyNoteName(selectedNote?.label, noteValue)} (${degree})`
                        : pianoKeyNoteName(selectedNote?.label, noteValue);

                  return (
                    <div
                      key={`${track.id}-step-${step}`}
                      onDragOver={(event) => {
                        if (!dragEventHasMimeType(event, SEQUENCER_STEP_DRAG_MIME)) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(event) => {
                        const payload = parseSequencerStepDragPayload(event);
                        if (!payload) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        if (payload.trackId === track.id && payload.stepIndex === step) {
                          return;
                        }
                        onSequencerTrackStepCopy(payload.trackId, payload.stepIndex, track.id, step);
                      }}
                      className={`rounded-md border p-1.5 transition ${isActive
                          ? "border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(14,165,233,0.55)]"
                          : isInScale
                            ? "border-emerald-500/70 bg-emerald-900/20"
                            : "border-slate-700 bg-slate-900"
                        }`}
                    >
                      <div className="relative pl-5 pr-12 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                        <div
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation();
                            const payload = JSON.stringify({ trackId: track.id, stepIndex: step });
                            event.dataTransfer.effectAllowed = "copy";
                            event.dataTransfer.setData(SEQUENCER_STEP_DRAG_MIME, payload);
                            event.dataTransfer.setData("text/plain", payload);
                          }}
                          className="absolute left-0 top-0 inline-flex cursor-grab select-none rounded px-1 py-0.5 text-[8px] text-slate-500 hover:bg-slate-800/80 hover:text-slate-300 active:cursor-grabbing"
                          aria-label={`Step ${step + 1}: drag to copy settings`}
                          title="Drag onto another step to copy note/chord/octave/velocity/timing"
                        >
                          ::
                        </div>
                        <button
                          type="button"
                          onClick={() => onSequencerTrackStepHoldChange(track.id, step, !holdActive)}
                          className="absolute right-0 top-0 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-300 transition hover:bg-slate-800/80"
                          title={ui.hold}
                          aria-label={ui.hold}
                        >
                          <span>{ui.hold}</span>
                          <span
                            className={`h-2.5 w-2.5 rounded-full border ${holdActive
                                ? "border-emerald-200 bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.95)]"
                                : "border-slate-500 bg-slate-600"
                              }`}
                          />
                        </button>
                        {step + 1}
                      </div>

                      <div className="relative mt-1">
                        <select
                          value={selectValue}
                          onMouseDown={(event) => {
                            if (event.button !== 0 || noteValue !== null) {
                              return;
                            }
                            const fallbackNote = previousNonRestNote(track.steps, step);
                            if (fallbackNote === null) {
                              return;
                            }
                            const fallbackValue = String(midiNotePitchClass(fallbackNote));
                            setStepSelectPreview((previous) =>
                              previous[stepKey] === fallbackValue
                                ? previous
                                : {
                                  ...previous,
                                  [stepKey]: fallbackValue
                                }
                            );
                            onSequencerTrackStepNoteChange(track.id, step, fallbackNote);
                          }}
                          onFocus={() => {
                            if (noteValue !== null) {
                              return;
                            }
                            const fallbackNote = previousNonRestNote(track.steps, step);
                            if (fallbackNote === null) {
                              return;
                            }
                            const fallbackValue = String(midiNotePitchClass(fallbackNote));
                            setStepSelectPreview((previous) =>
                              previous[stepKey] === fallbackValue
                                ? previous
                                : {
                                  ...previous,
                                  [stepKey]: fallbackValue
                                }
                            );
                          }}
                          onBlur={() => {
                            setStepSelectPreview((previous) => {
                              if (!(stepKey in previous)) {
                                return previous;
                              }
                              const next = { ...previous };
                              delete next[stepKey];
                              return next;
                            });
                          }}
                          onChange={(event) => {
                            const raw = event.target.value.trim();
                            setStepSelectPreview((previous) => {
                              if (!(stepKey in previous)) {
                                return previous;
                              }
                              const next = { ...previous };
                              delete next[stepKey];
                              return next;
                            });
                            if (raw.length === 0) {
                              onSequencerTrackStepNoteChange(track.id, step, null);
                              return;
                            }
                            const nextPitchClass = Number(raw);
                            const fallbackNote = previousNonRestNote(track.steps, step);
                            const nextOctave =
                              noteOctave ??
                              (fallbackNote === null ? 4 : midiNoteOctave(fallbackNote, tonicPitchClass));
                            onSequencerTrackStepNoteChange(
                              track.id,
                              step,
                              sequencerMidiNoteFromPitchClassOctave(nextPitchClass, nextOctave, tonicPitchClass)
                            );
                          }}
                          className="h-8 w-full appearance-none rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-center font-mono text-[11px] text-transparent outline-none ring-accent/40 transition focus:ring"
                        >
                          <optgroup label={ui.rest}>
                            <option value="" style={{ color: "#f8fafc" }}>
                              {ui.rest}
                            </option>
                          </optgroup>
                          <optgroup label={ui.inScaleOptgroup(scaleLabel, modeLabel)}>
                            {inScalePitchClassOptions.map((option) => (
                              <option
                                key={`${track.id}-in-pc-${option.pitchClass}`}
                                value={option.pitchClass}
                                style={{ color: "#f8fafc" }}
                              >
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label={ui.outOfScaleOptgroup}>
                            {outOfScalePitchClassOptions.map((option) => (
                              <option
                                key={`${track.id}-out-pc-${option.pitchClass}`}
                                value={option.pitchClass}
                                style={{ color: "#f8fafc" }}
                              >
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[11px] text-slate-100">
                          {selectedLabel}
                        </div>
                      </div>

                      <label
                        className={`mt-1 flex items-center gap-1.5 rounded-md border bg-slate-950/70 px-2 py-1 ${chordColorBorderClass(selectedChordColor)}`}
                      >
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.16em] text-slate-400">CHD</span>
                        <div className="relative min-w-0 flex-1">
                          <select
                            disabled={noteValue === null}
                            value={chordValue}
                            onChange={(event) =>
                              onSequencerTrackStepChordChange(track.id, step, event.target.value as SequencerChord)
                            }
                            className="h-6 w-full appearance-none rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-center font-mono text-[10px] text-transparent outline-none ring-accent/40 transition focus:ring disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`${ui.chord} ${step + 1}`}
                          >
                            <optgroup label={ui.chordNoneOptgroup}>
                              {chordNoneOptions.map((option) => (
                                <option
                                  key={`${track.id}-step-${step}-chord-${option.value}`}
                                  value={option.value}
                                  style={chordOptionInlineStyle(option.color)}
                                >
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label={ui.chordDiatonicOptgroup}>
                              {chordDiatonicOptions.map((option) => (
                                <option
                                  key={`${track.id}-step-${step}-chord-${option.value}`}
                                  value={option.value}
                                  style={chordOptionInlineStyle(option.color)}
                                >
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label={ui.chordChromaticOptgroup}>
                              {chordChromaticOptions.map((option) => (
                                <option
                                  key={`${track.id}-step-${step}-chord-${option.value}`}
                                  value={option.value}
                                  style={chordOptionInlineStyle(option.color)}
                                >
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          <div
                            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-semibold tracking-[0.08em] ${chordColorTextClass(selectedChordColor)}`}
                          >
                            {selectedChordLabel}
                          </div>
                        </div>
                      </label>

                      {chordStatusText ? (
                        <div className={`mt-1 text-center text-[9px] tracking-[0.12em] ${chordColorTextClass(selectedChordColor)}`}>
                          {chordStatusText}
                        </div>
                      ) : null}

                      <label className="mt-1 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.16em] text-slate-400">OCT</span>
                        <input
                          type="number"
                          min={0}
                          max={7}
                          step={1}
                          disabled={noteValue === null}
                          value={noteOctave ?? 4}
                          onChange={(event) => {
                            if (noteValue === null) {
                              return;
                            }
                            const raw = event.target.value.trim();
                            if (raw.length === 0) {
                              return;
                            }
                            onSequencerTrackStepNoteChange(
                              track.id,
                              step,
                              sequencerMidiNoteFromPitchClassOctave(notePitchClass ?? 0, Number(raw), tonicPitchClass)
                            );
                          }}
                          className="w-14 rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-center font-mono text-[11px] text-slate-100 outline-none ring-accent/40 transition focus:ring disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`${ui.octave} ${step + 1}`}
                        />
                      </label>

                      <label className="mt-1 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.16em] text-slate-400">VEL</span>
                        <input
                          type="number"
                          min={0}
                          max={127}
                          step={1}
                          value={stepVelocity}
                          onChange={(event) => {
                            const raw = event.target.value.trim();
                            if (raw.length === 0) {
                              return;
                            }
                            onSequencerTrackStepVelocityChange(track.id, step, Number(raw));
                          }}
                          className="w-14 rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-center font-mono text-[11px] text-slate-100 outline-none ring-accent/40 transition focus:ring"
                          aria-label={`VEL ${step + 1}`}
                        />
                      </label>

                      <NoteTimingControl value={stepState?.timingOffsetPercent ?? 0} timing={track.timing}
                        language={guiLanguage} onChange={(value) => onSequencerTrackStepTimingOffsetChange?.(track.id, step, value)} />

                      <div
                        className={`mt-1 text-center text-[10px] ${noteValue === null
                            ? holdActive
                              ? "text-emerald-300"
                              : "text-slate-500"
                            : isInScale
                              ? "text-emerald-300"
                              : "text-amber-300"
                          }`}
                      >
                        {noteValue === null
                          ? holdActive
                            ? `${ui.rest.toLowerCase()} + ${ui.hold.toLowerCase()}`
                            : ui.rest.toLowerCase()
                          : isInScale
                            ? ui.inScaleDegree(degree)
                            : ui.outOfScale}
                      </div>
                    </div>
                  );
                })}
              </div>
            </RetainedScroll>
          </article>
        );
      })}

    </div>
  </>;
}

function DrummerSequencersBody({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const {
    sequencer: playbackSequencer,
    sequencerTransportSubunit,
    onHelpRequest,
    guiLanguage,
    renderDeviceName,
    ui,
    transportStateClass,
    onDrummerSequencerTrackEnabledChange,
    instrumentsRunning,
    transportStopButtonClass,
    transportStartButtonClass,
    onDrummerSequencerTrackClearSteps,
    onDrummerSequencerRowAdd,
    onRemoveDrummerSequencerTrack,
    canRemovePerformDevice,
    controlLabelClass,
    onDrummerSequencerTrackChannelChange,
    controlFieldClass,
    onDrummerSequencerTrackMeterNumeratorChange,
    onDrummerSequencerTrackMeterDenominatorChange,
    onDrummerSequencerTrackStepsPerBeatChange,
    onDrummerSequencerTrackBeatRateChange,
    onDrummerSequencerTrackStepCountChange,
    onDrummerSequencerTrackPadLoopEnabledChange,
    onDrummerSequencerTrackPadLoopPatternChange,
    onDrummerSequencerPadPress,
    onDrummerSequencerPadCopy,
    onDrummerSequencerRowKeyChange,
    onDrummerSequencerRowKeyPreview,
    onDrummerSequencerRowRemove,
    onDrummerSequencerCellToggle,
    onDrummerSequencerCellVelocityChange,
    onDrummerSequencerCellTimingOffsetChange,
  } = context;
  const editingPads = useAppStore(state => state.sequencerEditingPads);
  const selectEditingPad = useAppStore(state => state.selectSequencerEditingPad);
  const authored = useAppStore(state => state.sequencer);
  const sequencer = sequencerEditingView(playbackSequencer, editingPads);
  useEffect(() => {
    for (const track of [...authored.tracks, ...authored.drummerTracks, ...authored.controllerSequencers]) {
      if (editingPads[track.id] === undefined) selectEditingPad(track.id, track.activePad);
    }
  }, [authored, editingPads, selectEditingPad]);

  const [timingTarget, setTimingTarget] = useState<{ trackId: string; rowId: string; step: number; padIndex: number } | null>(null);
  const [drummerVelocityDragState, setDrummerVelocityDragState] = useState<DrummerVelocityDragState | null>(null);
  const drummerLedDragRef = useRef<{
    pointerId: number;
    trackId: string;
    rowId: string;
    stepIndex: number;
    startY: number;
    startX: number;
    startTiming: number;
    padIndex: number;
    axis: "timing" | "velocity" | null;
    startVelocity: number;
    startedActive: boolean;
    moved: boolean;
  } | null>(null);
  const handleDrummerLedPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      trackId: string,
      rowId: string,
      stepIndex: number,
      active: boolean,
      velocity: number,
      timingOffsetPercent: number,
      padIndex: number
    ) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (!active) {
        onDrummerSequencerCellToggle(trackId, rowId, stepIndex, true);
      }
      drummerLedDragRef.current = {
        pointerId: event.pointerId,
        trackId,
        rowId,
        stepIndex,
        startY: event.clientY,
        startX: event.clientX,
        startTiming: timingOffsetPercent,
        padIndex,
        axis: null,
        startVelocity: Math.max(0, Math.min(127, Math.round(velocity))),
        startedActive: active,
        moved: false
      };
      setDrummerVelocityDragState(null);
    },
    [onDrummerSequencerCellToggle]
  );
  const handleDrummerLedPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = drummerLedDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || sequencer.drummerTracks.find(track => track.id === drag.trackId)?.activePad !== drag.padIndex) {
        return;
      }
      event.preventDefault();
      const deltaY = drag.startY - event.clientY;
      const deltaX = event.clientX - drag.startX;
      if (!drag.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 4) {
        drag.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "timing" : "velocity";
      }
      if (!drag.axis) return;
      drag.moved = true;
      if (drag.axis === "timing") {
        onDrummerSequencerCellTimingOffsetChange?.(drag.trackId, drag.rowId, drag.stepIndex,
          normalizeTimingOffset(drag.startTiming + deltaX));
      } else {
        const nextVelocity = Math.max(0, Math.min(127, drag.startVelocity + Math.round(deltaY)));
        setDrummerVelocityDragState({ trackId: drag.trackId, rowId: drag.rowId, stepIndex: drag.stepIndex, velocity: nextVelocity });
        onDrummerSequencerCellVelocityChange(drag.trackId, drag.rowId, drag.stepIndex, nextVelocity);
      }
    },
    [onDrummerSequencerCellVelocityChange, onDrummerSequencerCellTimingOffsetChange, sequencer.drummerTracks]
  );
  const handleDrummerLedPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = drummerLedDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || sequencer.drummerTracks.find(track => track.id === drag.trackId)?.activePad !== drag.padIndex) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!drag.moved && drag.startedActive) {
        onDrummerSequencerCellToggle(drag.trackId, drag.rowId, drag.stepIndex, false);
      }
      drummerLedDragRef.current = null;
      setDrummerVelocityDragState(null);
    },
    [onDrummerSequencerCellToggle, sequencer.drummerTracks]
  );
  const cancelDrummerLedPointer = useCallback(() => {
    drummerLedDragRef.current = null;
    setDrummerVelocityDragState(null);
  }, []);
  return <>
    <div className="space-y-3">
      {sequencer.drummerTracks.map((track, trackIndex) => {
        const stepIndices = Array.from({ length: track.stepCount }, (_, index) => index);
        const absoluteTransportSubunit = sequencer.isPlaying
          ? sequencerTransportSubunit
          : sequencerAbsoluteTransportStepValue(sequencer) * sequencerTransportSubunitsPerStep();
        const localPlayhead = sequencer.isPlaying && playbackSequencer.drummerTracks.find(t => t.id === track.id)?.activePad !== track.activePad ? -1 : displayedLocalStepFromPlayback(
          track,
          absoluteTransportSubunit,
          sequencer.isPlaying && playbackSequencer.drummerTracks.find(t => t.id === track.id)?.activePad === track.activePad
        );
        const trackIsRunning = sequencer.isPlaying && track.enabled;
        const manualPlayback = trackIsRunning && !track.padLoopEnabled;
        const playingPad = playbackSequencer.drummerTracks.find(t => t.id === track.id)?.activePad;

        return (
          <article
            key={track.id}
            id={`sequencer-${track.id}`}
            className="relative rounded-xl border border-slate-700 bg-slate-900/70 p-2.5 pr-10"
          >
            {onHelpRequest ? (
              <HelpIconButton
                guiLanguage={guiLanguage}
                onClick={() => onHelpRequest("sequencer_drummer_sequencer")}
                className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
              />
            ) : null}

            <div className="mb-2 flex flex-wrap items-center gap-2">
              {renderDeviceName("drummerTracks", track, ui.drummerSequencerWithIndex(trackIndex + 1))}
              <span className={transportStateClass}>{trackStateLabel(track, sequencer.isPlaying, ui)}</span>
              <button
                type="button"
                onClick={() => onDrummerSequencerTrackEnabledChange(track.id, !trackIsRunning)}
                disabled={!instrumentsRunning && !trackIsRunning}
                className={trackIsRunning ? transportStopButtonClass : transportStartButtonClass}
              >
                {trackIsRunning ? ui.stop : ui.start}
              </button>
              <button
                type="button"
                onClick={() => onDrummerSequencerTrackClearSteps(track.id)}
                className="ml-2 rounded-md border border-slate-500/70 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400 hover:bg-slate-700"
              >
                {ui.clearSteps}
              </button>
              <button
                type="button"
                onClick={() => onDrummerSequencerRowAdd(track.id)}
                className="rounded-md border border-rose-400/60 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/20"
              >
                + Key
              </button>
              <button
                type="button"
                onClick={() => onRemoveDrummerSequencerTrack(track.id)}
                disabled={!canRemovePerformDevice}
                className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ui.remove}
              </button>
            </div>

            <div className="mb-2 grid gap-3 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:items-start">
              <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.midiChannel}</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={track.midiChannel}
                  onChange={(event) => onDrummerSequencerTrackChannelChange(track.id, Number(event.target.value))}
                  className={`${controlFieldClass} w-24`}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.meter}</span>
                <div className="flex items-center gap-1">
                  <select
                    value={track.timing.meterNumerator}
                    onChange={(event) =>
                      onDrummerSequencerTrackMeterNumeratorChange(track.id, Number(event.target.value))
                    }
                    className={`${controlFieldClass} w-20`}
                  >
                    {[2, 3, 4, 5, 6, 7].map((value) => (
                      <option key={`${track.id}-drum-meter-numerator-${value}`} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-400">/</span>
                  <select
                    value={track.timing.meterDenominator}
                    onChange={(event) =>
                      onDrummerSequencerTrackMeterDenominatorChange(track.id, Number(event.target.value))
                    }
                    className={`${controlFieldClass} w-20`}
                  >
                    {[4, 8].map((value) => (
                      <option key={`${track.id}-drum-meter-denominator-${value}`} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.grid}</span>
                <select
                  value={track.timing.stepsPerBeat}
                  onChange={(event) =>
                    onDrummerSequencerTrackStepsPerBeatChange(track.id, Number(event.target.value))
                  }
                  className={`${controlFieldClass} w-24`}
                >
                  {[2, 4, 8].map((value) => (
                    <option key={`${track.id}-drum-steps-per-beat-${value}`} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.beatRate}</span>
                <select
                  value={`${track.timing.beatRateNumerator}:${track.timing.beatRateDenominator}`}
                  onChange={(event) => {
                    const beatRate = parseBeatRateValue(event.target.value);
                    if (beatRate) {
                      onDrummerSequencerTrackBeatRateChange(
                        track.id,
                        beatRate.numerator,
                        beatRate.denominator
                      );
                    }
                  }}
                  className={`${controlFieldClass} w-28`}
                >
                  {SEQUENCER_BEAT_RATE_OPTIONS.map((option) => (
                    <option
                      key={`${track.id}-drum-beat-rate-${option.label}`}
                      value={`${option.numerator}:${option.denominator}`}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.beats}</span>
                <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-600 bg-slate-950 p-1">
                  {sequencerPadLengthBeatOptions(track.timing.meterNumerator, track.lengthBeats).map((count) => (
                    <button
                      key={`${track.id}-drum-steps-${count}`}
                      type="button"
                      onClick={() => onDrummerSequencerTrackStepCountChange(track.id, count)}
                      className={`rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${track.lengthBeats === count
                          ? "bg-rose-500/20 text-rose-200"
                          : "text-slate-300 hover:bg-slate-800"
                        }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              </div>
              <div className="min-w-0 space-y-2">
              <PerformanceAuditionControls compact id={track.id} language={guiLanguage} editingPad={track.activePad} playingPad={playbackSequencer.drummerTracks.find(t => t.id === track.id)?.activePad} queuedPad={track.queuedPad} playing={sequencer.isPlaying && track.enabled} item={{ type: "pad", padIndex: track.activePad }} manualLaunch={track.padLoopEnabled ? undefined : () => { onDrummerSequencerPadPress(track.id, track.activePad); if (!sequencer.isPlaying || !track.enabled) onDrummerSequencerTrackEnabledChange(track.id, true); }} />
              <PatternWorkspace track={track} padHasContent={index => drummerPadHasSound(track.pads[index])} language={guiLanguage}
                onSourceChange={enabled => onDrummerSequencerTrackPadLoopEnabledChange(track.id, enabled)}
                onPatternChange={pattern => onDrummerSequencerTrackPadLoopPatternChange(track.id, pattern)} />
              </div>
            </div>

            <div className="mb-2">
              <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">{ui.patternPads}</div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {Array.from({ length: 8 }, (_, padIndex) => {
                  const isActivePad = track.activePad === padIndex;
                  const isQueuedPad = track.queuedPad === padIndex;
                  const padHasContent = drummerPadHasSound(track.pads[padIndex]);
                  return (
                    <div key={`${track.id}-drum-pad-${padIndex}`} className="relative">
                      <button
                        type="button"
                        draggable
                        aria-pressed={isActivePad}
                        onClick={() => {
                          selectEditingPad(track.id, padIndex);
                          if (manualPlayback) onDrummerSequencerPadPress(track.id, padIndex);
                        }}
                        onDragStart={(event) => {
                          const payload = JSON.stringify({ trackId: track.id, padIndex });
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData(SEQUENCER_PAD_DRAG_MIME, payload);
                          event.dataTransfer.setData("text/plain", payload);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const payload = parseSequencerPadDragPayload(event);
                          if (!payload || payload.trackId !== track.id || payload.padIndex === padIndex) {
                            return;
                          }
                          onDrummerSequencerPadCopy(track.id, payload.padIndex, padIndex);
                        }}
                        className={`w-full rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${patternPadClass(manualPlayback ? playingPad === padIndex : isActivePad, isQueuedPad, padHasContent)}`}
                      >
                        #{padIndex + 1}
                      </button>
                      <div className="absolute right-1 top-0.5 z-20">
                        <ArrangerSpeaker id={track.id} item={{ type: "pad", padIndex }} label={`#${padIndex + 1}`} language={guiLanguage} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {timingTarget?.trackId === track.id && timingTarget.padIndex === track.activePad && (() => {
              const cell = track.pads[track.activePad]?.rows.find(row => row.rowId === timingTarget.rowId)?.steps[timingTarget.step];
              const row = track.rows.find(row => row.id === timingTarget.rowId);
              if (!cell || !row) return null;
              const copy = noteTimingCopy[guiLanguage];
              return <div className="flex items-center gap-2 rounded border border-slate-600 p-2" role="group" aria-label={noteTimingCopy[guiLanguage].timing}>
                <span className="text-xs text-slate-300">{copy.key} {row.key} · {copy.step} {timingTarget.step + 1}</span>
                <div className="w-48"><NoteTimingControl value={cell.timingOffsetPercent ?? 0} timing={track.timing} language={guiLanguage}
                  onChange={value => onDrummerSequencerCellTimingOffsetChange?.(track.id, timingTarget.rowId, timingTarget.step, value)} />
                </div>
                <button type="button" onClick={() => setTimingTarget(null)} aria-label={noteTimingCopy[guiLanguage].close}>×</button>
              </div>;
            })()}
            <RetainedScroll owner={`device:${track.id}`} field="grid" className="overflow-x-auto pb-1">
              <div
                className="grid w-full items-center gap-x-1 gap-y-1"
                style={{
                  gridTemplateColumns: `minmax(136px, 136px) repeat(${track.stepCount}, minmax(20px, 1fr))`,
                  minWidth: `${136 + track.stepCount * 21}px`
                }}
              >
                <div className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                  Keys
                </div>
                {stepIndices.map((step) => {
                  const isCurrentStep = track.enabled && sequencer.isPlaying && localPlayhead === step;
                  return (
                    <div
                      key={`${track.id}-drum-header-${step}`}
                      className={`flex h-5 min-w-0 items-center justify-center rounded border font-mono text-[9px] ${isCurrentStep
                          ? "border-emerald-400/80 bg-emerald-400/15 text-emerald-200"
                          : "border-slate-700 bg-slate-950/70 text-slate-400"
                        }`}
                    >
                      {step + 1}
                    </div>
                  );
                })}

                {track.rows.map((row, rowIndex) => {
                  const activePad = track.pads[track.activePad];
                  const padRow = activePad?.rows.find((candidate) => candidate.rowId === row.id) ?? null;
                  return (
                    <Fragment key={`${track.id}-drum-row-${row.id}`}>
                      <div className="flex h-7 items-center gap-0.5 rounded-md border border-slate-700 bg-slate-950/70 px-1">
                        <span className="w-4 text-center font-mono text-[9px] text-slate-500">
                          {rowIndex + 1}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={127}
                          step={1}
                          value={row.key}
                          onChange={(event) => {
                            const raw = event.target.value.trim();
                            if (raw.length === 0) {
                              return;
                            }
                            const nextKey = Number(raw);
                            onDrummerSequencerRowKeyChange(track.id, row.id, nextKey);
                            onDrummerSequencerRowKeyPreview?.(nextKey, track.midiChannel);
                          }}
                          className="w-14 rounded border border-slate-600 bg-slate-950 px-1 py-0.5 text-center font-mono text-[11px] text-slate-100 outline-none ring-accent/40 transition focus:ring"
                          aria-label={`Drum key ${rowIndex + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => onDrummerSequencerRowRemove(track.id, row.id)}
                          disabled={track.rows.length <= 1}
                          className="rounded border border-slate-700 bg-slate-900 px-0.5 py-0.5 text-[9px] text-slate-300 transition hover:border-rose-400 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                          title={ui.remove}
                          aria-label={`${ui.remove} drum key ${rowIndex + 1}`}
                        >
                          x
                        </button>
                      </div>

                      {stepIndices.map((step) => {
                        const cell = padRow?.steps[step] ?? { active: false, velocity: 127 };
                        const isCurrentStep = track.enabled && sequencer.isPlaying && localPlayhead === step;
                        const isVelocityDragTarget =
                          drummerVelocityDragState?.trackId === track.id &&
                          drummerVelocityDragState.rowId === row.id &&
                          drummerVelocityDragState.stepIndex === step;
                        const draggedVelocity = isVelocityDragTarget
                          ? (drummerVelocityDragState?.velocity ?? cell.velocity)
                          : null;
                        const activeAlpha = 0.14 + (Math.max(0, Math.min(127, cell.velocity)) / 127) * 0.86;
                        const ledDotStyle: CSSProperties | undefined = cell.active
                          ? isCurrentStep
                            ? {
                              borderColor: "rgb(74 222 128)",
                              backgroundColor: `rgba(74, 222, 128, ${activeAlpha})`,
                              boxShadow: `0 0 ${4 + activeAlpha * 8}px rgba(74, 222, 128, ${0.35 + activeAlpha * 0.45})`
                            }
                            : {
                              borderColor: "rgb(251 113 133)",
                              backgroundColor: `rgba(251, 113, 133, ${activeAlpha})`,
                              boxShadow: `0 0 ${3 + activeAlpha * 6}px rgba(251, 113, 133, ${0.25 + activeAlpha * 0.35})`
                            }
                          : undefined;
                        const ledDotClass = cell.active
                          ? isCurrentStep
                            ? "h-3 w-3 rounded-full border animate-pulse"
                            : "h-3 w-3 rounded-full border"
                          : "h-3 w-3 rounded-full border border-slate-500 bg-slate-700";

                        return (
                          <button
                            key={`${track.id}-drum-led-${row.id}-${step}`}
                            type="button"
                            onPointerDown={(event) =>
                              handleDrummerLedPointerDown(
                                event,
                                track.id,
                                row.id,
                                step,
                                cell.active,
                                cell.velocity,
                                cell.timingOffsetPercent ?? 0,
                                track.activePad
                              )
                            }
                            onPointerMove={handleDrummerLedPointerMove}
                            onPointerUp={handleDrummerLedPointerEnd}
                            onPointerCancel={cancelDrummerLedPointer}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setTimingTarget({ trackId: track.id, rowId: row.id, step, padIndex: track.activePad });
                            }}
                            onKeyDown={(event) => {
                              if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                                event.preventDefault();
                                setTimingTarget({ trackId: track.id, rowId: row.id, step, padIndex: track.activePad });
                              }
                              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                                event.preventDefault();
                                onDrummerSequencerCellTimingOffsetChange?.(track.id, row.id, step,
                                  normalizeTimingOffset((cell.timingOffsetPercent ?? 0) + (event.key === "ArrowLeft" ? -1 : 1)));
                              }
                              if (event.key === " " || event.key === "Enter") {
                                event.preventDefault();
                                onDrummerSequencerCellToggle(track.id, row.id, step);
                              }
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                if (!cell.active) {
                                  onDrummerSequencerCellToggle(track.id, row.id, step, true);
                                }
                                onDrummerSequencerCellVelocityChange(
                                  track.id,
                                  row.id,
                                  step,
                                  Math.min(127, cell.velocity + 8)
                                );
                              }
                              if (event.key === "ArrowDown") {
                                event.preventDefault();
                                if (!cell.active) {
                                  onDrummerSequencerCellToggle(track.id, row.id, step, true);
                                }
                                onDrummerSequencerCellVelocityChange(
                                  track.id,
                                  row.id,
                                  step,
                                  Math.max(0, cell.velocity - 8)
                                );
                              }
                            }}
                            className={`relative flex h-7 min-w-0 items-center justify-center rounded-md border ${isCurrentStep
                                ? "border-emerald-500/60 bg-emerald-950/10"
                                : "border-slate-700 bg-slate-900/35 hover:bg-slate-800/35"
                              }`}
                            aria-pressed={cell.active}
                            aria-label={`Step ${step + 1}, drum key ${row.key}, velocity ${cell.velocity}, ${timingDescription(cell.timingOffsetPercent ?? 0, track.timing, guiLanguage)}`}
                            title={`${noteTimingCopy[guiLanguage].drumHint} | ${timingDescription(cell.timingOffsetPercent ?? 0, track.timing, guiLanguage)}`}
                          >
                            {draggedVelocity !== null ? (
                              <span className="pointer-events-none absolute -top-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-rose-300/70 bg-slate-950/95 px-2 py-0.5 font-mono text-[10px] text-rose-100 shadow-[0_8px_20px_rgba(2,6,23,0.45)]">
                                {ui.dragVelocity(draggedVelocity)}
                              </span>
                            ) : null}
                            <span className={ledDotClass} style={{ ...ledDotStyle, transform: `translateX(${(cell.timingOffsetPercent ?? 0) * 0.18}px)` }} aria-hidden="true" />
                            {!!cell.timingOffsetPercent && <span className="pointer-events-none absolute bottom-0 right-0 font-mono text-[8px] text-slate-300">{cell.timingOffsetPercent > 0 ? "+" : ""}{cell.timingOffsetPercent}%</span>}
                            <span className="sr-only">{cell.velocity}</span>
                          </button>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </RetainedScroll>
          </article>
        );
      })}
    </div>
  </>;
}

function ControllerSequencersBody({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const {
    sequencer: playbackSequencer,
    onHelpRequest,
    guiLanguage,
    renderDeviceName,
    ui,
    transportStateClass,
    onControllerSequencerEnabledChange,
    instrumentsRunning,
    transportStopButtonClass,
    transportStartButtonClass,
    onControllerSequencerClearSteps,
    onRemoveControllerSequencer,
    canRemovePerformDevice,
    controlLabelClass,
    onControllerSequencerNumberChange,
    onControllerSequencerTargetChannelsChange,
    controlFieldClass,
    onControllerSequencerMeterNumeratorChange,
    onControllerSequencerMeterDenominatorChange,
    onControllerSequencerStepsPerBeatChange,
    onControllerSequencerBeatRateChange,
    onControllerSequencerStepCountChange,
    onControllerSequencerPadLoopEnabledChange,
    onControllerSequencerPadLoopPatternChange,
    onControllerSequencerPadPress,
    onControllerSequencerPadCopy,
    sequencerTransportSubunit,
    onControllerSequencerKeypointAdd,
    onControllerSequencerKeypointChange,
    onControllerSequencerKeypointRemove,
  } = context;
  const editingPads = useAppStore(state => state.sequencerEditingPads);
  const selectEditingPad = useAppStore(state => state.selectSequencerEditingPad);
  const authored = useAppStore(state => state.sequencer);
  const sequencer = sequencerEditingView(playbackSequencer, editingPads);
  useEffect(() => {
    for (const track of [...authored.tracks, ...authored.drummerTracks, ...authored.controllerSequencers]) {
      if (editingPads[track.id] === undefined) selectEditingPad(track.id, track.activePad);
    }
  }, [authored, editingPads, selectEditingPad]);


  return <>
    <div className="space-y-3">
      {sequencer.controllerSequencers.map((controllerSequencer, controllerSequencerIndex) => {
        const controllerSequencerIsRunning = sequencer.isPlaying && controllerSequencer.enabled;
        const manualPlayback = controllerSequencerIsRunning && !controllerSequencer.padLoopEnabled;
        const playingPad = playbackSequencer.controllerSequencers.find(t => t.id === controllerSequencer.id)?.activePad;

        return (
          <article
            key={controllerSequencer.id}
            id={`sequencer-${controllerSequencer.id}`}
            className="relative rounded-xl border border-slate-700 bg-slate-900/70 p-2.5 pr-10"
          >
            {onHelpRequest ? (
              <HelpIconButton
                guiLanguage={guiLanguage}
                onClick={() => onHelpRequest("sequencer_controller_sequencer")}
                className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
              />
            ) : null}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {renderDeviceName("controllerSequencers", controllerSequencer, ui.controllerSequencerWithIndex(controllerSequencerIndex + 1))}
              <span className={transportStateClass}>
                {controllerSequencerIsRunning ? ui.running : ui.stopped}
              </span>
              <button
                type="button"
                onClick={() =>
                  onControllerSequencerEnabledChange(controllerSequencer.id, !controllerSequencerIsRunning)
                }
                disabled={!instrumentsRunning && !controllerSequencerIsRunning}
                className={
                  controllerSequencerIsRunning ? transportStopButtonClass : transportStartButtonClass
                }
              >
                {controllerSequencerIsRunning ? ui.stop : ui.start}
              </button>
              <button
                type="button"
                onClick={() => onControllerSequencerClearSteps(controllerSequencer.id)}
                className="rounded-md border border-slate-500/70 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400 hover:bg-slate-700"
              >
                {ui.clearSteps}
              </button>
              <MidiChannelSelector channels={controllerSequencer.targetChannels} ui={ui}
                onChange={(channels) => onControllerSequencerTargetChannelsChange(controllerSequencer.id, channels)} />
              <button
                type="button"
                onClick={() => onRemoveControllerSequencer(controllerSequencer.id)}
                disabled={!canRemovePerformDevice}
                className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ui.remove}
              </button>
            </div>

            <div className="mb-2 grid gap-3 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
            <div className="flex flex-wrap content-start items-end gap-2">
              <label className="flex min-w-[120px] flex-col gap-1">
                <span className={controlLabelClass}>{ui.controllerNumber}</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={controllerSequencer.controllerNumber}
                  onChange={(event) =>
                    onControllerSequencerNumberChange(controllerSequencer.id, Number(event.target.value))
                  }
                  className={`${controlFieldClass} w-24`}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.meter}</span>
                <div className="flex items-center gap-1">
                  <select
                    value={controllerSequencer.timing.meterNumerator}
                    onChange={(event) =>
                      onControllerSequencerMeterNumeratorChange(
                        controllerSequencer.id,
                        Number(event.target.value)
                      )
                    }
                    className={`${controlFieldClass} w-20`}
                  >
                    {[2, 3, 4, 5, 6, 7].map((value) => (
                      <option key={`${controllerSequencer.id}-meter-numerator-${value}`} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-400">/</span>
                  <select
                    value={controllerSequencer.timing.meterDenominator}
                    onChange={(event) =>
                      onControllerSequencerMeterDenominatorChange(
                        controllerSequencer.id,
                        Number(event.target.value)
                      )
                    }
                    className={`${controlFieldClass} w-20`}
                  >
                    {[4, 8].map((value) => (
                      <option key={`${controllerSequencer.id}-meter-denominator-${value}`} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.grid}</span>
                <select
                  value={controllerSequencer.timing.stepsPerBeat}
                  onChange={(event) =>
                    onControllerSequencerStepsPerBeatChange(
                      controllerSequencer.id,
                      Number(event.target.value)
                    )
                  }
                  className={`${controlFieldClass} w-24`}
                >
                  {[2, 4, 8].map((value) => (
                    <option key={`${controllerSequencer.id}-steps-per-beat-${value}`} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.beatRate}</span>
                <select
                  value={`${controllerSequencer.timing.beatRateNumerator}:${controllerSequencer.timing.beatRateDenominator}`}
                  onChange={(event) => {
                    const beatRate = parseBeatRateValue(event.target.value);
                    if (beatRate) {
                      onControllerSequencerBeatRateChange(
                        controllerSequencer.id,
                        beatRate.numerator,
                        beatRate.denominator
                      );
                    }
                  }}
                  className={`${controlFieldClass} w-28`}
                >
                  {SEQUENCER_BEAT_RATE_OPTIONS.map((option) => (
                    <option
                      key={`${controllerSequencer.id}-beat-rate-${option.label}`}
                      value={`${option.numerator}:${option.denominator}`}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.beats}</span>
                <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-600 bg-slate-950 p-1">
                  {controllerSequencerPadLengthBeatOptions(
                    controllerSequencer.timing.meterNumerator,
                    controllerSequencer.lengthBeats
                  ).map((option) => (
                    <button
                      key={`${controllerSequencer.id}-rate-${option}`}
                      type="button"
                      onClick={() =>
                        onControllerSequencerStepCountChange(controllerSequencer.id, option)
                      }
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${controllerSequencer.lengthBeats === option
                          ? "bg-teal-400/20 text-teal-200"
                          : "text-slate-300 hover:bg-slate-800"
                        }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200">
                CC {controllerSequencer.controllerNumber}
              </div>

            </div>
            <div className="min-w-0 space-y-2">
              <PerformanceAuditionControls compact id={controllerSequencer.id} language={guiLanguage} editingPad={controllerSequencer.activePad} playingPad={playbackSequencer.controllerSequencers.find(t => t.id === controllerSequencer.id)?.activePad} queuedPad={controllerSequencer.queuedPad} playing={sequencer.isPlaying && controllerSequencer.enabled} item={{ type: "pad", padIndex: controllerSequencer.activePad }} manualLaunch={controllerSequencer.padLoopEnabled ? undefined : () => { onControllerSequencerPadPress(controllerSequencer.id, controllerSequencer.activePad); if (!sequencer.isPlaying || !controllerSequencer.enabled) onControllerSequencerEnabledChange(controllerSequencer.id, true); }} />
              <PatternWorkspace track={controllerSequencer} language={guiLanguage}
                padHasContent={index => controllerPadHasContent(controllerSequencer.pads[index])}
                onSourceChange={enabled => onControllerSequencerPadLoopEnabledChange(controllerSequencer.id, enabled)}
                onPatternChange={pattern => onControllerSequencerPadLoopPatternChange(controllerSequencer.id, pattern)} />
            </div>
            </div>

            <div className="mb-2">
              <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">{ui.patternPads}</div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {Array.from({ length: 8 }, (_, padIndex) => {
                  const pad = controllerSequencer.pads[padIndex] ?? null;
                  const isActive = controllerSequencer.activePad === padIndex;
                  const isQueued = controllerSequencer.queuedPad === padIndex;
                  const padHasContent = controllerPadHasContent(pad ?? undefined);
                  return (
                    <div key={`${controllerSequencer.id}-pad-${padIndex}`} className="flex min-w-0 items-stretch gap-1">
                    <button
                      type="button"
                      draggable
                      onClick={() => {
                        selectEditingPad(controllerSequencer.id, padIndex);
                        if (manualPlayback) onControllerSequencerPadPress(controllerSequencer.id, padIndex);
                      }}
                      onDragStart={(event) => {
                        const payload = JSON.stringify({ trackId: controllerSequencer.id, padIndex });
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData(SEQUENCER_PAD_DRAG_MIME, payload);
                        event.dataTransfer.setData("text/plain", payload);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const payload = parseSequencerPadDragPayload(event);
                        if (
                          !payload ||
                          payload.trackId !== controllerSequencer.id ||
                          payload.padIndex === padIndex
                        ) {
                          return;
                        }
                        onControllerSequencerPadCopy(controllerSequencer.id, payload.padIndex, padIndex);
                      }}
                      className={`relative w-full rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${patternPadClass(manualPlayback ? playingPad === padIndex : isActive, isQueued, padHasContent)}`}
                      aria-pressed={isActive}
                      aria-label={`Controller pattern pad #${padIndex + 1}${isQueued ? " queued" : isActive ? " active" : ""}`}
                    >
                      #{padIndex + 1}
                    </button>
                    <ArrangerSpeaker id={controllerSequencer.id} item={{ type: "pad", padIndex }} label={`#${padIndex + 1}`} language={guiLanguage} />
                    </div>
                  );
                })}
              </div>
            </div>

            <ControllerSequencerCurveEditor
              ui={ui}
              controllerSequencer={controllerSequencer}
              playbackTransport={
                sequencer.isPlaying && controllerSequencer.enabled && playbackSequencer.controllerSequencers.find(t => t.id === controllerSequencer.id)?.activePad === controllerSequencer.activePad
                  ? {
                    transportSubunit: sequencerTransportSubunit,
                    transportSubunitDurationMs:
                      sequencerTransportSubunitDurationSeconds(sequencer.timing) * 1000
                  }
                  : null
              }
              onAddPoint={(position, value) =>
                onControllerSequencerKeypointAdd(controllerSequencer.id, position, value)
              }
              onPointChange={(keypointId, position, value) =>
                onControllerSequencerKeypointChange(controllerSequencer.id, keypointId, position, value)
              }
              onPointRemove={(keypointId) =>
                onControllerSequencerKeypointRemove(controllerSequencer.id, keypointId)
              }
            />
          </article>
        );
      })}
    </div>
  </>;
}

function ArpeggiatorsBody({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const { sequencer, guiLanguage, ui, renderDeviceName, onHelpRequest, instrumentBindings, patches,
    canRemovePerformDevice, instrumentsRunning, onArpeggiatorChange, onArpeggiatorEnabledChange,
    onRemoveArpeggiator, onArpeggiatorPresetApply, onArpeggiatorPresetSave, onArpeggiatorCommand } = context;
  return <div className="grid gap-3">{sequencer.arpeggiators.map((arp, index) => <ArpeggiatorEditor
    key={arp.id} arp={arp} language={guiLanguage} ui={ui}
    name={renderDeviceName("arpeggiators", arp, ui.arpeggiatorWithIndex(index + 1))}
    help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_arpeggiator")} /> : null}
    presets={sequencer.arpeggiatorPresets} instruments={instrumentBindings} patches={patches}
    canRemove={canRemovePerformDevice} engineRunning={instrumentsRunning} transportPlaying={sequencer.isPlaying}
    stepsPerBeat={sequencerTransportStepsPerBeat(sequencer.timing)}
    onChange={update => onArpeggiatorChange(arp.id, update)} onEnabled={enabled => onArpeggiatorEnabledChange(arp.id, enabled)}
    onRemove={() => onRemoveArpeggiator(arp.id)} onCommand={command => onArpeggiatorCommand?.(arp.id, command)}
    onPreset={(id, pad) => onArpeggiatorPresetApply(arp.id, id, pad)}
    onSave={(name, pad, update) => onArpeggiatorPresetSave(arp.id, name, pad, update)}
  />)}</div>;
}

function PianoRollsBody({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const {
    sequencer,
    instrumentsRunning,
    ui,
    scaleTypeLabels,
    modeLabels,
    renderDeviceName,
    transportStateClass,
    onPianoRollEnabledChange,
    transportStopButtonClass,
    transportStartButtonClass,
    onRemovePianoRoll,
    canRemovePerformDevice,
    controlLabelClass,
    onPianoRollMidiChannelChange,
    controlFieldClass,
    onPianoRollScaleChange,
    scaleOptions,
    onPianoRollModeChange,
    modeOptions,
    onPianoRollVelocityChange,
    onPianoRollNoteOn,
    onPianoRollNoteOff,
  } = context;
  const runningSequencerTheories = useMemo<RunningSequencerTheory[]>(
    () => {
      const enabledTracks = sequencer.tracks.filter((track) => track.enabled);
      const sourceTracks = enabledTracks.length > 0 ? enabledTracks : sequencer.tracks;
      return sourceTracks.map((track) => ({
        scaleRoot: track.scaleRoot,
        scaleType: track.scaleType,
        mode: track.mode
      }));
    },
    [sequencer.tracks]
  );
  const runningSequencerSummary = useMemo(() => {
    if (runningSequencerTheories.length === 0) {
      return null;
    }

    const first = runningSequencerTheories[0];
    const sharedScale =
      runningSequencerTheories.every(
        (theory) => theory.scaleRoot === first.scaleRoot && theory.scaleType === first.scaleType
      )
        ? { scaleRoot: first.scaleRoot, scaleType: first.scaleType }
        : null;
    const sharedMode = runningSequencerTheories.every((theory) => theory.mode === first.mode)
      ? first.mode
      : null;
    const highlightTheories: PianoRollHighlightTheory[] =
      sharedScale && sharedMode
        ? [{ scaleRoot: sharedScale.scaleRoot, mode: sharedMode }]
        : runningSequencerTheories.map((theory) => ({
          scaleRoot: theory.scaleRoot,
          mode: theory.mode
        }));

    return {
      sharedScale,
      sharedMode,
      highlightTheories
    };
  }, [runningSequencerTheories]);
  return <>
    <div className="space-y-3">
      {sequencer.pianoRolls.map((roll, rollIndex) => {
        const followSummary = instrumentsRunning && roll.enabled ? runningSequencerSummary : null;
        const followsMixedScale = followSummary !== null && followSummary.sharedScale === null;
        const followsMixedMode = followSummary !== null && followSummary.sharedMode === null;
        const effectiveScaleRoot = followSummary?.sharedScale?.scaleRoot ?? roll.scaleRoot;
        const effectiveScaleType = followSummary?.sharedScale?.scaleType ?? roll.scaleType;
        const effectiveScaleValue = followsMixedScale
          ? MIXED_SELECT_VALUE
          : `${effectiveScaleRoot}:${effectiveScaleType}`;
        const effectiveScaleLabel = followsMixedScale
          ? ui.mixed
          : scaleLabelFor(effectiveScaleRoot, effectiveScaleType, scaleTypeLabels);
        const effectiveMode = followSummary?.sharedMode ?? roll.mode;
        const effectiveModeValue = followsMixedMode ? MIXED_SELECT_VALUE : effectiveMode;
        const effectiveModeLabel = followsMixedMode ? ui.mixed : modeLabels[effectiveMode];
        const keyboardHighlightTheories =
          followSummary?.highlightTheories ?? [{ scaleRoot: roll.scaleRoot, mode: roll.mode }];
        return (
          <article key={roll.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {renderDeviceName("pianoRolls", roll, ui.pianoRollWithIndex(rollIndex + 1))}
              <span className={transportStateClass}>{roll.enabled ? ui.running : ui.stopped}</span>
              <button
                type="button"
                onClick={() => onPianoRollEnabledChange(roll.id, !roll.enabled)}
                className={roll.enabled ? transportStopButtonClass : transportStartButtonClass}
              >
                {roll.enabled ? ui.stop : ui.start}
              </button>
              <button
                type="button"
                onClick={() => onRemovePianoRoll(roll.id)}
                disabled={!canRemovePerformDevice}
                className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ui.remove}
              </button>
            </div>

            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.midiChannel}</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={roll.midiChannel}
                  onChange={(event) => onPianoRollMidiChannelChange(roll.id, Number(event.target.value))}
                  className={`${controlFieldClass} w-24`}
                />
              </label>
              <label className="flex min-w-[180px] flex-col gap-1">
                <span className={controlLabelClass}>{ui.scale}</span>
                <select
                  value={effectiveScaleValue}
                  disabled={followSummary !== null}
                  onChange={(event) => {
                    const selected = parseSequencerScaleValue(event.target.value);
                    if (selected) {
                      onPianoRollScaleChange(roll.id, selected.root, selected.type);
                    }
                  }}
                  className={controlFieldClass}
                >
                  {followsMixedScale ? (
                    <option value={MIXED_SELECT_VALUE} disabled>
                      {ui.mixed}
                    </option>
                  ) : null}
                  {scaleOptions.map((option) => (
                    <option key={`${roll.id}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[160px] flex-col gap-1">
                <span className={controlLabelClass}>{ui.mode}</span>
                <select
                  value={effectiveModeValue}
                  disabled={followSummary !== null}
                  onChange={(event) => onPianoRollModeChange(roll.id, event.target.value as SequencerMode)}
                  className={controlFieldClass}
                >
                  {followsMixedMode ? (
                    <option value={MIXED_SELECT_VALUE} disabled>
                      {ui.mixed}
                    </option>
                  ) : null}
                  {modeOptions.map((option) => (
                    <option key={`${roll.id}-mode-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={controlLabelClass}>{ui.velocity}</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={roll.velocity}
                  onChange={(event) => onPianoRollVelocityChange(roll.id, Number(event.target.value))}
                  className={`${controlFieldClass} w-24`}
                />
              </label>
            </div>

            <div className="mb-2 text-[11px] text-slate-500">
              {ui.inScaleHighlightInfo(effectiveScaleLabel, effectiveModeLabel)}
            </div>

            <div className="max-w-full">
              <PianoRollKeyboard
                ui={ui}
                roll={roll}
                instrumentsRunning={instrumentsRunning}
                highlightTheories={keyboardHighlightTheories}
                onNoteOn={onPianoRollNoteOn}
                onNoteOff={onPianoRollNoteOff}
              />
            </div>
          </article>
        );
      })}
    </div>
  </>;
}

function MidiControllersBody({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const {
    sequencer,
    ui,
    renderDeviceName,
    transportStateClass,
    controlLabelClass,
    onMidiControllerNumberChange,
    onMidiControllerTargetChannelsChange,
    controlFieldClass,
    onMidiControllerEnabledChange,
    transportStopButtonClass,
    transportStartButtonClass,
    onRemoveMidiController,
    canRemovePerformDevice,
    onMidiControllerValueChange,
  } = context;

  return <>
    {sequencer.midiControllers.length === 0 ? (
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
        {ui.noControllersHint}
      </div>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {sequencer.midiControllers.map((controller, controllerIndex) => (
          <article key={controller.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-2.5">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col items-start gap-2">
                {renderDeviceName("midiControllers", controller, ui.controllerWithIndex(controllerIndex + 1))}
                <span className={transportStateClass}>{controller.enabled ? ui.running : ui.stopped}</span>
              </div>
              <div className="ml-auto min-w-0 shrink-0">
                <MidiChannelSelector channels={controller.targetChannels} rows={2} ui={ui}
                  onChange={(channels) => onMidiControllerTargetChannelsChange(controller.id, channels)} />
              </div>
            </div>

            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="flex min-w-[120px] flex-col gap-1">
                <span className={controlLabelClass}>{ui.controllerNumber}</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={controller.controllerNumber}
                  onChange={(event) => onMidiControllerNumberChange(controller.id, Number(event.target.value))}
                  className={`${controlFieldClass} w-24`}
                />
              </label>
              <button
                type="button"
                onClick={() => onMidiControllerEnabledChange(controller.id, !controller.enabled)}
                className={controller.enabled ? transportStopButtonClass : transportStartButtonClass}
              >
                {controller.enabled ? ui.stop : ui.start}
              </button>
              <button
                type="button"
                onClick={() => onRemoveMidiController(controller.id)}
                disabled={!canRemovePerformDevice}
                className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ui.remove}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <MidiControllerKnob
                ariaLabel={ui.controllerKnobValue(controller.value)}
                value={controller.value}
                disabled={false}
                onChange={(value) => onMidiControllerValueChange(controller.id, value)}
              />
              <div className="space-y-1">
                <div className={controlLabelClass}>{ui.value}</div>
                <div className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100">
                  {controller.value}
                </div>
                <div className="text-[10px] text-slate-500">{ui.clickDragHint}</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    )}
  </>;
}

function RackSummary({ context }: { context: ReturnType<typeof useSequencerPageContext> }) {
  const { instrumentBindings, ui, rackInstrumentRows, patchById, guiLanguage } = context;
  return (instrumentBindings.length === 0 ? (
    <div className="text-xs text-slate-400">{ui.noInstrumentHint}</div>
  ) : (
    <RetainedScroll owner="rack" field="summaryScroll"
      tabIndex={0}
      role="region"
      aria-label={ui.instrumentRack}
      className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {[...rackInstrumentRows.standard, ...rackInstrumentRows.alwaysOn].map(({ binding }) => {
        const patch = patchById.get(binding.patchId);
        const name = patch?.name ?? `${audioCopy(guiLanguage)("missing")}: ${binding.patchId}`;
        const channel = patch?.always_on ? audioCopy(guiLanguage)("continuous") : `${ui.channel} ${binding.midiChannel}`;
        return (
          <span key={binding.id} title={`${channel} · ${name}`} className="inline-flex shrink-0 items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2 py-1">
            <span className="text-cyan-200">{channel}</span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span className="max-w-56 truncate text-slate-200">{name}</span>
          </span>
        );
      })}
    </RetainedScroll>
  ));
}
