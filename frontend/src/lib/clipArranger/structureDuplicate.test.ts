import { expect, it } from 'vitest';
import repeated from '../../../../backend/tests/fixtures/clip_transposition/repetition_grouping.json';
import { defaultSequencerPads } from '../../store/appStoreModel';
import { applyStructure, beginStructure, prepareStructure, stepStructure, structureClip, structurePreview } from './structure';
import { CLIP_LIMITS, QUARTER_TICKS as Q, resolveClip, validateArrangement, type ClipArrangement } from './model';
import { addOffsets, offsetAt } from './transposition';
import { transposePlans } from './transposeModel';
import { beginDraft, saveDraft } from './operations';
import { rebaseStructure } from './structuralDraftResolution';

function fixture():ClipArrangement {
  return {version:1,revision:0,end:8*Q,lanes:[{id:'lane',source:'sequencer',cycleTicks:null,
    definitions:[{id:'p',name:'Pattern',kind:'pattern',source:'sequencer',revision:0,payload:defaultSequencerPads()[0]}],
    clips:[{id:'clip',name:'Clip',start:0,length:8*Q,offset:0,mode:'once',children:[{id:'use',definitionId:'p'},{id:'tail',restTicks:4*Q}]}]}]};
}
const duplicate=(model:ClipArrangement,parent:string[]=[],ids=['use'],pass=0)=>applyStructure(beginStructure(model,model.lanes[0].id,model.lanes[0].clips[0].id,pass),{kind:'duplicate',parent,ids},{},model);
const save=(model:ClipArrangement,draft:ReturnType<typeof duplicate>)=>prepareStructure(model,draft,'local',{}).model;
function pitches(model:ClipArrangement) {
  const lane=model.lanes[0],clip=lane.clips[0];
  return resolveClip(lane,clip,clip.start,clip.start+clip.length).filter(l=>l.definition).map(l=>addOffsets(transposePlans(lane,clip,l.path).map(p=>offsetAt(p,(clip.repeatIndexBase??0)+l.pass))).chromaticSemitones);
}

it.each([2,4,6])('consumes %i trailing beats before growing and preserves links and one-step undo',rest=>{
  const model=fixture(),clip=model.lanes[0].clips[0];clip.children[1]={id:'tail',restTicks:rest*Q};clip.length=(4+rest)*Q;model.end=clip.length;
  const before=structuredClone(model),draft=duplicate(model),saved=save(model,draft),next=saved.lanes[0].clips[0];
  expect(model).toEqual(before);expect(saved.lanes[0].definitions).toEqual(model.lanes[0].definitions);
  expect(next.children.filter(i=>'definitionId' in i).map(i=>i.definitionId)).toEqual(['p','p']);
  expect(next.length).toBe(Math.max(8,4+rest)*Q);expect(saved.end).toBe(next.length);
  expect(next.children.filter(i=>'restTicks' in i).map(i=>i.restTicks)).toEqual(rest>4?[(rest-4)*Q]:[]);
  expect(draft.roots[0].id).not.toBe(draft.roots[1].id);
  expect(stepStructure(draft,-1).roots).toEqual(draft.history[0]);expect(stepStructure(stepStructure(draft,-1),1).roots).toEqual(draft.roots);
  expect(()=>validateArrangement(JSON.parse(JSON.stringify(saved)))).not.toThrow();
});

it.each(['group','supergroup'] as const)('duplicates a linked %s without forking its children',kind=>{
  const model=fixture(),lane=model.lanes[0];lane.definitions.push({id:'g',name:'G',kind,revision:0,children:[{id:'child',definitionId:'p'}]});lane.clips[0].children=[{id:'use',definitionId:'g'}];
  const saved=save(model,duplicate(model));
  expect(saved.lanes[0].definitions).toEqual(lane.definitions);
  expect(saved.lanes[0].clips[0].children.map(i=>'definitionId' in i&&i.definitionId)).toEqual(['g','g']);
});

it('copies nested content to the root while retaining inherited pitch and source identities',()=>{
  const model=fixture(),lane=model.lanes[0],clip=lane.clips[0];model.version=4;
  const plan=(base:number)=>({base:{diatonicSteps:0,chromaticSemitones:base},repetitions:[]});
  lane.transposeProfiles=[{id:'profile',revision:0,plan:plan(3)}];
  lane.definitions.push({id:'g',name:'Group',kind:'group',revision:0,transposeProfileId:'profile',children:[{id:'child',definitionId:'p'}]});
  clip.children=[{id:'use',definitionId:'g',transpose:plan(2)}];clip.transposePlacements=[{path:['use'],plan:plan(4)},{path:['use','child'],plan:plan(1)}];
  const draft=duplicate(model,['use'],['child']),result=prepareStructure(model,draft,'local',{});
  expect(pitches(result.model)).toEqual([10,10]);expect(result.model.lanes[0].definitions).toEqual(lane.definitions);
  expect(draft.roots[1].originalPath).toBeUndefined();expect(result.occurrences).toHaveLength(2);
});

it('preserves sibling order and internal rests in a range',()=>{
  const model=fixture(),clip=model.lanes[0].clips[0];clip.children=[clip.children[0],{id:'gap',restTicks:Q},{id:'second',definitionId:'p'},{id:'tail',restTicks:8*Q}];clip.length=17*Q;model.end=clip.length;
  const next=save(model,duplicate(model,[],['use','gap','second'])).lanes[0].clips[0];
  expect(next.children.map(i=>'definitionId' in i?i.definitionId:i.restTicks/Q)).toEqual(['p',1,'p','p',1,'p']);expect(next.length).toBe(18*Q);
});

it('appends once after four repetitions and preserves each original pitch',()=>{
  const model=structuredClone(repeated.before.sequencer.clipArrangement) as ClipArrangement,clip=model.lanes[0].clips[0];
  const draft=duplicate(model,[],[clip.children[0].id],1),saved=save(model,draft),next=saved.lanes[0].clips[0];
  expect(saved.lanes[0].clips).toHaveLength(1);expect(next).toMatchObject({id:clip.id,mode:'once',start:clip.start,length:20*Q});
  expect(pitches(saved)).toEqual([...pitches(model),pitches(model)[1]]);expect(saved.lanes[0].definitions).toEqual(model.lanes[0].definitions);
  expect(structurePreview(model,stepStructure(draft,-1)).lanes[0].clips[0]).toEqual(clip);
  expect(()=>prepareStructure(model,draft,'all',{})).toThrow('only this clip');
});

it('retains cropped loop content and reveals the appended item without extending a remaining silent tail',()=>{
  const model=fixture(),clip=model.lanes[0].clips[0];clip.mode='loop';clip.offset=Q;clip.length=10*Q;model.end=10*Q;
  const draft=duplicate(model,[],['use'],1),next=save(model,draft).lanes[0].clips[0];
  expect(next).toMatchObject({mode:'once',offset:Q,length:15*Q});
  expect(next.children.map(i=>'definitionId' in i?i.definitionId:i.restTicks/Q)).toEqual(['p',4,'p','p']);
  expect(structureClip(draft).length).toBe(next.length);
});

it('grows a cropped Once window even when the duplicate fits existing source silence',()=>{
  const model=fixture(),clip=model.lanes[0].clips[0];clip.children[1]={id:'tail',restTicks:12*Q};clip.length=4*Q;
  expect(save(model,duplicate(model)).lanes[0].clips[0].length).toBe(8*Q);
});

it('rejects collisions without moving neighboring clips or changing the draft',()=>{
  const model=fixture(),lane=model.lanes[0];lane.clips[0].children.pop();lane.clips[0].length=4*Q;lane.clips.push({...structuredClone(lane.clips[0]),id:'neighbor',start:4*Q,children:[{id:'other',definitionId:'p'}]});
  const draft=duplicate(model),snapshot=structuredClone(draft);
  expect(()=>save(model,draft)).toThrow('Growth overlaps');expect(draft).toEqual(snapshot);expect(lane.clips[1].start).toBe(4*Q);
});

it('rejects oversized loops and rest-only selections before changing the source',()=>{
  const model=fixture(),clip=model.lanes[0].clips[0],draft=beginStructure(model,'lane','clip',0);
  expect(()=>applyStructure(draft,{kind:'duplicate',parent:[],ids:['tail']})).toThrow('musical content');expect(draft.cursor).toBe(0);
  clip.mode='loop';clip.length=CLIP_LIMITS.ticks;model.end=clip.length;
  expect(()=>duplicate(model)).toThrow('content limit');
});

it.each(['local','all'] as const)('rebases duplication and redo after a %s musical save',scope=>{
  const model=fixture(),draft=stepStructure(duplicate(model),-1);
  const musical=beginDraft(model,{laneId:'lane',clipId:'clip',pass:0,path:['use']});musical.definition.name='Edited';
  const saved=saveDraft(model,musical,scope),rebased=stepStructure(rebaseStructure(draft,saved,{}),1);
  expect(rebased.roots.filter(n=>n.definition).map(n=>n.definition!.name)).toEqual(['Edited','Edited']);
  const committed=save(saved,rebased),refs=committed.lanes[0].clips[0].children.filter(i=>'definitionId' in i);
  expect(refs[0].definitionId).toBe(refs[1].definitionId);
});

it('keeps a duplicated edited container linked to the same newly saved definition',()=>{
  const model=fixture(),l=model.lanes[0];l.definitions.push({id:'g',name:'G',kind:'group',revision:0,children:[{id:'child',definitionId:'p'}]});l.clips[0].children=[{id:'use',definitionId:'g'}];
  const renamed=applyStructure(beginStructure(model,'lane','clip',0),{kind:'rename',path:['use'],name:'Renamed'});
  const draft=applyStructure(renamed,{kind:'duplicate',parent:[],ids:['use']}),saved=save(model,draft),items=saved.lanes[0].clips[0].children;
  expect(items[0]).toHaveProperty('definitionId', 'definitionId' in items[1]?items[1].definitionId:'');
  expect(saved.lanes[0].definitions.filter(d=>d.name==='Renamed')).toHaveLength(1);
});

it('maps nested selections and rests correctly when expanding a loop',()=>{
  const model=fixture(),l=model.lanes[0],clip=l.clips[0];
  l.definitions.push({id:'g',name:'G',kind:'group',revision:0,children:[{id:'child',definitionId:'p'}]});
  clip.children=[{id:'use',definitionId:'g'},{id:'rest',restTicks:Q}];clip.mode='loop';clip.length=10*Q;model.end=clip.length;
  expect(save(model,duplicate(model,['use'],['child'],1)).lanes[0].clips[0].children.map(i=>'definitionId' in i?i.definitionId:i.restTicks/Q)).toEqual(['g',1,'g','p']);
  expect(()=>save(model,duplicate(model,[],['use','rest'],1))).not.toThrow();
});

it('retains the selected logical pass when replaying loop duplication after a shared musical save',()=>{
  const model=structuredClone(repeated.before.sequencer.clipArrangement) as ClipArrangement,l=model.lanes[0],clip=l.clips[0];
  const draft=duplicate(model,[],[clip.children[0].id],2);
  const musical=beginDraft(model,{laneId:l.id,clipId:clip.id,pass:0,path:[clip.children[0].id]});musical.definition.name='Edited';
  const saved=saveDraft(model,musical,'all'),rebased=rebaseStructure(draft,saved,{}),committed=save(saved,rebased);
  expect(pitches(committed)).toEqual([...pitches(saved),pitches(saved)[2]]);
  expect(stepStructure(rebased,-1).pass).toBe(2);
});
