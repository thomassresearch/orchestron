import { useState } from "react";
import { arrangeCopy } from "../clipArranger/arrangeCopy";
import { ArrangerContextMenu, type ArrangerMenuTarget } from "./ArrangerContextMenu";
import { RackAddDialog } from "./RackAddDialog";
import { tracksUsingRackInstrument } from "../../lib/rackTrackUsage";
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
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<(ArrangerMenuTarget & { id: string }) | null>(null);
  const [warning, setWarning] = useState("");
  const running = useAppStore(s => s.activeSessionState === "running");
  const labels = arrangeCopy(language);
  const bindings = useAppStore(s => s.sequencerInstruments);
  const patches = useAppStore(s => s.patches);
  const { ids, primary: selected, picker, select } = useRackSelection();
  const masterWithInserts = useAppStore(s => selected === MASTER && Object.values(s.audioGraph.insertOwners).includes(MASTER));
  const binding = bindings.find(row => row.id === selected);
  const byId = new Map(patches.map(p => [p.id, p]));
  const patch = binding && byId.get(binding.patchId);
  const groups = groupRackInstruments(bindings, byId);
  const ui = SEQUENCER_UI_COPY[language], audio = audioCopy(language), copy = mixCopy(language);
  const go = (surface: MixDestination["surface"], dock?: MixDestination["dock"]) =>
    onNavigate?.("mix", { surface, bindingIds: binding ? [binding.id] : undefined, dock });
  const remove = () => {
    if (!menu) return;
    const state = useAppStore.getState(), id = menu.id;
    setMenu(null);
    if (state.activeSessionState === "running") return;
    const users = tracksUsingRackInstrument(state.sequencer, state.sequencerInstruments, state.audioGraph.insertOwners, id);
    if (users.length) {
      setWarning(`${labels.usedBy}: ${users.join(", ")}`);
      return;
    }
    state.removeSequencerInstrument(id);
    setWarning("");
  };
  return <div className="ws-compact-rack">
    <div className="ws-rack-selection">
      <RetainedScroll role="group" aria-label={ui.instrumentRack} owner="rack" field="compactScroll" className="ws-rack-picker">
        {[...groups.standard, ...groups.alwaysOn].map(({ binding: row, index }) => {
          const item = byId.get(row.patchId);
          const choice = picker(row.id);
          const showMenu = (anchor: HTMLElement, x: number, y: number) => { setWarning(""); setMenu({ anchor, x, y, id: row.id }); };
          return <button key={row.id} type="button" data-rack-instance={row.id} title={copy("multi")} {...choice} onContextMenu={e => {
            e.preventDefault(); showMenu(e.currentTarget, e.clientX, e.clientY);
          }} onKeyDown={e => {
            if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              showMenu(e.currentTarget, rect.left, rect.bottom);
            } else choice.onKeyDown(e);
          }}>
            <small>{ui.patch(index + 1)} · {row.midiChannel ? `${audio("midiChannelShort")} ${row.midiChannel}` : audio("continuous")}</small>
            <span>{item?.name ?? row.patchId}</span>
          </button>;
        })}
      </RetainedScroll>
      {onOpenControls && <button type="button" className="ws-open-controls" data-mix-detail="instrument" title={copy("openControls")}
        disabled={!binding && !masterWithInserts} onClick={() => onOpenControls(ids)}>
        {copy("instrument")}{ids.length > 1 && ` (${ids.length})`}
      </button>}
      <button type="button" className="ws-rack-add" aria-label={ui.addInstrument} title={ui.addInstrument} disabled={running}
        onClick={() => { setWarning(""); setAdding(true); }}>＋</button>
    </div>
    {adding && <RackAddDialog language={language} onClose={() => setAdding(false)} onAdd={patchId => {
      const id = useAppStore.getState().addSequencerInstrument(patchId);
      if (id) select(id);
    }} />}
    {menu && <ArrangerContextMenu target={menu} title={labels.removeInstrument} onClose={() => setMenu(null)}>
      <button type="button" data-compact-rack-menu role="menuitem" className="w-full rounded px-2 py-2 text-left text-rose-200 hover:bg-slate-800" disabled={running} onClick={remove}>{labels.removeInstrument}</button>
    </ArrangerContextMenu>}
    {warning && <p role="alert" className="px-2 pb-1 text-xs text-amber-200">{warning}</p>}
    {onNavigate && <div className="ws-rack-links">
      <button onClick={() => go("rack")}>{copy("manage")}</button>
      <button onClick={() => go("routing")}>{copy("routing")}</button>
      {patch?.has_sample_player && !patch.always_on && <button onClick={() => go("mixer", "samples")}>{copy("samples")}</button>}
    </div>}
  </div>;
}
