import { AutomationMergeConflict, reconcileAutomation } from "../lib/clipArranger/automation";
import { chooseAutomationMerge } from "../lib/clipArranger/automationMerge";
import { automationRuntimeConfig } from "../lib/clipArranger/automationRuntime";
import { hasChangedClipDrafts } from "../lib/clipArranger/draftResolution";
import { useStructureDraft } from "../lib/clipArranger/structureStore";
import { automationCopy } from "../components/clipArranger/automationCopy";
import type { StoreApi } from "zustand";
import { api, isApiError } from "../api/client";
import { onMixerConnected } from "../lib/mixerRuntime";
import { normalizeControllerValue } from "../lib/performanceControllers";
import type { PerformanceControllerSnapshot } from "../types";
import type { AppStore } from "./appStoreTypes";
import { sessionAudioSignature } from "./sessionSignature";

type Actions = Pick<AppStore, "setPerformanceControllerValue" | "setPerformanceControllerMidiCC" | "flushPerformanceControllers" | "receivePerformanceControllers" | "refreshPerformanceControllers">;
type Edit = { value?: number | null; cc?: number | null; revision?: number; midiRevision?: number; sequence: number };

export function createPerformanceControllerActions(set: StoreApi<AppStore>["setState"], get: StoreApi<AppStore>["getState"]): Actions {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let session: string | null = null;
  let generation = 0;
  let sequence = 0;
  let mappingWork: Promise<void> | undefined;
  const remapping = new Set<string>();
  const known = new Map<string, PerformanceControllerSnapshot>();
  const pending = new Map<string, Map<string, Edit>>();

  const sessionIsCurrent = (state: AppStore) =>
    state.activeSessionWorkspaceGeneration === state.performanceWorkspaceGeneration &&
    state.activeSessionAudioSignature === sessionAudioSignature(state);

  function context() {
    const state = get();
    if (generation !== state.performanceWorkspaceGeneration) {
      pending.clear(); known.clear(); generation = state.performanceWorkspaceGeneration;
    }
    if (session !== state.activeSessionId) { known.clear(); session = state.activeSessionId; }
    return state;
  }

  const receive: Actions["receivePerformanceControllers"] = (id, snapshots) => {
    const state = context();
    if (id !== state.activeSessionId || !sessionIsCurrent(state)) return;
    const bindings = state.sequencerInstruments.map(binding => {
      const incoming = snapshots[binding.id];
      const active = state.activeSessionInstruments.find(item => item.id === binding.id && item.patch_id === binding.patchId && item.midi_channel === binding.midiChannel);
      if (!incoming || !active) return binding;
      const old = known.get(binding.id);
      const merged: PerformanceControllerSnapshot = { values: { ...old?.values }, midi_ccs: { ...old?.midi_ccs }, revisions: { ...old?.revisions }, midi_revisions: { ...old?.midi_revisions } };
      const values = { ...binding.performanceControllerValues }, ccs = { ...binding.performanceControllerMidiCCs };
      for (const [node, revision] of Object.entries(incoming.revisions)) {
        if (revision < (old?.revisions[node] ?? -1)) continue;
        merged.revisions[node] = revision;
        if (incoming.midi_revisions?.[node] !== undefined) merged.midi_revisions![node] = incoming.midi_revisions[node];
        for (const [key, target, field] of [["values", values, "value"], ["midi_ccs", ccs, "cc"]] as const) {
          if (node in incoming[key]) merged[key][node] = incoming[key][node]; else delete merged[key][node];
          if (pending.get(binding.id)?.get(node)?.[field] !== undefined || field === "cc" && remapping.has(binding.id)) continue;
          if (node in incoming[key]) target[node] = incoming[key][node]; else delete target[node];
        }
      }
      known.set(binding.id, merged);
      const equal = (a: Record<string, number> = {}, b: Record<string, number>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
      if (equal(binding.performanceControllerValues, values) && equal(binding.performanceControllerMidiCCs, ccs)) return binding;
      return { ...binding, performanceControllerValues: values, performanceControllerMidiCCs: ccs };
    });
    if (bindings.some((binding, i) => binding !== state.sequencerInstruments[i])) set({ sequencerInstruments: bindings });
  };

  const refresh: Actions["refreshPerformanceControllers"] = async id => {
    const epoch = context().performanceWorkspaceGeneration;
    const snapshots = await api.getPerformanceControllers(id);
    if (get().performanceWorkspaceGeneration === epoch && get().activeSessionId === id) receive(id, snapshots);
  };

  const flush = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (running) { await running; return flush(); }
    running = (async () => {
      while (true) {
        const state = context();
        const id = state.activeSessionId, epoch = state.performanceWorkspaceGeneration;
        if (!id || !sessionIsCurrent(state)) return;
        const next = [...pending].find(([bindingId, edits]) => edits.size && state.activeSessionInstruments.some(item => item.id === bindingId && state.sequencerInstruments.some(b => b.id === bindingId && b.patchId === item.patch_id && b.midiChannel === item.midi_channel)));
        if (!next) { set({ performanceControllerSyncError: null }); return; }
        const [bindingId, edits] = next;
        try {
          if (!known.has(bindingId)) { await refresh(id); if (id !== get().activeSessionId || epoch !== get().performanceWorkspaceGeneration) continue; }
          const snapshot = known.get(bindingId);
          if (!snapshot) return;
          const sent = new Map(edits);
          const values: Record<string, number | null> = {}, midi_ccs: Record<string, number | null> = {}, revisions: Record<string, number> = {};
          const midi_revisions: Record<string, number> = {};
          for (const [node, edit] of sent) {
            if (edit.cc !== undefined && snapshot.midi_revisions?.[node] !== undefined) midi_revisions[node] = edit.midiRevision ?? snapshot.midi_revisions[node];
            if (edit.value !== undefined) values[node] = edit.value;
            if (edit.cc !== undefined) midi_ccs[node] = edit.cc;
            revisions[node] = edit.revision ?? snapshot.revisions[node];
          }
          let result: PerformanceControllerSnapshot;
          let conflict = false;
          try { result = await api.patchPerformanceControllers(id, bindingId, { values, midi_ccs, revisions, ...(Object.keys(midi_revisions).length ? { midi_revisions } : {}) }); }
          catch (error) {
            if (!isApiError(error) || error.status !== 409) throw error;
            const parsed = JSON.parse(error.body) as { detail?: { snapshot?: PerformanceControllerSnapshot } };
            if (!parsed.detail?.snapshot) throw error;
            result = parsed.detail.snapshot; conflict = true;
          }
          if (id !== get().activeSessionId || epoch !== get().performanceWorkspaceGeneration) continue;
          for (const [node, edit] of sent) {
            const latest = edits.get(node);
            if (latest?.sequence === edit.sequence) {
              if (conflict && edit.cc !== undefined) edits.set(node, { cc: edit.cc, revision: result.revisions[node], midiRevision: result.midi_revisions?.[node], sequence: ++sequence });
              else edits.delete(node);
            }
            else if (latest && !conflict && latest.revision === edit.revision) latest.revision = result.revisions[node];
          }
          receive(id, { [bindingId]: result });
          set({ performanceControllerSyncError: null });
        } catch (error) {
          if (id !== get().activeSessionId || epoch !== get().performanceWorkspaceGeneration) continue;
          set({ performanceControllerSyncError: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }
    })();
    try { await running; } finally { running = undefined; }
  };

  function edit(bindingId: string, nodeId: string, change: { value?: number | null; cc?: number | null }) {
    const state = context(), binding = state.sequencerInstruments.find(item => item.id === bindingId);
    const patch = state.patches.find(item => item.id === binding?.patchId);
    const definition = patch?.performance_controllers?.find(item => item.node_id === nodeId);
    if (!binding || !definition || definition.error) return;
    if (change.cc !== undefined && (patch?.always_on || binding.midiChannel === 0 || (change.cc !== null && (!Number.isInteger(change.cc) || change.cc < 1 || change.cc > 50)))) return;
    if (change.value !== undefined && change.value !== null) {
      if (!Number.isFinite(change.value)) return;
      change.value = normalizeControllerValue(change.value, definition);
    }
    const values = { ...binding.performanceControllerValues }, ccs = { ...binding.performanceControllerMidiCCs };
    for (const [field, target] of [["value", values], ["cc", ccs]] as const) {
      if (change[field] === null) delete target[nodeId];
      else if (change[field] !== undefined) target[nodeId] = change[field];
    }
    const edits = pending.get(bindingId) ?? new Map<string, Edit>();
    edits.set(nodeId, { ...edits.get(nodeId), ...change, revision: known.get(bindingId)?.revisions[nodeId], midiRevision: known.get(bindingId)?.midi_revisions?.[nodeId], sequence: ++sequence });
    pending.set(bindingId, edits);
    set({ sequencerInstruments: state.sequencerInstruments.map(item => item.id === bindingId ? { ...item, performanceControllerValues: values, performanceControllerMidiCCs: ccs, performanceControllerNotice: false } : item) });
    if (!timer) timer = setTimeout(() => { timer = undefined; void flush().catch(() => undefined); }, 34);
  }

  async function remap(bindingId: string, nodeId: string, cc: number | null) {
    let initial = context();
    if (!initial.sequencer.controllerSequencers.some(t => t.automationTarget?.instrumentId === bindingId)) { edit(bindingId, nodeId, { cc }); return; }
    const choices: Record<string, string> = {};
    while (true) {
      initial = context();
      const epoch = initial.performanceWorkspaceGeneration;
      const affected = new Set(initial.sequencer.controllerSequencers.filter(t => t.automationTarget?.instrumentId === bindingId).map(t => t.id));
      if (hasChangedClipDrafts(initial.sequencer.clipArrangement, Object.fromEntries(Object.entries(initial.clipDrafts).filter(([, d]) => affected.has(d.target.laneId)))) ||
          affected.has(useStructureDraft.getState().draft?.laneId ?? "")) {
        set({ performanceControllerSyncError: automationCopy(initial.guiLanguage).saveDrafts });
        return;
      }
      const binding = initial.sequencerInstruments.find(b => b.id === bindingId);
      const definition = initial.patches.find(p => p.id === binding?.patchId)?.performance_controllers?.find(d => d.node_id === nodeId);
      if (!binding || !definition || definition.error || binding.midiChannel === 0 || cc !== null && (!Number.isInteger(cc) || cc < 1 || cc > 50)) return;
      const mappings = { ...binding.performanceControllerMidiCCs };
      if (cc === null) delete mappings[nodeId]; else mappings[nodeId] = cc;
      const bindings = initial.sequencerInstruments.map(b => b.id === bindingId ? { ...b, performanceControllerMidiCCs: mappings } : b);
      try {
        const sequencer = reconcileAutomation(initial.sequencer, bindings, initial.patches, choices);
        if (initial.activeSessionId && sessionIsCurrent(initial)) {
          await flush();
          await refresh(initial.activeSessionId);
          if (get().performanceWorkspaceGeneration !== epoch || get().activeSessionId !== initial.activeSessionId) return;
          if (get().sequencer !== initial.sequencer) continue;
          const snapshot = known.get(bindingId);
          if (!snapshot) throw new Error("Instrument controller state is unavailable.");
          remapping.add(bindingId);
          const result = await api.patchPerformanceControllers(initial.activeSessionId, bindingId, { midi_ccs: { [nodeId]: cc }, revisions: { [nodeId]: snapshot.revisions[nodeId] },
            midi_revisions: snapshot.midi_revisions ? { [nodeId]: snapshot.midi_revisions[nodeId] } : undefined,
            sequencer_config: automationRuntimeConfig(sequencer) });
          const current = get();
          if (current.performanceWorkspaceGeneration !== epoch || current.activeSessionId !== initial.activeSessionId) { remapping.delete(bindingId); return; }
          if (current.sequencer !== initial.sequencer) {
            // A musical edit arrived while preparing. Restore the old assignment together
            // with that newer music; never overwrite it with the prepared snapshot.
            await api.patchPerformanceControllers(initial.activeSessionId, bindingId, {
              midi_ccs: { [nodeId]: binding.performanceControllerMidiCCs?.[nodeId] ?? null },
              revisions: { [nodeId]: result.revisions[nodeId] },
              midi_revisions: result.midi_revisions ? { [nodeId]: result.midi_revisions[nodeId] } : undefined,
              sequencer_config: automationRuntimeConfig(current.sequencer)
            });
            remapping.delete(bindingId);
            continue;
          }
        }
        remapping.delete(bindingId);
        const current = get();
        if (current.performanceWorkspaceGeneration !== epoch || current.sequencer !== initial.sequencer) throw new Error("The performance changed while remapping automation. Retry the assignment.");
        set({ sequencer, sequencerInstruments: current.sequencerInstruments.map(b => b.id === bindingId ? { ...b, performanceControllerMidiCCs: mappings } : b),
          sequencerEditRevision: current.sequencerEditRevision + 1, performanceControllerSyncError: null });
        if (current.activeSessionId) await refresh(current.activeSessionId);
        return;
      } catch (error) {
        remapping.delete(bindingId);
        if (error instanceof AutomationMergeConflict) {
          const selected = await chooseAutomationMerge(error);
          if (!selected || get().performanceWorkspaceGeneration !== epoch) return;
          choices[error.key] = selected;
        } else {
          set({ performanceControllerSyncError: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
    }
  }

  onMixerConnected(id => { if (get().activeSessionId === id) void refresh(id).then(flush).catch(() => undefined); });
  return { setPerformanceControllerValue: (binding, node, value) => edit(binding, node, { value }),
    setPerformanceControllerMidiCC: (binding, node, cc) => {
      if (!get().sequencer.controllerSequencers.some(t => t.automationTarget?.instrumentId === binding)) edit(binding, node, { cc });
      else mappingWork = (mappingWork ?? Promise.resolve()).then(() => remap(binding, node, cc));
    },
    flushPerformanceControllers: () => mappingWork ? mappingWork.then(flush) : flush(), receivePerformanceControllers: receive, refreshPerformanceControllers: refresh };
}
