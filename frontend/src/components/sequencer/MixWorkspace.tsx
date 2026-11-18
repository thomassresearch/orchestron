import { useLayoutEffect, type ReactNode } from "react";
import { audioCopy } from "../../lib/audioCopy";
import { MASTER, defaultStrip, stripDestinations } from "../../lib/audioRouting";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { MixerBody, editMixerPatch } from "../PerformMixer";
import { PerformanceControllerRack, PerformanceControllerSyncStatus } from "./PerformanceControllerRack";
import { RetainedScroll, usePerformanceEditorState, type PerformViewLayout } from "./PerformanceEditorState";
import { SampleMapEditor } from "./SamplePlayerRack";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import { WorkspacePanel, shellCopy } from "./WorkspacePanels";
import type { MixSurface } from "./PerformWorkspace";
import { mixCopy } from "./mixCopy";

export function MixWorkspace({ language, running, onStop, onAdd, rack }: {
  language: GuiLanguage; running: boolean; onStop: () => void; onAdd: () => void; rack: ReactNode;
}) {
  const audio = audioCopy(language), copy = mixCopy(language), ui = SEQUENCER_UI_COPY[language];
  const [surface, setSurface] = usePerformanceEditorState<MixSurface>("mixer", "surface", "mixer");
  const [selected] = usePerformanceEditorState("mixer", "selected", "");
  const [layout, setLayout] = usePerformanceEditorState<PerformViewLayout>("page", "layout", {});
  const bindings = useAppStore(s => s.sequencerInstruments);
  const patches = useAppStore(s => s.patches);
  const graph = useAppStore(s => s.audioGraph);
  const strip = useAppStore(s => s.mixer.strips[selected]) ?? defaultStrip();
  const binding = bindings.find(b => b.id === selected);
  const patch = patches.find(p => p.id === binding?.patchId);
  const master = selected === MASTER;
  const capable = !!binding && !!patch?.has_sample_player && !patch.always_on;
  const number = binding ? bindings.indexOf(binding) + 1 : 0;
  const channel = patch?.always_on ? audio("continuous") : `${audio("midiChannelShort")} ${binding?.midiChannel}`;
  const name = patch?.name ?? binding?.patchId ?? audio("missing");
  const instanceLabel = `${ui.patch(number)} · ${name} · ${channel}`;
  const dock = layout.dock;
  const insertOwner = graph.insertOwners[selected];
  const endpointName = (id: string) => {
    if (id === MASTER) return audio("master");
    if (id === "$output") return audio(master ? "audioOutput" : "direct");
    const endpoint = bindings.find(row => row.id === id);
    return patches.find(p => p.id === endpoint?.patchId)?.name ?? id;
  };
  const switchSurface = (next: MixSurface) => {
    setSurface(next);
    setLayout(previous => ({ ...previous, dock: null, dockExpanded: false, drawerOpen: false }));
  };
  const open = (next: "instrument" | "samples") => setLayout(previous => ({ ...previous, dock: next, drawerOpen: false }));
  useLayoutEffect(() => {
    if (dock && (!binding || (dock === "samples" && !capable))) {
      setLayout(previous => ({ ...previous, dock: null, dockExpanded: false }));
    }
  }, [binding, capable, dock, setLayout]);
  const details = binding && <>
    <button type="button" data-mix-detail="instrument" aria-expanded={dock === "instrument"} onClick={() => open("instrument")}>{copy("instrument")}</button>
    {capable && <button type="button" data-mix-detail="samples" aria-expanded={dock === "samples"} onClick={() => open("samples")}>{copy("samples")}</button>}
  </>;
  return <div className="ws-mix">
    <div className="ws-mix-tools">
      <nav aria-label={audio("mixer")}>
        {(["mixer", "rack", "routing"] as const).map(item => <button key={item} type="button" aria-pressed={surface === item}
          onClick={() => { if (surface !== item) switchSurface(item); }}>{item === "mixer" ? audio("mixer") : copy(item)}</button>)}
      </nav>
      {surface === "rack" ? <>
        <button type="button" onClick={onAdd} disabled={running}>{ui.addInstrument}</button>
        {running && <button type="button" onClick={onStop}>{copy("stopRack")}</button>}
      </> : <button type="button" onClick={() => switchSurface("rack")}>{copy("manage")}</button>}
      {details}
    </div>
    {surface === "mixer" ? <MixerBody onStop={onStop} surface="mixer" onShowRouting={() => switchSurface("routing")} /> :
      <RetainedScroll key={surface} owner="mixer" field={surface + "Scroll"} className="ws-mix-page">
        {surface === "rack" ? rack : <MixerBody onStop={onStop} surface="routing" />}
      </RetainedScroll>}
    <WorkspacePanel name="inspector">
      {binding || master ? <>
        <h3>{master ? audio("master") : name}</h3>
        {binding && <p>{ui.patch(number)} · {channel}</p>}
        {insertOwner ? <p>{audio("inserts")} · {endpointName(insertOwner)}</p> : <>
          <p>{audio("destination")} · {stripDestinations(selected, patch, graph).map(endpointName).join(", ") || "—"}</p>
          <p>{audio("gain")} · {strip.gainDb ?? "−∞"} dB</p>
          <p>{audio("balance")} · {strip.balance}</p>
        </>}
        <div className="ws-mix-actions">{details}<button onClick={() => switchSurface("routing")}>{copy("routing")}</button>
          {binding && <button disabled={!patch} onClick={() => patch && void editMixerPatch(patch.id)}>{audio("edit")}</button>}</div>
      </> : <p>{shellCopy[language].select}</p>}
    </WorkspacePanel>
    {binding && (dock === "instrument" || (dock === "samples" && capable)) && <WorkspacePanel name="editor">
      <div key={JSON.stringify([binding.id, binding.patchId, dock])} data-mix-detail-instance={binding.id}>
        {dock === "samples" ? <SampleMapEditor binding={binding} label={instanceLabel} capable={capable} running={running} language={language} /> : <>
          <h3>{instanceLabel}</h3>
          <PerformanceControllerSyncStatus language={language} />
          <PerformanceControllerRack binding={binding} patch={patch} language={language} />
          {!patch?.performance_controllers?.length && <p>{copy("noControls")}</p>}
          <div className="ws-mix-actions">{capable && <button onClick={() => open("samples")}>{copy("samples")}</button>}
            <button onClick={() => patch && void editMixerPatch(patch.id)} disabled={!patch}>{audio("edit")}</button></div>
        </>}
      </div>
    </WorkspacePanel>}
  </div>;
}
