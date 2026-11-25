import { useLayoutEffect, useRef, useState } from "react";
import type { GuiLanguage } from "../../types";
import { editCopy } from "../../lib/clipArranger/editCopy";
import { QUARTER_TICKS as Q } from "../../lib/clipArranger/model";
import { clipButtonClass, clipButton } from "./buttonStyles";

type Props = {
  start: number; end: number; unit: number; initial: number; language: GuiLanguage;
  onCut: (at: number) => void; onCancel: () => void;
};

/** Only confirmation publishes an edit. The line and its grip share a focusable slider. */
export function ClipCutSelector({ start, end, unit, initial, language, onCut, onCancel }: Props) {
  const c = editCopy(language);
  const snap = Q / 4;
  const first = (Math.floor(start / snap) + 1) * snap;
  const last = (Math.ceil(end / snap) - 1) * snap;
  // Short and off-grid windows can still be cut at an interior transport tick.
  const bounded = (tick: number) => first <= last
    ? Math.min(last, Math.max(first, Math.round(tick / snap) * snap))
    : Math.min(end - 1, Math.max(start + 1, Math.round(tick)));
  const [at, setAt] = useState(() => bounded(initial));
  const grip = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { grip.current?.focus({ preventScroll: true }); }, []);
  return <div className="arranger-cut-overlay" data-arranger-cut style={{ left: start * unit, width: (end - start) * unit }}
    onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}
    onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    }}>
    <div className="arranger-cut-surface" onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      grip.current?.focus({ preventScroll: true });
      setAt(bounded(start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / unit));
    }} onPointerMove={e => {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        setAt(bounded(start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / unit));
    }}>
      <button ref={grip} type="button" role="slider" aria-label={c.cutPosition} aria-valuemin={bounded(start) / Q}
        aria-valuemax={bounded(end) / Q} aria-valuenow={at / Q} className="arranger-cut-line" style={{ left: (at - start) * unit }}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); onCut(at); }
          else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault(); e.stopPropagation();
            const step = first <= last ? snap : 1;
            setAt(bounded(e.key === "Home" ? start : e.key === "End" ? end : at + (e.key === "ArrowLeft" ? -step : step)));
          }
        }}><span aria-hidden>✂︎</span></button>
    </div>
    <div className="arranger-cut-buttons" style={{ left: (at - start) * unit }}>
      <output aria-label={c.cutPosition}>{Number((at / Q).toFixed(4))}</output>
      <button className={clipButtonClass("edit")} onClick={() => onCut(at)}>{c.cut}</button>
      <button className={clipButton} onClick={onCancel}>{c.cancel}</button>
    </div>
  </div>;
}
