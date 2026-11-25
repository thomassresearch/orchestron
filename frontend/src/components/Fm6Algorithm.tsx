import { useId, useLayoutEffect, useRef, useState } from "react";
import { FM6, FM6_FIELDS } from "../lib/fm6";
import type { fm6Copy } from "../lib/fm6Copy";

type Props = {
  voice: Record<string, number>;
  copy: ReturnType<typeof fm6Copy>;
  selected: number | null;
  onSelect: (op: number) => void;
  attackScale: number;
  releaseScale: number;
};

// A common scale lets operators be compared and keeps millisecond stages visible.
// Each timed stage occupies up to 28 units, including the longest scaled release.
const maxSeconds = FM6.fields.release[1] * FM6.globals.irelease_scale[1];
const logRange = Math.log1p(maxSeconds * 1000);
const stageWidth = (seconds: number) => 3 + 25 * Math.log1p(seconds * 1000) / logRange;

function OperatorEnvelope({ attack, decay, sustain, release, ink, width }: {
  attack: number; decay: number; sustain: number; release: number; ink: string; width: number;
}) {
  const peak = stageWidth(attack);
  const held = peak + stageWidth(decay);
  const noteOff = held + 14;
  const end = noteOff + stageWidth(release);
  const sustainY = 20 * (1 - sustain / 100);
  const points = `0,20 ${peak},0 ${held},${sustainY} ${noteOff},${sustainY} ${end},20`;
  return <svg x="11" y="52" width={width} height="23" viewBox="-2 -3 104 26" preserveAspectRatio="none">
    <line x1="0" x2="100" y1="20" y2="20" stroke={ink} strokeOpacity=".22" />
    <polygon points={points} fill={ink} fillOpacity=".14" />
    <polyline points={points} fill="none" stroke={ink} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    <g fill={ink}>
      <circle cx={peak} cy="0" r="1.8" /><circle cx={held} cy={sustainY} r="1.8" />
      <circle cx={noteOff} cy={sustainY} r="1.8" /><circle cx={end} cy="20" r="1.8" />
    </g>
  </svg>;
}

export function Fm6Algorithm({ voice, copy, selected, onSelect, attackScale, releaseScale }: Props) {
  const id = useId().replace(/:/g, "");
  const algorithm = FM6.algorithms[voice.algorithm - 1];
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
  const horizontal = compact ? columns > rows : rows >= 4;
  const width = compact ? 420 : 1000;
  const across = horizontal ? rows : columns;
  const down = horizontal ? columns : rows;
  const desktopCardWidth = horizontal ? (rows === 6 ? 132 : 160) : across === 6 ? 140 : across === 5 ? 155 : 176;
  const cardWidth = compact ? Math.min(154, (width - 50) / across - 15) : desktopCardWidth;
  const cardHeight = 86;
  const height = horizontal && !compact ? 268 : Math.max(215, down * 116 + 65);
  const xMargin = cardWidth / 2 + (compact ? 14 : 23);
  const ys = algorithm.positions.map(([x]) => x);
  const min = Math.min(...ys), max = Math.max(...ys);
  const points = algorithm.positions.map(([x, row]) => {
    const fraction = min === max ? .5 : (x - min) / (max - min);
    if (!horizontal) return {
      x: compact ? xMargin + (width - 2 * xMargin) * fraction : 28 + x * (width - 56),
      y: down === 1 ? 97 : 66 + row * 116
    };
    return {
      x: xMargin + (width - 2 * xMargin - 26) * (rows === 1 ? .5 : row / (rows - 1)),
      y: compact ? 66 + (down - 1) * 116 * fraction : (down === 1 ? 130 : 84 + 107 * fraction)
    };
  });
  const bus = horizontal ? width - 22 : height - 36;
  const arrow = `url(#${id}-arrow)`;
  const feedback = points[5];
  return <div ref={container} className="rounded-lg border border-slate-700 bg-[#0a1321]">
    <svg role="group" aria-label={`${copy.algorithm} · ${copy.algorithms[voice.algorithm - 1]}`}
      viewBox={`0 0 ${width} ${height}`} className="block w-full select-none">
      <defs>
        <pattern id={`${id}-dots`} width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#28364a" /></pattern>
        <marker id={`${id}-arrow`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="m0 0 5 3-5 3" fill="none" stroke="#a1b2c7" strokeWidth="1.2" /></marker>
      </defs>
      <rect width={width} height={height} fill={`url(#${id}-dots)`} />
      <g fill="none" stroke="#7a8fa7" strokeWidth="1.7">
        {algorithm.edges.map(([from, to]) => {
          const a = points[from - 1], b = points[to - 1];
          const mid = (a.y + b.y) / 2;
          const path = horizontal ? `M${a.x + cardWidth / 2} ${a.y} H${(a.x + b.x) / 2} V${b.y} H${b.x - cardWidth / 2 - 4}`
            : `M${a.x} ${a.y + cardHeight / 2} V${mid} H${b.x} V${b.y - cardHeight / 2 - 4}`;
          return <path key={`${from}-${to}`} d={path} markerEnd={arrow} opacity={voice[`op${from}_enabled`] ? 1 : .35} />;
        })}
        {algorithm.outputs.map(op => {
          const { x, y } = points[op - 1];
          return <path key={op} d={horizontal ? `M${x + cardWidth / 2} ${y} H${bus}` : `M${x} ${y + cardHeight / 2} V${bus}`} stroke="#53959f" />;
        })}
        {horizontal ? <path d={`M${bus} ${Math.min(...algorithm.outputs.map(op => points[op - 1].y))} V${height - 33}`} stroke="#53959f" /> : <>
          <path d={`M${Math.min(...algorithm.outputs.map(op => points[op - 1].x))} ${bus} H${Math.max(...algorithm.outputs.map(op => points[op - 1].x))}`} stroke="#53959f" />
          <path d={`M${width / 2} ${bus} v9`} stroke="#53959f" />
        </>}
        <path d={`M${feedback.x + 24} ${feedback.y - cardHeight / 2} v-16 h-48 v13`}
          strokeDasharray={voice.feedback ? undefined : "3 3"} markerEnd={arrow} />
      </g>
      <text x={feedback.x + 32} y={feedback.y - cardHeight / 2 - 10} fontSize="11" fill="#b7c4d5">↻ {voice.feedback}%</text>
      <text x={horizontal ? bus : width / 2} y={height - 12} textAnchor={horizontal ? "end" : "middle"} fill="#94d3dc" fontSize="13">{copy.output}</text>
      {points.map(({ x, y }, i) => {
        const op = i + 1, prefix = `op${op}_`, carrier = algorithm.outputs.includes(op);
        const role = carrier ? copy.carrier : copy.modulator;
        const enabled = Boolean(voice[prefix + "enabled"]);
        const ink = !enabled ? "#91a0b4" : carrier ? "#71e3e0" : "#f4bf77";
        const w = cardWidth, active = op === selected;
        const level = voice[prefix + "level"], detune = voice[prefix + "detune"];
        const barX = w * .57, barWidth = w - barX - 10;
        const levelWidth = barWidth * level / 100;
        const softLevelX = barX + levelWidth * (1 - voice[prefix + "velocity"] / 100);
        return <g key={op} role="button" tabIndex={0} aria-pressed={active}
          aria-label={`${copy.operator} ${op} ${enabled ? role : copy.off}`}
          transform={`translate(${x - w / 2} ${y - cardHeight / 2})`}
          className="group cursor-pointer outline-none" onClick={() => onSelect(op)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(op); } }}>
          <title>{[`${copy.operator} ${op} · ${role}`, ...FM6_FIELDS.filter(k => k !== "enabled").map(k => `${copy[k]}: ${voice[prefix + k]}`)].join("\n")}</title>
          <rect width={w} height={cardHeight} rx={8} stroke={active ? ink : enabled ? carrier ? "#396b77" : "#75604c" : "#475569"}
            strokeWidth={active ? 2.5 : 1.3} fill={!enabled ? "#1a2331" : carrier ? "#112d39" : "#302a27"}
            className="group-hover:brightness-125 group-focus-visible:stroke-white group-focus-visible:stroke-[3px]" />
          <text x="11" y="20" fill={ink} fontSize="14" fontWeight="700">{compact ? op : `OP ${op}`}</text>
          <text x={w - 10} y="20" textAnchor="end" fill="#d5deea" fontSize="12">{enabled ? role : copy.off}</text>
          <text x="11" y="43" fill="#f1f5f9" fontFamily="monospace" fontSize="15">{voice[prefix + "ratio"]}×</text>
          <text x={w - 10} y="43" textAnchor="end" fill="#acb9c9" fontSize="11">{detune > 0 ? "+" : ""}{detune} ¢</text>
          <OperatorEnvelope attack={voice[prefix + "attack"] * attackScale} decay={voice[prefix + "decay"]}
            sustain={voice[prefix + "sustain"]} release={voice[prefix + "release"] * releaseScale} ink={ink} width={w * .41} />
          <text x={w - 10} y="62" textAnchor="end" fontFamily="monospace" fontSize="12" fill={ink}>{level}%</text>
          <rect x={barX} y="68" width={barWidth} height="4" rx="2" fill="#526071" />
          <rect x={barX} y="68" width={levelWidth} height="4" rx="2" fill={ink} />
          <line x1={softLevelX} x2={softLevelX} y1="66" y2="74" stroke="#fff" strokeWidth="1.5" />
        </g>;
      })}
    </svg>
  </div>;
}
