import { useCallback, useEffect, useRef, useState } from "react";
import { auditionCopy } from "../../lib/auditionCopy";
import type { GuiLanguage } from "../../types";

const black = (note: number) => [1, 3, 6, 8, 10].includes(note % 12);
const label = (note: number) => `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][note % 12]}${Math.floor(note / 12) - 1} (${note})`;

export function AuditionKeyboard({ initialNote, disabled, language, pressNote }: {
  initialNote: number; disabled: boolean; language: GuiLanguage; pressNote: (note: number) => () => void;
}) {
  const copy = auditionCopy(language);
  const [start, setStart] = useState(() => Math.min(108, Math.floor(initialNote / 12) * 12));
  const [held, setHeld] = useState<number[]>([]);
  const presses = useRef(new Map<string, { note: number; release: () => void }>());
  const release = useCallback((id: string) => {
    presses.current.get(id)?.release(); presses.current.delete(id);
    setHeld([...presses.current.values()].map(p => p.note));
  }, []);
  const releaseAll = useCallback(() => {
    for (const press of presses.current.values()) press.release();
    presses.current.clear(); setHeld([]);
  }, []);
  useEffect(() => {
    const visibility = () => { if (document.hidden) releaseAll(); };
    window.addEventListener("blur", releaseAll); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", releaseAll); document.removeEventListener("visibilitychange", visibility); releaseAll(); };
  }, [releaseAll]);
  useEffect(() => { if (disabled) releaseAll(); }, [disabled, releaseAll]);
  const press = (id: string, note: number) => {
    if (disabled || presses.current.has(id)) return;
    presses.current.set(id, { note, release: pressNote(note) });
    setHeld([...presses.current.values()].map(p => p.note));
  };
  const notes = Array.from({ length: Math.min(25, 128 - start) }, (_, i) => start + i);
  const whites = notes.filter(n => !black(n));
  const keyWidth = 100 / whites.length;
  const octave = (delta: number) => { releaseAll(); setStart(Math.max(0, Math.min(108, start + delta))); };
  return <div role="group" aria-label={copy.keyboard} title={disabled ? copy.noNotes : undefined}
    className={`flex w-full max-w-lg items-center gap-1.5 ${disabled ? "opacity-40" : ""}`}>
    <button type="button" aria-label={copy.lower} title={copy.lower} disabled={start === 0 || disabled} onClick={() => octave(-12)}
      className="h-8 w-6 shrink-0 rounded border border-slate-600 text-xs text-cyan-100 disabled:opacity-30">−</button>
    <div className="relative h-14 min-w-0 flex-1 overflow-hidden rounded border border-slate-700">
      {notes.map(note => {
        const isBlack = black(note), whiteIndex = whites.filter(n => n < note).length;
        return <button type="button" key={note} aria-label={label(note)} aria-pressed={held.includes(note)} title={label(note)} disabled={disabled}
          style={{ left: `${(whiteIndex - (isBlack ? .31 : 0)) * keyWidth}%`, width: `${keyWidth * (isBlack ? .62 : 1)}%` }}
          className={`absolute top-0 touch-none select-none rounded-b border-x border-b border-slate-500/50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500 ${isBlack ? "z-10 h-[62%]" : "h-full"} ${held.includes(note) ? "bg-cyan-400" : isBlack ? "bg-slate-900" : "bg-slate-200 hover:bg-slate-100"}`}
          onPointerDown={e => {
            if (e.button !== 0) return;
            e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); press(`p:${e.pointerId}`, note);
          }} onPointerUp={e => release(`p:${e.pointerId}`)} onPointerCancel={e => release(`p:${e.pointerId}`)} onLostPointerCapture={e => release(`p:${e.pointerId}`)}
          onKeyDown={e => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); if (!e.repeat) press(`k:${note}:${e.key}`, note); } }}
          onKeyUp={e => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); release(`k:${note}:${e.key}`); } }}
          onBlur={() => { release(`k:${note}: `); release(`k:${note}:Enter`); }}>
          {!isBlack && note % 12 === 0 && <span aria-hidden="true" className="absolute inset-x-0 bottom-0.5 text-[8px] text-slate-600">C{Math.floor(note / 12) - 1}</span>}
        </button>;
      })}
    </div>
    <button type="button" aria-label={copy.higher} title={copy.higher} disabled={start === 108 || disabled} onClick={() => octave(12)}
      className="h-8 w-6 shrink-0 rounded border border-slate-600 text-xs text-cyan-100 disabled:opacity-30">+</button>
  </div>;
}
