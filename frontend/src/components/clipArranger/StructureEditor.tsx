import { structureDropLayout, structureInsertionAt, STRUCTURE_TREE_TOP, type StructureDropLayout } from '../../lib/clipArranger/structureHitTest';
import { sourceKeys } from '../../lib/clipArranger/migration';
import { structureCopy } from "./structureCopy";
import { newStructurePattern } from "./ContentEditor";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import type { GuiLanguage, SequencerState } from '../../types';
import { type ContainerTarget, type StructureNode, type StructureSelection, type StructureCommand, applyStructure, beginStructure, prepareStructure, stepStructure, structureChildren, structurePreview, type StructureDraft } from '../../lib/clipArranger/structure';
import type { ClipArrangement, LaneTiming, OccurrenceTarget } from '../../lib/clipArranger/model';
import { contentLength, resolveContent } from '../../lib/clipArranger/model';
import { useAppStore } from '../../store/useAppStore';
import { hasChangedClipDrafts } from '../../lib/clipArranger/draftResolution';
import { affectedDraftKeys, rebaseStructure, remapStructureCommand } from '../../lib/clipArranger/structuralDraftResolution';
import { SaveScopeDialog } from './SaveScopeDialog';
import { commitClipArrangement, saveClipDraft } from '../../store/clipActions';
import { PatternPreview } from './PatternPreview';
import { clipButton, clipInput } from './ClipArranger';
import { clipCopy } from './copy';

const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export type StructureFocus = { laneId:string;clipId:string;pass:number;parent:string[] };
export function useStructureEditor(model:ClipArrangement, sequencer:SequencerState, timings:LaneTiming, language:GuiLanguage, beforeSave:(()=>Promise<void>)|undefined, unit:number) {
 const draft=useStructureDraft(s=>s.draft), c=clipCopy(language), t=structureCopy(language);
 const [focus,setFocus]=useState<StructureFocus|null>(null),[selection,setSelection]=useState<StructureSelection|null>(null);
 const [picker,setPicker]=useState<ContainerTarget|null>(null),[query,setQuery]=useState(''),[saving,setSaving]=useState(false),[scope,setScope]=useState<'local'|'all'>('local');
 const [menu,setMenu]=useState<{x:number;y:number}|null>(null),[ghost,setGhost]=useState<{x:number;y:number;count:number}|null>(null);
 const [groupName,setGroupName]=useState('');
 const [error,setError]=useState<string|null>(null),[pending,setPending]=useState<((model?:ClipArrangement,draft?:StructureDraft)=>void)|null>(null);
 const [musical,setMusical]=useState<{key:string;resume:(before:ClipArrangement,after:ClipArrangement)=>void}|null>(null);
 const [musicalSaving,setMusicalSaving]=useState(false),[busy,setBusy]=useState(false);
 const musicalDialog=useRef<HTMLDialogElement>(null);
 const generation=useAppStore(s=>s.performanceWorkspaceGeneration);
 const suppressClick=useRef(false);
 const drag=useRef<{focus:StructureFocus;selection:StructureSelection;x:number;y:number;active:boolean;layout:StructureDropLayout;viewport:HTMLElement;lane:HTMLElement}|null>(null);
 const scrollFrame=useRef<number|null>(null);
 const [drop,setDrop]=useState<{focus:StructureFocus;target:ContainerTarget}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{setFocus(null);setSelection(null);setPicker(null);setSaving(false);setMusical(null);setMusicalSaving(false);setPending(null);},[generation]);
 useEffect(()=>{if(musical&&!musicalSaving)musicalDialog.current?.showModal?.();},[musical,musicalSaving]);
 useEffect(()=>{if(picker||saving||pending)dialog.current?.showModal?.();else dialog.current?.close?.();},[picker,saving,pending]);
 useEffect(()=>{setSelection(null);cancelDrag();},[model.revision]);
 const discard=()=>{useStructureDraft.setState({draft:null});setSelection(null);setSaving(false);};
 const guard=(action:(model?:ClipArrangement,draft?:StructureDraft)=>void)=>{if(draft?.cursor){setPending(()=>action);return;} useStructureDraft.setState({draft:null});action();};
 const guardEdit=(requested:OccurrenceTarget,action:(target:OccurrenceTarget)=>void)=>guard((saved,structural)=>{
  try {
   if(saved&&structural&&requested.laneId===structural.laneId&&requested.clipId===structural.clipId&&requested.pass===structural.pass){
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
     const next=useStructureDraft.getState().draft??rebaseStructure(base,after,timings);
     useStructureDraft.setState({draft:next});
     const mapped=remapStructureCommand({kind:'rest',target:{path:f.parent,index:0},ticks:1},base.roots,next.roots);
     if(mapped.kind==='rest')run(remapStructureCommand(command,base.roots,next.roots),{...f,laneId:next.laneId,clipId:next.clipId,pass:next.pass,parent:mapped.target.path});
    });return;
   }
   const next=applyStructure(base,command);useStructureDraft.setState({draft:next});setFocus(f);setError(null);setSelection(null);
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
 const select=(f:StructureFocus,id:string,shift:boolean)=>{
  if(suppressClick.current){suppressClick.current=false;return;}
  const action=()=>{try{const d=target(f),items=structureChildren(d.roots,f.parent);let ids=[id],anchor=id;
   if(shift&&focus&&equal(f,focus)&&selection){const a=items.findIndex(n=>n.id===selection.anchor),b=items.findIndex(n=>n.id===id);if(a>=0&&b>=0){ids=items.slice(Math.min(a,b),Math.max(a,b)+1).map(n=>n.id);anchor=selection.anchor;}}
   setFocus(f);setSelection({parent:f.parent,ids,anchor});setError(null);
  }catch(e){setError(String(e));}};
  if(draft&&(draft.laneId!==f.laneId||draft.clipId!==f.clipId||draft.pass!==f.pass))guard(action);else action();
 };
 const add=(f:StructureFocus,index:number)=>{const action=()=>{setFocus(f);setPicker({path:f.parent,index});setQuery('');};if(draft&&(draft.laneId!==f.laneId||draft.clipId!==f.clipId||draft.pass!==f.pass))guard(action);else action();};
 const cancelDrag=()=>{drag.current=null;suppressClick.current=false;setDrop(null);setGhost(null);setMenu(null);if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);scrollFrame.current=null;};
 useEffect(()=>()=>{if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancelDrag();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const pointerDown=(e:PointerEvent,f:StructureFocus,id:string)=>{if(e.button!==0)return;e.stopPropagation();
  if(!focus||!equal(focus,f)||!selection?.ids.includes(id))select(f,id,e.shiftKey);
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
  const element=document.elementFromPoint(x,y);
  const hit=element?.closest<HTMLElement>('[data-structure-target]');
  const box=element?.closest<HTMLElement>('[data-structure-node]');
  let candidate:{focus:StructureFocus;target:ContainerTarget}|null=hit?JSON.parse(hit.dataset.structureTarget!):null;
  if(!candidate&&box){const node=JSON.parse(box.dataset.structureNode!) as {focus:StructureFocus;index:number};const rect=box.getBoundingClientRect();candidate={focus:node.focus,target:{path:node.focus.parent,index:node.index+(x>rect.left+rect.width/2?1:0)}};}
  if(!candidate){
   const viewport=d.viewport.getBoundingClientRect(),lane=d.lane.getBoundingClientRect();
   const timeline=d.lane.querySelector<HTMLElement>('[data-clip-timeline]')?.getBoundingClientRect();
   if(timeline&&x>=viewport.left+192&&x<viewport.right&&y>=lane.top&&y<lane.bottom&&d.lane.dataset.expanded==='true'){
    const insertion=structureInsertionAt(d.layout,(x-timeline.left)/unit,y-lane.top-STRUCTURE_TREE_TOP);
    if(insertion)candidate={focus:{...d.focus,parent:insertion.path},target:insertion};
   }
  }
  if(!candidate||candidate.focus.laneId!==d.focus.laneId||candidate.focus.clipId!==d.focus.clipId||candidate.focus.pass!==d.focus.pass)return null;
  try { applyStructure(target(d.focus),{kind:'move',parent:d.selection.parent,ids:d.selection.ids,target:candidate.target});return candidate; } catch {return null;}
 };
 const pointerMove=(e:PointerEvent)=>{const d=drag.current;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<5&&!d.active)return;if(!d.active)d.viewport.setPointerCapture(e.pointerId);d.active=true;setGhost({x:e.clientX+12,y:e.clientY+12,count:d.selection.ids.length});
  const update=()=>{const candidate=hitTarget(e.clientX,e.clientY);setDrop(candidate);};update();
  if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);
  const viewport=d.viewport;
  const scroll=()=>{if(!drag.current||!viewport)return;const r=viewport.getBoundingClientRect();const direction=e.clientX<r.left+45?-1:e.clientX>r.right-45?1:0;if(!direction)return;viewport.scrollLeft+=direction*12;update();scrollFrame.current=requestAnimationFrame(scroll);};
  if(viewport)scrollFrame.current=requestAnimationFrame(scroll);
 };
 const pointerUp=(e:PointerEvent)=>{const d=drag.current;if(!d)return;e.stopPropagation();const candidate=d?.active?hitTarget(e.clientX,e.clientY):null;if(d?.active&&candidate)run({kind:'move',parent:d.selection.parent,ids:d.selection.ids,target:candidate.target},d.focus);cancelDrag();if(d?.active){suppressClick.current=true;setTimeout(()=>{suppressClick.current=false;},0);}};
 const remove=(f=focus,id?:string)=>{if(!f)return;const ids=selection&&equal(f,focus)&&(!id||selection.ids.includes(id))?selection.ids:id?[id]:[];if(ids.length)run({kind:'remove',parent:f.parent,ids},f);};
 const openSave=()=>{setScope('local');setSaving(true);setPicker(null);};
 const boundary=(f:StructureFocus,index:number,left:number,end=false)=>{const data={focus:f,target:{path:f.parent,index}};return <button key={`insert-${index}`} data-structure-target={JSON.stringify(data)} aria-label={`${t.add} ${index+1}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();add(f,index);}} className={`absolute top-0 z-20 h-5 w-3 rounded text-xs ${equal(drop,data)?'bg-cyan-300 text-slate-950':'bg-slate-900 text-cyan-300 opacity-30 hover:opacity-100 focus:opacity-100'}`} style={{left:end?left-22:left+(index===0?8:0)}}>+{equal(drop,data)&&<span className="pointer-events-none absolute left-0 top-0 h-24 border-l-2 border-cyan-200"/>}</button>;};
 const source=focus?model.lanes.find(l=>l.id===focus.laneId):undefined;
 const focusedLane=focus?.laneId,focusedClip=focus?.clipId,focusedPass=focus?.pass??0;
 const roots=useMemo(()=>draft?.roots??(focusedLane&&focusedClip&&model.lanes.find(l=>l.id===focusedLane)?.clips.some(c=>c.id===focusedClip)?beginStructure(model,focusedLane,focusedClip,focusedPass).roots:[]),[draft?.roots,model,focusedLane,focusedClip,focusedPass]);
 let items:StructureNode[]=[];try{items=structureChildren(roots,focus?.parent??[]);}catch{/* A save or external undo invalidated the selection. */}
 useEffect(()=>{
  setSelection(null);
  setFocus(current=>{
   if(!current||!draft||current.laneId!==draft.laneId||current.clipId!==draft.clipId||current.pass!==draft.pass)return current;
   const parent=[...current.parent];
   while(parent.length){try{structureChildren(draft.roots,parent);break;}catch{parent.pop();}}
   return equal(parent,current.parent)?current:{...current,parent};
  });
 },[draft?.roots]);
 const group=(level:'group'|'supergroup')=>{if(selection)run({kind:'group',parent:selection.parent,ids:selection.ids,level,name:groupName.trim()||`${c[level]} ${Date.now().toString().slice(-4)}`});};
 const moveBy=(direction:number)=>{if(!selection)return;const indexes=selection.ids.map(id=>items.findIndex(n=>n.id===id));run({kind:'move',parent:selection.parent,ids:selection.ids,target:{path:selection.parent,index:direction<0?Math.max(0,Math.min(...indexes)-1):Math.min(items.length,Math.max(...indexes)+2)}});};
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
   const retained={...useAppStore.getState().clipDrafts};for(const key of affected)delete retained[key];
   commitClipArrangement(result.model,'Edit clip structure');
   useAppStore.setState({clipDrafts:retained,clipEditingKey:state.clipEditingKey&&retained[state.clipEditingKey]?state.clipEditingKey:null});discard();setFocus(result.model.lanes.find(l=>l.id===draft.laneId)?.clips.some(c=>c.id===draft.clipId)?{laneId:draft.laneId,clipId:draft.clipId,pass:0,parent:[]}:null);setError(null);const next=pending;setPending(null);next?.(result.model,draft);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 };
 const conflictDraft=musical?useAppStore.getState().clipDrafts[musical.key]:undefined;
 const conflictLane=conflictDraft?model.lanes.find(l=>l.id===conflictDraft.target.laneId):undefined;
 const conflictModal=musical&&conflictDraft&&conflictLane?(musicalSaving?
  <SaveScopeDialog draft={conflictDraft} lane={conflictLane} language={language} timing={timings[conflictLane.id]} error={error} busy={busy} onCancel={()=>{setMusicalSaving(false);setError(null);}} onSave={(scope,name)=>void finishMusical(scope,name)}/>:
  <dialog ref={musicalDialog} aria-label={t.musicalConflict} onCancel={e=>{e.preventDefault();if(!busy)setMusical(null);}} className="max-w-lg space-y-4 rounded-xl border border-slate-600 bg-slate-900 p-5 text-slate-200 backdrop:bg-black/70">
   <h3>{t.musicalConflict}</h3><p>{t.resolveMusical}</p><p>{sequencer[sourceKeys[conflictLane.source]].find(track=>track.id===conflictLane.id)?.name??conflictLane.id} / {conflictLane.clips.find(c=>c.id===conflictDraft.target.clipId)?.name} / {conflictDraft.definition.name}</p>
   {error&&<p role="alert">{error}</p>}<div className="flex gap-2"><button disabled={busy} className={clipButton} onClick={()=>setMusicalSaving(true)}>{c.save}</button><button disabled={busy} className={clipButton} onClick={()=>void finishMusical('discard')}>{t.discard}</button><button disabled={busy} className={clipButton} onClick={()=>setMusical(null)}>{c.cancel}</button></div>
  </dialog>):null;
 let preview:ReturnType<typeof prepareStructure>|null=null,saveError='';if(saving&&draft)try{preview=prepareStructure(model,draft,scope,timings);}catch(e){saveError=String(e);}
 let allIssue='';if(saving&&draft)try{if(!prepareStructure(model,draft,'all',timings).shared)allIssue=t.root;}catch(e){allIssue=String(e);}
 const modal=<dialog ref={dialog} aria-label={saving?t.save:pending?t.unsaved:t.add} onCancel={e=>{e.preventDefault();if(busy)return;setSaving(false);setPicker(null);setPending(null);}} className="max-h-[80vh] w-[min(95vw,620px)] overflow-auto rounded-xl border border-slate-600 bg-slate-900 p-4 text-sm text-slate-200 backdrop:bg-black/60">
 {pending&&!saving?<><p>{t.resolve}</p><button className={clipButton} onClick={openSave}>{t.save}</button><button className={clipButton} onClick={()=>{const next=pending;discard();setPending(null);setFocus(null);next();}}>{t.discard}</button><button className={clipButton} onClick={()=>setPending(null)}>{c.cancel}</button></>:saving?<><h3>{t.save}</h3><label className="block"><input type="radio" checked={scope==='local'} onChange={()=>setScope('local')}/>{c.local}</label><label className="block"><input type="radio" disabled={!!allIssue} checked={scope==='all'} onChange={()=>setScope('all')}/>{c.all}</label>{allIssue&&<p>{allIssue}</p>}{preview&&draft&&<ul>{preview.model.lanes.find(l=>l.id===draft.laneId)?.definitions.filter(d=>JSON.stringify(d)!==JSON.stringify(draft.basis.definitions.find(old=>old.id===d.id))).map(d=><li key={d.id}>{d.name} · {c[d.kind]}</li>)}{draft.basis.clips.filter(old=>!preview.model.lanes.find(l=>l.id===draft.laneId)?.clips.some(cl=>cl.id===old.id)).map(old=><li key={old.id}>{c.remove}: {old.name}</li>)}</ul>}{preview&&draft&&preview.model.lanes.find(l=>l.id===draft.laneId)?.clips.map(cl=>{
 const old=draft.basis.clips.find(x=>x.id===cl.id),lane=preview!.model.lanes.find(l=>l.id===draft.laneId)!;
 const changed=!old||cl.length!==old.length||cl.start!==old.start||!equal(resolveContent(draft.basis,old.children,timings[lane.id]),resolveContent(lane,cl.children,timings[lane.id]));
 return changed?<p key={cl.id}>{cl.name} · {c.start}: {cl.start/20160} · {c.length}: {old?`${old.length/20160} → `:''}{cl.length/20160} {c.beats}</p>:null;
 })}{saveError&&<p role="alert">{saveError}</p>}<button disabled={busy||!preview||(scope==='all'&&!!allIssue)} className={clipButton} onClick={submit}>{c.save}</button><button disabled={busy} className={clipButton} onClick={()=>setSaving(false)}>{c.cancel}</button></>:picker&&source?<><input aria-label={t.search} placeholder={t.search} className={`${clipInput} !w-full`} value={query} onChange={e=>setQuery(e.target.value)}/>{source.definitions.filter(d=>{const parent=picker.path.length?structureChildren(roots,picker.path.slice(0,-1)).find(n=>n.id===picker.path[picker.path.length-1]):null;return !parent||d.kind==='pattern'||parent.definition?.kind==='supergroup'&&d.kind==='group';}).filter(d=>d.name.toLowerCase().includes(query.toLowerCase())).map(d=><div key={d.id} className="my-2 rounded border border-slate-700 p-2"><span>{d.name} · {c[d.kind]} · {contentLength(source,[{id:'preview',definitionId:d.id}],timings[source.id])/20160} {c.beats}</span>{d.kind==='pattern'&&<PatternPreview definition={d} timing={timings[source.id]} controllerMode={sequencer.controllerSequencers.find(t=>t.id===source.id)?.controllerMode}/>}<button className={clipButton} onClick={()=>{run({kind:'insert',target:picker,definition:d,variation:false});setPicker(null);}}>{c.addContent}</button><button className={clipButton} onClick={()=>{run({kind:'insert',target:picker,definition:d,variation:true});setPicker(null);}}>{c.copy}</button></div>)}<button className={clipButton} onClick={()=>{run({kind:'insert',target:picker,definition:newStructurePattern(source,sequencer,language),variation:false});setPicker(null);}}>{c.newPattern}</button><button className={clipButton} onClick={()=>{run({kind:'rest',target:picker,ticks:20160});setPicker(null);}}>{c.rest} +1</button><button className={clipButton} onClick={()=>setPicker(null)}>{c.cancel}</button></>:null}</dialog>;
 const toolbar=<>{ghost&&<div className="pointer-events-none fixed z-50 rounded border border-cyan-300 bg-slate-900 px-3 py-2 text-xs text-cyan-100" style={{left:ghost.x,top:ghost.y}}>{ghost.count} · {c.content}</div>}{menu&&<div role="menu" className="fixed z-50 flex gap-2 rounded border border-slate-500 bg-slate-900 p-2" style={{left:menu.x,top:menu.y}}><button role="menuitem" className={clipButton} disabled={!selection} onClick={()=>remove()}>{t.remove}</button><button role="menuitem" className={clipButton} onClick={()=>group('group')}>{c.group}</button><button role="menuitem" className={clipButton} onClick={()=>group('supergroup')}>{c.supergroup}</button><button role="menuitem" className={clipButton} onClick={()=>selection&&run({kind:'ungroup',parent:selection.parent,ids:selection.ids})}>{c.ungroup}</button><button role="menuitem" className={clipButton} onClick={()=>{setMenu(null);if(focus)add(focus,items.length);}}>{c.addContent}</button></div>}<div className="my-2 flex flex-wrap items-center gap-2 text-xs text-slate-200">{focus&&<><input aria-label={c.name} placeholder={c.name} value={groupName} onChange={e=>setGroupName(e.target.value)} className={clipInput}/><button className={clipButton} onClick={()=>add(focus,items.length)}>{t.add}</button><button disabled={!selection} className={clipButton} onClick={()=>remove()}>{t.remove}</button><button disabled={!selection} className={clipButton} onClick={()=>group('group')}>{c.group}</button><button disabled={!selection} className={clipButton} onClick={()=>group('supergroup')}>{c.supergroup}</button><button disabled={!selection} className={clipButton} onClick={()=>selection&&run({kind:'ungroup',parent:selection.parent,ids:selection.ids})}>{c.ungroup}</button><button disabled={!selection} className={clipButton} onClick={()=>moveBy(-1)}>←</button><button disabled={!selection} className={clipButton} onClick={()=>moveBy(1)}>→</button><select aria-label={t.move} className={clipInput} value="" onChange={e=>{const dest=destinations[Number(e.target.value)];if(selection)run({kind:'move',parent:selection.parent,ids:selection.ids,target:{path:dest.path,index:dest.length}});}}><option value="">{t.move}</option>{destinations.map((d,i)=><option key={i} value={i}>{d.label}</option>)}</select></>}{draft&&<><span className="text-amber-300">{c.unsaved}</span><button className={clipButton} disabled={!draft.cursor} onClick={()=>useStructureDraft.setState({draft:stepStructure(draft,-1)})}>{c.undo}</button><button className={clipButton} disabled={draft.cursor===draft.history.length-1} onClick={()=>useStructureDraft.setState({draft:stepStructure(draft,1)})}>{c.redo}</button><button className={clipButton} disabled={!draft.cursor} onClick={openSave}>{t.save}</button><button className={clipButton} onClick={discard}>{t.discard}</button></>}</div>{error&&<p role="alert" className="text-rose-300">{error}</p>}{drop&&<p className="text-cyan-300">{t.insert} {drop.target.index+1} · {containerLabel(drop.target.path)}</p>}{modal}{conflictModal}</>;
 return {draft,selection,focus,select,guard,guardEdit,remove,run,openSave,discard,contextMenu:(f:StructureFocus,id:string,x:number,y:number)=>{if(!selection?.ids.includes(id)||!equal(focus,f))select(f,id,false);setMenu({x,y});},focusContainer:(f:StructureFocus)=>{setFocus(f);setSelection(null);},toolbar,boundary,lostCapture:()=>{if(drag.current)cancelDrag();},pointerDown,pointerMove,pointerUp,cancelDrag,setFocus};
}
