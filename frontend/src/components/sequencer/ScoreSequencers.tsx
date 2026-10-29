import { createContext, memo, useContext, useEffect, useMemo, useState } from "react";
import type { GuiLanguage, ScorePadState, ScoreTrackState, SequencerState, SequencerTimingConfig } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { addScoreTrack, removeScoreTrack, selectScorePad, updateScoreTrack } from "../../store/scoreActions";
import { normalizeSequencerTiming } from "../../store/appStoreModel";
import { scoreBeatTicks, scoreHasContent, scoreLengthTicks } from "../../lib/scoreSequencer";
import { arrangerTransportExtent } from "../../lib/arrangerTransport";
import { linkedModeForScaleType, linkedScaleTypeForMode, transposeSequencerNoteByScaleDegree, SEQUENCER_MODE_OPTIONS, SEQUENCER_SCALE_OPTIONS } from "../../lib/sequencer";
import { CollapsiblePanel } from "../CollapsiblePanel";
import { PerformanceDeviceName } from "./PerformanceDeviceName";
import { PatternWorkspace } from "./PatternWorkspace";
import { SequencerTimingControls } from "./SequencerTimingControls";
import { usePerformanceEditorState } from "./PerformanceEditorState";
import { ArrangerSpeaker } from "./ArrangerSpeaker";
import { ScoreEditor } from "./ScoreEditor";
import { scoreCopy } from "./scoreCopy";
import { MODE_LABELS, SCALE_TYPE_LABELS } from "./sequencerUiCopy";
import { ARRANGEMENT_ITEM_MIME, beginArrangementDrag, endArrangementDrag } from "../../lib/arrangementDrag";
import { sequencerEditingView } from "../../store/sequencerEdits";

export const ScoreTransportContext = createContext<{ play: (id: string, playing: boolean) => Promise<void>; queue: (id: string, pad: number | null) => Promise<void> } | null>(null);
const button = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-cyan-300 disabled:opacity-40";
const input = "rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-200";

export function ScoreSequencers({ sequencer, language, collapsed, onCollapse, readPosition }: {
  sequencer: SequencerState; language: GuiLanguage; collapsed: boolean; onCollapse: (value: boolean) => void; readPosition?: () => number | null;
}) {
  const c = scoreCopy(language);
  const selections = useAppStore(s => s.sequencerEditingPads);
  const editing = sequencerEditingView(sequencer, selections);
  return <CollapsiblePanel unmountOnCollapse title={c.title} collapsed={collapsed} onCollapsedChange={onCollapse}
    className="mt-4 rounded-xl border border-indigo-800/60 bg-slate-950/85 p-3" titleClassName="text-indigo-200"
    actions={<button className={button} disabled={sequencer.scoreTracks.length >= 16} onClick={() => { addScoreTrack(c.name); onCollapse(false); }}>{c.add}</button>}>
    <details className="mb-3 text-xs text-slate-400"><summary className="cursor-pointer">{c.helpTitle}</summary><p className="mt-2 max-w-4xl leading-relaxed">{c.help}</p></details>
    {editing.scoreTracks.map(track => <ScoreCard key={track.id} track={track} language={language} readPosition={readPosition}
      soundingPad={sequencer.scoreTracks.find(t => t.id === track.id)?.activePad ?? 0} running={sequencer.isPlaying && track.enabled} />)}
  </CollapsiblePanel>;
}

const ScoreCard = memo(function ScoreCard({ track, language, readPosition, soundingPad, running }: {
  track: ScoreTrackState; language: GuiLanguage; readPosition?: () => number | null; soundingPad: number; running: boolean;
}) {
  const c = scoreCopy(language), transport = useContext(ScoreTransportContext);
  const [error, setError] = useState<string | null>(null);
  const padIndex = track.activePad, pad = track.pads[padIndex];
  const signature = (p: ScorePadState) => JSON.stringify([p.notes, p.lengthBeats, p.scaleRoot, p.scaleType, p.mode]);
  const basis = useMemo(() => signature(pad), [pad]);
  const [history, setHistory] = usePerformanceEditorState<{ past: ScorePadState[]; future: ScorePadState[]; basis?: string }>(`device:${track.id}`, `scoreHistory:${padIndex}`, { past: [], future: [] });
  useEffect(() => { if (history.basis && history.basis !== basis) setHistory({ past: [], future: [], basis }); }, [basis, history.basis, setHistory]);
  const attempt = (fn: () => void) => { try { fn(); setError(null); } catch (e) { setError(`${c.error}: ${String(e)}`); } };
  const changePad = (next: ScorePadState) => attempt(() => {
    if (next === pad) return;
    updateScoreTrack(track.id, t => ({ ...t, pads: t.pads.map((p, i) => i === padIndex ? next : p) }));
    setHistory(h => ({ past: [...h.past, pad].slice(-25), future: [], basis: signature(next) }));
  });
  const historyStep = (redo = false) => attempt(() => {
    const source = redo ? history.future : history.past, next = source[source.length - 1]; if (!next) return;
    updateScoreTrack(track.id, t => ({ ...t, pads: t.pads.map((p, i) => i === padIndex ? next : p) }));
    setHistory(redo ? { past: [...history.past, pad].slice(-25), future: source.slice(0, -1), basis: signature(next) }
      : { past: source.slice(0, -1), future: [...history.future, pad].slice(-25), basis: signature(next) });
  });
  const timing = (value: Partial<SequencerTimingConfig>) => attempt(() => updateScoreTrack(track.id, t => {
    const next = normalizeSequencerTiming({ ...t.timing, ...value });
    return { ...t, timing: next, pads: t.pads.map(p => ({ ...p, stepCount: p.lengthBeats * next.stepsPerBeat })) };
  }));
  const duration = scoreLengthTicks(pad, track.timing);
  const hidden = pad.notes.filter(n => n.startTicks >= duration || n.startTicks + n.durationTicks > duration).length;
  const transpose = (direction: -1 | 1, octave: boolean) => changePad({ ...pad, notes: pad.notes.map(n => {
    let pitch = n.pitch;
    if (octave) pitch += direction * 12;
    else pitch = transposeSequencerNoteByScaleDegree(pitch, pad.scaleRoot, pad.mode, direction);
    return { ...n, pitch: Math.max(0, Math.min(127, pitch)) };
  }) });
  return <article className="mb-3 space-y-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3" data-score-track={track.id}
    onKeyDown={e => { if ((e.target as Element).closest("input,select,textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); historyStep(e.shiftKey); }
    }}>
    <div className="flex flex-wrap items-center gap-3">
      <PerformanceDeviceName kind="scoreTracks" device={track} fallback={c.name} sequencer={useAppStore.getState().sequencer} guiLanguage={language} onRename={useAppStore.getState().renamePerformanceDevice} />
      <button className={`${button} ${running ? "!border-amber-500" : "!border-cyan-500"}`} onClick={() => void transport?.play(track.id, !running).catch(e => setError(String(e)))}>{running ? c.stop : c.play}</button>
      <button type="button" onClick={() => removeScoreTrack(track.id)}
        className="ml-auto rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50">{c.remove}</button>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs text-slate-400">{c.channel} <select className={input} value={track.midiChannel} onChange={e => attempt(() => updateScoreTrack(track.id, t => ({ ...t, midiChannel: Number(e.target.value) })))}>{Array.from({ length: 16 }, (_, i) => <option key={i}>{i + 1}</option>)}</select></label>
      <label className="text-xs text-slate-400">{c.scale} <select className={input} value={`${pad.scaleRoot}:${pad.scaleType}`} onChange={e => {
        const option = SEQUENCER_SCALE_OPTIONS.find(o => o.value === e.target.value); if (option) changePad({ ...pad, scaleRoot: option.root, scaleType: option.type, mode: linkedModeForScaleType(option.type) ?? pad.mode });
      }}>{SEQUENCER_SCALE_OPTIONS.map(o => <option key={o.value} value={o.value}>{`${o.root} ${SCALE_TYPE_LABELS[language][o.type]}`.trim()}</option>)}</select></label>
      <label className="text-xs text-slate-400">{c.mode} <select className={input} value={pad.mode} onChange={e => { const mode = e.target.value as ScorePadState["mode"]; changePad({ ...pad, mode, scaleType: linkedScaleTypeForMode(mode) }); }}>{SEQUENCER_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{MODE_LABELS[language][o.value]}</option>)}</select></label>
      <label className="text-xs text-slate-400">{c.launch} <select className={input} value={track.launchQuantization} onChange={e => attempt(() => updateScoreTrack(track.id, t => ({ ...t, launchQuantization: e.target.value as "bar" | "score" })))}><option value="bar">{c.bar}</option><option value="score">{c.end}</option></select></label>
    </div>
    <SequencerTimingControls score id={track.id} language={language} timing={track.timing} pads={track.pads} lengthBeats={pad.lengthBeats}
      onMeterNumerator={n => timing({ meterNumerator: n as SequencerTimingConfig["meterNumerator"] })}
      onMeterDenominator={n => timing({ meterDenominator: n as 4 | 8 })} onSubdivision={n => timing({ stepsPerBeat: n as SequencerTimingConfig["stepsPerBeat"] })}
      onSpeed={(n, d) => timing({ beatRateNumerator: n as SequencerTimingConfig["beatRateNumerator"], beatRateDenominator: d as SequencerTimingConfig["beatRateDenominator"] })}
      onLength={lengthBeats => changePad({ ...pad, lengthBeats, stepCount: lengthBeats * track.timing.stepsPerBeat })} />
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} onClick={() => attempt(() => { const s = useAppStore.getState().sequencer;
        const beats = Math.ceil(arrangerTransportExtent({ ...s, scoreTracks: s.scoreTracks.filter(t => t.id !== track.id) }) * 2520 / scoreBeatTicks(track.timing) * track.timing.beatRateNumerator / track.timing.beatRateDenominator);
        if (beats > 8192) throw new Error("Score capacity exceeded (8192 beats).");
        changePad({ ...pad, lengthBeats: Math.max(1, beats), stepCount: Math.max(1, beats) * track.timing.stepsPerBeat });
      })}>{c.match}</button>
      <button className={button} onClick={() => historyStep()} disabled={!history.past.length}>{c.undo}</button><button className={button} onClick={() => historyStep(true)} disabled={!history.future.length}>{c.redo}</button>
      <button className={button} onClick={() => changePad({ ...pad, notes: [] })}>{c.clear}</button>
      <button className={button} onClick={e => transpose(-1, e.shiftKey)} title={`${c.transpose} − / Shift: −12`}>− ♪</button><button className={button} onClick={e => transpose(1, e.shiftKey)} title={`${c.transpose} + / Shift: +12`}>+ ♪</button>
      {hidden > 0 && <><span className="text-xs text-amber-300">{c.hidden}: {hidden}</span><button className={button} onClick={() => changePad({ ...pad, notes: pad.notes.filter(n => n.startTicks < duration).map(n => ({ ...n, durationTicks: Math.min(n.durationTicks, duration - n.startTicks) })) })}>{c.trim}</button></>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{track.pads.map((p, i) => <div key={i} className="flex items-center gap-1">
      <button className={`${button} ${i === padIndex ? "!ring-1 ring-indigo-300" : ""} ${i === track.queuedPad ? "!border-orange-400" : running && i === soundingPad ? "!border-cyan-300" : ""} ${scoreHasContent(p, track.timing) ? "!bg-emerald-950 !text-emerald-200" : ""}`}
        draggable onDragStart={e => { const item = { type: "pad" as const, padIndex: i }; beginArrangementDrag(track.id, item); e.dataTransfer.setData(ARRANGEMENT_ITEM_MIME, JSON.stringify({ trackId: track.id, item })); e.dataTransfer.effectAllowed = "copy"; }} onDragEnd={endArrangementDrag}
        aria-pressed={i === padIndex} onClick={() => { selectScorePad(track.id, i); if (running && !track.padLoopEnabled) void transport?.queue(track.id, i === soundingPad ? null : i).catch(e => setError(String(e))); }}>#{i + 1}</button>
      <ArrangerSpeaker id={track.id} item={{ type: "pad", padIndex: i }} label={`#${i + 1}`} language={language} />
    </div>)}
      <label className="text-xs text-slate-400">{c.copyPad} <select className={input} value="" onChange={e => { const target = Number(e.target.value); attempt(() => updateScoreTrack(track.id, t => ({ ...t, pads: t.pads.map((p, i) => i === target ? { ...pad, notes: pad.notes.map(n => ({ ...n, id: crypto.randomUUID() })) } : p) }))); }}><option value="">—</option>{track.pads.map((_, i) => i !== padIndex && <option key={i} value={i}>#{i + 1}</option>)}</select></label>
    </div>
    <PatternWorkspace track={track} language={language} padHasContent={i => scoreHasContent(track.pads[i], track.timing)}
      onPatternChange={padLoopPattern => attempt(() => updateScoreTrack(track.id, t => ({ ...t, padLoopPattern })))}
      onSourceChange={source => attempt(() => useAppStore.getState().commitArrangerEdit("source", [{ id: track.id, kind: "score", source }]))} />
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    <ScoreEditor track={track} padIndex={padIndex} pad={pad} language={language} onCommit={changePad} readPosition={readPosition} soundingPad={soundingPad} />
  </article>;
});
