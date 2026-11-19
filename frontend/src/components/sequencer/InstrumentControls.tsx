import { useMemo } from "react";
import { audioCopy } from "../../lib/audioCopy";
import { MASTER } from "../../lib/audioRouting";
import { instrumentsWithInserts } from "../../lib/insertRouting";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { InsertBypass } from "../MixerStripControls";
import { editMixerPatch } from "../PerformMixer";
import { AdaptiveInstrumentRack } from "./AdaptiveInstrumentRack";
import { PerformanceControllerRack, PerformanceControllerSyncStatus } from "./PerformanceControllerRack";
import { mixCopy } from "./mixCopy";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";

export function InstrumentControls({ ids, language, onSamples }: {
  ids: string[]; language: GuiLanguage; onSamples?: (id: string) => void;
}) {
  const audio = audioCopy(language), copy = mixCopy(language), ui = SEQUENCER_UI_COPY[language];
  const bindings = useAppStore(s => s.sequencerInstruments);
  const patches = useAppStore(s => s.patches);
  const graph = useAppStore(s => s.audioGraph);
  const patchesById = useMemo(() => new Map(patches.map(p => [p.id, p])), [patches]);
  const controlRows = useMemo(() => {
    const rows = new Map(bindings.map((row, index) => [row.id, { binding: row, index }]));
    return instrumentsWithInserts(graph, ids).flatMap(id => rows.get(id) ?? []);
  }, [bindings, graph, ids]);
  return <>
    <PerformanceControllerSyncStatus language={language} />
    <AdaptiveInstrumentRack rows={controlRows} patches={patchesById} language={language} renderCard={({ binding: row, index }) => {
      const item = patchesById.get(row.patchId);
      const owner = graph.insertOwners[row.id];
      const ownerIndex = owner ? bindings.findIndex(b => b.id === owner) : -1;
      const midi = item?.always_on ? audio("continuous") : `${audio("midiChannelShort")} ${row.midiChannel}`;
      return <section data-mix-detail-instance={row.id} className="rounded-lg border border-slate-700 bg-slate-900 p-2">
        <header data-rack-card-header>
          <small className="text-slate-400">{ui.patch(index + 1)} · {midi}</small>
          <h3 className="font-semibold text-cyan-100">{item?.name ?? row.patchId}</h3>
          {owner && <small>{audio("inserts")} · {ownerIndex >= 0 && `${ui.patch(ownerIndex + 1)} · `}{owner === MASTER ? audio("master") : patchesById.get(bindings[ownerIndex]?.patchId)?.name ?? owner}</small>}
          {owner && <InsertBypass id={row.id} name={item?.name ?? row.patchId} patch={item} language={language} />}
        </header>
        <PerformanceControllerRack key={row.patchId} binding={row} patch={item} language={language} />
        {!item?.performance_controllers?.length && <p>{copy("noControls")}</p>}
        <div className="ws-mix-actions">
          {onSamples && item?.has_sample_player && !item.always_on && <button onClick={() => onSamples(row.id)}>{copy("samples")}</button>}
          <button onClick={() => item && void editMixerPatch(item.id)} disabled={!item}>{audio("edit")}</button>
        </div>
      </section>;
    }} />
  </>;
}
