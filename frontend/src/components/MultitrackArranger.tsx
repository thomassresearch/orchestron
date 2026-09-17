import { LaneOutputButtons } from "./sequencer/LaneOutputButtons";
import { PerformanceAuditionControls } from "./sequencer/PerformanceAudition";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EditorScope, EditorDetails, useClearArrangementSelection, usePerformanceEditorState } from "./sequencer/PerformanceEditorState";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { HelpIconButton } from "./HelpIconButton";
import { PadLoopPatternEditor, ARRANGEMENT_ITEM_MIME, beginArrangementDrag, currentArrangementDrag, endArrangementDrag } from "./sequencer/PadLoopPatternEditor";
import { SEQUENCER_UI_COPY } from "./sequencer/sequencerUiCopy";
import { arrangementCopy } from "../lib/arrangementCopy";
import { PATTERN_ITEM_COLORS, patternItemButtonClass } from "../lib/patternItemPresentation";
import { arrangementSpans, firstUnusedPad, compileDefinition, createDefinition, definitionItem, moveArrangementItems, placeArrangementItems, removeArrangementItems, restTokens, validateArrangementEdit, type DefinitionRef } from "../lib/arrangementEditing";
import { canCreatePadLoopGroupFromSelection, copyPadLoopItemsFromContainer, groupPadLoopItemsInContainer, itemDisplayLabel, preparePadLoopClipboardInsertion, ungroupPadLoopItemsInContainer, type PadLoopPatternClipboardState } from "../lib/padLoopPattern";
import { sequencerTransportStepsPerBeat } from "../lib/sequencer";
import { useAppStore } from "../store/useAppStore";
import type { ArrangerLoopSelection, GuiLanguage, HelpDocId, PadLoopPatternItem, PadLoopPatternState, PatchListItem, SequencerInstrumentBinding, SequencerState } from "../types";

const DEFAULT_STEP_PIXEL_WIDTH = 9;
const MAX_STEP_PIXEL_WIDTH = 24;
const button = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-accent disabled:opacity-40";
type ArrangerTrackKind = "sequencer" | "drummer" | "controller" | "arpeggiator";
type Lane = { id: string; kind: ArrangerTrackKind; title: string; subtitle: string; pattern: PadLoopPatternState; padBeats: number[]; source: boolean; repeat: boolean; activePad: number; enabled: boolean; unusedPad: number; beatScale: number };
type MultitrackArrangerProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  guiLanguage: GuiLanguage;
  copy: {
    title: string;
    deviceSummary: string;
    zoomFit: string;
    zoomOut: string;
    zoomIn: string;
    instrumentColumn: string;
    timelineColumn: string;
    transportRewind: string;
    transportStop: string;
    transportPlay: string;
    transportFastForward: string;
    selectionRuler: string;
    selectionHint: string;
    clearSelection: string;
    dragToken: string;
    melodicSequencerWithIndex: (index: number) => string;
    drummerSequencerWithIndex: (index: number) => string;
    controllerSequencerWithIndex: (index: number) => string;
    contextMenuAddPad: string;
    contextMenuAddGroup: string;
    contextMenuAddSuperGroup: string;
    contextMenuCopy: string;
    contextMenuPaste: string;
    contextMenuGroup: string;
    contextMenuSuperGroup: string;
    contextMenuUngroup: string;
    contextMenuRemove: string;
    contextMenuNoGroups: string;
    contextMenuNoSuperGroups: string;
    contextMenuPasteDisabled: string;
    contextMenuInsertAtEnd: string;
  };
  sequencer: SequencerState;
  patches: PatchListItem[];
  instrumentBindings: SequencerInstrumentBinding[];
  onTransportPlay: () => void;
  onTransportStop: () => void;
  onTransportStopDoubleClick: () => void;
  onTransportRewind: () => void;
  onTransportFastForward: () => void;
  onArrangerLoopSelectionChange: (selection: ArrangerLoopSelection | null, positionStep?: number) => void;
  onSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onDrummerSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onControllerSequencerPadLoopPatternChange: (controllerSequencerId: string, pattern: PadLoopPatternState) => void;
  onArpeggiatorPadLoopPatternChange?: (id: string, pattern: PadLoopPatternState) => void;
  onPlaybackChange?: (kind: ArrangerTrackKind, id: string, source: boolean, repeat: boolean) => void;
  onEditPad?: (kind: ArrangerTrackKind, id: string, pad: number) => void;
  onPadCopy?: (kind: ArrangerTrackKind, id: string, source: number, target: number) => void;
  onHelpRequest?: (helpDocId: HelpDocId) => void;
};
function CassetteIcon({ kind }: { kind: "rewind" | "stop" | "play" | "fastForward" }) {
  if (kind === "stop") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
        <rect x="5" y="5" width="10" height="10" rx="1.2" />
      </svg>
    );
  }
  if (kind === "play") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
        <path d="M6 4.5 15 10 6 15.5Z" />
      </svg>
    );
  }
  if (kind === "rewind") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
        <path d="M11.2 4.5 4 10l7.2 5.5Z" />
        <path d="M16 4.5 8.8 10l7.2 5.5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <path d="M4 4.5 11.2 10 4 15.5Z" />
      <path d="M8.8 4.5 16 10l-7.2 5.5Z" />
    </svg>
  );
}

function MultitrackArrangerBody(props: MultitrackArrangerProps) {
  const { sequencer, copy } = props;
  const c = arrangementCopy(props.guiLanguage);
  const quantum = sequencerTransportStepsPerBeat(sequencer.timing);
  const [zoom] = usePerformanceEditorState("arranger", "stepPixelWidth", DEFAULT_STEP_PIXEL_WIDTH);
  const [scroll, setScroll] = usePerformanceEditorState("arranger", "timelineScrollLeft", 0);
  const [viewportWidth, setViewportWidth] = usePerformanceEditorState("arranger", "timelineViewportWidth", 0);
  const [, setMetrics] = usePerformanceEditorState("arranger", "metrics", { minStepPixelWidth: DEFAULT_STEP_PIXEL_WIDTH, fitStepPixelWidth: DEFAULT_STEP_PIXEL_WIDTH });
  const [selectedLane, selectLane] = usePerformanceEditorState<string | null>("arranger", "selectedLane", null);
  const [clipboard, setClipboard] = usePerformanceEditorState<PadLoopPatternClipboardState | null>("arranger", "clipboard", null);
  const viewport = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const scrollbar = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; start: number; moved: boolean } | null>(null);
  const [rangePreview, setRangePreview] = useState<ArrangerLoopSelection | null>(null);
  const channelLabel = (channel: number) => {
    const names = props.instrumentBindings.filter(binding => binding.midiChannel === channel)
      .map(binding => props.patches.find(patch => patch.id === binding.patchId)?.name).filter(Boolean);
    return `CH ${channel}${names.length ? ` · ${names.join(", ")}` : ""}`;
  };
  const lanes: Lane[] = [
    ...sequencer.tracks.map((t, i): Lane => ({ id: t.id, kind: "sequencer", title: t.name || copy.melodicSequencerWithIndex(i + 1), subtitle: channelLabel(t.midiChannel), pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: "timing" in t ? t.timing.beatRateDenominator / t.timing.beatRateNumerator : 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => !p.steps.some(s => s.note !== null || s.hold))) })),
    ...sequencer.drummerTracks.map((t, i): Lane => ({ id: t.id, kind: "drummer", title: t.name || copy.drummerSequencerWithIndex(i + 1), subtitle: channelLabel(t.midiChannel), pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: "timing" in t ? t.timing.beatRateDenominator / t.timing.beatRateNumerator : 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => !p.rows.some(r => r.steps.some(s => s.active)))) })),
    ...sequencer.controllerSequencers.map((t, i): Lane => ({ id: t.id, kind: "controller", title: t.name || copy.controllerSequencerWithIndex(i + 1), subtitle: `CC ${t.controllerNumber}`, pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: "timing" in t ? t.timing.beatRateDenominator / t.timing.beatRateNumerator : 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => p.keypoints.every(k => k.value === 0))) })),
    ...sequencer.arpeggiators.filter(t => t.playbackMode === "arranger").map((t): Lane => ({ id: t.id, kind: "arpeggiator", title: t.name, subtitle: channelLabel(t.targetChannel), pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => p.steps.every(s => s.kind === "rest"))) }))
  ];
  const totalSteps = Math.max(quantum, sequencer.stepCount, ...lanes.map(lane => arrangementSpans(lane.pattern, lane.padBeats).reduce((sum, s) => sum + s.duration * lane.beatScale * quantum, 0)));
  const width = Math.max(totalSteps * zoom, viewportWidth);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setViewportWidth(element.clientWidth); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [setViewportWidth]);
  useEffect(() => {
    const fit = viewportWidth > 0 ? Math.max(1, viewportWidth - 2) / totalSteps : DEFAULT_STEP_PIXEL_WIDTH;
    setMetrics(old => old.fitStepPixelWidth === fit ? old : { minStepPixelWidth: Math.min(DEFAULT_STEP_PIXEL_WIDTH, fit), fitStepPixelWidth: fit });
  }, [viewportWidth, totalSteps, setMetrics]);
  useEffect(() => { if (scrollbar.current && scrollbar.current.scrollLeft !== scroll) scrollbar.current.scrollLeft = scroll; }, [scroll]);
  const rawPosition = (x: number) => Math.max(0, (x - (ruler.current?.getBoundingClientRect().left ?? 0) + scroll) / zoom);
  const snapped = (x: number) => Math.min(totalSteps, Math.floor(rawPosition(x) / quantum) * quantum);
  const rangeAt = (x: number): ArrangerLoopSelection => {
    const start = gesture.current!.start;
    const raw = rawPosition(x);
    return { startStep: Math.min(start, Math.floor(raw / quantum) * quantum), endStep: Math.min(totalSteps, Math.max(start + quantum, Math.ceil(raw / quantum) * quantum)) };
  };
  const cancel = () => { gesture.current = null; setRangePreview(null); };
  const end = (e: ReactPointerEvent) => {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    if (g.moved || Math.abs(e.clientX - g.x) >= 4) props.onArrangerLoopSelectionChange(rangeAt(e.clientX));
    else props.onArrangerLoopSelectionChange(null, snapped(e.clientX));
    cancel();
  };
  const selection = rangePreview ?? sequencer.arrangerLoopSelection;
  const playhead = (sequencer.cycle * sequencer.stepCount + sequencer.playhead) * zoom;
  const commit = (lane: Lane, pattern: PadLoopPatternState) => {
    validateArrangementEdit(lane.pattern, pattern);
    if (lane.kind === "sequencer") props.onSequencerTrackPadLoopPatternChange(lane.id, pattern);
    else if (lane.kind === "drummer") props.onDrummerSequencerTrackPadLoopPatternChange(lane.id, pattern);
    else if (lane.kind === "controller") props.onControllerSequencerPadLoopPatternChange(lane.id, pattern);
    else props.onArpeggiatorPadLoopPatternChange?.(lane.id, pattern);
  };
  return <>
    <div className="mb-2 grid grid-cols-[220px_minmax(0,1fr)] gap-2 text-xs text-slate-400"><div>{copy.instrumentColumn}</div><div>{copy.timelineColumn}</div></div>
    <div ref={viewport} className="ml-[228px] overflow-hidden" aria-hidden><div className="relative h-6" style={{ width, transform: `translateX(${-scroll}px)` }}>
      {Array.from({ length: Math.ceil(totalSteps / quantum) }, (_, beat) => <span key={beat} className="absolute text-xs text-slate-400" style={{ left: beat * quantum * zoom }}>{beat % sequencer.timing.meterNumerator === 0 ? `${Math.floor(beat / sequencer.timing.meterNumerator) + 1}.1` : zoom * quantum >= 40 ? `·${beat % sequencer.timing.meterNumerator + 1}` : ""}</span>)}
    </div></div>
    <div className="space-y-1">{lanes.map(lane => <ArrangerLane key={lane.id} lane={lane} props={props} selected={selectedLane === lane.id} select={() => selectLane(lane.id)} commit={pattern => commit(lane, pattern)}
      clipboard={clipboard} setClipboard={setClipboard} zoom={zoom * quantum * lane.beatScale} width={width} scroll={scroll} playhead={playhead} />)}</div>
    <div className="mt-2 grid grid-cols-[220px_minmax(0,1fr)] gap-2">
      <span className="text-xs text-slate-400">{c.loop}</span>
      <div ref={ruler} aria-label={copy.selectionHint} className="relative h-7 touch-none select-none overflow-hidden rounded border border-slate-700"
        onPointerDown={e => { if (e.button !== 0 && e.pointerType === "mouse") return; e.preventDefault(); gesture.current = { id: e.pointerId, x: e.clientX, start: Math.min(totalSteps - quantum, snapped(e.clientX)), moved: false }; e.currentTarget.setPointerCapture?.(e.pointerId); }}
        onPointerMove={e => { const g = gesture.current; if (!g || g.id !== e.pointerId) return; g.moved ||= Math.abs(e.clientX - g.x) >= 4; if (g.moved) setRangePreview(rangeAt(e.clientX)); }}
        onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel}>
        <div className="relative h-full" style={{ width, transform: `translateX(${-scroll}px)`, backgroundSize: `${quantum * zoom}px 100%`, backgroundImage: "linear-gradient(to right, #334155 1px, transparent 1px)" }}>
          {selection && <span className="pointer-events-none absolute inset-y-0 border-x border-amber-300 bg-amber-400/20" style={{ left: selection.startStep * zoom, width: (selection.endStep - selection.startStep) * zoom }} />}
          <span className="absolute inset-y-0 w-px bg-amber-200" style={{ left: playhead }} />
        </div>
      </div>
    </div>
    <div ref={scrollbar} className="ml-[228px] mt-2 h-4 overflow-x-auto overflow-y-hidden" onScroll={e => { if (e.currentTarget.clientWidth > 0) setScroll(e.currentTarget.scrollLeft); }}><div style={{ width, height: 1 }} /></div>
  </>;
}

function ArrangerLane({ lane, props, selected, select, commit, clipboard, setClipboard, zoom, width, scroll, playhead }: {
  lane: Lane; props: MultitrackArrangerProps; selected: boolean; select: () => void; commit: (pattern: PadLoopPatternState) => void;
  clipboard: PadLoopPatternClipboardState | null; setClipboard: (value: PadLoopPatternClipboardState | null) => void;
  zoom: number; width: number; scroll: number; playhead: number;
}) {
  const c = arrangementCopy(props.guiLanguage);
  const owner = `device:${lane.id}` as const;
  const [selection, setSelection] = usePerformanceEditorState<number[]>(owner, "arrangerSelection", []);
  const [position, setPosition] = usePerformanceEditorState(owner, "arrangerPosition", 0);
  const [item, setItem] = usePerformanceEditorState<PadLoopPatternItem>(owner, "arrangerItem", { type: "pad", padIndex: 0 });
  const [, setDefinition] = usePerformanceEditorState<DefinitionRef | null>(owner, "definition", null);
  const [, openDefinition] = usePerformanceEditorState(owner, "definitionOpen", false);
  const [error, setError] = useState("");
  const [dragPreview, setDragPreview] = useState<{ start: number; duration: number; valid: boolean } | null>(null);
  const [expanded, setExpanded] = usePerformanceEditorState(owner, "arrangerExpanded", false);
  const clearSelection = useClearArrangementSelection();
  const openLane = () => { select(); setExpanded(true); };
  const toggleLane = () => { setExpanded(!expanded); drag.current = null; setDragPreview(null); endArrangementDrag(); };
  const drag = useRef<{ x: number; start: number; indexes: number[]; restDuration?: number } | null>(null);
  useEffect(() => () => { drag.current = null; endArrangementDrag(); }, []);
  const spans = arrangementSpans(lane.pattern, lane.padBeats);
  const indexes = selection.filter(i => i < lane.pattern.rootSequence.length);
  useEffect(() => { setSelection(previous => previous.every(i => i < lane.pattern.rootSequence.length) ? previous : previous.filter(i => i < lane.pattern.rootSequence.length)); }, [lane.pattern.rootSequence.length, setSelection]);
  const attempt = (edit: () => PadLoopPatternState) => { try { commit(edit()); setError(""); setSelection([]); } catch (error) { setError(error instanceof Error && error.message === "Occupied destination." ? c.collision : c.blocked); } };
  const label = (value: PadLoopPatternItem) => value.type === "pad" ? String(value.padIndex + 1) : value.type === "pause" ? `${c.rest} ${value.lengthBeats}` : itemDisplayLabel(value);
  const refs: PadLoopPatternItem[] = [...Array.from({ length: 8 }, (_, padIndex): PadLoopPatternItem => ({ type: "pad", padIndex })), ...lane.pattern.groups.map(g => definitionItem({ kind: "group", id: g.id })), ...lane.pattern.superGroups.map(g => definitionItem({ kind: "super", id: g.id })), ...([1, 2, 4, 8, 16] as const).map(lengthBeats => ({ type: "pause" as const, lengthBeats }))];
  const duration = (value: PadLoopPatternItem) => compileDefinition(lane.pattern, value).reduce((n, token) => n + (token < 0 ? -token : lane.padBeats[token]), 0);
  const insert = (values: PadLoopPatternItem[], at = position, shift = false, pattern = lane.pattern) => attempt(() => placeArrangementItems(pattern, values, at, lane.padBeats, shift));
  const remove = (close = false) => attempt(() => removeArrangementItems(lane.pattern, indexes, duration, close));
  const editPad = (pad: number) => { props.onEditPad?.(lane.kind, lane.id, pad); useAppStore.getState().selectSequencerEditingPad(lane.id, pad); requestAnimationFrame(() => document.getElementById(`sequencer-${lane.id}`)?.scrollIntoView({ block: "center" })); };
  const vary = () => {
    const source = lane.pattern.rootSequence[indexes[0]];
    if (!source) return;
    attempt(() => {
      const next = structuredClone(lane.pattern);
      if (source.type === "pause") return next;
      if (source.type === "pad") {
        if (lane.unusedPad < 0 || !props.onPadCopy) throw new Error(c.noSlot);
        next.rootSequence[indexes[0]] = { type: "pad", padIndex: lane.unusedPad };
        validateArrangementEdit(lane.pattern, next);
        props.onPadCopy(lane.kind, lane.id, source.padIndex, lane.unusedPad);
        return next;
      }
      const kind = source.type;
      const definition = kind === "group" ? lane.pattern.groups.find(g => g.id === source.groupId) : lane.pattern.superGroups.find(g => g.id === source.superGroupId);
      const result = createDefinition(lane.pattern, kind, definition?.sequence);
      result.pattern.rootSequence[indexes[0]] = definitionItem(result.ref);
      return result.pattern;
    });
  };
  const edit = () => {
    const source = lane.pattern.rootSequence[indexes[0]];
    if (source?.type === "pad") editPad(source.padIndex);
    if (source?.type === "group" || source?.type === "super") { setDefinition(source.type === "group" ? { kind: "group", id: source.groupId } : { kind: "super", id: source.superGroupId }); openDefinition(true); }
  };
  return <section aria-label={lane.title} className={`rounded border px-2 py-1 ${selected ? "border-cyan-700" : "border-slate-700"}`}>
    <div className="grid grid-cols-[204px_minmax(0,1fr)] gap-2">
      <div className="min-w-0">
        <div className="flex h-6 items-center gap-1">
          <button className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-100" title={lane.title} aria-expanded={expanded} onClick={toggleLane}><span aria-hidden>{expanded ? "▾" : "▸"}</span> {lane.title}</button>
          <LaneOutputButtons id={lane.id} language={props.guiLanguage} />
        </div>
        <div className="flex min-w-0 items-start gap-1">
          <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400" title={lane.subtitle}>{lane.subtitle}</span>
          <EditorDetails owner={owner} field="playbackSettings" summary={c.settings} className="max-w-full text-[10px] text-slate-400" summaryClassName="cursor-pointer">
            {() => <div className="space-y-1 py-1">
              <label className="block">{c.source}<select className={`${button} w-full`} value={lane.source ? "arrangement" : "manual"} onChange={e => props.onPlaybackChange?.(lane.kind, lane.id, e.target.value === "arrangement", lane.repeat)}>
                <option value="manual">{c.manual}</option><option value="arrangement" disabled={!lane.pattern.rootSequence.length}>{c.arrangement}</option></select></label>
              {lane.source && <label className="block">{c.atEnd}<select className={`${button} w-full`} value={String(lane.repeat)} onChange={e => props.onPlaybackChange?.(lane.kind, lane.id, true, e.target.value === "true")}><option value="false">{c.once}</option><option value="true">{c.repeat}</option></select></label>}
            </div>}
          </EditorDetails>
        </div>
      </div>
      <div className="min-w-0 overflow-hidden" onWheel={e => { const element = e.currentTarget.closest('#multitrack-arranger')?.querySelector('.h-4.overflow-x-auto'); if (element) element.scrollLeft += e.deltaX || e.deltaY; }}>
        <div role="list" tabIndex={0} aria-label={`${lane.title} ${c.arrangement}`} className="relative h-12 touch-none rounded border border-slate-700 bg-slate-950" style={{ width, transform: `translateX(${-scroll}px)`, backgroundImage: "linear-gradient(to right, #1e293b 1px, transparent 1px)", backgroundSize: `${zoom}px 100%` }}
          onClick={e => { if (e.target === e.currentTarget) { clearSelection(); setSelection([]); setPosition(Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom))); } }}
          onContextMenu={e => { e.preventDefault(); openLane(); setPosition(Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom))); }}
          onKeyDown={e => { if (["INPUT", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
            if (["Delete", "Backspace"].includes(e.key)) { e.preventDefault(); remove(e.shiftKey); }
            if (/^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey) insert([{ type: "pad", padIndex: Number(e.key) - 1 }]);
            if ((e.ctrlKey || e.metaKey) && e.key === "c") { e.preventDefault(); setClipboard(copyPadLoopItemsFromContainer(lane.pattern, { kind: "root" }, indexes)); }
            if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard) { e.preventDefault(); const prepared = preparePadLoopClipboardInsertion(lane.pattern, clipboard); insert(prepared.items, position, false, prepared.pattern); }
          }}
          onDragOver={e => { e.preventDefault(); const at = Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom)); const dragged = currentArrangementDrag(); const candidate = dragged?.item ?? item; let valid = dragged?.trackId === lane.id; try { placeArrangementItems(lane.pattern, [candidate], at, lane.padBeats, candidate.type === "pause"); } catch { valid = false; } setDragPreview({ start: at, duration: duration(candidate), valid }); }}
          onDragLeave={() => setDragPreview(null)}
          onDrop={e => { e.preventDefault(); setDragPreview(null); try { const payload = JSON.parse(e.dataTransfer.getData(ARRANGEMENT_ITEM_MIME)); if (payload.trackId === lane.id) insert([payload.item], Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom)), payload.item.type === "pause"); } catch { setError(c.blocked); } }}
          onPointerMove={e => { const d = drag.current; if (!d) return; if (d.restDuration !== undefined) { setDragPreview({ start: d.start, duration: Math.max(1, d.restDuration + Math.round((e.clientX - d.x) / zoom)), valid: true }); return; } const at = Math.max(0, d.start + Math.round((e.clientX - d.x) / zoom)); let valid = true; try { moveArrangementItems(lane.pattern, d.indexes, at, lane.padBeats); } catch { valid = false; } setDragPreview({ start: at, duration: d.indexes.reduce((n, i) => n + duration(lane.pattern.rootSequence[i]), 0), valid }); }}
          onPointerUp={e => { const d = drag.current; drag.current = null; setDragPreview(null); if (d?.restDuration !== undefined) { attempt(() => ({ ...lane.pattern, rootSequence: [...lane.pattern.rootSequence.slice(0, d.indexes[0]), ...restTokens(Math.max(1, d.restDuration! + Math.round((e.clientX - d.x) / zoom))), ...lane.pattern.rootSequence.slice(d.indexes[d.indexes.length - 1] + 1)] })); return; } if (d && Math.abs(e.clientX - d.x) >= 4) attempt(() => moveArrangementItems(lane.pattern, d.indexes, Math.max(0, d.start + Math.round((e.clientX - d.x) / zoom)), lane.padBeats)); }}
          onPointerCancel={() => { drag.current = null; setDragPreview(null); }}>
          {spans.map(span => <div key={span.indexes[0]} className={`absolute top-1 flex h-9 items-center overflow-hidden rounded border px-1 text-xs ${span.item.type === "pause" ? "border-slate-600 bg-slate-800/60 text-slate-300" : PATTERN_ITEM_COLORS[span.item.type]} ${span.indexes.some(i => indexes.includes(i)) ? "ring-2 ring-cyan-400" : ""}`} style={{ left: span.start * zoom, width: Math.max(10, span.duration * zoom) }}>
            {span.item.type !== "pause" && <button className="mr-1" aria-label={props.copy.dragToken} onPointerDown={e => { e.preventDefault(); const use = indexes.includes(span.indexes[0]) ? indexes : span.indexes; drag.current = { x: e.clientX, start: spans.find(s => s.indexes.includes(use[0]))?.start ?? span.start, indexes: use }; e.currentTarget.parentElement?.parentElement?.setPointerCapture?.(e.pointerId); }}>⠿</button>}
            <button className="min-w-0 truncate text-left" onClick={e => { e.stopPropagation(); openLane(); setPosition(span.start); setSelection(e.ctrlKey || e.metaKey || e.shiftKey ? span.indexes.some(i => indexes.includes(i)) ? indexes.filter(i => !span.indexes.includes(i)) : [...indexes, ...span.indexes] : span.indexes); }} onDoubleClick={() => { setSelection(span.indexes); if (span.item.type === "pad") editPad(span.item.padIndex); else if (span.item.type !== "pause") { setDefinition(span.item.type === "group" ? { kind: "group", id: span.item.groupId } : { kind: "super", id: span.item.superGroupId }); openDefinition(true); } }}>{span.item.type === "pause" ? `${c.rest} · ${span.duration}` : label(span.item)}</button>
            {span.item.type === "pause" && <button className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-slate-500/40" aria-label={c.duration} onPointerDown={e => { e.preventDefault(); drag.current = { x: e.clientX, start: span.start, indexes: span.indexes, restDuration: span.duration }; e.currentTarget.parentElement?.parentElement?.setPointerCapture?.(e.pointerId); }} />}
          </div>)}
          {dragPreview && <span className={`pointer-events-none absolute inset-y-0 border-2 ${dragPreview.valid ? "border-cyan-300 bg-cyan-500/20" : "border-red-400 bg-red-500/20"}`} style={{ left: dragPreview.start * zoom, width: dragPreview.duration * zoom }}>{Number((dragPreview.start * lane.beatScale).toFixed(4))} · {Number((dragPreview.duration * lane.beatScale).toFixed(4))}</span>}
          <span className="pointer-events-none absolute inset-y-0 w-px bg-amber-200" style={{ left: playhead }} />
        </div>
      </div>
    </div>
    {expanded && <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-300">{c.position} <input type="number" className={`${button} w-20`} min={0} value={Number((position * lane.beatScale).toFixed(6))} step={lane.beatScale} onChange={e => setPosition(Math.max(0, Math.round(Number(e.target.value) / lane.beatScale)))} /></label>
        <select className={patternItemButtonClass(item.type)} aria-label={c.add} value={JSON.stringify(item)} onChange={e => setItem(JSON.parse(e.target.value))}>{refs.map((ref, i) => <option key={i} className={PATTERN_ITEM_COLORS[ref.type]} value={JSON.stringify(ref)} disabled={!compileDefinition(lane.pattern, ref).length}>{label(ref)}</option>)}</select>
        <button className={patternItemButtonClass(item.type)} draggable onDragEnd={endArrangementDrag} onDragStart={e => { beginArrangementDrag(lane.id, item); e.dataTransfer.setData(ARRANGEMENT_ITEM_MIME, JSON.stringify({ trackId: lane.id, item })); }} onClick={() => insert([item], position, item.type === "pause")}>{c.add} {label(item)}</button>
        <button className={button} onClick={() => insert([item], position, true)}>{c.insert}</button>
        <button className={button} disabled={lane.unusedPad < 0} title={lane.unusedPad < 0 ? c.noSlot : c.newEmpty} onClick={() => editPad(lane.unusedPad)}>{c.newPattern}</button>
      </div>
      <div className="flex flex-wrap gap-1" aria-label={c.library}>{refs.map((ref, index) => <button key={index} className={patternItemButtonClass(ref.type)}
        disabled={!compileDefinition(lane.pattern, ref).length} aria-pressed={JSON.stringify(ref) === JSON.stringify(item)}
        onClick={() => setItem(ref)} draggable onDragEnd={endArrangementDrag} onDragStart={event => {
          setItem(ref); beginArrangementDrag(lane.id, ref); event.dataTransfer.setData(ARRANGEMENT_ITEM_MIME, JSON.stringify({ trackId: lane.id, item: ref }));
        }}>{ref.type === "group" ? `${c.group} ${ref.groupId}` : ref.type === "super" ? `${c.super} ${ref.superGroupId}` : label(ref)}</button>)}</div>
      <PerformanceAuditionControls id={lane.id} language={props.guiLanguage} item={indexes.length === 1 && lane.pattern.rootSequence[indexes[0]].type !== "pause" ? lane.pattern.rootSequence[indexes[0]] : undefined} />
      <div className="flex flex-wrap gap-1">
        <button className={button} disabled={!indexes.some(i => lane.pattern.rootSequence[i].type !== "pause")} onClick={() => remove()}>{c.remove}</button>
        <button className={button} disabled={!indexes.length} onClick={() => remove(true)}>{c.closeGap}</button>
        <button className={button} disabled={!indexes.length} onClick={() => setClipboard(copyPadLoopItemsFromContainer(lane.pattern, { kind: "root" }, indexes))}>{props.copy.contextMenuCopy}</button>
        <button className={button} disabled={!clipboard} onClick={() => { if (clipboard) { const prepared = preparePadLoopClipboardInsertion(lane.pattern, clipboard); insert(prepared.items, position, false, prepared.pattern); } }}>{props.copy.contextMenuPaste}</button>
        <button className={button} disabled={!indexes.length} onClick={() => insert(indexes.map(i => lane.pattern.rootSequence[i]), spans.reduce((n, s) => n + s.duration, 0))}>{c.duplicate}</button>
        <button className={button} disabled={indexes.length !== 1 || lane.pattern.rootSequence[indexes[0]]?.type === "pause"} onClick={vary}>{c.variation}</button>
        <button className={button} disabled={indexes.length !== 1 || lane.pattern.rootSequence[indexes[0]]?.type === "pause"} onClick={edit}>{c.edit}</button>
        {(["group", "super"] as const).map(kind => <button key={kind} className={button} disabled={!canCreatePadLoopGroupFromSelection(lane.pattern, { kind: "root" }, indexes, kind) || [...indexes].sort((a,b) => a-b).some((value,i,all) => i > 0 && value !== all[i-1]+1)} onClick={() => attempt(() => groupPadLoopItemsInContainer(lane.pattern, { kind: "root" }, indexes, kind))}>{kind === "group" ? c.newGroup : c.newSuper}</button>)}
        <button className={button} disabled={!indexes.some(i => ["group", "super"].includes(lane.pattern.rootSequence[i].type))} onClick={() => attempt(() => ungroupPadLoopItemsInContainer(lane.pattern, { kind: "root" }, indexes))}>{props.copy.contextMenuUngroup}</button>
      </div>
      {indexes.length > 0 && spans.find(span => span.item.type === "pause" && span.indexes[0] === indexes[0]) && (() => {
        const span = spans.find(s => s.indexes[0] === indexes[0])!;
        return <label className="text-xs text-slate-300">{c.duration} <input className={`${button} w-20`} type="number" min={1} step={1} value={span.duration} onChange={e => attempt(() => ({ ...lane.pattern, rootSequence: [...lane.pattern.rootSequence.slice(0, span.indexes[0]), ...restTokens(Number(e.target.value)), ...lane.pattern.rootSequence.slice(span.indexes[span.indexes.length - 1] + 1)] }))} /></label>;
      })()}
    </div>}
    {expanded && <div className="mt-2"><PadLoopPatternEditor ui={SEQUENCER_UI_COPY[props.guiLanguage]} guiLanguage={props.guiLanguage} hostId={lane.id} track={{ id: lane.id, enabled: lane.enabled, padLoopEnabled: lane.source, padLoopRepeat: lane.repeat, padLoopPattern: lane.pattern, padLoopPosition: null }}
      stepsPerBeat={1} padStepCounts={lane.padBeats} defaultPadStepCount={4} isPlaying={props.sequencer.isPlaying} linkedPadLoopStepPosition={null} onLinkedPadLoopStepPositionChange={() => {}} onPadLoopEnabledChange={() => {}} onPadLoopRepeatChange={() => {}} onPadLoopPatternChange={commit} hideSource /></div>}
    {error && <p className="mt-1 text-xs text-red-300" role="alert">{error}</p>}
  </section>;
}
export function MultitrackArranger(props: MultitrackArrangerProps) {
  return <div id="multitrack-arranger"><EditorScope><MultitrackArrangerShell {...props} /></EditorScope></div>;
}
function MultitrackArrangerShell(props: MultitrackArrangerProps) {
  const { collapsed, onCollapsedChange, guiLanguage, copy, onHelpRequest, onTransportRewind, onTransportStop, onTransportStopDoubleClick, onTransportPlay, onTransportFastForward } = props;
  const [stepPixelWidth, setStepPixelWidth] = usePerformanceEditorState<number>("arranger", "stepPixelWidth", DEFAULT_STEP_PIXEL_WIDTH);
  const [timelineViewportWidth] = usePerformanceEditorState<number>("arranger", "timelineViewportWidth", 0);
  const [, setTimelineScrollLeft] = usePerformanceEditorState<number>("arranger", "timelineScrollLeft", 0);
  const [{ minStepPixelWidth, fitStepPixelWidth }] = usePerformanceEditorState("arranger", "metrics", { minStepPixelWidth: DEFAULT_STEP_PIXEL_WIDTH, fitStepPixelWidth: DEFAULT_STEP_PIXEL_WIDTH });
  const canZoomOut = stepPixelWidth > minStepPixelWidth + 1e-6;
  const canZoomIn = stepPixelWidth < MAX_STEP_PIXEL_WIDTH - 1e-6;
  const zoomPercent = Math.round((stepPixelWidth / DEFAULT_STEP_PIXEL_WIDTH) * 100);
  const transportButtonClass = "inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-400/50 bg-amber-400/10 text-amber-100 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-45";
  if (props.sequencer.tracks.length + props.sequencer.drummerTracks.length + props.sequencer.controllerSequencers.length + props.sequencer.arpeggiators.length === 0) return null;
  return (<CollapsiblePanel unmountOnCollapse
    title={copy.title}
    collapsed={collapsed}
    onCollapsedChange={onCollapsedChange}
    className="mt-4 overscroll-x-none rounded-xl border border-amber-700/45 bg-slate-950/85 p-3"
    titleClassName="text-amber-200"
    help={onHelpRequest ? <HelpIconButton guiLanguage={guiLanguage} onClick={() => onHelpRequest("sequencer_multitrack_arranger")} /> : null}
    actions={<>
      <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-300">
        {copy.deviceSummary}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onTransportRewind}
          className={transportButtonClass}
          title={copy.transportRewind}
          aria-label={copy.transportRewind}
        >
          <CassetteIcon kind="rewind" />
        </button>
        <button
          type="button"
          onClick={onTransportStop}
          onDoubleClick={onTransportStopDoubleClick}
          className={transportButtonClass}
          title={copy.transportStop}
          aria-label={copy.transportStop}
        >
          <CassetteIcon kind="stop" />
        </button>
        <button
          type="button"
          onClick={onTransportPlay}
          className={transportButtonClass}
          title={copy.transportPlay}
          aria-label={copy.transportPlay}
        >
          <CassetteIcon kind="play" />
        </button>
        <button
          type="button"
          onClick={onTransportFastForward}
          className={transportButtonClass}
          title={copy.transportFastForward}
          aria-label={copy.transportFastForward}
        >
          <CassetteIcon kind="fastForward" />
        </button>
        <button
          type="button"
          onClick={() => {
            setStepPixelWidth(Math.min(MAX_STEP_PIXEL_WIDTH, fitStepPixelWidth));
            setTimelineScrollLeft(0);
          }}
          disabled={timelineViewportWidth <= 0}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copy.zoomFit}
        </button>
        <button
          type="button"
          onClick={() =>
            setStepPixelWidth((value) => Math.max(minStepPixelWidth, value * 0.85))
          }
          disabled={!canZoomOut}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copy.zoomOut}
        </button>
        <button
          type="button"
          onClick={() => setStepPixelWidth((value) => Math.min(MAX_STEP_PIXEL_WIDTH, value * 1.15))}
          disabled={!canZoomIn}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copy.zoomIn}
        </button>
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-300">
          {zoomPercent}%
        </span>
      </div>
    </>}
  >
    <MultitrackArrangerBody {...props} />
  </CollapsiblePanel>);
}
