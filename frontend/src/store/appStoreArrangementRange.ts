import type { AppStore } from "./appStoreTypes";

/** A range edit is one transaction, retaining explicit source and repeat settings. */
export function createArrangementRangeActions(get: () => AppStore): Pick<AppStore, "applyArrangementRangeEdit"> {
  return { applyArrangementRangeEdit: (updates, action = "overwrite") => {
    const state = get();
    const keys = { sequencer: "tracks", drummer: "drummerTracks", controller: "controllerSequencers", arpeggiator: "arpeggiators" } as const;
    state.commitArrangerEdit(action, updates.map(update => {
      const track = state.sequencer[keys[update.kind]].find(t => t.id === update.id);
      if (!track) throw new Error("Missing arranger lane.");
      return { id: update.id, kind: update.kind, pattern: { ...track.padLoopPattern, rootSequence: update.rootSequence } };
    }));
  } };
}
