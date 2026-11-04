import { structureDropLayout } from './structureHitTest';
import { expect, it } from 'vitest';
import fixture from '../../../../backend/tests/fixtures/clip_transposition/repetition_grouping.json';
import devices from '../../../../backend/tests/fixtures/performances/device_names.json';
import { defaultSequencerState } from '../../store/appStoreModel';
import { useAppStore } from '../../store/useAppStore';
import { applyStructure, beginStructure, prepareStructure, stepStructure, structurePreview } from './structure';
import { contentLength, resolveClip, validateArrangement, type ClipArrangement } from './model';
import { clipAuditionState, runtimeSchedule } from './runtime';
import { addOffsets, offsetAt } from './transposition';
import { logicalRepeatIndex, transposePlans } from './transposeModel';
import { beginDraft } from './operations';
import { arrangementTimings, migrateClipArrangement, sourceKeys } from './migration';

function group(model:ClipArrangement, first=1, last=2) {
 const lane=model.lanes[0], clip=lane.clips[0], id=clip.children[0].id;
 return applyStructure(beginStructure(model,lane.id,clip.id,first),{kind:'groupRepetitions',range:{first:{pass:first,id},last:{pass:last,id}},level:'group',name:'Middle'});
}
function events(model:ClipArrangement) {
 const lane=model.lanes[0],clip=lane.clips[0];
 return resolveClip(lane,clip,clip.start,clip.start+clip.length).map(l=>({start:l.start,length:l.length,sourceStart:l.sourceStart,sourceOffset:l.sourceOffset,definition:l.definition?.id,offset:l.definition?addOffsets(transposePlans(lane,clip,l.path).map(p=>offsetAt(p,(clip.repeatIndexBase??0)+l.pass))):null}));
}
it('preserves event spans, linked profiles and distinct repetition pitches after grouping and later profile edits',()=>{
 const before=structuredClone(fixture.before.sequencer.clipArrangement) as ClipArrangement;
 const draft=group(before),after=prepareStructure(before,draft,'local',{}).model;
 expect(events(after)).toEqual(events(before));expect(events(after).map(e=>e.offset!.chromaticSemitones)).toEqual(fixture.semitones);
 before.lanes[0].transposeProfiles![0].plan.repetitions[1].offset.chromaticSemitones=7;
 after.lanes[0].transposeProfiles![0].plan.repetitions[1].offset.chromaticSemitones=7;
 expect(events(after)).toEqual(events(before));
 const lane=after.lanes[0],clip=lane.clips[0],item=clip.children[1];
 const state=defaultSequencerState();state.clipArrangement=after;state.scoreTracks=fixture.after.sequencer.scoreTracks as unknown as typeof state.scoreTracks;
 const musical=beginDraft(after,{laneId:lane.id,clipId:clip.id,pass:0,path:[item.id]});
 const audition=clipAuditionState(state,musical).state as typeof state&{clipAuditionContext:{schedule:ReturnType<typeof runtimeSchedule>}};
 const schedule=audition.clipAuditionContext.schedule;
 expect(schedule.clips[0].content.map(span=>addOffsets(span.transpose_refs!.map(ref=>schedule.transpose_plans![ref].base)).chromaticSemitones)).toEqual([6,9]);
 expect(logicalRepeatIndex(lane,clip,[item.id],0)).toBe(1);
});
it.each([1,2,3,4])('retains cropped first/last source content with offset %i beats',beats=>{
 const before=structuredClone(fixture.before.sequencer.clipArrangement) as ClipArrangement;
 const clip=before.lanes[0].clips[0];clip.offset=beats*20160;clip.length=13*20160;
 const first=Math.floor(clip.offset/(4*20160));
 const draft=group(before,first,first+1),after=prepareStructure(before,draft,'local',{}).model;
 expect(events(after)).toEqual(events(before));expect(after.lanes[0].clips[0].length).toBe(clip.length);
 expect(structurePreview(before,stepStructure(draft,-1)).lanes[0].clips[0]).toMatchObject(clip);
 expect(structurePreview(before,draft).lanes[0].clips[0].mode).toBe('once');
});
it('rejects resource overflow before producing a draft and retains an exact original',()=>{
 const before=structuredClone(fixture.before.sequencer.clipArrangement) as ClipArrangement;
 before.end=before.lanes[0].clips[0].length=20160*4*100000;
 const original=structuredClone(before);
 expect(()=>group(before)).toThrow('content limit');expect(before).toEqual(original);
});
it('validates fixed repetition indices strictly and forbids older-format use',()=>{
 for(const value of [-1,1.5,true,40320000001]){
  const model=structuredClone(fixture.after.sequencer.clipArrangement);
  Object.assign(model.lanes[0].clips[0].children[0],{repeatIndex:value});
  expect(()=>validateArrangement(model as ClipArrangement)).toThrow('repetition index');
 }
 const old=structuredClone(fixture.after.sequencer.clipArrangement) as ClipArrangement;old.version=3;
 expect(()=>validateArrangement(old)).toThrow('repetition index');
});
it.each(Object.keys(sourceKeys) as (keyof typeof sourceKeys)[])('preserves exact %s spans and one clip with fractional timing',source=>{
 useAppStore.setState(useAppStore.getInitialState(),true);useAppStore.getState().applySequencerConfigSnapshot(devices.config);
 const state=structuredClone(useAppStore.getState().sequencer),track=state[sourceKeys[source]][0];
 track.padLoopEnabled=true;track.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:'pad',padIndex:0}]};
 if('playbackMode' in track)track.playbackMode='arranger';
 if('timing' in track)track.timing={...track.timing,beatRateNumerator:3,beatRateDenominator:2};
 for(const key of Object.values(sourceKeys))for(const device of state[key]){device.padLoopEnabled=true;device.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:'pad',padIndex:0}]};if('playbackMode' in device)device.playbackMode='arranger';}
 const model=migrateClipArrangement(state).model!,lane=model.lanes.find(l=>l.source===source)!;model.lanes=[lane];lane.cycleTicks=null;
 const timing=arrangementTimings(state),clip=lane.clips[0],duration=contentLength(lane,clip.children,timing[lane.id]);
 clip.mode='loop';clip.offset=duration/2;clip.length=duration*3;model.end=clip.length;
 const before=resolveClip(lane,clip,0,clip.length,timing[lane.id]);
 const id=clip.children[0].id;
 const draft=applyStructure(beginStructure(model,lane.id,clip.id,1),{kind:'groupRepetitions',range:{first:{pass:1,id},last:{pass:2,id}},level:'group',name:'Pair'},timing);
 const saved=prepareStructure(model,draft,'local',timing).model,nextLane=saved.lanes[0],nextClip=nextLane.clips[0];
 const musical=(leaves:typeof before)=>leaves.map(l=>[l.start,l.length,l.sourceOffset,l.definition?.payload]);
 expect(musical(resolveClip(nextLane,nextClip,0,clip.length,timing[lane.id]))).toEqual(musical(before));
 expect(nextLane.clips).toHaveLength(1);expect(nextClip.id).toBe(clip.id);
});

it('projects the shared v26 fixture into the unchanged v2 runtime contract',()=>{
 const state=defaultSequencerState();state.clipArrangement=fixture.after.sequencer.clipArrangement as ClipArrangement;
 state.scoreTracks=fixture.after.sequencer.scoreTracks as unknown as typeof state.scoreTracks;
 expect(runtimeSchedule(state,state.clipArrangement.lanes[0])).toEqual(fixture.afterSchedule);
});

it('groups repeated groups into a supergroup and maps placements and editor targets by occurrence',()=>{
 const before=structuredClone(fixture.before.sequencer.clipArrangement) as ClipArrangement;
 const lane=before.lanes[0],clip=lane.clips[0],pattern=clip.children[0];
 lane.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[pattern]});
 clip.children=[{id:'g-use',definitionId:'g'}];
 clip.transposePlacements=[{path:['g-use',pattern.id],plan:{base:{diatonicSteps:0,chromaticSemitones:3},repetitions:[{index:2,offset:{diatonicSteps:0,chromaticSemitones:7}}]}}];
 const neighbor={...structuredClone(clip),id:'neighbor',start:clip.length,children:[{id:'neighbor-use',definitionId:'g'}],transposePlacements:undefined};
 lane.clips.push(neighbor);before.end=clip.length*2;
 const draft=applyStructure(beginStructure(before,lane.id,clip.id,1),{kind:'groupRepetitions',range:{first:{pass:1,id:'g-use'},last:{pass:2,id:'g-use'}},level:'supergroup',name:'Middle'});
 const result=prepareStructure(before,draft,'local',{}),after=result.model;
 expect(events(after)).toEqual(events(before));expect(after.lanes[0].clips[1]).toEqual(neighbor);
 expect(after.lanes[0].definitions.find(d=>d.id==='g')).toEqual(lane.definitions.find(d=>d.id==='g'));
 expect(result.occurrences.filter(m=>m.from.path.length===2).map(m=>m.from.pass)).toEqual([0,1,2,3]);
 expect(new Set(result.occurrences.map(m=>JSON.stringify(m.to))).size).toBe(8);
 const groupUse=after.lanes[0].clips[0].children[1];
 const ungroup=applyStructure(beginStructure(after,lane.id,clip.id,0),{kind:'ungroup',parent:[],ids:[groupUse.id]});
 const restored=prepareStructure(after,ungroup,'local',{}).model;
 expect(events(restored)).toEqual(events(before));
 expect(restored.lanes[0].clips[0].children.map(i=>'definitionId' in i?i.repeatIndex:null)).toEqual([0,1,2,3]);
});
it('keeps complete hidden rests and restores the compact clip in a single draft undo',()=>{
 const before=structuredClone(fixture.before.sequencer.clipArrangement) as ClipArrangement,lane=before.lanes[0],clip=lane.clips[0];
 clip.children.unshift({id:'rest',restTicks:20160});clip.offset=20160*6;clip.length=20160*12;
 const draft=applyStructure(beginStructure(before,lane.id,clip.id,2),{kind:'groupRepetitions',range:{first:{pass:1,id:'rest'},last:{pass:2,id:clip.children[1].id}},level:'group',name:'With rests'});
 const after=prepareStructure(before,draft,'local',{}).model;
 expect(events(after)).toEqual(events(before));expect(after.lanes[0].clips[0].offset).toBe(20160);
 const undo=stepStructure(draft,-1);expect(undo.pass).toBe(2);expect(undo.roots).toEqual(draft.history[0]);
 expect(stepStructure(undo,1).roots).toEqual(draft.roots);
});
it('preserves inherited logical indices when moving a pattern out of a group',()=>{
 const before=structuredClone(fixture.after.sequencer.clipArrangement) as ClipArrangement,lane=before.lanes[0],clip=lane.clips[0];
 const groupUse=clip.children[1];if(!('definitionId' in groupUse))throw Error();
 const definition=lane.definitions.find(d=>d.id===groupUse.definitionId)!;if(definition.kind==='pattern')throw Error();
 delete (definition.children[0] as {repeatIndex?:number}).repeatIndex;
 const draft=applyStructure(beginStructure(before,lane.id,clip.id,0),{kind:'move',parent:[groupUse.id],ids:[definition.children[0].id],target:{path:[],index:3}});
 const after=prepareStructure(before,draft,'local',{}).model,items=after.lanes[0].clips[0].children;
 expect(items[items.length-1]).toMatchObject({repeatIndex:1});
});
it('evaluates ancestor and child contributions at their own indices',()=>{
 const model=structuredClone(fixture.after.sequencer.clipArrangement) as ClipArrangement,lane=model.lanes[0],clip=lane.clips[0];
 const groupUse=clip.children[1];if(!('definitionId' in groupUse))throw Error();
 groupUse.repeatIndex=3;groupUse.transpose={base:{diatonicSteps:0,chromaticSemitones:0},repetitions:[{index:3,offset:{diatonicSteps:0,chromaticSemitones:9}}]};
 expect(events(model).map(e=>e.offset?.chromaticSemitones)).toEqual([1,15,23,-2]);
});

it('keeps cropped preview windows fixed for grouping and permits subsequent ordinary growth',()=>{
 const model=structuredClone(fixture.before.sequencer.clipArrangement) as ClipArrangement,clip=model.lanes[0].clips[0];
 clip.offset=20160;clip.length=13*20160;
 const draft=group(model),layout=structureDropLayout(model,draft,{});
 expect(layout.end).toBe(clip.start+clip.length);
 const withRest=applyStructure(draft,{kind:'rest',target:{path:[],index:3},ticks:20160});
 expect(prepareStructure(model,withRest,'local',{}).model.lanes[0].clips[0].length).toBe(16*20160);
});
