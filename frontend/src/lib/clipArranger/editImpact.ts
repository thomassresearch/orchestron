import { definitionRelationships } from "./relationships";
import type { Clip, ClipArrangement, ClipLane, LaneTiming, OccurrenceTarget } from "./model";
import { definitionMap, type ContentItem } from "./model";

export type ClipChange = { kind: "added" | "deleted" | "moved" | "edited"; clip: Clip; before?: Clip; linked: boolean };
export type LaneChanges = { clips: Map<string, ClipChange>; definitions: Set<string>; reordered: boolean };
const omitRevision = (key: string, value: unknown) => key === "revision" ? undefined : value;
const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a, omitRevision) === JSON.stringify(b, omitRevision);

function changedDefinitions(before: ClipLane, after: ClipLane) {
  const old = definitionMap(before), changed = new Set<string>();
  const oldProfiles = new Map(before.transposeProfiles?.map(p => [p.id, p]));
  const profiles = new Set(after.transposeProfiles?.filter(p => !equal(p, oldProfiles.get(p.id))).map(p => p.id));
  for (const d of after.definitions) {
    if (!equal(old.get(d.id), d) || d.transposeProfileId && profiles.has(d.transposeProfileId)) changed.add(d.id);
  }
  // Group depth is bounded, independent of the number of loop passes.
  for (const kind of ["group", "supergroup"] as const)
    for (const d of after.definitions) if (d.kind === kind && uses(d.children, changed)) changed.add(d.id);
  return changed;
}
function uses(items: ContentItem[], ids: Set<string>) { return items.some(i => "definitionId" in i && ids.has(i.definitionId)); }
export function arrangementImpact(before: ClipArrangement, after: ClipArrangement, timings: LaneTiming = {}) {
  const lanes = new Map<string, LaneChanges>();
  if (before === after) return lanes;
  for (const [index, lane] of after.lanes.entries()) {
    const previous = before.lanes.find(l => l.id === lane.id);
    if (!previous) continue;
    const definitions = changedDefinitions(previous, lane), clips = new Map<string, ClipChange>();
    const sharedClips = new Set<string>();
    if (definitions.size) {
      const relations = definitionRelationships(previous, timings[lane.id]);
      for (const id of definitions) {
        const rel = relations.get(id);
        if (rel?.shared) rel.clipIds.forEach(id => sharedClips.add(id));
      }
    }
    const saved = new Map(previous.clips.map(c => [c.id, c]));
    for (const clip of lane.clips) {
      const old = saved.get(clip.id);
      saved.delete(clip.id);
      const definitionChange = uses(clip.children, definitions);
      if (!old || !equal(clip, old) || definitionChange) clips.set(clip.id, {
        kind: !old ? "added" : old.start !== clip.start ? "moved" : "edited", clip, before: old,
        linked: definitionChange && sharedClips.has(clip.id) && !!old && equal(old.children, clip.children)
      });
    }
    for (const old of saved.values()) clips.set(old.id, { kind: "deleted", clip: old, before: old, linked: false });
    const reordered = before.lanes[index]?.id !== lane.id;
    if (clips.size || definitions.size || reordered) lanes.set(lane.id, { clips, definitions, reordered });
  }
  return lanes;
}


/** Unresolved proposals still identify their editable source windows. */
export function markPendingClip(impact: Map<string, LaneChanges>, model: ClipArrangement, target: Pick<OccurrenceTarget,"laneId"|"clipId">, linked: boolean) {
  const clip = model.lanes.find(l => l.id === target.laneId)?.clips.find(c => c.id === target.clipId);
  if (!clip) return;
  const lane = impact.get(target.laneId) ?? {clips: new Map(), definitions: new Set<string>(), reordered: false};
  if (!lane.clips.has(clip.id)) lane.clips.set(clip.id, {kind:"edited", clip, linked});
  impact.set(target.laneId, lane);
}
