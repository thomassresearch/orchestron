import { flushArrangementEditors } from "../../store/arrangementEdits";
import { useState } from "react";
import type { ClipArrangement, LaneTiming } from "../../lib/clipArranger/model";
import { copyClipRange, editTime, pasteClipRange, type ClipSection } from "../../lib/clipArranger/operations";
import type { GuiLanguage } from "../../types";
import { clipInput } from "./ClipArranger";
import { clipButton, clipButtonClass } from "./buttonStyles";
import { clipCopy } from "./copy";
import { usePerformanceEditorState } from "../sequencer/PerformanceEditorState";
export function SectionTools({ model, timings, selectedLane, language, onChange }: { model: ClipArrangement; timings: LaneTiming; selectedLane?: string; language: GuiLanguage; onChange: (next: ClipArrangement, label: string) => void }) {
  const c = clipCopy(language);
  const [start, setStart] = usePerformanceEditorState("arranger", "sectionStart", 0);
  const [length, setLength] = usePerformanceEditorState("arranger", "sectionLength", 4);
  const [at, setAt] = usePerformanceEditorState("arranger", "sectionPasteAt", 0);
  const [all, setAll] = usePerformanceEditorState("arranger", "sectionAllTracks", true);
  const [open, setOpen] = usePerformanceEditorState("arranger", "sectionToolsOpen", false);
  const [clipboard, setClipboard] = usePerformanceEditorState<ClipSection | null>("arranger", "clipSection", null);
  const [error, setError] = useState<string | null>(null);
  const lanes = all ? model.lanes.map(l => l.id) : selectedLane ? [selectedLane] : [];
  const run = (action: () => void) => { try { action(); setError(null); } catch (e) { setError(String(e)); } };
  const prepare = (fn: (working: ClipArrangement) => ClipArrangement, label: string) => run(() => onChange(fn(flushArrangementEditors().model), label));
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400"><summary>{c.sections}</summary>
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label>{c.start}<input className={`${clipInput} block`} type="number" min={0} step={.25} value={start} onChange={e => setStart(Number(e.target.value))} /></label>
      <label>{c.length}<input className={`${clipInput} block`} type="number" min={.25} step={.25} value={length} onChange={e => setLength(Number(e.target.value))} /></label>
      <label className="self-center"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> {c.allTracks}</label>
      <button disabled={!lanes.length} className={clipButton} onClick={() => run(() => setClipboard(copyClipRange(flushArrangementEditors().model, lanes, start * 20160, length * 20160)))}>{c.copySection}</button>
      <button disabled={!lanes.length} className={clipButtonClass("add")} onClick={() => prepare(working => editTime(working, lanes, start * 20160, length * 20160, "insert", timings), c.insertTime)}>{c.insertTime}</button>
      <button disabled={!lanes.length} className={clipButtonClass("remove")} onClick={() => prepare(working => editTime(working, lanes, start * 20160, length * 20160, "close", timings), c.closeTime)}>{c.closeTime}</button>
      <label>{c.pasteAt}<input className={`${clipInput} block`} type="number" min={0} step={.25} value={at} onChange={e => setAt(Number(e.target.value))} /></label>
      {(["overwrite", "insert"] as const).map(mode => <button key={mode} disabled={!clipboard} className={clipButtonClass(mode === "insert" ? "add" : "edit")} onClick={() => prepare(working => pasteClipRange(working, clipboard!, at * 20160, mode, timings), mode === "insert" ? c.pasteInsert : c.pasteOverwrite)}>{mode === "insert" ? c.pasteInsert : c.pasteOverwrite}</button>)}
    </div>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
  </details>;
}
