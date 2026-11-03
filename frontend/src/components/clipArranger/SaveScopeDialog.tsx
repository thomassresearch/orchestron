import { useEffect, useRef, useState } from "react";
import type { GuiLanguage, SequencerTimingConfig } from "../../types";
import { contentLength, type ClipLane, type DefinitionDraft } from "../../lib/clipArranger/model";
import { directLinks } from "../../lib/clipArranger/operations";
import { clipButton, clipInput } from "./ClipArranger";
import { clipCopy } from "./copy";

export function SaveScopeDialog({ draft, lane, language, onSave, onCancel, timing }: { draft: DefinitionDraft; lane: ClipLane; language: GuiLanguage; timing?: SequencerTimingConfig; onSave: (scope: "local" | "all", name: string) => void; onCancel: () => void }) {
  const c = clipCopy(language), [scope, setScope] = useState<"local" | "all">("local"), [name, setName] = useState(draft.definition.name);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    if (node?.showModal) node.showModal();
    return () => { node?.close?.(); previous?.focus(); };
  }, []);
  const clip = lane.clips.find(clip => clip.id === draft.target.clipId);
  const linkedClips = lane.clips.filter(window => {
    const contains = (items: typeof window.children): boolean => items.some(item => {
      if (!("definitionId" in item)) return false;
      if (item.definitionId === draft.definition.id) return true;
      const def = lane.definitions.find(d => d.id === item.definitionId);
      return def && def.kind !== "pattern" ? contains(def.children) : false;
    });
    return contains(window.children);
  });
  let windows: [number, number][] = [];
  if (clip && clip.mode === "loop" && scope === "local") {
    const duration = contentLength(lane, clip.children, timing);
    const left = Math.max(clip.start, clip.start - clip.offset + draft.target.pass * duration);
    const right = Math.min(clip.start + clip.length, clip.start - clip.offset + (draft.target.pass + 1) * duration);
    windows = [[clip.start, left], [left, right], [right, clip.start + clip.length]].filter(([a, b]) => b > a) as [number, number][];
  }
  return <dialog ref={dialog} aria-labelledby="clip-save-title" onCancel={e => { e.preventDefault(); onCancel(); }} className="w-[min(94vw,480px)] rounded-xl border border-slate-600 bg-slate-900 p-5 text-slate-200 backdrop:bg-black/70">
    <form onSubmit={e => { e.preventDefault(); onSave(scope, name); }} className="space-y-4">
      <h3 id="clip-save-title" className="text-base font-semibold text-cyan-100">{c.scope}</h3>
      <p className="text-sm">{draft.definition.name} · {draft.definition.kind}</p>
      <p className="text-xs text-slate-400">{lane.id} / {clip?.name} / {draft.definition.name} · {directLinks(lane, draft.definition.id)} {c.linked}</p>
      <fieldset className="space-y-3"><legend className="sr-only">{c.scope}</legend>
        <label className="flex gap-2"><input autoFocus type="radio" name="scope" checked={scope === "local"} onChange={() => setScope("local")} />{c.local}</label>
        <label className="flex gap-2"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />{c.all}</label>
      </fieldset>
      <label className="flex flex-col gap-1 text-xs">{scope === "local" ? c.variation : c.name}<input required maxLength={128} className={`${clipInput} !w-full`} value={name} onChange={e => setName(e.target.value)} /></label>
      <p className="text-xs leading-relaxed text-slate-400">{c.impact}</p>
      {scope === "all" && <p className="text-xs text-slate-300">{c.window} · {linkedClips.length}: {linkedClips.map(window => window.name).join(", ") || "—"}</p>}
      {windows.length > 0 && <div className="flex gap-1" aria-label={c.repeatImpact}>{windows.map(([start, end]) => <span key={start} className="rounded border border-cyan-800 px-2 py-1 text-xs" style={{ flex: end - start }}>{start / 20160}–{end / 20160}</span>)}</div>}
      {scope === "local" && clip?.mode === "loop" && <p className="text-xs text-amber-200">{c.repeatImpact}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={clipButton} onClick={onCancel}>{c.cancel}</button><button type="submit" className={`${clipButton} !border-cyan-500`}>{c.save}</button></div>
    </form>
  </dialog>;
}
