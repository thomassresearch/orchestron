import { describe, expect, it } from "vitest";
import saxophone from "../../../backend/tests/fixtures/patches/tenor_saxophone.patch.json";
import catalog from "../../../backend/app/data/opcodes.json";
import type { OpcodeSpec, PatchGraph, PortSpec } from "../types";
import { readInputFormulaMap, setInputFormulaConfig } from "./graphFormula";
import { resolveInputValue, resetInputValue, saveInputValue, validateInputValue } from "./inputValue";
import { describeInputValue, inputValueCopy } from "./inputValueCopy";
import { addStereoBlock, projectAudioBlocks, resolveStereoMembers } from "./audioBlocks";
import { audioTemplate } from "./audioTemplates";
import { projectControlFlow } from "./controlFlowProjection";
import { addControlFlowBlock, moveNodesToCase, setBranchCollapsed } from "./controlFlow";
import { parseExportedPatchDefinition } from "./bundleImportExport";
import { normalizePatch } from "../store/appStoreModel";

const fixture = () => structuredClone(saxophone.graph) as unknown as PatchGraph;
const port = (id: string): PortSpec => catalog.find((op) => op.name === "resonx")!.inputs.find((p) => p.id === id)! as PortSpec;
const body = (graph: PatchGraph) => graph.nodes.find((n) => n.id === "sax_body")!;
const state = (graph: PatchGraph, id = "xcf") => resolveInputValue(graph, body(graph), port(id));

describe("input values presented as compiled", () => {
  it("reveals the saxophone's four stored filter parameters without mutating its graph", () => {
    const graph = fixture(); const before = structuredClone(graph);
    for (const [id, expected] of [["sax_body", ["650", "750", "1", "1"]], ["sax_presence", ["1800", "1600", "1", "1"]]] as const) {
      const node = graph.nodes.find((n) => n.id === id)!;
      ["xcf", "xbw", "inumlayer", "iscl"].forEach((key, i) => {
        expect(resolveInputValue(graph, node, port(key))).toMatchObject({ source: "parameter", highlighted: true, expression: expected[i] });
      });
      expect(resolveInputValue(graph, node, port("iskip"))).toMatchObject({ source: "default", highlighted: false, expression: "0" });
    }
    expect(graph).toEqual(before);
  });

  it.each([0, false, 1000, -1, 0.0000001])("recognizes the stored value %s, even when false or equal to the catalog default", (value) => {
    const graph = fixture(); body(graph).params.xcf = value;
    expect(state(graph)).toMatchObject({ source: "parameter", highlighted: true, storedValue: value });
    expect(describeInputValue(state(graph), "english")).toBe(`Stored value: ${value}`);
  });

  it("uses formula, connections, parameter, default, unset precedence with stable bindings", () => {
    let graph = fixture();
    graph.connections.push({ from_node_id: "sax_tone", from_port_id: "iout", to_node_id: "sax_body", to_port_id: "xcf" });
    expect(state(graph)).toMatchObject({ source: "connections", expression: "in1", highlighted: false, storedValue: 650 });
    graph.ui_layout = setInputFormulaConfig(graph.ui_layout, "sax_body::xcf", { expression: "tone * 1000", inputs: [
      { token: "tone", from_node_id: "sax_tone", from_port_id: "iout" }
    ] });
    expect(state(graph)).toMatchObject({ source: "formula", expression: "tone * 1000", highlighted: true });
    graph.connections.push({ from_node_id: "sax_growl", from_port_id: "iout", to_node_id: "sax_body", to_port_id: "xcf" });
    expect(state(graph).bindings.map((b) => b.token)).toEqual(["tone", "in1"]);
    graph = resetInputValue(graph, "sax_body", "xcf");
    expect(state(graph)).toMatchObject({ source: "connections", expression: "in1 + in2", storedValue: undefined });
    graph.connections = graph.connections.filter((link) => link.to_port_id !== "xcf");
    expect(state(graph)).toMatchObject({ source: "default", expression: "1000", highlighted: false });
    expect(resolveInputValue(graph, body(graph), { ...port("xcf"), default: null })).toMatchObject({ source: "unset", expression: "", highlighted: false });
  });

  it.each(["0", "-2.5", "1e-7", "+2E3"])("saves an unconnected numeric literal %s as a parameter", (text) => {
    const graph = fixture(); const next = saveInputValue(graph, "sax_body", port("xcf"), text);
    expect(body(next).params.xcf).toBe(Number(text));
    expect(readInputFormulaMap(next.ui_layout)["sax_body::xcf"]).toBeUndefined();
    expect(state(next).highlighted).toBe(true);
    expect(body(graph).params.xcf).toBe(650);
  });

  it("saves expressions with zero or multiple wires and removes the obsolete parameter", () => {
    let graph = saveInputValue(fixture(), "sax_body", port("xcf"), "sr * 0.1");
    expect(body(graph).params).not.toHaveProperty("xcf");
    expect(readInputFormulaMap(graph.ui_layout)["sax_body::xcf"]).toEqual({ expression: "sr * 0.1", inputs: [] });
    graph.connections.push({ from_node_id: "sax_tone", from_port_id: "iout", to_node_id: "sax_body", to_port_id: "xcf" });
    graph = saveInputValue(graph, "sax_body", port("xcf"), "650");
    expect(readInputFormulaMap(graph.ui_layout)["sax_body::xcf"].expression).toBe("650");
    expect(body(graph).params).not.toHaveProperty("xcf");
    expect(graph.connections).toHaveLength(fixture().connections.length + 1);
  });

  it("rejects invalid expressions and nonfinite numbers without changing the patch", () => {
    const graph = fixture();
    for (const text of ["", "NaN", "Infinity", "1e999", "unknown", "in1", "1 +"])
      expect(saveInputValue(graph, "sax_body", port("xcf"), text)).toBe(graph);
    expect(validateInputValue(state(graph), "1e-7 + 1").isValid).toBe(false); // Formula grammar is unchanged.
  });

  it("reset removes both layers but retains wires, other parameters and layout", () => {
    const graph = fixture();
    graph.ui_layout = setInputFormulaConfig(graph.ui_layout, "sax_body::xcf", { expression: "1200", inputs: [] });
    const next = resetInputValue(graph, "sax_body", "xcf");
    expect(state(next)).toMatchObject({ source: "default", expression: "1000", highlighted: false });
    expect(next.connections).toBe(graph.connections);
    expect(body(next).params.xbw).toBe(750);
    expect(body(next).position).toBe(body(graph).position);
    expect(body(graph).params.xcf).toBe(650);
  });

  it("keeps constants and formulas through save/reload and native instrument import", () => {
    let graph = saveInputValue(fixture(), "sax_body", port("xcf"), "1e-7");
    graph = saveInputValue(graph, "sax_body", port("xbw"), "sr / 100");
    const saved = normalizePatch({ ...saxophone, graph, id: "sax", created_at: "", updated_at: "", always_on: false, instrument_type: "melody" });
    const restored = parseExportedPatchDefinition(JSON.parse(JSON.stringify({ ...saved, sourcePatchId: saved.id })))!.graph;
    expect(state(restored)).toMatchObject({ source: "parameter", expression: "1e-7" });
    expect(state(restored, "xbw")).toMatchObject({ source: "formula", expression: "sr / 100" });
  });
});

describe("specialized inputs and projections", () => {
  it("keeps maxalloc literal-only and preserves connected literals", () => {
    const graph = fixture(); const node = graph.nodes.find((n) => n.opcode === "maxalloc")!;
    const p = catalog.find((o) => o.name === "maxalloc")!.inputs[0] as PortSpec;
    expect(validateInputValue(resolveInputValue(graph, node, p), "1 + 1").isValid).toBe(false);
    const next = saveInputValue(graph, node.id, p, "2");
    expect(next.nodes.find((n) => n.id === node.id)!.params.icount).toBe(2);
    expect(readInputFormulaMap(next.ui_layout)[`${node.id}::icount`]).toBeUndefined();
    next.connections.push({ from_node_id: "amp_attack", from_port_id: "iout", to_node_id: node.id, to_port_id: p.id });
    expect(saveInputValue(next, node.id, p, "3")).toBe(next);
  });

  it("edits standalone string literals and protects managed stereo names and coefficient lists", () => {
    const graph = audioTemplate("empty").graph;
    const node = { id: "channel", opcode: "outleta", params: { sname: "left" }, position: { x: 0, y: 0 } };
    graph.nodes.push(node);
    const p = catalog.find((o) => o.name === "outleta")!.inputs.find((p) => p.id === "sname")! as PortSpec;
    const next = saveInputValue(graph, node.id, p, "bus.left");
    expect(next.nodes[0].params.sname).toBe("bus.left");
    expect(readInputFormulaMap(next.ui_layout)).toEqual({});
    graph.audio_interface = { role: "instrument", groups: [{ id: "stereo", name: "Output", direction: "output", layout: "stereo", ports: ["left", "right"], purpose: "main" }] };
    expect(resolveInputValue(graph, node, p).mode).toBe("managed");
    expect(saveInputValue(graph, node.id, p, "changed")).toBe(graph);
    const coefficient = { ...node, opcode: "zfilter2", params: { icoeffs: "1, 2" } };
    expect(resolveInputValue(graph, coefficient, { ...p, id: "icoeffs", signal_type: "i" }).mode).toBe("coefficients");
  });

  it("projects and restores both literal and formula edits on collapsed Stereo Output", () => {
    const graph = addStereoBlock(audioTemplate("empty").graph, "output");
    const group = graph.audio_interface!.groups[0];
    const [left, right] = resolveStereoMembers(graph, group).nodes;
    left.params.asignal = 0;
    right.params.asignal = 0.2;
    const projection = projectAudioBlocks(graph, { input: "In", output: "Out" }, []);
    const node = projection.graph.nodes[0];
    const [l, r] = projection.opcodes[0].inputs;
    expect(resolveInputValue(projection.graph, node, l)).toMatchObject({ source: "parameter", expression: "0", highlighted: true });
    expect(projection.restore(projection.graph)).toEqual(graph);
    let changed = saveInputValue(projection.graph, node.id, l, "0.3");
    changed = saveInputValue(changed, node.id, r, "ampdb(-6)");
    const restored = projection.restore(changed);
    expect(restored.nodes.find((n) => n.id === left.id)!.params.asignal).toBe(0.3);
    expect(restored.nodes.find((n) => n.id === right.id)!.params).not.toHaveProperty("asignal");
    expect(readInputFormulaMap(restored.ui_layout)[`${right.id}::asignal`].expression).toBe("ampdb(-6)");
    expect(restored.audio_interface).toEqual(graph.audio_interface);
    const reset = projection.restore(resetInputValue(changed, node.id, "left"));
    expect(reset.nodes.find((n) => n.id === left.id)!.params).not.toHaveProperty("asignal");
  });

  it("keeps collapsed branch values editable and captured inputs read-only", () => {
    let graph = addControlFlowBlock(audioTemplate("empty").graph, "switch");
    const block = Object.values(graph.control_flow!)[0];
    const node = graph.nodes.find((n) => n.id === Object.keys(graph.control_flow!)[0])!;
    node.params.selector = 0;
    graph.nodes.push({ id: "filter", opcode: "resonx", params: { xcf: 650, xbw: 750 }, position: { x: 0, y: 0 } },
      { id: "shared", opcode: "const_a", params: { value: 0 }, position: { x: 0, y: 0 } });
    graph = moveNodesToCase(graph, ["filter"], { blockId: node.id, caseId: block.cases[0].id });
    graph.connections.push({ from_node_id: "shared", from_port_id: "aout", to_node_id: "filter", to_port_id: "asig" });
    graph = setBranchCollapsed(graph, node.id, true);
    const view = projectControlFlow(graph, catalog as unknown as OpcodeSpec[]);
    expect(view.readOnlyInputs.size).toBe(1);
    const projected = view.graph.nodes.find((n) => n.id === node.id)!;
    const spec = view.opcodes.find((o) => o.name === projected.opcode)!;
    const selector = spec.inputs.find((p) => p.id === "selector")!;
    expect(resolveInputValue(view.graph, projected, selector)).toMatchObject({ source: "parameter", highlighted: true, expression: "0" });
    const next = view.restore(saveInputValue(view.graph, node.id, selector, "1"));
    expect(next.nodes.find((n) => n.id === node.id)!.params.selector).toBe(1);
    expect(next.nodes.find((n) => n.id === "filter")!.params).toEqual({ xcf: 650, xbw: 750 });
    expect(next.connections).toEqual(graph.connections);
  });

  it.each(["english", "german", "french", "spanish"] as const)("labels source, reset and editing in %s", (language) => {
    const labels = inputValueCopy(language);
    expect(describeInputValue(state(fixture()), language)).toBe(`${labels.parameter}: 650`);
    expect(labels.reset).toBeTruthy(); expect(labels.default).toBeTruthy(); expect(labels.edit).toBeTruthy();
  });
});
