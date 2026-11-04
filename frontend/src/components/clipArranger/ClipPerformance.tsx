import { AutomationDuration, AutomationMergeDialog } from "./AutomationControls";
import { automationCopy } from "./automationCopy";
import { ControllerSequencerCurveEditor } from "../sequencer/ControllerSequencerCurveEditor";
import { SEQUENCER_UI_COPY } from "../sequencer/sequencerUiCopy";
import { DraftResolutionDialog } from "./DraftResolutionDialog";
import { hasChangedClipDrafts } from "../../lib/clipArranger/draftResolution";
import { occurrenceNames } from "../../lib/clipArranger/operations";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import { draftKey } from "../../lib/clipArranger/editorAdapter";
import { usePerformanceAudition } from "../sequencer/PerformanceAudition";
import { ClipEditingContext } from "./context";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mergedSequencerState } from "../../lib/mergedSequencerState";
import type { GuiLanguage, SequencerState } from "../../types";
import type { ClipArrangement, SourceKind } from "../../lib/clipArranger/model";
import { contentLength, resolveContent, patternDuration } from "../../lib/clipArranger/model";
import { clipEditorPlaybackView } from "../../lib/clipArranger/editorAdapter";
import { useAppStore } from "../../store/useAppStore";
import { clipHistoryStep, commitClipArrangement, openClipEditor, saveClipDraft, removeClipLane } from "../../store/clipActions";
import { ClipArranger, clipButton } from "./ClipArranger";
import { useStructureEditor } from "./StructureEditor";
import { usePerformanceEditorState } from "../sequencer/PerformanceEditorState";
import { beginStructure, structureChildren } from "../../lib/clipArranger/structure";
import { structureAuditionDraft } from "../../lib/clipArranger/structureAudition";
import { structureCopy } from "./structureCopy";
import { ContentEditor } from "./ContentEditor";
import { InlineCurve } from "./InlineCurve";
import { SaveScopeDialog } from "./SaveScopeDialog";
import { clipCopy } from "./copy";


const emptyArrangement: ClipArrangement = {version:1,revision:0,end:20160,lanes:[]};
export const CLIP_ARRANGER_ENABLED = import.meta.env.VITE_CLIP_ARRANGER === "1";

export function ClipPerformance({ language, renderEditor, transport, laneControls, onAddLane, position, onSeek, onLoopChange }: {
  language: GuiLanguage; renderEditor: (kind: SourceKind, id: string, state: SequencerState) => ReactNode;
  position?: number; onSeek?: (step: number) => void; onLoopChange?: (range: { startStep: number; endStep: number } | null) => void;
  transport?: ReactNode; laneControls?: (id: string) => ReactNode; onAddLane?: (source: SourceKind) => void;
}) {
  const sequencer = useAppStore(s => s.sequencer), drafts = useAppStore(s => s.clipDrafts), key = useAppStore(s => s.clipEditingKey);
  const model=sequencer.clipArrangement??emptyArrangement;
  const [zoom,setZoom]=usePerformanceEditorState("arranger","clipZoom",40);
  const timings=useMemo(()=>arrangementTimings(sequencer),[sequencer]);
  const runtime = useAppStore(s => s.sequencerRuntime);
  const auditionDraft = useAppStore(s => s.clipAuditionDraft);
  // Editors need audible runtime markers, while arrangement edits retain authored state.
  const playback = useMemo(() => mergedSequencerState(sequencer, runtime), [sequencer, runtime]);
  const audition = usePerformanceAudition();
  const auditionRef = useRef(audition); auditionRef.current = audition;
  const statuses = useAppStore(s => s.performanceAuditions);
  const songPosition = useAppStore(s => s.sequencerRuntime.arrangerTransportSubunit);
  const active = useRef<{ id: string; gesture: string; key: string; last: unknown } | null>(null);
  const [auditioning, setAuditioning] = useState(false);
  const stopEdit = async () => {
    const previous = active.current; active.current = null; setAuditioning(false);
    if (previous) await audition?.(previous.id, { action: "workspace_end", gestureId: previous.gesture });
    useAppStore.setState({ clipAuditionDraft: null });
  };
  const structure=useStructureEditor(model,sequencer,timings,language,stopEdit,zoom/20160);
  useEffect(() => () => {
    const previous = active.current;
    if (previous) void auditionRef.current?.(previous.id, { action: "workspace_end", gestureId: previous.gesture });
    useAppStore.setState({ clipAuditionDraft: null });
  }, []);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const current = active.current;
    const editing = current ? drafts[current.key] : undefined;
    if (!auditioning || !current || !editing || editing.definition.kind !== "pattern" || current.last === editing) return;
    const timer = setTimeout(() => {
      if (active.current !== current) return;
      current.last = editing;
      useAppStore.setState({ clipAuditionDraft: editing });
      void audition?.(current.id, { action: "workspace_start", gestureId: current.gesture, clipDraft: editing }).catch(e => setError(String(e)));
    }, 80);
    return () => clearTimeout(timer);
  }, [drafts, auditioning, audition]);
  const draft = key ? drafts[key] : undefined, c = clipCopy(language), t=structureCopy(language);
  const containerRoots=useMemo(()=>{
    if(!draft||draft.definition.kind==='pattern'||!model.lanes.find(l=>l.id===draft.target.laneId)?.clips.some(c=>c.id===draft.target.clipId))return null;
    const structural=structure.draft;
    return structural&&structural.laneId===draft.target.laneId&&structural.clipId===draft.target.clipId&&structural.pass===draft.target.pass?structural.roots:beginStructure(model,draft.target.laneId,draft.target.clipId,draft.target.pass).roots;
  },[model,draft,structure.draft]);
  let container:import('../../lib/clipArranger/structure').StructureNode|undefined;
  if(containerRoots&&draft)try{container=structureChildren(containerRoots,draft.target.path.slice(0,-1)).find(n=>n.id===draft.target.path[draft.target.path.length-1]);}catch{/* Empty containers disappear from the draft. */}
  if (!sequencer.clipArrangement) return null;
  const lane = model.lanes.find(l => l.id === draft?.target.laneId);
  const curve = draft?.definition.kind === "pattern" && draft.definition.source === "controller" ? clipEditorPlaybackView(playback, draft, auditionDraft).controllerSequencers.find(t => t.id === lane?.id && t.controllerMode === "curve") : undefined;
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
  if (lane && draft) {
    const name = sequencer[sourceKeys[lane.source]].find(t => t.id === lane.id)?.name ?? lane.id;
    try { breadcrumb = [name, selectedClip?.name, ...occurrenceNames(lane, draft.target)].join(" / "); }
    catch { breadcrumb = `${name} / ${draft.definition.name}`; }
  }
  const attempt = (action: () => void) => { try { action(); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return <>
    <DraftResolutionDialog language={language} />
    <AutomationMergeDialog language={language} />
    <ClipArranger structure={structure} zoom={zoom} setZoom={setZoom} editingTarget={draft?.target} language={language} model={model} sequencer={sequencer} onChange={commitClipArrangement} onEdit={target => attempt(() => openClipEditor(target))} laneControls={id => <>{laneControls?.(id)}{active.current?.id === id && <span title={statuses[id]?.workspace_queued ? c.auditionQueued : c.auditioning} aria-label={statuses[id]?.workspace_queued ? c.auditionQueued : c.auditioning} className="text-cyan-300">{statuses[id]?.workspace_queued ? "◷" : "▶"}</span>}</>} onAddLane={onAddLane} onRemoveLane={id => { void (active.current?.id === id ? stopEdit() : Promise.resolve()).then(() => attempt(() => removeClipLane(id))).catch(e => setError(String(e))); }} position={songPosition ?? position} onSeek={onSeek} onLoopChange={onLoopChange}
      renderAutomation={(target, range) => {
        if (!curve?.automationTarget || !draft || !lane || draftKey({ target }) !== draftKey(draft) || draft.definition.kind !== "pattern") return null;
        const original = lane.definitions.find(d => d.id === draft.definition.id);
        const ratio = original?.kind === "pattern" ? patternDuration(original, timings[lane.id]) / patternDuration(draft.definition, timings[lane.id]) : 1;
        const from = range[0] * ratio, to = Math.min(1, range[1] * ratio);
        // A duration draft stretches its points inside the saved occurrence window.
        // Shorter drafts leave silence; longer ones are cropped until Save changes content.
        if (from >= to) return <div />;
        return <div style={{ width: `${(to - from) / ((range[1] - range[0]) * ratio) * 100}%` }}><ControllerSequencerCurveEditor
        controllerSequencer={curve} ui={SEQUENCER_UI_COPY[language]} height={72} showHint={false} visibleRange={[from, to]}
        playbackTransport={curvePlaying ? { transportSubunit: runtime.transportSubunit, transportSubunitDurationMs: 60000 / sequencer.timing.tempoBPM / 20160 } : null}
        onAddPoint={(p, v) => useAppStore.getState().addControllerSequencerKeypoint(curve.id, p, v)}
        onPointChange={(id, p, v) => useAppStore.getState().setControllerSequencerKeypoint(curve.id, id, p, v)}
        onPointRemove={id => useAppStore.getState().removeControllerSequencerKeypoint(curve.id, id)} /></div>;
      }}
      inlineEditor={curve && !curve.automationTarget ? { laneId: curve.id, content: <InlineCurve track={curve} language={language} window={curveWindow} /> } : undefined}
      transport={<>{transport}<button className={clipButton} disabled={!sequencer.clipHistory?.cursor} onClick={() => attempt(() => clipHistoryStep(false))}>{c.undo}</button><button className={clipButton} disabled={!sequencer.clipHistory || sequencer.clipHistory.cursor >= sequencer.clipHistory.entries.length} onClick={() => attempt(() => clipHistoryStep(true))}>{c.redo}</button></>} />
    {draft && lane ? <section className="mt-2 rounded-xl border border-cyan-800 bg-slate-950/80 p-3" aria-label={c.path}>
      <header className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="mr-auto text-cyan-100">{breadcrumb}</span>
        {active.current && <span role="status" className="text-cyan-200">{statuses[active.current.id]?.workspace_queued ? c.auditionQueued : c.auditioning}</span>}
        <span className="text-amber-200">{(draft.definition.kind==="pattern"?hasChangedClipDrafts(model,{current:draft}):!!structure.draft?.cursor)?c.unsaved:c.saved}</span>
        <button className={clipButton} disabled={!auditioning&&draft.definition.kind!=="pattern"&&!container} onClick={() => { void (async () => {
          if (auditioning) { await stopEdit(); return; }
          const gesture = crypto.randomUUID();
          let played=draft;
          if(draft.definition.kind!=="pattern"&&structure.draft){
            played=structureAuditionDraft(model,structure.draft,draft.target,timings);
          }
          useAppStore.setState({ clipAuditionDraft: played });
          active.current = { id: lane.id, gesture, key: draftKey(draft), last: draft };
          try { await audition?.(lane.id, { action: "workspace_start", gestureId: gesture, clipDraft: played }); if (active.current?.gesture === gesture) setAuditioning(true); }
          catch (e) { active.current = null; useAppStore.setState({ clipAuditionDraft: null }); setError(String(e)); }
        })(); }}>{auditioning ? c.stop : c.play}</button><button className={clipButton} disabled={draft.definition.kind!=="pattern"&&!structure.draft?.cursor} onClick={() => draft.definition.kind==="pattern"?setSaving(true):structure.openSave()}>{draft.definition.kind==="pattern"?c.save:t.save}</button><button className={clipButton} onClick={() => { void stopEdit(); useAppStore.setState({ clipEditingKey: null }); }}>{c.close}</button>
      </header>
      <AutomationDuration language={language} />
      {curve?.automationTarget && <button className={`${clipButton} mb-2`} onClick={() => { void stopEdit().then(() => { const state = useAppStore.getState(); const remaining = { ...state.clipDrafts }; if (key) delete remaining[key]; useAppStore.setState({ clipDrafts: remaining, clipEditingKey: null }); }); }}>{automationCopy(language).discard}</button>}
      <p className="mb-2 text-[10px] text-slate-500">{c.laneSettings}</p>
      {draft.definition.kind === "pattern" ? <ClipEditingContext.Provider value>{renderEditor(draft.definition.source, lane.id, clipEditorPlaybackView(playback, draft, auditionDraft))}</ClipEditingContext.Provider>
        : container?.children ? <ContentEditor lane={lane} nodes={container.children} path={draft.target.path} name={container.definition!.name} level={draft.definition.kind} sequencer={sequencer} language={language} onCommand={command=>structure.run(command,{laneId:lane.id,clipId:draft.target.clipId,pass:draft.target.pass,parent:draft.target.path})}/> : <p>{t.containerRemoved}</p>}


    </section> : <p className="px-3 py-2 text-xs text-slate-500">{c.select}</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {saving && draft && lane && <SaveScopeDialog draft={draft} lane={lane} language={language} timing={arrangementTimings(sequencer)[lane.id]} onCancel={() => setSaving(false)} onSave={(scope, name) => { void stopEdit().then(() => attempt(() => { saveClipDraft(scope, name); setSaving(false); })).catch(e => setError(String(e))); }} />}
  </>;
}
