import { useCallback, useEffect, useState } from "react";

import { wsBaseUrl } from "./api/client";
import { OpcodeCatalog } from "./components/OpcodeCatalog";
import { PatchToolbar } from "./components/PatchToolbar";
import { ReteNodeEditor, type EditorSelection } from "./components/ReteNodeEditor";
import { RuntimePanel } from "./components/RuntimePanel";
import { useAppStore } from "./store/useAppStore";
import type { Connection, PatchGraph } from "./types";

function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

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

  const [selection, setSelection] = useState<EditorSelection>({
    nodeIds: [],
    connections: []
  });

  const selectedCount = selection.nodeIds.length + selection.connections.length;

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
      </div>
    </div>
  );
}
