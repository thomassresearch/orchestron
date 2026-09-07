import { onMixerConnected, sendMixerUpdate } from "../lib/mixerRuntime";
import type { StoreApi } from "zustand";
import { api } from "../api/client";
import { defaultStrip, emptyAudioGraph, emptyMixer, newRoute, mainPorts } from "../lib/audioRouting";
import { audioTemplate } from "../lib/audioTemplates";
import { audioCopy } from "../lib/audioCopy";
import type { MixerState } from "../types";
import type { AppStore } from "./appStoreTypes";

type Actions = Pick<AppStore, "setAudioGraph" | "setMixerStrip" | "setMixerSend" | "flushMixer" | "ensureMaster">;
export function createMixerActions(set: StoreApi<AppStore>["setState"], get: StoreApi<AppStore>["getState"]): Actions {
  let masterCreation: Promise<string> | undefined;
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
      set({ audioGraph, mixer: { ...mixer, sends: Object.fromEntries(Object.entries(mixer.sends).filter(([id]) => ids.has(id))) }, error: null });
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
    ensureMaster: async () => {
      const state = get();
      if (state.audioGraph.masterId && state.sequencerInstruments.some((b) => b.id === state.audioGraph.masterId)) return state.audioGraph.masterId;
      if (state.activeSessionState === "running") throw new Error("Stop to edit routing");
      if (masterCreation) return masterCreation;
      if (state.sequencerInstruments.length >= 64) throw new Error(audioCopy(state.guiLanguage)("instanceLimit"));
      masterCreation = (async () => {
      const patch = await api.createPatch(audioTemplate("output"));
      const patches = await api.listPatches();
      const id = crypto.randomUUID();
      const current = get();
      const audioGraph = { ...current.audioGraph, masterId: id };
      for (const binding of current.sequencerInstruments) {
        const p = patches.find((p) => p.id === binding.patchId);
        if (p?.audio_interface?.guided && p.audio_interface.role === "instrument" && !audioGraph.routes.some((r) => r.sourceId === binding.id)) {
          const ports = mainPorts(p, "output");
          if (ports.length === 2) audioGraph.routes = [...audioGraph.routes, ...ports.map((sourcePort, i) => newRoute({ sourceId: binding.id, sourcePort, targetId: id, targetPort: i ? "right" : "left", kind: "main", sourceStage: "strip", targetStage: "input" }))];
        }
      }
      set({ patches, audioGraph, sequencerInstruments: [...current.sequencerInstruments, { id, patchId: patch.id, midiChannel: 0, level: 10, effectSourceIds: [], effectRoutes: [] }] });
      return id;
      })();
      try { return await masterCreation; } finally { masterCreation = undefined; }
    }
  };
}
export const initialMixerState = () => ({ audioGraph: emptyAudioGraph(), mixer: emptyMixer(), migrationNotice: false, activeSessionAudioSignature: "", mixerSyncError: null });
