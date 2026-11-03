import { useState } from "react";
import type { GuiLanguage, SequencerState } from "../../types";
import { newClipId, type ClipLane, type ContentItem, type Definition, type PatternDefinition } from "../../lib/clipArranger/model";
import { groupChildren } from "../../lib/clipArranger/operations";
import { sourceKeys } from "../../lib/clipArranger/migration";
import { defaultArpeggiator, defaultControllerSequencerPad, defaultDrummerSequencerPads, defaultSequencerPads } from "../../store/appStoreModel";
import { clipButton, clipInput } from "./ClipArranger";
import { clipCopy } from "./copy";

/** The same ordered-child controls edit a clip root or a reusable container draft. */
export function ContentEditor({ lane, items, level, sequencer, language, onChange }: {
  lane: ClipLane; items: ContentItem[]; level: "clip" | "group" | "supergroup";
  sequencer: SequencerState; language: GuiLanguage; onChange: (definitions: Definition[], children: ContentItem[]) => void;
}) {
  const c = clipCopy(language), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState<string | null>(null);
  const valid = lane.definitions.filter(d => d.kind === "pattern" || level === "clip" || level === "supergroup" && d.kind === "group");
  const run = (fn: () => void) => { try { fn(); setError(null); } catch (e) { setError(String(e)); } };
  const append = (definitionId: string) => onChange(lane.definitions, [...items, { id: newClipId(), definitionId }]);
  const freshPattern = () => {
    const track = sequencer[sourceKeys[lane.source]].find(t => t.id === lane.id)!;
    const existing = lane.definitions.find((d): d is PatternDefinition => d.kind === "pattern")!;
    const payload = lane.source === "sequencer" ? defaultSequencerPads(undefined, undefined, undefined, 4, "timing" in track ? track.timing : undefined)[0]
      : lane.source === "drummer" && "rows" in track ? defaultDrummerSequencerPads(track.rows, 4, track.timing)[0]
      : lane.source === "controller" ? defaultControllerSequencerPad(4, "timing" in track ? track.timing : undefined)
      : lane.source === "arpeggiator" ? defaultArpeggiator().pads[0] : { ...existing.payload, notes: [] };
    const definition = { id: newClipId(), kind: "pattern", source: lane.source, payload, revision: 0, name: `${c.newPattern} ${lane.definitions.filter(d => d.kind === "pattern").length + 1}` } as PatternDefinition;
    onChange([...lane.definitions, definition], [...items, { id: newClipId(), definitionId: definition.id }]);
  };
  return <div className="w-full space-y-2 text-xs text-slate-300">
    {items.map((item, index) => {
      const definition = "definitionId" in item ? lane.definitions.find(d => d.id === item.definitionId) : undefined;
      return <div key={item.id} className="flex items-center gap-2 rounded border border-slate-700 p-2">
        <input type="checkbox" aria-label={`${c.choose}: ${definition?.name ?? c.rest} ${index + 1}`} checked={selected.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
        <span className="mr-auto">{definition ? `${c[definition.kind]} · ${definition.name}` : `${c.rest} · ${"restTicks" in item ? item.restTicks / 20160 : 0}`}</span>
        {([-1, 1] as const).map(direction => <button key={direction} className={clipButton} aria-label={direction < 0 ? c.up : c.down} disabled={index + direction < 0 || index + direction >= items.length} onClick={() => run(() => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(lane.definitions, next); })}>{direction < 0 ? "←" : "→"}</button>)}
        {definition && definition.kind !== "pattern" && <button className={clipButton} onClick={() => run(() => onChange(lane.definitions, items.flatMap(i => i.id === item.id ? definition.children.map(child => ({ ...child, id: newClipId() })) : [i])))}>{c.ungroup}</button>}
        <button className={clipButton} disabled={items.length === 1} onClick={() => run(() => onChange(lane.definitions, items.filter(i => i.id !== item.id)))}>{c.removeContent}</button>
      </div>;
    })}
    <div className="flex flex-wrap items-center gap-2">
      <label>{c.addContent} <select className={`${clipInput} !w-48`} value="" onChange={e => run(() => append(e.target.value))}><option value="">—</option>{valid.map(d => <option key={d.id} value={d.id}>{d.name} · {c[d.kind]}</option>)}</select></label>
      <button className={clipButton} onClick={() => run(freshPattern)}>{c.newPattern}</button>
      <button className={clipButton} onClick={() => run(() => onChange(lane.definitions, [...items, { id: newClipId(), restTicks: 20160 }]))}>{c.rest} +1</button>
      {(["group", "supergroup"] as const).filter(kind => level === "clip" || level === "supergroup" && kind === "group").map(kind => <button key={kind} disabled={!selected.length} className={clipButton} onClick={() => run(() => {
        const result = groupChildren(lane, items, selected, kind, `${c[kind]} ${lane.definitions.filter(d => d.kind === kind).length + 1}`);
        onChange([...lane.definitions, result.definition], result.children); setSelected([]);
      })}>{c[kind]}</button>)}
    </div>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
  </div>;
}
