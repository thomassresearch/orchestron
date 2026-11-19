import { useRackSelection } from "./useRackSelection";
import { InstrumentControls } from "./InstrumentControls";
import { PatchPicker } from "../PatchPicker";
import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { audioCopy } from "../../lib/audioCopy";
import { MASTER, defaultStrip, stripDestinations } from "../../lib/audioRouting";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, PatchListItem } from "../../types";
import { MixerBody, editMixerPatch } from "../PerformMixer";
import { AudioOutputMeter, StripControls } from "../MixerStripControls";
import { RetainedScroll, usePerformanceEditorState, type PerformViewLayout } from "./PerformanceEditorState";
import { SampleMapEditor } from "./SamplePlayerRack";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import { WorkspacePanel, WorkspacePanels, shellCopy } from "./WorkspacePanels";
import type { MixSurface } from "./PerformWorkspace";
import { mixCopy } from "./mixCopy";

export function MixWorkspace({ language, running, onStop, onAdd, patches, rack }: {
  language: GuiLanguage; running: boolean; onStop: () => void; onAdd: (patchId: string) => string | void; patches: PatchListItem[]; rack: ReactNode;
}) {
  const audio = audioCopy(language), copy = mixCopy(language), ui = SEQUENCER_UI_COPY[language];
  const [surface, setSurface] = usePerformanceEditorState<MixSurface>("mixer", "surface", "mixer");
  const { ids, primary: selected, select } = useRackSelection();
  const [layout, setLayout] = usePerformanceEditorState<PerformViewLayout>("page", "layout", {});
  const bindings = useAppStore(s => s.sequencerInstruments);
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
  const single = useContext(WorkspacePanels)?.singlePane;
  const overview = useRef<HTMLDivElement>(null);
  const [stripOffscreen, setStripOffscreen] = useState(false);
  const [monitorMaster, setMonitorMaster] = useState(false);
  const canOpenControls = !!binding || master && Object.values(graph.insertOwners).includes(MASTER);
  // Dedicated processors share the outermost owner's mixer strip.
  let stripId = selected;
  const ancestors = new Set<string>();
  while (graph.insertOwners[stripId] && !ancestors.has(stripId)) {
    ancestors.add(stripId);
    stripId = graph.insertOwners[stripId];
  }
  const bankHidden = !!single || surface !== "mixer";
  useLayoutEffect(() => setMonitorMaster(false), [stripId, dock]);
  useLayoutEffect(() => {
    setStripOffscreen(false);
    if (bankHidden || !dock || !stripId || stripId === MASTER) return;
    const bank = overview.current?.querySelector(".ws-strip-bank");
    const strip = bank?.querySelector(`[data-mixer-strip="${CSS.escape(stripId)}"]`);
    if (!bank || !strip || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setStripOffscreen(entry.intersectionRect.width + 1 < entry.boundingClientRect.width);
    }, { root: bank, threshold: [0, .99, 1] });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [bankHidden, dock, stripId]);
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
    if (dock && (!canOpenControls || (dock === "samples" && !capable))) {
      setLayout(previous => ({ ...previous, dock: null, dockExpanded: false }));
    }
  }, [canOpenControls, capable, dock, setLayout]);
  const details = canOpenControls && <>
    {surface !== "rack" && <button type="button" data-mix-detail="instrument" aria-expanded={dock === "instrument"} onClick={() => open("instrument")}>{copy("instrument")}</button>}
    {capable && <button type="button" data-mix-detail="samples" aria-expanded={dock === "samples"} onClick={() => open("samples")}>{copy("samples")}</button>}
  </>;
  const compareStrip = (id: string) => {
    const row = bindings.find(b => b.id === id);
    const label = row ? `${endpointName(id)} · ${ui.patch(bindings.indexOf(row) + 1)}` : audio("master");
    return <div className="ws-detail-strip" role="group" aria-label={label} data-detail-strip={id}
      data-monitor-current={id === (monitorMaster && bankHidden ? MASTER : stripId) || undefined}>
      <strong title={label}>{label}</strong><StripControls id={id} preferredInsert={selected} language={language} />
    </div>;
  };
  return <div className="ws-mix" ref={overview}>
    <div className="ws-mix-tools">
      <nav aria-label={audio("mixer")}>
        {(["mixer", "rack", "routing"] as const).map(item => <button key={item} type="button" aria-pressed={surface === item}
          onClick={() => { if (surface !== item) switchSurface(item); }}>{item === "mixer" ? audio("mixer") : copy(item)}</button>)}
      </nav>
      {surface !== "rack" && <button type="button" onClick={() => switchSurface("rack")}>{copy("manage")}</button>}
      {details}
      {bindings.length > 1 && surface !== "routing" && <small className="text-slate-400">{copy("multi")}</small>}
      {surface === "rack" && <>
        {running && <button type="button" onClick={onStop}>{copy("stopRack")}</button>}
        <div className="ws-rack-add"><PatchPicker guiLanguage={language} label={ui.addInstrument} patches={patches}
          disabled={running} onSelectPatch={patchId => {
            const id = onAdd(patchId);
            if (id) select(id);
          }} /></div>
      </>}
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
    {dock && canOpenControls && (bankHidden || stripOffscreen) && <WorkspacePanel name="mixControls">
      <div className="ws-detail-console">
        {bankHidden && stripId !== MASTER && <select className="ws-monitor-channel" aria-label={copy("monitorChannel")}
          value={monitorMaster ? MASTER : stripId} onChange={e => setMonitorMaster(e.target.value === MASTER)}>
          <option value={stripId}>{endpointName(stripId)} · {ui.patch(bindings.findIndex(b => b.id === stripId) + 1)}</option>
          <option value={MASTER}>{audio("master")}</option>
        </select>}
        {stripId !== MASTER && compareStrip(stripId)}
        {bankHidden && <>{compareStrip(MASTER)}<AudioOutputMeter language={language} /></>}
      </div>
    </WorkspacePanel>}
    {binding && dock === "samples" && capable && <WorkspacePanel name="editor">
      <div key={binding.id + binding.patchId} data-mix-detail-instance={binding.id}>
        <SampleMapEditor binding={binding} label={instanceLabel} capable={capable} running={running} language={language} />
      </div>
    </WorkspacePanel>}
    {canOpenControls && dock === "instrument" && <WorkspacePanel name="editor">
      <InstrumentControls ids={ids} language={language} onSamples={id => { select(id); open("samples"); }} />
    </WorkspacePanel>}
  </div>;
}
