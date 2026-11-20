import type { SequencerState } from "../../types";
import { draftKey } from "./editorAdapter";
import { arrangementTimings } from "./migration";
import type { ClipArrangement, DefinitionDraft, OccurrenceTarget, PatternDefinition } from "./model";
import { definitionRelationships, effectiveScope, localLoopWindows, type EditScope } from "./relationships";
import { definitionAt, saveDraft } from "./operations";
import { clipAuditionState } from "./runtime";
import { remapMusicalTarget } from "./structuralDraftResolution";

export type SongPatternEdit = {
  key: string;
  draft: DefinitionDraft;
  pattern: PatternDefinition;
  scope: EditScope;
};

/** Selection, names and separate structure/transposition inspectors do not change song playback. */
export function songPatternEdits(state: SequencerState, drafts: Record<string, DefinitionDraft>): SongPatternEdit[] {
  const edits: SongPatternEdit[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    const pattern = draft.definition;
    if (pattern.kind !== "pattern" || !draft.editIntent?.scope) continue;
    const lane = state.clipArrangement?.lanes.find(l => l.id === draft.target.laneId);
    const clip = lane?.clips.find(c => c.id === draft.target.clipId);
    if (!lane || !clip) continue;
    let saved;
    try {
      saved = definitionAt(lane, draft.target);
    } catch {
      // Structural edits can remove the occurrence while its draft awaits resolution.
      continue;
    }
    if (saved.kind !== "pattern" || saved.id !== pattern.id || saved.revision !== draft.baseRevision) continue;
    if (pattern.presetId === saved.presetId && JSON.stringify(pattern.payload) === JSON.stringify(saved.payload)) continue;
    if (draft.baseFingerprint && draft.baseFingerprint !== JSON.stringify(saved)) continue;
    const timing = arrangementTimings(state)[lane.id];
    const relationship = draft.editIntent.explicit ? undefined : definitionRelationships(lane, timing).get(pattern.id);
    const scope = effectiveScope(draft.editIntent, relationship);
    if (!scope) continue;
    if (scope === "local" && (clip.mode === "loop"
      ? !localLoopWindows(lane, clip.id, draft.target.pass, timing)
      : draft.target.pass !== 0)) continue;
    // The name field can be empty while typing. Preview only the musical changes.
    edits.push({ key, draft, pattern: pattern.name === saved.name ? pattern : { ...pattern, name: saved.name }, scope });
  }
  return edits;
}

export function sameSongEdits(before: SongPatternEdit[], after: SongPatternEdit[]) {
  return before.length === after.length && before.every((edit, i) => {
    const other = after[i];
    return edit.key === other.key && edit.scope === other.scope &&
      edit.pattern.payload === other.pattern.payload && edit.pattern.presetId === other.pattern.presetId;
  });
}

export function previewPattern(edits: SongPatternEdit[], target: OccurrenceTarget, saved: PatternDefinition) {
  return edits.find(edit => edit.draft.target.laneId === target.laneId && edit.pattern.id === saved.id &&
    (edit.scope === "all" || edit.key === draftKey({ target })))?.pattern ?? saved;
}

// Stable temporary IDs keep unrelated clips and cached preparation usable across curve drags.
const previewIds = new WeakMap<OccurrenceTarget, string>();
function previewIdFactory(target: OccurrenceTarget) {
  const prefix = previewIds.get(target) ?? crypto.randomUUID();
  previewIds.set(target, prefix);
  let index = 0;
  return () => `${prefix}:${index++}`;
}

/** Apply the same window splits and linked edits as Save, on a compilation-only model. */
export function songDraftPlayback(state: SequencerState, drafts: Record<string, DefinitionDraft>): SequencerState {
  const edits = songPatternEdits(state, drafts);
  if (!edits.length || !state.clipArrangement) return state;
  const timings = arrangementTimings(state);
  let model: ClipArrangement = state.clipArrangement;
  const targets = edits.map(edit => edit.draft.target);
  for (const [index, edit] of edits.entries()) {
    const before = model;
    model = saveDraft(before, { ...edit.draft, definition: edit.pattern, target: targets[index] }, edit.scope, timings, previewIdFactory(edit.draft.target));
    if (edit.scope === "local") {
      for (let j = index + 1; j < edits.length; j++) {
        if (targets[j].laneId === targets[index].laneId) {
          targets[j] = remapMusicalTarget(before, model, targets[j], timings);
        }
      }
    }
  }
  return { ...state, clipArrangement: model };
}

/** Reserve audition slots after all arranged patterns, including temporary local variations. */
export function clipSongPlayback(state: SequencerState, drafts: Record<string, DefinitionDraft>, audition: DefinitionDraft | null): ReturnType<typeof clipAuditionState> {
  const song = songDraftPlayback(state, drafts);
  return audition && state.clipArrangement ? clipAuditionState(state, audition, song) : { state: song, sequence: [] };
}
