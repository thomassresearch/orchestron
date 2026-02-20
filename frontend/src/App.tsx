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
import { resolveMidiInputName } from "./lib/sequencer";
import { useAppStore } from "./store/useAppStore";
import orchestronIcon from "./assets/orchestron-icon.png";
import type {
  Connection,
  GuiLanguage,
  HelpDocId,
  PatchGraph,
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

function sanitizeCsdFileBaseName(value: string): string {
  const withoutExtension = value.replace(/\.csd$/i, "");
  const normalized = withoutExtension
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "orchestron_instrument";
}

function transportStepCountFromTracks(stepCounts: Array<{ stepCount: 16 | 32 }>): 16 | 32 {
  return stepCounts.some((entry) => entry.stepCount === 32) ? 32 : 16;
}

type AppCopy = {
  appIconAlt: string;
  appTitle: string;
  appDescription: string;
  instrumentDesign: string;
  perform: string;
  config: string;
  graphEditor: string;
  graphStats: (nodes: number, connections: number) => string;
  selectedSummary: (nodes: number, connections: number) => string;
  showRuntime: string;
  showRuntimePanel: string;
  instrumentTabTitle: (index: number) => string;
  confirmDeleteSelection: (count: number) => string;
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

const APP_COPY: Record<GuiLanguage, AppCopy> = {
  english: {
    appIconAlt: "Orchestron icon",
    appTitle: "Orchestron",
    appDescription: "Visual opcode patching with realtime CSound sessions and macOS MIDI loopback support.",
    instrumentDesign: "Instrument Design",
    perform: "Perform",
    config: "Config",
    graphEditor: "Graph Editor",
    graphStats: (nodes, connections) => `Graph Editor (${nodes} nodes, ${connections} connections)`,
    selectedSummary: (nodes, connections) => `Selected: ${nodes} opcode(s), ${connections} connection(s)`,
    showRuntime: "Show Runtime",
    showRuntimePanel: "Show runtime panel",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `Delete ${count} selected elements?`,
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
    instrumentDesign: "Instrument-Design",
    perform: "Performance",
    config: "Konfig",
    graphEditor: "Graph-Editor",
    graphStats: (nodes, connections) => `Graph-Editor (${nodes} Nodes, ${connections} Verbindungen)`,
    selectedSummary: (nodes, connections) => `Ausgewaehlt: ${nodes} Opcode(s), ${connections} Verbindung(en)`,
    showRuntime: "Runtime anzeigen",
    showRuntimePanel: "Runtime-Panel anzeigen",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `${count} ausgewaehlte Elemente loeschen?`,
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
    instrumentDesign: "Design instrument",
    perform: "Performance",
    config: "Config",
    graphEditor: "Editeur de graphe",
    graphStats: (nodes, connections) => `Editeur de graphe (${nodes} noeuds, ${connections} connexions)`,
    selectedSummary: (nodes, connections) => `Selection: ${nodes} opcode(s), ${connections} connexion(s)`,
    showRuntime: "Afficher runtime",
    showRuntimePanel: "Afficher panneau runtime",
    instrumentTabTitle: (index) => `Instrument ${index}`,
    confirmDeleteSelection: (count) => `Supprimer ${count} elements selectionnes ?`,
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
    instrumentDesign: "Diseno de instrumento",
    perform: "Performance",
    config: "Config",
    graphEditor: "Editor de grafos",
    graphStats: (nodes, connections) => `Editor de grafos (${nodes} nodos, ${connections} conexiones)`,
    selectedSummary: (nodes, connections) => `Seleccionado: ${nodes} opcode(s), ${connections} conexion(es)`,
    showRuntime: "Mostrar runtime",
    showRuntimePanel: "Mostrar panel runtime",
    instrumentTabTitle: (index) => `Instrumento ${index}`,
    confirmDeleteSelection: (count) => `Eliminar ${count} elementos seleccionados?`,
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

export default function App() {
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);

  const activePage = useAppStore((state) => state.activePage);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const guiLanguage = useAppStore((state) => state.guiLanguage);
  const setGuiLanguage = useAppStore((state) => state.setGuiLanguage);
  const appCopy = useMemo(() => APP_COPY[guiLanguage], [guiLanguage]);

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
  const loadPerformance = useAppStore((state) => state.loadPerformance);
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
  const setSequencerTrackActivePad = useAppStore((state) => state.setSequencerTrackActivePad);
  const setSequencerTrackQueuedPad = useAppStore((state) => state.setSequencerTrackQueuedPad);
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

  const [selection, setSelection] = useState<EditorSelection>({
    nodeIds: [],
    connections: []
  });
  const [activeHelpDocumentation, setActiveHelpDocumentation] = useState<HelpDocId | null>(null);
  const [activeOpcodeDocumentation, setActiveOpcodeDocumentation] = useState<string | null>(null);
  const [sequencerError, setSequencerError] = useState<string | null>(null);
  const [runtimePanelCollapsed, setRuntimePanelCollapsed] = useState(false);

  const sequencerRef = useRef(sequencer);
  const sequencerSessionIdRef = useRef<string | null>(null);
  const sequencerStatusPollRef = useRef<number | null>(null);
  const sequencerPollInFlightRef = useRef(false);
  const sequencerConfigSyncPendingRef = useRef(false);
  const pianoRollNoteSessionRef = useRef(new Map<string, string>());
  const midiControllerInitSessionRef = useRef<string | null>(null);

  useEffect(() => {
    sequencerRef.current = sequencer;
  }, [sequencer]);

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
        enabled: track.enabled,
        queued_enabled: track.queuedEnabled,
        pads: track.pads.map((steps, padIndex) => ({
          pad_index: padIndex,
          steps: steps.map((note) => note)
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

  const onExportSequencerConfig = useCallback(() => {
    try {
      const snapshot = buildSequencerConfigSnapshot();
      const payload = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `orchestron-sequencer-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setSequencerError(null);
    } catch (error) {
      setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToSaveSequencerConfig);
    }
  }, [appCopy.errors.failedToSaveSequencerConfig, buildSequencerConfigSnapshot]);

  const onImportSequencerConfig = useCallback(
    (file: File) => {
      void file
        .text()
        .then((content) => {
          const parsed = JSON.parse(content);
          applySequencerConfigSnapshot(parsed);
          setSequencerError(null);
        })
        .catch((error) => {
          setSequencerError(error instanceof Error ? error.message : appCopy.errors.failedToLoadSequencerConfig);
        });
    },
    [appCopy.errors.failedToLoadSequencerConfig, applySequencerConfigSnapshot]
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
            !sequencerRef.current.tracks.some((track) => track.enabled || track.queuedEnabled === true)
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
    if (!sequencer.tracks.some((track) => track.enabled)) {
      return;
    }
    void startSequencerTransport();
  }, [activeSessionState, sequencer.isPlaying, sequencer.tracks, startSequencerTransport]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }
    if (sequencerConfigSyncPendingRef.current) {
      return;
    }
    if (sequencer.tracks.some((track) => track.enabled || track.queuedEnabled === true)) {
      return;
    }
    void stopSequencerTransport(false);
  }, [sequencer.isPlaying, sequencer.tracks, stopSequencerTransport]);

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

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#1e293b,_#020617_60%)] px-4 py-4 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-3">
        <header className="flex items-center gap-3 rounded-2xl border-x border-y border-slate-700/70 bg-slate-900/65 px-4 py-0">
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
                onSavePatch={() => {
                  void saveCurrentPatch();
                }}
                onCompile={() => {
                  void compileSession();
                }}
                onExport={() => {
                  void onExportCsd();
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
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                      {appCopy.graphStats(currentPatch.graph.nodes.length, currentPatch.graph.connections.length)}
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
            onLoadPerformance={(performanceId) => {
              void loadPerformance(performanceId);
            }}
            onExportConfig={onExportSequencerConfig}
            onImportConfig={onImportSequencerConfig}
            onStartInstruments={onStartInstrumentEngine}
            onStopInstruments={onStopInstrumentEngine}
            onBpmChange={setSequencerBpm}
            onAddSequencerTrack={addSequencerTrack}
            onRemoveSequencerTrack={removeSequencerTrack}
            onSequencerTrackEnabledChange={onSequencerTrackEnabledChange}
            onSequencerTrackChannelChange={setSequencerTrackMidiChannel}
            onSequencerTrackScaleChange={setSequencerTrackScale}
            onSequencerTrackModeChange={setSequencerTrackMode}
            onSequencerTrackStepCountChange={setSequencerTrackStepCount}
            onSequencerTrackStepNoteChange={setSequencerTrackStepNote}
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
            onGuiLanguageChange={setGuiLanguage}
            onHelpRequest={onHelpRequest}
            onApplyEngineConfig={(config) => {
              void applyEngineConfig(config);
            }}
          />
        )}
      </div>

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
