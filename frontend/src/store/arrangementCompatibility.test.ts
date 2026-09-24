import { expect, it } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/collapsed_gui.json";
import { buildSequencerConfigSnapshot, normalizePadLoopPatternBundle, parseSequencerConfigSnapshot } from "./appStoreModel";
import { arrangerTransportExtent } from "../lib/arrangerTransport";

it.each(Array.from({ length: 16 }, (_, index) => index + 1))("imports v%s with retained definitions and explicit legacy fallback", version => {
  const config = structuredClone(fixture.config);
  const track = config.sequencer.tracks[0];
  Object.assign(track, { padLoopEnabled: true, padLoopRepeat: false, activePad: 5, padLoopSequence: [],
    padLoopPattern: { rootSequence: [], groups: [{ id: "A", sequence: [] }, { id: "B", sequence: [{ type: "pad", padIndex: 1 }] }],
      superGroups: [{ id: "I", sequence: [{ type: "pause", lengthBeats: 4 }] }] } });
  const result = parseSequencerConfigSnapshot({ ...config, version }, [], "fixture-patch");
  expect(result.sequencer.tracks[0]).toMatchObject({ activePad: 5, padLoopEnabled: true, padLoopRepeat: false,
    padLoopSequence: [5], padLoopPattern: { rootSequence: [{ type: "pad", padIndex: 5 }], groups: [{ id: "A", sequence: [] }, { id: "B", sequence: [{ type: "pad", padIndex: 1 }] }] } });
  const saved = buildSequencerConfigSnapshot(result.sequencer, result.instruments);
  expect(saved.version).toBe(17);
  expect(parseSequencerConfigSnapshot(saved, [], "fixture-patch").sequencer.tracks[0].padLoopPattern).toEqual(result.sequencer.tracks[0].padLoopPattern);
});

it("counts rest-only and trailing silence with rational beat ratios", () => {
  const result = parseSequencerConfigSnapshot(fixture.config, [], "fixture-patch");
  const track = result.sequencer.tracks[0];
  const phrase = normalizePadLoopPatternBundle({ rootSequence: [{ type: "pause", lengthBeats: 16 }, { type: "pause", lengthBeats: 8 }], groups: [], superGroups: [] });
  const sequencer = { ...result.sequencer, drummerTracks: [], controllerSequencers: [], arpeggiators: [], tracks: [{ ...track, ...phrase, timing: { ...track.timing, beatRateNumerator: 3 as const, beatRateDenominator: 2 as const } }] };
  expect(arrangerTransportExtent(sequencer)).toBe(16 * 8);
});

it.each([false, true])("round-trips whole-song loop=%s without changing format versions", enabled => {
  const result = parseSequencerConfigSnapshot(fixture.config, [], "fixture-patch");
  expect(result.sequencer.arrangerSongLoopEnabled).toBe(false);
  result.sequencer.arrangerSongLoopEnabled = enabled;
  const saved = buildSequencerConfigSnapshot(result.sequencer, result.instruments);
  expect(saved.version).toBe(17);
  expect(saved.sequencer.arrangerSongLoopEnabled).toBe(enabled);
  expect(parseSequencerConfigSnapshot(saved, [], "fixture-patch").sequencer.arrangerSongLoopEnabled).toBe(enabled);
});
