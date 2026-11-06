import { useEffect, useRef } from 'react';
import type { GuiLanguage } from '../../types';
import type { OccurrenceTarget } from '../../lib/clipArranger/model';
import type { PitchOffset } from '../../lib/clipArranger/transposition';
import { draftKey } from '../../lib/clipArranger/editorAdapter';
import { useAppStore } from '../../store/useAppStore';
import { TransposeInspector } from './TransposeInspector';
import { transposeCopy } from './transposeCopy';
import { clipButton } from './ClipArranger';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Header height stays unchanged so structural drag/drop hit testing stays aligned. */
export function LaneTransposeBadge({ target, name, index, offset, width, language, onOpen }: {
  target: OccurrenceTarget; name: string; index: number; offset: PitchOffset; width: number;
  language: GuiLanguage; onOpen: (target: OccurrenceTarget, trigger: HTMLButtonElement) => void;
}) {
  const c = transposeCopy(language), key = draftKey({target});
  const dirty = useAppStore(s=>!!s.clipDrafts[key]?.transposeEdits?.length);
  const active = offset.diatonicSteps !== 0 || offset.chromaticSemitones !== 0;
  const values = [offset.diatonicSteps ? `D${signed(offset.diatonicSteps)}` : '', offset.chromaticSemitones ? `C${signed(offset.chromaticSemitones)}` : ''].filter(Boolean).join(' ');
  const description = `${c.title}: ${name} · ${c.repeat} ${index+1} · ${c.effective}: ${signed(offset.diatonicSteps)} ${c.diatonic} · ${signed(offset.chromaticSemitones)} ${c.chromatic}${dirty ? ` · ${c.draft}` : ''}`;
  return <button type="button" data-transpose-target={JSON.stringify(target)} data-transpose-active={active} aria-label={description} title={`${description}. ${c.laneHelp}`} aria-haspopup="dialog"
    className={`pointer-events-auto relative z-30 flex h-5 min-w-7 max-w-[60%] shrink-0 items-center justify-center gap-1 truncate rounded border px-1 font-mono text-xs font-semibold leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${dirty?'border-amber-400 bg-amber-950 text-amber-100':active?'border-indigo-300 bg-indigo-800 text-white':'border-indigo-400/70 bg-indigo-950 text-indigo-100 hover:border-indigo-200 hover:bg-indigo-800'}`}
    onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onContextMenu={e=>{e.preventDefault();e.stopPropagation();}}
    onClick={e=>{e.stopPropagation();onOpen(target,e.currentTarget);}}>
    <span aria-hidden="true" className="text-lg leading-none">↕</span>{active && values.length*7.25+36 <= width*.6 && <span>{values}</span>}{dirty?'*':''}
  </button>;
}

/** Native dialog provides focus trapping/Escape and escapes the timeline's clipping. */
export function LaneTransposeDialog({target, language, trigger, stopAudition, onClose}: {
  target: OccurrenceTarget; language: GuiLanguage; trigger: HTMLButtonElement;
  stopAudition: ()=>Promise<void>; onClose: ()=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null), c=transposeCopy(language);
  useEffect(()=>{
    const node=dialog.current;
    node?.showModal();
    return ()=>{node?.close();if(trigger.isConnected)trigger.focus();};
  },[trigger]);
  return <dialog ref={dialog} aria-label={c.laneTitle} className="w-[min(94vw,720px)] max-h-[85vh] overflow-y-auto rounded-xl border border-indigo-500 bg-slate-950 p-4 text-slate-100 shadow-2xl backdrop:bg-black/40"
    onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-indigo-200">{c.laneTitle}</h3><button type="button" className={clipButton} onClick={onClose}>{c.close}</button></div>
    <TransposeInspector target={target} language={language} stopAudition={stopAudition} onSaved={onClose}/>
    <p className="text-xs text-slate-400">{c.closeHelp}</p>
  </dialog>;
}
