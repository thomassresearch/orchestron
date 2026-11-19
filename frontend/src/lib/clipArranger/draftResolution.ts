import type { AppStore } from "../../store/appStoreTypes";
import { useStructureDraft } from './structureStore';
import { create } from "zustand";
import type { ClipArrangement, DefinitionDraft } from "./model";

export function hasChangedClipDrafts(model: ClipArrangement | undefined, drafts: Record<string, DefinitionDraft>): boolean {
  return !!model && Object.values(drafts).some(draft => {
    const original = model.lanes.find(l => l.id === draft.target.laneId)?.definitions.find(d => d.id === draft.definition.id);
    return (draft.editIntent?.scope === "local" && !!draft.editIntent.variationNameEdited) || !!draft.transposeEdits?.length || !!draft.additions?.length || JSON.stringify(original) !== JSON.stringify(draft.definition);
  });
}
export const useClipResolution = create<{ pending: { replace: boolean; resolve: (accepted: boolean) => void } | null }>(() => ({ pending: null }));
export function resolveClipDrafts(model: ClipArrangement | undefined, drafts: Record<string, DefinitionDraft>, replace = false): Promise<boolean> {
  if (!useStructureDraft.getState().draft?.cursor && !hasChangedClipDrafts(model, drafts)) return Promise.resolve(true);
  if (useClipResolution.getState().pending) return Promise.resolve(false);
  return new Promise(resolve => useClipResolution.setState({ pending: { replace, resolve: accepted => { useClipResolution.setState({ pending: null }); resolve(accepted); } } }));
}

type ReplacementState = Pick<AppStore, "performanceWorkspaceGeneration" | "clipDrafts" | "sequencer">;
export type ConfirmedReplacement = {
  generation: number;
  drafts: AppStore["clipDrafts"];
  structure: ReturnType<typeof useStructureDraft.getState>["draft"];
};

/** Reuse the decision across import/clone and their subsequent load while its drafts still match. */
export async function confirmReplacement(state: ReplacementState, earlier?: ConfirmedReplacement) {
  const generation = state.performanceWorkspaceGeneration, drafts = state.clipDrafts, structure = useStructureDraft.getState().draft;
  if (earlier && earlier.generation === generation && earlier.drafts === drafts && earlier.structure === structure) return earlier;
  return await resolveClipDrafts(state.sequencer.clipArrangement, drafts, true) ? { generation, drafts, structure } : null;
}
