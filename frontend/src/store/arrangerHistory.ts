import type { StoreApi } from "zustand";
import type { PadLoopPatternState, SequencerState } from "../types";
import type { ArrangementLaneKind } from "../lib/arrangementRange";
import { validateArrangementEdit } from "../lib/arrangementEditing";
import { normalizePadLoopPatternForState, normalizeSequencerState } from "./appStoreModel";
import { sequencerEditAccess } from "./sequencerEdits";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import type { AppStore } from "./appStoreTypes";

export const ARRANGER_HISTORY_LIMIT = 25;
export const arrangerActionCodes = ["place", "move", "remove", "closeGap", "rest", "group", "super", "ungroup", "variation", "deleteDefinition", "color", "source", "repeat", "overwrite", "insertAll", "insertSelected", "duplicateAll", "duplicateSelected"] as const;
export type ArrangerActionCode = typeof arrangerActionCodes[number];
const keys = { sequencer: "tracks", drummer: "drummerTracks", controller: "controllerSequencers", arpeggiator: "arpeggiators" } as const;
type Track = SequencerState[typeof keys[ArrangementLaneKind]][number];
type Pad = Track["pads"][number];
type Identity = { id: string; kind: ArrangementLaneKind };
type Values = { pattern?: PadLoopPatternState; source?: boolean; repeat?: boolean; pads?: Record<string, Pad> };
type Change = Identity & { before: Values; after: Values };
export type ArrangerHistoryEntry = { action: ArrangerActionCode; labels: string[]; changes: Change[] };
type Basis = Identity & { pattern: PadLoopPatternState; source: boolean; repeat: boolean; lengths: number[]; ratio: number[]; meterDenominator?: number; pads: Record<string, Pad>; rows?: string[] };
export type ArrangerHistory = { version: 1; entries: ArrangerHistoryEntry[]; cursor: number; basis: Basis[] };
export type ArrangerUpdate = Identity & Omit<Values, "pads"> & { copyPad?: { from: number; to: number } };
export const emptyArrangerHistory = (): ArrangerHistory => ({ version: 1, entries: [], cursor: 0, basis: [] });
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (!record(a) || !record(b)) return false;
  const fields = Object.keys(a).filter(key => a[key] !== undefined);
  return fields.length === Object.keys(b).filter(key => b[key] !== undefined).length && fields.every(key => equal(a[key], b[key]));
}
function trackFor(state: SequencerState, lane: Identity): Track {
  const track = state[keys[lane.kind]]?.find(t => t.id === lane.id);
  if (!track || "playbackMode" in track && track.playbackMode !== "arranger") throw new Error("Missing arranger lane.");
  return track;
}
function valuesFor(track: Track, fields: Values): Values {
  return {
    ...(fields.pattern !== undefined ? { pattern: track.padLoopPattern } : {}),
    ...(fields.source !== undefined ? { source: track.padLoopEnabled } : {}),
    ...(fields.repeat !== undefined ? { repeat: track.padLoopRepeat } : {}),
    ...(fields.pads ? { pads: Object.fromEntries(Object.keys(fields.pads).map(index => [index, track.pads[Number(index)]])) } : {})
  };
}
function applyValues(state: SequencerState, lane: Identity, values: Values): SequencerState {
  const track = trackFor(state, lane);
  if (values.pattern) validateArrangementEdit(track.padLoopPattern, values.pattern);
  const pattern = values.pattern ? normalizePadLoopPatternForState(values.pattern) : null;
  const next = { ...track,
    ...(pattern ? { padLoopPattern: pattern.padLoopPattern, ...("padLoopSequence" in track ? { padLoopSequence: pattern.padLoopSequence } : {}) } : {}),
    ...(values.source !== undefined ? { padLoopEnabled: values.source } : {}),
    ...(values.repeat !== undefined ? { padLoopRepeat: values.repeat } : {})
  };
  if (values.pads) {
    Object.assign(next, { pads: track.pads.map((pad, index) => values.pads?.[index] ? structuredClone(values.pads[index]) : pad) });
    // Keep the authored active-pad mirrors coherent; runtime pad selection is separate.
    const pad = next.pads[next.activePad];
    if (pad) for (const key of ["steps", "lengthBeats", "stepCount", "scaleRoot", "scaleType", "mode", "keypoints"] as const) {
      if (key in next && key in pad) Object.assign(next, { [key]: (pad as unknown as Record<string, unknown>)[key] });
    }
  }
  return { ...state, [keys[lane.kind]]: state[keys[lane.kind]].map(t => t.id === lane.id ? next : t) };
}
export function historyBasis(state: SequencerState, entries: ArrangerHistoryEntry[]): Basis[] {
  const lanes = new Map<string, Identity & { slots: Set<string> }>();
  for (const entry of entries) for (const change of entry.changes) {
    const key = `${change.kind}:${change.id}`;
    const lane = lanes.get(key) ?? { id: change.id, kind: change.kind, slots: new Set<string>() };
    for (const slot of Object.keys(change.after.pads ?? {})) lane.slots.add(slot);
    lanes.set(key, lane);
  }
  return [...lanes.values()].map(lane => {
    const track = trackFor(state, lane);
    return { id: lane.id, kind: lane.kind, pattern: track.padLoopPattern, source: track.padLoopEnabled, repeat: track.padLoopRepeat,
      meterDenominator: "timing" in track ? track.timing.meterDenominator : 4,
      lengths: track.pads.map(p => p.lengthBeats), ratio: "timing" in track ? [track.timing.beatRateNumerator, track.timing.beatRateDenominator] : [1, 1],
      pads: Object.fromEntries([...lane.slots].map(slot => [slot, track.pads[Number(slot)]])),
      ...("rows" in track ? { rows: track.rows.map(row => row.id) } : {}) };
  });
}
export function historyMatches(state: SequencerState, history: ArrangerHistory): boolean {
  try { return equal(history.basis.map(basis => ({ ...basis, meterDenominator: basis.meterDenominator ?? 4 })), historyBasis(state, history.entries)); } catch { return false; }
}
/** Source changes must also update an independently running device's transport intent. */
export function playingArrangerSourceChanges(state: AppStore, previous: AppStore): string[] {
  if (state.arrangerHistory === previous.arrangerHistory || state.sequencer === previous.sequencer ||
    state.performanceWorkspaceGeneration !== previous.performanceWorkspaceGeneration || state.activeSessionState !== "running") return [];
  const displayed = mergedSequencerState(previous.sequencer, previous.sequencerRuntime);
  return Object.values(keys).flatMap(key => state.sequencer[key].flatMap(track => {
    const old = displayed[key].find(t => t.id === track.id);
    if (!old || old.padLoopEnabled === track.padLoopEnabled) return [];
    const playing = "playbackMode" in old ? old.playbackMode === "arranger" && old.runtimeStatus?.enabled
      : previous.sequencerRuntime.isPlaying && old.enabled;
    return playing ? [track.id] : [];
  }));
}
function replay(state: SequencerState, entry: ArrangerHistoryEntry, forward: boolean): SequencerState {
  let next = state;
  for (const change of entry.changes) {
    const expected = forward ? change.before : change.after;
    if (!equal(valuesFor(trackFor(next, change), expected), expected)) throw new Error("Conflicting arranger history.");
    next = applyValues(next, change, forward ? change.after : change.before);
  }
  return next;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function checkValues(value: unknown, state: SequencerState, lane: Identity): asserts value is Values {
  if (!record(value) || Object.keys(value).some(k => !["pattern", "source", "repeat", "pads"].includes(k))) throw new Error("Invalid history fields.");
  for (const k of ["source", "repeat"]) if (k in value && typeof value[k] !== "boolean") throw new Error("Invalid history setting.");
  if (value.pattern !== undefined) {
    validateArrangementEdit(trackFor(state, lane).padLoopPattern, value.pattern as PadLoopPatternState);
    if (!equal(normalizePadLoopPatternForState(value.pattern as PadLoopPatternState).padLoopPattern, value.pattern)) throw new Error("Invalid history pattern.");
  }
  if (value.pads !== undefined) {
    if (!record(value.pads) || Object.keys(value.pads).some(k => !/^[0-7]$/.test(k))) throw new Error("Invalid history pads.");
    const candidate = applyValues(state, lane, value as Values);
    const normalized = normalizeSequencerState(candidate);
    for (const [slot, pad] of Object.entries(value.pads)) if (!record(pad) || !equal(trackFor(normalized, lane).pads[Number(slot)], pad)) throw new Error("Invalid history pad.");
  }
}
/** Optional metadata must never prevent loading the musical performance. */
export function readArrangerHistory(raw: unknown, state: SequencerState): { arrangerHistory: ArrangerHistory; arrangerHistoryNotice: boolean } {
  if (raw === undefined) return { arrangerHistory: emptyArrangerHistory(), arrangerHistoryNotice: false };
  try {
    if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > ARRANGER_HISTORY_LIMIT ||
      !Number.isInteger(raw.cursor) || Number(raw.cursor) < 0 || Number(raw.cursor) > raw.entries.length || !Array.isArray(raw.basis)) throw new Error("Invalid history.");
    for (const entry of raw.entries) {
      if (!record(entry) || !arrangerActionCodes.includes(entry.action as ArrangerActionCode) || !Array.isArray(entry.labels) ||
        entry.labels.length > 64 || entry.labels.some(label => typeof label !== "string" || label.length > 256) ||
        !Array.isArray(entry.changes) || !entry.changes.length || entry.changes.length > 64) throw new Error("Invalid history entry.");
      const seen = new Set<string>();
      for (const change of entry.changes) {
        if (!record(change) || typeof change.id !== "string" || !Object.prototype.hasOwnProperty.call(keys, String(change.kind)) || seen.has(`${change.kind}:${change.id}`)) throw new Error("Invalid history lane.");
        seen.add(`${change.kind}:${change.id}`);
        const lane = change as unknown as Identity;
        checkValues(change.before, state, lane); checkValues(change.after, state, lane);
        if (!equal(Object.keys(change.before as object).sort(), Object.keys(change.after as object).sort()) ||
          !equal(Object.keys((change.before as Values).pads ?? {}).sort(), Object.keys((change.after as Values).pads ?? {}).sort())) throw new Error("Invalid history transition.");
      }
    }
    const history = raw as unknown as ArrangerHistory;
    if (!historyMatches(state, history)) throw new Error("Stale history.");
    let previous = state, future = state;
    for (let i = history.cursor - 1; i >= 0; i--) previous = replay(previous, history.entries[i], false);
    for (let i = history.cursor; i < history.entries.length; i++) future = replay(future, history.entries[i], true);
    return { arrangerHistory: structuredClone(history), arrangerHistoryNotice: false };
  } catch { return { arrangerHistory: emptyArrangerHistory(), arrangerHistoryNotice: true }; }
}

export function createArrangerHistoryActions(set: StoreApi<AppStore>["setState"], get: () => AppStore): Pick<AppStore, "commitArrangerEdit" | "undoArranger" | "redoArranger" | "goToArrangerHistory"> {
  const edit = sequencerEditAccess(set, get);
  const commit = (sequencer: SequencerState, history: ArrangerHistory, restored = false) => {
    const original = get().sequencer;
    const displayed = edit.get().sequencer;
    const projected = { ...displayed };
    for (const key of Object.values(keys)) {
      Object.assign(projected, { [key]: displayed[key].map(track => {
        const before = original[key].find(t => t.id === track.id)!;
        const after = sequencer[key].find(t => t.id === track.id)!;
        return { ...track, ...Object.fromEntries(Object.entries(after).filter(([field, value]) => value !== (before as unknown as Record<string, unknown>)[field])) };
      }) });
    }
    edit.set({ sequencer: projected, arrangerHistory: history, arrangerHistoryNotice: false,
      arrangerHistoryRestoreRevision: get().arrangerHistoryRestoreRevision + Number(restored) });
  };
  return {
    commitArrangerEdit: (action, updates) => {
      const state = get();
      let next = state.sequencer;
      const changes: Change[] = [], labels: string[] = [], seen = new Set<string>();
      for (const update of updates) {
        const track = trackFor(next, update);
        const key = `${update.kind}:${update.id}`;
        if (seen.has(key)) throw new Error("Duplicate arranger lane.");
        seen.add(key);
        const requested: Values = { ...(update.pattern ? { pattern: update.pattern } : {}),
          ...(update.source !== undefined ? { source: update.source } : {}), ...(update.repeat !== undefined ? { repeat: update.repeat } : {}) };
        // First placement also selects Arrangement for range pastes and other entry points.
        // Once populated, timeline edits retain the device's saved source choice.
        if (update.source === undefined && update.pattern && !track.padLoopPattern.rootSequence.length && update.pattern.rootSequence.length) {
          requested.source = true;
        }
        if (update.copyPad) {
          const { from, to } = update.copyPad;
          if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < 8)) throw new Error("Invalid pad slot.");
          requested.pads = { [to]: structuredClone(track.pads[from]) };
        }
        next = applyValues(next, update, requested);
        const before: Values = {}, after: Values = {};
        const result = valuesFor(trackFor(next, update), requested), original = valuesFor(track, requested);
        for (const field of ["pattern", "source", "repeat", "pads"] as const) if (!equal(original[field], result[field])) {
          Object.assign(before, { [field]: original[field] }); Object.assign(after, { [field]: result[field] });
        }
        if (Object.keys(after).length) { changes.push({ id: update.id, kind: update.kind, before, after }); labels.push(track.name); }
      }
      if (!changes.length) return;
      const old = state.arrangerHistory;
      const entries = [...old.entries.slice(0, old.cursor), structuredClone({ action, labels, changes })].slice(-ARRANGER_HISTORY_LIMIT);
      commit(next, { version: 1, entries, cursor: entries.length, basis: structuredClone(historyBasis(next, entries)) });
    },
    goToArrangerHistory: cursor => {
      const state = get(), history = state.arrangerHistory;
      if (!Number.isInteger(cursor) || cursor < 0 || cursor > history.entries.length || cursor === history.cursor) return;
      if (!historyMatches(state.sequencer, history)) { set({ arrangerHistory: emptyArrangerHistory(), arrangerHistoryNotice: true }); return; }
      let next = state.sequencer;
      for (let i = history.cursor; i > cursor; i--) next = replay(next, history.entries[i - 1], false);
      for (let i = history.cursor; i < cursor; i++) next = replay(next, history.entries[i], true);
      commit(next, { ...history, cursor, basis: structuredClone(historyBasis(next, history.entries)) }, true);
    },
    undoArranger: () => get().goToArrangerHistory(get().arrangerHistory.cursor - 1),
    redoArranger: () => get().goToArrangerHistory(get().arrangerHistory.cursor + 1)
  };
}
