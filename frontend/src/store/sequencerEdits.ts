import type { StoreApi } from "zustand";
import type { SequencerState, SequencerTrackPlaybackState, SessionSequencerConfigRequest } from "../types";
import { parseDrummerRowRuntimeTrackId } from "../lib/sequencerRuntime";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import type { AppStore } from "./appStoreTypes";

const playbackKeys = ["activePad", "queuedPad", "queuedEnabled", "enabled", "padLoopPosition", "runtimePadStartSubunit"] as const;
const mirrors = ["steps", "lengthBeats", "stepCount", "scaleRoot", "scaleType", "mode", "keypoints"];
type RecordValue = Record<string, unknown>;

/** Compare authored audio data only, independent of transport and display metadata. */
export function sequencerEditSignature(state: SequencerState): string {
  const tracks = (items: Array<object>) => items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) =>
    !["name", "runtimeLocalStep", "runtimePadStartSubunit", "padLoopPosition", "steps", "keypoints"].includes(key))))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({ timing: state.timing, arrangerLoopSelection: state.arrangerLoopSelection,
    tracks: tracks(state.tracks), drummerTracks: tracks(state.drummerTracks), controllerSequencers: tracks(state.controllerSequencers),
    arpeggiatorArrangement: state.arpeggiators.filter(arp => arp.playbackMode === "arranger").map(arp => ({
      id: arp.id, loop: arp.padLoopEnabled, repeat: arp.padLoopRepeat, pattern: arp.padLoopPattern,
      durations: arp.pads.map(pad => pad.lengthBeats)
    })) });
}

function changedFields(authored: object, displayed: object, edited: object): RecordValue {
  const result = { ...authored } as RecordValue;
  for (const [key, value] of Object.entries(edited)) {
    if (value !== (displayed as RecordValue)[key]) result[key] = value;
  }
  return result;
}

/** Editors read the sounding pad; only their changes are committed to authorship. */
export function sequencerEditAccess(set: StoreApi<AppStore>["setState"], get: () => AppStore) {
  const read = (): AppStore => { const state = get(); return { ...state, sequencer: mergedSequencerState(state.sequencer, state.sequencerRuntime) }; };
  const write: StoreApi<AppStore>["setState"] = (update) => {
    const state = get();
    const displayed = read();
    const delta = typeof update === "function" ? update(displayed) : update;
    if (!delta.sequencer) { set(delta); return; }
    if (delta.sequencer === displayed.sequencer) { set({ ...delta, sequencer: state.sequencer }); return; }
    const edited = delta.sequencer;
    const authored = changedFields(state.sequencer, displayed.sequencer, edited) as unknown as SequencerState;
    let runtime = state.sequencerRuntime;
    for (const [kind, runtimeKey] of [["tracks", "trackStateById"], ["drummerTracks", "drummerStateById"], ["controllerSequencers", "controllerStateById"]] as const) {
      const before = new Map(displayed.sequencer[kind].map(t => [t.id, t]));
      const source = new Map(state.sequencer[kind].map(t => [t.id, t]));
      const overrides = { ...runtime[runtimeKey] };
      const next = edited[kind].map(track => {
        const view = before.get(track.id); const original = source.get(track.id);
        if (!view || !original) return track;
        const result = changedFields(original, view, track);
        const pad = (result.pads as RecordValue[])[result.activePad as number];
        if (pad) for (const key of mirrors) if (key in pad && key in result) result[key] = pad[key];
        const values: SequencerTrackPlaybackState = { ...overrides[track.id] };
        for (const key of playbackKeys) {
          if ((track as unknown as RecordValue)[key] !== (view as unknown as RecordValue)[key]) delete values[key];
        }
        overrides[track.id] = values;
        return result;
      });
      Object.assign(authored, { [kind]: next });
      runtime = { ...runtime, [runtimeKey]: overrides };
    }
    const changed = sequencerEditSignature(authored) !== sequencerEditSignature(state.sequencer);
    set({ ...delta, sequencer: authored, sequencerEditRevision: state.sequencerEditRevision + Number(changed),
      sequencerRuntime: state.sequencerRuntime.isPlaying ? runtime : delta.sequencerRuntime ?? runtime });
  };
  return { get: read, set: write };
}

/** Queued enablement is a command: consume it on dispatch, never echo it with later edits. */
export function consumeSequencerEnablementCommands(
  set: StoreApi<AppStore>["setState"], get: () => AppStore, payload: SessionSequencerConfigRequest
): void {
  const commands = new Map(payload.tracks.filter(track => track.queued_enabled != null).map(track =>
    [parseDrummerRowRuntimeTrackId(track.track_id)?.drummerTrackId ?? track.track_id, track.queued_enabled!]));
  if (commands.size === 0) return;
  const state = get();
  const view = mergedSequencerState(state.sequencer, state.sequencerRuntime);
  let sequencer = state.sequencer;
  let runtime = state.sequencerRuntime;
  for (const [kind, key] of [["tracks", "trackStateById"], ["drummerTracks", "drummerStateById"]] as const) {
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
