import type { GuiLanguage } from "../../types";
import { arrangementCopy } from "../../lib/arrangementCopy";
import { laneOutputSuppressed, toggleLaneOutput, useLaneOutput } from "../../lib/laneOutput";

export function LaneOutputButtons({ id, language }: { id: string; language: GuiLanguage }) {
  const { lanes, routes, error } = useLaneOutput();
  const c = arrangementCopy(language);
  const suppressed = laneOutputSuppressed(id, lanes, routes);
  return <span className="flex shrink-0 gap-1" title={error ? `${c.outputError} ${error}` : c.laneOnly}>
    <button aria-label={c.mute} aria-pressed={lanes[id]?.mute ?? false} title={suppressed && !lanes[id]?.mute ? c.soloSuppressed : c.laneOnly}
      className={`rounded border px-1 py-0.5 text-[10px] ${lanes[id]?.mute ? "border-rose-400 bg-rose-900 text-rose-100" : suppressed ? "border-dashed border-amber-500 text-amber-200" : "border-slate-600 text-slate-300"}`}
      onClick={() => toggleLaneOutput(id, "mute")}>{c.mute}</button>
    <button aria-label={c.solo} aria-pressed={lanes[id]?.solo ?? false}
      className={`rounded border px-1 py-0.5 text-[10px] ${lanes[id]?.solo ? "border-amber-400 bg-amber-900 text-amber-100" : "border-slate-600 text-slate-300"}`}
      onClick={() => toggleLaneOutput(id, "solo")}>{c.solo}</button>
    {error && <span role="alert" className="text-red-300" aria-label={c.outputError}>!</span>}
  </span>;
}
