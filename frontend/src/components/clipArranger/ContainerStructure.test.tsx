// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { clipHistoryStep, openClipEditor, updateClipDraft } from '../../store/clipActions';
import { migrateClipArrangement } from '../../lib/clipArranger/migration';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import { definitionAt } from '../../lib/clipArranger/operations';
import { validateArrangement, type OccurrenceTarget } from '../../lib/clipArranger/model';
import { clipAuditionState } from '../../lib/clipArranger/runtime';
import { arrangementTimings } from '../../lib/clipArranger/migration';
import { ClipPerformance } from './ClipPerformance';
import { PerformanceAuditionContext } from '../sequencer/PerformanceAudition';

beforeEach(()=>{
 useAppStore.setState(useAppStore.getInitialState(),true);useStructureDraft.setState({draft:null});
 const s=structuredClone(useAppStore.getState().sequencer),t=s.tracks[0];
 t.padLoopEnabled=true;t.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:'pad',padIndex:0},{type:'pad',padIndex:1}]};
 s.clipArrangement=migrateClipArrangement(s).model!;const l=s.clipArrangement.lanes[0];l.cycleTicks=null;
 const [a,b]=l.definitions;l.definitions=[{...a,name:'A'},{...b,name:'B'},{id:'g',kind:'group',revision:0,name:'Phrase',children:[{id:'a',definitionId:a.id},{id:'b',definitionId:b.id}]},{id:'s',kind:'supergroup',revision:0,name:'Section',children:[{id:'sg',definitionId:'g'}]}];
 l.clips=[{id:'first',name:'First',mode:'loop',start:0,length:16*20160,offset:0,children:[{id:'first-g',definitionId:'g'}]},{id:'linked',name:'Linked',mode:'loop',start:48*20160,length:16*20160,offset:0,children:[{id:'linked-g',definitionId:'g'}]}];s.clipArrangement.end=64*20160;
 useAppStore.setState({sequencer:s});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const model=()=>useAppStore.getState().sequencer.clipArrangement!;
const target=(clip='first',child?:string):OccurrenceTarget=>({laneId:model().lanes[0].id,clipId:clip,pass:0,path:[`${clip}-g`,...(child?[child]:[])]});
const reload=()=>act(()=>useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()))));
const editor=()=>within(screen.getByRole('region',{name:'Editing'}));
const open=(t:OccurrenceTarget)=>act(()=>openClipEditor(t));
const editNote=(note:number)=>act(()=>{const state=useAppStore.getState(),d=state.clipDrafts[state.clipEditingKey!].definition;if(d.kind!=='pattern'||d.source!=='sequencer')throw Error('Expected melodic pattern');updateClipDraft({...d,payload:{...d.payload,steps:d.payload.steps.map((s,i)=>i? s:{...s,note})}});});
const structureSave=async(scope:'local'|'all')=>{
 fireEvent.click(editor().getByRole('button',{name:'Save structure'}));const dialog=within(screen.getByRole('dialog',{name:'Save structure'}));
 fireEvent.click(dialog.getByRole('radio',{name:scope==='all'?'All linked occurrences':'Only this occurrence'}));fireEvent.click(dialog.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
};

it.each(['group','supergroup'].flatMap(kind=>(['local','all'] as const).map(scope=>({kind,scope}))))('saves $kind inspector growth with $scope scope across reloads',async({kind,scope})=>{
 if(kind==='supergroup')for(const c of model().lanes[0].clips)c.children[0]={id:c.children[0].id,definitionId:'s'};
 reload();render(<ClipPerformance language="english" renderEditor={()=>null}/>);open(target());const before=useAppStore.getState().sequencer;
 const added=model().lanes[0].definitions.find(d=>d.name==='B')!;
 fireEvent.change(editor().getByRole('combobox',{name:'Adopt linked'}),{target:{value:added.id}});
 expect(useAppStore.getState().sequencer).toBe(before);expect(useStructureDraft.getState().draft?.cursor).toBe(1);
 await structureSave(scope);const saved=structuredClone(model());reload();expect(model()).toEqual(saved);
 const lane=model().lanes[0],first=lane.clips.find(c=>c.id==='first')!,linked=lane.clips.find(c=>c.id==='linked')!;
 const count=(id:string)=>{const d=definitionAt(lane,{laneId:lane.id,clipId:id,pass:0,path:[lane.clips.find(c=>c.id===id)!.children[0].id]});return d.kind==='pattern'?0:d.children.length;};
 expect(count('first')).toBe(kind==='group'?3:2);expect(count('linked')).toBe(scope==='all'?count('first'):kind==='group'?2:1);
 expect(first.length/20160).toBe(scope==='all'?24:12);expect(linked.length/20160).toBe(scope==='all'?24:16);
 act(()=>clipHistoryStep(false));expect(model().lanes[0].clips[0].length/20160).toBe(16);act(()=>clipHistoryStep(true));expect(model()).toEqual(saved);
});

it('rejects inspector growth atomically and retains its draft when another clip blocks it',async()=>{
 model().lanes[0].clips[1].start=16*20160;reload();render(<ClipPerformance language="english" renderEditor={()=>null}/>);open(target());
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));const before=useAppStore.getState().sequencer;
 fireEvent.click(editor().getByRole('button',{name:'Save structure'}));const dialog=within(screen.getByRole('dialog',{name:'Save structure'}));
 expect(dialog.getByRole('alert').textContent).toContain('Linked');expect(dialog.getByRole('button',{name:'Save'}).hasAttribute('disabled')).toBe(true);
 expect(useAppStore.getState().sequencer).toBe(before);expect(useStructureDraft.getState().draft?.cursor).toBe(1);
});

it.each(['local','all'] as const)('removes the final inspector child with %s scope and reloads the retained definitions',async scope=>{
 const g=model().lanes[0].definitions.find(d=>d.id==='g')!;if(g.kind!=='pattern')g.children=g.children.slice(0,1);
 for(const clip of model().lanes[0].clips)clip.length=8*20160;
 reload();render(<ClipPerformance language="english" renderEditor={()=>null}/>);open(target());
 fireEvent.click(editor().getByRole('button',{name:'Remove occurrence'}));expect(editor().getByText(/empty container/)).toBeTruthy();
 await structureSave(scope);reload();expect(model().lanes[0].definitions.some(d=>d.id==='g')).toBe(true);
 expect(model().lanes[0].clips).toHaveLength(scope==='all'?0:2);
 if(scope==='local')expect(model().lanes[0].clips[0].start/20160).toBe(4);
});

it.each(['local','all'] as const)('resolves a musical %s save before resuming a pending inspector operation and preserves another draft',async scope=>{
 reload();render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 open(target('linked','b'));editNote(90);open(target('first','a'));editNote(73);open(target());
 const before=useAppStore.getState().sequencer;
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));let conflict=within(screen.getByRole('dialog',{name:'Unsaved musical draft'}));
 fireEvent.click(conflict.getByRole('button',{name:'Cancel'}));expect(useStructureDraft.getState().draft).toBeNull();expect(useAppStore.getState().sequencer).toBe(before);
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));conflict=within(screen.getByRole('dialog',{name:'Unsaved musical draft'}));fireEvent.click(conflict.getByRole('button',{name:'Save'}));
 const dialog=within(screen.getByRole('dialog',{name:'Save changes'}));fireEvent.click(dialog.getByRole('radio',{name:scope==='all'?'All linked occurrences':'Only this occurrence'}));fireEvent.click(dialog.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(useStructureDraft.getState().draft?.cursor).toBe(1));
 expect(Object.values(useAppStore.getState().clipDrafts).some(d=>d.definition.kind==='pattern'&&d.definition.source==='sequencer'&&d.definition.payload.steps[0].note===90)).toBe(true);
 await structureSave('local');
 // Preserve the unrelated dirty draft through the structural save, then explicitly clear it for a saved-state reload.
 expect(Object.values(useAppStore.getState().clipDrafts)).toHaveLength(1);act(()=>useAppStore.setState({clipDrafts:{}}));reload();
 const lane=model().lanes[0];const notes=(id:string)=>{const clip=lane.clips.find(c=>c.id===id)!,g=definitionAt(lane,{laneId:lane.id,clipId:id,pass:0,path:[clip.children[0].id]});if(g.kind==='pattern')throw Error();const p=lane.definitions.find(d=>'definitionId' in g.children[0]&&d.id===g.children[0].definitionId)!;return p.kind==='pattern'&&p.source==='sequencer'?p.payload.steps[0].note:0;};
 expect(notes('first')).toBe(73);expect(notes('linked')===73).toBe(scope==='all');
});

it('discards only the conflicting musical draft and resumes the pending operation',async()=>{
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);open(target('linked','b'));editNote(90);open(target('first','a'));editNote(73);open(target());
 const before=useAppStore.getState().sequencer;fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved musical draft'})).getByRole('button',{name:'Discard'}));
 await waitFor(()=>expect(useStructureDraft.getState().draft?.cursor).toBe(1));expect(useAppStore.getState().sequencer).toBe(before);
 expect(Object.values(useAppStore.getState().clipDrafts).filter(d=>d.definition.kind==='pattern')).toHaveLength(1);
});

it.each(['local','all'] as const)('resolves a linked musical %s save before structural all-save and retains draft history',async scope=>{
 reload();render(<ClipPerformance language="english" renderEditor={()=>null}/>);open(target('linked','b'));editNote(88);open(target());
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));fireEvent.click(editor().getByRole('button',{name:'Save structure'}));
 let dialog=within(screen.getByRole('dialog',{name:'Save structure'}));fireEvent.click(dialog.getByRole('radio',{name:'All linked occurrences'}));fireEvent.click(dialog.getByRole('button',{name:'Save'}));
 const conflict=within(screen.getByRole('dialog',{name:'Unsaved musical draft'}));fireEvent.click(conflict.getByRole('button',{name:'Save'}));
 const musical=within(screen.getByRole('dialog',{name:'Save changes'}));fireEvent.click(musical.getByRole('radio',{name:scope==='all'?'All linked occurrences':'Only this occurrence'}));fireEvent.click(musical.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Unsaved musical draft'})).toBeNull());
 expect(useStructureDraft.getState().draft?.cursor).toBe(1);
 dialog=within(screen.getByRole('dialog',{name:'Save structure'}));fireEvent.click(dialog.getByRole('button',{name:'Save'}));await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());
 const saved=structuredClone(model());reload();expect(model()).toEqual(saved);
 expect(model().lanes[0].clips.find(c=>c.id==='first')!.length/20160).toBe(18);
});

it('auditions the container snapshot explicitly without preparing on structural previews',async()=>{
 const audition=vi.fn().mockImplementation(async(_id,payload)=>{
  if(payload.action==='workspace_start'){
   const compiled=clipAuditionState(useAppStore.getState().sequencer,payload.clipDraft).state;
   validateArrangement(compiled.clipArrangement!,arrangementTimings(compiled));
   expect(useAppStore.getState().buildSequencerConfigSnapshot()).toBeTruthy();
  }
 });render(<PerformanceAuditionContext.Provider value={audition}><ClipPerformance language="english" renderEditor={()=>null}/></PerformanceAuditionContext.Provider>);open(target());
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));expect(audition).not.toHaveBeenCalled();
 await act(async()=>fireEvent.click(editor().getByRole('button',{name:'Play edit'})));
 expect(audition).toHaveBeenCalledTimes(1);expect(audition.mock.calls[0][1].clipDraft.definition.children).toHaveLength(3);
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));await act(async()=>new Promise(resolve=>setTimeout(resolve,120)));expect(audition).toHaveBeenCalledTimes(1);
 await structureSave('all');expect(audition.mock.calls[1][1].action).toBe('workspace_end');
});

it.each(['local','all'] as const)('opens the requested musical editor after saving its changed container with %s scope',async scope=>{
 render(<ClipPerformance language="english" renderEditor={()=> <span>Musical controls</span>}/>);open(target());
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));
 const pattern=screen.getAllByTitle('pattern: A')[0];fireEvent.doubleClick(pattern);
 let dialog=within(screen.getByRole('dialog',{name:'Unsaved structure'}));fireEvent.click(dialog.getByRole('button',{name:'Save structure'}));
 dialog=within(screen.getByRole('dialog',{name:'Save structure'}));fireEvent.click(dialog.getByRole('radio',{name:scope==='all'?'All linked occurrences':'Only this occurrence'}));fireEvent.click(dialog.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(editor().getByText('Musical controls')).toBeTruthy());
 const state=useAppStore.getState(),draft=state.clipDrafts[state.clipEditingKey!];expect(draft.definition.name).toBe('A');expect(draft.target.pass).toBe(0);
});
it('retains the pending operation and musical draft when its save is stale',async()=>{
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);open(target('first','a'));editNote(73);open(target());
 fireEvent.click(editor().getByRole('button',{name:'Rest +1'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved musical draft'})).getByRole('button',{name:'Save'}));
 act(()=>{const s=structuredClone(useAppStore.getState().sequencer);s.clipArrangement!.lanes[0].definitions[0].revision++;s.clipArrangement!.revision++;useAppStore.setState({sequencer:s});});
 const before=useAppStore.getState().sequencer;
 fireEvent.click(within(screen.getByRole('dialog',{name:'Save changes'})).getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(within(screen.getByRole('dialog',{name:'Save changes'})).getByRole('alert').textContent).toContain('changed'));
 expect(useAppStore.getState().sequencer).toBe(before);expect(useStructureDraft.getState().draft).toBeNull();expect(Object.values(useAppStore.getState().clipDrafts)).toHaveLength(2);
 fireEvent.click(within(screen.getByRole('dialog',{name:'Save changes'})).getByRole('button',{name:'Cancel'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Unsaved musical draft'})).getByRole('button',{name:'Cancel'}));
 expect(useAppStore.getState().sequencer).toBe(before);
});
it('keeps Stop edit available when the auditioned container becomes empty',async()=>{
 const audition=vi.fn().mockResolvedValue(undefined);render(<PerformanceAuditionContext.Provider value={audition}><ClipPerformance language="english" renderEditor={()=>null}/></PerformanceAuditionContext.Provider>);open(target());
 await act(async()=>fireEvent.click(editor().getByRole('button',{name:'Play edit'})));
 fireEvent.click(editor().getAllByRole('button',{name:'Remove occurrence'})[0]);fireEvent.click(editor().getByRole('button',{name:'Remove occurrence'}));
 const stop=editor().getByRole('button',{name:'Stop edit'});expect(stop.hasAttribute('disabled')).toBe(false);
 await act(async()=>fireEvent.click(stop));expect(audition.mock.calls[1][1].action).toBe('workspace_end');
});
