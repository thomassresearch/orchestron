// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import { migrateClipArrangement } from '../../lib/clipArranger/migration';
import { QUARTER_TICKS as Q } from '../../lib/clipArranger/model';
import { clipHistoryStep, openClipEditor } from '../../store/clipActions';
import { ClipPerformance } from './ClipPerformance';

beforeEach(()=>{
  useAppStore.setState(useAppStore.getInitialState(),true);useStructureDraft.setState({draft:null});
  const sequencer=structuredClone(useAppStore.getState().sequencer),track=sequencer.tracks[0];
  track.padLoopEnabled=true;track.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:'pad',padIndex:0}]};
  sequencer.clipArrangement=migrateClipArrangement(sequencer).model!;
  const lane=sequencer.clipArrangement.lanes[0],clip=lane.clips[0];lane.cycleTicks=null;clip.mode='once';clip.length=12*Q;clip.children.push({id:'tail',restTicks:8*Q});sequencer.clipArrangement.end=clip.length;
  useAppStore.setState({sequencer});
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const lane=()=>useAppStore.getState().sequencer.clipArrangement!.lanes[0];
const patterns=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-structure-key]')).filter(b=>b.title.startsWith('pattern:'));
function show(expand=true){render(<ClipPerformance language="english" renderEditor={()=>null}/>);const toggle=screen.queryByRole('button',{expanded:false,name:/▸/});if(expand&&toggle)fireEvent.click(toggle);}
function context(item:HTMLElement){fireEvent.contextMenu(item,{clientX:200,clientY:100});return within(screen.getByRole('menu'));}
async function save(){fireEvent.click(screen.getByRole('button',{name:'Save structure'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Save structure'})).getByRole('button',{name:'Save'}));await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());}

it('hides Ungroup for a pattern and duplicates a linked occurrence through save/reload and undo',async()=>{
  show();const original=structuredClone(lane());
  const menu=context(patterns()[0]);expect(menu.queryByRole('menuitem',{name:'Ungroup'})).toBeNull();expect(screen.queryByRole('button',{name:'Ungroup'})).toBeNull();
  fireEvent.click(menu.getByRole('menuitem',{name:'Duplicate'}));expect(lane()).toEqual(original);
  expect(patterns()).toHaveLength(2);await save();
  const saved=structuredClone(lane());expect(saved.definitions).toEqual(original.definitions);expect(saved.clips[0].length).toBe(12*Q);
  act(()=>useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()))));expect(lane()).toEqual(saved);
  act(()=>clipHistoryStep(false));expect(lane()).toEqual(original);act(()=>clipHistoryStep(true));expect(lane()).toEqual(saved);
});

it.each(['group','supergroup'] as const)('offers Ungroup and Duplicate for a %s and hides Ungroup for a mixed selection',kind=>{
  const l=lane(),clip=l.clips[0],pattern=clip.children[0];l.definitions.push({id:'container',name:'Container',kind,revision:0,children:[{...pattern,id:'child'}]});clip.children=[{id:'container-use',definitionId:'container'},pattern,{id:'tail',restTicks:4*Q}];
  show();const container=screen.getByTitle(`${kind}: Container`);expect(context(container).getByRole('menuitem',{name:'Ungroup'})).toBeTruthy();
  fireEvent.click(container);fireEvent.click(patterns()[1],{shiftKey:true});expect(context(container).queryByRole('menuitem',{name:'Ungroup'})).toBeNull();
  expect((screen.getByRole('menuitem',{name:'Duplicate'}) as HTMLButtonElement).disabled).toBe(false);
});

it('disables duplication for rests and cross-repetition selections',()=>{
  const clip=lane().clips[0];clip.mode='loop';clip.length=24*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();const rest=screen.getAllByTitle('Rest')[0];expect((context(rest).getByRole('menuitem',{name:'Duplicate'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(patterns()[0]);fireEvent.click(patterns()[1],{shiftKey:true});const menu=context(patterns()[1]);expect((menu.getByRole('menuitem',{name:'Duplicate'}) as HTMLButtonElement).disabled).toBe(true);expect(menu.queryByRole('menuitem',{name:'Ungroup'})).toBeNull();
});

it('appends once after the final loop repetition and saves as one clip',async()=>{
  const clip=lane().clips[0];clip.children.pop();clip.mode='loop';clip.length=16*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();fireEvent.click(context(patterns()[1]).getByRole('menuitem',{name:'Duplicate'}));expect(patterns()).toHaveLength(5);await save();
  expect(lane().clips).toHaveLength(1);expect(lane().clips[0]).toMatchObject({mode:'once',length:20*Q});
});

it.each(['cancel','discard'] as const)('resolves a dirty musical draft before duplication: %s',async choice=>{
  const l=lane(),clip=l.clips[0];openClipEditor({laneId:l.id,clipId:clip.id,pass:0,path:[clip.children[0].id]});
  const state=useAppStore.getState(),key=state.clipEditingKey!;useAppStore.setState({clipDrafts:{...state.clipDrafts,[key]:{...state.clipDrafts[key],definition:{...state.clipDrafts[key].definition,name:'Unsaved'}}}});
  show();fireEvent.click(context(patterns()[0]).getByRole('menuitem',{name:'Duplicate'}));
  fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved musical draft'})).getByRole('button',{name:choice==='cancel'?'Cancel':'Discard'}));
  if(choice==='cancel'){expect(useStructureDraft.getState().draft).toBeNull();expect(useAppStore.getState().clipDrafts[key]).toBeTruthy();}
  else await waitFor(()=>expect(useStructureDraft.getState().draft?.roots.filter(n=>n.definition)).toHaveLength(2));
});

it.each([false,true])('opens Add content at the snapped position with expanded=%s',expanded=>{
  show(expanded);
  const timeline=document.querySelector('[data-clip-timeline]')!,row=document.querySelector('[data-clip-lane]')!,body=document.querySelector('[data-clip-content]')!;
  vi.spyOn(timeline,'getBoundingClientRect').mockReturnValue({left:-300} as DOMRect);vi.spyOn(row,'getBoundingClientRect').mockReturnValue({top:20} as DOMRect);
  fireEvent.change(screen.getByRole('slider',{name:'Zoom'}),{target:{value:'60'}});
  const clip = lane().clips[0];
  const pixelsPerBeat = parseFloat((body.parentElement as HTMLElement).style.width) / (clip.length / Q);
  fireEvent.doubleClick(body,{clientX:-300+5.3*pixelsPerBeat,clientY:80});
  const dialog=within(screen.getByRole('dialog',{name:'Add content'}));fireEvent.click(dialog.getByRole('button',{name:'New pattern'}));
  expect(useStructureDraft.getState().draft?.roots.map(n=>n.restTicks??n.definition?.kind)).toEqual(['pattern',1.25*Q,'pattern',2.75*Q]);
});

it('double-clicks an empty clip at an offset and cancellation leaves authored state unchanged',()=>{
  const clip=lane().clips[0];clip.children=[{id:'silence',restTicks:12*Q}];clip.offset=2*Q;clip.length=8*Q;
  show(false);const before=structuredClone(lane()),body=document.querySelector('[data-clip-content]')!;
  fireEvent.doubleClick(body,{clientX:80,clientY:30});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'Cancel'}));
  expect(lane()).toEqual(before);expect(useStructureDraft.getState().draft).toBeNull();
  fireEvent.doubleClick(body,{clientX:80,clientY:30});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));expect(useStructureDraft.getState().draft?.roots[0].restTicks).toBe(4*Q);
});

it('targets nested silence while retaining content-header double-click editing',()=>{
  const l=lane(),clip=l.clips[0];l.definitions.push({id:'g',name:'Group',kind:'group',revision:0,children:clip.children});clip.children=[{id:'group-use',definitionId:'g'}];
  show();fireEvent.doubleClick(document.querySelector('[data-clip-content]')!,{clientX:240,clientY:70});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));
  expect(useStructureDraft.getState().draft?.roots).toHaveLength(1);expect(useStructureDraft.getState().draft?.roots[0].children?.filter(n=>n.definition)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Discard'}));fireEvent.doubleClick(patterns()[0]);expect(screen.queryByRole('dialog',{name:'Add content'})).toBeNull();expect(useAppStore.getState().clipEditingKey).toBeTruthy();
});

it('adds content in the clicked loop repetition without moving other content',()=>{
  const clip=lane().clips[0];clip.mode='loop';clip.length=24*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();fireEvent.doubleClick(document.querySelector('[data-clip-content]')!,{clientX:18.2*40,clientY:70});
  fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));
  expect(useStructureDraft.getState().draft?.pass).toBe(1);
  expect(useStructureDraft.getState().draft?.roots[1].restTicks).toBe(2.25*Q);
});

it('requires resolving pending structure before appending to a whole loop',()=>{
  const clip=lane().clips[0];clip.mode='loop';clip.length=24*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();fireEvent.doubleClick(document.querySelector('[data-clip-content]')!,{clientX:240,clientY:70});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));
  const original=useStructureDraft.getState().draft;
  fireEvent.click(context(patterns()[0]).getByRole('menuitem',{name:'Duplicate'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved structure'})).getByRole('button',{name:'Cancel'}));expect(useStructureDraft.getState().draft).toBe(original);
  fireEvent.click(context(patterns()[0]).getByRole('menuitem',{name:'Duplicate'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved structure'})).getByRole('button',{name:'Discard'}));
  expect(useStructureDraft.getState().draft).toBeNull();expect(screen.getByRole('alert').textContent).toContain('Select the range again');
  fireEvent.click(context(patterns()[0]).getByRole('menuitem',{name:'Duplicate'}));expect(useStructureDraft.getState().draft?.expanded).toBeTruthy();
});
