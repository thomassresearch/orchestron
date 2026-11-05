import { validateTranspositions } from "./transposeModel";
import type { OffsetPlan, TransposeProfile } from "./transposition";
import type { ArpeggiatorPadState, ControllerSequencerPadState, DrummerSequencerPadState, ScorePadState, SequencerPadState, SequencerTimingConfig } from "../../types";

/** Authored time uses the existing transport/score timebase, never animation frames. */
export const QUARTER_TICKS = 20160;
export const CLIP_LIMITS = { lanes: 72, definitions: 512, children: 256, clips: 2048, leaves: 65536, ticks: QUARTER_TICKS * 1000000 } as const;
export type SourceKind = "sequencer" | "score" | "drummer" | "controller" | "arpeggiator";
export type PatternPayload = {
  sequencer: SequencerPadState;
  score: ScorePadState;
  drummer: DrummerSequencerPadState;
  controller: ControllerSequencerPadState;
  arpeggiator: ArpeggiatorPadState;
};
export type PatternDefinition = { [K in SourceKind]: DefinitionIdentity & { kind: "pattern"; source: K; payload: PatternPayload[K]; presetId?: string | null } }[SourceKind];
export type DefinitionIdentity = { id: string; name: string; revision: number; color?: string; transposeProfileId?: string };
export type ContentItem = { id: string; definitionId: string; repeatIndex?: number; transpose?: OffsetPlan } | { id: string; restTicks: number };
export type ContainerDefinition = DefinitionIdentity & { kind: "group" | "supergroup"; children: ContentItem[] };
export type Definition = PatternDefinition | ContainerDefinition;
export type Clip = { id: string; name: string; start: number; length: number; offset: number; mode: "once" | "loop"; children: ContentItem[]; repeatIndexBase?: number; transposePlacements?: { path: string[]; plan: OffsetPlan }[] };
export type ClipLane = {
  id: string; source: SourceKind; transposeProfiles?: TransposeProfile[]; definitions: Definition[]; clips: Clip[];
  /** Legacy repeating lanes repeat their authored cycle, independently of song looping. */
  cycleTicks: number | null;
};
export type ClipArrangement = { version: 1 | 2 | 3 | 4; revision: number; end: number; lanes: ClipLane[] };
export type OccurrenceTarget = { laneId: string; clipId: string; path: string[]; pass: number };
export type DefinitionDraft = { target: OccurrenceTarget; baseRevision: number; baseFingerprint?: string; definition: Definition; additions?: Definition[]; transposeEdits?: import("./transposeEdits").TransposeEdit[]; auditionContext?: { lane: ClipLane; childIds: Record<string,string> } };
export type ClipHistoryChange =
  | { kind: "replace"; path: (string | number)[]; before?: unknown; after?: unknown }
  | { kind: "splice"; path: (string | number)[]; index: number; before: unknown[]; after: unknown[] };
export type ClipHistoryEntry = { label: string; changes: ClipHistoryChange[] };
/** One current-state basis detects external edits; entries contain only reversible changes. */
export type ClipHistory = { version: 2; cursor: number; basis: ClipArrangement | null; entries: ClipHistoryEntry[] };
export type PatternTiming = SequencerTimingConfig & { controllerMode?: "curve" | "step"; automation?: boolean };
export type LaneTiming = Readonly<Record<string, PatternTiming | undefined>>;
export function patternDuration(definition: PatternDefinition, timing?: PatternTiming): number {
  return exactTick(definition.source === "controller" && timing?.controllerMode !== "step" && definition.payload.curveDurationTicks !== undefined
    ? definition.payload.curveDurationTicks : definition.payload.lengthBeats * localBeatTicks(timing), true);
}
export type ResolvedLeaf = { definition: PatternDefinition | null; path: string[]; start: number; length: number };
export type ClipSegment = ResolvedLeaf & { clipId: string; pass: number; sourceOffset: number; sourceStart: number };
export class ClipError extends Error {
  constructor(public code: "invalid" | "collision" | "limit" | "missing" | "conflict" | "offset", message: string) { super(message); }
}
export const newClipId = () => crypto.randomUUID();
export function exactTick(value: number, positive = false): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > CLIP_LIMITS.ticks) throw new ClipError("invalid", "Time must be an exact, bounded transport tick.");
  return value;
}
export function localBeatTicks(timing?: PatternTiming): number {
  return timing ? exactTick(QUARTER_TICKS * 4 * timing.beatRateDenominator / (timing.meterDenominator * timing.beatRateNumerator), true) : QUARTER_TICKS;
}
export function definitionMap(lane: ClipLane): Map<string, Definition> { return new Map(lane.definitions.map(d => [d.id, d])); }

/** A bounded DAG: groups contain patterns; supergroups contain groups/patterns. */
export function resolveContent(lane: ClipLane, children: ContentItem[], timing?: PatternTiming): ResolvedLeaf[] {
  const defs = definitionMap(lane), result: ResolvedLeaf[] = [];
  let cursor = 0;
  const visit = (items: ContentItem[], level: number, path: string[]) => {
    for (const item of items) {
      if (result.length >= CLIP_LIMITS.leaves) throw new ClipError("limit", "Content expansion limit exceeded.");
      const nextPath = [...path, item.id];
      if ("restTicks" in item) { result.push({ definition: null, path: nextPath, start: cursor, length: item.restTicks }); cursor += item.restTicks; }
      else {
        const def = defs.get(item.definitionId);
        if (!def) throw new ClipError("missing", "Missing content definition.");
        const rank = def.kind === "pattern" ? 0 : def.kind === "group" ? 1 : 2;
        if (rank >= level) throw new ClipError("invalid", "Invalid nesting or cyclic content.");
        if (def.kind === "pattern") {
          const length = patternDuration(def, timing);
          result.push({ definition: def, path: nextPath, start: cursor, length }); cursor += length;
        } else visit(def.children, rank, nextPath);
      }
      exactTick(cursor);
    }
  };
  visit(children, 3, []);
  return result;
}
export function contentLength(lane: ClipLane, children: ContentItem[], timing?: PatternTiming): number {
  return resolveContent(lane, children, timing).reduce((sum, item) => sum + item.length, 0);
}

/** Resolve only the requested viewport/render interval. Long loops never allocate all passes. */
export function resolveClip(lane: ClipLane, clip: Clip, from: number, to: number, timing?: PatternTiming): ClipSegment[] {
  const start = Math.max(clip.start, from), end = Math.min(clip.start + clip.length, to);
  if (end <= start) return [];
  const leaves = resolveContent(lane, clip.children, timing), duration = leaves.reduce((sum, leaf) => sum + leaf.length, 0);
  if (!duration) return [];
  const first = clip.mode === "loop" ? Math.floor((clip.offset + start - clip.start) / duration) : 0;
  const last = clip.mode === "loop" ? Math.ceil((clip.offset + end - clip.start) / duration) - 1 : 0;
  if ((last - first + 1) * leaves.length > CLIP_LIMITS.leaves) throw new ClipError("limit", "Resolve a smaller time interval.");
  const result: ClipSegment[] = [];
  for (let pass = first; pass <= last; pass++) for (const leaf of leaves) {
    const sourceStart = clip.start - clip.offset + pass * duration + leaf.start;
    const left = Math.max(start, sourceStart), right = Math.min(end, sourceStart + leaf.length);
    if (right > left) result.push({ ...leaf, start: left, length: right - left, sourceOffset: left - sourceStart, sourceStart, clipId: clip.id, pass });
  }
  return result;
}

/** No JSON normalization here: malformed authored content must not be silently discarded. */
export function validateArrangement(arrangement: ClipArrangement, timings: LaneTiming = {}, auditionLaneId?: string): void {
  if (![1, 2, 3, 4].includes(arrangement.version) || !Number.isSafeInteger(arrangement.revision) || arrangement.revision < 0) throw new ClipError("invalid", "Unsupported clip arrangement version or revision.");
  exactTick(arrangement.end, true);
  if (arrangement.lanes.length > CLIP_LIMITS.lanes) throw new ClipError("limit", "Too many lanes.");
  const identities = new Set<string>();
  const identity = (id: string) => {
    if (typeof id !== "string" || !id.length || id.length > 128 || identities.has(id)) throw new ClipError("invalid", "Identities must be unique nonempty strings.");
    identities.add(id);
  };
  validateTranspositions(arrangement, identity);
  for (const lane of arrangement.lanes) {
    identity(lane.id);
    if (!["sequencer", "score", "drummer", "controller", "arpeggiator"].includes(lane.source)) throw new ClipError("invalid", "Unknown source type.");
    if (lane.definitions.length > CLIP_LIMITS.definitions * (lane.id === auditionLaneId ? 2 : 1) || lane.clips.length > CLIP_LIMITS.clips) throw new ClipError("limit", "Lane resource limit exceeded.");
    if (lane.cycleTicks !== null) exactTick(lane.cycleTicks, true);
    const defs = definitionMap(lane);
    const children = (items: ContentItem[], level: number) => {
      if (!items.length || items.length > CLIP_LIMITS.children) throw new ClipError("limit", "Content must contain 1–256 items.");
      for (const item of items) {
        identity(item.id);
        if ("restTicks" in item) { exactTick(item.restTicks, true); continue; }
        const def = defs.get(item.definitionId);
        if (!def) throw new ClipError("missing", "Missing definition.");
        const rank = def.kind === "pattern" ? 0 : def.kind === "group" ? 1 : 2;
        if (rank >= level) throw new ClipError("invalid", "Invalid content nesting.");
      }
      // Includes unused definitions; resource checks cannot be bypassed by leaving one unplaced.
      contentLength(lane, items, timings[lane.id]);
    };
    for (const def of lane.definitions) {
      identity(def.id);
      if (typeof def.name !== "string" || !def.name.trim() || def.name.length > 128 || !Number.isSafeInteger(def.revision) || def.revision < 0) throw new ClipError("invalid", "Invalid definition name or revision.");
      if (def.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(def.color)) throw new ClipError("invalid", "Invalid definition color.");
      if (def.kind === "pattern") {
        if (def.source !== lane.source) throw new ClipError("invalid", "Patterns must match their lane type.");
        patternDuration(def, timings[lane.id]);
        if (def.source === "controller" && (timings[lane.id]?.automation || def.payload.curveDurationTicks !== undefined)) {
          if (!timings[lane.id]?.automation) throw new ClipError("invalid", "Extended curves require an automation target.");
          if (arrangement.version < 2 || def.payload.keypoints.length < 2 || def.payload.keypoints.length > 10) throw new ClipError("limit", "Automation curves require 2–10 points, including endpoints.");
          const positions = def.payload.keypoints.map(p => p.position).sort((a, b) => a - b);
          if (positions[0] !== 0 || positions[positions.length - 1] !== 1 || new Set(positions).size !== positions.length) throw new ClipError("invalid", "Automation curves require distinct points and both endpoints.");
          if (def.payload.curveDurationTicks !== undefined) exactTick(def.payload.curveDurationTicks, true);
        }
      } else if (def.kind === "group" || def.kind === "supergroup") children(def.children, def.kind === "group" ? 1 : 2);
      else throw new ClipError("invalid", "Unknown definition type.");
    }
    let previousEnd = 0;
    for (const clip of [...lane.clips].sort((a, b) => a.start - b.start)) {
      identity(clip.id); exactTick(clip.start); exactTick(clip.length, true); exactTick(clip.offset);
      if (typeof clip.name !== "string" || !clip.name.trim() || clip.name.length > 128 || !["once", "loop"].includes(clip.mode)) throw new ClipError("invalid", "Invalid clip name or mode.");
      if (clip.start < previousEnd) throw new ClipError("collision", "Clips on the same lane cannot overlap.");
      previousEnd = exactTick(clip.start + clip.length);
      if (previousEnd > arrangement.end || lane.cycleTicks !== null && previousEnd > lane.cycleTicks) throw new ClipError("invalid", "Clip extends beyond its song/cycle boundary.");
      children(clip.children, 3);
      const duration = contentLength(lane, clip.children, timings[lane.id]);
      const last = (clip.repeatIndexBase ?? 0) + (clip.mode === "loop" ? Math.floor((clip.offset + clip.length - 1) / duration) : 0);
      if (last > 40320000000) throw new ClipError("limit", "Logical repetition extent exceeded.");
    }
  }
}
