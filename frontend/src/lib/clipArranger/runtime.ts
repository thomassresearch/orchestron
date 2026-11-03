import { parseDrummerRowRuntimeTrackId } from "../sequencerRuntime";
import type { SequencerState } from "../../types";
import { arrangementTimings, sourceKeys } from "./migration";
import { resolveContent, validateArrangement, type ClipLane, type PatternDefinition } from "./model";

export type RuntimeClipSchedule = { version: 1; end: number; cycle_ticks: number | null; clips: { id: string; start: number; length: number; offset: number; mode: "once" | "loop"; content: { pad: number | null; length: number }[] }[] };
export function runtimeSchedule(state: SequencerState, lane: ClipLane): RuntimeClipSchedule {
  const patterns = lane.definitions.filter((d): d is PatternDefinition => d.kind === "pattern");
  const slots = new Map(patterns.map((p, i) => [p.id, i]));
  return { version: 1, end: state.clipArrangement!.end, cycle_ticks: lane.cycleTicks,
    clips: [...lane.clips].sort((a, b) => a.start - b.start).map(clip => ({ id: clip.id, start: clip.start, length: clip.length, offset: clip.offset, mode: clip.mode,
      content: resolveContent(lane, clip.children, arrangementTimings(state)[lane.id]).map(leaf => ({ pad: leaf.definition ? slots.get(leaf.definition.id)! : null, length: leaf.length })) })) };
}

/** Compilation view only. Existing musical serializers remain the single payload authority. */
export function clipRuntimeView(state: SequencerState): SequencerState {
  const model = state.clipArrangement;
  if (!model) return state;
  validateArrangement(model, arrangementTimings(state));
  const next = { ...state };
  for (const lane of model.lanes) {
    const key = sourceKeys[lane.source];
    const definitions = lane.definitions.filter((d): d is PatternDefinition => d.kind === "pattern");
    Object.assign(next, { [key]: next[key].map(track => track.id === lane.id ? {
      ...track, activePad: 0, queuedPad: null, queuedEnabled: null, padLoopEnabled: true, padLoopRepeat: false,
      padLoopPattern: { rootSequence: [], groups: [], superGroups: [] }, padLoopSequence: [], pads: definitions.map(d => d.payload)
    } : track) });
  }
  return next;
}

export function attachClipSchedules<T extends import("../../types").SessionSequencerConfigRequest>(state: SequencerState, config: T): T {
  const model = state.clipArrangement;
  if (!model) return config;
  const schedules = new Map(model.lanes.map(lane => [lane.id, runtimeSchedule(state, lane)]));
  const scheduleFor = (id: string) => schedules.get(id) ?? schedules.get(parseDrummerRowRuntimeTrackId(id)?.drummerTrackId ?? "");
  return { ...config,
    playback_end_step: state.arrangerLoopSelection ? config.playback_end_step : Math.ceil(model.end / 2520),
    tracks: config.tracks.map(track => ({ ...track, ...(scheduleFor(track.track_id) ? { clip_schedule: scheduleFor(track.track_id), pad_loop_sequence: [] } : {}) })),
    score_tracks: config.score_tracks?.map(track => ({ ...track, ...(schedules.has(track.track_id) ? { clip_schedule: schedules.get(track.track_id), pad_loop_sequence: [] } : {}) })),
    controller_tracks: config.controller_tracks.map(track => ({ ...track, ...(schedules.has(track.track_id) ? { clip_schedule: schedules.get(track.track_id), pad_loop_sequence: [] } : {}) })),
    arpeggiators: config.arpeggiators?.map(track => ({ ...track, ...(schedules.has(track.arpeggiator_id) ? { clip_schedule: schedules.get(track.arpeggiator_id), pad_loop_sequence: [] } : {}) })) };
}

/** Append a temporary definition for audition; arranged references still point to saved data. */
export function clipAuditionState(state: SequencerState, draft: import("./model").DefinitionDraft): { state: SequencerState; sequence: number[] } {
  if (!state.clipArrangement) throw new Error("A clip audition requires a clip arrangement.");
  const next = structuredClone(state), lane = next.clipArrangement!.lanes.find(l => l.id === draft.target.laneId);
  if (!lane) throw new Error("The audition lane no longer exists.");
  lane.definitions.push(...structuredClone((draft.additions ?? []).filter(d => !lane.definitions.some(existing => existing.id === d.id))));
  const definition = structuredClone(draft.definition); definition.id = `clip-audition:${draft.definition.id.slice(0,80)}`;
  if (definition.kind !== "pattern") definition.children = definition.children.map((item, index) => ({ ...item, id: `audition-child:${definition.id}:${index}` }));
  lane.definitions = lane.definitions.filter(d => d.id !== definition.id);
  lane.definitions.push(definition);
  const patterns = lane.definitions.filter(d => d.kind === "pattern"), slots = new Map(patterns.map((p, i) => [p.id, i]));
  const timing = arrangementTimings(next)[lane.id];
  const beat = timing ? 20160 * 4 / timing.meterDenominator * timing.beatRateDenominator / timing.beatRateNumerator : 20160;
  const sequence: number[] = [];
  for (const leaf of resolveContent(lane, [{ id: crypto.randomUUID(), definitionId: definition.id }], timing)) {
    if (leaf.definition) sequence.push(slots.get(leaf.definition.id)!);
    else {
      let beats = leaf.length / beat;
      if (!Number.isInteger(beats)) throw new Error("This rest cannot yet be auditioned on the source grid.");
      for (const size of [32, 16, 8, 4, 2, 1]) while (beats >= size) { sequence.push(-size); beats -= size; }
    }
  }
  return { state: next, sequence };
}
