import { structureCopy } from './structureCopy';
import { addOffsets, offsetAt } from "../../lib/clipArranger/transposition";
import { logicalRepeatIndex, transposePlans } from "../../lib/clipArranger/transposeModel";
import { AutomationGenerator } from "./AutomationControls";
import { automationCopy } from "./automationCopy";
import type { useStructureEditor } from "./StructureEditor";
import { structurePreview, structureClip, isExpandedStructure, structureDisplayGeometry } from "../../lib/clipArranger/structure";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GuiLanguage, SequencerState } from "../../types";
import { localBeatTicks, contentLength, definitionMap, newClipId, QUARTER_TICKS as Q, type Clip, type ClipArrangement, type ClipLane, type ContentItem, type OccurrenceTarget } from "../../lib/clipArranger/model";
import { addClip, convertLaneCycle, deleteClip, fitClip, trimClip, updateClip } from "../../lib/clipArranger/operations";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import { SectionTools } from "./SectionTools";
import { PatternPreview } from "./PatternPreview";
import { clipCopy } from "./copy";
import { usePerformanceEditorState } from "../sequencer/PerformanceEditorState";
import { LaneTransposeBadge, LaneTransposeDialog } from './LaneTransposition';
import { openClipTransposition } from '../../store/clipActions';
import { useAppStore } from '../../store/useAppStore';

export const clipButton = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-40";
export const clipInput = "w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100";
export type ClipArrangerProps = {
  model: ClipArrangement; sequencer: SequencerState; language: GuiLanguage;
  onChange: (model: ClipArrangement, label: string) => void;
  structure: ReturnType<typeof useStructureEditor>; zoom: number; setZoom: (zoom: number) => void;
  onEdit: (target: OccurrenceTarget) => void;
  stopAudition?: () => Promise<void>;
  editingTarget?: OccurrenceTarget;
  renderAutomation?: (target: OccurrenceTarget, range: [number, number]) => ReactNode;
  inlineEditor?: { laneId: string; content: ReactNode };
  position?: number; onSeek?: (step: number) => void; onLoopChange?: (range: { startStep: number; endStep: number } | null) => void;
  transport?: ReactNode; laneControls?: (id: string) => ReactNode;
  onRemoveLane?: (id: string) => void;
  onAddLane?: (source: ClipLane["source"]) => void;
};

export function ClipArranger({ model, sequencer, language, onChange, onEdit, structure, zoom, setZoom, editingTarget, transport, laneControls, onAddLane, inlineEditor, renderAutomation, position = 0, onSeek, onLoopChange, onRemoveLane, stopAudition = async () => {} }: ClipArrangerProps) {
  const c = clipCopy(language), timings = useMemo(() => arrangementTimings(sequencer), [sequencer]);
  const displayModel = useMemo(() => structure.draft ? structurePreview(model, structure.draft, timings) : model, [model, structure.draft, timings]);
  const [expanded, setExpanded] = usePerformanceEditorState<string | null>("arranger", "clipExpandedLane", null);
  const [transposing,setTransposing] = useState<{target:OccurrenceTarget;trigger:HTMLButtonElement}|null>(null);
  const generation = useAppStore(s=>s.performanceWorkspaceGeneration);
  useEffect(()=>setTransposing(null),[generation,expanded]);
  const [selected, select] = usePerformanceEditorState<{ laneId: string; clipId: string } | null | undefined>("arranger", "clipSelection", undefined);
  const editingLane = editingTarget?.laneId, editingClip = editingTarget?.clipId;
  useEffect(() => {
    if (editingLane && editingClip) { select({ laneId: editingLane, clipId: editingClip }); setExpanded(editingLane); }
  }, [editingLane, editingClip, select, setExpanded]);
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
  const [drag, setDrag] = useState<{ laneId: string; clipId: string; mode: "move" | "left" | "right"; x: number; delta: number } | null>(null);
  const dragRef = useRef(drag); dragRef.current = drag;
  const unit = zoom / Q, width = Math.max(900, (model.end / Q + 4) * zoom);
  const attempt = (action: () => ClipArrangement, label: string) => { try { onChange(action(), label); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const focusStructureOccurrence = (lane: ClipLane, clip: Clip, pass: number, path: string[]) => {
    const node = viewport.current;
    if (!node) return;
    const key = JSON.stringify([lane.id,clip.id,pass,...path]);
    const find = () => Array.from(node.querySelectorAll<HTMLButtonElement>('[data-structure-key]'))
      .find(button => button.dataset.structureKey === key);
    const visible = find();
    if (visible) { visible.focus(); return; }
    let start = clip.start - clip.offset + pass * contentLength(lane,clip.children,timings[lane.id]);
    let children = clip.children;
    for (const id of path) {
      const index = children.findIndex(item => item.id === id), item = children[index];
      if (!item) return;
      start += contentLength(lane,children.slice(0,index),timings[lane.id]);
      const definition = 'definitionId' in item ? lane.definitions.find(d => d.id === item.definitionId) : undefined;
      children = definition && definition.kind !== 'pattern' ? definition.children : [];
    }
    node.scrollLeft = Math.max(0,start * unit);
    setScroll(node.scrollLeft);
    requestAnimationFrame(() => find()?.focus());
  };
  const pick = (lane: ClipLane, clip: Clip) => { structure.setFocus({ laneId: lane.id, clipId: clip.id, pass: 0, parent: [] }); select({ laneId: lane.id, clipId: clip.id }); setExpanded(lane.id); };
  const createEmpty = (lane:ClipLane,start:number) => structure.guard((saved) => {
    const clip:Clip={id:newClipId(),name:c.window,start,length:4*Q,offset:0,mode:'once',children:[{id:newClipId(),restTicks:4*Q}]};
    try { onChange(addClip(saved??model,lane.id,clip,timings),c.add); select({laneId:lane.id,clipId:clip.id});structure.setFocus({laneId:lane.id,clipId:clip.id,pass:0,parent:[]});setError(null); } catch(e){setError(String(e));}
  });
  const selectedLane = model.lanes.find(l => l.id === selected?.laneId), selectedClip = selectedLane?.clips.find(cl => cl.id === selected?.clipId);
  const loopStart = sequencer.arrangerLoopSelection?.startStep, loopEnd = sequencer.arrangerLoopSelection?.endStep;
  useEffect(() => {
    // Selection is session-only. Give loaded performances a usable loop target
    // even when looping was saved off, without opening or expanding an editor.
    // null is an explicit deselection; undefined means this session has not selected yet.
    if (selected === null || selectedClip || editingClip) return;
    const candidates = model.lanes.flatMap(lane => lane.clips.map(clip => ({ lane, clip })))
      .sort((a, b) => a.clip.start - b.clip.start);
    const target = candidates.find(({ clip }) => loopStart !== undefined && loopEnd !== undefined &&
      clip.start === loopStart * 2520 && clip.start + clip.length === loopEnd * 2520)
      ?? candidates.find(({ clip }) => clip.start <= position && position < clip.start + clip.length)
      ?? candidates[0];
    if (target) select({ laneId: target.lane.id, clipId: target.clip.id });
  }, [selected, selectedClip, editingClip, loopStart, loopEnd, model.lanes, position, select]);
  const lastClipEnd = Math.max(Q / 4, ...model.lanes.flatMap(lane => lane.clips.map(clip => clip.start + clip.length)));
  const setSongEnd = (end: number) => attempt(() => ({ ...model, revision: model.revision + 1, end }), c.songEnd);
  const open = (lane: ClipLane, clip: Clip, path: string[], pass: number) => { pick(lane, clip); structure.guardEdit({ laneId: lane.id, clipId: clip.id, path, pass }, onEdit); };
  const openTranspose = (requested:OccurrenceTarget,trigger:HTMLButtonElement) => {
    structure.cancelDrag();
    structure.guardEdit(requested,target=>{openClipTransposition(target);setTransposing({target,trigger});});
  };
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
    return [...items.map((item, itemIndex) => {
      const duration = contentLength(lane, [item], timings[lane.id]);
      const left = cursor * unit; cursor += duration;
      if (origin + left + duration * unit < scroll - 192 || origin + left > scroll + 1800) return null;
      const def = "definitionId" in item ? defs.get(item.definitionId)! : null;
      const itemPath = [...path, item.id];
      const color = !def ? "border-slate-600 bg-slate-900 text-slate-400" : def.kind === "pattern" ? "border-emerald-700 bg-emerald-950/70 text-emerald-200" : def.kind === "group" ? "border-rose-700 bg-rose-950/40 text-rose-200" : "border-violet-600 bg-violet-950/40 text-violet-200";
      const target = { laneId: lane.id, clipId: clip.id, pass, parent: path };
      const boundCurve = sequencer.controllerSequencers.some(t => t.id === lane.id && t.automationTarget && t.controllerMode === "curve");
      const visibleLeft = Math.max(0, scroll - 192 - origin - left, clip.start * unit - origin - left);
      const visibleRight = Math.min(duration * unit, scroll + viewportWidth - origin - left, (clip.start + clip.length) * unit - origin - left);
      const headerLeft = Math.max(0, scroll - origin - left, clip.start * unit - origin - left);
      const headerRight = Math.min(duration * unit, scroll + viewportWidth - 192 - origin - left, (clip.start + clip.length) * unit - origin - left);
      const selectedItem = structure.isSelected(target,item.id);
      const offset = def ? addOffsets(transposePlans(lane,clip,itemPath).map(p=>offsetAt(p,(clip.repeatIndexBase??0)+pass))) : undefined;
      return <div data-structure-node={JSON.stringify({ focus: target, index: itemIndex })} key={item.id} className={`absolute top-0 overflow-hidden rounded border ${color}`} style={{ outline: selectedItem ? "2px solid #67e8f9" : undefined, left, width: duration * unit, height: (boundCurve ? 108 : 46) + (def && def.kind !== "pattern" ? (2 - depth) * 22 : 0) }}>
        {structure.boundary(target, itemIndex, 0)}
        <div className="flex h-5 min-w-0 items-center overflow-hidden" style={{marginLeft:headerLeft,width:Math.max(0,headerRight-headerLeft)}}><button data-structure-key={JSON.stringify([lane.id, clip.id, pass, ...path, item.id])} onPointerDown={e => structure.pointerDown(e, target, item.id)} onContextMenu={e => { e.preventDefault(); structure.contextMenu(target, item.id, e.clientX, e.clientY); }} className="block h-5 min-w-0 flex-1 truncate px-1 text-left text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" title={def ? `${def.kind}: ${def.name}` : c.rest}
          onClick={e => { e.stopPropagation(); select({ laneId: lane.id, clipId: clip.id }); setExpanded(lane.id); structure.select(target, item.id, e.shiftKey); }} onDoubleClick={e => { e.stopPropagation(); if (def) open(lane, clip, itemPath, pass); }}
          onKeyDown={e => { if (!e.shiftKey && ["ArrowLeft","ArrowRight"].includes(e.key)) {e.preventDefault();e.stopPropagation();structure.nudge(target,item.id,(e.key==="ArrowLeft"?-1:1)*Q/4);} if (["Delete", "Backspace"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); structure.remove(target, item.id); } if (e.shiftKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); const next = structure.extendSelection(target,item.id,e.key === "ArrowLeft" ? -1 : 1); if(next)focusStructureOccurrence(lane,clip,next.focus.pass,[...next.focus.parent,next.id]); } if (e.key === "Enter" && def) { e.stopPropagation(); open(lane, clip, itemPath, pass); } }}>{def ? `${def.kind === "pattern" ? "♪" : def.kind === "group" ? "▣" : "▤"} ${def.name}` : c.rest}</button>
        {def && ['sequencer','score','arpeggiator'].includes(lane.source) && headerRight>headerLeft && <LaneTransposeBadge target={{laneId:lane.id,clipId:clip.id,path:itemPath,pass}} name={def.name} index={logicalRepeatIndex(lane,clip,itemPath,pass)} offset={offset!} width={headerRight-headerLeft} language={language} onOpen={openTranspose}/>}</div>
        {def?.kind==='pattern' && (['left','right'] as const).map(edge=><div key={edge} role="separator" aria-label={`${c.length}: ${def.name} ${edge}`} aria-orientation="vertical" tabIndex={0} className={`absolute bottom-0 top-5 z-20 w-2 cursor-ew-resize ${edge==='left'?'left-0':'right-0'} hover:bg-cyan-300/50 focus:bg-cyan-300/50`} onPointerDown={e=>structure.resizeDown(e,target,item.id,edge)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();structure.resize(target,item.id,edge,(e.key==='ArrowLeft'?-1:1)*localBeatTicks(timings[lane.id]));}}}/>)}
        {def?.kind === "pattern" ? boundCurve && visibleRight > visibleLeft ? <div style={{ marginLeft: visibleLeft, width: visibleRight - visibleLeft }} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          {renderAutomation?.({ laneId: lane.id, clipId: clip.id, path: itemPath, pass }, [visibleLeft / (duration * unit), visibleRight / (duration * unit)]) ??
            <button className="block w-full" aria-label={`${c.edit}: ${def.name}`} onClick={() => open(lane, clip, itemPath, pass)}><PatternPreview definition={def} timing={timings[lane.id]} height={72} visibleRange={[visibleLeft / (duration * unit), visibleRight / (duration * unit)]} /></button>}
        </div> : <PatternPreview definition={def} offset={offset} timing={timings[lane.id]} controllerMode={sequencer.controllerSequencers.find(t => t.id === lane.id)?.controllerMode} />
          : def ? <div className="relative mt-px">{tree(lane, clip, def.children, itemPath, pass, depth + 1, origin + left)}</div> : null}
      </div>;
    }), structure.boundary({ laneId: lane.id, clipId: clip.id, pass, parent: path }, items.length, cursor * unit, true)];
  };
  return <section className="mt-4 min-w-0 rounded-xl border border-slate-700 bg-slate-950/85 p-3" aria-label={c.title}>
    <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-semibold text-cyan-100">{c.title}</h2>{transport}
      {onSeek && <label className="text-xs text-slate-400">{c.position} <input className={clipInput} type="number" min={0} step={.25} key={Math.floor(position / Q)} defaultValue={Math.round(position / Q * 100) / 100} onBlur={e => onSeek(Math.round(Number(e.target.value) * 8))} /></label>}
      {onLoopChange && <button className={clipButton + (sequencer.arrangerLoopSelection ? " !border-amber-300 !bg-amber-300 !text-slate-950 ring-2 ring-amber-300" : "")} aria-pressed={!!sequencer.arrangerLoopSelection} title={selectedClip ? c.loopClip : c.loopSong} onClick={() => onLoopChange(sequencer.arrangerLoopSelection ? null : selectedClip ? { startStep: selectedClip.start / 2520, endStep: (selectedClip.start + selectedClip.length) / 2520 } : { startStep: 0, endStep: model.end / 2520 })}>{c.loop}</button>}
      <label className="flex items-center gap-2 text-xs text-slate-400">{c.zoom}<input aria-label={c.zoom} type="range" min="12" max="100" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
      {onAddLane && <label className="text-xs text-slate-400">{c.newLane} <select className={clipInput} value="" onChange={e => onAddLane(e.target.value as ClipLane["source"])}><option value="">+</option>{Object.keys(sourceKeys).map(kind => <option key={kind} value={kind}>{c[kind === "sequencer" ? "melodic" : kind as Exclude<ClipLane["source"], "sequencer">]}</option>)}</select></label>}
    </div>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <label>{c.songEnd} · {c.beats} <input className={clipInput} aria-label={c.songEnd} type="number" min={lastClipEnd / Q} step="0.25" key={model.end} defaultValue={model.end / Q} onBlur={e => { const end = Number(e.target.value) * Q; if (end !== model.end) setSongEnd(end); }} /></label>
      <button className={clipButton} disabled={model.end === lastClipEnd} onClick={() => setSongEnd(lastClipEnd)}>{c.fitSong}</button>
    </div>
    <div data-arranger-viewport onClickCapture={e => {
      const target = e.target as Element;
      if (!target.closest("[data-arranger-clip], [data-clip-inline-editor]")) { select(null); structure.clearSelection(); }
    }} onPointerMove={e=>{structure.pointerMove(e);const hovered=(document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-clip-lane]') as HTMLElement|null)?.dataset.clipLane;if(structure.dragging()&&hovered)setExpanded(hovered);}} onPointerUp={structure.pointerUp} onPointerCancel={structure.cancelDrag} onLostPointerCapture={e => { if (e.target === e.currentTarget) structure.lostCapture(); }} ref={viewport} className="overflow-x-auto" onScroll={e => setScroll(e.currentTarget.scrollLeft)}>
      <div style={{ width: width + 192, minWidth: "100%", paddingBottom: 16 }}>
        <div className="relative ml-48 h-6 cursor-crosshair border-b border-slate-800" aria-hidden onClick={e => onSeek?.(Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 4) * 2))}>{sequencer.arrangerLoopSelection && <span className="pointer-events-none absolute inset-y-0 border-x border-amber-300 bg-amber-400/20" style={{ left: sequencer.arrangerLoopSelection.startStep * 2520 * unit, width: (sequencer.arrangerLoopSelection.endStep - sequencer.arrangerLoopSelection.startStep) * 2520 * unit }} />}{Array.from({ length: Math.min(400, Math.ceil(1200 / zoom) + 4) }, (_, n) => n + Math.floor(scroll / zoom)).filter(n => n * zoom < width).map(beat => <span key={beat} className="absolute text-[10px] text-slate-500" style={{ left: beat * zoom }}>{beat % sequencer.timing.meterNumerator === 0 ? `${Math.floor(beat / sequencer.timing.meterNumerator) + 1}.1` : "·"}</span>)}</div>
        {displayModel.lanes.map(lane => {
          const track = sequencer[sourceKeys[lane.source]].find(t => t.id === lane.id);
          const detailed = expanded === lane.id;
          const expandedHeight = track && "automationTarget" in track && track.automationTarget && track.controllerMode === "curve"
            ? lane.clips.some(cl => cl.children.some(item => "definitionId" in item && lane.definitions.find(d => d.id === item.definitionId)?.kind !== "pattern")) ? 198 : 154 : 152;
          return <div key={lane.id}><div className="relative flex border-b border-slate-800" data-clip-lane={lane.id} data-expanded={detailed} style={{ height: detailed ? expandedHeight : 48 }}>
            <div className="sticky left-0 z-20 flex w-48 shrink-0 flex-col justify-center border-r border-slate-700 bg-slate-950 px-2">
              <button className="truncate text-left text-xs font-semibold text-slate-200" aria-expanded={detailed} onClick={() => { structure.cancelDrag(); setExpanded(detailed ? null : lane.id); }}>{detailed ? "▾" : "▸"} {track?.name ?? lane.id}</button>
              <div className="flex items-center gap-1 text-[10px] text-slate-500"><span>{c[lane.source === "sequencer" ? "melodic" : lane.source]}</span>{track && "automationSuspended" in track && track.automationSuspended && <span title={automationCopy(language).suspended} aria-label={automationCopy(language).suspended} className="text-amber-300">⚠</span>}{laneControls?.(lane.id)}<button className="ml-auto px-2 text-sm text-cyan-300" aria-label={`${c.add}: ${track?.name}`} onClick={() => { createEmpty(lane,Math.max(0,...lane.clips.map(cl=>cl.start+cl.length))); }}>+</button></div>
            </div>
            <div data-clip-timeline className="relative flex-1" style={{ backgroundSize: `${zoom}px 100%`, backgroundImage: "linear-gradient(to right, #1e293b 1px, transparent 1px)" }} onDoubleClick={e => {
              if (e.target === e.currentTarget) { createEmpty(lane,Math.max(0,Math.round((e.clientX-e.currentTarget.getBoundingClientRect().left)/zoom*4)*Q/4)); }
            }}>
              <div className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-amber-400/80" title={c.songEnd} style={{ left: model.end * unit }} />
              <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-cyan-300" style={{ left: position * unit }} />
              {lane.clips.filter(clip => (clip.start + clip.length) * unit > scroll - 192 && clip.start * unit < scroll + 1800).map(clip => {
                let originalClip = model.lanes.find(l => l.id === lane.id)?.clips.find(c => c.id === clip.id) ?? clip;
                const editingStructure = structure.draft?.laneId === lane.id && structure.draft.clipId === clip.id ? structure.draft : null;
                if(editingStructure&&isExpandedStructure(editingStructure))originalClip=structureClip(editingStructure);
                const duration = Math.max(1, contentLength(lane, originalClip.children, timings[lane.id]));
                const draftDuration = contentLength(lane, clip.children, timings[lane.id]);
                const geometry = editingStructure ? structureDisplayGeometry(originalClip, isExpandedStructure(editingStructure)?editingStructure.expanded!.contentTicks:duration, draftDuration, editingStructure.pass) : {length: clip.length, left: (pass: number) => pass * duration - clip.offset};
                const firstPass = clip.mode === "loop" ? Math.floor((clip.offset + Math.max(0, (scroll - 192) / unit - clip.start)) / duration) : 0;
                const lastPass = clip.mode === "loop" ? Math.min(Math.ceil((clip.offset + clip.length) / duration), firstPass + Math.ceil(1800 / unit / duration) + 1) : 1;
                const moving = drag?.clipId === clip.id ? drag : null;
                const left = clip.start + (moving && moving.mode !== "right" ? moving.delta : 0);
                const length = geometry.length + (moving ? moving.mode === "right" ? moving.delta : moving.mode === "left" ? -moving.delta : 0 : 0);
                return <div key={clip.id} data-arranger-clip={clip.id} onClickCapture={() => { select({ laneId: lane.id, clipId: clip.id }); }} className={`absolute top-1 overflow-hidden rounded border ${selected?.clipId === clip.id ? "border-cyan-300 ring-1 ring-cyan-900" : "border-slate-500"} bg-slate-900/90`} style={{ left: left * unit, width: Math.max(2, length * unit), height: detailed ? expandedHeight - 14 : 40 }}>
                  <button className="relative z-10 block h-4 w-full cursor-grab truncate bg-slate-800/90 px-2 text-left text-[10px] font-semibold text-slate-200 touch-none" title={`${clip.name} · ${c.boundary}`} onClick={() => pick(lane, clip)}
                    onDoubleClick={() => { const first = clip.children.find(i => "definitionId" in i); if (first) open(lane, clip, [first.id], firstPass); }} onPointerDown={e => startDrag(e, lane, clip, "move")} {...dragHandlers}>{clip.name} {clip.mode === "loop" ? "↻" : ""}</button>
                  <div className="relative" style={{ height: detailed ? expandedHeight - 42 : 24 }}>
                    {clip.children.every(i=>'restTicks' in i) ? <button aria-label={structureCopy(language).add} className="absolute inset-0 z-20 text-lg text-cyan-300" onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();structure.add({laneId:lane.id,clipId:clip.id,pass:0,parent:[]},0,0);}}>+</button> : Array.from({ length: Math.max(0, lastPass - firstPass) }, (_, index) => firstPass + index).map(pass => <div key={pass} className={`absolute top-0 ${pass > 0 ? "border-l border-dashed border-slate-400" : ""}`} style={{ left: geometry.left(pass) * unit, width: (editingStructure && pass === editingStructure.pass ? draftDuration : duration) * unit }}>
                      {detailed ? <><span className="block h-4 px-1 text-[9px] text-slate-500">{c.content} · {(clip.repeatIndexBase ?? 0) + pass + 1}</span><div className="relative">{tree(lane, editingStructure && pass !== editingStructure.pass ? originalClip : clip, editingStructure && pass !== editingStructure.pass ? originalClip.children : clip.children, [], pass, 0, (clip.start + geometry.left(pass)) * unit)}</div></>
                        : <CompactContent pass={pass} lane={lane} clip={clip} sequencer={sequencer} unit={unit} from={scroll - (clip.start + pass * duration - clip.offset) * unit} to={scroll + viewportWidth - 192 - (clip.start + pass * duration - clip.offset) * unit} language={language} onTranspose={openTranspose} />}
                    </div>)}
                  </div>
                  {(["left", "right"] as const).map(edge => <div key={edge} role="separator" aria-label={`${c.length}: ${edge}`} aria-orientation="vertical" tabIndex={0}
                    className={`absolute inset-y-0 z-10 w-2 cursor-ew-resize touch-none hover:bg-cyan-300/30 focus-visible:bg-cyan-300/30 ${edge === "left" ? "left-0" : "right-0"}`} onPointerDown={e => startDrag(e, lane, clip, edge)} {...dragHandlers}
                    onKeyDown={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); attempt(() => trimClip(model, lane.id, clip.id, edge, clip.start + (edge === "right" ? clip.length : 0) + (e.key === "ArrowLeft" ? -Q / 4 : Q / 4), timings), c.edit); } }} />)}
                </div>;
              })}
            </div>
          </div>{detailed && inlineEditor?.laneId === lane.id && <div data-clip-inline-editor className="sticky left-0 p-2" style={{ width: Math.min(viewportWidth, 1200) }}>{inlineEditor.content}</div>}</div>;
        })}
      </div>
    </div>
    {structure.toolbar}
    {selectedClip && selectedLane && <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-700 pt-3 text-xs text-slate-400">
      <span className="self-center text-cyan-200">{selectedClip.name}</span>
      <AutomationGenerator laneId={selectedLane.id} clipId={selectedClip.id} language={language} />
      {([-1, 1] as const).map(direction => <button key={direction} className={clipButton} aria-label={`${c.newLane}: ${direction < 0 ? c.up : c.down}`} disabled={model.lanes.indexOf(selectedLane) + direction < 0 || model.lanes.indexOf(selectedLane) + direction >= model.lanes.length} onClick={() => attempt(() => { const lanes = [...model.lanes], index = lanes.indexOf(selectedLane); [lanes[index], lanes[index + direction]] = [lanes[index + direction], lanes[index]]; return { ...model, revision: model.revision + 1, lanes }; }, c.edit)}>{direction < 0 ? "↑" : "↓"}</button>)}
      {onRemoveLane && <button className={clipButton} onClick={() => onRemoveLane(selectedLane.id)}>{c.removeTrack}</button>}
      {(["start", "length", "offset"] as const).map(field => <label key={`${selectedClip.id}:${field}:${selectedClip[field]}`} className="flex flex-col gap-1">{field === "offset" ? c.offset : c[field]} · {c.beats}
        <input className={clipInput} type="number" step="0.25" min={field === "length" ? .25 : 0} defaultValue={selectedClip[field] / Q} onBlur={e => { const value = Number(e.target.value) * Q; if (value !== selectedClip[field]) attempt(() => updateClip(model, selectedLane.id, selectedClip.id, { [field]: value }, timings), c.edit); }} /></label>)}
      <span className="self-center">{c.content}: {contentLength(selectedLane, selectedClip.children, timings[selectedLane.id]) / Q} {c.beats}</span>
      <select className={clipInput} aria-label={c.loop} value={selectedClip.mode} onChange={e => attempt(() => updateClip(model, selectedLane.id, selectedClip.id, { mode: e.target.value as Clip["mode"] }, timings), c.edit)}><option value="once">{c.once}</option><option value="loop">{c.loop}</option></select>
      <button className={clipButton} onClick={() => attempt(() => fitClip(model, selectedLane.id, selectedClip.id, timings), c.fit)}>{c.fit}</button>
      <button className={clipButton} onClick={() => attempt(() => deleteClip(model, selectedLane.id, selectedClip.id, timings), c.remove)}>{c.remove}</button>
      {selectedLane.cycleTicks !== null && <span>{c.localLoop}: {selectedLane.cycleTicks / Q} {c.beats} <button className={clipButton} onClick={() => attempt(() => convertLaneCycle(model, selectedLane.id, timings), c.convertCycle)}>{c.convertCycle}</button></span>}
      <details className="w-full"><summary>{c.content}</summary><div className="flex flex-wrap gap-2">{selectedClip.children.map(item => <button key={item.id} className={clipButton} onClick={e => structure.select({ laneId: selectedLane.id, clipId: selectedClip.id, pass: 0, parent: [] }, item.id, e.shiftKey)}>{"definitionId" in item ? selectedLane.definitions.find(d => d.id === item.definitionId)?.name : c.rest}</button>)}</div></details>
    </div>}
    <SectionTools model={model} timings={timings} selectedLane={selectedLane?.id} language={language} onChange={onChange} />
    {!model.lanes.length && <p className="py-8 text-center text-sm text-slate-500">{c.empty}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{c.error}: {error}</p>}
    {transposing && model.lanes.some(l=>l.id===transposing.target.laneId&&l.clips.some(cl=>cl.id===transposing.target.clipId)) && <LaneTransposeDialog key={JSON.stringify(transposing.target)} {...transposing} language={language} stopAudition={stopAudition} onClose={()=>setTransposing(null)}/>}

  </section>;
}

function CompactContent({ lane, clip, sequencer, unit, from, to, pass, language, onTranspose }: { lane: ClipLane; clip: Clip; sequencer: SequencerState; unit: number; from: number; to: number; pass: number; language:GuiLanguage; onTranspose:(target:OccurrenceTarget,trigger:HTMLButtonElement)=>void }) {
  const timing = arrangementTimings(sequencer)[lane.id], defs = definitionMap(lane);
  const windowStart=(clip.offset-(clip.mode==="loop"?pass*contentLength(lane,clip.children,timing):0))*unit;
  let cursor = 0;
  const render = (items: ContentItem[], path: string[] = []): ReactNode[] => items.flatMap<ReactNode>(item => {
    if ("restTicks" in item) { cursor += item.restTicks; return []; }
    const def = defs.get(item.definitionId)!;
    if (def.kind !== "pattern") return render(def.children,[...path,item.id]);
    const duration = contentLength(lane, [item], timing), left = cursor * unit; cursor += duration;
    if (left + duration * unit < from || left > to) return [];
    const offset=addOffsets(transposePlans(lane,clip,[...path,item.id]).map(p=>offsetAt(p,(clip.repeatIndexBase??0)+pass)));
    const visibleLeft=Math.max(0,from-left,windowStart-left), visibleWidth=Math.max(0,Math.min(duration*unit,to-left,windowStart+clip.length*unit-left)-visibleLeft);
    return [<div key={`${item.id}:${left}`} className="absolute top-0 overflow-hidden" style={{ left, width: duration * unit }}><PatternPreview definition={def} offset={offset} timing={timing} controllerMode={sequencer.controllerSequencers.find(t => t.id === lane.id)?.controllerMode} />
      {['sequencer','score','arpeggiator'].includes(lane.source) && visibleWidth>0 && <div className="pointer-events-none absolute top-0 flex justify-end" style={{left:visibleLeft,width:visibleWidth}}><LaneTransposeBadge target={{laneId:lane.id,clipId:clip.id,path:[...path,item.id],pass}} name={def.name} index={logicalRepeatIndex(lane,clip,[...path,item.id],pass)} offset={offset} width={visibleWidth} language={language} onOpen={onTranspose}/></div>}
    </div>];
  });
  return <>{render(clip.children)}</>;
}
