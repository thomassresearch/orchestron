import { useMemo } from "react";
import { sourceKeys } from "../../lib/clipArranger/migration";
import { useAppStore } from "../../store/useAppStore";

/** The sound a lane addresses is independent of its current clip, audition and mute state. */
export function useArrangeControlRoutes(active: boolean) {
  const sequencer = useAppStore(s => active ? s.sequencer : null);
  const bindings = useAppStore(s => active ? s.sequencerInstruments : null);
  const patches = useAppStore(s => active ? s.patches : null);
  return useMemo(() => {
    const routes = new Map<string, { name: string; ids: string[]; enabled: boolean }>();
    if (!sequencer || !bindings || !patches) return routes;
    const library = new Map(patches.map(p => [p.id, p]));
    const arpOutputs = new Map(sequencer.arpeggiators.map(a => [a.inputChannel, a.targetChannel]));
    const clipLanes = sequencer.clipArrangement && new Set(sequencer.clipArrangement.lanes.map(lane => lane.id));
    for (const key of Object.values(sourceKeys)) {
      for (const track of sequencer[key]) {
        if (clipLanes ? !clipLanes.has(track.id) : "playbackMode" in track && track.playbackMode === "live") continue;
        const target = "automationTarget" in track ? track.automationTarget : undefined;
        const channels = "targetChannels" in track ? track.targetChannels : ["targetChannel" in track ? track.targetChannel : track.midiChannel];
        const outputs = channels.map(ch => arpOutputs.get(ch) ?? ch);
        const instruments = bindings.filter(b => target ? b.id === target.instrumentId
          : outputs.includes(b.midiChannel) && !library.get(b.patchId)?.always_on);
        routes.set(track.id, { name: track.name, ids: instruments.map(b => b.id),
          enabled: instruments.some(b => library.get(b.patchId)?.performance_controllers?.some(control => !control.error)) });
      }
    }
    return routes;
  }, [sequencer, bindings, patches]);
}
