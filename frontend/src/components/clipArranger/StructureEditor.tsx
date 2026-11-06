import { sumPlans, offsetAt, type OffsetPlan } from '../../lib/clipArranger/transposition';
import { copyNodes, nodeTicks } from '../../lib/clipArranger/timedStructure';
import { structureDropLayout, structureInsertionAt, STRUCTURE_TREE_TOP, type StructureDropLayout } from '../../lib/clipArranger/structureHitTest';
import { sourceKeys } from '../../lib/clipArranger/migration';
import { structureCopy } from "./structureCopy";
import { newStructurePattern } from "./ContentEditor";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import type { GuiLanguage, SequencerState } from '../../types';
import { type ContainerTarget, type StructureNode, type StructureSelection, type StructureCommand, applyStructure, isExpandedStructure, beginStructure, prepareStructure, stepStructure, structureChildren, structurePreview, type StructureDraft } from '../../lib/clipArranger/structure';
import type { ClipArrangement, LaneTiming, OccurrenceTarget } from '../../lib/clipArranger/model';
import { ClipError, contentLength, resolveContent } from '../../lib/clipArranger/model';
import { useAppStore } from '../../store/useAppStore';
import { hasChangedClipDrafts } from '../../lib/clipArranger/draftResolution';
import { beginDraft } from '../../lib/clipArranger/operations';
import { draftKey } from '../../lib/clipArranger/editorAdapter';
import { affectedDraftKeys, rebaseStructure, remapStructureCommand } from '../../lib/clipArranger/structuralDraftResolution';
import { SaveScopeDialog } from './SaveScopeDialog';
import { commitClipArrangement, saveClipDraft } from '../../store/clipActions';
import { PatternPreview } from './PatternPreview';
import { clipInput } from "./ClipArranger";
import { clipButton, clipButtonClass } from "./buttonStyles";
import { clipCopy } from './copy';

const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export type StructureFocus = { laneId:string;clipId:string;pass:number;parent:string[] };
export function useStructureEditor(model:ClipArrangement, sequencer:SequencerState, timings:LaneTiming, language:GuiLanguage, beforeSave:(()=>Promise<void>)|undefined, unit:number) {
 const draft=useStructureDraft(s=>s.draft), c=clipCopy(language), t=structureCopy(language);
 const [focus,setFocus]=useState<StructureFocus|null>(null),[selection,setSelection]=useState<StructureSelection|null>(null);
 const [picker,setPicker]=useState<ContainerTarget|null>(null),[query,setQuery]=useState(''),[saving,setSaving]=useState(false),[scope,setScope]=useState<'local'|'all'>('local');
 const [menu,setMenu]=useState<{x:number;y:number}|null>(null),[ghost,setGhost]=useState<{x:number;y:number;count:number}|null>(null);
 const [groupName,setGroupName]=useState('');
 const [resizeFeedback,setResizeFeedback]=useState<string|null>(null);
 const [previewDraft,setPreviewDraft]=useState<StructureDraft|null>(null);
 const [error,setError]=useState<string|null>(null),[pending,setPending]=useState<((model?:ClipArrangement,draft?:StructureDraft,paths?:{before:string[];after:string[]}[])=>void)|null>(null);
 const [musical,setMusical]=useState<{key:string;resume:(before:ClipArrangement,after:ClipArrangement)=>void}|null>(null);
 const [musicalSaving,setMusicalSaving]=useState(false),[busy,setBusy]=useState(false);
 const musicalDialog=useRef<HTMLDialogElement>(null);
 const generation=useAppStore(s=>s.performanceWorkspaceGeneration);
 const suppressClick=useRef(false);
 const drag=useRef<{focus:StructureFocus;selection:StructureSelection;x:number;y:number;active:boolean;layout:StructureDropLayout;viewport:HTMLElement;lane:HTMLElement}|null>(null);
 const scrollFrame=useRef<number|null>(null);
 const [drop,setDrop]=useState<{focus:StructureFocus;target:ContainerTarget;screenX?:number;screenY?:number}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{setFocus(null);setSelection(null);setPicker(null);setSaving(false);setMusical(null);setMusicalSaving(false);setPending(null);},[generation]);
 useEffect(()=>{if(musical&&!musicalSaving)musicalDialog.current?.showModal?.();},[musical,musicalSaving]);
 useEffect(()=>{if(picker||saving||pending)dialog.current?.showModal?.();else dialog.current?.close?.();},[picker,saving,pending]);
 useEffect(()=>{setSelection(null);cancelDrag();},[model.revision]);
 const discard=()=>{useStructureDraft.setState({draft:null});setSelection(null);setSaving(false);};
 const guard=(action:(model?:ClipArrangement,draft?:StructureDraft,paths?:{before:string[];after:string[]}[])=>void)=>{if(draft?.cursor){setPending(()=>action);return;} useStructureDraft.setState({draft:null});action();};
 const guardEdit=(requested:OccurrenceTarget,action:(target:OccurrenceTarget)=>void)=>guard((saved,structural,paths)=>{
  try {
   if(saved&&structural&&requested.laneId===structural.laneId&&requested.clipId===structural.clipId&&requested.pass===structural.pass){
    if(isExpandedStructure(structural)){
     const mapped=paths?.find(p=>equal(p.before,requested.path));
     if(!mapped)throw Error(t.containerRemoved);
     action({...requested,pass:0,path:mapped.after});return;
    }
    const preview=structurePreview(model,structural,timings),clip=saved.lanes.find(l=>l.id===requested.laneId)?.clips.find(c=>c.id===requested.clipId);
    if(!clip)throw Error(t.containerRemoved);
    const pass=clip.mode==='once'?0:requested.pass;
    const mapped=remapStructureCommand({kind:'rename',path:requested.path,name:''},beginStructure(preview,requested.laneId,requested.clipId,requested.pass).roots,beginStructure(saved,requested.laneId,requested.clipId,pass).roots);
    if(mapped.kind==='rename')action({...requested,pass,path:mapped.path});
   }else action(requested);
  }catch(e){setError(String(e));}
 });
 const target=(f:StructureFocus)=>{
  const draft=useStructureDraft.getState().draft;
  if(draft && (draft.laneId!==f.laneId||draft.clipId!==f.clipId||draft.pass!==f.pass)) throw Error('Save or discard the current structure first.');
  return draft??beginStructure(useAppStore.getState().sequencer.clipArrangement!,f.laneId,f.clipId,f.pass);
 };
 const dirtyKeys=(keys:string[])=>{
  const state=useAppStore.getState();
  return keys.filter(key=>state.clipDrafts[key]&&hasChangedClipDrafts(state.sequencer.clipArrangement,{[key]:state.clipDrafts[key]}));
 };
 const resolveMusical=(key:string,resume:(before:ClipArrangement,after:ClipArrangement)=>void)=>{setError(null);setMusicalSaving(false);setMusical({key,resume});};
 const run=(command:StructureCommand,f=focus)=>{
  if(!f)return;setMenu(null);
  try {
   const base=target(f),state=useAppStore.getState();
   const conflicting=dirtyKeys(Object.keys(state.clipDrafts).filter(key=>{const d=state.clipDrafts[key];return d.target.laneId===f.laneId&&d.target.clipId===f.clipId;}));
   if(conflicting.length){
    resolveMusical(conflicting[0],(before,after)=>{
     if(before===after){run(command,f);return;}
     if(command.kind==='duplicate'&&before.lanes.find(l=>l.id===f.laneId)?.clips.find(c=>c.id===f.clipId)?.mode==='loop'&&after.lanes.find(l=>l.id===f.laneId)?.clips.find(c=>c.id===f.clipId)?.mode!=='loop'){setSelection(null);setError(t.selectionChanged);return;}
     const next=useStructureDraft.getState().draft??rebaseStructure(base,after,timings);
     useStructureDraft.setState({draft:next});
     const mapped=remapStructureCommand({kind:'rest',target:{path:f.parent,index:0},ticks:1},base.roots,next.roots);
     if(mapped.kind==='rest')run(remapStructureCommand(command,base.roots,next.roots),{...f,laneId:next.laneId,clipId:next.clipId,pass:next.pass,parent:mapped.target.path});
    });return;
   }
   const next=applyStructure(base,command,timings,state.sequencer.clipArrangement!);
   if(command.kind==='groupRepetitions')prepareStructure(state.sequencer.clipArrangement!,next,'local',timings);
   if(command.kind==='duplicate')try{prepareStructure(state.sequencer.clipArrangement!,next,'local',timings);}catch(e){if(!(e instanceof ClipError&&e.code==='collision'))throw e;}
   useStructureDraft.setState({draft:next});setFocus({...f,pass:next.pass});setError(null);setSelection(null);
  }catch(e){setError(String(e));}
 };
 const finishMusical=async(choice:'discard'|'local'|'all',name?:string)=>{
  if(!musical||busy)return;setBusy(true);
  const pending=musical, before=useAppStore.getState();
  try {
   await beforeSave?.();
   if(useAppStore.getState().performanceWorkspaceGeneration!==before.performanceWorkspaceGeneration)return;
   if(choice==='discard'){
    const state=useAppStore.getState(),drafts={...state.clipDrafts};delete drafts[pending.key];
    useAppStore.setState({clipDrafts:drafts,clipEditingKey:state.clipEditingKey===pending.key?null:state.clipEditingKey});
   }else saveClipDraft(choice,name??before.clipDrafts[pending.key].definition.name,pending.key);
   setMusical(null);setMusicalSaving(false);setError(null);
   pending.resume(before.sequencer.clipArrangement!,useAppStore.getState().sequencer.clipArrangement!);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 };
 const spansPasses = !!selection?.range;
 const isSelected=(f:StructureFocus,id:string)=>{
  if(!focus||!selection||focus.laneId!==f.laneId||focus.clipId!==f.clipId||!equal(selection.parent,f.parent))return false;
  if(selection.range){const clip=model.lanes.find(l=>l.id===f.laneId)?.clips.find(c=>c.id===f.clipId);if(!clip)return false;const ordinal=f.pass*clip.children.length+clip.children.findIndex(n=>n.id===id);return ordinal>=selection.range.first&&ordinal<=selection.range.last;}
  return focus.pass===f.pass&&selection.ids.includes(id);
 };
 const select=(f:StructureFocus,id:string,shift:boolean)=>{
  if(suppressClick.current){suppressClick.current=false;return false;}
  if(shift&&focus&&selection&&(focus.laneId!==f.laneId||focus.clipId!==f.clipId||!equal(focus.parent,f.parent)||f.parent.length&&focus.pass!==f.pass))return false;
  const action=()=>{try{
   const current=useAppStore.getState().sequencer.clipArrangement!;
   const clip=current.lanes.find(l=>l.id===f.laneId)?.clips.find(c=>c.id===f.clipId);
   if(!clip||clip.mode==='once'&&f.pass!==0)throw Error(t.selectionChanged);
   const rangeAllowed=!f.parent.length&&clip.mode==='loop'&&!(draft&&isExpandedStructure(draft));
   if(shift&&focus&&selection&&rangeAllowed){
    const anchorPass=selection.anchorPass??focus.pass;
    const a=clip.children.findIndex(n=>n.id===selection.anchor),b=clip.children.findIndex(n=>n.id===id);
    const duration=contentLength(current.lanes.find(l=>l.id===f.laneId)!,clip.children,timings[f.laneId]);
    const firstPass=Math.floor(clip.offset/duration),lastPass=Math.floor((clip.offset+clip.length-1)/duration);
    if(a<0||b<0||anchorPass<firstPass||anchorPass>lastPass||f.pass<firstPass||f.pass>lastPass)throw Error(t.selectionChanged);
    if(anchorPass!==f.pass){const x=anchorPass*clip.children.length+a,y=f.pass*clip.children.length+b;setFocus(f);setSelection({parent:[],ids:[],anchor:selection.anchor,anchorPass,tip:{pass:f.pass,id},range:{first:Math.min(x,y),last:Math.max(x,y)}});setError(null);return;}
   }
   const d=target(f),items=structureChildren(d.roots,f.parent);
   if(!items.some(n=>n.id===id))throw Error(t.selectionChanged);
   let ids=[id],anchor=id,anchorPass=f.pass;
   if(shift&&focus&&selection){const a=items.findIndex(n=>n.id===selection.anchor),b=items.findIndex(n=>n.id===id);if(a>=0&&b>=0){ids=items.slice(Math.min(a,b),Math.max(a,b)+1).map(n=>n.id);anchor=selection.anchor;anchorPass=selection.anchorPass??focus.pass;}}
   setFocus(f);setSelection({parent:f.parent,ids,anchor,anchorPass,tip:{pass:f.pass,id}});setError(null);
  }catch(e){setError(String(e));}};
  if(draft&&(draft.laneId!==f.laneId||draft.clipId!==f.clipId||draft.pass!==f.pass))guard(action);else action();
 };
 const extendSelection=(f:StructureFocus,id:string,direction:number)=>{
  const current=draft?structurePreview(model,draft,timings):model;
  const lane=current.lanes.find(l=>l.id===f.laneId)!,clip=lane.clips.find(c=>c.id===f.clipId)!;
  const nodes=structureChildren((draft&&isExpandedStructure(draft)?draft:beginStructure(current,f.laneId,f.clipId,f.pass)).roots,f.parent);
  let index=nodes.findIndex(n=>n.id===id)+direction,pass=f.pass;
  if(!f.parent.length&&clip.mode==='loop'){
   if(index<0){index=nodes.length-1;pass--;}else if(index>=nodes.length){index=0;pass++;}
   const duration=contentLength(lane,clip.children,timings[lane.id]);
   if(pass<Math.floor(clip.offset/duration)||pass>Math.floor((clip.offset+clip.length-1)/duration))return;
  }
  const next=nodes[index];if(!next)return;
  const nextFocus={...f,pass};select(nextFocus,next.id,true);return {focus:nextFocus,id:next.id};
 };
 const add=(f:StructureFocus,index:number,ticks?:number)=>{const action=()=>{setFocus(f);setPicker({path:f.parent,index,ticks});setQuery('');};if(draft&&(draft.laneId!==f.laneId||draft.clipId!==f.clipId||draft.pass!==f.pass))guard(action);else action();};
 const cancelDrag=()=>{resizing.current=null;setResizeFeedback(null);setPreviewDraft(null);drag.current=null;suppressClick.current=false;setDrop(null);setGhost(null);setMenu(null);if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);scrollFrame.current=null;};
 useEffect(()=>()=>{if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancelDrag();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const pointerDown=(e:PointerEvent,f:StructureFocus,id:string)=>{if(e.button!==0)return;e.stopPropagation();
  if(e.shiftKey){select(f,id,true);return;}
  if(spansPasses)return;
  if(!focus||!equal(focus,f)||!selection?.ids.includes(id)){if(select(f,id,false)===false)return;}
  const viewport=e.currentTarget.closest<HTMLElement>('[data-arranger-viewport]');
  const lane=Array.from(viewport?.querySelectorAll<HTMLElement>('[data-clip-lane]')??[]).find(node=>node.dataset.clipLane===f.laneId);
  if(!viewport||!lane)return;
  try {
   const layout=structureDropLayout(model,target(f),timings);
   drag.current={focus:f,selection:focus&&equal(focus,f)&&selection?.ids.includes(id)?selection:{parent:f.parent,ids:[id],anchor:id},x:e.clientX,y:e.clientY,active:false,layout,viewport,lane};
   e.currentTarget.setPointerCapture(e.pointerId);
  } catch(e){setError(String(e));}
 };
 const hitTarget=(x:number,y:number)=>{
  const d=drag.current;if(!d)return null;
  const laneElement=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-clip-lane]')??(y>=d.lane.getBoundingClientRect().top&&y<d.lane.getBoundingClientRect().bottom?d.lane:null);
  const laneId=laneElement?.dataset.clipLane;
  const timeline=laneElement?.querySelector<HTMLElement>('[data-clip-timeline]');
  const lane=model.lanes.find(l=>l.id===laneId);if(!lane||!timeline)return null;
  const marker=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-structure-target]');
  if(marker){const data=JSON.parse(marker.dataset.structureTarget!) as {focus:StructureFocus;target:ContainerTarget};const base=data.focus.clipId===d.focus.clipId?target(d.focus):beginStructure(model,data.focus.laneId,data.focus.clipId,data.focus.pass);const items=structureChildren(base.roots,data.target.path);return {...data,target:{...data.target,ticks:items.slice(0,data.target.index).reduce((sum,n)=>sum+nodeTicks(n,timings[lane.id]),0)}};}
  const tick=(x-timeline.getBoundingClientRect().left)/unit;
  const clip=lane.clips.find(c=>tick>=c.start&&tick<c.start+c.length);if(!clip)return null;
  const duration=contentLength(lane,clip.children,timings[lane.id]);
  const pass=clip.mode==='loop'?Math.floor((clip.offset+tick-clip.start)/duration):0;
  const f={laneId:lane.id,clipId:clip.id,pass,parent:[] as string[]};
  const current=lane.id===d.focus.laneId&&clip.id===d.focus.clipId&&pass===d.focus.pass?target(d.focus):beginStructure(model,lane.id,clip.id,pass);
  const layout=structureDropLayout(model,current,timings);
  const insertion=structureInsertionAt(layout,tick,laneElement!.dataset.expanded==='true'?y-laneElement!.getBoundingClientRect().top-STRUCTURE_TREE_TOP:0);
  if(!insertion)return null;
  let origin=layout.origin,items=current.roots;
  for(const id of insertion.path){const index=items.findIndex(n=>n.id===id);origin+=items.slice(0,index).reduce((sum,n)=>sum+nodeTicks(n,timings[lane.id]),0);items=items[index].children!;}
  insertion.ticks=Math.max(0,Math.round((tick-origin)/20160*4)*20160/4);
  f.parent=insertion.path;
  return {focus:f,target:insertion,screenX:timeline.getBoundingClientRect().left+(origin+insertion.ticks)*unit,screenY:laneElement!.getBoundingClientRect().top+STRUCTURE_TREE_TOP};
 };
 const dropCommand=(d:NonNullable<typeof drag.current>,candidate:{focus:StructureFocus;target:ContainerTarget}):StructureCommand=>{
   const currentModel=useAppStore.getState().sequencer.clipArrangement!;
   const same=d.focus.laneId===candidate.focus.laneId&&d.focus.clipId===candidate.focus.clipId&&d.focus.pass===candidate.focus.pass;
   if(!same&&d.focus.clipId===candidate.focus.clipId)throw Error(t.selectionChanged);
   const base=target(d.focus),nodes=structureChildren(base.roots,d.selection.parent).filter(n=>d.selection.ids.includes(n.id));
   const inherited:OffsetPlan[]=[];let repeat=(base.basis.clips.find(c=>c.id===d.focus.clipId)?.repeatIndexBase??0)+d.focus.pass;
   let ancestors=base.roots;
   for(const id of d.selection.parent){const n=ancestors.find(n=>n.id===id)!;repeat=n.repeatIndex??repeat;const profile=base.basis.transposeProfiles?.find(p=>p.id===n.definition?.transposeProfileId);for(const plan of [profile?.plan,n.transpose,n.placement])if(plan)inherited.push({base:offsetAt(plan,repeat),repetitions:[]});ancestors=n.children!;}
   const snapshot=nodes.map(n=>({...n,...(model.version>=3?{repeatIndex:n.repeatIndex??repeat}:{}),...(inherited.length?{placement:sumPlans([...inherited,...(n.placement?[n.placement]:[])])}:{})}));
   return {kind:'timed',parent:same?d.selection.parent:[],ids:same?d.selection.ids:[],target:candidate.target,...(!same?{nodes:copyNodes(snapshot,base.basis,currentModel.lanes.find(l=>l.id===candidate.focus.laneId)!,useAppStore.getState().sequencer,timings)}:{})};
 };
 const resizing=useRef<{focus:StructureFocus;id:string;edge:'left'|'right';x:number;scroll:number;viewport:HTMLElement;base:StructureDraft;visibleTicks?:number}|null>(null);
 const resizeCommand=(base:StructureDraft,f:StructureFocus,id:string,edge:'left'|'right',delta:number,visibleTicks?:number):StructureCommand=>{
  const items=structureChildren(base.roots,f.parent),index=items.findIndex(n=>n.id===id),node=items[index];
  if(!node)throw Error(t.selectionChanged);
  if(node.restTicks!==undefined)return {kind:'resizeRest',parent:f.parent,ids:[id],ticks:Math.round(((visibleTicks??node.restTicks)+delta)/5040)*5040};
  const at=items.slice(0,index).reduce((sum,n)=>sum+nodeTicks(n,timings[f.laneId]),0);
  return {kind:'timed',parent:f.parent,ids:[id],target:{path:f.parent,index,ticks:at},resize:{edge,delta}};
 };
 const resize=(f:StructureFocus,id:string,edge:'left'|'right',delta:number,visibleTicks?:number)=>{
  try {run(resizeCommand(target(f),f,id,edge,delta,visibleTicks),f);}catch(e){setError(String(e));}
 };
 const nudge=(f:StructureFocus,id:string,delta:number)=>{try{const items=structureChildren(target(f).roots,f.parent),index=items.findIndex(n=>n.id===id);run({kind:'timed',parent:f.parent,ids:[id],target:{path:f.parent,index,ticks:items.slice(0,index).reduce((sum,n)=>sum+nodeTicks(n,timings[f.laneId]),0)+delta}},f);}catch(e){setError(String(e));}};
 const resizeDown=(e:PointerEvent,f:StructureFocus,id:string,edge:'left'|'right',visibleTicks?:number)=>{
  if(e.button!==0)return;e.stopPropagation();
  const viewport=e.currentTarget.closest<HTMLElement>('[data-arranger-viewport]');if(!viewport)return;
  try {
   const base=target(f);viewport.setPointerCapture(e.pointerId);
   resizing.current={focus:f,id,edge,x:e.clientX,scroll:viewport.scrollLeft,viewport,base,visibleTicks};
   setError(null);
  }catch(error){setError(String(error));}
 };
 const resizeAt=(x:number)=>{
  const r=resizing.current!;
  return resizeCommand(r.base,r.focus,r.id,r.edge,Math.round((x-r.x+r.viewport.scrollLeft-r.scroll)/unit),r.visibleTicks);
 };
 const previewResize=(x:number)=>{
  const r=resizing.current;if(!r)return;
  try {
   const command=resizeAt(x),next=x===r.x&&r.viewport.scrollLeft===r.scroll?r.base:applyStructure(r.base,command,timings,model);
   prepareStructure(model,next,'local',timings);
   const node=structureChildren(next.roots,r.focus.parent).find(n=>n.id===r.id);
   setPreviewDraft(next);setResizeFeedback(`${c.length}: ${Math.round((node?nodeTicks(node,timings[r.focus.laneId]):0)/20160*100)/100} ${c.beats}`);setError(null);
  }catch(error){setResizeFeedback(null);setError(String(error));}
 };
 const pointerMove=(e:PointerEvent)=>{if(resizing.current){
  previewResize(e.clientX);
  if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);
  const scroll=()=>{const r=resizing.current;if(!r)return;const bounds=r.viewport.getBoundingClientRect();const direction=e.clientX<bounds.left+45?-1:e.clientX>bounds.right-45?1:0;if(!direction)return;r.viewport.scrollLeft+=direction*12;previewResize(e.clientX);scrollFrame.current=requestAnimationFrame(scroll);};
  scrollFrame.current=requestAnimationFrame(scroll);return;
 }const d=drag.current;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<5&&!d.active)return;if(!d.active)d.viewport.setPointerCapture(e.pointerId);d.active=true;setGhost({x:e.clientX+12,y:e.clientY+12,count:d.selection.ids.length});
  const update=()=>{const candidate=hitTarget(e.clientX,e.clientY);try{if(candidate){const command=dropCommand(d,candidate);const base=candidate.focus.clipId===d.focus.clipId?target(d.focus):beginStructure(model,candidate.focus.laneId,candidate.focus.clipId,candidate.focus.pass);applyStructure(base,command,timings,model);}setDrop(candidate);}catch{setDrop(null);}};update();
  if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);
  const viewport=d.viewport;
  const scroll=()=>{if(!drag.current||!viewport)return;const r=viewport.getBoundingClientRect();const direction=e.clientX<r.left+45?-1:e.clientX>r.right-45?1:0;if(!direction)return;viewport.scrollLeft+=direction*12;update();scrollFrame.current=requestAnimationFrame(scroll);};
  if(viewport)scrollFrame.current=requestAnimationFrame(scroll);
 };
 const pointerUp=(e:PointerEvent)=>{
  if(resizing.current){
   const r=resizing.current;e.stopPropagation();
   try {if(e.clientX!==r.x||r.viewport.scrollLeft!==r.scroll){const command=resizeAt(e.clientX);prepareStructure(model,applyStructure(r.base,command,timings,model),'local',timings);run(command,r.focus);}}catch(error){setError(String(error));}
   cancelDrag();suppressClick.current=true;return;
  }
  const d=drag.current;if(!d)return;e.stopPropagation();const candidate=d.active?hitTarget(e.clientX,e.clientY):null;
  if(candidate)try{const command=dropCommand(d,candidate);const apply=()=>run(command,candidate.focus);if(draft&&(draft.laneId!==candidate.focus.laneId||draft.clipId!==candidate.focus.clipId))guard((saved,_structural,paths)=>{
    if(!saved||!paths){setError(t.selectionChanged);return;}
    try{const mapped=d.selection.ids.map(id=>paths.find(p=>equal(p.before,[...d.selection.parent,id]))?.after);if(mapped.some(p=>!p))throw Error(t.selectionChanged);const parent=mapped[0]!.slice(0,-1),ids=mapped.map(p=>p![p!.length-1]);const sourceClip=saved.lanes.find(l=>l.id===d.focus.laneId)!.clips.find(c=>c.id===d.focus.clipId)!;const source={...d,focus:{...d.focus,pass:sourceClip.mode==='once'?0:d.focus.pass,parent},selection:{...d.selection,parent,ids}};run(dropCommand(source,candidate),candidate.focus);}catch(error){setError(String(error));}
   });else apply();}catch(e){setError(String(e));}
  cancelDrag();if(d.active){suppressClick.current=true;}
 };

 const remove=(f=focus,id?:string)=>{if(!f||spansPasses)return;const ids=selection&&equal(f,focus)&&(!id||selection.ids.includes(id))?selection.ids:id?[id]:[];if(ids.length)run({kind:'remove',parent:f.parent,ids},f);};
 const openSave=()=>{setScope('local');setSaving(true);setPicker(null);};
 const boundary=(f:StructureFocus,index:number)=>{const data={focus:f,target:{path:f.parent,index}};return <button type="button" key={`insert-${index}`} data-structure-target={JSON.stringify(data)} aria-label={`${t.add} ${index+1}`} title={`${t.add} ${index+1}`} onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();add(f,index);}} className={`relative z-20 flex h-[15px] w-[21px] shrink-0 items-center justify-center rounded border text-[13.5px] font-semibold leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${equal(drop,data)?'border-cyan-200 bg-cyan-300 text-slate-950':'border-emerald-400/55 bg-emerald-950 text-emerald-300 hover:bg-emerald-900'}`}>+{equal(drop,data)&&<span className="pointer-events-none absolute left-0 top-0 h-24 border-l-2 border-cyan-200"/>}</button>;};
 const source=focus?model.lanes.find(l=>l.id===focus.laneId):undefined;
 const focusedLane=focus?.laneId,focusedClip=focus?.clipId,focusedPass=focus?.pass??0;
 const roots=useMemo(()=>draft?.roots??(focusedLane&&focusedClip&&model.lanes.find(l=>l.id===focusedLane)?.clips.some(c=>c.id===focusedClip)?beginStructure(model,focusedLane,focusedClip,focusedPass).roots:[]),[draft?.roots,model,focusedLane,focusedClip,focusedPass]);
 let items:StructureNode[]=[];try{items=structureChildren(roots,focus?.parent??[]);}catch{/* A save or external undo invalidated the selection. */}
 useEffect(()=>{
  if(!draft)return;
  const last=draft?.cursor?draft.commands[draft.cursor-1]:undefined;
  const previousDefinitions=new Set<string>();
  const collect=(nodes:StructureNode[])=>{for(const node of nodes){if(node.definition)previousDefinitions.add(node.definition.id);if(node.children)collect(node.children);}};
  collect(draft.history[Math.max(0,draft.cursor-1)]);
  const chosen=last&&(last.kind==='group'||last.kind==='groupRepetitions')
   ?structureChildren(draft.roots,last.kind==='group'?last.parent:[]).find(n=>n.definition?.kind===last.level&&!previousDefinitions.has(n.definition.id))
   :undefined;
  setSelection(chosen?{parent:last?.kind==='group'?last.parent:[],ids:[chosen.id],anchor:chosen.id}:null);
  setFocus(current=>{
   if(!current||!draft||current.laneId!==draft.laneId||current.clipId!==draft.clipId)return current;
   const parent=[...current.parent];
   while(parent.length){try{structureChildren(draft.roots,parent);break;}catch{parent.pop();}}
   return equal(parent,current.parent)&&current.pass===draft.pass?current:{...current,pass:draft.pass,parent};
  });
 },[draft?.roots]);
 const selectionSize=selection?.range ? selection.range.last-selection.range.first+1 : selection?.ids.length??0;
 // A range larger than a complete source cycle includes every source child. Avoid
 // allocating virtual selection nodes just to determine hierarchy compatibility.
 const selectedNodes=selection?.range
  ?Array.from({length:Math.min(selectionSize,roots.length)},(_,i)=>roots[(selection.range!.first+i)%roots.length])
  :items.filter(n=>selection?.ids.includes(n.id));
 const canGroup=(level:'group'|'supergroup')=>{
  const requiredKind=level==='group'?'pattern':'group';
  const compatible=selectedNodes.every(n=>!n.definition||n.definition.kind===requiredKind);
  const definitions=selection?.range
   ?Array.from({length:Math.min(selectionSize,roots.length*2)},(_,i)=>roots[(selection.range!.first+i)%roots.length]).filter(n=>n.definition).length
   :selectedNodes.filter(n=>n.definition).length;
  const parentAllows=!focus?.parent.length||level==='group'&&focus.parent.length===1&&roots.find(n=>n.id===focus.parent[0])?.definition?.kind==='supergroup';
  return selectionSize>=2&&compatible&&definitions>=(level==='group'?1:2)&&parentAllows;
 };
 const canUngroup=!!selection&&!spansPasses&&selectedNodes.length>0&&selectedNodes.every(n=>!!n.children);
 const canDuplicate=!!selection&&!spansPasses&&selectedNodes.some(n=>!!n.definition);
 const duplicate=()=>{
  if(!selection||!focus||!canDuplicate)return;
  const command:StructureCommand={kind:'duplicate',parent:selection.parent,ids:selection.ids};
  const clip=model.lanes.find(l=>l.id===focus.laneId)?.clips.find(c=>c.id===focus.clipId);
  if(clip?.mode==='loop'&&draft?.cursor&&!isExpandedStructure(draft)){
   setMenu(null);
   guard(()=>{setSelection(null);setError(t.selectionChanged);});
  }else run(command);
 };
 const group=(level:'group'|'supergroup')=>{
  if(!selection||!focus||!canGroup(level))return;
  const name=groupName.trim()||`${c[level]} ${Date.now().toString().slice(-4)}`;
  if(selection.range){
   const clip=model.lanes.find(l=>l.id===focus.laneId)!.clips.find(c=>c.id===focus.clipId)!;
   const point=(ordinal:number)=>({pass:Math.floor(ordinal/clip.children.length),id:clip.children[ordinal%clip.children.length].id});
   run({kind:'groupRepetitions',range:{first:point(selection.range.first),last:point(selection.range.last)},level,name},focus);
  }else run({kind:'group',parent:selection.parent,ids:selection.ids,level,name});
 };
 const moveBy=(direction:number)=>{if(!selection||spansPasses)return;const indexes=selection.ids.map(id=>items.findIndex(n=>n.id===id));run({kind:'move',parent:selection.parent,ids:selection.ids,target:{path:selection.parent,index:direction<0?Math.max(0,Math.min(...indexes)-1):Math.min(items.length,Math.max(...indexes)+2)}});};
 const destinations:{path:string[];label:string;length:number}[]=[];
 const visit=(nodes:StructureNode[],path:string[],label:string)=>{destinations.push({path,label,length:nodes.length});for(const n of nodes)if(n.children)visit(n.children,[...path,n.id],`${label} / ${n.definition!.name}`);};visit(roots,[],'Clip');
 const containerLabel=(path:string[])=>{
  let nodes=roots;const names=['Clip'];
  for(const id of path){const node=nodes.find(n=>n.id===id);if(!node)break;names.push(node.definition?.name??c.rest);nodes=node.children??[];}
  return names.join(' / ');
 };
 const submit=async()=>{
  const draft=useStructureDraft.getState().draft;if(!draft||busy)return;
  try{
   const state=useAppStore.getState(),model=state.sequencer.clipArrangement!;
   const result=prepareStructure(model,draft,scope,timings);
   const affected=affectedDraftKeys(model,result.model,state.clipDrafts),conflicting=dirtyKeys(affected);
   if(conflicting.length){resolveMusical(conflicting[0],()=>setSaving(true));return;}
   setBusy(true);await beforeSave?.();
   if(useAppStore.getState().sequencer.clipArrangement!==model)throw Error(t.changed);
   const retained={...useAppStore.getState().clipDrafts};let editingKey=state.clipEditingKey;
   for(const key of affected){const previous=retained[key];delete retained[key];const mapped=isExpandedStructure(draft)?result.occurrences.find(m=>equal(m.from,previous.target)):undefined;if(mapped){const refreshed=beginDraft(result.model,mapped.to),nextKey=draftKey(refreshed);retained[nextKey]=refreshed;if(editingKey===key)editingKey=nextKey;}else if(editingKey===key)editingKey=null;}
   commitClipArrangement(result.model,'Edit clip structure');
   useAppStore.setState({clipDrafts:retained,clipEditingKey:editingKey&&retained[editingKey]?editingKey:null});discard();setFocus(result.model.lanes.find(l=>l.id===draft.laneId)?.clips.some(c=>c.id===draft.clipId)?{laneId:draft.laneId,clipId:draft.clipId,pass:0,parent:[]}:null);setError(null);const next=pending;setPending(null);next?.(result.model,draft,result.previewPaths);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 };
 const conflictDraft=musical?useAppStore.getState().clipDrafts[musical.key]:undefined;
 const conflictLane=conflictDraft?model.lanes.find(l=>l.id===conflictDraft.target.laneId):undefined;
 const conflictModal=musical&&conflictDraft&&conflictLane?(musicalSaving?
  <SaveScopeDialog draft={conflictDraft} lane={conflictLane} language={language} timing={timings[conflictLane.id]} error={error} busy={busy} onCancel={()=>{setMusicalSaving(false);setError(null);}} onSave={(scope,name)=>void finishMusical(scope,name)}/>:
  <dialog ref={musicalDialog} aria-label={t.musicalConflict} onCancel={e=>{e.preventDefault();if(!busy)setMusical(null);}} className="max-w-lg space-y-4 rounded-xl border border-slate-600 bg-slate-900 p-5 text-slate-200 backdrop:bg-black/70">
   <h3>{t.musicalConflict}</h3><p>{t.resolveMusical}</p><p>{sequencer[sourceKeys[conflictLane.source]].find(track=>track.id===conflictLane.id)?.name??conflictLane.id} / {conflictLane.clips.find(c=>c.id===conflictDraft.target.clipId)?.name} / {conflictDraft.definition.name}</p>
   {error&&<p role="alert">{error}</p>}<div className="flex gap-2"><button disabled={busy} className={clipButtonClass("save")} onClick={()=>setMusicalSaving(true)}>{c.save}</button><button disabled={busy} className={clipButtonClass("remove")} onClick={()=>void finishMusical('discard')}>{t.discard}</button><button disabled={busy} className={clipButton} onClick={()=>setMusical(null)}>{c.cancel}</button></div>
  </dialog>):null;
 let preview:ReturnType<typeof prepareStructure>|null=null,saveError='';if(saving&&draft)try{preview=prepareStructure(model,draft,scope,timings);}catch(e){saveError=String(e);}
 let allIssue='';if(saving&&draft)try{if(!prepareStructure(model,draft,'all',timings).shared)allIssue=t.root;}catch(e){allIssue=draft&&isExpandedStructure(draft)?t.localRepetitions:String(e);}
 const modal=<dialog ref={dialog} aria-label={saving?t.save:pending?t.unsaved:t.add} onCancel={e=>{e.preventDefault();if(busy)return;setSaving(false);setPicker(null);setPending(null);}} className="max-h-[80vh] w-[min(95vw,620px)] overflow-auto rounded-xl border border-slate-600 bg-slate-900 p-4 text-sm text-slate-200 backdrop:bg-black/60">
 {pending&&!saving?<><p>{t.resolve}</p><button className={clipButtonClass("save")} onClick={openSave}>{t.save}</button><button className={clipButtonClass("remove")} onClick={()=>{const next=pending;discard();setPending(null);setFocus(null);next();}}>{t.discard}</button><button className={clipButton} onClick={()=>setPending(null)}>{c.cancel}</button></>:saving?<><h3>{t.save}</h3><label className="block"><input type="radio" checked={scope==='local'} onChange={()=>setScope('local')}/>{c.local}</label>{(!draft||!isExpandedStructure(draft))&&<label className="block"><input type="radio" disabled={!!allIssue} checked={scope==='all'} onChange={()=>setScope('all')}/>{c.all}</label>}{allIssue&&<p>{allIssue}</p>}{preview&&draft&&<ul>{preview.model.lanes.find(l=>l.id===draft.laneId)?.definitions.filter(d=>JSON.stringify(d)!==JSON.stringify(draft.basis.definitions.find(old=>old.id===d.id))).map(d=><li key={d.id}>{d.name} · {c[d.kind]}</li>)}{draft.basis.clips.filter(old=>!preview.model.lanes.find(l=>l.id===draft.laneId)?.clips.some(cl=>cl.id===old.id)).map(old=><li key={old.id}>{c.remove}: {old.name}</li>)}</ul>}{preview&&draft&&preview.model.lanes.find(l=>l.id===draft.laneId)?.clips.map(cl=>{
 const old=draft.basis.clips.find(x=>x.id===cl.id),lane=preview!.model.lanes.find(l=>l.id===draft.laneId)!;
 const changed=!old||cl.length!==old.length||cl.start!==old.start||!equal(resolveContent(draft.basis,old.children,timings[lane.id]),resolveContent(lane,cl.children,timings[lane.id]));
 return changed?<p key={cl.id}>{cl.name} · {c.start}: {cl.start/20160} · {c.length}: {old?`${old.length/20160} → `:''}{cl.length/20160} {c.beats}</p>:null;
 })}{saveError&&<p role="alert">{saveError}</p>}<button disabled={busy||!preview||(scope==='all'&&!!allIssue)} className={clipButtonClass("save")} onClick={submit}>{c.save}</button><button disabled={busy} className={clipButton} onClick={()=>setSaving(false)}>{c.cancel}</button></>:picker&&source?<>{picker.ticks!==undefined&&<p className="mb-2 text-cyan-200">{t.insert}: {picker.ticks/20160} {c.beats} · {containerLabel(picker.path)}</p>}<input aria-label={t.search} placeholder={t.search} className={`${clipInput} !w-full`} value={query} onChange={e=>setQuery(e.target.value)}/>{source.definitions.filter(d=>{const parent=picker.path.length?structureChildren(roots,picker.path.slice(0,-1)).find(n=>n.id===picker.path[picker.path.length-1]):null;return !parent||d.kind==='pattern'||parent.definition?.kind==='supergroup'&&d.kind==='group';}).filter(d=>d.name.toLowerCase().includes(query.toLowerCase())).map(d=><div key={d.id} className="my-2 rounded border border-slate-700 p-2"><span>{d.name} · {c[d.kind]} · {contentLength(source,[{id:'preview',definitionId:d.id}],timings[source.id])/20160} {c.beats}</span>{d.kind==='pattern'&&<PatternPreview definition={d} timing={timings[source.id]} controllerMode={sequencer.controllerSequencers.find(t=>t.id===source.id)?.controllerMode}/>}<button className={clipButtonClass("add")} onClick={()=>{run({kind:'insert',target:picker,definition:d,variation:false});setPicker(null);}}>{c.addContent}</button><button className={clipButtonClass("add")} onClick={()=>{run({kind:'insert',target:picker,definition:d,variation:true});setPicker(null);}}>{c.copy}</button></div>)}<button className={clipButtonClass("add")} onClick={()=>{run({kind:'insert',target:picker,definition:newStructurePattern(source,sequencer,language),variation:false});setPicker(null);}}>{c.newPattern}</button><button className={clipButtonClass("add")} onClick={()=>{run({kind:'rest',target:picker,ticks:20160});setPicker(null);}}>{c.rest} +1</button><button className={clipButton} onClick={()=>setPicker(null)}>{c.cancel}</button></>:null}</dialog>;
 const toolbar=<>{drop&&ghost&&<div aria-hidden className="pointer-events-none fixed z-50 h-16 border-l-2 border-cyan-300" style={{left:drop.screenX??ghost.x-12,top:drop.screenY??ghost.y-12}}/>}{resizeFeedback&&<p role="status" className="text-cyan-300">{resizeFeedback}</p>}{ghost&&<div className="pointer-events-none fixed z-50 rounded border border-cyan-300 bg-slate-900 px-3 py-2 text-xs text-cyan-100" style={{left:ghost.x,top:ghost.y}}>{ghost.count} · {c.content}</div>}{menu&&<div role="menu" className="fixed z-50 flex gap-2 rounded border border-slate-500 bg-slate-900 p-2" style={{left:menu.x,top:menu.y}}><button role="menuitem" className={clipButtonClass("remove")} disabled={!selection||spansPasses} onClick={()=>remove()}>{t.remove}</button><button role="menuitem" disabled={!canGroup('group')} className={clipButtonClass("add")} onClick={()=>group('group')}>{c.group}</button><button role="menuitem" disabled={!canGroup('supergroup')} className={clipButtonClass("add")} onClick={()=>group('supergroup')}>{c.supergroup}</button>{canUngroup&&<button role="menuitem" className={clipButtonClass("edit")} onClick={()=>selection&&!spansPasses&&run({kind:'ungroup',parent:selection.parent,ids:selection.ids})}>{c.ungroup}</button>}<button role="menuitem" className={clipButtonClass("add")} disabled={!canDuplicate} onClick={duplicate}>{t.duplicate}</button><button role="menuitem" className={clipButtonClass("add")} onClick={()=>{setMenu(null);if(focus)add(focus,items.length);}}>{c.addContent}</button></div>}<div className="my-2 flex flex-wrap items-center gap-2 text-xs text-slate-200">{focus&&<><input aria-label={c.name} placeholder={c.name} value={groupName} onChange={e=>setGroupName(e.target.value)} className={clipInput}/><button className={clipButtonClass("add")} onClick={()=>add(focus,items.length)}>{t.add}</button><button disabled={!selection||spansPasses} className={clipButtonClass("remove")} onClick={()=>remove()}>{t.remove}</button><button disabled={!canGroup('group')} className={clipButtonClass("add")} onClick={()=>group('group')}>{c.group}</button><button disabled={!canGroup('supergroup')} className={clipButtonClass("add")} onClick={()=>group('supergroup')}>{c.supergroup}</button>{canUngroup&&<button className={clipButtonClass("edit")} onClick={()=>selection&&!spansPasses&&run({kind:'ungroup',parent:selection.parent,ids:selection.ids})}>{c.ungroup}</button>}<button disabled={!selection||spansPasses} className={clipButton} onClick={()=>moveBy(-1)}>←</button><button disabled={!selection||spansPasses} className={clipButton} onClick={()=>moveBy(1)}>→</button><select disabled={spansPasses} aria-label={t.move} className={clipInput} value="" onChange={e=>{const dest=destinations[Number(e.target.value)];if(selection)run({kind:'move',parent:selection.parent,ids:selection.ids,target:{path:dest.path,index:dest.length}});}}><option value="">{t.move}</option>{destinations.map((d,i)=><option key={i} value={i}>{d.label}</option>)}</select></>}{draft&&<><span className="text-amber-300">{c.unsaved}</span><button className={clipButtonClass("edit")} disabled={!draft.cursor} onClick={()=>useStructureDraft.setState({draft:stepStructure(draft,-1)})}>{c.undo}</button><button className={clipButtonClass("edit")} disabled={draft.cursor===draft.history.length-1} onClick={()=>useStructureDraft.setState({draft:stepStructure(draft,1)})}>{c.redo}</button><button className={clipButtonClass("save")} disabled={!draft.cursor} onClick={openSave}>{t.save}</button><button className={clipButtonClass("remove")} onClick={discard}>{t.discard}</button></>}</div>{error&&<p role="alert" className="text-rose-300">{error}</p>}{drop&&<p className="text-cyan-300">{t.insert} {drop.target.ticks!==undefined?`${drop.target.ticks/20160} ${c.beats}`:drop.target.index+1} · {containerLabel(drop.target.path)}</p>}{modal}{conflictModal}</>;
 return {startPointer:()=>{suppressClick.current=false;},consumeGestureClick:()=>{const suppressed=suppressClick.current;suppressClick.current=false;return suppressed;},add,nudge,resize,resizeDown,dragging:()=>!!drag.current?.active,draft,previewDraft,selection,focus,select,isSelected,extendSelection,clearSelection:()=>{setFocus(null);setSelection(null);cancelDrag();},guard,guardEdit,remove,run,openSave,discard,contextMenu:(f:StructureFocus,id:string,x:number,y:number)=>{if(!isSelected(f,id))select(f,id,false);setMenu({x,y});},focusContainer:(f:StructureFocus)=>{setFocus(f);setSelection(null);},toolbar,boundary,lostCapture:()=>{if(drag.current||resizing.current)cancelDrag();},pointerDown,pointerMove,pointerUp,cancelDrag,setFocus};
}
