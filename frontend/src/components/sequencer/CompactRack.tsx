import { useRackSelection } from "./useRackSelection";
import { groupRackInstruments } from "../../lib/rackOrdering";
import { audioCopy } from "../../lib/audioCopy";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { RetainedScroll } from "./PerformanceEditorState";
import type { ViewNavigation, MixDestination } from "./PerformWorkspace";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import { mixCopy } from "./mixCopy";

export function CompactRack({ language, onNavigate }: { language: GuiLanguage; onNavigate?: ViewNavigation }) {
  const bindings = useAppStore(s => s.sequencerInstruments);
  const patches = useAppStore(s => s.patches);
  const { primary: selected, picker } = useRackSelection();
  const binding = bindings.find(row => row.id === selected);
  const byId = new Map(patches.map(p => [p.id, p]));
  const patch = binding && byId.get(binding.patchId);
  const groups = groupRackInstruments(bindings, byId);
  const ui = SEQUENCER_UI_COPY[language], audio = audioCopy(language), copy = mixCopy(language);
  const go = (surface: MixDestination["surface"], dock?: MixDestination["dock"]) =>
    onNavigate?.("mix", { surface, bindingId: binding?.id, dock });
  return <div className="ws-compact-rack">
    <RetainedScroll role="group" aria-label={ui.instrumentRack} owner="rack" field="compactScroll" className="ws-rack-picker">
      {[...groups.standard, ...groups.alwaysOn].map(({ binding: row, index }) => {
        const item = byId.get(row.patchId);
        return <button key={row.id} type="button" data-rack-instance={row.id} {...picker(row.id, !onNavigate)}>
          <small>{ui.patch(index + 1)} · {row.midiChannel ? `${audio("midiChannelShort")} ${row.midiChannel}` : audio("continuous")}</small>
          <span>{item?.name ?? row.patchId}</span>
        </button>;
      })}
    </RetainedScroll>
    {onNavigate && <div className="ws-rack-links">
      <button onClick={() => go("rack")}>{copy("manage")}</button>
      <button onClick={() => go("routing")}>{copy("routing")}</button>
      {binding && <button onClick={() => go("mixer", "instrument")}>{copy("instrument")}</button>}
      {patch?.has_sample_player && !patch.always_on && <button onClick={() => go("mixer", "samples")}>{copy("samples")}</button>}
    </div>}
  </div>;
}
