import type { ArrangerActionCode } from "../store/arrangerHistory";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { sequencerTransportSubunitsPerBeat } from "../lib/sequencer";
import type { Lane, MultitrackArrangerProps } from "./MultitrackArranger";
import type { PadLoopPatternItem, PadLoopPatternState } from "../types";
import { arrangementCopy } from "../lib/arrangementCopy";
import { ARRANGEMENT_ITEM_MIME, beginArrangementDrag, currentArrangementDrag, endArrangementDrag } from "../lib/arrangementDrag";
import { arrangementSpans, compileDefinition, contiguousArrangementSelection, createDefinition, definitionItem, definitionUses, groupArrangementSelection, removeArrangementItems, resolveArrangementDrop, restTokens, validateArrangementEdit, type DefinitionRef } from "../lib/arrangementEditing";
import { PAD_LOOP_PAUSE_BEAT_OPTIONS, canCreatePadLoopGroupFromSelection, itemDisplayLabel, ungroupPadLoopItemsInContainer } from "../lib/padLoopPattern";
import { definitionColorKey, definitionColorStyle, setDefinitionColor } from "../lib/definitionColors";
import { PATTERN_ITEM_COLORS } from "../lib/patternItemPresentation";
import { useAppStore } from "../store/useAppStore";
import { useClearArrangementSelection, usePerformanceEditorState } from "./sequencer/PerformanceEditorState";
import { LaneOutputButtons } from "./sequencer/LaneOutputButtons";
import { ArrangerSpeaker } from "./sequencer/ArrangerSpeaker";
import { ArrangerContextMenu, type ArrangerMenuTarget } from "./sequencer/ArrangerContextMenu";
import { deleteWorkspaceDefinition, type PatternWorkspaceDraft } from "../lib/patternWorkspace";
import { patternWorkspaceCopy } from "./sequencer/patternWorkspaceCopy";

const button = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-accent disabled:opacity-40";
const menuButton = "block w-full rounded px-2 py-1.5 text-left hover:bg-slate-700 focus:bg-slate-700 disabled:opacity-40";
const swatches = ["#065f46", "#991b1b", "#6d28d9", "#0369a1", "#b45309", "#be185d", "#d9e4ed", "#27272a"];
type Menu = ArrangerMenuTarget & { item?: PadLoopPatternItem; indexes: number[]; palette: boolean };
type Drag = { x: number; start: number; indexes: number[]; moved: boolean; restDuration?: number };
type Preview = { position: number; duration: number; valid: boolean; insert: boolean };

export function ArrangerLane({ lane, props, selected, select, commit, zoom, width, scroll, playhead, rangeOverlay, rangeSelection, rangeActions }: {
  lane: Lane; props: MultitrackArrangerProps; selected: boolean; select: () => void; commit: (pattern: PadLoopPatternState, action: ArrangerActionCode, copyPad?: { from: number; to: number }) => void;
  zoom: number; width: number; scroll: number; playhead: number;
  rangeOverlay?: ReactNode; rangeSelection?: { start: number; end: number }; rangeActions?: (close: () => void) => ReactNode;
}) {
  const c = arrangementCopy(props.guiLanguage);
  const owner = `device:${lane.id}` as const;
  const [workspaceDrafts, setWorkspaceDrafts] = usePerformanceEditorState<Record<string, PatternWorkspaceDraft>>(owner, "workspaceDrafts", {});
  const [, setWorkspaceDefinition] = usePerformanceEditorState<DefinitionRef | null>(owner, "workspaceDefinition", null);
  const deletionUses = (ref: DefinitionRef) => definitionUses(lane.pattern, ref);
  const [selection, setSelection] = usePerformanceEditorState<number[]>(owner, "arrangerSelection", []);
  const [position, setPosition] = usePerformanceEditorState(owner, "arrangerPosition", 0);
  const [expanded, setExpanded] = usePerformanceEditorState(owner, "arrangerExpanded", false);
  const [focusedDefinition, setFocusedDefinition] = usePerformanceEditorState<PadLoopPatternItem | null>(owner, "arrangerFocusDefinition", null);
  const [origin, setOrigin] = usePerformanceEditorState<DefinitionRef | null>(owner, "arrangerUngroupOrigin", null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [panel, setPanel] = useState<"actions" | "color" | "group" | "super" | "rest">("actions");
  const [groupTarget, setGroupTarget] = useState("");
  const [restDuration, setRestDuration] = useState("1");
  const [color, setColor] = useState(swatches[0]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const restoreRevision = useAppStore(state => state.arrangerHistoryRestoreRevision);
  const drag = useRef<Drag | null>(null);
  const draggedClick = useRef(false);
  const palette = useRef<HTMLDivElement>(null);
  const clearSelection = useClearArrangementSelection();
  const spans = arrangementSpans(lane.pattern, lane.padBeats);
  const indexes = selection.filter(i => i < lane.pattern.rootSequence.length);
  const refs: PadLoopPatternItem[] = [...lane.availablePads.map((padIndex): PadLoopPatternItem => ({ type: "pad", padIndex })),
    ...lane.pattern.groups.map(g => definitionItem({ kind: "group", id: g.id })),
    ...lane.pattern.superGroups.map(g => definitionItem({ kind: "super", id: g.id })),
    ...PAD_LOOP_PAUSE_BEAT_OPTIONS.map(lengthBeats => ({ type: "pause" as const, lengthBeats }))];
  const label = (item: PadLoopPatternItem) => item.type === "pad" ? String(item.padIndex + 1) : item.type === "pause" ? `${c.rest} ${item.lengthBeats}` : itemDisplayLabel(item);
  const duration = (item: PadLoopPatternItem) => compileDefinition(lane.pattern, item).reduce((n, token) => n + (token < 0 ? -token : lane.padBeats[token]), 0);
  const openLane = () => { select(); setExpanded(true); };
  const cancelDrag = () => { drag.current = null; setPreview(null); endArrangementDrag(); };
  const closeMenu = () => setMenu(null);
  const attempt = (action: ArrangerActionCode, edit: () => PadLoopPatternState, nextSelection: number[] = [], copyPad?: { from: number; to: number }) => {
    try { commit(edit(), action, copyPad); setError(""); setSelection(nextSelection); closeMenu(); return true; }
    catch (cause) { setError(cause instanceof Error && cause.message === "Occupied destination." ? c.collision : c.blocked); return false; }
  };
  useEffect(() => () => { drag.current = null; endArrangementDrag(); }, []);
  useEffect(() => { drag.current = null; setPreview(null); setMenu(null); endArrangementDrag(); }, [restoreRevision]);
  useEffect(() => {
    if (!expanded || !focusedDefinition) return;
    const key = definitionColorKey(focusedDefinition);
    palette.current?.querySelectorAll<HTMLElement>("[data-definition]").forEach(node => { if (node.dataset.definition === key) node.focus(); });
  }, [expanded, focusedDefinition]);
  useEffect(() => { setSelection(previous => previous.every(i => i < lane.pattern.rootSequence.length) ? previous : previous.filter(i => i < lane.pattern.rootSequence.length)); }, [lane.pattern.rootSequence.length, setSelection]);
  const editPad = (pad: number) => {
    props.onEditPad?.(lane.kind, lane.id, pad);
    useAppStore.getState().selectSequencerEditingPad(lane.id, pad);
    requestAnimationFrame(() => document.getElementById(`sequencer-${lane.id}`)?.scrollIntoView({ block: "center" }));
  };
  const selectSpan = (values: number[], start: number, event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">) => {
    openLane(); setPosition(start);
    setSelection(event.metaKey || event.ctrlKey || event.shiftKey ? values.some(i => indexes.includes(i))
      ? indexes.filter(i => !values.includes(i)) : [...indexes, ...values] : values);
  };
  const showMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, item: PadLoopPatternItem | undefined, values: number[], isPalette = false) => {
    event.preventDefault(); event.stopPropagation(); cancelDrag(); openLane(); setPanel("actions");
    const chosen = !isPalette && values.some(i => indexes.includes(i)) ? indexes : values;
    if (!isPalette && values.length) setSelection(chosen);
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenu({ item, indexes: chosen, palette: isPalette, anchor: event.currentTarget,
      x: "clientX" in event ? event.clientX : bounds.left, y: "clientY" in event ? event.clientY : bounds.bottom });
  };
  const resolve = (raw: number, items: PadLoopPatternItem[], moving?: number[]) => resolveArrangementDrop(lane.pattern, items, raw, lane.padBeats, zoom, moving);
  const previewDrop = (raw: number, items: PadLoopPatternItem[], moving?: number[]) => {
    try { const result = resolve(raw, items, moving); setPreview({ ...result, valid: true }); }
    catch { setPreview({ position: Math.max(0, Math.round(raw)), duration: items.reduce((n, item) => n + duration(item), 0), valid: false, insert: false }); }
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    current.moved ||= Math.abs(event.clientX - current.x) >= 4;
    if (!current.moved) return;
    if (current.restDuration !== undefined) {
      setPreview({ position: current.start, duration: Math.max(1, current.restDuration + Math.round((event.clientX - current.x) / zoom)), valid: true, insert: false });
    } else previewDrop(current.start + (event.clientX - current.x) / zoom, current.indexes.map(i => lane.pattern.rootSequence[i]), current.indexes);
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    cancelDrag();
    if (!current || !current.moved && Math.abs(event.clientX - current.x) < 4) return;
    draggedClick.current = true;
    if (current.restDuration !== undefined) {
      attempt("rest", () => ({ ...lane.pattern, rootSequence: [...lane.pattern.rootSequence.slice(0, current.indexes[0]),
        ...restTokens(Math.max(1, current.restDuration! + Math.round((event.clientX - current.x) / zoom))), ...lane.pattern.rootSequence.slice(current.indexes[current.indexes.length - 1] + 1)] }));
    } else attempt("move", () => resolve(current.start + (event.clientX - current.x) / zoom, current.indexes.map(i => lane.pattern.rootSequence[i]), current.indexes).pattern);
  };
  const vary = () => {
    if (!menu?.item || menu.item.type === "pause") return;
    const source = menu.item;
    attempt("variation", () => {
      let next = lane.pattern;
      let target: PadLoopPatternItem;
      if (source.type === "pad") {
        if (lane.unusedPad < 0) throw new Error(c.noSlot);
        target = { type: "pad", padIndex: lane.unusedPad };
      } else {
        const definition = source.type === "group" ? lane.pattern.groups.find(g => g.id === source.groupId) : lane.pattern.superGroups.find(g => g.id === source.superGroupId);
        const result = createDefinition(lane.pattern, source.type, definition?.sequence);
        next = result.pattern; target = definitionItem(result.ref);
      }
      next = { ...next, rootSequence: next.rootSequence.map((item, i) => i === menu.indexes[0] ? target : item) };
      next = setDefinitionColor(next, target, lane.pattern.definitionColors?.[definitionColorKey(source)]);
      validateArrangementEdit(lane.pattern, next);
      return next;
    }, [], source.type === "pad" ? { from: source.padIndex, to: lane.unusedPad } : undefined);
  };
  const canGroup = (kind: "group" | "super") => !!menu && contiguousArrangementSelection(menu.indexes)
    && canCreatePadLoopGroupFromSelection(lane.pattern, { kind: "root" }, menu.indexes, kind);
  const musicalMenu = menu?.item && menu.item.type !== "pause";
  const menuRef: DefinitionRef | null = menu?.item?.type === "group" ? { kind: "group", id: menu.item.groupId }
    : menu?.item?.type === "super" ? { kind: "super", id: menu.item.superGroupId } : null;

  return <section aria-label={lane.title} className={`rounded border px-2 py-1 ${selected ? "border-cyan-700" : "border-slate-700"}`}>
    <div className="grid grid-cols-[204px_minmax(0,1fr)] gap-2">
      <div className="min-w-0">
        <div className="flex h-6 items-center gap-1">
          <button className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-100" title={lane.title} aria-expanded={expanded}
            onClick={() => { setExpanded(!expanded); cancelDrag(); closeMenu(); }}><span aria-hidden>{expanded ? "▾" : "▸"}</span> {lane.title}</button>
          <LaneOutputButtons id={lane.id} language={props.guiLanguage} />
        </div>
        <div className="truncate text-[10px] text-slate-400" title={lane.subtitle}>{lane.subtitle}</div>
      </div>
      <div className="min-w-0 overflow-hidden" onWheel={event => { const element = event.currentTarget.closest('#multitrack-arranger')?.querySelector('.h-4.overflow-x-auto'); if (element) element.scrollLeft += event.deltaX || event.deltaY; }}>
        <div role="list" data-arrangement-lane={lane.id} tabIndex={0} aria-label={`${lane.title} ${c.arrangement}`} className="relative h-12 touch-none rounded border border-slate-700 bg-slate-950"
          style={{ width, transform: `translateX(${-scroll}px)`, backgroundImage: "linear-gradient(to right, #1e293b 1px, transparent 1px)", backgroundSize: `${zoom}px 100%` }}
          onClick={event => { if (event.target === event.currentTarget) { if (draggedClick.current) { draggedClick.current = false; return; } clearSelection(); setSelection([]); setPosition(Math.max(0, Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom))); } }}
          onContextMenu={event => { if (event.target === event.currentTarget) showMenu(event, undefined, indexes); }}
          onKeyDown={event => {
            if ((event.target as HTMLElement).closest("button,input,select")) return;
            if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); attempt(event.shiftKey ? "closeGap" : "remove", () => removeArrangementItems(lane.pattern, indexes, duration, event.shiftKey)); }
            if (event.key === "Escape") { cancelDrag(); closeMenu(); }
            if (event.target === event.currentTarget && (event.key === "ContextMenu" || event.shiftKey && event.key === "F10")) showMenu(event, undefined, indexes);
          }}
          onDragOver={event => { const payload = currentArrangementDrag(); if (payload?.trackId !== lane.id) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; previewDrop((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom, [payload.item]); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setPreview(null); }}
          onDrop={event => { event.preventDefault(); setPreview(null); try { const payload = JSON.parse(event.dataTransfer.getData(ARRANGEMENT_ITEM_MIME)); if (payload.trackId !== lane.id) throw new Error(c.blocked); attempt("place", () => resolve((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom, [payload.item]).pattern); } catch { setError(c.blocked); } endArrangementDrag(); }}
          onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (drag.current) cancelDrag(); }}>
          {spans.map(span => <div key={span.indexes[0]} role="listitem" data-arrangement-occurrence data-range-start={span.start * lane.beatScale * sequencerTransportSubunitsPerBeat()} tabIndex={0} aria-label={`${label(span.item)} · ${Number((span.start * lane.beatScale).toFixed(4))}`} aria-selected={span.indexes.some(i => indexes.includes(i)) || !!rangeSelection && span.start < rangeSelection.end && span.start + span.duration > rangeSelection.start}
            className={`absolute top-1 flex h-9 cursor-grab select-none items-center overflow-hidden rounded border px-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${span.item.type === "pause" ? "border-slate-600 bg-slate-800/60 text-slate-300" : PATTERN_ITEM_COLORS[span.item.type]} ${span.indexes.some(i => indexes.includes(i)) ? "ring-2 ring-cyan-400" : ""}`}
            style={{ left: span.start * zoom, width: Math.max(10, span.duration * zoom), ...definitionColorStyle(lane.pattern, span.item) }}
            onClick={event => { event.stopPropagation(); if (draggedClick.current) { draggedClick.current = false; return; } selectSpan(span.indexes, span.start, event); }}
            onDoubleClick={() => { if (span.item.type === "pad") editPad(span.item.padIndex); }}
            onPointerDown={event => { if (event.button !== 0) return; draggedClick.current = false; const values = indexes.includes(span.indexes[0]) ? indexes : span.indexes;
              drag.current = { x: event.clientX, start: spans.find(s => s.indexes.includes(Math.min(...values)))?.start ?? span.start, indexes: values, moved: false };
              event.currentTarget.setPointerCapture?.(event.pointerId); }}
            onContextMenu={event => showMenu(event, span.item, span.indexes)}
            onKeyDown={event => { if (event.target !== event.currentTarget) return;
              if (["Enter", " "].includes(event.key)) { event.preventDefault(); selectSpan(span.indexes, span.start, event); }
              if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") showMenu(event, span.item, span.indexes);
              if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const node = event.key === "ArrowLeft" ? event.currentTarget.previousElementSibling : event.currentTarget.nextElementSibling; if (node instanceof HTMLElement && node.getAttribute("role") === "listitem") node.focus(); }
            }}>
            <span className="pointer-events-none min-w-0 truncate">{span.item.type === "pause" ? `${c.rest} · ${span.duration}` : label(span.item)}</span>
            {span.item.type !== "pause" && <ArrangerSpeaker key={String(expanded)} id={lane.id} item={span.item} label={label(span.item)} language={props.guiLanguage} />}
            {span.item.type === "pause" && <button className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-slate-500/40" aria-label={c.duration}
              onClick={event => event.stopPropagation()} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); draggedClick.current = false; drag.current = { x: event.clientX, start: span.start, indexes: span.indexes, restDuration: span.duration, moved: false }; event.currentTarget.setPointerCapture?.(event.pointerId); }} />}
          </div>)}
          {preview && <span className={`pointer-events-none absolute inset-y-0 border-2 ${preview.valid ? "border-cyan-300 bg-cyan-500/20" : "border-red-400 bg-red-500/20"}`} style={{ left: preview.position * zoom, width: preview.duration * zoom }}>
            {Number((preview.position * lane.beatScale).toFixed(4))} · {Number((preview.duration * lane.beatScale).toFixed(4))}{preview.insert && <span className="sr-only"> {c.insert}</span>}</span>}
          {rangeOverlay}
          <span className="pointer-events-none absolute inset-y-0 w-px bg-amber-200" style={{ left: playhead }} />
        </div>
      </div>
    </div>
    {expanded && <div ref={palette} className="mt-2 flex flex-wrap items-center gap-1" aria-label={c.library}>
      <label className="mr-1 whitespace-nowrap text-xs text-slate-300">{c.position} <input type="number" className={`${button} w-20`} min={0} value={Number((position * lane.beatScale).toFixed(6))} step={lane.beatScale} onChange={event => setPosition(Math.max(0, Math.round(Number(event.target.value) / lane.beatScale)))} /></label>
      {refs.map(item => {
        const playable = compileDefinition(lane.pattern, item).length > 0;
        const name = item.type === "group" ? `${c.group} ${item.groupId}` : item.type === "super" ? `${c.super} ${item.superGroupId}` : label(item);
        return <div key={item.type === "pause" ? `pause:${item.lengthBeats}` : definitionColorKey(item)} className={`flex items-center rounded border px-1 text-xs ${PATTERN_ITEM_COLORS[item.type]} ${!playable ? "opacity-50" : ""}`} style={definitionColorStyle(lane.pattern, item)}
          draggable={playable} onDragEnd={endArrangementDrag} onDragStart={event => { beginArrangementDrag(lane.id, item); event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(ARRANGEMENT_ITEM_MIME, JSON.stringify({ trackId: lane.id, item })); }}
          onContextMenu={event => showMenu(event, item, [], true)}>
          <button type="button" className="px-1 py-1 focus-visible:outline focus-visible:outline-cyan-300" data-definition={definitionColorKey(item)} title={c.dragHint}
            onClick={() => setFocusedDefinition(item)} onDoubleClick={() => { if (item.type === "pad") editPad(item.padIndex); }}
            onKeyDown={event => { if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") showMenu(event, item, [], true); }}>{name}</button>
          {item.type !== "pause" && <ArrangerSpeaker id={lane.id} item={item} label={name} language={props.guiLanguage} disabled={!playable} />}
        </div>;
      })}
    </div>}
    {menu && <ArrangerContextMenu target={menu} title={c.actions} dialog={panel !== "actions"} onClose={closeMenu}>
      {panel === "actions" && <>
        {!menu.palette && rangeActions && <>{rangeActions(closeMenu)}<hr className="my-1 border-slate-700" /></>}
        {menu.item?.type === "pad" && <button role="menuitem" className={menuButton} onClick={() => { editPad(menu.item!.type === "pad" ? menu.item!.padIndex : 0); closeMenu(); }}>{c.editPattern}</button>}
        {!menu.palette && <>
          {musicalMenu && <button role="menuitem" className={menuButton} disabled={menu.indexes.length !== 1 || menu.item?.type === "pad" && lane.unusedPad < 0} onClick={vary}>{c.variation}</button>}
          {(["group", "super"] as const).map(kind => <button key={kind} role="menuitem" className={menuButton} disabled={!canGroup(kind)} title={c.groupHint} onClick={() => { setPanel(kind); setGroupTarget(""); }}>{kind === "group" ? c.group : c.super}…</button>)}
          {!canGroup("group") && !canGroup("super") && <p className="px-2 py-1 text-slate-400">{c.groupHint}</p>}
          <button role="menuitem" className={menuButton} disabled={!menu.indexes.some(i => ["group", "super"].includes(lane.pattern.rootSequence[i]?.type))} onClick={() => {
            const source = menu.indexes.length === 1 ? lane.pattern.rootSequence[menu.indexes[0]] : undefined;
            const ref = source?.type === "group" ? { kind: "group" as const, id: source.groupId } : source?.type === "super" ? { kind: "super" as const, id: source.superGroupId } : null;
            if (attempt("ungroup", () => ungroupPadLoopItemsInContainer(lane.pattern, { kind: "root" }, menu.indexes))) setOrigin(ref);
          }}>{props.copy.contextMenuUngroup}</button>
          <button role="menuitem" className={menuButton} disabled={!menu.indexes.some(i => lane.pattern.rootSequence[i]?.type !== "pause")} onClick={() => attempt("remove", () => removeArrangementItems(lane.pattern, menu.indexes, duration))}>{c.remove}</button>
          <button role="menuitem" className={menuButton} disabled={!menu.indexes.length} onClick={() => attempt("closeGap", () => removeArrangementItems(lane.pattern, menu.indexes, duration, true))}>{c.closeGap}</button>
          {menu.item?.type === "pause" && <button role="menuitem" className={menuButton} disabled={spans.filter(span => span.indexes.some(i => menu.indexes.includes(i))).length !== 1} onClick={() => { const span = spans.find(s => s.indexes.includes(menu.indexes[0])); setRestDuration(String(span?.duration ?? 1)); setPanel("rest"); }}>{c.duration}…</button>}
        </>}
        {musicalMenu && <><button role="menuitem" className={menuButton} onClick={() => { setColor(lane.pattern.definitionColors?.[definitionColorKey(menu.item!)] ?? swatches[0]); setPanel("color"); }}>{c.setColor}</button>
          <button role="menuitem" className={menuButton} disabled={!lane.pattern.definitionColors?.[definitionColorKey(menu.item!)]} onClick={() => attempt("color", () => setDefinitionColor(lane.pattern, menu.item!), indexes)}>{c.resetColor}</button></>}
        {menu.palette && menuRef && <>
          <button role="menuitem" className={menuButton} disabled={deletionUses(menuRef).length > 0} onClick={() => {
            let nextDrafts = workspaceDrafts;
            if (attempt("deleteDefinition", () => { const result = deleteWorkspaceDefinition(lane.pattern, workspaceDrafts, menuRef); nextDrafts = result.drafts; return result.pattern; })) {
              setWorkspaceDrafts(nextDrafts);
              setWorkspaceDefinition(current => current?.kind === menuRef.kind && current.id === menuRef.id ? null : current);
            }
          }}>{c.removeDefinition}</button>
          {!deletionUses(menuRef).length && <p className="px-2 py-1 text-slate-400">{patternWorkspaceCopy(props.guiLanguage).deleteHint}</p>}
          {deletionUses(menuRef).length > 0 && <p className="px-2 py-1 text-slate-400">{c.used}: {deletionUses(menuRef).join(", ")}</p>}
        </>}
      </>}
      {panel === "rest" && <div className="space-y-2">
        <label>{c.duration} <input className={`${button} w-20`} type="number" min={1} step={1} value={restDuration} onChange={event => setRestDuration(event.target.value)} /></label>
        <div><button className={button} onClick={() => attempt("rest", () => {
          const span = spans.find(s => s.indexes.includes(menu.indexes[0]));
          if (!span || Number(restDuration) < 1) throw new Error(c.blocked);
          return { ...lane.pattern, rootSequence: [...lane.pattern.rootSequence.slice(0, span.indexes[0]), ...restTokens(Number(restDuration)), ...lane.pattern.rootSequence.slice(span.indexes[span.indexes.length - 1] + 1)] };
        })}>{c.apply}</button> <button className={button} onClick={closeMenu}>{c.cancelEdit}</button></div>
      </div>}
      {panel === "color" && <div className="space-y-2">
        <p>{c.setColor} {menu.item && label(menu.item)}</p>
        <div className="flex flex-wrap gap-2">{swatches.map(value => <button key={value} className={`h-6 w-6 rounded border ${color === value ? "ring-2 ring-cyan-300" : ""}`} aria-label={value} style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}</div>
        <label className="flex items-center gap-2">{c.customColor}<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
        <button className={button} onClick={() => attempt("color", () => setDefinitionColor(lane.pattern, menu.item!, color), indexes)}>{c.apply}</button> <button className={button} onClick={closeMenu}>{c.cancelEdit}</button>
      </div>}
      {(panel === "group" || panel === "super") && <div className="space-y-2">
        <label className="block">{panel === "group" ? c.group : c.super}<select className={`${button} mt-1 w-full`} value={groupTarget} onChange={event => setGroupTarget(event.target.value)}>
          <option value="">{c.newDefinition}</option><optgroup label={c.updateDefinition}>{[...(panel === "group" ? lane.pattern.groups : lane.pattern.superGroups)].sort((a, b) => Number(b.id === origin?.id && origin.kind === panel) - Number(a.id === origin?.id && origin.kind === panel)).map(g => <option key={g.id} value={g.id}>{g.id}</option>)}</optgroup>
        </select></label>
        {groupTarget && <><p>{c.used}: {definitionUses(lane.pattern, { kind: panel, id: groupTarget }).join(", ") || "—"}</p><p className="text-amber-200">{c.shared}</p></>}
        <button className={button} onClick={() => attempt(panel, () => groupArrangementSelection(lane.pattern, menu.indexes, panel, groupTarget || undefined).pattern, [Math.min(...menu.indexes)])}>{c.apply}</button> <button className={button} onClick={closeMenu}>{c.cancelEdit}</button>
      </div>}
    </ArrangerContextMenu>}
    {error && <p className="mt-1 text-xs text-red-300" role="alert">{error}</p>}
  </section>;
}
