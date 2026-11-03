import { useState } from "react";
import type { ClipArrangement, LaneTiming } from "../../lib/clipArranger/model";
import { copyClipRange, editTime, pasteClipRange, type ClipSection } from "../../lib/clipArranger/operations";
import type { GuiLanguage } from "../../types";
import { clipButton, clipInput } from "./ClipArranger";
import { clipCopy } from "./copy";
import { usePerformanceEditorState } from "../sequencer/PerformanceEditorState";
export function SectionTools({ model, timings, selectedLane, language, onChange }: { model: ClipArrangement; timings: LaneTiming; selectedLane?: string; language: GuiLanguage; onChange: (next: ClipArrangement, label: string) => void }) {
  const c = clipCopy(language), [start, setStart] = useState(0), [length, setLength] = useState(4), [at, setAt] = useState(0), [all, setAll] = useState(true);
  const [clipboard, setClipboard] = usePerformanceEditorState<ClipSection | null>("arranger", "clipSection", null);
  const [pending, setPending] = useState<{ next: ClipArrangement; label: string; basis: string } | null>(null), [error, setError] = useState<string | null>(null);
  const lanes = all ? model.lanes.map(l => l.id) : selectedLane ? [selectedLane] : [];
  const run = (action: () => void) => { try { action(); setError(null); } catch (e) { setError(String(e)); } };
  const prepare = (fn: () => ClipArrangement, label: string) => run(() => setPending({ next: fn(), label, basis: JSON.stringify(model) }));
  return <details className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400"><summary>{c.sections}</summary>
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label>{c.start}<input className={`${clipInput} block`} type="number" min={0} step={.25} value={start} onChange={e => setStart(Number(e.target.value))} /></label>
      <label>{c.length}<input className={`${clipInput} block`} type="number" min={.25} step={.25} value={length} onChange={e => setLength(Number(e.target.value))} /></label>
      <label className="self-center"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> {c.allTracks}</label>
      <button disabled={!lanes.length} className={clipButton} onClick={() => run(() => setClipboard(copyClipRange(model, lanes, start * 20160, length * 20160)))}>{c.copySection}</button>
      <button disabled={!lanes.length} className={clipButton} onClick={() => prepare(() => editTime(model, lanes, start * 20160, length * 20160, "insert", timings), c.insertTime)}>{c.insertTime}</button>
      <button disabled={!lanes.length} className={clipButton} onClick={() => prepare(() => editTime(model, lanes, start * 20160, length * 20160, "close", timings), c.closeTime)}>{c.closeTime}</button>
      <label>{c.pasteAt}<input className={`${clipInput} block`} type="number" min={0} step={.25} value={at} onChange={e => setAt(Number(e.target.value))} /></label>
      {(["overwrite", "insert"] as const).map(mode => <button key={mode} disabled={!clipboard} className={clipButton} onClick={() => prepare(() => pasteClipRange(model, clipboard!, at * 20160, mode, timings), mode === "insert" ? c.pasteInsert : c.pasteOverwrite)}>{mode === "insert" ? c.pasteInsert : c.pasteOverwrite}</button>)}
    </div>
    {pending && <div className="mt-2 rounded border border-cyan-800 p-2"><p>{pending.label} · {c.length}: {model.end / 20160} → {pending.next.end / 20160} {c.beats}</p>
      {pending.next.lanes.filter(l => JSON.stringify(l.clips) !== JSON.stringify(model.lanes.find(old => old.id === l.id)?.clips)).map(l => <div key={l.id} className="my-1 flex gap-1" aria-label={l.id}>{l.clips.slice(0, 32).map(cl => <span className="rounded border border-slate-600 px-1" key={cl.id}>{cl.name} [{cl.start / 20160}–{(cl.start + cl.length) / 20160}]</span>)}</div>)}
      <button className={clipButton} onClick={() => run(() => { if (pending.basis !== JSON.stringify(model)) throw new Error(c.stale); onChange(pending.next, pending.label); setPending(null); })}>{c.apply}</button> <button className={clipButton} onClick={() => setPending(null)}>{c.cancel}</button>
    </div>}
    {error && <p role="alert" className="text-rose-300">{error}</p>}
  </details>;
}
