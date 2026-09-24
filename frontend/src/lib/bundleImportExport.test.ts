import { expect, it } from "vitest";
import { audioTemplate } from "./audioTemplates";
import { useAppStore } from "../store/useAppStore";
import { buildPerformanceExportPayload, parsePerformanceExportPayload, planPatchImports, resolveImportedPerformanceConfig } from "./bundleImportExport";

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
