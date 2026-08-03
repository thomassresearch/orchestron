import type { EditorSelection } from "./components/ReteNodeEditor";
import {
  compileArrangerTransportSequence
} from "./lib/arrangerTransport";
import type { AppCopy } from "./lib/appUiCopy";
import { sequencerTransportStepsPerBeat } from "./lib/sequencer";
import { drummerRowRuntimeTrackId } from "./lib/sequencerRuntime";
import type {
  Connection,
  DrummerSequencerTrackState,
  OpcodeSpec,
  PatchGraph,
  SequencerInstrumentBinding,
  SequencerState,
  SessionArpeggiatorConfigRequest,
  SessionSequencerConfigRequest
} from "./types";

export function connectionKey(connection: Connection): string {
  return `${connection.from_node_id}|${connection.from_port_id}|${connection.to_node_id}|${connection.to_port_id}`;
}

export function pianoRollNoteKey(note: number, channel: number): string {
  return `${channel}:${note}`;
}

export function normalizeMidiChannel(channel: number): number {
  return Math.max(1, Math.min(16, Math.round(channel)));
}

export function normalizeMidiVelocity(velocity: number): number {
  return Math.max(0, Math.min(127, Math.round(velocity)));
}

export function DeferredPageFallback() {
  return (
    <section
      className="min-h-[480px] rounded-2xl border border-slate-700/70 bg-slate-900/70"
      aria-busy="true"
      aria-live="polite"
    />
  );
}

export function DeferredModalFallback() {
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 p-4" aria-busy="true" />
  );
}

export function normalizeInstrumentLevel(level: number): number {
  return Math.max(1, Math.min(10, Math.round(level)));
}

export function instrumentLevelByChannel(bindings: SequencerInstrumentBinding[]): Map<number, number> {
  const levelMap = new Map<number, number>();
  for (const binding of bindings) {
    if (binding.midiChannel <= 0) {
      continue;
    }
    const channel = normalizeMidiChannel(binding.midiChannel);
    levelMap.set(channel, normalizeInstrumentLevel(binding.level));
  }
  return levelMap;
}

export function levelForChannel(channel: number, levelMap: Map<number, number>): number {
  const level = levelMap.get(normalizeMidiChannel(channel));
  return level === undefined ? 10 : normalizeInstrumentLevel(level);
}

export function scaleVelocityForChannel(velocity: number, channel: number, levelMap: Map<number, number>): number {
  const normalizedVelocity = normalizeMidiVelocity(velocity);
  const level = levelForChannel(channel, levelMap);
  return normalizeMidiVelocity(Math.round((normalizedVelocity * level) / 10));
}

export function buildBackendArpeggiatorConfigs(
  state: SequencerState
): NonNullable<SessionArpeggiatorConfigRequest["arpeggiators"]> {
  return state.arpeggiators.map((arpeggiator) => ({
    arpeggiator_id: arpeggiator.id,
    enabled: arpeggiator.enabled,
    input_channel: arpeggiator.inputChannel,
    target_channel: arpeggiator.targetChannel,
    rate: arpeggiator.rate,
    gate_ratio: arpeggiator.gateRatio,
    swing: arpeggiator.swing,
    octaves: arpeggiator.octaves,
    pattern: arpeggiator.pattern,
    latch: arpeggiator.latch,
    velocity_mode: arpeggiator.velocityMode,
    fixed_velocity: arpeggiator.fixedVelocity,
    accent_cycle: arpeggiator.accentCycle,
    probability: arpeggiator.probability,
    repeats: arpeggiator.repeats,
    humanize_ms: arpeggiator.humanizeMs,
    humanize_velocity: arpeggiator.humanizeVelocity,
    transpose: arpeggiator.transpose,
    scale_quantize: arpeggiator.scaleQuantize,
    scale_root: arpeggiator.scaleRoot,
    scale_type: arpeggiator.scaleType,
    mode: arpeggiator.mode,
    restart_mode: arpeggiator.restartMode
  }));
}

export type DeleteSelectionDialogState = {
  nodeIds: string[];
  connectionKeys: string[];
  itemLabels: string[];
};

export type DeletePatchDialogState = {
  patchId: string;
  patchName: string;
  nodeCount: number;
  connectionCount: number;
};

export function sanitizeFileBaseName(value: string, fallback: string, extensionPatterns: RegExp[]): string {
  let normalizedValue = value.trim();
  for (const pattern of extensionPatterns) {
    normalizedValue = normalizedValue.replace(pattern, "");
  }

  const normalized = normalizedValue
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : fallback;
}

export function sanitizeCsdFileBaseName(value: string): string {
  return sanitizeFileBaseName(value, "orchestron_instrument", [/\.csd$/i]);
}

export function sanitizePerformanceFileBaseName(value: string): string {
  return sanitizeFileBaseName(value, "orchestron_performance", [/\.orch\.zip$/i, /\.orch\.json$/i, /\.json$/i]);
}

export function sanitizeInstrumentDefinitionFileBaseName(value: string): string {
  return sanitizeFileBaseName(
    value,
    "orchestron_instrument",
    [/\.orch\.instrument\.zip$/i, /\.orch\.instrument\.json$/i, /\.json$/i]
  );
}

export function transportStepCountFromPerformanceSequencers(
  timing: SequencerState["timing"],
  melodicTracks: Array<{ stepCount: number; pads?: Array<{ stepCount: number }> }>,
  drummerTracks: Array<{ stepCount: number; pads?: Array<{ stepCount: number }> }>,
  controllerSequencers: Array<{ stepCount: number; pads?: Array<{ stepCount: number }> }> = []
): number {
  void melodicTracks;
  void drummerTracks;
  void controllerSequencers;
  return sequencerTransportStepsPerBeat(timing);
}

export const UNBOUNDED_PLAYBACK_END_STEP = 1_000_000_000;
export const MAX_BACKEND_SEQUENCER_NOTE_TRACKS = 128;

export function trackShouldRunContinuously(
  track: {
    enabled: boolean;
    padLoopEnabled: boolean;
    padLoopRepeat: boolean;
  }
): boolean {
  return track.enabled && (!track.padLoopEnabled || track.padLoopRepeat);
}

export function enabledForSequencerConfigExport(
  track: {
    enabled: boolean;
    padLoopEnabled: boolean;
  },
  exportMode: boolean
): boolean {
  return exportMode && track.padLoopEnabled ? true : track.enabled;
}

export function hasEnabledPerformanceSequencer(state: SequencerState): boolean {
  return (
    state.tracks.some((track) => track.enabled || track.queuedEnabled === true) ||
    state.drummerTracks.some((track) => track.enabled || track.queuedEnabled === true) ||
    state.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled)
  );
}

export function buildDrummerRowTrackConfigs(
  drummerTrack: DrummerSequencerTrackState,
  levelMap: Map<number, number>,
  queueRuntimeState = true,
  exportMode = false
): SessionSequencerConfigRequest["tracks"] {
  const scaledTrackVelocity = scaleVelocityForChannel(127, drummerTrack.midiChannel, levelMap);
  const transportSequence = compileArrangerTransportSequence(drummerTrack.padLoopPattern, drummerTrack.activePad);
  const enabled = enabledForSequencerConfigExport(drummerTrack, exportMode);
  return drummerTrack.rows.map((row) => ({
    track_id: drummerRowRuntimeTrackId(drummerTrack.id, row.id),
    midi_channel: drummerTrack.midiChannel,
    timing: {
      tempo_bpm: drummerTrack.timing.tempoBPM,
      meter_numerator: drummerTrack.timing.meterNumerator,
      meter_denominator: drummerTrack.timing.meterDenominator,
      steps_per_beat: drummerTrack.timing.stepsPerBeat,
      beat_rate_numerator: drummerTrack.timing.beatRateNumerator,
      beat_rate_denominator: drummerTrack.timing.beatRateDenominator
    },
    length_beats: drummerTrack.lengthBeats,
    velocity: scaledTrackVelocity,
    gate_ratio: 0.8,
    sync_to_track_id: null,
    active_pad: drummerTrack.activePad,
    queued_pad: queueRuntimeState ? drummerTrack.queuedPad : null,
    pad_loop_enabled: drummerTrack.padLoopEnabled,
    pad_loop_repeat: drummerTrack.padLoopRepeat,
    pad_loop_sequence: transportSequence,
    enabled,
    queued_enabled: queueRuntimeState ? drummerTrack.queuedEnabled : null,
    pads: drummerTrack.pads.map((pad, padIndex) => {
      const padRow = pad.rows.find((candidate) => candidate.rowId === row.id);
      return {
        pad_index: padIndex,
        length_beats: pad.lengthBeats,
        steps: Array.from({ length: pad.stepCount }, (_, stepIndex) => {
          const cell = padRow?.steps?.[stepIndex];
          if (cell?.active !== true) {
            return {
              note: null,
              hold: false,
              velocity: scaleVelocityForChannel(cell?.velocity ?? 127, drummerTrack.midiChannel, levelMap)
            };
          }
          return {
            note: row.key,
            hold: false,
            velocity: scaleVelocityForChannel(cell.velocity, drummerTrack.midiChannel, levelMap)
          };
        })
      };
    })
  }));
}

export function patchCompileSignatureFor(
  patch: {
    id?: string;
    name: string;
    description: string;
    is_template: boolean;
    always_on: boolean;
    schema_version: number;
    graph: PatchGraph;
  },
  tabId: string
): string {
  return JSON.stringify({
    patchKey: patch.id ?? `draft:${tabId}`,
    name: patch.name,
    description: patch.description,
    is_template: patch.is_template,
    always_on: patch.always_on,
    schema_version: patch.schema_version,
    graph: patch.graph
  });
}

export function patchGraphHasOpcode(graph: PatchGraph, opcode: string): boolean {
  return graph.nodes.some((node) => node.opcode === opcode);
}


export function buildGraphSelectionDeletePlan(
  graph: PatchGraph,
  selection: EditorSelection,
  opcodes: OpcodeSpec[],
  copy: Pick<AppCopy, "deleteSelectionDialogOpcodeItem" | "deleteSelectionDialogConnectionItem">
): DeleteSelectionDialogState {
  const nodeIds = Array.from(new Set(selection.nodeIds));
  const nodeIdSet = new Set(nodeIds);
  const selectedConnectionKeySet = new Set(selection.connections.map((connection) => connectionKey(connection)));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const opcodeByName = new Map(opcodes.map((opcode) => [opcode.name, opcode]));
  const itemLabels: string[] = [];
  const connectionKeys: string[] = [];

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    const opcodeName = opcodeByName.get(node.opcode)?.name ?? node.opcode;
    itemLabels.push(copy.deleteSelectionDialogOpcodeItem(opcodeName, node.id));
  }

  for (const connection of graph.connections) {
    const key = connectionKey(connection);
    const removedWithNode =
      nodeIdSet.has(connection.from_node_id) || nodeIdSet.has(connection.to_node_id);
    if (!removedWithNode && !selectedConnectionKeySet.has(key)) {
      continue;
    }

    connectionKeys.push(key);
    itemLabels.push(
      copy.deleteSelectionDialogConnectionItem(
        `${connection.from_node_id}.${connection.from_port_id}`,
        `${connection.to_node_id}.${connection.to_port_id}`
      )
    );
  }

  return {
    nodeIds,
    connectionKeys,
    itemLabels
  };
}


