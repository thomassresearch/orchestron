import { buildBackendArpeggiatorConfigs } from '../../appOrchestration';
import { expect, it } from 'vitest';
import fixture from '../../../../backend/tests/fixtures/performances/device_names.json';
import { parseSequencerConfigSnapshot } from '../../store/appStoreModel';
import { beginDraft } from './operations';
import { clipAuditionState, clipRuntimeView } from './runtime';
import { arrangementTimings, migrateClipArrangement, sourceKeys } from './migration';
import { QUARTER_TICKS as Q, validateArrangement, type ClipArrangement, type SourceKind } from './model';

function setup(version: ClipArrangement['version'], source: SourceKind) {
  const state = parseSequencerConfigSnapshot(fixture.config, [], null).sequencer;
  for (const key of Object.values(sourceKeys)) for (const t of state[key]) { t.padLoopEnabled = true; if ('playbackMode' in t) t.playbackMode='arranger'; }
  state.pianoRolls=state.pianoRolls.slice(0,1);
  state.clipArrangement=migrateClipArrangement(state).model!;
  const model=state.clipArrangement; model.version=version;
  const lane=model.lanes.find(l=>l.source===source)!;
  model.lanes=[lane]; lane.cycleTicks=null;
  const p=lane.definitions.find(d=>d.kind==='pattern')!;
  lane.definitions=[p,{id:'g',name:'Group',revision:0,kind:'group',children:[{id:'note',definitionId:p.id},{id:'rest',restTicks:Q/4}]}];
  lane.clips=[{id:'c',name:'Clip',start:0,length:Q*4096,offset:0,mode:'once',children:[{id:'root',definitionId:'g'}]}];model.end=Q*4096;
  const target={laneId:lane.id,clipId:'c',path:['root'],pass:0};
  return {state,model,lane,p,target};
}
for(const version of [1,2,3,4] as const) for(const source of Object.keys(sourceKeys) as SourceKind[]) {
  it(`auditions exact fractional rests and large containers in v${version} ${source}`,()=>{
    const {state,model,lane,p,target}=setup(version,source);
    const before=structuredClone(state);
    const first=clipAuditionState(state,beginDraft(model,target));
    expect(first.clipContext).toBe(true);
    expect(()=>clipRuntimeView(first.state)).not.toThrow();
    const context=(first.state as typeof state & {clipAuditionContext:{schedule:{clips:{content:{length:number}[]}[]}}}).clipAuditionContext;
    expect(context.schedule.clips[0].content[1].length).toBe(Q/4);
    expect(state).toEqual(before);
    lane.definitions[1]={id:'g',name:'Group',revision:0,kind:'group',children:Array.from({length:256},(_,i)=>({id:`n${i}`,definitionId:p.id}))};
    lane.definitions.push({id:'s',name:'Supergroup',revision:0,kind:'supergroup',children:[{id:'g1',definitionId:'g'},{id:'g2',definitionId:'g'}]});
    lane.clips[0].children=[{id:'root',definitionId:'s'}];
    const result=clipAuditionState(state,beginDraft(model,target));
    expect(result.sequence).toHaveLength(1);
    expect(()=>clipRuntimeView(result.state)).not.toThrow();
  });
  it(`keeps authored music at capacity while auditioning v${version} ${source}`,()=>{
    const {state,model,lane,p,target}=setup(version,source);
    lane.definitions=Array.from({length:512},(_,i)=>({...structuredClone(p),id:`p${i}`}));
    lane.clips[0].children=[{id:'root',definitionId:'p0'}];
    validateArrangement(model,arrangementTimings(state));
    const before=structuredClone(state), draft=beginDraft(model,target);
    const result=clipAuditionState(state,draft);
    expect(result.sequence).toEqual([512]);
    if(source==='arpeggiator') {
      const wire=buildBackendArpeggiatorConfigs(result.state).find(a=>a.arpeggiator_id===lane.id)!;
      expect(wire.audition_schedule?.clips[0].content[0].pad).toBe(512);
      expect(wire.pads).toHaveLength(513);
    }
    expect(clipRuntimeView(result.state)[sourceKeys[source]][0].pads).toHaveLength(513);
    expect(()=>validateArrangement(result.state.clipArrangement!,arrangementTimings(state))).toThrow('Lane resource limit');
    expect(state).toEqual(before);
  });
}
it('ignores unrelated draft additions and rejects over-budget selected trees',()=>{
  const {state,model,lane,p,target}=setup(1,'sequencer');
  const draft=beginDraft(model,target);
  draft.additions=Array.from({length:512},(_,i)=>({...structuredClone(p),id:`unused${i}`}));
  expect(()=>clipRuntimeView(clipAuditionState(state,draft).state)).not.toThrow();
  const groups=Array.from({length:2},(_,g)=>({id:`group${g}`,name:'New group',revision:0,kind:'group' as const,children:Array.from({length:256},(_,i)=>({id:`child${g}-${i}`,definitionId:`unused${g*256+i}`}))}));
  draft.additions.push(...groups);
  draft.definition={id:'s',name:'Supergroup',revision:0,kind:'supergroup',children:groups.map((g,i)=>({id:`use${i}`,definitionId:g.id}))};
  expect(()=>clipAuditionState(state,draft)).toThrow('definition budget');
  expect(lane.definitions).toHaveLength(2);
});
