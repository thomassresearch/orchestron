import { useRef } from "react";
import { normalizeControllerValue } from "../../lib/performanceControllers";
import { performanceControllerCopy } from "../../lib/performanceControllerCopy";
import type { GuiLanguage, PerformanceControllerDefinition } from "../../types";
import { usePerformanceEditorState, type EditorOwner } from "./PerformanceEditorState";

export function PerformanceControllerDiscrete({ definition, value, language, onChange, onReset, editorOwner = "rack" }: {
  definition: PerformanceControllerDefinition; value: number; language: GuiLanguage;
  editorOwner?: EditorOwner;
  onChange: (value: number) => void; onReset: () => void;
}) {
  const copy = performanceControllerCopy(language);
  const isBool = definition.controller_type === "bool";
  const invalid = !!definition.error;
  const cancelEntry = useRef(false);
  const [draft, setDraft] = usePerformanceEditorState<string | null>(editorOwner, `controller:${definition.node_id}:${definition.controller_type}:draft`, null);
  const commit = () => {
    if (!cancelEntry.current && draft !== null && draft.trim() && Number.isSafeInteger(Number(draft))) {
      const next = normalizeControllerValue(Number(draft), definition);
      if (next !== value) onChange(next);
    }
    cancelEntry.current = false;
    setDraft(null);
  };
  const step = (delta: number) => {
    setDraft(null);
    const next = normalizeControllerValue(value + delta, definition);
    if (next !== value) onChange(next);
  };
  const triangleClass = "flex h-7 w-full items-center justify-center rounded border border-slate-600 bg-slate-800 text-cyan-200 hover:bg-slate-700 focus-visible:outline-cyan-300 disabled:opacity-30";
  return <div className="flex w-20 min-w-0 max-w-full flex-none flex-col items-center gap-1" data-performance-controller={definition.node_id}
    title={invalid ? copy.invalid : isBool ? copy.boolHelp : copy.integerHelp}>
    <span className="line-clamp-2 h-8 w-full break-words text-center text-xs text-slate-200" title={definition.label}>{definition.label}</span>
    {isBool ? <div className="flex h-[6.25rem] w-full items-center justify-center">
      <button type="button" role="switch" aria-checked={value === 1} aria-label={definition.label} disabled={invalid}
        className={`flex w-full flex-col items-center gap-2 rounded p-1 text-xs focus-visible:outline-cyan-300 disabled:opacity-40 ${value === 1 ? "text-cyan-200" : "text-slate-300"}`}
        onClick={() => onChange(value === 1 ? 0 : 1)}>
        <span aria-hidden="true" className={`flex h-7 w-12 items-center rounded-full border p-1 ${value === 1 ? "justify-end border-cyan-400 bg-cyan-900" : "justify-start border-slate-500 bg-slate-800"}`}>
          <span className={`h-4 w-4 rounded-full ${value === 1 ? "bg-cyan-200" : "bg-slate-400"}`} />
        </span>
        <span>{value === 1 ? copy.on : copy.off}</span>
      </button>
    </div> : <div className="flex w-full flex-col gap-1" onKeyDown={(event) => {
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (invalid) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") step(event.key === "ArrowUp" ? 1 : -1);
        else { setDraft(null); onChange(event.key === "Home" ? definition.min : definition.max); }
      }
    }}>
      <button type="button" className={triangleClass} disabled={invalid || value >= definition.max} aria-label={`${definition.label} · ${copy.increase}`}
        onClick={() => step(1)}><svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M7 1 13 9H1Z" fill="currentColor" /></svg></button>
      <input type="number" step="1" disabled={invalid} min={definition.min} max={definition.max} aria-label={definition.label}
        className="h-9 w-full min-w-0 appearance-none rounded border border-slate-600 bg-slate-950 px-1 text-center font-mono text-sm text-cyan-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        value={draft ?? String(value)} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { cancelEntry.current = true; setDraft(null); event.currentTarget.blur(); }
        }} />
      <button type="button" className={triangleClass} disabled={invalid || value <= definition.min} aria-label={`${definition.label} · ${copy.decrease}`}
        onClick={() => step(-1)}><svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M1 1H13L7 9Z" fill="currentColor" /></svg></button>
    </div>}
    <button type="button" disabled={invalid} title={copy.reset} aria-label={`${definition.label} · ${copy.reset}`}
      className="rounded px-2 py-1 text-sm text-slate-400 hover:text-cyan-200 focus-visible:outline-cyan-300 disabled:opacity-40"
      onClick={() => { setDraft(null); onReset(); }}>↺</button>
  </div>;
}
