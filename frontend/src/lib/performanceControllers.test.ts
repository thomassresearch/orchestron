import { describe, expect, it } from "vitest";
import { controllerConfigurationError, controllerDefaults, normalizeControllerValue, controllerPosition, controllerTicks, controllerValue, performanceControllersForGraph, reconcileControllerValues } from "./performanceControllers";
import { audioTemplate } from "./audioTemplates";
import { cleanBindings, emptyAudioGraph, emptyMixer } from "./audioRouting";
import { remapSnapshotPatchIds, toPatchListItem } from "./patchCatalog";
import { buildSequencerConfigSnapshot, defaultSequencerState, normalizePersistedSequencerInstruments, normalizeSessionInstrumentAssignments, parseSequencerConfigSnapshot, sameAssignments } from "../store/appStoreModel";
import type { NodeInstance, PerformanceControllerDefinition, SequencerInstrumentBinding } from "../types";

const definition: PerformanceControllerDefinition = { node_id: "attack", min: 0.01, max: 10, default: 0.1, scale: "logarithmic", label: "Attack" };
const binding: SequencerInstrumentBinding = { id: "one", patchId: "patch", midiChannel: 1, level: 10, effectRoutes: [], effectSourceIds: [] };
const patch = toPatchListItem({ ...audioTemplate("empty"), id: "patch" });
patch.performance_controllers = [definition];

describe("performance controller ranges", () => {
  it("maps exact endpoints and logarithmic ratios without MIDI quantization", () => {
    expect(controllerValue(0, definition)).toBe(0.01);
    expect(controllerValue(1, definition)).toBe(10);
    expect(controllerValue(1 / 3, definition)).toBeCloseTo(0.1, 12);
    expect(controllerPosition(0.1, definition)).toBeCloseTo(1 / 3, 12);
    expect(controllerValue(controllerPosition(0.0372, definition), definition)).toBeCloseTo(0.0372, 12);
    const linear = { ...definition, min: -10, max: 10, default: 0, scale: "linear" as const };
    expect(controllerValue(0.5, linear)).toBe(0);
    expect(controllerPosition(-30, linear)).toBe(0);
    expect(controllerValue(2, linear)).toBe(10);
    expect(controllerTicks(linear).map((tick) => tick.position)).toEqual(Array.from({ length: 11 }, (_, i) => i / 10));
    expect(controllerTicks(definition).find((tick) => tick.major && Math.abs(tick.position - 1 / 3) < 1e-10)).toBeDefined();
  });
  it.each([
    [{ min: 0 }, "positive"], [{ min: 10 }, "range"], [{ default: 20 }, "defaultRange"],
    [{ max: Infinity }, "finite"], [{ default: NaN }, "finite"], [{ label: " " }, "labelRequired"]
  ])("rejects invalid configuration %o", (change, error) => {
    expect(controllerConfigurationError({ ...definition, ...change })).toBe(error);
  });
  it("discovers every node in graph order and marks invalid definitions", () => {
    const graph = audioTemplate("empty").graph;
    graph.nodes = [
      { id: "b", opcode: "perf_controller", position: { x: 0, y: 0 }, params: {} },
      { id: "a", opcode: "perf_controller", position: { x: 0, y: 0 }, params: { scale: "logarithmic" } }
    ];
    const definitions = performanceControllersForGraph(graph);
    expect(definitions.map((item) => item.node_id)).toEqual(["b", "a"]);
    expect(definitions[0]).toMatchObject({ min: 0, max: 1, default: 0.5, error: null });
    expect(definitions[1].error).toBe("positive");
  });
  it("keeps malformed imported fields safe to display in the rack", () => {
    const graph = audioTemplate("empty").graph;
    graph.nodes = [{ id: "invalid", opcode: "perf_controller", position: { x: 0, y: 0 }, params: { min: "bad", label: 42 } }];
    expect(performanceControllersForGraph(graph)[0]).toEqual({ node_id: "invalid", controller_type: "float", min: 0, max: 1, default: 0.5, scale: "linear", label: "Parameter", error: "finite" });
  });
});

describe("instance override persistence", () => {
  it("retains explicit overrides equal to a default, clamps changed ranges, and removes deleted controllers", () => {
    const configured = { ...binding, performanceControllerValues: { attack: 0.1, removed: 0.5 } };
    const result = reconcileControllerValues(configured, [{ ...definition, default: 0.7 }]);
    expect(result.performanceControllerValues).toEqual({ attack: 0.1 });
    expect(result.performanceControllerNotice).toBe(true);
    expect(reconcileControllerValues(configured, [{ ...definition, min: 0.2, default: 0.5 }]).performanceControllerValues).toEqual({ attack: 0.2 });
    expect(reconcileControllerValues(binding, [definition]).performanceControllerValues).toEqual({});
  });
  it("round-trips snapshots, app state, sessions, and import ID remapping independently per instance", () => {
    const bindings = [{ ...binding, performanceControllerValues: { attack: 0.3 } }, { ...binding, id: "two", midiChannel: 2, performanceControllerValues: { attack: 2.7 } }];
    const snapshot = buildSequencerConfigSnapshot(defaultSequencerState(), bindings, emptyAudioGraph(), emptyMixer());
    expect(snapshot.version).toBe(21);
    expect(parseSequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot)), [patch], null).instruments.map((item) => item.performanceControllerValues)).toEqual([{ attack: 0.3 }, { attack: 2.7 }]);
    expect(normalizePersistedSequencerInstruments(cleanBindings(bindings), [patch], null).map((item) => item.performanceControllerValues)).toEqual([{ attack: 0.3 }, { attack: 2.7 }]);
    const assignments = normalizeSessionInstrumentAssignments(bindings);
    expect(assignments.map((item) => item.performance_controller_values)).toEqual([{ attack: 0.3 }, { attack: 2.7 }]);
    expect(sameAssignments(assignments, assignments.map((item) => ({ ...item, performance_controller_values: { attack: 5 } })))).toBe(true);
    const remapped = remapSnapshotPatchIds(snapshot, new Map([["patch", "copy"]]), [{ ...patch, id: "copy" }]);
    expect(remapped.instruments[0]).toMatchObject({ patchId: "copy", performanceControllerValues: { attack: 0.3 } });
  });
  it.each([1,2,3,4,5,6,7,8,9,10,11,12])("loads version %i with untouched defaults", (version) => {
    const parsed = parseSequencerConfigSnapshot({ version, instruments: [binding], sequencer: {} }, [patch], null);
    expect(parsed.instruments[0].performanceControllerValues).toEqual({});
  });
  it.each([11,12])("preserves an empty rack and explicit routing in version %i", (version) => {
    const graph = emptyAudioGraph();
    const parsed = parseSequencerConfigSnapshot({ version, instruments: [], sequencer: {}, audioGraph: graph }, [patch], "patch");
    expect(parsed.instruments).toEqual([]);
    expect(parsed.audioGraph).toEqual(graph);
  });
});


describe("discrete controller types", () => {
  const integer = { ...controllerDefaults("integer"), node_id: "count", min: -3, max: 3 };
  const bool = { ...controllerDefaults("bool"), node_id: "enabled" };
  it("defaults legacy nodes to float and new discrete nodes to zero", () => {
    const graph = audioTemplate("empty").graph;
    graph.nodes = [undefined, "integer", "bool"].map((type, i) => ({ id: String(i), opcode: "perf_controller", position: { x: 0, y: 0 }, params: (type ? { controller_type: type } : {}) as NodeInstance["params"] }));
    expect(performanceControllersForGraph(graph).map(d => [d.controller_type, d.default, d.error])).toEqual([
      ["float", 0.5, null], ["integer", 0, null], ["bool", 0, null]
    ]);
  });
  it("rejects fractional or unsafe integers, logarithmic discrete controls, and invalid bool fields", () => {
    for (const key of ["min", "max", "default"] as const) {
      expect(controllerConfigurationError({ ...integer, [key]: 0.5 })).toBe("integerRequired");
      expect(controllerConfigurationError({ ...integer, [key]: 2 ** 53 })).toBe("integerRequired");
    }
    expect(controllerConfigurationError({ ...integer, scale: "logarithmic" })).toBe("linearOnly");
    expect(controllerConfigurationError({ ...bool, default: 0.5 })).toBe("boolRequired");
    expect(controllerConfigurationError({ ...bool, max: 2 })).toBe("boolRequired");
    expect(controllerConfigurationError({ ...bool, scale: "logarithmic" })).toBe("linearOnly");
  });
  it("rounds ties toward positive infinity and preserves exact safe endpoints", () => {
    expect([-9, -1.5, -0.5, 0.5, 1.5, 9].map(v => normalizeControllerValue(v, integer))).toEqual([-3, -1, -0, 1, 2, 3]);
    expect(normalizeControllerValue(Number.MAX_SAFE_INTEGER, { ...integer, max: Number.MAX_SAFE_INTEGER })).toBe(Number.MAX_SAFE_INTEGER);
    expect([-9, 0.49999, 0.5, 9].map(v => normalizeControllerValue(v, bool))).toEqual([0, 0, 1, 1]);
  });
  it("converts saved overrides with notice while leaving untouched defaults implicit", () => {
    const result = reconcileControllerValues({ ...binding, performanceControllerValues: { count: -1.5, enabled: 0.5, removed: 1 } }, [integer, bool]);
    expect(result.performanceControllerValues).toEqual({ count: -1, enabled: 1 });
    expect(result.performanceControllerNotice).toBe(true);
    expect(reconcileControllerValues(binding, [integer, bool]).performanceControllerValues).toEqual({});
    const typedPatch = { ...patch, performance_controllers: [integer, bool] };
    const snapshot = buildSequencerConfigSnapshot(defaultSequencerState(), [result], emptyAudioGraph(), emptyMixer());
    expect(parseSequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot)), [typedPatch], null).instruments[0].performanceControllerValues).toEqual({ count: -1, enabled: 1 });
  });
});
