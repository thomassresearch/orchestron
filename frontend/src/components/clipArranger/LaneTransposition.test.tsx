// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fixture from '../../../../backend/tests/fixtures/clip_transposition/performance.json';
import { defaultSequencerState } from '../../store/appStoreModel';
import { useAppStore } from '../../store/useAppStore';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import { clipHistoryStep, openClipEditor, updateClipDraft } from '../../store/clipActions';
import type { ClipArrangement, OccurrenceTarget } from '../../lib/clipArranger/model';
import { ClipPerformance } from './ClipPerformance';

const target=(path=['as','sg','gp'],pass=1,clipId='a'):OccurrenceTarget=>({laneId:'transpose-score',clipId,path,pass});
function badge(t:OccurrenceTarget) {
 return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-transpose-target]')).find(b=>b.dataset.transposeTarget===JSON.stringify(t))!;
}
function panel(){return within(screen.getByRole('dialog',{name:'Transpose in arranger'}));}
beforeEach(()=>{
 useAppStore.setState(useAppStore.getInitialState(),true);useStructureDraft.setState({draft:null});
 const sequencer=defaultSequencerState();sequencer.clipArrangement=structuredClone(fixture.sequencer.clipArrangement) as ClipArrangement;
 sequencer.scoreTracks=structuredClone(fixture.sequencer.scoreTracks) as unknown as typeof sequencer.scoreTracks;
 useAppStore.setState({sequencer});
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function show(expand=true){render(<ClipPerformance language="english" renderEditor={()=> <p>Musical editor</p>}/>);if(expand)fireEvent.click(screen.getByRole('button',{name:'▸ Long Score'}));}

it('shows inherited totals on patterns, groups and supergroups and opens directly without editing music',()=>{
 show();
 expect(badge(target(['as'])).getAttribute('aria-label')).toContain('+1 Diatonic steps · 0 Semitones');
 expect(badge(target(['as','sg'])).getAttribute('aria-label')).toContain('+1 Diatonic steps · +12 Semitones');
 const b=badge(target());expect(b.getAttribute('aria-label')).toContain('+3 Diatonic steps · +24 Semitones');expect(b.dataset.transposeActive).toBe('true');
 const state=useAppStore.getState();fireEvent.pointerDown(b,{button:0});fireEvent.click(b);
 expect(panel().getByRole('spinbutton',{name:'Diatonic steps'})).toHaveProperty('value','2');
 expect(useAppStore.getState().clipEditingKey).toBeNull();expect(screen.queryByText('Musical editor')).toBeNull();
 expect(useAppStore.getState().sequencer).toBe(state.sequencer);expect(useAppStore.getState().sequencerEditRevision).toBe(state.sequencerEditRevision);expect(useStructureDraft.getState().draft).toBeNull();
});
it('saves the chosen shared repetition, updates both clips and supports one undo/redo',async()=>{
 show();const before=structuredClone(useAppStore.getState().sequencer.clipArrangement);
 fireEvent.click(badge(target()));fireEvent.change(panel().getByRole('spinbutton'),{target:{value:'5'}});
 await act(async()=>fireEvent.click(panel().getByRole('button',{name:'Save transposition'})));
 expect(screen.queryByRole('dialog',{name:'Transpose in arranger'})).toBeNull();
 expect(badge(target()).getAttribute('aria-label')).toContain('+6 Diatonic steps');expect(badge(target(['bs','sg','gp'],1,'b')).getAttribute('aria-label')).toContain('+6 Diatonic steps');
 const after=useAppStore.getState().sequencer.clipArrangement!;expect(after.lanes[0].clips).toEqual(before!.lanes[0].clips);
 act(()=>clipHistoryStep(false));expect(useAppStore.getState().sequencer.clipArrangement).toEqual(before);
 act(()=>clipHistoryStep(true));expect(useAppStore.getState().sequencer.clipArrangement).toEqual(after);
});
it.each([{path:['as']},{path:['as','sg']}])('edits a container placement directly and keeps the linked clip independent ($path)',async({path})=>{
 show();fireEvent.click(badge(target(path)));
 fireEvent.change(panel().getByRole('combobox',{name:'Transposition scope'}),{target:{value:'placement'}});
 fireEvent.change(panel().getByRole('combobox',{name:'Transposition component'}),{target:{value:'chromaticSemitones'}});
 fireEvent.change(panel().getByRole('spinbutton'),{target:{value:'7'}});
 await act(async()=>fireEvent.click(panel().getByRole('button',{name:'Save transposition'})));
 expect(badge(target()).getAttribute('aria-label')).toContain('+31 Semitones');
 expect(badge(target(['bs','sg','gp'],1,'b')).getAttribute('aria-label')).toContain('+12 Semitones');
});
it('compact lanes allow editing, closing retains the draft, and discard leaves music unchanged',()=>{
 show(false);const before=useAppStore.getState().sequencer;
 const b=badge(target());fireEvent.click(b);fireEvent.change(panel().getByRole('spinbutton'),{target:{value:'6'}});
 fireEvent(screen.getByRole('dialog',{name:'Transpose in arranger'}),new Event('cancel',{cancelable:true}));
 expect(useAppStore.getState().sequencer).toBe(before);expect(badge(target()).textContent).toContain('*');expect(document.activeElement).toBe(b);
 fireEvent.click(badge(target()));expect(panel().getByRole('spinbutton')).toHaveProperty('value','6');
 fireEvent.click(panel().getByRole('button',{name:'Discard transposition'}));expect(badge(target()).textContent).not.toContain('*');expect(useAppStore.getState().sequencer).toBe(before);
});
it('editing another lane occurrence preserves the open musical editor and its notes draft',async()=>{
 openClipEditor(target(['bs','sg','gp'],0,'b'));
 const key=useAppStore.getState().clipEditingKey!;const draft=useAppStore.getState().clipDrafts[key];updateClipDraft({...draft.definition,name:'Unfinished music'});
 show(false);fireEvent.click(badge(target()));fireEvent.change(panel().getByRole('spinbutton'),{target:{value:'4'}});
 await act(async()=>fireEvent.click(panel().getByRole('button',{name:'Save transposition'})));
 expect(useAppStore.getState().clipEditingKey).toBe(key);expect(useAppStore.getState().clipDrafts[key].definition.name).toBe('Unfinished music');
});
it('refreshes a closed clean inspector after a shared musical edit',async()=>{
 show(false);fireEvent.click(badge(target()));fireEvent.click(panel().getByRole('button',{name:'Close'}));
 act(()=>{
   const state=useAppStore.getState(), model=structuredClone(state.sequencer.clipArrangement!);
   const definition=model.lanes[0].definitions.find(d=>d.id==='p')!;
   definition.name='Updated motif';definition.revision++;
   useAppStore.setState({sequencer:{...state.sequencer,clipArrangement:model}});
 });
 fireEvent.click(badge(target()));fireEvent.change(panel().getByRole('spinbutton'),{target:{value:'3'}});
 await act(async()=>fireEvent.click(panel().getByRole('button',{name:'Save transposition'})));
 expect(screen.queryByRole('dialog',{name:'Transpose in arranger'})).toBeNull();
 expect(badge(target()).getAttribute('aria-label')).toContain('Updated motif');
});
