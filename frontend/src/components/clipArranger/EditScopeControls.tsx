import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GuiLanguage } from '../../types';
import type { DefinitionRelationship, EditScope } from '../../lib/clipArranger/relationships';
import { clipButton, clipButtonClass } from './buttonStyles';
import { arrangeCopy } from './arrangeCopy';
import { clipCopy } from './copy';
import { scopeCopy } from '../../lib/clipArranger/scopeCopy';

export function RelationshipSummary({ relationship, language }: { relationship?: DefinitionRelationship; language: GuiLanguage }) {
  const t = scopeCopy(language);
  return relationship ? <span>{relationship.shared ? t.linked : t.independent} · {relationship.occurrences} {t.occurrences} · {relationship.clipIds.length} {t.clips}{relationship.retained && <span title={t.retained} aria-label={t.retained}> · ◇</span>}</span> : null;
}

export function EditScopeControls({ scope, language, onChoose, relationship, kind = 'pattern', localOnly = false, repeat = false, splitWindows, variationName, patternName, nameInputRef, onNameChange, children }: {
  scope: EditScope | null; language: GuiLanguage; onChoose: (scope: EditScope) => void;
  relationship?: DefinitionRelationship; kind?: 'pattern' | 'group' | 'supergroup' | 'structure'; localOnly?: boolean; repeat?: boolean;
  splitWindows?: [number, number][];
  variationName?: string; patternName?: string; nameInputRef?: React.RefObject<HTMLInputElement>; onNameChange?: (name: string) => void; children?: ReactNode;
}) {
  const c = clipCopy(language), t = scopeCopy(language), [changing, setChanging] = useState(false);
  const choose = (next: EditScope) => { onChoose(next); setChanging(false); };
  return <div data-edit-scope={kind} className={kind === "pattern" ? "mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" : "mb-3 space-y-2 text-xs"} aria-label={t.choose}>
    <div className="flex flex-wrap items-center gap-2"><strong className="font-medium">{scope === 'local' ? t.editingLocal : scope === 'all' ? relationship && !relationship.shared ? t.independent : t.editingAll : t.choose}</strong>
      {(scope || kind !== "pattern") && <RelationshipSummary relationship={relationship} language={language} />}
      {scope && !localOnly && (repeat || !relationship || relationship.shared) && <button className={clipButton} onClick={() => setChanging(!changing)} aria-expanded={changing}>{t.change}</button>}
    </div>
    {(!scope || changing) && <div className="flex flex-wrap gap-2">
      <button className={clipButtonClass('edit')} disabled={localOnly} aria-pressed={scope === 'all'} onClick={() => choose('all')}>{kind === 'structure' ? t.allDefinitions : t[kind]}{relationship ? ` (${relationship.occurrences})` : ''}</button>
      <button className={clipButtonClass('add')} aria-pressed={scope === 'local'} onClick={() => choose('local')}>{kind === 'structure' ? c.local : t.variation}</button>
    </div>}
    {!scope && kind !== "pattern" && <p>{t.chooseHint}</p>}
    {localOnly && <p>{t.localOnly}</p>}
    {scope && (scope === 'local' || patternName !== undefined) && onNameChange && <label className="flex flex-wrap items-center gap-2">{scope === "local" ? c.variation : arrangeCopy(language).patternName}<input ref={nameInputRef} maxLength={128} value={scope === "local" ? variationName ?? "" : patternName} onChange={e => onNameChange(e.target.value)} className="min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1" /></label>}
    {repeat && scope !== 'all' && <details className="text-amber-200"><summary className="cursor-pointer">{arrangeCopy(language).loopDetails}</summary><p>{!scope && `${c.local}: `}{c.repeatImpact}{splitWindows && <> {c.beats}: {splitWindows.map(([from,to])=>`${from/20160}–${to/20160}`).join(' / ')}.</>}</p></details>}
    {children}
  </div>;
}

export function EditScopeDialog({ language, onCancel, children }: { language: GuiLanguage; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), t = scopeCopy(language);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal?.(); return () => { ref.current?.close?.(); previous?.focus(); }; }, []);
  return <dialog ref={ref} aria-label={t.choose} onCancel={e => { e.preventDefault(); onCancel(); }} className="max-h-[80vh] w-[min(95vw,560px)] space-y-3 overflow-auto rounded-xl border border-slate-600 bg-slate-900 p-4 text-slate-200 backdrop:bg-black/70">
    {children}<button className={clipButton} onClick={onCancel}>{clipCopy(language).cancel}</button>
  </dialog>;
}
