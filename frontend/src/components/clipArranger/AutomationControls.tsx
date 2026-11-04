import { useEffect, useRef, useState } from "react";
import type { GuiLanguage } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { generateAutomation, setAutomationCurveDuration } from "../../store/automationActions";
import { automationCandidates } from "../../lib/clipArranger/automation";
import { useAutomationMerge } from "../../lib/clipArranger/automationMerge";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";
import { clipButton, clipInput } from "./ClipArranger";
import { automationCopy } from "./automationCopy";

export function AutomationGenerator({ laneId, clipId, language }: { laneId: string; clipId: string; language: GuiLanguage }) {
  const state = useAppStore(), c = automationCopy(language);
  const candidates = automationCandidates(state.sequencer, laneId, state.sequencerInstruments, state.patches);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = candidates.some(b => b.id === selected) ? selected : candidates[0]?.id;
  if (state.sequencer.clipArrangement?.lanes.find(l => l.id === laneId)?.source === "controller") return null;
  return <div className="flex flex-wrap items-center gap-2">
    {candidates.length > 1 && <select aria-label={c.instrument} className={clipInput} value={id} onChange={e => setSelected(e.target.value)}>{candidates.map((b, index) => <option key={b.id} value={b.id}>{state.patches.find(p => p.id === b.patchId)?.name} #{index + 1} · MIDI {b.midiChannel}</option>)}</select>}
    <button className={clipButton} disabled={!id} title={id ? c.generate : c.noTargets} onClick={() => {
      try { if (useStructureDraft.getState().draft) throw new Error(c.saveDrafts); generateAutomation(laneId, clipId, id); setError(null); } catch (e) { setError(String(e)); }
    }}>{c.generate}</button>{error && <span role="alert" className="text-rose-300">{error}</span>}
  </div>;
}

export function AutomationDuration({ language }: { language: GuiLanguage }) {
  const state = useAppStore(), c = automationCopy(language), key = state.clipEditingKey, draft = key ? state.clipDrafts[key] : undefined;
  const track = state.sequencer.controllerSequencers.find(t => t.id === draft?.target.laneId);
  if (!track?.automationTarget || track.controllerMode !== "curve" || draft?.definition.kind !== "pattern" || draft.definition.source !== "controller") return null;
  const ticks = draft.definition.payload.curveDurationTicks ?? draft.definition.payload.lengthBeats * 20160;
  const clip = state.sequencer.clipArrangement?.lanes.find(l => l.id === track.id)?.clips.find(c => c.id === draft.target.clipId);
  return <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-teal-200">
    <span>{c.points}: {draft.definition.payload.keypoints.length}/10</span>
    <label>{c.duration} <input aria-label={c.duration} className={clipInput} type="number" min={1 / 20160} max={1000000} step={.25} value={ticks / 20160} onChange={e => setAutomationCurveDuration(Math.round(Number(e.target.value) * 20160))} /></label>
    <button className={clipButton} disabled={!clip} onClick={() => { if (clip) setAutomationCurveDuration(clip.length); }}>{c.fit}</button>
    <span>{c.locked} · MIDI {track.targetChannels[0]} · CC {track.controllerNumber}</span>
    {track.automationSuspended && <span role="status" className="text-amber-300">{c.suspended}</span>}
  </div>;
}

export function AutomationMergeDialog({ language }: { language: GuiLanguage }) {
  const { conflict, resolve } = useAutomationMerge(), dialog = useRef<HTMLDialogElement>(null), c = automationCopy(language);
  useEffect(() => { if (conflict) dialog.current?.showModal?.(); }, [conflict]);
  return conflict ? <dialog ref={dialog} aria-label={c.merge} className="max-w-xl space-y-4 rounded-xl border border-teal-500 bg-slate-950 p-5 text-slate-100 backdrop:bg-black/70" onCancel={e => { e.preventDefault(); resolve?.(null); }}>
    <h3>{c.merge}</h3><p className="text-sm text-slate-300">{c.mergeHint}</p>
    {conflict.candidates.map(({ track, lane }) => <button key={track.id} className={`${clipButton} block w-full text-left`} onClick={() => resolve?.(track.id)}>{c.keep}: {track.name} · {lane.clips.map(c => `${c.start / 20160}–${(c.start + c.length) / 20160}`).join(", ")}</button>)}
    <button autoFocus className={clipButton} onClick={() => resolve?.(null)}>{c.cancel}</button>
  </dialog> : null;
}
