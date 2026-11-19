import { useEffect, useId, useRef, useState } from "react";
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

function edgeBadge(point: { x: number; y: number }) {
  return { x: 200 + (point.x - 200) * 0.53, y: 119 + (point.y - 119) * 0.53 };
}

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
  const trigger = useRef<SVGGElement | null>(null);
  const popup = useRef<HTMLFormElement>(null);
  const editingEdge = edit?.edge;
  useEffect(() => {
    if (editingEdge === undefined) return;
    popup.current?.querySelector<HTMLElement>("input:not(:disabled), button")?.focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !trigger.current?.contains(target)) setEdit(null);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside, true);
    };
  }, [editingEdge]);
  function dismiss() {
    setEdit(null);
    trigger.current?.focus({ preventScroll: true });
  }
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
  // Percentages use the badge's coordinates in the SVG viewBox so scrolling and resizing
  // move the badge and its HTML controls together.
  const destination = visiblePoint(editingEdge);
  const anchor = destination && edgeBadge(destination);
  const locked = edit?.original.every((weight, i) => i === edit.edge || weight === 0);
  const choose = (i: number) => {
    select(i);
    setEdit(null);
  };
  function apply() {
    if (!edit || edit.value === "") return;
    onChange(chain.map((r, i) => (i === source ? row : r)));
    dismiss();
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
      <div className="mk-plot">
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
            const badge = edgeBadge({ x, y });
            const color = graphColors[i % graphColors.length],
              active = playing === i;
            const open = (element: SVGGElement) => {
              trigger.current = element;
              if (editingEdge === i) {
                dismiss();
                return;
              }
              setEdit({ edge: i, value: String(Number(chain[source][i].toFixed(2))), original: chain[source] });
            };
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
                  aria-haspopup="dialog"
                  aria-expanded={editingEdge === i}
                  aria-controls={editingEdge === i ? id + "-weight" : undefined}
                  aria-label={name(source) + " → " + label + " · " + units[i] / 10 + "%"}
                  transform={`translate(${badge.x} ${badge.y})`}
                  onClick={(e) => open(e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(e.currentTarget);
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
        {edit && anchor && (
          <form
            ref={popup}
            id={id + "-weight"}
            role="dialog"
            aria-label={name(source) + " → " + name(edit.edge)}
            className="mk-edge"
            style={{
              left: `clamp(0px, calc(${(100 * anchor.x) / 400}% - var(--mk-popup-width) / 2), calc(100% - var(--mk-popup-width)))`,
              ...(anchor.y < 120
                ? { top: `calc(${(100 * anchor.y) / 240}% + var(--mk-badge-gap))` }
                : { bottom: `calc(${100 - (100 * anchor.y) / 240}% + var(--mk-badge-gap))` }),
            }}
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                dismiss();
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
            <label className="mk-percent">
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
              %
            </label>
            <div className="mk-edge-actions">
              <button type="submit" disabled={edit.value === ""}>
                {copy.apply}
              </button>
              <button type="button" onClick={dismiss}>
                {copy.cancel}
              </button>
            </div>
          </form>
        )}
      </div>
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
    </section>
  );
}
