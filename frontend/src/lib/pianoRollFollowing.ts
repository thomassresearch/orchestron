import type { PerformanceAuditionStatus, SequencerRuntimeState, SequencerState } from "../types";
import { resolveClip, type DefinitionDraft } from "./clipArranger/model";
import { clipAuditionDefinitions } from "./clipArranger/runtime";

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
        const playing = runtime.independentSources ? runtime.arrangementRunning : runtime.arrangerActive ?? runtime.isPlaying;
        if (!playing) return [];
        const position = runtime.arrangementPlaybackSubunit ?? runtime.arrangerTransportSubunit ?? runtime.transportSubunit;
        if (position >= sequencer.clipArrangement!.end) return [];
        const at = lane.cycleTicks ? position % lane.cycleTicks : position;
        const clip = lane.clips.find(c => c.start <= at && at < c.start + c.length);
        const definition = clip ? resolveClip(lane, clip, at, at + 1, track.timing)[0]?.definition : null;
        if (definition?.source === "sequencer" || definition?.source === "score") theory = definition.payload;
      }
    } else {
      // Legacy Manual pads and auditions use the same eight authored pads.
      theory = track.pads[slot];
    }
    return theory ? [{ scaleRoot: theory.scaleRoot, scaleType: theory.scaleType, mode: theory.mode }] : [];
  });
}
