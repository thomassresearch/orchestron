import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { GuiLanguage, PadLoopPatternItem } from "../../types";
import { arrangementCopy } from "../../lib/arrangementCopy";
import { useAppStore } from "../../store/useAppStore";
import { usePerformanceAudition } from "./PerformanceAudition";
import { ARRANGER_PREVIEW_CANCEL } from "../../lib/arrangerPreviewGesture";

/** A gesture owns both the delayed launch and its matching release. */
export function ArrangerSpeaker({ id, item, patternId, label, language, disabled = false, children, description }: {
  id: string; item: PadLoopPatternItem; patternId?: string; label: string; language: GuiLanguage; disabled?: boolean; children?: ReactNode; description?: string;
}) {
  const audition = usePerformanceAudition();
  const status = useAppStore(state => state.performanceAuditions[id]);
  const hold = useRef<{ gesture: string; input: string; timer?: ReturnType<typeof setTimeout>; started: boolean } | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const c = arrangementCopy(language);
  const release = useCallback(() => {
    const current = hold.current;
    hold.current = null;
    setPressed(null);
    if (!current) return;
    clearTimeout(current.timer);
    if (current.started) void audition?.(id, { action: "preview_end", gestureId: current.gesture }).catch(() => {});
  }, [audition, id]);
  const itemKey = JSON.stringify(item);
  useEffect(() => release, [release, itemKey, patternId]);
  useEffect(() => {
    if (!pressed) return;
    const visibility = () => { if (document.visibilityState !== "visible") release(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && hold.current) release(); };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", release);
    window.addEventListener(ARRANGER_PREVIEW_CANCEL, release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", release);
      window.removeEventListener(ARRANGER_PREVIEW_CANCEL, release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [release, pressed]);
  const press = (input: string) => {
    if (hold.current || disabled || !audition) return;
    const current = { gesture: crypto.randomUUID(), input, started: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    hold.current = current;
    setPressed(current.gesture);
    void audition(id, { action: "preview_arm", gestureId: current.gesture });
    current.timer = setTimeout(() => {
      if (hold.current !== current) return;
      current.started = true;
      void audition(id, { action: "preview_start", gestureId: current.gesture, item, ...(patternId !== undefined ? { patternId } : {}) }).catch(() => {
        if (hold.current === current) release();
      });
    }, 250);
  };
  const releasePointer = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (hold.current?.input === `pointer:${event.pointerId}`) release();
  };
  return <button type="button" draggable={false} disabled={disabled || !audition}
    aria-label={`${c.audition} ${label}`} aria-description={description} title={[c.holdPreview, description].filter(Boolean).join(" · ")} aria-pressed={!!pressed}
    className={`ml-auto flex h-6 w-5 shrink-0 items-center justify-center rounded hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-40 ${pressed ? "bg-white/20" : ""} ${status?.preview_gesture === pressed ? "ring-1 ring-cyan-300" : ""}`}
    onPointerDown={event => { event.stopPropagation(); if (event.button !== 0 || hold.current) return; event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); press(`pointer:${event.pointerId}`); }}
    onPointerUp={releasePointer} onPointerCancel={releasePointer} onLostPointerCapture={releasePointer}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => { event.stopPropagation(); if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); if (!event.repeat) press(event.key); } if (event.key === "Escape") release(); }}
    onKeyUp={event => { event.stopPropagation(); if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); if (hold.current?.input === event.key) release(); } }} onBlur={release}>
    {children}<svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h3l4-4v14l-4-4H3Z" /><path d="M13 6a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14" /></svg>
  </button>;
}
