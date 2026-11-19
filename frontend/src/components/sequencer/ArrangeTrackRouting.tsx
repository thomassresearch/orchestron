import { memo, useState } from "react";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { RackAddDialog } from "./RackAddDialog";
import { shellCopy } from "./WorkspacePanels";
import { MIDI_CHANNELS } from "../../lib/midiControllerChannels";
import { sampleCopy } from "../../lib/sampleCopy";
import { sourceKeys } from "../../lib/clipArranger/migration";
import type { SourceKind } from "../../lib/clipArranger/model";
import { updateScoreTrack } from "../../store/scoreActions";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { clipButton } from "../clipArranger/buttonStyles";
import { MidiChannelSelector } from "./MidiChannelSelector";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";

const channelLabel = (channel: number) => `CH${String(channel).padStart(2, "0")}`;

export function focusTrackChannel(id: string) {
  requestAnimationFrame(() => {
    const control = document.querySelector<HTMLElement>(`[data-track-channel="${CSS.escape(id)}"]`);
    control?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    control?.focus();
  });
}

export const ArrangeTrackRouting = memo(function ArrangeTrackRouting({ id, kind, language }: {
  id: string; kind: SourceKind; language: GuiLanguage;
}) {
  const track = useAppStore(s => s.sequencer[sourceKeys[kind]].find(t => t.id === id));
  const patches = useAppStore(s => s.patches);
  const bindings = useAppStore(s => s.sequencerInstruments);
  const arpeggiators = useAppStore(s => s.sequencer.arpeggiators);
  const running = useAppStore(s => s.activeSessionState === "running");
  const [open, setOpen] = useState<"channels" | "add" | null>(null);
  const ui = SEQUENCER_UI_COPY[language];
  if (!track) return null;
  const outputChannels = MIDI_CHANNELS.filter(ch => kind !== "arpeggiator" || !arpeggiators.some(a => a.inputChannel === ch));
  const assign = (value: number) => {
    const state = useAppStore.getState();
    if ("targetChannels" in track && !track.automationTarget && !track.targetChannels.includes(value)) {
      state.setControllerSequencerTargetChannels(id, [...track.targetChannels, value].sort((a, b) => a - b));
    }
    if (kind === "sequencer") state.setSequencerTrackMidiChannel(id, value);
    if (kind === "drummer") state.setDrummerSequencerTrackMidiChannel(id, value);
    if (kind === "score") updateScoreTrack(id, t => ({ ...t, midiChannel: value }));
    if (kind === "arpeggiator") state.updateArpeggiator(id, { targetChannel: value });
  };
  const add = (patchId: string) => {
    const before = useAppStore.getState();
    if (before.activeSessionState === "running" || !before.sequencer[sourceKeys[kind]].some(t => t.id === id)) return;
    const freeChannel = before.sequencer.arpeggiators.length ? MIDI_CHANNELS.find(ch =>
      !before.sequencer.arpeggiators.some(a => a.inputChannel === ch) && !before.sequencerInstruments.some(b => b.midiChannel === ch)
    ) : undefined;
    if (before.sequencer.arpeggiators.length && !freeChannel) {
      useAppStore.setState({ error: sampleCopy(language).noChannel });
      return;
    }
    const addedId = before.addSequencerInstrument(patchId);
    const added = useAppStore.getState().sequencerInstruments.find(b => b.id === addedId);
    if (!added) return;
    if (freeChannel && freeChannel !== added.midiChannel) before.updateSequencerInstrumentChannel(added.id, freeChannel);
    const destination = freeChannel ?? added.midiChannel;
    assign(destination);
  };
  const optionLabel = (ch: number) => {
    const arp = arpeggiators.find(a => a.inputChannel === ch);
    const names = bindings.filter(b => b.midiChannel === (arp?.targetChannel ?? ch)).map(b => patches.find(p => p.id === b.patchId)?.name ?? b.patchId);
    return [channelLabel(ch), ...(arp ? [arp.name] : []), ...names].join(" · ");
  };
  const browser = open === "add" && <RackAddDialog language={language} playableOnly onAdd={add} onClose={() => setOpen(null)} />;
  if ("targetChannels" in track) {
    const automation = track.automationTarget;
    const binding = automation && bindings.find(row => row.id === automation.instrumentId);
    const patch = binding && patches.find(p => p.id === binding.patchId);
    const controls = patch?.performance_controllers?.filter(d => automation?.controllerNodeIds.includes(d.node_id));
    const label = track.targetChannels.length === 16 ? "CH01–16" : track.targetChannels.map(channelLabel).join(", ");
    if (automation) return <span className="ws-channel-label" title={[patch?.name, controls?.map(c => c.label).join(", ")].filter(Boolean).join(" · ")}>{label} · CC {track.controllerNumber}</span>;
    return <>
      <button className="ws-channel-trigger" data-track-channel={id} title={label} aria-label={`${ui.midiChannels} · ${track.name}`} aria-haspopup="dialog" aria-expanded={open !== null} onClick={() => setOpen("channels")}>{label} ▾</button>
      {open === "channels" && <WorkspaceDialog title={ui.midiChannels} onClose={() => setOpen(null)}>
        <MidiChannelSelector optionLabel={optionLabel} rows={2} ui={ui} channels={track.targetChannels} onChange={channels => useAppStore.getState().setControllerSequencerTargetChannels(id, channels)} />
        <button className={clipButton} disabled={running} onClick={() => setOpen("add")}>＋ {ui.addInstrument}…</button>
        <button className={clipButton} onClick={() => setOpen(null)}>{shellCopy[language].close}</button>
      </WorkspaceDialog>}
      {browser}
    </>;
  }
  const channel = "targetChannel" in track ? track.targetChannel : track.midiChannel;
  const label = "inputChannel" in track ? `${channelLabel(track.inputChannel)} → ${channelLabel(channel)}` : channelLabel(channel);
  return <>
    <label className="ws-channel-trigger">
      <span aria-hidden="true">{label} ▾</span>
      <select data-track-channel={id} aria-label={`${ui.midiChannel} · ${track.name}`} value={channel}
        onChange={e => e.target.value === "add" ? setOpen("add") : assign(Number(e.target.value))}>
        {outputChannels.map(ch => <option key={ch} value={ch}>{optionLabel(ch)}</option>)}
        <option value="add" disabled={running}>＋ {ui.addInstrument}…</option>
      </select>
    </label>
    {browser}
  </>;
});
