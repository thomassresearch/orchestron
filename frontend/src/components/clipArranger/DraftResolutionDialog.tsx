import { useEffect, useRef } from "react";
import type { GuiLanguage } from "../../types";
import { useClipResolution } from "../../lib/clipArranger/draftResolution";
import { clipButton, clipButtonClass } from "./buttonStyles";
import { clipCopy } from "./copy";
export function DraftResolutionDialog({ language }: { language: GuiLanguage }) {
  const pending = useClipResolution(s => s.pending), dialog = useRef<HTMLDialogElement>(null), c = clipCopy(language);
  useEffect(() => {
    if (!pending) return;
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { before?.focus(); if (useClipResolution.getState().pending === pending) pending.resolve(false); };
  }, [pending]);
  return pending ? <dialog ref={dialog} aria-label={c.pending} onCancel={e => { e.preventDefault(); pending.resolve(false); }} className="max-w-lg space-y-4 rounded-xl border border-slate-600 bg-slate-900 p-5 text-slate-200 backdrop:bg-black/70">
    <p>{c.pending}</p><p className="text-xs text-slate-400">{pending.replace ? c.discardExplanation : c.savedExplanation}</p>
    <div className="flex justify-end gap-2"><button autoFocus className={clipButton} onClick={() => pending.resolve(false)}>{c.backToDrafts}</button><button className={clipButtonClass(pending.replace ? "remove" : "edit")} onClick={() => pending.resolve(true)}>{pending.replace ? c.discardDrafts : c.useSaved}</button></div>
  </dialog> : null;
}
