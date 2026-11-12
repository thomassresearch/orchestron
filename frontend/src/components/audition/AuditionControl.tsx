import { useRef, useState } from "react";
import { controllerPosition, controllerValue, normalizeControllerValue } from "../../lib/performanceControllers";
import { auditionCopy } from "../../lib/auditionCopy";
import type { GuiLanguage, PerformanceControllerDefinition } from "../../types";

export function AuditionControl({ definition: d, value, alwaysOn, language, onChange }: {
  definition: PerformanceControllerDefinition; value: number; alwaysOn: boolean; language: GuiLanguage; onChange: (value: number) => void;
}) {
  const copy = auditionCopy(language);
  const [entry, setEntry] = useState<string | null>(null);
  const cancelled = useRef(false);
  const drag = useRef<{ pointer: number; y: number; position: number } | null>(null);
  const timing = d.update_mode === "unused" ? copy.unused : !alwaysOn ? copy.nextNote : d.update_mode === "live" ? copy.live : copy.restart;
  const position = d.error ? 0 : controllerPosition(value, d);
  const change = (next: number) => { if (!d.error && Number.isFinite(next)) onChange(normalizeControllerValue(next, d)); };
  const commit = () => {
    if (!cancelled.current && entry?.trim() && Number.isSafeInteger(Number(entry))) change(Number(entry));
    cancelled.current = false; setEntry(null);
  };
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40";
  return <div data-audition-controller={d.node_id} className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-slate-200">
    <span className="max-w-32 truncate" title={d.label}>{d.label}</span>
    {d.controller_type === "bool" ? <button type="button" role="switch" aria-label={d.label} aria-checked={value === 1} disabled={!!d.error}
      title={`${copy.bool} ${timing}`} onClick={() => change(value === 1 ? 0 : 1)}
      className={`flex h-5 w-8 shrink-0 items-center rounded-full border p-0.5 ${focus} ${value === 1 ? "justify-end border-cyan-400 bg-cyan-900" : "justify-start border-slate-500 bg-slate-800"}`}>
      <span aria-hidden="true" className={`h-3 w-3 rounded-full ${value === 1 ? "bg-cyan-200" : "bg-slate-400"}`} />
    </button> : d.controller_type === "integer" ? <input type="number" step="1" min={d.min} max={d.max} disabled={!!d.error}
      aria-label={d.label} title={`${copy.integer} ${timing}`} value={entry ?? String(value)}
      className={`h-7 w-16 rounded border border-slate-600 bg-slate-950 px-1 font-mono text-xs text-cyan-100 ${focus}`}
      onChange={e => setEntry(e.target.value)} onBlur={commit} onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { cancelled.current = true; setEntry(null); e.currentTarget.blur(); }
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
          e.preventDefault(); setEntry(null);
          change(e.key === "Home" ? d.min : e.key === "End" ? d.max : value + (e.key === "ArrowUp" ? 1 : -1));
        }
      }} /> : <button type="button" role="slider" aria-label={d.label} aria-valuemin={d.min} aria-valuemax={d.max}
      aria-valuenow={value} aria-valuetext={Number(value.toPrecision(5)).toString()} disabled={!!d.error}
      title={`${d.label}: ${Number(value.toPrecision(5))}. ${copy.knob} ${timing}`}
      className={`h-8 w-8 shrink-0 touch-none rounded-full ${focus}`} onDoubleClick={() => change(d.default)}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointer: e.pointerId, y: e.clientY, position };
      }} onPointerMove={e => {
        if (drag.current?.pointer !== e.pointerId) return;
        const next = Math.max(0, Math.min(1, drag.current.position + (drag.current.y - e.clientY) / (e.shiftKey ? 2000 : 200)));
        drag.current = { pointer: e.pointerId, y: e.clientY, position: next }; change(controllerValue(next, d));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={e => {
        const delta = ["ArrowUp", "ArrowRight"].includes(e.key) ? 1 : ["ArrowDown", "ArrowLeft"].includes(e.key) ? -1 : 0;
        if (delta) { e.preventDefault(); change(controllerValue(position + delta * (e.shiftKey ? .001 : .01), d)); }
        if (e.key === "Home" || e.key === "End") { e.preventDefault(); change(e.key === "Home" ? d.min : d.max); }
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); change(d.default); }
      }}>
      <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="#1e293b" stroke="#64748b" />
        <path d="M16 16V6" stroke="#67e8f9" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${position * 270 - 135} 16 16)`} />
      </svg>
    </button>}
  </div>;
}
