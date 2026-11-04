import { describe,expect,it } from 'vitest';
import { applyStructure,beginStructure,prepareStructure,stepStructure } from './structure';
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
 const changed=structuredClone(m);changed.lanes[0].clips[0].length++;
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
