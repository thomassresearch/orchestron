import { FmAlgorithmCanvas } from "./FmAlgorithmCanvas";
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
  const algorithm = FM6.algorithms[voice.algorithm - 1];
  return <FmAlgorithmCanvas algorithm={algorithm} label={`${copy.algorithm} · ${copy.algorithms[voice.algorithm - 1]}`}
    copy={copy} selected={selected} onSelect={onSelect} feedbackFrom={6} feedbackTo={6}
    feedbackLabel={`${voice.feedback}%`} feedbackOn={Boolean(voice.feedback)}
    renderBranch={({ from, to, ...geometry }) => {
      const key = fm6WeightKey(from, to);
      return <Fm6ModulationBranch key={key} {...geometry}
        name={`${copy.branchWeight} · ${copy.operator} ${from} → ${copy.operator} ${to}`} help={copy.branchHelp} percent={percent}
        level={voice[`op${from}_enabled`] ? voice[`op${from}_level`] : 0} weight={voice[key]} selected={selectedWeight === key}
        onSelect={() => onSelectBranch(from, to)} onChange={value => onWeight(key, value)} />;
    }}
    operator={op => {
      const prefix = `op${op}_`, level = voice[prefix + "level"];
      const role = algorithm.outputs.includes(op) ? copy.carrier : copy.modulator;
      return { level, enabled: Boolean(voice[prefix + "enabled"]),
        title: [`${copy.operator} ${op} · ${role}`, ...FM6_FIELDS.filter(k => k !== "enabled").map(k => `${copy[k]}: ${voice[prefix + k]}`)].join("\n"),
        details: (w, ink) => {
          const barX = w * .57, barWidth = w - barX - 10;
          const levelWidth = barWidth * level / 100;
          const softLevelX = barX + levelWidth * (1 - voice[prefix + "velocity"] / 100);
          return <>
          <OperatorTuning ratio={voice[prefix + "ratio"]} detune={voice[prefix + "detune"]} ink={ink} width={w} copy={copy} />
          <OperatorEnvelope attack={voice[prefix + "attack"] * attackScale} decay={voice[prefix + "decay"]}
            sustain={voice[prefix + "sustain"]} release={voice[prefix + "release"] * releaseScale} ink={ink} width={w * .41} />
          <text x={w - 10} y="62" textAnchor="end" fontFamily="monospace" fontSize="12" fill={ink}>{level}%</text>
          <rect x={barX} y="68" width={barWidth} height="4" rx="2" fill="#526071" />
          <rect x={barX} y="68" width={levelWidth} height="4" rx="2" fill={ink} />
          <line x1={softLevelX} x2={softLevelX} y1="66" y2="74" stroke="#fff" strokeWidth="1.5" />
          </>;
        }
      };
    }} />;
}
