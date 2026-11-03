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

/** Map arpeggiator runtime definition slots onto the editor's single displayed pad. */
export function clipEditorPlaybackView(state: SequencerState, draft: DefinitionDraft, audition: DefinitionDraft | null): SequencerState {
  const view = clipEditorView(state, draft);
  if (draft.definition.kind !== "pattern" || draft.definition.source !== "arpeggiator") return view;
  const patterns = state.clipArrangement?.lanes.find(l => l.id === draft.target.laneId)?.definitions.filter(d => d.kind === "pattern") ?? [];
  const savedSlot = patterns.findIndex(d => d.id === draft.definition.id);
  const auditionSlot = audition && draftKey(audition) === draftKey(draft) ? patterns.length : -1;
  return { ...view, arpeggiators: view.arpeggiators.map(arp => {
    if (arp.id !== draft.target.laneId || !arp.runtimeStatus) return arp;
    const runtime = arp.runtimeStatus;
    const matches = runtime.active_pad !== undefined && (runtime.active_pad === savedSlot || runtime.active_pad === auditionSlot);
    // The backend's enabled flag remains authored/source intent during audition.
    return { ...arp, enabled: runtime.enabled || runtime.state === "playing",
      runtimeStatus: { ...runtime, active_pad: matches ? 0 : -1 } };
  }) };
}
