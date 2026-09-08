import { useState } from "react";
import { addControlFlowCase, arrangeControlFlowCases, branchCollapsed, changeControlFlowFormat, connectionText,
  deleteControlFlowCase, moveNodesToCase, ROOT_ONLY_OPCODES, setBranchCollapsed, silenceControlFlowCase, updateControlFlowBlock } from "../lib/controlFlow";
import { controlFlowCopy } from "../lib/controlFlowCopy";
import { readInputFormulaMap } from "../lib/graphFormula";
import type { ControlFlowBlock, GuiLanguage, OpcodeSpec, PatchGraph } from "../types";
import { ConfirmationListDialog } from "./ConfirmationListDialog";

const field = "rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100";
const button = "rounded border border-purple-500/50 px-2 py-1 text-xs text-purple-100 hover:bg-purple-500/20 disabled:opacity-30";

interface Props {
  graph: PatchGraph;
  language: GuiLanguage;
  opcodes: OpcodeSpec[];
  selectedNodeIds: string[];
  activeBlockId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActiveBlock: (id: string) => void;
  onChange: (graph: PatchGraph) => void;
}

export function ControlFlowPanel({ graph, language, opcodes, selectedNodeIds, activeBlockId, open, onOpenChange, onActiveBlock, onChange }: Props) {
  const t = controlFlowCopy(language);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ graph: PatchGraph; items: string[] } | null>(null);
  const blocks = Object.entries(graph.control_flow ?? {});
  const blockId = blocks.some(([id]) => id === activeBlockId) ? activeBlockId : blocks[0]?.[0];
  const block = graph.control_flow?.[blockId];
  if (!block) return null;
  const node = graph.nodes.find((n) => n.id === blockId)!;

  const change = (operation: () => PatchGraph) => {
    try { const next = operation(); onChange(next); setError(""); } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
  };
  const review = (operation: () => PatchGraph, summary: string) => {
    try {
      const next = operation(); const nodes = new Set(next.nodes.map((n) => n.id));
      const links = new Set(next.connections.map(connectionText)); const formulas = readInputFormulaMap(next.ui_layout);
      setPending({ graph: next, items: [summary,
        ...graph.nodes.filter((n) => !nodes.has(n.id)).map((n) => `${n.opcode} · ${n.id}`),
        ...graph.connections.filter((c) => !links.has(connectionText(c))).map(connectionText),
        ...Object.keys(readInputFormulaMap(graph.ui_layout)).filter((key) => !formulas[key]).map((key) => `ƒ ${key}`)] });
      setError("");
    } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
  };
  const numericParam = (id: "lhs" | "rhs" | "selector") => <label key={id} className="flex items-center gap-2 text-xs">
    {t(id)}<input key={`${node.id}:${id}:${node.params[id]}`} className={`${field} w-24`} type="number" step="any" aria-label={t(id)}
      title={t("connected")} defaultValue={Number(node.params[id] ?? 0)} onBlur={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value)) change(() => ({ ...graph, nodes: graph.nodes.map((n) => n.id === node.id ? { ...n, params: { ...n.params, [id]: value } } : n) }));
      }} />
  </label>;
  return <details open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)} className="max-h-52 shrink-0 overflow-auto rounded-lg border border-purple-800/60 bg-slate-900/80 p-2 text-slate-200">
    <summary className="cursor-pointer text-xs font-semibold">{t("title")} · {t("noteStart")}</summary>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select className={field} aria-label={t("configure")} value={blockId} onChange={(e) => onActiveBlock(e.target.value)}>
        {blocks.map(([id, value], i) => <option key={id} value={id}>{value.kind === "if" ? "If" : "Switch"} {i + 1} · {value.cases.map((c) => c.name).join(" / ")}</option>)}
      </select>
      <button className={button} onClick={() => change(() => setBranchCollapsed(graph, blockId, !branchCollapsed(graph, blockId)))}>{t(branchCollapsed(graph, blockId) ? "expand" : "collapse")}</button>
      <label className="text-xs">{t("format")} <select className={field} value={block.output_format} aria-label={t("format")}
        onChange={(e) => review(() => changeControlFlowFormat(graph, blockId, e.target.value as ControlFlowBlock["output_format"]), `${t("format")}: ${block.output_format} → ${e.target.value}`)}>
        <option value="mono">{t("mono")}</option><option value="stereo">{t("stereo")}</option>
      </select></label>
      {block.kind === "if" ? <>{numericParam("lhs")}<select className={field} aria-label={t("operator")} value={block.operator}
        onChange={(e) => change(() => updateControlFlowBlock(graph, blockId, { operator: e.target.value as ControlFlowBlock["operator"] }))}>
        {["==", "!=", "<", "<=", ">", ">="].map((op) => <option key={op}>{op}</option>)}
      </select>{numericParam("rhs")}</> : numericParam("selector")}
      <label className="text-xs">{t("move")} <select aria-label={t("move")} className={field} value="" disabled={!selectedNodeIds.length}
        onChange={(e) => change(() => moveNodesToCase(graph, selectedNodeIds, e.target.value === "main" ? null : { blockId, caseId: e.target.value }))}>
        <option value="">—</option><option value="main">{t("mainGraph")}</option>
        {block.cases.filter((c) => !c.silence).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
    </div>
    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
      {block.cases.map((item, index) => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-700 px-2 py-1.5">
        <input key={`${item.id}:${item.name}`} className={`${field} w-32`} aria-label={`${t("caseName")} ${index + 1}`} defaultValue={item.name}
          onBlur={(e) => change(() => updateControlFlowBlock(graph, blockId, { cases: block.cases.map((c) => c.id === item.id ? { ...c, name: e.target.value } : c) }))} />
        {block.kind === "switch" && index < block.cases.length - 1 ? <input key={`${item.id}:${item.value}`} className={`${field} w-20`} type="number" step="any"
          aria-label={`${t("value")} ${index + 1}`} defaultValue={item.value ?? 0}
          onBlur={(e) => change(() => updateControlFlowBlock(graph, blockId, { cases: block.cases.map((c) => c.id === item.id ? { ...c, value: e.target.valueAsNumber } : c) }))} />
          : <span className="text-xs text-purple-200">{t(block.kind === "if" ? index === 0 ? "true" : "false" : "default")}</span>}
        <select className={field} aria-label={`${item.name} ${t("synthesis")}`} value={item.silence ? "silence" : "synthesis"}
          onChange={(e) => e.target.value === "silence" ? review(() => silenceControlFlowCase(graph, blockId, item.id, true), `${item.name} → ${t("silence")}`)
            : change(() => silenceControlFlowCase(graph, blockId, item.id, false))}>
          <option value="synthesis">{t("synthesis")}</option><option value="silence">{t("silence")}</option>
        </select>
        {!item.silence && <select className={`${field} max-w-44`} aria-label={`${t("addNode")} ${item.name}`} value="" onChange={(e) => change(() => {
          const spec = opcodes.find((s) => s.name === e.target.value)!;
          const id = crypto.randomUUID(); const result = graph.nodes.find((n) => n.id === item.result_node_id)!;
          const next = { ...graph, nodes: [...graph.nodes, { id, opcode: spec.name, params: Object.fromEntries(spec.inputs.filter((p) => p.default != null).map((p) => [p.id, p.default!])), position: { x: result.position.x - 500, y: result.position.y } }] };
          return moveNodesToCase(next, [id], { blockId, caseId: item.id });
        })}>
          <option value="">{t("addNode")}</option>{opcodes.filter((s) => !ROOT_ONLY_OPCODES.has(s.name) && !s.name.startsWith("__")).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>}
        {block.kind === "switch" && index < block.cases.length - 1 && <>
          {([-1, 1] as const).map((direction) => <button key={direction} className={button} aria-label={`${t(direction < 0 ? "up" : "down")} ${item.name}`}
            disabled={index + direction < 0 || index + direction >= block.cases.length - 1} onClick={() => change(() => {
              const cases = [...block.cases]; [cases[index], cases[index + direction]] = [cases[index + direction], cases[index]];
              return arrangeControlFlowCases(updateControlFlowBlock(graph, blockId, { cases }), blockId);
            })}>{direction < 0 ? "↑" : "↓"}</button>)}
          <button className={button} disabled={block.cases.length <= 2} onClick={() => review(() => deleteControlFlowCase(graph, blockId, item.id), `${t("remove")}: ${item.name}`)}>{t("remove")}</button>
        </>}
      </div>)}
    </div>
    {block.kind === "switch" && <button className={`${button} mt-2`} onClick={() => change(() => addControlFlowCase(graph, blockId))}>{t("addCase")}</button>}
    {error && <p role="alert" className="mt-2 whitespace-pre-wrap text-xs text-rose-300">{t("invalid")}<br />{error}</p>}
    {pending && <ConfirmationListDialog ariaLabel={t("review")} title={t("review")} description={t("review")} items={pending.items}
      cancelLabel={t("cancel")} confirmLabel={t("apply")} onCancel={() => setPending(null)} onConfirm={() => { onChange(pending.graph); setPending(null); }} />}
  </details>;
}
