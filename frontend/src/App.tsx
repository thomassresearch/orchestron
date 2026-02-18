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
  allNotesOffMessages,
  findMatchingMidiOutput,
  nextSequencerStep,
  noteOffMessage,
  noteOnMessage,
  resolveMidiInputName,
  sequencerGateDurationMs,
  sequencerStepDurationMs
} from "./lib/sequencer";
import { useAppStore } from "./store/useAppStore";
import type { Connection, PatchGraph } from "./types";

type TransportMode = "webmidi" | "backend" | "none";

function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

function hasWebMidiSupport(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return typeof (navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> }).requestMIDIAccess === "function";
}

async function requestMidiAccess(): Promise<MIDIAccess> {
  if (typeof navigator === "undefined") {
    throw new Error("Web MIDI is unavailable in this environment.");
  }
  const browserNavigator = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  if (!browserNavigator.requestMIDIAccess) {
    throw new Error("Web MIDI not available in this browser. Use Chrome or Edge.");
  }
  return browserNavigator.requestMIDIAccess();
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
  const setSequencerStepCount = useAppStore((state) => state.setSequencerStepCount);
  const setSequencerStepNote = useAppStore((state) => state.setSequencerStepNote);
  const setSequencerPlaying = useAppStore((state) => state.setSequencerPlaying);
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

  const sequencerRef = useRef(sequencer);
  const intervalRef = useRef<number | null>(null);
  const noteOffTimersRef = useRef<Set<number>>(new Set());
  const midiOutputRef = useRef<MIDIOutput | null>(null);
  const currentStepRef = useRef(0);
  const activeVoiceRef = useRef<{ note: number; channel: number } | null>(null);
  const transportModeRef = useRef<TransportMode>("none");
  const transportSessionIdRef = useRef<string | null>(null);
  const transportFailureRef = useRef(false);

  useEffect(() => {
    sequencerRef.current = sequencer;
  }, [sequencer]);

  const activeMidiInputName = useMemo(
    () => resolveMidiInputName(activeMidiInput, midiInputs),
    [activeMidiInput, midiInputs]
  );

  const webMidiSupported = hasWebMidiSupport();

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

  const clearNoteOffTimers = useCallback(() => {
    for (const timerId of noteOffTimersRef.current) {
      window.clearTimeout(timerId);
    }
    noteOffTimersRef.current.clear();
  }, []);

  const sendBackendMidiEvent = useCallback(
    async (
      payload: { type: "note_on" | "note_off" | "all_notes_off"; channel: number; note?: number; velocity?: number },
      sessionIdOverride?: string
    ) => {
      const sessionId = sessionIdOverride ?? transportSessionIdRef.current;
      if (!sessionId) {
        throw new Error("No active runtime session available for backend MIDI fallback.");
      }
      await api.sendSessionMidiEvent(sessionId, payload);
    },
    []
  );

  const sendAllNotesOff = useCallback(
    (channel: number) => {
      if (transportModeRef.current === "webmidi") {
        if (!midiOutputRef.current) {
          return;
        }
        try {
          for (const message of allNotesOffMessages(channel)) {
            midiOutputRef.current.send(message);
          }
        } catch {
          // Ignore transient MIDI transport errors.
        }
        return;
      }

      if (transportModeRef.current === "backend") {
        void sendBackendMidiEvent({ type: "all_notes_off", channel }).catch(() => {
          // Ignore best-effort all-notes-off failures during transport shutdown.
        });
      }
    },
    [sendBackendMidiEvent]
  );

  const releaseActiveVoice = useCallback(() => {
    const activeVoice = activeVoiceRef.current;
    if (!activeVoice) {
      return;
    }

    if (transportModeRef.current === "webmidi") {
      if (!midiOutputRef.current) {
        activeVoiceRef.current = null;
        return;
      }
      try {
        midiOutputRef.current.send(noteOffMessage(activeVoice.note, activeVoice.channel));
      } catch {
        // Ignore transient MIDI transport errors.
      } finally {
        activeVoiceRef.current = null;
      }
      return;
    }

    if (transportModeRef.current === "backend") {
      void sendBackendMidiEvent({
        type: "note_off",
        channel: activeVoice.channel,
        note: activeVoice.note
      }).catch(() => {
        // Ignore best-effort note-off failures; panic/all-notes-off remains available.
      });
      activeVoiceRef.current = null;
      return;
    }

    activeVoiceRef.current = null;
  }, [sendBackendMidiEvent]);

  const stopSequencerTransport = useCallback(
    (resetPlayhead: boolean) => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      clearNoteOffTimers();
      releaseActiveVoice();
      sendAllNotesOff(sequencerRef.current.midiChannel);

      transportModeRef.current = "none";
      transportSessionIdRef.current = null;
      transportFailureRef.current = false;
      midiOutputRef.current = null;

      setSequencerPlaying(false);
      if (resetPlayhead) {
        currentStepRef.current = 0;
        setSequencerPlayhead(0);
      }
    },
    [clearNoteOffTimers, releaseActiveVoice, sendAllNotesOff, setSequencerPlayhead, setSequencerPlaying]
  );

  const handleTransportFailure = useCallback(
    (message: string, cause?: unknown) => {
      if (transportFailureRef.current) {
        return;
      }
      transportFailureRef.current = true;
      stopSequencerTransport(true);
      if (cause instanceof Error && cause.message.length > 0) {
        setSequencerError(`${message}: ${cause.message}`);
      } else {
        setSequencerError(message);
      }
    },
    [stopSequencerTransport]
  );

  const startSequencerTransport = useCallback(async () => {
    setSequencerError(null);

    const midiTargetName = activeMidiInputName;
    if (!midiTargetName) {
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

      transportSessionIdRef.current = sessionId;
      transportFailureRef.current = false;

      let usingBackendFallback = true;
      if (webMidiSupported) {
        try {
          const access = await requestMidiAccess();
          const output = findMatchingMidiOutput(access, midiTargetName);
          if (output) {
            midiOutputRef.current = output;
            transportModeRef.current = "webmidi";
            usingBackendFallback = false;
          }
        } catch {
          usingBackendFallback = true;
        }
      }

      if (usingBackendFallback) {
        transportModeRef.current = "backend";
        midiOutputRef.current = null;
        await sendBackendMidiEvent(
          { type: "all_notes_off", channel: sequencerRef.current.midiChannel },
          sessionId
        );
      }

      currentStepRef.current = sequencerRef.current.playhead % sequencerRef.current.stepCount;
      setSequencerPlaying(true);
    } catch (transportError) {
      stopSequencerTransport(true);
      setSequencerError(transportError instanceof Error ? transportError.message : "Failed to start sequencer.");
    }
  }, [
    activeMidiInputName,
    ensureSession,
    sendBackendMidiEvent,
    setSequencerPlaying,
    startSession,
    stopSequencerTransport,
    webMidiSupported
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
    stopSequencerTransport(true);
  }, [stopSequencerTransport]);

  const onSequencerAllNotesOff = useCallback(() => {
    clearNoteOffTimers();
    releaseActiveVoice();
    sendAllNotesOff(sequencerRef.current.midiChannel);
    setSequencerError(null);
  }, [clearNoteOffTimers, releaseActiveVoice, sendAllNotesOff]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }

    const stepDurationMs = sequencerStepDurationMs(sequencer.bpm);

    const tick = () => {
      const mode = transportModeRef.current;
      if (mode !== "webmidi" && mode !== "backend") {
        handleTransportFailure("Sequencer transport is not initialized.");
        return;
      }

      const state = sequencerRef.current;
      const stepCount = state.stepCount;
      const stepIndex = ((currentStepRef.current % stepCount) + stepCount) % stepCount;
      const note = state.steps[stepIndex];
      const channel = state.midiChannel;

      setSequencerPlayhead(stepIndex);
      releaseActiveVoice();

      if (note !== null) {
        if (mode === "webmidi") {
          const output = midiOutputRef.current;
          if (!output) {
            handleTransportFailure("MIDI output disconnected. Sequencer transport stopped.");
            return;
          }

          try {
            output.send(noteOnMessage(note, channel));
            activeVoiceRef.current = { note, channel };

            const gateTimer = window.setTimeout(() => {
              noteOffTimersRef.current.delete(gateTimer);

              const activeVoice = activeVoiceRef.current;
              if (!activeVoice || activeVoice.note !== note || activeVoice.channel !== channel) {
                return;
              }

              try {
                midiOutputRef.current?.send(noteOffMessage(note, channel));
              } catch {
                // Ignore transient MIDI transport errors.
              } finally {
                activeVoiceRef.current = null;
              }
            }, sequencerGateDurationMs(stepDurationMs));

            noteOffTimersRef.current.add(gateTimer);
          } catch {
            handleTransportFailure("Failed to send MIDI note events. Sequencer transport stopped.");
            return;
          }
        } else {
          const sessionId = transportSessionIdRef.current;
          if (!sessionId) {
            handleTransportFailure("No active session for backend MIDI fallback.");
            return;
          }

          activeVoiceRef.current = { note, channel };
          void sendBackendMidiEvent({ type: "note_on", channel, note, velocity: 100 }, sessionId).catch((eventError) => {
            handleTransportFailure("Failed to send backend MIDI note_on", eventError);
          });

          const gateTimer = window.setTimeout(() => {
            noteOffTimersRef.current.delete(gateTimer);

            const activeVoice = activeVoiceRef.current;
            if (!activeVoice || activeVoice.note !== note || activeVoice.channel !== channel) {
              return;
            }

            void sendBackendMidiEvent({ type: "note_off", channel, note }, sessionId).catch((eventError) => {
              handleTransportFailure("Failed to send backend MIDI note_off", eventError);
            });
            activeVoiceRef.current = null;
          }, sequencerGateDurationMs(stepDurationMs));

          noteOffTimersRef.current.add(gateTimer);
        }
      }

      currentStepRef.current = nextSequencerStep(stepIndex, stepCount);
    };

    tick();
    intervalRef.current = window.setInterval(tick, stepDurationMs);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [
    handleTransportFailure,
    releaseActiveVoice,
    sendBackendMidiEvent,
    sequencer.isPlaying,
    sequencer.bpm,
    setSequencerPlayhead
  ]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }

    if (activeSessionState !== "running" && activeSessionState !== "compiled") {
      stopSequencerTransport(false);
      setSequencerError("Session is no longer running. Sequencer transport stopped.");
    }
  }, [activeSessionState, sequencer.isPlaying, stopSequencerTransport]);

  useEffect(() => {
    return () => {
      stopSequencerTransport(false);
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
            stopSequencerTransport(false);
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
          <main className="grid h-[72vh] grid-cols-1 gap-4 xl:grid-cols-[300px_1fr_360px]">
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
                  onOpcodeHelpRequest={onOpcodeHelpRequest}
                />
              </div>
            </section>

            <RuntimePanel
              midiInputs={midiInputs}
              selectedMidiInput={activeMidiInput}
              compileOutput={compileOutput}
              events={events}
              onBindMidiInput={(midiInput) => {
                void bindMidiInput(midiInput);
              }}
            />
          </main>
        )}

        {activePage === "sequencer" && (
          <SequencerPage
            sequencer={sequencer}
            sessionState={activeSessionState}
            midiInputName={activeMidiInputName}
            transportError={sequencerError}
            webMidiSupported={webMidiSupported}
            onStartPlayback={onStartSequencerPlayback}
            onStopPlayback={onStopSequencerPlayback}
            onBpmChange={setSequencerBpm}
            onMidiChannelChange={setSequencerMidiChannel}
            onStepCountChange={setSequencerStepCount}
            onStepNoteChange={setSequencerStepNote}
            onResetPlayhead={() => {
              currentStepRef.current = 0;
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
