import { refreshStructureWindows } from '../lib/clipArranger/structure';
import { useAppStore } from "./useAppStore";
import { arrangementTimings, migrateClipArrangement, sourceKeys } from "../lib/clipArranger/migration";
import { contentLength, validateArrangement, type ClipArrangement, type Definition, type OccurrenceTarget } from "../lib/clipArranger/model";
import { beginDraft, emptyClipHistory, recordClipEdit, replayClipEdit, saveDraft } from "../lib/clipArranger/operations";
import { draftKey } from "../lib/clipArranger/editorAdapter";
import { rebaseStructure, retainMusicalDrafts } from "../lib/clipArranger/structuralDraftResolution";
import { useStructureDraft } from "../lib/clipArranger/structureStore";
import { saveTransposeEdits } from '../lib/clipArranger/transposeEdits';

export function saveClipTransposition(resolvingKey?: string) {
  const state = useAppStore.getState(), key = resolvingKey ?? state.clipEditingKey, model = state.sequencer.clipArrangement;
  if (!key || !model || !state.clipDrafts[key]?.transposeEdits?.length) return;
  const draft = state.clipDrafts[key], timings = arrangementTimings(state.sequencer);
  const current = beginDraft(model, draft.target);
  if (draft.baseFingerprint !== current.baseFingerprint) throw Error('The musical definition changed. Resolve that draft before saving transposition.');
  const next = saveTransposeEdits(model, draft.target, draft.transposeEdits!, timings);
  const structural = useStructureDraft.getState().draft;
  const rebased = structural ? rebaseStructure(structural, next, timings) : null;
  const original = beginDraft(next, draft.target);
  const remaining = { ...draft, transposeEdits: undefined, baseRevision: original.baseRevision, baseFingerprint: original.baseFingerprint,
    definition: { ...draft.definition, transposeProfileId: original.definition.transposeProfileId } };
  commitClipArrangement(next, 'Transpose');
  useStructureDraft.setState({ draft: rebased });
  useAppStore.setState({ clipDrafts: { ...state.clipDrafts, [key]: remaining } });
}

/** Share the transposition draft without selecting or opening a musical editor. */
export function openClipTransposition(target: OccurrenceTarget) {
  const state = useAppStore.getState(), model = state.sequencer.clipArrangement;
  if (!model) return;
  const key = draftKey({ target });
  const existing = state.clipDrafts[key];
  // A closed, clean inspector may predate a shared edit or undo in another clip.
  // Refresh that snapshot while preserving unfinished musical/transposition work.
  if (!existing || (!existing.transposeEdits?.length && !existing.additions?.length && existing.baseFingerprint === JSON.stringify(existing.definition))) {
    useAppStore.setState({ clipDrafts: { ...state.clipDrafts, [key]: beginDraft(model,target) } });
  }
}

export function commitClipArrangement(next: ClipArrangement, label: string) {
  const state = useAppStore.getState(), before = state.sequencer.clipArrangement;
  validateArrangement(next, arrangementTimings(state.sequencer));
  const structural=useStructureDraft.getState().draft;
  if(structural)useStructureDraft.setState({draft:refreshStructureWindows(next,structural)});
  useAppStore.setState({ sequencer: { ...state.sequencer, clipArrangement: next,
    clipHistory: before ? recordClipEdit(state.sequencer.clipHistory ?? emptyClipHistory(), before, next, label, arrangementTimings(state.sequencer)) : emptyClipHistory() }, sequencerEditRevision: state.sequencerEditRevision + 1 });
}
export function openClipEditor(target: OccurrenceTarget) {
  const state = useAppStore.getState(), model = state.sequencer.clipArrangement;
  if (!model) return;
  const key = draftKey({ target });
  useAppStore.setState({ clipEditingKey: key, clipDrafts: { ...state.clipDrafts, [key]: state.clipDrafts[key] ?? beginDraft(model, target) },
    sequencerEditingPads: { ...state.sequencerEditingPads, [target.laneId]: 0 } });
}
export function updateClipDraft(definition: Definition, additions?: Definition[]) {
  const state = useAppStore.getState(), key = state.clipEditingKey;
  if (!key || !state.clipDrafts[key]) return;
  useAppStore.setState({ clipDrafts: { ...state.clipDrafts, [key]: { ...state.clipDrafts[key], definition, ...(additions ? { additions } : {}) } } });
}
export function saveClipDraft(scope: "local" | "all", name: string, resolvingKey?: string) {
  const state = useAppStore.getState(), key = resolvingKey ?? state.clipEditingKey, model = state.sequencer.clipArrangement;
  if (!key || !model) return;
  let draft = state.clipDrafts[key];
  let basis = model;
  if (draft.transposeEdits?.length) {
    if (draft.baseFingerprint !== beginDraft(model,draft.target).baseFingerprint) throw Error('The musical definition changed. Reopen the draft before saving.');
    basis = saveTransposeEdits(model,draft.target,draft.transposeEdits,arrangementTimings(state.sequencer));
    const updated = beginDraft(basis,draft.target);
    draft = {...draft,baseRevision:updated.baseRevision,baseFingerprint:updated.baseFingerprint,transposeEdits:undefined,
      definition:{...draft.definition,transposeProfileId:updated.definition.transposeProfileId}};
  }
  if (draft.definition.kind !== "pattern") throw Error("Use Save structure for container edits.");
  const next = saveDraft(basis, { ...draft, definition: { ...draft.definition, name } }, scope, arrangementTimings(state.sequencer));
  const structural = useStructureDraft.getState().draft;
  if (structural && JSON.stringify(structural.basis) !== JSON.stringify(model.lanes.find(l => l.id === structural.laneId))) throw Error("The track changed. Resolve the structure draft before saving.");
  const rebased = structural ? rebaseStructure(structural, next, arrangementTimings(state.sequencer)) : null;
  const retained = retainMusicalDrafts(model, next, state.clipDrafts, key, arrangementTimings(state.sequencer));
  commitClipArrangement(next, name);
  useStructureDraft.setState({ draft: rebased });
  useAppStore.setState({ clipDrafts: retained.drafts, clipEditingKey: state.clipEditingKey ? retained.keys.get(state.clipEditingKey) ?? null : null });
}
export function clipHistoryStep(forward: boolean) {
  const state = useAppStore.getState(), model = state.sequencer.clipArrangement;
  if (!model) return;
  const next = replayClipEdit(state.sequencer.clipHistory ?? emptyClipHistory(), model, forward, arrangementTimings(state.sequencer));
  const structural=useStructureDraft.getState().draft;
  if(structural)useStructureDraft.setState({draft:refreshStructureWindows(next.model,structural)});
  useAppStore.setState({ sequencer: { ...state.sequencer, clipArrangement: next.model, clipHistory: next.history }, sequencerEditRevision: state.sequencerEditRevision + 1 });
}

/** Keep source creation atomic with its first clip; existing factories own musical defaults. */
export function addClipLane(source: import("../lib/clipArranger/model").SourceKind, create: () => void) {
  const before = useAppStore.getState();
  if (!before.sequencer.clipArrangement) return;
  try {
    create();
    const current = useAppStore.getState();
    const key = sourceKeys[source];
    const track = current.sequencer[key].find(t => !before.sequencer[key].some(old => old.id === t.id));
    if (!track) return;
    const isolated = { ...current.sequencer, tracks: [], scoreTracks: [], drummerTracks: [], controllerSequencers: [], arpeggiators: [], pianoRolls: [] } as typeof current.sequencer;
    Object.assign(isolated, { [key]: [{ ...track, padLoopEnabled: true, padLoopRepeat: false, ...(source === "arpeggiator" ? { playbackMode: "arranger" } : {}) }] });
    const report = migrateClipArrangement(isolated);
    if (!report.model) throw new Error(report.reasons.join(", "));
    const lane = report.model.lanes[0];
    const first = lane.definitions[0];
    // Fresh tracks start with one definition. No eight-slot navigation/storage constraint.
    lane.definitions = [first];
    lane.clips = [{ id: crypto.randomUUID(), name: first.name, start: 0,
      length: contentLength(lane, [{ id: "length", definitionId: first.id }], arrangementTimings(current.sequencer)[lane.id]),
      offset: 0, mode: "loop", children: [{ id: crypto.randomUUID(), definitionId: first.id }] }];
    useAppStore.setState({ sequencer: { ...current.sequencer, [key]: current.sequencer[key].map(t => t.id === track.id ? { ...t, padLoopEnabled: true, padLoopRepeat: false, ...(source === "arpeggiator" ? { playbackMode: "arranger" } : {}) } : t) } });
    commitClipArrangement({ ...before.sequencer.clipArrangement, revision: before.sequencer.clipArrangement.revision + 1, end: Math.max(before.sequencer.clipArrangement.end, lane.clips[0].length), lanes: [...before.sequencer.clipArrangement.lanes, lane] }, "Add track");
    // Source topology cannot be replayed by clip-only history snapshots.
    useAppStore.setState(s => ({ sequencer: { ...s.sequencer, clipHistory: emptyClipHistory() } }));
    openClipEditor({ laneId: lane.id, clipId: lane.clips[0].id, path: [lane.clips[0].children[0].id], pass: 0 });
  } catch (error) { useAppStore.setState({ sequencer: before.sequencer }); throw error; }
}

/** Device topology sits outside clip history, as with the compatibility arranger. */
export function removeClipLane(laneId: string) {
  const state = useAppStore.getState(), model = state.sequencer.clipArrangement;
  const lane = model?.lanes.find(l => l.id === laneId);
  if (!model || !lane) return;
  const key = sourceKeys[lane.source];
  const sequencer = { ...state.sequencer, [key]: state.sequencer[key].filter(t => t.id !== laneId),
    clipArrangement: { ...model, revision: model.revision + 1, lanes: model.lanes.filter(l => l.id !== laneId) }, clipHistory: emptyClipHistory() };
  sequencer.tracks = sequencer.tracks.map(track => track.syncToTrackId === laneId ? { ...track, syncToTrackId: null } : track);
  validateArrangement(sequencer.clipArrangement, arrangementTimings(sequencer));
  useAppStore.setState({ sequencer, sequencerEditRevision: state.sequencerEditRevision + 1,
    clipDrafts: Object.fromEntries(Object.entries(state.clipDrafts).filter(([, d]) => d.target.laneId !== laneId)),
    clipEditingKey: state.clipEditingKey && state.clipDrafts[state.clipEditingKey]?.target.laneId === laneId ? null : state.clipEditingKey });
}
