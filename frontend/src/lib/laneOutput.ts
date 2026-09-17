import { create } from "zustand";
import type { SequencerState, SessionLaneOutputRequest, SessionSequencerConfigRequest, SessionSequencerStatus } from "../types";

type Control = { mute: boolean; solo: boolean };
type Route = { channels: number[]; input?: number };
type Sender = (request: SessionLaneOutputRequest) => Promise<SessionSequencerStatus>;
const off: Control = { mute: false, solo: false };
let sender: Sender | null = null;
let epoch = 0;
export const useLaneOutput = create<{ lanes: Record<string, Control>; routes: Record<string, Route>; revision: number; error: string | null }>(() => ({ lanes: {}, routes: {}, revision: 0, error: null }));

export function reconcileLaneOutput(sequencer: SequencerState, reset = false) {
  const routes: Record<string, Route> = Object.fromEntries([
    ...sequencer.tracks.map(t => [t.id, { channels: [t.midiChannel] }]),
    ...sequencer.drummerTracks.map(t => [t.id, { channels: [t.midiChannel] }]),
    ...sequencer.controllerSequencers.map(t => [t.id, { channels: t.targetChannels }]),
    ...sequencer.arpeggiators.filter(t => t.playbackMode === "arranger").map(t => [t.id, { channels: [t.targetChannel], input: t.inputChannel }])
  ]);
  const state = useLaneOutput.getState();
  const lanes = reset ? {} : Object.fromEntries(Object.entries(state.lanes).filter(([id]) => id in routes));
  const changed = reset || JSON.stringify(lanes) !== JSON.stringify(state.lanes);
  if (reset) { epoch++; sender = null; }
  if (!changed && JSON.stringify(routes) === JSON.stringify(state.routes)) return;
  useLaneOutput.setState({ routes, lanes: changed ? lanes : state.lanes, revision: state.revision + (changed ? 1 : 0), error: reset ? null : state.error });
}

export function acknowledgeLaneOutput(status: SessionSequencerStatus) {
  const state = useLaneOutput.getState();
  if (state.error && status.lane_output?.revision === state.revision) useLaneOutput.setState({ error: null });
}

export function laneOutputSuppressed(id: string, lanes: Record<string, Control>, routes: Record<string, Route>) {
  if (lanes[id]?.mute) return true;
  const solos = Object.keys(lanes).filter(key => lanes[key].solo && key in routes);
  if (!solos.length) return false;
  const allowed = new Set(solos);
  for (const key of solos) {
    const input = routes[key]?.input;
    if (input !== undefined) for (const [other, route] of Object.entries(routes)) if (route.channels.includes(input)) allowed.add(other);
  }
  for (const [key, route] of Object.entries(routes)) if (route.input !== undefined && [...allowed].some(other => routes[other]?.channels.includes(route.input!))) allowed.add(key);
  return !allowed.has(id);
}

export function laneOutputRequest(): SessionLaneOutputRequest {
  const { lanes, revision } = useLaneOutput.getState();
  return { lanes, revision };
}

/** Attach only to runtime requests, never authored data or export compilation. */
export function withLaneOutput(config: SessionSequencerConfigRequest): SessionSequencerConfigRequest {
  const ids = new Set([...config.tracks.map(t => t.track_id.startsWith("drumrow:") ? t.track_id.split(":")[1] : t.track_id),
    ...(config.controller_tracks ?? []).map(t => t.track_id), ...(config.arpeggiators ?? []).filter(a => a.playback_mode === "arranger").map(a => a.arpeggiator_id)]);
  const request = laneOutputRequest();
  return { ...config, lane_output: { ...request, lanes: Object.fromEntries(Object.entries(request.lanes).filter(([id]) => ids.has(id))) } };
}

export function setLaneOutputSender(next: Sender | null) {
  epoch++;
  sender = next;
  return () => { if (sender === next) { epoch++; sender = null; } };
}

export function toggleLaneOutput(id: string, key: keyof Control) {
  const state = useLaneOutput.getState();
  const control = state.lanes[id] ?? off;
  useLaneOutput.setState({ lanes: { ...state.lanes, [id]: { ...control, [key]: !control[key] } }, revision: state.revision + 1, error: null });
  const revision = state.revision + 1, currentEpoch = epoch;
  void sender?.(laneOutputRequest()).then(() => {
    if (epoch === currentEpoch && useLaneOutput.getState().revision === revision) useLaneOutput.setState({ error: null });
  }).catch(error => {
    if (epoch === currentEpoch && useLaneOutput.getState().revision === revision) useLaneOutput.setState({ error: String(error) });
  });
}
