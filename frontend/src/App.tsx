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

export default function App() {
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);

  const activePage = useAppStore((state) => state.activePage);
  const setActivePage = useAppStore((state) => state.setActivePage);

  const opcodes = useAppStore((state) => state.opcodes);
  const patches = useAppStore((state) => state.patches);
  const midiInputs = useAppStore((state) => state.midiInputs);

  const currentPatch = useAppStore((state) => state.currentPatch);
  const sequencer = useAppStore((state) => state.sequencer);

  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activeSessionState = useAppStore((state) => state.activeSessionState);
  const activeMidiInput = useAppStore((state) => state.activeMidiInput);
  const compileOutput = useAppStore((state) => state.compileOutput);
  const events = useAppStore((state) => state.events);

  const loadBootstrap = useAppStore((state) => state.loadBootstrap);
  const loadPatch = useAppStore((state) => state.loadPatch);
  const newPatch = useAppStore((state) => state.newPatch);
  const setCurrentPatchMeta = useAppStore((state) => state.setCurrentPatchMeta);
  const setGraph = useAppStore((state) => state.setGraph);
  const addNodeFromOpcode = useAppStore((state) => state.addNodeFromOpcode);
  const saveCurrentPatch = useAppStore((state) => state.saveCurrentPatch);
  const compileSession = useAppStore((state) => state.compileSession);
  const ensureSession = useAppStore((state) => state.ensureSession);
  const startSession = useAppStore((state) => state.startSession);
  const stopSession = useAppStore((state) => state.stopSession);
  const panicSession = useAppStore((state) => state.panicSession);
  const bindMidiInput = useAppStore((state) => state.bindMidiInput);
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

  const sequencerRef = useRef(sequencer);
  const sequencerSessionIdRef = useRef<string | null>(null);
  const sequencerStatusPollRef = useRef<number | null>(null);
  const sequencerPollInFlightRef = useRef(false);

  useEffect(() => {
    sequencerRef.current = sequencer;
  }, [sequencer]);

  const activeMidiInputName = useMemo(
    () => resolveMidiInputName(activeMidiInput, midiInputs),
    [activeMidiInput, midiInputs]
  );

  const selectedCount = selection.nodeIds.length + selection.connections.length;
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
    if (!activeMidiInputName) {
      setSequencerError("Select and bind a MIDI input before starting the sequencer.");
      return;
    }

    try {
      const sessionId = await ensureSession();
      if (useAppStore.getState().activeSessionState !== "running") {
        await startSession();
      }
      const sessionState = useAppStore.getState().activeSessionState;
      if (sessionState !== "running" && sessionState !== "compiled") {
        throw new Error(`Session did not start successfully (state: ${sessionState}).`);
      }

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
    activeMidiInputName,
    applySequencerStatus,
    buildBackendSequencerConfig,
    ensureSession,
    startSession,
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

  const onSequencerAllNotesOff = useCallback(() => {
    sendAllNotesOff(sequencerRef.current.midiChannel);
    setSequencerError(null);
  }, [sendAllNotesOff]);

  const onPianoRollNoteTrigger = useCallback(
    (note: number, channel: number) => {
      setSequencerError(null);
      void (async () => {
        const sessionId = await ensureSession();
        if (useAppStore.getState().activeSessionState !== "running") {
          await startSession();
        }

        await sendDirectMidiEvent({ type: "note_on", channel, note, velocity: 110 }, sessionId);
        window.setTimeout(() => {
          void sendDirectMidiEvent({ type: "note_off", channel, note }, sessionId).catch(() => {
            // Ignore transient note-off failures during jam interaction.
          });
        }, 220);
      })().catch((error) => {
        setSequencerError(error instanceof Error ? error.message : "Failed to trigger piano roll note.");
      });
    },
    [ensureSession, sendDirectMidiEvent, startSession]
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
      return;
    }

    if (activeSessionState !== "running" && activeSessionState !== "compiled") {
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
    ? "grid h-[72vh] grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]"
    : "grid h-[72vh] grid-cols-1 gap-4 xl:grid-cols-[300px_1fr_360px]";

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#1e293b,_#020617_60%)] px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <header className="flex items-end justify-between gap-4 rounded-2xl border border-slate-700/70 bg-slate-900/65 px-4 py-3">
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

        <PatchToolbar
          patchName={currentPatch.name}
          patchDescription={currentPatch.description}
          patches={patches}
          currentPatchId={currentPatch.id}
          loading={loading}
          sessionState={activeSessionState}
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
          onStart={() => {
            void startSession();
          }}
          onStop={() => {
            void stopSequencerTransport(false);
            void stopSession();
          }}
          onPanic={() => {
            onSequencerAllNotesOff();
            void panicSession();
          }}
        />

        {error && (
          <div className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
            {error}
          </div>
        )}

        {activePage === "instrument" && (
          <main className={instrumentLayoutClassName}>
            <OpcodeCatalog opcodes={opcodes} onAddOpcode={addNodeFromOpcode} />

            <section className="flex h-full min-h-[480px] flex-col gap-2">
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  Graph Editor ({currentPatch.graph.nodes.length} nodes, {currentPatch.graph.connections.length} connections)
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-300">
                  <div className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1">
                    Selected: {selection.nodeIds.length} opcode(s), {selection.connections.length} connection(s)
                  </div>
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
        )}

        {activePage === "sequencer" && (
          <SequencerPage
            sequencer={sequencer}
            sessionState={activeSessionState}
            midiInputName={activeMidiInputName}
            transportError={sequencerError}
            onStartPlayback={onStartSequencerPlayback}
            onStopPlayback={onStopSequencerPlayback}
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
            onPianoRollNoteTrigger={onPianoRollNoteTrigger}
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
