import { useState } from 'react';
import type { GuiLanguage } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { saveClipTransposition } from '../../store/clipActions';
import { directLinks } from '../../lib/clipArranger/operations';
import { readTransposePlan, transposeFingerprint, saveTransposeEdits, type TransposeScope } from '../../lib/clipArranger/transposeEdits';
import { addOffsets, offsetAt, emptyOffsetPlan, type PitchOffset, type OffsetPlan } from '../../lib/clipArranger/transposition';
import { logicalRepeatIndex, transposeContributions } from '../../lib/clipArranger/transposeModel';
import { arrangementTimings } from '../../lib/clipArranger/migration';
import { clipInput } from "./ClipArranger";
import { clipButtonClass } from "./buttonStyles";
import { transposeCopy } from './transposeCopy';
import { useTransposeStatus } from '../../lib/clipArranger/transposeStatus';
import { buildSequencerStepChordMidiNotes } from '../../lib/sequencer';
import { transposePitch } from '../../lib/clipArranger/transposition';
import { resolveContent, type ContentItem, type OccurrenceTarget } from '../../lib/clipArranger/model';
import { draftKey } from '../../lib/clipArranger/editorAdapter';

function PendingTranspose({laneId,language}:{laneId:string;language:GuiLanguage}) {
  const pending=useTransposeStatus(s=>s.byLane[laneId]);
  const at=useAppStore(s=>s.sequencerRuntime.transportSubunit),running=useAppStore(s=>s.sequencerRuntime.isPlaying);
  const c=transposeCopy(language);
  const sequencer=useAppStore(s=>s.sequencer),model=sequencer.clipArrangement;
  const lane=model?.lanes.find(l=>l.id===laneId),clip=lane?.clips.find(clip=>clip.id===pending?.clip_id);
  const leaf=lane&&clip&&pending?resolveContent(lane,clip.children,arrangementTimings(sequencer)[lane.id])[pending.leaf_index]:undefined;
  const index=lane&&clip&&leaf?.definition&&pending?logicalRepeatIndex(lane,clip,leaf.path,pending.logical_pass-(clip.repeatIndexBase??0)):pending?.logical_pass??0;
  return pending&&running&&at<pending.at_subunit?<p role="status" className="text-amber-200">{c.pending}: {clip?.name??''} · {c.repeat} {index+1} · #{pending.leaf_index+1}</p>:null;
}

export function TransposeInspector({ language, stopAudition, target, onSaved }: { language: GuiLanguage; stopAudition: () => Promise<void>; target?: OccurrenceTarget; onSaved?: () => void }) {
  const sequencer = useAppStore(s => s.sequencer), clipDrafts = useAppStore(s => s.clipDrafts), editingKey = useAppStore(s => s.clipEditingKey);
  const key = target ? draftKey({target}) : editingKey;
  const state = { sequencer, clipDrafts }, model = sequencer.clipArrangement;
  const draft = key ? state.clipDrafts[key] : undefined, lane = model?.lanes.find(l => l.id === draft?.target.laneId);
  const [scope, setScope] = useState<TransposeScope>('shared'), [base, setBase] = useState(false);
  const [component, setComponent] = useState<keyof PitchOffset>('diatonicSteps'), [error, setError] = useState('');
  if (!draft || !key || !lane || !model || !['sequencer','score','arpeggiator'].includes(lane.source)) return null;
  const clip = lane.clips.find(c => c.id === draft.target.clipId);
  if (!clip) return null;
  const c = transposeCopy(language), index = logicalRepeatIndex(lane,clip,draft.target.path,draft.target.pass);
  const sourceIndex=(clip.repeatIndexBase??0)+draft.target.pass;
  let plan: OffsetPlan;
  try { plan = draft.transposeEdits?.find(e => e.scope === scope)?.plan ?? readTransposePlan(model,draft.target,scope); } catch { return null; }
  const amount = base ? plan.base : offsetAt(plan,index);
  let contributions = transposeContributions(lane,clip,draft.target.path);
  const savedEffective=addOffsets(contributions.map(p=>offsetAt(p.plan,p.repeatIndex??sourceIndex)));
  try {
    const preview = saveTransposeEdits(model,draft.target,draft.transposeEdits ?? [],arrangementTimings(state.sequencer));
    const previewLane = preview.lanes.find(l => l.id === lane.id)!;
    contributions = transposeContributions(previewLane,previewLane.clips.find(p => p.id === clip.id)!,draft.target.path);
  } catch { /* A stale draft remains visible until explicitly discarded. Save reports the conflict. */ }
  const effective = addOffsets(contributions.map(p => offsetAt(p.plan,p.repeatIndex??sourceIndex)));
  const definition=draft.definition;
  const pitches=definition.kind==='pattern'&&definition.source==='score'?definition.payload.notes.map(n=>n.pitch)
    :definition.kind==='pattern'&&definition.source==='sequencer'?definition.payload.steps.flatMap(s=>s.hold?[]:buildSequencerStepChordMidiNotes(s.note,s.chord,definition.payload.scaleRoot,definition.payload.mode)):[];
  const theory=definition.kind==='pattern'&&'scaleRoot' in definition.payload?definition.payload:null;
  const omitted=theory?pitches.filter(p=>transposePitch(p,theory.scaleRoot,theory.mode,effective)===null).length:0;
  const contains=(items:ContentItem[]):boolean=>items.some(item=>{if(!('definitionId' in item))return false;if(item.definitionId===definition.id)return true;const child=lane.definitions.find(d=>d.id===item.definitionId);return !!child&&child.kind!=='pattern'&&contains(child.children);});
  const linkedClips=scope==='shared'?lane.clips.filter(window=>contains(window.children)).map(window=>window.name):[];
  const write = (next: OffsetPlan) => {
    const existing = draft.transposeEdits?.find(e => e.scope === scope);
    useAppStore.setState({ clipDrafts: { ...state.clipDrafts, [key]: { ...draft, transposeEdits: [
      ...(draft.transposeEdits ?? []).filter(e => e.scope !== scope), { scope, plan: next, fingerprint: existing?.fingerprint ?? transposeFingerprint(model,draft.target) }
    ] } } }); setError('');
  };
  const setPair = (pair: PitchOffset) => write(base ? { ...plan, base: pair } : { ...plan, repetitions: [...plan.repetitions.filter(e => e.index !== index), {index,offset:pair}].sort((a,b)=>a.index-b.index) });
  const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
  return <fieldset className="mb-3 min-w-0 max-w-full break-words space-y-2 rounded-lg border border-indigo-700 bg-indigo-950/20 p-3 text-xs">
    <legend className="max-w-full px-1 font-semibold text-indigo-200">{c.title} · {draft.definition.name} · {c.repeat} {index+1}</legend>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 max-w-full flex-col gap-1">{c.title}<select className={`${clipInput} !w-auto max-w-full`} aria-label={c.scope} value={scope} onChange={e=>setScope(e.target.value as TransposeScope)}>{(['shared','parent','placement'] as const).map(s=><option key={s} value={s}>{c[s]}</option>)}</select></label>
      <label className="flex min-w-0 max-w-full flex-col gap-1">{c.repeat}<select className={`${clipInput} !w-auto max-w-full`} value={base?'base':'repeat'} onChange={e=>setBase(e.target.value==='base')}><option value="repeat">{c.repeat} {index+1}</option><option value="base">{c.base}</option></select></label>
      <label className="flex min-w-0 max-w-full flex-col gap-1">{c.title}<select className={`${clipInput} !w-auto max-w-full`} aria-label={c.component} value={component} onChange={e=>setComponent(e.target.value as keyof PitchOffset)}><option value="diatonicSteps">{c.diatonic}</option><option value="chromaticSemitones">{c.chromatic}</option></select></label>
      <label className="flex min-w-0 max-w-full flex-col gap-1">{component==='diatonicSteps'?c.diatonic:c.chromatic}<input type="number" min={-127} max={127} step={1} className={clipInput} value={amount[component]} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isInteger(value)&&Math.abs(value)<=127)setPair({...amount,[component]:value});}} /></label>
      <span>{signed(amount.diatonicSteps)} {c.diatonic} · {signed(amount.chromaticSemitones)} {c.chromatic}</span>
    </div>
    <p>{c[scope]} · {scope==='shared'?`${draft.definition.name} · ${directLinks(lane,draft.definition.id)} ${c.linked}`:scope==='placement'?`${clip.name} / ${draft.target.path.join(' / ')}`:draft.target.path.slice(0,-1).join(' / ')||clip.name}</p>
    {linkedClips.length>0&&<p>{linkedClips.join(' · ')}</p>}
    <p className="text-indigo-200">{c.effective}: {!!draft.transposeEdits?.length&&<>{signed(savedEffective.diatonicSteps)} {c.diatonic} · {signed(savedEffective.chromaticSemitones)} {c.chromatic} → </>}{signed(effective.diatonicSteps)} {c.diatonic} · {signed(effective.chromaticSemitones)} {c.chromatic}</p>
    {omitted>0&&<p className="text-amber-200">{c.omitted}: {omitted}</p>}
    <PendingTranspose laneId={lane.id} language={language}/>
    <ul className="space-y-1 text-slate-300">{contributions.map((entry,i) => {const pair=offsetAt(entry.plan,entry.repeatIndex??sourceIndex);return <li key={i}>{entry.owner} · {c[entry.scope]}: {signed(pair.diatonicSteps)} {c.diatonic} · {signed(pair.chromaticSemitones)} {c.chromatic}</li>;})}</ul>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={clipButtonClass("edit")} onClick={()=>setPair({...amount,[component]:0})}>{c.resetComponent}</button>
      {!base && <><button type="button" className={clipButtonClass("edit")} onClick={()=>write({...plan,repetitions:plan.repetitions.filter(e=>e.index!==index)})}>{c.inherit}</button><button type="button" className={clipButtonClass("edit")} onClick={()=>setPair({diatonicSteps:0,chromaticSemitones:0})}>{c.zero}</button></>}
      <button type="button" className={clipButtonClass("edit")} onClick={()=>write(emptyOffsetPlan())}>{c.reset}</button>
      <button type="button" className={clipButtonClass("save")} disabled={!draft.transposeEdits?.length} onClick={()=>{void stopAudition().then(()=>{saveClipTransposition(key);setError('');onSaved?.();}).catch(e=>setError(String(e)));}}>{c.save}</button>
      <button type="button" className={clipButtonClass("remove")} disabled={!draft.transposeEdits?.length} onClick={()=>useAppStore.setState({clipDrafts:{...state.clipDrafts,[key]:{...draft,transposeEdits:undefined}}})}>{c.discard}</button>
      {!!draft.transposeEdits?.length && <span className="text-amber-200">{c.draft}</span>}
    </div>
    <p className="text-slate-400">{c.help} {lane.source==='arpeggiator'?c.arp:''} {c.live}</p>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
  </fieldset>;
}
