import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GuiLanguage, SequencerState } from "../../types";
import { contentLength, definitionMap, newClipId, QUARTER_TICKS as Q, type Clip, type ClipArrangement, type ClipLane, type ContentItem, type OccurrenceTarget } from "../../lib/clipArranger/model";
import { addClip, convertLaneCycle, deleteClip, fitClip, trimClip, updateClip } from "../../lib/clipArranger/operations";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import { SectionTools } from "./SectionTools";
import { ContentEditor } from "./ContentEditor";
import { PatternPreview } from "./PatternPreview";
import { clipCopy } from "./copy";
import { usePerformanceEditorState } from "../sequencer/PerformanceEditorState";

export const clipButton = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-40";
export const clipInput = "w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100";
export type ClipArrangerProps = {
  model: ClipArrangement; sequencer: SequencerState; language: GuiLanguage;
  onChange: (model: ClipArrangement, label: string) => void;
  onEdit: (target: OccurrenceTarget) => void;
  inlineEditor?: { laneId: string; content: ReactNode };
  position?: number; onSeek?: (step: number) => void; onLoopChange?: (range: { startStep: number; endStep: number } | null) => void;
  transport?: ReactNode; laneControls?: (id: string) => ReactNode;
  onRemoveLane?: (id: string) => void;
  onAddLane?: (source: ClipLane["source"]) => void;
};

export function ClipArranger({ model, sequencer, language, onChange, onEdit, transport, laneControls, onAddLane, inlineEditor, position = 0, onSeek, onLoopChange, onRemoveLane }: ClipArrangerProps) {
  const c = clipCopy(language), timings = useMemo(() => arrangementTimings(sequencer), [sequencer]);
  const [expanded, setExpanded] = usePerformanceEditorState<string | null>("arranger", "clipExpandedLane", null);
  const [selected, select] = usePerformanceEditorState<{ laneId: string; clipId: string } | null>("arranger", "clipSelection", null);
  const [zoom, setZoom] = usePerformanceEditorState("arranger", "clipZoom", 40);
  const [scroll, setScroll] = useState(0);
  const viewport = useRef<HTMLDivElement>(null), [viewportWidth, setViewportWidth] = useState(1200);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => setViewportWidth(node.clientWidth || 1200);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null), [definitionId, setDefinitionId] = useState("");
  const [addStart, setAddStart] = useState(0);
  const addDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!adding) return;
    const previous = document.activeElement as HTMLElement | null, node = addDialog.current;
    node?.showModal?.();
    return () => { node?.close?.(); previous?.focus(); };
  }, [adding]);
  const [drag, setDrag] = useState<{ laneId: string; clipId: string; mode: "move" | "left" | "right"; x: number; delta: number } | null>(null);
  const dragRef = useRef(drag); dragRef.current = drag;
  const unit = zoom / Q, width = Math.max(900, (model.end / Q + 4) * zoom);
  const attempt = (action: () => ClipArrangement, label: string) => { try { onChange(action(), label); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const pick = (lane: ClipLane, clip: Clip) => { select({ laneId: lane.id, clipId: clip.id }); setExpanded(lane.id); };
  const selectedLane = model.lanes.find(l => l.id === selected?.laneId), selectedClip = selectedLane?.clips.find(cl => cl.id === selected?.clipId);
  const open = (lane: ClipLane, clip: Clip, path: string[], pass: number) => { pick(lane, clip); onEdit({ laneId: lane.id, clipId: clip.id, path, pass }); };
  const startDrag = (event: React.PointerEvent, lane: ClipLane, clip: Clip, mode: "move" | "left" | "right") => {
    if (event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); pick(lane, clip);
    setDrag({ laneId: lane.id, clipId: clip.id, mode, x: event.clientX, delta: 0 });
  };
  const moveDrag = (event: React.PointerEvent) => {
    const old = dragRef.current;
    if (old) setDrag({ ...old, delta: Math.round((event.clientX - old.x) / zoom * 4) * Q / 4 });
  };
  const endDrag = () => {
    const current = dragRef.current; setDrag(null);
    if (!current?.delta) return;
    const lane = model.lanes.find(l => l.id === current.laneId)!, clip = lane.clips.find(cl => cl.id === current.clipId)!;
    attempt(() => current.mode === "move" ? updateClip(model, lane.id, clip.id, { start: clip.start + current.delta }, timings)
      : trimClip(model, lane.id, clip.id, current.mode, clip.start + (current.mode === "right" ? clip.length : 0) + current.delta, timings), c.edit);
  };
  const dragHandlers = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: () => setDrag(null), onLostPointerCapture: () => setDrag(null) };
  const tree = (lane: ClipLane, clip: Clip, items: ContentItem[], path: string[], pass: number, depth = 0, origin = 0): ReactNode => {
    const defs = definitionMap(lane); let cursor = 0;
    return items.map(item => {
      const duration = contentLength(lane, [item], timings[lane.id]);
      const left = cursor * unit; cursor += duration;
      if (origin + left + duration * unit < scroll - 192 || origin + left > scroll + 1800) return null;
      const def = "definitionId" in item ? defs.get(item.definitionId)! : null;
      const itemPath = [...path, item.id];
      const color = !def ? "border-slate-600 bg-slate-900 text-slate-400" : def.kind === "pattern" ? "border-emerald-700 bg-emerald-950/70 text-emerald-200" : def.kind === "group" ? "border-rose-700 bg-rose-950/40 text-rose-200" : "border-violet-600 bg-violet-950/40 text-violet-200";
      return <div key={item.id} className={`absolute top-0 overflow-hidden rounded border ${color}`} style={{ left, width: duration * unit, height: def?.kind === "pattern" || !def ? 46 : 46 + (2 - depth) * 22 }}>
        <button className="block h-5 w-full truncate px-1 text-left text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" title={def ? `${def.kind}: ${def.name}` : c.rest}
          disabled={!def} onClick={e => { e.stopPropagation(); pick(lane, clip); }} onDoubleClick={e => { e.stopPropagation(); if (def) open(lane, clip, itemPath, pass); }}
          onKeyDown={e => { if (e.key === "Enter" && def) { e.stopPropagation(); open(lane, clip, itemPath, pass); } }}>{def ? `${def.kind === "pattern" ? "♪" : def.kind === "group" ? "▣" : "▤"} ${def.name}` : c.rest}</button>
        {def?.kind === "pattern" ? <PatternPreview definition={def} timing={timings[lane.id]} controllerMode={sequencer.controllerSequencers.find(t => t.id === lane.id)?.controllerMode} />
          : def ? <div className="relative mt-px">{tree(lane, clip, def.children, itemPath, pass, depth + 1, origin + left)}</div> : null}
      </div>;
    });
  };
  return <section className="mt-4 min-w-0 rounded-xl border border-slate-700 bg-slate-950/85 p-3" aria-label={c.title}>
    <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-semibold text-cyan-100">{c.title}</h2>{transport}
      {onSeek && <label className="text-xs text-slate-400">{c.position} <input className={clipInput} type="number" min={0} step={.25} key={Math.floor(position / Q)} defaultValue={Math.round(position / Q * 100) / 100} onBlur={e => onSeek(Math.round(Number(e.target.value) * 8))} /></label>}
      {onLoopChange && <button className={clipButton} aria-pressed={!!sequencer.arrangerLoopSelection} disabled={!selectedClip && !sequencer.arrangerLoopSelection} onClick={() => onLoopChange(sequencer.arrangerLoopSelection ? null : selectedClip ? { startStep: selectedClip.start / 2520, endStep: (selectedClip.start + selectedClip.length) / 2520 } : null)}>{c.loop} · {c.window}</button>}
      <label className="flex items-center gap-2 text-xs text-slate-400">{c.zoom}<input aria-label={c.zoom} type="range" min="12" max="100" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
      {onAddLane && <label className="text-xs text-slate-400">{c.newLane} <select className={clipInput} value="" onChange={e => onAddLane(e.target.value as ClipLane["source"])}><option value="">+</option>{Object.keys(sourceKeys).map(kind => <option key={kind} value={kind}>{c[kind === "sequencer" ? "melodic" : kind as Exclude<ClipLane["source"], "sequencer">]}</option>)}</select></label>}
    </div>
    <div ref={viewport} className="overflow-x-auto" onScroll={e => setScroll(e.currentTarget.scrollLeft)}>
      <div style={{ width: width + 192, minWidth: "100%" }}>
        <div className="relative ml-48 h-6 cursor-crosshair border-b border-slate-800" aria-hidden onClick={e => onSeek?.(Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 4) * 2))}>{Array.from({ length: Math.min(400, Math.ceil(1200 / zoom) + 4) }, (_, n) => n + Math.floor(scroll / zoom)).filter(n => n * zoom < width).map(beat => <span key={beat} className="absolute text-[10px] text-slate-500" style={{ left: beat * zoom }}>{beat % sequencer.timing.meterNumerator === 0 ? `${Math.floor(beat / sequencer.timing.meterNumerator) + 1}.1` : "·"}</span>)}</div>
        {model.lanes.map(lane => {
          const track = sequencer[sourceKeys[lane.source]].find(t => t.id === lane.id);
          const detailed = expanded === lane.id;
          return <div key={lane.id}><div className="relative flex border-b border-slate-800" data-clip-lane={lane.id} data-expanded={detailed} style={{ height: detailed ? 152 : 48 }}>
            <div className="sticky left-0 z-20 flex w-48 shrink-0 flex-col justify-center border-r border-slate-700 bg-slate-950 px-2">
              <button className="truncate text-left text-xs font-semibold text-slate-200" aria-expanded={detailed} onClick={() => setExpanded(detailed ? null : lane.id)}>{detailed ? "▾" : "▸"} {track?.name ?? lane.id}</button>
              <div className="flex items-center gap-1 text-[10px] text-slate-500"><span>{c[lane.source === "sequencer" ? "melodic" : lane.source]}</span>{laneControls?.(lane.id)}<button className="ml-auto px-2 text-sm text-cyan-300" aria-label={`${c.add}: ${track?.name}`} onClick={() => { setAddStart(Math.max(0, ...lane.clips.map(cl => cl.start + cl.length))); setAdding(lane.id); setDefinitionId(lane.definitions[0]?.id ?? ""); }}>+</button></div>
            </div>
            <div className="relative flex-1" style={{ backgroundSize: `${zoom}px 100%`, backgroundImage: "linear-gradient(to right, #1e293b 1px, transparent 1px)" }} onDoubleClick={e => {
              if (e.target === e.currentTarget) { setAddStart(Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 4) * Q / 4)); setAdding(lane.id); setDefinitionId(lane.definitions[0]?.id ?? ""); }
            }}>
              <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-cyan-300" style={{ left: position * unit }} />
              {lane.clips.filter(clip => (clip.start + clip.length) * unit > scroll - 192 && clip.start * unit < scroll + 1800).map(clip => {
                const duration = contentLength(lane, clip.children, timings[lane.id]);
                const firstPass = clip.mode === "loop" ? Math.floor((clip.offset + Math.max(0, (scroll - 192) / unit - clip.start)) / duration) : 0;
                const lastPass = clip.mode === "loop" ? Math.min(Math.ceil((clip.offset + clip.length) / duration), firstPass + Math.ceil(1800 / unit / duration) + 1) : 1;
                const moving = drag?.clipId === clip.id ? drag : null;
                const left = clip.start + (moving && moving.mode !== "right" ? moving.delta : 0);
                const length = clip.length + (moving ? moving.mode === "right" ? moving.delta : moving.mode === "left" ? -moving.delta : 0 : 0);
                return <div key={clip.id} className={`absolute top-1 overflow-hidden rounded border ${selected?.clipId === clip.id ? "border-cyan-300 ring-1 ring-cyan-900" : "border-slate-500"} bg-slate-900/90`} style={{ left: left * unit, width: Math.max(2, length * unit), height: detailed ? 138 : 40 }}>
                  <button className="relative z-10 block h-4 w-full cursor-grab truncate bg-slate-800/90 px-2 text-left text-[10px] font-semibold text-slate-200 touch-none" title={`${clip.name} · ${c.boundary}`} onClick={() => pick(lane, clip)}
                    onDoubleClick={() => { const first = clip.children.find(i => "definitionId" in i); if (first) open(lane, clip, [first.id], firstPass); }} onPointerDown={e => startDrag(e, lane, clip, "move")} {...dragHandlers}>{clip.name} {clip.mode === "loop" ? "↻" : ""}</button>
                  <div className="relative" style={{ height: detailed ? 110 : 24 }}>
                    {Array.from({ length: Math.max(0, lastPass - firstPass) }, (_, index) => firstPass + index).map(pass => <div key={pass} className={`absolute top-0 ${pass > 0 ? "border-l border-dashed border-slate-400" : ""}`} style={{ left: (pass * duration - clip.offset) * unit, width: duration * unit }}>
                      {detailed ? <><span className="block h-4 px-1 text-[9px] text-slate-500">{c.content} · {pass + 1}</span><div className="relative">{tree(lane, clip, clip.children, [], pass, 0, (clip.start + pass * duration - clip.offset) * unit)}</div></>
                        : <CompactContent lane={lane} clip={clip} sequencer={sequencer} unit={unit} from={scroll - 192 - (clip.start + pass * duration - clip.offset) * unit} to={scroll + 1800 - (clip.start + pass * duration - clip.offset) * unit} />}
                    </div>)}
                  </div>
                  {(["left", "right"] as const).map(edge => <div key={edge} role="separator" aria-label={`${c.length}: ${edge}`} aria-orientation="vertical" tabIndex={0}
                    className={`absolute inset-y-0 z-10 w-2 cursor-ew-resize touch-none hover:bg-cyan-300/30 focus-visible:bg-cyan-300/30 ${edge === "left" ? "left-0" : "right-0"}`} onPointerDown={e => startDrag(e, lane, clip, edge)} {...dragHandlers}
                    onKeyDown={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); attempt(() => trimClip(model, lane.id, clip.id, edge, clip.start + (edge === "right" ? clip.length : 0) + (e.key === "ArrowLeft" ? -Q / 4 : Q / 4), timings), c.edit); } }} />)}
                </div>;
              })}
            </div>
          </div>{detailed && inlineEditor?.laneId === lane.id && <div className="sticky left-0 p-2" style={{ width: Math.min(viewportWidth, 1200) }}>{inlineEditor.content}</div>}</div>;
        })}
      </div>
    </div>
    {selectedClip && selectedLane && <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-700 pt-3 text-xs text-slate-400">
      <span className="self-center text-cyan-200">{selectedClip.name}</span>
      {([-1, 1] as const).map(direction => <button key={direction} className={clipButton} aria-label={`${c.newLane}: ${direction < 0 ? c.up : c.down}`} disabled={model.lanes.indexOf(selectedLane) + direction < 0 || model.lanes.indexOf(selectedLane) + direction >= model.lanes.length} onClick={() => attempt(() => { const lanes = [...model.lanes], index = lanes.indexOf(selectedLane); [lanes[index], lanes[index + direction]] = [lanes[index + direction], lanes[index]]; return { ...model, revision: model.revision + 1, lanes }; }, c.edit)}>{direction < 0 ? "↑" : "↓"}</button>)}
      {onRemoveLane && <button className={clipButton} onClick={() => onRemoveLane(selectedLane.id)}>{c.removeTrack}</button>}
      {(["start", "length", "offset"] as const).map(field => <label key={`${selectedClip.id}:${field}:${selectedClip[field]}`} className="flex flex-col gap-1">{field === "offset" ? c.offset : c[field]} · {c.beats}
        <input className={clipInput} type="number" step="0.25" min={field === "length" ? .25 : 0} defaultValue={selectedClip[field] / Q} onBlur={e => { const value = Number(e.target.value) * Q; if (value !== selectedClip[field]) attempt(() => updateClip(model, selectedLane.id, selectedClip.id, { [field]: value }, timings), c.edit); }} /></label>)}
      <span className="self-center">{c.content}: {contentLength(selectedLane, selectedClip.children, timings[selectedLane.id]) / Q} {c.beats}</span>
      <select className={clipInput} aria-label={c.loop} value={selectedClip.mode} onChange={e => attempt(() => updateClip(model, selectedLane.id, selectedClip.id, { mode: e.target.value as Clip["mode"] }, timings), c.edit)}><option value="once">{c.once}</option><option value="loop">{c.loop}</option></select>
      <button className={clipButton} onClick={() => attempt(() => fitClip(model, selectedLane.id, selectedClip.id, timings), c.fit)}>{c.fit}</button>
      <button className={clipButton} onClick={() => attempt(() => deleteClip(model, selectedLane.id, selectedClip.id, timings), c.remove)}>{c.remove}</button>
      {selectedLane.cycleTicks !== null && <span>{c.localLoop}: {selectedLane.cycleTicks / Q} {c.beats} <button className={clipButton} onClick={() => attempt(() => convertLaneCycle(model, selectedLane.id, timings), c.convertCycle)}>{c.convertCycle}</button></span>}
      <details className="w-full"><summary>{c.content}</summary><ContentEditor lane={selectedLane} items={selectedClip.children} level="clip" sequencer={sequencer} language={language} onChange={(definitions, children) => attempt(() => ({ ...model, revision: model.revision + 1, lanes: model.lanes.map(l => l.id !== selectedLane.id ? l : { ...l, definitions, clips: l.clips.map(cl => cl.id === selectedClip.id ? { ...cl, children } : cl) }) }), c.edit)} /></details>
    </div>}
    <SectionTools model={model} timings={timings} selectedLane={selectedLane?.id} language={language} onChange={onChange} />
    {!model.lanes.length && <p className="py-8 text-center text-sm text-slate-500">{c.empty}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{c.error}: {error}</p>}
    {adding && <dialog ref={addDialog} aria-label={c.add} className="w-[min(94vw,400px)] rounded-xl border border-slate-600 bg-slate-900 p-5 backdrop:bg-black/60" onCancel={e => { e.preventDefault(); setAdding(null); }}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); const lane = model.lanes.find(l => l.id === adding)!;
        const children = [{ id: newClipId(), definitionId }];
        const length = contentLength(lane, children, timings[lane.id]);
        const start = addStart;
        attempt(() => addClip(model, lane.id, { id: newClipId(), name: lane.definitions.find(d => d.id === definitionId)?.name ?? c.window, start, length, offset: 0, mode: "loop", children }, timings), c.add); setAdding(null);
      }}><h3 className="text-sm text-cyan-100">{c.add}</h3><label className="block text-xs text-slate-300">{c.choose}<select autoFocus className={`${clipInput} mt-2 !w-full`} value={definitionId} onChange={e => setDefinitionId(e.target.value)}>{model.lanes.find(l => l.id === adding)?.definitions.map(d => <option key={d.id} value={d.id}>{d.name} · {d.kind}</option>)}</select></label>
        <label className="block text-xs text-slate-300">{c.start} · {c.beats}<input className={`${clipInput} ml-2`} type="number" min={0} step={.25} value={addStart / Q} onChange={e => setAddStart(Number(e.target.value) * Q)} /></label>
        <div className="flex justify-end gap-2"><button type="button" className={clipButton} onClick={() => setAdding(null)}>{c.cancel}</button><button className={clipButton} disabled={!definitionId}>{c.add}</button></div>
      </form></dialog>}
  </section>;
}

function CompactContent({ lane, clip, sequencer, unit, from, to }: { lane: ClipLane; clip: Clip; sequencer: SequencerState; unit: number; from: number; to: number }) {
  const timing = arrangementTimings(sequencer)[lane.id], defs = definitionMap(lane);
  let cursor = 0;
  const render = (items: ContentItem[]): ReactNode[] => items.flatMap<ReactNode>(item => {
    if ("restTicks" in item) { cursor += item.restTicks; return []; }
    const def = defs.get(item.definitionId)!;
    if (def.kind !== "pattern") return render(def.children);
    const duration = contentLength(lane, [item], timing), left = cursor * unit; cursor += duration;
    if (left + duration * unit < from || left > to) return [];
    return [<div key={`${item.id}:${left}`} className="absolute top-0" style={{ left, width: duration * unit }}><PatternPreview definition={def} timing={timing} controllerMode={sequencer.controllerSequencers.find(t => t.id === lane.id)?.controllerMode} /></div>];
  });
  return <>{render(clip.children)}</>;
}
