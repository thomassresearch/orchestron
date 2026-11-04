import { useStructureEditor } from './StructureEditor';
import { clipHistoryStep } from "../../store/clipActions";
import fixture from "../../../../backend/tests/fixtures/performances/device_names.json";
import { sourceKeys } from "../../lib/clipArranger/migration";
import type { SourceKind } from "../../lib/clipArranger/model";
// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,renderHook,screen,within,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import { ClipPerformance } from './ClipPerformance';
import { migrateClipArrangement } from '../../lib/clipArranger/migration';
beforeEach(()=>{
 useAppStore.setState(useAppStore.getInitialState(),true);useStructureDraft.setState({draft:null});
 const s=structuredClone(useAppStore.getState().sequencer);const t=s.tracks[0];
 t.padLoopEnabled=true;t.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:'pad',padIndex:0},{type:'pad',padIndex:1}]};
 s.clipArrangement=migrateClipArrangement(s).model!;const l=s.clipArrangement.lanes[0];l.cycleTicks=null;l.clips[0].mode='once';
 useAppStore.setState({sequencer:s});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(([{source:'sequencer'},{source:'score'},{source:'drummer'},{source:'controller',mode:'step'},{source:'controller',mode:'curve'},{source:'arpeggiator'}] as {source:SourceKind;mode?:'step'|'curve'}[]).flatMap(editor=>(['local','all'] as const).map(scope=>({...editor,scope}))))('groups and reorders $source $mode with $scope save/reload',async ({source,mode,scope})=>{
 useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
 const state=structuredClone(useAppStore.getState().sequencer);
 for(const key of Object.values(sourceKeys))for(const device of state[key]){device.padLoopEnabled=true;device.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:"pad",padIndex:0}]};if("playbackMode" in device)device.playbackMode="arranger";}
 const track=state[sourceKeys[source]][0];track.padLoopEnabled=true;track.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:'pad',padIndex:0},{type:'pad',padIndex:1}]};
 if(mode)state.controllerSequencers[0].controllerMode=mode;
 state.clipArrangement=migrateClipArrangement(state).model!;
 const selected=state.clipArrangement.lanes.find(l=>l.source===source)!;selected.cycleTicks=null;selected.clips[0].mode='once';
 useAppStore.setState({sequencer:state});
 const before=useAppStore.getState().sequencer;const lane=before.clipArrangement!.lanes.find(l=>l.source===source)!;
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(within(document.querySelector(`[data-clip-lane="${lane.id}"]`) as HTMLElement).getByRole('button',{expanded:false}));
 const buttons=screen.getAllByRole('button').filter(b=>b.title.startsWith('pattern:'));
 expect(buttons).toHaveLength(2);
 fireEvent.click(buttons[0]);fireEvent.click(buttons[1],{shiftKey:true});
 fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Phrase'}});
 fireEvent.click(screen.getByRole('button',{name:'Group'}));
 expect(useAppStore.getState().sequencer).toBe(before);
 expect(useStructureDraft.getState().draft?.roots[0].definition?.name).toBe('Phrase');
 fireEvent.click(screen.getByRole('button',{name:'Save structure'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'Save structure'})).getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
 expect(useAppStore.getState().sequencer.clipArrangement!.lanes.find(l=>l.id===lane.id)!.clips[0].children).toHaveLength(1);
 const reordered=screen.getAllByRole('button').filter(b=>b.title.startsWith('pattern:'));
 fireEvent.click(reordered[1]);fireEvent.click(screen.getByRole('button',{name:'←'}));
 fireEvent.click(screen.getByRole('button',{name:'Save structure'}));
 const dialog=within(screen.getByRole('dialog',{name:'Save structure'}));
 fireEvent.click(dialog.getByRole('radio',{name:scope==='all'?'All linked occurrences':'Only this occurrence'}));
 fireEvent.click(dialog.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
 const saved=structuredClone(useAppStore.getState().sequencer.clipArrangement);
 const snapshot=JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()));
 act(()=>useAppStore.getState().applySequencerConfigSnapshot(snapshot));
 expect(useAppStore.getState().sequencer.clipArrangement).toEqual(saved);
 act(()=>{clipHistoryStep(false);clipHistoryStep(false);});expect(useAppStore.getState().sequencer.clipArrangement!.lanes.find(l=>l.id===lane.id)!.clips[0].children).toHaveLength(2);
 act(()=>{clipHistoryStep(true);clipHistoryStep(true);});expect(useAppStore.getState().sequencer.clipArrangement).toEqual(saved);
});

it.each([0,1,2].flatMap(depth=>(depth?['local','all']:['local']).map(scope=>({depth,scope}))))('removes content at depth $depth with $scope save after reload',async({depth,scope})=>{
 const s=structuredClone(useAppStore.getState().sequencer),lane=s.clipArrangement!.lanes[0],clip=lane.clips[0];
 if(depth){lane.definitions.push({id:'remove-container',kind:depth===1?'group':'supergroup',name:'Remove container',revision:0,children:clip.children});clip.children=[{id:'container-use',definitionId:'remove-container'}];}
 lane.clips.push({...structuredClone(clip),id:'linked-copy',start:clip.length,children:clip.children.map(i=>({...i,id:'copy-'+i.id}))});s.clipArrangement!.end=clip.length*2;
 useAppStore.setState({sequencer:s});
 act(()=>useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()))));
 const original=useAppStore.getState().sequencer;
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(within(document.querySelector(`[data-clip-lane="${lane.id}"]`) as HTMLElement).getByRole('button',{expanded:false}));
 const buttons=screen.getAllByRole('button').filter(b=>b.title.startsWith('pattern:'));
 fireEvent.click(buttons[0]);fireEvent.click(screen.getByRole('button',{name:'Remove selected'}));
 expect(useAppStore.getState().sequencer).toBe(original);
 fireEvent.click(screen.getByRole('button',{name:'Save structure'}));
 const dialog=within(screen.getByRole('dialog',{name:'Save structure'}));
 if(scope==='all')fireEvent.click(dialog.getByRole('radio',{name:'All linked occurrences'}));
 fireEvent.click(dialog.getByRole('button',{name:'Save'}));await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
 const snapshot=JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()));
 act(()=>useAppStore.getState().applySequencerConfigSnapshot(snapshot));
 const saved=useAppStore.getState().sequencer.clipArrangement!.lanes[0];
 const count=(index:number)=>{const items=saved.clips[index].children;if(!depth)return items.length;const ref=items[0];const d=saved.definitions.find(d=>'definitionId' in ref&&d.id===ref.definitionId)!;return d.kind==='pattern'?0:d.children.length;};
 expect(count(0)).toBe(1);expect(count(1)).toBe(scope==='all'?1:2);expect(saved.clips.map(c=>c.length)).toEqual([clip.length,clip.length]);
});

it('removes the last item without closing surrounding time and retains undo',async()=>{
 const s=structuredClone(useAppStore.getState().sequencer),clip=s.clipArrangement!.lanes[0].clips[0];clip.children=clip.children.slice(0,1);
 useAppStore.setState({sequencer:s});render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 const item=screen.getAllByRole('button').find(b=>b.title.startsWith('pattern:'))!;
 fireEvent.click(item);fireEvent.keyDown(item,{key:'Delete'});
 fireEvent.click(screen.getByRole('button',{name:'Save structure'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Save structure'})).getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
 expect(useAppStore.getState().sequencer.clipArrangement!.lanes[0].clips).toEqual([]);
 expect(useAppStore.getState().sequencer.clipArrangement!.end).toBe(s.clipArrangement!.end);
 act(()=>clipHistoryStep(false));expect(useAppStore.getState().sequencer.clipArrangement!.lanes[0].clips).toHaveLength(1);
});

it.each(['local','all'] as const)('moves between linked groups with pointer input and %s save across reloads',async scope=>{
 const s=structuredClone(useAppStore.getState().sequencer),l=s.clipArrangement!.lanes[0],clip=l.clips[0];
 const [a,b]=clip.children;
 l.definitions.push({id:'left',kind:'group',name:'Left',revision:0,children:[{...a,id:'la'},{...b,id:'lb'}]},{id:'right',kind:'group',name:'Right',revision:0,children:[{...a,id:'ra'}]});
 clip.children=[{id:'left-use',definitionId:'left'},{id:'right-use',definitionId:'right'}];clip.length=20160*12;
 l.clips.push({...structuredClone(clip),id:'second',start:20160*16,children:[{id:'left-copy',definitionId:'left'},{id:'right-copy',definitionId:'right'}]});s.clipArrangement!.end=20160*28;
 useAppStore.setState({sequencer:s});
 act(()=>useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()))));
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 vi.stubGlobal('PointerEvent',MouseEvent);HTMLElement.prototype.setPointerCapture=vi.fn();
 const nodes=Array.from(document.querySelectorAll<HTMLElement>('[data-structure-node]'));
 const source=nodes.find(n=>{const d=JSON.parse(n.dataset.structureNode!);return d.focus.parent.join()==='left-use'&&d.index===1;})!.querySelector('button[data-structure-key]')!;
 const dest=Array.from(document.querySelectorAll<HTMLElement>('[data-structure-target]')).find(n=>{const d=JSON.parse(n.dataset.structureTarget!);return d.focus.parent.join()==='right-use'&&d.target.index===1;})!;
 Object.defineProperty(document,'elementFromPoint',{value:vi.fn(()=>dest),configurable:true});
 fireEvent.pointerDown(source,{button:0,clientX:0,clientY:0});fireEvent.pointerMove(source,{clientX:100,clientY:10});fireEvent.pointerUp(source,{clientX:100,clientY:10});
 expect(useStructureDraft.getState().draft?.roots.map(n=>n.children!.length)).toEqual([1,2]);
 fireEvent.click(screen.getByRole('button',{name:'Save structure'}));const dialog=within(screen.getByRole('dialog',{name:'Save structure'}));
 fireEvent.click(dialog.getByRole('radio',{name:scope==='all'?'All linked occurrences':'Only this occurrence'}));fireEvent.click(dialog.getByRole('button',{name:'Save'}));await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
 act(()=>useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()))));
 const saved=useAppStore.getState().sequencer.clipArrangement!.lanes[0];
 const counts=(index:number)=>saved.clips[index].children.map(i=>{const d=saved.definitions.find(d=>'definitionId' in i&&d.id===i.definitionId)!;return d.kind==='pattern'?0:d.children.length;});
 expect(counts(0)).toEqual([1,2]);expect(counts(1)).toEqual(scope==='all'?[1,2]:[2,1]);
});


it('keeps dragging after scrolling unmounts the source and resolves a model-based destination',()=>{
 const s=structuredClone(useAppStore.getState().sequencer),lane=s.clipArrangement!.lanes[0],clip=lane.clips[0];
 const first=clip.children[0];clip.children=Array.from({length:40},(_,i)=>({...first,id:`item-${i}`}));clip.length=20160*160;s.clipArrangement!.end=clip.length;
 useAppStore.setState({sequencer:s});render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 vi.stubGlobal('PointerEvent',MouseEvent);HTMLElement.prototype.setPointerCapture=vi.fn();
 const viewport=document.querySelector<HTMLElement>('[data-arranger-viewport]')!;
 const laneNode=document.querySelector<HTMLElement>('[data-clip-lane]')!;
 const timeline=laneNode.querySelector<HTMLElement>('[data-clip-timeline]')!;
 vi.spyOn(viewport,'getBoundingClientRect').mockReturnValue({left:0,right:1000,top:0,bottom:200,width:1000,height:200} as DOMRect);
 vi.spyOn(laneNode,'getBoundingClientRect').mockReturnValue({left:0,right:6592,top:0,bottom:152,width:6592,height:152} as DOMRect);
 vi.spyOn(timeline,'getBoundingClientRect').mockImplementation(()=>({left:192-viewport.scrollLeft,right:6592-viewport.scrollLeft,top:0,bottom:152,width:6400,height:152} as DOMRect));
 Object.defineProperty(document,'elementFromPoint',{value:vi.fn(()=>viewport),configurable:true});
 const source=document.querySelector<HTMLElement>('[data-structure-key]')!;
 fireEvent.pointerDown(source,{button:0,clientX:210,clientY:45});
 fireEvent.pointerMove(viewport,{clientX:400,clientY:45});
 expect(viewport.setPointerCapture).toHaveBeenCalled();
 fireEvent.scroll(viewport,{target:{scrollLeft:4000}});
 expect(source.isConnected).toBe(false);
 fireEvent.pointerMove(viewport,{clientX:800,clientY:45});fireEvent.pointerUp(viewport,{clientX:800,clientY:45});
 expect(useStructureDraft.getState().draft?.roots[28].id).toBe('item-0');
 expect(useAppStore.getState().sequencer).toBe(s);
});


it.each(['pattern', 'group', 'supergroup'] as const)('selects adjacent %s boxes through full pointer clicks', kind => {
 const state = structuredClone(useAppStore.getState().sequencer);
 const lane = state.clipArrangement!.lanes[0], clip = lane.clips[0];
 if (kind !== 'pattern') {
  const children = clip.children;
  lane.definitions.push({id:'selection-container',kind,name:'Selection container',revision:0,children});
  clip.children = [{id:'selection-first',definitionId:'selection-container'}, {id:'selection-second',definitionId:'selection-container'}];
  clip.length *= 2; state.clipArrangement!.end = clip.length;
 }
 useAppStore.setState({sequencer:state});
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 vi.stubGlobal('PointerEvent',MouseEvent); HTMLElement.prototype.setPointerCapture=vi.fn();
 const buttons = screen.getAllByRole('button').filter(b=>b.title.startsWith(`${kind}:`));
 const click = (button: HTMLElement, shiftKey=false) => {
  fireEvent.pointerDown(button,{button:0,shiftKey});
  fireEvent.pointerUp(button,{button:0,shiftKey});
  fireEvent.click(button,{shiftKey});
 };
 click(buttons[0]); click(buttons[1],true);
 const selected = () => buttons.filter(b=>(b.closest('[data-structure-node]') as HTMLElement).style.outline);
 expect(selected()).toHaveLength(2);
 click(buttons[0]); expect(selected()).toHaveLength(1);
});


it.each(['forward','backward','keyboard'] as const)('groups across repetitions using %s selection and saves one clip', async gesture => {
 const state = structuredClone(useAppStore.getState().sequencer);
 const clip = state.clipArrangement!.lanes[0].clips[0];
 clip.children = clip.children.slice(0,1); clip.mode = 'loop'; clip.length=20160*16;state.clipArrangement!.end=clip.length;
 useAppStore.setState({sequencer:state});
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 vi.stubGlobal('PointerEvent',MouseEvent); HTMLElement.prototype.setPointerCapture=vi.fn();
 const buttons = screen.getAllByRole('button').filter(b=>b.title.startsWith('pattern:'));
 expect(buttons).toHaveLength(4);
 const click = (button:HTMLElement, shiftKey=false) => {
  fireEvent.pointerDown(button,{button:0,shiftKey}); fireEvent.pointerUp(button,{button:0,shiftKey}); fireEvent.click(button,{shiftKey});
 };
 if(gesture==='backward'){click(buttons[2]);click(buttons[1],true);}else {click(buttons[1]);if(gesture==='keyboard')fireEvent.keyDown(buttons[1],{key:'ArrowRight',shiftKey:true});else click(buttons[2],true);}
 expect(buttons.map(b=>!!(b.closest('[data-structure-node]') as HTMLElement).style.outline)).toEqual([false,true,true,false]);
 expect(screen.getByRole('button',{name:'Remove selected'}).hasAttribute('disabled')).toBe(true);
 expect(useAppStore.getState().sequencer).toBe(state);expect(useStructureDraft.getState().draft).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Middle'}});
 fireEvent.click(screen.getByRole('button',{name:'Group'}));
 expect(useStructureDraft.getState().draft?.roots).toHaveLength(3);
 expect(screen.getByRole('button',{name:'▣ Middle'})).toBeTruthy();
 expect(useAppStore.getState().sequencer).toBe(state);
 fireEvent.click(screen.getByRole('button',{name:'Save structure'}));
 const dialog=within(screen.getByRole('dialog',{name:'Save structure'}));
 expect(dialog.queryByRole('radio',{name:'All linked occurrences'})).toBeNull();
 fireEvent.click(dialog.getByRole('button',{name:'Save'}));await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
 const saved=structuredClone(useAppStore.getState().sequencer.clipArrangement!);
 expect(saved.lanes[0].clips).toHaveLength(1);expect(saved.lanes[0].clips[0]).toMatchObject({id:clip.id,start:0,length:clip.length,mode:'once'});
 const snapshot=useAppStore.getState().buildSequencerConfigSnapshot();expect(snapshot.version).toBe(26);
 act(()=>useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot))));
 expect(useAppStore.getState().sequencer.clipArrangement).toEqual(saved);
 act(()=>clipHistoryStep(false));expect(useAppStore.getState().sequencer.clipArrangement!.lanes[0].clips[0]).toEqual(clip);
 act(()=>clipHistoryStep(true));expect(useAppStore.getState().sequencer.clipArrangement).toEqual(saved);
});

it.each(['pattern','group'] as const)('uses the context menu for %s ranges and contracts a keyboard selection',async kind=>{
 const state=structuredClone(useAppStore.getState().sequencer),lane=state.clipArrangement!.lanes[0],clip=lane.clips[0];
 clip.children=clip.children.slice(0,1);clip.mode='loop';clip.length=20160*16;state.clipArrangement!.end=clip.length;
 if(kind==='group'){lane.definitions.push({id:'repeated-group',kind:'group',name:'Repeated',revision:0,children:clip.children});clip.children=[{id:'group-use',definitionId:'repeated-group'}];}
 useAppStore.setState({sequencer:state});render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 const boxes=()=>screen.getAllByRole('button').filter(b=>b.title.startsWith(`${kind}:`));const buttons=boxes();
 fireEvent.click(buttons[1]);fireEvent.keyDown(buttons[1],{key:'ArrowRight',shiftKey:true});fireEvent.keyDown(buttons[2],{key:'ArrowRight',shiftKey:true});fireEvent.keyDown(buttons[3],{key:'ArrowLeft',shiftKey:true});
 expect(boxes().map(b=>!!(b.closest('[data-structure-node]') as HTMLElement).style.outline)).toEqual([false,true,true,false]);
 fireEvent.contextMenu(buttons[2]);fireEvent.click(screen.getByRole('menuitem',{name:kind==='group'?'Supergroup':'Group'}));
 const draft=useStructureDraft.getState().draft!;expect(draft.roots).toHaveLength(3);expect(draft.roots[1].definition?.kind).toBe(kind==='group'?'supergroup':'group');
 expect(screen.getByRole('button',{name:'Remove selected'}).hasAttribute('disabled')).toBe(false);
});
it('retains an oversized range and authored state when grouping exceeds capacity',()=>{
 const state=structuredClone(useAppStore.getState().sequencer),clip=state.clipArrangement!.lanes[0].clips[0];
 clip.children=clip.children.slice(0,1);clip.mode='loop';clip.length=20160*4*300;state.clipArrangement!.end=clip.length;
 useAppStore.setState({sequencer:state});render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 const buttons=screen.getAllByRole('button').filter(b=>b.title.startsWith('pattern:'));
 fireEvent.click(buttons[1]);fireEvent.click(buttons[2],{shiftKey:true});fireEvent.click(screen.getByRole('button',{name:'Group'}));
 expect(screen.getByRole('alert').textContent).toContain('content limit');
 expect(buttons.slice(1,3).every(b=>(b.closest('[data-structure-node]') as HTMLElement).style.outline)).toBe(true);
 expect(useStructureDraft.getState().draft).toBeNull();expect(useAppStore.getState().sequencer).toBe(state);
});
it.each(['discard','save'])('resolves a dirty single-pass structure and revalidates after %s',async choice=>{
 const state=structuredClone(useAppStore.getState().sequencer),clip=state.clipArrangement!.lanes[0].clips[0];
 clip.children=clip.children.slice(0,1);clip.mode='loop';clip.length=20160*16;state.clipArrangement!.end=clip.length;
 useAppStore.setState({sequencer:state});render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 fireEvent.click(screen.getByRole('button',{expanded:false,name:/▸/}));
 const buttons=()=>screen.getAllByRole('button').filter(b=>b.title.startsWith('pattern:'));
 fireEvent.click(buttons()[1]);fireEvent.click(screen.getByRole('button',{name:'Add content'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'Rest +1'}));
 const draft=useStructureDraft.getState().draft;fireEvent.click(buttons()[1]);fireEvent.click(buttons()[2],{shiftKey:true});
 fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved structure'})).getByRole('button',{name:'Cancel'}));
 expect(useStructureDraft.getState().draft).toBe(draft);
 fireEvent.click(buttons()[2],{shiftKey:true});
 if(choice==='save'){
  fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved structure'})).getByRole('button',{name:'Save structure'}));
  fireEvent.click(within(screen.getByRole('dialog',{name:'Save structure'})).getByRole('button',{name:'Save'}));
  await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
  expect(screen.getByRole('alert').textContent).toContain('Select the range again');
  expect(useAppStore.getState().sequencer.clipArrangement!.lanes[0].clips).toHaveLength(3);
  expect(screen.getByRole('button',{name:'Group'}).hasAttribute('disabled')).toBe(true);
  return;
 }
 fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved structure'})).getByRole('button',{name:'Discard'}));
 expect(useStructureDraft.getState().draft).toBeNull();expect(useAppStore.getState().sequencer).toBe(state);
 // The original occurrence IDs survive discard; grouping now uses that original range.
 fireEvent.click(screen.getByRole('button',{name:'Group'}));expect(useStructureDraft.getState().draft?.roots).toHaveLength(3);
});


it('extends and contracts across unmounted repetitions without changing authored state',()=>{
 const state=structuredClone(useAppStore.getState().sequencer),model=state.clipArrangement!,lane=model.lanes[0],clip=lane.clips[0];
 clip.children=clip.children.slice(0,1);clip.mode='loop';clip.length=20160*4*80;model.end=clip.length;
 useAppStore.setState({sequencer:state});
 const {result}=renderHook(()=>useStructureEditor(model,state,{},'english',undefined,40/20160));
 const at=(pass:number)=>({laneId:lane.id,clipId:clip.id,pass,parent:[]});
 act(()=>result.current.select(at(0),clip.children[0].id,false));
 for(let pass=0;pass<60;pass++)act(()=>{result.current.extendSelection(at(pass),clip.children[0].id,1);});
 expect(result.current.selection?.range).toEqual({first:0,last:60});
 expect(result.current.isSelected(at(45),clip.children[0].id)).toBe(true);
 act(()=>{result.current.extendSelection(at(60),clip.children[0].id,-1);});
 expect(result.current.selection?.range).toEqual({first:0,last:59});
 expect(useAppStore.getState().sequencer).toBe(state);expect(useStructureDraft.getState().draft).toBeNull();
});
