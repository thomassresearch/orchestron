import { useRef } from "react";

type Props = {
  path: string; arrow: string; labelX: number; labelY: number;
  name: string; help: string; percent: Intl.NumberFormat;
  level: number; weight: number; selected: boolean;
  onSelect: () => void; onChange: (weight: number) => void;
};

export function Fm6ModulationBranch({ path, arrow, labelX, labelY, name, help, percent,
  level, weight, selected, onSelect, onChange }: Props) {
  const drag = useRef<{ id: number; y: number; weight: number } | null>(null);
  const depth = level * weight / 100;
  const label = percent.format(depth);
  const change = (value: number) => {
    const next = Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
    if (next !== weight) onChange(next);
  };
  return <g role="slider" tabIndex={0} aria-label={name} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={1}
    aria-valuenow={weight} aria-valuetext={percent.format(weight)} className="group touch-none cursor-ns-resize outline-none"
    onClick={onSelect}
    onPointerDown={e => {
      if (e.button !== 0 || drag.current) return;
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, y: e.clientY, weight };
      onSelect();
    }}
    onPointerMove={e => {
      const start = drag.current;
      if (start && start.id === e.pointerId) change(start.weight + (start.y - e.clientY) / 160);
    }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={e => {
      const step = e.shiftKey ? .001 : .01;
      const next = ({ ArrowUp: weight + step, ArrowRight: weight + step, ArrowDown: weight - step, ArrowLeft: weight - step,
        Home: 0, End: 1, PageUp: weight + .1, PageDown: weight - .1 } as Record<string, number>)[e.key];
      if (next !== undefined || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
        if (next !== undefined) change(next);
      }
    }}>
    <title>{`${name} · ${weight}\n${help}`}</title>
    <path d={path} stroke="transparent" strokeWidth="20" strokeLinecap="round" pointerEvents="stroke" />
    <path d={path} stroke={selected ? "#ffcb81" : "#d0ac7a"} strokeWidth={depth > 0 ? 1 + 6 * depth : 1}
      strokeDasharray={depth > 0 ? undefined : "3 3"} opacity={depth > 0 ? 1 : .55} markerEnd={arrow}
      className="group-focus-visible:stroke-white group-hover:stroke-amber-200" />
    <rect x={labelX - 24} y={labelY - 12} width="48" height="17" fill="transparent" stroke="none" />
    <text x={labelX} y={labelY} textAnchor="middle" fontSize="11" fontFamily="monospace" fontWeight="600"
      stroke="#0a1321" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke" fill={selected ? "#ffd79b" : "#e2caa9"}
      className="group-focus-visible:fill-white group-hover:fill-amber-100">{label}</text>
  </g>;
}
