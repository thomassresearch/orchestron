import { useState } from "react";
import { audioCopy } from "../lib/audioCopy";
import { stereoCopy } from "../lib/stereoCopy";
import { AudioBlockError, audioPortName, audioPorts, executeStereoCommand, renameStereoBlock, resolveStereoMembers, type AudioDirection, type StereoCommand } from "../lib/audioBlocks";
import { useAppStore } from "../store/useAppStore";
import { ConfirmationListDialog } from "./ConfirmationListDialog";
import type { AudioPortGroup, GuiLanguage, PatchGraph } from "../types";

const field = "rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs";
type Props = {
  graph: PatchGraph;
  guiLanguage: GuiLanguage;
  patchId?: string | null;
  onGraphChange: (graph: PatchGraph) => void;
  onDeleteAudioGroup: (id: string) => void;
};
type Preview = { before: PatchGraph; next: PatchGraph; items: string[]; routeNotice: boolean };

function ChannelNames({ group, language, onApply }: { group: AudioPortGroup; language: GuiLanguage; onApply: (names: [string, string]) => void }) {
  const copy = stereoCopy(language);
  const [names, setNames] = useState<[string, string]>([group.ports[0], group.ports[1]]);
  const dirty = names.some((name, i) => name !== group.ports[i]);
  return <div className="flex flex-wrap items-center gap-2">
    {(["left", "right"] as const).map((side, i) => <label key={side}>{copy(side)} <input className={`${field} w-32 font-mono`} value={names[i]} onChange={(event) => setNames(i === 0 ? [event.target.value, names[1]] : [names[0], event.target.value])} /></label>)}
    {dirty && <><button className={field} onClick={() => onApply(names)}>{copy("apply")}</button><button className={field} onClick={() => setNames([group.ports[0], group.ports[1]])}>{copy("cancel")}</button></>}
  </div>;
}

export function StereoInterfacePanel({ graph, guiLanguage, patchId, onGraphChange, onDeleteAudioGroup }: Props) {
  const t = audioCopy(guiLanguage), copy = stereoCopy(guiLanguage);
  const bindings = useAppStore((s) => s.sequencerInstruments);
  const routes = useAppStore((s) => s.audioGraph.routes);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [direction, setDirection] = useState<AudioDirection>("output");
  const [pair, setPair] = useState<[string, string]>(["", ""]);
  const [repairId, setRepairId] = useState<string | undefined>();
  const [outsId, setOutsId] = useState("");
  const showError = (error: unknown) => setError(error instanceof AudioBlockError ? copy(error.code) : String(error));
  const changeGroup = (id: string, changes: Partial<AudioPortGroup>) => {
    onGraphChange({ ...graph, audio_interface: { ...graph.audio_interface!, groups: graph.audio_interface!.groups.map((g) => g.id === id ? { ...g, ...changes } : g) } });
  };
  const review = (operation: () => PatchGraph) => {
    setError(null);
    try {
      const next = operation();
      const items: string[] = [];
      for (const node of graph.nodes) if (!next.nodes.some((n) => n.id === node.id)) items.push(`− ${node.opcode} (${node.id})`);
      for (const node of next.nodes) if (!graph.nodes.some((n) => n.id === node.id)) items.push(`+ ${node.opcode} (${audioPortName(next, node) ?? node.id})`);
      for (const group of next.audio_interface?.groups ?? []) {
        const previous = graph.audio_interface?.groups.find((g) => g.id === group.id);
        if (JSON.stringify(previous) !== JSON.stringify(group)) items.push(`${t("mapping")}: ${previous?.ports.join(" / ") ?? "∅"} → ${group.ports.join(" / ")}`);
      }
      const lostInput = audioPorts(graph, "input").filter((p) => !audioPorts(next, "input").includes(p));
      const lostOutput = audioPorts(graph, "output").filter((p) => !audioPorts(next, "output").includes(p));
      const ids = new Set(bindings.filter((b) => b.patchId === patchId).map((b) => b.id));
      const affected = routes.filter((r) => (ids.has(r.sourceId) && lostOutput.includes(r.sourcePort)) || (ids.has(r.targetId) && (r.targetStage === "strip" ? lostOutput : lostInput).includes(r.targetPort)));
      const routeNotice = lostInput.length > 0 || lostOutput.length > 0 || graph.nodes.some((n) => n.opcode === "outs" && !next.nodes.some((m) => m.id === n.id));
      if (routeNotice) {
        items.push(`${copy("routes")}: ${affected.length ? affected.length : copy("noRoutes")}`);
        items.push(...affected.map((r) => `${r.sourceId}.${r.sourcePort} → ${r.targetId}.${r.targetPort}`));
      }
      setPreview({ before: graph, next, items, routeNotice });
    } catch (error) { showError(error); }
  };
  const command = (command: StereoCommand) => review(() => executeStereoCommand(graph, command));
  const candidates = graph.nodes.filter((n) => n.opcode === (direction === "input" ? "inleta" : "outleta"));
  const directNodes = graph.nodes.filter((n) => n.opcode === "outs");
  const selectedRepair = graph.audio_interface?.groups.find((g) => g.id === repairId);
  return <details className="max-h-72 overflow-y-auto rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">
    <summary>{t("stereoInput")} / {t("stereoOutput")} · {t("mapping")}</summary>
    <div className="my-2 flex flex-wrap gap-2">{(["input", "output"] as const).map((direction) => <button key={direction} className={field} onClick={() => onGraphChange(executeStereoCommand(graph, { kind: "create", direction }))}>+ {t(direction === "input" ? "stereoInput" : "stereoOutput")}</button>)}</div>
    {graph.audio_interface && <label>{t("role")} <select className={field} value={graph.audio_interface.role} onChange={(e) => onGraphChange({ ...graph, audio_interface: { ...graph.audio_interface!, role: e.target.value as NonNullable<PatchGraph["audio_interface"]>["role"] } })}>{(["instrument", "effect", "output", "custom"] as const).map((role) => <option key={role} value={role}>{t(role)}</option>)}</select></label>}
    {graph.audio_interface?.groups.map((group) => {
      const isDirect = group.direction === "output" && group.ports.every((p) => ["$direct.left", "$direct.right"].includes(p));
      const resolution = resolveStereoMembers(graph, group);
      const issue = group.layout === "stereo" && !(isDirect && directNodes.length) ? resolution.issue : undefined;
      const stereo = group.layout === "stereo" && !isDirect;
      const blocks = (graph.ui_layout.audio_blocks ?? {}) as Record<string, boolean>;
      return <div key={group.id} className="my-2 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <span>{t(group.direction === "input" ? "stereoInput" : "stereoOutput")}</span>
        <input aria-label={t("groupName")} className={field} value={group.name} onChange={(e) => changeGroup(group.id, { name: e.target.value })} />
        <select aria-label={t("layout")} className={field} value={group.layout} onChange={(e) => {
          const layout = e.target.value as AudioPortGroup["layout"];
          // A mono group describes its first channel; both underlying nodes survive.
          changeGroup(group.id, { layout, ports: layout === "mono" ? group.ports.slice(0, 1) : group.ports });
        }}><option value="mono">Mono</option><option value="stereo" disabled={group.ports.length !== 2}>Stereo</option><option value="custom">{t("custom")}</option></select>
        {stereo && !issue ? <ChannelNames key={`${group.id}:${JSON.stringify(group.ports)}`} group={group} language={guiLanguage} onApply={(names) => review(() => renameStereoBlock(graph, group.id, names))} /> : isDirect || issue ? <span className="font-mono">{group.ports.join(" / ")}</span> : <input aria-label={t("mapping")} className={`${field} w-48 font-mono`} value={group.ports.join(", ")} onChange={(e) => changeGroup(group.id, { ports: e.target.value.split(",").map((s) => s.trim()) })} />}
        <select aria-label={t("portPurpose")} className={field} value={group.purpose} onChange={(e) => changeGroup(group.id, { purpose: e.target.value as AudioPortGroup["purpose"] })}>{(["main", "aux", "sidechain", "custom"] as const).map((purpose) => <option key={purpose} value={purpose}>{purpose === "main" ? t("main") : purpose === "custom" ? t("custom") : purpose}</option>)}</select>
        <label><input type="radio" name={`main-${group.direction}`} checked={(group.direction === "input" ? graph.audio_interface?.mainInput : graph.audio_interface?.mainOutput) === group.id} onChange={() => onGraphChange({ ...graph, audio_interface: { ...graph.audio_interface!, [group.direction === "input" ? "mainInput" : "mainOutput"]: group.id } })} /> {t(group.direction === "input" ? "mainInput" : "main")}</label>
        {stereo && !issue && <button className={field} onClick={() => onGraphChange({ ...graph, ui_layout: { ...graph.ui_layout, audio_blocks: { ...blocks, [group.id]: blocks[group.id] === false } } })}>{blocks[group.id] === false ? t("collapse") : t("expand")}</button>}
        <button className={field} onClick={() => onDeleteAudioGroup(group.id)}>{stereo && !issue ? t("remove") : copy("removeMapping")}</button>
        {issue && <div className="w-full text-amber-300"><span>{copy(issue)}</span> <button className={field} onClick={() => { setRepairId(group.id); setDirection(group.direction); setPair(["", ""]); }}>{copy("repair")}</button></div>}
      </div>;
    })}
    <div className="my-2 border-t border-slate-700 pt-2">
      <div className="mb-2">{selectedRepair ? `${copy("repair")}: ${selectedRepair.name}` : copy("groupExisting")}</div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t("role")} className={field} value={direction} disabled={!!selectedRepair} onChange={(e) => { setDirection(e.target.value as AudioDirection); setPair(["", ""]); }}>{(["input", "output"] as const).map((d) => <option key={d} value={d}>{t(d === "input" ? "stereoInput" : "stereoOutput")}</option>)}</select>
        {(["left", "right"] as const).map((side, i) => <label key={side}>{copy(side)} <select className={`${field} max-w-60`} value={pair[i]} onChange={(e) => setPair(i === 0 ? [e.target.value, pair[1]] : [pair[0], e.target.value])}><option value="">{copy("choose")}</option>{candidates.map((n) => <option key={n.id} value={n.id}>{audioPortName(graph, n) ?? "?"} ({n.id})</option>)}</select></label>)}
        <button className={field} disabled={!pair[0] || !pair[1]} onClick={() => command({ kind: "group", direction, nodeIds: pair, groupId: selectedRepair?.id })}>{copy("groupExisting")}</button>
        {selectedRepair && <><button className={field} onClick={() => command({ kind: "repair", groupId: selectedRepair.id })}>{copy("createMissing")}</button><button className={field} onClick={() => { setRepairId(undefined); setPair(["", ""]); }}>{copy("cancel")}</button></>}
      </div>
    </div>
    {!!directNodes.length && <div className="my-2 flex flex-wrap gap-2 border-t border-slate-700 pt-2"><select aria-label={copy("convert")} className={field} value={outsId} onChange={(e) => setOutsId(e.target.value)}><option value="">{copy("choose")}</option>{directNodes.map((n) => <option key={n.id} value={n.id}>outs ({n.id})</option>)}</select><button className={field} disabled={!outsId} onClick={() => command({ kind: "convert", nodeId: outsId })}>{copy("convert")}</button></div>}
    {error && <p role="alert" className="my-2 text-rose-300">{error}</p>}
    {preview && preview.before === graph && <ConfirmationListDialog ariaLabel={copy("preview")} title={copy("preview")} description={preview.routeNotice ? copy("routeNotice") : t("mapping")} items={preview.items} cancelLabel={copy("cancel")} confirmLabel={copy("apply")} confirmTone="accent" onCancel={() => setPreview(null)} onConfirm={() => { onGraphChange(preview.next); setPreview(null); setRepairId(undefined); setPair(["", ""]); setOutsId(""); }} />}
  </details>;
}
