import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, wsBaseUrl } from "./api/client";
import { ConfigPage } from "./components/ConfigPage";
import { HelpDocumentationModal } from "./components/HelpDocumentationModal";
import { HelpIconButton } from "./components/HelpIconButton";
import { OpcodeCatalog } from "./components/OpcodeCatalog";
import { OpcodeDocumentationModal } from "./components/OpcodeDocumentationModal";
import { PatchToolbar } from "./components/PatchToolbar";
import { ReteNodeEditor, type EditorSelection } from "./components/ReteNodeEditor";
import { RuntimePanel } from "./components/RuntimePanel";
import { SequencerPage } from "./components/SequencerPage";
import { documentationUiCopy, getHelpDocument } from "./lib/documentation";
import { GUI_LANGUAGE_OPTIONS } from "./lib/guiLanguage";
import { resolveMidiInputName, sampleControllerCurveValue } from "./lib/sequencer";
import { useAppStore } from "./store/useAppStore";
import orchestronIcon from "./assets/orchestron-icon.png";
import type {
  Connection,
  ControllerSequencerState,
  GuiLanguage,
  HelpDocId,
  Patch,
  PatchGraph,
  PatchListItem,
  Performance,
  PerformanceListItem,
  SequencerConfigSnapshot,
  SessionEvent,
  SessionMidiEventRequest,
  SessionSequencerConfigRequest,
  SessionSequencerStatus
} from "./types";

function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

function pianoRollNoteKey(note: number, channel: number): string {
  return `${channel}:${note}`;
}

function wrapModulo(value: number, modulo: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulo) || modulo <= 0) {
    return 0;
  }
  const remainder = value % modulo;
  return remainder < 0 ? remainder + modulo : remainder;
}

function controllerSequencerSignature(controllerSequencer: ControllerSequencerState): string {
  return JSON.stringify({
    controllerNumber: controllerSequencer.controllerNumber,
    stepCount: controllerSequencer.stepCount,
    keypoints: controllerSequencer.keypoints.map((keypoint) => ({
      id: keypoint.id,
      position: keypoint.position,
      value: keypoint.value
    }))
  });
}

const CONTROLLER_SEQUENCER_SAMPLES_PER_STEP = 8;

function waitForIceGatheringComplete(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onStateChange = () => {
      if (peer.iceGatheringState !== "complete") {
        return;
      }
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };

    peer.addEventListener("icegatheringstatechange", onStateChange);
    window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, 5000);
  });
}

type ExportedPatchDefinition = {
  sourcePatchId: string;
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
};

type ExportedPerformanceDocument = {
  name: string;
  description: string;
  config: SequencerConfigSnapshot;
};

type PerformanceExportPayload = {
  format: "orchestron.performance";
  version: 1;
  exported_at: string;
  performance: ExportedPerformanceDocument;
  patch_definitions: ExportedPatchDefinition[];
};

type ImportSelectionDialogState = {
  patchDefinitionsAvailable: boolean;
  importPerformance: boolean;
  importPatchDefinitions: boolean;
};

type ImportSelectionDialogResult = {
  confirmed: boolean;
  importPerformance: boolean;
  importPatchDefinitions: boolean;
};

type ImportConflictDialogItem = {
  id: string;
  kind: "patch" | "performance";
  sourcePatchId?: string;
  originalName: string;
  overwrite: boolean;
  targetName: string;
  skip: boolean;
};

type ImportConflictDialogResult = {
  confirmed: boolean;
  items: ImportConflictDialogItem[];
};

type ImportDialogCopy = {
  optionsTitle: string;
  optionsDescription: string;
  performanceLabel: string;
  patchDefinitionsLabel: string;
  conflictsTitle: string;
  conflictsDescription: string;
  overwriteLabel: string;
  skipLabel: string;
  newNameLabel: string;
  cancel: string;
  import: string;
  conflictPatchLabel: (name: string) => string;
  conflictPerformanceLabel: (name: string) => string;
  validation: {
    nameRequired: (kindLabel: string, originalName: string) => string;
    patchNameExists: (name: string) => string;
    patchNameDuplicate: (name: string) => string;
    performanceNameExists: (name: string) => string;
    performanceNameDuplicate: (name: string) => string;
  };
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
  return sanitizeFileBaseName(value, "orchestron_performance", [/\.orch\.json$/i, /\.json$/i]);
}

function sanitizeInstrumentDefinitionFileBaseName(value: string): string {
  return sanitizeFileBaseName(value, "orchestron_instrument", [/\.orch\.instrument\.json$/i, /\.json$/i]);
}

function normalizeNameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function findPatchByName(patches: PatchListItem[], name: string): PatchListItem | null {
  const target = normalizeNameKey(name);
  if (target.length === 0) {
    return null;
  }
  return patches.find((patch) => normalizeNameKey(patch.name) === target) ?? null;
}

function findPerformanceByName(performances: PerformanceListItem[], name: string): PerformanceListItem | null {
  const target = normalizeNameKey(name);
  if (target.length === 0) {
    return null;
  }
  return performances.find((performance) => normalizeNameKey(performance.name) === target) ?? null;
}

function suggestUniqueCopyName(baseName: string, isTaken: (candidate: string) => boolean): string {
  const seed = baseName.trim().length > 0 ? baseName.trim() : "Imported";
  let index = 1;
  let candidate = `${seed} Copy`;
  while (isTaken(candidate)) {
    index += 1;
    candidate = `${seed} Copy ${index}`;
  }
  return candidate;
}

function validateImportConflictItems(
  items: ImportConflictDialogItem[],
  patches: PatchListItem[],
  performances: PerformanceListItem[],
  copy: ImportDialogCopy
): string | null {
  const existingPatchNames = new Set(patches.map((patch) => normalizeNameKey(patch.name)));
  const existingPerformanceNames = new Set(performances.map((performance) => normalizeNameKey(performance.name)));
  const plannedPatchNames = new Set<string>();
  const plannedPerformanceNames = new Set<string>();

  for (const item of items) {
    if (item.kind === "patch" && item.skip) {
      continue;
    }
    if (item.overwrite) {
      continue;
    }

    const nextName = item.targetName.trim();
    if (nextName.length === 0) {
      return copy.validation.nameRequired(
        item.kind === "patch" ? copy.patchDefinitionsLabel : copy.performanceLabel,
        item.originalName
      );
    }

    const key = normalizeNameKey(nextName);
    if (item.kind === "patch") {
      if (existingPatchNames.has(key)) {
        return copy.validation.patchNameExists(nextName);
      }
      if (plannedPatchNames.has(key)) {
        return copy.validation.patchNameDuplicate(nextName);
      }
      plannedPatchNames.add(key);
    } else {
      if (existingPerformanceNames.has(key)) {
        return copy.validation.performanceNameExists(nextName);
      }
      if (plannedPerformanceNames.has(key)) {
        return copy.validation.performanceNameDuplicate(nextName);
      }
      plannedPerformanceNames.add(key);
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExportedPatchDefinition(raw: unknown): ExportedPatchDefinition | null {
  if (!isRecord(raw) || !isRecord(raw.graph)) {
    return null;
  }

  const sourcePatchId = typeof raw.sourcePatchId === "string" ? raw.sourcePatchId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const description = typeof raw.description === "string" ? raw.description : "";
  const schemaVersion =
    typeof raw.schema_version === "number" && Number.isFinite(raw.schema_version)
      ? Math.max(1, Math.round(raw.schema_version))
      : 1;

  if (sourcePatchId.length === 0 || name.length === 0) {
    return null;
  }

  return {
    sourcePatchId,
    name,
    description,
    schema_version: schemaVersion,
    graph: raw.graph as unknown as PatchGraph
  };
}

function parsePerformanceExportPayload(raw: unknown): PerformanceExportPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.format !== "orchestron.performance" || raw.version !== 1) {
    return null;
  }
  if (!isRecord(raw.performance) || !isRecord(raw.performance.config)) {
    return null;
  }
  if (!Array.isArray(raw.patch_definitions)) {
    return null;
  }

  const parsedPatchDefinitions = raw.patch_definitions
    .map((entry) => parseExportedPatchDefinition(entry))
    .filter((entry): entry is ExportedPatchDefinition => entry !== null);

  const performanceName =
    typeof raw.performance.name === "string" && raw.performance.name.trim().length > 0
      ? raw.performance.name.trim()
      : "Imported Performance";
  const performanceDescription = typeof raw.performance.description === "string" ? raw.performance.description : "";

  return {
    format: "orchestron.performance",
    version: 1,
    exported_at: typeof raw.exported_at === "string" ? raw.exported_at : new Date().toISOString(),
    performance: {
      name: performanceName,
      description: performanceDescription,
      config: raw.performance.config as unknown as SequencerConfigSnapshot
    },
    patch_definitions: parsedPatchDefinitions
  };
}

function remapSnapshotPatchIds(
  snapshot: SequencerConfigSnapshot,
  patchIdMap: Map<string, string>,
  patches: PatchListItem[]
): SequencerConfigSnapshot {
  return {
    ...snapshot,
    instruments: snapshot.instruments.map((instrument) => {
      const mappedById = patchIdMap.get(instrument.patchId);
      if (mappedById) {
        return {
          ...instrument,
          patchId: mappedById
        };
      }

      if (typeof instrument.patchName === "string" && instrument.patchName.trim().length > 0) {
        const existing = findPatchByName(patches, instrument.patchName);
        if (existing) {
          return {
            ...instrument,
            patchId: existing.id
          };
        }
      }

      return instrument;
    })
  };
}

function toPatchListItem(patch: Patch): PatchListItem {
  return {
    id: patch.id,
    name: patch.name,
    description: patch.description,
    schema_version: patch.schema_version,
    updated_at: patch.updated_at
  };
}

function transportStepCountFromTracks(stepCounts: Array<{ stepCount: 16 | 32 }>): 16 | 32 {
  return stepCounts.some((entry) => entry.stepCount === 32) ? 32 : 16;
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
    failedToLoadSequencerConfig: string;
    failedToInitializeMidiControllers: string;
    failedToSyncSequencerStatus: string;
    failedToUpdateSequencerConfig: string;
    sessionNotRunningSequencerStopped: string;
    noActiveSessionForPadSwitching: string;
    failedToQueuePad: string;
  };
};

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
    confirmDeleteSelection: (count) => `Delete ${count} selected elements?`,
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
    confirmDeleteSelection: (count) => `${count} ausgewaehlte Elemente loeschen?`,
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
    confirmDeleteSelection: (count) => `Supprimer ${count} elements selectionnes ?`,
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
    confirmDeleteSelection: (count) => `Eliminar ${count} elementos seleccionados?`,
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
  const appCopy = useMemo(() => APP_COPY[guiLanguage], [guiLanguage]);
  const importDialogCopy = useMemo(() => IMPORT_DIALOG_COPY[guiLanguage], [guiLanguage]);

  const opcodes = useAppStore((state) => state.opcodes);
  const patches = useAppStore((state) => state.patches);
  const performances = useAppStore((state) => state.performances);
  const midiInputs = useAppStore((state) => state.midiInputs);
  const instrumentTabs = useAppStore((state) => state.instrumentTabs);
  const activeInstrumentTabId = useAppStore((state) => state.activeInstrumentTabId);

  const currentPatch = useAppStore((state) => state.currentPatch);
  const sequencer = useAppStore((state) => state.sequencer);
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
  const buildSequencerConfigSnapshot = useAppStore((state) => state.buildSequencerConfigSnapshot);
  const applySequencerConfigSnapshot = useAppStore((state) => state.applySequencerConfigSnapshot);
  const pushEvent = useAppStore((state) => state.pushEvent);

  const setSequencerBpm = useAppStore((state) => state.setSequencerBpm);
  const addSequencerTrack = useAppStore((state) => state.addSequencerTrack);
  const removeSequencerTrack = useAppStore((state) => state.removeSequencerTrack);
  const setSequencerTrackEnabled = useAppStore((state) => state.setSequencerTrackEnabled);
  const setSequencerTrackMidiChannel = useAppStore((state) => state.setSequencerTrackMidiChannel);
  const setSequencerTrackScale = useAppStore((state) => state.setSequencerTrackScale);
  const setSequencerTrackMode = useAppStore((state) => state.setSequencerTrackMode);
  const setSequencerTrackStepNote = useAppStore((state) => state.setSequencerTrackStepNote);
  const setSequencerTrackStepHold = useAppStore((state) => state.setSequencerTrackStepHold);
  const clearSequencerTrackSteps = useAppStore((state) => state.clearSequencerTrackSteps);
  const copySequencerTrackPad = useAppStore((state) => state.copySequencerTrackPad);
  const transposeSequencerTrackPadInScale = useAppStore((state) => state.transposeSequencerTrackPadInScale);
  const transposeSequencerTrackPadDiatonic = useAppStore((state) => state.transposeSequencerTrackPadDiatonic);
  const setSequencerTrackActivePad = useAppStore((state) => state.setSequencerTrackActivePad);
  const setSequencerTrackQueuedPad = useAppStore((state) => state.setSequencerTrackQueuedPad);
  const setSequencerTrackPadLoopEnabled = useAppStore((state) => state.setSequencerTrackPadLoopEnabled);
  const setSequencerTrackPadLoopRepeat = useAppStore((state) => state.setSequencerTrackPadLoopRepeat);
  const addSequencerTrackPadLoopStep = useAppStore((state) => state.addSequencerTrackPadLoopStep);
  const removeSequencerTrackPadLoopStep = useAppStore((state) => state.removeSequencerTrackPadLoopStep);
  const addPianoRoll = useAppStore((state) => state.addPianoRoll);
  const removePianoRoll = useAppStore((state) => state.removePianoRoll);
  const setPianoRollEnabled = useAppStore((state) => state.setPianoRollEnabled);
  const setPianoRollMidiChannel = useAppStore((state) => state.setPianoRollMidiChannel);
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
  const setControllerSequencerStepCount = useAppStore((state) => state.setControllerSequencerStepCount);
  const addControllerSequencerKeypoint = useAppStore((state) => state.addControllerSequencerKeypoint);
  const setControllerSequencerKeypoint = useAppStore((state) => state.setControllerSequencerKeypoint);
  const setControllerSequencerKeypointValue = useAppStore((state) => state.setControllerSequencerKeypointValue);
  const removeControllerSequencerKeypoint = useAppStore((state) => state.removeControllerSequencerKeypoint);
  const setSequencerTrackStepCount = useAppStore((state) => state.setSequencerTrackStepCount);
  const syncSequencerRuntime = useAppStore((state) => state.syncSequencerRuntime);
  const setSequencerPlayhead = useAppStore((state) => state.setSequencerPlayhead);
  const applyEngineConfig = useAppStore((state) => state.applyEngineConfig);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const url = `${wsBaseUrl()}/ws/sessions/${activeSessionId}`;
    const socket = new WebSocket(url);

    socket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data);
        pushEvent(parsed);
      } catch {
        // Ignore malformed websocket payloads.
      }
    };

    return () => {
      socket.close();
    };
  }, [activeSessionId, pushEvent]);

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

  const importSelectionDialogResolverRef = useRef<((result: ImportSelectionDialogResult) => void) | null>(null);
  const importConflictDialogResolverRef = useRef<((result: ImportConflictDialogResult) => void) | null>(null);
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
  const [importSelectionDialog, setImportSelectionDialog] = useState<ImportSelectionDialogState | null>(null);
  const [importConflictDialog, setImportConflictDialog] = useState<{ items: ImportConflictDialogItem[] } | null>(null);

  const sequencerRef = useRef(sequencer);
  const sequencerSessionIdRef = useRef<string | null>(null);
  const sequencerStatusPollRef = useRef<number | null>(null);
  const sequencerPollInFlightRef = useRef(false);
  const sequencerConfigSyncPendingRef = useRef(false);
  const pianoRollNoteSessionRef = useRef(new Map<string, string>());
  const midiControllerInitSessionRef = useRef<string | null>(null);
  const controllerSequencerTransportAnchorRef = useRef<{
    playhead: number;
    cycle: number;
    stepCount: 16 | 32;
    bpm: number;
    timestampMs: number;
  } | null>(null);
  const controllerSequencerPlaybackRef = useRef<
    Record<string, { lastSampleSerial: number; signature: string; lastSentValue: number | null }>
  >({});
  const controllerSequencerPlaybackRafRef = useRef<number | null>(null);
  const browserAudioFallbackElementRef = useRef<HTMLAudioElement | null>(null);
  const browserAudioRuntimeElementRef = useRef<HTMLAudioElement | null>(null);
  const browserAudioStreamRef = useRef<MediaStream | null>(null);
  const browserAudioPeerRef = useRef<RTCPeerConnection | null>(null);
  const browserAudioSessionRef = useRef<string | null>(null);
  const browserAudioNegotiationTokenRef = useRef(0);
  const browserAudioRtcConfigurationRef = useRef<RTCConfiguration | null>(null);
  const browserAudioRtcConfigurationLoadedRef = useRef(false);
  const browserAudioRtcConfigurationPromiseRef = useRef<Promise<RTCConfiguration | null> | null>(null);
  const [browserAudioStatus, setBrowserAudioStatus] = useState<"off" | "connecting" | "live" | "error">("off");
  const [browserAudioError, setBrowserAudioError] = useState<string | null>(null);

  const syncBrowserAudioOutput = useCallback(
    (reportPlaybackError: boolean) => {
      const stream = browserAudioStreamRef.current;
      const runtimeElement = browserAudioRuntimeElementRef.current;
      const fallbackElement = browserAudioFallbackElementRef.current;
      const activeElement = runtimeElement ?? fallbackElement;

      const applyToElement = (audioElement: HTMLAudioElement | null, shouldUseStream: boolean) => {
        if (!audioElement) {
          return;
        }

        if (!shouldUseStream || !stream) {
          if (audioElement.srcObject !== null) {
            audioElement.srcObject = null;
          }
          return;
        }

        if (audioElement.srcObject !== stream) {
          audioElement.srcObject = stream;
        }

        void audioElement.play().catch((playbackError: unknown) => {
          if (!reportPlaybackError) {
            return;
          }
          setBrowserAudioStatus("error");
          setBrowserAudioError(
            playbackError instanceof Error ? playbackError.message : "Browser blocked autoplay for streamed audio."
          );
        });
      };

      applyToElement(runtimeElement, activeElement === runtimeElement);
      applyToElement(fallbackElement, activeElement === fallbackElement);
    },
    [setBrowserAudioError, setBrowserAudioStatus]
  );

  const setBrowserAudioRuntimeElement = useCallback(
    (audioElement: HTMLAudioElement | null) => {
      browserAudioRuntimeElementRef.current = audioElement;
      syncBrowserAudioOutput(false);
    },
    [syncBrowserAudioOutput]
  );

  const latestStartedEvent = useMemo<SessionEvent | null>(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === "started") {
        return event;
      }
    }
    return null;
  }, [events]);
  const latestStartedAudioMode = useMemo<"local" | "streaming" | null>(() => {
    const raw = latestStartedEvent?.payload?.audio_mode;
    return raw === "streaming" ? "streaming" : raw === "local" ? "local" : null;
  }, [latestStartedEvent]);
  const latestStartedAudioStreamReady = useMemo<boolean | null>(() => {
    const value = latestStartedEvent?.payload?.audio_stream_ready;
    return typeof value === "boolean" ? value : null;
  }, [latestStartedEvent]);

  const disconnectBrowserAudio = useCallback(() => {
    browserAudioNegotiationTokenRef.current += 1;

    const peer = browserAudioPeerRef.current;
    browserAudioPeerRef.current = null;
    browserAudioSessionRef.current = null;
    if (peer) {
      try {
        peer.ontrack = null;
        peer.onconnectionstatechange = null;
        peer.oniceconnectionstatechange = null;
        peer.close();
      } catch {
        // Ignore browser-side cleanup failures.
      }
    }

    browserAudioStreamRef.current = null;

    const runtimeElement = browserAudioRuntimeElementRef.current;
    if (runtimeElement) {
      runtimeElement.srcObject = null;
    }

    const fallbackElement = browserAudioFallbackElementRef.current;
    if (fallbackElement) {
      fallbackElement.srcObject = null;
    }
  }, []);

  const getBrowserAudioRtcConfiguration = useCallback(async (): Promise<RTCConfiguration | null> => {
    if (browserAudioRtcConfigurationLoadedRef.current) {
      return browserAudioRtcConfigurationRef.current;
    }
    if (browserAudioRtcConfigurationPromiseRef.current) {
      return browserAudioRtcConfigurationPromiseRef.current;
    }

    const pending = api
      .getRuntimeConfig()
      .then((runtimeConfig) => {
        const iceServers: RTCIceServer[] = runtimeConfig.webrtc_browser_ice_servers
          .filter((server) => {
            if (typeof server.urls === "string") {
              return server.urls.length > 0;
            }
            return Array.isArray(server.urls) && server.urls.some((url) => typeof url === "string" && url.length > 0);
          })
          .map((server) => {
            const normalized: RTCIceServer = { urls: server.urls };
            if (server.username) {
              normalized.username = server.username;
            }
            if (server.credential) {
              normalized.credential = server.credential;
            }
            return normalized;
          });

        const configuration = iceServers.length > 0 ? ({ iceServers } satisfies RTCConfiguration) : null;
        browserAudioRtcConfigurationRef.current = configuration;
        browserAudioRtcConfigurationLoadedRef.current = true;
        browserAudioRtcConfigurationPromiseRef.current = null;
        return configuration;
      })
      .catch((error) => {
        browserAudioRtcConfigurationPromiseRef.current = null;
        throw error;
      });

    browserAudioRtcConfigurationPromiseRef.current = pending;
    return pending;
  }, []);

  const ensureBrowserAudioConnection = useCallback(
    async (sessionId: string) => {
      const existing = browserAudioPeerRef.current;
      if (
        existing &&
        browserAudioSessionRef.current === sessionId &&
        existing.connectionState !== "closed" &&
        existing.connectionState !== "failed"
      ) {
        return;
      }

      disconnectBrowserAudio();
      setBrowserAudioStatus("connecting");
      setBrowserAudioError(null);

      const token = browserAudioNegotiationTokenRef.current;
      const rtcConfiguration = await getBrowserAudioRtcConfiguration();
      if (browserAudioNegotiationTokenRef.current !== token) {
        return;
      }

      const peer = new RTCPeerConnection(rtcConfiguration ?? undefined);
      browserAudioPeerRef.current = peer;
      browserAudioSessionRef.current = sessionId;

      peer.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        browserAudioStreamRef.current = stream;
        syncBrowserAudioOutput(true);
      };
      peer.onconnectionstatechange = () => {
        if (browserAudioPeerRef.current !== peer) {
          return;
        }
        if (peer.connectionState === "connected") {
          setBrowserAudioStatus("live");
          setBrowserAudioError(null);
          return;
        }
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          setBrowserAudioStatus("error");
          setBrowserAudioError(`WebRTC connection ${peer.connectionState}.`);
        }
      };
      peer.oniceconnectionstatechange = () => {
        if (browserAudioPeerRef.current !== peer) {
          return;
        }
        if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected") {
          setBrowserAudioStatus("error");
          setBrowserAudioError(`ICE ${peer.iceConnectionState}.`);
        }
      };

      try {
        peer.addTransceiver("audio", { direction: "recvonly" });
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGatheringComplete(peer);

        if (browserAudioNegotiationTokenRef.current !== token) {
          peer.close();
          return;
        }

        const localDescription = peer.localDescription;
        if (!localDescription?.sdp) {
          throw new Error("Failed to create WebRTC offer.");
        }

        const answer = await api.negotiateSessionAudioWebRtc(sessionId, {
          type: "offer",
          sdp: localDescription.sdp
        });

        if (browserAudioNegotiationTokenRef.current !== token) {
          peer.close();
          return;
        }

        await peer.setRemoteDescription({
          type: answer.type,
          sdp: answer.sdp
        });
      } catch (error) {
        if (browserAudioPeerRef.current === peer) {
          peer.close();
          browserAudioPeerRef.current = null;
          browserAudioSessionRef.current = null;
        }
        setBrowserAudioStatus("error");
        setBrowserAudioError(error instanceof Error ? error.message : "Failed to connect browser audio stream.");
      }
    },
    [disconnectBrowserAudio, getBrowserAudioRtcConfiguration, syncBrowserAudioOutput]
  );

  useEffect(() => {
    if (!activeSessionId || activeSessionState !== "running") {
      disconnectBrowserAudio();
      setBrowserAudioStatus("off");
      setBrowserAudioError(null);
      return;
    }

    if (latestStartedAudioMode === null) {
      return;
    }

    if (latestStartedAudioMode !== "streaming") {
      disconnectBrowserAudio();
      setBrowserAudioStatus("off");
      setBrowserAudioError(null);
      return;
    }

    if (latestStartedAudioStreamReady === false) {
      disconnectBrowserAudio();
      setBrowserAudioStatus("error");
      setBrowserAudioError("Backend started in streaming mode, but browser audio is not available.");
      return;
    }

    void ensureBrowserAudioConnection(activeSessionId);
  }, [
    activeSessionId,
    activeSessionState,
    disconnectBrowserAudio,
    ensureBrowserAudioConnection,
    latestStartedAudioMode,
    latestStartedAudioStreamReady
  ]);

  useEffect(() => {
    return () => {
      disconnectBrowserAudio();
    };
  }, [disconnectBrowserAudio]);

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
    if (!currentPatch.id) {
      return;
    }
    if (!window.confirm(appCopy.confirmDeletePatch)) {
      return;
    }

    void (async () => {
      try {
        const patchId = currentPatch.id as string;
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
  }, [appCopy.confirmDeletePatch, currentPatch.id, loadPatch, newPatch, refreshPatches]);

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
    if (!window.confirm(appCopy.confirmDeletePerformance)) {
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
    appCopy.confirmDeletePerformance,
    clearCurrentPerformanceSelection,
    currentPerformanceId,
    loadPerformance,
    refreshPerformances
  ]);

  const onExportInstrumentDefinition = useCallback(() => {
    const exportedPatchName = currentPatch.name.trim().length > 0 ? currentPatch.name.trim() : "Untitled Patch";
    const payload: ExportedPatchDefinition = {
      sourcePatchId: currentPatch.id ?? activeInstrumentTabId,
      name: exportedPatchName,
      description: currentPatch.description,
      schema_version: currentPatch.schema_version,
      graph: currentPatch.graph
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeInstrumentDefinitionFileBaseName(exportedPatchName)}.orch.instrument.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setInstrumentPatchIoError(null);
  }, [activeInstrumentTabId, currentPatch]);

  const triggerInstrumentPatchImport = useCallback(() => {
    instrumentPatchImportInputRef.current?.click();
  }, []);

  useEffect(() => {
    sequencerRef.current = sequencer;
  }, [sequencer]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      controllerSequencerTransportAnchorRef.current = null;
      controllerSequencerPlaybackRef.current = {};
      return;
    }

    controllerSequencerTransportAnchorRef.current = {
      playhead: sequencer.playhead,
      cycle: sequencer.cycle,
      stepCount: sequencer.stepCount,
      bpm: sequencer.bpm,
      timestampMs: performance.now()
    };
  }, [sequencer.bpm, sequencer.cycle, sequencer.isPlaying, sequencer.playhead, sequencer.stepCount]);

  const activeMidiInputName = useMemo(
    () => resolveMidiInputName(activeMidiInput, midiInputs),
    [activeMidiInput, midiInputs]
  );
  const instrumentsRunning = activeSessionState === "running";

  const selectedCount = selection.nodeIds.length + selection.connections.length;
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
  const selectedHelpDocumentation = useMemo(() => {
    if (!activeHelpDocumentation) {
      return null;
    }
    return getHelpDocument(activeHelpDocumentation, guiLanguage);
  }, [activeHelpDocumentation, guiLanguage]);
  const importConflictValidationError = useMemo(() => {
    if (!importConflictDialog) {
      return null;
    }
    return validateImportConflictItems(importConflictDialog.items, patches, performances, importDialogCopy);
  }, [importConflictDialog, importDialogCopy, patches, performances]);

  const requestImportSelectionDialog = useCallback((patchDefinitionsAvailable: boolean) => {
    return new Promise<ImportSelectionDialogResult>((resolve) => {
      importSelectionDialogResolverRef.current = resolve;
      setImportSelectionDialog({
        patchDefinitionsAvailable,
        importPerformance: true,
        importPatchDefinitions: patchDefinitionsAvailable
      });
    });
  }, []);

  const closeImportSelectionDialog = useCallback(
    (confirmed: boolean) => {
      const resolver = importSelectionDialogResolverRef.current;
      const snapshot = importSelectionDialog;
      importSelectionDialogResolverRef.current = null;
      setImportSelectionDialog(null);
      if (!resolver) {
        return;
      }

      if (!confirmed || !snapshot) {
        resolver({
          confirmed: false,
          importPerformance: false,
          importPatchDefinitions: false
        });
        return;
      }

      resolver({
        confirmed: true,
        importPerformance: snapshot.importPerformance,
        importPatchDefinitions: snapshot.patchDefinitionsAvailable ? snapshot.importPatchDefinitions : false
      });
    },
    [importSelectionDialog]
  );

  const requestImportConflictDialog = useCallback((items: ImportConflictDialogItem[]) => {
    return new Promise<ImportConflictDialogResult>((resolve) => {
      importConflictDialogResolverRef.current = resolve;
      setImportConflictDialog({ items });
    });
  }, []);

  const closeImportConflictDialog = useCallback(
    (confirmed: boolean) => {
      const resolver = importConflictDialogResolverRef.current;
      const snapshot = importConflictDialog;
      importConflictDialogResolverRef.current = null;
      setImportConflictDialog(null);
      if (!resolver) {
        return;
      }

      resolver({
        confirmed,
        items: snapshot?.items ?? []
      });
    },
    [importConflictDialog]
  );

  useEffect(() => {
    return () => {
      const selectionResolver = importSelectionDialogResolverRef.current;
      if (selectionResolver) {
        importSelectionDialogResolverRef.current = null;
        selectionResolver({
          confirmed: false,
          importPerformance: false,
          importPatchDefinitions: false
        });
      }

      const conflictResolver = importConflictDialogResolverRef.current;
      if (conflictResolver) {
        importConflictDialogResolverRef.current = null;
        conflictResolver({
          confirmed: false,
          items: []
        });
      }
    };
  }, []);

  const onImportInstrumentDefinitionFile = useCallback(
    (file: File) => {
      void (async () => {
        const content = await file.text();
        const parsed = JSON.parse(content) as unknown;

        const standalonePatchDefinition = parseExportedPatchDefinition(parsed);
        const performanceExport = standalonePatchDefinition ? null : parsePerformanceExportPayload(parsed);
        const patchDefinitions = standalonePatchDefinition
          ? [standalonePatchDefinition]
          : (performanceExport?.patch_definitions ?? []);

        if (patchDefinitions.length === 0) {
          throw new Error("Import file does not contain an instrument definition.");
        }

        let patchCatalog = [...patches];
        const conflictItems: ImportConflictDialogItem[] = [];
        for (const definition of patchDefinitions) {
          const incomingName = definition.name.trim().length > 0 ? definition.name.trim() : "Imported Patch";
          const existing = findPatchByName(patchCatalog, incomingName);
          if (!existing) {
            continue;
          }

          conflictItems.push({
            id: `patch:${definition.sourcePatchId}`,
            kind: "patch",
            sourcePatchId: definition.sourcePatchId,
            originalName: incomingName,
            overwrite: true,
            targetName: suggestUniqueCopyName(incomingName, (candidate) => findPatchByName(patchCatalog, candidate) !== null),
            skip: false
          });
        }

        let conflictDecisions = conflictItems;
        if (conflictItems.length > 0) {
          const decision = await requestImportConflictDialog(conflictItems);
          if (!decision.confirmed) {
            return;
          }
          const validationError = validateImportConflictItems(decision.items, patchCatalog, performances, importDialogCopy);
          if (validationError) {
            throw new Error(validationError);
          }
          conflictDecisions = decision.items;
        }

        const patchConflictBySourceId = new Map<string, ImportConflictDialogItem>();
        for (const item of conflictDecisions) {
          if (item.kind === "patch" && item.sourcePatchId) {
            patchConflictBySourceId.set(item.sourcePatchId, item);
          }
        }

        let firstImportedPatchId: string | null = null;
        for (const definition of patchDefinitions) {
          const incomingName = definition.name.trim().length > 0 ? definition.name.trim() : "Imported Patch";
          const existingPatch = findPatchByName(patchCatalog, incomingName);
          const conflictItem = patchConflictBySourceId.get(definition.sourcePatchId);
          let importedPatch: Patch;

          if (conflictItem?.skip) {
            continue;
          }

          if (existingPatch) {
            if (!conflictItem || conflictItem.overwrite) {
              importedPatch = await api.updatePatch(existingPatch.id, {
                name: incomingName,
                description: definition.description,
                schema_version: definition.schema_version,
                graph: definition.graph
              });
              patchCatalog = patchCatalog.map((patch) => (patch.id === existingPatch.id ? toPatchListItem(importedPatch) : patch));
            } else {
              const renamed = conflictItem.targetName.trim();
              importedPatch = await api.createPatch({
                name: renamed,
                description: definition.description,
                schema_version: definition.schema_version,
                graph: definition.graph
              });
              patchCatalog = [toPatchListItem(importedPatch), ...patchCatalog];
            }
          } else {
            importedPatch = await api.createPatch({
              name: incomingName,
              description: definition.description,
              schema_version: definition.schema_version,
              graph: definition.graph
            });
            patchCatalog = [toPatchListItem(importedPatch), ...patchCatalog];
          }

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

  const sendDirectMidiEvent = useCallback(
    async (payload: SessionMidiEventRequest, sessionIdOverride?: string) => {
      const sessionId = sessionIdOverride ?? activeSessionId;
      if (!sessionId) {
        throw new Error(appCopy.errors.noActiveRuntimeSession);
      }
      await api.sendSessionMidiEvent(sessionId, payload);
    },
    [activeSessionId, appCopy.errors.noActiveRuntimeSession]
  );

  const sendAllNotesOff = useCallback(
    (channel: number) => {
      void sendDirectMidiEvent({ type: "all_notes_off", channel }).catch(() => {
        // Ignore best-effort all-notes-off failures during panic.
      });
    },
    [sendDirectMidiEvent]
  );

  const buildBackendSequencerConfig = useCallback((state = sequencerRef.current): SessionSequencerConfigRequest => {
    const transportStepCount = transportStepCountFromTracks(state.tracks);
    return {
      bpm: state.bpm,
      step_count: transportStepCount,
      tracks: state.tracks.map((track) => ({
        track_id: track.id,
        midi_channel: track.midiChannel,
        step_count: track.stepCount,
        velocity: 100,
        gate_ratio: 0.8,
        active_pad: track.activePad,
        queued_pad: track.queuedPad,
        pad_loop_enabled: track.padLoopEnabled,
        pad_loop_repeat: track.padLoopRepeat,
        pad_loop_sequence: track.padLoopSequence,
        enabled: track.enabled,
        queued_enabled: track.queuedEnabled,
        pads: track.pads.map((pad, padIndex) => ({
          pad_index: padIndex,
          steps: pad.steps.map((step) => ({
            note: step.note,
            hold: step.hold
          }))
        }))
      }))
    };
  }, []);
  const sequencerConfigSyncSignature = useMemo(
    () => JSON.stringify(buildBackendSequencerConfig(sequencer)),
    [buildBackendSequencerConfig, sequencer.bpm, sequencer.tracks]
  );

  const applySequencerStatus = useCallback(
    (status: SessionSequencerStatus) => {
      syncSequencerRuntime({
        isPlaying: status.running,
        transportStepCount: status.step_count,
        playhead: status.current_step,
        cycle: status.cycle,
        tracks: status.tracks.map((track) => ({
          trackId: track.track_id,
          stepCount: track.step_count,
          activePad: track.active_pad,
          queuedPad: track.queued_pad,
          padLoopPosition: track.pad_loop_position,
          enabled: track.enabled,
          queuedEnabled: track.queued_enabled
        }))
      });
    },
    [syncSequencerRuntime]
  );

  const stopSequencerTransport = useCallback(
    async (resetPlayhead: boolean) => {
      const sessionId = sequencerSessionIdRef.current ?? activeSessionId;
      sequencerConfigSyncPendingRef.current = false;
      if (sessionId) {
        try {
          const status = await api.stopSessionSequencer(sessionId);
          applySequencerStatus(status);
        } catch {
          syncSequencerRuntime({ isPlaying: false });
        }
      } else {
        syncSequencerRuntime({ isPlaying: false });
      }

      sequencerSessionIdRef.current = null;
      if (resetPlayhead) {
        setSequencerPlayhead(0);
      }
    },
    [activeSessionId, applySequencerStatus, setSequencerPlayhead, syncSequencerRuntime]
  );

  const startSequencerTransport = useCallback(async () => {
    setSequencerError(null);
    if (activeSessionState !== "running") {
      setSequencerError(appCopy.errors.startInstrumentsFirstForSequencer);
      return;
    }

    const sessionId = activeSessionId;
    if (!sessionId) {
      setSequencerError(appCopy.errors.noActiveInstrumentSessionForSequencer);
      return;
    }

    try {
      const status = await api.startSessionSequencer(sessionId, {
        config: buildBackendSequencerConfig(sequencerRef.current)
      });
      sequencerSessionIdRef.current = sessionId;
      applySequencerStatus(status);
    } catch (transportError) {
      syncSequencerRuntime({ isPlaying: false });
      setSequencerError(
        transportError instanceof Error ? transportError.message : appCopy.errors.failedToStartSequencer
      );
    }
  }, [
    activeSessionId,
    activeSessionState,
    appCopy.errors.failedToStartSequencer,
    appCopy.errors.noActiveInstrumentSessionForSequencer,
    appCopy.errors.startInstrumentsFirstForSequencer,
    applySequencerStatus,
    buildBackendSequencerConfig,
    syncSequencerRuntime
  ]);

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

  const onStartInstrumentEngine = useCallback(() => {
    setSequencerError(null);
    void startSession();
  }, [startSession]);

  const collectPerformanceChannels = useCallback(() => {
    const channels = new Set<number>();
    for (const track of sequencerRef.current.tracks) {
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

  const onStopInstrumentEngine = useCallback(() => {
    setSequencerError(null);
    void (async () => {
      disableAllPianoRolls();
      if (sequencerRef.current.isPlaying) {
        await stopSequencerTransport(false);
      }
      collectPerformanceChannels().forEach((channel) => {
        sendAllNotesOff(channel);
      });
      pianoRollNoteSessionRef.current.clear();
      await stopSession();
      syncSequencerRuntime({ isPlaying: false });
    })().catch((error) => {
      setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToStopInstrumentEngine);
    });
  }, [
    appCopy.errors.failedToStopInstrumentEngine,
    collectPerformanceChannels,
    disableAllPianoRolls,
    sendAllNotesOff,
    stopSequencerTransport,
    stopSession,
    syncSequencerRuntime
  ]);

  const onSequencerAllNotesOff = useCallback(() => {
    collectPerformanceChannels().forEach((channel) => {
      sendAllNotesOff(channel);
    });
    pianoRollNoteSessionRef.current.clear();
    setSequencerError(null);
  }, [collectPerformanceChannels, sendAllNotesOff]);

  const onPianoRollNoteOn = useCallback(
    (note: number, channel: number) => {
      if (activeSessionState !== "running") {
        setSequencerError(appCopy.errors.startInstrumentsBeforePianoRoll);
        return;
      }
      if (!activeSessionId) {
        setSequencerError(appCopy.errors.noActiveInstrumentSession);
        return;
      }

      setSequencerError(null);
      void (async () => {
        await sendDirectMidiEvent({ type: "note_on", channel, note, velocity: 110 }, activeSessionId);
        pianoRollNoteSessionRef.current.set(pianoRollNoteKey(note, channel), activeSessionId);
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
    (note: number, channel: number) => {
      const noteKey = pianoRollNoteKey(note, channel);
      const sessionId = pianoRollNoteSessionRef.current.get(noteKey) ?? activeSessionId;
      pianoRollNoteSessionRef.current.delete(noteKey);
      if (!sessionId) {
        return;
      }

      void sendDirectMidiEvent({ type: "note_off", channel, note }, sessionId).catch(() => {
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

  const onExportSequencerConfig = useCallback(async () => {
    try {
      const snapshot = buildSequencerConfigSnapshot();
      const patchIds = [...new Set(snapshot.instruments.map((instrument) => instrument.patchId.trim()).filter(Boolean))];
      const selectedPatches = await Promise.all(patchIds.map((patchId) => api.getPatch(patchId)));
      const patchDefinitions: ExportedPatchDefinition[] = selectedPatches.map((patch) => ({
        sourcePatchId: patch.id,
        name: patch.name,
        description: patch.description,
        schema_version: patch.schema_version,
        graph: patch.graph
      }));

      const patchNameById = new Map(patchDefinitions.map((patch) => [patch.sourcePatchId, patch.name]));
      const exportConfig: SequencerConfigSnapshot = {
        ...snapshot,
        instruments: snapshot.instruments.map((instrument) => ({
          ...instrument,
          patchName: patchNameById.get(instrument.patchId) ?? instrument.patchName
        }))
      };

      const exportedPerformanceName =
        performanceName.trim().length > 0 ? performanceName.trim() : "Untitled Performance";
      const payload: PerformanceExportPayload = {
        format: "orchestron.performance",
        version: 1,
        exported_at: new Date().toISOString(),
        performance: {
          name: exportedPerformanceName,
          description: performanceDescription,
          config: exportConfig
        },
        patch_definitions: patchDefinitions
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${sanitizePerformanceFileBaseName(exportedPerformanceName)}.orch.json`;
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
    buildSequencerConfigSnapshot,
    performanceDescription,
    performanceName
  ]);

  const onImportSequencerConfig = useCallback(
    (file: File) => {
      void (async () => {
        const content = await file.text();
        const parsed = JSON.parse(content) as unknown;
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
        const patchIdMap = new Map<string, string>();
        let performanceCatalog = [...performances];
        const conflictItems: ImportConflictDialogItem[] = [];

        if (selection.importPatchDefinitions) {
          for (const definition of exported.patch_definitions) {
            const incomingName = definition.name.trim().length > 0 ? definition.name.trim() : "Imported Patch";
            const existing = findPatchByName(patchCatalog, incomingName);
            if (!existing) {
              continue;
            }

            conflictItems.push({
              id: `patch:${definition.sourcePatchId}`,
              kind: "patch",
              sourcePatchId: definition.sourcePatchId,
              originalName: incomingName,
              overwrite: true,
              targetName: suggestUniqueCopyName(incomingName, (candidate) => findPatchByName(patchCatalog, candidate) !== null),
              skip: false
            });
          }
        }

        if (selection.importPerformance) {
          const incomingPerformanceName =
            exported.performance.name.trim().length > 0 ? exported.performance.name.trim() : "Imported Performance";
          const existingPerformance = findPerformanceByName(performanceCatalog, incomingPerformanceName);
          if (existingPerformance) {
            conflictItems.push({
              id: "performance",
              kind: "performance",
              originalName: incomingPerformanceName,
              overwrite: true,
              targetName: suggestUniqueCopyName(
                incomingPerformanceName,
                (candidate) => findPerformanceByName(performanceCatalog, candidate) !== null
              ),
              skip: false
            });
          }
        }

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

        const patchConflictBySourceId = new Map<string, ImportConflictDialogItem>();
        let performanceConflict: ImportConflictDialogItem | null = null;
        for (const item of conflictDecisions) {
          if (item.kind === "patch" && item.sourcePatchId) {
            patchConflictBySourceId.set(item.sourcePatchId, item);
          }
          if (item.kind === "performance") {
            performanceConflict = item;
          }
        }

        if (selection.importPatchDefinitions) {
          for (const definition of exported.patch_definitions) {
            const incomingName = definition.name.trim().length > 0 ? definition.name.trim() : "Imported Patch";
            const existingPatch = findPatchByName(patchCatalog, incomingName);
            const conflictItem = patchConflictBySourceId.get(definition.sourcePatchId);
            let importedPatch: Patch;

            if (conflictItem?.skip) {
              continue;
            }

            if (existingPatch) {
              if (!conflictItem || conflictItem.overwrite) {
                importedPatch = await api.updatePatch(existingPatch.id, {
                  name: incomingName,
                  description: definition.description,
                  schema_version: definition.schema_version,
                  graph: definition.graph
                });
                patchCatalog = patchCatalog.map((patch) =>
                  patch.id === existingPatch.id ? toPatchListItem(importedPatch) : patch
                );
              } else {
                const renamed = conflictItem.targetName.trim();
                importedPatch = await api.createPatch({
                  name: renamed,
                  description: definition.description,
                  schema_version: definition.schema_version,
                  graph: definition.graph
                });
                patchCatalog = [toPatchListItem(importedPatch), ...patchCatalog];
              }
            } else {
              importedPatch = await api.createPatch({
                name: incomingName,
                description: definition.description,
                schema_version: definition.schema_version,
                graph: definition.graph
              });
              patchCatalog = [toPatchListItem(importedPatch), ...patchCatalog];
            }

            patchIdMap.set(definition.sourcePatchId, importedPatch.id);
          }
          if (exported.patch_definitions.length > 0) {
            patchCatalog = await refreshPatches();
          }
        }

        if (selection.importPerformance) {
          const resolvedConfig = remapSnapshotPatchIds(exported.performance.config, patchIdMap, patchCatalog);
          const knownPatchIds = new Set(patchCatalog.map((patch) => patch.id));
          const hasResolvableInstrument = resolvedConfig.instruments.some((instrument) =>
            knownPatchIds.has(instrument.patchId)
          );
          if (!hasResolvableInstrument) {
            throw new Error(
              "No instrument assignments in this import match available patches. Import patch definitions or create matching patch names first."
            );
          }

          performanceCatalog = await refreshPerformances();
          const incomingPerformanceName =
            exported.performance.name.trim().length > 0 ? exported.performance.name.trim() : "Imported Performance";
          const existingPerformance = findPerformanceByName(performanceCatalog, incomingPerformanceName);
          let savedPerformance: Performance;

          if (existingPerformance && (!performanceConflict || performanceConflict.overwrite)) {
            savedPerformance = await api.updatePerformance(existingPerformance.id, {
              name: incomingPerformanceName,
              description: exported.performance.description,
              config: resolvedConfig
            });
          } else {
            const createName =
              existingPerformance && performanceConflict
                ? performanceConflict.targetName.trim()
                : incomingPerformanceName;
            savedPerformance = await api.createPerformance({
              name: createName,
              description: exported.performance.description,
              config: resolvedConfig
            });
          }

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

  useEffect(() => {
    if (controllerSequencerPlaybackRafRef.current !== null) {
      window.cancelAnimationFrame(controllerSequencerPlaybackRafRef.current);
      controllerSequencerPlaybackRafRef.current = null;
    }

    if (activeSessionState !== "running" || !activeSessionId || !sequencer.isPlaying) {
      controllerSequencerPlaybackRef.current = {};
      return;
    }

    const enabledControllerSequencers = sequencer.controllerSequencers.filter((controllerSequencer) => controllerSequencer.enabled);
    if (enabledControllerSequencers.length === 0) {
      controllerSequencerPlaybackRef.current = {};
      return;
    }

    let cancelled = false;
    let errorReported = false;

    const tick = () => {
      if (cancelled) {
        return;
      }

      const anchor = controllerSequencerTransportAnchorRef.current;
      const currentSequencer = sequencerRef.current;
      if (!anchor || !currentSequencer.isPlaying) {
        controllerSequencerPlaybackRafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const nowMs = performance.now();
      const stepDurationMs = 60000 / Math.max(30, Math.min(300, Math.round(anchor.bpm))) / 4;
      const elapsedTransportSteps = Math.max(0, (nowMs - anchor.timestampMs) / Math.max(1, stepDurationMs));
      const absoluteTransportSteps = anchor.cycle * anchor.stepCount + anchor.playhead + elapsedTransportSteps;

      const controllerTasks: Promise<void>[] = [];
      const nextPlaybackState: Record<string, { lastSampleSerial: number; signature: string; lastSentValue: number | null }> = {
        ...controllerSequencerPlaybackRef.current
      };
      const activeIds = new Set<string>();

      for (const controllerSequencer of currentSequencer.controllerSequencers) {
        if (!controllerSequencer.enabled) {
          continue;
        }
        activeIds.add(controllerSequencer.id);

        const controllerStepCount = Math.max(1, controllerSequencer.stepCount);
        const currentSampleSerial = Math.floor(absoluteTransportSteps * CONTROLLER_SEQUENCER_SAMPLES_PER_STEP);
        const signature = controllerSequencerSignature(controllerSequencer);
        const previous = nextPlaybackState[controllerSequencer.id];

        let firstSerialToSend = currentSampleSerial;
        if (previous && previous.signature === signature) {
          firstSerialToSend = previous.lastSampleSerial + 1;
        }

        if (firstSerialToSend > currentSampleSerial) {
          nextPlaybackState[controllerSequencer.id] = {
            lastSampleSerial: previous?.lastSampleSerial ?? currentSampleSerial,
            signature,
            lastSentValue: previous?.lastSentValue ?? null
          };
          continue;
        }

        if (currentSampleSerial - firstSerialToSend > controllerStepCount * CONTROLLER_SEQUENCER_SAMPLES_PER_STEP * 2) {
          firstSerialToSend = currentSampleSerial;
        }

        let lastSentValue = previous?.signature === signature ? previous.lastSentValue : null;
        for (let serial = firstSerialToSend; serial <= currentSampleSerial; serial += 1) {
          const sampleStepPosition = serial / CONTROLLER_SEQUENCER_SAMPLES_PER_STEP;
          const sampleIndex = wrapModulo(sampleStepPosition, controllerStepCount);
          const samplePosition = sampleIndex / controllerStepCount;
          const value = sampleControllerCurveValue(controllerSequencer.keypoints, samplePosition);
          if (lastSentValue === value) {
            continue;
          }
          lastSentValue = value;
          controllerTasks.push(
            sendMidiControllerValue(controllerSequencer.controllerNumber, value, activeSessionId).then(() => undefined)
          );
        }

        nextPlaybackState[controllerSequencer.id] = {
          lastSampleSerial: currentSampleSerial,
          signature,
          lastSentValue
        };
      }

      for (const knownId of Object.keys(nextPlaybackState)) {
        if (!activeIds.has(knownId)) {
          delete nextPlaybackState[knownId];
        }
      }
      controllerSequencerPlaybackRef.current = nextPlaybackState;

      if (controllerTasks.length > 0) {
        void Promise.all(controllerTasks).catch((error) => {
          if (errorReported) {
            return;
          }
          errorReported = true;
          setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToSendMidiControllerValue);
        });
      }

      controllerSequencerPlaybackRafRef.current = window.requestAnimationFrame(tick);
    };

    controllerSequencerPlaybackRafRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (controllerSequencerPlaybackRafRef.current !== null) {
        window.cancelAnimationFrame(controllerSequencerPlaybackRafRef.current);
        controllerSequencerPlaybackRafRef.current = null;
      }
    };
  }, [
    activeSessionId,
    activeSessionState,
    appCopy.errors.failedToSendMidiControllerValue,
    sendMidiControllerValue,
    sequencer.controllerSequencers,
    sequencer.isPlaying
  ]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }

    const sessionId = sequencerSessionIdRef.current ?? activeSessionId;
    if (!sessionId) {
      return;
    }

    const syncStatus = async () => {
      if (sequencerPollInFlightRef.current) {
        return;
      }
      if (sequencerConfigSyncPendingRef.current) {
        return;
      }
      sequencerPollInFlightRef.current = true;
      try {
        const status = await api.getSessionSequencerStatus(sessionId);
        applySequencerStatus(status);
      } catch (pollError) {
        setSequencerError(
          pollError instanceof Error
            ? `${appCopy.errors.failedToSyncSequencerStatus}: ${pollError.message}`
            : appCopy.errors.failedToSyncSequencerStatus
        );
      } finally {
        sequencerPollInFlightRef.current = false;
      }
    };

    void syncStatus();
    sequencerStatusPollRef.current = window.setInterval(() => {
      void syncStatus();
    }, 80);

    return () => {
      if (sequencerStatusPollRef.current !== null) {
        window.clearInterval(sequencerStatusPollRef.current);
        sequencerStatusPollRef.current = null;
      }
    };
  }, [activeSessionId, appCopy.errors.failedToSyncSequencerStatus, applySequencerStatus, sequencer.isPlaying]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      sequencerConfigSyncPendingRef.current = false;
      return;
    }

    const sessionId = sequencerSessionIdRef.current ?? activeSessionId;
    if (!sessionId) {
      sequencerConfigSyncPendingRef.current = false;
      return;
    }

    const payload = JSON.parse(sequencerConfigSyncSignature) as SessionSequencerConfigRequest;
    sequencerConfigSyncPendingRef.current = true;

    const syncTimer = window.setTimeout(() => {
      void api
        .configureSessionSequencer(sessionId, payload)
        .then((status) => {
          applySequencerStatus(status);
        })
        .catch((syncError) => {
          setSequencerError(
            syncError instanceof Error
              ? `${appCopy.errors.failedToUpdateSequencerConfig}: ${syncError.message}`
              : appCopy.errors.failedToUpdateSequencerConfig
          );
        })
        .finally(() => {
          sequencerConfigSyncPendingRef.current = false;
          if (
            sequencerRef.current.isPlaying &&
            !sequencerRef.current.tracks.some((track) => track.enabled || track.queuedEnabled === true) &&
            !sequencerRef.current.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled)
          ) {
            void stopSequencerTransport(false);
          }
        });
    }, 80);

    return () => {
      window.clearTimeout(syncTimer);
    };
  }, [
    activeSessionId,
    appCopy.errors.failedToUpdateSequencerConfig,
    applySequencerStatus,
    sequencer.isPlaying,
    sequencerConfigSyncSignature,
    stopSequencerTransport
  ]);

  useEffect(() => {
    if (activeSessionState !== "running") {
      return;
    }
    if (sequencer.isPlaying) {
      return;
    }
    if (
      !sequencer.tracks.some((track) => track.enabled) &&
      !sequencer.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled)
    ) {
      return;
    }
    void startSequencerTransport();
  }, [activeSessionState, sequencer.controllerSequencers, sequencer.isPlaying, sequencer.tracks, startSequencerTransport]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }
    if (sequencerConfigSyncPendingRef.current) {
      return;
    }
    if (
      sequencer.tracks.some((track) => track.enabled || track.queuedEnabled === true) ||
      sequencer.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled)
    ) {
      return;
    }
    void stopSequencerTransport(false);
  }, [sequencer.controllerSequencers, sequencer.isPlaying, sequencer.tracks, stopSequencerTransport]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      if (activeSessionState !== "running") {
        disableAllPianoRolls();
      }
      return;
    }

    if (activeSessionState !== "running") {
      disableAllPianoRolls();
      void stopSequencerTransport(false);
      setSequencerError(appCopy.errors.sessionNotRunningSequencerStopped);
    }
  }, [
    activeSessionState,
    appCopy.errors.sessionNotRunningSequencerStopped,
    disableAllPianoRolls,
    sequencer.isPlaying,
    stopSequencerTransport
  ]);

  useEffect(() => {
    return () => {
      void stopSequencerTransport(false);
    };
  }, [stopSequencerTransport]);

  const onDeleteSelection = useCallback(() => {
    if (selectedCount === 0) {
      return;
    }

    if (selectedCount > 1 && !window.confirm(appCopy.confirmDeleteSelection(selectedCount))) {
      return;
    }

    const nodeIdsToRemove = new Set(selection.nodeIds);
    const connectionsToRemove = new Set(selection.connections.map((connection) => connectionKey(connection)));

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
  }, [appCopy, currentPatch.graph, selectedCount, selection.connections, selection.nodeIds, setGraph]);

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
      <audio ref={browserAudioFallbackElementRef} className="sr-only" autoPlay playsInline preload="none" aria-hidden />
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
                patches={patches}
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
                accept=".json,.orch.json,.orch.instrument.json"
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
                <OpcodeCatalog guiLanguage={guiLanguage} opcodes={opcodes} onAddOpcode={addNodeFromOpcode} />
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
                    browserAudioStatus={latestStartedAudioMode === "streaming" ? browserAudioStatus : "off"}
                    browserAudioError={latestStartedAudioMode === "streaming" ? browserAudioError : null}
                    browserAudioElementRef={latestStartedAudioMode === "streaming" ? setBrowserAudioRuntimeElement : undefined}
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
          <SequencerPage
            guiLanguage={guiLanguage}
            patches={patches}
            instrumentBindings={sequencerInstruments}
            sequencer={sequencer}
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
            onPerformanceNameChange={(name) => setCurrentPerformanceMeta(name, performanceDescription)}
            onPerformanceDescriptionChange={(description) => setCurrentPerformanceMeta(performanceName, description)}
            onSavePerformance={() => {
              void saveCurrentPerformance();
            }}
            onClonePerformance={onCloneCurrentPerformance}
            onDeletePerformance={onDeleteCurrentPerformance}
            onLoadPerformance={(performanceId) => {
              void loadPerformance(performanceId);
            }}
            onExportConfig={onExportSequencerConfig}
            onImportConfig={onImportSequencerConfig}
            onStartInstruments={onStartInstrumentEngine}
            onStopInstruments={onStopInstrumentEngine}
            onBpmChange={setSequencerBpm}
            onAddSequencerTrack={addSequencerTrack}
            onAddControllerSequencer={addControllerSequencer}
            onRemoveSequencerTrack={removeSequencerTrack}
            onSequencerTrackEnabledChange={onSequencerTrackEnabledChange}
            onSequencerTrackChannelChange={setSequencerTrackMidiChannel}
            onSequencerTrackScaleChange={setSequencerTrackScale}
            onSequencerTrackModeChange={setSequencerTrackMode}
            onSequencerTrackStepCountChange={setSequencerTrackStepCount}
            onSequencerTrackStepNoteChange={setSequencerTrackStepNote}
            onSequencerTrackStepHoldChange={setSequencerTrackStepHold}
            onSequencerTrackClearSteps={clearSequencerTrackSteps}
            onSequencerPadPress={(trackId, padIndex) => {
              if (!sequencerRef.current.isPlaying) {
                setSequencerTrackActivePad(trackId, padIndex);
                return;
              }

              const sessionId = sequencerSessionIdRef.current ?? activeSessionId;
              if (!sessionId) {
                setSequencerError(appCopy.errors.noActiveSessionForPadSwitching);
                return;
              }

              void api
                .queueSessionSequencerPad(sessionId, trackId, { pad_index: padIndex })
                .then((status) => {
                  setSequencerTrackQueuedPad(trackId, padIndex);
                  applySequencerStatus(status);
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
            onSequencerTrackPadLoopStepAdd={addSequencerTrackPadLoopStep}
            onSequencerTrackPadLoopStepRemove={removeSequencerTrackPadLoopStep}
            onAddPianoRoll={addPianoRoll}
            onRemovePianoRoll={removePianoRoll}
            onPianoRollEnabledChange={onPianoRollEnabledChange}
            onPianoRollMidiChannelChange={setPianoRollMidiChannel}
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
            onControllerSequencerStepCountChange={setControllerSequencerStepCount}
            onControllerSequencerKeypointAdd={addControllerSequencerKeypoint}
            onControllerSequencerKeypointChange={setControllerSequencerKeypoint}
            onControllerSequencerKeypointValueChange={setControllerSequencerKeypointValue}
            onControllerSequencerKeypointRemove={removeControllerSequencerKeypoint}
            onResetPlayhead={() => {
              setSequencerPlayhead(0);
            }}
            onAllNotesOff={onSequencerAllNotesOff}
            onHelpRequest={onHelpRequest}
          />
        )}

        {activePage === "config" && (
          <ConfigPage
            guiLanguage={guiLanguage}
            audioRate={currentPatch.graph.engine_config.sr}
            controlRate={currentPatch.graph.engine_config.control_rate}
            ksmps={currentPatch.graph.engine_config.ksmps}
            softwareBuffer={currentPatch.graph.engine_config.software_buffer}
            hardwareBuffer={currentPatch.graph.engine_config.hardware_buffer}
            onHelpRequest={onHelpRequest}
            onApplyEngineConfig={(config) => {
              void applyEngineConfig(config);
            }}
          />
        )}
      </div>

      {importSelectionDialog && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={() => closeImportSelectionDialog(false)}
        >
          <section
            className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={importDialogCopy.optionsTitle}
          >
            <header className="border-b border-slate-700 px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-slate-100">{importDialogCopy.optionsTitle}</h2>
              <p className="mt-1 text-xs text-slate-400">{importDialogCopy.optionsDescription}</p>
            </header>

            <div className="space-y-3 px-4 py-4 text-sm text-slate-200">
              <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                <input
                  type="checkbox"
                  checked={importSelectionDialog.importPerformance}
                  onChange={(event) =>
                    setImportSelectionDialog((state) =>
                      state
                        ? {
                            ...state,
                            importPerformance: event.target.checked
                          }
                        : state
                    )
                  }
                  className="h-4 w-4 accent-cyan-400"
                />
                <span>{importDialogCopy.performanceLabel}</span>
              </label>

              <label
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  importSelectionDialog.patchDefinitionsAvailable
                    ? "border-slate-700 bg-slate-950/70"
                    : "border-slate-800 bg-slate-900/50 text-slate-500"
                }`}
              >
                <input
                  type="checkbox"
                  checked={importSelectionDialog.importPatchDefinitions}
                  disabled={!importSelectionDialog.patchDefinitionsAvailable}
                  onChange={(event) =>
                    setImportSelectionDialog((state) =>
                      state
                        ? {
                            ...state,
                            importPatchDefinitions: event.target.checked
                          }
                        : state
                    )
                  }
                  className="h-4 w-4 accent-cyan-400 disabled:opacity-50"
                />
                <span>{importDialogCopy.patchDefinitionsLabel}</span>
              </label>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={() => closeImportSelectionDialog(false)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
              >
                {importDialogCopy.cancel}
              </button>
              <button
                type="button"
                disabled={!importSelectionDialog.importPerformance && !importSelectionDialog.importPatchDefinitions}
                onClick={() => closeImportSelectionDialog(true)}
                className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importDialogCopy.import}
              </button>
            </footer>
          </section>
        </div>
      )}

      {importConflictDialog && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/75 p-4"
          onMouseDown={() => closeImportConflictDialog(false)}
        >
          <section
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={importDialogCopy.conflictsTitle}
          >
            <header className="border-b border-slate-700 px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-slate-100">{importDialogCopy.conflictsTitle}</h2>
              <p className="mt-1 text-xs text-slate-400">{importDialogCopy.conflictsDescription}</p>
            </header>

            <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-4">
              {importConflictDialog.items.map((item) => (
                <article key={item.id} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-sm font-semibold text-slate-100">
                      {item.kind === "patch"
                        ? importDialogCopy.conflictPatchLabel(item.originalName)
                        : importDialogCopy.conflictPerformanceLabel(item.originalName)}
                    </div>
                    <label className="ml-auto inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-300">
                      <input
                        type="checkbox"
                        checked={item.overwrite}
                        disabled={item.kind === "patch" && item.skip}
                        onChange={(event) =>
                          setImportConflictDialog((state) =>
                            state
                              ? {
                                  items: state.items.map((entry) =>
                                    entry.id === item.id
                                      ? {
                                          ...entry,
                                          overwrite: event.target.checked
                                        }
                                      : entry
                                  )
                                }
                              : state
                          )
                        }
                        className="h-4 w-4 accent-cyan-400 disabled:opacity-50"
                      />
                      <span>{importDialogCopy.overwriteLabel}</span>
                    </label>
                    {item.kind === "patch" && (
                      <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-300">
                        <input
                          type="checkbox"
                          checked={item.skip}
                          onChange={(event) =>
                            setImportConflictDialog((state) =>
                              state
                                ? {
                                    items: state.items.map((entry) =>
                                      entry.id === item.id
                                        ? {
                                            ...entry,
                                            skip: event.target.checked
                                          }
                                        : entry
                                    )
                                  }
                                : state
                            )
                          }
                          className="h-4 w-4 accent-cyan-400"
                        />
                        <span>{importDialogCopy.skipLabel}</span>
                      </label>
                    )}
                  </div>

                  {!item.overwrite && !(item.kind === "patch" && item.skip) && (
                    <label className="mt-2 flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        {importDialogCopy.newNameLabel}
                      </span>
                      <input
                        value={item.targetName}
                        onChange={(event) =>
                          setImportConflictDialog((state) =>
                            state
                              ? {
                                  items: state.items.map((entry) =>
                                    entry.id === item.id
                                      ? {
                                          ...entry,
                                          targetName: event.target.value
                                        }
                                      : entry
                                  )
                                }
                              : state
                          )
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/40 transition focus:ring"
                      />
                    </label>
                  )}
                </article>
              ))}
            </div>

            <footer className="border-t border-slate-700 px-4 py-3">
              {importConflictValidationError && (
                <div className="mb-2 rounded-md border border-rose-500/60 bg-rose-950/50 px-2 py-1.5 text-xs text-rose-200">
                  {importConflictValidationError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                onClick={() => closeImportConflictDialog(false)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
              >
                {importDialogCopy.cancel}
              </button>
              <button
                type="button"
                disabled={importConflictValidationError !== null}
                onClick={() => closeImportConflictDialog(true)}
                className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importDialogCopy.import}
              </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {selectedOpcodeDocumentation && (
        <OpcodeDocumentationModal
          opcode={selectedOpcodeDocumentation}
          guiLanguage={guiLanguage}
          onClose={() => setActiveOpcodeDocumentation(null)}
        />
      )}

      {selectedHelpDocumentation && (
        <HelpDocumentationModal
          title={selectedHelpDocumentation.title}
          markdown={selectedHelpDocumentation.markdown}
          guiLanguage={guiLanguage}
          onClose={() => setActiveHelpDocumentation(null)}
        />
      )}
    </div>
  );
}
