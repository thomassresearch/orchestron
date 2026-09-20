import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GuiLanguage } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { arrangerHistoryCopy } from "../../lib/arrangerHistoryCopy";
import { ArrangerContextMenu, type ArrangerMenuTarget } from "./ArrangerContextMenu";

export function ArrangerHistoryControls({ language, collapsed }: { language: GuiLanguage; collapsed: boolean }) {
  const history = useAppStore(s => s.arrangerHistory);
  const notice = useAppStore(s => s.arrangerHistoryNotice);
  const generation = useAppStore(s => s.performanceWorkspaceGeneration);
  const page = useAppStore(s => s.activePage);
  const [menu, setMenu] = useState<(ArrangerMenuTarget & { redo: boolean }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const suppressed = useRef(false);
  const controls = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<boolean | null>(null);
  const c = arrangerHistoryCopy(language);
  const cancel = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; origin.current = null; };
  useEffect(() => {
    cancel(); setMenu(null);
  }, [collapsed, generation, page, history]);
  useLayoutEffect(() => {
    if (restoreFocus.current === null) return;
    const buttons = controls.current?.querySelectorAll<HTMLButtonElement>("button");
    const preferred = buttons?.[Number(restoreFocus.current)];
    const fallback = controls.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (preferred?.disabled ? fallback : preferred)?.focus();
    restoreFocus.current = null;
  }, [history]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => useAppStore.setState({ arrangerHistoryNotice: false }), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    const blur = () => { cancel(); suppressed.current = true; setMenu(null); };
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("blur", blur); cancel(); };
  }, []);
  const open = (anchor: HTMLElement, redo: boolean) => {
    const bounds = anchor.getBoundingClientRect();
    setMenu({ anchor, x: bounds.left, y: bounds.bottom + 4, redo });
  };
  const step = (redo: boolean) => { const s = useAppStore.getState(); if (redo) s.redoArranger(); else s.undoArranger(); };
  const choices = menu?.redo ? history.entries.map((entry, i) => ({ entry, target: i + 1 })).slice(history.cursor)
    : history.entries.slice(0, history.cursor).map((entry, i) => ({ entry, target: i })).reverse();
  return <>
    <div ref={controls} className="flex items-center gap-1" aria-label={`${c.undo} / ${c.redo}`}>
      {[false, true].map(redo => {
        const next = history.entries[history.cursor - Number(!redo)];
        return <button key={String(redo)} type="button" aria-label={redo ? c.redo : c.undo} aria-haspopup="menu" aria-expanded={menu?.redo === redo}
          disabled={redo ? history.cursor === history.entries.length : history.cursor === 0}
          title={`${redo ? c.redo : c.undo}${next ? `: ${c.label(next)}` : ""} · ${c.hold}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-600 bg-slate-900 text-slate-200 hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          onPointerDown={event => {
            if (event.button !== 0) return;
            cancel(); suppressed.current = false; origin.current = { x: event.clientX, y: event.clientY };
            const anchor = event.currentTarget;
            timer.current = setTimeout(() => { timer.current = null; origin.current = null; suppressed.current = true; open(anchor, redo); }, 500);
          }}
          onPointerMove={event => { if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) >= 4) { cancel(); suppressed.current = true; } }}
          onPointerLeave={() => { if (timer.current !== null) { cancel(); suppressed.current = true; } }}
          onPointerUp={cancel} onPointerCancel={() => { cancel(); suppressed.current = true; }}
          onLostPointerCapture={() => { if (timer.current !== null) { cancel(); suppressed.current = true; } }}
          onBlur={cancel}
          onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); cancel(); open(event.currentTarget, redo); }
            if (event.key === "Enter" || event.key === " ") suppressed.current = false;
          }}
          onClick={() => { cancel(); if (suppressed.current) { suppressed.current = false; return; } step(redo); }}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={redo ? { transform: "scaleX(-1)" } : undefined}>
            <path d="M7 3 3 7l4 4M3 7h8a5 5 0 0 1 0 10H8" />
          </svg>
        </button>;
      })}
    </div>
    {notice && <span role="status" className="max-w-72 text-xs text-amber-200">{c.cleared}</span>}
    {menu && <ArrangerContextMenu target={menu} title={menu.redo ? c.future : c.past} onClose={() => setMenu(null)}>
      {choices.map(({ entry, target }) => <button key={target} type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-700 focus:bg-slate-700"
        onClick={() => { restoreFocus.current = menu.redo; useAppStore.getState().goToArrangerHistory(target); setMenu(null); }}>
        <span className="mr-2 inline-block w-5 text-right tabular-nums text-slate-400">{target + Number(!menu.redo)}</span>{c.label(entry)}
      </button>)}
    </ArrangerContextMenu>}
  </>;
}
