import type { PerformanceAuditionStatus, SequencerRuntimeState, SequencerState } from "../types";
import type { DefinitionDraft } from "./clipArranger/model";
import { clipAuditionDefinitions, playingClipPattern } from "./clipArranger/runtime";

/** Harmonic guidance comes from audible sources, never the selected editor or legacy clip pads. */
export function pianoRollFollowingTheories(
  sequencer: SequencerState,
  runtime: SequencerRuntimeState,
  auditions: PerformanceAuditionStatus,
  draft: DefinitionDraft | null
) {
  if (!runtime.isPlaying) return [];
  return [...sequencer.tracks, ...sequencer.scoreTracks].flatMap(track => {
    const playback = runtime.trackStateById[track.id];
    if (!playback?.enabled) return [];
    const audition = auditions[track.id];
    const workspace = audition?.workspace_active && !audition.preview_active;
    const workspaceSlot = workspace && audition.workspace_position != null
      ? audition.workspace_sequence?.[audition.workspace_position] : undefined;
    const slot = workspace ? workspaceSlot : playback.activePad;
    if (slot == null || slot < 0) return [];

    const lane = sequencer.clipArrangement?.lanes.find(l => l.id === track.id);
    let theory;
    if (lane) {
      if (workspace) {
        const definitions = draft?.target.laneId === lane.id ? clipAuditionDefinitions(lane, draft) : lane.definitions;
        const definition = definitions.filter(d => d.kind === "pattern")[slot];
        if (definition?.source === "sequencer" || definition?.source === "score") theory = definition.payload;
      } else {
        const definition = playingClipPattern(lane, sequencer.clipArrangement!.end, runtime, track.timing);
        if (definition?.source === "sequencer" || definition?.source === "score") theory = definition.payload;
      }
    } else {
      // Legacy Manual pads and auditions use the same eight authored pads.
      theory = track.pads[slot];
    }
    return theory ? [{ scaleRoot: theory.scaleRoot, scaleType: theory.scaleType, mode: theory.mode }] : [];
  });
}
