import { previewPattern, type SongPatternEdit } from "../../lib/clipArranger/songDrafts";
import { clipLoopTarget } from "../../lib/clipArranger/loopTarget";
import { ArrangeTrackRouting, focusTrackChannel } from "../sequencer/ArrangeTrackRouting";
import { AddArrangeTrack } from "./AddArrangeTrack";
import { WorkspacePanels, WorkspacePanel, shellCopy } from "../sequencer/WorkspacePanels";
import { draftKey } from "../../lib/clipArranger/editorAdapter";
import { arrangeCopy } from "./arrangeCopy";
import { InspectorName } from "./InspectorName";
import { EditScopeControls, EditScopeDialog } from "./EditScopeControls";
import { type MidiDevice } from "../../lib/midiControllerChannels";
import { localLoopWindows, type EditScope } from "../../lib/clipArranger/relationships";
import { occurrenceEditIntent } from "../../lib/clipArranger/draftResolution";
import { scopeCopy } from "../../lib/clipArranger/scopeCopy";
import { clipButton, clipButtonClass, clipButtonTone } from "./buttonStyles";
import { HelpIconButton } from "../HelpIconButton";
import { PositionInput } from "./PositionInput";
import { ArrangerFollowPlayhead, followPlayheadOffset } from "../sequencer/ArrangerFollowPlayhead";
import { structureDropLayout, structureContentAt, STRUCTURE_TREE_TOP } from '../../lib/clipArranger/structureHitTest';
import { structureCopy } from './structureCopy';
import { addOffsets, offsetAt } from "../../lib/clipArranger/transposition";
import { logicalRepeatIndex, transposePlans } from "../../lib/clipArranger/transposeModel";
import { AutomationGenerator } from "./AutomationControls";
import { automationCopy } from "./automationCopy";
import type { useStructureEditor } from "./StructureEditor";
import { beginStructure, structurePreview, structureClip, isExpandedStructure, structureDisplayGeometry } from "../../lib/clipArranger/structure";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { GuiLanguage, HelpDocId, SequencerState } from "../../types";
import { localBeatTicks, patternDuration, contentLength, definitionMap, newClipId, QUARTER_TICKS as Q, type Clip, type ClipArrangement, type ClipLane, type ContentItem, type OccurrenceTarget, type PatternTiming } from "../../lib/clipArranger/model";
import { definitionAt, clipDisplayName, addClip, convertLaneCycle, deleteClip, fitClip, trimClip, updateClip } from "../../lib/clipArranger/operations";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import { SectionTools } from "./SectionTools";
import { PatternPreview } from "./PatternPreview";
import { clipCopy } from "./copy";
import { EditorDetails, usePerformanceEditorState, useRetainedScroll } from "../sequencer/PerformanceEditorState";
import { LaneTransposeBadge, LaneTransposeDialog } from './LaneTransposition';
import { openClipTransposition, saveInspectorPatternName } from '../../store/clipActions';
import { useAppStore } from '../../store/useAppStore';

export const clipInput = "w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100";
export type ClipArrangerProps = {
  songEdits?: SongPatternEdit[];
  onHelpRequest?: (id: HelpDocId) => void;
  instrumentName?: (device: MidiDevice) => string;
  model: ClipArrangement; sequencer: SequencerState; language: GuiLanguage;
  onChange: (model: ClipArrangement, label: string) => void;
  structure: ReturnType<typeof useStructureEditor>;
  zoom: number; minZoom: number; setZoom: (zoom: number | null) => void;
  viewport: RefObject<HTMLDivElement>; viewportWidth: number; laneHeaderWidth: number;
  onEdit: (target: OccurrenceTarget, scope?: EditScope) => void;
  stopAudition?: () => Promise<void>;
  editingTarget?: OccurrenceTarget;
  renderAutomation?: (target: OccurrenceTarget, range: [number, number]) => ReactNode;
  inlineEditor?: { laneId: string; content: ReactNode };
  position?: number; onSeek?: (step: number) => void; onLoopChange?: (range: { startStep: number; endStep: number } | null) => void;
  transport?: ReactNode; laneControls?: (id: string) => ReactNode;
  onRemoveLane?: (id: string) => void;
  onAddLane?: (source: ClipLane["source"]) => OccurrenceTarget | void;
  requestClose?: (finish: () => void) => void;
};

function firstVisibleTarget(lane: ClipLane, clip: Clip, timing?: PatternTiming): OccurrenceTarget | undefined {
  const cycle = contentLength(lane, clip.children, timing);
  if (!cycle) return;
  const firstPass = clip.mode === "loop" ? Math.floor(clip.offset / cycle) : 0;
  // A cropped pass may contain only rests. The next full cycle contains every available definition.
  for (let pass = firstPass; pass <= firstPass + (clip.mode === "loop" ? 1 : 0); pass++) {
    let tick = clip.start - clip.offset + pass * cycle;
    for (const item of clip.children) {
      const end = tick + contentLength(lane, [item], timing);
      if ("definitionId" in item && end > clip.start && tick < clip.start + clip.length)
        return { laneId: lane.id, clipId: clip.id, path: [item.id], pass };
      tick = end;
    }
  }
}

export function ClipArranger({ songEdits = [], onHelpRequest, instrumentName, model, sequencer, language, onChange, onEdit, structure, zoom, minZoom, setZoom, viewport, viewportWidth, laneHeaderWidth, editingTarget, transport, laneControls, onAddLane, inlineEditor, renderAutomation, position = 0, onSeek, onLoopChange, onRemoveLane, requestClose, stopAudition = async () => {} }: ClipArrangerProps) {
  const c = clipCopy(language), t = structureCopy(language), timings = useMemo(() => arrangementTimings(sequencer), [sequencer]);
  const displayDraft = structure.previewDraft ?? structure.draft;
  const displayModel = useMemo(() => displayDraft ? structurePreview(model, displayDraft, timings) : model, [model, displayDraft, timings]);
  const shell = useContext(WorkspacePanels);
  const [fitTracks, setFitTracks] = usePerformanceEditorState("arranger", "fitTracks", false);
  const [followPlayhead, setFollowPlayhead] = usePerformanceEditorState("arranger", "followPlayhead", false);
  const following = useAppStore(state => followPlayhead && state.sequencerRuntime.arrangerActive === true);
  const [expanded, setExpanded] = usePerformanceEditorState<string | null>("arranger", "clipExpandedLane", null);
  const [transposing,setTransposing] = useState<{target:OccurrenceTarget;trigger:HTMLButtonElement}|null>(null);
  const generation = useAppStore(s=>s.performanceWorkspaceGeneration);
  useEffect(()=>setTransposing(null),[generation,expanded]);
  const [selected, select] = usePerformanceEditorState<{ laneId: string; clipId?: string } | null | undefined>("arranger", "clipSelection", undefined);
  const editingLane = editingTarget?.laneId, editingClip = editingTarget?.clipId;
  const [lastEditor, rememberEditor] = usePerformanceEditorState<string | null>("arranger", "lastClipEditor", null);
  useEffect(() => {
    const identity = editingLane && editingClip ? JSON.stringify([editingLane, editingClip]) : null;
    if (lastEditor === identity) return;
    rememberEditor(identity);
    if (editingLane && editingClip) { select({ laneId: editingLane, clipId: editingClip }); setExpanded(editingLane); }
  }, [editingLane, editingClip, lastEditor, rememberEditor, select, setExpanded]);
  const [scroll, setScroll] = useState(0);
  const retainScroll = useRetainedScroll(viewport, "arranger", "clipViewport");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ laneId: string; clipId: string; mode: "move" | "left" | "right"; x: number; delta: number } | null>(null);
  const dragRef = useRef(drag); dragRef.current = drag;
  const timelineWidth = viewportWidth - laneHeaderWidth;
  const unit = zoom / Q, width = Math.max(timelineWidth, (model.end / Q + 4) * zoom);
  const renderAhead = Math.max(1800, timelineWidth);
  const zoomRatio = 100 / minZoom;
  const sliderValue = Math.round(100 * Math.log(zoom / minZoom) / Math.log(zoomRatio));
  const pendingZoomBeat = useRef<number | null>(null);
  const lastZoomAnchor = useRef<{ beat: number; centerPixel: number; zoom: number } | null>(null);
  const changeZoom = (value: number) => {
    if (viewport.current && !following) {
      const centerPixel = viewport.current.scrollLeft + timelineWidth / 2;
      const last = lastZoomAnchor.current;
      // Reuse the exact beat across slider steps. Rounded scroll pixels accumulate drift on long songs.
      pendingZoomBeat.current = last?.centerPixel === centerPixel && last.zoom === zoom ? last.beat : centerPixel / zoom;
    }
    setZoom(value === 0 ? null : minZoom * zoomRatio ** (value / 100));
  };
  useLayoutEffect(() => {
    const node = viewport.current, beat = pendingZoomBeat.current;
    if (!node || beat === null) return;
    pendingZoomBeat.current = null;
    // The new canvas width must be in the DOM before assigning its scroll offset.
    const target = beat * zoom - timelineWidth / 2;
    const left = Math.max(0, Math.min(width - timelineWidth, target));
    node.scrollLeft = left;
    lastZoomAnchor.current = left === target ? { beat, centerPixel: node.scrollLeft + timelineWidth / 2, zoom } : null;
    setScroll(node.scrollLeft);
    retainScroll();
  }, [zoom, width, timelineWidth, viewport, retainScroll]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!following || !node?.clientWidth) return;
    const left = followPlayheadOffset(position * unit, model.end * unit, timelineWidth);
    if (Math.abs(node.scrollLeft - left) < 0.5) return;
    node.scrollLeft = left;
    setScroll(node.scrollLeft);
    retainScroll();
  }, [following, position, unit, model.end, timelineWidth, viewport, retainScroll]);
  const beatsPerBar = sequencer.timing.meterNumerator;
  const rulerStep = zoom >= 12 ? 1 : beatsPerBar * Math.ceil(48 / (zoom * beatsPerBar));
  const firstRulerBeat = Math.floor(scroll / (zoom * rulerStep)) * rulerStep;
  const rulerBeats = Array.from({ length: Math.ceil(timelineWidth / (zoom * rulerStep)) + 2 },
    (_, index) => firstRulerBeat + index * rulerStep).filter(beat => beat * zoom < width);
  const attempt = (action: () => ClipArrangement, label: string) => { try { const next = action(); onChange(next, label); setError(null); return next; } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
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
  const pick = (lane: ClipLane, clip: Clip) => {
    structure.setFocus({ laneId: lane.id, clipId: clip.id, pass: 0, parent: [] });
    select({ laneId: lane.id, clipId: clip.id });
  };
  const createEmpty = (lane:ClipLane,start:number) => structure.guard((saved) => {
    const clip:Clip={id:newClipId(),name:c.window,start,length:4*Q,offset:0,mode:'once',children:[{id:newClipId(),restTicks:4*Q}]};
    try { onChange(addClip(saved??model,lane.id,clip,timings),c.add); select({laneId:lane.id,clipId:clip.id});structure.setFocus({laneId:lane.id,clipId:clip.id,pass:0,parent:[]});setError(null); } catch(e){setError(String(e));}
  });
  const selectedLane = model.lanes.find(l => l.id === selected?.laneId), selectedClip = selectedLane?.clips.find(cl => cl.id === selected?.clipId);
  const selectedTrack = selectedLane && sequencer[sourceKeys[selectedLane.source]].find(track => track.id === selectedLane.id);
  const loopStart = sequencer.arrangerLoopSelection?.startStep, loopEnd = sequencer.arrangerLoopSelection?.endStep;
  useEffect(() => {
    // Selection is session-only. Give loaded performances a usable loop target
    // even when looping was saved off, without opening or expanding an editor.
    // null is an explicit deselection; undefined means this session has not selected yet.
    if (selected === null || selectedLane || editingClip) return;
    if (selected) { select(null); return; }
    const candidates = model.lanes.flatMap(lane => lane.clips.map(clip => ({ lane, clip })))
      .sort((a, b) => a.clip.start - b.clip.start);
    const target = candidates.find(({ clip }) => loopStart !== undefined && loopEnd !== undefined &&
      clip.start === Math.round(loopStart * 2520) && clip.start + clip.length === Math.round(loopEnd * 2520))
      ?? candidates.find(({ clip }) => clip.start <= position && position < clip.start + clip.length)
      ?? candidates[0];
    if (target) select({ laneId: target.lane.id, clipId: target.clip.id });
  }, [selected, selectedLane, editingClip, loopStart, loopEnd, model.lanes, position, select]);
  const lastClipEnd = Math.max(Q / 4, ...model.lanes.flatMap(lane => lane.clips.map(clip => clip.start + clip.length)));
  const setSongEnd = (end: number) => attempt(() => ({ ...model, revision: model.revision + 1, end }), c.songEnd);
  const open = (lane: ClipLane, clip: Clip, path: string[], pass: number, selectItem = true) => {
    structure.guardEdit({ laneId: lane.id, clipId: clip.id, path, pass }, requested => structure.guardPattern(requested, undefined, target => {
      shell?.revealEditor();
      select({ laneId: target.laneId, clipId: target.clipId });
      setExpanded(target.laneId);
      if (selectItem) structure.select({ laneId: target.laneId, clipId: target.clipId, pass: target.pass, parent: target.path.slice(0, -1) }, target.path[target.path.length - 1], false);
      else structure.clearSelection();
      onEdit(target);
    }));
  };
  const compatible = (lane: ClipLane, target: OccurrenceTarget) => {
    if (!shell || !editingTarget || draftKey({ target }) === draftKey({ target: editingTarget })) return false;
    const previous = model.lanes.find(l => l.id === editingTarget.laneId);
    if (!previous) return false;
    try {
      const before = definitionAt(previous, editingTarget), after = definitionAt(lane, target);
      return before.kind === "pattern" ? after.kind === "pattern" && before.source === after.source : after.kind !== "pattern";
    } catch { return false; } // Unsaved structural additions have no authored editor target yet.
  };
  const selectContent = (lane: ClipLane, clip: Clip, pass: number, parent: string[], id: string, shift: boolean) => {
    const target = { laneId: lane.id, clipId: clip.id, path: [...parent, id], pass };
    if (!shift && compatible(lane, target)) { open(lane, clip, target.path, pass); return; }
    structure.select({ laneId: lane.id, clipId: clip.id, parent, pass }, id, shift, () => {
      select({ laneId: lane.id, clipId: clip.id }); setExpanded(lane.id);
    });
  };
  const contentMenu = (lane: ClipLane, clip: Clip, pass: number, path: string[], x: number, y: number) => {
    const focus = { laneId: lane.id, clipId: clip.id, pass, parent: path.slice(0, -1) };
    structure.contextMenu(focus, path[path.length - 1], x, y, () => select({ laneId: lane.id, clipId: clip.id }));
  };
  const selectHeader = (lane: ClipLane, clip: Clip, target?: OccurrenceTarget) => {
    if (target && editingTarget?.clipId !== clip.id && compatible(lane, target)) open(lane, clip, target.path, target.pass, false);
    else { structure.clearSelection(); pick(lane, clip); }
  };
  const selectedOccurrence = structure.selectedTarget?.laneId === selectedLane?.id && structure.selectedTarget?.clipId === selectedClip?.id ? structure.selectedTarget : undefined;
  const hasContentSelection = structure.selection && structure.focus?.laneId === selectedLane?.id && structure.focus?.clipId === selectedClip?.id;
  const loopTarget = useMemo(() => shell ? null : clipLoopTarget(sequencer, selected, structure.focus, structure.selection),
    [shell, sequencer, selected, structure.focus, structure.selection]);
  const selectedTiming = selectedLane && timings[selectedLane.id];
  const firstTarget = useMemo(() => shell && selectedLane && selectedClip ? firstVisibleTarget(selectedLane, selectedClip, selectedTiming) : undefined, [!!shell, selectedLane, selectedClip, selectedTiming]);
  const editorTarget = shell && (hasContentSelection ? selectedOccurrence : shell.getRememberedTarget() ?? firstTarget);
  const nameTarget = hasContentSelection ? selectedOccurrence : firstTarget;
  const namedDefinition = selectedOccurrence ? structure.selectedDefinition : selectedLane && nameTarget && definitionAt(selectedLane, nameTarget);
  const nameKey = nameTarget && draftKey({ target: nameTarget });
  const nameDraft = useAppStore(s => nameKey ? s.clipDrafts[nameKey] : undefined);
  const nameRelationship = namedDefinition && selectedLane && structure.relationships.get(selectedLane.id)?.get(namedDefinition.id);
  const namePass = selectedClip?.mode === "loop" && nameTarget ? (selectedClip.repeatIndexBase ?? 0) + nameTarget.pass : undefined;
  const nameScope = occurrenceEditIntent(model, nameDraft, !!nameDraft && nameDraft.target === editingTarget, nameRelationship, namePass).scope;
  const labels = arrangeCopy(language);
  const selectedPass = selectedOccurrence && `${labels.pass} ${(selectedClip?.repeatIndexBase ?? 0) + selectedOccurrence.pass + 1}`;
  const openTranspose = (requested:OccurrenceTarget,trigger:HTMLButtonElement) => {
    structure.cancelDrag();
    structure.guardEdit(requested,target=>{openClipTransposition(target);setTransposing({target,trigger});});
  };
  const startDrag = (event: React.PointerEvent, lane: ClipLane, clip: Clip, mode: "move" | "left" | "right") => {
    if (event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); if (!shell) pick(lane, clip);
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
    if (!items.length) return structure.boundary({ laneId: lane.id, clipId: clip.id, pass, parent: path }, 0);
    return items.map((item, itemIndex) => {
      const duration = contentLength(lane, [item], timings[lane.id]);
      const left = cursor * unit; cursor += duration;
      if (origin + left + duration * unit < scroll - laneHeaderWidth || origin + left > scroll + renderAhead) return null;
      const def = "definitionId" in item ? defs.get(item.definitionId)! : null;
      const itemPath = [...path, item.id];
      const preview = def?.kind === "pattern" ? previewPattern(songEdits, { laneId: lane.id, clipId: clip.id, pass, path: itemPath }, def) : null;
      const editDefinition = def ? (event: React.MouseEvent) => {
        event.stopPropagation();
        open(lane, clip, itemPath, pass);
      } : undefined;
      const color = !def ? "border-slate-600 bg-slate-900 text-slate-400" : def.kind === "pattern" ? "border-emerald-700 bg-emerald-950/70 text-emerald-200" : def.kind === "group" ? "border-rose-700 bg-rose-950/40 text-rose-200" : "border-violet-600 bg-violet-950/40 text-violet-200";
      const target = { laneId: lane.id, clipId: clip.id, pass, parent: path };
      const boundCurve = sequencer.controllerSequencers.some(t => t.id === lane.id && t.automationTarget && t.controllerMode === "curve");
      const visibleLeft = Math.max(0, scroll - laneHeaderWidth - origin - left, clip.start * unit - origin - left);
      const previewWidth = preview && preview !== def ? patternDuration(preview, timings[lane.id]) * unit : duration * unit;
      const visibleRight = Math.min(previewWidth, duration * unit, scroll + viewportWidth - origin - left, (clip.start + clip.length) * unit - origin - left);
      const restEnd = Math.min(duration, ((clip.start + clip.length) * unit - origin - left) / unit);
      const headerLeft = Math.max(0, scroll - origin - left, clip.start * unit - origin - left);
      const headerRight = Math.min(duration * unit, scroll + viewportWidth - laneHeaderWidth - origin - left, (clip.start + clip.length) * unit - origin - left);
      const selectedItem = structure.isSelected(target,item.id);
      const related = !!def && structure.selectedTarget?.laneId === lane.id && structure.selectedDefinition?.id === def.id && !selectedItem;
      const relationship = def ? structure.relationships.get(lane.id)?.get(def.id) : undefined;
      const repeated = clip.mode === 'loop' && (clip.repeatIndexBase ?? 0) + pass > 0;
      const sc = scopeCopy(language);
      const repeatColor = !repeated || !def ? '' : def.kind === 'pattern' ? '!bg-emerald-900/40' : def.kind === 'group' ? '!bg-rose-900/25' : '!bg-violet-900/25';
      const offset = def ? addOffsets(transposePlans(lane,clip,itemPath).map(p=>offsetAt(p,(clip.repeatIndexBase??0)+pass))) : undefined;
      return <div data-structure-node={JSON.stringify({ focus: target, index: itemIndex })} key={item.id} onContextMenu={event => {
        event.preventDefault(); event.stopPropagation(); contentMenu(lane, clip, pass, itemPath, event.clientX, event.clientY);
      }} data-linked-highlight={related || undefined} data-loop-repetition={repeated || undefined} className={`absolute top-0 overflow-hidden rounded border ${color} ${repeatColor}`} style={{ outline: selectedItem ? "2px solid #67e8f9" : related ? "1px dashed #94a3b8" : undefined, left, width: duration * unit, height: (boundCurve ? 108 : 46) + (def && def.kind !== "pattern" ? (2 - depth) * 22 : 0) }}>
        <div onDoubleClick={editDefinition} className="flex h-5 min-w-0 items-center gap-0.5 overflow-hidden" style={{marginLeft:headerLeft,width:Math.max(0,headerRight-headerLeft-2)}}>
        {structure.boundary(target, itemIndex)}
        {relationship?.shared && <span className="shrink-0 text-[10px]" title={sc.linked} aria-label={sc.linked}>↔</span>}
        {repeated && <span className="shrink-0 text-[10px]" title={sc.repeat} aria-label={sc.repeat}>↻</span>}
        <button data-structure-key={JSON.stringify([lane.id, clip.id, pass, ...path, item.id])} onPointerDown={e => structure.pointerDown(e, target, item.id)} className="block h-5 min-w-0 flex-1 truncate px-1 text-left text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" title={def ? `${def.kind}: ${def.name}` : c.rest}
          onClick={e => { e.stopPropagation(); selectContent(lane, clip, pass, path, item.id, e.shiftKey); }}
          onKeyDown={e => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect();
            contentMenu(lane, clip, pass, itemPath, rect.left, rect.bottom); return;
          } if (!e.shiftKey && ["ArrowLeft","ArrowRight"].includes(e.key)) {e.preventDefault();e.stopPropagation();structure.nudge(target,item.id,(e.key==="ArrowLeft"?-1:1)*Q/4);} if (["Delete", "Backspace"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); structure.remove(target, item.id); } if (e.shiftKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); const next = structure.extendSelection(target,item.id,e.key === "ArrowLeft" ? -1 : 1); if(next)focusStructureOccurrence(lane,clip,next.focus.pass,[...next.focus.parent,next.id]); } if (e.key === "Enter" && def) { e.stopPropagation(); open(lane, clip, itemPath, pass); } }}>{def ? `${def.kind === "pattern" ? "♪" : def.kind === "group" ? "▣" : "▤"} ${def.name}` : c.rest}</button>
        {def && ['sequencer','score','arpeggiator'].includes(lane.source) && headerRight>headerLeft && <LaneTransposeBadge target={{laneId:lane.id,clipId:clip.id,path:itemPath,pass}} name={def.name} index={logicalRepeatIndex(lane,clip,itemPath,pass)} offset={offset!} width={Math.max(0,headerRight-headerLeft-(itemIndex===items.length-1?46:23))} language={language} onOpen={openTranspose}/>}
        {itemIndex===items.length-1 && structure.boundary(target, items.length)}</div>
        {def?.kind==='pattern' && (['left','right'] as const).map(edge=><div key={edge} role="separator" aria-label={`${c.length}: ${def.name} ${edge==='left'?t.leftEdge:t.rightEdge}`} aria-orientation="vertical" tabIndex={0} className={`absolute bottom-0 top-5 z-20 w-2 cursor-ew-resize ${edge==='left'?'left-0':'right-0'} hover:bg-cyan-300/50 focus:bg-cyan-300/50`} onPointerDown={e=>structure.resizeDown(e,target,item.id,edge)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();structure.resize(target,item.id,edge,(e.key==='ArrowLeft'?-1:1)*localBeatTicks(timings[lane.id]));}}}/>)}
        {!def && itemIndex===items.length-1 && visibleRight>visibleLeft && <div role="separator" aria-label={`${c.length}: ${c.rest}`} title={t.restResize} aria-orientation="vertical" tabIndex={0} aria-valuenow={duration/Q} aria-valuetext={`${duration/Q} ${c.beats}`} className="absolute bottom-0 top-5 z-20 w-2 cursor-ew-resize bg-slate-500/40 hover:bg-cyan-300/50 focus:bg-cyan-300/50" style={{left:restEnd*unit-10}} onPointerDown={e=>structure.resizeDown(e,target,item.id,'right',restEnd)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();structure.resize(target,item.id,'right',(e.key==='ArrowLeft'?-1:1)*Q/4,restEnd);}}}/>}
        {def?.kind === "pattern" ? boundCurve ? visibleRight > visibleLeft && <div style={{ marginLeft: visibleLeft, width: visibleRight - visibleLeft }} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          {renderAutomation?.({ laneId: lane.id, clipId: clip.id, path: itemPath, pass }, [visibleLeft / previewWidth, visibleRight / previewWidth]) ??
            <button className="block w-full" aria-label={`${c.edit}: ${def.name}`} onClick={() => open(lane, clip, itemPath, pass)}><PatternPreview definition={preview ?? def} timing={timings[lane.id]} height={72} visibleRange={[visibleLeft / previewWidth, visibleRight / previewWidth]} /></button>}
        </div> : <div style={{ width: previewWidth }} onClick={e => { e.stopPropagation(); selectContent(lane, clip, pass, path, item.id, e.shiftKey); }} onDoubleClick={editDefinition}><PatternPreview definition={preview ?? def} offset={offset} timing={timings[lane.id]} controllerMode={sequencer.controllerSequencers.find(t => t.id === lane.id)?.controllerMode} /></div>
          : def ? <div className="relative mt-px">{tree(lane, clip, def.children, itemPath, pass, depth + 1, origin + left)}</div> : null}
      </div>;
    });
  };
  const addTrack = (kind: ClipLane["source"]) => {
    const create = () => {
      const target = onAddLane?.(kind);
      if (!target) return;
      useAppStore.setState({ clipEditingKey: null });
      shell?.revealEditor();
      structure.clearSelection();
      select({ laneId: target.laneId, clipId: target.clipId });
      focusTrackChannel(target.laneId);
    };
    if (requestClose && editingTarget) requestClose(create);
    else create();
  };
  const laneActions = selectedLane && (
      <div className={shell ? "ws-lane-actions" : "contents"}>
      {selectedClip && <AutomationGenerator laneId={selectedLane.id} clipId={selectedClip.id} language={language} />}
      {([-1, 1] as const).map(direction => <button key={direction} className={clipButton} aria-label={`${c.newLane}: ${direction < 0 ? c.up : c.down}`} disabled={model.lanes.indexOf(selectedLane) + direction < 0 || model.lanes.indexOf(selectedLane) + direction >= model.lanes.length} onClick={() => attempt(() => { const lanes = [...model.lanes], index = lanes.indexOf(selectedLane); [lanes[index], lanes[index + direction]] = [lanes[index + direction], lanes[index]]; return { ...model, revision: model.revision + 1, lanes }; }, c.edit)}>{direction < 0 ? "↑" : "↓"}</button>)}
      {onRemoveLane && <button className={clipButtonClass("remove")} onClick={() => onRemoveLane(selectedLane.id)}>{c.removeTrack}</button>}
      </div>
  );
  return <section data-workspace-arranger={shell ? "" : undefined} data-fit-tracks={shell && fitTracks || undefined} className="relative mt-4 min-w-0 rounded-xl border border-slate-700 bg-slate-950/85 p-3" aria-label={c.title}>
    {shell && <WorkspacePanel name="editorCommand"><button aria-pressed={!!editingTarget && !shell.editorHidden} onClick={() => {
      if (shell.editorHidden && editingTarget) { shell.revealEditor(); return; }
      if (editingTarget) { shell.closeDock(); return; }
      if (selectedLane && selectedClip && editorTarget) open(selectedLane, selectedClip, editorTarget.path, editorTarget.pass);
    }} disabled={!editingTarget && !editorTarget}>{shellCopy[language].editor}</button></WorkspacePanel>}
    {onHelpRequest && <HelpIconButton guiLanguage={language} onClick={() => onHelpRequest("sequencer_clip_arranger")} />}
    <div className={`mb-3 flex flex-wrap items-center gap-2 ${onHelpRequest ? "pr-8" : ""}`}><h2 className="mr-auto text-sm font-semibold text-cyan-100">{c.title}</h2>{transport}
      {!shell && onSeek && <label className="text-xs text-slate-400">{c.position} <PositionInput key={generation} className={clipInput} beats={position / Q} onSeek={onSeek} /></label>}
      {loopTarget && onLoopChange && <button className={clipButton + (sequencer.arrangerLoopSelection ? " !border-amber-300 !bg-amber-300 !text-slate-950 ring-2 ring-amber-300" : "")} aria-pressed={!!sequencer.arrangerLoopSelection} title={c[loopTarget.label]} onClick={() => onLoopChange(sequencer.arrangerLoopSelection ? null : loopTarget.range)}>{c.loop}</button>}
      <label className="flex items-center gap-2 text-xs text-slate-400">{c.zoom}<input aria-label={c.zoom} type="range" min="0" max="100" value={sliderValue} onChange={e => changeZoom(Number(e.target.value))} /></label>
      <ArrangerFollowPlayhead language={language} checked={followPlayhead} onChange={setFollowPlayhead} />
      {shell && <button className={clipButton} aria-pressed={fitTracks} onClick={() => setFitTracks(!fitTracks)}>{shellCopy[language].fit}</button>}
    </div>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <label>{c.songEnd} · {c.beats} <input className={clipInput} aria-label={c.songEnd} type="number" min={lastClipEnd / Q} step="0.25" key={model.end} defaultValue={model.end / Q} onBlur={e => { const end = Number(e.target.value) * Q; if (end !== model.end) setSongEnd(end); }} /></label>
      <button className={clipButtonClass("edit")} disabled={model.end === lastClipEnd} onClick={() => setSongEnd(lastClipEnd)}>{c.fitSong}</button>
    </div>
    <div style={shell ? { "--tracks": Math.max(1, model.lanes.length), "--beat-width": zoom + "px", "--header-width": laneHeaderWidth + "px" } as CSSProperties : undefined} data-arranger-viewport onPointerDownCapture={structure.startPointer} onClickCapture={e => {
      if(structure.consumeGestureClick()){e.stopPropagation();return;}
      const target = e.target as Element;
      if (!target.closest("[data-arranger-clip], [data-clip-inline-editor], [data-lane-controllers], [data-track-routing]")) { select(null); structure.clearSelection(); }
    }} onPointerMove={e=>{structure.pointerMove(e);const hovered=(document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-clip-lane]') as HTMLElement|null)?.dataset.clipLane;if(structure.dragging()&&hovered)setExpanded(hovered);}} onPointerUp={structure.pointerUp} onPointerCancel={structure.cancelDrag} onLostPointerCapture={e => { if (e.target === e.currentTarget) structure.lostCapture(); }} ref={viewport} className="overflow-x-auto" onScroll={e => { retainScroll(); setScroll(e.currentTarget.scrollLeft); }}>
      <div style={{ width: width + laneHeaderWidth, minWidth: "100%", paddingBottom: 16 }}>
        <div style={{ marginLeft: laneHeaderWidth }} className="relative h-6 cursor-crosshair overflow-hidden border-b border-slate-800" aria-hidden onClick={e => onSeek?.(Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 4) * 2))}>{sequencer.arrangerLoopSelection && <span className="pointer-events-none absolute inset-y-0 border-x border-amber-300 bg-amber-400/20" style={{ left: sequencer.arrangerLoopSelection.startStep * 2520 * unit, width: (sequencer.arrangerLoopSelection.endStep - sequencer.arrangerLoopSelection.startStep) * 2520 * unit }} />}{rulerBeats.map(beat => <span key={beat} className="absolute text-[10px] text-slate-500" style={{ left: beat * zoom }}>{beat % beatsPerBar === 0 ? `${Math.floor(beat / beatsPerBar) + 1}.1` : "·"}</span>)}</div>
        {displayModel.lanes.map(lane => {
          const track = sequencer[sourceKeys[lane.source]].find(t => t.id === lane.id);
          const instrument = track && instrumentName?.(track);
          const detailed = expanded === lane.id;
          const expandedHeight = track && "automationTarget" in track && track.automationTarget && track.controllerMode === "curve"
            ? lane.clips.some(cl => cl.children.some(item => "definitionId" in item && lane.definitions.find(d => d.id === item.definitionId)?.kind !== "pattern")) ? 198 : 154 : 152;
          return <div key={lane.id}><div className="relative flex border-b border-slate-800" data-clip-lane={lane.id} data-expanded={detailed} style={{ height: detailed ? expandedHeight : undefined, minHeight: shell && fitTracks && !detailed ? undefined : 48 }}>
            <div style={{ width: laneHeaderWidth }} className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-slate-700 bg-slate-950 px-2 py-1">
              <button className="truncate text-left text-xs font-semibold text-slate-200" aria-expanded={detailed} aria-description={instrument} onClick={() => { structure.cancelDrag(); setExpanded(detailed ? null : lane.id); if (shell) { structure.clearSelection(); select({ laneId: lane.id }); } }}>{detailed ? "▾" : "▸"} {track?.name ?? lane.id}</button>
              <div data-track-routing className="flex min-w-0 items-center gap-1">
                <ArrangeTrackRouting id={lane.id} kind={lane.source} language={language} />
                {instrument && <div className="truncate text-[11px] leading-tight text-slate-300" title={instrument}>{instrument}</div>}
              </div>
              <div className="text-[10px] text-slate-400">{c[lane.source === "sequencer" ? "melodic" : lane.source]} {track && "automationSuspended" in track && track.automationSuspended && <span title={automationCopy(language).suspended} aria-label={automationCopy(language).suspended} className="text-amber-300">⚠</span>}</div>
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">{laneControls?.(lane.id)}<button className={`ml-auto rounded border px-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${clipButtonTone.add}`} aria-label={`${c.add}: ${track?.name}`} onClick={() => { createEmpty(lane,Math.max(0,...lane.clips.map(cl=>cl.start+cl.length))); }}>+</button></div>
            </div>
            <div data-clip-timeline className="relative flex-1" style={{ backgroundSize: `${zoom * rulerStep}px 100%`, backgroundImage: "linear-gradient(to right, #1e293b 1px, transparent 1px)" }} onDoubleClick={e => {
              if (e.target === e.currentTarget) { createEmpty(lane,Math.max(0,Math.round((e.clientX-e.currentTarget.getBoundingClientRect().left)/zoom*4)*Q/4)); }
            }}>
              <div className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-amber-400/80" title={c.songEnd} style={{ left: model.end * unit }} />
              {position * unit + 1 <= width && <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-cyan-300" style={{ left: position * unit }} />}
              {lane.clips.filter(clip => (clip.start + clip.length) * unit > scroll - laneHeaderWidth && clip.start * unit < scroll + renderAhead).map(clip => {
                let originalClip = model.lanes.find(l => l.id === lane.id)?.clips.find(c => c.id === clip.id) ?? clip;
                const editingStructure = displayDraft?.laneId === lane.id && displayDraft.clipId === clip.id ? displayDraft : null;
                if(editingStructure)originalClip=structureClip(editingStructure,timings);
                const duration = Math.max(1, contentLength(lane, originalClip.children, timings[lane.id]));
                const draftDuration = contentLength(lane, clip.children, timings[lane.id]);
                const geometry = editingStructure ? structureDisplayGeometry(originalClip, isExpandedStructure(editingStructure)?editingStructure.expanded!.contentTicks:duration, draftDuration, editingStructure.pass) : {length: clip.length, left: (pass: number) => pass * duration - clip.offset};
                const firstPass = clip.mode === "loop" ? Math.floor((clip.offset + Math.max(0, (scroll - laneHeaderWidth) / unit - clip.start)) / duration) : 0;
                // At overview scale the clip box is enough when each repeat is subpixel.
                const lastPass = clip.mode === "loop" ? duration * unit < 1 ? firstPass
                  : Math.min(Math.ceil((clip.offset + clip.length) / duration), firstPass + Math.ceil(renderAhead / unit / duration) + 1) : 1;
                const title = clipDisplayName(lane, clip);
                const moving = drag?.clipId === clip.id ? drag : null;
                const left = clip.start + (moving && moving.mode !== "right" ? moving.delta : 0);
                const length = geometry.length + (moving ? moving.mode === "right" ? moving.delta : moving.mode === "left" ? -moving.delta : 0 : 0);
                const contentAt = (clientX: number, timeline: Element, row: number) => {
                  const tick = (clientX - timeline.getBoundingClientRect().left) / unit;
                  if (tick < clip.start || tick >= clip.start + length) return;
                  // A structural preview can stretch its edited pass and shift the following ones.
                  const passAtTick = clip.mode === "loop" ? Math.floor((tick - clip.start + clip.offset) / duration) : 0;
                  const from = editingStructure ? firstPass : passAtTick;
                  const to = editingStructure ? lastPass : passAtTick + 1;
                  for (let pass = from; pass < to; pass++) {
                    const origin = clip.start + geometry.left(pass);
                    const end = clip.mode === "once" ? clip.start + length : origin + (editingStructure?.pass === pass ? draftDuration : duration);
                    if (tick < origin || tick >= end) continue;
                    const current = editingStructure?.pass === pass ? editingStructure : beginStructure(model, lane.id, clip.id, pass);
                    const layout = structureDropLayout(model, current, timings);
                    const hit = structureContentAt(layout, tick - origin + layout.origin, row);
                    if (hit) return { pass, hit };
                  }
                };
                const headerTarget = (event: React.MouseEvent<HTMLButtonElement>) => {
                  const timeline = event.currentTarget.closest("[data-clip-timeline]")!;
                  const at = contentAt(event.clientX, timeline, 0);
                  if (at && !("index" in at.hit)) return { laneId: lane.id, clipId: clip.id, pass: at.pass, path: at.hit.path };
                  return firstVisibleTarget(lane, clip, timings[lane.id]);
                };
                return <div key={clip.id} data-arranger-clip={clip.id} onPointerDownCapture={() => !shell && select({ laneId: lane.id, clipId: clip.id })} onClickCapture={e => { if (!shell || !(e.target as Element).closest("button, [role=separator]")) select({ laneId: lane.id, clipId: clip.id }); }} className={`absolute top-1 overflow-hidden rounded border ${selected?.clipId === clip.id ? "border-cyan-300 ring-1 ring-cyan-900" : "border-slate-500"} bg-slate-900/90`} style={{ left: left * unit, width: Math.max(2, length * unit), height: detailed ? expandedHeight - 14 : 40 }}>
                  <button className="relative z-10 block h-4 w-full cursor-grab truncate bg-slate-800/90 px-2 text-left text-[10px] font-semibold text-slate-200 touch-none" title={`${title} · ${c.boundary}`} onContextMenu={event => {
                      const timeline = event.currentTarget.closest("[data-clip-timeline]")!;
                      const at = contentAt(event.clientX, timeline, 0);
                      if (!at || "index" in at.hit) return;
                      event.preventDefault();
                      contentMenu(lane, clip, at.pass, at.hit.path, event.clientX, event.clientY);
                    }} onClick={event => selectHeader(lane, clip, editingTarget ? headerTarget(event) : undefined)}
                    onDoubleClick={event => {
                      const target = headerTarget(event);
                      if (target) open(lane, clip, target.path, target.pass);
                    }} onPointerDown={e => startDrag(e, lane, clip, "move")} {...dragHandlers}>{title} {clip.mode === "loop" ? "↻" : ""}</button>
                  <div data-clip-content className="relative" style={{ height: "calc(100% - 1rem)" }} onDoubleClick={e => {
                    e.stopPropagation();
                    if ((e.target as Element).closest('button, input, select, [role="separator"]')) return;
                    const timeline = e.currentTarget.closest("[data-clip-timeline]")!;
                    const row = detailed ? e.clientY - e.currentTarget.closest("[data-clip-lane]")!.getBoundingClientRect().top - STRUCTURE_TREE_TOP : Infinity;
                    const at = contentAt(e.clientX, timeline, row);
                    if (!at) return;
                    if ("index" in at.hit) structure.add({ laneId: lane.id, clipId: clip.id, pass: at.pass, parent: at.hit.path }, at.hit.index, at.hit.ticks);
                    else open(lane, clip, at.hit.path, at.pass);
                  }}>
                    {clip.children.every(i=>'restTicks' in i) && <button aria-label={structureCopy(language).add} className={`absolute z-20 rounded border text-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${clipButtonTone.add} ${detailed?'bottom-1':'top-0'} left-1/2 -translate-x-1/2 px-4`} onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();structure.add({laneId:lane.id,clipId:clip.id,pass:0,parent:[]},0,0);}}>+</button>}{(detailed||clip.children.some(i=>'definitionId' in i)) && Array.from({ length: Math.max(0, lastPass - firstPass) }, (_, index) => firstPass + index).map(pass => <div key={pass} className={`absolute top-0 ${pass > 0 ? "border-l border-dashed border-slate-400" : ""}`} style={{ left: geometry.left(pass) * unit, width: (editingStructure && pass === editingStructure.pass ? draftDuration : duration) * unit }}>
                      {detailed ? <><span className="block h-4 px-1 text-[9px] text-slate-500">{c.content} · {(clip.repeatIndexBase ?? 0) + pass + 1}</span><div className="relative">{tree(lane, { ...(editingStructure && pass !== editingStructure.pass ? originalClip : clip), length }, editingStructure && pass !== editingStructure.pass ? originalClip.children : clip.children, [], pass, 0, (clip.start + geometry.left(pass)) * unit)}</div></>
                        : <CompactContent songEdits={songEdits} pass={pass} lane={lane} clip={clip} sequencer={sequencer} unit={unit} from={scroll - (clip.start + pass * duration - clip.offset) * unit} to={scroll + viewportWidth - laneHeaderWidth - (clip.start + pass * duration - clip.offset) * unit} language={language} onTranspose={openTranspose} onOpen={path => open(lane, clip, path, pass)}
                          onMenu={(path, x, y) => contentMenu(lane, clip, pass, path, x, y)}
                          onSelect={(path, shift) => structure.select({ laneId: lane.id, clipId: clip.id, pass, parent: path.slice(0,-1) }, path[path.length-1], shift, () => select({ laneId: lane.id, clipId: clip.id }))}
                          isSelected={path => structure.isSelected({ laneId: lane.id, clipId: clip.id, pass, parent: path.slice(0,-1) }, path[path.length-1])} />}
                    </div>)}
                  </div>
                  {(["left", "right"] as const).map(edge => <div key={edge} role="separator" aria-label={`${c.length}: ${edge==='left'?t.leftEdge:t.rightEdge}`} aria-orientation="vertical" tabIndex={0}
                    className={`absolute inset-y-0 z-10 w-2 cursor-ew-resize touch-none hover:bg-cyan-300/30 focus-visible:bg-cyan-300/30 ${edge === "left" ? "left-0" : "right-0"}`} onPointerDown={e => startDrag(e, lane, clip, edge)} {...dragHandlers}
                    onKeyDown={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); attempt(() => trimClip(model, lane.id, clip.id, edge, clip.start + (edge === "right" ? clip.length : 0) + (e.key === "ArrowLeft" ? -Q / 4 : Q / 4), timings), c.edit); } }} />)}
                </div>;
              })}
            </div>
          </div>{detailed && inlineEditor?.laneId === lane.id && <div data-clip-inline-editor className="sticky left-0 p-2" style={{ width: Math.min(viewportWidth, 1200) }}>{inlineEditor.content}</div>}</div>;
        })}
        {onAddLane && <div className="sticky left-0 w-fit px-2 pt-2"><AddArrangeTrack language={language} add={addTrack} /></div>}
      </div>
    </div>
    {!shell && structure.toolbar}
    <WorkspacePanel name="inspector">
      {shell && selectedLane && <div className="ws-track-properties"><h3>{selectedTrack?.name}</h3>
        {selectedTrack && instrumentName && <p className="[overflow-wrap:anywhere]">{instrumentName(selectedTrack)}</p>}
      </div>}
      {shell && selectedLane && !selectedClip && laneActions}
      {selectedClip && selectedLane && <div data-clip-properties className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-700 pt-3 text-xs text-slate-400">
      <InspectorName key={JSON.stringify([selectedLane.id, selectedClip.id])} label={labels.clipName} renameLabel={labels.renameClip}
        name={clipDisplayName(selectedLane, selectedClip)} onSave={name => {
          const saved = attempt(() => updateClip(model, selectedLane.id, selectedClip.id, { name, nameIsExplicit: true }, timings), labels.renameClip);
          if (saved) structure.keepSelectionAt(saved.revision);
        }} />
      {shell && selectedOccurrence && namedDefinition?.kind !== "pattern" && <p className="w-full">{namedDefinition?.name} · {selectedPass}</p>}
      {shell && namedDefinition?.kind === "pattern" && nameTarget && <InspectorName key={nameKey}
        label={labels.patternName} renameLabel={labels.renamePattern} name={namedDefinition.name} scope={nameScope} detail={selectedPass}
        chooseScope={(choose, cancel) => <EditScopeDialog language={language} onCancel={cancel}>
          <EditScopeControls language={language} scope={null} relationship={nameRelationship} repeat={selectedClip.mode === "loop"}
            splitWindows={localLoopWindows(selectedLane, selectedClip.id, nameTarget.pass, selectedTiming)} onChoose={choose} />
        </EditScopeDialog>}
        onSave={(name, scope) => structure.guardEdit(nameTarget, target => {
          const renamed = saveInspectorPatternName(target, name, scope);
          if (renamed && selectedOccurrence) {
            const { path, ...focus } = renamed;
            structure.select({ ...focus, parent: path.slice(0, -1) }, path[path.length - 1], false);
          }
        })} />}
      {laneActions}
      {(["start", "length", "offset"] as const).map(field => <label key={`${selectedClip.id}:${field}:${selectedClip[field]}`} className="flex flex-col gap-1">{field === "offset" ? c.offset : c[field]} · {c.beats}
        <input className={clipInput} type="number" step="0.25" min={field === "length" ? .25 : 0} defaultValue={selectedClip[field] / Q} onBlur={e => { const value = Number(e.target.value) * Q; if (value !== selectedClip[field]) attempt(() => updateClip(model, selectedLane.id, selectedClip.id, { [field]: value }, timings), c.edit); }} /></label>)}
      <span className="self-center">{c.content}: {contentLength(selectedLane, selectedClip.children, timings[selectedLane.id]) / Q} {c.beats}</span>
      <select className={clipInput} aria-label={c.loop} value={selectedClip.mode} onChange={e => attempt(() => updateClip(model, selectedLane.id, selectedClip.id, { mode: e.target.value as Clip["mode"] }, timings), c.edit)}><option value="once">{c.once}</option><option value="loop">{c.loop}</option></select>
      <button className={clipButtonClass("edit")} onClick={() => attempt(() => fitClip(model, selectedLane.id, selectedClip.id, timings), c.fit)}>{c.fit}</button>
      <button className={clipButtonClass("remove")} onClick={() => attempt(() => deleteClip(model, selectedLane.id, selectedClip.id, timings), c.remove)}>{c.remove}</button>
      {selectedLane.cycleTicks !== null && <span>{c.localLoop}: {selectedLane.cycleTicks / Q} {c.beats} <button className={clipButtonClass("edit")} onClick={() => attempt(() => convertLaneCycle(model, selectedLane.id, timings), c.convertCycle)}>{c.convertCycle}</button></span>}
      <EditorDetails owner="arranger" field="clipContents" className="w-full" summary={c.content}>{() => <div className="flex flex-wrap gap-2">{selectedClip.children.map(item => <button key={item.id} className={clipButton} onClick={e => selectContent(selectedLane, selectedClip, selectedOccurrence?.pass ?? firstTarget?.pass ?? 0, [], item.id, e.shiftKey)}>{"definitionId" in item ? selectedLane.definitions.find(d => d.id === item.definitionId)?.name : c.rest}</button>)}</div>}</EditorDetails>
    </div>}</WorkspacePanel>
    {shell && structure.toolbar}
    <SectionTools model={model} timings={timings} selectedLane={selectedLane?.id} language={language} onChange={onChange} />
    {!shell && !model.lanes.length && <p className="py-8 text-center text-sm text-slate-500">{c.empty}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{c.error}: {error}</p>}
    <WorkspacePanel name="dialogs">{transposing && model.lanes.some(l=>l.id===transposing.target.laneId&&l.clips.some(cl=>cl.id===transposing.target.clipId)) && <LaneTransposeDialog key={JSON.stringify(transposing.target)} {...transposing} language={language} stopAudition={stopAudition} onClose={()=>setTransposing(null)}/>}</WorkspacePanel>

  </section>;
}

function CompactContent({ songEdits, lane, clip, sequencer, unit, from, to, pass, language, onTranspose, onOpen, onMenu, onSelect, isSelected }: { songEdits: SongPatternEdit[]; onMenu: (path: string[], x: number, y: number) => void; onSelect: (path: string[], shift: boolean) => void; isSelected: (path: string[]) => boolean; onOpen: (path: string[]) => void; lane: ClipLane; clip: Clip; sequencer: SequencerState; unit: number; from: number; to: number; pass: number; language:GuiLanguage; onTranspose:(target:OccurrenceTarget,trigger:HTMLButtonElement)=>void }) {
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
    const itemPath = [...path, item.id];
    const preview = previewPattern(songEdits, { laneId: lane.id, clipId: clip.id, pass, path: itemPath }, def);
    return [<div key={`${item.id}:${left}`} className={`absolute top-0 overflow-hidden ${isSelected(itemPath) ? "ring-2 ring-inset ring-cyan-300" : ""}`}
      onClick={event => { event.stopPropagation(); onSelect(itemPath, event.shiftKey); }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu(itemPath, event.clientX, event.clientY); }} style={{ left, width: duration * unit }}
      onDoubleClick={event => { event.stopPropagation(); onOpen([...path, item.id]); }}>
      <div style={{ width: preview === def ? undefined : patternDuration(preview, timing) * unit }}><PatternPreview definition={preview} offset={offset} timing={timing} controllerMode={sequencer.controllerSequencers.find(t => t.id === lane.id)?.controllerMode} /></div>
      {visibleWidth > 0 && (clip.children.length > 1 || clip.length > duration || clipDisplayName(lane, clip) !== def.name) && <span className="pointer-events-none absolute bottom-0 truncate rounded bg-slate-950/80 px-1 text-[10px] leading-tight text-slate-100" style={{ left: visibleLeft, maxWidth: visibleWidth }} title={def.name}>{def.name}</span>}
      {['sequencer','score','arpeggiator'].includes(lane.source) && visibleWidth>0 && <div className="pointer-events-none absolute top-0 flex justify-end" style={{left:visibleLeft,width:visibleWidth}}><LaneTransposeBadge compact target={{laneId:lane.id,clipId:clip.id,path:[...path,item.id],pass}} name={def.name} index={logicalRepeatIndex(lane,clip,[...path,item.id],pass)} offset={offset} width={visibleWidth} language={language} onOpen={onTranspose}/></div>}
    </div>];
  });
  return <>{render(clip.children)}</>;
}
