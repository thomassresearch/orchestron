import { useRackSelection } from "./useRackSelection";
import { groupRackInstruments } from "../../lib/rackOrdering";
import { audioCopy } from "../../lib/audioCopy";
import { MASTER } from "../../lib/audioRouting";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { RetainedScroll } from "./PerformanceEditorState";
import type { ViewNavigation, MixDestination } from "./PerformWorkspace";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import { mixCopy } from "./mixCopy";

export function CompactRack({ language, onNavigate, onOpenControls }: {
  language: GuiLanguage; onNavigate?: ViewNavigation; onOpenControls?: (ids: string[]) => void;
}) {
  const bindings = useAppStore(s => s.sequencerInstruments);
  const patches = useAppStore(s => s.patches);
  const { ids, primary: selected, picker } = useRackSelection();
  const masterWithInserts = useAppStore(s => selected === MASTER && Object.values(s.audioGraph.insertOwners).includes(MASTER));
  const binding = bindings.find(row => row.id === selected);
  const byId = new Map(patches.map(p => [p.id, p]));
  const patch = binding && byId.get(binding.patchId);
  const groups = groupRackInstruments(bindings, byId);
  const ui = SEQUENCER_UI_COPY[language], audio = audioCopy(language), copy = mixCopy(language);
  const go = (surface: MixDestination["surface"], dock?: MixDestination["dock"]) =>
    onNavigate?.("mix", { surface, bindingIds: binding ? [binding.id] : undefined, dock });
  return <div className="ws-compact-rack">
    <div className="ws-rack-selection">
      <RetainedScroll role="group" aria-label={ui.instrumentRack} owner="rack" field="compactScroll" className="ws-rack-picker">
        {[...groups.standard, ...groups.alwaysOn].map(({ binding: row, index }) => {
          const item = byId.get(row.patchId);
          return <button key={row.id} type="button" data-rack-instance={row.id} title={copy("multi")} {...picker(row.id)}>
            <small>{ui.patch(index + 1)} · {row.midiChannel ? `${audio("midiChannelShort")} ${row.midiChannel}` : audio("continuous")}</small>
            <span>{item?.name ?? row.patchId}</span>
          </button>;
        })}
      </RetainedScroll>
      {onOpenControls && <button type="button" className="ws-open-controls" data-mix-detail="instrument" title={copy("openControls")}
        disabled={!binding && !masterWithInserts} onClick={() => onOpenControls(ids)}>
        {copy("instrument")}{ids.length > 1 && ` (${ids.length})`}
      </button>}
    </div>
    {onNavigate && <div className="ws-rack-links">
      <button onClick={() => go("rack")}>{copy("manage")}</button>
      <button onClick={() => go("routing")}>{copy("routing")}</button>
      {patch?.has_sample_player && !patch.always_on && <button onClick={() => go("mixer", "samples")}>{copy("samples")}</button>}
    </div>}
  </div>;
}
