import { clipEditorView } from "../lib/clipArranger/editorAdapter";
import type { DefinitionDraft, PatternDefinition } from "../lib/clipArranger/model";
import type { StoreApi } from "zustand";
import type { SequencerState, SequencerTrackPlaybackState, SessionSequencerConfigRequest } from "../types";
import { parseDrummerRowRuntimeTrackId } from "../lib/sequencerRuntime";
import { mergedSequencerState, playbackTrack } from "../lib/mergedSequencerState";
import type { AppStore } from "./appStoreTypes";

const playbackKeys = ["activePad", "queuedPad", "queuedEnabled", "enabled", "padLoopPosition", "runtimePadStartSubunit"] as const;
const mirrors = ["curveDurationTicks", "steps", "lengthBeats", "stepCount", "scaleRoot", "scaleType", "mode", "keypoints"];
type RecordValue = Record<string, unknown>;

const trackDisplayKeys = new Set(["name", "runtimeLocalStep", "runtimePadStartSubunit", "padLoopPosition", "steps", "keypoints"]);

/** Compare only changed JSON branches; shared pads and steps are constant-time checks. */
function sameAudioValue(left: unknown, right: unknown, ignored?: ReadonlySet<string>): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameAudioValue(value, right[index]));
  }
  const a = left as RecordValue, b = right as RecordValue;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key !== "definitionColors" && !ignored?.has(key) && !sameAudioValue(a[key], b[key])) return false;
  }
  return true;
}

function sameAudioTracks(left: Array<{ id: string }>, right: Array<{ id: string }>): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  const previous = new Map(right.map(track => [track.id, track]));
  return left.every(track => sameAudioValue(track, previous.get(track.id), trackDisplayKeys));
}

function sequencerAudioChanged(next: SequencerState, previous: SequencerState): boolean {
  if (next === previous) return false;
  if (!(["timing", "arrangerLoopSelection", "arrangerSongLoopEnabled"] as const).every(key =>
    sameAudioValue(next[key], previous[key]))) return true;
  if (!(["tracks", "scoreTracks", "drummerTracks", "controllerSequencers"] as const).every(key =>
    sameAudioTracks(next[key], previous[key]))) return true;
  if (next.arpeggiators === previous.arpeggiators) return false;
  // Live arpeggiator synthesis uses its separate revision/configuration path.
  const arrangement = (state: SequencerState) => state.arpeggiators.filter(arp => arp.playbackMode === "arranger").map(arp => ({
    id: arp.id, loop: arp.padLoopEnabled, repeat: arp.padLoopRepeat, pattern: arp.padLoopPattern,
    durations: arp.pads.map(pad => pad.lengthBeats)
  }));
  return !sameAudioValue(arrangement(next), arrangement(previous));
}

function sameFields(left: object, right: object): boolean {
  const a = left as RecordValue, b = right as RecordValue;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
}

function changedFields(authored: object, displayed: object, edited: object): RecordValue {
  const result = { ...authored } as RecordValue;
  for (const [key, value] of Object.entries(edited)) {
    if (value !== (displayed as RecordValue)[key]) result[key] = value;
  }
  return result;
}

/** Project explicit editor targets without changing authored or sounding pad selection. */
export function sequencerEditingView(state: SequencerState, selections: Record<string, number>): SequencerState {
  const project = <T extends { id: string; activePad: number; pads: object[] }>(track: T): T =>
    selections[track.id] === undefined ? track : playbackTrack(track, { activePad: selections[track.id] });
  return { ...state, tracks: state.tracks.map(project), scoreTracks: state.scoreTracks.map(project), drummerTracks: state.drummerTracks.map(project), controllerSequencers: state.controllerSequencers.map(project) };
}

/** Only edits to the displayed pad are committed; editor selection is never playback intent. */
export function sequencerEditAccess(set: StoreApi<AppStore>["setState"], get: () => AppStore, editSelection = true) {
  let cachedState: AppStore | undefined;
  let cachedView: AppStore;
  const read = (): AppStore => {
    const state = get();
    if (state === cachedState) return cachedView;
    const selections = editSelection ? {
      ...Object.fromEntries([...state.sequencer.tracks, ...state.sequencer.scoreTracks, ...state.sequencer.drummerTracks,
        ...state.sequencer.controllerSequencers].map(track => [track.id, track.activePad])), ...state.sequencerEditingPads
    } : {};
    cachedState = state;
    cachedView = { ...state, sequencer: clipEditorView(
      sequencerEditingView(mergedSequencerState(state.sequencer, state.sequencerRuntime), selections),
      state.clipEditingKey ? state.clipDrafts[state.clipEditingKey] : undefined
    ) };
    return cachedView;
  };
  const write: StoreApi<AppStore>["setState"] = (update) => {
    const state = get();
    const displayed = read();
    const delta = typeof update === "function" ? update(displayed) : update;
    if (!delta.sequencer) { set(delta); return; }
    if (delta.sequencer === displayed.sequencer) { set({ ...delta, sequencer: state.sequencer }); return; }
    const edited = delta.sequencer;
    if (edited.controllerSequencers.some(t => t.automationTarget && t.pads.some(p => p.keypoints.length > 10))) return;
    const authored = changedFields(state.sequencer, displayed.sequencer, edited) as unknown as SequencerState;
    let runtime = state.sequencerRuntime;
    let clipDrafts = state.clipDrafts;
    const draft = state.clipEditingKey ? state.clipDrafts[state.clipEditingKey] : undefined;
    for (const [kind, runtimeKey] of [["tracks", "trackStateById"], ["scoreTracks", "trackStateById"], ["drummerTracks", "drummerStateById"], ["controllerSequencers", "controllerStateById"], ["arpeggiators", "arpeggiatorStatusById"]] as const) {
      if (edited[kind] === displayed.sequencer[kind]) {
        Object.assign(authored, { [kind]: state.sequencer[kind] });
        continue;
      }
      const before = new Map(displayed.sequencer[kind].map(t => [t.id, t]));
      const source = new Map(state.sequencer[kind].map(t => [t.id, t]));
      const playbackRuntimeKey = runtimeKey === "arpeggiatorStatusById" ? null : runtimeKey;
      let overrides = playbackRuntimeKey ? runtime[playbackRuntimeKey] : undefined;
      const next = edited[kind].map(track => {
        const view = before.get(track.id); const original = source.get(track.id);
        if (!view || !original) return track;
        if (track === view) return original;
        const result = changedFields(original, view, track);
        if (draft?.target.laneId === track.id && draft.definition.kind === "pattern") {
          const payload = track.pads[0];
          if (!sameAudioValue(payload, draft.definition.payload)) {
            const definition = { ...draft.definition, payload } as PatternDefinition;
            clipDrafts = { ...clipDrafts, [state.clipEditingKey!]: { ...draft, definition } as DefinitionDraft };
          }
          if ("padPresetIds" in track && "padPresetIds" in original) {
            const current = clipDrafts[state.clipEditingKey!] ?? draft;
            clipDrafts = { ...clipDrafts, [state.clipEditingKey!]: { ...current, definition: { ...current.definition, presetId: track.padPresetIds[0] } as PatternDefinition } };
            for (const key of Object.keys(draft.definition.payload)) result[key] = (original as unknown as RecordValue)[key];
          }
          result.pads = original.pads;
          result.activePad = original.activePad;
          for (const key of mirrors) if (key in original) result[key] = (original as unknown as RecordValue)[key];
          if ("padPresetIds" in original) result.padPresetIds = original.padPresetIds;
        }
        const pad = (result.pads as RecordValue[])[result.activePad as number];
        if (pad) for (const key of mirrors) if (key in pad && key in result) result[key] = pad[key];
        if (overrides) {
          const previous = overrides[track.id];
          if (previous) {
            const removed = playbackKeys.filter(key => key in previous &&
              (track as unknown as RecordValue)[key] !== (view as unknown as RecordValue)[key]);
            if (removed.length) {
              const values: SequencerTrackPlaybackState = { ...previous };
              for (const key of removed) delete values[key];
              overrides = { ...overrides, [track.id]: values };
            }
          }
        }
        return sameFields(result, original) ? original : result;
      });
      const original = state.sequencer[kind];
      Object.assign(authored, { [kind]: next.length === original.length && next.every((track, index) => track === original[index]) ? original : next });
      if (playbackRuntimeKey && overrides && overrides !== runtime[playbackRuntimeKey]) {
        runtime = { ...runtime, [playbackRuntimeKey]: overrides };
      }
    }
    const sequencer = sameFields(authored, state.sequencer) ? state.sequencer : authored;
    const changed = sequencerAudioChanged(sequencer, state.sequencer);
    set({ ...delta, clipDrafts, sequencer, sequencerEditRevision: state.sequencerEditRevision + Number(changed),
      sequencerRuntime: state.sequencerRuntime.isPlaying ? runtime : delta.sequencerRuntime ?? runtime });
  };
  return { get: read, set: write };
}

/** Queued enablement is a command: consume it on dispatch, never echo it with later edits. */
export function consumeSequencerEnablementCommands(
  set: StoreApi<AppStore>["setState"], get: () => AppStore, payload: SessionSequencerConfigRequest
): void {
  const commands = new Map([...payload.tracks, ...(payload.score_tracks ?? [])].filter(track => track.queued_enabled != null).map(track =>
    [parseDrummerRowRuntimeTrackId(track.track_id)?.drummerTrackId ?? track.track_id, track.queued_enabled!]));
  if (commands.size === 0) return;
  const state = get();
  const view = mergedSequencerState(state.sequencer, state.sequencerRuntime);
  let sequencer = state.sequencer;
  let runtime = state.sequencerRuntime;
  for (const [kind, key] of [["tracks", "trackStateById"], ["scoreTracks", "trackStateById"], ["drummerTracks", "drummerStateById"]] as const) {
    const overrides = { ...runtime[key] };
    const tracks = sequencer[kind].map(track => {
      const command = commands.get(track.id);
      if (command === undefined || track.queuedEnabled !== command) return track;
      const displayed = view[kind].find(item => item.id === track.id)!;
      overrides[track.id] = { ...overrides[track.id], enabled: displayed.enabled, queuedEnabled: command };
      return { ...track, enabled: command, queuedEnabled: null };
    });
    sequencer = { ...sequencer, [kind]: tracks };
    runtime = { ...runtime, [key]: overrides };
  }
  set({ sequencer, sequencerRuntime: runtime });
}
