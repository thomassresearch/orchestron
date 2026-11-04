import { logicalRepeatIndex, transposePlans } from "./transposeModel";
import type { OffsetPlan } from "./transposition";
import { offsetAt } from './transposition';
import { saveTransposeEdits } from './transposeEdits';
import { parseDrummerRowRuntimeTrackId } from "../sequencerRuntime";
import type { SequencerState } from "../../types";
import { arrangementTimings, sourceKeys } from "./migration";
import { resolveContent, validateArrangement, type ClipLane, type DefinitionDraft, type PatternDefinition } from "./model";

export type RuntimeClipSchedule = { version: 1 | 2; transpose_plans?: OffsetPlan[]; end: number; cycle_ticks: number | null; clips: { id: string; start: number; length: number; offset: number; mode: "once" | "loop"; repeat_index_base?: number; content: { pad: number | null; length: number; transpose_refs?: number[] }[] }[] };
type AuditionState = SequencerState & { clipAuditionContext?: { laneId: string; schedule: RuntimeClipSchedule } };
export function runtimeSchedule(state: SequencerState, lane: ClipLane): RuntimeClipSchedule {
  const patterns = lane.definitions.filter((d): d is PatternDefinition => d.kind === "pattern");
  const slots = new Map(patterns.map((p, i) => [p.id, i]));
  const version = state.clipArrangement!.version >= 3 ? 2 : 1;
  const plans: OffsetPlan[] = [], indices = new Map<string, number>();
  const intern = (plan: OffsetPlan) => { const key = JSON.stringify(plan); if (!indices.has(key)) { indices.set(key, plans.length); plans.push(plan); } return indices.get(key)!; };
  const clips = [...lane.clips].sort((a,b) => a.start-b.start).map(clip => ({
    id: clip.id, start: clip.start, length: clip.length, offset: clip.offset, mode: clip.mode,
    ...(version === 2 ? { repeat_index_base: clip.repeatIndexBase ?? 0 } : {}),
    content: resolveContent(lane, clip.children, arrangementTimings(state)[lane.id]).map(leaf => ({
      pad: leaf.definition ? slots.get(leaf.definition.id)! : null, length: leaf.length,
      ...(version === 2 ? { transpose_refs: leaf.definition ? transposePlans(lane, clip, leaf.path).map(intern) : [] } : {})
    }))
  }));
  return { version, end: state.clipArrangement!.end, cycle_ticks: lane.cycleTicks, clips, ...(version === 2 ? { transpose_plans: plans } : {}) };
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
  const audition = (state as AuditionState).clipAuditionContext;
  const auditionFor = (id: string) => audition && (id === audition.laneId || parseDrummerRowRuntimeTrackId(id)?.drummerTrackId === audition.laneId) ? { audition_schedule: audition.schedule } : {};
  return { ...config,
    playback_end_step: state.arrangerLoopSelection ? config.playback_end_step : Math.ceil(model.end / 2520),
    tracks: config.tracks.map(track => ({ ...track, ...auditionFor(track.track_id), ...(scheduleFor(track.track_id) ? { clip_schedule: scheduleFor(track.track_id), pad_loop_sequence: [] } : {}) })),
    score_tracks: config.score_tracks?.map(track => ({ ...track, ...auditionFor(track.track_id), ...(schedules.has(track.track_id) ? { clip_schedule: schedules.get(track.track_id), pad_loop_sequence: [] } : {}) })),
    controller_tracks: config.controller_tracks.map(track => ({ ...track, ...auditionFor(track.track_id), ...(schedules.has(track.track_id) ? { clip_schedule: schedules.get(track.track_id), pad_loop_sequence: [] } : {}) })),
    arpeggiators: config.arpeggiators?.map(track => ({ ...track, ...auditionFor(track.arpeggiator_id), ...(schedules.has(track.arpeggiator_id) ? { clip_schedule: schedules.get(track.arpeggiator_id), pad_loop_sequence: [] } : {}) })) };
}

/** Shared definition order for audition compilation and audible UI slot lookup. */
export function clipAuditionDefinitions(lane: ClipLane, draft: DefinitionDraft) {
  const definitions = [...lane.definitions,
    ...(draft.additions ?? []).filter(d => !lane.definitions.some(existing => existing.id === d.id))];
  const definition = { ...draft.definition, id: `clip-audition:${draft.definition.id.slice(0,80)}` };
  if (definition.kind !== "pattern") definition.children = definition.children.map((item, index) => ({ ...item, id: `audition-child:${definition.id}:${index}` }));
  return [...definitions.filter(d => d.id !== definition.id), definition];
}

/** Append a temporary definition for audition; arranged references still point to saved data. */
export function clipAuditionState(state: SequencerState, draft: import("./model").DefinitionDraft): { state: SequencerState; sequence: number[]; clipContext?: boolean } {
  if (!state.clipArrangement) throw new Error("A clip audition requires a clip arrangement.");
  const next = structuredClone(state), lane = next.clipArrangement!.lanes.find(l => l.id === draft.target.laneId);
  if (!lane) throw new Error("The audition lane no longer exists.");
  lane.definitions = structuredClone(clipAuditionDefinitions(lane, draft));
  const definition = lane.definitions[lane.definitions.length - 1];
  const patterns = lane.definitions.filter(d => d.kind === "pattern"), slots = new Map(patterns.map((p, i) => [p.id, i]));
  const timing = arrangementTimings(next)[lane.id];
  const beat = timing ? 20160 * 4 / timing.meterDenominator * timing.beatRateDenominator / timing.beatRateNumerator : 20160;
  const sequence: number[] = [];
  // V3 auditions use exact clip timing and a frozen source-repetition context.
  if (state.clipArrangement.version >= 3 || draft.transposeEdits?.length) {
    next.clipArrangement!.version = state.clipArrangement.version === 4 ? 4 : 3;
    const preview = saveTransposeEdits(state.clipArrangement, draft.target, draft.transposeEdits ?? [], arrangementTimings(state));
    const sourceLane = draft.auditionContext?.lane ?? preview.lanes.find(l => l.id === lane.id)!;
    const sourceClip = sourceLane.clips.find(c => c.id === draft.target.clipId)!;
    const logical = logicalRepeatIndex(sourceLane,sourceClip,draft.target.path,draft.target.pass);
    const inherited = transposePlans(sourceLane, sourceClip, draft.target.path);
    lane.transposeProfiles = structuredClone(sourceLane.transposeProfiles);
    // The selected level is already included in inherited; descendants add their own scopes.
    delete definition.transposeProfileId;
    const root = { id: 'audition-root', definitionId: definition.id, repeatIndex:logical };
    const contextClip = { ...sourceClip, children: [root], transposePlacements: sourceClip.transposePlacements?.flatMap(p => {
      if (p.path.length <= draft.target.path.length || !draft.target.path.every((id,i)=>p.path[i]===id)) return [];
      const suffix = p.path.slice(draft.target.path.length).map(id => draft.auditionContext?.childIds[id] ?? id);
      if (definition.kind !== 'pattern' && draft.definition.kind !== 'pattern') {
        const index = draft.definition.children.findIndex(i=>i.id===p.path[draft.target.path.length]);
        if (index < 0) throw Error('The audition placement changed. Refresh the draft.');
        suffix[0] = definition.children[index].id;
      }
      return [{...p,path:[root.id,...suffix]}];
    }) };
    const plans: OffsetPlan[] = [], indices = new Map<string,number>();
    const intern = (p: OffsetPlan) => {
      const frozen = {base:offsetAt(p,(sourceClip.repeatIndexBase??0)+draft.target.pass),repetitions:[]}, key = JSON.stringify(frozen);
      if (!indices.has(key)) { indices.set(key,plans.length); plans.push(frozen); }
      return indices.get(key)!;
    };
    const content = resolveContent(lane,[root],timing).map(leaf=>({pad:leaf.definition?slots.get(leaf.definition.id)!:null,length:leaf.length,
      transpose_refs:leaf.definition?[...inherited,...transposePlans(lane,contextClip,leaf.path)].map(intern):[]}));
    const duration=content.reduce((sum,l)=>sum+l.length,0);
    const schedule: RuntimeClipSchedule = {version:2,end:duration,cycle_ticks:duration,transpose_plans:plans,
      clips:[{id:'audition',start:0,length:duration,offset:0,mode:'once',content}]};
    (next as AuditionState).clipAuditionContext={laneId:lane.id,schedule};
    // Legacy status tokens identify the selection; timing comes exclusively from the schedule.
    return {state:next,sequence:[content.find(l=>l.pad!==null)?.pad ?? -1],clipContext:true};
  }
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
