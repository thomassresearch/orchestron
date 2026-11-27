import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { fm6Copy } from "../lib/fm6Copy";

export type FmBranchGeometry = { from: number; to: number; path: string; arrow: string; labelX: number; labelY: number };
type Algorithm = { positions: number[][]; edges: number[][]; outputs: number[] };
type Operator = { level: number; outputLabel?: string; enabled: boolean; title: string; details: (width: number, ink: string) => ReactNode };

export function FmAlgorithmCanvas({ algorithm, label, copy, selected, onSelect, operator, renderBranch,
  feedbackFrom, feedbackTo, feedbackLabel, feedbackOn }: {
  algorithm: Algorithm; label: string; copy: ReturnType<typeof fm6Copy>; selected: number | null;
  onSelect: (op: number) => void; operator: (op: number) => Operator;
  renderBranch?: (branch: FmBranchGeometry) => ReactNode;
  feedbackFrom: number; feedbackTo: number; feedbackLabel: string; feedbackOn: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const rows = 1 + Math.max(...algorithm.positions.map(([, row]) => row));
  const container = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 640));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = new Set(algorithm.positions.map(([x]) => x)).size;
  // Fit the shorter dimension across narrow screens; wide screens can show long chains sideways.
  const horizontal = compact ? columns > rows : rows >= 4 && columns <= 2;
  const baseWidth = compact ? 420 : 1000;
  const across = horizontal ? rows : columns;
  const down = horizontal ? columns : rows;
  const desktopCardWidth = horizontal ? (rows === 6 ? 132 : 160) : across === 6 ? 140 : across === 5 ? 155 : 176;
  const cardWidth = compact ? Math.min(154, (baseWidth - 50) / across - 15) : desktopCardWidth;
  // Leave a readable percentage between adjacent cards in horizontal chains.
  const width = horizontal ? Math.max(baseWidth, across * cardWidth + (across - 1) * 58 + (compact ? 54 : 72)) : baseWidth;
  const cardHeight = 86;
  const rowSpacing = !horizontal && columns > 3 ? 156 : 116;
  const height = horizontal && !compact ? 268 : Math.max(215, (down - 1) * rowSpacing + 181);
  const xMargin = cardWidth / 2 + (compact ? 14 : 23);
  const ys = algorithm.positions.map(([x]) => x);
  const min = Math.min(...ys), max = Math.max(...ys);
  const points = algorithm.positions.map(([x, row]) => {
    const fraction = min === max ? .5 : (x - min) / (max - min);
    if (!horizontal) return {
      x: compact ? xMargin + (width - 2 * xMargin) * fraction : 28 + x * (width - 56),
      y: down === 1 ? 97 : 66 + row * rowSpacing
    };
    return {
      x: xMargin + (width - 2 * xMargin - 26) * (rows === 1 ? .5 : row / (rows - 1)),
      y: compact ? 66 + (down - 1) * 116 * fraction : (down === 1 ? 130 : 84 + 107 * fraction)
    };
  });
  const bus = horizontal ? width - 22 : height - 36;
  const arrow = `url(#${id}-arrow)`;
  const feedback = points[feedbackTo - 1], send = points[feedbackFrom - 1];
  let loop = `M${feedback.x + 24} ${feedback.y - cardHeight / 2} v-16 h-48 v8`;
  if (feedbackFrom !== feedbackTo) {
    loop = horizontal
      ? `M${send.x} ${send.y - cardHeight / 2} V${Math.min(send.y, feedback.y) - cardHeight / 2 - 16} H${feedback.x} V${feedback.y - cardHeight / 2 - 8}`
      : `M${send.x + cardWidth / 2} ${send.y} H${Math.max(send.x, feedback.x) + cardWidth / 2 + 10} V${feedback.y} H${feedback.x + cardWidth / 2 + 8}`;
  }
  const singleOutput = algorithm.outputs.length === 1;
  // Paint the long outer curves first so their wide hit areas stay behind the inner branches.
  const lateralSpan = ([from, to]: number[]) => Math.abs(algorithm.positions[from - 1][0] - algorithm.positions[to - 1][0]);
  const branches = [...algorithm.edges].sort((a, b) => lateralSpan(b) - lateralSpan(a));
  const portOffset = (peers: number[], peer: number) => {
    if (peers.length === 1) return 0;
    // Give each branch its own attachment point, ordered like the operators facing it.
    peers.sort((a, b) => algorithm.positions[a - 1][0] - algorithm.positions[b - 1][0]);
    return (peers.indexOf(peer) / (peers.length - 1) - .5) * (horizontal ? cardHeight : cardWidth) * .7;
  };
  const modulationBranch = ([from, to]: number[]) => {
    const a = points[from - 1], b = points[to - 1];
    const targets = algorithm.edges.filter(([source]) => source === from).map(([, target]) => target);
    const sources = algorithm.edges.filter(([, target]) => target === to).map(([source]) => source);
    const out = portOffset(targets, to), into = portOffset(sources, from);
    const startX = a.x + (horizontal ? cardWidth / 2 : out), startY = a.y + (horizontal ? out : cardHeight / 2);
    const endX = b.x + (horizontal ? -cardWidth / 2 - 8 : into), endY = b.y + (horizontal ? into : -cardHeight / 2 - 8);
    const midX = (startX + endX) / 2, midY = (startY + endY) / 2;
    const controls = horizontal ? `${midX} ${startY} ${midX} ${endY}` : `${startX} ${midY} ${endX} ${midY}`;
    // Label the separate ends of a fan, where both the cable and its drag target are unambiguous.
    let labelX = horizontal ? midX : midX + 27;
    let labelY = horizontal ? midY - 6 : midY + 4;
    if (targets.length > 1) {
      if (!horizontal) labelX = endX + (endX < startX ? -26 : 26);
      labelY = endY - 5;
    } else if (sources.length > 1) {
      if (!horizontal) labelX = startX + (startX < endX ? -26 : 26);
      labelY = startY + (horizontal ? -5 : 17);
    }
    const path = `M${startX} ${startY} C${controls} ${endX} ${endY}`;
    if (renderBranch) return renderBranch({ from, to, path, labelX, labelY, arrow });
    return <path key={`${from}-${to}`} d={path} markerEnd={arrow} strokeWidth={1 + 6 * operator(from).level / 100} />;
  };
  return <div ref={container} className="rounded-lg border border-slate-700 bg-[#0a1321]">
    <svg role="group" aria-label={label}
      viewBox={`0 0 ${width} ${height}`} className="block w-full select-none">
      <defs>
        <pattern id={`${id}-dots`} width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#28364a" /></pattern>
        <marker id={`${id}-arrow`} markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="1" refY="5" orient="auto">
          <path d="M0 0 L9 5 L0 10 Z" fill="#bbc5d1" />
        </marker>
      </defs>
      <rect width={width} height={height} fill={`url(#${id}-dots)`} />
      <g fill="none" stroke="#7a8fa7" strokeWidth="1.7">
        {branches.map(modulationBranch)}
        {algorithm.outputs.map(op => {
          const { x, y } = points[op - 1];
          const lead = horizontal ? `M${x + cardWidth / 2} ${y} H${bus}` : `M${x} ${y + cardHeight / 2} V${bus}`;
          const tail = horizontal ? ` V${height - 33}` : " v9";
          const { level, outputLabel, enabled } = operator(op);
          const active = enabled && level > 0;
          return <path key={op} d={singleOutput ? lead + tail : lead} stroke="#63bdc4" strokeLinejoin="round"
            strokeWidth={active ? 1 + 6 * level / 100 : 1} strokeDasharray={active ? undefined : "3 3"} opacity={active ? 1 : .55}>
            <title>{`${copy.operator} ${op} → ${copy.output} · ${outputLabel ?? `${copy.level} ${level}%`}${enabled ? "" : ` · ${copy.off}`}`}</title>
          </path>;
        })}
        {!singleOutput && (horizontal ? <path d={`M${bus} ${Math.min(...algorithm.outputs.map(op => points[op - 1].y))} V${height - 33}`} stroke="#53959f" /> : <>
          <path d={`M${Math.min(...algorithm.outputs.map(op => points[op - 1].x))} ${bus} H${Math.max(...algorithm.outputs.map(op => points[op - 1].x))}`} stroke="#53959f" />
          <path d={`M${width / 2} ${bus} v9`} stroke="#53959f" />
        </>)}
        <path d={loop}
          strokeDasharray={feedbackOn ? undefined : "3 3"} markerEnd={arrow} />
      </g>
      <text x={feedback.x + 32} y={feedback.y - cardHeight / 2 - 10} fontSize="11" fill="#b7c4d5">↻ {feedbackLabel}</text>
      <text x={horizontal ? bus : width / 2} y={height - 12} textAnchor={horizontal ? "end" : "middle"} fill="#94d3dc" fontSize="13">{copy.output}</text>
      {points.map(({ x, y }, i) => {
        const op = i + 1, carrier = algorithm.outputs.includes(op);
        const role = carrier ? copy.carrier : copy.modulator;
        const { enabled, title, details } = operator(op);
        const ink = !enabled ? "#91a0b4" : carrier ? "#71e3e0" : "#f4bf77";
        const w = cardWidth, active = op === selected;
        return <g key={op} role="button" tabIndex={0} aria-pressed={active}
          aria-label={`${copy.operator} ${op} ${enabled ? role : copy.off}`}
          transform={`translate(${x - w / 2} ${y - cardHeight / 2})`}
          className="group cursor-pointer outline-none" onClick={() => onSelect(op)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(op); } }}>
          <title>{title}</title>
          <rect width={w} height={cardHeight} rx={8} stroke={active ? ink : enabled ? carrier ? "#396b77" : "#75604c" : "#475569"}
            strokeWidth={active ? 2.5 : 1.3} fill={!enabled ? "#1a2331" : carrier ? "#112d39" : "#302a27"}
            className="group-hover:brightness-125 group-focus-visible:stroke-white group-focus-visible:stroke-[3px]" />
          <text x="11" y="20" fill={ink} fontSize="14" fontWeight="700">{compact ? op : `OP ${op}`}</text>
          <text x={w - 10} y="20" textAnchor="end" fill="#d5deea" fontSize="12">{enabled ? role : copy.off}</text>
          {details(w, ink)}
        </g>;
      })}
    </svg>
  </div>;
}
