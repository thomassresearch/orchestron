import { useCallback, useMemo, useRef } from "react";
import { audioCopy } from "../lib/audioCopy";
import { addStereoBlock, audioPorts, projectAudioBlocks } from "../lib/audioBlocks";
import { suggestedInterface } from "../lib/audioRouting";
import { ReteNodeEditor, type ReteNodeEditorProps } from "./ReteNodeEditor";
import type { AudioInterface, AudioPortGroup } from "../types";

export function AudioGraphEditor(props: ReteNodeEditorProps) {
  const { graph, onGraphChange } = props; const t = audioCopy(props.guiLanguage);
  const projection = useMemo(() => projectAudioBlocks(graph, { input: t("stereoInput"), output: t("stereoOutput") }, props.opcodes), [graph, props.opcodes, props.guiLanguage]);
  const latest = useRef({ projection, onGraphChange, onSelectionChange: props.onSelectionChange });
  latest.current = { projection, onGraphChange, onSelectionChange: props.onSelectionChange };
  const restoreGraph = useCallback<ReteNodeEditorProps["onGraphChange"]>((next) => {
    latest.current.onGraphChange(latest.current.projection.restore(next));
  }, []);
  const restoreSelection = useCallback<ReteNodeEditorProps["onSelectionChange"]>((selection) => {
    const { projection, onSelectionChange } = latest.current;
    onSelectionChange({ nodeIds: selection.nodeIds.flatMap((id) => projection.members.get(id)?.map((n) => n.id) ?? [id]), connections: selection.connections.map(projection.restoreConnection) });
  }, []);
  const field = "rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs";
  const update = (audio_interface: AudioInterface) => onGraphChange({ ...graph, audio_interface });
  const changeGroup = (id: string, changes: Partial<AudioPortGroup>) => {
    const info = graph.audio_interface!; update({ ...info, groups: info.groups.map((g) => g.id === id ? { ...g, ...changes } : g) });
  };
  return <div className="flex h-full flex-col gap-2">
    <details className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">
      <summary>{t("stereoInput")} / {t("stereoOutput")} · {t("mapping")}</summary>
      <div className="my-2 flex flex-wrap gap-2"><button className={field} onClick={() => onGraphChange(addStereoBlock(graph, "input"))}>+ {t("stereoInput")} · inleta</button><button className={field} onClick={() => onGraphChange(addStereoBlock(graph, "output"))}>+ {t("stereoOutput")} · outleta</button></div>
      {!graph.audio_interface && <div><p>{audioPorts(graph, "input").join(" / ")} → {audioPorts(graph, "output").join(" / ")}</p><button className={field} onClick={() => update(suggestedInterface({ id: "draft", name: "Draft", description: "", is_template: false, always_on: false, schema_version: 1, updated_at: "", audio_inlet_names: audioPorts(graph, "input"), audio_outlet_names: audioPorts(graph, "output") }))}>{t("add")} · Stereo</button></div>}
      {graph.audio_interface && <label className="mr-2">{t("role")} <select className={field} value={graph.audio_interface.role} onChange={(e) => update({ ...graph.audio_interface!, role: e.target.value as AudioInterface["role"] })}>{(["instrument", "effect", "output", "custom"] as const).map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></label>}
      {graph.audio_interface?.groups.map((group) => <div key={group.id} className="my-2 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <input aria-label={t("groupName")} className={field} value={group.name} onChange={(e) => changeGroup(group.id, { name: e.target.value })} />
        <select aria-label={t("layout")} className={field} value={group.layout} onChange={(e) => changeGroup(group.id, { layout: e.target.value as AudioPortGroup["layout"] })}><option value="mono">Mono</option><option value="stereo">Stereo</option><option value="custom">{t("custom")}</option></select>
        <input aria-label={t("mapping")} className={`${field} w-48 font-mono`} value={group.ports.join(", ")} onChange={(e) => changeGroup(group.id, { ports: e.target.value.split(",").map((s) => s.trim()) })} />
        <select aria-label={t("portPurpose")} className={field} value={group.purpose} onChange={(e) => changeGroup(group.id, { purpose: e.target.value as AudioPortGroup["purpose"] })}><option value="main">{t("main")}</option><option value="aux">Aux</option><option value="sidechain">Sidechain</option><option value="custom">{t("custom")}</option></select>
        <label><input type="radio" name={`main-${group.direction}`} checked={(group.direction === "input" ? graph.audio_interface?.mainInput : graph.audio_interface?.mainOutput) === group.id} onChange={() => update({ ...graph.audio_interface!, [group.direction === "input" ? "mainInput" : "mainOutput"]: group.id })} /> {t(group.direction === "input" ? "mainInput" : "main")}</label>
        <button className={field} onClick={() => { const blocks = (graph.ui_layout.audio_blocks ?? {}) as Record<string, boolean>; onGraphChange({ ...graph, ui_layout: { ...graph.ui_layout, audio_blocks: { ...blocks, [group.id]: blocks[group.id] === false } } }); }}>{(graph.ui_layout.audio_blocks as Record<string, boolean> | undefined)?.[group.id] === false ? t("collapse") : t("expand")}</button>
      </div>)}
    </details>
    <div className="min-h-0 flex-1"><ReteNodeEditor {...props} graph={projection.graph} opcodes={projection.opcodes} onGraphChange={restoreGraph} onSelectionChange={restoreSelection} /></div>
  </div>;
}
