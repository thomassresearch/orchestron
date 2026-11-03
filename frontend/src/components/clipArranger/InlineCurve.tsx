import type { ControllerSequencerState, GuiLanguage } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { ControllerSequencerCurveEditor } from "../sequencer/ControllerSequencerCurveEditor";
import { SEQUENCER_UI_COPY } from "../sequencer/sequencerUiCopy";
import { clipCopy } from "./copy";
import { clipInput } from "./ClipArranger";

/** Uses the production curve gestures and store draft adapter, including independent endpoints. */
export function InlineCurve({ track, language, window = [0, 1] }: { track: ControllerSequencerState; language: GuiLanguage; window?: [number, number] }) {
  const c = clipCopy(language), actions = useAppStore.getState();
  const points = [...track.keypoints].sort((a, b) => a.position - b.position);
  return <div className="min-w-0 rounded border border-teal-800 bg-slate-950 p-2" aria-label={`${c.content}: ${c.keypoint}`}>
    <p className="mb-1 text-[10px] text-slate-400">{c.content} · {c.position}: {Math.round(window[0] * 1000) / 10}–{Math.round(window[1] * 1000) / 10}%</p>
    <div className="overflow-hidden"><div style={{ width: `${100 / (window[1] - window[0])}%`, marginLeft: `${-window[0] / (window[1] - window[0]) * 100}%` }}><ControllerSequencerCurveEditor ui={SEQUENCER_UI_COPY[language]} controllerSequencer={track} height={72} showHint={false} playbackTransport={null}
      onAddPoint={(position, value) => actions.addControllerSequencerKeypoint(track.id, position, value)}
      onPointChange={(id, position, value) => actions.setControllerSequencerKeypoint(track.id, id, position, value)}
      onPointRemove={id => actions.removeControllerSequencerKeypoint(track.id, id)} /></div></div>
    <p className="mt-1 text-[10px] text-slate-500">{SEQUENCER_UI_COPY[language].curveEditorHint}</p>
    <details className="mt-1 text-xs text-slate-400"><summary>{c.keypoint} · {c.position} / {c.value}</summary>
      <div className="mt-2 flex flex-wrap gap-3">{points.map((point, index) => <fieldset key={point.id} className="flex items-end gap-1"><legend>{c.keypoint} {index + 1}</legend>
        <label>{c.position} %<input aria-label={`${c.position} ${index + 1}`} className={`${clipInput} block !w-20`} type="number" min={index ? (points[index - 1].position + .001) * 100 : 0} max={index < points.length - 1 ? (points[index + 1].position - .001) * 100 : 100} step="0.1" disabled={index === 0 || index === points.length - 1} value={Number((point.position * 100).toFixed(2))} onChange={e => actions.setControllerSequencerKeypoint(track.id, point.id, Number(e.target.value) / 100, point.value)} /></label>
        <label>{c.value}<input aria-label={`${c.value} ${index + 1}`} className={`${clipInput} block !w-20`} type="number" min={0} max={127} value={point.value} onChange={e => actions.setControllerSequencerKeypoint(track.id, point.id, point.position, Number(e.target.value))} /></label>
      </fieldset>)}</div>
    </details>
  </div>;
}
