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
  PerformanceListItem,
  MidiControllerState,
  PianoRollState,
  SequencerConfigSnapshot,
  SequencerInstrumentBinding,
  SequencerMode,
  SequencerScaleRoot,
  SequencerScaleType,
  SequencerState,
  SequencerTrackState,
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
  performances: PerformanceListItem[];
  midiInputs: MidiInputRef[];

  instrumentTabs: InstrumentTabState[];
  activeInstrumentTabId: string;
  currentPatch: EditablePatch;

  sequencer: SequencerState;
  sequencerInstruments: SequencerInstrumentBinding[];
  currentPerformanceId: string | null;
  performanceName: string;
  performanceDescription: string;

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
  loadPerformance: (performanceId: string) => Promise<void>;
  setCurrentPerformanceMeta: (name: string, description: string) => void;
  saveCurrentPerformance: () => Promise<void>;

  addSequencerInstrument: () => void;
  removeSequencerInstrument: (bindingId: string) => void;
  updateSequencerInstrumentPatch: (bindingId: string, patchId: string) => void;
  updateSequencerInstrumentChannel: (bindingId: string, channel: number) => void;
  buildSequencerConfigSnapshot: () => SequencerConfigSnapshot;
  applySequencerConfigSnapshot: (snapshot: unknown) => void;

  addSequencerTrack: () => void;
  removeSequencerTrack: (trackId: string) => void;
  setSequencerTrackEnabled: (trackId: string, enabled: boolean, queueOnCycle?: boolean) => void;
  setSequencerTrackMidiChannel: (trackId: string, channel: number) => void;
  setSequencerTrackScale: (trackId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  setSequencerTrackMode: (trackId: string, mode: SequencerMode) => void;
  setSequencerTrackStepCount: (trackId: string, stepCount: 16 | 32) => void;
  setSequencerTrackStepNote: (trackId: string, index: number, note: number | null) => void;
  setSequencerTrackActivePad: (trackId: string, padIndex: number) => void;
  setSequencerTrackQueuedPad: (trackId: string, padIndex: number | null) => void;

  addPianoRoll: () => void;
  removePianoRoll: (rollId: string) => void;
  setPianoRollEnabled: (rollId: string, enabled: boolean) => void;
  setPianoRollMidiChannel: (rollId: string, channel: number) => void;
  setPianoRollScale: (rollId: string, scaleRoot: SequencerScaleRoot, scaleType: SequencerScaleType) => void;
  setPianoRollMode: (rollId: string, mode: SequencerMode) => void;

  addMidiController: () => void;
  removeMidiController: (controllerId: string) => void;
  setMidiControllerEnabled: (controllerId: string, enabled: boolean) => void;
  setMidiControllerNumber: (controllerId: string, controllerNumber: number) => void;
  setMidiControllerValue: (controllerId: string, value: number) => void;

  setSequencerBpm: (bpm: number) => void;
  syncSequencerRuntime: (payload: {
    isPlaying: boolean;
    transportStepCount?: 16 | 32;
    playhead?: number;
    cycle?: number;
    tracks?: Array<{
      trackId: string;
      stepCount?: 16 | 32;
      activePad?: number;
      queuedPad?: number | null;
      enabled?: boolean;
      queuedEnabled?: boolean | null;
    }>;
  }) => void;
  setSequencerPlaying: (isPlaying: boolean) => void;
  setSequencerPlayhead: (playhead: number) => void;
  applyEngineConfig: (config: {
    sr: number;
    controlRate: number;
    softwareBuffer: number;
    hardwareBuffer: number;
  }) => Promise<void>;

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
const MAX_MIDI_CONTROLLERS = 16;
const AUDIO_RATE_MIN = 22000;
const AUDIO_RATE_MAX = 48000;
const CONTROL_RATE_MIN = 25;
const CONTROL_RATE_MAX = 48000;
const ENGINE_BUFFER_MIN = 32;
const ENGINE_BUFFER_MAX = 8192;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeStepCount(value: number): 16 | 32 {
  return value === 32 ? 32 : 16;
}

function transportStepCountForTracks(tracks: SequencerTrackState[]): 16 | 32 {
  if (tracks.some((track) => normalizeStepCount(track.stepCount) === 32)) {
    return 32;
  }
  return 16;
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

function normalizeControllerNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return clampInt(value, 0, 127);
}

function normalizeControllerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
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

function defaultSequencerTrack(index = 1, midiChannel = 1): SequencerTrackState {
  const channel = clampInt(midiChannel, 1, 16);
  const pads = defaultSequencerPads();
  return {
    id: `voice-${index}`,
    name: `Sequencer ${index}`,
    midiChannel: channel,
    stepCount: 16,
    scaleRoot: "C",
    scaleType: "minor",
    mode: "aeolian",
    activePad: 0,
    queuedPad: null,
    pads,
    steps: [...pads[0]],
    enabled: false,
    queuedEnabled: null
  };
}

function defaultPianoRoll(index = 1, midiChannel = 2): PianoRollState {
  const channel = clampInt(midiChannel, 1, 16);
  return {
    id: `piano-${index}`,
    name: `Piano Roll ${index}`,
    midiChannel: channel,
    scaleRoot: "C",
    scaleType: "minor",
    mode: "aeolian",
    enabled: false
  };
}

function defaultMidiController(index = 1): MidiControllerState {
  return {
    id: `cc-${index}`,
    name: `Controller ${index}`,
    controllerNumber: clampInt(index - 1, 0, 127),
    value: 0,
    enabled: false
  };
}

function defaultMidiControllers(count = MAX_MIDI_CONTROLLERS): MidiControllerState[] {
  return Array.from({ length: count }, (_, index) => defaultMidiController(index + 1));
}

function defaultSequencerState(): SequencerState {
  return {
    isPlaying: false,
    bpm: 120,
    stepCount: 16,
    playhead: 0,
    cycle: 0,
    tracks: [defaultSequencerTrack(1, 1)],
    pianoRolls: [defaultPianoRoll(1, 2)],
    midiControllers: defaultMidiControllers()
  };
}

function normalizeSequencerTrack(raw: unknown, index: number): SequencerTrackState {
  const fallback = defaultSequencerTrack(index, index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const track = raw as Record<string, unknown>;
  const id =
    typeof track.id === "string" && track.id.length > 0
      ? track.id
      : typeof track.trackId === "string" && track.trackId.length > 0
        ? track.trackId
        : fallback.id;
  const name = typeof track.name === "string" && track.name.trim().length > 0 ? track.name : fallback.name;
  const midiChannel =
    typeof track.midiChannel === "number" ? clampInt(track.midiChannel, 1, 16) : fallback.midiChannel;
  const scaleRoot = normalizeSequencerScaleRoot(track.scaleRoot);
  const scaleType = normalizeSequencerScaleType(track.scaleType);
  const fallbackMode = defaultModeForScaleType(scaleType);
  const mode = track.mode !== undefined ? normalizeSequencerMode(track.mode) : fallbackMode;
  const stepCount =
    typeof track.stepCount === "number"
      ? normalizeStepCount(track.stepCount)
      : typeof track.step_count === "number"
        ? normalizeStepCount(track.step_count)
        : fallback.stepCount;
  const activePad = typeof track.activePad === "number" ? normalizePadIndex(track.activePad) : fallback.activePad;
  const queuedPad = typeof track.queuedPad === "number" ? normalizePadIndex(track.queuedPad) : null;
  const enabled = typeof track.enabled === "boolean" ? track.enabled : fallback.enabled;
  const queuedEnabled = typeof track.queuedEnabled === "boolean" ? track.queuedEnabled : null;

  const pads = defaultSequencerPads();
  if (Array.isArray(track.pads)) {
    for (let padIndex = 0; padIndex < Math.min(DEFAULT_PAD_COUNT, track.pads.length); padIndex += 1) {
      const normalized = normalizePadSteps(track.pads[padIndex]);
      if (normalized) {
        pads[padIndex] = normalized;
      }
    }
  } else if (Array.isArray(track.steps)) {
    const legacy = normalizePadSteps(track.steps);
    if (legacy) {
      pads[0] = legacy;
    }
  }

  return {
    id,
    name,
    midiChannel,
    stepCount,
    scaleRoot,
    scaleType,
    mode,
    activePad,
    queuedPad,
    pads,
    steps: [...pads[activePad]],
    enabled,
    queuedEnabled
  };
}

function normalizePianoRollState(raw: unknown, index: number): PianoRollState {
  const fallback = defaultPianoRoll(index, index + 1);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const roll = raw as Record<string, unknown>;
  const id = typeof roll.id === "string" && roll.id.length > 0 ? roll.id : fallback.id;
  const name = typeof roll.name === "string" && roll.name.trim().length > 0 ? roll.name : fallback.name;
  const midiChannel =
    typeof roll.midiChannel === "number" ? clampInt(roll.midiChannel, 1, 16) : fallback.midiChannel;
  const scaleRoot = normalizeSequencerScaleRoot(roll.scaleRoot);
  const scaleType = normalizeSequencerScaleType(roll.scaleType);
  const fallbackMode = defaultModeForScaleType(scaleType);
  const mode = roll.mode !== undefined ? normalizeSequencerMode(roll.mode) : fallbackMode;
  const enabled = typeof roll.enabled === "boolean" ? roll.enabled : fallback.enabled;

  return {
    id,
    name,
    midiChannel,
    scaleRoot,
    scaleType,
    mode,
    enabled
  };
}

function normalizeMidiControllerState(raw: unknown, index: number): MidiControllerState {
  const fallback = defaultMidiController(index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const controller = raw as Record<string, unknown>;
  const id = typeof controller.id === "string" && controller.id.length > 0 ? controller.id : fallback.id;
  const name =
    typeof controller.name === "string" && controller.name.trim().length > 0 ? controller.name : fallback.name;
  const controllerNumber = normalizeControllerNumber(controller.controllerNumber);
  const value = normalizeControllerValue(controller.value);
  const enabled = typeof controller.enabled === "boolean" ? controller.enabled : fallback.enabled;

  return {
    id,
    name,
    controllerNumber,
    value,
    enabled
  };
}

function normalizeSequencerState(raw: unknown): SequencerState {
  const defaults = defaultSequencerState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const sequencer = raw as Record<string, unknown>;
  const bpm = typeof sequencer.bpm === "number" ? clampInt(sequencer.bpm, 30, 300) : defaults.bpm;
  const rawStepCount =
    typeof sequencer.stepCount === "number" ? normalizeStepCount(sequencer.stepCount) : defaults.stepCount;
  const playhead = typeof sequencer.playhead === "number" ? Math.max(0, Math.round(sequencer.playhead)) : 0;

  const tracks: SequencerTrackState[] = [];
  if (Array.isArray(sequencer.tracks)) {
    for (let index = 0; index < Math.min(8, sequencer.tracks.length); index += 1) {
      tracks.push(normalizeSequencerTrack(sequencer.tracks[index], index + 1));
    }
  } else {
    tracks.push(normalizeSequencerTrack(sequencer, 1));
  }

  const pianoRolls: PianoRollState[] = [];
  if (Array.isArray(sequencer.pianoRolls)) {
    for (let index = 0; index < Math.min(8, sequencer.pianoRolls.length); index += 1) {
      pianoRolls.push(normalizePianoRollState(sequencer.pianoRolls[index], index + 1));
    }
  } else {
    pianoRolls.push(
      normalizePianoRollState(
        {
          id: "piano-1",
          name: "Piano Roll 1",
          midiChannel: sequencer.pianoRollMidiChannel,
          scaleRoot: sequencer.pianoRollScaleRoot,
          scaleType: sequencer.pianoRollScaleType,
          mode: sequencer.pianoRollMode,
          enabled: false
        },
        1
      )
    );
  }

  const midiControllers: MidiControllerState[] = [];
  const rawMidiControllers = Array.isArray(sequencer.midiControllers) ? sequencer.midiControllers : null;
  const hasMidiControllers = rawMidiControllers !== null;
  if (rawMidiControllers) {
    for (let index = 0; index < Math.min(MAX_MIDI_CONTROLLERS, rawMidiControllers.length); index += 1) {
      midiControllers.push(normalizeMidiControllerState(rawMidiControllers[index], index + 1));
    }
  }

  const trackList = tracks.length > 0 ? tracks : defaults.tracks;
  const seenTrackIds = new Set<string>();
  const normalizedTracks = trackList.map((track, index) => {
    let nextId = track.id.trim().length > 0 ? track.id : `voice-${index + 1}`;
    if (seenTrackIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenTrackIds.add(nextId);
    return {
      ...track,
      id: nextId
    };
  });

  const rollList = pianoRolls.length > 0 ? pianoRolls : defaults.pianoRolls;
  const seenRollIds = new Set<string>();
  const normalizedRolls = rollList.map((roll, index) => {
    let nextId = roll.id.trim().length > 0 ? roll.id : `piano-${index + 1}`;
    if (seenRollIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenRollIds.add(nextId);
    return {
      ...roll,
      id: nextId
    };
  });

  const controllerList = hasMidiControllers ? midiControllers : defaults.midiControllers;
  const seenControllerIds = new Set<string>();
  const normalizedControllers = controllerList.map((controller, index) => {
    let nextId = controller.id.trim().length > 0 ? controller.id : `cc-${index + 1}`;
    if (seenControllerIds.has(nextId)) {
      nextId = `${nextId}-${index + 1}`;
    }
    seenControllerIds.add(nextId);
    return {
      ...controller,
      id: nextId
    };
  });

  const normalizedTransportStepCount = normalizeStepCount(
    typeof sequencer.stepCount === "number"
      ? rawStepCount
      : transportStepCountForTracks(normalizedTracks)
  );

  return {
    ...defaults,
    bpm,
    stepCount: normalizedTransportStepCount,
    playhead: playhead % normalizedTransportStepCount,
    tracks: normalizedTracks,
    pianoRolls: normalizedRolls,
    midiControllers: normalizedControllers
  };
}

function normalizeEngineConfig(raw: Partial<EngineConfig> | undefined): EngineConfig {
  const sr = clampInt(typeof raw?.sr === "number" ? raw.sr : 44100, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
  let controlRate = 1378;

  if (typeof raw?.control_rate === "number" && Number.isFinite(raw.control_rate)) {
    controlRate = clampInt(raw.control_rate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
  } else if (typeof raw?.ksmps === "number" && Number.isFinite(raw.ksmps) && raw.ksmps > 0) {
    const derivedControlRate = Math.round(sr / raw.ksmps);
    if (derivedControlRate >= CONTROL_RATE_MIN && derivedControlRate <= CONTROL_RATE_MAX) {
      controlRate = derivedControlRate;
    }
  }

  const ksmps = Math.max(1, Math.round(sr / controlRate));
  const softwareBuffer = clampInt(
    typeof raw?.software_buffer === "number" ? raw.software_buffer : 128,
    ENGINE_BUFFER_MIN,
    ENGINE_BUFFER_MAX
  );
  const hardwareBuffer = clampInt(
    typeof raw?.hardware_buffer === "number" ? raw.hardware_buffer : 512,
    ENGINE_BUFFER_MIN,
    ENGINE_BUFFER_MAX
  );

  return {
    sr,
    control_rate: controlRate,
    ksmps,
    nchnls: typeof raw?.nchnls === "number" ? Math.max(1, Math.round(raw.nchnls)) : 2,
    software_buffer: softwareBuffer,
    hardware_buffer: hardwareBuffer,
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

function nextAvailablePerformanceChannel(sequencer: SequencerState): number {
  const occupied = new Set<number>();
  for (const track of sequencer.tracks) {
    occupied.add(clampInt(track.midiChannel, 1, 16));
  }
  for (const roll of sequencer.pianoRolls) {
    occupied.add(clampInt(roll.midiChannel, 1, 16));
  }

  for (let channel = 1; channel <= 16; channel += 1) {
    if (!occupied.has(channel)) {
      return channel;
    }
  }
  return 1;
}

function nextAvailableControllerNumber(controllers: MidiControllerState[]): number {
  const occupied = new Set(controllers.map((controller) => normalizeControllerNumber(controller.controllerNumber)));
  for (let controllerNumber = 0; controllerNumber <= 127; controllerNumber += 1) {
    if (!occupied.has(controllerNumber)) {
      return controllerNumber;
    }
  }
  return 0;
}

function buildSequencerConfigSnapshot(
  sequencer: SequencerState,
  instruments: SequencerInstrumentBinding[]
): SequencerConfigSnapshot {
  return {
    version: 2,
    instruments: instruments
      .filter((instrument) => instrument.patchId.length > 0)
      .map((instrument) => ({
        patchId: instrument.patchId,
        midiChannel: clampInt(instrument.midiChannel, 1, 16)
      })),
    sequencer: {
      bpm: clampInt(sequencer.bpm, 30, 300),
      stepCount: normalizeStepCount(sequencer.stepCount),
      tracks: sequencer.tracks.slice(0, 8).map((track, index) => ({
        id: track.id.length > 0 ? track.id : `voice-${index + 1}`,
        name: track.name.trim().length > 0 ? track.name : `Sequencer ${index + 1}`,
        midiChannel: clampInt(track.midiChannel, 1, 16),
        stepCount: normalizeStepCount(track.stepCount),
        scaleRoot: normalizeSequencerScaleRoot(track.scaleRoot),
        scaleType: normalizeSequencerScaleType(track.scaleType),
        mode: normalizeSequencerMode(track.mode),
        activePad: normalizePadIndex(track.activePad),
        queuedPad: track.queuedPad === null ? null : normalizePadIndex(track.queuedPad),
        pads: Array.from({ length: DEFAULT_PAD_COUNT }, (_, padIndex) =>
          Array.from({ length: 32 }, (_, stepIndex) => normalizeStepNote(track.pads[padIndex]?.[stepIndex]))
        ),
        enabled: track.enabled === true,
        queuedEnabled:
          track.queuedEnabled === null || typeof track.queuedEnabled === "boolean" ? track.queuedEnabled : null
      })),
      pianoRolls: sequencer.pianoRolls.slice(0, 8).map((roll, index) => ({
        id: roll.id.length > 0 ? roll.id : `piano-${index + 1}`,
        name: roll.name.trim().length > 0 ? roll.name : `Piano Roll ${index + 1}`,
        midiChannel: clampInt(roll.midiChannel, 1, 16),
        scaleRoot: normalizeSequencerScaleRoot(roll.scaleRoot),
        scaleType: normalizeSequencerScaleType(roll.scaleType),
        mode: normalizeSequencerMode(roll.mode),
        enabled: roll.enabled === true
      })),
      midiControllers: sequencer.midiControllers.slice(0, MAX_MIDI_CONTROLLERS).map((controller, index) => ({
        id: controller.id.length > 0 ? controller.id : `cc-${index + 1}`,
        name: controller.name.trim().length > 0 ? controller.name : `Controller ${index + 1}`,
        controllerNumber: normalizeControllerNumber(controller.controllerNumber),
        value: normalizeControllerValue(controller.value),
        enabled: controller.enabled === true
      }))
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
  if (payload.version !== 1 && payload.version !== 2) {
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
    performances: [],
    midiInputs: [],

    instrumentTabs: [initialTab],
    activeInstrumentTabId: initialTab.id,
    currentPatch: initialPatch,

    sequencer: defaultSequencerState(),
    sequencerInstruments: [],
    currentPerformanceId: null,
    performanceName: "Untitled Performance",
    performanceDescription: "",

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
        const [opcodes, patches, performances, midiInputs] = await Promise.all([
          api.listOpcodes(),
          api.listPatches(),
          api.listPerformances(),
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
          performances,
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

    loadPerformance: async (performanceId) => {
      set({ loading: true, error: null });
      try {
        const performance = await api.getPerformance(performanceId);
        const state = get();
        const availablePatchIds = new Set(state.patches.map((patch) => patch.id));
        if (state.currentPatch.id) {
          availablePatchIds.add(state.currentPatch.id);
        }
        const fallbackPatchId = state.patches[0]?.id ?? state.currentPatch.id ?? null;
        const parsed = parseSequencerConfigSnapshot(performance.config, availablePatchIds, fallbackPatchId);

        set({
          sequencer: parsed.sequencer,
          sequencerInstruments: parsed.instruments,
          currentPerformanceId: performance.id,
          performanceName: performance.name,
          performanceDescription: performance.description,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load performance"
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

    setCurrentPerformanceMeta: (name, description) => {
      set({
        performanceName: name,
        performanceDescription: description
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

    saveCurrentPerformance: async () => {
      const state = get();
      const name = state.performanceName.trim();
      if (name.length === 0) {
        set({ error: "Performance name is required." });
        return;
      }

      const snapshot = buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
      set({ loading: true, error: null });
      try {
        const payload = {
          name,
          description: state.performanceDescription,
          config: snapshot
        };

        const saved = state.currentPerformanceId
          ? await api.updatePerformance(state.currentPerformanceId, payload)
          : await api.createPerformance(payload);
        const performances = await api.listPerformances();

        set({
          performances,
          currentPerformanceId: saved.id,
          performanceName: saved.name,
          performanceDescription: saved.description,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to save performance"
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

    addSequencerTrack: () => {
      const sequencer = get().sequencer;
      if (sequencer.tracks.length >= 8) {
        set({ error: "A maximum of 8 sequencers is supported." });
        return;
      }

      const nextIndex = sequencer.tracks.length + 1;
      const track = defaultSequencerTrack(nextIndex, nextAvailablePerformanceChannel(sequencer));
      track.id = crypto.randomUUID();
      track.name = `Sequencer ${nextIndex}`;
      const nextTracks = [...sequencer.tracks, track];

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForTracks(nextTracks),
          tracks: nextTracks
        },
        error: null
      });
    },

    removeSequencerTrack: (trackId) => {
      const sequencer = get().sequencer;
      if (sequencer.tracks.length <= 1) {
        set({ error: "At least one sequencer is required." });
        return;
      }
      const nextTracks = sequencer.tracks.filter((track) => track.id !== trackId);

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForTracks(nextTracks),
          tracks: nextTracks
        },
        error: null
      });
    },

    setSequencerTrackEnabled: (trackId, enabled, queueOnCycle) => {
      const sequencer = get().sequencer;
      const shouldQueue = queueOnCycle ?? sequencer.isPlaying;
      const nextTracks = sequencer.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }
        if (shouldQueue && sequencer.isPlaying) {
          if (track.enabled === enabled) {
            return { ...track, queuedEnabled: null };
          }
          return {
            ...track,
            queuedEnabled: enabled
          };
        }
        return {
          ...track,
          enabled,
          queuedEnabled: null
        };
      });

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForTracks(nextTracks),
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackMidiChannel: (trackId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId ? { ...track, midiChannel: normalizedChannel } : track
          )
        }
      });
    },

    setSequencerTrackScale: (trackId, scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      const nextMode = defaultModeForScaleType(normalizedType);

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  scaleRoot: normalizedRoot,
                  scaleType: normalizedType,
                  mode: nextMode
                }
              : track
          )
        }
      });
    },

    setSequencerTrackMode: (trackId, mode) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId ? { ...track, mode: normalizeSequencerMode(mode) } : track
          )
        }
      });
    },

    setSequencerTrackStepCount: (trackId, stepCount) => {
      const sequencer = get().sequencer;
      const normalizedStepCount = normalizeStepCount(stepCount);
      const nextTracks = sequencer.tracks.map((track) =>
        track.id === trackId ? { ...track, stepCount: normalizedStepCount } : track
      );

      set({
        sequencer: {
          ...sequencer,
          stepCount: transportStepCountForTracks(nextTracks),
          tracks: nextTracks
        }
      });
    },

    setSequencerTrackStepNote: (trackId, index, note) => {
      if (index < 0 || index >= 32) {
        return;
      }

      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) => {
            if (track.id !== trackId) {
              return track;
            }

            const pads = track.pads.map((pad) => [...pad]);
            const activePad = normalizePadIndex(track.activePad);
            const steps = [...pads[activePad]];
            steps[index] = normalizeStepNote(note);
            pads[activePad] = steps;

            return {
              ...track,
              pads,
              steps
            };
          })
        }
      });
    },

    setSequencerTrackActivePad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      const normalizedPad = normalizePadIndex(padIndex);

      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  activePad: normalizedPad,
                  queuedPad: sequencer.isPlaying ? track.queuedPad : null,
                  steps: [...track.pads[normalizedPad]]
                }
              : track
          )
        }
      });
    },

    setSequencerTrackQueuedPad: (trackId, padIndex) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          tracks: sequencer.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  queuedPad: padIndex === null ? null : normalizePadIndex(padIndex)
                }
              : track
          )
        }
      });
    },

    addPianoRoll: () => {
      const sequencer = get().sequencer;
      if (sequencer.pianoRolls.length >= 8) {
        set({ error: "A maximum of 8 piano rolls is supported." });
        return;
      }

      const nextIndex = sequencer.pianoRolls.length + 1;
      const roll = defaultPianoRoll(nextIndex, nextAvailablePerformanceChannel(sequencer));
      roll.id = crypto.randomUUID();
      roll.name = `Piano Roll ${nextIndex}`;

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: [...sequencer.pianoRolls, roll]
        },
        error: null
      });
    },

    removePianoRoll: (rollId) => {
      const sequencer = get().sequencer;
      if (sequencer.pianoRolls.length <= 1) {
        set({ error: "At least one piano roll is required." });
        return;
      }

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.filter((roll) => roll.id !== rollId)
        },
        error: null
      });
    },

    setPianoRollEnabled: (rollId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, enabled } : roll
          )
        }
      });
    },

    setPianoRollMidiChannel: (rollId, channel) => {
      const normalizedChannel = clampInt(channel, 1, 16);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, midiChannel: normalizedChannel } : roll
          )
        }
      });
    },

    setPianoRollScale: (rollId, scaleRoot, scaleType) => {
      const normalizedRoot = normalizeSequencerScaleRoot(scaleRoot);
      const normalizedType = normalizeSequencerScaleType(scaleType);
      const nextMode = defaultModeForScaleType(normalizedType);
      const sequencer = get().sequencer;

      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId
              ? {
                  ...roll,
                  scaleRoot: normalizedRoot,
                  scaleType: normalizedType,
                  mode: nextMode
                }
              : roll
          )
        }
      });
    },

    setPianoRollMode: (rollId, mode) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          pianoRolls: sequencer.pianoRolls.map((roll) =>
            roll.id === rollId ? { ...roll, mode: normalizeSequencerMode(mode) } : roll
          )
        }
      });
    },

    addMidiController: () => {
      const sequencer = get().sequencer;
      if (sequencer.midiControllers.length >= MAX_MIDI_CONTROLLERS) {
        set({ error: `A maximum of ${MAX_MIDI_CONTROLLERS} MIDI controllers is supported.` });
        return;
      }

      const nextIndex = sequencer.midiControllers.length + 1;
      const controller = defaultMidiController(nextIndex);
      controller.id = crypto.randomUUID();
      controller.name = `Controller ${nextIndex}`;
      controller.controllerNumber = nextAvailableControllerNumber(sequencer.midiControllers);

      set({
        sequencer: {
          ...sequencer,
          midiControllers: [...sequencer.midiControllers, controller]
        },
        error: null
      });
    },

    removeMidiController: (controllerId) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.filter((controller) => controller.id !== controllerId)
        },
        error: null
      });
    },

    setMidiControllerEnabled: (controllerId, enabled) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, enabled } : controller
          )
        }
      });
    },

    setMidiControllerNumber: (controllerId, controllerNumber) => {
      const normalizedNumber = normalizeControllerNumber(controllerNumber);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, controllerNumber: normalizedNumber } : controller
          )
        }
      });
    },

    setMidiControllerValue: (controllerId, value) => {
      const normalizedValue = normalizeControllerValue(value);
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          midiControllers: sequencer.midiControllers.map((controller) =>
            controller.id === controllerId ? { ...controller, value: normalizedValue } : controller
          )
        }
      });
    },

    setSequencerBpm: (bpm) => {
      set({
        sequencer: {
          ...get().sequencer,
          bpm: clampInt(bpm, 30, 300)
        }
      });
    },

    setSequencerPlaying: (isPlaying) => {
      const sequencer = get().sequencer;
      set({
        sequencer: {
          ...sequencer,
          isPlaying,
          tracks: sequencer.tracks.map((track) => ({
            ...track,
            queuedPad: isPlaying ? track.queuedPad : null,
            queuedEnabled: isPlaying ? track.queuedEnabled : null
          }))
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

    syncSequencerRuntime: ({ isPlaying, transportStepCount, playhead, cycle, tracks }) => {
      const sequencer = get().sequencer;
      const boundedStepCount = normalizeStepCount(transportStepCount ?? sequencer.stepCount);
      const normalizedPlayhead =
        playhead === undefined
          ? sequencer.playhead
          : ((Math.round(playhead) % boundedStepCount) + boundedStepCount) % boundedStepCount;
      const trackPayload = new Map((tracks ?? []).map((track) => [track.trackId, track]));

      set({
        sequencer: {
          ...sequencer,
          isPlaying,
          stepCount: boundedStepCount,
          cycle: cycle === undefined ? sequencer.cycle : Math.max(0, Math.round(cycle)),
          playhead: normalizedPlayhead,
          tracks: sequencer.tracks.map((track) => {
            const payload = trackPayload.get(track.id);
            if (!payload) {
              if (!isPlaying) {
                return {
                  ...track,
                  queuedPad: null,
                  queuedEnabled: null
                };
              }
              return track;
            }

            const nextActivePad =
              payload.activePad === undefined ? track.activePad : normalizePadIndex(payload.activePad);
            const nextQueuedPad =
              payload.queuedPad === undefined
                ? track.queuedPad
                : payload.queuedPad === null
                  ? null
                  : normalizePadIndex(payload.queuedPad);
            const nextEnabled = payload.enabled === undefined ? track.enabled : payload.enabled;
            const nextStepCount =
              payload.stepCount === undefined ? track.stepCount : normalizeStepCount(payload.stepCount);
            const nextQueuedEnabled =
              payload.queuedEnabled === undefined
                ? track.queuedEnabled
                : payload.queuedEnabled === null
                  ? null
                  : payload.queuedEnabled;

            if (
              nextActivePad === track.activePad &&
              nextQueuedPad === track.queuedPad &&
              nextStepCount === track.stepCount &&
              nextEnabled === track.enabled &&
              nextQueuedEnabled === track.queuedEnabled
            ) {
              return track;
            }

            return {
              ...track,
              activePad: nextActivePad,
              queuedPad: nextQueuedPad,
              stepCount: nextStepCount,
              enabled: nextEnabled,
              queuedEnabled: nextQueuedEnabled,
              steps: nextActivePad === track.activePad ? track.steps : [...track.pads[nextActivePad]]
            };
          })
        }
      });
    },

    applyEngineConfig: async ({ sr, controlRate, softwareBuffer, hardwareBuffer }) => {
      const currentPatch = get().currentPatch;
      const currentEngine = normalizeEngineConfig(currentPatch.graph.engine_config);
      const nextSr = clampInt(sr, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
      const nextControlRate = clampInt(controlRate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
      const nextSoftwareBuffer = clampInt(softwareBuffer, ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX);
      const nextHardwareBuffer = clampInt(hardwareBuffer, ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX);
      const nextKsmps = Math.max(1, Math.round(nextSr / nextControlRate));

      const nextPatch: EditablePatch = {
        ...currentPatch,
        graph: {
          ...currentPatch.graph,
          engine_config: {
            ...currentEngine,
            sr: nextSr,
            control_rate: nextControlRate,
            ksmps: nextKsmps,
            software_buffer: nextSoftwareBuffer,
            hardware_buffer: nextHardwareBuffer
          }
        }
      };

      commitCurrentPatch(nextPatch, { error: null });

      const normalizedGraph = withNormalizedEngineConfig(nextPatch.graph);

      try {
        let persisted: Patch;
        if (nextPatch.id) {
          persisted = await api.updatePatch(nextPatch.id, { graph: normalizedGraph });
        } else {
          persisted = await api.createPatch({
            name: nextPatch.name,
            description: nextPatch.description,
            schema_version: nextPatch.schema_version,
            graph: normalizedGraph
          });
        }

        const patches = await api.listPatches();
        const persistedNormalized = normalizePatch(persisted);
        const resolvedPatch: EditablePatch = nextPatch.id
          ? {
              ...nextPatch,
              graph: normalizedGraph,
              created_at: persistedNormalized.created_at,
              updated_at: persistedNormalized.updated_at
            }
          : persistedNormalized;

        const state = get();
        const hasKnownBindings = state.sequencerInstruments.length > 0;
        const sequencerInstruments = hasKnownBindings
          ? state.sequencerInstruments
          : defaultSequencerInstruments(patches, resolvedPatch.id);

        commitCurrentPatch(resolvedPatch, {
          patches,
          sequencerInstruments,
          error: null
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to persist engine configuration."
        });
      }
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
