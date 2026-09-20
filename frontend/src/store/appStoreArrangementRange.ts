import type { StoreApi } from "zustand";
import { validateArrangementEdit } from "../lib/arrangementEditing";
import { ArrangementRangeError } from "../lib/arrangementRange";
import { normalizePadLoopPatternForState } from "./appStoreModel";
import type { AppStore } from "./appStoreTypes";

/** Receives authored edit access, so the batch increments the live-edit revision only once. */
export function createArrangementRangeActions(set: StoreApi<AppStore>["setState"], get: () => AppStore): Pick<AppStore, "applyArrangementRangeEdit"> {
  return { applyArrangementRangeEdit: updates => {
    const sequencer = get().sequencer;
    const keys = { sequencer: "tracks", drummer: "drummerTracks", controller: "controllerSequencers", arpeggiator: "arpeggiators" } as const;
    const seen = new Set<string>();
    const prepared = updates.map(update => {
      const key = keys[update.kind];
      const track = sequencer[key].find(t => t.id === update.id);
      if (!track || "playbackMode" in track && track.playbackMode !== "arranger" || seen.has(update.id)) throw new ArrangementRangeError("missing", update.id);
      seen.add(update.id);
      const pattern = { ...track.padLoopPattern, rootSequence: structuredClone(update.rootSequence) };
      validateArrangementEdit(track.padLoopPattern, pattern);
      return { id: update.id, key, ...normalizePadLoopPatternForState(pattern) };
    });
    if (!prepared.length) return;
    const next = { ...sequencer };
    for (const key of ["tracks", "drummerTracks", "controllerSequencers", "arpeggiators"] as const) {
      const values = prepared.filter(update => update.key === key);
      if (!values.length) continue;
      // Only authored arrangement fields change: source, phase and runtime intent are retained.
      Object.assign(next, { [key]: sequencer[key].map(track => {
        const update = values.find(value => value.id === track.id);
        return update ? { ...track, padLoopPattern: update.padLoopPattern,
          ...(key === "arpeggiators" ? {} : { padLoopSequence: update.padLoopSequence }) } : track;
      }) });
    }
    set({ sequencer: next });
  } };
}
