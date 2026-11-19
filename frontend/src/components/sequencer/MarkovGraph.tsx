import { useId, useState } from "react";
import { redistribute, type Chain } from "../../lib/markov";
import type { MarkovCopy } from "../../lib/markovCopy";

export const graphColors = [
  "#73dec2",
  "#87b8ff",
  "#efa6c6",
  "#ecc782",
  "#b9a3ee",
  "#88d7e0",
  "#aace84",
  "#eca993",
  "#b7bbc8",
];

export function MarkovGraph({
  title,
  labels,
  chain,
  onChange,
  playing,
  previous,
  copy,
  children,
}: {
  title: string;
  labels: string[];
  chain: Chain;
  onChange: (next: Chain) => void;
  playing?: number;
  previous?: number;
  copy: MarkovCopy;
  children: React.ReactNode;
}) {
  const id = useId(),
    start = labels.length;
  const [source, select] = useState(start),
    [page, setPage] = useState(0);
  const [edit, setEdit] = useState<{ edge: number; value: string; original: number[] } | null>(null);
  const name = (i: number) => labels[i] ?? copy.start;
  const row =
    edit && edit.value !== "" ? redistribute(edit.original, edit.edge, Number(edit.value)) : chain[source];
  const entries = labels.map((label, i) => ({ label, i })).slice(page * 9, page * 9 + 9);
  function point(index: number) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / entries.length;
    return { x: 200 + 161 * Math.cos(angle), y: 119 + 95 * Math.sin(angle) };
  }
  const visiblePoint = (state?: number) => {
    const i = entries.findIndex((entry) => entry.i === state);
    return i === -1 ? null : point(i);
  };
  const from = visiblePoint(previous),
    to = visiblePoint(playing);
  const locked = edit?.original.every((weight, i) => i === edit.edge || weight === 0);
  const choose = (i: number) => {
    select(i);
    setEdit(null);
  };
  function apply() {
    if (!edit || edit.value === "") return;
    onChange(chain.map((r, i) => (i === source ? row : r)));
    setEdit(null);
  }
  const units = row.map((n) => Math.floor(n * 10));
  const byRemainder = row.map((n, i) => ({ i, r: n * 10 - units[i] })).sort((a, b) => b.r - a.r);
  const left = 1000 - units.reduce((a, b) => a + b, 0);
  for (let j = 0; j < Math.min(left, units.length); j++) units[byRemainder[j].i]++;
  return (
    <section className="mk-graph" aria-label={title}>
      <header>
        <h3>{title}</h3>
        {children}
      </header>
      <label className="mk-from">
        {copy.from}{" "}
        <select aria-label={title + " · " + copy.from} value={source} onChange={(e) => choose(+e.target.value)}>
          <option value={start}>{copy.start}</option>
          {labels.map((l, i) => (
            <option key={i} value={i}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <svg viewBox="0 0 400 240" aria-label={title} role="group">
        <defs>
          <marker id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0L8 4L0 8" fill="#94a3b8" />
          </marker>
        </defs>
        {from && to && previous !== source && (
          <path
            fill="none"
            stroke="#e5f8ef"
            strokeWidth="2"
            pointerEvents="none"
            d={
              previous === playing
                ? `M ${to.x - 12} ${to.y - 9} c -15 -18 38 -18 24 0`
                : `M ${from.x} ${from.y} Q 200 96 ${to.x} ${to.y}`
            }
          />
        )}
        {entries.map(({ label, i }, index) => {
          const { x, y } = point(index),
            dx = x - 200,
            dy = y - 119;
          const color = graphColors[i % graphColors.length],
            active = playing === i;
          const open = () =>
            setEdit({ edge: i, value: String(Number(chain[source][i].toFixed(2))), original: chain[source] });
          return (
            <g key={i}>
              <line
                x1={200 + dx * 0.16}
                y1={119 + dy * 0.16}
                x2={200 + dx * 0.8}
                y2={119 + dy * 0.8}
                stroke={color}
                opacity={active && previous === source ? 1 : row[i] ? 0.57 : 0.25}
                strokeWidth={active && previous === source ? 4 : 1.5}
                strokeDasharray={row[i] ? undefined : "3 4"}
                markerEnd={`url(#${id})`}
              />
              <g
                role="button"
                tabIndex={0}
                aria-label={name(source) + " → " + label + " · " + units[i] / 10 + "%"}
                transform={`translate(${200 + dx * 0.53} ${119 + dy * 0.53})`}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                  }
                }}
              >
                <rect x="-21" y="-9" width="42" height="18" rx="6" fill="#111e31" stroke="#374458" />
                <text dy="3.5" fill={color}>
                  {units[i] / 10}%
                </text>
              </g>
              <g
                role="button"
                tabIndex={0}
                aria-label={title + " · " + label}
                aria-pressed={source === i}
                transform={`translate(${x} ${y})`}
                onClick={() => choose(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    choose(i);
                  }
                }}
              >
                <title>{label}</title>
                <rect
                  x="-30"
                  y="-13"
                  width="60"
                  height="26"
                  rx="13"
                  fill={active ? color : "#142234"}
                  stroke={color}
                  strokeWidth={source === i || active ? 2.5 : 1}
                />
                <text dy="4" fill={active ? "#081321" : color}>
                  {label.length > 9 ? label.slice(0, 8) + "…" : label}
                </text>
              </g>
            </g>
          );
        })}
        <rect x="171" y="104" width="58" height="30" rx="15" fill="#26394a" stroke="#9ab3c9" />
        <text x="200" y="123" fill="#edf4fb">
          {name(source).slice(0, 9)}
        </text>
      </svg>
      {labels.length > 9 && (
        <div>
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            {copy.prev}
          </button>{" "}
          {page + 1}/{Math.ceil(labels.length / 9)}{" "}
          <button disabled={(page + 1) * 9 >= labels.length} onClick={() => setPage(page + 1)}>
            {copy.next}
          </button>
        </div>
      )}
      {edit && (
        <form
          className="mk-edge"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setEdit(null);
            }
          }}
        >
          <strong>
            {name(source)} → {name(edit.edge)}
          </strong>
          <input
            aria-label={copy.chance}
            type="range"
            disabled={locked}
            min="0"
            max="100"
            step=".1"
            value={row[edit.edge]}
            onChange={(e) => setEdit({ ...edit, value: e.target.value })}
          />
          <input
            aria-label={copy.chance + " %"}
            type="number"
            disabled={locked}
            min="0"
            max="100"
            step="any"
            value={edit.value}
            onChange={(e) =>
              setEdit({
                ...edit,
                value: e.target.value === "" ? "" : String(Math.max(0, Math.min(100, +e.target.value))),
              })
            }
          />{" "}
          %<button type="submit">{copy.apply}</button>
          <button type="button" onClick={() => setEdit(null)}>
            {copy.cancel}
          </button>
        </form>
      )}
    </section>
  );
}
