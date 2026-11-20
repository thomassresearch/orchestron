import { logicalRepeatIndex, transposePlans } from "./transposeModel";
import type { OffsetPlan } from "./transposition";
import { offsetAt } from './transposition';
import { saveTransposeEdits } from './transposeEdits';
import { parseDrummerRowRuntimeTrackId } from "../sequencerRuntime";
import type { SequencerRuntimeState, SequencerState } from "../../types";
import { arrangementTimings, sourceKeys } from "./migration";
import { CLIP_LIMITS, localBeatTicks, resolveClip, resolveContent, validateArrangement, type ClipLane, type PatternTiming, type DefinitionDraft, type PatternDefinition } from "./model";

export type RuntimeClipSchedule = { version: 1 | 2; transpose_plans?: OffsetPlan[]; end: number; cycle_ticks: number | null; clips: { id: string; start: number; length: number; offset: number; mode: "once" | "loop"; repeat_index_base?: number; content: { pad: number | null; length: number; transpose_refs?: number[] }[] }[] };
export type LivePreviews = ReadonlyMap<string, { padIndex?: number }>;
type AuditionContext = { laneId: string; schedule: RuntimeClipSchedule };
type AuditionState = SequencerState & { livePreviewSlots?: Record<string, number>; clipAuditionContext?: AuditionContext; padAuditionContext?: AuditionContext };
/** The standalone arpeggiator update must carry the same session-only schedule. */
export function clipAuditionSchedule(state: SequencerState, laneId: string): RuntimeClipSchedule | undefined {
  const context = (state as AuditionState).clipAuditionContext;
  return context?.laneId === laneId ? context.schedule : undefined;
}

/** Resolve the audible song position, including rests, clip offsets and independent lane cycles. */
export function playingClipPattern(lane: ClipLane, end: number, runtime: SequencerRuntimeState, timing?: PatternTiming) {
  const playing = runtime.independentSources ? runtime.arrangementRunning : runtime.arrangerActive ?? runtime.isPlaying;
  if (!playing) return null;
  const position = runtime.arrangementPlaybackSubunit ?? runtime.arrangerTransportSubunit ?? runtime.transportSubunit;
  if (position >= end) return null;
  const at = lane.cycleTicks ? position % lane.cycleTicks : position;
  const clip = lane.clips.find(c => c.start <= at && at < c.start + c.length);
  return clip ? resolveClip(lane, clip, at, at + 1, timing)[0]?.definition ?? null : null;
}

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
export function clipRuntimeView(state: SequencerState, previews?: LivePreviews): AuditionState {
  const model = state.clipArrangement;
  if (!model) return state;
  validateArrangement(model, arrangementTimings(state), (state as AuditionState).clipAuditionContext?.laneId);
  const next: AuditionState = { ...state };
  for (const lane of model.lanes) {
    const key = sourceKeys[lane.source];
    const definitions = lane.definitions.filter((d): d is PatternDefinition => d.kind === "pattern");
    const pads = definitions.map(d => d.payload);
    const index = previews?.get(lane.id)?.padIndex;
    const physicalPad = index === undefined ? undefined : state[key].find(track => track.id === lane.id)?.pads[index];
    if (physicalPad) {
      (next.livePreviewSlots ??= {})[lane.id] = pads.length;
      pads.push(physicalPad);
    }
    Object.assign(next, { [key]: next[key].map(track => track.id === lane.id ? {
      ...track, activePad: 0, queuedPad: null, queuedEnabled: null, padLoopEnabled: true, padLoopRepeat: false,
      padLoopPattern: { rootSequence: [], groups: [], superGroups: [] }, padLoopSequence: [], pads
    } : track) });
  }
  return next;
}

/** Reserve a session-only slot for an unsaved physical pad, keeping all authored pads accessible. */
export function withPadAudition(state: AuditionState, preview: import("../markovPattern").PadAudition | null): AuditionState {
  if (!preview) return state;
  const { deviceId, pattern } = preview;
  const key = sourceKeys[pattern.source];
  const device = state[key].find(track => track.id === deviceId);
  if (!device) return state;
  const physical = state.livePreviewSlots?.[deviceId];
  const slot = physical ?? device.pads.length;
  const length = pattern.payload.lengthBeats * localBeatTicks(device.timing);
  const schedule: RuntimeClipSchedule = { version: 1, end: length, cycle_ticks: length,
    clips: [{ id: "pad-audition", start: 0, length, offset: 0, mode: "once", content: [{ pad: slot, length }] }] };
  return { ...state, [key]: state[key].map(track => track !== device ? track : { ...track,
    pads: [...track.pads.slice(0, slot), pattern.payload, ...track.pads.slice(slot)] }),
    ...(physical === undefined ? {} : { livePreviewSlots: { ...state.livePreviewSlots, [deviceId]: physical + 1 } }),
    padAuditionContext: { laneId: deviceId, schedule } };
}

export function attachClipSchedules<T extends import("../../types").SessionSequencerConfigRequest>(state: SequencerState, config: T): T {
  const model = state.clipArrangement;
  const padAudition = (state as AuditionState).padAuditionContext;
  if (!model && !padAudition) return config;
  const schedules = new Map((model?.lanes ?? []).map(lane => [lane.id, runtimeSchedule(state, lane)]));
  const scheduleFor = (id: string) => schedules.get(id) ?? schedules.get(parseDrummerRowRuntimeTrackId(id)?.drummerTrackId ?? "");
  const audition = (state as AuditionState).clipAuditionContext;
  const auditionFor = (id: string) => {
    const device = parseDrummerRowRuntimeTrackId(id)?.drummerTrackId ?? id;
    const context = padAudition?.laneId === device ? padAudition : audition;
    const slot = (state as AuditionState).livePreviewSlots?.[device];
    return { ...(context?.laneId === device ? { audition_schedule: context.schedule } : {}),
      ...(slot === undefined ? {} : { live_preview_pad: slot }) };
  };
  return { ...config,
    playback_end_step: !model || state.arrangerLoopSelection ? config.playback_end_step : Math.ceil(model.end / 2520),
    tracks: config.tracks.map(track => ({ ...track, ...auditionFor(track.track_id), ...(scheduleFor(track.track_id) ? { clip_schedule: scheduleFor(track.track_id), pad_loop_sequence: [] } : {}) })),
    score_tracks: config.score_tracks?.map(track => ({ ...track, ...auditionFor(track.track_id), ...(schedules.has(track.track_id) ? { clip_schedule: schedules.get(track.track_id), pad_loop_sequence: [] } : {}) })),
    controller_tracks: config.controller_tracks.map(track => ({ ...track, ...auditionFor(track.track_id), ...(schedules.has(track.track_id) ? { clip_schedule: schedules.get(track.track_id), pad_loop_sequence: [] } : {}) })),
    arpeggiators: config.arpeggiators?.map(track => ({ ...track, ...auditionFor(track.arpeggiator_id), ...(schedules.has(track.arpeggiator_id) ? { clip_schedule: schedules.get(track.arpeggiator_id), pad_loop_sequence: [] } : {}) })) };
}

/** Shared definition order for audition compilation and audible UI slot lookup. */
export function clipAuditionDefinitions(lane: ClipLane, draft: DefinitionDraft) {
  const additions = new Map((draft.additions ?? []).filter(d => !lane.definitions.some(existing => existing.id === d.id)).map(d => [d.id, d]));
  const reachable = new Set<string>();
  const visit = (definition: typeof draft.definition) => {
    if (definition.kind === 'pattern') return;
    for (const item of definition.children) {
      if (!('definitionId' in item) || reachable.has(item.definitionId)) continue;
      const added = additions.get(item.definitionId);
      if (added) { reachable.add(added.id); visit(added); }
    }
  };
  visit(draft.definition);
  if (reachable.size >= CLIP_LIMITS.definitions) throw new Error("Audition draft exceeds the definition budget.");
  const definitions = [...lane.definitions, ...[...additions.values()].filter(d => reachable.has(d.id))];
  const definition = { ...draft.definition, id: `clip-audition:${draft.definition.id.slice(0,80)}` };
  if (definition.kind !== "pattern") definition.children = definition.children.map((item, index) => ({ ...item, id: `audition-child:${definition.id}:${index}` }));
  return [...definitions.filter(d => d.id !== definition.id), definition];
}

/** Append a temporary definition for audition; arranged references still point to saved data. */
export function clipAuditionState(state: SequencerState, draft: DefinitionDraft, song: SequencerState = state): { state: SequencerState; sequence: number[]; clipContext?: boolean } {
  if (!state.clipArrangement) throw new Error("A clip audition requires a clip arrangement.");
  const next = structuredClone(song), lane = next.clipArrangement!.lanes.find(l => l.id === draft.target.laneId);
  if (!lane) throw new Error("The audition lane no longer exists.");
  lane.definitions = structuredClone(clipAuditionDefinitions(lane, draft));
  const definition = lane.definitions[lane.definitions.length - 1];
  const patterns = lane.definitions.filter(d => d.kind === "pattern"), slots = new Map(patterns.map((p, i) => [p.id, i]));
  const timing = arrangementTimings(next)[lane.id];
  // Use the exact schedule for every saved format. This view is session-only.
  next.clipArrangement!.version = state.clipArrangement.version === 4 ? 4 : 3;
  const preview = saveTransposeEdits(state.clipArrangement, draft.target, draft.transposeEdits ?? [], arrangementTimings(state));
  const sourceLane = draft.auditionContext?.lane ?? preview.lanes.find(l => l.id === lane.id)!;
  const sourceClip = sourceLane.clips.find(c => c.id === draft.target.clipId)!;
  const logical = logicalRepeatIndex(sourceLane,sourceClip,draft.target.path,draft.target.pass);
  const inherited = transposePlans(sourceLane, sourceClip, draft.target.path);
  const auditionLane = { ...lane, transposeProfiles: sourceLane.transposeProfiles };
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
    transpose_refs:leaf.definition?[...inherited,...transposePlans(auditionLane,contextClip,leaf.path)].map(intern):[]}));
  const duration=content.reduce((sum,l)=>sum+l.length,0);
  const schedule: RuntimeClipSchedule = {version:2,end:duration,cycle_ticks:duration,transpose_plans:plans,
    clips:[{id:'audition',start:0,length:duration,offset:0,mode:'once',content}]};
  (next as AuditionState).clipAuditionContext={laneId:lane.id,schedule};
  // Legacy status tokens identify the selection; timing comes exclusively from the schedule.
  return {state:next,sequence:[content.find(l=>l.pad!==null)?.pad ?? -1],clipContext:true};
}
