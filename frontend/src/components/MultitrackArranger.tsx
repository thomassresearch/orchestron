import { useAppStore } from "../store/useAppStore";
import { sequencerTransportSubunitsPerStep } from "../lib/sequencer";
import { ArrangerLane } from "./ArrangerLane";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EditorScope, usePerformanceEditorState } from "./sequencer/PerformanceEditorState";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { HelpIconButton } from "./HelpIconButton";
import { arrangementCopy } from "../lib/arrangementCopy";
import { arrangementSpans, firstUnusedPad, validateArrangementEdit } from "../lib/arrangementEditing";
import { sequencerTransportStepsPerBeat } from "../lib/sequencer";
import type { ArrangerLoopSelection, GuiLanguage, HelpDocId, PadLoopPatternState, PatchListItem, SequencerInstrumentBinding, SequencerState } from "../types";

const DEFAULT_STEP_PIXEL_WIDTH = 9;
const MAX_STEP_PIXEL_WIDTH = 24;
type ArrangerTrackKind = "sequencer" | "drummer" | "controller" | "arpeggiator";
export type Lane = { id: string; kind: ArrangerTrackKind; title: string; subtitle: string; pattern: PadLoopPatternState; padBeats: number[]; availablePads: number[]; source: boolean; repeat: boolean; activePad: number; enabled: boolean; unusedPad: number; beatScale: number };
export type MultitrackArrangerProps = {
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
    ...sequencer.tracks.map((t, i): Lane => ({ id: t.id, kind: "sequencer", title: t.name || copy.melodicSequencerWithIndex(i + 1), subtitle: channelLabel(t.midiChannel), pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: "timing" in t ? t.timing.beatRateDenominator / t.timing.beatRateNumerator : 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, availablePads: t.pads.flatMap((p, i) => p.steps.some(s => s.note !== null || s.hold) ? [i] : []), unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => !p.steps.some(s => s.note !== null || s.hold))) })),
    ...sequencer.drummerTracks.map((t, i): Lane => ({ id: t.id, kind: "drummer", title: t.name || copy.drummerSequencerWithIndex(i + 1), subtitle: channelLabel(t.midiChannel), pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: "timing" in t ? t.timing.beatRateDenominator / t.timing.beatRateNumerator : 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, availablePads: t.pads.flatMap((p, i) => p.rows.some(r => r.steps.some(s => s.active)) ? [i] : []), unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => !p.rows.some(r => r.steps.some(s => s.active)))) })),
    ...sequencer.controllerSequencers.map((t, i): Lane => ({ id: t.id, kind: "controller", title: t.name || copy.controllerSequencerWithIndex(i + 1), subtitle: `CC ${t.controllerNumber}`, pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: "timing" in t ? t.timing.beatRateDenominator / t.timing.beatRateNumerator : 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, availablePads: t.pads.map((_, i) => i), unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => p.keypoints.every(k => k.value === 0))) })),
    ...sequencer.arpeggiators.filter(t => t.playbackMode === "arranger").map((t): Lane => ({ id: t.id, kind: "arpeggiator", title: t.name, subtitle: channelLabel(t.targetChannel), pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatScale: 1, source: t.padLoopEnabled, repeat: t.padLoopRepeat, activePad: t.activePad, enabled: t.enabled, availablePads: t.pads.flatMap((p, i) => p.steps.some(s => s.kind !== "rest") ? [i] : []), unusedPad: firstUnusedPad(t.padLoopPattern, t.pads.map(p => p.steps.every(s => s.kind === "rest"))) }))
  ];
  const totalSteps = Math.max(quantum, sequencer.stepCount, ...lanes.map(lane => arrangementSpans(lane.pattern, lane.padBeats).reduce((sum, s) => sum + s.duration * lane.beatScale * quantum, 0)));
  const width = Math.max((totalSteps + quantum * 4) * zoom, viewportWidth);
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
  const arrangerActive = useAppStore(state => state.sequencerRuntime.arrangerActive);
  const arrangerPosition = useAppStore(state => state.sequencerRuntime.arrangerTransportSubunit);
  const playhead = (arrangerActive === false && arrangerPosition !== undefined
    ? arrangerPosition / sequencerTransportSubunitsPerStep() : sequencer.cycle * sequencer.stepCount + sequencer.playhead) * zoom;
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
      zoom={zoom * quantum * lane.beatScale} width={width} scroll={scroll} playhead={playhead} />)}</div>
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
  const arrangerActive = useAppStore(state => state.sequencerRuntime.arrangerActive) ?? props.sequencer.isPlaying;
  const activeTransportClass = " ring-2 ring-amber-300 !bg-amber-300 !text-slate-950";
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
          className={transportButtonClass + (!arrangerActive ? activeTransportClass : "")}
          aria-pressed={!arrangerActive}
          title={copy.transportStop}
          aria-label={copy.transportStop}
        >
          <CassetteIcon kind="stop" />
        </button>
        <button
          type="button"
          onClick={onTransportPlay}
          className={transportButtonClass + (arrangerActive ? activeTransportClass : "")}
          aria-pressed={arrangerActive}
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
