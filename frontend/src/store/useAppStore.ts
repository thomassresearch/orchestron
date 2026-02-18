import { create } from "zustand";

import { api } from "../api/client";
import { createUntitledPatch } from "../lib/defaultPatch";
import type {
  AppPage,
  CompileResponse,
  EngineConfig,
  JsonObject,
  MidiInputRef,
  NodeInstance,
  OpcodeSpec,
  Patch,
  PatchGraph,
  PatchListItem,
  SequencerState,
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

  activePage: AppPage;

  opcodes: OpcodeSpec[];
  patches: PatchListItem[];
  midiInputs: MidiInputRef[];

  currentPatch: EditablePatch;
  sequencer: SequencerState;

  activeSessionId: string | null;
  activeSessionState: SessionState;
  activeMidiInput: string | null;
  compileOutput: CompileResponse | null;

  events: SessionEvent[];

  setActivePage: (page: AppPage) => void;

  loadBootstrap: () => Promise<void>;
  loadPatch: (patchId: string) => Promise<void>;
  newPatch: () => void;
  setCurrentPatchMeta: (name: string, description: string) => void;
  setGraph: (graph: PatchGraph) => void;
  addNodeFromOpcode: (opcode: OpcodeSpec) => void;
  removeNode: (nodeId: string) => void;
  removeConnection: (connectionIndex: number) => void;
  saveCurrentPatch: () => Promise<void>;

  setSequencerBpm: (bpm: number) => void;
  setSequencerMidiChannel: (channel: number) => void;
  setSequencerStepCount: (stepCount: 16 | 32) => void;
  setSequencerStepNote: (index: number, note: number | null) => void;
  setSequencerPlaying: (isPlaying: boolean) => void;
  setSequencerPlayhead: (playhead: number) => void;
  setEngineAudioRate: (sr: number) => void;
  setEngineControlRate: (controlRate: number) => void;

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

const DEFAULT_SEQUENCER_STEPS: Array<number | null> = Array.from({ length: 32 }, () => null);
const AUDIO_RATE_MIN = 22000;
const AUDIO_RATE_MAX = 48000;
const CONTROL_RATE_MIN = 25;
const CONTROL_RATE_MAX = 48000;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeStepCount(value: number): 16 | 32 {
  return value === 32 ? 32 : 16;
}

function normalizeStepNote(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clampInt(value, 0, 127);
}

function defaultSequencerState(): SequencerState {
  return {
    isPlaying: false,
    bpm: 120,
    midiChannel: 1,
    stepCount: 16,
    playhead: 0,
    steps: [...DEFAULT_SEQUENCER_STEPS]
  };
}

function parseSequencerState(graph: PatchGraph): SequencerState {
  const defaults = defaultSequencerState();
  const raw = graph.ui_layout.sequencer;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const sequencer = raw as Record<string, unknown>;
  const bpm = typeof sequencer.bpm === "number" ? clampInt(sequencer.bpm, 30, 300) : defaults.bpm;
  const midiChannel =
    typeof sequencer.midiChannel === "number" ? clampInt(sequencer.midiChannel, 1, 16) : defaults.midiChannel;
  const stepCount = typeof sequencer.stepCount === "number" ? normalizeStepCount(sequencer.stepCount) : defaults.stepCount;

  const steps = [...defaults.steps];
  if (Array.isArray(sequencer.steps)) {
    for (let index = 0; index < Math.min(32, sequencer.steps.length); index += 1) {
      steps[index] = normalizeStepNote(sequencer.steps[index]);
    }
  }

  return {
    ...defaults,
    bpm,
    midiChannel,
    stepCount,
    steps
  };
}

function sequencerLayout(sequencer: SequencerState): JsonObject {
  return {
    bpm: clampInt(sequencer.bpm, 30, 300),
    midiChannel: clampInt(sequencer.midiChannel, 1, 16),
    stepCount: normalizeStepCount(sequencer.stepCount),
    steps: Array.from({ length: 32 }, (_, index) => normalizeStepNote(sequencer.steps[index]))
  };
}

function withSequencerLayout(graph: PatchGraph, sequencer: SequencerState): PatchGraph {
  return {
    ...graph,
    ui_layout: {
      ...graph.ui_layout,
      sequencer: sequencerLayout(sequencer)
    }
  };
}

function normalizeEngineConfig(raw: Partial<EngineConfig> | undefined): EngineConfig {
  const sr = clampInt(typeof raw?.sr === "number" ? raw.sr : 44100, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
  let controlRate = 4400;

  if (typeof raw?.control_rate === "number" && Number.isFinite(raw.control_rate)) {
    controlRate = clampInt(raw.control_rate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
  } else if (typeof raw?.ksmps === "number" && Number.isFinite(raw.ksmps) && raw.ksmps > 0) {
    const derivedControlRate = Math.round(sr / raw.ksmps);
    if (derivedControlRate >= CONTROL_RATE_MIN && derivedControlRate <= CONTROL_RATE_MAX) {
      controlRate = derivedControlRate;
    }
  }

  const ksmps = Math.max(1, Math.round(sr / controlRate));
  return {
    sr,
    control_rate: controlRate,
    ksmps,
    nchnls: typeof raw?.nchnls === "number" ? Math.max(1, Math.round(raw.nchnls)) : 2,
    "0dbfs": typeof raw?.["0dbfs"] === "number" ? raw["0dbfs"] : 1
  };
}

function withNormalizedEngineConfig(graph: PatchGraph): PatchGraph {
  return {
    ...graph,
    engine_config: normalizeEngineConfig(graph.engine_config)
  };
}

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
    graph: withNormalizedEngineConfig(patch.graph),
    created_at: patch.created_at,
    updated_at: patch.updated_at
  };
}

export const useAppStore = create<AppStore>((set, get) => ({
  loading: false,
  error: null,

  activePage: "instrument",

  opcodes: [],
  patches: [],
  midiInputs: [],

  currentPatch: (() => {
    const patch = createUntitledPatch();
    const sequencer = defaultSequencerState();
    return { ...patch, graph: withNormalizedEngineConfig(withSequencerLayout(patch.graph, sequencer)) };
  })(),
  sequencer: defaultSequencerState(),

  activeSessionId: null,
  activeSessionState: "idle",
  activeMidiInput: null,
  compileOutput: null,

  events: [],

  setActivePage: (page) => {
    set({ activePage: page });
  },

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

      const sequencer = parseSequencerState(currentPatch.graph);
      currentPatch = {
        ...currentPatch,
        graph: withNormalizedEngineConfig(withSequencerLayout(currentPatch.graph, sequencer))
      };

      set({
        opcodes,
        patches,
        midiInputs,
        activeMidiInput: midiInputs.length > 0 ? midiInputs[0].id : null,
        currentPatch,
        sequencer,
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
      const currentPatch = normalizePatch(patch);
      const sequencer = parseSequencerState(currentPatch.graph);
      set({
        currentPatch: {
          ...currentPatch,
          graph: withNormalizedEngineConfig(withSequencerLayout(currentPatch.graph, sequencer))
        },
        sequencer,
        loading: false
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load patch"
      });
    }
  },

  newPatch: () => {
    const patch = createUntitledPatch();
    const sequencer = defaultSequencerState();

    set({
      currentPatch: {
        ...patch,
        graph: withNormalizedEngineConfig(withSequencerLayout(patch.graph, sequencer))
      },
      sequencer,
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
    const sequencer = get().sequencer;
    set({
      currentPatch: {
        ...current,
        graph: withNormalizedEngineConfig(withSequencerLayout(graph, sequencer))
      }
    });
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
    const sequencer = get().sequencer;
    const current = {
      ...get().currentPatch,
      graph: withNormalizedEngineConfig(withSequencerLayout(get().currentPatch.graph, sequencer))
    };

    set({ loading: true, error: null, currentPatch: current });

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
      const normalizedPatch = normalizePatch(saved);
      const normalizedSequencer = parseSequencerState(normalizedPatch.graph);

      set({
        currentPatch: {
          ...normalizedPatch,
          graph: withNormalizedEngineConfig(withSequencerLayout(normalizedPatch.graph, normalizedSequencer))
        },
        sequencer: normalizedSequencer,
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

  setSequencerBpm: (bpm) => {
    const currentPatch = get().currentPatch;
    const sequencer = {
      ...get().sequencer,
      bpm: clampInt(bpm, 30, 300)
    };

    set({
      sequencer,
      currentPatch: {
        ...currentPatch,
        graph: withSequencerLayout(currentPatch.graph, sequencer)
      }
    });
  },

  setSequencerMidiChannel: (channel) => {
    const currentPatch = get().currentPatch;
    const sequencer = {
      ...get().sequencer,
      midiChannel: clampInt(channel, 1, 16)
    };

    set({
      sequencer,
      currentPatch: {
        ...currentPatch,
        graph: withSequencerLayout(currentPatch.graph, sequencer)
      }
    });
  },

  setSequencerStepCount: (stepCount) => {
    const currentPatch = get().currentPatch;
    const sequencer = {
      ...get().sequencer,
      stepCount: normalizeStepCount(stepCount),
      playhead: get().sequencer.playhead % normalizeStepCount(stepCount)
    };

    set({
      sequencer,
      currentPatch: {
        ...currentPatch,
        graph: withSequencerLayout(currentPatch.graph, sequencer)
      }
    });
  },

  setSequencerStepNote: (index, note) => {
    if (index < 0 || index >= 32) {
      return;
    }

    const currentPatch = get().currentPatch;
    const sequencer = get().sequencer;
    const steps = [...sequencer.steps];
    steps[index] = normalizeStepNote(note);

    const nextSequencer: SequencerState = {
      ...sequencer,
      steps
    };

    set({
      sequencer: nextSequencer,
      currentPatch: {
        ...currentPatch,
        graph: withSequencerLayout(currentPatch.graph, nextSequencer)
      }
    });
  },

  setSequencerPlaying: (isPlaying) => {
    const sequencer = get().sequencer;
    set({
      sequencer: {
        ...sequencer,
        isPlaying
      }
    });
  },

  setSequencerPlayhead: (playhead) => {
    const sequencer = get().sequencer;
    const boundedStepCount = normalizeStepCount(sequencer.stepCount);
    const normalizedPlayhead = ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;
    set({
      sequencer: {
        ...sequencer,
        playhead: normalizedPlayhead
      }
    });
  },

  setEngineAudioRate: (sr) => {
    const currentPatch = get().currentPatch;
    const currentEngine = normalizeEngineConfig(currentPatch.graph.engine_config);
    const nextSr = clampInt(sr, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
    const nextKsmps = Math.max(1, Math.round(nextSr / currentEngine.control_rate));

    set({
      currentPatch: {
        ...currentPatch,
        graph: {
          ...currentPatch.graph,
          engine_config: {
            ...currentEngine,
            sr: nextSr,
            ksmps: nextKsmps
          }
        }
      }
    });
  },

  setEngineControlRate: (controlRate) => {
    const currentPatch = get().currentPatch;
    const currentEngine = normalizeEngineConfig(currentPatch.graph.engine_config);
    const nextControlRate = clampInt(controlRate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
    const nextKsmps = Math.max(1, Math.round(currentEngine.sr / nextControlRate));

    set({
      currentPatch: {
        ...currentPatch,
        graph: {
          ...currentPatch.graph,
          engine_config: {
            ...currentEngine,
            control_rate: nextControlRate,
            ksmps: nextKsmps
          }
        }
      }
    });
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
