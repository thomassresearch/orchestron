import { expect, it } from "vitest";
import golden from "../../../backend/tests/fixtures/sample_player/performance.json";
import { createSamplePlayerPatch } from "./samplePlayer";
import { toPatchListItem } from "./patchCatalog";
import {
  buildSequencerConfigSnapshot, normalizeSessionInstrumentAssignments, parseSequencerConfigSnapshot
} from "../store/appStoreModel";

it.each(["mp3", "m4a"])("retains %s independent maps and the newest clip feature through native and runtime serialization", format => {
  const fixture = structuredClone(golden);
  for (const asset of Object.values(fixture.sampleAssets)) {
    if (asset.source.format === "mp3") {
      asset.source.format = format;
      asset.source.stored_name = `sam-${asset.source.sha256}.${format}`;
      asset.source.original_name = `sample.${format}`;
    }
  }
  const patch = toPatchListItem({ ...createSamplePlayerPatch(), id: "sample-player-test", created_at: "", updated_at: "" });
  const result = parseSequencerConfigSnapshot(fixture, [patch], null);
  const snap = buildSequencerConfigSnapshot(result.sequencer, result.instruments, result.audioGraph, result.mixer);
  expect(snap.version).toBe(27);
  expect(snap.sequencer.clipArrangement?.version).toBe(4);
  expect(snap.sampleAssets).toEqual(fixture.sampleAssets);
  expect(snap.instruments.map(b => b.sampleMap)).toEqual(fixture.instruments.map(b => b.sampleMap));
  const [first, second] = normalizeSessionInstrumentAssignments(result.instruments);
  const lookup = (row: typeof first) => row.sample_map?.entries.find(note => note.note === 36)?.asset_id;
  expect(lookup(first)).not.toEqual(lookup(second));
  expect(() => parseSequencerConfigSnapshot({ ...golden, version: 26 }, [patch], null)).toThrow(/format 27/);
  expect(() => parseSequencerConfigSnapshot({ ...golden, sampleAssets: {} }, [patch], null)).toThrow(/unresolved/);
});
