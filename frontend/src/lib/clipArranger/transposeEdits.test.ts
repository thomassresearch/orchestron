import { expect, it } from 'vitest';
import { defaultSequencerState } from '../../store/appStoreModel';
import { validateArrangement, resolveContent, type ClipArrangement, type OccurrenceTarget } from './model';
import { saveTransposeEdits, transposeFingerprint, type TransposeScope } from './transposeEdits';
import { addOffsets, offsetAt, type OffsetPlan } from './transposition';
import { transposePlans } from './transposeModel';
import { beginDraft, saveDraft, copyClipRange, pasteClipRange, emptyClipHistory, recordClipEdit, replayClipEdit } from './operations';
import { applyStructure, beginStructure, prepareStructure } from './structure';
import { clipAuditionState, runtimeSchedule } from './runtime';
import sharedPerformance from '../../../../backend/tests/fixtures/clip_transposition/performance.json';
import expectedSchedule from '../../../../backend/tests/fixtures/clip_transposition/schedule.json';

const Q=20160;
const plan=(d=0,c=0):OffsetPlan=>({base:{diatonicSteps:d,chromaticSemitones:c},repetitions:[]});
function fixture():ClipArrangement {
  const payload={...defaultSequencerState().tracks[0].pads[0],lengthBeats:1 as const};
  return {version:3,revision:0,end:16*Q,lanes:[{id:'lane',source:'sequencer',cycleTicks:null,definitions:[
    {id:'p',name:'P',kind:'pattern',source:'sequencer',revision:0,payload},
    {id:'g',name:'G',kind:'group',revision:0,children:[{id:'gp',definitionId:'p'},{id:'gp2',definitionId:'p'}]},
    {id:'s',name:'S',kind:'supergroup',revision:0,children:[{id:'sg',definitionId:'g'}]}
  ],clips:[{id:'a',name:'A',start:0,length:8*Q,offset:0,mode:'loop',children:[{id:'as',definitionId:'s'}]},
    {id:'b',name:'B',start:8*Q,length:8*Q,offset:0,mode:'loop',children:[{id:'bs',definitionId:'s'}]}]}]};
}
const target=(clip='a',path=[clip==='a'?'as':'bs','sg','gp'],pass=0):OccurrenceTarget=>({laneId:'lane',clipId:clip,path,pass});
function edit(model:ClipArrangement,t:OccurrenceTarget,scope:TransposeScope,value:OffsetPlan){return saveTransposeEdits(model,t,[{scope,plan:value,fingerprint:transposeFingerprint(model,t)}]);}
function effective(model:ClipArrangement,clip='a',pass=0){const lane=model.lanes[0],window=lane.clips.find(c=>c.id===clip)!;return resolveContent(lane,window.children).filter(l=>l.definition).map(l=>addOffsets(transposePlans(lane,window,l.path).map(p=>offsetAt(p,pass+(window.repeatIndexBase??0)))));}

it('S01–S13 canonical shared progression, contextual independence, hidden entries and no musical mutation',()=>{
  const original=fixture(), progression=plan();progression.repetitions=[0,2,4,-1].map((d,index)=>({index,offset:plan(d).base}));
  let model=edit(original,target(), 'shared',progression);
  expect(model.lanes[0].transposeProfiles).toHaveLength(1);
  expect(model.lanes[0].definitions[0].kind==='pattern' && model.lanes[0].definitions[0].payload).toEqual(original.lanes[0].definitions[0].kind==='pattern' && original.lanes[0].definitions[0].payload);
  expect(effective(model,'a',2)).toEqual(effective(model,'b',2));
  model=edit(model,target(),'placement',plan(0,12));
  model=edit(model,target(),'parent',plan(1));
  model=edit(model,target('a',['as','sg']),'shared',plan(1));
  model=edit(model,target('a',['as']),'shared',plan(0,12));
  expect(effective(model,'a',2)).toEqual([plan(6,24).base,plan(5,12).base]);
  expect(effective(model,'b',2)).toEqual([plan(6,12).base,plan(5,12).base]);
  expect(model.lanes[0].clips.map(c=>[c.length,c.offset])).toEqual(original.lanes[0].clips.map(c=>[c.length,c.offset]));
  expect(JSON.parse(JSON.stringify(model))).toEqual(model);
});
it('S14 rejects a stale dependent draft but permits unrelated edits',()=>{
  const model=fixture(),fingerprint=transposeFingerprint(model,target());
  const next=edit(model,target(),'shared',plan(1));
  expect(()=>saveTransposeEdits(next,target(),[{scope:'placement',plan:plan(0,12),fingerprint}])).toThrow(/changed/);
  const unrelated=edit(model,target('b'),'placement',plan(0,12));
  expect(()=>saveTransposeEdits(unrelated,target(),[{scope:'placement',plan:plan(1),fingerprint}])).not.toThrow();
});
it('R07/E07 local musical fork keeps logical index and forks only the selected profile',()=>{
  let model=edit(fixture(),target(),'shared',{...plan(),repetitions:[{index:3,offset:plan(2).base}]});
  model=edit(model,target('a',['as','sg']),'shared',plan(0,12));
  model=edit(model,target(),'placement',plan(1));
  const draft=beginDraft(model,target('a',undefined,3));draft.definition.name='Variation';
  const next=saveDraft(model,draft,'local');
  expect(next.lanes[0].clips.find(c=>c.id==='a')?.repeatIndexBase).toBe(3);
  expect(effective(next,'a')).toEqual([plan(3,12).base,plan(2,12).base]);
  expect(next.lanes[0].transposeProfiles).toHaveLength(3);
  expect(effective(next,'b',3)).toEqual([plan(2,12).base,plan(2,12).base]);
});
it('R08 copies crops with local paths remapped and shared profiles intact',()=>{
  const model=edit(fixture(),target(),'placement',plan(0,12));
  const copied=copyClipRange(model,['lane'],Q,2*Q);
  const next=pasteClipRange(model,copied,16*Q,'insert',{});
  validateArrangement(next);
  expect(effective(next,next.lanes[0].clips[next.lanes[0].clips.length-1].id)).toEqual(effective(model));
});
for(const scope of ['local','all'] as const) it(`E01–E04 ${scope} grouping/ungrouping preserves every layer`,()=>{
  let model=edit(fixture(),target('a',['as']),'shared',plan(2));
  model=edit(model,target('a',['as','sg']),'shared',plan(0,12));
  model=edit(model,target('a',['as','sg']),'placement',plan(-1));
  model=edit(model,target('b',['bs','sg','gp']),'placement',plan(0,-12));
  const before=effective(model),other=effective(model,'b');
  const draft=applyStructure(beginStructure(model,'lane','a',0),{kind:'ungroup',parent:['as'],ids:['sg']});
  const next=prepareStructure(model,draft,scope,{}).model;
  expect(effective(next)).toEqual(before);
  expect(effective(next,'b')).toEqual(other);
  const p=next.lanes[0].definitions.find(d=>d.id==='p')!;
  expect(p.transposeProfileId).toBeUndefined();
  validateArrangement(next);
});
it('E09 retains 25 atomic mixed transpose actions and exact identities',()=>{
  let model=fixture(),history=emptyClipHistory();const states=[model];
  for(let n=0;n<25;n++){const next=edit(model,target(),n%2?'shared':'placement',plan(n));history=recordClipEdit(history,model,next,'Transpose');model=next;states.push(next);}
  for(let n=24;n>=0;n--){const next=replayClipEdit(history,model,false);history=next.history;model=next.model;expect(model).toEqual(states[n]);}
  for(let n=1;n<=25;n++){const next=replayClipEdit(history,model,true);history=next.history;model=next.model;expect(model).toEqual(states[n]);}
});
it('U01/U12 audition freezes selected repetition and full duration; runtime keeps compact shared plans',()=>{
  let model=edit(fixture(),target(),'shared',{...plan(),repetitions:[{index:2,offset:plan(3).base}]});
  model=edit(model,target('a',['as','sg']),'parent',plan(0,12));
  const state=defaultSequencerState();state.tracks[0].id='lane';state.clipArrangement=model;
  const scheduled=runtimeSchedule(state,model.lanes[0]);expect(scheduled.clips).toHaveLength(2);expect(scheduled.transpose_plans).toHaveLength(2);
  const audition=clipAuditionState(state,beginDraft(model,target('a',undefined,2)));
  expect(audition.clipContext).toBe(true);
  const context=(audition.state as typeof state&{clipAuditionContext:{schedule:typeof scheduled}}).clipAuditionContext.schedule;
  expect(context.end).toBe(Q);expect(context.cycle_ticks).toBe(Q);
  expect(context.transpose_plans?.map(p=>p.base)).toEqual([plan(0,12).base,plan(3).base]);
});
it('V11 frontend and standalone CLI project the same versioned nested fixture',()=>{
  const state=defaultSequencerState();state.clipArrangement=sharedPerformance.sequencer.clipArrangement as ClipArrangement;
  state.scoreTracks=sharedPerformance.sequencer.scoreTracks as unknown as typeof state.scoreTracks;
  expect(runtimeSchedule(state,state.clipArrangement.lanes[0])).toEqual(expectedSchedule);
});
it('U02 structural container audition preserves descendant placement paths', async()=>{
 const {structureAuditionDraft}=await import('./structureAudition');
 let model=edit(fixture(),target(),'placement',plan(0,12));
 model=edit(model,target('a',['as','sg']),'shared',plan(2));
 const state=defaultSequencerState();state.tracks[0].id='lane';state.clipArrangement=model;
 const structure=applyStructure(beginStructure(model,'lane','a',0),{kind:'ungroup',parent:['as'],ids:['sg']});
 const draft=structureAuditionDraft(model,structure,target('a',['as']),{});
 const audition=clipAuditionState(state,draft);
 const context=(audition.state as typeof state&{clipAuditionContext:{schedule:ReturnType<typeof runtimeSchedule>}}).clipAuditionContext.schedule;
 const values=context.clips[0].content.map(span=>addOffsets((span.transpose_refs??[]).map(i=>context.transpose_plans![i].base)));
 expect(values).toEqual([plan(2,12).base,plan(2).base]);
});
it('first unsaved transposition auditions v3 without promoting saved v1',()=>{
 const model=fixture();model.version=1;
 const state=defaultSequencerState();state.tracks[0].id='lane';state.clipArrangement=model;
 const draft=beginDraft(model,target());draft.transposeEdits=[{scope:'shared',plan:plan(0,12),fingerprint:transposeFingerprint(model,target())}];
 const audition=clipAuditionState(state,draft);
 expect(audition.state.clipArrangement?.version).toBe(3);expect(model.version).toBe(1);
 validateArrangement(audition.state.clipArrangement!);
});
