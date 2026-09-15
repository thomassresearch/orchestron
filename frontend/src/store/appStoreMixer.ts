import { onMixerConnected, sendMixerUpdate } from "../lib/mixerRuntime";
import type { StoreApi } from "zustand";
import { api } from "../api/client";
import { MASTER, defaultStrip, emptyAudioGraph, emptyMixer, newRoute, mainPorts } from "../lib/audioRouting";
import { audioCopy } from "../lib/audioCopy";
import type { MixerState } from "../types";
import type { AppStore } from "./appStoreTypes";

type Actions = Pick<AppStore, "setAudioGraph" | "setMixerStrip" | "setMixerSend" | "flushMixer" | "ensureMaster">;
export function createMixerActions(set: StoreApi<AppStore>["setState"], get: StoreApi<AppStore>["getState"]): Actions {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let dirty = false;
  let lastSentAt = -Infinity;
  let sessionRevision: { id: string; revision: number } | undefined;
  const flush = async (immediate = true) => {
    if (pending) { clearTimeout(pending); pending = undefined; }
    if (running) { await running; if (dirty) return flush(immediate); return; }
    if (!immediate && Date.now() - lastSentAt < 34) { schedule(); return; }
    const state = get();
    if (!state.activeSessionId || state.activeSessionAudioSignature !== JSON.stringify({ graph: state.audioGraph, patches: state.patches.map((p) => [p.id, p.updated_at]) })) { dirty = false; return; }
    const id = state.activeSessionId;
    const mixer: MixerState = structuredClone(state.mixer);
    dirty = false;
    running = (async () => {
      try {
        if (sessionRevision?.id !== id) {
          const current = await api.getMixer(id);
          sessionRevision = { id, revision: current.revision };
        }
        lastSentAt = Date.now();
        const response = await (sendMixerUpdate(id, mixer, sessionRevision.revision) ?? api.updateMixer(id, mixer, sessionRevision.revision));
        sessionRevision = { id, revision: response.revision };
        set({ mixerSyncError: null });
      } catch (e) {
        sessionRevision = undefined;
        dirty = true;
        const message = e instanceof Error ? e.message : "Mixer update failed";
        set({ mixerSyncError: message });
        throw e;
      }
    })();
    try { await running; } finally { running = undefined; }
    if (dirty) { if (immediate) await flush(); else schedule(); }
  };
  const schedule = () => {
    dirty = true;
    if (!pending) pending = setTimeout(() => { pending = undefined; void flush(false).catch(() => undefined); }, 34);
  };
  onMixerConnected((id) => { if (get().activeSessionId === id) { sessionRevision = undefined; schedule(); } });
  return {
    setAudioGraph: (audioGraph) => {
      if (get().activeSessionState === "running") return;
      if (audioGraph.routes.length > 1024) { set({ error: audioCopy(get().guiLanguage)("routeLimit") }); return; }
      const mixer = get().mixer;
      const ids = new Set(audioGraph.routes.map((r) => r.id));
      set({ audioGraph: { ...audioGraph, masterId: audioGraph.masterId ?? MASTER }, mixer: { ...mixer, sends: Object.fromEntries(Object.entries(mixer.sends).filter(([id]) => ids.has(id))) }, error: null });
    },
    setMixerStrip: (id, update) => {
      const state = get();
      set({ mixer: { ...state.mixer, strips: { ...state.mixer.strips, [id]: { ...defaultStrip(), ...state.mixer.strips[id], ...update } } } });
      schedule();
    },
    setMixerSend: (ids, update) => {
      const state = get();
      const sends = { ...state.mixer.sends };
      for (const id of ids) sends[id] = { ...(sends[id] ?? { gainDb: 0, tap: "post" }), ...update };
      set({ mixer: { ...state.mixer, sends } });
      schedule();
    },
    flushMixer: flush,
    ensureMaster: () => {
      const state = get();
      if (state.audioGraph.masterId && state.audioGraph.masterId !== MASTER) throw new Error(audioCopy(state.guiLanguage)("repairMaster"));
      if (state.activeSessionState === "running") {
        if (state.audioGraph.masterId === MASTER) return MASTER;
        throw new Error("Stop to edit routing");
      }
      const audioGraph = { ...state.audioGraph, masterId: MASTER, routes: [...state.audioGraph.routes] };
      for (const binding of state.sequencerInstruments) {
        const patch = state.patches.find(p => p.id === binding.patchId);
        if (patch?.audio_interface?.guided && patch.audio_interface.role === "instrument" && !audioGraph.routes.some(r => r.sourceId === binding.id)) {
          const ports = mainPorts(patch, "output");
          if (ports.length === 2) audioGraph.routes.push(...ports.map((sourcePort, i) => newRoute({ sourceId: binding.id, sourcePort, targetId: MASTER, targetPort: i ? "right" : "left", kind: "main", sourceStage: "strip", targetStage: "input" })));
        }
      }
      if (audioGraph.routes.length > 1024) throw new Error(audioCopy(state.guiLanguage)("routeLimit"));
      set({ audioGraph });
      return MASTER;
    }
  };
}
export const initialMixerState = () => ({ audioGraph: emptyAudioGraph(), mixer: emptyMixer(), migrationNotice: false, activeSessionAudioSignature: "", mixerSyncError: null });
