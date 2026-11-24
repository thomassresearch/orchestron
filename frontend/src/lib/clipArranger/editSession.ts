import { create } from "zustand";
import type { SequencerState } from "../../types";
import type { ClipArrangement, DefinitionDraft } from "./model";
import type { StructureDraft } from "./structure";

/** Immutable editor frames share references. Only the final model enters persisted clip history. */
export type EditFrame = {
  model: ClipArrangement;
  drafts: Record<string, DefinitionDraft>;
  structure: StructureDraft | null;
  editor: string | null;
};
export type EditSession = { basis: ClipArrangement; model: ClipArrangement; past: EditFrame[]; future: EditFrame[] };
export const useArrangementEdits = create<{ session: EditSession | null }>(() => ({ session: null }));

export function workingArrangement(sequencer: SequencerState) {
  const session = useArrangementEdits.getState().session;
  return session && sequencer.clipArrangement === session.basis ? session.model : sequencer.clipArrangement;
}
export function workingSequencer(sequencer: SequencerState, session = useArrangementEdits.getState().session): SequencerState {
  return session && sequencer.clipArrangement === session.basis && session.model !== session.basis
    ? { ...sequencer, clipArrangement: session.model } : sequencer;
}
export function sameArrangement(a: ClipArrangement, b: ClipArrangement) {
  // Reversing a gesture manually can advance revision counters without changing any music.
  return a === b || JSON.stringify(a, omitRevision) === JSON.stringify(b, omitRevision);
}
function omitRevision(key: string, value: unknown) { return key === "revision" ? undefined : value; }
