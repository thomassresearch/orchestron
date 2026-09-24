import { PerformanceAuditionContext } from "./components/sequencer/PerformanceAudition";
import { useMidiControllerRouting } from "./hooks/useMidiControllerRouting";
import { normalizeControllerTargetChannels } from "./lib/midiControllerChannels";
import { INITIAL_PANEL_COLLAPSE_STATE, type PanelId } from "./components/CollapsiblePanel";
import { stereoCatalogEntries } from "./lib/stereoCatalog";
import { AuditionPanel } from "./components/AuditionPanel";
import { audioTemplate, type BuiltinTemplate } from "./lib/audioTemplates";
import { audioCopy } from "./lib/audioCopy";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPerformanceEditorStore } from "./components/sequencer/PerformanceEditorState";

import { api } from "./api/client";
import { ConfirmationListDialog } from "./components/ConfirmationListDialog";
import { HelpIconButton } from "./components/HelpIconButton";
import { ImportDialogs } from "./components/ImportDialogs";
import { OpcodeCatalog } from "./components/OpcodeCatalog";
import { PatchToolbar } from "./components/PatchToolbar";
import { type EditorSelection } from "./components/ReteNodeEditor";
import { RuntimePanel } from "./components/RuntimePanel";
import {
  buildPerformanceExportPayload,
  collectPatchImportConflictItems,
  collectPerformanceImportConflictItems,
  extractImportPatchDefinitions,
  hasResolvableImportedPerformance,
  parsePerformanceExportPayload,
  partitionImportConflictItems,
  resolveImportedPerformanceConfig,
  resolvePatchImportOperation,
  resolvePerformanceImportOperation,
  type ExportedPatchDefinition,
  type PerformanceCsdExportRequestPayload
} from "./lib/bundleImportExport";
import { findPatchByName, findPerformanceByName, toPatchListItem } from "./lib/patchCatalog";
import { documentationUiCopy } from "./lib/documentationUi";
import {
  APP_COPY,
  GUI_LANGUAGE_SHORT_LABELS,
  IMPORT_DIALOG_COPY
} from "./lib/appUiCopy";
import { GUI_LANGUAGE_OPTIONS } from "./lib/guiLanguage";
import { validateImportConflictItems } from "./lib/importDialogs";
import { mergedSequencerState } from "./lib/mergedSequencerState";
import {
  absoluteTransportStep as sequencerAbsoluteTransportStep,
  arrangerPlaybackBounds,
  compileArrangerTransportSequence
} from "./lib/arrangerTransport";
import {
  buildSequencerStepChordMidiNotes,
  resolveMidiInputName,
  sequencerTransportSubunitsPerStep,
  sequencerTransportStepsPerBeat
} from "./lib/sequencer";
import { drummerRowRuntimeTrackId } from "./lib/sequencerRuntime";
import { useImportDialogs } from "./hooks/useImportDialogs";
import { useSequencerRuntimeController } from "./hooks/useSequencerRuntimeController";
import { useAppStore } from "./store/useAppStore";
import orchestronIcon from "./assets/orchestron-icon.png";
import {
  MAX_BACKEND_SEQUENCER_NOTE_TRACKS,
  buildSequencerPlaybackRange,
  type DeletePatchDialogState,
  type DeleteSelectionDialogState,
  DeferredModalFallback,
  DeferredPageFallback,
  buildBackendArpeggiatorConfigs,
  buildDrummerRowTrackConfigs,
  buildGraphSelectionDeletePlan,
  applyGraphSelectionDeletePlan,
  enabledForSequencerConfigExport,
  normalizeMidiChannel,
  normalizeMidiVelocity,
  patchCompileSignatureFor,
  pianoRollNoteKey,
  sanitizeCsdFileBaseName,
  sanitizeInstrumentDefinitionFileBaseName,
  sanitizePerformanceFileBaseName,
  transportStepCountFromPerformanceSequencers,
} from "./appOrchestration";
import type {
  HelpDocId,
  PatchGraph,
  SequencerState,
  SessionArpeggiatorConfigRequest,
  SessionSequencerConfigRequest
} from "./types";

const LazyAudioGraphEditor = lazy(() => import("./components/AudioGraphEditor").then((module) => ({ default: module.AudioGraphEditor })));
const LazyConfigPage = lazy(() =>
  import("./components/ConfigPage").then((module) => ({ default: module.ConfigPage }))
);
const LazyHelpDocumentationModal = lazy(() =>
  import("./components/HelpDocumentationModal").then((module) => ({ default: module.HelpDocumentationModal }))
);
const LazyOpcodeDocumentationModal = lazy(() =>
  import("./components/OpcodeDocumentationModal").then((module) => ({ default: module.OpcodeDocumentationModal }))
);
const LazySequencerPage = lazy(() =>
  import("./components/SequencerPage").then((module) => ({ default: module.SequencerPage }))
);


export default function App() {
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);

  const activePage = useAppStore((state) => state.activePage);
  const workspaceGeneration = useAppStore(state => state.performanceWorkspaceGeneration);
  const performanceEditors = useMemo(() => ({ generation: workspaceGeneration, store: createPerformanceEditorStore() }), [workspaceGeneration]);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const guiLanguage = useAppStore((state) => state.guiLanguage);
  const setGuiLanguage = useAppStore((state) => state.setGuiLanguage);
  const browserClockLatencySettings = useAppStore((state) => state.browserClockLatencySettings);
  const setBrowserClockLatencySettings = useAppStore((state) => state.setBrowserClockLatencySettings);
  const appCopy = useMemo(() => APP_COPY[guiLanguage], [guiLanguage]);
  const importDialogCopy = useMemo(() => IMPORT_DIALOG_COPY[guiLanguage], [guiLanguage]);

  const opcodes = useAppStore((state) => state.opcodes);
  const patches = useAppStore((state) => state.patches);
  const performances = useAppStore((state) => state.performances);
  const midiInputs = useAppStore((state) => state.midiInputs);
  const instrumentTabs = useAppStore((state) => state.instrumentTabs);
  const activeInstrumentTabId = useAppStore((state) => state.activeInstrumentTabId);

  const currentPatch = useAppStore((state) => state.currentPatch);
  const sequencerConfig = useAppStore((state) => state.sequencer);
  const sequencerRuntime = useAppStore((state) => state.sequencerRuntime);
  const sequencer = useMemo(
    () => mergedSequencerState(sequencerConfig, sequencerRuntime),
    [sequencerConfig, sequencerRuntime]
  );
  const sequencerInstruments = useAppStore((state) => state.sequencerInstruments);
  const currentPerformanceId = useAppStore((state) => state.currentPerformanceId);
  const performanceName = useAppStore((state) => state.performanceName);
  const performanceDescription = useAppStore((state) => state.performanceDescription);

  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activeSessionState = useAppStore((state) => state.activeSessionState);
  const activeMidiInput = useAppStore((state) => state.activeMidiInput);
  const compileOutput = useAppStore((state) => state.compileOutput);
  const events = useAppStore((state) => state.events);

  const loadBootstrap = useAppStore((state) => state.loadBootstrap);
  const loadPatch = useAppStore((state) => state.loadPatch);
  const refreshPatches = useAppStore((state) => state.refreshPatches);
  const refreshPerformances = useAppStore((state) => state.refreshPerformances);
  const loadPerformance = useAppStore((state) => state.loadPerformance);
  const clearCurrentPerformanceSelection = useAppStore((state) => state.clearCurrentPerformanceSelection);
  const newPerformanceWorkspace = useAppStore((state) => state.newPerformanceWorkspace);
  const addInstrumentTab = useAppStore((state) => state.addInstrumentTab);
  const closeInstrumentTab = useAppStore((state) => state.closeInstrumentTab);
  const setActiveInstrumentTab = useAppStore((state) => state.setActiveInstrumentTab);
  const newPatch = useAppStore((state) => state.newPatch);
  const newPatchFromTemplate = useAppStore((state) => state.newPatchFromTemplate);
  const setCurrentPatchMeta = useAppStore((state) => state.setCurrentPatchMeta);
  const setCurrentPatchTemplate = useAppStore((state) => state.setCurrentPatchTemplate);
  const setCurrentPatchType = useAppStore((state) => state.setCurrentPatchType);
  const setCurrentPerformanceMeta = useAppStore((state) => state.setCurrentPerformanceMeta);
  const setGraph = useAppStore((state) => state.setGraph);
  const addNodeFromOpcode = useAppStore((state) => state.addNodeFromOpcode);
  const saveCurrentPatch = useAppStore((state) => state.saveCurrentPatch);
  const saveCurrentPerformance = useAppStore((state) => state.saveCurrentPerformance);
  const compileSession = useAppStore((state) => state.compileSession);
  const startSession = useAppStore((state) => state.startSession);
  const stopSession = useAppStore((state) => state.stopSession);
  const bindMidiInput = useAppStore((state) => state.bindMidiInput);
  const addSequencerInstrument = useAppStore((state) => state.addSequencerInstrument);
  const removeSequencerInstrument = useAppStore((state) => state.removeSequencerInstrument);
  const updateSequencerInstrumentPatch = useAppStore((state) => state.updateSequencerInstrumentPatch);
  const updateSequencerInstrumentChannel = useAppStore((state) => state.updateSequencerInstrumentChannel);
  const updateSequencerInstrumentLevel = useAppStore((state) => state.updateSequencerInstrumentLevel);
  const updateSequencerInstrumentEffectRoute = useAppStore((state) => state.updateSequencerInstrumentEffectRoute);
  const buildSequencerConfigSnapshot = useAppStore((state) => state.buildSequencerConfigSnapshot);
  const applySequencerConfigSnapshot = useAppStore((state) => state.applySequencerConfigSnapshot);
  const pushEvent = useAppStore((state) => state.pushEvent);

  const setSequencerBpm = useAppStore((state) => state.setSequencerBpm);
  const renamePerformanceDevice = useAppStore((state) => state.renamePerformanceDevice);
  const addSequencerTrack = useAppStore((state) => state.addSequencerTrack);
  const removeSequencerTrack = useAppStore((state) => state.removeSequencerTrack);
  const setSequencerTrackMidiChannel = useAppStore((state) => state.setSequencerTrackMidiChannel);
  const setSequencerTrackSyncTarget = useAppStore((state) => state.setSequencerTrackSyncTarget);
  const setSequencerTrackScale = useAppStore((state) => state.setSequencerTrackScale);
  const setSequencerTrackMode = useAppStore((state) => state.setSequencerTrackMode);
  const setSequencerTrackMeterNumerator = useAppStore((state) => state.setSequencerTrackMeterNumerator);
  const setSequencerTrackMeterDenominator = useAppStore((state) => state.setSequencerTrackMeterDenominator);
  const setSequencerTrackStepsPerBeat = useAppStore((state) => state.setSequencerTrackStepsPerBeat);
  const setSequencerTrackBeatRate = useAppStore((state) => state.setSequencerTrackBeatRate);
  const setSequencerTrackStepNote = useAppStore((state) => state.setSequencerTrackStepNote);
  const setSequencerTrackStepChord = useAppStore((state) => state.setSequencerTrackStepChord);
  const setSequencerTrackStepHold = useAppStore((state) => state.setSequencerTrackStepHold);
  const setSequencerTrackStepVelocity = useAppStore((state) => state.setSequencerTrackStepVelocity);
  const setSequencerTrackStepTimingOffset = useAppStore((state) => state.setSequencerTrackStepTimingOffset);
  const copySequencerTrackStepSettings = useAppStore((state) => state.copySequencerTrackStepSettings);
  const clearSequencerTrackSteps = useAppStore((state) => state.clearSequencerTrackSteps);
  const copySequencerTrackPad = useAppStore((state) => state.copySequencerTrackPad);
  const transposeSequencerTrackPadInScale = useAppStore((state) => state.transposeSequencerTrackPadInScale);
  const transposeSequencerTrackPadDiatonic = useAppStore((state) => state.transposeSequencerTrackPadDiatonic);
  const setSequencerTrackActivePad = useAppStore((state) => state.setSequencerTrackActivePad);
  const setSequencerTrackPadLoopEnabled = useAppStore((state) => state.setSequencerTrackPadLoopEnabled);
  const setSequencerTrackPadLoopRepeat = useAppStore((state) => state.setSequencerTrackPadLoopRepeat);
  const setSequencerTrackPadLoopPattern = useAppStore((state) => state.setSequencerTrackPadLoopPattern);
  const addSequencerTrackPadLoopStep = useAppStore((state) => state.addSequencerTrackPadLoopStep);
  const removeSequencerTrackPadLoopStep = useAppStore((state) => state.removeSequencerTrackPadLoopStep);
  const moveSequencerTrack = useAppStore((state) => state.moveSequencerTrack);
  const addDrummerSequencerTrack = useAppStore((state) => state.addDrummerSequencerTrack);
  const removeDrummerSequencerTrack = useAppStore((state) => state.removeDrummerSequencerTrack);
  const setDrummerSequencerTrackMidiChannel = useAppStore((state) => state.setDrummerSequencerTrackMidiChannel);
  const setDrummerSequencerTrackMeterNumerator = useAppStore((state) => state.setDrummerSequencerTrackMeterNumerator);
  const setDrummerSequencerTrackMeterDenominator = useAppStore((state) => state.setDrummerSequencerTrackMeterDenominator);
  const setDrummerSequencerTrackStepsPerBeat = useAppStore((state) => state.setDrummerSequencerTrackStepsPerBeat);
  const setDrummerSequencerTrackBeatRate = useAppStore((state) => state.setDrummerSequencerTrackBeatRate);
  const setDrummerSequencerTrackStepCount = useAppStore((state) => state.setDrummerSequencerTrackStepCount);
  const addDrummerSequencerRow = useAppStore((state) => state.addDrummerSequencerRow);
  const removeDrummerSequencerRow = useAppStore((state) => state.removeDrummerSequencerRow);
  const setDrummerSequencerRowKey = useAppStore((state) => state.setDrummerSequencerRowKey);
  const toggleDrummerSequencerCell = useAppStore((state) => state.toggleDrummerSequencerCell);
  const setDrummerSequencerCellVelocity = useAppStore((state) => state.setDrummerSequencerCellVelocity);
  const setDrummerSequencerCellTimingOffset = useAppStore((state) => state.setDrummerSequencerCellTimingOffset);
  const clearDrummerSequencerTrackSteps = useAppStore((state) => state.clearDrummerSequencerTrackSteps);
  const copyDrummerSequencerPad = useAppStore((state) => state.copyDrummerSequencerPad);
  const setDrummerSequencerTrackActivePad = useAppStore((state) => state.setDrummerSequencerTrackActivePad);
  const setDrummerSequencerTrackPadLoopEnabled = useAppStore((state) => state.setDrummerSequencerTrackPadLoopEnabled);
  const setDrummerSequencerTrackPadLoopRepeat = useAppStore((state) => state.setDrummerSequencerTrackPadLoopRepeat);
  const setDrummerSequencerTrackPadLoopPattern = useAppStore((state) => state.setDrummerSequencerTrackPadLoopPattern);
  const addDrummerSequencerTrackPadLoopStep = useAppStore((state) => state.addDrummerSequencerTrackPadLoopStep);
  const removeDrummerSequencerTrackPadLoopStep = useAppStore((state) => state.removeDrummerSequencerTrackPadLoopStep);
  const addPianoRoll = useAppStore((state) => state.addPianoRoll);
  const removePianoRoll = useAppStore((state) => state.removePianoRoll);
  const setPianoRollEnabled = useAppStore((state) => state.setPianoRollEnabled);
  const setPianoRollMidiChannel = useAppStore((state) => state.setPianoRollMidiChannel);
  const setPianoRollVelocity = useAppStore((state) => state.setPianoRollVelocity);
  const setPianoRollScale = useAppStore((state) => state.setPianoRollScale);
  const setPianoRollMode = useAppStore((state) => state.setPianoRollMode);
  const addMidiController = useAppStore((state) => state.addMidiController);
  const removeMidiController = useAppStore((state) => state.removeMidiController);
  const addControllerSequencer = useAppStore((state) => state.addControllerSequencer);
  const removeControllerSequencer = useAppStore((state) => state.removeControllerSequencer);
  const setControllerSequencerNumber = useAppStore((state) => state.setControllerSequencerNumber);
  const setControllerSequencerTargetChannels = useAppStore((state) => state.setControllerSequencerTargetChannels);
  const setControllerSequencerActivePad = useAppStore((state) => state.setControllerSequencerActivePad);
  const setControllerSequencerQueuedPad = useAppStore((state) => state.setControllerSequencerQueuedPad);
  const copyControllerSequencerPad = useAppStore((state) => state.copyControllerSequencerPad);
  const clearControllerSequencerSteps = useAppStore((state) => state.clearControllerSequencerSteps);
  const setControllerSequencerPadLoopEnabled = useAppStore((state) => state.setControllerSequencerPadLoopEnabled);
  const setControllerSequencerPadLoopRepeat = useAppStore((state) => state.setControllerSequencerPadLoopRepeat);
  const setControllerSequencerPadLoopPattern = useAppStore((state) => state.setControllerSequencerPadLoopPattern);
  const addControllerSequencerPadLoopStep = useAppStore((state) => state.addControllerSequencerPadLoopStep);
  const removeControllerSequencerPadLoopStep = useAppStore((state) => state.removeControllerSequencerPadLoopStep);
  const setControllerSequencerMeterNumerator = useAppStore((state) => state.setControllerSequencerMeterNumerator);
  const setControllerSequencerMeterDenominator = useAppStore((state) => state.setControllerSequencerMeterDenominator);
  const setControllerSequencerStepsPerBeat = useAppStore((state) => state.setControllerSequencerStepsPerBeat);
  const setControllerSequencerBeatRate = useAppStore((state) => state.setControllerSequencerBeatRate);
  const setControllerSequencerStepCount = useAppStore((state) => state.setControllerSequencerStepCount);
  const addControllerSequencerKeypoint = useAppStore((state) => state.addControllerSequencerKeypoint);
  const setControllerSequencerKeypoint = useAppStore((state) => state.setControllerSequencerKeypoint);
  const setControllerSequencerKeypointValue = useAppStore((state) => state.setControllerSequencerKeypointValue);
  const removeControllerSequencerKeypoint = useAppStore((state) => state.removeControllerSequencerKeypoint);
  const syncControllerSequencerRuntime = useAppStore((state) => state.syncControllerSequencerRuntime);
  const addArpeggiator = useAppStore((state) => state.addArpeggiator);
  const removeArpeggiator = useAppStore((state) => state.removeArpeggiator);
  const setArpeggiatorEnabled = useAppStore((state) => state.setArpeggiatorEnabled);
  const updateArpeggiator = useAppStore((state) => state.updateArpeggiator);
  const applyArpeggiatorPreset = useAppStore((state) => state.applyArpeggiatorPreset);
  const saveArpeggiatorPreset = useAppStore((state) => state.saveArpeggiatorPreset);
  const syncArpeggiatorRuntime = useAppStore((state) => state.syncArpeggiatorRuntime);
  const setSequencerTrackStepCount = useAppStore((state) => state.setSequencerTrackStepCount);
  const setSequencerArrangerLoopSelection = useAppStore((state) => state.setSequencerArrangerLoopSelection);
  const syncSequencerRuntime = useAppStore((state) => state.syncSequencerRuntime);
  const syncSequencerTransportRuntime = useAppStore((state) => state.syncSequencerTransportRuntime);
  const setSequencerPlayhead = useAppStore((state) => state.setSequencerPlayhead);
  const setSequencerTransportAbsoluteStep = useAppStore((state) => state.setSequencerTransportAbsoluteStep);
  const applyEngineConfig = useAppStore((state) => state.applyEngineConfig);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const onGraphChange = useCallback(
    (graph: PatchGraph) => {
      setGraph(graph);
    },
    [setGraph]
  );

  const onExportCsd = useCallback(async () => {
    const compileArtifact = await compileSession();
    if (!compileArtifact) {
      return;
    }

    const fileName = `${sanitizeCsdFileBaseName(currentPatch.name)}.csd`;
    const blob = new Blob([compileArtifact.csd], { type: "application/csound" });
    const downloadUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(downloadUrl);
  }, [compileSession, currentPatch.name]);

  const onOpcodeHelpRequest = useCallback((opcodeName: string) => {
    setActiveOpcodeDocumentation(opcodeName);
  }, []);
  const onHelpRequest = useCallback((helpDocId: HelpDocId) => {
    setActiveHelpDocumentation(helpDocId);
  }, []);

  const instrumentPatchImportInputRef = useRef<HTMLInputElement | null>(null);

  const [selection, setSelection] = useState<EditorSelection>({
    nodeIds: [],
    connections: []
  });
  const [activeHelpDocumentation, setActiveHelpDocumentation] = useState<HelpDocId | null>(null);
  const [activeOpcodeDocumentation, setActiveOpcodeDocumentation] = useState<string | null>(null);
  const [sequencerError, setSequencerError] = useState<string | null>(null);
  const [instrumentPatchIoError, setInstrumentPatchIoError] = useState<string | null>(null);
  const [newFromTemplateDialogOpen, setNewFromTemplateDialogOpen] = useState(false);
  const [selectedTemplatePatchId, setSelectedTemplatePatchId] = useState("");
  const [lastCompiledPatchSignature, setLastCompiledPatchSignature] = useState<string | null>(null);
  const [lastFailedPatchSignature, setLastFailedPatchSignature] = useState<string | null>(null);
  const [runtimePanelCollapsed, setRuntimePanelCollapsed] = useState(true);
  const [collapsedPanels, setCollapsedPanels] = useState(INITIAL_PANEL_COLLAPSE_STATE);
  const setPanelCollapsed = useCallback((panel: PanelId, collapsed: boolean) => {
    setCollapsedPanels((previous) => previous[panel] === collapsed ? previous : { ...previous, [panel]: collapsed });
  }, []);
  const [deleteSelectionDialog, setDeleteSelectionDialog] = useState<DeleteSelectionDialogState | null>(null);
  const [deletePatchDialog, setDeletePatchDialog] = useState<DeletePatchDialogState | null>(null);
  const {
    importSelectionDialog,
    importConflictDialog,
    requestImportSelectionDialog,
    closeImportSelectionDialog,
    requestImportConflictDialog,
    closeImportConflictDialog,
    setImportSelectionOption,
    setImportConflictOverwrite,
    setImportConflictSkip,
    setImportConflictTargetName
  } = useImportDialogs();

  const activeMidiInputName = useMemo(
    () => resolveMidiInputName(activeMidiInput, midiInputs),
    [activeMidiInput, midiInputs]
  );
  const instrumentsRunning = activeSessionState === "running";
  const buildBackendSequencerConfig = useCallback(
    (
      state?: SequencerState,
      mode: "runtime" | "export" = "runtime",
      arrangerActive = useAppStore.getState().sequencerRuntime.arrangerActive ?? false
    ): SessionSequencerConfigRequest => {
      const resolvedState = state ?? useAppStore.getState().sequencer;
      const transportStepCount = transportStepCountFromPerformanceSequencers(
        resolvedState.timing,
        resolvedState.tracks,
        resolvedState.drummerTracks,
        resolvedState.controllerSequencers
      );
      const playbackRange = buildSequencerPlaybackRange(resolvedState, mode, arrangerActive || !!useAppStore.getState().sequencerRuntime.independentSources);
      const exportMode = mode === "export";
      const useRuntimeQueues = !exportMode;
      const melodicTracks = resolvedState.tracks.map((track) => {
        const trackVelocity = 127;
        const transportSequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
        const enabled = enabledForSequencerConfigExport(track, exportMode);
        return {
          track_id: track.id,
          midi_channel: track.midiChannel,
          timing: {
            tempo_bpm: track.timing.tempoBPM,
            meter_numerator: track.timing.meterNumerator,
            meter_denominator: track.timing.meterDenominator,
            steps_per_beat: track.timing.stepsPerBeat,
            beat_rate_numerator: track.timing.beatRateNumerator,
            beat_unit: "meter" as const,
            beat_rate_denominator: track.timing.beatRateDenominator
          },
          scale_root: track.scaleRoot,
          scale_type: track.scaleType,
          mode: track.mode,
          length_beats: track.lengthBeats,
          velocity: trackVelocity,
          gate_ratio: 0.8,
          sync_to_track_id: track.syncToTrackId,
          active_pad: track.activePad,
          queued_pad: useRuntimeQueues ? track.queuedPad : null,
          pad_loop_enabled: track.padLoopEnabled,
          pad_loop_repeat: track.padLoopRepeat,
          pad_loop_sequence: transportSequence,
          enabled,
          queued_enabled: useRuntimeQueues ? track.queuedEnabled : null,
          pads: track.pads.map((pad, padIndex) => ({
            pad_index: padIndex,
            length_beats: pad.lengthBeats,
            scale_root: pad.scaleRoot,
            scale_type: pad.scaleType,
            mode: pad.mode,
            steps: pad.steps.map((step) => {
              const notes = buildSequencerStepChordMidiNotes(step.note, step.chord, pad.scaleRoot, pad.mode);
              return {
                note: notes.length === 0 ? null : notes.length === 1 ? notes[0] : notes,
                hold: step.hold,
                timing_offset_percent: step.timingOffsetPercent ?? 0,
                velocity: normalizeMidiVelocity(step.velocity)
              };
            })
          }))
        };
      });
      const drummerRowTracks = resolvedState.drummerTracks.flatMap((drummerTrack) =>
        buildDrummerRowTrackConfigs(drummerTrack, useRuntimeQueues, exportMode)
      );
      const controllerTracks = resolvedState.controllerSequencers.map((controllerSequencer) => {
        const transportSequence = compileArrangerTransportSequence(
          controllerSequencer.padLoopPattern,
          controllerSequencer.activePad
        );
        const enabled = enabledForSequencerConfigExport(controllerSequencer, exportMode);
        return {
          track_id: controllerSequencer.id,
          controller_number: controllerSequencer.controllerNumber,
          target_channels: normalizeControllerTargetChannels(controllerSequencer.targetChannels),
          timing: {
            tempo_bpm: controllerSequencer.timing.tempoBPM,
            meter_numerator: controllerSequencer.timing.meterNumerator,
            meter_denominator: controllerSequencer.timing.meterDenominator,
            steps_per_beat: controllerSequencer.timing.stepsPerBeat,
            beat_rate_numerator: controllerSequencer.timing.beatRateNumerator,
            beat_unit: "meter" as const,
            beat_rate_denominator: controllerSequencer.timing.beatRateDenominator
          },
          length_beats: controllerSequencer.lengthBeats,
          active_pad: controllerSequencer.activePad,
          queued_pad: useRuntimeQueues ? controllerSequencer.queuedPad : null,
          pad_loop_enabled: controllerSequencer.padLoopEnabled,
          pad_loop_repeat: controllerSequencer.padLoopRepeat,
          pad_loop_sequence: transportSequence,
          enabled,
          pads: controllerSequencer.pads.map((pad, padIndex) => ({
            pad_index: padIndex,
            length_beats: pad.lengthBeats,
            keypoints: pad.keypoints.map((keypoint) => ({
              position: keypoint.position,
              value: keypoint.value
            }))
          }))
        };
      });
      const transportTracks: SessionSequencerConfigRequest["tracks"] =
        melodicTracks.length + drummerRowTracks.length > 0 || controllerTracks.length > 0
          ? [...melodicTracks, ...drummerRowTracks]
          : [
              {
                track_id: "__transport__",
                midi_channel: 1,
                timing: {
                  tempo_bpm: resolvedState.timing.tempoBPM,
                  meter_numerator: resolvedState.timing.meterNumerator,
                  meter_denominator: resolvedState.timing.meterDenominator,
                  steps_per_beat: 8,
                  beat_unit: "meter",
                  beat_rate_numerator: 1,
                  beat_rate_denominator: 1
                },
                scale_root: "C",
                scale_type: "neutral",
                mode: "ionian",
                length_beats: 4,
                velocity: 1,
                gate_ratio: 0.8,
                sync_to_track_id: null,
                active_pad: 0,
                queued_pad: null,
                pad_loop_enabled: true,
                pad_loop_repeat: true,
                pad_loop_sequence: [0],
                enabled: false,
                queued_enabled: null,
                pads: [
                  {
                    pad_index: 0,
                    length_beats: 4,
                    steps: Array.from({ length: transportStepCount }, () => ({ note: null, hold: false, velocity: 1 }))
                  }
                ]
              }
            ];
      if (transportTracks.length > MAX_BACKEND_SEQUENCER_NOTE_TRACKS) {
        throw new Error(
          appCopy.errors.tooManySequencerTracks(
            transportTracks.length,
            MAX_BACKEND_SEQUENCER_NOTE_TRACKS
          )
        );
      }
      return {
        timing: {
          tempo_bpm: resolvedState.timing.tempoBPM,
          meter_numerator: resolvedState.timing.meterNumerator,
          meter_denominator: resolvedState.timing.meterDenominator,
          steps_per_beat: 8,
          beat_unit: "meter",
          beat_rate_numerator: 1,
          beat_rate_denominator: 1
        },
        step_count: transportStepCount,
        ...playbackRange,
        tracks: transportTracks,
        controller_tracks: controllerTracks,
        arpeggiators: buildBackendArpeggiatorConfigs(resolvedState).map((arp, index) => ({
          ...arp, enabled: exportMode && arp.playback_mode === "arranger" ? resolvedState.arpeggiators[index].padLoopEnabled : arp.enabled
        }))
      };
    },
    [appCopy.errors]
  );
  const buildBackendArpeggiatorConfig = useCallback((state?: SequencerState): SessionArpeggiatorConfigRequest => {
    const resolvedState = state ?? useAppStore.getState().sequencer;
    return {
      tempo_bpm: resolvedState.timing.tempoBPM,
      arpeggiators: buildBackendArpeggiatorConfigs(resolvedState)
    };
  }, []);
  const pianoRollNoteSessionRef = useRef(new Map<string, string>());
  const {
    browserAudioError,
    browserAudioDiagnostics,
    browserAudioStatus,
    browserAudioTransport,
    displayedSequencer,
    displayedSequencerTransportSubunit,
    readPlaybackTransportSubunit,
    moveSequencerTransport,
    seekSequencerTransport,
    onApplyBrowserClockLatencySettings,
    primeBrowserClockAudio,
    auditionDevice,
    queueSequencerPadRuntime,
    resolveSequencerSessionId,
    runtimeAudioOutputMode,
    sendAllNotesOff,
    sendDirectMidiEvent,
    sequencerRef,
    transportDevice,
    stopSequencerTransport,
    cancelPendingArpeggiatorEdits,
  } = useSequencerRuntimeController({
    activePage,
    melodicVisualsVisible: !collapsedPanels.melodic,
    drummerVisualsVisible: !collapsedPanels.drummer,
    activeSessionId,
    activeSessionState,
    browserClockLatencySettings,
    buildBackendArpeggiatorConfig,
    buildBackendSequencerConfig,
    errors: appCopy.errors,
    events,
    pushEvent,
    sequencer,
    sequencerConfig,
    sequencerRuntime,
    setBrowserClockLatencySettings,
    setSequencerError,
    setSequencerPlayhead,
    setSequencerTransportAbsoluteStep,
    syncArpeggiatorRuntime,
    syncControllerSequencerRuntime,
    syncSequencerRuntime,
    syncSequencerTransportRuntime
  });

  const currentPatchCompileSignature = useMemo(
    () => patchCompileSignatureFor(currentPatch, activeInstrumentTabId),
    [activeInstrumentTabId, currentPatch]
  );
  const patchCompileBadge = useMemo<"compiled" | "pending" | "errors">(() => {
    if (lastFailedPatchSignature === currentPatchCompileSignature) {
      return "errors";
    }
    if (lastCompiledPatchSignature === currentPatchCompileSignature) {
      return "compiled";
    }
    return "pending";
  }, [currentPatchCompileSignature, lastCompiledPatchSignature, lastFailedPatchSignature]);

  const compileCurrentPatchWithStatus = useCallback(async () => {
    const signature = currentPatchCompileSignature;
    const compileArtifact = await compileSession();
    if (!compileArtifact) {
      setLastFailedPatchSignature(signature);
      return null;
    }

    setLastFailedPatchSignature(null);
    setLastCompiledPatchSignature(signature);
    return compileArtifact;
  }, [compileSession, currentPatchCompileSignature]);

  const onCompileCurrentPatch = useCallback(() => {
    void compileCurrentPatchWithStatus();
  }, [compileCurrentPatchWithStatus]);

  const onSavePatchWithCompileValidation = useCallback(() => {
    void (async () => {


      if (currentPatch.is_template) {
        await saveCurrentPatch();
        return;
      }

      const compileArtifact = await compileCurrentPatchWithStatus();
      if (!compileArtifact) {
        return;
      }

      await saveCurrentPatch();
      const latestState = useAppStore.getState();
      if (latestState.error) {
        return;
      }

      setLastFailedPatchSignature(null);
      setLastCompiledPatchSignature(
        patchCompileSignatureFor(latestState.currentPatch, latestState.activeInstrumentTabId)
      );
    })();
  }, [compileCurrentPatchWithStatus, currentPatch.always_on, currentPatch.graph, currentPatch.is_template, saveCurrentPatch]);

  const onCloneCurrentPatch = useCallback(() => {
    void (async () => {
      try {
        const baseName = currentPatch.name.trim().length > 0 ? currentPatch.name.trim() : "Untitled Patch";
        let cloneName = `${baseName} (copy)`;
        let cloneIndex = 2;
        while (findPatchByName(patches, cloneName)) {
          cloneName = `${baseName} (copy ${cloneIndex})`;
          cloneIndex += 1;
        }

        const cloned = await api.createPatch({
          name: cloneName,
          description: currentPatch.description,
          is_template: currentPatch.is_template,
          always_on: currentPatch.always_on,
          instrument_type: currentPatch.instrument_type,
          schema_version: currentPatch.schema_version,
          graph: currentPatch.graph
        });
        await refreshPatches();
        await loadPatch(cloned.id);
        setInstrumentPatchIoError(null);
      } catch (cloneError) {
        setInstrumentPatchIoError(cloneError instanceof Error ? cloneError.message : "Failed to clone patch.");
      }
    })();
  }, [currentPatch, loadPatch, patches, refreshPatches]);

  const onDeleteCurrentPatch = useCallback(() => {
    if (typeof currentPatch.id !== "string" || currentPatch.id.trim().length === 0) {
      return;
    }
    setDeletePatchDialog({
      patchId: currentPatch.id,
      patchName: currentPatch.name.trim(),
      nodeCount: currentPatch.graph.nodes.length,
      connectionCount: currentPatch.graph.connections.length
    });
  }, [currentPatch.graph.connections.length, currentPatch.graph.nodes.length, currentPatch.id, currentPatch.name]);

  const onCloneCurrentPerformance = useCallback(() => {
    void (async () => {
      try {
        const baseName = performanceName.trim().length > 0 ? performanceName.trim() : "Untitled Performance";
        let cloneName = `${baseName} (copy)`;
        let cloneIndex = 2;
        while (findPerformanceByName(performances, cloneName)) {
          cloneName = `${baseName} (copy ${cloneIndex})`;
          cloneIndex += 1;
        }

        const cloned = await api.createPerformance({
          name: cloneName,
          description: performanceDescription,
          config: buildSequencerConfigSnapshot()
        });
        await refreshPerformances();
        await loadPerformance(cloned.id);
        setSequencerError(null);
      } catch (cloneError) {
        setSequencerError(cloneError instanceof Error ? cloneError.message : "Failed to clone performance.");
      }
    })();
  }, [
    buildSequencerConfigSnapshot,
    loadPerformance,
    performanceDescription,
    performanceName,
    performances,
    refreshPerformances
  ]);

  const onDeleteCurrentPerformance = useCallback(() => {
    if (!currentPerformanceId) {
      return;
    }

    void (async () => {
      try {
        const deletedPerformanceId = currentPerformanceId;
        await api.deletePerformance(deletedPerformanceId);
        const refreshed = await refreshPerformances();
        const nextPerformance = refreshed.find((performance) => performance.id !== deletedPerformanceId) ?? null;
        if (nextPerformance) {
          await loadPerformance(nextPerformance.id);
        } else {
          clearCurrentPerformanceSelection();
        }
        setSequencerError(null);
      } catch (deleteError) {
        setSequencerError(
          deleteError instanceof Error ? deleteError.message : "Failed to delete performance."
        );
      }
    })();
  }, [
    clearCurrentPerformanceSelection,
    currentPerformanceId,
    loadPerformance,
    refreshPerformances
  ]);

  const onNewCurrentPerformance = useCallback(() => {
    void (async () => {
      setSequencerError(null);
      await newPerformanceWorkspace();
    })();
  }, [newPerformanceWorkspace]);

  const onExportInstrumentDefinition = useCallback(() => {
    void (async () => {
      const exportedPatchName = currentPatch.name.trim().length > 0 ? currentPatch.name.trim() : "Untitled Patch";
      const payload: ExportedPatchDefinition = {
        sourcePatchId: currentPatch.id ?? activeInstrumentTabId,
        name: exportedPatchName,
        description: currentPatch.description,
        isTemplate: currentPatch.is_template,
        alwaysOn: currentPatch.always_on,
        instrumentType: currentPatch.instrument_type,
        schema_version: currentPatch.schema_version,
        graph: currentPatch.graph
      };

      const { blob, headers } = await api.exportPatchBundle(payload as unknown as Record<string, unknown>);
      const format = headers.get("x-orchestron-export-format") === "zip" ? "zip" : "json";
      const fileName = `${sanitizeInstrumentDefinitionFileBaseName(exportedPatchName)}.orch.instrument.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setInstrumentPatchIoError(null);
    })().catch((error) => {
      setInstrumentPatchIoError(error instanceof Error ? error.message : "Failed to export instrument definition.");
    });
  }, [activeInstrumentTabId, currentPatch]);

  const triggerInstrumentPatchImport = useCallback(() => {
    instrumentPatchImportInputRef.current?.click();
  }, []);

  const selectedCount = selection.nodeIds.length + selection.connections.length;
  const openInstrumentPatchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of instrumentTabs) {
      if (tab.patch.id) {
        ids.add(tab.patch.id);
      }
    }
    return ids;
  }, [instrumentTabs]);
  const loadableInstrumentPatches = useMemo(
    () => patches.filter((patch) => !openInstrumentPatchIds.has(patch.id)),
    [openInstrumentPatchIds, patches]
  );
  const templatePatches = useMemo(() => [...(["instrument", "drumset", "effect", "output", "empty"] as const).map((kind) => ({ ...audioTemplate(kind), name: audioCopy(guiLanguage)(kind) })), ...patches.filter((patch) => patch.is_template === true)], [patches, guiLanguage]);
  const openNewFromTemplateDialog = useCallback(() => {
    if (templatePatches.length === 0) {
      setInstrumentPatchIoError("no templates available yet");
      return;
    }
    setSelectedTemplatePatchId(templatePatches[0].id);
    setNewFromTemplateDialogOpen(true);
    setInstrumentPatchIoError(null);
  }, [templatePatches]);

  const closeNewFromTemplateDialog = useCallback(() => {
    setNewFromTemplateDialogOpen(false);
  }, []);

  const confirmNewFromTemplate = useCallback(() => {
    void (async () => {
      const templateId = selectedTemplatePatchId || templatePatches[0]?.id;
      if (!templateId) {
        setNewFromTemplateDialogOpen(false);
        setInstrumentPatchIoError("no templates available yet");
        return;
      }

      const template = templateId.startsWith("builtin-") ? audioTemplate(templateId.slice(8) as BuiltinTemplate) : await api.getPatch(templateId);
      newPatchFromTemplate(template);
      setNewFromTemplateDialogOpen(false);
      setInstrumentPatchIoError(null);
    })().catch((error) => {
      setInstrumentPatchIoError(error instanceof Error ? error.message : "Failed to create patch from template.");
    });
  }, [newPatchFromTemplate, selectedTemplatePatchId, templatePatches]);
  const instrumentTabItems = useMemo(
    () =>
      instrumentTabs.map((tab, index) => ({
        id: tab.id,
        title:
          (tab.patch.name.trim().length > 0 ? tab.patch.name : appCopy.instrumentTabTitle(index + 1)) +
          (tab.patch.is_template ? ` ${appCopy.templateToken}` : "")
      })),
    [appCopy, instrumentTabs]
  );
  const editorOpcodes = useMemo(() => [...opcodes, ...stereoCatalogEntries(opcodes, guiLanguage)], [opcodes, guiLanguage]);
  const selectedOpcodeDocumentation = useMemo(
    () => editorOpcodes.find((opcode) => opcode.name === activeOpcodeDocumentation) ?? null,
    [activeOpcodeDocumentation, editorOpcodes]
  );
  const documentationCopy = useMemo(() => documentationUiCopy(guiLanguage), [guiLanguage]);
  const importConflictValidationError = useMemo(() => {
    if (!importConflictDialog) {
      return null;
    }
    return validateImportConflictItems(importConflictDialog.items, patches, performances, importDialogCopy);
  }, [importConflictDialog, importDialogCopy, patches, performances]);

  const onImportInstrumentDefinitionFile = useCallback(
    (file: File) => {
      void (async () => {
        const parsed = await api.expandImportBundle(file);
        const patchDefinitions = extractImportPatchDefinitions(parsed);

        if (patchDefinitions.length === 0) {
          throw new Error("Import file does not contain an instrument definition.");
        }

        let patchCatalog = [...patches];
        let conflictDecisions = collectPatchImportConflictItems(patchDefinitions, patchCatalog);
        if (conflictDecisions.length > 0) {
          const decision = await requestImportConflictDialog(conflictDecisions);
          if (!decision.confirmed) {
            return;
          }
          const validationError = validateImportConflictItems(decision.items, patchCatalog, performances, importDialogCopy);
          if (validationError) {
            throw new Error(validationError);
          }
          conflictDecisions = decision.items;
        }

        const { patchConflictsBySourceId } = partitionImportConflictItems(conflictDecisions);

        let firstImportedPatchId: string | null = null;
        for (const definition of patchDefinitions) {
          const operation = resolvePatchImportOperation(definition, patchCatalog, patchConflictsBySourceId);
          if (operation.type === "skip") {
            continue;
          }

          const importedPatch =
            operation.type === "update"
              ? await api.updatePatch(operation.patchId, operation.payload)
              : await api.createPatch(operation.payload);
          const importedPatchListItem = toPatchListItem(importedPatch);
          patchCatalog =
            operation.type === "update"
              ? patchCatalog.map((patch) => (patch.id === importedPatch.id ? importedPatchListItem : patch))
              : [importedPatchListItem, ...patchCatalog];

          if (!firstImportedPatchId) {
            firstImportedPatchId = importedPatch.id;
          }
        }

        if (patchDefinitions.length > 0) {
          await refreshPatches();
        }
        if (firstImportedPatchId) {
          await loadPatch(firstImportedPatchId);
        }
        setInstrumentPatchIoError(null);
      })().catch((error) => {
        setInstrumentPatchIoError(error instanceof Error ? error.message : "Failed to import instrument definition.");
      });
    },
    [importDialogCopy, loadPatch, patches, performances, refreshPatches, requestImportConflictDialog]
  );

  useEffect(() => {
    if (!activeOpcodeDocumentation) {
      return;
    }
    if (selectedOpcodeDocumentation) {
      return;
    }
    setActiveOpcodeDocumentation(null);
  }, [activeOpcodeDocumentation, selectedOpcodeDocumentation]);

  useEffect(() => {
    setSelection({ nodeIds: [], connections: [] });
  }, [activeInstrumentTabId, currentPatch.id]);

  const onSequencerTrackEnabledChange = useCallback((id: string, enabled: boolean) => {
    void transportDevice(id, enabled);
  }, [transportDevice]);
  const onDrummerSequencerTrackEnabledChange = onSequencerTrackEnabledChange;
  const startArrangerTransportFromUserAction = useCallback(() => {
    void transportDevice(null, true);
  }, [transportDevice]);

  const onDrummerSequencerRowKeyPreview = useCallback(
    (note: number, channel: number) => {
      const sessionId = activeSessionId;
      if (activeSessionState !== "running" || !sessionId) {
        return;
      }

      const normalizedNote = Math.max(0, Math.min(127, Math.round(note)));
      const normalizedChannel = normalizeMidiChannel(channel);
      const noteVelocity = 110;
      void sendDirectMidiEvent(
        { type: "note_on", channel: normalizedChannel, note: normalizedNote, velocity: noteVelocity },
        sessionId
      )
        .then(() => {
          window.setTimeout(() => {
            void sendDirectMidiEvent(
              { type: "note_off", channel: normalizedChannel, note: normalizedNote },
              sessionId
            ).catch(() => undefined);
          }, 140);
        })
        .catch(() => undefined);
    },
    [activeSessionId, activeSessionState, sendDirectMidiEvent]
  );

  const onStartInstrumentEngine = useCallback(() => {
    setSequencerError(null);
    primeBrowserClockAudio();
    void startSession();
  }, [primeBrowserClockAudio, startSession]);

  const collectPerformanceChannels = useCallback(() => {
    const channels = new Set<number>();
    for (const track of sequencerRef.current.tracks) {
      channels.add(track.midiChannel);
    }
    for (const track of sequencerRef.current.drummerTracks) {
      channels.add(track.midiChannel);
    }
    for (const roll of sequencerRef.current.pianoRolls) {
      channels.add(roll.midiChannel);
    }
    for (const arpeggiator of sequencerRef.current.arpeggiators) {
      channels.add(arpeggiator.inputChannel);
      channels.add(arpeggiator.targetChannel);
    }
    for (const instrument of sequencerInstruments) {
      channels.add(instrument.midiChannel);
    }
    return channels;
  }, [sequencerInstruments]);

  const resetArrangerTransportToSelectionStart = useCallback(() => {
    const currentState = sequencerRef.current;
    const { selection } = arrangerPlaybackBounds(currentState);
    const targetAbsoluteStep = selection?.startStep ?? 0;
    if (useAppStore.getState().sequencerRuntime.independentSources) {
      useAppStore.setState(state => ({ sequencerRuntime: { ...state.sequencerRuntime,
        arrangerTransportSubunit: targetAbsoluteStep * sequencerTransportSubunitsPerStep() } }));
    } else setSequencerTransportAbsoluteStep(targetAbsoluteStep);
  }, [setSequencerTransportAbsoluteStep]);

  const stopPerformance = useCallback(
    async (resetTransport: boolean) => {
      if (sequencerRef.current.isPlaying) {
        await stopSequencerTransport(false);
      }
      collectPerformanceChannels().forEach((channel) => {
        sendAllNotesOff(channel);
      });
      pianoRollNoteSessionRef.current.clear();
      if (activeSessionState === "running") {
        await stopSession();
      }
      syncSequencerRuntime({ isPlaying: false });
      if (resetTransport) {
        resetArrangerTransportToSelectionStart();
      }
    },
    [
      activeSessionState,
      collectPerformanceChannels,
      resetArrangerTransportToSelectionStart,
      sendAllNotesOff,
      stopSequencerTransport,
      stopSession,
      syncSequencerRuntime
    ]
  );

  const onStopInstrumentEngine = useCallback(() => {
    setSequencerError(null);
    void stopPerformance(false).catch((error) => {
      setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToStopInstrumentEngine);
    });
  }, [appCopy.errors.failedToStopInstrumentEngine, stopPerformance]);

  const handleArrangerLoopSelectionChange = useCallback(
    (selection: SequencerState["arrangerLoopSelection"], positionStep?: number) => {
      setSequencerArrangerLoopSelection(selection);
      const runtime = useAppStore.getState().sequencerRuntime;
      const currentStep = sequencerAbsoluteTransportStep(runtime.playhead, runtime.cycle, runtime.stepCount);
      const targetStep = positionStep ?? (
        selection && (currentStep < selection.startStep || currentStep >= selection.endStep)
          ? selection.startStep
          : currentStep
      );
      void seekSequencerTransport(targetStep);
    },
    [seekSequencerTransport, setSequencerArrangerLoopSelection]
  );

  const onPianoRollNoteOn = useCallback(
    (rollId: string, note: number, channel: number, velocity: number) => {
      if (activeSessionState !== "running") {
        setSequencerError(appCopy.errors.startInstrumentsBeforePianoRoll);
        return;
      }
      if (!activeSessionId) {
        setSequencerError(appCopy.errors.noActiveInstrumentSession);
        return;
      }

      setSequencerError(null);
      const normalizedChannel = normalizeMidiChannel(channel);
      const normalizedNote = Math.max(0, Math.min(127, Math.round(note)));
      const noteVelocity = normalizeMidiVelocity(velocity);
      const roll = sequencerRef.current.pianoRolls.find((entry) => entry.id === rollId);
      void (async () => {
        await sendDirectMidiEvent(
          {
            type: "note_on",
            channel: normalizedChannel,
            note: normalizedNote,
            velocity: noteVelocity,
            source_id: rollId,
            source_scale_root: roll?.scaleRoot,
            source_scale_type: roll?.scaleType,
            source_mode: roll?.mode
          },
          activeSessionId
        );
        pianoRollNoteSessionRef.current.set(pianoRollNoteKey(normalizedNote, normalizedChannel), activeSessionId);
      })().catch((error) => {
        setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToStartPianoRollNote);
      });
    },
    [
      activeSessionId,
      activeSessionState,
      appCopy.errors.failedToStartPianoRollNote,
      appCopy.errors.noActiveInstrumentSession,
      appCopy.errors.startInstrumentsBeforePianoRoll,
      sendDirectMidiEvent
    ]
  );

  const onPianoRollNoteOff = useCallback(
    (rollId: string, note: number, channel: number) => {
      const normalizedChannel = normalizeMidiChannel(channel);
      const normalizedNote = Math.max(0, Math.min(127, Math.round(note)));
      const noteKey = pianoRollNoteKey(normalizedNote, normalizedChannel);
      const sessionId = pianoRollNoteSessionRef.current.get(noteKey) ?? activeSessionId;
      pianoRollNoteSessionRef.current.delete(noteKey);
      if (!sessionId) {
        return;
      }

      void sendDirectMidiEvent(
        { type: "note_off", channel: normalizedChannel, note: normalizedNote, source_id: rollId },
        sessionId
      ).catch(() => {
        // Ignore transient note-off failures during release.
      });
    },
    [activeSessionId, sendDirectMidiEvent]
  );

  const onPianoRollEnabledChange = useCallback(
    (rollId: string, enabled: boolean) => {
      if (!enabled) {
        const roll = sequencerRef.current.pianoRolls.find((entry) => entry.id === rollId);
        if (roll) {
          sendAllNotesOff(roll.midiChannel);
        }
        pianoRollNoteSessionRef.current.clear();
      }

      setPianoRollEnabled(rollId, enabled);
      setSequencerError(null);
      if (enabled && activeSessionState !== "running") {
        primeBrowserClockAudio();
        void startSession();
      }
    },
    [activeSessionState, primeBrowserClockAudio, sendAllNotesOff, setPianoRollEnabled, startSession]
  );

  const { onMidiControllerEnabledChange, onMidiControllerNumberChange,
    onMidiControllerValueChange, onMidiControllerTargetChannelsChange } = useMidiControllerRouting({
    activeSessionId, activeSessionState, sendDirectMidiEvent, setSequencerError, errors: appCopy.errors
  });

  const buildCurrentPerformanceExport = useCallback(async (purpose: "native" | "csd" = "native") => {
    await useAppStore.getState().flushMixer();
    await useAppStore.getState().flushPerformanceControllers();
    const exportState = structuredClone(useAppStore.getState().sequencer);
    const snapshot = structuredClone(buildSequencerConfigSnapshot());
    // CSD export validates routing after the backend selects device/routing
    // instruments. Native exports still validate the complete saved rack.
    if (purpose === "native") {
      await api.validateAudio(snapshot.instruments.map((b) => ({ id: b.id, patch_id: b.patchId, midi_channel: b.midiChannel, performance_controller_values: b.performanceControllerValues })), snapshot.audioGraph!, snapshot.mixer!);
    }
    const patchIds = [...new Set(snapshot.instruments.map((instrument) => instrument.patchId.trim()).filter(Boolean))];
    const selectedPatches = await Promise.all(patchIds.map((patchId) => api.getPatch(patchId)));
    return { exportState, ...buildPerformanceExportPayload({
      snapshot,
      selectedPatches,
      performanceName,
      performanceDescription
    }) };
  }, [buildSequencerConfigSnapshot, performanceDescription, performanceName]);

  const onExportSequencerConfig = useCallback(async () => {
    try {
      const { exportedPerformanceName, payload } = await buildCurrentPerformanceExport();
      const { blob, headers } = await api.exportPerformanceBundle(payload as unknown as Record<string, unknown>);
      const format = headers.get("x-orchestron-export-format") === "zip" ? "zip" : "json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${sanitizePerformanceFileBaseName(exportedPerformanceName)}.orch.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setSequencerError(null);
    } catch (error) {
      setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToSaveSequencerConfig);
    }
  }, [
    appCopy.errors.failedToSaveSequencerConfig,
    buildCurrentPerformanceExport
  ]);

  const onExportPerformanceCsd = useCallback(async (eventSource: "midiFile" | "score" = "midiFile") => {
    try {
      const { exportedPerformanceName, payload, exportState } = await buildCurrentPerformanceExport("csd");
      const exportPayload: PerformanceCsdExportRequestPayload = {
        performanceExport: payload,
        sequencerConfig: buildBackendSequencerConfig(exportState, "export"),
        eventSource,
        midiControllers: exportState.midiControllers
          .filter((controller) => controller.enabled)
          .map((controller) => ({
            controllerNumber: controller.controllerNumber,
            targetChannels: controller.targetChannels,
            value: controller.value,
            enabled: controller.enabled
          }))
      };
      const { blob } = await api.exportPerformanceCsdBundle(exportPayload as unknown as Record<string, unknown>);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${sanitizePerformanceFileBaseName(exportedPerformanceName)}.csd.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setSequencerError(null);
    } catch (error) {
      setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToExportPerformanceCsd);
    }
  }, [
    appCopy.errors.failedToExportPerformanceCsd,
    buildBackendSequencerConfig,
    buildCurrentPerformanceExport
  ]);

  const onImportSequencerConfig = useCallback(
    (file: File) => {
      void (async () => {
        const parsed = await api.expandImportBundle(file);
        const exported = parsePerformanceExportPayload(parsed);

        if (!exported) {
          applySequencerConfigSnapshot(parsed);
          setSequencerError(null);
          return;
        }

        const selection = await requestImportSelectionDialog(exported.patch_definitions.length > 0);
        if (!selection.confirmed || (!selection.importPerformance && !selection.importPatchDefinitions)) {
          return;
        }

        let patchCatalog = [...patches];
        let performanceCatalog = [...performances];
        const conflictItems = [
          ...(selection.importPatchDefinitions
            ? collectPatchImportConflictItems(exported.patch_definitions, patchCatalog)
            : []),
          ...(selection.importPerformance
            ? collectPerformanceImportConflictItems(exported, performanceCatalog)
            : [])
        ];

        let conflictDecisions = conflictItems;
        if (conflictItems.length > 0) {
          const decision = await requestImportConflictDialog(conflictItems);
          if (!decision.confirmed) {
            return;
          }
          const validationError = validateImportConflictItems(
            decision.items,
            patchCatalog,
            performanceCatalog,
            importDialogCopy
          );
          if (validationError) {
            throw new Error(validationError);
          }
          conflictDecisions = decision.items;
        }

        const { patchConflictsBySourceId, performanceConflict } = partitionImportConflictItems(conflictDecisions);
        const patchIdMap = new Map<string, string>();

        if (selection.importPatchDefinitions) {
          for (const definition of exported.patch_definitions) {
            const operation = resolvePatchImportOperation(definition, patchCatalog, patchConflictsBySourceId);
            if (operation.type === "skip") {
              continue;
            }

            const importedPatch =
              operation.type === "update"
                ? await api.updatePatch(operation.patchId, operation.payload)
                : await api.createPatch(operation.payload);
            const importedPatchListItem = toPatchListItem(importedPatch);
            patchCatalog =
              operation.type === "update"
                ? patchCatalog.map((patch) => (patch.id === importedPatch.id ? importedPatchListItem : patch))
                : [importedPatchListItem, ...patchCatalog];

            patchIdMap.set(definition.sourcePatchId, importedPatch.id);
          }
          if (exported.patch_definitions.length > 0) {
            patchCatalog = await refreshPatches();
          }
        }

        if (selection.importPerformance) {
          const resolvedConfig = resolveImportedPerformanceConfig(exported, patchIdMap, patchCatalog);
          if (!hasResolvableImportedPerformance(resolvedConfig, patchCatalog)) {
            throw new Error(
              "No instrument assignments in this import match available patches. Import patch definitions or create matching patch names first."
            );
          }

          performanceCatalog = await refreshPerformances();
          const operation = resolvePerformanceImportOperation(
            exported,
            performanceCatalog,
            performanceConflict,
            resolvedConfig
          );
          const savedPerformance =
            operation.type === "update"
              ? await api.updatePerformance(operation.performanceId, operation.payload)
              : await api.createPerformance(operation.payload);

          await refreshPerformances();
          await loadPerformance(savedPerformance.id);
        }

        setSequencerError(null);
      })().catch((error) => {
        setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToLoadSequencerConfig);
      });
    },
    [
      appCopy.errors.failedToLoadSequencerConfig,
      applySequencerConfigSnapshot,
      importDialogCopy,
      loadPerformance,
      patches,
      performances,
      refreshPatches,
      refreshPerformances,
      requestImportConflictDialog,
      requestImportSelectionDialog
    ]
  );

  const onControllerSequencerEnabledChange = onSequencerTrackEnabledChange;

  const applyDeleteSelectionPlan = useCallback(
    (plan: DeleteSelectionDialogState) => {
      setGraph(applyGraphSelectionDeletePlan(currentPatch.graph, plan));
    },
    [currentPatch.graph, setGraph]
  );

  const closeDeleteSelectionDialog = useCallback(() => {
    setDeleteSelectionDialog(null);
  }, []);

  const closeDeletePatchDialog = useCallback(() => {
    setDeletePatchDialog(null);
  }, []);

  const confirmDeletePatchDialog = useCallback(() => {
    if (!deletePatchDialog) {
      return;
    }

    const patchId = deletePatchDialog.patchId;
    setDeletePatchDialog(null);

    void (async () => {
      try {
        await api.deletePatch(patchId);
        const refreshed = await refreshPatches();
        const nextPatch = refreshed.find((patch) => patch.id !== patchId) ?? refreshed[0] ?? null;
        setInstrumentPatchIoError(null);
        if (nextPatch) {
          await loadPatch(nextPatch.id);
        } else {
          newPatch();
        }
      } catch (deleteError) {
        setInstrumentPatchIoError(deleteError instanceof Error ? deleteError.message : "Failed to delete patch.");
      }
    })();
  }, [deletePatchDialog, loadPatch, newPatch, refreshPatches]);

  const confirmDeleteSelectionDialog = useCallback(() => {
    if (!deleteSelectionDialog) {
      return;
    }
    applyDeleteSelectionPlan(deleteSelectionDialog);
    setDeleteSelectionDialog(null);
  }, [applyDeleteSelectionPlan, deleteSelectionDialog]);

  const onDeleteSelection = useCallback(() => {
    if (selectedCount === 0) {
      return;
    }

    const plan = buildGraphSelectionDeletePlan(currentPatch.graph, selection, opcodes, appCopy, guiLanguage);
    if (plan.itemLabels.length === 0) {
      return;
    }

    if (plan.itemLabels.length > 1) {
      setDeleteSelectionDialog(plan);
      return;
    }

    applyDeleteSelectionPlan(plan);
  }, [appCopy, applyDeleteSelectionPlan, currentPatch.graph, opcodes, selectedCount, selection, guiLanguage]);

  const instrumentLayoutClassName = runtimePanelCollapsed
    ? "grid h-[68vh] grid-cols-1 gap-3 xl:grid-cols-[280px_1fr]"
    : "grid h-[68vh] grid-cols-1 gap-3 xl:grid-cols-[280px_1fr_340px]";
  const patchCompileBadgeText =
    patchCompileBadge === "compiled"
      ? appCopy.patchCompileStatusCompiled
      : patchCompileBadge === "errors"
        ? appCopy.patchCompileStatusErrors
        : appCopy.patchCompileStatusPending;
  const patchCompileBadgeClass =
    patchCompileBadge === "errors" ? "text-[11px] font-medium text-rose-300" : "text-[11px] font-medium text-orange-300";
  const performableInstrumentPatches = useMemo(() => patches.filter((patch) => patch.is_template !== true), [patches]);
  const sequencerPageData = {
    guiLanguage,
    patches: performableInstrumentPatches,
    performances,
    instrumentBindings: sequencerInstruments,
    sequencer: displayedSequencer,
    sequencerTransportSubunit: displayedSequencerTransportSubunit,
    readPlaybackTransportSubunit,
    currentPerformanceId,
    performanceName,
    performanceDescription,
    instrumentsRunning,
    sessionState: activeSessionState,
    midiInputName: activeMidiInputName,
    transportError: sequencerError
  };
  const sequencerInstrumentActions = {
    onAddInstrument: addSequencerInstrument,
    onRemoveInstrument: removeSequencerInstrument,
    onInstrumentPatchChange: updateSequencerInstrumentPatch,
    onInstrumentChannelChange: updateSequencerInstrumentChannel,
    onInstrumentLevelChange: updateSequencerInstrumentLevel,
    onInstrumentEffectRouteChange: updateSequencerInstrumentEffectRoute,
    onStartInstruments: onStartInstrumentEngine,
    onStopInstruments: onStopInstrumentEngine
  };
  const sequencerPerformanceActions = {
    onRenamePerformanceDevice: renamePerformanceDevice,
    onPerformanceNameChange: (name: string) => setCurrentPerformanceMeta(name, performanceDescription),
    onPerformanceDescriptionChange: (description: string) => setCurrentPerformanceMeta(performanceName, description),
    onNewPerformance: onNewCurrentPerformance,
    onSavePerformance: () => {
      void saveCurrentPerformance();
    },
    onClonePerformance: onCloneCurrentPerformance,
    onDeletePerformance: onDeleteCurrentPerformance,
    onLoadPerformance: (performanceId: string) => {
      void loadPerformance(performanceId);
    },
    onExportConfig: onExportSequencerConfig,
    onExportCsdMidi: () => onExportPerformanceCsd("midiFile"),
    onExportCsdScore: () => onExportPerformanceCsd("score"),
    onImportConfig: onImportSequencerConfig
  };
  const onStopArrangerTransport = useCallback((resetPlayhead: boolean) => {
    cancelPendingArpeggiatorEdits();
    void transportDevice(null, false).then(() => {
      if (resetPlayhead) resetArrangerTransportToSelectionStart();
    });
  }, [cancelPendingArpeggiatorEdits, transportDevice, resetArrangerTransportToSelectionStart]);
  const sequencerTransportActions = {
    onBpmChange: setSequencerBpm,
    onSequencerCycleRewind: () => {
      void moveSequencerTransport(-sequencerTransportStepsPerBeat(sequencer.timing));
    },
    onSequencerCycleForward: () => {
      void moveSequencerTransport(sequencerTransportStepsPerBeat(sequencer.timing));
    },
    onSequencerTransportStart: startArrangerTransportFromUserAction,
    onSequencerTransportStop: onStopArrangerTransport,
    onSequencerArrangerLoopSelectionChange: handleArrangerLoopSelectionChange
  };
  const sequencerMelodicTrackActions = {
    onAddSequencerTrack: addSequencerTrack,
    onRemoveSequencerTrack: removeSequencerTrack,
    onSequencerTrackEnabledChange,
    onSequencerTrackChannelChange: setSequencerTrackMidiChannel,
    onSequencerTrackSyncTargetChange: setSequencerTrackSyncTarget,
    onSequencerTrackScaleChange: setSequencerTrackScale,
    onSequencerTrackModeChange: setSequencerTrackMode,
    onSequencerTrackMeterNumeratorChange: setSequencerTrackMeterNumerator,
    onSequencerTrackMeterDenominatorChange: setSequencerTrackMeterDenominator,
    onSequencerTrackStepsPerBeatChange: setSequencerTrackStepsPerBeat,
    onSequencerTrackBeatRateChange: setSequencerTrackBeatRate,
    onSequencerTrackStepCountChange: setSequencerTrackStepCount,
    onSequencerTrackStepNoteChange: setSequencerTrackStepNote,
    onSequencerTrackStepChordChange: setSequencerTrackStepChord,
    onSequencerTrackStepHoldChange: setSequencerTrackStepHold,
    onSequencerTrackStepVelocityChange: setSequencerTrackStepVelocity,
    onSequencerTrackStepTimingOffsetChange: setSequencerTrackStepTimingOffset,
    onSequencerTrackStepCopy: copySequencerTrackStepSettings,
    onSequencerTrackClearSteps: clearSequencerTrackSteps,
    onSequencerTrackReorder: moveSequencerTrack,
    onSequencerPadPress: (trackId: string, padIndex: number) => {
      const track = sequencerRef.current.tracks.find((candidate) => candidate.id === trackId);
      if (!track) {
        return;
      }
      if (!sequencerRef.current.isPlaying || !track.enabled) {
        setSequencerTrackActivePad(trackId, padIndex);
        return;
      }

      const sessionId = resolveSequencerSessionId();
      if (!sessionId) {
        setSequencerError(appCopy.errors.noActiveSessionForPadSwitching);
        return;
      }

      void queueSequencerPadRuntime(sessionId, trackId, track.activePad === padIndex ? null : padIndex)
        .catch((queueError) => {
          setSequencerError(
            queueError instanceof Error
              ? `${appCopy.errors.failedToQueuePad}: ${queueError.message}`
              : appCopy.errors.failedToQueuePad
          );
        });
    },
    onSequencerPadCopy: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => {
      copySequencerTrackPad(trackId, sourcePadIndex, targetPadIndex);
    },
    onSequencerPadTransposeShort: (trackId: string, padIndex: number, direction: -1 | 1) => {
      transposeSequencerTrackPadInScale(trackId, padIndex, direction);
    },
    onSequencerPadTransposeLong: (trackId: string, padIndex: number, direction: -1 | 1) => {
      transposeSequencerTrackPadDiatonic(trackId, padIndex, direction);
    },
    onSequencerTrackPadLoopEnabledChange: (id: string, enabled: boolean) => {
      const playing = sequencerRef.current.isPlaying && sequencerRef.current.tracks.some(t => t.id === id && t.enabled);
      setSequencerTrackPadLoopEnabled(id, enabled);
      if (playing) void transportDevice(id, true);
    },
    onSequencerTrackPadLoopRepeatChange: setSequencerTrackPadLoopRepeat,
    onSequencerTrackPadLoopPatternChange: setSequencerTrackPadLoopPattern,
    onSequencerTrackPadLoopStepAdd: addSequencerTrackPadLoopStep,
    onSequencerTrackPadLoopStepRemove: removeSequencerTrackPadLoopStep
  };
  const sequencerDrummerTrackActions = {
    onAddDrummerSequencerTrack: addDrummerSequencerTrack,
    onRemoveDrummerSequencerTrack: removeDrummerSequencerTrack,
    onDrummerSequencerTrackEnabledChange,
    onDrummerSequencerTrackChannelChange: setDrummerSequencerTrackMidiChannel,
    onDrummerSequencerTrackMeterNumeratorChange: setDrummerSequencerTrackMeterNumerator,
    onDrummerSequencerTrackMeterDenominatorChange: setDrummerSequencerTrackMeterDenominator,
    onDrummerSequencerTrackStepsPerBeatChange: setDrummerSequencerTrackStepsPerBeat,
    onDrummerSequencerTrackBeatRateChange: setDrummerSequencerTrackBeatRate,
    onDrummerSequencerTrackStepCountChange: setDrummerSequencerTrackStepCount,
    onDrummerSequencerRowAdd: addDrummerSequencerRow,
    onDrummerSequencerRowRemove: removeDrummerSequencerRow,
    onDrummerSequencerRowKeyChange: setDrummerSequencerRowKey,
    onDrummerSequencerRowKeyPreview: onDrummerSequencerRowKeyPreview,
    onDrummerSequencerCellToggle: toggleDrummerSequencerCell,
    onDrummerSequencerCellVelocityChange: setDrummerSequencerCellVelocity,
    onDrummerSequencerCellTimingOffsetChange: setDrummerSequencerCellTimingOffset,
    onDrummerSequencerTrackClearSteps: clearDrummerSequencerTrackSteps,
    onDrummerSequencerPadPress: (trackId: string, padIndex: number) => {
      const drummerTrack = sequencerRef.current.drummerTracks.find((track) => track.id === trackId);
      if (!drummerTrack) {
        return;
      }
      if (!sequencerRef.current.isPlaying || !drummerTrack.enabled) {
        setDrummerSequencerTrackActivePad(trackId, padIndex);
        return;
      }

      const sessionId = resolveSequencerSessionId();
      if (!sessionId) {
        setSequencerError(appCopy.errors.noActiveSessionForPadSwitching);
        return;
      }

      void (async () => {
        for (const row of drummerTrack.rows) {
          await queueSequencerPadRuntime(sessionId, drummerRowRuntimeTrackId(trackId, row.id), drummerTrack.activePad === padIndex ? null : padIndex);
        }
      })().catch((queueError) => {
        setSequencerError(
          queueError instanceof Error
            ? `${appCopy.errors.failedToQueuePad}: ${queueError.message}`
            : appCopy.errors.failedToQueuePad
        );
      });
    },
    onDrummerSequencerPadCopy: (trackId: string, sourcePadIndex: number, targetPadIndex: number) => {
      copyDrummerSequencerPad(trackId, sourcePadIndex, targetPadIndex);
    },
    onDrummerSequencerTrackPadLoopEnabledChange: (id: string, enabled: boolean) => {
      const playing = sequencerRef.current.isPlaying && sequencerRef.current.drummerTracks.some(t => t.id === id && t.enabled);
      setDrummerSequencerTrackPadLoopEnabled(id, enabled);
      if (playing) void transportDevice(id, true);
    },
    onDrummerSequencerTrackPadLoopRepeatChange: setDrummerSequencerTrackPadLoopRepeat,
    onDrummerSequencerTrackPadLoopPatternChange: setDrummerSequencerTrackPadLoopPattern,
    onDrummerSequencerTrackPadLoopStepAdd: addDrummerSequencerTrackPadLoopStep,
    onDrummerSequencerTrackPadLoopStepRemove: removeDrummerSequencerTrackPadLoopStep
  };
  const sequencerPianoRollActions = {
    onAddPianoRoll: addPianoRoll,
    onRemovePianoRoll: removePianoRoll,
    onPianoRollEnabledChange,
    onPianoRollMidiChannelChange: setPianoRollMidiChannel,
    onPianoRollVelocityChange: setPianoRollVelocity,
    onPianoRollScaleChange: setPianoRollScale,
    onPianoRollModeChange: setPianoRollMode,
    onPianoRollNoteOn: onPianoRollNoteOn,
    onPianoRollNoteOff: onPianoRollNoteOff
  };
  const sequencerMidiControllerActions = {
    onAddMidiController: addMidiController,
    onRemoveMidiController: removeMidiController,
    onMidiControllerEnabledChange,
    onMidiControllerTargetChannelsChange,
    onMidiControllerNumberChange: onMidiControllerNumberChange,
    onMidiControllerValueChange: onMidiControllerValueChange
  };
  const sequencerControllerSequencerActions = {
    onAddControllerSequencer: addControllerSequencer,
    onRemoveControllerSequencer: removeControllerSequencer,
    onControllerSequencerEnabledChange,
    onControllerSequencerNumberChange: setControllerSequencerNumber,
    onControllerSequencerTargetChannelsChange: setControllerSequencerTargetChannels,
    onControllerSequencerMeterNumeratorChange: setControllerSequencerMeterNumerator,
    onControllerSequencerMeterDenominatorChange: setControllerSequencerMeterDenominator,
    onControllerSequencerStepsPerBeatChange: setControllerSequencerStepsPerBeat,
    onControllerSequencerBeatRateChange: setControllerSequencerBeatRate,
    onControllerSequencerPadPress: (controllerSequencerId: string, padIndex: number) => {
      const controllerSequencer = sequencerRef.current.controllerSequencers.find(
        (candidate) => candidate.id === controllerSequencerId
      );
      if (!controllerSequencer) {
        return;
      }
      if (!sequencerRef.current.isPlaying || !controllerSequencer.enabled) {
        setControllerSequencerActivePad(controllerSequencerId, padIndex);
        setControllerSequencerQueuedPad(controllerSequencerId, null);
        return;
      }

      const sessionId = resolveSequencerSessionId();
      if (!sessionId) {
        setSequencerError(appCopy.errors.noActiveSessionForPadSwitching);
        return;
      }

      const queuedPad = controllerSequencer.activePad === padIndex ? null : padIndex;
      void queueSequencerPadRuntime(sessionId, controllerSequencerId, queuedPad).catch((queueError) => {
        setSequencerError(
          queueError instanceof Error
            ? `${appCopy.errors.failedToQueuePad}: ${queueError.message}`
            : appCopy.errors.failedToQueuePad
        );
      });
    },
    onControllerSequencerPadCopy: copyControllerSequencerPad,
    onControllerSequencerClearSteps: clearControllerSequencerSteps,
    onControllerSequencerPadLoopEnabledChange: (id: string, enabled: boolean) => {
      const playing = sequencerRef.current.isPlaying && sequencerRef.current.controllerSequencers.some(t => t.id === id && t.enabled);
      setControllerSequencerPadLoopEnabled(id, enabled);
      if (playing) void transportDevice(id, true);
    },
    onControllerSequencerPadLoopRepeatChange: setControllerSequencerPadLoopRepeat,
    onControllerSequencerPadLoopPatternChange: setControllerSequencerPadLoopPattern,
    onControllerSequencerPadLoopStepAdd: addControllerSequencerPadLoopStep,
    onControllerSequencerPadLoopStepRemove: removeControllerSequencerPadLoopStep,
    onControllerSequencerStepCountChange: setControllerSequencerStepCount,
    onControllerSequencerKeypointAdd: addControllerSequencerKeypoint,
    onControllerSequencerKeypointChange: setControllerSequencerKeypoint,
    onControllerSequencerKeypointValueChange: setControllerSequencerKeypointValue,
    onControllerSequencerKeypointRemove: removeControllerSequencerKeypoint
  };
  const sequencerArpeggiatorActions = {
    onAddArpeggiator: addArpeggiator,
    onRemoveArpeggiator: removeArpeggiator,
    onArpeggiatorEnabledChange: (id: string, enabled: boolean) => {
      const arp = useAppStore.getState().sequencer.arpeggiators.find(a => a.id === id);
      if (arp?.playbackMode === "arranger") { void transportDevice(id, enabled); return; }
      setArpeggiatorEnabled(id, enabled);
      if (enabled && arp?.playbackMode === "live" && activeSessionState !== "running") {
        primeBrowserClockAudio();
        void startSession();
      }
    },
    onArpeggiatorCommand: (id: string, command: import("./types").ArpeggiatorCommand) => {
      const sessionId = useAppStore.getState().activeSessionId;
      if (!sessionId || activeSessionState !== "running") {
        if (command.command === "launch" && command.pad_index !== undefined) updateArpeggiator(id, { activePad: command.pad_index });
        return;
      }
      void api.commandArpeggiator(sessionId, id, command).then(statuses => syncArpeggiatorRuntime(statuses.map(status => ({
        arpeggiatorId: status.arpeggiator_id, status, heldNotes: status.held_notes, activeNote: status.active_note,
        stepIndex: status.step_index, lastVelocity: status.last_velocity
      })))).catch(error => setSequencerError(String(error)));
    },
    onArpeggiatorChange: (id: string, update: Partial<import("./types").ArpeggiatorState>) => {
      const current = sequencerRef.current.arpeggiators.find(a => a.id === id);
      updateArpeggiator(id, update);
      if (update.padLoopEnabled !== undefined && current?.playbackMode === "arranger" && current.runtimeStatus?.enabled) void transportDevice(id, true);
    },
    onArpeggiatorPresetApply: applyArpeggiatorPreset,
    onArpeggiatorPresetSave: saveArpeggiatorPreset
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#1e293b,_#020617_60%)] px-4 py-4 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-3">
        <header className="relative flex items-center gap-3 rounded-2xl border-x border-y border-slate-700/70 bg-slate-900/65 px-4 py-0 pr-44">
          <div className="flex flex-1 items-center gap-3">
            <img
              src={orchestronIcon}
              alt={appCopy.appIconAlt}
              className="h-40 w-40 shrink-0 object-contain -my-8"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">{appCopy.appTitle}</h1>
              <p className="text-sm text-slate-400">{appCopy.appDescription}</p>
            </div>
          </div>
          <div className="absolute right-4 top-3 flex flex-col items-end gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{appCopy.guiLanguage}</span>
            <div
              role="group"
              aria-label={appCopy.guiLanguage}
              className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/70 px-2 py-1"
            >
              {GUI_LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGuiLanguage(option.value)}
                  aria-pressed={option.value === guiLanguage}
                  className={`font-body text-xs uppercase tracking-[0.14em] transition focus:outline-none focus-visible:text-slate-100 ${
                    option.value === guiLanguage
                      ? "font-bold text-slate-100"
                      : "font-medium text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {GUI_LANGUAGE_SHORT_LABELS[option.value]}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="inline-flex rounded-xl border border-slate-700 bg-slate-950/80 p-1">
          <button
            type="button"
            onClick={() => setActivePage("instrument")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
              activePage === "instrument" ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {appCopy.instrumentDesign}
          </button>
          <button
            type="button"
            onClick={() => setActivePage("sequencer")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
              activePage === "sequencer" ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {appCopy.perform}
          </button>
          <button
            type="button"
            onClick={() => setActivePage("config")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
              activePage === "config" ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {appCopy.config}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
            {error}
          </div>
        )}
        {activePage === "instrument" && instrumentPatchIoError && (
          <div className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
            {instrumentPatchIoError}
          </div>
        )}

        {activePage === "instrument" && (
          <>
            <div className="relative">
              <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("instrument_patch_toolbar")} />
              <PatchToolbar
                collapsed={collapsedPanels.patchControls}
                onCollapsedChange={(collapsed) => setPanelCollapsed("patchControls", collapsed)}
                guiLanguage={guiLanguage}
                patchName={currentPatch.name}
                patchDescription={currentPatch.description}
                patchIsTemplate={currentPatch.is_template}
                patchInstrumentType={currentPatch.instrument_type}
                patches={loadableInstrumentPatches}
                currentPatchId={currentPatch.id}
                loading={loading}
                tabs={instrumentTabItems}
                activeTabId={activeInstrumentTabId}
                onSelectTab={setActiveInstrumentTab}
                onAddTab={addInstrumentTab}
                onCloseTab={closeInstrumentTab}
                onPatchNameChange={(name) => setCurrentPatchMeta(name, currentPatch.description)}
                onPatchDescriptionChange={(description) => setCurrentPatchMeta(currentPatch.name, description)}
                onPatchTemplateChange={setCurrentPatchTemplate}
                onPatchTypeChange={setCurrentPatchType}
                onSelectPatch={(patchId) => {
                  void loadPatch(patchId);
                }}
                onNewPatch={openNewFromTemplateDialog}
                onNewFromTemplate={openNewFromTemplateDialog}
                onClonePatch={onCloneCurrentPatch}
                onDeletePatch={onDeleteCurrentPatch}
                onSavePatch={() => {
                  onSavePatchWithCompileValidation();
                }}
                onCompile={() => {
                  onCompileCurrentPatch();
                }}
                onExportPatch={() => {
                  onExportInstrumentDefinition();
                }}
                onImportPatch={() => {
                  triggerInstrumentPatchImport();
                }}
                onExportCsd={() => {
                  void onExportCsd();
                }}
              />
              <input
                ref={instrumentPatchImportInputRef}
                type="file"
                accept=".json,.orch.json,.orch.instrument.json,.zip,.orch.zip,.orch.instrument.zip,application/json,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) {
                    return;
                  }
                  onImportInstrumentDefinitionFile(file);
                }}
              />
            </div>

            <main className={instrumentLayoutClassName}>
              <div className="relative h-full min-h-0">
                <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("instrument_opcode_catalog")} />
                <OpcodeCatalog
                  guiLanguage={guiLanguage}
                  opcodes={editorOpcodes}
                  onAddOpcode={addNodeFromOpcode}
                  onOpcodeHelpRequest={onOpcodeHelpRequest}
                />
              </div>

              <section className="relative flex h-full min-h-[440px] flex-col gap-2">
                <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <AuditionPanel stopPerformance={() => stopPerformance(false)} buildConfig={(state) => buildBackendSequencerConfig(state)} />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        {appCopy.graphStats(currentPatch.graph.nodes.length, currentPatch.graph.connections.length)}
                      </div>
                      <div className={patchCompileBadgeClass}>{patchCompileBadgeText}</div>
                    </div>
                    <HelpIconButton
                      guiLanguage={guiLanguage}
                      onClick={() => onHelpRequest("instrument_graph_editor")}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-500 bg-slate-950/90 text-xs font-bold text-slate-100 transition hover:border-accent hover:text-accent"
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                    <div className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                      {appCopy.selectedSummary(selection.nodeIds.length, selection.connections.length)}
                    </div>
                    {runtimePanelCollapsed ? (
                      <button
                        type="button"
                        onClick={() => setRuntimePanelCollapsed(false)}
                        className="rounded-md border border-accent/70 bg-accent/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent transition hover:bg-accent/25"
                        aria-label={appCopy.showRuntimePanel}
                        title={appCopy.showRuntimePanel}
                      >
                        {appCopy.showRuntime}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <Suspense fallback={<DeferredPageFallback />}>
                    <LazyAudioGraphEditor
                      patchId={currentPatch.id}
                      onDeleteAudioGroup={(groupId) => setDeleteSelectionDialog(buildGraphSelectionDeletePlan(currentPatch.graph, { nodeIds: [], connections: [] }, opcodes, appCopy, guiLanguage, [groupId]))}
                      guiLanguage={guiLanguage}
                      graph={currentPatch.graph}
                      graphLabel={currentPatch.name.trim().length > 0 ? currentPatch.name.trim() : "Untitled Patch"}
                      graphBadgeLabel={currentPatch.is_template ? appCopy.templateToken : undefined}
                      opcodes={editorOpcodes}
                      viewportKey={`${activeInstrumentTabId}:${currentPatch.id ?? "draft"}`}
                      onGraphChange={onGraphChange}
                      onSelectionChange={setSelection}
                      onAddOpcodeAtPosition={addNodeFromOpcode}
                      onOpcodeHelpRequest={onOpcodeHelpRequest}
                      opcodeHelpLabel={documentationCopy.showDocumentation}
                      onDeleteSelection={onDeleteSelection}
                      canDeleteSelection={selectedCount > 0}
                    />
                  </Suspense>
                </div>
              </section>

              {!runtimePanelCollapsed ? (
                <div className="relative h-full min-h-0">
                  <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("instrument_runtime_panel")} />
                  <RuntimePanel
                    guiLanguage={guiLanguage}
                    midiInputs={midiInputs}
                    selectedMidiInput={activeMidiInput}
                    compileOutput={compileOutput}
                    events={events}
                    browserAudioTransport={browserAudioTransport}
                    browserAudioStatus={browserAudioTransport !== "off" ? browserAudioStatus : "off"}
                    browserAudioError={browserAudioTransport !== "off" ? browserAudioError : null}
                    browserAudioDiagnostics={browserAudioTransport !== "off" ? browserAudioDiagnostics : null}
                    onBindMidiInput={(midiInput) => {
                      void bindMidiInput(midiInput);
                    }}
                    onToggleCollapse={() => setRuntimePanelCollapsed(true)}
                  />
                </div>
              ) : null}
            </main>
          </>
        )}

        {activePage === "sequencer" && (
          <Suspense fallback={<DeferredPageFallback />}>
            <PerformanceAuditionContext.Provider value={auditionDevice}><LazySequencerPage
              editorStore={performanceEditors.store}
              collapsedPanels={collapsedPanels}
              onPanelCollapsedChange={setPanelCollapsed}
              data={sequencerPageData}
              instrumentActions={sequencerInstrumentActions}
              performanceActions={sequencerPerformanceActions}
              transportActions={sequencerTransportActions}
              melodicTrackActions={sequencerMelodicTrackActions}
              drummerTrackActions={sequencerDrummerTrackActions}
              pianoRollActions={sequencerPianoRollActions}
              midiControllerActions={sequencerMidiControllerActions}
              controllerSequencerActions={sequencerControllerSequencerActions}
              arpeggiatorActions={sequencerArpeggiatorActions}
              onHelpRequest={onHelpRequest}
            /></PerformanceAuditionContext.Provider>
          </Suspense>
        )}

        {activePage === "config" && (
          <Suspense fallback={<DeferredPageFallback />}>
            <LazyConfigPage
              guiLanguage={guiLanguage}
              audioRate={currentPatch.graph.engine_config.sr}
              controlRate={currentPatch.graph.engine_config.control_rate}
              ksmps={currentPatch.graph.engine_config.ksmps}
              softwareBuffer={currentPatch.graph.engine_config.software_buffer}
              hardwareBuffer={currentPatch.graph.engine_config.hardware_buffer}
              showBrowserClockLatencyConfig={runtimeAudioOutputMode === "browser_clock"}
              browserClockLatencySettings={browserClockLatencySettings}
              onHelpRequest={onHelpRequest}
              onApplyEngineConfig={(config) => {
                void applyEngineConfig(config);
              }}
              onApplyBrowserClockLatencySettings={onApplyBrowserClockLatencySettings}
            />
          </Suspense>
        )}
      </div>

      {newFromTemplateDialogOpen && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={closeNewFromTemplateDialog}
        >
          <section
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={appCopy.newFromTemplateDialogTitle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 className="font-display text-lg font-semibold text-slate-100">
              {appCopy.newFromTemplateDialogTitle}
            </h2>
            <p className="mt-1 text-sm text-slate-300">{appCopy.newFromTemplateDialogDescription}</p>
            <label className="mt-4 flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">
                {appCopy.templateSelectLabel}
              </span>
              <select
                className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-body text-sm text-slate-100 outline-none ring-accent/40 transition focus:ring"
                value={
                  selectedTemplatePatchId && templatePatches.some((patch) => patch.id === selectedTemplatePatchId)
                    ? selectedTemplatePatchId
                    : templatePatches[0]?.id ?? ""
                }
                onChange={(event) => setSelectedTemplatePatchId(event.target.value)}
              >
                {templatePatches.map((patch) => (
                  <option key={`template-${patch.id}`} value={patch.id}>
                    {patch.name} {appCopy.templateToken}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeNewFromTemplateDialog}
                className="rounded-md border border-slate-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-300 hover:text-white"
              >
                {appCopy.cancel}
              </button>
              <button
                type="button"
                onClick={confirmNewFromTemplate}
                className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
              >
                {appCopy.createFromTemplate}
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteSelectionDialog && (
        <ConfirmationListDialog
          ariaLabel={appCopy.confirmDeleteSelection(deleteSelectionDialog.itemLabels.length)}
          title={appCopy.confirmDeleteSelection(deleteSelectionDialog.itemLabels.length)}
          description={appCopy.deleteSelectionDialogListLabel}
          items={deleteSelectionDialog.itemLabels}
          cancelLabel={appCopy.cancel}
          confirmLabel="OK"
          onCancel={closeDeleteSelectionDialog}
          onConfirm={confirmDeleteSelectionDialog}
        />
      )}

      {deletePatchDialog && (
        <ConfirmationListDialog
          ariaLabel={appCopy.confirmDeletePatch}
          title={appCopy.confirmDeletePatch}
          description={appCopy.deletePatchDialogListLabel}
          items={[
            appCopy.deletePatchDialogPatchItem(deletePatchDialog.patchName || "(unnamed)"),
            appCopy.deletePatchDialogIdItem(deletePatchDialog.patchId),
            appCopy.deletePatchDialogGraphItem(deletePatchDialog.nodeCount, deletePatchDialog.connectionCount)
          ]}
          cancelLabel={appCopy.cancel}
          confirmLabel={appCopy.deleteAction}
          onCancel={closeDeletePatchDialog}
          onConfirm={confirmDeletePatchDialog}
          maxWidthClassName="max-w-xl"
        />
      )}

      <ImportDialogs
        importDialogCopy={importDialogCopy}
        importSelectionDialog={importSelectionDialog}
        setImportSelectionOption={setImportSelectionOption}
        closeImportSelectionDialog={closeImportSelectionDialog}
        importConflictDialog={importConflictDialog}
        setImportConflictOverwrite={setImportConflictOverwrite}
        setImportConflictSkip={setImportConflictSkip}
        setImportConflictTargetName={setImportConflictTargetName}
        closeImportConflictDialog={closeImportConflictDialog}
        importConflictValidationError={importConflictValidationError}
      />

      {selectedOpcodeDocumentation && (
        <Suspense fallback={<DeferredModalFallback />}>
          <LazyOpcodeDocumentationModal
            opcode={selectedOpcodeDocumentation}
            guiLanguage={guiLanguage}
            onClose={() => setActiveOpcodeDocumentation(null)}
          />
        </Suspense>
      )}

      {activeHelpDocumentation && (
        <Suspense fallback={<DeferredModalFallback />}>
          <LazyHelpDocumentationModal
            helpDocId={activeHelpDocumentation}
            guiLanguage={guiLanguage}
            onClose={() => setActiveHelpDocumentation(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
