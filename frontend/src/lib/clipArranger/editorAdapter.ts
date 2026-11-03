import type { SequencerState } from "../../types";
import { sourceKeys } from "./migration";
import type { DefinitionDraft } from "./model";

/** A temporary pad view lets existing editors keep every musical control and gesture. */
export function clipEditorView(state: SequencerState, draft: DefinitionDraft | undefined): SequencerState {
  if (!draft || draft.definition.kind !== "pattern") return state;
  const definition = draft.definition, key = sourceKeys[definition.source];
  // Drum track rows own { id, key }; pad rows own { rowId, steps }.
  // Only the timing fields are mirrored on the track. Replacing track.rows
  // loses the IDs used by both the editor actions and runtime MIDI tracks.
  const mirrors = definition.source === "drummer"
    ? { lengthBeats: definition.payload.lengthBeats, stepCount: definition.payload.stepCount }
    : definition.payload;
  return { ...state, [key]: state[key].map(track => {
    if (track.id !== draft.target.laneId) return track;
    return { ...track, ...mirrors, activePad: 0, padLoopEnabled: true,
      pads: track.pads.map((pad, index) => index === 0 ? definition.payload : pad),
      ...("padPresetIds" in track ? { padPresetIds: track.padPresetIds.map((preset, index) => index === 0 ? definition.presetId ?? null : preset) } : {}) };
  }) };
}
export const draftKey = (draft: Pick<DefinitionDraft, "target">) => JSON.stringify(draft.target);
