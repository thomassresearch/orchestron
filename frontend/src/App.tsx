import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, wsBaseUrl } from "./api/client";
import { ConfigPage } from "./components/ConfigPage";
import { OpcodeCatalog } from "./components/OpcodeCatalog";
import { OpcodeDocumentationModal } from "./components/OpcodeDocumentationModal";
import { PatchToolbar } from "./components/PatchToolbar";
import { ReteNodeEditor, type EditorSelection } from "./components/ReteNodeEditor";
import { RuntimePanel } from "./components/RuntimePanel";
import { SequencerPage } from "./components/SequencerPage";
import {
  resolveMidiInputName,
} from "./lib/sequencer";
import { useAppStore } from "./store/useAppStore";
import type { Connection, PatchGraph, SessionSequencerConfigRequest, SessionSequencerStatus } from "./types";

function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

function pianoRollNoteKey(note: number, channel: number): string {
  return `${channel}:${note}`;
}

export default function App() {
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);

  const activePage = useAppStore((state) => state.activePage);
  const setActivePage = useAppStore((state) => state.setActivePage);

  const opcodes = useAppStore((state) => state.opcodes);
  const patches = useAppStore((state) => state.patches);
  const midiInputs = useAppStore((state) => state.midiInputs);
  const instrumentTabs = useAppStore((state) => state.instrumentTabs);
  const activeInstrumentTabId = useAppStore((state) => state.activeInstrumentTabId);

  const currentPatch = useAppStore((state) => state.currentPatch);
  const sequencer = useAppStore((state) => state.sequencer);
  const sequencerInstruments = useAppStore((state) => state.sequencerInstruments);

  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activeSessionState = useAppStore((state) => state.activeSessionState);
  const activeMidiInput = useAppStore((state) => state.activeMidiInput);
  const compileOutput = useAppStore((state) => state.compileOutput);
  const events = useAppStore((state) => state.events);

  const loadBootstrap = useAppStore((state) => state.loadBootstrap);
  const loadPatch = useAppStore((state) => state.loadPatch);
  const addInstrumentTab = useAppStore((state) => state.addInstrumentTab);
  const closeInstrumentTab = useAppStore((state) => state.closeInstrumentTab);
  const setActiveInstrumentTab = useAppStore((state) => state.setActiveInstrumentTab);
  const newPatch = useAppStore((state) => state.newPatch);
  const setCurrentPatchMeta = useAppStore((state) => state.setCurrentPatchMeta);
  const setGraph = useAppStore((state) => state.setGraph);
  const addNodeFromOpcode = useAppStore((state) => state.addNodeFromOpcode);
  const saveCurrentPatch = useAppStore((state) => state.saveCurrentPatch);
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
  const setSequencerMidiChannel = useAppStore((state) => state.setSequencerMidiChannel);
  const setSequencerScale = useAppStore((state) => state.setSequencerScale);
  const setSequencerMode = useAppStore((state) => state.setSequencerMode);
  const setPianoRollMidiChannel = useAppStore((state) => state.setPianoRollMidiChannel);
  const setPianoRollScale = useAppStore((state) => state.setPianoRollScale);
  const setPianoRollMode = useAppStore((state) => state.setPianoRollMode);
  const setSequencerStepCount = useAppStore((state) => state.setSequencerStepCount);
  const setSequencerStepNote = useAppStore((state) => state.setSequencerStepNote);
  const setSequencerActivePad = useAppStore((state) => state.setSequencerActivePad);
  const setSequencerQueuedPad = useAppStore((state) => state.setSequencerQueuedPad);
  const syncSequencerRuntime = useAppStore((state) => state.syncSequencerRuntime);
  const setSequencerPlayhead = useAppStore((state) => state.setSequencerPlayhead);
  const setEngineAudioRate = useAppStore((state) => state.setEngineAudioRate);
  const setEngineControlRate = useAppStore((state) => state.setEngineControlRate);

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

  const onOpcodeHelpRequest = useCallback((opcodeName: string) => {
    setActiveOpcodeDocumentation(opcodeName);
  }, []);

  const [selection, setSelection] = useState<EditorSelection>({
    nodeIds: [],
    connections: []
  });
  const [activeOpcodeDocumentation, setActiveOpcodeDocumentation] = useState<string | null>(null);
  const [sequencerError, setSequencerError] = useState<string | null>(null);
  const [runtimePanelCollapsed, setRuntimePanelCollapsed] = useState(false);
  const [pianoRollRunning, setPianoRollRunning] = useState(false);

  const sequencerRef = useRef(sequencer);
  const sequencerSessionIdRef = useRef<string | null>(null);
  const sequencerStatusPollRef = useRef<number | null>(null);
  const sequencerPollInFlightRef = useRef(false);
  const pianoRollNoteSessionRef = useRef(new Map<string, string>());

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
        title: tab.patch.name.trim().length > 0 ? tab.patch.name : `Instrument ${index + 1}`
      })),
    [instrumentTabs]
  );
  const selectedOpcodeDocumentation = useMemo(
    () => opcodes.find((opcode) => opcode.name === activeOpcodeDocumentation) ?? null,
    [activeOpcodeDocumentation, opcodes]
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
    async (
      payload: { type: "note_on" | "note_off" | "all_notes_off"; channel: number; note?: number; velocity?: number },
      sessionIdOverride?: string
    ) => {
      const sessionId = sessionIdOverride ?? activeSessionId;
      if (!sessionId) {
        throw new Error("No active runtime session available.");
      }
      await api.sendSessionMidiEvent(sessionId, payload);
    },
    [activeSessionId]
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
    return {
      bpm: state.bpm,
      step_count: state.stepCount,
      tracks: [
        {
          track_id: state.trackId,
          midi_channel: state.midiChannel,
          velocity: 100,
          gate_ratio: 0.8,
          active_pad: state.activePad,
          queued_pad: state.queuedPad,
          pads: state.pads.map((steps, padIndex) => ({
            pad_index: padIndex,
            steps: steps.map((note) => note)
          }))
        }
      ]
    };
  }, []);

  const applySequencerStatus = useCallback(
    (status: SessionSequencerStatus) => {
      const preferredTrack = status.tracks.find((track) => track.track_id === sequencerRef.current.trackId);
      const track = preferredTrack ?? status.tracks[0];
      syncSequencerRuntime({
        isPlaying: status.running,
        playhead: status.current_step,
        cycle: status.cycle,
        activePad: track?.active_pad,
        queuedPad: track?.queued_pad ?? null
      });
    },
    [syncSequencerRuntime]
  );

  const stopSequencerTransport = useCallback(
    async (resetPlayhead: boolean) => {
      const sessionId = sequencerSessionIdRef.current ?? activeSessionId;
      if (sessionId) {
        try {
          const status = await api.stopSessionSequencer(sessionId);
          applySequencerStatus(status);
        } catch {
          syncSequencerRuntime({ isPlaying: false, queuedPad: null });
        }
      } else {
        syncSequencerRuntime({ isPlaying: false, queuedPad: null });
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
      setSequencerError("Start instruments first. Sequencer transport is independent from instrument engine start/stop.");
      return;
    }

    const sessionId = activeSessionId;
    if (!sessionId) {
      setSequencerError("No active instrument session available. Start instruments first.");
      return;
    }

    try {
      const status = await api.startSessionSequencer(sessionId, {
        config: buildBackendSequencerConfig(sequencerRef.current)
      });
      sequencerSessionIdRef.current = sessionId;
      applySequencerStatus(status);
    } catch (transportError) {
      syncSequencerRuntime({ isPlaying: false, queuedPad: null });
      setSequencerError(transportError instanceof Error ? transportError.message : "Failed to start sequencer.");
    }
  }, [
    activeSessionId,
    activeSessionState,
    applySequencerStatus,
    buildBackendSequencerConfig,
    syncSequencerRuntime
  ]);

  const onStartSequencerPlayback = useCallback(() => {
    if (sequencerRef.current.isPlaying) {
      return;
    }
    void startSequencerTransport();
  }, [startSequencerTransport]);

  const onStopSequencerPlayback = useCallback(() => {
    if (!sequencerRef.current.isPlaying) {
      return;
    }
    void stopSequencerTransport(true);
  }, [stopSequencerTransport]);

  const onStartInstrumentEngine = useCallback(() => {
    setSequencerError(null);
    void startSession();
  }, [startSession]);

  const onStopInstrumentEngine = useCallback(() => {
    setSequencerError(null);
    void (async () => {
      setPianoRollRunning(false);
      if (sequencerRef.current.isPlaying) {
        await stopSequencerTransport(false);
      }
      const channels = new Set<number>();
      channels.add(sequencerRef.current.midiChannel);
      channels.add(sequencerRef.current.pianoRollMidiChannel);
      for (const instrument of sequencerInstruments) {
        channels.add(instrument.midiChannel);
      }
      channels.forEach((channel) => {
        sendAllNotesOff(channel);
      });
      pianoRollNoteSessionRef.current.clear();
      await stopSession();
      syncSequencerRuntime({ isPlaying: false, queuedPad: null });
    })().catch((error) => {
      setSequencerError(error instanceof Error ? error.message : "Failed to stop instrument engine.");
    });
  }, [sendAllNotesOff, sequencerInstruments, stopSequencerTransport, stopSession, syncSequencerRuntime]);

  const onSequencerAllNotesOff = useCallback(() => {
    const channels = new Set<number>();
    channels.add(sequencerRef.current.midiChannel);
    channels.add(sequencerRef.current.pianoRollMidiChannel);
    for (const instrument of sequencerInstruments) {
      channels.add(instrument.midiChannel);
    }

    channels.forEach((channel) => {
      sendAllNotesOff(channel);
    });
    pianoRollNoteSessionRef.current.clear();
    setSequencerError(null);
  }, [sendAllNotesOff, sequencerInstruments]);

  const onPianoRollNoteOn = useCallback(
    (note: number, channel: number) => {
      if (!pianoRollRunning) {
        return;
      }
      if (activeSessionState !== "running") {
        setSequencerError("Start instruments first before using the piano roll.");
        return;
      }
      if (!activeSessionId) {
        setSequencerError("No active instrument session available.");
        return;
      }

      setSequencerError(null);
      void (async () => {
        await sendDirectMidiEvent({ type: "note_on", channel, note, velocity: 110 }, activeSessionId);
        pianoRollNoteSessionRef.current.set(pianoRollNoteKey(note, channel), activeSessionId);
      })().catch((error) => {
        setSequencerError(error instanceof Error ? error.message : "Failed to start piano roll note.");
      });
    },
    [activeSessionId, activeSessionState, pianoRollRunning, sendDirectMidiEvent]
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

  const onStartPianoRollPlayback = useCallback(() => {
    if (activeSessionState !== "running") {
      setSequencerError("Start instruments first before starting the piano roll.");
      return;
    }
    setPianoRollRunning(true);
    setSequencerError(null);
  }, [activeSessionState]);

  const onStopPianoRollPlayback = useCallback(() => {
    setPianoRollRunning(false);
    sendAllNotesOff(sequencerRef.current.pianoRollMidiChannel);
    pianoRollNoteSessionRef.current.clear();
  }, [sendAllNotesOff]);

  const onSaveSequencerConfig = useCallback(() => {
    try {
      const snapshot = buildSequencerConfigSnapshot();
      const payload = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `visualcsound-sequencer-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setSequencerError(null);
    } catch (error) {
      setSequencerError(error instanceof Error ? error.message : "Failed to save sequencer config.");
    }
  }, [buildSequencerConfigSnapshot]);

  const onLoadSequencerConfig = useCallback(
    (file: File) => {
      void file
        .text()
        .then((content) => {
          const parsed = JSON.parse(content);
          applySequencerConfigSnapshot(parsed);
          setSequencerError(null);
        })
        .catch((error) => {
          setSequencerError(error instanceof Error ? error.message : "Failed to load sequencer config.");
        });
    },
    [applySequencerConfigSnapshot]
  );

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
      sequencerPollInFlightRef.current = true;
      try {
        const status = await api.getSessionSequencerStatus(sessionId);
        applySequencerStatus(status);
      } catch (pollError) {
        setSequencerError(
          pollError instanceof Error ? `Failed to sync sequencer status: ${pollError.message}` : "Failed to sync sequencer status."
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
  }, [activeSessionId, applySequencerStatus, sequencer.isPlaying]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }

    const sessionId = sequencerSessionIdRef.current ?? activeSessionId;
    if (!sessionId) {
      return;
    }

    const syncTimer = window.setTimeout(() => {
      void api
        .configureSessionSequencer(sessionId, buildBackendSequencerConfig(sequencerRef.current))
        .then((status) => {
          applySequencerStatus(status);
        })
        .catch((syncError) => {
          setSequencerError(
            syncError instanceof Error ? `Failed to update sequencer config: ${syncError.message}` : "Failed to update sequencer config."
          );
        });
    }, 120);

    return () => {
      window.clearTimeout(syncTimer);
    };
  }, [
    activeSessionId,
    applySequencerStatus,
    buildBackendSequencerConfig,
    sequencer.isPlaying,
    sequencer.bpm,
    sequencer.midiChannel,
    sequencer.stepCount,
    sequencer.activePad,
    sequencer.queuedPad,
    sequencer.pads
  ]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      if (activeSessionState !== "running") {
        setPianoRollRunning(false);
      }
      return;
    }

    if (activeSessionState !== "running") {
      setPianoRollRunning(false);
      void stopSequencerTransport(false);
      setSequencerError("Session is no longer running. Sequencer transport stopped.");
    }
  }, [activeSessionState, sequencer.isPlaying, stopSequencerTransport]);

  useEffect(() => {
    return () => {
      void stopSequencerTransport(false);
    };
  }, [stopSequencerTransport]);

  const onDeleteSelection = useCallback(() => {
    if (selectedCount === 0) {
      return;
    }

    if (selectedCount > 1 && !window.confirm(`Delete ${selectedCount} selected elements?`)) {
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
  }, [currentPatch.graph, selectedCount, selection.connections, selection.nodeIds, setGraph]);

  const instrumentLayoutClassName = runtimePanelCollapsed
    ? "grid h-[68vh] grid-cols-1 gap-3 xl:grid-cols-[280px_1fr]"
    : "grid h-[68vh] grid-cols-1 gap-3 xl:grid-cols-[280px_1fr_340px]";

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#1e293b,_#020617_60%)] px-4 py-4 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-3">
        <header className="flex items-end justify-between gap-4 rounded-2xl border border-slate-700/70 bg-slate-900/65 px-4 py-2.5">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">VisualCSound</h1>
            <p className="mt-1 text-sm text-slate-400">
              Visual opcode patching with realtime CSound sessions and macOS MIDI loopback support.
            </p>
          </div>
          <div className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
            FastAPI + Rete.js
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
            Instrument Design
          </button>
          <button
            type="button"
            onClick={() => setActivePage("sequencer")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
              activePage === "sequencer" ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            Sequencer
          </button>
          <button
            type="button"
            onClick={() => setActivePage("config")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
              activePage === "config" ? "bg-accent/30 text-accent" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            Config
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
            {error}
          </div>
        )}

        {activePage === "instrument" && (
          <>
            <PatchToolbar
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
            />

            <main className={instrumentLayoutClassName}>
              <OpcodeCatalog opcodes={opcodes} onAddOpcode={addNodeFromOpcode} />

              <section className="flex h-full min-h-[440px] flex-col gap-2">
                <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    Graph Editor ({currentPatch.graph.nodes.length} nodes, {currentPatch.graph.connections.length} connections)
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-300">
                    <div className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                      Selected: {selection.nodeIds.length} opcode(s), {selection.connections.length} connection(s)
                    </div>
                    <div className="flex items-center gap-2">
                      {runtimePanelCollapsed ? (
                        <button
                          type="button"
                          onClick={() => setRuntimePanelCollapsed(false)}
                          className="rounded-md border border-accent/70 bg-accent/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent transition hover:bg-accent/25"
                          aria-label="Show runtime panel"
                          title="Show runtime panel"
                        >
                          Show Runtime
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={onDeleteSelection}
                        disabled={selectedCount === 0}
                        aria-label="Delete selected elements"
                        title={selectedCount > 0 ? "Delete selected elements" : "Select elements to delete"}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-600/70 bg-rose-950/60 text-rose-200 transition enabled:hover:bg-rose-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.9}>
                          <path d="M4 7h16" />
                          <path d="M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7" />
                          <path d="M6.2 7l.9 12.3A1.8 1.8 0 0 0 8.9 21h6.2a1.8 1.8 0 0 0 1.8-1.7L17.8 7" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <ReteNodeEditor
                    graph={currentPatch.graph}
                    opcodes={opcodes}
                    onGraphChange={onGraphChange}
                    onSelectionChange={setSelection}
                    onAddOpcodeAtPosition={addNodeFromOpcode}
                    onOpcodeHelpRequest={onOpcodeHelpRequest}
                  />
                </div>
              </section>

              {!runtimePanelCollapsed ? (
                <RuntimePanel
                  midiInputs={midiInputs}
                  selectedMidiInput={activeMidiInput}
                  compileOutput={compileOutput}
                  events={events}
                  onBindMidiInput={(midiInput) => {
                    void bindMidiInput(midiInput);
                  }}
                  onToggleCollapse={() => setRuntimePanelCollapsed(true)}
                />
              ) : null}
            </main>
          </>
        )}

        {activePage === "sequencer" && (
          <SequencerPage
            patches={patches}
            instrumentBindings={sequencerInstruments}
            sequencer={sequencer}
            instrumentsRunning={instrumentsRunning}
            pianoRollRunning={pianoRollRunning}
            sessionState={activeSessionState}
            midiInputName={activeMidiInputName}
            transportError={sequencerError}
            onAddInstrument={addSequencerInstrument}
            onRemoveInstrument={removeSequencerInstrument}
            onInstrumentPatchChange={updateSequencerInstrumentPatch}
            onInstrumentChannelChange={updateSequencerInstrumentChannel}
            onSaveConfig={onSaveSequencerConfig}
            onLoadConfig={onLoadSequencerConfig}
            onStartInstruments={onStartInstrumentEngine}
            onStopInstruments={onStopInstrumentEngine}
            onStartSequencerPlayback={onStartSequencerPlayback}
            onStopSequencerPlayback={onStopSequencerPlayback}
            onStartPianoRoll={onStartPianoRollPlayback}
            onStopPianoRoll={onStopPianoRollPlayback}
            onBpmChange={setSequencerBpm}
            onMidiChannelChange={setSequencerMidiChannel}
            onScaleChange={setSequencerScale}
            onModeChange={setSequencerMode}
            onStepCountChange={setSequencerStepCount}
            onStepNoteChange={setSequencerStepNote}
            onPadPress={(padIndex) => {
              if (!sequencerRef.current.isPlaying) {
                setSequencerActivePad(padIndex);
                return;
              }

              const sessionId = sequencerSessionIdRef.current ?? activeSessionId;
              if (!sessionId) {
                setSequencerError("No active session available for pad switching.");
                return;
              }

              void api
                .queueSessionSequencerPad(sessionId, sequencerRef.current.trackId, { pad_index: padIndex })
                .then((status) => {
                  setSequencerQueuedPad(padIndex);
                  applySequencerStatus(status);
                })
                .catch((queueError) => {
                  setSequencerError(
                    queueError instanceof Error ? `Failed to queue pad: ${queueError.message}` : "Failed to queue pad."
                  );
                });
            }}
            onPianoRollMidiChannelChange={setPianoRollMidiChannel}
            onPianoRollScaleChange={setPianoRollScale}
            onPianoRollModeChange={setPianoRollMode}
            onPianoRollNoteOn={onPianoRollNoteOn}
            onPianoRollNoteOff={onPianoRollNoteOff}
            onResetPlayhead={() => {
              setSequencerPlayhead(0);
            }}
            onAllNotesOff={onSequencerAllNotesOff}
          />
        )}

        {activePage === "config" && (
          <ConfigPage
            audioRate={currentPatch.graph.engine_config.sr}
            controlRate={currentPatch.graph.engine_config.control_rate}
            ksmps={currentPatch.graph.engine_config.ksmps}
            onAudioRateChange={setEngineAudioRate}
            onControlRateChange={setEngineControlRate}
          />
        )}
      </div>

      {selectedOpcodeDocumentation && (
        <OpcodeDocumentationModal
          opcode={selectedOpcodeDocumentation}
          onClose={() => setActiveOpcodeDocumentation(null)}
        />
      )}
    </div>
  );
}
