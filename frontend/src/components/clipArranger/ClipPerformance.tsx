import { PatternEditor, PatternSettings } from "../sequencer/PatternEditor";
import { WorkspaceDialog } from "../sequencer/WorkspaceDialog";
import { transposeCopy } from "./transposeCopy";
import { WorkspacePanel, WorkspacePanels } from "../sequencer/WorkspacePanels";
import { effectiveScope, localLoopWindows, uniqueVariationName } from "../../lib/clipArranger/relationships";
import { arrangeCopy, arrangeSaveLabel } from "./arrangeCopy";
import { EditScopeControls } from "./EditScopeControls";
import { scopeCopy } from "../../lib/clipArranger/scopeCopy";
import { TransposeInspector } from "./TransposeInspector";
import { AutomationDuration, AutomationMergeDialog } from "./AutomationControls";
import { ControllerSequencerCurveEditor } from "../sequencer/ControllerSequencerCurveEditor";
import { SEQUENCER_UI_COPY } from "../sequencer/sequencerUiCopy";
import { hasChangedClipDrafts } from "../../lib/clipArranger/draftResolution";
import { clipDisplayName, occurrenceNames } from "../../lib/clipArranger/operations";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import { draftKey } from "../../lib/clipArranger/editorAdapter";
import { usePerformanceAudition } from "../sequencer/PerformanceAudition";
import { ClipEditingContext } from "./context";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mergedSequencerState } from "../../lib/mergedSequencerState";
import type { GuiLanguage, HelpDocId, SequencerState } from "../../types";
import type { ClipArrangement, DefinitionDraft, SourceKind } from "../../lib/clipArranger/model";
import { contentLength, resolveContent, patternDuration, QUARTER_TICKS } from "../../lib/clipArranger/model";
import { clipEditorPlaybackView } from "../../lib/clipArranger/editorAdapter";
import { useAppStore } from "../../store/useAppStore";
import { clipHistoryStep, commitClipArrangement, discardClipDraft, renameClipPattern, openClipEditor, saveClipDraftWithIntent, setClipEditIntent, removeClipLane } from "../../store/clipActions";
import { ClipArranger, type ClipArrangerProps } from "./ClipArranger";
import { clipButton, clipButtonClass } from "./buttonStyles";
import { useStructureEditor } from "./StructureEditor";
import { ClipEditorTargetContext, EditorDetails, usePerformanceEditorState } from "../sequencer/PerformanceEditorState";
import { beginStructure, structureChildren } from "../../lib/clipArranger/structure";
import { structureAuditionDraft } from "../../lib/clipArranger/structureAudition";
import { structureCopy } from "./structureCopy";
import { ContentEditor } from "./ContentEditor";
import { InlineCurve } from "./InlineCurve";
import { songPatternEdits } from "../../lib/clipArranger/songDrafts";
import { clipCopy } from "./copy";


const emptyArrangement: ClipArrangement = {version:1,revision:0,end:20160,lanes:[]};

export function ClipPerformance({ language, instrumentName, renderEditor, transport, laneControls, onAddLane, position, onSeek, onLoopChange, onHelpRequest }: {
  onHelpRequest?: (id: HelpDocId) => void;
  instrumentName?: ClipArrangerProps["instrumentName"];
  language: GuiLanguage; renderEditor: (kind: SourceKind, id: string, state: SequencerState) => ReactNode;
  position?: number; onSeek?: (step: number) => void; onLoopChange?: (range: { startStep: number; endStep: number } | null) => void;
  transport?: ReactNode; laneControls?: (id: string) => ReactNode; onAddLane?: ClipArrangerProps["onAddLane"];
}) {
  const sequencer = useAppStore(s => s.sequencer), drafts = useAppStore(s => s.clipDrafts), key = useAppStore(s => s.clipEditingKey);
  const songEdits = useMemo(() => songPatternEdits(sequencer, drafts), [sequencer, drafts]);
  const shell = useContext(WorkspacePanels);
  const model=sequencer.clipArrangement??emptyArrangement;
  const [zoomSetting, setZoom] = usePerformanceEditorState<number | null>("arranger", "clipZoom", 40);
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1200);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => { if (node.clientWidth > 0) setViewportWidth(node.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const laneHeaderWidth = Math.min(192, Math.floor(viewportWidth * .45));
  const songBeats = model.end / QUARTER_TICKS;
  const minZoom = Math.min(12, Math.max(1, viewportWidth - laneHeaderWidth - 2) / (songBeats + 4));
  const zoom = Math.max(minZoom, zoomSetting ?? minZoom);
  const timings=useMemo(()=>arrangementTimings(sequencer),[sequencer]);
  const runtime = useAppStore(s => s.sequencerRuntime);
  const auditionDraft = useAppStore(s => s.clipAuditionDraft);
  // Editors need audible runtime markers, while arrangement edits retain authored state.
  const playback = useMemo(() => mergedSequencerState(sequencer, runtime), [sequencer, runtime]);
  const audition = usePerformanceAudition();
  const auditionRef = useRef(audition); auditionRef.current = audition;
  const statuses = useAppStore(s => s.performanceAuditions);
  const songPosition = useAppStore(s => s.sequencerRuntime.arrangerTransportSubunit);
  const active = useRef<{ id: string; gesture: string; key: string; last: DefinitionDraft } | null>(null);
  const [auditioning, setAuditioning] = useState(false);
  const stopEdit = async () => {
    const previous = active.current; active.current = null; setAuditioning(false);
    if (!previous) return;
    const owned = useAppStore.getState().clipAuditionDraft;
    await audition?.(previous.id, { action: "workspace_end", gestureId: previous.gesture });
    if (!active.current && owned && useAppStore.getState().clipAuditionDraft === owned) useAppStore.setState({ clipAuditionDraft: null });
  };
  useEffect(() => {
    if (active.current && (shell || active.current.last.provisionalDuplicate) && active.current.key !== key) void stopEdit().catch(e => setError(String(e)));
  }, [key]);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const structure=useStructureEditor(model,sequencer,timings,language,stopEdit,zoom/QUARTER_TICKS,target => {
    openClipEditor(target);
    shell?.revealEditor();
    setRenameKey(draftKey({target}));
  });
  useEffect(() => () => {
    const previous = active.current;
    if (!previous) return;
    active.current = null;
    void auditionRef.current?.(previous.id, { action: "workspace_end", gestureId: previous.gesture });
    useAppStore.setState({ clipAuditionDraft: null });
  }, []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const current = active.current;
    const editing = current ? drafts[current.key] : undefined;
    if (!auditioning || !current || !editing || editing.definition.kind !== "pattern" || current.last === editing) return;
    const previous = current.last;
    if (JSON.stringify(previous.definition) === JSON.stringify(editing.definition)) return;
    const snapshot = { ...editing, transposeEdits: previous.transposeEdits };
    const timer = setTimeout(() => {
      if (active.current !== current) return;
      current.last = snapshot;
      useAppStore.setState({ clipAuditionDraft: snapshot });
      void audition?.(current.id, { action: "workspace_start", gestureId: current.gesture, clipDraft: snapshot }).catch(e => setError(String(e)));
    }, 80);
    return () => clearTimeout(timer);
  }, [drafts, auditioning, audition]);
  const draft = key ? drafts[key] : undefined, c = clipCopy(language), t=structureCopy(language), sc=scopeCopy(language);
  const relationships=structure.relationships;
  const relationship=draft?relationships.get(draft.target.laneId)?.get(draft.definition.id):undefined;
  const scope=draft?(draft.definition.kind==='pattern'?effectiveScope(draft.editIntent,relationship):structure.draft?.editIntent?.scope??null):null;
  const focusPatternName = () => {
    if (!nameInput.current) return;
    nameInput.current.focus();
    nameInput.current.select();
    setRenameKey(null);
  };
  useLayoutEffect(() => {
    if (!renameKey) return;
    if (renameKey !== key) { setRenameKey(null); return; }
    if (!shell && scope) focusPatternName();
  });
  const dirty=!!draft&&hasChangedClipDrafts(model,{current:draft});
  const [closing, setClosing] = useState<{ key: string; finish: () => void } | null>(null);
  const [closingError, setClosingError] = useState("");
  const requestClose = (finish: () => void) => {
    if (key && draft?.definition.kind === "pattern" && dirty) {
      setClosingError("");
      setClosing({ key, finish });
    } else if (active.current) void stopEdit().then(finish).catch(e => setError(String(e)));
    else finish();
  };
  useLayoutEffect(() => {
    if (!shell) return;
    shell.patternClose.current = requestClose;
    return () => { shell.patternClose.current = null; };
  });
  const resolveClose = async (targetKey: string, action: "save" | "discard", finish?: () => void) => {
    try {
      await stopEdit();
      if (useAppStore.getState().clipEditingKey !== targetKey) return;
      if (action === "save") saveClipDraftWithIntent(targetKey);
      else discardClipDraft(targetKey);
      setClosing(null);
      finish?.();
    } catch (e) { setClosingError(String(e)); setError(String(e)); }
  };
  const containerRoots=useMemo(()=>{
    if(!draft||draft.definition.kind==='pattern'||!model.lanes.find(l=>l.id===draft.target.laneId)?.clips.some(c=>c.id===draft.target.clipId))return null;
    const structural=structure.draft;
    return structural&&structural.laneId===draft.target.laneId&&structural.clipId===draft.target.clipId&&structural.pass===draft.target.pass?structural.roots:beginStructure(model,draft.target.laneId,draft.target.clipId,draft.target.pass).roots;
  },[model,draft,structure.draft]);
  let container:import('../../lib/clipArranger/structure').StructureNode|undefined;
  if(containerRoots&&draft)try{container=structureChildren(containerRoots,draft.target.path.slice(0,-1)).find(n=>n.id===draft.target.path[draft.target.path.length-1]);}catch{/* Empty containers disappear from the draft. */}
  if (!sequencer.clipArrangement) return null;
  const lane = model.lanes.find(l => l.id === draft?.target.laneId);
  const curve = scope && draft?.definition.kind === "pattern" && draft.definition.source === "controller" ? clipEditorPlaybackView(playback, draft, auditionDraft, songEdits).controllerSequencers.find(t => t.id === lane?.id && t.controllerMode === "curve") : undefined;
  const selectedClip = lane?.clips.find(cl => cl.id === draft?.target.clipId);
  let curveWindow: [number, number] = [0, 1];
  let curvePlaying = auditioning && !!lane && !!statuses[lane.id]?.workspace_active;
  if (curve && draft && lane && selectedClip && draft.definition.kind === "pattern") {
    const timing = arrangementTimings(sequencer)[lane.id];
    const leaf = resolveContent(lane, selectedClip.children, timing).find(l => JSON.stringify(l.path) === JSON.stringify(draft.target.path));
    if (leaf) {
      const origin = selectedClip.start - selectedClip.offset + draft.target.pass * contentLength(lane, selectedClip.children, timing) + leaf.start;
      const length = patternDuration(draft.definition, timing);
      curvePlaying ||= runtime.isPlaying && !!runtime.arrangerActive && curve.enabled && (songPosition ?? 0) >= Math.max(selectedClip.start, origin) && (songPosition ?? 0) < Math.min(selectedClip.start + selectedClip.length, origin + length);
      curveWindow = [Math.max(0, (selectedClip.start - origin) / length), Math.min(1, (selectedClip.start + selectedClip.length - origin) / length)];
      if (curveWindow[1] <= curveWindow[0]) curveWindow = [0, 1];
    }
  }
  let breadcrumb = "";
  const passLabel = shell && draft && selectedClip?.mode === "loop" ? `${arrangeCopy(language).pass} ${(selectedClip.repeatIndexBase ?? 0) + draft.target.pass + 1}` : "";
  if (lane && draft) {
    const name = sequencer[sourceKeys[lane.source]].find(t => t.id === lane.id)?.name ?? lane.id;
    try {
      const names = occurrenceNames(lane, draft.target);
      const clipTitle = selectedClip && clipDisplayName(lane, selectedClip);
      breadcrumb = [name, ...(clipTitle && clipTitle !== names[0] ? [clipTitle] : []), ...names, ...(passLabel ? [passLabel] : [])].join(" / ");
    }
    catch { breadcrumb = `${name} / ${draft.definition.name}`; }
  }
  const separatePattern = draft?.definition.kind === "pattern" && !draft.provisionalDuplicate;
  const previewSaveLabel = separatePattern ? arrangeSaveLabel(language, "pattern", scope, relationship) : structure.saveLabel;
  const attempt = (action: () => void) => { try { action(); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const renderPanel = () => {
    if (!draft || !lane) return !shell && <p className="px-3 py-2 text-xs text-slate-500">{c.select}</p>;
    const actions = <>
      {active.current && <span role="status" className="text-cyan-200">{statuses[active.current.id]?.workspace_queued ? c.auditionQueued : c.auditioning}</span>}
      <span className="text-amber-200">{(separatePattern ? dirty : structure.draft?.cursor) ? c.unsaved : c.saved}</span>
      <button className={clipButtonClass(active.current ? "edit" : "add")} disabled={!active.current && (!scope || (draft.definition.kind!=="pattern"&&!container))} onClick={() => { void (async () => {
        if (active.current) { await stopEdit(); return; }
        const gesture = crypto.randomUUID();
        let played=draft;
        if(draft.definition.kind!=="pattern"&&structure.draft){
          played=structureAuditionDraft(model,structure.draft,draft.target,timings);
        }
        active.current = { id: lane.id, gesture, key: draftKey(draft), last: draft };
        useAppStore.setState({ clipAuditionDraft: played });
        try { await audition?.(lane.id, { action: "workspace_start", gestureId: gesture, clipDraft: played }); if (active.current?.gesture === gesture) setAuditioning(true); }
        catch (e) { if (active.current?.gesture === gesture) { active.current = null; useAppStore.setState({ clipAuditionDraft: null }); setError(String(e)); } }
      })(); }}>{active.current ? c.stop : c.play}</button>
      <button className={clipButtonClass("save")} disabled={separatePattern ? !scope || !dirty : !structure.canSave} onClick={() => {
        if (separatePattern) void stopEdit().then(() => attempt(() => saveClipDraftWithIntent(key ?? undefined))).catch(e => setError(String(e)));
        else structure.openSave();
      }}>{shell ? previewSaveLabel : separatePattern ? scope === 'local' ? sc.saveLocal : relationship?.shared ? `${sc.saveAll} (${relationship.occurrences})` : c.save : structure.draft?.editIntent?.scope === 'all' ? sc.saveStructureAll : sc.saveStructureLocal}</button>
      {draft.provisionalDuplicate && <button className={clipButtonClass("remove")} onClick={structure.discard}>{t.discard}</button>}
      {key && separatePattern && <button className={clipButtonClass("remove")} onClick={() => void resolveClose(key, "discard")}>{arrangeCopy(language).cancelEdits}</button>}
      {!shell && <button className={clipButton} onClick={() => requestClose(() => useAppStore.setState({ clipEditingKey: null }))}>{c.close}</button>}
    </>;
    const chooseScope = draft.provisionalDuplicate ? null : draft.definition.kind === 'pattern' ? <EditScopeControls key={key} language={language} scope={scope} relationship={relationship} repeat={selectedClip?.mode==='loop'} splitWindows={localLoopWindows(lane,draft.target.clipId,draft.target.pass,timings[lane.id])}
        variationName={draft.editIntent?.variationName ?? uniqueVariationName(lane, draft.definition.name, sc.variationSuffix)}
        onChoose={next => structure.guardPattern(draft.target, next, ready =>
          setClipEditIntent(next, draft.editIntent?.variationName ?? uniqueVariationName(lane, draft.definition.name, sc.variationSuffix), draftKey({ target: ready })))}
        patternName={draft.definition.name} nameInputRef={nameInput} onNameChange={renameClipPattern} /> : structure.scopeControls;
    const settings = <>
      {!draft.provisionalDuplicate && (shell ? ["sequencer", "score", "arpeggiator"].includes(lane.source) && <EditorDetails owner={`device:${lane.id}`} field="clipTranspose" className="mb-2 text-xs" summary={transposeCopy(language).title}>
        {() => <TransposeInspector key={key} language={language} stopAudition={stopEdit} />}
      </EditorDetails> : <TransposeInspector key={key} language={language} stopAudition={stopEdit} />)}
      <AutomationDuration language={language} />
      <p className="mb-2 text-[10px] text-slate-500">{c.laneSettings}</p>
    </>;
    const surface = !scope ? null : <>
      {draft.definition.kind === "pattern" ? <ClipEditorTargetContext.Provider key={shell ? key : undefined} value={shell ? key : null}><ClipEditingContext.Provider value>{renderEditor(draft.definition.source, lane.id, clipEditorPlaybackView(playback, draft, auditionDraft, songEdits))}</ClipEditingContext.Provider></ClipEditorTargetContext.Provider>
        : container?.children ? <ContentEditor showName={scope!=='local'} lane={lane} nodes={container.children} path={draft.target.path} name={container.definition!.name} level={draft.definition.kind} sequencer={sequencer} language={language} onCommand={command=>structure.run(command,{laneId:lane.id,clipId:draft.target.clipId,pass:draft.target.pass,parent:draft.target.path})}/> : <p>{t.containerRemoved}</p>}
    </>;
    if (!shell) return <section className="mt-2 rounded-xl border border-cyan-800 bg-slate-950/80 p-3" aria-label={c.path}>
      <header className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="mr-auto text-cyan-100">{breadcrumb}</span>{actions}</header>
      {chooseScope}{scope && <>{settings}{surface}</>}
    </section>;
    const pattern = draft.definition.kind === "pattern";
    const scopeLabel = scope === "local" ? sc.editingLocal : relationship?.shared ? `${sc.linked} (${relationship.occurrences})` : sc.independent;
    return <PatternEditor key={key} language={language} title={breadcrumb} label={c.path} actions={actions}
      owner={`device:${lane.id}`} scrollField={`clipDock:${key}`} hasSettings={!!scope}
      onRevealSettings={scope && renameKey !== null && renameKey === key ? focusPatternName : undefined} scopeLabel={pattern && scope ? scopeLabel : undefined}>
      {pattern && scope ? <PatternSettings>{chooseScope}</PatternSettings> : chooseScope}
      {scope && <><PatternSettings>{settings}</PatternSettings>{surface}</>}
    </PatternEditor>;
  };
  return <>
    <WorkspacePanel name="dialogs">{closing && closing.key === key && <WorkspaceDialog title={arrangeCopy(language).closeQuestion} onClose={() => setClosing(null)}>
      <p className="mb-3">{draft?.definition.name}</p>
      {closingError && <p role="alert" className="text-rose-300">{closingError}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={clipButtonClass("save")} disabled={!scope} onClick={() => void resolveClose(closing.key, "save", closing.finish)}>{previewSaveLabel}</button>
        <button className={clipButtonClass("remove")} onClick={() => void resolveClose(closing.key, "discard", closing.finish)}>{arrangeCopy(language).discardEdits}</button>
        <button className={clipButton} onClick={() => setClosing(null)}>{arrangeCopy(language).keepEditing}</button>
      </div>
    </WorkspaceDialog>}<AutomationMergeDialog language={language} /></WorkspacePanel>
    {shell && active.current && draft && <WorkspacePanel name="editorCommand">
      <button type="button" className="ws-stop-edit" title={breadcrumb} aria-label={`${c.stop} · ${breadcrumb}`}
        onClick={() => { void stopEdit().catch(e => setError(String(e))); }}>
        {c.stop} · {lane && selectedClip ? clipDisplayName(lane, selectedClip) : draft.definition.name}{passLabel && ` · ${passLabel}`}
      </button>
    </WorkspacePanel>}
    <ClipArranger songEdits={songEdits} requestClose={requestClose} instrumentName={instrumentName} onHelpRequest={onHelpRequest} stopAudition={stopEdit} structure={structure} zoom={zoom} minZoom={minZoom} setZoom={setZoom} viewport={viewport} viewportWidth={viewportWidth} laneHeaderWidth={laneHeaderWidth} editingTarget={draft?.target} language={language} model={model} sequencer={sequencer} onChange={commitClipArrangement} onEdit={(target, intent) => attempt(() => openClipEditor(target, intent))} laneControls={id => <>{laneControls?.(id)}{active.current?.id === id && <span title={statuses[id]?.workspace_queued ? c.auditionQueued : c.auditioning} aria-label={statuses[id]?.workspace_queued ? c.auditionQueued : c.auditioning} className="text-cyan-300">{statuses[id]?.workspace_queued ? "◷" : "▶"}</span>}</>} onAddLane={onAddLane} onRemoveLane={id => { void (active.current?.id === id ? stopEdit() : Promise.resolve()).then(() => attempt(() => removeClipLane(id))).catch(e => setError(String(e))); }} position={songPosition ?? position} onSeek={onSeek} onLoopChange={onLoopChange}
      renderAutomation={(target, range) => {
        if (!curve?.automationTarget || !draft || !lane || draftKey({ target }) !== draftKey(draft) || draft.definition.kind !== "pattern") return null;
        return <ControllerSequencerCurveEditor
        controllerSequencer={curve} ui={SEQUENCER_UI_COPY[language]} height={72} showHint={false} visibleRange={range}
        playbackTransport={curvePlaying ? { transportSubunit: runtime.transportSubunit, transportSubunitDurationMs: 60000 / sequencer.timing.tempoBPM / 20160 } : null}
        onAddPoint={(p, v) => useAppStore.getState().addControllerSequencerKeypoint(curve.id, p, v)}
        onPointChange={(id, p, v) => useAppStore.getState().setControllerSequencerKeypoint(curve.id, id, p, v)}
        onPointRemove={id => useAppStore.getState().removeControllerSequencerKeypoint(curve.id, id)} />;
      }}
      inlineEditor={curve && !curve.automationTarget ? { laneId: curve.id, content: <InlineCurve track={curve} language={language} window={curveWindow} /> } : undefined}
      transport={<>{transport}<button className={clipButtonClass("edit")} disabled={!sequencer.clipHistory?.cursor} onClick={() => attempt(() => clipHistoryStep(false))}>{c.undo}</button><button className={clipButtonClass("edit")} disabled={!sequencer.clipHistory || sequencer.clipHistory.cursor >= sequencer.clipHistory.entries.length} onClick={() => attempt(() => clipHistoryStep(true))}>{c.redo}</button></>} />
    <WorkspacePanel name="editor">{renderPanel()}</WorkspacePanel>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}

  </>;
}
