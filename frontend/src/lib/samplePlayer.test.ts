import { expect, it } from "vitest";
import golden from "../../../backend/tests/fixtures/sample_player/performance.json";
import { audioTemplate } from "./audioTemplates";
import { toPatchListItem } from "./patchCatalog";
import {
  buildSequencerConfigSnapshot, normalizeSessionInstrumentAssignments, parseSequencerConfigSnapshot
} from "../store/appStoreModel";

it("retains independent maps and the newest clip feature through native and runtime serialization", () => {
  const patch = toPatchListItem({ ...audioTemplate("samplePlayer"), id: "sample-player-test" });
  const result = parseSequencerConfigSnapshot(golden, [patch], null);
  const snap = buildSequencerConfigSnapshot(result.sequencer, result.instruments, result.audioGraph, result.mixer);
  expect(snap.version).toBe(27);
  expect(snap.sequencer.clipArrangement?.version).toBe(4);
  expect(snap.sampleAssets).toEqual(golden.sampleAssets);
  expect(snap.instruments.map(b => b.sampleMap)).toEqual(golden.instruments.map(b => b.sampleMap));
  const [first, second] = normalizeSessionInstrumentAssignments(result.instruments);
  const lookup = (row: typeof first) => row.sample_map?.entries.find(note => note.note === 36)?.asset_id;
  expect(lookup(first)).not.toEqual(lookup(second));
  expect(() => parseSequencerConfigSnapshot({ ...golden, version: 26 }, [patch], null)).toThrow(/format 27/);
  expect(() => parseSequencerConfigSnapshot({ ...golden, sampleAssets: {} }, [patch], null)).toThrow(/unresolved/);
});
