import { usePerformanceAudition } from "./PerformanceAudition";
import { useState } from "react";
import type { GuiLanguage, PadLoopPatternItem, PadLoopPatternState } from "../../types";
import { arrangementCopy } from "../../lib/arrangementCopy";
import { patternItemButtonClass } from "../../lib/patternItemPresentation";
import { compileDefinition, createDefinition, definitionItem, definitionUses, deleteDefinition, validateArrangementEdit, type DefinitionRef } from "../../lib/arrangementEditing";
import { canInsertItemIntoPadLoopContainer, getPadLoopContainerSequence, groupPadLoopItemsInContainer, insertPadLoopItem, itemDisplayLabel, movePadLoopItemWithinContainer, removePadLoopItemsFromContainer, ungroupPadLoopItemsInContainer } from "../../lib/padLoopPattern";
import { useOpenArranger, usePerformanceEditorState } from "./PerformanceEditorState";
import type { SequencerUiCopy } from "./sequencerUiCopy";

let arrangementDrag: { trackId: string; item: PadLoopPatternItem } | null = null;
export const currentArrangementDrag = () => arrangementDrag;
export const beginArrangementDrag = (trackId: string, item: PadLoopPatternItem) => { arrangementDrag = { trackId, item }; };
export const endArrangementDrag = () => { arrangementDrag = null; };
export const ARRANGEMENT_ITEM_MIME = "application/x-orchestron-pattern-reference";
const button = "rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-accent disabled:opacity-40";
type Props = {
  ui: Pick<SequencerUiCopy, "padLoopSequence" | "padLoopSequenceEmpty" | "padLoopSequenceHint" | "padLooper" | "repeat" | "on" | "off" | "remove">;
  guiLanguage?: GuiLanguage;
  hostId: string;
  track: { id: string; enabled: boolean; padLoopEnabled: boolean; padLoopRepeat: boolean; padLoopPosition: number | null; padLoopPattern: PadLoopPatternState };
  stepsPerBeat: number;
  padStepCounts: number[];
  defaultPadStepCount: number;
  isPlaying: boolean;
  linkedPadLoopStepPosition: number | null;
  onLinkedPadLoopStepPositionChange: (position: number | null) => void;
  onPadLoopEnabledChange: (enabled: boolean) => void;
  onPadLoopRepeatChange: (repeat: boolean) => void;
  onPadLoopPatternChange: (pattern: PadLoopPatternState) => void;
  onAudition?: (item: PadLoopPatternItem) => void;
  hideSource?: boolean;
  allowAudition?: boolean;
};

/** Shared definition editor. It deliberately never exposes the root/song sequence. */
export function PadLoopPatternEditor({ track, guiLanguage = "english", onPadLoopEnabledChange, onPadLoopPatternChange, onAudition, hideSource = false, allowAudition = true }: Props) {
  const audition = usePerformanceAudition();
  const openArranger = useOpenArranger();
  const launchDefinition = !allowAudition ? undefined : onAudition ?? (audition ? (item: PadLoopPatternItem) => { void audition(track.id, item); } : undefined);
  const c = arrangementCopy(guiLanguage);
  const pattern = track.padLoopPattern;
  const [selected, setSelected] = usePerformanceEditorState<DefinitionRef | null>(`device:${track.id}`, "definition", null);
  const [selection, setSelection] = usePerformanceEditorState<number[]>(`device:${track.id}`, "definitionSelection", []);
  const [, selectLane] = usePerformanceEditorState<string | null>("arranger", "selectedLane", null);
  const [expanded, setExpanded] = usePerformanceEditorState(`device:${track.id}`, hideSource ? "definitionOpen" : "libraryOpen", false);
  const [, expandLane] = usePerformanceEditorState(`device:${track.id}`, "arrangerExpanded", false);
  const [, expandArrangerDefinition] = usePerformanceEditorState(`device:${track.id}`, "definitionOpen", false);
  const [error, setError] = useState(false);
  const active = selected && getPadLoopContainerSequence(pattern, selected) !== null ? selected : null;
  const sequence = active ? getPadLoopContainerSequence(pattern, active) ?? [] : [];
  const uses = active ? definitionUses(pattern, active) : [];
  const change = (edit: () => PadLoopPatternState) => {
    try {
      const next = edit();
      validateArrangementEdit(pattern, next);
      onPadLoopPatternChange(next);
      setError(false);
      setSelection([]);
    } catch { setError(true); }
  };
  const create = (kind: "group" | "super") => change(() => {
    const result = createDefinition(pattern, kind);
    setSelected(result.ref);
    return result.pattern;
  });
  const label = (item: PadLoopPatternItem) => item.type === "pause" ? `${c.rest} ${item.lengthBeats}` : itemDisplayLabel(item);
  const references: PadLoopPatternItem[] = [
    ...Array.from({ length: 8 }, (_, padIndex): PadLoopPatternItem => ({ type: "pad", padIndex })),
    ...pattern.groups.map(g => definitionItem({ kind: "group", id: g.id })),
    ...pattern.superGroups.map(g => definitionItem({ kind: "super", id: g.id }))
  ];
  return <section className="min-w-0 space-y-2 rounded border border-slate-700 p-2" aria-label={c.library}>
    <div className="flex flex-wrap items-center gap-2">
      <button className="text-xs font-semibold text-slate-200" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); endArrangementDrag(); }}><span aria-hidden>{expanded ? "▾" : "▸"}</span> {c.library}</button>
    </div>
    {expanded && <>
    <div className="flex flex-wrap items-center gap-2">
      {!hideSource && <>
        <label className="text-xs text-slate-300">{c.source} <select className={button} value={track.padLoopEnabled ? "arrangement" : "manual"}
          onChange={e => onPadLoopEnabledChange(e.target.value === "arrangement")}>
          <option value="manual">{c.manual}</option>
          <option value="arrangement" disabled={!pattern.rootSequence.length}>{c.arrangement}</option>
        </select></label>
        <button className={button} onClick={() => { selectLane(track.id); expandLane(true); expandArrangerDefinition(true); openArranger?.(); requestAnimationFrame(() => document.getElementById("multitrack-arranger")?.scrollIntoView({ block: "center" })); }}>{c.open}</button>
      </>}
      <button className={button} onClick={() => create("group")}>{c.newGroup}</button>
      <button className={button} onClick={() => create("super")}>{c.newSuper}</button>
    </div>
    <div className="flex flex-wrap gap-1">
      {[...pattern.groups.map(g => ({ kind: "group" as const, id: g.id })), ...pattern.superGroups.map(g => ({ kind: "super" as const, id: g.id }))].map(ref =>
        <button key={`${ref.kind}:${ref.id}`} className={patternItemButtonClass(ref.kind)} aria-pressed={active?.id === ref.id && active.kind === ref.kind}
          onClick={() => { setSelected(ref); setSelection([]); }}>{ref.kind === "group" ? c.group : c.super} {ref.id}</button>)}
    </div>
    {active ? <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span>{c.editing}: {active.id}</span>
        {uses.length > 0 && <span>{c.used}: {uses.map(use => use === "Arrangement" ? c.arrangement : use).join(", ")}</span>}
        {launchDefinition && <button className={button} disabled={!compileDefinition(pattern, definitionItem(active)).length} onClick={() => launchDefinition(definitionItem(active))}>{c.audition}</button>}
        <button className={button} disabled={uses.length > 0} onClick={() => change(() => deleteDefinition(pattern, active))}>{c.removeDefinition}</button>
      </div>
      <p className="text-xs text-slate-400">{c.shared}</p>
      <div className="flex flex-wrap gap-1" aria-label={c.add}>
        {[...references, ...([1, 2, 4, 8, 16] as const).map(lengthBeats => ({ type: "pause" as const, lengthBeats }))].filter(item =>
          canInsertItemIntoPadLoopContainer(pattern, active, item) && compileDefinition(pattern, item).length > 0).map((item, index) => <button key={index} className={patternItemButtonClass(item.type)}
          draggable onDragEnd={endArrangementDrag} onDragStart={event => { beginArrangementDrag(track.id, item); event.dataTransfer.setData(ARRANGEMENT_ITEM_MIME, JSON.stringify({ trackId: track.id, item })); }}
          onClick={() => change(() => insertPadLoopItem(pattern, active, sequence.length, item))}>{label(item)}</button>)}
      </div>
      <div className="flex min-h-10 flex-wrap gap-1 rounded border border-slate-600 p-1" role="list" aria-label={`${c.editing} ${active.id}`} tabIndex={0}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (/^[1-8]$/.test(event.key)) { event.preventDefault(); change(() => insertPadLoopItem(pattern, active, sequence.length, { type: "pad", padIndex: Number(event.key) - 1 })); }
          if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); change(() => removePadLoopItemsFromContainer(pattern, active, selection)); }
        }}
        onDragOver={event => event.preventDefault()} onDrop={event => {
          event.preventDefault();
          try {
            const data = JSON.parse(event.dataTransfer.getData(ARRANGEMENT_ITEM_MIME));
            if (data.trackId === track.id && data.item) change(() => insertPadLoopItem(pattern, active, sequence.length, data.item));
          } catch { /* An unrelated drag has no effect. */ }
        }}>
        {!sequence.length && <span className="text-xs text-slate-400">{c.empty}</span>}
        {sequence.map((item, index) => <div key={index} className="flex items-center gap-1" role="listitem" onDragOver={e => e.preventDefault()}
          onDrop={e => {
            const from = e.dataTransfer.getData("application/x-orchestron-phrase-index");
            if (from !== "") { e.preventDefault(); e.stopPropagation(); const data = JSON.parse(from); if (data.trackId === track.id && data.id === active.id && data.kind === active.kind) change(() => movePadLoopItemWithinContainer(pattern, active, data.index, index)); }
          }}>
          <button className={patternItemButtonClass(item.type)} draggable aria-pressed={selection.includes(index)} onDragStart={e => e.dataTransfer.setData("application/x-orchestron-phrase-index", JSON.stringify({ trackId: track.id, ...active, index }))}
            onClick={e => setSelection(e.ctrlKey || e.metaKey || e.shiftKey ? selection.includes(index) ? selection.filter(i => i !== index) : [...selection, index] : [index])}>{label(item)}</button>
          <button className={button} aria-label={`${c.closeGap} ${label(item)}`} onClick={() => change(() => removePadLoopItemsFromContainer(pattern, active, [index]))}>×</button>
        </div>)}
      </div>
      <div className="flex flex-wrap gap-1">
        <button className={button} disabled={!selection.length} onClick={() => change(() => removePadLoopItemsFromContainer(pattern, active, selection))}>{c.closeGap}</button>
        <button className={button} disabled={active.kind !== "super" || selection.length < 2} onClick={() => change(() => groupPadLoopItemsInContainer(pattern, active, selection, "group"))}>{c.newGroup}</button>
        <button className={button} disabled={!selection.some(i => sequence[i]?.type === "group")} onClick={() => change(() => ungroupPadLoopItemsInContainer(pattern, active, selection))}>↔ {c.group}</button>
      </div>
    </> : <p className="text-xs text-slate-400">{c.fill}</p>}
    {error && <p role="alert" className="text-xs text-red-300">{c.blocked}</p>}
    </>}
  </section>;
}
