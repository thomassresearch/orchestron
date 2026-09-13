import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cases from "../../../backend/tests/fixtures/instrument_types.json";
import { inferInstrumentType, instrumentMetadata, INSTRUMENT_TYPES } from "./instrumentTypes";
import { audioTemplate } from "./audioTemplates";
import { toPatchListItem } from "./patchCatalog";
import { buildPerformanceExportPayload, extractImportPatchDefinitions, parseExportedPatchDefinition, resolvePatchImportOperation } from "./bundleImportExport";
import { buildPersistedAppStateSnapshot, normalizePersistedInstrumentTabs, normalizePersistedPatch, parseEmbeddedPerformancePatchDefinition } from "../store/appStoreModel";
import { useAppStore } from "../store/useAppStore";
import { api } from "../api/client";

beforeEach(() => { vi.useFakeTimers(); useAppStore.setState(useAppStore.getInitialState(), true); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("instrument types", () => {
  it.each(cases)("infers $name as $expected", (example) => {
    expect(inferInstrumentType(example.name, example.description, example.always_on)).toBe(example.expected);
    expect(instrumentMetadata(example)).toEqual({ instrument_type: example.expected, always_on: example.always_on });
  });

  it.each(INSTRUMENT_TYPES)("preserves %s through exports, import operations and performance definitions", (type) => {
    const patch = { ...audioTemplate("empty"), instrument_type: type, always_on: type === "continuous" };
    const { payload } = buildPerformanceExportPayload({
      snapshot: useAppStore.getState().buildSequencerConfigSnapshot(), selectedPatches: [patch],
      performanceName: "Set", performanceDescription: ""
    });
    const definition = payload.patch_definitions[0];
    expect(definition.instrumentType).toBe(type);
    expect(extractImportPatchDefinitions(JSON.parse(JSON.stringify(payload)))[0].instrumentType).toBe(type);
    expect(extractImportPatchDefinitions(definition)[0].instrumentType).toBe(type);
    for (const key of ["instrumentType", "instrument_type"]) {
      const imported = parseExportedPatchDefinition({ ...definition, instrumentType: undefined, [key]: type, alwaysOn: type !== "continuous" })!;
      expect(imported.alwaysOn).toBe(type === "continuous");
      expect(parseEmbeddedPerformancePatchDefinition(imported)?.instrument_type).toBe(type);
      const create = resolvePatchImportOperation(imported, [], new Map());
      expect(create).toMatchObject({ type: "create", payload: { instrument_type: type, always_on: type === "continuous" } });
      const overwrite = resolvePatchImportOperation(imported, [toPatchListItem(patch)], new Map());
      expect(overwrite).toMatchObject({ type: "update", payload: { instrument_type: type } });
      const rename = resolvePatchImportOperation(imported, [toPatchListItem(patch)], new Map([[patch.id, {
        id: patch.id, kind: "patch", sourcePatchId: patch.id, originalName: patch.name,
        overwrite: false, targetName: "Renamed", skip: false
      }]]));
      expect(rename).toMatchObject({ type: "create", payload: { instrument_type: type } });
    }
  });

  it("infers old imports and rejects unsupported explicit types", () => {
    const old = { sourcePatchId: "old", name: "Kick", graph: audioTemplate("empty").graph };
    expect(parseExportedPatchDefinition(old)?.instrumentType).toBe("percussion");
    expect(parseEmbeddedPerformancePatchDefinition(old)?.instrument_type).toBe("percussion");
    expect(() => parseExportedPatchDefinition({ ...old, instrumentType: "invalid" })).toThrow("Unsupported instrument type");
  });

  it("retains assigned types in templates, cloned drafts, saved patches and restored tabs", async () => {
    const template = { ...audioTemplate("empty"), instrument_type: "effects_noise" as const, name: "Drum", is_template: true };
    const actions = useAppStore.getState();
    actions.newPatchFromTemplate(template);
    expect(useAppStore.getState().currentPatch.instrument_type).toBe("effects_noise");
    actions.setCurrentPatchMeta("Pad", "Bass");
    expect(useAppStore.getState().currentPatch.instrument_type).toBe("effects_noise");
    actions.setCurrentPatchType("continuous");
    expect(useAppStore.getState().currentPatch.always_on).toBe(true);
    actions.setCurrentPatchType("percussion");
    expect(useAppStore.getState().currentPatch.always_on).toBe(false);
    const create = vi.spyOn(api, "createPatch").mockImplementation(async (payload) => ({ ...audioTemplate("empty"), ...payload, id: "saved" }));
    vi.spyOn(api, "listPatches").mockResolvedValue([]);
    await actions.saveCurrentPatch();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ instrument_type: "percussion", always_on: false }));
    const persisted = buildPersistedAppStateSnapshot(useAppStore.getState());
    const restored = normalizePersistedInstrumentTabs(JSON.parse(JSON.stringify(persisted.instrumentTabs)));
    expect(restored.find((tab) => tab.patch.id === "saved")?.patch.instrument_type).toBe("percussion");
    expect(normalizePersistedPatch({ name: "Kick", graph: template.graph }).instrument_type).toBe("percussion");
    expect(normalizePersistedPatch({ ...structuredClone(template), name: "Clone" }).instrument_type).toBe("effects_noise");
    expect(audioTemplate("drumset").instrument_type).toBe("percussion");
    expect(audioTemplate("effect").instrument_type).toBe("continuous");
    expect(audioTemplate("output").instrument_type).toBe("continuous");
  });
});
