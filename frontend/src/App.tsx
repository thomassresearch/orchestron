import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "./api/client";
import { HelpIconButton } from "./components/HelpIconButton";
import { ImportDialogs } from "./components/ImportDialogs";
import { OpcodeCatalog } from "./components/OpcodeCatalog";
import { PatchToolbar } from "./components/PatchToolbar";
import { ReteNodeEditor, type EditorSelection } from "./components/ReteNodeEditor";
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
import { GUI_LANGUAGE_OPTIONS } from "./lib/guiLanguage";
import type { ImportDialogCopy } from "./lib/importDialogs";
import { validateImportConflictItems } from "./lib/importDialogs";
import {
  absoluteTransportStep as sequencerAbsoluteTransportStep,
  arrangerTransportExtent,
  arrangerPlaybackBounds,
  clampArrangerSeekStep,
  compileArrangerTransportSequence
} from "./lib/arrangerTransport";
import {
  buildSequencerStepChordMidiNotes,
  resolveMidiInputName,
  sequencerTransportStepsPerBeat
} from "./lib/sequencer";
import { drummerRowRuntimeTrackId } from "./lib/sequencerRuntime";
import { useImportDialogs } from "./hooks/useImportDialogs";
import { useSequencerRuntimeController } from "./hooks/useSequencerRuntimeController";
import { useAppStore } from "./store/useAppStore";
import orchestronIcon from "./assets/orchestron-icon.png";
import type {
  Connection,
  DrummerSequencerTrackState,
  GuiLanguage,
  HelpDocId,
  OpcodeSpec,
  PatchGraph,
  SequencerConfigSnapshot,
  SequencerInstrumentBinding,
  SequencerRuntimeState,
  SequencerState,
  SessionSequencerConfigRequest
} from "./types";

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

function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

function pianoRollNoteKey(note: number, channel: number): string {
  return `${channel}:${note}`;
}

function normalizeMidiChannel(channel: number): number {
  return Math.max(1, Math.min(16, Math.round(channel)));
}

function normalizeMidiVelocity(velocity: number): number {
  return Math.max(0, Math.min(127, Math.round(velocity)));
}

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function DeferredPageFallback() {
  return (
    <section
      className="min-h-[480px] rounded-2xl border border-slate-700/70 bg-slate-900/70"
      aria-busy="true"
      aria-live="polite"
    />
  );
}

function DeferredModalFallback() {
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 p-4" aria-busy="true" />
  );
}

function mergedSequencerState(
  sequencerConfig: SequencerState,
  sequencerRuntime: SequencerRuntimeState
): SequencerState {
  const runtimeStepCount = Math.max(1, Math.round(sequencerRuntime.stepCount));
  const runtimePlayhead = ((Math.round(sequencerRuntime.playhead) % runtimeStepCount) + runtimeStepCount) % runtimeStepCount;
  const runtimeCycle = Math.max(0, Math.round(sequencerRuntime.cycle));

  let trackRuntimeChanged = false;
  const tracks = sequencerConfig.tracks.map((track) => {
    const runtimeRecord = sequencerRuntime.trackLocalStepById as Record<string, unknown>;
    const runtimeValue = hasOwnRecordKey(runtimeRecord, track.id)
      ? sequencerRuntime.trackLocalStepById[track.id]
      : track.runtimeLocalStep;
    const runtimeLocalStep =
      typeof runtimeValue === "number" && Number.isFinite(runtimeValue) ? Math.max(0, Math.round(runtimeValue)) : null;
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
  const drummerTracks = sequencerConfig.drummerTracks.map((track) => {
    const runtimeRecord = sequencerRuntime.drummerTrackLocalStepById as Record<string, unknown>;
    const runtimeValue = hasOwnRecordKey(runtimeRecord, track.id)
      ? sequencerRuntime.drummerTrackLocalStepById[track.id]
      : track.runtimeLocalStep;
    const runtimeLocalStep =
      typeof runtimeValue === "number" && Number.isFinite(runtimeValue) ? Math.max(0, Math.round(runtimeValue)) : null;
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
  const controllerSequencers = sequencerConfig.controllerSequencers.map((controllerSequencer) => {
    const runtimeRecord = sequencerRuntime.controllerRuntimePadStartSubunitById as Record<string, unknown>;
    const runtimeValue = hasOwnRecordKey(runtimeRecord, controllerSequencer.id)
      ? sequencerRuntime.controllerRuntimePadStartSubunitById[controllerSequencer.id]
      : controllerSequencer.runtimePadStartSubunit;
    const runtimePadStartSubunit =
      typeof runtimeValue === "number" && Number.isFinite(runtimeValue) ? Math.max(0, Math.floor(runtimeValue)) : null;
    if (runtimePadStartSubunit === controllerSequencer.runtimePadStartSubunit) {
      return controllerSequencer;
    }
    controllerRuntimeChanged = true;
    return {
      ...controllerSequencer,
      runtimePadStartSubunit
    };
  });

  if (
    sequencerConfig.isPlaying === sequencerRuntime.isPlaying &&
    sequencerConfig.stepCount === runtimeStepCount &&
    sequencerConfig.playhead === runtimePlayhead &&
    sequencerConfig.cycle === runtimeCycle &&
    !trackRuntimeChanged &&
    !drummerRuntimeChanged &&
    !controllerRuntimeChanged
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
    controllerSequencers: controllerRuntimeChanged ? controllerSequencers : sequencerConfig.controllerSequencers
  };
}

function normalizeInstrumentLevel(level: number): number {
  return Math.max(1, Math.min(10, Math.round(level)));
}

function instrumentLevelByChannel(bindings: SequencerInstrumentBinding[]): Map<number, number> {
  const levelMap = new Map<number, number>();
  for (const binding of bindings) {
    const channel = normalizeMidiChannel(binding.midiChannel);
    levelMap.set(channel, normalizeInstrumentLevel(binding.level));
  }
  return levelMap;
}

function levelForChannel(channel: number, levelMap: Map<number, number>): number {
  const level = levelMap.get(normalizeMidiChannel(channel));
  return level === undefined ? 10 : normalizeInstrumentLevel(level);
}

function scaleVelocityForChannel(velocity: number, channel: number, levelMap: Map<number, number>): number {
  const normalizedVelocity = normalizeMidiVelocity(velocity);
  const level = levelForChannel(channel, levelMap);
  return normalizeMidiVelocity(Math.round((normalizedVelocity * level) / 10));
}

type DeleteSelectionDialogState = {
  nodeIds: string[];
  connectionKeys: string[];
  itemLabels: string[];
};

type DeletePatchDialogState = {
  patchId: string;
  patchName: string;
  nodeCount: number;
  connectionCount: number;
};

function sanitizeFileBaseName(value: string, fallback: string, extensionPatterns: RegExp[]): string {
  let normalizedValue = value.trim();
  for (const pattern of extensionPatterns) {
    normalizedValue = normalizedValue.replace(pattern, "");
  }

  const normalized = normalizedValue
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : fallback;
}

function sanitizeCsdFileBaseName(value: string): string {
  return sanitizeFileBaseName(value, "orchestron_instrument", [/\.csd$/i]);
}

function sanitizePerformanceFileBaseName(value: string): string {
  return sanitizeFileBaseName(value, "orchestron_performance", [/\.orch\.zip$/i, /\.orch\.json$/i, /\.json$/i]);
}

function sanitizeInstrumentDefinitionFileBaseName(value: string): string {
  return sanitizeFileBaseName(
    value,
    "orchestron_instrument",
    [/\.orch\.instrument\.zip$/i, /\.orch\.instrument\.json$/i, /\.json$/i]
  );
}

function transportStepCountFromTracks(stepCounts: Array<{ stepCount: number }>): number {
  void stepCounts;
  return sequencerTransportStepsPerBeat();
}

function transportStepCountFromPerformanceSequencers(
  timing: SequencerState["timing"],
  melodicTracks: Array<{ stepCount: number; pads?: Array<{ stepCount: number }> }>,
  drummerTracks: Array<{ stepCount: number; pads?: Array<{ stepCount: number }> }>,
  controllerSequencers: Array<{ stepCount: number; pads?: Array<{ stepCount: number }> }> = []
): number {
  void melodicTracks;
  void drummerTracks;
  void controllerSequencers;
  return sequencerTransportStepsPerBeat(timing);
}

const UNBOUNDED_PLAYBACK_END_STEP = 1_000_000_000;

function trackShouldRunContinuously(
  track: {
    enabled: boolean;
    padLoopEnabled: boolean;
    padLoopRepeat: boolean;
  }
): boolean {
  return track.enabled && (!track.padLoopEnabled || track.padLoopRepeat);
}

function buildDrummerRowTrackConfigs(
  drummerTrack: DrummerSequencerTrackState,
  levelMap: Map<number, number>,
  queueRuntimeState = true
): SessionSequencerConfigRequest["tracks"] {
  const scaledTrackVelocity = scaleVelocityForChannel(127, drummerTrack.midiChannel, levelMap);
  const transportSequence = compileArrangerTransportSequence(drummerTrack.padLoopPattern, drummerTrack.activePad);
  return drummerTrack.rows.map((row) => ({
    track_id: drummerRowRuntimeTrackId(drummerTrack.id, row.id),
    midi_channel: drummerTrack.midiChannel,
    timing: {
      tempo_bpm: drummerTrack.timing.tempoBPM,
      meter_numerator: drummerTrack.timing.meterNumerator,
      meter_denominator: drummerTrack.timing.meterDenominator,
      steps_per_beat: drummerTrack.timing.stepsPerBeat,
      beat_rate_numerator: drummerTrack.timing.beatRateNumerator,
      beat_rate_denominator: drummerTrack.timing.beatRateDenominator
    },
    length_beats: drummerTrack.lengthBeats,
    velocity: scaledTrackVelocity,
    gate_ratio: 0.8,
    sync_to_track_id: null,
    active_pad: drummerTrack.activePad,
    queued_pad: queueRuntimeState ? drummerTrack.queuedPad : null,
    pad_loop_enabled: drummerTrack.padLoopEnabled,
    pad_loop_repeat: drummerTrack.padLoopRepeat,
    pad_loop_sequence: transportSequence,
    enabled: drummerTrack.enabled,
    queued_enabled: queueRuntimeState ? drummerTrack.queuedEnabled : null,
    pads: drummerTrack.pads.map((pad, padIndex) => {
      const padRow = pad.rows.find((candidate) => candidate.rowId === row.id);
      return {
        pad_index: padIndex,
        length_beats: pad.lengthBeats,
        steps: Array.from({ length: pad.stepCount }, (_, stepIndex) => {
          const cell = padRow?.steps?.[stepIndex];
          if (cell?.active !== true) {
            return {
              note: null,
              hold: false,
              velocity: scaleVelocityForChannel(cell?.velocity ?? 127, drummerTrack.midiChannel, levelMap)
            };
          }
          return {
            note: row.key,
            hold: false,
            velocity: scaleVelocityForChannel(cell.velocity, drummerTrack.midiChannel, levelMap)
          };
        })
      };
    })
  }));
}

function patchCompileSignatureFor(
  patch: { id?: string; name: string; description: string; schema_version: number; graph: PatchGraph },
  tabId: string
): string {
  return JSON.stringify({
    patchKey: patch.id ?? `draft:${tabId}`,
    name: patch.name,
    description: patch.description,
    schema_version: patch.schema_version,
    graph: patch.graph
  });
}

type AppCopy = {
  appIconAlt: string;
  appTitle: string;
  appDescription: string;
  guiLanguage: string;
  instrumentDesign: string;
  perform: string;
  config: string;
  graphEditor: string;
  graphStats: (nodes: number, connections: number) => string;
  selectedSummary: (nodes: number, connections: number) => string;
  showRuntime: string;
  showRuntimePanel: string;
  patchCompileStatusCompiled: string;
  patchCompileStatusPending: string;
  patchCompileStatusErrors: string;
  instrumentTabTitle: (index: number) => string;
  confirmDeleteSelection: (count: number) => string;
  deleteSelectionDialogListLabel: string;
  deleteSelectionDialogOpcodeItem: (opcodeName: string, nodeId: string) => string;
  deleteSelectionDialogConnectionItem: (from: string, to: string) => string;
  deletePatchDialogListLabel: string;
  deletePatchDialogPatchItem: (name: string) => string;
  deletePatchDialogIdItem: (patchId: string) => string;
  deletePatchDialogGraphItem: (nodes: number, connections: number) => string;
  cancel: string;
  deleteAction: string;
  confirmDeletePatch: string;
  confirmDeletePerformance: string;
  errors: {
    noActiveRuntimeSession: string;
    startInstrumentsFirstForSequencer: string;
    noActiveInstrumentSessionForSequencer: string;
    failedToStartSequencer: string;
    failedToStopInstrumentEngine: string;
    startInstrumentsBeforePianoRoll: string;
    noActiveInstrumentSession: string;
    failedToStartPianoRollNote: string;
    startInstrumentsBeforePianoRollStart: string;
    failedToSendMidiControllerValue: string;
    failedToSaveSequencerConfig: string;
    failedToExportPerformanceCsd: string;
    failedToLoadSequencerConfig: string;
    failedToInitializeMidiControllers: string;
    failedToSyncSequencerStatus: string;
    failedToUpdateSequencerConfig: string;
    sessionNotRunningSequencerStopped: string;
    noActiveSessionForPadSwitching: string;
    failedToQueuePad: string;
  };
};

function buildGraphSelectionDeletePlan(
  graph: PatchGraph,
  selection: EditorSelection,
  opcodes: OpcodeSpec[],
  copy: Pick<AppCopy, "deleteSelectionDialogOpcodeItem" | "deleteSelectionDialogConnectionItem">
): DeleteSelectionDialogState {
  const nodeIds = Array.from(new Set(selection.nodeIds));
  const nodeIdSet = new Set(nodeIds);
  const selectedConnectionKeySet = new Set(selection.connections.map((connection) => connectionKey(connection)));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const opcodeByName = new Map(opcodes.map((opcode) => [opcode.name, opcode]));
  const itemLabels: string[] = [];
  const connectionKeys: string[] = [];

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    const opcodeName = opcodeByName.get(node.opcode)?.name ?? node.opcode;
    itemLabels.push(copy.deleteSelectionDialogOpcodeItem(opcodeName, node.id));
  }

  for (const connection of graph.connections) {
    const key = connectionKey(connection);
    const removedWithNode =
      nodeIdSet.has(connection.from_node_id) || nodeIdSet.has(connection.to_node_id);
    if (!removedWithNode && !selectedConnectionKeySet.has(key)) {
      continue;
    }

    connectionKeys.push(key);
    itemLabels.push(
      copy.deleteSelectionDialogConnectionItem(
        `${connection.from_node_id}.${connection.from_port_id}`,
        `${connection.to_node_id}.${connection.to_port_id}`
      )
    );
  }

  return {
    nodeIds,
    connectionKeys,
    itemLabels
  };
}

const GUI_LANGUAGE_SHORT_LABELS: Record<GuiLanguage, string> = {
  english: "EN",
  german: "DE",
  french: "FR",
  spanish: "ES"
};

const APP_COPY: Record<GuiLanguage, AppCopy> = {
  english: {
    appIconAlt: "Orchestron icon",
    appTitle: "Orchestron",
    appDescription: "Visual opcode patching with realtime CSound sessions and macOS MIDI loopback support.",
    guiLanguage: "GUI Language",
    instrumentDesign: "Instrument Design",
    perform: "Perform",
    config: "Config",
    graphEditor: "Graph Editor",
    graphStats: (nodes, connections) => `Graph Editor (${nodes} nodes, ${connections} connections)`,
    selectedSummary: (nodes, connections) => `Selected: ${nodes} opcode(s), ${connections} connection(s)`,
    showRuntime: "Show Runtime",
    showRuntimePanel: "Show runtime panel",
    patchCompileStatusCompiled: "(compiled)",
    patchCompileStatusPending: "(pending changes)",
    patchCompileStatusErrors: "(errors)",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `Delete ${count} elements?`,
    deleteSelectionDialogListLabel: "The following elements will be deleted:",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode: ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Connection: ${from} -> ${to}`,
    deletePatchDialogListLabel: "The following saved patch will be deleted:",
    deletePatchDialogPatchItem: (name) => `Patch: ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID: ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Graph: ${nodes} opcode(s), ${connections} connection(s)`,
    cancel: "Cancel",
    deleteAction: "Delete",
    confirmDeletePatch: "do you really want to delete this patch?",
    confirmDeletePerformance: "do you really want to delete this performance?",
    errors: {
      noActiveRuntimeSession: "No active runtime session available.",
      startInstrumentsFirstForSequencer:
        "Start instruments first. Sequencer transport is independent from instrument engine start/stop.",
      noActiveInstrumentSessionForSequencer: "No active instrument session available. Start instruments first.",
      failedToStartSequencer: "Failed to start sequencer.",
      failedToStopInstrumentEngine: "Failed to stop instrument engine.",
      startInstrumentsBeforePianoRoll: "Start instruments first before using the piano roll.",
      noActiveInstrumentSession: "No active instrument session available.",
      failedToStartPianoRollNote: "Failed to start piano roll note.",
      startInstrumentsBeforePianoRollStart: "Start instruments first before starting a piano roll.",
      failedToSendMidiControllerValue: "Failed to send MIDI controller value.",
      failedToSaveSequencerConfig: "Failed to save sequencer config.",
      failedToExportPerformanceCsd: "Failed to export performance CSD bundle.",
      failedToLoadSequencerConfig: "Failed to load sequencer config.",
      failedToInitializeMidiControllers: "Failed to initialize MIDI controllers.",
      failedToSyncSequencerStatus: "Failed to sync sequencer status.",
      failedToUpdateSequencerConfig: "Failed to update sequencer config.",
      sessionNotRunningSequencerStopped: "Session is no longer running. Sequencer transport stopped.",
      noActiveSessionForPadSwitching: "No active session available for pad switching.",
      failedToQueuePad: "Failed to queue pad."
    }
  },
  german: {
    appIconAlt: "Orchestron-Icon",
    appTitle: "Orchestron",
    appDescription: "Visuelles Opcode-Patching mit Echtzeit-CSound-Sessions und macOS-MIDI-Loopback-Unterstuetzung.",
    guiLanguage: "GUI-Sprache",
    instrumentDesign: "Instrument-Design",
    perform: "Performance",
    config: "Konfig",
    graphEditor: "Graph-Editor",
    graphStats: (nodes, connections) => `Graph-Editor (${nodes} Nodes, ${connections} Verbindungen)`,
    selectedSummary: (nodes, connections) => `Ausgewaehlt: ${nodes} Opcode(s), ${connections} Verbindung(en)`,
    showRuntime: "Runtime anzeigen",
    showRuntimePanel: "Runtime-Panel anzeigen",
    patchCompileStatusCompiled: "(kompiliert)",
    patchCompileStatusPending: "(aenderungen offen)",
    patchCompileStatusErrors: "(fehler)",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `${count} Elemente loeschen?`,
    deleteSelectionDialogListLabel: "Die folgenden Elemente werden geloescht:",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode: ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Verbindung: ${from} -> ${to}`,
    deletePatchDialogListLabel: "Das folgende gespeicherte Patch wird geloescht:",
    deletePatchDialogPatchItem: (name) => `Patch: ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID: ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Graph: ${nodes} Opcode(s), ${connections} Verbindung(en)`,
    cancel: "Abbrechen",
    deleteAction: "Loeschen",
    confirmDeletePatch: "Willst du dieses Patch wirklich loeschen?",
    confirmDeletePerformance: "Willst du diese Performance wirklich loeschen?",
    errors: {
      noActiveRuntimeSession: "Keine aktive Runtime-Session verfuegbar.",
      startInstrumentsFirstForSequencer:
        "Starte zuerst Instrumente. Der Sequencer-Transport ist vom Start/Stop der Engine getrennt.",
      noActiveInstrumentSessionForSequencer: "Keine aktive Instrument-Session verfuegbar. Bitte zuerst starten.",
      failedToStartSequencer: "Sequencer konnte nicht gestartet werden.",
      failedToStopInstrumentEngine: "Instrument-Engine konnte nicht gestoppt werden.",
      startInstrumentsBeforePianoRoll: "Starte zuerst Instrumente, bevor du die Piano Roll benutzt.",
      noActiveInstrumentSession: "Keine aktive Instrument-Session verfuegbar.",
      failedToStartPianoRollNote: "Piano-Roll-Note konnte nicht gestartet werden.",
      startInstrumentsBeforePianoRollStart: "Starte zuerst Instrumente, bevor du eine Piano Roll startest.",
      failedToSendMidiControllerValue: "MIDI-Controller-Wert konnte nicht gesendet werden.",
      failedToSaveSequencerConfig: "Sequencer-Konfiguration konnte nicht gespeichert werden.",
      failedToExportPerformanceCsd: "Performance-CSD-Bundle konnte nicht exportiert werden.",
      failedToLoadSequencerConfig: "Sequencer-Konfiguration konnte nicht geladen werden.",
      failedToInitializeMidiControllers: "MIDI-Controller konnten nicht initialisiert werden.",
      failedToSyncSequencerStatus: "Sequencer-Status konnte nicht synchronisiert werden.",
      failedToUpdateSequencerConfig: "Sequencer-Konfiguration konnte nicht aktualisiert werden.",
      sessionNotRunningSequencerStopped: "Session laeuft nicht mehr. Sequencer-Transport wurde gestoppt.",
      noActiveSessionForPadSwitching: "Keine aktive Session fuer Pad-Wechsel verfuegbar.",
      failedToQueuePad: "Pad konnte nicht in die Warteschlange gesetzt werden."
    }
  },
  french: {
    appIconAlt: "Icone Orchestron",
    appTitle: "Orchestron",
    appDescription:
      "Patching visuel d'opcodes avec sessions CSound temps reel et support loopback MIDI macOS.",
    guiLanguage: "Langue GUI",
    instrumentDesign: "Design instrument",
    perform: "Performance",
    config: "Config",
    graphEditor: "Editeur de graphe",
    graphStats: (nodes, connections) => `Editeur de graphe (${nodes} noeuds, ${connections} connexions)`,
    selectedSummary: (nodes, connections) => `Selection: ${nodes} opcode(s), ${connections} connexion(s)`,
    showRuntime: "Afficher runtime",
    showRuntimePanel: "Afficher panneau runtime",
    patchCompileStatusCompiled: "(compile)",
    patchCompileStatusPending: "(modifications en attente)",
    patchCompileStatusErrors: "(erreurs)",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `Supprimer ${count} elements ?`,
    deleteSelectionDialogListLabel: "Les elements suivants seront supprimes :",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode : ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Connexion : ${from} -> ${to}`,
    deletePatchDialogListLabel: "Le patch enregistre suivant sera supprime :",
    deletePatchDialogPatchItem: (name) => `Patch : ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID : ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Graphe : ${nodes} opcode(s), ${connections} connexion(s)`,
    cancel: "Annuler",
    deleteAction: "Supprimer",
    confirmDeletePatch: "Voulez-vous vraiment supprimer ce patch ?",
    confirmDeletePerformance: "Voulez-vous vraiment supprimer cette performance ?",
    errors: {
      noActiveRuntimeSession: "Aucune session runtime active disponible.",
      startInstrumentsFirstForSequencer:
        "Demarrez d'abord les instruments. Le transport sequencer est independant du start/stop moteur.",
      noActiveInstrumentSessionForSequencer:
        "Aucune session instrument active disponible. Demarrez d'abord les instruments.",
      failedToStartSequencer: "Echec du demarrage du sequencer.",
      failedToStopInstrumentEngine: "Echec de l'arret du moteur instrument.",
      startInstrumentsBeforePianoRoll: "Demarrez d'abord les instruments avant d'utiliser le piano roll.",
      noActiveInstrumentSession: "Aucune session instrument active disponible.",
      failedToStartPianoRollNote: "Echec du demarrage de la note piano roll.",
      startInstrumentsBeforePianoRollStart: "Demarrez d'abord les instruments avant de lancer un piano roll.",
      failedToSendMidiControllerValue: "Echec de l'envoi de la valeur du controleur MIDI.",
      failedToSaveSequencerConfig: "Echec de l'enregistrement de la configuration sequencer.",
      failedToExportPerformanceCsd: "Echec de l'export du bundle CSD de performance.",
      failedToLoadSequencerConfig: "Echec du chargement de la configuration sequencer.",
      failedToInitializeMidiControllers: "Echec de l'initialisation des controleurs MIDI.",
      failedToSyncSequencerStatus: "Echec de synchronisation du statut sequencer.",
      failedToUpdateSequencerConfig: "Echec de mise a jour de la configuration sequencer.",
      sessionNotRunningSequencerStopped: "La session ne tourne plus. Le transport sequencer est arrete.",
      noActiveSessionForPadSwitching: "Aucune session active pour le changement de pad.",
      failedToQueuePad: "Echec de mise en file du pad."
    }
  },
  spanish: {
    appIconAlt: "Icono de Orchestron",
    appTitle: "Orchestron",
    appDescription:
      "Patching visual de opcodes con sesiones CSound en tiempo real y soporte de loopback MIDI en macOS.",
    guiLanguage: "Idioma de GUI",
    instrumentDesign: "Diseno de instrumento",
    perform: "Performance",
    config: "Config",
    graphEditor: "Editor de grafos",
    graphStats: (nodes, connections) => `Editor de grafos (${nodes} nodos, ${connections} conexiones)`,
    selectedSummary: (nodes, connections) => `Seleccionado: ${nodes} opcode(s), ${connections} conexion(es)`,
    showRuntime: "Mostrar runtime",
    showRuntimePanel: "Mostrar panel runtime",
    patchCompileStatusCompiled: "(compilado)",
    patchCompileStatusPending: "(cambios pendientes)",
    patchCompileStatusErrors: "(errores)",
    instrumentTabTitle: (index) => `Instrumento ${index}`,
    confirmDeleteSelection: (count) => `Eliminar ${count} elementos?`,
    deleteSelectionDialogListLabel: "Se eliminaran los siguientes elementos:",
    deleteSelectionDialogOpcodeItem: (opcodeName, nodeId) => `Opcode: ${opcodeName} (${nodeId})`,
    deleteSelectionDialogConnectionItem: (from, to) => `Conexion: ${from} -> ${to}`,
    deletePatchDialogListLabel: "Se eliminara el siguiente patch guardado:",
    deletePatchDialogPatchItem: (name) => `Patch: ${name}`,
    deletePatchDialogIdItem: (patchId) => `ID: ${patchId}`,
    deletePatchDialogGraphItem: (nodes, connections) => `Grafo: ${nodes} opcode(s), ${connections} conexion(es)`,
    cancel: "Cancelar",
    deleteAction: "Eliminar",
    confirmDeletePatch: "Deseas eliminar este patch?",
    confirmDeletePerformance: "Deseas eliminar esta performance?",
    errors: {
      noActiveRuntimeSession: "No hay una sesion runtime activa disponible.",
      startInstrumentsFirstForSequencer:
        "Inicia primero los instrumentos. El transporte del secuenciador es independiente del start/stop del motor.",
      noActiveInstrumentSessionForSequencer:
        "No hay una sesion de instrumentos activa. Inicia primero los instrumentos.",
      failedToStartSequencer: "No se pudo iniciar el secuenciador.",
      failedToStopInstrumentEngine: "No se pudo detener el motor de instrumentos.",
      startInstrumentsBeforePianoRoll: "Inicia primero los instrumentos antes de usar el piano roll.",
      noActiveInstrumentSession: "No hay una sesion de instrumentos activa.",
      failedToStartPianoRollNote: "No se pudo iniciar la nota del piano roll.",
      startInstrumentsBeforePianoRollStart: "Inicia primero los instrumentos antes de iniciar un piano roll.",
      failedToSendMidiControllerValue: "No se pudo enviar el valor del controlador MIDI.",
      failedToSaveSequencerConfig: "No se pudo guardar la configuracion del secuenciador.",
      failedToExportPerformanceCsd: "No se pudo exportar el bundle CSD de la performance.",
      failedToLoadSequencerConfig: "No se pudo cargar la configuracion del secuenciador.",
      failedToInitializeMidiControllers: "No se pudieron inicializar los controladores MIDI.",
      failedToSyncSequencerStatus: "No se pudo sincronizar el estado del secuenciador.",
      failedToUpdateSequencerConfig: "No se pudo actualizar la configuracion del secuenciador.",
      sessionNotRunningSequencerStopped: "La sesion ya no esta en ejecucion. El transporte del secuenciador se detuvo.",
      noActiveSessionForPadSwitching: "No hay una sesion activa para cambiar pads.",
      failedToQueuePad: "No se pudo poner en cola el pad."
    }
  }
};

const IMPORT_DIALOG_COPY: Record<GuiLanguage, ImportDialogCopy> = {
  english: {
    optionsTitle: "Import Options",
    optionsDescription: "Choose what should be imported from this file.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "patch definitions",
    conflictsTitle: "Name Conflicts",
    conflictsDescription:
      "Existing items were found. Keep overwrite checked to replace existing entries. Uncheck overwrite to import under a new name. Enable skip to ignore a patch definition.",
    overwriteLabel: "overwrite",
    skipLabel: "skip",
    newNameLabel: "New Name",
    cancel: "Cancel",
    import: "Import",
    conflictPatchLabel: (name) => `Instrument patch: ${name}`,
    conflictPerformanceLabel: (name) => `Performance: ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) => `A new name is required for ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `Instrument patch name "${name}" already exists.`,
      patchNameDuplicate: (name) => `Instrument patch name "${name}" is used more than once in this import.`,
      performanceNameExists: (name) => `Performance name "${name}" already exists.`,
      performanceNameDuplicate: (name) => `Performance name "${name}" is used more than once in this import.`
    }
  },
  german: {
    optionsTitle: "Importoptionen",
    optionsDescription: "Wähle aus, was aus dieser Datei importiert werden soll.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "patch-definitionen",
    conflictsTitle: "Namenskonflikte",
    conflictsDescription:
      "Es wurden bestehende Einträge gefunden. Lass Überschreiben aktiviert, um bestehende Einträge zu ersetzen. Deaktiviere Überschreiben für einen neuen Namen. Aktiviere Überspringen, um eine Patch-Definition zu ignorieren.",
    overwriteLabel: "überschreiben",
    skipLabel: "überspringen",
    newNameLabel: "Neuer Name",
    cancel: "Abbrechen",
    import: "Importieren",
    conflictPatchLabel: (name) => `Instrument-Patch: ${name}`,
    conflictPerformanceLabel: (name) => `Performance: ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) =>
        `Ein neuer Name ist erforderlich für ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `Instrument-Patch-Name "${name}" existiert bereits.`,
      patchNameDuplicate: (name) =>
        `Instrument-Patch-Name "${name}" wird in diesem Import mehr als einmal verwendet.`,
      performanceNameExists: (name) => `Performance-Name "${name}" existiert bereits.`,
      performanceNameDuplicate: (name) =>
        `Performance-Name "${name}" wird in diesem Import mehr als einmal verwendet.`
    }
  },
  french: {
    optionsTitle: "Options d'importation",
    optionsDescription: "Choisissez ce qui doit être importé depuis ce fichier.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "définitions de patch",
    conflictsTitle: "Conflits de noms",
    conflictsDescription:
      "Des éléments existants ont été trouvés. Laissez Écraser activé pour remplacer les éléments existants. Désactivez Écraser pour importer avec un nouveau nom. Activez Ignorer pour ne pas importer une définition de patch.",
    overwriteLabel: "écraser",
    skipLabel: "ignorer",
    newNameLabel: "Nouveau nom",
    cancel: "Annuler",
    import: "Importer",
    conflictPatchLabel: (name) => `Patch d'instrument : ${name}`,
    conflictPerformanceLabel: (name) => `Performance : ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) => `Un nouveau nom est requis pour ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `Le nom de patch d'instrument "${name}" existe déjà.`,
      patchNameDuplicate: (name) =>
        `Le nom de patch d'instrument "${name}" est utilisé plusieurs fois dans cet import.`,
      performanceNameExists: (name) => `Le nom de performance "${name}" existe déjà.`,
      performanceNameDuplicate: (name) => `Le nom de performance "${name}" est utilisé plusieurs fois dans cet import.`
    }
  },
  spanish: {
    optionsTitle: "Opciones de importación",
    optionsDescription: "Elige qué debe importarse desde este archivo.",
    performanceLabel: "performance",
    patchDefinitionsLabel: "definiciones de patch",
    conflictsTitle: "Conflictos de nombre",
    conflictsDescription:
      "Se encontraron elementos existentes. Deja Sobrescribir activado para reemplazar elementos existentes. Desactiva Sobrescribir para importar con un nombre nuevo. Activa Omitir para ignorar una definición de patch.",
    overwriteLabel: "sobrescribir",
    skipLabel: "omitir",
    newNameLabel: "Nuevo nombre",
    cancel: "Cancelar",
    import: "Importar",
    conflictPatchLabel: (name) => `Patch de instrumento: ${name}`,
    conflictPerformanceLabel: (name) => `Performance: ${name}`,
    validation: {
      nameRequired: (kindLabel, originalName) => `Se requiere un nombre nuevo para ${kindLabel} "${originalName}".`,
      patchNameExists: (name) => `El nombre de patch de instrumento "${name}" ya existe.`,
      patchNameDuplicate: (name) =>
        `El nombre de patch de instrumento "${name}" se usa más de una vez en esta importación.`,
      performanceNameExists: (name) => `El nombre de performance "${name}" ya existe.`,
      performanceNameDuplicate: (name) =>
        `El nombre de performance "${name}" se usa más de una vez en esta importación.`
    }
  }
};

export default function App() {
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);

  const activePage = useAppStore((state) => state.activePage);
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
  const activeSessionInstruments = useAppStore((state) => state.activeSessionInstruments);
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
  const setCurrentPatchMeta = useAppStore((state) => state.setCurrentPatchMeta);
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
  const buildSequencerConfigSnapshot = useAppStore((state) => state.buildSequencerConfigSnapshot);
  const applySequencerConfigSnapshot = useAppStore((state) => state.applySequencerConfigSnapshot);
  const pushEvent = useAppStore((state) => state.pushEvent);

  const setSequencerBpm = useAppStore((state) => state.setSequencerBpm);
  const addSequencerTrack = useAppStore((state) => state.addSequencerTrack);
  const removeSequencerTrack = useAppStore((state) => state.removeSequencerTrack);
  const setSequencerTrackEnabled = useAppStore((state) => state.setSequencerTrackEnabled);
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
  const copySequencerTrackStepSettings = useAppStore((state) => state.copySequencerTrackStepSettings);
  const clearSequencerTrackSteps = useAppStore((state) => state.clearSequencerTrackSteps);
  const copySequencerTrackPad = useAppStore((state) => state.copySequencerTrackPad);
  const transposeSequencerTrackPadInScale = useAppStore((state) => state.transposeSequencerTrackPadInScale);
  const transposeSequencerTrackPadDiatonic = useAppStore((state) => state.transposeSequencerTrackPadDiatonic);
  const setSequencerTrackActivePad = useAppStore((state) => state.setSequencerTrackActivePad);
  const setSequencerTrackQueuedPad = useAppStore((state) => state.setSequencerTrackQueuedPad);
  const setSequencerTrackPadLoopEnabled = useAppStore((state) => state.setSequencerTrackPadLoopEnabled);
  const setSequencerTrackPadLoopRepeat = useAppStore((state) => state.setSequencerTrackPadLoopRepeat);
  const setSequencerTrackPadLoopPattern = useAppStore((state) => state.setSequencerTrackPadLoopPattern);
  const addSequencerTrackPadLoopStep = useAppStore((state) => state.addSequencerTrackPadLoopStep);
  const removeSequencerTrackPadLoopStep = useAppStore((state) => state.removeSequencerTrackPadLoopStep);
  const moveSequencerTrack = useAppStore((state) => state.moveSequencerTrack);
  const addDrummerSequencerTrack = useAppStore((state) => state.addDrummerSequencerTrack);
  const removeDrummerSequencerTrack = useAppStore((state) => state.removeDrummerSequencerTrack);
  const setDrummerSequencerTrackEnabled = useAppStore((state) => state.setDrummerSequencerTrackEnabled);
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
  const clearDrummerSequencerTrackSteps = useAppStore((state) => state.clearDrummerSequencerTrackSteps);
  const copyDrummerSequencerPad = useAppStore((state) => state.copyDrummerSequencerPad);
  const setDrummerSequencerTrackActivePad = useAppStore((state) => state.setDrummerSequencerTrackActivePad);
  const setDrummerSequencerTrackQueuedPad = useAppStore((state) => state.setDrummerSequencerTrackQueuedPad);
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
  const setMidiControllerEnabled = useAppStore((state) => state.setMidiControllerEnabled);
  const setMidiControllerNumber = useAppStore((state) => state.setMidiControllerNumber);
  const setMidiControllerValue = useAppStore((state) => state.setMidiControllerValue);
  const addControllerSequencer = useAppStore((state) => state.addControllerSequencer);
  const removeControllerSequencer = useAppStore((state) => state.removeControllerSequencer);
  const setControllerSequencerEnabled = useAppStore((state) => state.setControllerSequencerEnabled);
  const setControllerSequencerNumber = useAppStore((state) => state.setControllerSequencerNumber);
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
  const [lastCompiledPatchSignature, setLastCompiledPatchSignature] = useState<string | null>(null);
  const [lastFailedPatchSignature, setLastFailedPatchSignature] = useState<string | null>(null);
  const [runtimePanelCollapsed, setRuntimePanelCollapsed] = useState(false);
  const [deleteSelectionDialog, setDeleteSelectionDialog] = useState<DeleteSelectionDialogState | null>(null);
  const [deletePatchDialog, setDeletePatchDialog] = useState<DeletePatchDialogState | null>(null);
  const {
    importSelectionDialog,
    setImportSelectionDialog,
    importConflictDialog,
    setImportConflictDialog,
    requestImportSelectionDialog,
    closeImportSelectionDialog,
    requestImportConflictDialog,
    closeImportConflictDialog
  } = useImportDialogs();

  const activeMidiInputName = useMemo(
    () => resolveMidiInputName(activeMidiInput, midiInputs),
    [activeMidiInput, midiInputs]
  );
  const instrumentsRunning = activeSessionState === "running";
  const instrumentLevelsByChannel = useMemo(
    () => instrumentLevelByChannel(sequencerInstruments),
    [sequencerInstruments]
  );
  const disableAllRuntimePianoRolls = useCallback(() => {
    const currentSequencer = useAppStore.getState().sequencer;
    for (const roll of currentSequencer.pianoRolls) {
      if (roll.enabled) {
        setPianoRollEnabled(roll.id, false);
      }
    }
  }, [setPianoRollEnabled]);
  const buildBackendSequencerConfig = useCallback(
    (
      state?: SequencerState,
      mode: "runtime" | "export" = "runtime"
    ): SessionSequencerConfigRequest => {
      const resolvedState = state ?? useAppStore.getState().sequencer;
      const transportStepCount = transportStepCountFromPerformanceSequencers(
        resolvedState.timing,
        resolvedState.tracks,
        resolvedState.drummerTracks,
        resolvedState.controllerSequencers
      );
      const { playbackStartStep, playbackEndStep, playbackLoop, selection } = arrangerPlaybackBounds(resolvedState);
      const arrangementEndStep = arrangerTransportExtent(resolvedState);
      const exportMode = mode === "export";
      const hasUnboundedPlayback =
        !exportMode &&
        selection === null &&
        (resolvedState.tracks.some(trackShouldRunContinuously) ||
          resolvedState.drummerTracks.some(trackShouldRunContinuously) ||
          resolvedState.controllerSequencers.some(trackShouldRunContinuously));
      const resolvedPlaybackStartStep = exportMode ? 0 : playbackStartStep;
      const resolvedPlaybackEndStep = exportMode
        ? Math.max(sequencerTransportStepsPerBeat(resolvedState.timing), arrangementEndStep)
        : hasUnboundedPlayback
          ? UNBOUNDED_PLAYBACK_END_STEP
          : playbackEndStep;
      const resolvedPlaybackLoop = exportMode ? false : playbackLoop;
      const useRuntimeQueues = !exportMode;
      const melodicTracks = resolvedState.tracks.map((track) => {
        const scaledTrackVelocity = scaleVelocityForChannel(127, track.midiChannel, instrumentLevelsByChannel);
        const transportSequence = compileArrangerTransportSequence(track.padLoopPattern, track.activePad);
        return {
          track_id: track.id,
          midi_channel: track.midiChannel,
          timing: {
            tempo_bpm: track.timing.tempoBPM,
            meter_numerator: track.timing.meterNumerator,
            meter_denominator: track.timing.meterDenominator,
            steps_per_beat: track.timing.stepsPerBeat,
            beat_rate_numerator: track.timing.beatRateNumerator,
            beat_rate_denominator: track.timing.beatRateDenominator
          },
          length_beats: track.lengthBeats,
          velocity: scaledTrackVelocity,
          gate_ratio: 0.8,
          sync_to_track_id: track.syncToTrackId,
          active_pad: track.activePad,
          queued_pad: useRuntimeQueues ? track.queuedPad : null,
          pad_loop_enabled: track.padLoopEnabled,
          pad_loop_repeat: track.padLoopRepeat,
          pad_loop_sequence: transportSequence,
          enabled: track.enabled,
          queued_enabled: useRuntimeQueues ? track.queuedEnabled : null,
          pads: track.pads.map((pad, padIndex) => ({
            pad_index: padIndex,
            length_beats: pad.lengthBeats,
            steps: pad.steps.map((step) => {
              const notes = buildSequencerStepChordMidiNotes(step.note, step.chord, pad.scaleRoot, pad.mode);
              return {
                note: notes.length === 0 ? null : notes.length === 1 ? notes[0] : notes,
                hold: step.hold,
                velocity: scaleVelocityForChannel(step.velocity, track.midiChannel, instrumentLevelsByChannel)
              };
            })
          }))
        };
      });
      const drummerRowTracks = resolvedState.drummerTracks.flatMap((drummerTrack) =>
        buildDrummerRowTrackConfigs(drummerTrack, instrumentLevelsByChannel, useRuntimeQueues)
      );
      const controllerTracks = resolvedState.controllerSequencers.map((controllerSequencer) => {
        const transportSequence = compileArrangerTransportSequence(
          controllerSequencer.padLoopPattern,
          controllerSequencer.activePad
        );
        return {
          track_id: controllerSequencer.id,
          controller_number: controllerSequencer.controllerNumber,
          timing: {
            tempo_bpm: controllerSequencer.timing.tempoBPM,
            meter_numerator: controllerSequencer.timing.meterNumerator,
            meter_denominator: controllerSequencer.timing.meterDenominator,
            steps_per_beat: controllerSequencer.timing.stepsPerBeat,
            beat_rate_numerator: controllerSequencer.timing.beatRateNumerator,
            beat_rate_denominator: controllerSequencer.timing.beatRateDenominator
          },
          length_beats: controllerSequencer.lengthBeats,
          active_pad: controllerSequencer.activePad,
          queued_pad: useRuntimeQueues ? controllerSequencer.queuedPad : null,
          pad_loop_enabled: controllerSequencer.padLoopEnabled,
          pad_loop_repeat: controllerSequencer.padLoopRepeat,
          pad_loop_sequence: transportSequence,
          enabled: controllerSequencer.enabled,
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
                  beat_rate_numerator: 1,
                  beat_rate_denominator: 1
                },
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
      return {
        timing: {
          tempo_bpm: resolvedState.timing.tempoBPM,
          meter_numerator: resolvedState.timing.meterNumerator,
          meter_denominator: resolvedState.timing.meterDenominator,
          steps_per_beat: 8,
          beat_rate_numerator: 1,
          beat_rate_denominator: 1
        },
        step_count: transportStepCount,
        playback_start_step: resolvedPlaybackStartStep,
        playback_end_step: resolvedPlaybackEndStep,
        playback_loop: resolvedPlaybackLoop,
        tracks: transportTracks,
        controller_tracks: controllerTracks
      };
    },
    [instrumentLevelsByChannel]
  );
  const pianoRollNoteSessionRef = useRef(new Map<string, string>());
  const midiControllerInitSessionRef = useRef<string | null>(null);
  const {
    browserAudioError,
    browserAudioStatus,
    browserAudioTransport,
    displayedSequencer,
    displayedSequencerTransportSubunit,
    moveSequencerTransport,
    onApplyBrowserClockLatencySettings,
    primeBrowserClockAudio,
    queueSequencerPadRuntime,
    resolveSequencerSessionId,
    runtimeAudioOutputMode,
    sendAllNotesOff,
    sendDirectMidiEvent,
    sequencerRef,
    startSequencerTransport,
    stopSequencerTransport
  } = useSequencerRuntimeController({
    activeSessionId,
    activeSessionState,
    browserClockLatencySettings,
    buildBackendSequencerConfig,
    disableAllPianoRolls: disableAllRuntimePianoRolls,
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
  }, [compileCurrentPatchWithStatus, saveCurrentPatch]);

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
  const instrumentTabItems = useMemo(
    () =>
      instrumentTabs.map((tab, index) => ({
        id: tab.id,
        title: tab.patch.name.trim().length > 0 ? tab.patch.name : appCopy.instrumentTabTitle(index + 1)
      })),
    [appCopy, instrumentTabs]
  );
  const selectedOpcodeDocumentation = useMemo(
    () => opcodes.find((opcode) => opcode.name === activeOpcodeDocumentation) ?? null,
    [activeOpcodeDocumentation, opcodes]
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

  const onSequencerTrackEnabledChange = useCallback(
    (trackId: string, enabled: boolean) => {
      const sequencerState = sequencerRef.current;
      const hasOtherRunningTracks = sequencerState.tracks.some((track) => track.id !== trackId && track.enabled);
      // Start is queued only when aligning with other running tracks.
      // Stop is always queued while transport is running so the current loop can finish.
      const shouldQueueOnCycle =
        sequencerState.isPlaying && (enabled ? hasOtherRunningTracks : true);
      setSequencerTrackEnabled(trackId, enabled, shouldQueueOnCycle);
      setSequencerError(null);
    },
    [setSequencerTrackEnabled]
  );

  const onDrummerSequencerTrackEnabledChange = useCallback(
    (trackId: string, enabled: boolean) => {
      const sequencerState = sequencerRef.current;
      const hasOtherRunningTracks =
        sequencerState.tracks.some((track) => track.enabled) ||
        sequencerState.drummerTracks.some((track) => track.id !== trackId && track.enabled);
      const shouldQueueOnCycle = sequencerState.isPlaying && (enabled ? hasOtherRunningTracks : true);
      setDrummerSequencerTrackEnabled(trackId, enabled, shouldQueueOnCycle);
      setSequencerError(null);
    },
    [setDrummerSequencerTrackEnabled]
  );

  const onDrummerSequencerRowKeyPreview = useCallback(
    (note: number, channel: number) => {
      const sessionId = activeSessionId;
      if (activeSessionState !== "running" || !sessionId) {
        return;
      }

      const normalizedNote = Math.max(0, Math.min(127, Math.round(note)));
      const normalizedChannel = normalizeMidiChannel(channel);
      const scaledVelocity = scaleVelocityForChannel(110, normalizedChannel, instrumentLevelsByChannel);
      void sendDirectMidiEvent(
        { type: "note_on", channel: normalizedChannel, note: normalizedNote, velocity: scaledVelocity },
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
    [activeSessionId, activeSessionState, instrumentLevelsByChannel, sendDirectMidiEvent]
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
    for (const instrument of sequencerInstruments) {
      channels.add(instrument.midiChannel);
    }
    return channels;
  }, [sequencerInstruments]);

  const disableAllPianoRolls = useCallback(() => {
    for (const roll of sequencerRef.current.pianoRolls) {
      if (roll.enabled) {
        setPianoRollEnabled(roll.id, false);
      }
    }
  }, [setPianoRollEnabled]);

  const resetArrangerTransportToSelectionStart = useCallback(() => {
    const currentState = sequencerRef.current;
    const { selection } = arrangerPlaybackBounds(currentState);
    const targetAbsoluteStep = selection?.startStep ?? 0;
    setSequencerTransportAbsoluteStep(targetAbsoluteStep);
  }, [setSequencerTransportAbsoluteStep]);

  const stopPerformance = useCallback(
    async (resetTransport: boolean) => {
      disableAllPianoRolls();
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
      disableAllPianoRolls,
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

  const onStopInstrumentEngineAndResetTransport = useCallback(() => {
    setSequencerError(null);
    void stopPerformance(true).catch((error) => {
      setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToStopInstrumentEngine);
    });
  }, [appCopy.errors.failedToStopInstrumentEngine, stopPerformance]);

  const handleArrangerLoopSelectionChange = useCallback(
    (selection: SequencerState["arrangerLoopSelection"]) => {
      setSequencerArrangerLoopSelection(selection);
      if (!selection) {
        return;
      }
      const currentState = sequencerRef.current;
      const currentAbsoluteStep = sequencerAbsoluteTransportStep(
        currentState.playhead,
        currentState.cycle,
        currentState.stepCount
      );
      if (currentAbsoluteStep >= selection.startStep && currentAbsoluteStep < selection.endStep) {
        return;
      }
      const nextAbsoluteStep = clampArrangerSeekStep(
        currentAbsoluteStep,
        selection,
        Math.max(selection.endStep, selection.startStep + sequencerTransportStepsPerBeat(currentState.timing)),
        sequencerTransportStepsPerBeat(currentState.timing)
      );
      setSequencerTransportAbsoluteStep(nextAbsoluteStep);
    },
    [setSequencerArrangerLoopSelection, setSequencerTransportAbsoluteStep]
  );

  const onPianoRollNoteOn = useCallback(
    (note: number, channel: number, velocity: number) => {
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
      const scaledVelocity = scaleVelocityForChannel(velocity, normalizedChannel, instrumentLevelsByChannel);
      void (async () => {
        await sendDirectMidiEvent(
          { type: "note_on", channel: normalizedChannel, note: normalizedNote, velocity: scaledVelocity },
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
      instrumentLevelsByChannel,
      sendDirectMidiEvent
    ]
  );

  const onPianoRollNoteOff = useCallback(
    (note: number, channel: number) => {
      const normalizedChannel = normalizeMidiChannel(channel);
      const normalizedNote = Math.max(0, Math.min(127, Math.round(note)));
      const noteKey = pianoRollNoteKey(normalizedNote, normalizedChannel);
      const sessionId = pianoRollNoteSessionRef.current.get(noteKey) ?? activeSessionId;
      pianoRollNoteSessionRef.current.delete(noteKey);
      if (!sessionId) {
        return;
      }

      void sendDirectMidiEvent({ type: "note_off", channel: normalizedChannel, note: normalizedNote }, sessionId).catch(() => {
        // Ignore transient note-off failures during release.
      });
    },
    [activeSessionId, sendDirectMidiEvent]
  );

  const onPianoRollEnabledChange = useCallback(
    (rollId: string, enabled: boolean) => {
      if (enabled && activeSessionState !== "running") {
        setSequencerError(appCopy.errors.startInstrumentsBeforePianoRollStart);
        return;
      }

      if (!enabled) {
        const roll = sequencerRef.current.pianoRolls.find((entry) => entry.id === rollId);
        if (roll) {
          sendAllNotesOff(roll.midiChannel);
        }
        pianoRollNoteSessionRef.current.clear();
      }

      setPianoRollEnabled(rollId, enabled);
      setSequencerError(null);
    },
    [activeSessionState, appCopy.errors.startInstrumentsBeforePianoRollStart, sendAllNotesOff, setPianoRollEnabled]
  );

  const collectMidiControllerChannels = useCallback(() => {
    const channels = new Set<number>();

    if (activeSessionInstruments.length > 0) {
      for (const instrument of activeSessionInstruments) {
        channels.add(Math.max(1, Math.min(16, Math.round(instrument.midi_channel))));
      }
    } else {
      for (const instrument of sequencerInstruments) {
        channels.add(Math.max(1, Math.min(16, Math.round(instrument.midiChannel))));
      }
    }

    if (channels.size === 0) {
      channels.add(1);
    }

    return [...channels];
  }, [activeSessionInstruments, sequencerInstruments]);

  const sendMidiControllerValue = useCallback(
    async (controllerNumber: number, value: number, sessionIdOverride?: string) => {
      const normalizedController = Math.max(0, Math.min(127, Math.round(controllerNumber)));
      const normalizedValue = Math.max(0, Math.min(127, Math.round(value)));
      const channels = collectMidiControllerChannels();

      await Promise.all(
        channels.map((channel) =>
          sendDirectMidiEvent(
            {
              type: "control_change",
              channel,
              controller: normalizedController,
              value: normalizedValue
            },
            sessionIdOverride
          )
        )
      );
    },
    [collectMidiControllerChannels, sendDirectMidiEvent]
  );

  const onMidiControllerEnabledChange = useCallback(
    (controllerId: string, enabled: boolean) => {
      setMidiControllerEnabled(controllerId, enabled);
      if (!enabled || activeSessionState !== "running" || !activeSessionId) {
        return;
      }

      const controller = sequencerRef.current.midiControllers.find((entry) => entry.id === controllerId);
      if (!controller) {
        return;
      }

      void sendMidiControllerValue(controller.controllerNumber, controller.value, activeSessionId).catch((error) => {
        setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToSendMidiControllerValue);
      });
    },
    [
      activeSessionId,
      activeSessionState,
      appCopy.errors.failedToSendMidiControllerValue,
      sendMidiControllerValue,
      setMidiControllerEnabled
    ]
  );

  const onMidiControllerNumberChange = useCallback(
    (controllerId: string, controllerNumber: number) => {
      setMidiControllerNumber(controllerId, controllerNumber);
      if (activeSessionState !== "running" || !activeSessionId) {
        return;
      }

      const controller = sequencerRef.current.midiControllers.find((entry) => entry.id === controllerId);
      if (!controller || !controller.enabled) {
        return;
      }

      void sendMidiControllerValue(controllerNumber, controller.value, activeSessionId).catch((error) => {
        setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToSendMidiControllerValue);
      });
    },
    [
      activeSessionId,
      activeSessionState,
      appCopy.errors.failedToSendMidiControllerValue,
      sendMidiControllerValue,
      setMidiControllerNumber
    ]
  );

  const onMidiControllerValueChange = useCallback(
    (controllerId: string, value: number) => {
      setMidiControllerValue(controllerId, value);
      if (activeSessionState !== "running" || !activeSessionId) {
        return;
      }

      const controller = sequencerRef.current.midiControllers.find((entry) => entry.id === controllerId);
      if (!controller || !controller.enabled) {
        return;
      }

      void sendMidiControllerValue(controller.controllerNumber, value, activeSessionId).catch((error) => {
        setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToSendMidiControllerValue);
      });
    },
    [
      activeSessionId,
      activeSessionState,
      appCopy.errors.failedToSendMidiControllerValue,
      sendMidiControllerValue,
      setMidiControllerValue
    ]
  );

  const buildCurrentPerformanceExport = useCallback(async () => {
    const snapshot = buildSequencerConfigSnapshot();
    const patchIds = [...new Set(snapshot.instruments.map((instrument) => instrument.patchId.trim()).filter(Boolean))];
    const selectedPatches = await Promise.all(patchIds.map((patchId) => api.getPatch(patchId)));
    return buildPerformanceExportPayload({
      snapshot,
      selectedPatches,
      performanceName,
      performanceDescription
    });
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

  const onExportPerformanceCsd = useCallback(async () => {
    try {
      const { exportedPerformanceName, payload } = await buildCurrentPerformanceExport();
      const exportPayload: PerformanceCsdExportRequestPayload = {
        performanceExport: payload,
        sequencerConfig: buildBackendSequencerConfig(sequencerRef.current, "export")
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

  useEffect(() => {
    if (activeSessionState !== "running" || !activeSessionId) {
      midiControllerInitSessionRef.current = null;
      return;
    }
    if (midiControllerInitSessionRef.current === activeSessionId) {
      return;
    }

    midiControllerInitSessionRef.current = activeSessionId;
    const startedControllers = sequencerRef.current.midiControllers.filter((controller) => controller.enabled);
    if (startedControllers.length === 0) {
      return;
    }

    void Promise.all(
      startedControllers.map((controller) =>
      sendMidiControllerValue(controller.controllerNumber, controller.value, activeSessionId)
      )
    ).catch((error) => {
      setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToInitializeMidiControllers);
    });
  }, [
    activeSessionId,
    activeSessionState,
    appCopy.errors.failedToInitializeMidiControllers,
    sendMidiControllerValue
  ]);

  const applyDeleteSelectionPlan = useCallback(
    (plan: DeleteSelectionDialogState) => {
      if (plan.nodeIds.length === 0 && plan.connectionKeys.length === 0) {
        return;
      }

      const nodeIdsToRemove = new Set(plan.nodeIds);
      const connectionsToRemove = new Set(plan.connectionKeys);

      setGraph({
        ...currentPatch.graph,
        nodes: currentPatch.graph.nodes.filter((node) => !nodeIdsToRemove.has(node.id)),
        connections: currentPatch.graph.connections.filter((connection) => {
          if (nodeIdsToRemove.has(connection.from_node_id) || nodeIdsToRemove.has(connection.to_node_id)) {
            return false;
          }
          return !connectionsToRemove.has(connectionKey(connection));
        })
      });
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

    const plan = buildGraphSelectionDeletePlan(currentPatch.graph, selection, opcodes, appCopy);
    if (plan.itemLabels.length === 0) {
      return;
    }

    if (plan.itemLabels.length > 1) {
      setDeleteSelectionDialog(plan);
      return;
    }

    applyDeleteSelectionPlan(plan);
  }, [appCopy, applyDeleteSelectionPlan, currentPatch.graph, opcodes, selectedCount, selection]);

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
                guiLanguage={guiLanguage}
                patchName={currentPatch.name}
                patchDescription={currentPatch.description}
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
                onSelectPatch={(patchId) => {
                  void loadPatch(patchId);
                }}
                onNewPatch={newPatch}
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
                  opcodes={opcodes}
                  onAddOpcode={addNodeFromOpcode}
                  onOpcodeHelpRequest={onOpcodeHelpRequest}
                />
              </div>

              <section className="relative flex h-full min-h-[440px] flex-col gap-2">
                <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                  <ReteNodeEditor
                    guiLanguage={guiLanguage}
                    graph={currentPatch.graph}
                    graphLabel={currentPatch.name.trim().length > 0 ? currentPatch.name.trim() : "Untitled Patch"}
                    opcodes={opcodes}
                    viewportKey={`${activeInstrumentTabId}:${currentPatch.id ?? "draft"}`}
                    onGraphChange={onGraphChange}
                    onSelectionChange={setSelection}
                    onAddOpcodeAtPosition={addNodeFromOpcode}
                    onOpcodeHelpRequest={onOpcodeHelpRequest}
                    opcodeHelpLabel={documentationCopy.showDocumentation}
                    onDeleteSelection={onDeleteSelection}
                    canDeleteSelection={selectedCount > 0}
                  />
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
            <LazySequencerPage
              guiLanguage={guiLanguage}
              patches={patches}
              instrumentBindings={sequencerInstruments}
              sequencer={displayedSequencer}
              sequencerTransportSubunit={displayedSequencerTransportSubunit}
              performances={performances}
              currentPerformanceId={currentPerformanceId}
              performanceName={performanceName}
              performanceDescription={performanceDescription}
              instrumentsRunning={instrumentsRunning}
              sessionState={activeSessionState}
              midiInputName={activeMidiInputName}
              transportError={sequencerError}
              onAddInstrument={addSequencerInstrument}
              onRemoveInstrument={removeSequencerInstrument}
              onInstrumentPatchChange={updateSequencerInstrumentPatch}
              onInstrumentChannelChange={updateSequencerInstrumentChannel}
              onInstrumentLevelChange={updateSequencerInstrumentLevel}
              onPerformanceNameChange={(name) => setCurrentPerformanceMeta(name, performanceDescription)}
              onPerformanceDescriptionChange={(description) => setCurrentPerformanceMeta(performanceName, description)}
              onNewPerformance={onNewCurrentPerformance}
              onSavePerformance={() => {
                void saveCurrentPerformance();
              }}
              onClonePerformance={onCloneCurrentPerformance}
              onDeletePerformance={onDeleteCurrentPerformance}
              onLoadPerformance={(performanceId) => {
                void loadPerformance(performanceId);
              }}
              onExportConfig={onExportSequencerConfig}
              onExportCsd={onExportPerformanceCsd}
              onImportConfig={onImportSequencerConfig}
              onStartInstruments={onStartInstrumentEngine}
              onStopInstruments={onStopInstrumentEngine}
              onStopInstrumentsAndResetTransport={onStopInstrumentEngineAndResetTransport}
              onBpmChange={setSequencerBpm}
              onAddSequencerTrack={addSequencerTrack}
              onAddDrummerSequencerTrack={addDrummerSequencerTrack}
              onAddControllerSequencer={addControllerSequencer}
              onSequencerCycleRewind={() => {
                void moveSequencerTransport(-sequencerTransportStepsPerBeat(sequencer.timing));
              }}
              onSequencerCycleForward={() => {
                void moveSequencerTransport(sequencerTransportStepsPerBeat(sequencer.timing));
              }}
              onSequencerArrangerLoopSelectionChange={handleArrangerLoopSelectionChange}
              onRemoveSequencerTrack={removeSequencerTrack}
              onSequencerTrackEnabledChange={onSequencerTrackEnabledChange}
              onSequencerTrackChannelChange={setSequencerTrackMidiChannel}
              onSequencerTrackSyncTargetChange={setSequencerTrackSyncTarget}
              onSequencerTrackScaleChange={setSequencerTrackScale}
              onSequencerTrackModeChange={setSequencerTrackMode}
              onSequencerTrackMeterNumeratorChange={setSequencerTrackMeterNumerator}
              onSequencerTrackMeterDenominatorChange={setSequencerTrackMeterDenominator}
              onSequencerTrackStepsPerBeatChange={setSequencerTrackStepsPerBeat}
              onSequencerTrackBeatRateChange={setSequencerTrackBeatRate}
              onSequencerTrackStepCountChange={setSequencerTrackStepCount}
              onSequencerTrackStepNoteChange={setSequencerTrackStepNote}
              onSequencerTrackStepChordChange={setSequencerTrackStepChord}
              onSequencerTrackStepHoldChange={setSequencerTrackStepHold}
              onSequencerTrackStepVelocityChange={setSequencerTrackStepVelocity}
              onSequencerTrackStepCopy={copySequencerTrackStepSettings}
              onSequencerTrackClearSteps={clearSequencerTrackSteps}
              onSequencerTrackReorder={moveSequencerTrack}
              onSequencerPadPress={(trackId, padIndex) => {
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

                void queueSequencerPadRuntime(sessionId, trackId, padIndex)
                  .then(() => {
                    setSequencerTrackQueuedPad(trackId, padIndex);
                  })
                  .catch((queueError) => {
                    setSequencerError(
                      queueError instanceof Error
                        ? `${appCopy.errors.failedToQueuePad}: ${queueError.message}`
                        : appCopy.errors.failedToQueuePad
                    );
                  });
              }}
              onSequencerPadCopy={(trackId, sourcePadIndex, targetPadIndex) => {
                copySequencerTrackPad(trackId, sourcePadIndex, targetPadIndex);
              }}
              onSequencerPadTransposeShort={(trackId, padIndex, direction) => {
                transposeSequencerTrackPadInScale(trackId, padIndex, direction);
              }}
              onSequencerPadTransposeLong={(trackId, padIndex, direction) => {
                transposeSequencerTrackPadDiatonic(trackId, padIndex, direction);
              }}
              onSequencerTrackPadLoopEnabledChange={setSequencerTrackPadLoopEnabled}
              onSequencerTrackPadLoopRepeatChange={setSequencerTrackPadLoopRepeat}
              onSequencerTrackPadLoopPatternChange={setSequencerTrackPadLoopPattern}
              onSequencerTrackPadLoopStepAdd={addSequencerTrackPadLoopStep}
              onSequencerTrackPadLoopStepRemove={removeSequencerTrackPadLoopStep}
              onRemoveDrummerSequencerTrack={removeDrummerSequencerTrack}
              onDrummerSequencerTrackEnabledChange={onDrummerSequencerTrackEnabledChange}
              onDrummerSequencerTrackChannelChange={setDrummerSequencerTrackMidiChannel}
              onDrummerSequencerTrackMeterNumeratorChange={setDrummerSequencerTrackMeterNumerator}
              onDrummerSequencerTrackMeterDenominatorChange={setDrummerSequencerTrackMeterDenominator}
              onDrummerSequencerTrackStepsPerBeatChange={setDrummerSequencerTrackStepsPerBeat}
              onDrummerSequencerTrackBeatRateChange={setDrummerSequencerTrackBeatRate}
              onDrummerSequencerTrackStepCountChange={setDrummerSequencerTrackStepCount}
              onDrummerSequencerRowAdd={addDrummerSequencerRow}
              onDrummerSequencerRowRemove={removeDrummerSequencerRow}
              onDrummerSequencerRowKeyChange={setDrummerSequencerRowKey}
              onDrummerSequencerRowKeyPreview={onDrummerSequencerRowKeyPreview}
              onDrummerSequencerCellToggle={toggleDrummerSequencerCell}
              onDrummerSequencerCellVelocityChange={setDrummerSequencerCellVelocity}
              onDrummerSequencerTrackClearSteps={clearDrummerSequencerTrackSteps}
              onDrummerSequencerPadPress={(trackId, padIndex) => {
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
                    await queueSequencerPadRuntime(sessionId, drummerRowRuntimeTrackId(trackId, row.id), padIndex);
                  }
                  setDrummerSequencerTrackQueuedPad(trackId, padIndex);
                })().catch((queueError) => {
                  setSequencerError(
                    queueError instanceof Error
                      ? `${appCopy.errors.failedToQueuePad}: ${queueError.message}`
                      : appCopy.errors.failedToQueuePad
                  );
                });
              }}
              onDrummerSequencerPadCopy={(trackId, sourcePadIndex, targetPadIndex) => {
                copyDrummerSequencerPad(trackId, sourcePadIndex, targetPadIndex);
              }}
              onDrummerSequencerTrackPadLoopEnabledChange={setDrummerSequencerTrackPadLoopEnabled}
              onDrummerSequencerTrackPadLoopRepeatChange={setDrummerSequencerTrackPadLoopRepeat}
              onDrummerSequencerTrackPadLoopPatternChange={setDrummerSequencerTrackPadLoopPattern}
              onDrummerSequencerTrackPadLoopStepAdd={addDrummerSequencerTrackPadLoopStep}
              onDrummerSequencerTrackPadLoopStepRemove={removeDrummerSequencerTrackPadLoopStep}
              onAddPianoRoll={addPianoRoll}
              onRemovePianoRoll={removePianoRoll}
              onPianoRollEnabledChange={onPianoRollEnabledChange}
              onPianoRollMidiChannelChange={setPianoRollMidiChannel}
              onPianoRollVelocityChange={setPianoRollVelocity}
              onPianoRollScaleChange={setPianoRollScale}
              onPianoRollModeChange={setPianoRollMode}
              onPianoRollNoteOn={onPianoRollNoteOn}
              onPianoRollNoteOff={onPianoRollNoteOff}
              onAddMidiController={addMidiController}
              onRemoveMidiController={removeMidiController}
              onMidiControllerEnabledChange={onMidiControllerEnabledChange}
              onMidiControllerNumberChange={onMidiControllerNumberChange}
              onMidiControllerValueChange={onMidiControllerValueChange}
              onRemoveControllerSequencer={removeControllerSequencer}
              onControllerSequencerEnabledChange={setControllerSequencerEnabled}
              onControllerSequencerNumberChange={setControllerSequencerNumber}
              onControllerSequencerMeterNumeratorChange={setControllerSequencerMeterNumerator}
              onControllerSequencerMeterDenominatorChange={setControllerSequencerMeterDenominator}
              onControllerSequencerStepsPerBeatChange={setControllerSequencerStepsPerBeat}
              onControllerSequencerBeatRateChange={setControllerSequencerBeatRate}
              onControllerSequencerPadPress={(controllerSequencerId, padIndex) => {
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
                void queueSequencerPadRuntime(sessionId, controllerSequencerId, queuedPad)
                  .catch((queueError) => {
                    setSequencerError(
                      queueError instanceof Error
                        ? `${appCopy.errors.failedToQueuePad}: ${queueError.message}`
                        : appCopy.errors.failedToQueuePad
                    );
                  });
              }}
              onControllerSequencerPadCopy={copyControllerSequencerPad}
              onControllerSequencerClearSteps={clearControllerSequencerSteps}
              onControllerSequencerPadLoopEnabledChange={setControllerSequencerPadLoopEnabled}
              onControllerSequencerPadLoopRepeatChange={setControllerSequencerPadLoopRepeat}
              onControllerSequencerPadLoopPatternChange={setControllerSequencerPadLoopPattern}
              onControllerSequencerPadLoopStepAdd={addControllerSequencerPadLoopStep}
              onControllerSequencerPadLoopStepRemove={removeControllerSequencerPadLoopStep}
              onControllerSequencerStepCountChange={setControllerSequencerStepCount}
              onControllerSequencerKeypointAdd={addControllerSequencerKeypoint}
              onControllerSequencerKeypointChange={setControllerSequencerKeypoint}
              onControllerSequencerKeypointValueChange={setControllerSequencerKeypointValue}
              onControllerSequencerKeypointRemove={removeControllerSequencerKeypoint}
              onHelpRequest={onHelpRequest}
            />
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

      {deleteSelectionDialog && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={closeDeleteSelectionDialog}
        >
          <section
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={appCopy.confirmDeleteSelection(deleteSelectionDialog.itemLabels.length)}
          >
            <header className="border-b border-slate-700 px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-slate-100">
                {appCopy.confirmDeleteSelection(deleteSelectionDialog.itemLabels.length)}
              </h2>
              <p className="mt-1 text-xs text-slate-400">{appCopy.deleteSelectionDialogListLabel}</p>
            </header>

            <div className="min-h-0 overflow-y-auto px-4 py-4">
              <ul className="space-y-2">
                {deleteSelectionDialog.itemLabels.map((item, index) => (
                  <li
                    key={`${index}:${item}`}
                    className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-200"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={closeDeleteSelectionDialog}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
              >
                {appCopy.cancel}
              </button>
              <button
                type="button"
                onClick={confirmDeleteSelectionDialog}
                className="rounded-md border border-rose-500/70 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-rose-200 transition hover:bg-rose-500/25"
              >
                OK
              </button>
            </footer>
          </section>
        </div>
      )}

      {deletePatchDialog && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={closeDeletePatchDialog}
        >
          <section
            className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={appCopy.confirmDeletePatch}
          >
            <header className="border-b border-slate-700 px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-slate-100">{appCopy.confirmDeletePatch}</h2>
              <p className="mt-1 text-xs text-slate-400">{appCopy.deletePatchDialogListLabel}</p>
            </header>

            <div className="space-y-2 px-4 py-4">
              <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-200">
                {appCopy.deletePatchDialogPatchItem(deletePatchDialog.patchName || "(unnamed)")}
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-200">
                {appCopy.deletePatchDialogIdItem(deletePatchDialog.patchId)}
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-200">
                {appCopy.deletePatchDialogGraphItem(deletePatchDialog.nodeCount, deletePatchDialog.connectionCount)}
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={closeDeletePatchDialog}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
              >
                {appCopy.cancel}
              </button>
              <button
                type="button"
                onClick={confirmDeletePatchDialog}
                className="rounded-md border border-rose-500/70 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-rose-200 transition hover:bg-rose-500/25"
              >
                {appCopy.deleteAction}
              </button>
            </footer>
          </section>
        </div>
      )}

      <ImportDialogs
        importDialogCopy={importDialogCopy}
        importSelectionDialog={importSelectionDialog}
        setImportSelectionDialog={setImportSelectionDialog}
        closeImportSelectionDialog={closeImportSelectionDialog}
        importConflictDialog={importConflictDialog}
        setImportConflictDialog={setImportConflictDialog}
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
