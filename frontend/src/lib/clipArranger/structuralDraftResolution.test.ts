import { expect, it } from 'vitest';
import { defaultSequencerPads } from '../../store/appStoreModel';
import { type ClipArrangement, type PatternDefinition } from './model';
import { beginDraft, saveDraft } from './operations';
import { applyStructure, beginStructure, prepareStructure, stepStructure } from './structure';
import { affectedDraftKeys, rebaseStructure, remapMusicalTarget, retainMusicalDrafts } from './structuralDraftResolution';
function fixture():ClipArrangement {
 const patterns:PatternDefinition[]=['a','b'].map(id=>({id,name:id,kind:'pattern',source:'sequencer',revision:0,payload:defaultSequencerPads()[0]}));
 return {version:1,revision:0,end:20160*40,lanes:[{id:'lane',source:'sequencer',cycleTicks:null,definitions:patterns,clips:[{id:'clip',name:'Original',start:0,length:20160*16,offset:0,mode:'loop',children:[{id:'a-use',definitionId:'a'},{id:'b-use',definitionId:'b'}]},{id:'independent',name:'Independent',start:20160*32,length:20160*8,offset:0,mode:'once',children:[{id:'other-a',definitionId:'a'}]}]}]};
}
it.each(['local','all'] as const)('rebases generated container identities and full draft undo/redo after a %s musical save',scope=>{
 const m=fixture();let structure=beginStructure(m,'lane','clip',0);
 structure=applyStructure(structure,{kind:'group',parent:[],ids:['a-use','b-use'],level:'group',name:'New group'});
 structure=applyStructure(structure,{kind:'rest',target:{path:[structure.roots[0].id],index:2},ticks:20160});
 structure=stepStructure(structure,-1);
 const musical=beginDraft(m,{laneId:'lane',clipId:'clip',pass:0,path:['a-use']});musical.definition.name='Edited a';
 const saved=saveDraft(m,musical,scope),rebased=rebaseStructure(structure,saved,{});
 expect(rebased.cursor).toBe(1);expect(rebased.history).toHaveLength(3);
 const redo=stepStructure(rebased,1);expect(redo.roots[0].children).toHaveLength(3);expect(redo.roots[0].children![0].definition?.name).toBe('Edited a');
 const committed=prepareStructure(saved,redo,'local',{}).model;
 expect(committed.lanes[0].clips.find(c=>c.id==='clip')!.length).toBe(20160*9);
 const following=committed.lanes[0].clips.find(c=>c.id!=='clip'&&c.id!=='independent')!;
 expect([following.start,following.length]).toEqual([20160*9,20160*8]);
 expect(committed.lanes[0].clips.find(c=>c.id==='independent')!.start).toBe(20160*32);
});
it('retargets an unrelated dirty draft in a later generated pass after local musical save',()=>{
 const m=fixture(),target={laneId:'lane',clipId:'clip',pass:1,path:['b-use']};
 const later=beginDraft(m,target);later.definition.name='Unsaved b';
 const first=beginDraft(m,{...target,pass:0,path:['a-use']});first.definition.name='Saved a';
 const saved=saveDraft(m,first,'local');
 const mapped=remapMusicalTarget(m,saved,target,{});
 expect(mapped.clipId).not.toBe('clip');expect(mapped.pass).toBe(1);
 const retained=retainMusicalDrafts(m,saved,{first,later},'first',{});
 expect(Object.values(retained.drafts)).toEqual([{...later,target:mapped}]);
 expect(affectedDraftKeys(m,saved,{later})).toEqual(['later']);
});
