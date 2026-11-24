import { sameArrangement, useArrangementEdits } from "./editSession";
import type { AppStore } from "../../store/appStoreTypes";
import { useStructureDraft } from './structureStore';
import { create } from "zustand";
import type { ClipArrangement, DefinitionDraft } from "./model";
import { initialEditIntent, type DefinitionRelationship } from "./relationships";

export function hasChangedClipDrafts(model: ClipArrangement | undefined, drafts: Record<string, DefinitionDraft>): boolean {
  return !!model && Object.values(drafts).some(draft => {
    if (draft.provisionalDuplicate) return false;
    const original = model.lanes.find(l => l.id === draft.target.laneId)?.definitions.find(d => d.id === draft.definition.id);
    return (draft.editIntent?.scope === "local" && !!draft.editIntent.variationNameEdited) || !!draft.transposeEdits?.length || !!draft.additions?.length || JSON.stringify(original) !== JSON.stringify(draft.definition);
  });
}

export function occurrenceEditIntent(model: ClipArrangement, draft: DefinitionDraft | undefined, active: boolean, relationship: DefinitionRelationship | undefined, loopPass?: number) {
  const intent = draft?.editIntent;
  if (draft && intent?.explicit && (loopPass === undefined || active || hasChangedClipDrafts(model, { draft }))) return intent;
  return { ...intent, ...initialEditIntent(relationship, loopPass) };
}
export const useClipResolution = create<{ pending: { resolve: (accepted: boolean) => void } | null }>(() => ({ pending: null }));
export function resolveClipDrafts(model: ClipArrangement | undefined, drafts: Record<string, DefinitionDraft>): Promise<boolean> {
  const session = useArrangementEdits.getState().session;
  if ((!session || sameArrangement(session.basis, session.model)) && !useStructureDraft.getState().draft?.cursor && !hasChangedClipDrafts(session?.model ?? model, drafts)) return Promise.resolve(true);
  if (useClipResolution.getState().pending) return Promise.resolve(false);
  return new Promise(resolve => useClipResolution.setState({ pending: { resolve: accepted => { useClipResolution.setState({ pending: null }); resolve(accepted); } } }));
}

type ReplacementState = Pick<AppStore, "performanceWorkspaceGeneration" | "clipDrafts" | "sequencer">;
export type ConfirmedReplacement = {
  session: ReturnType<typeof useArrangementEdits.getState>["session"];
  generation: number;
  drafts: AppStore["clipDrafts"];
  structure: ReturnType<typeof useStructureDraft.getState>["draft"];
};

/** Reuse the decision across import/clone and their subsequent load while its drafts still match. */
export async function confirmReplacement(state: ReplacementState, earlier?: ConfirmedReplacement) {
  const generation = state.performanceWorkspaceGeneration, drafts = state.clipDrafts, structure = useStructureDraft.getState().draft;
  const session = useArrangementEdits.getState().session;
  if (earlier && earlier.session === session && earlier.generation === generation && earlier.drafts === drafts && earlier.structure === structure) return earlier;
  return await resolveClipDrafts(state.sequencer.clipArrangement, drafts) ? { session, generation, drafts, structure } : null;
}
