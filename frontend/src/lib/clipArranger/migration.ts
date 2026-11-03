import type { PadLoopPatternItem, SequencerState } from "../../types";
import { ClipError, QUARTER_TICKS, contentLength, localBeatTicks, validateArrangement, type ClipArrangement, type ClipLane, type ContentItem, type Definition, type LaneTiming, type PatternDefinition, type SourceKind } from "./model";

export const sourceKeys = { sequencer: "tracks", score: "scoreTracks", drummer: "drummerTracks", controller: "controllerSequencers", arpeggiator: "arpeggiators" } as const;
export function arrangementTimings(state: SequencerState): LaneTiming {
  return Object.fromEntries([...state.tracks, ...state.scoreTracks, ...state.drummerTracks, ...state.controllerSequencers].map(track => [track.id, track.timing]));
}
export type MigrationReport = { model: ClipArrangement | null; reasons: string[]; original: SequencerState; historyReset: boolean };

/** Deterministic and lossless. Unsupported transports retain the entire original in compatibility view. */
export function migrateClipArrangement(state: SequencerState): MigrationReport {
  const reasons: string[] = [], lanes: ClipLane[] = [], timings = arrangementTimings(state);
  if (state.pianoRolls.length > 1) reasons.push("multiple-keyboards");
  for (const source of Object.keys(sourceKeys) as SourceKind[]) for (const track of state[sourceKeys[source]]) {
    if (!track.padLoopEnabled) reasons.push(`manual-source:${track.id}`);
    if ("playbackMode" in track && track.playbackMode === "live") reasons.push(`live-arpeggiator:${track.id}`);
    let counter = 0;
    const id = (part: string) => `${track.id}:${part}`;
    const childId = () => id(`occurrence:${counter++}`);
    const convert = (item: PadLoopPatternItem): ContentItem => item.type === "pause"
      ? { id: childId(), restTicks: item.lengthBeats * localBeatTicks(timings[track.id]) }
      : { id: childId(), definitionId: id(item.type === "pad" ? `pattern:${item.padIndex}` : item.type === "group" ? `group:${item.groupId}` : `supergroup:${item.superGroupId}`) };
    const definitions: Definition[] = track.pads.map((payload, index) => ({ id: id(`pattern:${index}`), name: `#${index + 1}`, revision: 0,
      kind: "pattern", source, payload: structuredClone(payload),
      ...("padPresetIds" in track ? { presetId: track.padPresetIds[index] } : {}),
      ...(track.padLoopPattern.definitionColors?.[`pad:${index}`] ? { color: track.padLoopPattern.definitionColors[`pad:${index}`] } : {}) }) as PatternDefinition);
    for (const group of track.padLoopPattern.groups) definitions.push({ id: id(`group:${group.id}`), name: group.id, revision: 0, kind: "group", ...(track.padLoopPattern.definitionColors?.[`group:${group.id}`] ? { color: track.padLoopPattern.definitionColors[`group:${group.id}`] } : {}), children: group.sequence.map(convert) });
    for (const group of track.padLoopPattern.superGroups) definitions.push({ id: id(`supergroup:${group.id}`), name: group.id, revision: 0, kind: "supergroup", ...(track.padLoopPattern.definitionColors?.[`supergroup:${group.id}`] ? { color: track.padLoopPattern.definitionColors[`supergroup:${group.id}`] } : {}), children: group.sequence.map(convert) });
    const lane: ClipLane = { id: track.id, source, definitions, clips: [], cycleTicks: null };
    const children = track.padLoopPattern.rootSequence.map(convert);
    try {
      const duration = contentLength(lane, children, timings[lane.id]);
      if (duration > 0) {
        lane.clips.push({ id: id("clip:0"), name: track.name, start: 0, length: duration, offset: 0, mode: "once", children });
        if (track.padLoopRepeat) lane.cycleTicks = duration;
      }
    } catch (error) { reasons.push(`invalid-content:${track.id}:${error instanceof Error ? error.message : String(error)}`); }
    lanes.push(lane);
  }
  const model: ClipArrangement = { version: 1, revision: 0, end: Math.max(QUARTER_TICKS, state.stepCount * QUARTER_TICKS / 8, ...lanes.flatMap(l => l.clips.map(c => c.start + c.length))), lanes };
  try { validateArrangement(model, timings); } catch (error) {
    reasons.push(error instanceof ClipError ? error.code : "invalid-model");
  }
  return { model: reasons.length ? null : model, reasons, original: structuredClone(state), historyReset: true };
}
