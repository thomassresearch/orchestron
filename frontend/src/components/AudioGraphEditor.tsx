import { useCallback, useMemo, useRef } from "react";
import { audioCopy } from "../lib/audioCopy";
import { projectAudioBlocks } from "../lib/audioBlocks";
import { STEREO_INPUT, STEREO_OUTPUT } from "../lib/stereoCatalog";
import { ReteNodeEditor, type ReteNodeEditorProps } from "./ReteNodeEditor";
import { StereoInterfacePanel } from "./StereoInterfacePanel";

export function AudioGraphEditor(props: ReteNodeEditorProps & { patchId?: string | null; onDeleteAudioGroup: (id: string) => void }) {
  const { graph, onGraphChange } = props; const t = audioCopy(props.guiLanguage);
  const projection = useMemo(() => projectAudioBlocks(graph, { input: t("stereoInput"), output: t("stereoOutput") }, props.opcodes), [graph, props.opcodes, props.guiLanguage]);
  const latest = useRef({ projection, onGraphChange, onSelectionChange: props.onSelectionChange, onOpcodeHelpRequest: props.onOpcodeHelpRequest });
  latest.current = { projection, onGraphChange, onSelectionChange: props.onSelectionChange, onOpcodeHelpRequest: props.onOpcodeHelpRequest };
  const restoreGraph = useCallback<ReteNodeEditorProps["onGraphChange"]>((next) => {
    latest.current.onGraphChange(latest.current.projection.restore(next));
  }, []);
  const restoreSelection = useCallback<ReteNodeEditorProps["onSelectionChange"]>((selection) => {
    const { projection, onSelectionChange } = latest.current;
    onSelectionChange({ nodeIds: selection.nodeIds.flatMap((id) => projection.members.get(id)?.map((n) => n.id) ?? [id]), connections: selection.connections.map(projection.restoreConnection) });
  }, []);
  const help = useCallback<NonNullable<ReteNodeEditorProps["onOpcodeHelpRequest"]>>((name) => {
    const { projection, onOpcodeHelpRequest } = latest.current;
    const block = projection.graph.nodes.find((n) => n.opcode === name && projection.members.has(n.id));
    const members = block && projection.members.get(block.id);
    onOpcodeHelpRequest?.(members ? members[0].opcode === "inleta" ? STEREO_INPUT : STEREO_OUTPUT : name);
  }, []);
  return <div className="flex h-full flex-col gap-2">
    <StereoInterfacePanel key={props.viewportKey} graph={graph} guiLanguage={props.guiLanguage} patchId={props.patchId} onGraphChange={onGraphChange} onDeleteAudioGroup={props.onDeleteAudioGroup} />
    <div className="min-h-0 flex-1"><ReteNodeEditor {...props} graph={projection.graph} opcodes={projection.opcodes} onGraphChange={restoreGraph} onSelectionChange={restoreSelection} onOpcodeHelpRequest={help} /></div>
  </div>;
}
