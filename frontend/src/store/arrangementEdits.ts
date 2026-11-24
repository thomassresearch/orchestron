import { refreshStructureWindows } from "../lib/clipArranger/structure";
import { useAppStore } from "./useAppStore";
import type { AppStore } from "./appStoreTypes";
import { sameArrangement, useArrangementEdits, workingArrangement, workingSequencer, type EditFrame } from "../lib/clipArranger/editSession";
import { arrangementTimings, sourceKeys } from "../lib/clipArranger/migration";
import { validateArrangement, type ClipArrangement, type DefinitionDraft, type OccurrenceTarget } from "../lib/clipArranger/model";
import { beginDraft, emptyClipHistory, recordClipEdit, replayClipEdit, saveDraft } from "../lib/clipArranger/operations";
import { reviewStructureDraft, useStructureDraft } from "../lib/clipArranger/structureStore";
import type { StructureDraft } from "../lib/clipArranger/structure";
import { hasChangedClipDrafts } from "../lib/clipArranger/draftResolution";
import { remapMusicalTarget } from "../lib/clipArranger/structuralDraftResolution";
import { draftKey } from "../lib/clipArranger/editorAdapter";
import { saveTransposeEdits, transposeFingerprint } from "../lib/clipArranger/transposeEdits";
import { definitionRelationships, effectiveScope } from "../lib/clipArranger/relationships";
import { editCopy } from "../lib/clipArranger/editCopy";
import type { SequencerState } from "../types";
import { clipSongPlayback, songDraftPlayback, previewIdFactory } from "../lib/clipArranger/songDrafts";

let restoring = false;
let gesture: EventTarget | null = null;
let recordedGesture: EventTarget | null = null;
export function beginArrangementGesture(target: EventTarget) { gesture = target; recordedGesture = null; }
export function endArrangementGesture() { gesture = recordedGesture = null; }

function frame(state = useAppStore.getState(), structure = useStructureDraft.getState().draft): EditFrame {
  return { model: workingArrangement(state.sequencer)!, drafts: state.clipDrafts, editor: state.clipEditingKey, structure };
}
function record(before: EditFrame, model = before.model) {
  if (restoring || !before.model) return;
  const session = useArrangementEdits.getState().session;
  const basis = session?.basis ?? useAppStore.getState().sequencer.clipArrangement!;
  const past = gesture && gesture === recordedGesture && session ? session.past : [...(session?.past ?? []), before];
  recordedGesture = gesture;
  useArrangementEdits.setState({ session: { basis, model, past, future: [] } });
}
export function observeMusicalEdit(state: AppStore, previous: AppStore) {
  if (restoring || !state.sequencer.clipArrangement || state.clipDrafts === previous.clipDrafts || state.performanceWorkspaceGeneration !== previous.performanceWorkspaceGeneration) return;
  const model = workingArrangement(state.sequencer);
  for (const [key, draft] of Object.entries(state.clipDrafts)) {
    const old = previous.clipDrafts[key];
    if (!old || old === draft || draft.provisionalDuplicate || old.target !== draft.target) continue;
    if ((draft.definition !== old.definition || draft.transposeEdits !== old.transposeEdits || draft.editIntent !== old.editIntent || draft.additions !== old.additions)
      && (hasChangedClipDrafts(model, { draft }) || hasChangedClipDrafts(model, { draft: old }))) {
      record(frame(previous)); return;
    }
  }
}
export function observeStructuralEdit(next: StructureDraft | null, old: StructureDraft | null) {
  if (!restoring && next?.cursor && (next.roots !== old?.roots || next.editIntent !== old?.editIntent)) record(frame(useAppStore.getState(), old));
}
function atomic(action: () => void) {
  const previous = restoring;
  restoring = true;
  try { action(); } finally { restoring = previous; }
}

function assertCurrentBasis(state: AppStore) {
  const session = useArrangementEdits.getState().session;
  if (session && state.sequencer.clipArrangement !== session.basis) throw Error(editCopy(state.guiLanguage).stale);
}

export function stageArrangement(model: ClipArrangement) {
  const state = useAppStore.getState(), before = frame(state);
  assertCurrentBasis(state);
  validateArrangement(model, arrangementTimings(state.sequencer));
  if (sameArrangement(before.model, model)) return;
  record(before, model);
  atomic(() => {
    // Removed windows can own an open editor. Keep unrelated drafts and close vanished targets.
    const drafts = Object.fromEntries(Object.entries(before.drafts).filter(([, d]) =>
      model.lanes.find(l => l.id === d.target.laneId)?.clips.some(c => c.id === d.target.clipId)));
    const structural = before.structure;
    if (structural) {
      const lane = model.lanes.find(l => l.id === structural.laneId);
      useStructureDraft.setState({ draft: lane?.clips.some(c => c.id === structural.clipId) ? refreshStructureWindows(model, structural) : null });
    }
    useAppStore.setState({ clipDrafts: drafts, clipEditingKey: before.editor && drafts[before.editor] ? before.editor : null, sequencerEditRevision: state.sequencerEditRevision + 1 });
  });
}


/** Resolve into private models first, so a failed gesture or Save publishes no partial work. */
export function resolveArrangement(current: EditFrame, state = useAppStore.getState()) {
  const timings = arrangementTimings(state.sequencer);
  let model = current.model;
  const targets = new Map(Object.entries(current.drafts).map(([key, draft]) => [key, draft.target]));
  const structure = current.structure;
  const review = reviewStructureDraft(model, structure, timings);
  if (structure?.cursor) {
    if (!review.result) throw Error(review.error || "Choose the structural editing scope.");
    model = review.result.model;
    for (const [key, target] of targets) {
      const mapped = review.result.occurrences.find(item => draftKey({ target: item.from }) === key)?.to;
      if (mapped) targets.set(key, mapped);
      else if (target.clipId === structure.clipId && target.pass === structure.pass && review.result.previewPaths.length) {
        const path = review.result.previewPaths.find(p => JSON.stringify(p.before) === JSON.stringify(target.path))?.after;
        if (path) targets.set(key, { ...target, path, pass: model.lanes.find(l => l.id === target.laneId)?.clips.find(c => c.id === target.clipId)?.mode === "once" ? 0 : target.pass });
      }
    }
  }
  const pending = Object.entries(current.drafts).filter(([, draft]) =>
    !draft.provisionalDuplicate && hasChangedClipDrafts(current.model, {draft}));
  const factories = new Map(pending.map(([key, draft]) => [key, previewIdFactory(draft.target)]));
  // Resolve offsets first so local note variations inherit the intended shared profile.
  for (const [key, draft] of pending) {
    if (!draft.transposeEdits?.length) continue;
    const source = transposeFingerprint(current.model, draft.target);
    if (draft.transposeEdits.some(edit => edit.fingerprint !== source)) throw Error(draft.definition.name + " · " + editCopy(state.guiLanguage).stale);
    const target = targets.get(key)!;
    const fingerprint = transposeFingerprint(model, target);
    model = saveTransposeEdits(model, target, draft.transposeEdits.map(edit => ({...edit, fingerprint})), timings, factories.get(key));
  }
  for (const [key, draft] of pending) {
    const target = targets.get(key)!;
    const original = beginDraft(model, target);
    const oldLane = current.model.lanes.find(l => l.id === draft.target.laneId)!;
    const basis = oldLane.definitions.find(d => d.id === draft.definition.id);
    if (draft.baseFingerprint && draft.baseFingerprint !== JSON.stringify(basis)) throw Error(draft.definition.name + " · " + editCopy(state.guiLanguage).stale);
    if (!hasChangedClipDrafts(current.model, { draft: { ...draft, transposeEdits: undefined } })) continue;
    const relationship = draft.editIntent?.explicit ? undefined : definitionRelationships(oldLane, timings[oldLane.id]).get(draft.definition.id);
    const scope = effectiveScope(draft.editIntent, relationship);
    if (!scope) throw Error("Choose the editing scope for " + draft.definition.name);
    const definition = { ...draft.definition, transposeProfileId: original.definition.transposeProfileId,
      name: scope === "local" ? draft.editIntent?.variationName?.trim() || draft.definition.name : draft.definition.name };
    const before = model;
    model = saveDraft(model, { ...draft, ...original, definition }, scope, timings, factories.get(key));
    if (scope === "local") for (const [other, location] of targets) {
      if (location.laneId === target.laneId) targets.set(other, remapMusicalTarget(before, model, location, timings));
    }
  }
  validateArrangement(model, timings);
  return { model, targets, review };
}

function cleanEditors(current: EditFrame, model: ClipArrangement, targets: Map<string, OccurrenceTarget>) {
  const drafts: Record<string, DefinitionDraft> = {};
  let editor: string | null = null;
  for (const [key, old] of Object.entries(current.drafts)) {
    const target = targets.get(key) ?? old.target;
    try {
      const next = beginDraft(model, target), newKey = draftKey(next);
      next.editIntent = next.definition.id !== old.definition.id ? { scope: "all", explicit: true } : old.editIntent && { ...old.editIntent, variationNameEdited: false };
      drafts[newKey] = next;
      if (current.editor === key) editor = newKey;
    } catch { /* Deleted content has no editor. */ }
  }
  return { clipDrafts: drafts, clipEditingKey: editor };
}

/** Finish a sub-editor into the same working transaction when another target needs its result. */
export function flushArrangementEditors() {
  const state = useAppStore.getState(), current = frame(state);
  assertCurrentBasis(state);
  const resolved = resolveArrangement(current, state);
  const session = useArrangementEdits.getState().session;
  if (resolved.model !== current.model && !session) record(current, resolved.model);
  atomic(() => {
    if (session) useArrangementEdits.setState({ session: { ...session, model: resolved.model } });
    useStructureDraft.setState({ draft: null });
    useAppStore.setState(cleanEditors(current, resolved.model, resolved.targets));
  });
  return resolved;
}
export function saveArrangementEdits() {
  const state = useAppStore.getState();
  const basis = state.sequencer.clipArrangement!;
  assertCurrentBasis(state);
  const current = frame(state), { model, targets } = resolveArrangement(current, state);
  const changed = !sameArrangement(basis, model);
  const sequencer = changed ? { ...state.sequencer, clipArrangement: model, clipHistory: recordClipEdit(state.sequencer.clipHistory ?? emptyClipHistory(), basis, model, editCopy(state.guiLanguage).changes, arrangementTimings(state.sequencer)) } : state.sequencer;
  atomic(() => {
    useArrangementEdits.setState({ session: null });
    useStructureDraft.setState({ draft: null });
    useAppStore.setState({ sequencer, ...cleanEditors(current, model, targets), sequencerEditRevision: state.sequencerEditRevision + Number(changed) });
  });
}
export function cancelArrangementEdits() {
  const state = useAppStore.getState();
  atomic(() => {
    useArrangementEdits.setState({ session: null });
    useStructureDraft.setState({ draft: null });
    useAppStore.setState({ clipDrafts: {}, clipEditingKey: null, sequencerEditRevision: state.sequencerEditRevision + 1 });
  });
}
export function arrangementHistoryStep(redo: boolean) {
  endArrangementGesture();
  const state = useAppStore.getState(), session = useArrangementEdits.getState().session;
  if (!session) {
    const model = state.sequencer.clipArrangement!;
    const next = replayClipEdit(state.sequencer.clipHistory ?? emptyClipHistory(), model, redo, arrangementTimings(state.sequencer));
    if (next.model !== model) atomic(() => {
      useStructureDraft.setState({ draft: null });
      useAppStore.setState({ sequencer: { ...state.sequencer, clipArrangement: next.model, clipHistory: next.history },
        ...cleanEditors(frame(state), next.model, new Map()), sequencerEditRevision: state.sequencerEditRevision + 1 });
    });
    return;
  }
  const current = frame(state), stack = redo ? session.future : session.past, target = stack[stack.length - 1];
  if (!target) return;
  atomic(() => {
    useArrangementEdits.setState({ session: { ...session, model: target.model,
      past: redo ? [...session.past, current] : stack.slice(0, -1), future: redo ? stack.slice(0, -1) : [...session.future, current] } });
    useStructureDraft.setState({ draft: target.structure });
    useAppStore.setState({ clipDrafts: target.drafts, clipEditingKey: target.editor, sequencerEditRevision: state.sequencerEditRevision + 1 });
  });
}

/** The runtime receives the resolved working model. Exports still use the authored sequencer. */
export function arrangementPlayback(sequencer: SequencerState, drafts: EditFrame["drafts"], audition: DefinitionDraft | null, structure: StructureDraft | null) {
  const state = useAppStore.getState(), working = workingSequencer(sequencer), model = working.clipArrangement;
  let song = working;
  if (model && (structure?.cursor || hasChangedClipDrafts(model, drafts))) {
    try {
      const resolved = resolveArrangement({ model, structure, drafts, editor: null }, { ...state, sequencer: working });
      song = { ...working, clipArrangement: resolved.model };
    } catch {
      // An invalid edit stays in the editor. Continue with the independently playable changes.
      song = songDraftPlayback(working, drafts, structure);
    }
  }
  return clipSongPlayback(working, drafts, audition, structure, song);
}

/** Apply device topology changes to the committed model and carry unrelated staged lanes forward. */
export function withTrackSetup<T>(affected: string[], action: () => T): T {
  const session = useArrangementEdits.getState().session;
  if (!session) return action();
  const state = useAppStore.getState(), basis = state.sequencer.clipArrangement!;
  if (basis !== session.basis) throw Error(editCopy(state.guiLanguage).stale);
  const frames = [frame(state), ...session.past, ...session.future];
  for (const id of affected) {
    if (frames.some(f => f.model.lanes.findIndex(l => l.id === id) !== basis.lanes.findIndex(l => l.id === id) ||
      f.structure?.cursor && f.structure.laneId === id ||
      Object.values(f.drafts).some(d => d.target.laneId === id && hasChangedClipDrafts(f.model, { d })) ||
      JSON.stringify(f.model.lanes.find(l => l.id === id)) !== JSON.stringify(basis.lanes.find(l => l.id === id)))) {
      const track = Object.values(sourceKeys).flatMap(k => state.sequencer[k].map(t => ({ id: t.id, name: t.name }))).find(t => t.id === id);
      throw Error((track?.name ?? id) + " · " + editCopy(state.guiLanguage).setup);
    }
  }
  const result = action(), next = useAppStore.getState().sequencer.clipArrangement!;
  if (basis === next) return result;
  function rebase(model: ClipArrangement) {
    if (model === basis) return next;
    const surviving = new Set(next.lanes.map(l => l.id));
    const lanes = model.lanes.filter(l => surviving.has(l.id)).map(lane => affected.includes(lane.id) ? next.lanes.find(l => l.id === lane.id)! : lane);
    for (const [i, lane] of next.lanes.entries()) if (!lanes.some(l => l.id === lane.id)) {
      const preceding = next.lanes[i - 1];
      lanes.splice(preceding ? lanes.findIndex(l => l.id === preceding.id) + 1 : 0, 0, lane);
    }
    return { ...model, version: Math.max(next.version, model.version) as ClipArrangement["version"],
      revision: model.revision + 1, end: Math.max(model.end, ...lanes.flatMap(l => l.clips.map(c => c.start + c.length))), lanes };
  }
  const surviving = new Set(next.lanes.map(l => l.id));
  function rebaseFrame(f: EditFrame): EditFrame {
    const drafts = Object.fromEntries(Object.entries(f.drafts).filter(([, draft]) => surviving.has(draft.target.laneId)));
    return { model: rebase(f.model), drafts, editor: f.editor && drafts[f.editor] ? f.editor : null,
      structure: f.structure && surviving.has(f.structure.laneId) ? f.structure : null };
  }
  useArrangementEdits.setState({ session: { basis: next, model: rebase(session.model), past: session.past.map(rebaseFrame), future: session.future.map(rebaseFrame) } });
  return result;
}
