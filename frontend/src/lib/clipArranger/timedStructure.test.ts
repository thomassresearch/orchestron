import { expect,it } from 'vitest';
import { copyNodes, nodeTicks, resizeNode } from './timedStructure';
import { beginStructure,applyStructure } from './structure';
import { defaultDrummerSequencerTrack, defaultSequencerPads } from '../../store/appStoreModel';
import { useAppStore } from '../../store/useAppStore';
import type { ClipArrangement, LaneTiming } from './model';
const Q=20160;
const model=():ClipArrangement=>({version:1,revision:0,end:16*Q,lanes:[{id:'a',source:'sequencer',cycleTicks:null,definitions:[{id:'p',kind:'pattern',source:'sequencer',name:'Pattern',revision:0,payload:defaultSequencerPads()[0]}],clips:[{id:'c',name:'Clip',start:0,length:8*Q,mode:'once',offset:0,children:[{id:'use',definitionId:'p'},{id:'rest',restTicks:4*Q}]}]}]});
it('copies linked occurrences with fresh occurrence IDs and an unchanged source',()=>{
 const m=model(),source=m.lanes[0],nodes=beginStructure(m,'a','c',0).roots,snapshot=structuredClone(nodes);
 const copies=copyNodes(nodes,source,source,useAppStore.getInitialState().sequencer,{});
 expect(copies[0].id).not.toBe(nodes[0].id);expect(copies[0].definition?.id).toBe('p');expect(nodes).toEqual(snapshot);
});
it('copies independent definitions and converts rests to destination beat timing',()=>{
 const m=model(),source=m.lanes[0],destination={...source,id:'b'};
 const base=useAppStore.getInitialState().sequencer.timing;
 const timings:LaneTiming={a:{...base,beatRateNumerator:1,beatRateDenominator:1,meterDenominator:4},b:{...base,beatRateNumerator:2,beatRateDenominator:1,meterDenominator:4}};
 const nodes=copyNodes(beginStructure(m,'a','c',0).roots,source,destination,useAppStore.getInitialState().sequencer,timings);
 expect(nodes[0].definition?.id).not.toBe('p');expect(nodes[1].restTicks).toBe(2*Q);expect(nodeTicks(nodes[0],timings.b)).toBe(2*Q);
});
it('rejects incompatible track types',()=>{const m=model();expect(()=>copyNodes(beginStructure(m,'a','c',0).roots,m.lanes[0],{...m.lanes[0],id:'b',source:'score'},useAppStore.getInitialState().sequencer,{})).toThrow('same type');});
it('keeps a self-overlapping move valid after vacating its source',()=>{
 const m=model(),draft=applyStructure(beginStructure(m,'a','c',0),{kind:'timed',parent:[],ids:['use'],target:{path:[],index:0,ticks:Q}});
 expect(draft.roots[0].restTicks).toBe(Q);expect(draft.roots[1].id).toBe('use');expect(draft.roots[2].restTicks).toBe(3*Q);
});
it('rejects zero length',()=>{const m=model();expect(()=>resizeNode(beginStructure(m,'a','c',0).roots[0],0,undefined)).toThrow('limits');});
it('keeps same-track container copies linked to the original definition',()=>{
 const m=model(),lane=m.lanes[0];lane.definitions.push({id:'g',name:'Group',kind:'group',revision:0,children:[{id:'child',definitionId:'p'}]});lane.clips[0].children=[{id:'group-use',definitionId:'g'}];
 const nodes=copyNodes(beginStructure(m,'a','c',0).roots,lane,lane,useAppStore.getInitialState().sequencer,{});
 expect(nodes[0].definition?.id).toBe('g');expect(nodes[0].children![0].id).toBe('child');expect(nodes[0].id).not.toBe('group-use');
});
it('maps drum hits by MIDI key and rejects missing or ambiguous used keys',()=>{
 const state=structuredClone(useAppStore.getInitialState().sequencer);
 const track=defaultDrummerSequencerTrack();state.drummerTracks=[track];
 const source={...model().lanes[0],id:track.id,source:'drummer' as const};
 const destination={...source,id:'destination'};
 const row=track.rows[0];state.drummerTracks.push({...structuredClone(track),id:'destination',rows:[{id:'mapped',key:row.key}]});
 const nodes=[{id:'drum-use',definition:{id:'drum',name:'Drum',revision:0,kind:'pattern' as const,source:'drummer' as const,payload:{...structuredClone(track.pads[0]),rows:[{rowId:row.id,steps:[{active:true,velocity:100}]}]}}}];
 const result=copyNodes(nodes,source,destination,state,{});
 const def=result[0].definition;if(def?.kind==='pattern'&&def.source==='drummer')expect(def.payload.rows[0].rowId).toBe('mapped');
 state.drummerTracks[1].rows=[];
 expect(()=>copyNodes(nodes,source,destination,state,{})).toThrow('missing or ambiguous');
 state.drummerTracks[1].rows=[{id:'one',key:row.key},{id:'two',key:row.key}];
 expect(()=>copyNodes(nodes,source,destination,state,{})).toThrow('missing or ambiguous');
});
