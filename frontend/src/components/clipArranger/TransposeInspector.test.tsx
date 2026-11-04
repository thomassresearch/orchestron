// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import { openClipEditor, saveClipDraft } from '../../store/clipActions';
import { defaultSequencerState } from '../../store/appStoreModel';
import type { ClipArrangement } from '../../lib/clipArranger/model';
import fixture from '../../../../backend/tests/fixtures/clip_transposition/performance.json';
import { TransposeInspector } from './TransposeInspector';

beforeEach(()=>{
 useAppStore.setState(useAppStore.getInitialState(),true);useStructureDraft.setState({draft:null});
 const sequencer=defaultSequencerState();sequencer.clipArrangement=structuredClone(fixture.sequencer.clipArrangement) as ClipArrangement;
 sequencer.scoreTracks=structuredClone(fixture.sequencer.scoreTracks) as unknown as typeof sequencer.scoreTracks;
 useAppStore.setState({sequencer});openClipEditor({laneId:'transpose-score',clipId:'a',pass:1,path:['as','sg','gp']});
});
afterEach(cleanup);
it('U06–U08 mode selection is inert, preserves both components, and zero differs from inherit',async()=>{
 const stop=vi.fn(async()=>{});render(<TransposeInspector language="english" stopAudition={stop}/>);
 const before=useAppStore.getState().sequencer;
 const selectors=screen.getAllByRole('combobox');
 fireEvent.change(selectors[2],{target:{value:'chromaticSemitones'}});
 expect(useAppStore.getState().sequencer).toBe(before);expect(stop).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'12'}});
 let draft=Object.values(useAppStore.getState().clipDrafts)[0];
 expect(draft.transposeEdits?.[0].plan.repetitions[1].offset).toEqual({diatonicSteps:2,chromaticSemitones:12});
 fireEvent.click(screen.getByRole('button',{name:'Set repetition to zero'}));
 draft=Object.values(useAppStore.getState().clipDrafts)[0];
 expect(draft.transposeEdits?.[0].plan.repetitions[1].offset).toEqual({diatonicSteps:0,chromaticSemitones:0});
 fireEvent.click(screen.getByRole('button',{name:'Inherit default'}));
 expect(Object.values(useAppStore.getState().clipDrafts)[0].transposeEdits?.[0].plan.repetitions.some(r=>r.index===1)).toBe(false);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save transposition'})));
 expect(stop).toHaveBeenCalledOnce();expect(useAppStore.getState().sequencer.clipArrangement?.lanes[0].clips).toHaveLength(2);
 expect(Object.values(useAppStore.getState().clipDrafts)[0].transposeEdits).toBeUndefined();
});
it('U08 discard retains authored configuration and combined musical Save commits one history action',()=>{
 render(<TransposeInspector language="english" stopAudition={async()=>{}}/>);
 const before=useAppStore.getState().sequencer;
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'5'}});
 fireEvent.click(screen.getByRole('button',{name:'Discard transposition'}));expect(useAppStore.getState().sequencer).toBe(before);
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'4'}});
 act(()=>saveClipDraft('all','Renamed motif'));
 const state=useAppStore.getState();expect(state.sequencer.clipArrangement?.lanes[0].definitions.find(d=>d.id==='p')?.name).toBe('Renamed motif');
 expect(state.sequencer.clipArrangement?.lanes[0].transposeProfiles?.find(p=>p.id==='pp')?.plan.repetitions[1].offset.diatonicSteps).toBe(4);
});
