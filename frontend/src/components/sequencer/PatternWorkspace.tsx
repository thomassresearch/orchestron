import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { GuiLanguage, PadLoopPatternItem, PadLoopPatternState } from "../../types";
import { arrangementCopy } from "../../lib/arrangementCopy";
import { compileDefinition, createDefinition, definitionItem, definitionUses, type DefinitionRef } from "../../lib/arrangementEditing";
import { ARRANGEMENT_ITEM_MIME, beginArrangementDrag, endArrangementDrag } from "../../lib/arrangementDrag";
import { ARRANGER_PREVIEW_CANCEL } from "../../lib/arrangerPreviewGesture";
import { itemDisplayLabel } from "../../lib/padLoopPattern";
import { patternItemButtonClass } from "../../lib/patternItemPresentation";
import { applyWorkspaceDefinition, deleteWorkspaceDefinition, groupWorkspaceItems, moveWorkspaceItems, splitWorkspaceItems, validateWorkspace, workspacePlayingIndex, workspaceSelection, type PatternWorkspaceDraft } from "../../lib/patternWorkspace";
import { useAppStore } from "../../store/useAppStore";
import { ArrangerContextMenu, type ArrangerMenuTarget } from "./ArrangerContextMenu";
import { ArrangerSpeaker } from "./ArrangerSpeaker";
import { RetainedScroll, useOpenArranger, usePerformanceEditorState } from "./PerformanceEditorState";
import { usePerformanceAudition } from "./PerformanceAudition";
import { patternWorkspaceCopy } from "./patternWorkspaceCopy";

const button = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-accent disabled:opacity-40";
const menuButton = "block w-full rounded px-2 py-1.5 text-left hover:bg-slate-700 disabled:opacity-40";
const MOVE_MIME = "application/x-orchestron-workspace-items";
const PAD_MIME = "application/x-visualcsound-sequencer-pad";
type Menu = ArrangerMenuTarget & { ref?: DefinitionRef; palette?: boolean; indexes: number[] };
const refKey = (ref: DefinitionRef) => `${ref.kind}:${ref.id}`;
const itemRef = (item: PadLoopPatternItem): DefinitionRef | undefined => item.type === "group" ? { kind: "group", id: item.groupId } : item.type === "super" ? { kind: "super", id: item.superGroupId } : undefined;

export function PatternWorkspace({ track, language, onPatternChange, onSourceChange, padHasContent, hideArrangement = false }: {
  track: { id: string; activePad: number; padLoopEnabled: boolean; padLoopPattern: PadLoopPatternState; pads: Array<{ lengthBeats: number }> }; language: GuiLanguage;
  padHasContent: (index: number) => boolean; hideArrangement?: boolean;
  onPatternChange: (pattern: PadLoopPatternState) => void; onSourceChange: (enabled: boolean) => void;
}) {
  const c = patternWorkspaceCopy(language), a = arrangementCopy(language);
  const owner = `device:${track.id}` as const;
  const [drafts, setDrafts] = usePerformanceEditorState<Record<string, PatternWorkspaceDraft>>(owner, "workspaceDrafts", {});
  const [active, setActive] = usePerformanceEditorState<DefinitionRef | null>(owner, "workspaceDefinition", null);
  const [, selectLane] = usePerformanceEditorState<string | null>("arranger", "selectedLane", null);
  const [, expandLane] = usePerformanceEditorState(owner, "arrangerExpanded", false);
  const [, focusDefinition] = usePerformanceEditorState<PadLoopPatternItem | null>(owner, "arrangerFocusDefinition", null);
  const openArranger = useOpenArranger();
  const audition = usePerformanceAudition();
  const status = useAppStore(state => state.performanceAuditions[track.id]);
  const [gesture, setGesture] = useState<string | null>(null);
  const gestureRef = useRef<string | null>(null);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const anchor = useRef<number | null>(null);
  const pattern = track.padLoopPattern;
  const key = active ? refKey(active) : "free";
  const saved = active ? (active.kind === "group" ? pattern.groups : pattern.superGroups).find(g => g.id === active.id)?.sequence : undefined;
  const items = drafts[key]?.items ?? saved ?? [];
  const selection = workspaceSelection(drafts[key]?.selection ?? [], items.length);
  const playingIndex = workspacePlayingIndex(pattern, items, status, gesture);
  const dirty = !!active && JSON.stringify(items) !== JSON.stringify(saved);
  const uses = active ? definitionUses(pattern, active) : [];
  let tokens: number[] = [];
  try { tokens = validateWorkspace(pattern, items, active); } catch { /* Invalid drafts remain editable. */ }
  const signature = JSON.stringify(tokens);
  const duration = (sequence: number[]) => sequence.reduce((beats, token) => beats + (token < 0 ? -token : track.pads[token]?.lengthBeats ?? 4), 0);
  const savedDuration = active ? duration(compileDefinition(pattern, definitionItem(active))) : 0;
  const lastSubmitted = useRef("");
  const latest = useRef({ items, signature });
  latest.current = { items, signature };
  const stop = useCallback(() => {
    const id = gestureRef.current;
    gestureRef.current = null; setGesture(null);
    if (id) void audition?.(track.id, { action: "workspace_end", gestureId: id }).catch(() => setError(true));
  }, [audition, track.id]);
  useEffect(() => {
    const cancel = () => { gestureRef.current = null; setGesture(null); };
    window.addEventListener(ARRANGER_PREVIEW_CANCEL, cancel);
    return () => { window.removeEventListener(ARRANGER_PREVIEW_CANCEL, cancel); stop(); endArrangementDrag(); };
  }, [key, stop]);
  useEffect(() => {
    if (!gesture || lastSubmitted.current === signature) return;
    if (!tokens.length) { stop(); return; }
    const timer = setTimeout(() => {
      lastSubmitted.current = signature;
      void audition?.(track.id, { action: "workspace_start", gestureId: gesture, items: latest.current.items }).catch(() => setError(true));
    }, 80);
    return () => clearTimeout(timer);
  }, [audition, gesture, signature, stop, tokens.length, track.id]);
  const play = () => {
    if (gestureRef.current) { stop(); return; }
    const id = crypto.randomUUID(); gestureRef.current = id; setGesture(id);
    lastSubmitted.current = signature; setError(false);
    void audition?.(track.id, { action: "workspace_start", gestureId: id, items }).catch(() => {
      if (gestureRef.current === id) { gestureRef.current = null; setGesture(null); setError(true); }
    });
  };
  const setDraft = (nextItems: PadLoopPatternItem[], indexes: number[] = []) => setDrafts(previous => ({ ...previous, [key]: { items: nextItems, selection: indexes } }));
  const attempt = (fn: () => void) => { try { fn(); setError(false); setMenu(null); } catch { setError(true); } };
  const editItems = (next: PadLoopPatternItem[]) => attempt(() => { validateWorkspace(pattern, next, active); setDraft(next); });
  const select = (index: number, event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">) => {
    const indexes = event.shiftKey && anchor.current !== null
      ? Array.from({ length: Math.abs(index - anchor.current) + 1 }, (_, i) => Math.min(index, anchor.current!) + i)
      : event.metaKey || event.ctrlKey ? selection.includes(index) ? selection.filter(i => i !== index) : [...selection, index] : [index];
    if (!event.shiftKey) anchor.current = index;
    setDraft(items, indexes);
  };
  const open = (ref: DefinitionRef | null) => {
    stop(); setMenu(null); setError(false); anchor.current = null;
    if (ref && !drafts[refKey(ref)]) {
      const sequence = (ref.kind === "group" ? pattern.groups : pattern.superGroups).find(g => g.id === ref.id)?.sequence ?? [];
      setDrafts(previous => ({ ...previous, [refKey(ref)]: { items: structuredClone(sequence), selection: [] } }));
    }
    setActive(ref);
  };
  const canGroup = (kind: "group" | "super", indexes = selection) => indexes.length >= 2 && active?.kind !== "group" &&
    !(active && kind === "super") && indexes.every(i => items[i] && items[i].type !== "super" && (kind === "super" || items[i].type !== "group"));
  const group = (kind: "group" | "super", indexes = selection) => attempt(() => {
    const result = groupWorkspaceItems(pattern, items, indexes, kind, active);
    onPatternChange(result.pattern); setDraft(result.items, [Math.min(...indexes)]);
  });
  const split = (indexes = selection) => editItems(splitWorkspaceItems(pattern, items, indexes));
  const remove = (indexes = selection) => editItems(items.filter((_, i) => !indexes.includes(i)));
  const deleteUses = (ref: DefinitionRef) => definitionUses(pattern, ref);
  const showMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, index?: number, ref?: DefinitionRef) => {
    event.preventDefault(); event.stopPropagation();
    const indexes = index === undefined ? [] : selection.includes(index) ? selection : [index];
    if (index !== undefined) setDraft(items, indexes);
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenu({ x: "clientX" in event ? event.clientX : bounds.left, y: "clientY" in event ? event.clientY : bounds.bottom,
      anchor: event.currentTarget, indexes, ref: ref ?? (index === undefined ? undefined : itemRef(items[index])), palette: index === undefined });
  };
  const menuKey = (event: KeyboardEvent<HTMLElement>, index?: number, ref?: DefinitionRef) => {
    if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) showMenu(event, index, ref);
  };
  const label = (item: PadLoopPatternItem) => item.type === "pause" ? `${a.rest} ${item.lengthBeats}` : itemDisplayLabel(item);
  const hasContent = (item: PadLoopPatternItem) => item.type !== "pad" || padHasContent(item.padIndex);
  const drop = (event: DragEvent, position: number) => {
    event.preventDefault(); event.stopPropagation(); setDropIndex(null);
    attempt(() => {
      const move = event.dataTransfer.getData(MOVE_MIME);
      if (move) {
        const data = JSON.parse(move);
        if (data.trackId !== track.id || data.key !== key || !Array.isArray(data.indexes)) return;
        const indexes = workspaceSelection(data.indexes, items.length);
        const next = moveWorkspaceItems(items, indexes, position); validateWorkspace(pattern, next, active);
        const insertion = position - indexes.filter(i => i < position).length;
        setDraft(next, indexes.map((_, i) => insertion + i)); anchor.current = insertion; return;
      }
      const data = JSON.parse(event.dataTransfer.getData(ARRANGEMENT_ITEM_MIME) || event.dataTransfer.getData(PAD_MIME) || "null");
      if (!data || data.trackId !== track.id) return;
      const item = data.item ?? { type: "pad", padIndex: data.padIndex };
      if (!compileDefinition(pattern, item).length) throw new Error("Empty definition.");
      const next = [...items.slice(0, position), item, ...items.slice(position)];
      validateWorkspace(pattern, next, active); setDraft(next, [position]);
    });
    endArrangementDrag();
  };
  const references = [...pattern.groups.map(g => ({ kind: "group" as const, id: g.id })), ...pattern.superGroups.map(g => ({ kind: "super" as const, id: g.id }))];
  return <section className="min-w-0 space-y-2 rounded-lg border border-slate-700 bg-slate-950/40 p-2" aria-label={c.workspace}>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-slate-200">{c.workspace}</span>
      {!hideArrangement && <><label className="ml-auto text-slate-400">{a.source} <select className={button} value={track.padLoopEnabled ? "arrangement" : "manual"} onChange={e => onSourceChange(e.target.value === "arrangement")}>
        <option value="manual">{a.manual}</option><option value="arrangement" disabled={!pattern.rootSequence.length}>{a.arrangement}</option>
      </select></label>
      <button className={button} onClick={() => { selectLane(track.id); expandLane(true); focusDefinition(active ? definitionItem(active) : { type: "pad", padIndex: track.activePad }); openArranger?.(); requestAnimationFrame(() => document.getElementById("multitrack-arranger")?.scrollIntoView({ block: "center" })); }}>{a.open}</button></>}
    </div>
    <RetainedScroll owner={owner} field="workspacePalette" className="flex max-h-20 flex-wrap items-center gap-1 overflow-y-auto" aria-label={c.saved}>
      <button className={button} aria-pressed={!active} onClick={() => open(null)}>{c.free}</button>
      {references.map(ref => { const item = definitionItem(ref); return <div key={refKey(ref)} className={`flex items-center rounded border ${ref.kind === "group" ? "border-red-700 bg-red-950" : "border-violet-700 bg-violet-950"}`}>
        <button className={patternItemButtonClass(item.type)} aria-pressed={!!active && refKey(active) === refKey(ref)} draggable
          onDragStart={e => { beginArrangementDrag(track.id, item); e.dataTransfer.setData(ARRANGEMENT_ITEM_MIME, JSON.stringify({ trackId: track.id, item })); e.dataTransfer.effectAllowed = "copy"; }} onDragEnd={endArrangementDrag}
          onClick={() => open(ref)} onDoubleClick={() => open(ref)} onContextMenu={e => showMenu(e, undefined, ref)} onKeyDown={e => menuKey(e, undefined, ref)}>{ref.kind === "group" ? a.group : a.super} {ref.id}</button>
        <ArrangerSpeaker id={track.id} item={item} label={label(item)} language={language} disabled={!compileDefinition(pattern, item).length} />
      </div>; })}
    </RetainedScroll>
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" className={`${button} ${gesture ? "border-cyan-400 text-cyan-200" : ""}`} aria-label={gesture ? c.stop : c.play} aria-pressed={!!gesture} disabled={!audition || !gesture && !tokens.length} onClick={play}>{gesture ? "■" : "▶"}</button>
      <span className="mr-auto text-xs text-slate-300">{active ? `${a.editing}: ${active.id}` : c.free}{dirty ? ` · ${c.changes}` : ""}</span>
      {gesture && <span className="text-xs text-cyan-300">{status?.workspace_queued ? c.queued : c.auditioning}{playingIndex >= 0 && `: ${label(items[playingIndex])}`}</span>}
      <button className={button} disabled={!canGroup("group")} onClick={() => group("group")}>{c.group}</button>
      <button className={button} disabled={!canGroup("super")} onClick={() => group("super")}>{c.super}</button>
      <select className={button} aria-label={c.rest} value="" onChange={e => editItems([...items, { type: "pause", lengthBeats: Number(e.target.value) as 1 | 2 | 4 | 8 | 16 }])}>
        <option value="" disabled>{c.rest}</option>{[1, 2, 4, 8, 16].map(value => <option key={value} value={value}>{a.rest} {value}</option>)}
      </select>
    </div>
    <RetainedScroll key={key} owner={owner} field={`workspaceStrip:${key}`} role="list" aria-label={active ? `${a.editing} ${active.id}` : c.free} tabIndex={0}
      title={c.hint} className="flex min-h-12 items-center gap-1 overflow-x-auto rounded border border-dashed border-slate-600 p-2"
      onDragOver={e => { e.preventDefault(); if (e.target === e.currentTarget) setDropIndex(items.length); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null); }} onDrop={e => drop(e, items.length)}
      onClick={e => { if (e.target === e.currentTarget) setDraft(items); }}
      onKeyDown={e => { if (e.key === "Escape") { setMenu(null); setDropIndex(null); endArrangementDrag(); } if (["Delete", "Backspace"].includes(e.key)) { e.preventDefault(); remove(); } }}>
      {!items.length && <span className="text-xs text-slate-400">{c.empty}</span>}
      {items.map((item, index) => <div role="listitem" key={index} className={`flex shrink-0 items-center rounded ${playingIndex === index ? "outline outline-2 outline-offset-2 outline-amber-300" : ""} ${dropIndex === index ? "border-l-2 border-cyan-300" : "border-l-2 border-transparent"}`}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setDropIndex(e.clientX < r.left + r.width / 2 ? index : index + 1); }}
        onDrop={e => drop(e, dropIndex ?? index)}>
        <button className={patternItemButtonClass(item.type, hasContent(item))} draggable aria-pressed={selection.includes(index)} aria-current={playingIndex === index ? "true" : undefined}
          onClick={e => select(index, e)} onDoubleClick={() => { const ref = itemRef(item); if (ref) open(ref); else if (item.type === "pad") useAppStore.getState().selectSequencerEditingPad(track.id, item.padIndex); }}
          onContextMenu={e => showMenu(e, index)} onKeyDown={e => menuKey(e, index)}
          onDragStart={e => { const indexes = selection.includes(index) ? selection : [index]; setDraft(items, indexes); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(MOVE_MIME, JSON.stringify({ trackId: track.id, key, indexes })); }}
          onDragEnd={() => { setDropIndex(null); endArrangementDrag(); }}>{label(item)}</button>
        {item.type !== "pause" && <ArrangerSpeaker id={track.id} item={item} label={label(item)} language={language} />}
      </div>)}
      <span aria-hidden className={`h-7 w-2 shrink-0 ${dropIndex === items.length ? "border-l-2 border-cyan-300" : ""}`} />
    </RetainedScroll>
    {active ? <>
      <div className="flex flex-wrap items-center gap-1">
        <button className={button} disabled={!dirty} onClick={() => attempt(() => { onPatternChange(applyWorkspaceDefinition(pattern, active, items)); })}>{c.apply}</button>
        <button className={button} onClick={() => attempt(() => { const result = createDefinition(pattern, active.kind, items); onPatternChange(result.pattern); setDrafts(previous => ({ ...previous, [refKey(result.ref)]: { items: structuredClone(items), selection: [] } })); setActive(result.ref); })}>{c.saveNew}</button>
        <button className={button} disabled={!dirty} onClick={() => { setDraft(structuredClone(saved ?? [])); setError(false); }}>{c.discard}</button>
        <span className="text-xs text-slate-400">{a.duration}: {savedDuration}{dirty && ` → ${duration(tokens)}`}</span>
        {uses.length > 0 && <span className="text-xs text-slate-400">{a.used}: {uses.map(use => use === "Arrangement" ? a.arrangement : use).join(", ")}</span>}
      </div><p className="text-[11px] text-slate-400">{c.update}</p>
    </> : <p className="text-[11px] text-slate-400">{c.temporary}</p>}
    {error && <p role="alert" className="text-xs text-red-300">{c.invalid}</p>}
    {menu && <ArrangerContextMenu target={menu} title={c.actions} onClose={() => setMenu(null)}>
      {menu.ref && <button role="menuitem" className={menuButton} onClick={() => open(menu.ref!)}>{c.edit} {menu.ref.id}</button>}
      {!menu.palette && <>
        <button role="menuitem" className={menuButton} disabled={!canGroup("group", menu.indexes)} onClick={() => group("group", menu.indexes)}>{c.group}</button>
        <button role="menuitem" className={menuButton} disabled={!canGroup("super", menu.indexes)} onClick={() => group("super", menu.indexes)}>{c.super}</button>
        <button role="menuitem" className={menuButton} disabled={!menu.indexes.some(i => itemRef(items[i]))} onClick={() => split(menu.indexes)}>{c.split}</button>
        <button role="menuitem" className={menuButton} onClick={() => remove(menu.indexes)}>{c.remove}</button>
      </>}
      {menu.ref && menu.palette && <>
        <button role="menuitem" className={menuButton} disabled={deleteUses(menu.ref).length > 0} onClick={() => attempt(() => { const ref = menu.ref!; const result = deleteWorkspaceDefinition(pattern, drafts, ref); onPatternChange(result.pattern); setDrafts(result.drafts); if (active && refKey(active) === refKey(ref)) open(null); })}>{c.delete}</button>
        {!deleteUses(menu.ref).length && <p className="p-2 text-slate-400">{c.deleteHint}</p>}
        {deleteUses(menu.ref).length > 0 && <p className="p-2 text-slate-400">{a.used}: {deleteUses(menu.ref).map(use => use === "Arrangement" ? a.arrangement : use).join(", ")}</p>}
      </>}
    </ArrangerContextMenu>}
  </section>;
}
