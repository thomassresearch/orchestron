import { PlaybackSourceToggle } from "./PlaybackSourceToggle";
import { useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, SequencerState } from "../../types";
import { sourceKeys } from "../../lib/clipArranger/migration";
import type { SourceKind } from "../../lib/clipArranger/model";
import { AddArrangeTrack } from "../clipArranger/AddArrangeTrack";
import { arrangeCopy } from "../clipArranger/arrangeCopy";
import { clipButtonClass } from "../clipArranger/buttonStyles";
import { LivePadEditorContext } from "../clipArranger/context";
import { usePerformanceEditorState, type PerformViewLayout } from "./PerformanceEditorState";
import { shellCopy, WorkspacePanel, WorkspacePanels } from "./WorkspacePanels";
import type { DeviceEditorRenderer, ViewNavigation } from "./PerformWorkspace";

type PadTarget = { id: string; kind: SourceKind; pad: number };
export type LegacyPadAction = (kind: SourceKind, id: string, pad: number) => void;

/** Temporarily direct physical-pad edits to the selected legacy occurrence. Live retains its own pad. */
export function LegacyArrange({ sequencer, language, add, navigate, renderEditor, onSourceChange, children }: {
  sequencer: SequencerState; language: GuiLanguage; add: (kind: SourceKind) => void; navigate: ViewNavigation;
  onSourceChange: (kind: SourceKind, id: string, enabled: boolean) => void;
  renderEditor: DeviceEditorRenderer; children: (select: LegacyPadAction, open: LegacyPadAction) => ReactNode;
}) {
  const [target, setTarget] = usePerformanceEditorState<PadTarget | null>("arranger", "legacyPad", null);
  const [laneId, setLaneId] = usePerformanceEditorState<string | null>("arranger", "selectedLane", null);
  const [layout, setLayout] = usePerformanceEditorState<PerformViewLayout>("page", "layout", {});
  const shell = useContext(WorkspacePanels);
  const source = (Object.keys(sourceKeys) as SourceKind[]).find(kind => sequencer[sourceKeys[kind]].some(t => t.id === laneId));
  const device = source && sequencer[sourceKeys[source]].find(t => t.id === laneId);
  const [indexes] = usePerformanceEditorState<number[]>(laneId ? `device:${laneId}` : "arranger", "arrangerSelection", []);
  const item = indexes.length === 1 ? device?.padLoopPattern.rootSequence[indexes[0]] : null;
  const pad = item?.type === "pad" ? item.padIndex : !indexes.length && device ? (device.id === target?.id ? target.pad : device.activePad) : null;
  const chosen = device && source && pad !== null ? { kind: source, id: device.id, pad } : null;
  const edited = target && layout.dock === "editor" && sequencer[sourceKeys[target.kind]].some(t => t.id === target.id) ? target : null;
  const handoff = useRef(false);
  const open: LegacyPadAction = (kind, id, pad) => {
    setTarget({ id, kind, pad }); setLaneId(id); setLayout(l => ({ ...l, dock: "editor" }));
  };
  useLayoutEffect(() => {
    if (!edited) return;
    const state = useAppStore.getState(), previous = state.sequencerEditingPads[edited.id];
    handoff.current = false;
    state.selectSequencerEditingPad(edited.id, edited.pad);
    return () => {
      const current = useAppStore.getState();
      if (handoff.current || state.performanceWorkspaceGeneration !== current.performanceWorkspaceGeneration || current.sequencerEditingPads[edited.id] !== edited.pad || !current.sequencer[sourceKeys[edited.kind]].some(t => t.id === edited.id)) return;
      if (previous !== undefined) current.selectSequencerEditingPad(edited.id, previous);
      else {
        const pads = { ...current.sequencerEditingPads }; delete pads[edited.id];
        useAppStore.setState({ sequencerEditingPads: pads });
      }
    };
  }, [edited?.id, edited?.pad]);
  return <>
    <AddArrangeTrack language={language} add={kind => {
      const before = useAppStore.getState().sequencer[sourceKeys[kind]];
      add(kind);
      const created = useAppStore.getState().sequencer[sourceKeys[kind]].find(t => !before.some(old => old.id === t.id));
      if (created) open(kind, created.id, created.activePad);
    }} />
    {children((kind, id, pad) => { if (!edited || edited.kind === kind) setTarget({ kind, id, pad }); }, open)}
    <WorkspacePanel name="editorCommand"><button aria-pressed={!!edited} disabled={!edited && !chosen}
      onClick={() => { if (edited) shell?.closeDock(); else if (chosen) open(chosen.kind, chosen.id, chosen.pad); }}>{shellCopy[language].editor}</button></WorkspacePanel>
    <WorkspacePanel name="inspector">{device && source ? <div className="ws-track-properties"><h3>{device.name}</h3>
      {shell?.trackRouting(device.id, source)}
      {!("playbackMode" in device && device.playbackMode === "live") && <PlaybackSourceToggle language={language} arrangement={device.padLoopEnabled}
        hasArrangement={device.padLoopPattern.rootSequence.length > 0} onChange={enabled => onSourceChange(source, device.id, enabled)} />}
      {chosen && <><p>Pad {chosen.pad + 1}</p><button className={clipButtonClass("edit")} onClick={() => {
        handoff.current = edited?.id === chosen.id;
        navigate("live", chosen);
      }}>{arrangeCopy(language).editPad}</button></>}</div> : <p>{shellCopy[language].select}</p>}</WorkspacePanel>
    {edited && <WorkspacePanel name="editor"><h3>{sequencer[sourceKeys[edited.kind]].find(t => t.id === edited.id)?.name} / Pad {edited.pad + 1}</h3>
      <LivePadEditorContext.Provider value><div key={edited.id + ":" + edited.pad}>{renderEditor(edited.kind, edited.id, sequencer)}</div></LivePadEditorContext.Provider></WorkspacePanel>}
  </>;
}
