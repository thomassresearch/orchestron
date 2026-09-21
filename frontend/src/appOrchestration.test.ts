import fixture from "../../backend/tests/fixtures/performances/arranger_seek.json";
import { normalizeSequencerState, normalizeArpeggiatorState } from "./store/appStoreModel";
import { arrangerTransportExtent } from "./lib/arrangerTransport";
import { describe, expect, it } from "vitest";

import {
  buildSequencerPlaybackRange,
  UNBOUNDED_PLAYBACK_END_STEP,
  enabledForSequencerConfigExport,
  sanitizeCsdFileBaseName,
  sanitizePerformanceFileBaseName,
  normalizeMidiVelocity,
  trackShouldRunContinuously
} from "./appOrchestration";

describe("application orchestration helpers", () => {
  it("preserves authored MIDI velocity regardless of legacy rack Level", () => {
    expect(normalizeMidiVelocity(127)).toBe(127);
    expect(normalizeMidiVelocity(110)).toBe(110);
  });

  it("normalizes exported file names without duplicating extensions", () => {
    expect(sanitizeCsdFileBaseName(" Lead Synth.csd ")).toBe("Lead_Synth");
    expect(sanitizePerformanceFileBaseName("Live Set.orch.zip")).toBe("Live_Set");
  });

  it("keeps runtime and export enablement policies distinct", () => {
    const oneShotLoop = { enabled: true, padLoopEnabled: true, padLoopRepeat: false };
    expect(trackShouldRunContinuously(oneShotLoop)).toBe(false);
    expect(enabledForSequencerConfigExport(oneShotLoop, true)).toBe(true);
    expect(enabledForSequencerConfigExport(oneShotLoop, false)).toBe(true);
  });
});

describe("arranger playback range", () => {
  function song() {
    const state = normalizeSequencerState(fixture.config.sequencer);
    for (const track of [...state.tracks, ...state.drummerTracks, ...state.controllerSequencers]) {
      track.enabled = true;
      track.padLoopRepeat = true;
    }
    return state;
  }

  it("stops at the song end including trailing rests despite repeating lanes", () => {
    const state = song();
    const track = state.tracks[0];
    track.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }, { type: "pause", lengthBeats: 16 }];
    expect(buildSequencerPlaybackRange(state, "runtime", true)).toEqual({
      playback_start_step: 0, playback_end_step: 160, playback_loop: false
    });
    expect(buildSequencerPlaybackRange(state, "runtime", false).playback_end_step).toBe(UNBOUNDED_PLAYBACK_END_STEP);
  });

  it("keeps a manually enabled lane from extending arranger playback", () => {
    const state = song();
    state.tracks[0].padLoopEnabled = false;
    expect(buildSequencerPlaybackRange(state, "runtime", true).playback_end_step).toBe(arrangerTransportExtent(state));
    expect(buildSequencerPlaybackRange(state, "runtime", false).playback_end_step).toBe(UNBOUNDED_PLAYBACK_END_STEP);
  });

  it("loops only the marked range and exports the complete finite song", () => {
    const state = song();
    state.arrangerLoopSelection = { startStep: 8, endStep: 24 };
    expect(buildSequencerPlaybackRange(state, "runtime", true)).toEqual({
      playback_start_step: 8, playback_end_step: 24, playback_loop: true
    });
    expect(buildSequencerPlaybackRange(state, "export", true)).toEqual({
      playback_start_step: 0, playback_end_step: arrangerTransportExtent(state), playback_loop: false
    });
    state.arrangerLoopSelection = null;
    expect(buildSequencerPlaybackRange(state, "runtime", true).playback_loop).toBe(false);
  });

  it("bounds an arpeggiator-only song even when its lane repeats", () => {
    const state = song();
    state.tracks = []; state.drummerTracks = []; state.controllerSequencers = [];
    const arp = normalizeArpeggiatorState({ id: "arp", enabled: true, padLoopEnabled: true, padLoopRepeat: true }, 0);
    arp.padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }, { type: "pause", lengthBeats: 2 }];
    state.arpeggiators = [arp];
    expect(buildSequencerPlaybackRange(state, "runtime", true)).toEqual({
      playback_start_step: 0, playback_end_step: 48, playback_loop: false
    });
  });
});

it.each([false, true])("keeps whole-song loop=%s bounded and lets marked ranges take precedence", enabled => {
  const state = normalizeSequencerState(fixture.config.sequencer);
  state.arrangerSongLoopEnabled = enabled;
  state.tracks[0].enabled = true;
  state.tracks[0].padLoopRepeat = true;
  expect(buildSequencerPlaybackRange(state, "runtime", true)).toEqual({
    playback_start_step: 0, playback_end_step: arrangerTransportExtent(state), playback_loop: enabled
  });
  if (enabled) expect(buildSequencerPlaybackRange(state, "runtime", false).playback_end_step).toBe(arrangerTransportExtent(state));
  state.arrangerLoopSelection = { startStep: 8, endStep: 24 };
  expect(buildSequencerPlaybackRange(state, "runtime", true)).toEqual({
    playback_start_step: 8, playback_end_step: 24, playback_loop: true
  });
  expect(buildSequencerPlaybackRange(state, "export", true)).toEqual({
    playback_start_step: 0, playback_end_step: arrangerTransportExtent(state), playback_loop: false
  });
});
