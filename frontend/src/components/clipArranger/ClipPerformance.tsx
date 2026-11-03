import { DraftResolutionDialog } from "./DraftResolutionDialog";
import { hasChangedClipDrafts } from "../../lib/clipArranger/draftResolution";
import { occurrenceNames } from "../../lib/clipArranger/operations";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import { draftKey } from "../../lib/clipArranger/editorAdapter";
import { usePerformanceAudition } from "../sequencer/PerformanceAudition";
import { ClipEditingContext } from "./context";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GuiLanguage, SequencerState } from "../../types";
import type { SourceKind } from "../../lib/clipArranger/model";
import { contentLength, resolveContent, localBeatTicks } from "../../lib/clipArranger/model";
import { clipEditorView } from "../../lib/clipArranger/editorAdapter";
import { useAppStore } from "../../store/useAppStore";
import { clipHistoryStep, commitClipArrangement, openClipEditor, saveClipDraft, updateClipDraft, removeClipLane } from "../../store/clipActions";
import { ClipArranger, clipButton } from "./ClipArranger";
import { ContentEditor } from "./ContentEditor";
import { InlineCurve } from "./InlineCurve";
import { SaveScopeDialog } from "./SaveScopeDialog";
import { clipCopy } from "./copy";


export const CLIP_ARRANGER_ENABLED = import.meta.env.VITE_CLIP_ARRANGER === "1";

export function ClipPerformance({ language, renderEditor, transport, laneControls, onAddLane, position, onSeek, onLoopChange }: {
  language: GuiLanguage; renderEditor: (kind: SourceKind, id: string, state: SequencerState) => ReactNode;
  position?: number; onSeek?: (step: number) => void; onLoopChange?: (range: { startStep: number; endStep: number } | null) => void;
  transport?: ReactNode; laneControls?: (id: string) => ReactNode; onAddLane?: (source: SourceKind) => void;
}) {
  const sequencer = useAppStore(s => s.sequencer), drafts = useAppStore(s => s.clipDrafts), key = useAppStore(s => s.clipEditingKey);
  const audition = usePerformanceAudition();
  const statuses = useAppStore(s => s.performanceAuditions);
  const active = useRef<{ id: string; gesture: string; key: string; last: unknown } | null>(null);
  const [auditioning, setAuditioning] = useState(false);
  const stopEdit = async () => {
    const previous = active.current; active.current = null; setAuditioning(false);
    if (previous) await audition?.(previous.id, { action: "workspace_end", gestureId: previous.gesture });
    useAppStore.setState({ clipAuditionDraft: null });
  };
  useEffect(() => () => {
    const previous = active.current;
    if (previous) void audition?.(previous.id, { action: "workspace_end", gestureId: previous.gesture });
    useAppStore.setState({ clipAuditionDraft: null });
  }, [audition]);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const current = active.current;
    const editing = current ? drafts[current.key] : undefined;
    if (!auditioning || !current || !editing || current.last === editing) return;
    const timer = setTimeout(() => {
      if (active.current !== current) return;
      current.last = editing;
      useAppStore.setState({ clipAuditionDraft: editing });
      void audition?.(current.id, { action: "workspace_start", gestureId: current.gesture, clipDraft: editing }).catch(e => setError(String(e)));
    }, 80);
    return () => clearTimeout(timer);
  }, [drafts, auditioning, audition]);
  const model = sequencer.clipArrangement, draft = key ? drafts[key] : undefined, c = clipCopy(language);
  if (!model) return null;
  const lane = model.lanes.find(l => l.id === draft?.target.laneId);
  const curve = draft?.definition.kind === "pattern" && draft.definition.source === "controller" ? clipEditorView(sequencer, draft).controllerSequencers.find(t => t.id === lane?.id && t.controllerMode === "curve") : undefined;
  const selectedClip = lane?.clips.find(cl => cl.id === draft?.target.clipId);
  let curveWindow: [number, number] = [0, 1];
  if (curve && draft && lane && selectedClip && draft.definition.kind === "pattern") {
    const timing = arrangementTimings(sequencer)[lane.id];
    const leaf = resolveContent(lane, selectedClip.children, timing).find(l => JSON.stringify(l.path) === JSON.stringify(draft.target.path));
    if (leaf) {
      const origin = selectedClip.start - selectedClip.offset + draft.target.pass * contentLength(lane, selectedClip.children, timing) + leaf.start;
      const length = draft.definition.payload.lengthBeats * localBeatTicks(timing);
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
    <ClipArranger language={language} model={model} sequencer={sequencer} onChange={commitClipArrangement} onEdit={target => attempt(() => openClipEditor(target))} laneControls={id => <>{laneControls?.(id)}{active.current?.id === id && <span title={statuses[id]?.workspace_queued ? c.auditionQueued : c.auditioning} aria-label={statuses[id]?.workspace_queued ? c.auditionQueued : c.auditioning} className="text-cyan-300">{statuses[id]?.workspace_queued ? "◷" : "▶"}</span>}</>} onAddLane={onAddLane} onRemoveLane={id => { void (active.current?.id === id ? stopEdit() : Promise.resolve()).then(() => attempt(() => removeClipLane(id))).catch(e => setError(String(e))); }} position={position} onSeek={onSeek} onLoopChange={onLoopChange}
      inlineEditor={curve ? { laneId: curve.id, content: <InlineCurve track={curve} language={language} window={curveWindow} /> } : undefined}
      transport={<>{transport}<button className={clipButton} disabled={!sequencer.clipHistory?.cursor} onClick={() => attempt(() => clipHistoryStep(false))}>{c.undo}</button><button className={clipButton} disabled={!sequencer.clipHistory || sequencer.clipHistory.cursor >= sequencer.clipHistory.entries.length} onClick={() => attempt(() => clipHistoryStep(true))}>{c.redo}</button></>} />
    {draft && lane ? <section className="mt-2 rounded-xl border border-cyan-800 bg-slate-950/80 p-3" aria-label={c.path}>
      <header className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="mr-auto text-cyan-100">{breadcrumb}</span>
        {active.current && <span role="status" className="text-cyan-200">{statuses[active.current.id]?.workspace_queued ? c.auditionQueued : c.auditioning}</span>}
        <span className="text-amber-200">{hasChangedClipDrafts(model, { current: draft }) ? c.unsaved : c.saved}</span>
        <button className={clipButton} onClick={() => { void (async () => {
          if (auditioning) { await stopEdit(); return; }
          const gesture = crypto.randomUUID();
          useAppStore.setState({ clipAuditionDraft: draft });
          active.current = { id: lane.id, gesture, key: draftKey(draft), last: draft };
          try { await audition?.(lane.id, { action: "workspace_start", gestureId: gesture, clipDraft: draft }); if (active.current?.gesture === gesture) setAuditioning(true); }
          catch (e) { active.current = null; useAppStore.setState({ clipAuditionDraft: null }); setError(String(e)); }
        })(); }}>{auditioning ? c.stop : c.play}</button><button className={clipButton} onClick={() => setSaving(true)}>{c.save}</button><button className={clipButton} onClick={() => { void stopEdit(); useAppStore.setState({ clipEditingKey: null }); }}>{c.close}</button>
      </header>
      <p className="mb-2 text-[10px] text-slate-500">{c.laneSettings}</p>
      {draft.definition.kind === "pattern" ? <ClipEditingContext.Provider value>{renderEditor(draft.definition.source, lane.id, clipEditorView(sequencer, draft))}</ClipEditingContext.Provider>
        : <ContentEditor lane={{ ...lane, definitions: [...lane.definitions, ...(draft.additions ?? [])] }} items={draft.definition.children} level={draft.definition.kind} sequencer={sequencer} language={language} onChange={(definitions, children) => {
          if (draft.definition.kind !== "pattern") updateClipDraft({ ...draft.definition, children }, definitions.filter(d => !lane.definitions.some(original => original.id === d.id)));
        }} />}

    </section> : <p className="px-3 py-2 text-xs text-slate-500">{c.select}</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {saving && draft && lane && <SaveScopeDialog draft={draft} lane={lane} language={language} timing={arrangementTimings(sequencer)[lane.id]} onCancel={() => setSaving(false)} onSave={(scope, name) => { void stopEdit().then(() => attempt(() => { saveClipDraft(scope, name); setSaving(false); })).catch(e => setError(String(e))); }} />}
  </>;
}
