import type { StoreApi } from "zustand";
import { api } from "../api/client";
import { onMixerConnected } from "../lib/mixerRuntime";
import { normalizeControllerValues } from "../lib/performanceControllers";
import type { AppStore } from "./appStoreTypes";

type Actions = Pick<AppStore, "setPerformanceControllerValue" | "flushPerformanceControllers">;

export function createPerformanceControllerActions(set: StoreApi<AppStore>["setState"], get: StoreApi<AppStore>["getState"]): Actions {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const acknowledged = new Map<string, string>();
  let acknowledgedSession: string | null = null;

  const flush = async (): Promise<void> => {
    if (pending) { clearTimeout(pending); pending = undefined; }
    if (running) { await running; return flush(); }
    running = (async () => {
      // Read the latest state after each acknowledgment: edits during a request are never lost.
      while (true) {
        const state = get();
        const sessionId = state.activeSessionId;
        if (!sessionId || state.activeSessionAudioSignature !== JSON.stringify({ graph: state.audioGraph, patches: state.patches.map((p) => [p.id, p.updated_at]) })) return;
        if (acknowledgedSession !== sessionId) { acknowledged.clear(); acknowledgedSession = sessionId; }
        const next = state.sequencerInstruments.find((binding) => {
          const active = state.activeSessionInstruments.find((item) => item.id === binding.id && item.patch_id === binding.patchId && item.midi_channel === binding.midiChannel);
          if (!active) return false;
          const definitions = state.patches.find((patch) => patch.id === binding.patchId)?.performance_controllers;
          if (!definitions?.length && !Object.keys(binding.performanceControllerValues ?? {}).length) return false;
          return acknowledged.get(binding.id) !== JSON.stringify(normalizeControllerValues(binding.performanceControllerValues));
        });
        if (!next) { set({ performanceControllerSyncError: null }); return; }
        const values = normalizeControllerValues(next.performanceControllerValues);
        const signature = JSON.stringify(values);
        try {
          await api.updatePerformanceControllers(sessionId, next.id, values);
          if (get().activeSessionId !== sessionId) continue;
          acknowledged.set(next.id, signature);
          set({ performanceControllerSyncError: null });
        } catch (error) {
          if (get().activeSessionId !== sessionId) continue;
          set({ performanceControllerSyncError: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }
    })();
    try { await running; } finally { running = undefined; }
  };

  const schedule = () => {
    if (!pending) pending = setTimeout(() => { pending = undefined; void flush().catch(() => undefined); }, 34);
  };

  onMixerConnected((sessionId) => {
    if (get().activeSessionId === sessionId) { acknowledged.clear(); schedule(); }
  });

  return {
    setPerformanceControllerValue: (bindingId, nodeId, value) => {
      const state = get();
      const binding = state.sequencerInstruments.find((item) => item.id === bindingId);
      const definition = state.patches.find((patch) => patch.id === binding?.patchId)?.performance_controllers?.find((item) => item.node_id === nodeId);
      if (!binding || !definition || definition.error || (value !== null && !Number.isFinite(value))) return;
      const values = normalizeControllerValues(binding.performanceControllerValues);
      if (value === null) delete values[nodeId];
      else {
        const next = Math.min(definition.max, Math.max(definition.min, value));
        if (next === (values[nodeId] ?? definition.default)) return;
        values[nodeId] = next;
      }
      set({ sequencerInstruments: state.sequencerInstruments.map((item) => item.id === bindingId
        ? { ...item, performanceControllerValues: values, performanceControllerNotice: false } : item) });
      schedule();
    },
    flushPerformanceControllers: flush
  };
}
