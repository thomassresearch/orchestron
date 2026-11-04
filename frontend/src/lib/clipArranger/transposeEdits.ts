import { validateArrangement, newClipId, type ClipArrangement, type ClipLane, type ContentItem, type LaneTiming, type OccurrenceTarget } from './model';
import { definitionAt, clipFor, laneFor } from './operations';
import { emptyOffsetPlan, validateOffsetPlan, type OffsetPlan } from './transposition';
import { transposePlans } from './transposeModel';

export type TransposeScope = 'shared' | 'parent' | 'placement';
export type TransposeEdit = { scope: TransposeScope; plan: OffsetPlan; fingerprint: string };
function reference(lane: ClipLane, target: OccurrenceTarget) {
  let items = clipFor(lane, target.clipId).children, parent;
  for (const id of target.path.slice(0,-1)) {
    const item = items.find(i => i.id === id);
    const definition = item && 'definitionId' in item ? lane.definitions.find(d => d.id === item.definitionId) : undefined;
    if (!definition || definition.kind === 'pattern') throw Error('The transposition path changed.');
    parent = definition; items = parent.children;
  }
  const item = items.find(i => i.id === target.path[target.path.length - 1]);
  if (!item || !('definitionId' in item)) throw Error('Select a pattern, group or supergroup.');
  return { item, parent };
}
export function readTransposePlan(model: ClipArrangement, target: OccurrenceTarget, scope: TransposeScope): OffsetPlan {
  const lane = laneFor(model, target.laneId), definition = definitionAt(lane, target), clip = clipFor(lane, target.clipId);
  const plan = scope === 'shared' ? lane.transposeProfiles?.find(p => p.id === definition.transposeProfileId)?.plan
    : scope === 'parent' ? reference(lane, target).item.transpose : clip.transposePlacements?.find(p => JSON.stringify(p.path) === JSON.stringify(target.path))?.plan;
  return structuredClone(plan ?? emptyOffsetPlan());
}
export function transposeFingerprint(model: ClipArrangement, target: OccurrenceTarget): string {
  const lane = laneFor(model, target.laneId), clip = clipFor(lane, target.clipId);
  return JSON.stringify([target, clip.offset, clip.mode, clip.repeatIndexBase, target.path.map((_, index) => {
    const partial = { ...target, path: target.path.slice(0,index+1) }, def = definitionAt(lane, partial);
    return [def.id, def.revision, def.transposeProfileId, lane.transposeProfiles?.find(p => p.id === def.transposeProfileId), reference(lane, partial).item];
  }), transposePlans(lane, clip, target.path)]);
}
/** One validated transaction, no split or musical copy-on-write for transpose-only edits. */
export function saveTransposeEdits(model: ClipArrangement, target: OccurrenceTarget, edits: TransposeEdit[], timings: LaneTiming = {}, id = newClipId): ClipArrangement {
  if (!edits.length) return model;
  const fingerprint = transposeFingerprint(model, target);
  for (const edit of edits) { validateOffsetPlan(edit.plan); if (edit.fingerprint !== fingerprint) throw Error('Transposition dependencies changed. Reopen the draft before saving.'); }
  const next = structuredClone(model), lane = laneFor(next, target.laneId), clip = clipFor(lane, target.clipId), definition = definitionAt(lane, target);
  next.version = next.version === 4 ? 4 : 3; next.revision++;
  for (const edit of edits) {
    const plan = structuredClone(edit.plan);
    if (edit.scope === 'shared') {
      lane.transposeProfiles ??= [];
      let profile = lane.transposeProfiles.find(p => p.id === definition.transposeProfileId);
      if (!profile) { profile = { id: id(), revision: 0, plan }; lane.transposeProfiles.push(profile); definition.transposeProfileId = profile.id; }
      else { profile.plan = plan; profile.revision++; }
    } else if (edit.scope === 'parent') {
      const { item, parent } = reference(lane, target); item.transpose = plan; if (parent) parent.revision++;
    } else {
      clip.transposePlacements ??= [];
      const placement = clip.transposePlacements.find(p => JSON.stringify(p.path) === JSON.stringify(target.path));
      if (placement) placement.plan = plan; else clip.transposePlacements.push({ path: [...target.path], plan });
    }
  }
  validateArrangement(next, timings); return next;
}

/** Fresh child identities must carry every saved full-path placement with them. */
export function remapPlacementChildren(clip: import('./model').Clip, children: ContentItem[]) {
  const ids = new Map(clip.children.map((item, index) => [item.id, children[index].id]));
  return { ...clip, children, ...(clip.transposePlacements ? { transposePlacements: clip.transposePlacements.map(p => ({ ...p, path: [ids.get(p.path[0])!, ...p.path.slice(1)] })) } : {}) };
}
