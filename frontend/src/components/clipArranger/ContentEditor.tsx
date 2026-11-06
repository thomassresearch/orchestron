import { useEffect, useState } from "react";
import type { GuiLanguage, SequencerState } from "../../types";
import { newClipId, type ClipLane, type PatternDefinition } from "../../lib/clipArranger/model";
import type { StructureCommand, StructureNode } from "../../lib/clipArranger/structure";
import { sourceKeys } from "../../lib/clipArranger/migration";
import { defaultArpeggiator, defaultControllerSequencerPad, defaultDrummerSequencerPads, defaultSequencerPads } from "../../store/appStoreModel";
import { clipInput } from "./ClipArranger";
import { clipButton, clipButtonClass } from "./buttonStyles";
import { clipCopy } from "./copy";

export function newStructurePattern(lane: ClipLane, sequencer: SequencerState, language: GuiLanguage): PatternDefinition {
  const c = clipCopy(language);
    const track = sequencer[sourceKeys[lane.source]].find(t => t.id === lane.id)!;
    const existing = lane.definitions.find((d): d is PatternDefinition => d.kind === "pattern")!;
    const payload = lane.source === "sequencer" ? defaultSequencerPads(undefined, undefined, undefined, 4, "timing" in track ? track.timing : undefined)[0]
      : lane.source === "drummer" && "rows" in track ? defaultDrummerSequencerPads(track.rows, 4, track.timing)[0]
      : lane.source === "controller" ? defaultControllerSequencerPad(4, "timing" in track ? track.timing : undefined)
      : lane.source === "arpeggiator" ? defaultArpeggiator().pads[0] : { ...existing.payload, notes: [] };
    const definition = { id: newClipId(), kind: "pattern", source: lane.source, payload, revision: 0, name: `${c.newPattern} ${lane.definitions.filter(d => d.kind === "pattern").length + 1}` } as PatternDefinition;
  return definition;
}

/** Optional inspector; every action uses the timeline's structural transaction. */
export function ContentEditor({ lane, nodes, path, name, level, sequencer, language, onCommand }: {
  lane: ClipLane; nodes: StructureNode[]; path: string[]; name: string; level: "group" | "supergroup";
  sequencer: SequencerState; language: GuiLanguage; onCommand: (command: StructureCommand) => void;
}) {
  const c = clipCopy(language), [selected, setSelected] = useState<string[]>([]);
  useEffect(() => setSelected([]), [nodes]);
  const valid = lane.definitions.filter(d => d.kind === "pattern" || level === "supergroup" && d.kind === "group");
  const insert = (definition: PatternDefinition | ClipLane["definitions"][number]) => onCommand({kind:'insert',target:{path,index:nodes.length},definition,variation:false});
  return <div className="w-full space-y-2 text-xs text-slate-300">
    <label>{c.name} <input key={name} className={clipInput} defaultValue={name} onBlur={e=>{if(e.target.value!==name)onCommand({kind:'rename',path,name:e.target.value});}} /></label>
    {nodes.map((node, index) => <div key={node.id} className="flex items-center gap-2 rounded border border-slate-700 p-2">
      <input type="checkbox" aria-label={`${c.choose}: ${node.definition?.name ?? c.rest} ${index + 1}`} checked={selected.includes(node.id)} onChange={e => setSelected(e.target.checked ? [...selected,node.id] : selected.filter(id=>id!==node.id))}/>
      <span className="mr-auto">{node.definition ? `${c[node.definition.kind]} · ${node.definition.name}` : `${c.rest} · ${(node.restTicks??0)/20160}`}</span>
      {([-1,1] as const).map(direction=><button key={direction} className={clipButton} aria-label={direction<0?c.up:c.down} disabled={index+direction<0||index+direction>=nodes.length} onClick={()=>onCommand({kind:'move',parent:path,ids:[node.id],target:{path,index:direction<0?index-1:index+2}})}>{direction<0?'←':'→'}</button>)}
      {node.children&&<button className={clipButtonClass("edit")} onClick={()=>onCommand({kind:'ungroup',parent:path,ids:[node.id]})}>{c.ungroup}</button>}
      <button className={clipButtonClass("remove")} onClick={()=>onCommand({kind:'remove',parent:path,ids:[node.id]})}>{c.removeContent}</button>
    </div>)}
    <div className="flex flex-wrap items-center gap-2">
      <label>{c.addContent} <select className={`${clipInput} !w-48`} value="" onChange={e=>{const definition=valid.find(d=>d.id===e.target.value);if(definition)insert(definition);}}><option value="">—</option>{valid.map(d=><option key={d.id} value={d.id}>{d.name} · {c[d.kind]}</option>)}</select></label>
      <button className={clipButtonClass("add")} onClick={()=>insert(newStructurePattern(lane,sequencer,language))}>{c.newPattern}</button>
      <button className={clipButtonClass("add")} onClick={()=>onCommand({kind:'rest',target:{path,index:nodes.length},ticks:20160})}>{c.rest} +1</button>
      {level==='supergroup'&&<button disabled={!selected.length} className={clipButtonClass("add")} onClick={()=>onCommand({kind:'group',parent:path,ids:selected,level:'group',name:`${c.group} ${lane.definitions.filter(d=>d.kind==='group').length+1}`})}>{c.group}</button>}
    </div>
  </div>;
}
