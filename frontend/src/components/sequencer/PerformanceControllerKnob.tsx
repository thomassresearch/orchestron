import { useRef, useState } from "react";
import { controllerPosition, controllerTicks, controllerValue } from "../../lib/performanceControllers";
import { performanceControllerCopy } from "../../lib/performanceControllerCopy";
import type { GuiLanguage, PerformanceControllerDefinition } from "../../types";

const display = (value: number) => Number(value.toPrecision(5)).toString();

export function PerformanceControllerKnob({ definition, value, language, onChange, onReset }: {
  definition: PerformanceControllerDefinition; value: number; language: GuiLanguage;
  onChange: (value: number) => void; onReset: () => void;
}) {
  const copy = performanceControllerCopy(language);
  const drag = useRef<{ pointer: number; y: number; position: number } | null>(null);
  const cancelEntry = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = !!definition.error;
  const position = invalid ? 0 : controllerPosition(value, definition);
  const angle = (position * 270 - 135) * Math.PI / 180;
  const commit = () => {
    if (!cancelEntry.current && draft !== null && draft.trim() && Number.isFinite(Number(draft)) && Number(draft) !== value) onChange(Number(draft));
    cancelEntry.current = false;
    setDraft(null);
  };
  return <div className="flex w-20 min-w-0 max-w-full flex-none flex-col items-center gap-1" data-performance-controller={definition.node_id}>
    <span className="line-clamp-2 h-8 w-full break-words text-center text-xs text-slate-200" title={definition.label}>{definition.label}</span>
    <button type="button" role="slider" disabled={invalid} aria-label={definition.label} aria-valuemin={definition.min} aria-valuemax={definition.max}
      aria-valuenow={value} aria-valuetext={`${display(value)} · ${copy[definition.scale]}`} title={invalid ? copy.invalid : copy.help}
      className="h-[4.5rem] w-[4.5rem] touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { pointer: event.pointerId, y: event.clientY, position };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        event.preventDefault();
        const movement = (drag.current.y - event.clientY) / (event.shiftKey ? 2000 : 200);
        const next = Math.min(1, Math.max(0, drag.current.position + movement));
        drag.current = { pointer: event.pointerId, y: event.clientY, position: next };
        onChange(controllerValue(next, definition));
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const delta = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : ["ArrowDown", "ArrowLeft"].includes(event.key) ? -1 : 0;
        if (delta) { event.preventDefault(); onChange(controllerValue(position + delta * (event.shiftKey ? 0.001 : 0.01), definition)); }
        if (event.key === "Home" || event.key === "End") { event.preventDefault(); onChange(event.key === "Home" ? definition.min : definition.max); }
        if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onReset(); }
      }}>
      <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden="true">
        {!invalid && controllerTicks(definition).map((tick, index) => {
          const a = (tick.position * 270 - 135) * Math.PI / 180;
          const r = tick.major ? 30 : 33;
          return <line key={index} x1={40 + Math.sin(a) * r} y1={40 - Math.cos(a) * r}
            x2={40 + Math.sin(a) * 37} y2={40 - Math.cos(a) * 37} stroke={tick.major ? "#a5f3fc" : "#64748b"} strokeWidth={tick.major ? 1.5 : 1} />;
        })}
        <circle cx="40" cy="40" r="25" fill="#0f172a" stroke="#475569" />
        <circle cx="40" cy="40" r="21" fill="#1e293b" stroke="#334155" />
        <line x1={40 + Math.sin(angle) * 12} y1={40 - Math.cos(angle) * 12}
          x2={40 + Math.sin(angle) * 22} y2={40 - Math.cos(angle) * 22} stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </button>
    <div className="flex w-full items-center justify-between gap-1 font-mono text-[9px] text-slate-400">
      <span>{display(definition.min)}</span><span className="text-cyan-300" title={copy[definition.scale]}>{definition.scale === "linear" ? "LIN" : "LOG"}</span><span>{display(definition.max)}</span>
    </div>
    <input type="number" step="any" disabled={invalid} min={definition.min} max={definition.max} aria-label={`${definition.label} · ${copy.title}`}
      className="w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-1 py-1 text-center font-mono text-xs text-cyan-100"
      value={draft ?? display(value)} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { cancelEntry.current = true; setDraft(null); event.currentTarget.blur(); } }} />
  </div>;
}
