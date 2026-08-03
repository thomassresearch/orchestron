import type {
  ArrangerLoopSelection,
  ArpeggiatorState,
  DrummerSequencerStepCount,
  GuiLanguage,
  HelpDocId,
  PadLoopPatternState,
  PatchListItem,
  PerformanceListItem,
  SequencerChord,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState
} from "../../types";

export interface SequencerPageData {
  guiLanguage: GuiLanguage;
  patches: PatchListItem[];
  performances: PerformanceListItem[];
  instrumentBindings: SequencerInstrumentBinding[];
  sequencer: SequencerState;
  sequencerTransportSubunit: number;
  currentPerformanceId: string | null;
  performanceName: string;
  performanceDescription: string;
  instrumentsRunning: boolean;
  sessionState: string;
  midiInputName: string | null;
  transportError: string | null;
}

export interface SequencerPageInstrumentActions {
  onAddInstrument: () => void;
  onRemoveInstrument: (bindingId: string) => void;
  onInstrumentPatchChange: (bindingId: string, patchId: string) => void;
  onInstrumentChannelChange: (bindingId: string, channel: number) => void;
  onInstrumentLevelChange: (bindingId: string, level: number) => void;
  onInstrumentEffectRouteChange: (
    bindingId: string,
    sourceBindingId: string,
    channel: string,
    enabled: boolean
  ) => void;
  onStartInstruments: () => void;
  onStopInstruments: () => void;
}

export interface SequencerPagePerformanceActions {
  onPerformanceNameChange: (value: string) => void;
  onPerformanceDescriptionChange: (value: string) => void;
  onNewPerformance: () => void;
  onSavePerformance: () => void;
  onClonePerformance: () => void;
  onDeletePerformance: () => void;
  onLoadPerformance: (performanceId: string) => void;
  onExportConfig: () => void;
  onExportCsdMidi: () => void;
  onExportCsdScore: () => void;
  onImportConfig: (file: File) => void;
}

export interface SequencerPageTransportActions {
  onBpmChange: (bpm: number) => void;
  onSequencerCycleRewind: () => void;
  onSequencerCycleForward: () => void;
  onSequencerTransportStart: () => void;
  onSequencerTransportStop: (resetPlayhead: boolean) => void;
  onSequencerArrangerLoopSelectionChange: (selection: ArrangerLoopSelection | null) => void;
}

export interface SequencerPageMelodicTrackActions {
  onAddSequencerTrack: () => void;
  onRemoveSequencerTrack: (trackId: string) => void;
  onSequencerTrackEnabledChange: (trackId: string, enabled: boolean) => void;
  onSequencerTrackChannelChange: (trackId: string, channel: number) => void;
  onSequencerTrackSyncTargetChange: (trackId: string, syncToTrackId: string | null) => void;
  onSequencerTrackScaleChange: (trackId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onSequencerTrackModeChange: (trackId: string, mode: SequencerMode) => void;
  onSequencerTrackMeterNumeratorChange: (trackId: string, numerator: number) => void;
  onSequencerTrackMeterDenominatorChange: (trackId: string, denominator: number) => void;
  onSequencerTrackStepsPerBeatChange: (trackId: string, stepsPerBeat: number) => void;
  onSequencerTrackBeatRateChange: (trackId: string, numerator: number, denominator: number) => void;
  onSequencerTrackStepCountChange: (trackId: string, count: number) => void;
  onSequencerTrackStepNoteChange: (trackId: string, index: number, note: number | null) => void;
  onSequencerTrackStepChordChange: (trackId: string, index: number, chord: SequencerChord) => void;
  onSequencerTrackStepHoldChange: (trackId: string, index: number, hold: boolean) => void;
  onSequencerTrackStepVelocityChange: (trackId: string, index: number, velocity: number) => void;
  onSequencerTrackStepCopy: (
    sourceTrackId: string,
    sourceIndex: number,
    targetTrackId: string,
    targetIndex: number
  ) => void;
  onSequencerTrackClearSteps: (trackId: string) => void;
  onSequencerTrackReorder: (sourceTrackId: string, targetTrackId: string, position?: "before" | "after") => void;
  onSequencerPadPress: (trackId: string, padIndex: number) => void;
  onSequencerPadCopy: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  onSequencerPadTransposeShort: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  onSequencerPadTransposeLong: (trackId: string, padIndex: number, direction: -1 | 1) => void;
  onSequencerTrackPadLoopEnabledChange: (trackId: string, enabled: boolean) => void;
  onSequencerTrackPadLoopRepeatChange: (trackId: string, repeat: boolean) => void;
  onSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onSequencerTrackPadLoopStepAdd: (trackId: string, padIndex: number) => void;
  onSequencerTrackPadLoopStepRemove: (trackId: string, sequenceIndex: number) => void;
}

export interface SequencerPageDrummerTrackActions {
  onAddDrummerSequencerTrack: () => void;
  onRemoveDrummerSequencerTrack: (trackId: string) => void;
  onDrummerSequencerTrackEnabledChange: (trackId: string, enabled: boolean) => void;
  onDrummerSequencerTrackChannelChange: (trackId: string, channel: number) => void;
  onDrummerSequencerTrackMeterNumeratorChange: (trackId: string, numerator: number) => void;
  onDrummerSequencerTrackMeterDenominatorChange: (trackId: string, denominator: number) => void;
  onDrummerSequencerTrackStepsPerBeatChange: (trackId: string, stepsPerBeat: number) => void;
  onDrummerSequencerTrackBeatRateChange: (trackId: string, numerator: number, denominator: number) => void;
  onDrummerSequencerTrackStepCountChange: (trackId: string, count: DrummerSequencerStepCount) => void;
  onDrummerSequencerRowAdd: (trackId: string) => void;
  onDrummerSequencerRowRemove: (trackId: string, rowId: string) => void;
  onDrummerSequencerRowKeyChange: (trackId: string, rowId: string, key: number) => void;
  onDrummerSequencerRowKeyPreview?: (key: number, channel: number) => void;
  onDrummerSequencerCellToggle: (trackId: string, rowId: string, stepIndex: number, active?: boolean) => void;
  onDrummerSequencerCellVelocityChange: (trackId: string, rowId: string, stepIndex: number, velocity: number) => void;
  onDrummerSequencerTrackClearSteps: (trackId: string) => void;
  onDrummerSequencerPadPress: (trackId: string, padIndex: number) => void;
  onDrummerSequencerPadCopy: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  onDrummerSequencerTrackPadLoopEnabledChange: (trackId: string, enabled: boolean) => void;
  onDrummerSequencerTrackPadLoopRepeatChange: (trackId: string, repeat: boolean) => void;
  onDrummerSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onDrummerSequencerTrackPadLoopStepAdd: (trackId: string, padIndex: number) => void;
  onDrummerSequencerTrackPadLoopStepRemove: (trackId: string, sequenceIndex: number) => void;
}

export interface SequencerPagePianoRollActions {
  onAddPianoRoll: () => void;
  onRemovePianoRoll: (rollId: string) => void;
  onPianoRollEnabledChange: (rollId: string, enabled: boolean) => void;
  onPianoRollMidiChannelChange: (rollId: string, channel: number) => void;
  onPianoRollVelocityChange: (rollId: string, velocity: number) => void;
  onPianoRollScaleChange: (rollId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  onPianoRollModeChange: (rollId: string, mode: SequencerMode) => void;
  onPianoRollNoteOn: (rollId: string, note: number, channel: number, velocity: number) => void;
  onPianoRollNoteOff: (rollId: string, note: number, channel: number) => void;
}

export interface SequencerPageMidiControllerActions {
  onAddMidiController: () => void;
  onRemoveMidiController: (controllerId: string) => void;
  onMidiControllerEnabledChange: (controllerId: string, enabled: boolean) => void;
  onMidiControllerNumberChange: (controllerId: string, controllerNumber: number) => void;
  onMidiControllerValueChange: (controllerId: string, value: number) => void;
}

export interface SequencerPageControllerSequencerActions {
  onAddControllerSequencer: () => void;
  onRemoveControllerSequencer: (controllerSequencerId: string) => void;
  onControllerSequencerEnabledChange: (controllerSequencerId: string, enabled: boolean) => void;
  onControllerSequencerNumberChange: (controllerSequencerId: string, controllerNumber: number) => void;
  onControllerSequencerMeterNumeratorChange: (controllerSequencerId: string, numerator: number) => void;
  onControllerSequencerMeterDenominatorChange: (controllerSequencerId: string, denominator: number) => void;
  onControllerSequencerStepsPerBeatChange: (controllerSequencerId: string, stepsPerBeat: number) => void;
  onControllerSequencerBeatRateChange: (
    controllerSequencerId: string,
    numerator: number,
    denominator: number
  ) => void;
  onControllerSequencerPadPress: (controllerSequencerId: string, padIndex: number) => void;
  onControllerSequencerPadCopy: (controllerSequencerId: string, sourcePadIndex: number, targetPadIndex: number) => void;
  onControllerSequencerClearSteps: (controllerSequencerId: string) => void;
  onControllerSequencerPadLoopEnabledChange: (controllerSequencerId: string, enabled: boolean) => void;
  onControllerSequencerPadLoopRepeatChange: (controllerSequencerId: string, repeat: boolean) => void;
  onControllerSequencerPadLoopPatternChange: (
    controllerSequencerId: string,
    pattern: PadLoopPatternState
  ) => void;
  onControllerSequencerPadLoopStepAdd: (controllerSequencerId: string, padIndex: number) => void;
  onControllerSequencerPadLoopStepRemove: (controllerSequencerId: string, sequenceIndex: number) => void;
  onControllerSequencerStepCountChange: (controllerSequencerId: string, stepCount: number) => void;
  onControllerSequencerKeypointAdd: (controllerSequencerId: string, position: number, value: number) => void;
  onControllerSequencerKeypointChange: (
    controllerSequencerId: string,
    keypointId: string,
    position: number,
    value: number
  ) => void;
  onControllerSequencerKeypointValueChange: (
    controllerSequencerId: string,
    keypointId: string,
    value: number
  ) => void;
  onControllerSequencerKeypointRemove: (controllerSequencerId: string, keypointId: string) => void;
}

export interface SequencerPageArpeggiatorActions {
  onAddArpeggiator: () => void;
  onRemoveArpeggiator: (arpeggiatorId: string) => void;
  onArpeggiatorEnabledChange: (arpeggiatorId: string, enabled: boolean) => void;
  onArpeggiatorChange: (arpeggiatorId: string, update: Partial<ArpeggiatorState>) => void;
  onArpeggiatorPresetApply: (arpeggiatorId: string, presetId: string) => void;
  onArpeggiatorPresetSave: (arpeggiatorId: string, presetName: string) => void;
}

export interface SequencerPageProps {
  data: SequencerPageData;
  instrumentActions: SequencerPageInstrumentActions;
  performanceActions: SequencerPagePerformanceActions;
  transportActions: SequencerPageTransportActions;
  melodicTrackActions: SequencerPageMelodicTrackActions;
  drummerTrackActions: SequencerPageDrummerTrackActions;
  pianoRollActions: SequencerPagePianoRollActions;
  midiControllerActions: SequencerPageMidiControllerActions;
  controllerSequencerActions: SequencerPageControllerSequencerActions;
  arpeggiatorActions: SequencerPageArpeggiatorActions;
  onHelpRequest?: (helpDocId: HelpDocId) => void;
}

