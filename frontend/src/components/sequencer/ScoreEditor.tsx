import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { GuiLanguage, ScoreNoteState, ScorePadState, ScoreTrackState } from "../../types";
import { buildSequencerChordOptions, scaleDegreeForNote } from "../../lib/sequencer";
import { scoreBeatTicks, scoreLengthTicks } from "../../lib/scoreSequencer";
import { usePerformanceEditorState } from "./PerformanceEditorState";
import { scoreCopy } from "./scoreCopy";

const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const scorePitchLabel = (pitch: number) => `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const colors = ["#fb7185", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#60a5fa", "#c084fc"];
const button = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-cyan-300 disabled:opacity-40";
type Gesture = { kind: "draw" | "move" | "start" | "end" | "select"; x: number; pitch: number; ids: string[]; initial: ScoreNoteState[]; note?: ScoreNoteState };

function ScorePlayhead({ track, pad, width, height, readPosition }: {
  track: ScoreTrackState; pad: ScorePadState; width: number; height: number; readPosition?: () => number | null;
}) {
  const ref = useRef<SVGLineElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const now = readPosition?.();
      const origin = track.runtimePadStartSubunit;
      const local = now != null && origin != null && track.enabled
        ? (now - origin) * track.timing.beatRateNumerator / track.timing.beatRateDenominator : -1;
      const length = scoreLengthTicks(pad, track.timing);
      const x = local >= 0 ? 64 + (local % length) / length * width : -100;
      ref.current?.setAttribute("x1", String(x)); ref.current?.setAttribute("x2", String(x));
      frame = requestAnimationFrame(update);
    };
    if (track.enabled && readPosition) update();
    else { ref.current?.setAttribute("x1", "-100"); ref.current?.setAttribute("x2", "-100"); }
    return () => cancelAnimationFrame(frame);
  }, [track.enabled, track.runtimePadStartSubunit, track.timing, pad, width, readPosition]);
  return <line ref={ref} y1={0} y2={height} stroke="#f8fafc" strokeWidth={1.5} pointerEvents="none" />;
}

export const ScoreEditor = memo(function ScoreEditor({ track, padIndex, pad, language, onCommit, readPosition, soundingPad }: {
  track: ScoreTrackState; padIndex: number; pad: ScorePadState; language: GuiLanguage;
  onCommit: (pad: ScorePadState) => void; readPosition?: () => number | null; soundingPad: number;
}) {
  const c = scoreCopy(language), owner = `device:${track.id}` as const, key = `score:${padIndex}`;
  const [selected, setSelected] = usePerformanceEditorState<string[]>(owner, `${key}:selection`, []);
  const [clipboard, setClipboard] = usePerformanceEditorState<ScoreNoteState[]>(owner, "scoreClipboard", []);
  const [zoom, setZoom] = usePerformanceEditorState(owner, `${key}:zoom`, 64);
  const [row, setRow] = usePerformanceEditorState(owner, `${key}:row`, 24);
  const [savedScroll, saveScroll] = usePerformanceEditorState(owner, `${key}:scroll`, { left: 0, top: 50 * 24 });
  const [tool, setTool] = usePerformanceEditorState<"draw" | "select">(owner, "scoreTool", "draw");
  const [position, setPosition] = useState(0);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScoreNoteState[] | null>(null);
  const [marquee, setMarquee] = useState<{ a: number; b: number; low: number; high: number } | null>(null);
  const [view, setView] = useState({ ...savedScroll, width: 900, height: 360 });
  const scroll = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), previewRef = useRef<ScoreNoteState[] | null>(null);
  const beat = scoreBeatTicks(track.timing), step = beat / track.timing.stepsPerBeat, length = scoreLengthTicks(pad, track.timing);
  const width = pad.lengthBeats * zoom, height = 128 * row + 28;
  const snap = (x: number) => Math.round(x / step) * step;
  const points = preview ?? pad.notes;
  const property = pad.notes.find(n => n.id === propertyId);
  const chordOptions = useMemo(() => buildSequencerChordOptions(property?.pitch ?? null, pad.scaleRoot, pad.mode), [property?.pitch, pad.scaleRoot, pad.mode]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    el.scrollLeft = savedScroll.left; el.scrollTop = savedScroll.top;
    const resize = () => setView(v => ({ ...v, width: el.clientWidth || 900, height: el.clientHeight || 360 }));
    resize(); const observer = new ResizeObserver(resize); observer.observe(el);
    return () => observer.disconnect();
    // Scroll is restored once when opening a pad; scrolling does not reset it.
  }, [padIndex]);
  const cancel = () => { gesture.current = null; previewRef.current = null; setPreview(null); setMarquee(null); };
  useEffect(() => { setPropertyId(null); cancel(); }, [padIndex]);
  const selectedSet = new Set(selected);
  const visible = points.filter(n => n.startTicks < length && 64 + n.startTicks / beat * zoom <= view.left + view.width &&
    64 + Math.min(length, n.startTicks + n.durationTicks) / beat * zoom >= view.left + 64 &&
    (127 - n.pitch) * row + 28 >= view.top - row && (127 - n.pitch) * row + 28 < view.top + view.height);
  const pitchTop = Math.max(0, Math.floor((view.top - 28) / row)), pitchBottom = Math.min(127, Math.ceil((view.top + view.height - 28) / row));
  const rows = Array.from({ length: pitchBottom - pitchTop + 1 }, (_, i) => pitchTop + i);
  const beatStride = zoom < 8 ? track.timing.meterNumerator * Math.ceil(30 / zoom / track.timing.meterNumerator) : 1;
  const beatStart = Math.max(0, Math.floor((view.left - 64) / zoom / beatStride) * beatStride);
  const beats = Array.from({ length: Math.max(0, Math.min(Math.ceil((pad.lengthBeats - beatStart + 1) / beatStride), Math.ceil(view.width / zoom / beatStride) + 3)) }, (_, i) => i * beatStride + beatStart);
  const coords = (e: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(length - step, snap((e.clientX - bounds.left + view.left - 64) / zoom * beat))),
      pitch: Math.max(0, Math.min(127, 127 - Math.floor((e.clientY - bounds.top + view.top - 28) / row))) };
  };
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("[data-keyboard]")) return;
    e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
    const p = coords(e); setPosition(p.x); setPropertyId(null);
    const element = (e.target as Element).closest("[data-note]");
    const note = pad.notes.find(n => n.id === element?.getAttribute("data-note"));
    if (note) {
      const ids = e.metaKey || e.ctrlKey ? selectedSet.has(note.id) ? selected.filter(id => id !== note.id) : [...selected, note.id]
        : selectedSet.has(note.id) ? selected : [note.id];
      setSelected(ids);
      if (!ids.includes(note.id)) return;
      gesture.current = { kind: element?.getAttribute("data-edge") as "start" | "end" || "move", ...p, ids, initial: pad.notes, note };
    } else if (tool === "select") {
      gesture.current = { kind: "select", ...p, ids: [], initial: pad.notes };
      setSelected([]);
    } else {
      const n: ScoreNoteState = { id: crypto.randomUUID(), pitch: p.pitch, startTicks: p.x, durationTicks: step, velocity: 100 };
      gesture.current = { kind: "draw", ...p, ids: [n.id], initial: pad.notes, note: n };
      previewRef.current = [...pad.notes, n]; setPreview(previewRef.current); setSelected([n.id]);
    }
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g) return;
    const p = coords(e), delta = p.x - g.x;
    if (g.kind === "select") {
      const m = { a: Math.min(g.x, p.x), b: Math.max(g.x, p.x) + step, low: Math.min(g.pitch, p.pitch), high: Math.max(g.pitch, p.pitch) };
      setMarquee(m); setSelected(pad.notes.filter(n => n.pitch >= m.low && n.pitch <= m.high && n.startTicks < m.b && n.startTicks + n.durationTicks > m.a).map(n => n.id)); return;
    }
    const selection = new Set(g.ids);
    let next = g.initial;
    if (g.kind === "draw" && g.note) next = [...g.initial, { ...g.note, startTicks: Math.min(g.x, p.x), durationTicks: Math.abs(delta) + step }];
    else if (g.kind === "move") {
      const chosen = g.initial.filter(n => selection.has(n.id));
      const shift = Math.max(-Math.min(...chosen.map(n => n.startTicks)), Math.min(delta, length - step - Math.max(...chosen.map(n => n.startTicks))));
      const pitchShift = Math.max(-Math.min(...chosen.map(n => n.pitch)), Math.min(p.pitch - g.pitch, 127 - Math.max(...chosen.map(n => n.pitch))));
      next = g.initial.map(n => selection.has(n.id) ? { ...n, startTicks: Math.max(0, Math.min(length - step, snap(n.startTicks + shift))), pitch: n.pitch + pitchShift } : n);
    } else next = g.initial.map(n => n.id !== g.note?.id ? n : g.kind === "start"
      ? { ...n, startTicks: Math.max(0, Math.min(n.startTicks + n.durationTicks - step, snap(n.startTicks + delta))), durationTicks: n.startTicks + n.durationTicks - Math.max(0, Math.min(n.startTicks + n.durationTicks - step, snap(n.startTicks + delta))) }
      : { ...n, durationTicks: Math.max(step, Math.min(length - n.startTicks, snap(n.startTicks + n.durationTicks + delta) - n.startTicks)) });
    previewRef.current = next; setPreview(next);
  };
  const copy = () => setClipboard(pad.notes.filter(n => selectedSet.has(n.id)).map(n => ({ ...n })));
  const paste = () => {
    if (!clipboard.length) return;
    const start = Math.min(...clipboard.map(n => n.startTicks));
    const added = clipboard.map(n => ({ ...n, id: crypto.randomUUID(), startTicks: n.startTicks - start + position })).filter(n => n.startTicks < length);
    onCommit({ ...pad, notes: [...pad.notes, ...added] }); setSelected(added.map(n => n.id));
  };
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {(["draw", "select"] as const).map(t => <button key={t} className={`${button} ${tool === t ? "!border-cyan-300 !text-cyan-200" : ""}`} aria-pressed={tool === t} onClick={() => setTool(t)}>{c[t]}</button>)}
      <button className={button} onClick={copy} disabled={!selected.length}>{c.copy}</button><button className={button} onClick={paste} disabled={!clipboard.length}>{c.paste}</button>
      <button className={button} onClick={() => { setZoom(Math.max(0.0625, (view.width - 64) / pad.lengthBeats)); if (scroll.current) scroll.current.scrollLeft = 0; }}>{c.fit}</button>
      <label className="text-xs text-slate-400">{c.zoom} <input aria-label={c.zoom} type="range" min={-4} max={8} step={0.1} value={Math.log2(zoom)} onChange={e => setZoom(2 ** Number(e.target.value))} /></label>
      <label className="text-xs text-slate-400">{c.height} <input aria-label={c.height} type="range" min={14} max={40} value={row} onChange={e => setRow(Number(e.target.value))} /></label>
    </div>
    {property && <div className="flex flex-wrap items-end gap-3 rounded border border-cyan-800 bg-slate-900 p-2" role="group" aria-label={c.properties}>
      <span className="text-sm text-cyan-200">{scorePitchLabel(property.pitch)}</span>
      <label className="text-xs">{c.velocity} <input className="w-16 rounded bg-slate-950 p-1" type="number" min={0} max={127} value={property.velocity} onChange={e => { const velocity = Number(e.target.value); if (Number.isInteger(velocity) && velocity >= 0 && velocity <= 127) onCommit({ ...pad, notes: pad.notes.map(n => n.id === property.id ? { ...n, velocity } : n) }); }} /></label>
      <label className="text-xs">{c.chord} <select className="rounded bg-slate-950 p-1" value="" onChange={e => {
        const chord = chordOptions.find(o => o.value === e.target.value); if (!chord) return;
        const added = chord.notes.filter(pitch => !pad.notes.some(n => n.pitch === pitch && n.startTicks === property.startTicks && n.durationTicks === property.durationTicks)).map(pitch => ({ ...property, pitch, id: crypto.randomUUID() }));
        onCommit({ ...pad, notes: [...pad.notes, ...added] }); setSelected([property.id, ...added.map(n => n.id)]);
      }}><option value="">—</option>{(["diatonic", "chromatic"] as const).map(group => <optgroup key={group} label={group === "diatonic" ? c.inScale : c.outScale}>{chordOptions.filter(o => o.group === group).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}</select></label>
      <button className={button} onClick={() => { onCommit({ ...pad, notes: pad.notes.filter(n => n.id !== property.id) }); setPropertyId(null); }}>{c.delete}</button>
      <button className={button} aria-label={c.close} onClick={() => setPropertyId(null)}>×</button>
    </div>}
    <div ref={scroll} className="relative h-[360px] overflow-auto rounded border border-slate-700 bg-slate-950" onScroll={e => {
      const next = { left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }; saveScroll(next); setView(v => ({ ...v, ...next }));
    }}>
      <div style={{ width: Math.max(width + 64, view.width), height, position: "relative" }}>
        <svg role="application" aria-label={`${track.name} ${c.title}`} tabIndex={0} width={view.width} height={view.height}
          viewBox={`${view.left} ${view.top} ${view.width} ${view.height}`} style={{ position: "absolute", left: view.left, top: view.top, touchAction: "none" }}
          onPointerDown={down} onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={cancel}
          onPointerUp={() => { const next = previewRef.current; cancel(); if (next) onCommit({ ...pad, notes: next }); }}
          onContextMenu={e => { e.preventDefault(); const id = (e.target as Element).closest("[data-note]")?.getAttribute("data-note"); if (id) { setSelected([id]); setPropertyId(id); } }}
          onKeyDown={e => {
            if (e.key === "Escape") { cancel(); setPropertyId(null); }
            if (e.key === "F10" && e.shiftKey && selected[0]) { e.preventDefault(); setPropertyId(selected[0]); }
            if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onCommit({ ...pad, notes: pad.notes.filter(n => !selectedSet.has(n.id)) }); }
            if (e.metaKey || e.ctrlKey) {
              if (e.key.toLowerCase() === "c") { e.preventDefault(); copy(); }
              if (e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
              if (e.key.toLowerCase() === "a") { e.preventDefault(); setSelected(pad.notes.map(n => n.id)); }
            }
          }}>
          <rect x={view.left} y={view.top} width={view.width} height={view.height} fill="#020617" />
          {rows.map(i => { const pitch = 127 - i, degree = scaleDegreeForNote(pitch, pad.scaleRoot, pad.mode), y = i * row + 28; return <g key={i}>
            <rect x={view.left + 64} y={y} width={view.width - 64} height={row} fill={degree ? colors[degree - 1] : "#64748b"} opacity={degree === 1 ? 0.14 : degree ? 0.065 : 0.02} />
            <line x1={view.left + 64} x2={view.left + view.width} y1={y + row} y2={y + row} stroke="#334155" strokeWidth={0.5} />
          </g>; })}
          {beats.map(b => <g key={b}><line x1={64 + b * zoom} x2={64 + b * zoom} y1={view.top} y2={view.top + view.height} stroke={b % track.timing.meterNumerator === 0 ? "#64748b" : "#334155"} />
            {zoom / track.timing.stepsPerBeat > 6 && Array.from({ length: track.timing.stepsPerBeat - 1 }, (_, j) => <line key={j} x1={64 + (b + (j + 1) / track.timing.stepsPerBeat) * zoom} x2={64 + (b + (j + 1) / track.timing.stepsPerBeat) * zoom} y1={view.top} y2={view.top + view.height} stroke="#1e293b" />)}</g>)}
          {visible.map(n => { const x = 64 + n.startTicks / beat * zoom, y = (127 - n.pitch) * row + 29, w = Math.max(3, (Math.min(length, n.startTicks + n.durationTicks) - n.startTicks) / beat * zoom), degree = scaleDegreeForNote(n.pitch, pad.scaleRoot, pad.mode); return <g key={n.id} data-note={n.id}>
            <rect data-note={n.id} x={x} y={y} width={w} height={row - 2} rx={3} fill={degree ? colors[degree - 1] : "#94a3b8"} opacity={0.55 + n.velocity / 127 * 0.4} stroke={selectedSet.has(n.id) ? "#fff" : "#0f172a"} strokeWidth={selectedSet.has(n.id) ? 2 : 1} />
            {w > 28 && <text x={x + 7} y={y + row * 0.65} fontSize={10} fill="#0f172a" pointerEvents="none">{scorePitchLabel(n.pitch)}</text>}
            <rect data-note={n.id} data-edge="start" x={x} y={y} width={Math.min(6, w / 3)} height={row - 2} fill="transparent" style={{ cursor: "ew-resize" }} />
            <rect data-note={n.id} data-edge="end" x={x + w - Math.min(6, w / 3)} y={y} width={Math.min(6, w / 3)} height={row - 2} fill="transparent" style={{ cursor: "ew-resize" }} />
          </g>; })}
          {marquee && <rect x={64 + marquee.a / beat * zoom} y={(127 - marquee.high) * row + 28} width={(marquee.b - marquee.a) / beat * zoom} height={(marquee.high - marquee.low + 1) * row} fill="#22d3ee22" stroke="#22d3ee" pointerEvents="none" />}
          {soundingPad === padIndex && <ScorePlayhead track={track} pad={pad} width={width} height={height} readPosition={readPosition} />}
          {rows.map(i => { const pitch = 127 - i, degree = scaleDegreeForNote(pitch, pad.scaleRoot, pad.mode), black = [1,3,6,8,10].includes(pitch % 12); return <g key={i} data-keyboard="true">
            <rect x={view.left} y={i * row + 28} width={64} height={row} fill={black ? "#0f172a" : "#cbd5e1"} stroke="#475569" />
            {degree && <rect x={view.left + 57} y={i * row + 29} width={6} height={row - 2} fill={colors[degree - 1]} />}
            <text x={view.left + 7} y={i * row + 28 + row * 0.7} fontSize={11} fill={black ? "#e2e8f0" : "#0f172a"}>{scorePitchLabel(pitch)}{degree ? ` · ${degree}` : ""}</text>
          </g>; })}
          <rect data-keyboard="true" x={view.left} y={view.top} width={view.width} height={26} fill="#0f172a" />
          {beats.filter(b => b % Math.max(track.timing.meterNumerator, Math.ceil(42 / zoom / track.timing.meterNumerator) * track.timing.meterNumerator) === 0).map(b => <text key={b} x={64 + b * zoom + 4} y={view.top + 17} fill="#cbd5e1" fontSize={11}>{Math.floor(b / track.timing.meterNumerator) + 1}</text>)}
        </svg>
      </div>
    </div>
    {!pad.notes.length && <p className="text-xs text-slate-500">{c.empty}</p>}
  </div>;
});
