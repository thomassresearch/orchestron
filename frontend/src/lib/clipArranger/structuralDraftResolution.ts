import { contentLength, type ClipArrangement, type DefinitionDraft, type LaneTiming, type OccurrenceTarget } from './model';
import { beginDraft, definitionAt } from './operations';
import { hasChangedClipDrafts } from './draftResolution';
import { transposeFingerprint } from './transposeEdits';
import { applyStructure, beginStructure, stepStructure, structureChildren, type StructureCommand, type StructureDraft, type StructureNode } from './structure';

/** Musical saves preserve sibling order, but local forks/splits can change occurrence IDs. */
export function remapMusicalTarget(before: ClipArrangement, after: ClipArrangement, target: OccurrenceTarget, timings: LaneTiming): OccurrenceTarget {
  const oldLane = before.lanes.find(l => l.id === target.laneId)!;
  const newLane = after.lanes.find(l => l.id === target.laneId)!;
  const oldClip = oldLane.clips.find(c => c.id === target.clipId)!;
  const duration = contentLength(oldLane, oldClip.children, timings[oldLane.id]);
  const anchor = oldClip.mode === 'once' ? oldClip.start : Math.max(oldClip.start, oldClip.start - oldClip.offset + target.pass * duration);
  let clip = newLane.clips.find(c => c.id === target.clipId);
  const split = oldClip.mode === 'loop' && clip?.mode === 'once';
  if (split) clip = newLane.clips.find(c => c.start <= anchor && c.start + c.length > anchor);
  if (!clip) throw Error('The edited occurrence no longer exists.');
  const pass = clip.mode === 'once' ? 0 : split
    ? Math.floor((clip.offset + anchor - clip.start) / contentLength(newLane, clip.children, timings[newLane.id])) : target.pass;
  let oldItems = oldClip.children, newItems = clip.children;
  const path = target.path.map(id => {
    const index = oldItems.findIndex(i => i.id === id), oldItem = oldItems[index], newItem = newItems[index];
    if (!oldItem || !newItem || !('definitionId' in oldItem) || !('definitionId' in newItem)) throw Error('The edited path changed.');
    const oldDef = oldLane.definitions.find(d => d.id === oldItem.definitionId)!;
    const newDef = newLane.definitions.find(d => d.id === newItem.definitionId)!;
    oldItems = oldDef.kind === 'pattern' ? [] : oldDef.children;
    newItems = newDef.kind === 'pattern' ? [] : newDef.children;
    return newItem.id;
  });
  return { ...target, clipId: clip.id, pass, path };
}

export function remapStructureCommand(command: StructureCommand, before: StructureNode[], after: StructureNode[]): StructureCommand {
  if(command.kind==='groupRepetitions') {
    const point=(p:{pass:number;id:string})=>{const index=before.findIndex(n=>n.id===p.id);if(index<0||!after[index])throw Error('The structural selection changed.');return {...p,id:after[index].id};};
    return {...command,range:{first:point(command.range.first),last:point(command.range.last)}};
  }
  const path = (ids: string[]) => {
    let oldItems = before, newItems = after;
    return ids.map(id => {
      const index = oldItems.findIndex(n => n.id === id), node = newItems[index];
      if (index < 0 || !node) throw Error('The structural selection changed.');
      oldItems = oldItems[index].children ?? []; newItems = node.children ?? [];
      return node.id;
    });
  };
  if (command.kind === 'insert' || command.kind === 'rest') return { ...command, target: { ...command.target, path: path(command.target.path) } };
  if (command.kind === 'rename') return { ...command, path: path(command.path) };
  const parent = path(command.parent), oldItems = structureChildren(before, command.parent), newItems = structureChildren(after, parent);
  const ids = command.kind==='timed'&&command.nodes?[]:command.ids.map(id => {
    const item = newItems[oldItems.findIndex(n => n.id === id)];
    if (!item) throw Error('The structural selection changed.');
    return item.id;
  });
  return (command.kind === 'move'||command.kind === 'timed') ? { ...command, parent, ids, target: { ...command.target, path: path(command.target.path) } } : { ...command, parent, ids };
}

/** Replay every draft-history step, including redo, against a musical-only saved change. */
export function rebaseStructure(draft: StructureDraft, model: ClipArrangement, timings: LaneTiming): StructureDraft {
  const before = { ...model, lanes: model.lanes.map(l => l.id === draft.laneId ? draft.basis : l) };
  const target = remapMusicalTarget(before, model, { laneId: draft.laneId, clipId: draft.clipId, pass: draft.pass, path: [] }, timings);
  let next = beginStructure(model, target.laneId, target.clipId, target.pass);
  const lane=model.lanes.find(l=>l.id===draft.laneId)!,oldClip=draft.basis.clips.find(c=>c.id===draft.clipId)!,clip=lane.clips.find(c=>c.id===target.clipId)!;
  const following=new Set(draft.followingPassClipIds??[]);
  const inherited=draft.basis.clips.filter(c=>following.has(c.id));
  if(oldClip.mode==='loop'&&clip.mode==='once') inherited.push({...oldClip,start:clip.start+clip.length,length:oldClip.start+oldClip.length-clip.start-clip.length});
  for(const window of inherited)for(const candidate of lane.clips)if(candidate.start>=window.start&&candidate.start+candidate.length<=window.start+window.length)following.add(candidate.id);
  next.followingPassClipIds=[...following].filter(id=>lane.clips.some(c=>c.id===id));
  for (let i = 0; i < draft.commands.length; i++) {
    let command = remapStructureCommand(draft.commands[i], draft.history[i], next.roots);
    if (command.kind === 'insert') {
      const definition = command.definition;
      command = { ...command, definition: next.basis.definitions.find(d => d.id === definition.id) ?? definition };
    }
    next = applyStructure(next, command, timings, model);
  }
  return stepStructure(next, draft.cursor - next.cursor);
}

/** Include descendants whose parent forks/changes even if their own definition is unchanged. */
export function affectedDraftKeys(before: ClipArrangement, after: ClipArrangement, drafts: Record<string, DefinitionDraft>): string[] {
  return Object.entries(drafts).filter(([, draft]) => {
    try {
      if (draft.transposeEdits?.length && transposeFingerprint(before,draft.target)!==transposeFingerprint(after,draft.target)) return true;
      const oldLane = before.lanes.find(l => l.id === draft.target.laneId)!;
      const newLane = after.lanes.find(l => l.id === draft.target.laneId)!;
      const oldClip = oldLane.clips.find(c => c.id === draft.target.clipId)!;
      const newClip = newLane.clips.find(c => c.id === draft.target.clipId);
      if (!newClip || newClip.mode !== oldClip.mode || newClip.offset !== oldClip.offset) return true;
      return JSON.stringify(definitionAt(oldLane, draft.target)) !== JSON.stringify(definitionAt(newLane, draft.target));
    } catch { return true; }
  }).map(([key]) => key);
}

export function retainMusicalDrafts(before: ClipArrangement, after: ClipArrangement, drafts: Record<string, DefinitionDraft>, removedKey: string, timings: LaneTiming) {
  const result: Record<string, DefinitionDraft> = {}, keys = new Map<string, string>();
  for (const [key, draft] of Object.entries(drafts)) {
    if (key === removedKey) continue;
    let next = draft;
    try {
      const target = remapMusicalTarget(before, after, draft.target, timings);
      next = hasChangedClipDrafts(before, { draft }) ? { ...draft, target } : beginDraft(after, target);
    } catch { /* Retain conflicting drafts for explicit resolution, never silently discard them. */ }
    const nextKey = JSON.stringify(next.target);
    // Use the same key order as editorAdapter.draftKey (see caller).
    keys.set(key, nextKey); result[nextKey] = next;
  }
  return { drafts: result, keys };
}
