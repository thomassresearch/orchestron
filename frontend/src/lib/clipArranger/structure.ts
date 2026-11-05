import { nodeTicks, placeAt, resizeNode } from './timedStructure';
import { sumPlans, offsetAt, TRANSPOSE_LIMITS, type OffsetPlan } from "./transposition";
import { remapPlacementChildren } from "./transposeEdits";
import { CLIP_LIMITS, ClipError, resolveContent, contentLength, definitionMap, newClipId, validateArrangement, type ClipArrangement, type Clip, type ClipLane, type ContentItem, type Definition, type LaneTiming, type OccurrenceTarget } from './model';

/** Nodes represent occurrences, including repeated uses of the same definition. */
export type StructureNode = { id: string; repeatIndex?: number; originalPass?: number; definition?: Definition; restTicks?: number; children?: StructureNode[]; transpose?: OffsetPlan; placement?: OffsetPlan; originalPath?: string[]; variationOf?: string };
export type ContainerTarget = { path: string[]; index: number; ticks?: number };
export type StructureSelection = { parent: string[]; ids: string[]; anchor: string; anchorPass?: number; tip?: {pass:number;id:string}; range?: {first:number;last:number} };
export type RepetitionRange = { first: {pass:number;id:string}; last: {pass:number;id:string} };
export type StructureCommand =
  | { kind: 'resizeRest'; parent: string[]; ids: string[]; ticks: number }
  | { kind: 'timed'; parent: string[]; ids: string[]; target: ContainerTarget; nodes?: StructureNode[]; resize?: { edge: 'left'|'right'; delta: number } }
  | { kind: 'groupRepetitions'; range: RepetitionRange; level:'group'|'supergroup'; name:string }
  | { kind: 'insert'; target: ContainerTarget; definition: Definition; variation: boolean }
  | { kind: 'rest'; target: ContainerTarget; ticks: number }
  | { kind: 'rename'; path: string[]; name: string }
  | { kind: 'move'; parent: string[]; ids: string[]; target: ContainerTarget }
  | { kind: 'group'; parent: string[]; ids: string[]; level: 'group' | 'supergroup'; name: string }
  | { kind: 'remove'; parent: string[]; ids: string[] }
  | { kind: 'ungroup'; parent: string[]; ids: string[] };
export type StructureDraft = { laneId: string; clipId: string; pass: number; basis: ClipLane; roots: StructureNode[]; history: StructureNode[][]; commands: StructureCommand[]; cursor: number; emptied: string[]; emptyHistory: string[][]; followingPassClipIds?: string[]; expanded?: {at:number;sourcePass:number;contentTicks:number;offset:number;repeatIndexBase:number} };
const copy = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new ClipError('invalid', message); };
function expand(lane: ClipLane, items: ContentItem[], clip?: Clip, path: string[] = []): StructureNode[] {
  const defs = definitionMap(lane);
  return items.map(i => 'restTicks' in i ? { id: i.id, restTicks: i.restTicks } : {
    id: i.id, repeatIndex: i.repeatIndex, definition: copy(defs.get(i.definitionId)!), transpose: copy(i.transpose),
    ...(clip ? { originalPath: [...path,i.id], placement: copy(clip.transposePlacements?.find(p => JSON.stringify(p.path) === JSON.stringify([...path,i.id]))?.plan) } : {}),
    ...(defs.get(i.definitionId)!.kind !== 'pattern' ? { children: expand(lane, (defs.get(i.definitionId)! as Extract<Definition, {kind:'group'|'supergroup'}>).children, clip, [...path,i.id]) } : {})
  });
}
export function beginStructure(model: ClipArrangement, laneId: string, clipId: string, pass: number): StructureDraft {
  const lane = model.lanes.find(l => l.id === laneId)!, clip = lane.clips.find(c => c.id === clipId)!;
  const roots = expand(lane, clip.children, clip);
  return { laneId, clipId, pass, basis: copy(lane), roots, history: [copy(roots)], commands: [], cursor: 0, emptied: [], emptyHistory: [[]] };
}
/** Clip windows can change independently of the content being edited. */
export function refreshStructureWindows(model: ClipArrangement, draft: StructureDraft): StructureDraft {
  const current=model.lanes.find(l=>l.id===draft.laneId);
  if(!current||JSON.stringify(current)===JSON.stringify(draft.basis))return draft;
  const musical=(lane:ClipLane)=>({...lane,clips:lane.clips.map(({start:_start,length:_length,offset:_offset,name:_name,...content})=>content)});
  if(JSON.stringify(musical(current))!==JSON.stringify(musical(draft.basis)))return draft;
  const clip=current.clips.find(c=>c.id===draft.clipId)!;
  const old=draft.basis.clips.find(c=>c.id===draft.clipId)!;
  if(draft.expanded&&clip.offset!==old.offset)return draft;
  return {...draft,basis:copy(current)};
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
function fixedIndexAt(roots: StructureNode[], path: string[]): number | undefined {
  let index: number | undefined, nodes = roots;
  for (const id of path) {
    const node = nodes.find(n => n.id === id)!;
    index = node.repeatIndex ?? index;
    nodes = node.children ?? [];
  }
  return index;
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
export function applyStructure(draft: StructureDraft, command: StructureCommand, timings: LaneTiming = {}, model?: ClipArrangement): StructureDraft {
  if (command.kind === 'groupRepetitions') return groupRepetitions(draft, command, timings, model);
  if(draft.expanded&&!isExpandedStructure(draft))draft={...draft,expanded:undefined};
  if (draft.basis.cycleTicks !== null) fail('Convert the repeating lane to song clips first.');
  let roots = copy(draft.roots);
  if(command.kind==='resizeRest') {
    const items=structureChildren(roots,command.parent),index=selection(items,command.ids)[0];
    if(command.ids.length!==1||index!==items.length-1||items[index].restTicks===undefined)fail('Select a trailing rest to resize.');
    if(!Number.isSafeInteger(command.ticks)||command.ticks<0||command.ticks>CLIP_LIMITS.ticks)fail('Invalid rest duration.');
    if(command.ticks===items[index].restTicks)return draft;
    if(command.ticks===0){if(items.length===1)fail('Keep a positive duration for an empty clip or container.');items.pop();}
    else items[index].restTicks=command.ticks;
  } else if (command.kind === 'timed') {
    const source=structureChildren(roots,command.parent), timing=timings[draft.laneId];
    const indices=command.nodes?[]:selection(source,command.ids);
    let chosen=copy(command.nodes??source.slice(indices[0],indices[0]+indices.length));
    let at=command.target.ticks??0;
    if(command.resize){
      const old=nodeTicks(chosen[0],timing);
      chosen=[resizeNode(chosen[0],old+(command.resize.edge==='right'?command.resize.delta:-command.resize.delta),timing)];
      if(old===nodeTicks(chosen[0],timing))return draft;
      if(command.resize.edge==='left')at+=old-nodeTicks(chosen[0],timing);
    }
    if(!command.nodes)for(const index of indices)source[index]={id:newClipId(),restTicks:nodeTicks(source[index],timing)};
    const destination=structureChildren(roots,command.target.path);
    if(chosen.some(n=>rank(n)>=parentRank(roots,command.target.path)))fail('This content cannot be nested here.');
    const placed=placeAt(destination,chosen,at,timing);destination.splice(0,destination.length,...placed);
  } else if (command.kind === 'insert' || command.kind === 'rest') {
    const items = structureChildren(roots, command.target.path);
    let node: StructureNode;
    if (command.kind === 'rest') node = { id: newClipId(), restTicks: command.ticks };
    else {
      const def = copy(command.definition);
      if (command.variation) { def.id = newClipId(); def.revision = 0; def.name += ' variation'; }
      node = { id: newClipId(), definition: def, ...(command.variation ? { variationOf: command.definition.id } : {}), ...(def.kind !== 'pattern' ? { children: expand(draft.basis, def.children) } : {}) };
    }
    if (rank(node) >= parentRank(roots, command.target.path)) fail('This content cannot be nested here.');
    if(command.target.ticks!==undefined){const placed=placeAt(items,[node],command.target.ticks,timings[draft.laneId]);items.splice(0,items.length,...placed);}else items.splice(command.target.index, 0, node);
  } else if (command.kind === 'rename') {
    const node = structureChildren(roots, command.path.slice(0, -1)).find(n => n.id === command.path[command.path.length - 1]);
    if (!node?.definition || node.definition.kind === 'pattern') fail('Select a container to rename.');
    node!.definition!.name = command.name.trim();
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
      const inherited = fixedIndexAt(roots, command.parent);
      destination.splice(index, 0, ...chosen.map(node => ({...node,
        ...(existingIds.has(node.id) ? {id:newClipId()} : {}),
        ...(node.definition && inherited !== undefined ? {repeatIndex:node.repeatIndex??inherited} : {})
      })));
    } else if (command.kind === 'group') {
      const required = command.level==='group' ? 0 : 1;
      if (chosen.length<2 || chosen.some(n=>n.definition && rank(n)!==required) || chosen.filter(n=>n.definition).length < (required ? 2 : 1)) fail('Select adjacent patterns for a group, or adjacent groups for a supergroup.');
      if (required+1>=parentRank(roots,command.parent)) fail('This grouping is not valid at this level.');
      const def: Definition = { id:newClipId(),name:command.name,kind:command.level,revision:0,children:[] };
      items.splice(start,chosen.length,{id:newClipId(),definition:def,children:chosen,...(chosen[0].repeatIndex !== undefined ? {repeatIndex:chosen[0].repeatIndex} : {})});
    } else {
      if (chosen.some(n=>!n.children)) fail('Select groups to ungroup.');
      items.splice(start,chosen.length,...chosen.flatMap(n=>n.children!.map(child=>{
        const profile = draft.basis.transposeProfiles?.find(p=>p.id===n.definition?.transposeProfileId)?.plan;
        const fixed=n.repeatIndex??fixedIndexAt(roots,command.parent);
        const freeze = (p:OffsetPlan) => fixed === undefined ? p : {base:offsetAt(p,fixed),repetitions:[]};
        const plans = [...[profile,n.transpose].filter((p):p is OffsetPlan=>!!p).map(freeze),...(child.transpose?[child.transpose]:[])];
        const local = [...(n.placement?[freeze(n.placement)]:[]),...(child.placement?[child.placement]:[])];
        return {...child,id:newClipId(),repeatIndex:child.repeatIndex??fixed,...(child.definition && plans.length?{transpose:sumPlans(plans)}:{}),...(child.definition && local.length?{placement:sumPlans(local)}:{})};
      })));
    }
  }
  if(command.kind==='timed'||command.kind==='resizeRest') {
    // Rebuild only enclosing rows at their old positions; nested growth consumes
    // neighboring silence instead of pushing another container along the song.
    const paths=command.kind==='timed'?[command.parent,command.target.path]:[command.parent];
    const repair=(before:StructureNode[],after:StructureNode[],path:string[]):StructureNode[]=>{
      if(!paths.some(p=>path.every((id,index)=>p[index]===id)))return after;
      for(const n of after){const old=before.find(b=>b.id===n.id);if(n.children&&old?.children)n.children=repair(old.children,n.children,[...path,n.id]);}
      if(paths.some(p=>JSON.stringify(p)===JSON.stringify(path)))return after;
      const timing=timings[draft.laneId];let cursor=0;
      const positions=new Map(before.map(n=>{const at=cursor;cursor+=nodeTicks(n,timing);return [n.id,at] as const;}));
      // A shortened trailing rest can shorten trailing ancestors too. Gaps
      // before unedited siblings still retain their original timeline positions.
      const extent=command.kind==='resizeRest'?Math.max(...after.map(n=>positions.get(n.id)!+nodeTicks(n,timing))):cursor;
      let result:StructureNode[]=[{id:newClipId(),restTicks:extent}];
      for(const n of after.filter(n=>n.definition))result=placeAt(result,[n],positions.get(n.id)!,timing);
      return result;
    };
    roots=repair(draft.roots,roots,[]);
  }
  const emptied = new Set(draft.emptied);
  roots = clean(roots, emptied);
  if (JSON.stringify(roots)===JSON.stringify(draft.roots)) return draft;
  return { ...draft, roots, history:[...draft.history.slice(0,draft.cursor+1),copy(roots)], commands:[...draft.commands.slice(0,draft.cursor),command], cursor:draft.cursor+1, emptied:[...emptied], emptyHistory:[...draft.emptyHistory.slice(0,draft.cursor+1),[...emptied]] };
}
export function stepStructure(draft: StructureDraft, direction: number): StructureDraft {
  const cursor = Math.max(0,Math.min(draft.history.length-1,draft.cursor+direction));
  return {...draft,cursor,pass:draft.expanded?(cursor>=draft.expanded.at?0:draft.expanded.sourcePass):draft.pass,roots:copy(draft.history[cursor]),emptied:[...draft.emptyHistory[cursor]]};
}
export const isExpandedStructure = (draft:StructureDraft) => !!draft.expanded && draft.cursor >= draft.expanded.at;
export function structureClip(draft:StructureDraft):Clip {
  const original = draft.basis.clips.find(c=>c.id===draft.clipId)!;
  return isExpandedStructure(draft) ? {...original,mode:'once',offset:draft.expanded!.offset,repeatIndexBase:draft.expanded!.repeatIndexBase} : original;
}

function groupRepetitions(
  draft: StructureDraft,
  command: Extract<StructureCommand, {kind:'groupRepetitions'}>,
  timings: LaneTiming,
  model?: ClipArrangement
): StructureDraft {
  if (draft.cursor || draft.basis.cycleTicks !== null) fail('Save or discard the current structure before grouping repetitions.');
  const original = draft.basis.clips.find(c => c.id === draft.clipId)!;
  if (original.mode !== 'loop') fail('The selected repetitions no longer exist.');
  const duration = contentLength(draft.basis, original.children, timings[draft.laneId]);
  const firstPass = Math.floor(original.offset / duration);
  const lastPass = Math.floor((original.offset + original.length - 1) / duration);
  const passes = lastPass - firstPass + 1;
  const locate = (point: {pass:number;id:string}) => {
    const index = original.children.findIndex(i => i.id === point.id);
    if (!Number.isSafeInteger(point.pass) || point.pass < firstPass || point.pass > lastPass || index < 0) {
      fail('The selected repetitions changed. Select the range again.');
    }
    return (point.pass - firstPass) * original.children.length + index;
  };
  const start = locate(command.range.first), end = locate(command.range.last);
  if (end <= start) fail('Select adjacent content across repetitions.');

  // Bound the complete materialized source before cloning any virtual occurrences.
  const count = passes * original.children.length;
  const leaves = resolveContentCount(draft.basis, original.children);
  if (count - (end-start) > CLIP_LIMITS.children || end-start+1 > CLIP_LIMITS.children ||
      leaves * passes > CLIP_LIMITS.leaves || draft.basis.definitions.length+1 > CLIP_LIMITS.definitions ||
      duration * passes > CLIP_LIMITS.ticks || (original.transposePlacements?.length??0) * passes > TRANSPOSE_LIMITS.placements) {
    fail('Grouping repetitions exceeds the clip content limit. Shorten the clip first.');
  }
  preflightRepeatedPlans(model?.lanes ?? [draft.basis], original, passes);

  const roots: StructureNode[] = [];
  for (let pass = firstPass; pass <= lastPass; pass++) {
    const nodes = expand(draft.basis, original.children, original);
    const provenance = (nodes: StructureNode[]) => {
      for (const node of nodes) {
        node.originalPass = pass;
        if (node.children) provenance(node.children);
      }
    };
    provenance(nodes);
    roots.push(...nodes.map(node => ({...node, id:newClipId(),
      ...(node.definition ? {repeatIndex:node.repeatIndex??(original.repeatIndexBase??0)+pass} : {})
    })));
  }
  const expanded = {
    at:draft.cursor+1, sourcePass:draft.pass, contentTicks:duration*passes,
    offset:original.offset-firstPass*duration, repeatIndexBase:(original.repeatIndexBase??0)+firstPass
  };
  const grouped = applyStructure({...draft, roots, expanded:undefined}, {
    kind:'group', parent:[], ids:roots.slice(start,end+1).map(n => n.id), level:command.level, name:command.name
  }, timings);
  // A leading rest has no reference on which to carry its logical index.
  grouped.roots[start].repeatIndex = roots[start].repeatIndex??(original.repeatIndexBase??0)+command.range.first.pass;
  return {...grouped, expanded, pass:0,
    history:[...draft.history.slice(0,draft.cursor+1),copy(grouped.roots)],
    commands:[...draft.commands.slice(0,draft.cursor),command]
  };
}
function preflightRepeatedPlans(lanes: ClipLane[], original: Clip, passes: number): void {
  const entries = (plans: OffsetPlan[]) => plans.reduce((count, plan) => count+plan.repetitions.length, 0);
  const referencePlans = (items: ContentItem[]) => items.flatMap(i => 'definitionId' in i && i.transpose ? [i.transpose] : []);
  const placements = lanes.flatMap(l => l.clips.flatMap(c => c.transposePlacements??[]));
  const plans = lanes.flatMap(l => [
    ...(l.transposeProfiles??[]).map(p => p.plan),
    ...l.clips.flatMap(c => referencePlans(c.children)),
    ...l.definitions.flatMap(d => d.kind === 'pattern' ? [] : referencePlans(d.children))
  ]);
  const copiedPlans = [...(original.transposePlacements??[]).map(p => p.plan), ...referencePlans(original.children)];
  const entryCount = entries(plans)+entries(placements.map(p => p.plan))+entries(copiedPlans)*(passes-1);
  const placementCount = placements.length+(original.transposePlacements?.length??0)*(passes-1);
  if (placementCount > TRANSPOSE_LIMITS.totalPlacements || entryCount > TRANSPOSE_LIMITS.totalEntries) {
    fail('Grouping repetitions exceeds the transposition placement/entry limit.');
  }
}
function resolveContentCount(lane: ClipLane, items: ContentItem[]): number {
  const defs = definitionMap(lane);
  return items.reduce((count, item) => {
    const definition = 'definitionId' in item ? defs.get(item.definitionId)! : undefined;
    return count+(definition && definition.kind !== 'pattern' ? resolveContentCount(lane,definition.children) : 1);
  }, 0);
}

/** Materialize occurrence changes without mutating the shared baseline. */
function materialize(draft: StructureDraft, scope: 'local'|'all', preview = false): { lane: ClipLane; children: ContentItem[]; shared: boolean; placements: NonNullable<Clip['transposePlacements']>; pathRules: Map<string, {before:string[];after:string[]}[]>; occurrences: {from:OccurrenceTarget;to:OccurrenceTarget}[]; previewPaths: {before:string[];after:string[]}[] } {
  const lane = copy(draft.basis), changes = new Map<string,string>(); let shared=false;
  const pathRules = new Map<string, {before:string[];after:string[]}[]>();
  const visit = (nodes: StructureNode[]): ContentItem[] => nodes.map(n=> {
    if (!n.definition) return {id:n.id,restTicks:n.restTicks!};
    const original = draft.basis.definitions.find(d=>d.id===n.definition!.id);
    const def = copy(n.definition);
    if (n.variationOf && def.transposeProfileId) {
      const profile = lane.transposeProfiles!.find(p=>p.id===def.transposeProfileId)!;
      const fork = {...copy(profile),id:newClipId(),revision:0}; lane.transposeProfiles!.push(fork); def.transposeProfileId=fork.id;
    }
    if (def.kind!=='pattern') def.children=visit(n.children!);
    const changed = !original || JSON.stringify(def)!==JSON.stringify(original);
    if (!changed) return {id:n.id,definitionId:def.id,...(n.repeatIndex !== undefined ? {repeatIndex:n.repeatIndex} : {}),...(n.transpose?{transpose:copy(n.transpose)}:{})};
    if (original) shared=true;
    if (scope==='all' && original) {
      const signature=JSON.stringify(def.kind==='pattern'?def:{...def,children:def.children.map(i=>'definitionId' in i?{definitionId:i.definitionId,transpose:i.transpose,repeatIndex:i.repeatIndex}:{restTicks:i.restTicks})});
      if (changes.has(def.id) && changes.get(def.id)!==signature) fail('Different occurrences require incompatible structures. Save only this occurrence.');
      changes.set(def.id,signature); def.revision=original.revision+1;
      if (def.kind!=='pattern') def.children=def.children.map(i=>({...i,id:newClipId()}));
      lane.definitions[lane.definitions.findIndex(d=>d.id===def.id)]=def;
    } else {
      if (original) { def.id=newClipId(); def.revision=0; }
      if (!preview && def.kind!=='pattern') def.children=def.children.map(i=>({...i,id:newClipId()}));
      if (!lane.definitions.some(d=>d.id===def.id)) lane.definitions.push(def);
    }
    if(scope==='all' && original && original.kind!=='pattern' && def.kind!=='pattern' && n.originalPath) {
      const mappings: {before:string[];after:string[]}[]=[];
      const trace=(nodes:StructureNode[],items:ContentItem[],path:string[])=>nodes.forEach((node,index)=>{
        const item=items[index],after=[...path,item.id];
        if(node.originalPath && n.originalPath!.every((id,i)=>node.originalPath![i]===id))mappings.push({before:node.originalPath.slice(n.originalPath!.length),after});
        if(node.children && 'definitionId' in item){const child=lane.definitions.find(d=>d.id===item.definitionId)!;if(child.kind!=='pattern')trace(node.children,child.children,after);}
      });
      trace(n.children!,def.children,[]);pathRules.set(original.id,mappings);
    }
    return {id:n.id,definitionId:def.id,...(n.repeatIndex !== undefined ? {repeatIndex:n.repeatIndex} : {}),...(n.transpose?{transpose:copy(n.transpose)}:{})};
  });
  const children=visit(draft.roots).map(i=>preview?i:{...i,id:newClipId()});
  const placements: NonNullable<Clip['transposePlacements']> = [];
  const occurrences: {from:OccurrenceTarget;to:OccurrenceTarget}[]=[];
  const previewPaths: {before:string[];after:string[]}[]=[];
  const collect = (nodes:StructureNode[],items:ContentItem[],path:string[],previewPath:string[]=[]) => nodes.forEach((n,i)=>{
    const item=items[i], nextPath=[...path,item.id], before=[...previewPath,n.id];
    previewPaths.push({before,after:nextPath});
    if(n.originalPath)occurrences.push({from:{laneId:draft.laneId,clipId:draft.clipId,pass:n.originalPass??draft.pass,path:n.originalPath},to:{laneId:draft.laneId,clipId:draft.clipId,pass:0,path:nextPath}});
    if(n.placement && 'definitionId' in item) placements.push({path:nextPath,plan:copy(n.placement)});
    if(n.children && 'definitionId' in item){const def=lane.definitions.find(d=>d.id===item.definitionId)!;if(def.kind!=='pattern')collect(n.children,def.children,nextPath,before);}
  });
  collect(draft.roots,children,[]);
  return {lane,children,shared,placements,pathRules,occurrences,previewPaths};
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
  // A trim may hide the edited pass; keep rendering the remaining window.
  // Saving still rejects that missing occurrence until the trim is undone.
  if((pass+1)*before<=original.offset||pass*before>=original.offset+original.length)return {length:original.length,left:(index:number)=>index*before-original.offset};
  const window=structurePassWindow(original,before,after,pass);
  return {length:original.length+window.growth,left:(index:number)=>index===pass?window.start-original.start-window.newOffset:index*before-original.offset+(index>pass?window.growth:0)};
}
export function prepareStructure(model: ClipArrangement, draft: StructureDraft, scope: 'local'|'all', timings: LaneTiming): { model: ClipArrangement; shared: boolean; occurrences: {from:OccurrenceTarget;to:OccurrenceTarget}[]; previewPaths: {before:string[];after:string[]}[] } {
  if(isExpandedStructure(draft)&&scope==='all')fail('Grouping repetitions changes only this clip. Pattern definitions remain linked.');
  draft=refreshStructureWindows(model,draft);
  const current=model.lanes.find(l=>l.id===draft.laneId);
  if (JSON.stringify(current)!==JSON.stringify(draft.basis)) throw new ClipError('conflict','The track changed. Discard this structure draft and reopen it.');
  const timed=draft.commands.slice(0,draft.cursor).some(c=>c.kind==='timed'||c.kind==='resizeRest'||('target' in c&&c.target.ticks!==undefined));
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
  if(scope==='all') for(const candidate of lane.clips) {
    if(candidate.id===draft.clipId || !candidate.transposePlacements)continue;
    const oldClip=draft.basis.clips.find(c=>c.id===candidate.id)!;
    const remapped: NonNullable<Clip['transposePlacements']>=[];
    for(const placement of candidate.transposePlacements){
      let items=oldClip.children,targets=[placement.path];
      for(let depth=0;depth<placement.path.length;depth++){
        const item=items.find(i=>i.id===placement.path[depth]);
        if(!item || !('definitionId' in item))fail('Cannot remap transposition placement.');
        const def=draft.basis.definitions.find(d=>d.id===(item as {definitionId:string}).definitionId)!;
        const rules=materialized.pathRules.get(def.id),suffix=placement.path.slice(depth+1);
        if(rules && suffix.length){
          const exact=rules.filter(r=>JSON.stringify(r.before)===JSON.stringify(suffix));
          const matches=exact.length?exact:rules.filter(r=>suffix.every((id,i)=>r.before[i]===id));
          const shortest=matches.filter(r=>!matches.some(other=>other!==r&&other.after.length<r.after.length&&other.after.every((id,i)=>r.after[i]===id)));
          targets=shortest.map(r=>[...placement.path.slice(0,depth+1),...r.after]);break;
        }
        items=def.kind==='pattern'?[]:def.children;
      }
      for(const path of targets){const existing=remapped.find(p=>JSON.stringify(p.path)===JSON.stringify(path));if(existing)existing.plan=sumPlans([existing.plan,placement.plan]);else remapped.push({path,plan:copy(placement.plan)});}
    }
    candidate.transposePlacements=remapped;
  }
  if(timed&&scope==='all') {
    const expected=materialize(draft,'local',true);
    const beforeLeaves=resolveContent(expected.lane,expected.children,timings[lane.id]);
    const afterLeaves=resolveContent(lane,children,timings[lane.id]);
    if(beforeLeaves.some((leaf,index)=>leaf.definition&&afterLeaves[index]?.start!==leaf.start))fail('Linked resizing would move other content. Make room or save only this occurrence.');

    const keepPositions=(old:ContentItem[],items:ContentItem[]):ContentItem[]=>{
      if(JSON.stringify(old)!==JSON.stringify(items)||old.every(item=>contentLength(draft.basis,[item],timings[lane.id])===contentLength(lane,[item],timings[lane.id])))return items;
      const timing=timings[lane.id];let at=0;
      let result:StructureNode[]=[{id:newClipId(),restTicks:contentLength(draft.basis,old,timing)}];
      for(const item of old){if('definitionId' in item)result=placeAt(result,expand(lane,[item]),at,timing);at+=contentLength(draft.basis,[item],timing);}
      return result.map(n=>n.definition?{id:n.id,definitionId:n.definition.id,...(n.transpose?{transpose:n.transpose}:{}),...(n.repeatIndex!==undefined?{repeatIndex:n.repeatIndex}:{})}:{id:n.id,restTicks:n.restTicks!});
    };
    for(const kind of ['group','supergroup'])for(const def of lane.definitions){const old=draft.basis.definitions.find(d=>d.id===def.id);if(def.kind===kind&&def.kind!=='pattern'&&old&&old.kind!=='pattern')def.children=keepPositions(old.children,def.children);}
    for(const candidate of lane.clips)if(candidate.id!==draft.clipId){const old=draft.basis.clips.find(c=>c.id===candidate.id)!;candidate.children=keepPositions(old.children,candidate.children);}
    for(const candidate of lane.clips){const old=draft.basis.clips.find(c=>c.id===candidate.id)!;const before=contentLength(draft.basis,old.children,timings[lane.id]),after=contentLength(lane,candidate.id===draft.clipId?children:candidate.children,timings[lane.id]);if(old.mode==='loop'&&after!==before&&old.offset+old.length>before)fail('Resizing would change another loop repetition. Save only this occurrence.');}
  }
  const original=draft.basis.clips.find(c=>c.id===draft.clipId)!;
  const clip=lane.clips.find(c=>c.id===draft.clipId)!;
  const timing=timings[lane.id], before=contentLength(draft.basis,original.children,timing);
  const after=children.length ? contentLength(lane,children,timing) : 0;
  if (original.transposePlacements || materialized.placements.length) clip.transposePlacements=materialized.placements;
  if(isExpandedStructure(draft)) {
    Object.assign(clip,structureClip(draft),{children,...(original.transposePlacements||materialized.placements.length?{transposePlacements:materialized.placements}:{})});
    if(after>draft.expanded!.contentTicks)clip.length=Math.max(clip.length,after-clip.offset);
  } else if (scope==='local' && clip.mode==='loop') {
    const {start,end,newOffset,length,growth}=structurePassWindow(original,before,after,draft.pass);
    const fresh=(items:ContentItem[])=>items.map(i=>({...i,id:newClipId()}));
    lane.clips.splice(lane.clips.indexOf(clip),1,
      ...(start>original.start?[{...remapPlacementChildren(copy(original),fresh(original.children)),id:newClipId(),length:start-original.start}]:[]),
      ...(after?[{...clip,start,length,offset:newOffset,mode:'once' as const,children,...(model.version>=3?{repeatIndexBase:(original.repeatIndexBase??0)+draft.pass}:{})}]:[]),
      ...(end<original.start+original.length?[{...remapPlacementChildren(copy(original),fresh(original.children)),id:newClipId(),start:end+(timed?0:growth),length:original.start+original.length-end,offset:original.offset+end-original.start}]:[]));
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
  // A musical local save can split the source loop while resolving a conflict.
  // These session-only IDs retain which following windows came from that source.
  const selectedGrowth = Math.max(0, (lane.clips.find(c=>c.id===draft.clipId)?.length ?? original.length) - original.length);
  if (!timed && original.mode==='once' && selectedGrowth) for (const following of lane.clips) {
    if(draft.followingPassClipIds?.includes(following.id)) following.start += selectedGrowth;
  }
  lane.clips=lane.clips.filter(c=>c.children.length);
  const sorted=[...lane.clips].sort((a,b)=>a.start-b.start);
  for(let i=1;i<sorted.length;i++) if(sorted[i].start<sorted[i-1].start+sorted[i-1].length) throw new ClipError('collision',`Growth overlaps “${sorted[i-1].name}” and “${sorted[i].name}”. Make room before saving.`);
  const next:ClipArrangement={...copy(model),version:isExpandedStructure(draft)||timed&&model.version>=3?4:model.version,revision:model.revision+1,lanes:model.lanes.map(l=>l.id===lane.id?lane:copy(l)),end:Math.max(model.end,...lane.clips.map(c=>c.start+c.length))};
  validateArrangement(next,timings);
  return {model:next,shared,occurrences:materialized.occurrences,previewPaths:materialized.previewPaths};
}
/** Preview uses a private lane; it never enters authored state or audio configuration. */
export function structurePreview(model:ClipArrangement,draft:StructureDraft,timings:LaneTiming={}):ClipArrangement {
  draft=refreshStructureWindows(model,draft);
  const timed=draft.commands.slice(0,draft.cursor).some(c=>c.kind==='timed'||c.kind==='resizeRest'||('target' in c&&c.target.ticks!==undefined));
  const {lane,children,placements}=materialize(draft,'local',true);
  const original=structureClip(draft);
  const before=isExpandedStructure(draft)?draft.expanded!.contentTicks:contentLength(draft.basis,original.children,timings[lane.id]),after=contentLength(lane,children,timings[lane.id]);
  const growth=original.mode==='once'&&after>before?Math.max(0,after-original.offset-original.length):0;
  lane.clips=lane.clips.map(c=>c.id===draft.clipId?{...c,...(isExpandedStructure(draft)?original:{}),children,...(c.transposePlacements||placements.length?{transposePlacements:placements}:{})}:draft.followingPassClipIds?.includes(c.id)?{...c,start:c.start+growth}:c);
  return {...model,version:isExpandedStructure(draft)||timed&&model.version>=3?4:model.version,lanes:model.lanes.map(l=>l.id===lane.id?lane:l)};
}
