import { sumPlans } from './transposition';
import { localBeatTicks, newClipId, patternDuration, type LaneTiming } from './model';
import type { StructureNode } from './structure';

export function nodeTicks(node: StructureNode, timing: LaneTiming[string]): number {
  return node.children ? node.children.reduce((sum,n)=>sum+nodeTicks(n,timing),0) : node.definition?.kind === 'pattern' ? patternDuration(node.definition,timing) : node.restTicks!;
}
/** Place into silence without moving any other occurrence. */
export function placeAt(items: StructureNode[], nodes: StructureNode[], at: number, timing: LaneTiming[string]): StructureNode[] {
  const length=nodes.reduce((sum,n)=>sum+nodeTicks(n,timing),0);
  if (!Number.isSafeInteger(at)||at<0||!length) throw Error('Invalid content position.');
  let cursor=0;
  const occupied=items.flatMap(n=>{const start=cursor;cursor+=nodeTicks(n,timing);return n.definition?[{node:n,start,end:cursor}]:[];});
  if(occupied.some(n=>n.start<at+length&&n.end>at))throw Error('Content overlaps. Make room before placing it.');
  const entries=[...occupied,...nodes.map(node=>{const start=at;at+=nodeTicks(node,timing);return {node,start,end:at};})].sort((a,b)=>a.start-b.start);
  const result:StructureNode[]=[];let position=0;
  for(const entry of entries){if(entry.start>position)result.push({id:newClipId(),restTicks:entry.start-position});result.push(entry.node);position=entry.end;}
  if(cursor>position)result.push({id:newClipId(),restTicks:cursor-position});
  return result.reduce<StructureNode[]>((merged,node)=>{
    const previous=merged[merged.length-1];
    if(previous?.restTicks!==undefined&&node.restTicks!==undefined)previous.restTicks+=node.restTicks;
    else merged.push(node);
    return merged;
  },[]);
}
export function resizeNode(node: StructureNode, ticks: number, timing: LaneTiming[string]): StructureNode {
  const next=structuredClone(node),def=next.definition;
  if(def?.kind!=='pattern')throw Error('Select a pattern to resize.');
  const beats=Math.round(ticks/localBeatTicks(timing));
  const maximum=def.source==='score'?8192:def.source==='arpeggiator'?16:32;
  if(def.source==='controller'&&def.payload.curveDurationTicks!==undefined){
    if(!Number.isSafeInteger(ticks)||ticks<1)throw Error('Invalid duration.');
    def.payload.curveDurationTicks=ticks;return next;
  }
  if(def.source==='arpeggiator'&&beats>8&&beats!==16)throw Error('Arpeggiator length must be 1–8 or 16 beats.');
  if(beats<1||beats>maximum||def.source==='controller'&&beats*(timing?.stepsPerBeat??4)>128)throw Error('Pattern duration exceeds the editor limits.');
  def.payload.lengthBeats=beats;
  if('stepCount' in def.payload)def.payload.stepCount=beats*(timing?.stepsPerBeat??4);
  return next;
}

/** Clipboard-style snapshot: source music is never changed by a drop. */
export function copyNodes(nodes: StructureNode[], source: import('./model').ClipLane, destination: import('./model').ClipLane, state: import('../../types').SequencerState, timings: LaneTiming): StructureNode[] {
  if(source.source!==destination.source)throw Error('Copy content to a track of the same type.');
  const cross=source.id!==destination.id;
  const from=timings[source.id],to=timings[destination.id];
  if(source.source==='controller'&&(from?.controllerMode!==to?.controllerMode||!!from?.automation!==!!to?.automation))throw Error('Controller modes must match.');
  const visit=(node:StructureNode,fresh=true):StructureNode=>{
    const next=structuredClone(node);if(fresh||cross)next.id=newClipId();delete next.originalPath;
    if(cross&&next.restTicks!==undefined){next.restTicks=next.restTicks*localBeatTicks(to)/localBeatTicks(from);if(!Number.isSafeInteger(next.restTicks))throw Error('Rest cannot be represented on the destination timing.');}
    if(next.definition&&cross){
      next.definition.id=newClipId();next.definition.revision=0;
      const profile=source.transposeProfiles?.find(p=>p.id===next.definition!.transposeProfileId);
      if(profile)next.transpose=sumPlans([profile.plan,...(next.transpose?[next.transpose]:[])]);
      delete next.definition.transposeProfileId;
      if(next.definition.kind==='pattern'){
        const def=next.definition;
        if('stepCount' in def.payload)def.payload.stepCount=def.payload.lengthBeats*(to?.stepsPerBeat??4);
        if(def.source==='controller'&&def.payload.lengthBeats*(to?.stepsPerBeat??4)>128)throw Error('Destination controller grid exceeds 128 steps.');
        if(def.source==='drummer'){
          const src=state.drummerTracks.find(t=>t.id===source.id)!,dst=state.drummerTracks.find(t=>t.id===destination.id)!;
          def.payload.rows=def.payload.rows.flatMap(row=>{
            const key=src.rows.find(r=>r.id===row.rowId)?.key, matches=dst.rows.filter(r=>r.key===key);
            const used=row.steps.some(cell=>cell.active);
            if(matches.length!==1){if(used)throw Error('A used drum key is missing or ambiguous in the destination.');return [];}
            return [{...row,rowId:matches[0].id}];
          });
        }
      }
    }
    if(next.children)next.children=next.children.map(n=>visit(n,false));
    return next;
  };
  return nodes.map(n=>visit(n));
}
