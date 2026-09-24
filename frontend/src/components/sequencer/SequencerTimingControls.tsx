import { Fragment } from "react";
import type { ControllerSequencerPadLengthBeats, GuiLanguage, SequencerTimingConfig } from "../../types";
import { MAX_STEPS_PER_PAD, SEQUENCER_BEAT_RATE_OPTIONS, SEQUENCER_STEPS_PER_BEAT_OPTIONS } from "../../lib/sequencer";
import { patternLengthLabel, sequencerBeatGroups, subdivisionLabel, timingCopy, timingSummary } from "../../lib/sequencerTimingPresentation";
import { EditorDetails } from "./PerformanceEditorState";

interface Props {
  id: string;
  timing: SequencerTimingConfig;
  lengthBeats: ControllerSequencerPadLengthBeats;
  pads: { lengthBeats: number }[];
  controller?: boolean;
  language: GuiLanguage;
  onMeterNumerator: (value: number) => void;
  onMeterDenominator: (value: number) => void;
  onSubdivision: (value: number) => void;
  onLength: (value: number) => void;
  onSpeed: (numerator: number, denominator: number) => void;
}

export function SequencerTimingControls(p: Props) {
  const c = timingCopy(p.language);
  const field = "min-h-8 min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-200";
  const speed = p.timing.beatRateNumerator / p.timing.beatRateDenominator;
  const oversized = (grid: number) => p.pads.some(pad => pad.lengthBeats * grid > MAX_STEPS_PER_PAD);
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-end gap-2">
      <fieldset className="min-w-0"><legend className="mb-1 text-xs text-slate-400">{c.meter}</legend>
        <div className="flex items-center gap-1">
          <select aria-label={`${c.meter} ${p.id} numerator`} className={field} value={p.timing.meterNumerator} onChange={e => p.onMeterNumerator(Number(e.target.value))}>
            {[2,3,4,5,6,7].map(n => <option key={n}>{n}</option>)}
          </select><span>/</span>
          <select aria-label={`${c.meter} ${p.id} denominator`} className={field} value={p.timing.meterDenominator} onChange={e => p.onMeterDenominator(Number(e.target.value))}>
            {[4,8].map(n => <option key={n}>{n}</option>)}
          </select>
        </div>
      </fieldset>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">{c.length}
        <select className={field} value={p.lengthBeats} onChange={e => p.onLength(Number(e.target.value))}>
          {Array.from({length:p.controller ? 32 : 16}, (_, i) => i + 1).map(n => <option key={n} value={n} disabled={n * p.timing.stepsPerBeat > MAX_STEPS_PER_PAD}>{patternLengthLabel(n, p.timing.meterNumerator, p.language)}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-slate-400">{c.subdivision}
        <select className={field} value={p.timing.stepsPerBeat} onChange={e => p.onSubdivision(Number(e.target.value))}>
          {SEQUENCER_STEPS_PER_BEAT_OPTIONS.map(n => <option key={n} value={n} disabled={oversized(n)}>{subdivisionLabel(n, p.timing.meterDenominator, p.language)}</option>)}
        </select>
      </label>
    </div>
    <div className="text-xs text-slate-200" aria-live="polite">{timingSummary(p.timing, p.lengthBeats, p.language)}</div>
    <div className="text-[11px] text-slate-400">{c.scope}</div>
    {(SEQUENCER_STEPS_PER_BEAT_OPTIONS.some(oversized) || p.controller && 32 * p.timing.stepsPerBeat > MAX_STEPS_PER_PAD) && <div className="text-[11px] text-slate-400">{c.limit}</div>}
    {speed !== 1 && <div className="text-xs text-amber-300">{c.speed}: {Number(speed.toFixed(3))}× ({p.timing.beatRateNumerator}:{p.timing.beatRateDenominator})</div>}
    <EditorDetails owner={`device:${p.id}`} field="timing" summary={c.advanced} summaryClassName="cursor-pointer text-xs text-slate-400">
      {() => <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">{c.speed}
        <select className={field} value={`${p.timing.beatRateNumerator}:${p.timing.beatRateDenominator}`} onChange={e => {
          const [n,d] = e.target.value.split(":").map(Number); p.onSpeed(n,d);
        }}>{SEQUENCER_BEAT_RATE_OPTIONS.map(r => <option key={r.label} value={r.label}>{Number((r.numerator / r.denominator).toFixed(3))}× ({r.label})</option>)}</select>
      </label>}
    </EditorDetails>
  </div>;
}

export function BeatGroupHeaders({ timing, stepCount, language, offset = 0 }: { timing: SequencerTimingConfig; stepCount: number; language: GuiLanguage; offset?: number }) {
  const c = timingCopy(language);
  return <Fragment>{offset > 0 && <div aria-hidden="true" />}{sequencerBeatGroups(timing, stepCount).map(group =>
    <div key={group.start} data-beat-group={group.beat} className={`min-w-0 break-words border-l px-1 py-1 text-xs text-slate-300 ${group.barStart ? "border-l-[3px] border-slate-400" : "border-slate-600"}`}
      style={{gridColumn: `${group.start + offset + 1} / span ${group.count}`, gridRow:1}}>
      {group.barStart ? `${c.bar} ${group.bar} · ` : ""}{c.beat} {group.beat}
    </div>
  )}</Fragment>;
}
