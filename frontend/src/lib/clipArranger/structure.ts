import { ClipError, contentLength, definitionMap, newClipId, validateArrangement, type ClipArrangement, type Clip, type ClipLane, type ContentItem, type Definition, type LaneTiming } from './model';

/** Nodes represent occurrences, including repeated uses of the same definition. */
export type StructureNode = { id: string; definition?: Definition; restTicks?: number; children?: StructureNode[] };
export type ContainerTarget = { path: string[]; index: number };
export type StructureSelection = { parent: string[]; ids: string[]; anchor: string };
export type StructureCommand =
  | { kind: 'insert'; target: ContainerTarget; definition: Definition; variation: boolean }
  | { kind: 'rest'; target: ContainerTarget; ticks: number }
  | { kind: 'move'; parent: string[]; ids: string[]; target: ContainerTarget }
  | { kind: 'group'; parent: string[]; ids: string[]; level: 'group' | 'supergroup'; name: string }
  | { kind: 'remove'; parent: string[]; ids: string[] }
  | { kind: 'ungroup'; parent: string[]; ids: string[] };
export type StructureDraft = { laneId: string; clipId: string; pass: number; basis: ClipLane; roots: StructureNode[]; history: StructureNode[][]; commands: StructureCommand[]; cursor: number; emptied: string[]; emptyHistory: string[][] };
const copy = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new ClipError('invalid', message); };
function expand(lane: ClipLane, items: ContentItem[]): StructureNode[] {
  const defs = definitionMap(lane);
  return items.map(i => 'restTicks' in i ? { id: i.id, restTicks: i.restTicks } : {
    id: i.id, definition: copy(defs.get(i.definitionId)!),
    ...(defs.get(i.definitionId)!.kind !== 'pattern' ? { children: expand(lane, (defs.get(i.definitionId)! as Extract<Definition, {kind:'group'|'supergroup'}>).children) } : {})
  });
}
export function beginStructure(model: ClipArrangement, laneId: string, clipId: string, pass: number): StructureDraft {
  const lane = model.lanes.find(l => l.id === laneId)!, clip = lane.clips.find(c => c.id === clipId)!;
  const roots = expand(lane, clip.children);
  return { laneId, clipId, pass, basis: copy(lane), roots, history: [copy(roots)], commands: [], cursor: 0, emptied: [], emptyHistory: [[]] };
}
export function structureChildren(roots: StructureNode[], path: string[]): StructureNode[] {
  let items = roots;
  for (const id of path) {
    const node = items.find(n => n.id === id);
    if (!node?.children) fail('The selected container no longer exists.');
    items = node!.children!;
  }
  return items;
}
function parentRank(roots: StructureNode[], path: string[]): number {
  if (!path.length) return 3;
  const node = structureChildren(roots, path.slice(0,-1)).find(n => n.id === path[path.length-1])!;
  return node.definition?.kind === 'group' ? 1 : 2;
}
const rank = (n: StructureNode) => !n.definition || n.definition.kind === 'pattern' ? 0 : n.definition.kind === 'group' ? 1 : 2;
function selection(items: StructureNode[], ids: string[]) {
  const indices = ids.map(id => items.findIndex(n => n.id === id)).sort((a,b)=>a-b);
  if (!indices.length || indices[0] < 0 || indices.some((v,i)=>v!==indices[0]+i)) fail('Select consecutive items in one container.');
  return indices;
}
function clean(nodes: StructureNode[], emptied: Set<string>): StructureNode[] {
  return nodes.flatMap(n => { if (!n.children) return [n]; n.children = clean(n.children, emptied); if (!n.children.length && n.definition) emptied.add(n.definition.id); return n.children.length ? [n] : []; });
}
export function applyStructure(draft: StructureDraft, command: StructureCommand): StructureDraft {
  if (draft.basis.cycleTicks !== null) fail('Convert the repeating lane to song clips first.');
  let roots = copy(draft.roots);
  if (command.kind === 'insert' || command.kind === 'rest') {
    const items = structureChildren(roots, command.target.path);
    let node: StructureNode;
    if (command.kind === 'rest') node = { id: newClipId(), restTicks: command.ticks };
    else {
      const def = copy(command.definition);
      if (command.variation) { def.id = newClipId(); def.revision = 0; def.name += ' variation'; }
      node = { id: newClipId(), definition: def, ...(def.kind !== 'pattern' ? { children: expand(draft.basis, def.children) } : {}) };
    }
    if (rank(node) >= parentRank(roots, command.target.path)) fail('This content cannot be nested here.');
    items.splice(command.target.index, 0, node);
  } else {
    const items = structureChildren(roots, command.parent), indices = selection(items, command.ids), start = indices[0];
    const chosen = items.slice(start, start + indices.length);
    if (command.kind === 'remove') {
      items.splice(start, chosen.length);
    } else if (command.kind === 'move') {
      if (command.target.path.length > command.parent.length && command.parent.every((id,i)=>command.target.path[i]===id) && command.ids.includes(command.target.path[command.parent.length])) fail('Cannot move a container into itself.');
      const destination = structureChildren(roots, command.target.path);
      if (chosen.some(n=>rank(n)>=parentRank(roots, command.target.path))) fail('This content cannot be nested here.');
      const index = command.target.index - (destination===items ? indices.filter(i=>i<command.target.index).length : 0);
      items.splice(start, chosen.length);
      // Child IDs are shared inside repeated definitions. Crossing into another
      // occurrence of that definition must not create ambiguous sibling IDs.
      const existingIds = new Set(destination.map(node => node.id));
      destination.splice(index, 0, ...chosen.map(node => existingIds.has(node.id) ? {...node,id:newClipId()} : node));
    } else if (command.kind === 'group') {
      const required = command.level==='group' ? 0 : 1;
      if (chosen.length<2 || chosen.some(n=>n.definition && rank(n)!==required) || chosen.filter(n=>n.definition).length < (required ? 2 : 1)) fail('Select adjacent patterns for a group, or adjacent groups for a supergroup.');
      if (required+1>=parentRank(roots,command.parent)) fail('This grouping is not valid at this level.');
      const def: Definition = { id:newClipId(),name:command.name,kind:command.level,revision:0,children:[] };
      items.splice(start,chosen.length,{id:newClipId(),definition:def,children:chosen});
    } else {
      if (chosen.some(n=>!n.children)) fail('Select groups to ungroup.');
      items.splice(start,chosen.length,...chosen.flatMap(n=>n.children!.map(child=>({...child,id:newClipId()}))));
    }
  }
  const emptied = new Set(draft.emptied);
  roots = clean(roots, emptied);
  if (JSON.stringify(roots)===JSON.stringify(draft.roots)) return draft;
  return { ...draft, roots, history:[...draft.history.slice(0,draft.cursor+1),copy(roots)], commands:[...draft.commands.slice(0,draft.cursor),command], cursor:draft.cursor+1, emptied:[...emptied], emptyHistory:[...draft.emptyHistory.slice(0,draft.cursor+1),[...emptied]] };
}
export function stepStructure(draft: StructureDraft, direction: number): StructureDraft {
  const cursor = Math.max(0,Math.min(draft.history.length-1,draft.cursor+direction));
  return {...draft,cursor,roots:copy(draft.history[cursor]),emptied:[...draft.emptyHistory[cursor]]};
}
/** Materialize occurrence changes without mutating the shared baseline. */
function materialize(draft: StructureDraft, scope: 'local'|'all', preview = false): { lane: ClipLane; children: ContentItem[]; shared: boolean } {
  const lane = copy(draft.basis), changes = new Map<string,string>(); let shared=false;
  const visit = (nodes: StructureNode[]): ContentItem[] => nodes.map(n=> {
    if (!n.definition) return {id:n.id,restTicks:n.restTicks!};
    const original = draft.basis.definitions.find(d=>d.id===n.definition!.id);
    const def = copy(n.definition);
    if (def.kind!=='pattern') def.children=visit(n.children!);
    const changed = !original || JSON.stringify(def)!==JSON.stringify(original);
    if (!changed) return {id:n.id,definitionId:def.id};
    if (original) shared=true;
    if (scope==='all' && original) {
      const signature=JSON.stringify(def.kind==='pattern'?def:{...def,children:def.children.map(i=>'definitionId' in i?{definitionId:i.definitionId}:{restTicks:i.restTicks})});
      if (changes.has(def.id) && changes.get(def.id)!==signature) fail('Different occurrences require incompatible structures. Save only this occurrence.');
      changes.set(def.id,signature); def.revision=original.revision+1;
      if (def.kind!=='pattern') def.children=def.children.map(i=>({...i,id:newClipId()}));
      lane.definitions[lane.definitions.findIndex(d=>d.id===def.id)]=def;
    } else {
      if (original) { def.id=newClipId(); def.revision=0; }
      if (!preview && def.kind!=='pattern') def.children=def.children.map(i=>({...i,id:newClipId()}));
      if (!lane.definitions.some(d=>d.id===def.id)) lane.definitions.push(def);
    }
    return {id:n.id,definitionId:def.id};
  });
  const children=visit(draft.roots).map(i=>preview?i:{...i,id:newClipId()});
  return {lane,children,shared};
}
const scaled = (value: number, before: number, after: number) => Number((BigInt(value)*BigInt(after)+BigInt(Math.floor(before/2)))/BigInt(before));
/** The timeline preview and local commit must use the same partial-pass geometry. */
export function structurePassWindow(original:Clip,before:number,after:number,pass:number) {
  if (!Number.isSafeInteger(pass)||pass<0||before<=0) fail('Invalid repeat pass.');
    const start=Math.max(original.start,original.start-original.offset+pass*before);
    const end=Math.min(original.start+original.length,original.start-original.offset+(pass+1)*before);
    if (end<=start) fail('That repeat pass no longer exists.');
    const offset=(original.offset+start-original.start)%before;
    const newOffset=after>before ? scaled(offset,before,after) : offset;
    const length=after>before ? scaled(offset+end-start,before,after)-newOffset : end-start;
    const growth=length-(end-start);
  return {start,end,newOffset,length,growth};
}
export function structureDisplayGeometry(original:Clip,before:number,after:number,pass:number) {
  if(original.mode==='once')return {length:after>before?Math.max(original.length,after-original.offset):original.length, left:(_pass:number)=>-original.offset};
  const window=structurePassWindow(original,before,after,pass);
  return {length:original.length+window.growth,left:(index:number)=>index===pass?window.start-original.start-window.newOffset:index*before-original.offset+(index>pass?window.growth:0)};
}
export function prepareStructure(model: ClipArrangement, draft: StructureDraft, scope: 'local'|'all', timings: LaneTiming): { model: ClipArrangement; shared: boolean } {
  const current=model.lanes.find(l=>l.id===draft.laneId);
  if (JSON.stringify(current)!==JSON.stringify(draft.basis)) throw new ClipError('conflict','The track changed. Discard this structure draft and reopen it.');
  const materialized=materialize(draft,scope); const lane=materialized.lane, shared=materialized.shared||draft.emptied.length>0; let children=materialized.children;
  if(scope==='all' && draft.emptied.length){
    const removed=new Set(draft.emptied);
    const inspect=(nodes:StructureNode[])=>{for(const node of nodes){
      if(node.definition && removed.has(node.definition.id)) {
        const original=draft.basis.definitions.find(d=>d.id===node.definition!.id);
        const currentChildren=node.children?.map(n=>n.definition?{id:n.id,definitionId:n.definition.id}:{id:n.id,restTicks:n.restTicks});
        if(!original||original.kind==='pattern'||JSON.stringify(currentChildren)!==JSON.stringify(original.children)) fail('Different occurrences require incompatible structures. Save only this occurrence.');
      }
      if(node.children)inspect(node.children);
    }};
    inspect(draft.roots);
    let grew=true;
    while(grew){grew=false;for(const d of lane.definitions) if(d.kind!=='pattern'&&!removed.has(d.id)&&d.children.every(i=>'definitionId' in i&&removed.has(i.definitionId))){removed.add(d.id);grew=true;}}
    const retain=(items:ContentItem[])=>items.filter(i=>!('definitionId' in i)||!removed.has(i.definitionId));
    lane.definitions=lane.definitions.map(d=>d.kind==='pattern'||removed.has(d.id)||retain(d.children).length===d.children.length?d:{...d,revision:d.revision+1,children:retain(d.children)});
    lane.clips=lane.clips.map(c=>({...c,children:retain(c.children)}));
    children=retain(children);
  }
  const original=draft.basis.clips.find(c=>c.id===draft.clipId)!;
  const clip=lane.clips.find(c=>c.id===draft.clipId)!;
  const timing=timings[lane.id], before=contentLength(draft.basis,original.children,timing);
  const after=children.length ? contentLength(lane,children,timing) : 0;
  if (scope==='local' && clip.mode==='loop') {
    const {start,end,newOffset,length,growth}=structurePassWindow(original,before,after,draft.pass);
    const fresh=(items:ContentItem[])=>items.map(i=>({...i,id:newClipId()}));
    lane.clips.splice(lane.clips.indexOf(clip),1,
      ...(start>original.start?[{...copy(original),id:newClipId(),length:start-original.start,children:fresh(original.children)}]:[]),
      ...(after?[{...clip,start,length,offset:newOffset,mode:'once' as const,children}]:[]),
      ...(end<original.start+original.length?[{...copy(original),id:newClipId(),start:end+growth,length:original.start+original.length-end,offset:original.offset+end-original.start,children:fresh(original.children)}]:[]));
  } else {
    clip.children=children;
    for (const candidate of lane.clips) {
      if (!candidate.children.length) continue;
      const old=draft.basis.clips.find(c=>c.id===candidate.id)!;
      const oldDuration=contentLength(draft.basis,old.children,timing), duration=contentLength(lane,candidate.children,timing);
      if (duration<=oldDuration) continue;
      if (candidate.mode==='loop') {
        candidate.offset=scaled(old.offset,oldDuration,duration);
        candidate.length=scaled(old.offset+old.length,oldDuration,duration)-candidate.offset;
      } else candidate.length=Math.max(old.length,duration-old.offset);
    }
  }
  lane.clips=lane.clips.filter(c=>c.children.length);
  const sorted=[...lane.clips].sort((a,b)=>a.start-b.start);
  for(let i=1;i<sorted.length;i++) if(sorted[i].start<sorted[i-1].start+sorted[i-1].length) throw new ClipError('collision',`Growth overlaps “${sorted[i-1].name}” and “${sorted[i].name}”. Make room before saving.`);
  const next={...copy(model),revision:model.revision+1,lanes:model.lanes.map(l=>l.id===lane.id?lane:copy(l)),end:Math.max(model.end,...lane.clips.map(c=>c.start+c.length))};
  validateArrangement(next,timings);
  return {model:next,shared};
}
/** Preview uses a private lane; it never enters authored state or audio configuration. */
export function structurePreview(model:ClipArrangement,draft:StructureDraft):ClipArrangement {
  const {lane,children}=materialize(draft,'local',true);
  lane.clips=lane.clips.map(c=>c.id===draft.clipId?{...c,children}:c);
  return {...model,lanes:model.lanes.map(l=>l.id===lane.id?lane:l)};
}
