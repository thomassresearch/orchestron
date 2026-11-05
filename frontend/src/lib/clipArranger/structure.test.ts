import { structureDropLayout, structureInsertionAt } from './structureHitTest';
import { describe,expect,it } from 'vitest';
import { applyStructure,beginStructure,prepareStructure,stepStructure,structureDisplayGeometry } from './structure';
import type { ClipArrangement,Definition } from './model';
import { defaultSequencerPads } from '../../store/appStoreModel';
const pattern=(id:string):Definition=>({id,name:id,revision:0,kind:'pattern',source:'sequencer',payload:defaultSequencerPads()[0]});
function fixture():ClipArrangement { return {version:1,revision:0,end:20160*32,lanes:[{id:'lane',source:'sequencer',cycleTicks:null,definitions:[pattern('a'),pattern('b')],clips:[{id:'clip',name:'Clip',start:0,length:20160*8,offset:0,mode:'loop',children:[{id:'a-use',definitionId:'a'}]}]}]}; }
describe('structural transactions',()=>{
 it('inserts without mutating authored state and retains repeat span on all save',()=>{
  const m=fixture(), snapshot=JSON.stringify(m); const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:[],index:1},definition:m.lanes[0].definitions[1],variation:false});
  expect(JSON.stringify(m)).toBe(snapshot);
  const next=prepareStructure(m,d,'all',{}).model;
  expect(next.lanes[0].clips[0].length).toBe(20160*16);
  expect(next.lanes[0].clips[0].children.map(i=>'definitionId' in i&&i.definitionId)).toEqual(['a','b']);
  expect(stepStructure(d,-1).roots).toHaveLength(1);
 });
 it('rejects growth collisions atomically',()=>{
  const m=fixture();m.lanes[0].clips.push({id:'next',name:'Next',start:20160*8,length:20160*4,offset:0,mode:'once',children:[{id:'next-a',definitionId:'a'}]});
  const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:[],index:1},definition:m.lanes[0].definitions[1],variation:false});
  expect(()=>prepareStructure(m,d,'all',{})).toThrow('Growth overlaps');expect(m.lanes[0].clips[0].length).toBe(20160*8);
 });
 it('isolates a local pass and shifts only its following generated passes',()=>{
  const m=fixture(); const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:[],index:1},definition:m.lanes[0].definitions[1],variation:false});
  const clips=prepareStructure(m,d,'local',{}).model.lanes[0].clips;
  expect(clips).toHaveLength(2);expect(clips[0].length).toBe(20160*8);expect(clips[1].start).toBe(20160*8);expect(clips[1].length).toBe(20160*4);
 });
 it('groups and moves between containers without changing duration',()=>{
  const m=fixture();m.lanes[0].clips[0].children.push({id:'b-use',definitionId:'b'});
  let d=beginStructure(m,'lane','clip',0);
  d=applyStructure(d,{kind:'group',parent:[],ids:['a-use','b-use'],level:'group',name:'Phrase'});
  const group=d.roots[0];
  d=applyStructure(d,{kind:'move',parent:[group.id],ids:['b-use'],target:{path:[],index:1}});
  const result=prepareStructure(m,d,'local',{}).model;
  expect(result.lanes[0].clips[0].children).toHaveLength(2);
  expect(d.roots[0].children).toHaveLength(1);
 });
});
it('grows every linked clip and preserves local sharing on a local save',()=>{
 const m=fixture(),lane=m.lanes[0];lane.definitions.push({id:'g',name:'G',kind:'group',revision:0,children:[{id:'ga',definitionId:'a'}]});
 lane.clips[0].children=[{id:'g1',definitionId:'g'}];lane.clips.push({...structuredClone(lane.clips[0]),id:'second',start:20160*20,children:[{id:'g2',definitionId:'g'}]});
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:['g1'],index:1},definition:lane.definitions[1],variation:false});
 const all=prepareStructure(m,d,'all',{}).model;
 expect(all.lanes[0].clips.map(c=>c.length)).toEqual([20160*16,20160*16]);
 const local=prepareStructure(m,d,'local',{}).model;
 expect(local.lanes[0].clips.find(c=>c.id==='second')!.length).toBe(20160*8);
});
it('removes empty shared container occurrences while retaining unused definitions',()=>{
 const m=fixture(),lane=m.lanes[0];lane.definitions.push({id:'g',name:'G',kind:'group',revision:0,children:[{id:'ga',definitionId:'a'}]});lane.clips[0].children=[{id:'g1',definitionId:'g'}];
 lane.clips.push({...structuredClone(lane.clips[0]),id:'second',start:20160*20,children:[{id:'g2',definitionId:'g'}]});
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'move',parent:['g1'],ids:['ga'],target:{path:[],index:1}});
 const all=prepareStructure(m,d,'all',{}).model;
 expect(all.lanes[0].clips).toHaveLength(1);expect(all.lanes[0].definitions.find(x=>x.id==='g')).toBeDefined();
});
it('keeps fractional loop phases with rational rounding and rejects stale drafts',()=>{
 const m=fixture();const clip=m.lanes[0].clips[0];clip.offset=10080;clip.length=100800;
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:[],index:1},definition:m.lanes[0].definitions[1],variation:false});
 const saved=prepareStructure(m,d,'all',{}).model.lanes[0].clips[0];expect(saved.offset).toBe(20160);expect(saved.length).toBe(201600);
 const changed=structuredClone(m);changed.lanes[0].clips[0].children.push({id:'external-rest',restTicks:20160});
 expect(()=>prepareStructure(changed,d,'all',{})).toThrow('track changed');
});
it('reorders a selected range, leaves explicit rests and ignores equivalent drops',()=>{
 const m=fixture();m.lanes[0].clips[0].children.push({id:'rest',restTicks:20160},{id:'b-use',definitionId:'b'});
 const base=beginStructure(m,'lane','clip',0);
 expect(applyStructure(base,{kind:'move',parent:[],ids:['a-use'],target:{path:[],index:1}})).toBe(base);
 const changed=applyStructure(base,{kind:'move',parent:[],ids:['rest','b-use'],target:{path:[],index:0}});
 expect(changed.roots.map(n=>n.id)).toEqual(['rest','b-use','a-use']);
 expect(()=>applyStructure(base,{kind:'group',parent:[],ids:['a-use','b-use'],level:'group',name:'Bad'})).toThrow('consecutive');
});
it('rejects contradictory edits to two occurrences of the same shared container',()=>{
 const m=fixture(),l=m.lanes[0];l.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'},{id:'gb',definitionId:'b'}]});l.clips[0].children=[{id:'g1',definitionId:'g'},{id:'g2',definitionId:'g'}];
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'move',parent:['g1'],ids:['ga'],target:{path:['g2'],index:2}});
 expect(()=>prepareStructure(m,d,'all',{})).toThrow('incompatible');expect(()=>prepareStructure(m,d,'local',{})).not.toThrow();
});

it.each(['local','all'] as const)('removes a pattern from a shared nested group with %s scope',scope=>{
 const m=fixture(),l=m.lanes[0];
 l.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'},{id:'gb',definitionId:'b'}]},{id:'s',kind:'supergroup',name:'S',revision:0,children:[{id:'sg',definitionId:'g'}]});
 l.clips[0].mode='once';l.clips[0].children=[{id:'s1',definitionId:'s'}];l.clips.push({...structuredClone(l.clips[0]),id:'second',start:20160*16,children:[{id:'s2',definitionId:'s'}]});
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'remove',parent:['s1','sg'],ids:['ga']});
 const saved=prepareStructure(m,d,scope,{}).model;
 const read=(index:number)=>{const lane=saved.lanes[0];let def=lane.definitions.find(d=>d.id===('definitionId' in lane.clips[index].children[0]?lane.clips[index].children[0].definitionId:''))!;while(def.kind!=='pattern'){if(def.kind==='group')return def.children.map(i=>'definitionId' in i?i.definitionId:'rest');const child=def.children[0];def=lane.definitions.find(d=>d.id===('definitionId' in child?child.definitionId:''))!;}return [];};
 expect(read(0)).toEqual(['b']);expect(read(1)).toEqual(scope==='all'?['b']:['a','b']);
 expect(saved.lanes[0].clips.map(c=>c.length)).toEqual([20160*8,20160*8]);expect(saved.lanes[0].definitions.some(d=>d.id==='a')).toBe(true);
 expect(prepareStructure(JSON.parse(JSON.stringify(m)),d,scope,{}).model.lanes[0].clips).toHaveLength(2);
});
it('deletes only the selected loop pass when removing its last item locally',()=>{
 const m=fixture();m.lanes[0].clips[0].length=20160*12;
 const d=applyStructure(beginStructure(m,'lane','clip',1),{kind:'remove',parent:[],ids:['a-use']});
 const saved=prepareStructure(m,d,'local',{}).model;
 expect(saved.lanes[0].clips.map(c=>[c.start,c.length])).toEqual([[0,20160*4],[20160*8,20160*4]]);
 expect(saved.end).toBe(m.end);
});
it('assigns a distinct occurrence identity when moving between uses of one group',()=>{
 const m=fixture(),l=m.lanes[0];l.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'}]});l.clips[0].children=[{id:'g1',definitionId:'g'},{id:'g2',definitionId:'g'}];
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'move',parent:['g1'],ids:['ga'],target:{path:['g2'],index:1}});
 expect(new Set(d.roots[0].children!.map(n=>n.id)).size).toBe(2);
 expect(()=>prepareStructure(m,d,'all',{})).toThrow('incompatible');
 expect(()=>prepareStructure(m,d,'local',{})).not.toThrow();
});
it('allows identical edits to separate occurrences when saving all',()=>{
 const m=fixture(),l=m.lanes[0];l.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'}]});l.clips[0].children=[{id:'g1',definitionId:'g'},{id:'g2',definitionId:'g'}];
 let d=beginStructure(m,'lane','clip',0);
 for(const id of ['g1','g2'])d=applyStructure(d,{kind:'insert',target:{path:[id],index:1},definition:l.definitions[1],variation:false});
 expect(()=>prepareStructure(m,d,'all',{})).not.toThrow();
});
it('removes every unchanged linked use of an emptied group in the same clip',()=>{
 const m=fixture(),l=m.lanes[0];l.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'}]});l.clips[0].children=[{id:'g1',definitionId:'g'},{id:'g2',definitionId:'g'},{id:'b-root',definitionId:'b'}];
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'remove',parent:['g1'],ids:['ga']});
 const all=prepareStructure(m,d,'all',{}).model;
 expect(all.lanes[0].clips[0].children).toEqual([expect.objectContaining({definitionId:'b'})]);
});
it.each(['local','all'] as const)('rejects collisions without changing drafts or unrelated windows after %s reload',scope=>{
 const original=fixture(),l=original.lanes[0];l.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'}]});l.clips[0].children=[{id:'g-use',definitionId:'g'}];l.clips.push({id:'blocking',name:'Blocking clip',start:20160*8,length:20160*4,offset:0,mode:'once',children:[{id:'block-a',definitionId:'a'}]});
 const model=JSON.parse(JSON.stringify(original));const draft=applyStructure(beginStructure(model,'lane','clip',0),{kind:'insert',target:{path:['g-use'],index:1},definition:l.definitions[1],variation:false});
 const snapshot=JSON.stringify(draft);
 expect(()=>prepareStructure(model,draft,scope,{})).toThrow('Blocking clip');expect(JSON.stringify(draft)).toBe(snapshot);expect(model).toEqual(original);
});

it('previews the committed growth for partial passes and existing trailing silence',()=>{
 const m=fixture(),clip=m.lanes[0].clips[0];clip.offset=20160;clip.length=20160*2;
 const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:[],index:1},definition:m.lanes[0].definitions[1],variation:false});
 const saved=prepareStructure(m,d,'local',{}).model.lanes[0].clips[0];
 const geometry=structureDisplayGeometry(clip,20160*4,20160*8,0);
 expect(geometry.length).toBe(saved.length);expect(geometry.left(0)).toBe(-saved.offset);
 const once={...clip,mode:'once' as const,length:20160*16};
 expect(structureDisplayGeometry(once,20160*4,20160*8,0).length).toBe(once.length);
});


it('calculates nested drop boundaries from the occurrence tree without preview boxes',()=>{
 const m=fixture(),lane=m.lanes[0],clip=lane.clips[0];
 lane.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'},{id:'gb',definitionId:'b'}]},{id:'s',kind:'supergroup',name:'S',revision:0,children:[{id:'sg',definitionId:'g'},{id:'sb',definitionId:'b'}]});
 clip.children=[{id:'s-use',definitionId:'s'}];clip.length=20160*24;
 const layout=structureDropLayout(m,beginStructure(m,'lane','clip',1),{});
 expect(structureInsertionAt(layout,20160*18,0)).toEqual({path:[],index:1});
 expect(structureInsertionAt(layout,20160*18,25)).toEqual({path:['s-use'],index:1});
 expect(structureInsertionAt(layout,20160*18,48)).toEqual({path:['s-use','sg'],index:2});
 expect(structureInsertionAt(layout,20160*10,48)).toBeNull(); // another pass
 expect(structureInsertionAt(layout,20160*25,48)).toBeNull(); // outside the clip
});
it('uses the grown partial pass for model-based drop targets',()=>{
 const m=fixture(),clip=m.lanes[0].clips[0];clip.offset=20160;clip.length=20160*2;
 const draft=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:[],index:1},definition:m.lanes[0].definitions[1],variation:false});
 const layout=structureDropLayout(m,draft,{});
 expect([layout.start,layout.end,layout.origin]).toEqual([0,20160*4,-20160*2]);
 expect(structureInsertionAt(layout,20160*3,5)).toEqual({path:[],index:1});
 expect(structureInsertionAt(layout,20160*5,5)).toBeNull();
});

it('groups only the middle repetitions, preserves one window, and undoes expansion atomically',()=>{
 const m=fixture(),clip=m.lanes[0].clips[0];clip.length=20160*16;
 const original=structuredClone(m);
 const draft=applyStructure(beginStructure(m,'lane','clip',1),{kind:'groupRepetitions',range:{first:{pass:1,id:'a-use'},last:{pass:2,id:'a-use'}},level:'group',name:'Middle'});
 expect(m).toEqual(original);expect(draft.cursor).toBe(1);expect(draft.roots).toHaveLength(3);
 expect(draft.roots.map(n=>n.repeatIndex)).toEqual([0,1,3]);expect(draft.roots[1].children!.map(n=>n.repeatIndex)).toEqual([1,2]);
 const saved=prepareStructure(m,draft,'local',{}).model;
 expect(saved.version).toBe(4);expect(saved.lanes[0].clips).toHaveLength(1);expect(saved.lanes[0].clips[0]).toMatchObject({id:'clip',start:0,length:20160*16,offset:0,mode:'once'});
 expect(saved.lanes[0].definitions.filter(d=>d.kind==='pattern')).toEqual(m.lanes[0].definitions);
 expect(()=>prepareStructure(m,draft,'all',{})).toThrow('only this clip');
 const undone=stepStructure(draft,-1);expect(undone.roots).toEqual(beginStructure(m,'lane','clip',0).roots);expect(undone.cursor).toBe(0);
 expect(stepStructure(undone,1).roots).toEqual(draft.roots);
});

describe('timed content edits',()=>{
 const Q=20160;
 const model=()=>{const m=fixture();m.lanes[0].clips[0].mode='once';m.lanes[0].clips[0].children.push({id:'space',restTicks:4*Q});return m;};
 it('moves into silence and retains old time as a rest, with atomic undo',()=>{
  const m=model(),base=beginStructure(m,'lane','clip',0);
  const d=applyStructure(base,{kind:'timed',parent:[],ids:['a-use'],target:{path:[],index:1,ticks:4*Q}});
  const saved=prepareStructure(m,d,'local',{}).model.lanes[0].clips[0];
  expect(saved.children[0]).toMatchObject({restTicks:4*Q});expect(saved.children[1]).toHaveProperty('definitionId');expect(saved.length).toBe(8*Q);
  expect(stepStructure(d,-1).roots).toEqual(base.roots);
 });
 it('fills empty clips without appending their placeholder rest',()=>{
  const m=model();m.lanes[0].clips[0].children=[{id:'empty',restTicks:8*Q}];
  const d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'insert',target:{path:[],index:0,ticks:0},definition:m.lanes[0].definitions[0],variation:false});
  expect(d.roots[0].definition?.id).toBe('a');expect(d.roots[1].restTicks).toBe(4*Q);
 });
 it('rejects overlaps without changing the source',()=>{
  const m=model();m.lanes[0].clips[0].children[1]={id:'b-use',definitionId:'b'};const base=beginStructure(m,'lane','clip',0);
  expect(()=>applyStructure(base,{kind:'timed',parent:[],ids:['a-use'],target:{path:[],index:1,ticks:Q}})).toThrow('overlaps');expect(base.cursor).toBe(0);
 });
 it.each(['left','right'] as const)('resizes the %s edge without destroying hidden notes',edge=>{
  const m=model(),base=beginStructure(m,'lane','clip',0),payload=structuredClone(base.roots[0].definition);
  const d=applyStructure(base,{kind:'timed',parent:[],ids:['a-use'],target:{path:[],index:0,ticks:0},resize:{edge,delta:edge==='left'?Q:-Q}});
  const node=d.roots.find(n=>n.definition)!;expect(node.definition?.kind==='pattern'&&node.definition.payload.lengthBeats).toBe(3);
  if(node.definition?.kind==='pattern'&&payload?.kind==='pattern')expect(node.definition.payload).toMatchObject({...payload.payload,lengthBeats:3,stepCount:12});
  expect(d.roots.reduce((sum,n)=>sum+(n.restTicks??3*Q),0)).toBe(8*Q);
 });
 it('rejects local growth into the following loop pass',()=>{
  const m=fixture(),d=applyStructure(beginStructure(m,'lane','clip',0),{kind:'timed',parent:[],ids:['a-use'],target:{path:[],index:0,ticks:0},resize:{edge:'right',delta:Q}});
  expect(()=>prepareStructure(m,d,'local',{})).toThrow('Growth overlaps');
 });
});

it.each(['local','all'] as const)('shortens a nested trailing rest with %s scope without moving the next group',scope=>{
 const m=fixture(),lane=m.lanes[0];
 lane.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'},{id:'tail',restTicks:20160*4}]});
 lane.definitions.push({id:'h',kind:'group',name:'H',revision:0,children:[{id:'ha',definitionId:'a'},{id:'h-tail',restTicks:20160*4}]});
 lane.clips[0].mode='once';lane.clips[0].length=20160*16;lane.clips[0].children=[{id:'g-use',definitionId:'g'},{id:'next',definitionId:'h'}];
 const base=beginStructure(m,'lane','clip',0);
 const draft=applyStructure(base,{kind:'resizeRest',parent:['g-use'],ids:['tail'],ticks:20160*2},{});
 expect(draft.roots.map(n=>n.definition?.id??n.restTicks)).toEqual(['g',20160*2,'h']);
 expect(draft.roots[0].children?.slice(-1)[0]?.restTicks).toBe(20160*2);
 expect(draft.roots[2].children![1].id).toBe('h-tail');
 expect(stepStructure(draft,-1).roots).toEqual(base.roots);
 const saved=prepareStructure(m,draft,scope,{}).model;
 expect(saved.lanes[0].clips[0].length).toBe(20160*16);
 expect(saved.lanes[0].clips[0].children[1]).toMatchObject({restTicks:20160*2});
});

it('shortens or removes a trailing rest without recreating it and bounds empty clips',()=>{
 const m=fixture(),clip=m.lanes[0].clips[0];clip.mode='once';clip.children.push({id:'tail',restTicks:20160*4});
 const base=beginStructure(m,'lane','clip',0),command={kind:'resizeRest' as const,parent:[],ids:['tail'],ticks:0};
 const draft=applyStructure(base,command,{});
 expect(draft.roots).toHaveLength(1);expect(prepareStructure(m,draft,'local',{}).model.lanes[0].clips[0].length).toBe(20160*8);
 expect(()=>applyStructure(base,{...command,ids:['a-use']})).toThrow('trailing rest');
 clip.children=[{id:'tail',restTicks:20160*4}];
 expect(()=>applyStructure(beginStructure(m,'lane','clip',0),command)).toThrow('positive duration');
 expect(()=>applyStructure(base,{...command,ticks:-1})).toThrow('Invalid rest');
});

it('refreshes window metadata while preserving structural undo/redo, but rejects changed music',()=>{
 const m=fixture();m.lanes[0].clips[0].mode='once';m.lanes[0].clips[0].children.push({id:'tail',restTicks:20160*4});
 const draft=applyStructure(beginStructure(m,'lane','clip',0),{kind:'resizeRest',parent:[],ids:['tail'],ticks:20160*2});
 const trimmed=structuredClone(m);Object.assign(trimmed.lanes[0].clips[0],{name:'Trimmed',length:20160*6,start:20160,offset:5040});
 const saved=prepareStructure(trimmed,draft,'local',{}).model.lanes[0].clips[0];
 expect(saved).toMatchObject({name:'Trimmed',length:20160*6,start:20160,offset:5040});
 expect(saved.children.slice(-1)[0]).toMatchObject({restTicks:20160*2});
 const redo=stepStructure(stepStructure(draft,-1),1);
 expect(redo.roots).toEqual(draft.roots);
 expect(prepareStructure(trimmed,redo,'local',{}).model.lanes[0].clips[0]).toMatchObject({length:saved.length,offset:saved.offset,start:saved.start,name:saved.name});
 trimmed.lanes[0].definitions[0].name='Changed music';
 expect(()=>prepareStructure(trimmed,draft,'local',{})).toThrow('track changed');
});

it('shortens trailing containers along with their last rest, retaining the clip window',()=>{
 const m=fixture(),lane=m.lanes[0];lane.clips[0].mode='once';
 lane.definitions.push({id:'g',kind:'group',name:'G',revision:0,children:[{id:'ga',definitionId:'a'},{id:'tail',restTicks:20160*4}]},{id:'s',kind:'supergroup',name:'S',revision:0,children:[{id:'sg',definitionId:'g'}]});
 lane.clips[0].children=[{id:'s-use',definitionId:'s'}];
 const draft=applyStructure(beginStructure(m,'lane','clip',0),{kind:'resizeRest',parent:['s-use','sg'],ids:['tail'],ticks:20160});
 expect(draft.roots).toHaveLength(1);expect(draft.roots[0].children).toHaveLength(1);
 expect(draft.roots[0].children![0].children![1].restTicks).toBe(20160);
 expect(prepareStructure(m,draft,'local',{}).model.lanes[0].clips[0].length).toBe(20160*8);
});

it('keeps later loop passes fixed when shortening a rest locally and rejects changing every loop length',()=>{
 const m=fixture(),clip=m.lanes[0].clips[0];clip.length=20160*16;clip.children.push({id:'tail',restTicks:20160*4});
 const draft=applyStructure(beginStructure(m,'lane','clip',0),{kind:'resizeRest',parent:[],ids:['tail'],ticks:20160});
 expect(prepareStructure(m,draft,'local',{}).model.lanes[0].clips.map(c=>c.start)).toEqual([0,20160*8]);
 expect(()=>prepareStructure(m,draft,'all',{})).toThrow('another loop repetition');
});

it('keeps rendering after trimming away the edited loop pass and retains its draft',()=>{
 const m=fixture(),clip=m.lanes[0].clips[0];
 const draft=applyStructure(beginStructure(m,'lane','clip',1),{kind:'timed',parent:[],ids:['a-use'],target:{path:[],index:0,ticks:0},resize:{edge:'right',delta:-20160}});
 const trimmed=structuredClone(m);trimmed.lanes[0].clips[0].length=20160*4;
 expect(structureDisplayGeometry(trimmed.lanes[0].clips[0],20160*4,20160*4,1).length).toBe(20160*4);
 expect(()=>prepareStructure(trimmed,draft,'local',{})).toThrow('pass no longer exists');
 expect(()=>prepareStructure(m,draft,'local',{})).not.toThrow();expect(clip.length).toBe(20160*8);
});
