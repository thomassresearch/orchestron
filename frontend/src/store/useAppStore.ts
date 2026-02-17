import { create } from "zustand";

import { api } from "../api/client";
import { createUntitledPatch } from "../lib/defaultPatch";
import type {
  CompileResponse,
  MidiInputRef,
  NodeInstance,
  OpcodeSpec,
  Patch,
  PatchGraph,
  PatchListItem,
  SessionEvent,
  SessionState
} from "../types";

interface EditablePatch {
  id?: string;
  name: string;
  description: string;
  schema_version: number;
  graph: PatchGraph;
  created_at?: string;
  updated_at?: string;
}

interface AppStore {
  loading: boolean;
  error: string | null;

  opcodes: OpcodeSpec[];
  patches: PatchListItem[];
  midiInputs: MidiInputRef[];

  currentPatch: EditablePatch;
  activeSessionId: string | null;
  activeSessionState: SessionState;
  activeMidiInput: string | null;
  compileOutput: CompileResponse | null;

  events: SessionEvent[];

  loadBootstrap: () => Promise<void>;
  loadPatch: (patchId: string) => Promise<void>;
  newPatch: () => void;
  setCurrentPatchMeta: (name: string, description: string) => void;
  setGraph: (graph: PatchGraph) => void;
  addNodeFromOpcode: (opcode: OpcodeSpec) => void;
  removeNode: (nodeId: string) => void;
  removeConnection: (connectionIndex: number) => void;
  saveCurrentPatch: () => Promise<void>;

  ensureSession: () => Promise<string>;
  compileSession: () => Promise<void>;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  panicSession: () => Promise<void>;
  bindMidiInput: (midiInput: string) => Promise<void>;

  pushEvent: (event: SessionEvent) => void;
}

const OPCODE_PARAM_DEFAULTS: Record<string, Record<string, string | number | boolean>> = {
  const_a: { value: 0 },
  const_i: { value: 0 },
  const_k: { value: 0 }
};

function defaultParams(opcode: OpcodeSpec): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  for (const input of opcode.inputs) {
    if (input.default !== undefined && input.default !== null) {
      params[input.id] = input.default;
    }
  }
  const opcodeDefaults = OPCODE_PARAM_DEFAULTS[opcode.name];
  if (opcodeDefaults) {
    Object.assign(params, opcodeDefaults);
  }
  return params;
}

function randomPosition(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 80 + col * 220, y: 80 + row * 150 };
}

function normalizePatch(patch: Patch): EditablePatch {
  return {
    id: patch.id,
    name: patch.name,
    description: patch.description,
    schema_version: patch.schema_version,
    graph: patch.graph,
    created_at: patch.created_at,
    updated_at: patch.updated_at
  };
}

export const useAppStore = create<AppStore>((set, get) => ({
  loading: false,
  error: null,

  opcodes: [],
  patches: [],
  midiInputs: [],

  currentPatch: createUntitledPatch(),
  activeSessionId: null,
  activeSessionState: "idle",
  activeMidiInput: null,
  compileOutput: null,

  events: [],

  loadBootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const [opcodes, patches, midiInputs] = await Promise.all([
        api.listOpcodes(),
        api.listPatches(),
        api.listMidiInputs()
      ]);

      let currentPatch = get().currentPatch;
      if (patches.length > 0) {
        const full = await api.getPatch(patches[0].id);
        currentPatch = normalizePatch(full);
      }

      set({
        opcodes,
        patches,
        midiInputs,
        activeMidiInput: midiInputs.length > 0 ? midiInputs[0].id : null,
        currentPatch,
        loading: false,
        error: null
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load bootstrap data"
      });
    }
  },

  loadPatch: async (patchId) => {
    set({ loading: true, error: null });
    try {
      const patch = await api.getPatch(patchId);
      set({ currentPatch: normalizePatch(patch), loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load patch"
      });
    }
  },

  newPatch: () => {
    set({
      currentPatch: createUntitledPatch(),
      activeSessionId: null,
      activeSessionState: "idle",
      compileOutput: null
    });
  },

  setCurrentPatchMeta: (name, description) => {
    const current = get().currentPatch;
    set({
      currentPatch: {
        ...current,
        name,
        description
      }
    });
  },

  setGraph: (graph) => {
    const current = get().currentPatch;
    set({ currentPatch: { ...current, graph } });
  },

  addNodeFromOpcode: (opcode) => {
    const current = get().currentPatch;
    const index = current.graph.nodes.length;

    const node: NodeInstance = {
      id: crypto.randomUUID(),
      opcode: opcode.name,
      params: defaultParams(opcode),
      position: randomPosition(index)
    };

    set({
      currentPatch: {
        ...current,
        graph: {
          ...current.graph,
          nodes: [...current.graph.nodes, node]
        }
      }
    });
  },

  removeNode: (nodeId) => {
    const current = get().currentPatch;
    set({
      currentPatch: {
        ...current,
        graph: {
          ...current.graph,
          nodes: current.graph.nodes.filter((node) => node.id !== nodeId),
          connections: current.graph.connections.filter(
            (connection) => connection.from_node_id !== nodeId && connection.to_node_id !== nodeId
          )
        }
      }
    });
  },

  removeConnection: (connectionIndex) => {
    const current = get().currentPatch;
    set({
      currentPatch: {
        ...current,
        graph: {
          ...current.graph,
          connections: current.graph.connections.filter((_, index) => index !== connectionIndex)
        }
      }
    });
  },

  saveCurrentPatch: async () => {
    const current = get().currentPatch;
    set({ loading: true, error: null });

    try {
      const payload = {
        name: current.name,
        description: current.description,
        schema_version: current.schema_version,
        graph: current.graph
      };

      let saved: Patch;
      if (current.id) {
        saved = await api.updatePatch(current.id, payload);
      } else {
        saved = await api.createPatch(payload);
      }

      const patches = await api.listPatches();
      set({
        currentPatch: normalizePatch(saved),
        patches,
        loading: false
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to save patch"
      });
    }
  },

  ensureSession: async () => {
    let sessionId = get().activeSessionId;
    if (sessionId) {
      return sessionId;
    }

    if (!get().currentPatch.id) {
      await get().saveCurrentPatch();
    }

    const patchId = get().currentPatch.id;
    if (!patchId) {
      throw new Error("Patch must be saved before creating a runtime session.");
    }

    const session = await api.createSession(patchId);
    sessionId = session.session_id;
    const midiInput = get().activeMidiInput;
    if (midiInput) {
      try {
        await api.bindMidiInput(sessionId, midiInput);
      } catch {
        // Keep session creation successful even if MIDI binding fails.
      }
    }
    set({
      activeSessionId: sessionId,
      activeSessionState: session.state,
      activeMidiInput: midiInput
    });
    return sessionId;
  },

  compileSession: async () => {
    set({ loading: true, error: null });
    try {
      const sessionId = await get().ensureSession();
      await get().saveCurrentPatch();
      const compileOutput = await api.compileSession(sessionId);
      set({
        compileOutput,
        activeSessionState: compileOutput.state,
        loading: false
      });
    } catch (error) {
      set({
        loading: false,
        activeSessionState: "error",
        error: error instanceof Error ? error.message : "Failed to compile session"
      });
    }
  },

  startSession: async () => {
    set({ loading: true, error: null });
    try {
      const sessionId = await get().ensureSession();
      const response = await api.startSession(sessionId);
      set({ activeSessionState: response.state, loading: false });
    } catch (error) {
      set({
        loading: false,
        activeSessionState: "error",
        error: error instanceof Error ? error.message : "Failed to start session"
      });
    }
  },

  stopSession: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;

    set({ loading: true, error: null });
    try {
      const response = await api.stopSession(sessionId);
      set({ activeSessionState: response.state, loading: false });
    } catch (error) {
      set({
        loading: false,
        activeSessionState: "error",
        error: error instanceof Error ? error.message : "Failed to stop session"
      });
    }
  },

  panicSession: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;

    set({ loading: true, error: null });
    try {
      await api.panicSession(sessionId);
      set({ loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to send panic"
      });
    }
  },

  bindMidiInput: async (midiInput: string) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) {
      set({ activeMidiInput: midiInput });
      return;
    }

    set({ loading: true, error: null });
    try {
      const session = await api.bindMidiInput(sessionId, midiInput);
      set({
        activeSessionState: session.state,
        activeMidiInput: midiInput,
        loading: false
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to bind MIDI input"
      });
    }
  },

  pushEvent: (event: SessionEvent) => {
    const events = get().events;
    set({ events: [...events.slice(-199), event] });
  }
}));
