import { beforeEach, expect, it } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import { useAppStore } from "./useAppStore";
import { parseSequencerConfigSnapshot, buildSequencerConfigSnapshot } from "./appStoreModel";
import { clonePadLoopPattern, normalizePadLoopPatternState } from "../lib/padLoopPattern";
import { definitionColorStyle, setDefinitionColor } from "../lib/definitionColors";

beforeEach(() => { useAppStore.setState(useAppStore.getInitialState(), true); useAppStore.getState().applySequencerConfigSnapshot(fixture.config); });
it("retains colours through normalization and copying while ignoring invalid metadata", () => {
  const pattern = useAppStore.getState().sequencer.tracks[0].padLoopPattern;
  const raw = { ...pattern, definitionColors: { "pad:0": "#ABcDef", "pad:8": "#123456", "group:UNKNOWN": "#123456", "pad:1": "red" } };
  const normalized = normalizePadLoopPatternState(raw).pattern;
  expect(normalized.definitionColors).toEqual({ "pad:0": "#abcdef" });
  expect(clonePadLoopPattern(normalized)).toEqual(normalized);
  expect(definitionColorStyle(normalized, { type: "pad", padIndex: 0 })?.color).toBe("#000000");
  expect(setDefinitionColor(normalized, { type: "pad", padIndex: 0 }).definitionColors).toBeUndefined();
});
it("saves a colour without changing the audio revision or compiled sequence", () => {
  const before = useAppStore.getState();
  const track = before.sequencer.tracks[0];
  before.setSequencerTrackPadLoopPattern(track.id, setDefinitionColor(track.padLoopPattern, { type: "pad", padIndex: 0 }, "#123456"));
  const after = useAppStore.getState();
  expect(after.sequencerEditRevision).toBe(before.sequencerEditRevision);
  expect(after.sequencer.tracks[0].padLoopSequence).toEqual(track.padLoopSequence);
  const saved = buildSequencerConfigSnapshot(after.sequencer, after.sequencerInstruments, after.audioGraph, after.mixer);
  expect(saved.version).toBe(16);
  expect(parseSequencerConfigSnapshot(saved, [], "fixture-patch").sequencer.tracks[0].padLoopPattern.definitionColors).toEqual({ "pad:0": "#123456" });
});
