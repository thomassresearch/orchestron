import { create } from "zustand";

import { api } from "../api/client";
import { createUntitledPatch } from "../lib/defaultPatch";
import {
  defaultModeForScaleType,
  normalizeSequencerMode,
  normalizeSequencerScaleRoot,
  normalizeSequencerScaleType
} from "../lib/sequencer";
import type {
  AppPage,
  CompileResponse,
  EngineConfig,
  MidiInputRef,
  NodeInstance,
  NodePosition,
  OpcodeSpec,
  Patch,
  PatchGraph,
  PatchListItem,
  SequencerConfigSnapshot,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SessionEvent,
  SessionInstrumentAssignment,
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

interface InstrumentTabState {
  id: string;
  patch: EditablePatch;
}

interface AppStore {
  loading: boolean;
  error: string | null;

  activePage: AppPage;

  opcodes: OpcodeSpec[];
  patches: PatchListItem[];
  midiInputs: MidiInputRef[];

  instrumentTabs: InstrumentTabState[];
  activeInstrumentTabId: string;
  currentPatch: EditablePatch;

  sequencer: SequencerState;
  sequencerInstruments: SequencerInstrumentBinding[];

  activeSessionId: string | null;
  activeSessionState: SessionState;
  activeMidiInput: string | null;
  activeSessionInstruments: SessionInstrumentAssignment[];
  compileOutput: CompileResponse | null;

  events: SessionEvent[];

  setActivePage: (page: AppPage) => void;

  addInstrumentTab: () => void;
  closeInstrumentTab: (tabId: string) => void;
  setActiveInstrumentTab: (tabId: string) => void;

  loadBootstrap: () => Promise<void>;
  loadPatch: (patchId: string) => Promise<void>;
  newPatch: () => void;
  setCurrentPatchMeta: (name: string, description: string) => void;
  setGraph: (graph: PatchGraph) => void;
  addNodeFromOpcode: (opcode: OpcodeSpec, position?: NodePosition) => void;
  removeNode: (nodeId: string) => void;
  removeConnection: (connectionIndex: number) => void;
  saveCurrentPatch: () => Promise<void>;

  addSequencerInstrument: () => void;
  removeSequencerInstrument: (bindingId: string) => void;
  updateSequencerInstrumentPatch: (bindingId: string, patchId: string) => void;
  updateSequencerInstrumentChannel: (bindingId: string, channel: number) => void;
  buildSequencerConfigSnapshot: () => SequencerConfigSnapshot;
  applySequencerConfigSnapshot: (snapshot: unknown) => void;

  setSequencerBpm: (bpm: number) => void;
  setSequencerMidiChannel: (channel: number) => void;
  setSequencerScale: (scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  setSequencerMode: (mode: SequencerMode) => void;
  setPianoRollMidiChannel: (channel: number) => void;
  setPianoRollScale: (scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  setPianoRollMode: (mode: SequencerMode) => void;
  setSequencerStepCount: (stepCount: 16 | 32) => void;
  setSequencerStepNote: (index: number, note: number | null) => void;
  setSequencerActivePad: (padIndex: number) => void;
  setSequencerQueuedPad: (padIndex: number | null) => void;
  syncSequencerRuntime: (payload: {
    isPlaying: boolean;
    playhead?: number;
    cycle?: number;
    activePad?: number;
    queuedPad?: number | null;
  }) => void;
  setSequencerPlaying: (isPlaying: boolean) => void;
  setSequencerPlayhead: (playhead: number) => void;
  setEngineAudioRate: (sr: number) => void;
  setEngineControlRate: (controlRate: number) => void;

  ensureSession: () => Promise<string>;
  compileSession: () => Promise<CompileResponse | null>;
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
const DEFAULT_PAD_COUNT = 8;
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

function defaultSequencerPads(): Array<Array<number | null>> {
  return Array.from({ length: DEFAULT_PAD_COUNT }, () => [...DEFAULT_SEQUENCER_STEPS]);
}

function normalizePadIndex(value: number): number {
  return clampInt(value, 0, DEFAULT_PAD_COUNT - 1);
}

function normalizePadSteps(raw: unknown): Array<number | null> | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const steps = [...DEFAULT_SEQUENCER_STEPS];
  for (let index = 0; index < Math.min(32, raw.length); index += 1) {
    steps[index] = normalizeStepNote(raw[index]);
  }
  return steps;
}

function defaultSequencerState(): SequencerState {
  const pads = defaultSequencerPads();
  return {
    isPlaying: false,
    bpm: 120,
    midiChannel: 1,
    scaleRoot: "C",
    scaleType: "minor",
    mode: "aeolian",
    trackId: "voice-1",
    stepCount: 16,
    playhead: 0,
    cycle: 0,
    activePad: 0,
    queuedPad: null,
    pads,
    steps: [...pads[0]],
    pianoRollMidiChannel: 1,
    pianoRollScaleRoot: "C",
    pianoRollScaleType: "minor",
    pianoRollMode: "aeolian"
  };
}

function normalizeSequencerState(raw: unknown): SequencerState {
  const defaults = defaultSequencerState();

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const sequencer = raw as Record<string, unknown>;
  const bpm = typeof sequencer.bpm === "number" ? clampInt(sequencer.bpm, 30, 300) : defaults.bpm;
  const midiChannel =
    typeof sequencer.midiChannel === "number" ? clampInt(sequencer.midiChannel, 1, 16) : defaults.midiChannel;
  const scaleRoot = normalizeSequencerScaleRoot(sequencer.scaleRoot);
  const scaleType = normalizeSequencerScaleType(sequencer.scaleType);
  const fallbackMode = defaultModeForScaleType(scaleType);
  const mode = sequencer.mode !== undefined ? normalizeSequencerMode(sequencer.mode) : fallbackMode;
  const trackId = typeof sequencer.trackId === "string" && sequencer.trackId.length > 0 ? sequencer.trackId : defaults.trackId;
  const stepCount = typeof sequencer.stepCount === "number" ? normalizeStepCount(sequencer.stepCount) : defaults.stepCount;
  const activePad =
    typeof sequencer.activePad === "number" ? normalizePadIndex(sequencer.activePad) : defaults.activePad;
  const queuedPad =
    typeof sequencer.queuedPad === "number" ? normalizePadIndex(sequencer.queuedPad) : null;

  const pads = defaultSequencerPads();
  if (Array.isArray(sequencer.pads)) {
    for (let index = 0; index < Math.min(DEFAULT_PAD_COUNT, sequencer.pads.length); index += 1) {
      const normalized = normalizePadSteps(sequencer.pads[index]);
      if (normalized) {
        pads[index] = normalized;
      }
    }
  } else if (Array.isArray(sequencer.steps)) {
    const legacy = normalizePadSteps(sequencer.steps);
    if (legacy) {
      pads[0] = legacy;
    }
  }

  const steps = [...pads[activePad]];

  const pianoRollMidiChannel =
    typeof sequencer.pianoRollMidiChannel === "number"
      ? clampInt(sequencer.pianoRollMidiChannel, 1, 16)
      : defaults.pianoRollMidiChannel;
  const pianoRollScaleRoot = normalizeSequencerScaleRoot(sequencer.pianoRollScaleRoot);
  const pianoRollScaleType = normalizeSequencerScaleType(sequencer.pianoRollScaleType);
  const pianoRollFallbackMode = defaultModeForScaleType(pianoRollScaleType);
  const pianoRollMode =
    sequencer.pianoRollMode !== undefined ? normalizeSequencerMode(sequencer.pianoRollMode) : pianoRollFallbackMode;

  return {
    ...defaults,
    bpm,
    midiChannel,
    scaleRoot,
    scaleType,
    mode,
    trackId,
    stepCount,
    cycle: 0,
    activePad,
    queuedPad,
    pads,
    steps,
    pianoRollMidiChannel,
    pianoRollScaleRoot,
    pianoRollScaleType,
    pianoRollMode
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

function defaultEditablePatch(): EditablePatch {
  const patch = createUntitledPatch();
  return {
    ...patch,
    graph: withNormalizedEngineConfig(patch.graph)
  };
}

function createInstrumentTab(patch = defaultEditablePatch()): InstrumentTabState {
  return {
    id: crypto.randomUUID(),
    patch
  };
}

function updatePatchInTabs(tabs: InstrumentTabState[], tabId: string, patch: EditablePatch): InstrumentTabState[] {
  let found = false;
  const next = tabs.map((tab) => {
    if (tab.id !== tabId) {
      return tab;
    }
    found = true;
    return {
      ...tab,
      patch
    };
  });

  if (found) {
    return next;
  }
  return [...tabs, { id: tabId, patch }];
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

function defaultSequencerInstruments(patches: PatchListItem[], currentPatchId?: string): SequencerInstrumentBinding[] {
  const patchId = patches[0]?.id ?? currentPatchId;
  if (!patchId) {
    return [];
  }
  return [
    {
      id: crypto.randomUUID(),
      patchId,
      midiChannel: 1
    }
  ];
}

function nextAvailableMidiChannel(bindings: SequencerInstrumentBinding[]): number {
  const occupied = new Set(bindings.map((binding) => clampInt(binding.midiChannel, 1, 16)));
  for (let channel = 1; channel <= 16; channel += 1) {
    if (!occupied.has(channel)) {
      return channel;
    }
  }
  return 1;
}

function buildSequencerConfigSnapshot(
  sequencer: SequencerState,
  instruments: SequencerInstrumentBinding[]
): SequencerConfigSnapshot {
  const pads = Array.from({ length: DEFAULT_PAD_COUNT }, (_, padIndex) =>
    Array.from({ length: 32 }, (_, stepIndex) => normalizeStepNote(sequencer.pads[padIndex]?.[stepIndex]))
  );

  return {
    version: 1,
    instruments: instruments
      .filter((instrument) => instrument.patchId.length > 0)
      .map((instrument) => ({
        patchId: instrument.patchId,
        midiChannel: clampInt(instrument.midiChannel, 1, 16)
      })),
    sequencer: {
      bpm: clampInt(sequencer.bpm, 30, 300),
      midiChannel: clampInt(sequencer.midiChannel, 1, 16),
      scaleRoot: normalizeSequencerScaleRoot(sequencer.scaleRoot),
      scaleType: normalizeSequencerScaleType(sequencer.scaleType),
      mode: normalizeSequencerMode(sequencer.mode),
      trackId: sequencer.trackId,
      stepCount: normalizeStepCount(sequencer.stepCount),
      activePad: normalizePadIndex(sequencer.activePad),
      queuedPad: sequencer.queuedPad === null ? null : normalizePadIndex(sequencer.queuedPad),
      pads,
      pianoRollMidiChannel: clampInt(sequencer.pianoRollMidiChannel, 1, 16),
      pianoRollScaleRoot: normalizeSequencerScaleRoot(sequencer.pianoRollScaleRoot),
      pianoRollScaleType: normalizeSequencerScaleType(sequencer.pianoRollScaleType),
      pianoRollMode: normalizeSequencerMode(sequencer.pianoRollMode)
    }
  };
}

function parseSequencerConfigSnapshot(
  snapshot: unknown,
  availablePatchIds: Set<string>,
  fallbackPatchId: string | null
): { sequencer: SequencerState; instruments: SequencerInstrumentBinding[] } {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Invalid sequencer config file.");
  }

  const payload = snapshot as Record<string, unknown>;
  if (payload.version !== 1) {
    throw new Error("Unsupported sequencer config version.");
  }

  const sequencer = normalizeSequencerState(payload.sequencer);
  const instrumentsRaw = Array.isArray(payload.instruments) ? payload.instruments : [];

  const instruments: SequencerInstrumentBinding[] = [];
  const seenChannels = new Set<number>();
  for (const entry of instrumentsRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.patchId !== "string" || record.patchId.length === 0) {
      continue;
    }
    if (!availablePatchIds.has(record.patchId)) {
      continue;
    }

    const midiChannel =
      typeof record.midiChannel === "number" ? clampInt(record.midiChannel, 1, 16) : 1;
    if (seenChannels.has(midiChannel)) {
      continue;
    }
    seenChannels.add(midiChannel);

    instruments.push({
      id: crypto.randomUUID(),
      patchId: record.patchId,
      midiChannel
    });
  }

  if (instruments.length === 0 && fallbackPatchId) {
    instruments.push({ id: crypto.randomUUID(), patchId: fallbackPatchId, midiChannel: 1 });
  }

  if (instruments.length === 0) {
    throw new Error("No valid instrument assignments found in config.");
  }

  return {
    sequencer,
    instruments
  };
}

function normalizeSessionInstrumentAssignments(
  bindings: SequencerInstrumentBinding[]
): SessionInstrumentAssignment[] {
  const assignments: SessionInstrumentAssignment[] = [];
  const seenChannels = new Set<number>();

  for (const binding of bindings) {
    if (!binding.patchId || binding.patchId.length === 0) {
      continue;
    }

    const midiChannel = clampInt(binding.midiChannel, 1, 16);
    if (seenChannels.has(midiChannel)) {
      throw new Error(`MIDI channel ${midiChannel} is assigned more than once.`);
    }

    seenChannels.add(midiChannel);
    assignments.push({
      patch_id: binding.patchId,
      midi_channel: midiChannel
    });
  }

  if (assignments.length === 0) {
    throw new Error("Add at least one sequencer instrument before starting the engine.");
  }

  return assignments;
}

function sortedAssignments(assignments: SessionInstrumentAssignment[]): SessionInstrumentAssignment[] {
  return [...assignments].sort((a, b) => {
    if (a.midi_channel !== b.midi_channel) {
      return a.midi_channel - b.midi_channel;
    }
    return a.patch_id.localeCompare(b.patch_id);
  });
}

function sameAssignments(a: SessionInstrumentAssignment[], b: SessionInstrumentAssignment[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const aSorted = sortedAssignments(a);
  const bSorted = sortedAssignments(b);
  for (let index = 0; index < aSorted.length; index += 1) {
    if (aSorted[index].midi_channel !== bSorted[index].midi_channel) {
      return false;
    }
    if (aSorted[index].patch_id !== bSorted[index].patch_id) {
      return false;
    }
  }

  return true;
}

const initialPatch = defaultEditablePatch();
const initialTab = createInstrumentTab(initialPatch);

export const useAppStore = create<AppStore>((set, get) => {
  const commitCurrentPatch = (patch: EditablePatch, extra?: Partial<AppStore>) => {
    const state = get();
    const instrumentTabs = updatePatchInTabs(state.instrumentTabs, state.activeInstrumentTabId, patch);
    set({
      ...extra,
      currentPatch: patch,
      instrumentTabs
    });
  };

  return {
    loading: false,
    error: null,

    activePage: "instrument",

    opcodes: [],
    patches: [],
    midiInputs: [],

    instrumentTabs: [initialTab],
    activeInstrumentTabId: initialTab.id,
    currentPatch: initialPatch,

    sequencer: defaultSequencerState(),
    sequencerInstruments: [],

    activeSessionId: null,
    activeSessionState: "idle",
    activeMidiInput: null,
    activeSessionInstruments: [],
    compileOutput: null,

    events: [],

    setActivePage: (page) => {
      set({ activePage: page });
    },

    addInstrumentTab: () => {
      const tab = createInstrumentTab();
      set((state) => ({
        instrumentTabs: [...state.instrumentTabs, tab],
        activeInstrumentTabId: tab.id,
        currentPatch: tab.patch
      }));
    },

    closeInstrumentTab: (tabId) => {
      const state = get();
      if (state.instrumentTabs.length <= 1) {
        const replacement = createInstrumentTab();
        set({
          instrumentTabs: [replacement],
          activeInstrumentTabId: replacement.id,
          currentPatch: replacement.patch
        });
        return;
      }

      const index = state.instrumentTabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) {
        return;
      }

      const nextTabs = state.instrumentTabs.filter((tab) => tab.id !== tabId);
      if (state.activeInstrumentTabId !== tabId) {
        set({ instrumentTabs: nextTabs });
        return;
      }

      const nextActive = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      set({
        instrumentTabs: nextTabs,
        activeInstrumentTabId: nextActive.id,
        currentPatch: nextActive.patch
      });
    },

    setActiveInstrumentTab: (tabId) => {
      const tab = get().instrumentTabs.find((candidate) => candidate.id === tabId);
      if (!tab) {
        return;
      }

      set({
        activeInstrumentTabId: tabId,
        currentPatch: tab.patch
      });
    },

    loadBootstrap: async () => {
      set({ loading: true, error: null });
      try {
        const [opcodes, patches, midiInputs] = await Promise.all([
          api.listOpcodes(),
          api.listPatches(),
          api.listMidiInputs()
        ]);

        let currentPatch = defaultEditablePatch();
        if (patches.length > 0) {
          const full = await api.getPatch(patches[0].id);
          currentPatch = normalizePatch(full);
        }

        const tab = createInstrumentTab(currentPatch);
        const sequencerInstruments = defaultSequencerInstruments(patches, currentPatch.id);
        const preferredMidi = get().activeMidiInput;
        const activeMidiInput =
          preferredMidi && midiInputs.some((input) => input.id === preferredMidi)
            ? preferredMidi
            : midiInputs[0]?.id ?? null;

        set({
          opcodes,
          patches,
          midiInputs,
          activeMidiInput,
          instrumentTabs: [tab],
          activeInstrumentTabId: tab.id,
          currentPatch,
          sequencer: defaultSequencerState(),
          sequencerInstruments,
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
        commitCurrentPatch(currentPatch, { loading: false, error: null });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load patch"
        });
      }
    },

    newPatch: () => {
      commitCurrentPatch(defaultEditablePatch());
    },

    setCurrentPatchMeta: (name, description) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        name,
        description
      });
    },

    setGraph: (graph) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: withNormalizedEngineConfig(graph)
      });
    },

    addNodeFromOpcode: (opcode, position) => {
      const current = get().currentPatch;
      const index = current.graph.nodes.length;

      const node: NodeInstance = {
        id: crypto.randomUUID(),
        opcode: opcode.name,
        params: defaultParams(opcode),
        position: position ?? randomPosition(index)
      };

      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          nodes: [...current.graph.nodes, node]
        }
      });
    },

    removeNode: (nodeId) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          nodes: current.graph.nodes.filter((node) => node.id !== nodeId),
          connections: current.graph.connections.filter(
            (connection) => connection.from_node_id !== nodeId && connection.to_node_id !== nodeId
          )
        }
      });
    },

    removeConnection: (connectionIndex) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          connections: current.graph.connections.filter((_, index) => index !== connectionIndex)
        }
      });
    },

    saveCurrentPatch: async () => {
      const current = {
        ...get().currentPatch,
        graph: withNormalizedEngineConfig(get().currentPatch.graph)
      };

      commitCurrentPatch(current, { loading: true, error: null });

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
        const state = get();

        const hasKnownBindings = state.sequencerInstruments.length > 0;
        const sequencerInstruments = hasKnownBindings
          ? state.sequencerInstruments
          : defaultSequencerInstruments(patches, normalizedPatch.id);

        commitCurrentPatch(normalizedPatch, {
          patches,
          sequencerInstruments,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to save patch"
        });
      }
    },

    addSequencerInstrument: () => {
      const state = get();
      const patchId = state.patches[0]?.id ?? state.currentPatch.id;
      if (!patchId) {
        set({ error: "Save at least one instrument patch before adding it to the sequencer." });
        return;
      }

      const binding: SequencerInstrumentBinding = {
        id: crypto.randomUUID(),
        patchId,
        midiChannel: nextAvailableMidiChannel(state.sequencerInstruments)
      };

      set({
        sequencerInstruments: [...state.sequencerInstruments, binding],
        error: null
      });
    },

    removeSequencerInstrument: (bindingId) => {
      const state = get();
      set({
        sequencerInstruments: state.sequencerInstruments.filter((binding) => binding.id !== bindingId)
      });
    },

    updateSequencerInstrumentPatch: (bindingId, patchId) => {
      const state = get();
      set({
        sequencerInstruments: state.sequencerInstruments.map((binding) =>
          binding.id === bindingId ? { ...binding, patchId } : binding
        )
      });
    },

    updateSequencerInstrumentChannel: (bindingId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const state = get();

      const duplicate = state.sequencerInstruments.some(
        (binding) => binding.id !== bindingId && clampInt(binding.midiChannel, 1, 16) === normalizedChannel
      );
      if (duplicate) {
        set({ error: `MIDI channel ${normalizedChannel} is already assigned.` });
        return;
      }

      set({
        sequencerInstruments: state.sequencerInstruments.map((binding) =>
          binding.id === bindingId ? { ...binding, midiChannel: normalizedChannel } : binding
        ),
        error: null
      });
    },

    buildSequencerConfigSnapshot: () => {
      const state = get();
      return buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
    },

    applySequencerConfigSnapshot: (snapshot) => {
      try {
        const state = get();
        const availablePatchIds = new Set(state.patches.map((patch) => patch.id));
        if (state.currentPatch.id) {
          availablePatchIds.add(state.currentPatch.id);
        }
        const fallbackPatchId = state.patches[0]?.id ?? state.currentPatch.id ?? null;
        const parsed = parseSequencerConfigSnapshot(snapshot, availablePatchIds, fallbackPatchId);

        set({
          sequencer: parsed.sequencer,
          sequencerInstruments: parsed.instruments,
          error: null
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to load sequencer config"
        });
      }
    },

    setSequencerBpm: (bpm) => {
      set({
        sequencer: {
          ...get().sequencer,
          bpm: clampInt(bpm, 30, 300)
        }
      });
    },

    setSequencerMidiChannel: (channel) => {
      set({
        sequencer: {
          ...get().sequencer,
          midiChannel: clampInt(channel, 1, 16)
        }
      });
    },

    setSequencerScale: (scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      set({
        sequencer: {
          ...get().sequencer,
          scaleRoot: normalizedRoot,
          scaleType: normalizedType,
          mode: defaultModeForScaleType(normalizedType)
        }
      });
    },

    setSequencerMode: (mode) => {
      set({
        sequencer: {
          ...get().sequencer,
          mode: normalizeSequencerMode(mode)
        }
      });
    },

    setPianoRollMidiChannel: (channel) => {
      set({
        sequencer: {
          ...get().sequencer,
          pianoRollMidiChannel: clampInt(channel, 1, 16)
        }
      });
    },

    setPianoRollScale: (scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      set({
        sequencer: {
          ...get().sequencer,
          pianoRollScaleRoot: normalizedRoot,
          pianoRollScaleType: normalizedType,
          pianoRollMode: defaultModeForScaleType(normalizedType)
        }
      });
    },

    setPianoRollMode: (mode) => {
      set({
        sequencer: {
          ...get().sequencer,
          pianoRollMode: normalizeSequencerMode(mode)
        }
      });
    },

    setSequencerStepCount: (stepCount) => {
      const sequencerState = get().sequencer;
      const boundedStepCount = normalizeStepCount(stepCount);
      const sequencer = {
        ...sequencerState,
        stepCount: boundedStepCount,
        playhead: sequencerState.playhead % boundedStepCount,
        steps: [...sequencerState.pads[sequencerState.activePad]]
      };

      set({ sequencer });
    },

    setSequencerStepNote: (index, note) => {
      if (index < 0 || index >= 32) {
        return;
      }

      const sequencer = get().sequencer;
      const pads = sequencer.pads.map((pad) => [...pad]);
      const activePad = normalizePadIndex(sequencer.activePad);
      const steps = [...pads[activePad]];
      steps[index] = normalizeStepNote(note);
      pads[activePad] = steps;

      const nextSequencer: SequencerState = {
        ...sequencer,
        pads,
        steps
      };

      set({ sequencer: nextSequencer });
    },

    setSequencerActivePad: (padIndex) => {
      const sequencer = get().sequencer;
      const normalizedPad = normalizePadIndex(padIndex);
      const nextSequencer: SequencerState = {
        ...sequencer,
        activePad: normalizedPad,
        queuedPad: sequencer.isPlaying ? sequencer.queuedPad : null,
        steps: [...sequencer.pads[normalizedPad]],
        playhead: sequencer.isPlaying ? sequencer.playhead : 0
      };

      set({ sequencer: nextSequencer });
    },

    setSequencerQueuedPad: (padIndex) => {
      const sequencer = get().sequencer;
      const nextSequencer: SequencerState = {
        ...sequencer,
        queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
      };

      set({ sequencer: nextSequencer });
    },

    setSequencerPlaying: (isPlaying) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          isPlaying,
          queuedPad: isPlaying ? sequencer.queuedPad : null
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

    syncSequencerRuntime: ({ isPlaying, playhead, cycle, activePad, queuedPad }) => {
      const sequencer = get().sequencer;
      const nextActivePad = activePad === undefined ? sequencer.activePad : normalizePadIndex(activePad);
      const boundedStepCount = normalizeStepCount(sequencer.stepCount);
      const normalizedPlayhead =
        playhead === undefined
          ? sequencer.playhead
          : ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;

      set({
        sequencer: {
          ...sequencer,
          isPlaying,
          cycle: cycle === undefined ? sequencer.cycle : Math.max(0, Math.round(cycle)),
          activePad: nextActivePad,
          queuedPad:
            queuedPad === undefined ? sequencer.queuedPad : queuedPad === null ? null : normalizePadIndex(queuedPad),
          playhead: normalizedPlayhead,
          steps: [...sequencer.pads[nextActivePad]]
        }
      });
    },

    setEngineAudioRate: (sr) => {
      const currentPatch = get().currentPatch;
      const currentEngine = normalizeEngineConfig(currentPatch.graph.engine_config);
      const nextSr = clampInt(sr, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
      const nextKsmps = Math.max(1, Math.round(nextSr / currentEngine.control_rate));

      commitCurrentPatch({
        ...currentPatch,
        graph: {
          ...currentPatch.graph,
          engine_config: {
            ...currentEngine,
            sr: nextSr,
            ksmps: nextKsmps
          }
        }
      });
    },

    setEngineControlRate: (controlRate) => {
      const currentPatch = get().currentPatch;
      const currentEngine = normalizeEngineConfig(currentPatch.graph.engine_config);
      const nextControlRate = clampInt(controlRate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
      const nextKsmps = Math.max(1, Math.round(currentEngine.sr / nextControlRate));

      commitCurrentPatch({
        ...currentPatch,
        graph: {
          ...currentPatch.graph,
          engine_config: {
            ...currentEngine,
            control_rate: nextControlRate,
            ksmps: nextKsmps
          }
        }
      });
    },

    ensureSession: async () => {
      const requestedAssignments = normalizeSessionInstrumentAssignments(get().sequencerInstruments);
      let sessionId = get().activeSessionId;

      if (sessionId && sameAssignments(requestedAssignments, get().activeSessionInstruments)) {
        return sessionId;
      }

      if (sessionId && !sameAssignments(requestedAssignments, get().activeSessionInstruments)) {
        try {
          await api.stopSession(sessionId);
        } catch {
          // Ignore if session wasn't running.
        }
        try {
          await api.deleteSession(sessionId);
        } catch {
          // Ignore cleanup failures and continue with a fresh session.
        }

        set({
          activeSessionId: null,
          activeSessionState: "idle",
          activeSessionInstruments: [],
          compileOutput: null,
          events: []
        });
        sessionId = null;
      }

      if (sessionId) {
        return sessionId;
      }

      const session = await api.createSession(requestedAssignments);
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
        activeMidiInput: midiInput,
        activeSessionInstruments: session.instruments.length > 0 ? session.instruments : requestedAssignments
      });

      return sessionId;
    },

    compileSession: async () => {
      set({ loading: true, error: null });
      try {
        if (!get().currentPatch.id) {
          await get().saveCurrentPatch();
        }

        const patchId = get().currentPatch.id;
        if (!patchId) {
          throw new Error("Patch must be saved before compiling.");
        }

        const compileSession = await api.createSession([
          {
            patch_id: patchId,
            midi_channel: 1
          }
        ]);

        const sessionId = compileSession.session_id;
        let compileOutput = null as CompileResponse | null;
        try {
          const midiInput = get().activeMidiInput;
          if (midiInput) {
            try {
              await api.bindMidiInput(sessionId, midiInput);
            } catch {
              // Keep compile successful even if MIDI binding fails for temporary validation session.
            }
          }

          compileOutput = await api.compileSession(sessionId);
        } finally {
          try {
            await api.deleteSession(sessionId);
          } catch {
            // Best-effort cleanup for temporary compile sessions.
          }
        }

        if (!compileOutput) {
          throw new Error("Failed to compile current patch.");
        }

        set({
          compileOutput,
          loading: false,
          error: null
        });
        return compileOutput;
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to compile session"
        });
        return null;
      }
    },

    startSession: async () => {
      set({ loading: true, error: null });
      try {
        const sessionId = await get().ensureSession();
        const compileOutput = await api.compileSession(sessionId);
        const response = await api.startSession(sessionId);
        set({ compileOutput, activeSessionState: response.state, loading: false });
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
      if (!sessionId) {
        return;
      }

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
      if (!sessionId) {
        return;
      }

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
  };
});
