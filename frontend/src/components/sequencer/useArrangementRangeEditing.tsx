import { useAppStore } from "../../store/useAppStore";
import { arrangerHistoryCopy } from "../../lib/arrangerHistoryCopy";
import type { ArrangerActionCode } from "../../store/arrangerHistory";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import type { GuiLanguage } from "../../types";
import { ArrangementRangeError, arrangementRangeSignature, copyArrangementRange, placeArrangementRange, resolveArrangementRange,
  type ArrangementRange, type ArrangementRangeClipboard, type ArrangementRangeMode, type ArrangementRangeUpdate, type RangeLane } from "../../lib/arrangementRange";
import { arrangementRangeCopy } from "../../lib/arrangementRangeCopy";
import { sequencerTransportSubunitsPerBeat } from "../../lib/sequencer";
import { arrangementSpans } from "../../lib/arrangementEditing";
import { ArrangerContextMenu, type ArrangerMenuTarget } from "./ArrangerContextMenu";
import { useClearArrangementSelection, usePerformanceEditorState, useSetArrangementPosition } from "./PerformanceEditorState";

type Gesture = { id: number; x: number; y: number; lastX: number; lastY: number; anchor: number; lane: number | null; moved: boolean; copy?: ArrangementRangeClipboard; source?: ArrangementRange };
type Preview = { range: ArrangementRange; affected: string[]; mode: ArrangementRangeMode; error: string };
const editable = "button,input,textarea,select,[contenteditable=true]";
const menuButton = "block w-full rounded px-2 py-1.5 text-left hover:bg-slate-700 focus:bg-slate-700 disabled:opacity-40";

export function useArrangementRangeEditing({ lanes, titles, language, pixelsPerSubunit, scroll, ruler, commit }: {
  lanes: RangeLane[]; titles: Record<string, string>; language: GuiLanguage; pixelsPerSubunit: number; scroll: number;
  ruler: RefObject<HTMLDivElement>; commit: (updates: ArrangementRangeUpdate[], action?: ArrangerActionCode) => void;
}) {
  const hc = arrangerHistoryCopy(language);
  const c = { ...arrangementRangeCopy(language), undo: hc.undo, redo: hc.redo };
  const beat = sequencerTransportSubunitsPerBeat();
  const signature = arrangementRangeSignature(lanes);
  const [range, setRange] = usePerformanceEditorState<ArrangementRange | null>("arranger", "editRange", null);
  const [cursor, setCursor] = usePerformanceEditorState("arranger", "editCursor", 0);
  const [clipboard, setClipboard] = usePerformanceEditorState<ArrangementRangeClipboard | null>("arranger", "rangeClipboard", null);
  const history = useAppStore(state => state.arrangerHistory);
  const previousSignature = useRef(signature);
  const restoreRevision = useAppStore(state => state.arrangerHistoryRestoreRevision);
  const [selectionPreview, setSelectionPreview] = useState<ArrangementRange | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [menu, setMenu] = useState<ArrangerMenuTarget | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const keyboardAnchor = useRef<{ time: number; lane: number; focusTime: number; focusLane: number } | null>(null);
  const clearItems = useClearArrangementSelection();
  const setLanePosition = useSetArrangementPosition();
  const currentRange = selectionPreview ?? range;
  const canUndo = history.cursor > 0, canRedo = history.cursor < history.entries.length;
  const message = (cause: unknown) => {
    const problem = cause instanceof ArrangementRangeError ? cause : new ArrangementRangeError("limit");
    return `${problem.laneId && titles[problem.laneId] ? `${titles[problem.laneId]}: ` : ""}${c[problem.code]}`;
  };
  useEffect(() => {
    if (previousSignature.current !== signature) setRange(null);
    previousSignature.current = signature;
  }, [signature, setRange]);
  const cancel = () => { gesture.current = null; setSelectionPreview(null); setPreview(null); };
  useEffect(() => { gesture.current = null; setSelectionPreview(null); setPreview(null); setMenu(null); }, [restoreRevision]);
  useEffect(() => {
    const blur = () => { gesture.current = null; setSelectionPreview(null); setPreview(null); };
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("blur", blur); gesture.current = null; };
  }, []);

  const rawPosition = (x: number) => Math.max(0, (x - (ruler.current?.getBoundingClientRect().left ?? 0) - (ruler.current?.clientLeft ?? 0) + scroll) / pixelsPerSubunit);
  const snapPosition = (raw: number) => {
    const grid = Math.round(raw / beat) * beat;
    const boundaries = lanes.flatMap(lane => [Math.round(raw / lane.beatSubunits) * lane.beatSubunits,
      ...arrangementSpans(lane.pattern, lane.padBeats).flatMap(span => [span.start * lane.beatSubunits, (span.start + span.duration) * lane.beatSubunits])]);
    const nearest = boundaries.reduce((best, value) => Math.abs(value - raw) < Math.abs(best - raw) ? value : best, grid);
    return Math.max(0, Math.abs(nearest - raw) * pixelsPerSubunit <= 6 ? nearest : grid);
  };
  const position = (x: number) => snapPosition(rawPosition(x));
  const laneAt = (y: number) => {
    const nodes = [...surface.current!.querySelectorAll<HTMLElement>("[data-arrangement-lane]")];
    let closest = 0, distance = Infinity;
    nodes.forEach((node, index) => {
      const bounds = node.getBoundingClientRect();
      const d = Math.max(bounds.top - y, y - bounds.bottom, 0);
      if (d < distance) { closest = index; distance = d; }
    });
    return closest;
  };
  const inRange = (laneId: string | undefined, time: number) => !!range && (!laneId || range.laneIds.includes(laneId)) && time >= range.startSubunit && time < range.endSubunit;
  const tryCopy = () => {
    try {
      if (!range) throw new ArrangementRangeError("empty");
      setClipboard(copyArrangementRange(lanes, range)); setNotice(c.copied); setError("");
    } catch (cause) { setError(message(cause)); }
  };
  const apply = (source: ArrangementRangeClipboard | null, at: number, mode: ArrangementRangeMode, duplicate = false) => {
    if (!source) { setError(c.noClipboard); return; }
    try {
      const after = placeArrangementRange(lanes, source, at, mode);
      const nextLanes = lanes.map(lane => ({ ...lane, pattern: { ...lane.pattern, rootSequence: after.find(u => u.id === lane.id)?.rootSequence ?? lane.pattern.rootSequence } }));
      const afterRange = { startSubunit: at, endSubunit: at + source.durationSubunits, laneIds: source.lanes.map(l => l.id) };
      const nextSignature = arrangementRangeSignature(nextLanes);
      if (nextSignature !== signature) {
        previousSignature.current = nextSignature;
        const action = mode === "overwrite" ? "overwrite" : mode === "insert-all" ? duplicate ? "duplicateAll" : "insertAll" : duplicate ? "duplicateSelected" : "insertSelected";
        commit(after, action);
      }
      clearItems(); setRange(afterRange); setCursor(at); setError(""); setNotice(""); keyboardAnchor.current = null;
    } catch (cause) { setError(message(cause)); }
  };
  const duplicate = (mode: ArrangementRangeMode) => {
    try {
      if (!range) throw new ArrangementRangeError("empty");
      apply(copyArrangementRange(lanes, range), range.endSubunit, mode, true);
    } catch (cause) { setError(message(cause)); }
  };
  const restore = (redo: boolean) => {
    const store = useAppStore.getState();
    if (redo) store.redoArranger(); else store.undoArranger();
    clearItems(); setError(""); setNotice(""); keyboardAnchor.current = null;
  };
  const updateGesture = (x: number, y: number, shift: boolean): Preview | ArrangementRange | null => {
    const g = gesture.current;
    if (!g) return null;
    g.lastX = x; g.lastY = y;
    g.moved ||= Math.abs(x - g.x) >= 4 || Math.abs(y - g.y) >= 4;
    if (!g.moved) return null;
    if (g.copy && g.source) {
      const at = snapPosition(g.source.startSubunit + (x - g.x) / pixelsPerSubunit);
      const mode: ArrangementRangeMode = shift ? "insert-all" : "overwrite";
      const destination = { startSubunit: at, endSubunit: at + g.copy.durationSubunits, laneIds: g.source.laneIds };
      let problem = "";
      let affected = mode === "insert-all" ? lanes.map(l => l.id) : destination.laneIds;
      try { affected = placeArrangementRange(lanes, g.copy, at, mode).map(u => u.id); }
      catch (cause) { problem = message(cause); }
      const next = { range: destination, mode, affected, error: problem };
      setPreview(next); return next;
    }
    const last = laneAt(y);
    const laneIds = g.lane === null ? lanes.map(l => l.id) : lanes.slice(Math.min(g.lane, last), Math.max(g.lane, last) + 1).map(l => l.id);
    const raw = rawPosition(x);
    const next = resolveArrangementRange(lanes, { laneIds,
      startSubunit: Math.round(Math.min(g.anchor, raw)),
      endSubunit: Math.round(Math.max(g.anchor, raw)) });
    setSelectionPreview(next); return next;
  };

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !lanes.length) return;
    suppressClick.current = false;
    const target = event.target as HTMLElement;
    if (target.closest(editable)) return;
    const timeline = target.closest<HTMLElement>("[data-arrangement-lane]");
    const isRuler = !!target.closest("[data-range-ruler]");
    if (!timeline && !isRuler) return;
    const occurrence = target.closest<HTMLElement>("[data-arrangement-occurrence]");
    const copy = event.altKey && occurrence && inRange(timeline?.dataset.arrangementLane, Number(occurrence.dataset.rangeStart));
    if (occurrence && !event.shiftKey && !copy) { setRange(null); keyboardAnchor.current = null; return; }
    event.preventDefault(); event.stopPropagation();
    surface.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    clearItems(); setError(""); setNotice(""); keyboardAnchor.current = null;
    try {
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
        anchor: Math.round(rawPosition(event.clientX)), lane: isRuler ? null : lanes.findIndex(l => l.id === timeline!.dataset.arrangementLane), moved: false,
        ...(copy && range ? { copy: copyArrangementRange(lanes, range), source: range } : {}) };
    } catch (cause) { setError(message(cause)); cancel(); }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    event.stopPropagation(); updateGesture(event.clientX, event.clientY, event.shiftKey);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    event.stopPropagation(); suppressClick.current = true;
    const next = updateGesture(event.clientX, event.clientY, event.shiftKey);
    if (g.moved && next) {
      if ("mode" in next) apply(g.copy!, next.range.startSubunit, next.mode);
      else { setRange(next); setCursor(next.startSubunit); }
    } else {
      const at = position(event.clientX);
      setRange(null); setCursor(at);
      if (g.lane !== null && lanes[g.lane]) setLanePosition(lanes[g.lane].id, Math.round(at / lanes[g.lane].beatSubunits));
    }
    cancel();
  };
  const openMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, time: number) => {
    event.preventDefault(); event.stopPropagation(); cancel();
    setCursor(time);
    const bounds = (event.target as HTMLElement).getBoundingClientRect();
    setMenu({ anchor: surface.current!, x: "clientX" in event ? event.clientX : bounds.left, y: "clientY" in event ? event.clientY : bounds.bottom });
  };
  const onContextMenuCapture = (event: MouseEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    const target = event.target as HTMLElement;
    const timeline = target.closest<HTMLElement>("[data-arrangement-lane]");
    const isRuler = !!target.closest("[data-range-ruler]");
    if ((!timeline && !isRuler) || target.closest(editable)) return;
    const time = position(event.clientX);
    const inside = inRange(timeline?.dataset.arrangementLane, rawPosition(event.clientX));
    if (!inside) { setRange(null); setCursor(time); }
    if (isRuler || inside || !target.closest("[data-arrangement-occurrence]")) openMenu(event, inside ? cursor : time);
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!surface.current?.contains(target) || target.closest(editable)) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (gesture.current) cancel(); else { setRange(null); keyboardAnchor.current = null; }
      setMenu(null); setError(""); return;
    }
    if (gesture.current) {
      if (event.key === "Shift") updateGesture(gesture.current.lastX, gesture.current.lastY, true);
      return;
    }
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && ["c", "v"].includes(key) || modifier && event.shiftKey && key === "d") {
      event.preventDefault(); event.stopPropagation();
      if (key === "c") tryCopy();
      if (key === "v") apply(clipboard, cursor, event.shiftKey ? "insert-all" : "overwrite");
      if (key === "d") duplicate("insert-all");
      return;
    }
    if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
      const occurrence = target.closest<HTMLElement>("[data-arrangement-occurrence]");
      if (range || !occurrence) openMenu(event, cursor);
      else setCursor(Number(occurrence.dataset.rangeStart));
      return;
    }
    if (["Enter", " "].includes(event.key) && target.closest("[data-arrangement-occurrence]")) setRange(null);
    if (lanes.length && event.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); clearItems();
      const focusLaneId = target.closest<HTMLElement>("[data-arrangement-lane]")?.dataset.arrangementLane;
      const lane = Math.max(0, lanes.findIndex(l => l.id === (range?.laneIds[0] ?? focusLaneId)));
      const anchor = keyboardAnchor.current ?? { time: range?.startSubunit ?? cursor, focusTime: range?.endSubunit ?? cursor, lane,
        focusLane: range ? Math.max(lane, lanes.findIndex(l => l.id === range.laneIds[range.laneIds.length - 1])) : lane };
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") anchor.focusTime = Math.max(0, anchor.focusTime + (event.key === "ArrowLeft" ? -beat : beat));
      else anchor.focusLane = Math.max(0, Math.min(lanes.length - 1, anchor.focusLane + (event.key === "ArrowUp" ? -1 : 1)));
      keyboardAnchor.current = anchor;
      setRange(resolveArrangementRange(lanes, { startSubunit: anchor.time, endSubunit: anchor.focusTime,
        laneIds: lanes.slice(Math.min(anchor.lane, anchor.focusLane), Math.max(anchor.lane, anchor.focusLane) + 1).map(l => l.id) }));
    }
    if (range && ["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
  };

  const availability = (source: ArrangementRangeClipboard | null, at: number, mode: ArrangementRangeMode) => {
    if (!source) return c.noClipboard;
    try { placeArrangementRange(lanes, source, at, mode); return ""; }
    catch (cause) { return message(cause); }
  };
  const menuActions = (close: () => void) => {
    let selectedCopy: ArrangementRangeClipboard | null = null;
    try { if (range) selectedCopy = copyArrangementRange(lanes, range); } catch { /* Invalidated ranges cannot be copied. */ }
    const action = (label: string, shortcut: string, run: () => void, reason = "") => <button key={label} type="button" role="menuitem" className={menuButton} disabled={!!reason} title={reason || shortcut} onClick={() => { run(); close(); }}>
      {label}{shortcut && <span className="mt-0.5 block text-[10px] text-slate-400">{shortcut}</span>}
    </button>;
    const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
    return <>
      {action(c.copy, `${mod}C`, tryCopy, selectedCopy ? "" : c.empty)}
      {action(c.paste, `${mod}V`, () => apply(clipboard, cursor, "overwrite"), availability(clipboard, cursor, "overwrite"))}
      {action(c.insertAll, `${mod}Shift+V`, () => apply(clipboard, cursor, "insert-all"), availability(clipboard, cursor, "insert-all"))}
      {action(c.insertSelected, "", () => apply(clipboard, cursor, "insert-selected"), availability(clipboard, cursor, "insert-selected"))}
      {action(c.duplicateAll, `${mod}Shift+D`, () => duplicate("insert-all"), selectedCopy ? availability(selectedCopy, range!.endSubunit, "insert-all") : c.empty)}
      {action(c.duplicateSelected, "", () => duplicate("insert-selected"), selectedCopy ? availability(selectedCopy, range!.endSubunit, "insert-selected") : c.empty)}
      <hr className="my-1 border-slate-700" />
      {action(c.undo, `${mod}Z`, () => restore(false), canUndo ? "" : c.undo)}
      {action(c.redo, `${mod}Shift+Z`, () => restore(true), canRedo ? "" : c.redo)}
      <p className="px-2 pt-1 text-slate-400">{c.dragHint}</p>
    </>;
  };
  const format = (ticks: number) => Number((ticks / beat).toFixed(4));
  const durationLabel = (ticks: number) => `${format(ticks)} ${ticks === beat ? c.beat : c.beats}`;
  const laneCount = (count: number) => `${count} ${count === 1 ? c.lane : c.lanes}`;
  const overlay = (laneId?: string) => <>
    {currentRange && (!laneId || currentRange.laneIds.includes(laneId)) && <span data-range-selection className="pointer-events-none absolute inset-y-0 z-10 border-x-2 border-cyan-300 bg-cyan-400/15" style={{ left: currentRange.startSubunit * pixelsPerSubunit, width: (currentRange.endSubunit - currentRange.startSubunit) * pixelsPerSubunit }} />}
    {preview && (!laneId || preview.affected.includes(laneId)) && <span data-range-preview className={`pointer-events-none absolute inset-y-0 z-20 border-2 ${preview.error ? "border-red-400 bg-red-500/20" : "border-cyan-200 bg-cyan-400/25"}`} style={{ left: preview.range.startSubunit * pixelsPerSubunit, width: (preview.range.endSubunit - preview.range.startSubunit) * pixelsPerSubunit }} />}
    <span data-edit-cursor className="pointer-events-none absolute inset-y-0 z-10 w-px bg-cyan-200" style={{ left: cursor * pixelsPerSubunit }} />
  </>;
  return {
    c, surface, range: currentRange, overlay, menuActions,
    extent: Math.max(cursor, currentRange?.endSubunit ?? 0, preview?.range.endSubunit ?? 0),
    bindings: { onPointerDownCapture, onPointerMove, onPointerUp, onPointerCancel: cancel, onLostPointerCapture: cancel,
      onContextMenuCapture, onKeyDownCapture,
      onDragStartCapture: () => { setError(""); setNotice(""); setRange(null); cancel(); },
      onKeyUpCapture: (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === "Shift" && gesture.current) updateGesture(gesture.current.lastX, gesture.current.lastY, false); },
      onClickCapture: (event: MouseEvent<HTMLDivElement>) => { if (suppressClick.current && surface.current?.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }
    },
    status: <div className="ml-[222px] mr-[10px] min-h-5 text-xs text-slate-400" aria-live="polite">
      {error || preview?.error ? <span role="alert" className="text-red-300">{error || preview?.error}</span>
        : preview ? `${preview.mode === "overwrite" ? c.overwrite : `${c.insert} +${durationLabel(preview.range.endSubunit - preview.range.startSubunit)}`} · ${preview.mode === "insert-all" ? c.all : laneCount(preview.affected.length)} · ${c.cursor} ${format(preview.range.startSubunit)}`
        : currentRange ? `${durationLabel(currentRange.endSubunit - currentRange.startSubunit)} · ${laneCount(currentRange.laneIds.length)}${notice ? ` · ${notice}` : ""}`
        : notice || `${c.cursor} ${format(cursor)} · ${c.hint}`}
    </div>,
    menu: menu && <ArrangerContextMenu target={menu} title={c.actions} onClose={() => setMenu(null)}>{menuActions(() => setMenu(null))}</ArrangerContextMenu>
  };
}
