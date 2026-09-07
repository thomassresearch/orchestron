import { useRef } from "react";

/** Keyboard-accessible rotary control; vertical drags avoid discontinuities around the dial. */
export function MixerKnob({ value, min, max, step, reset = 0, label, valueText, onChange, onFinal }: {
  value: number; min: number; max: number; step: number; reset?: number; label: string; valueText?: string;
  onChange: (value: number) => void; onFinal: () => void;
}) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const change = (next: number) => onChange(Math.max(min, Math.min(max, Math.round(next / step) * step)));
  return <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText}
    className="relative m-1 h-10 w-10 shrink-0 touch-none cursor-ns-resize rounded-full border-2 border-slate-500 bg-gradient-to-b from-slate-600 to-slate-900 shadow-md outline-none focus:ring-2 focus:ring-cyan-400"
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus(); drag.current = { y: e.clientY, value }; }}
    onPointerMove={(e) => { if (drag.current) change(drag.current.value + (drag.current.y - e.clientY) * (max - min) / (e.shiftKey ? 1000 : 160)); }}
    onPointerUp={() => { drag.current = null; onFinal(); }} onPointerCancel={() => { drag.current = null; onFinal(); }}
    onDoubleClick={() => { change(reset); onFinal(); }}
    onKeyDown={(e) => {
      const delta = e.shiftKey ? step / 10 : step;
      const next = ({ ArrowUp: value + delta, ArrowRight: value + delta, ArrowDown: value - delta, ArrowLeft: value - delta, PageUp: value + step * 10, PageDown: value - step * 10, Home: min, End: max } as Record<string, number>)[e.key];
      if (next !== undefined) { e.preventDefault(); change(next); }
    }} onKeyUp={onFinal}>
    <span className="absolute inset-1" style={{ transform: `rotate(${-135 + (value-min)/(max-min)*270}deg)` }}><span className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 rounded bg-cyan-300" /></span>
  </div>;
}
