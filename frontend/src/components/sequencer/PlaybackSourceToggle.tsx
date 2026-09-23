import type { GuiLanguage } from "../../types";
import { arrangementCopy } from "../../lib/arrangementCopy";

export function PlaybackSourceToggle({ language, arrangement, hasArrangement, onChange }: {
  language: GuiLanguage;
  arrangement: boolean;
  hasArrangement: boolean;
  onChange: (arrangement: boolean) => void;
}) {
  const c = arrangementCopy(language);
  return <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-400" role="group" aria-label={c.source}>
    <span>{c.source}</span>
    <div className="inline-flex overflow-hidden rounded border border-slate-600">
      {[{ value: true, label: c.arrangement }, { value: false, label: c.manual }].map(option =>
        <button key={option.label} type="button" aria-pressed={arrangement === option.value}
          disabled={option.value && !hasArrangement} title={option.value && !hasArrangement ? c.emptyLane : undefined}
          className={`px-2 py-1 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${arrangement === option.value ? "bg-cyan-900 text-cyan-100" : "bg-slate-900 text-slate-300 hover:bg-slate-800"}`}
          onClick={() => { if (arrangement !== option.value) onChange(option.value); }}>{option.label}</button>)}
    </div>
  </div>;
}
