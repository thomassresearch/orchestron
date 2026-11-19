import { useState } from "react";
import { api } from "../../api/client";
import { audioCopy } from "../../lib/audioCopy";
import { audioTemplate } from "../../lib/audioTemplates";
import { toPatchListItem } from "../../lib/patchCatalog";
import { MIDI_CHANNELS } from "../../lib/midiControllerChannels";
import { sampleCopy } from "../../lib/sampleCopy";
import { sourceKeys } from "../../lib/clipArranger/migration";
import type { SourceKind } from "../../lib/clipArranger/model";
import { updateScoreTrack } from "../../store/scoreActions";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage } from "../../types";
import { arrangeCopy } from "../clipArranger/arrangeCopy";
import { clipButtonClass } from "../clipArranger/buttonStyles";
import { MidiChannelSelector } from "./MidiChannelSelector";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";

export function ArrangeTrackRouting({ id, kind, language }: {
  id: string; kind: SourceKind; language: GuiLanguage;
}) {
  const track = useAppStore(s => s.sequencer[sourceKeys[kind]].find(t => t.id === id));
  const patches = useAppStore(s => s.patches);
  const bindings = useAppStore(s => s.sequencerInstruments);
  const arpeggiators = useAppStore(s => s.sequencer.arpeggiators);
  const running = useAppStore(s => s.activeSessionState === "running");
  const [creating, setCreating] = useState(false);
  const ui = SEQUENCER_UI_COPY[language];
  if (!track) return null;
  if ("targetChannels" in track) {
    const automation = track.automationTarget;
    const binding = automation && bindings.find(row => row.id === automation.instrumentId);
    const patch = binding && patches.find(p => p.id === binding.patchId);
    const controls = patch?.performance_controllers?.filter(d => automation?.controllerNodeIds.includes(d.node_id));
    return <div className="ws-track-routing">
      {automation
        ? <p>{patch?.name ?? track.name} · MIDI {track.targetChannels.join(", ")} · CC {track.controllerNumber}{controls?.length ? " · " + controls.map(d => d.label).join(", ") : ""}</p>
        : <MidiChannelSelector rows={2} ui={ui} channels={track.targetChannels}
            onChange={channels => useAppStore.getState().setControllerSequencerTargetChannels(id, channels)} />}
    </div>;
  }
  const channel = "targetChannel" in track ? track.targetChannel : track.midiChannel;
  const outputChannels = MIDI_CHANNELS.filter(ch => kind !== "arpeggiator" || !arpeggiators.some(a => a.inputChannel === ch));
  const assign = (value: number) => {
    const state = useAppStore.getState();
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
    before.addSequencerInstrument(patchId);
    const added = useAppStore.getState().sequencerInstruments.find(b => !before.sequencerInstruments.some(old => old.id === b.id));
    if (!added) return;
    if (freeChannel && freeChannel !== added.midiChannel) before.updateSequencerInstrumentChannel(added.id, freeChannel);
    const destination = freeChannel ?? added.midiChannel;
    if (destination !== channel) assign(destination);
  };
  const playable = patches.filter(p => !p.always_on && !p.is_template);
  const createStarter = async () => {
    const generation = useAppStore.getState().performanceWorkspaceGeneration;
    setCreating(true);
    try {
      const { description, is_template, always_on, instrument_type, schema_version, graph } = audioTemplate("instrument");
      const saved = await api.createPatch({ name: audioCopy(language)("instrument"), description, is_template, always_on, instrument_type, schema_version, graph });
      useAppStore.setState(s => ({ patches: [...s.patches.filter(p => p.id !== saved.id), toPatchListItem(saved)] }));
      if (useAppStore.getState().performanceWorkspaceGeneration === generation) add(saved.id);
    } catch (e) { useAppStore.setState({ error: String(e) }); }
    finally { setCreating(false); }
  };
  return <div className="ws-track-routing">
    <label>{ui.midiChannel} <select value={channel} onChange={e => assign(Number(e.target.value))}>
      {outputChannels.map(ch => {
        const names = bindings.filter(b => b.midiChannel === ch).map(b => patches.find(p => p.id === b.patchId)?.name ?? b.patchId);
        return <option key={ch} value={ch}>{[ch, ...names].join(" · ")}</option>;
      })}
    </select></label>
    {playable.length ? <label>{ui.addInstrument} <select value="" disabled={running} onChange={e => add(e.target.value)}>
      <option value="">＋</option>{playable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label> : <button className={clipButtonClass("add")} disabled={running || creating} onClick={() => void createStarter()}>{arrangeCopy(language).starter}</button>}
  </div>;
}
