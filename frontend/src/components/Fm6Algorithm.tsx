import { useId, useLayoutEffect, useRef, useState } from "react";
import { FM6, FM6_FIELDS, fm6WeightKey } from "../lib/fm6";
import type { fm6Copy } from "../lib/fm6Copy";
import { Fm6ModulationBranch } from "./Fm6ModulationBranch";

type Props = {
  voice: Record<string, number>;
  copy: ReturnType<typeof fm6Copy>;
  selected: number | null;
  onSelect: (op: number) => void;
  selectedWeight: string | null;
  onSelectBranch: (from: number, to: number) => void;
  onWeight: (key: string, weight: number) => void;
  percent: Intl.NumberFormat;
  attackScale: number;
  releaseScale: number;
};

// A common scale lets operators be compared and keeps millisecond stages visible.
// Each timed stage occupies up to 28 units, including the longest scaled release.
const maxSeconds = FM6.fields.release[1] * FM6.globals.irelease_scale[1];
const logRange = Math.log1p(maxSeconds * 1000);
const stageWidth = (seconds: number) => 3 + 25 * Math.log1p(seconds * 1000) / logRange;

const [minRatio, maxRatio] = FM6.fields.ratio;
const octaveCount = Math.log2(maxRatio / minRatio);
const octaveTicks = Array.from({ length: octaveCount + 1 }, (_, i) => minRatio * 2 ** i);
const fineCents = 10;
const maxCents = FM6.fields.detune[1];

function OperatorTuning({ ratio, detune, ink, width, copy }: {
  ratio: number; detune: number; ink: string; width: number; copy: Props["copy"];
}) {
  const octaveStep = width * .36 / octaveCount;
  const ratioX = (value: number) => 12 + Math.log2(Math.min(maxRatio, Math.max(minRatio, value)) / minRatio) * octaveStep;
  const detuneHalf = width * .15;
  const center = width - 12 - detuneHalf;
  const cents = Math.min(Math.abs(detune), maxCents);
  // Reserve the inner half of each side for offsets of up to ten cents.
  const distance = cents <= fineCents ? cents / fineCents : 1 + (cents - fineCents) / (maxCents - fineCents);
  const detuneX = center + Math.sign(detune) * distance * detuneHalf / 2;
  const ratioLabel = `${ratio}×`, detuneLabel = `${detune > 0 ? "+" : ""}${detune} ¢`;
  const textScale = Math.min(1, (width - 28) / (.61 * (15 * ratioLabel.length + 12 * detuneLabel.length)));
  return <g fontFamily="monospace">
    <g>
      <title>{copy.ratioScale}</title>
      <text x="11" y="39" fontSize={15 * textScale} fill="#f1f5f9">{ratioLabel}</text>
      <line x1={ratioX(minRatio)} x2={ratioX(maxRatio)} y1="46" y2="46" stroke="#688691" />
      {octaveTicks.map(tick => <line key={tick} x1={ratioX(tick)} x2={ratioX(tick)} y1="46"
        y2={tick === 1 ? 52 : 49} stroke={tick === 1 ? "#d1e6eb" : "#688691"} />)}
      <circle cx={ratioX(ratio)} cy="46" r="2.6" fill={ink} />
    </g>
    <g>
      <title>{copy.detuneScale}</title>
      <text x={width - 10} y="39" textAnchor="end" fontSize={12 * textScale} fill="#ced9e5">{detuneLabel}</text>
      <line x1={center - detuneHalf} x2={center + detuneHalf} y1="47" y2="47" stroke="#688691" />
      <path d={`M${center - detuneHalf} 45v4 M${center - detuneHalf / 2} 46v2 M${center} 43v8 M${center + detuneHalf / 2} 46v2 M${center + detuneHalf} 45v4`} stroke="#9caebc" />
      <line x1={center} x2={detuneX} y1="47" y2="47" stroke={ink} strokeWidth="3" />
      <circle cx={detuneX} cy="47" r="2.4" fill={ink} />
    </g>
  </g>;
}

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

export function Fm6Algorithm({ voice, copy, selected, onSelect, selectedWeight, onSelectBranch, onWeight,
  percent, attackScale, releaseScale }: Props) {
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
  const feedback = points[5];
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
    const key = fm6WeightKey(from, to);
    return <Fm6ModulationBranch key={key} path={`M${startX} ${startY} C${controls} ${endX} ${endY}`} arrow={arrow}
      labelX={labelX} labelY={labelY}
      name={`${copy.branchWeight} · ${copy.operator} ${from} → ${copy.operator} ${to}`} help={copy.branchHelp} percent={percent}
      level={voice[`op${from}_enabled`] ? voice[`op${from}_level`] : 0} weight={voice[key]} selected={selectedWeight === key}
      onSelect={() => onSelectBranch(from, to)} onChange={value => onWeight(key, value)} />;
  };
  return <div ref={container} className="rounded-lg border border-slate-700 bg-[#0a1321]">
    <svg role="group" aria-label={`${copy.algorithm} · ${copy.algorithms[voice.algorithm - 1]}`}
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
          const level = voice[`op${op}_level`], enabled = Boolean(voice[`op${op}_enabled`]);
          const active = enabled && level > 0;
          return <path key={op} d={singleOutput ? lead + tail : lead} stroke="#63bdc4" strokeLinejoin="round"
            strokeWidth={active ? 1 + 6 * level / 100 : 1} strokeDasharray={active ? undefined : "3 3"} opacity={active ? 1 : .55}>
            <title>{`${copy.operator} ${op} → ${copy.output} · ${copy.level} ${level}%${enabled ? "" : ` · ${copy.off}`}`}</title>
          </path>;
        })}
        {!singleOutput && (horizontal ? <path d={`M${bus} ${Math.min(...algorithm.outputs.map(op => points[op - 1].y))} V${height - 33}`} stroke="#53959f" /> : <>
          <path d={`M${Math.min(...algorithm.outputs.map(op => points[op - 1].x))} ${bus} H${Math.max(...algorithm.outputs.map(op => points[op - 1].x))}`} stroke="#53959f" />
          <path d={`M${width / 2} ${bus} v9`} stroke="#53959f" />
        </>)}
        <path d={`M${feedback.x + 24} ${feedback.y - cardHeight / 2} v-16 h-48 v8`}
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
        const level = voice[prefix + "level"];
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
          <OperatorTuning ratio={voice[prefix + "ratio"]} detune={voice[prefix + "detune"]} ink={ink} width={w} copy={copy} />
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
