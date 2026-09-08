import { useCallback, useMemo, useRef, useState } from "react";
import { audioCopy } from "../lib/audioCopy";
import { projectAudioBlocks } from "../lib/audioBlocks";
import { STEREO_INPUT, STEREO_OUTPUT } from "../lib/stereoCatalog";
import { ReteNodeEditor, type ReteNodeEditorProps } from "./ReteNodeEditor";
import { StereoInterfacePanel } from "./StereoInterfacePanel";
import { ControlFlowPanel } from "./ControlFlowPanel";
import { projectControlFlow } from "../lib/controlFlowProjection";
import { branchCollapsed, controlFlowConditionLabel, controlFlowIssues, setBranchCollapsed } from "../lib/controlFlow";
import { controlFlowCopy } from "../lib/controlFlowCopy";

export function AudioGraphEditor(props: ReteNodeEditorProps & { patchId?: string | null; onDeleteAudioGroup: (id: string) => void }) {
  const { graph, onGraphChange } = props; const t = audioCopy(props.guiLanguage);
  const flowCopy = controlFlowCopy(props.guiLanguage);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [activeBlockId, setActiveBlockId] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const error = useMemo(() => controlFlowIssues(graph).join("\n"), [graph]);
  const audioProjection = useMemo(() => projectAudioBlocks(graph, { input: t("stereoInput"), output: t("stereoOutput") }, props.opcodes), [graph, props.opcodes, props.guiLanguage]);
  const projection = useMemo(() => projectControlFlow(audioProjection.graph, audioProjection.opcodes), [audioProjection]);
  const latest = useRef({ projection, audioProjection, graph, onGraphChange, onSelectionChange: props.onSelectionChange, onOpcodeHelpRequest: props.onOpcodeHelpRequest });
  latest.current = { projection, audioProjection, graph, onGraphChange, onSelectionChange: props.onSelectionChange, onOpcodeHelpRequest: props.onOpcodeHelpRequest };
  const restoreGraph = useCallback<ReteNodeEditorProps["onGraphChange"]>((next) => {
    const value = latest.current.audioProjection.restore(latest.current.projection.restore(next));
    // Wiring errors remain visible and compilable to diagnostics; explicit scope moves validate before applying.
    latest.current.onGraphChange(value);
  }, []);
  const canonicalSelection = useCallback<NonNullable<ReteNodeEditorProps["selectionMapping"]>["canonical"]>((selection) => {
    const { projection, audioProjection } = latest.current;
    return { nodeIds: selection.nodeIds.flatMap((id) => audioProjection.members.get(id)?.map((n) => n.id) ?? [id]),
      connections: selection.connections.map(projection.restoreConnection).map(audioProjection.restoreConnection) };
  }, []);
  const displaySelection = useCallback<NonNullable<ReteNodeEditorProps["selectionMapping"]>["display"]>((selection) => {
    const { graph, projection, audioProjection } = latest.current;
    const present = new Set(graph.nodes.map((n) => n.id));
    const links = new Set(graph.connections.map((c) => JSON.stringify(c)));
    return { nodeIds: [...new Set(selection.nodeIds.filter((id) => present.has(id)).map((id) =>
      [...audioProjection.members].find(([, nodes]) => nodes.some((n) => n.id === id))?.[0] ?? id))],
      connections: selection.connections.filter((c) => links.has(JSON.stringify(c))).map(audioProjection.projectConnection).map(projection.projectConnection) };
  }, []);
  const restoreSelection = useCallback<ReteNodeEditorProps["onSelectionChange"]>((selection) => {
    const { projection, audioProjection, onSelectionChange } = latest.current;
    const nodeIds = selection.nodeIds.flatMap((id) => audioProjection.members.get(id)?.map((n) => n.id) ?? [id]);
    setSelectedNodeIds(nodeIds);
    onSelectionChange({ nodeIds, connections: selection.connections.map(projection.restoreConnection).map(audioProjection.restoreConnection) });
  }, []);
  const help = useCallback<NonNullable<ReteNodeEditorProps["onOpcodeHelpRequest"]>>((name) => {
    const { audioProjection: projection, onOpcodeHelpRequest, graph } = latest.current;
    if (name.startsWith("__branch_") || name.startsWith("__result_")) {
      const node = graph.nodes.find((n) => name === `__branch_${n.id}` || name === `__result_${n.id}`);
      onOpcodeHelpRequest?.(node?.opcode === "If" ? "If" : "Switch"); return;
    }
    const block = projection.graph.nodes.find((n) => n.opcode === name && projection.members.has(n.id));
    const members = block && projection.members.get(block.id);
    onOpcodeHelpRequest?.(members ? members[0].opcode === "inleta" ? STEREO_INPUT : STEREO_OUTPUT : name);
  }, []);
  const nodeTitles: Record<string, string> = {};
  const regions: NonNullable<ReteNodeEditorProps["regions"]> = [];
  for (const [id, block] of Object.entries(graph.control_flow ?? {})) {
    nodeTitles[id] = `${controlFlowConditionLabel(graph, id)}\n${flowCopy("noteStart")}\n${block.cases.map((c) => `${c.value !== null ? `${c.value} ` : ""}${c.name}`).join(" / ")}`;
    const origin = graph.nodes.find((n) => n.id === id)!.position;
    block.cases.forEach((item, index) => {
      nodeTitles[item.result_node_id] = `${flowCopy(item.silence ? "silence" : "result")} · ${item.name}`;
      if (!branchCollapsed(graph, id)) regions.push({ id: `${id}:${item.id}`,
        title: `${item.name}${block.kind === "switch" && item.value !== null ? ` · ${item.value}` : ""} · ${flowCopy(item.silence ? "silence" : "synthesis")}`,
        nodeIds: item.node_ids,
        anchor: { x: origin.x + 20, y: graph.nodes.find((n) => n.id === item.result_node_id)?.position.y ?? origin.y + 220 + index * 350 } });
    });
  }
  return <div className="flex h-full flex-col gap-2">
    <StereoInterfacePanel key={`stereo:${props.viewportKey}`} graph={graph} guiLanguage={props.guiLanguage} patchId={props.patchId} onGraphChange={onGraphChange} onDeleteAudioGroup={props.onDeleteAudioGroup} />
    <ControlFlowPanel key={`flow:${props.viewportKey}`} graph={graph} language={props.guiLanguage} opcodes={props.opcodes} selectedNodeIds={selectedNodeIds}
      activeBlockId={activeBlockId} open={panelOpen} onOpenChange={setPanelOpen} onActiveBlock={setActiveBlockId} onChange={onGraphChange} />
    {error && <p role="alert" className="max-h-16 overflow-auto whitespace-pre-wrap text-xs text-rose-300">{flowCopy("invalid")} {error}</p>}
    <div className="min-h-0 flex-1"><ReteNodeEditor {...props} graph={projection.graph} opcodes={projection.opcodes} onGraphChange={restoreGraph} onSelectionChange={restoreSelection} onOpcodeHelpRequest={help}
      nodeTitles={nodeTitles} regions={regions} selectionMapping={{ canonical: canonicalSelection, display: displaySelection }} readOnlyInputs={projection.readOnlyInputs} readOnlyInputLabel={flowCopy("expandToEdit")}
      renderNodeActions={(id) => graph.control_flow?.[id] ? <div className="flex gap-1" onPointerDownCapture={(e) => e.stopPropagation()}>
        <button className="rounded border border-purple-400 bg-slate-900 px-1 py-0.5 text-[10px] text-purple-100" onClick={() => {
          const current = latest.current;
          current.onGraphChange(setBranchCollapsed(current.graph, id, !branchCollapsed(current.graph, id)));
        }}>{flowCopy(branchCollapsed(graph, id) ? "expand" : "collapse")}</button>
        <button className="rounded border border-purple-400 bg-slate-900 px-1 py-0.5 text-[10px] text-purple-100" onClick={() => { setActiveBlockId(id); setPanelOpen(true); }}>{flowCopy("configure")}</button>
      </div> : null} /></div>
  </div>;
}
