import { expect, it } from "vitest";
import { audioTemplate } from "./audioTemplates";
import { useAppStore } from "../store/useAppStore";
import { buildPerformanceExportPayload, parsePerformanceExportPayload, planPatchImports, resolveImportedPerformanceConfig } from "./bundleImportExport";
import { buildSequencerConfigSnapshot, defaultSequencerState } from "../store/appStoreModel";
import { migrateClipArrangement } from "./clipArranger/migration";
import { emptyClipHistory, recordClipEdit } from "./clipArranger/history";
import { emptyArrangerHistory } from "../store/arrangerHistory";

function bundle() {
  return buildPerformanceExportPayload({ snapshot: useAppStore.getState().buildSequencerConfigSnapshot(),
    selectedPatches: [audioTemplate("empty")], performanceName: "Song", performanceDescription: "" }).payload;
}

it("rejects ambiguous and malformed definitions instead of silently dropping them", () => {
  const exported = bundle();
  expect(() => parsePerformanceExportPayload({ ...exported, patch_definitions: [{ name: "Broken" }] })).toThrow(/invalid/);
  expect(() => parsePerformanceExportPayload({ ...exported, patch_definitions: [...exported.patch_definitions, ...exported.patch_definitions] })).toThrow(/duplicate/);
});

it("plans destination IDs before remapping performance references", () => {
  const exported = bundle();
  const source = exported.patch_definitions[0].sourcePatchId;
  exported.performance.config.instruments = [{ id: "rack", patchId: source, midiChannel: 1 }];
  const { plan, catalog, patchIdMap } = planPatchImports(exported.patch_definitions, [], new Map());
  const resolved = resolveImportedPerformanceConfig(exported, patchIdMap, catalog);
  expect(plan.patches[0].sourcePatchId).toBe(source);
  expect(resolved.instruments[0].patchId).toBe(plan.patches[0].id);
  expect(catalog[0].id).toBe(plan.patches[0].id);
});

it("omits undo history only from CSD requests while preserving music, native exports and the source snapshot", () => {
  const state = defaultSequencerState();
  state.tracks[0].padLoopEnabled = true;
  state.tracks[0].padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }];
  const before = migrateClipArrangement(state).model!;
  const after = structuredClone(before);
  after.revision++;
  after.lanes[0].clips[0].name = "Renamed phrase";
  state.clipArrangement = after;
  state.clipHistory = recordClipEdit(emptyClipHistory(), before, after, "Rename");
  const snapshot = buildSequencerConfigSnapshot(state, []);
  snapshot.arrangerHistory = emptyArrangerHistory();
  const original = structuredClone(snapshot);
  const params = { snapshot, selectedPatches: [], performanceName: "With history", performanceDescription: "" };

  const native = buildPerformanceExportPayload(params).payload;
  const csd = buildPerformanceExportPayload({ ...params, purpose: "csd" }).payload;
  const expected = structuredClone(original);
  delete expected.sequencer.clipHistory;
  delete expected.arrangerHistory;

  expect(csd.performance.config.sequencer).not.toHaveProperty("clipHistory");
  expect(csd.performance.config).not.toHaveProperty("arrangerHistory");
  expect(csd.performance.config).toEqual(expected);
  expect(native.performance.config).toEqual(original);
  expect(snapshot).toEqual(original);
  expect(native.performance.config.sequencer.clipHistory?.entries).toHaveLength(1);
  expect(buildPerformanceExportPayload({ ...params, purpose: "native" }).payload.performance.config).toEqual(original);
});
