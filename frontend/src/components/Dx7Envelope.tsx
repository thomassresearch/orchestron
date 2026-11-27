import { dx7Envelope } from "../lib/dx7";

export function Dx7Envelope({ voice, offset, pitch, detail, label, keyOff, ink = "#71e3e0" }: {
  voice: number[]; offset: number; pitch?: boolean; detail?: boolean; label: string; keyOff?: string; ink?: string;
}) {
  const points = dx7Envelope(voice, offset, pitch ? voice[offset + 7] : 0);
  const width = detail ? 380 : 100, height = detail ? 54 : 24;
  const x = (n: number) => 3 + (width - 6) * n;
  const y = (n: number) => 4 + (height - 8) * n;
  const line = points.map(p => `${x(p.x)},${y(p.y)}`).join(" ");
  // L3 holds between the end of stage three and key release.
  const release = x(points[4].x);
  return <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height + (detail ? 14 : 0)}`}
    preserveAspectRatio="none" width="100%" height="100%">
    <line x1="3" x2={width - 3} y1={height - 4} y2={height - 4} stroke={ink} opacity=".22" />
    <polygon points={`3,${height - 4} ${line} ${width - 3},${height - 4}`} fill={ink} opacity=".12" />
    <line x1={release} x2={release} y1="2" y2={height} stroke={ink} opacity=".45" strokeDasharray="2 2" />
    <polyline fill="none" stroke={ink} strokeWidth={detail ? 2 : 1.4} vectorEffect="non-scaling-stroke" points={line} />
    {points.slice(1).map((p, i) => <circle key={i} cx={x(p.x)} cy={y(p.y)} r={detail ? 2.5 : 1.7} fill={ink} />)}
    {detail && <text x={Math.min(width - 2, Math.max(64, release))} textAnchor="end" y={height + 10} fontSize="10" fill="#b6c7d6">{keyOff}</text>}
  </svg>;
}
