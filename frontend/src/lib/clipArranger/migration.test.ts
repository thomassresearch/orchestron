import { expect, it } from 'vitest';
import named from '../../../../backend/tests/fixtures/performances/device_names.json';
import legacy from '../../../../backend/tests/fixtures/performances/legacy_master.json';
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot } from '../../store/appStoreModel';
import { buildPerformanceExportPayload, parsePerformanceExportPayload } from '../bundleImportExport';
import { compilePadLoopPattern } from '../padLoopPattern';
import { migrateClipArrangement, sourceKeys } from './migration';

// Real versioned snapshots; never claim old-version coverage by relabeling new data.
for (const [name, raw] of Object.entries({named:named.config, legacy})) {
  it(`migrates and restores the ${name} snapshot without losing source payloads`,()=>{
    const initial=parseSequencerConfigSnapshot(raw,[],null);
    const state=initial.sequencer;
    state.pianoRolls=state.pianoRolls.slice(0,1);
    for(const key of Object.values(sourceKeys)) for(const track of state[key]) {
      track.padLoopEnabled=true;
      if('playbackMode' in track) track.playbackMode='arranger';
      track.padLoopRepeat=true;
      track.padLoopPattern={rootSequence:[{type:'super',superGroupId:'I'}],groups:[{id:'G',sequence:[{type:'pad',padIndex:0},{type:'pause',lengthBeats:2},{type:'pad',padIndex:0}]}],superGroups:[{id:'I',sequence:[{type:'group',groupId:'G'}]}],definitionColors:{'pad:0':'#123456','group:G':'#abcdef'}};
      if ('padLoopSequence' in track) track.padLoopSequence=compilePadLoopPattern(track.padLoopPattern).sequence;
    }
    const original=buildSequencerConfigSnapshot(state,initial.instruments,initial.audioGraph,initial.mixer);
    if(name==='legacy') {
      expect(original.instruments.length).toBeGreaterThan(0);
      expect(Object.keys(original.mixer?.strips ?? {}).length).toBeGreaterThan(0);
      expect(original.audioGraph?.routes.length ?? 0).toBeGreaterThan(0);
    }
    const report=migrateClipArrangement(state);
    expect(report.reasons).toEqual([]);
    expect(report.original).toEqual(state);
    expect(report.model!.lanes.every(l=>l.cycleTicks!>0)).toBe(true);
    for(const lane of report.model!.lanes) {
      const track=state[sourceKeys[lane.source]].find(t=>t.id===lane.id)!;
      expect(lane.definitions.filter(d=>d.kind==='pattern').map(d=>d.payload)).toEqual(track.pads);
      expect(lane.definitions[0].color).toBe('#123456');
    }
    const migrated={...state,clipArrangement:report.model!};
    const snapshot=buildSequencerConfigSnapshot(migrated,initial.instruments,initial.audioGraph,initial.mixer);
    const native=buildPerformanceExportPayload({snapshot,selectedPatches:[],performanceName:'Recovery',performanceDescription:''}).payload;
    const imported=parsePerformanceExportPayload(JSON.parse(JSON.stringify(native)))!;
    const roundtrip=parseSequencerConfigSnapshot(imported.performance.config,[],null);
    expect(roundtrip.sequencer.clipArrangement).toEqual(report.model);
    expect(roundtrip.instruments).toEqual(initial.instruments);
    expect(roundtrip.audioGraph).toEqual(initial.audioGraph);
    expect(roundtrip.mixer).toEqual(initial.mixer);
    // This is the same raw config reader used by Import for the downloaded original.
    const restored=parseSequencerConfigSnapshot(JSON.parse(JSON.stringify(original)),[],null);
    expect(buildSequencerConfigSnapshot(restored.sequencer,restored.instruments,restored.audioGraph,restored.mixer)).toEqual(original);
    expect(restored.sequencer.clipArrangement).toBeUndefined();
  });
}
it.each(['manual','live','keyboards'] as const)('rejects %s conversion without modifying the original',kind=>{
  const state=parseSequencerConfigSnapshot(named.config,[],null).sequencer;
  state.pianoRolls=state.pianoRolls.slice(0,1);
  for(const key of Object.values(sourceKeys)) for(const track of state[key]) {track.padLoopEnabled=true;if('playbackMode' in track)track.playbackMode='arranger';}
  if(kind==='manual')state.tracks[0].padLoopEnabled=false;
  if(kind==='live')state.arpeggiators[0].playbackMode='live';
  if(kind==='keyboards')state.pianoRolls.push({...state.pianoRolls[0],id:'extra'});
  const before=structuredClone(state),report=migrateClipArrangement(state);
  expect(report.model).toBeNull();expect(report.reasons.join(' ')).toContain({manual:'manual-source:',live:'live-arpeggiator:',keyboards:'multiple-keyboards'}[kind]);
  expect(state).toEqual(before);expect(report.original).toEqual(before);
});

it.each(Object.keys(sourceKeys))('preserves hidden %s data and metadata through both save scopes',async source=>{
  const {beginDraft,saveDraft,definitionAt}=await import('./operations');
  const {clipEditorView}=await import('./editorAdapter');
  const {arrangementTimings}=await import('./migration');
  const state=parseSequencerConfigSnapshot(named.config,[],null).sequencer;
  state.pianoRolls=state.pianoRolls.slice(0,1);
  for(const key of Object.values(sourceKeys))for(const t of state[key]){t.padLoopEnabled=true;if('playbackMode' in t)t.playbackMode='arranger';}
  const model=migrateClipArrangement(state).model!,lane=model.lanes.find(l=>l.source===source)!;
  state.clipArrangement=model;
  const pattern=lane.definitions.find(d=>d.kind==='pattern')!;
  if(pattern.kind!=='pattern')throw Error('fixture pattern');
  pattern.presetId='preserved-preset';
  if(pattern.source==='sequencer') {pattern.payload.lengthBeats=1;pattern.payload.steps.slice(-1)[0].note=91;}
  if(pattern.source==='score') {pattern.payload.lengthBeats=1;pattern.payload.notes.push({id:'hidden',pitch:91,velocity:80,startTicks:20160*4,durationTicks:20160});}
  if(pattern.source==='drummer') {pattern.payload.lengthBeats=1;const hit=pattern.payload.rows[0].steps.slice(-1)[0];hit.ratchets=4;hit.ratchetEndVelocity=23;}
  if(pattern.source==='arpeggiator') {pattern.payload.randomSeed=48271;pattern.payload.octaves=3;}
  if(pattern.source==='controller') {pattern.payload.steps[0]=0;pattern.payload.steps[1]=null;pattern.payload.keypoints[0].value=0;pattern.payload.keypoints.slice(-1)[0].value=127;}
  lane.cycleTicks=null;
  lane.clips=[{id:'capability-clip',name:'Capabilities',start:0,length:32*20160,offset:0,mode:'once',children:[{id:'root-a',definitionId:pattern.id},{id:'root-b',definitionId:pattern.id}]}];
  model.end=Math.max(model.end,32*20160);
  const target={laneId:lane.id,clipId:lane.clips[0].id,path:['root-a'],pass:0};
  for(const scope of ['local','all'] as const){
    const draft=beginDraft(model,target);draft.definition.name='Edited';
    const view=clipEditorView(state,draft);
    expect(view[sourceKeys[lane.source]].find(t=>t.id===lane.id)!.pads[0]).toEqual(pattern.payload);
    const next=saveDraft(model,draft,scope,arrangementTimings(state));
    const snapshot=buildSequencerConfigSnapshot({...state,clipArrangement:next},[]);
    const restored=parseSequencerConfigSnapshot(snapshot,[],null).sequencer.clipArrangement!;
    const restoredLane=restored.lanes.find(l=>l.id===lane.id)!;
    const edited=definitionAt(restoredLane,target);
    expect(edited).toMatchObject({payload:pattern.payload,presetId:'preserved-preset'});
    expect(definitionAt(restoredLane,{...target,path:['root-b']}).name).toBe(scope==='all'?'Edited':pattern.name);
  }
});
