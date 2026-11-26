import { useEffect, useRef, useState } from "react";
import { arrangementHistoryStep, beginArrangementGesture, cancelArrangementEdits, endArrangementGesture, saveArrangementEdits } from "../../store/arrangementEdits";
import { useAppStore } from "../../store/useAppStore";
import { useArrangementEdits } from "../../lib/clipArranger/editSession";
import type { LaneChanges } from "../../lib/clipArranger/editImpact";
import { sourceKeys } from "../../lib/clipArranger/migration";
import { clipCopy } from "./copy";
import { editCopy } from "../../lib/clipArranger/editCopy";
import { clipButtonClass } from "./buttonStyles";
import { scopeCopy } from "../../lib/clipArranger/scopeCopy";
import type { GuiLanguage } from "../../types";
import { WorkspaceDialog } from "../sequencer/WorkspaceDialog";

export function ArrangeEditControls({ language, impact, endChanged, changed, error, stopEdit }: {
  language: GuiLanguage; impact: Map<string, LaneChanges>; endChanged: boolean; changed: boolean; error: string; stopEdit?: () => Promise<void>;
}) {
  const session = useArrangementEdits(s => s.session), sequencer = useAppStore(s => s.sequencer);
  const c = clipCopy(language), t = editCopy(language), scope = scopeCopy(language);
  const [review, setReview] = useState(false), [failure, setFailure] = useState("");
  const busy = useRef(false);
  async function apply(save: boolean) {
    if (busy.current) return;
    busy.current = true;
    const generation = useAppStore.getState().performanceWorkspaceGeneration;
    try {
      if (stopEdit) await stopEdit();
      if (useAppStore.getState().performanceWorkspaceGeneration !== generation) return;
      if (save) saveArrangementEdits(); else cancelArrangementEdits();
      setFailure(""); setReview(false);
    } catch (e) { setFailure(String(e)); setReview(true); }
    finally { busy.current = false; }
  }
  const undo = session ? !!session.past.length : !!sequencer.clipHistory?.cursor;
  const redo = session ? !!session.future.length : !!sequencer.clipHistory && sequencer.clipHistory.cursor < sequencer.clipHistory.entries.length;
  function step(forward: boolean) {
    try { arrangementHistoryStep(forward); setFailure(""); }
    catch (e) { setFailure(String(e)); setReview(true); }
  }
  useEffect(() => {
    const field = (el: Element) => el.matches('textarea,input:not([type=range]):not([type=checkbox]):not([type=button]),[contenteditable=true]');
    const relevant = (el: EventTarget | null): el is Element => el instanceof Element && !!el.closest('[data-arranger-viewport],.ws-clip-editor-host,[data-clip-properties],fieldset,section[data-clip-performance],dialog[open],.ws-inspector');
    const modal = 'dialog[open], [role="dialog"][aria-modal="true"]';
    const down = (e: PointerEvent) => { if (relevant(e.target)) beginArrangementGesture(e.target); };
    const focus = (e: FocusEvent) => { if (relevant(e.target) && field(e.target)) beginArrangementGesture(e.target); };
    const up = (e: PointerEvent) => { if (!(e.target instanceof Element && field(e.target))) endArrangementGesture(); };
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.target instanceof Element && field(e.target)) return;
      if (document.querySelector(modal) || !(e.target instanceof Element)) return;
      if (e.target !== document.body && !e.target.closest('[data-clip-performance],.ws-clip-editor-host,.ws-inspector,.arranger-edit-controls,.ws-editor-command')) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && !(key === "y" && e.ctrlKey && !e.shiftKey)) return;
      e.preventDefault(); step(key === "y" || e.shiftKey);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointerup", up);
    document.addEventListener("focusin", focus); document.addEventListener("focusout", endArrangementGesture);
    document.addEventListener("pointercancel", endArrangementGesture);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up);
      document.removeEventListener("focusin", focus); document.removeEventListener("focusout", endArrangementGesture);
      document.removeEventListener("pointercancel", endArrangementGesture); endArrangementGesture();
    };
  }, []);
  const count = [...impact.values()].reduce((n, lane) => n + lane.clips.size, 0);
  return <span className="arranger-edit-controls" role="group" aria-label={t.changes}>
    <button className={clipButtonClass("edit")} disabled={!undo} onClick={() => step(false)}>{c.undo}</button>
    <button className={clipButtonClass("edit")} disabled={!redo} onClick={() => step(true)}>{c.redo}</button>
    <button className={clipButtonClass("save")} disabled={!changed || !!error} onClick={() => void apply(true)}>{c.save}</button>
    <button className={clipButtonClass("remove")} disabled={!session && !changed} onClick={() => void apply(false)}>{c.cancel}</button>
    {changed && <button className="arranger-change-summary" onClick={() => setReview(true)} title={t.changes}>
      ✎ {count ? `${count} ${count === 1 ? t.oneClip : t.clips} · ${impact.size} ${impact.size === 1 ? t.oneTrack : t.tracks}` : endChanged ? c.songEnd : t.changes}
    </button>}
    {review && <WorkspaceDialog title={t.changes} onClose={() => setReview(false)}>
      {(failure || error) && <p role="alert">{failure || error}</p>}
      {endChanged && <p>{c.songEnd}</p>}
      {[...impact].map(([id, lane]) => <section key={id}>
        <strong>{Object.values(sourceKeys).flatMap(source => sequencer[source].map(track => ({id:track.id,name:track.name}))).find(track => track.id === id)?.name ?? id}</strong>
        {lane.reordered && <p>{t.reordered}</p>}
        <ul>{[...lane.clips.values()].map(change => <li key={change.clip.id}>{change.clip.name} · {t[change.kind]} · {change.linked ? scope.linked : scope.editingLocal}</li>)}</ul>
      </section>)}
      <button className={clipButtonClass("edit")} onClick={() => setReview(false)}>{c.close}</button>
    </WorkspaceDialog>}
  </span>;
}
