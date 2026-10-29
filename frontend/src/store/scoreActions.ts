import type { ScoreTrackState } from "../types";
import { nextAvailablePerformanceChannel } from "./appStoreModel";
import { defaultScoreTrack, validateScoreTracks } from "../lib/scoreSequencer";
import { nextPerformanceDeviceName } from "../lib/performanceDeviceNames";
import { sequencerEditAccess } from "./sequencerEdits";
import { useAppStore } from "./useAppStore";

export function updateScoreTrack(id: string, update: (track: ScoreTrackState) => ScoreTrackState) {
  const access = sequencerEditAccess(useAppStore.setState, useAppStore.getState);
  const state = access.get();
  const scoreTracks = state.sequencer.scoreTracks.map(t => {
    if (t.id !== id) return t;
    const next = update(t);
    const pad = next.pads[next.activePad];
    return { ...next, lengthBeats: pad.lengthBeats, stepCount: pad.lengthBeats * next.timing.stepsPerBeat,
      scaleRoot: pad.scaleRoot, scaleType: pad.scaleType, mode: pad.mode };
  });
  validateScoreTracks(scoreTracks);
  access.set({ sequencer: { ...state.sequencer, scoreTracks } });
}

export function addScoreTrack(prefix: string) {
  const access = sequencerEditAccess(useAppStore.setState, useAppStore.getState);
  const state = access.get();
  const track = defaultScoreTrack(state.sequencer.scoreTracks.length + 1, state.sequencer.timing);
  track.midiChannel = nextAvailablePerformanceChannel(state.sequencer);
  track.name = nextPerformanceDeviceName(state.sequencer, prefix, state.sequencer.scoreTracks.length + 1);
  const scoreTracks = [...state.sequencer.scoreTracks, track];
  validateScoreTracks(scoreTracks);
  access.set({ sequencer: { ...state.sequencer, scoreTracks } });
}

export function removeScoreTrack(id: string) {
  const access = sequencerEditAccess(useAppStore.setState, useAppStore.getState);
  const state = access.get();
  access.set({ sequencer: { ...state.sequencer, scoreTracks: state.sequencer.scoreTracks.filter(t => t.id !== id) } });
}

export function selectScorePad(id: string, pad: number) {
  const state = useAppStore.getState();
  useAppStore.setState({ sequencerEditingPads: { ...state.sequencerEditingPads, [id]: pad } });
}
