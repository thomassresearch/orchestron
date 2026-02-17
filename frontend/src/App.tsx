import { useCallback, useEffect, useMemo, useState } from "react";

import { wsBaseUrl } from "./api/client";
import { OpcodeCatalog } from "./components/OpcodeCatalog";
import { PatchToolbar } from "./components/PatchToolbar";
import { ReteNodeEditor } from "./components/ReteNodeEditor";
import { RuntimePanel } from "./components/RuntimePanel";
import { useAppStore } from "./store/useAppStore";
import type { PatchGraph } from "./types";

export default function App() {
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);

  const opcodes = useAppStore((state) => state.opcodes);
  const patches = useAppStore((state) => state.patches);
  const midiInputs = useAppStore((state) => state.midiInputs);

  const currentPatch = useAppStore((state) => state.currentPatch);
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
  const removeNode = useAppStore((state) => state.removeNode);
  const removeConnection = useAppStore((state) => state.removeConnection);
  const saveCurrentPatch = useAppStore((state) => state.saveCurrentPatch);
  const compileSession = useAppStore((state) => state.compileSession);
  const startSession = useAppStore((state) => state.startSession);
  const stopSession = useAppStore((state) => state.stopSession);
  const panicSession = useAppStore((state) => state.panicSession);
  const bindMidiInput = useAppStore((state) => state.bindMidiInput);
  const pushEvent = useAppStore((state) => state.pushEvent);

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

  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [selectedConnectionIndex, setSelectedConnectionIndex] = useState<string>("");

  useEffect(() => {
    const { nodes } = currentPatch.graph;
    if (nodes.length === 0) {
      if (selectedNodeId !== "") {
        setSelectedNodeId("");
      }
      return;
    }

    const exists = nodes.some((node) => node.id === selectedNodeId);
    if (!exists) {
      setSelectedNodeId(nodes[0].id);
    }
  }, [currentPatch.graph.nodes, selectedNodeId]);

  useEffect(() => {
    const { connections } = currentPatch.graph;
    if (connections.length === 0) {
      if (selectedConnectionIndex !== "") {
        setSelectedConnectionIndex("");
      }
      return;
    }

    const parsed = Number.parseInt(selectedConnectionIndex, 10);
    const isValid =
      Number.isFinite(parsed) && parsed >= 0 && parsed < currentPatch.graph.connections.length;
    if (!isValid) {
      setSelectedConnectionIndex("0");
    }
  }, [currentPatch.graph.connections, selectedConnectionIndex]);

  const nodeLabelById = useMemo(() => {
    return new Map(
      currentPatch.graph.nodes.map((node) => [node.id, `${node.opcode} (${node.id.slice(0, 8)})`])
    );
  }, [currentPatch.graph.nodes]);

  const connectionLabels = useMemo(() => {
    return currentPatch.graph.connections.map((connection, index) => {
      const sourceLabel = nodeLabelById.get(connection.from_node_id) ?? connection.from_node_id;
      const targetLabel = nodeLabelById.get(connection.to_node_id) ?? connection.to_node_id;
      return {
        index,
        label: `${sourceLabel}.${connection.from_port_id} -> ${targetLabel}.${connection.to_port_id}`
      };
    });
  }, [currentPatch.graph.connections, nodeLabelById]);

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
            void stopSession();
          }}
          onPanic={() => {
            void panicSession();
          }}
        />

        {error && (
          <div className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
            {error}
          </div>
        )}

        <main className="grid h-[72vh] grid-cols-1 gap-4 xl:grid-cols-[300px_1fr_360px]">
          <OpcodeCatalog opcodes={opcodes} onAddOpcode={addNodeFromOpcode} />

          <section className="flex h-full min-h-[480px] flex-col gap-2">
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Graph Editor ({currentPatch.graph.nodes.length} nodes, {currentPatch.graph.connections.length} connections)
              </div>
              <div className="mt-2 grid gap-2 text-xs text-slate-300 2xl:grid-cols-2">
                <div className="flex items-center gap-2">
                  <select
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200"
                    value={selectedNodeId}
                    onChange={(event) => setSelectedNodeId(event.target.value)}
                    disabled={currentPatch.graph.nodes.length === 0}
                  >
                    {currentPatch.graph.nodes.length === 0 && <option value="">No opcode selected</option>}
                    {currentPatch.graph.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.opcode} ({node.id.slice(0, 8)})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedNodeId) {
                        removeNode(selectedNodeId);
                      }
                    }}
                    disabled={!selectedNodeId}
                    className="rounded-md border border-rose-600/70 bg-rose-950/60 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-rose-200 transition enabled:hover:bg-rose-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete Opcode
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200"
                    value={selectedConnectionIndex}
                    onChange={(event) => setSelectedConnectionIndex(event.target.value)}
                    disabled={connectionLabels.length === 0}
                  >
                    {connectionLabels.length === 0 && <option value="">No connection selected</option>}
                    {connectionLabels.map((connection) => (
                      <option key={connection.index} value={String(connection.index)}>
                        {connection.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const index = Number.parseInt(selectedConnectionIndex, 10);
                      if (Number.isFinite(index)) {
                        removeConnection(index);
                      }
                    }}
                    disabled={connectionLabels.length === 0}
                    className="rounded-md border border-rose-600/70 bg-rose-950/60 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-rose-200 transition enabled:hover:bg-rose-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete Connection
                  </button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ReteNodeEditor graph={currentPatch.graph} opcodes={opcodes} onGraphChange={onGraphChange} />
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
      </div>
    </div>
  );
}
