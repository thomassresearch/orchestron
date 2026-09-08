import { describe, expect, it } from "vitest";
import catalogData from "../../../backend/app/data/opcodes.json";
import type { OpcodeSpec, PatchGraph } from "../types";
import { addControlFlowBlock, addControlFlowCase, assertControlFlow, branchChannels, changeControlFlowFormat,
  controlFlowIssues, controlFlowConditionLabel, defaultAuditionNote, deleteControlFlowCase, moveNodesToCase, patchSchemaVersion, setBranchCollapsed,
  silenceControlFlowCase } from "./controlFlow";
import { projectControlFlow } from "./controlFlowProjection";
import { audioTemplate } from "./audioTemplates";
import { deleteAudioGraphItems, projectAudioBlocks } from "./audioBlocks";
import { readInputFormulaMap, writeInputFormulaMap } from "./graphFormula";
import { normalizePatch, normalizePersistedPatch } from "../store/appStoreModel";
import { parseExportedPatchDefinition } from "./bundleImportExport";
import { useAppStore } from "../store/useAppStore";
import { buildGraphSelectionDeletePlan } from "../appOrchestration";
import { APP_COPY } from "./appUiCopy";

const catalog = catalogData.map((s) => ({ ...s, icon: `/static/icons/${s.icon_filename}` })) as OpcodeSpec[];
const firstId = (graph: PatchGraph) => Object.keys(graph.control_flow!)[0];
const firstCase = (graph: PatchGraph) => graph.control_flow![firstId(graph)].cases[0];

function playable() {
  let graph = addControlFlowBlock(audioTemplate("empty").graph, "switch");
  graph = { ...graph, nodes: [...graph.nodes, { id: "tone", opcode: "const_a", params: { value: .2 }, position: { x: 0, y: 0 } }] };
  graph = moveNodesToCase(graph, ["tone"], { blockId: firstId(graph), caseId: firstCase(graph).id });
  graph.connections = ["left", "right"].map((port) => ({ from_node_id: "tone", from_port_id: "aout", to_node_id: firstCase(graph).result_node_id, to_port_id: port }));
  return graph;
}

describe("structured branches", () => {
  it.each(["if", "switch"] as const)("creates %s with managed result nodes and promotes schema", (kind) => {
    const graph = addControlFlowBlock(audioTemplate("empty").graph, kind);
    expect(controlFlowIssues(graph)).toEqual([]);
    expect(graph.nodes).toHaveLength(3);
    expect(firstCase(graph).silence).toBe(false);
    expect(graph.control_flow![firstId(graph)].cases[1].silence).toBe(true);
    expect(patchSchemaVersion(1, graph)).toBe(2);
    expect(patchSchemaVersion(2, audioTemplate("empty").graph)).toBe(2);
  });
  it("rejects malformed records and unsupported versions", () => {
    const graph = playable();
    expect(() => assertControlFlow({ ...graph, control_flow: {} })).toThrow();
    expect(() => patchSchemaVersion(3, graph)).toThrow(/Unsupported/);
    expect(() => normalizePersistedPatch({ ...audioTemplate("empty"), schema_version: 8 })).toThrow();
    const block = graph.control_flow![firstId(graph)];
    block.cases.push({ ...block.cases[0] });
    expect(controlFlowIssues(graph).length).toBeGreaterThan(0);
  });
  it("keeps membership unchanged when nodes move geometrically", () => {
    const graph = playable();
    const moved = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, position: { x: 9000, y: -9000 } })) };
    expect(moved.control_flow).toEqual(graph.control_flow);
  });
  it("keeps later case regions below nodes explicitly added to a case", () => {
    const graph = playable();
    const extended = { ...graph, nodes: [...graph.nodes, { id: "extra", opcode: "const_a", params: { value: 0 }, position: { x: 0, y: 0 } }] };
    const moved = moveNodesToCase(extended, ["extra"], { blockId: firstId(graph), caseId: firstCase(graph).id });
    const cases = moved.control_flow![firstId(graph)].cases;
    const last = cases[cases.length - 1];
    expect(moved.nodes.find((n) => n.id === last.result_node_id)!.position.y).toBeGreaterThan(
      moved.nodes.find((n) => n.id === "extra")!.position.y + 300);
  });
  it("blocks scope escapes and structural node moves", () => {
    const graph = playable();
    expect(() => moveNodesToCase(graph, [firstId(graph)], { blockId: firstId(graph), caseId: firstCase(graph).id })).toThrow();
    const extra = { ...graph, connections: [...graph.connections, { from_node_id: "tone", from_port_id: "aout", to_node_id: firstId(graph), to_port_id: "selector" }] };
    expect(controlFlowIssues(extra).length).toBeGreaterThan(0);
  });
  it("changes format explicitly and removes only the second result channel", () => {
    const graph = playable(); const id = firstId(graph);
    const mono = changeControlFlowFormat(graph, id, "mono");
    expect(branchChannels(mono.control_flow![id])).toEqual(["left"]);
    expect(mono.connections.map((c) => c.to_port_id)).toEqual(["left"]);
    const stereo = changeControlFlowFormat(mono, id, "stereo");
    expect(stereo.connections).toEqual(mono.connections);
  });
  it("deletes a case and its formulas while protecting Default and result nodes", () => {
    let graph = playable(); const id = firstId(graph);
    graph = addControlFlowCase(graph, id);
    const item = firstCase(graph);
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { [`${item.result_node_id}::left`]: { expression: "0.2", inputs: [] } });
    const next = deleteControlFlowCase(graph, id, item.id);
    expect(next.nodes.some((n) => n.id === "tone")).toBe(false);
    expect(readInputFormulaMap(next.ui_layout)).toEqual({});
    expect(() => deleteControlFlowCase(next, id, next.control_flow![id].cases[1].id)).toThrow();
  });
  it("deletes whole blocks with an accurate node/connection preview", () => {
    const graph = playable(); const id = firstId(graph);
    const plan = buildGraphSelectionDeletePlan(graph, { nodeIds: [id], connections: [] }, catalog, APP_COPY.english);
    expect(plan.nodeIds).toHaveLength(4);
    expect(plan.connectionKeys).toHaveLength(2);
    const next = deleteAudioGraphItems(graph, [id]);
    expect(next.nodes).toEqual([]); expect(next.control_flow).toEqual({});
    expect(deleteAudioGraphItems(graph, [firstCase(graph).result_node_id]).nodes).toEqual(graph.nodes);
  });
  it("turns synthesis into Silence only by clearing its owned content", () => {
    const graph = playable(); const id = firstId(graph); const item = firstCase(graph);
    const next = silenceControlFlowCase(graph, id, item.id, true);
    expect(next.nodes.some((n) => n.id === "tone")).toBe(false);
    expect(next.connections).toEqual([]);
    expect(next.control_flow![id].cases[0].node_ids).toEqual([item.result_node_id]);
  });
});

describe("projection and persistence", () => {
  it.each([false, true])("roundtrips all canonical IDs and formulas with collapsed=%s", (collapsed) => {
    let graph = playable(); const id = firstId(graph); const result = firstCase(graph).result_node_id;
    graph = { ...graph, nodes: [...graph.nodes, { id: "shared", opcode: "const_a", params: { value: .1 }, position: { x: 0, y: 0 } }],
      connections: [...graph.connections, { from_node_id: "shared", from_port_id: "aout", to_node_id: result, to_port_id: "left" }] };
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { [`${result}::left`]: { expression: "in1 * in2", inputs: [
      { token: "in1", from_node_id: "tone", from_port_id: "aout" }, { token: "in2", from_node_id: "shared", from_port_id: "aout" }] } });
    graph = setBranchCollapsed(graph, id, collapsed);
    const view = projectControlFlow(graph, catalog); const restored = view.restore(view.graph);
    expect([...restored.nodes].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)));
    expect([...restored.connections].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([...graph.connections].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    expect(readInputFormulaMap(restored.ui_layout)).toEqual(readInputFormulaMap(graph.ui_layout));
    if (collapsed) expect(view.readOnlyInputs.size).toBe(1);
  });
  it("moves all case members with the block", () => {
    const graph = playable(); const id = firstId(graph); const view = projectControlFlow(graph, catalog);
    const moved = view.restore({ ...view.graph, nodes: view.graph.nodes.map((n) => n.id === id ? { ...n, position: { x: n.position.x + 100, y: n.position.y + 50 } } : n) });
    const tone = graph.nodes.find((n) => n.id === "tone")!;
    expect(moved.nodes.find((n) => n.id === "tone")!.position).toEqual({ x: tone.position.x + 100, y: tone.position.y + 50 });
  });
  it("preserves the drumset through stereo projections, store edits, and export/import", () => {
    const patch = audioTemplate("drumset");
    expect(controlFlowIssues(patch.graph)).toEqual([]);
    const audio = projectAudioBlocks(patch.graph, { input: "Input", output: "Output" }, catalog);
    const branch = projectControlFlow(audio.graph, audio.opcodes);
    const restored = audio.restore(branch.restore(branch.graph));
    expect(restored.control_flow).toEqual(patch.graph.control_flow);
    expect(readInputFormulaMap(restored.ui_layout)).toEqual(readInputFormulaMap(patch.graph.ui_layout));
    useAppStore.setState({ currentPatch: normalizePatch(patch) });
    useAppStore.getState().setGraph(restored);
    expect(useAppStore.getState().currentPatch.schema_version).toBe(2);
    const imported = parseExportedPatchDefinition({ ...patch, sourcePatchId: patch.id });
    expect(imported!.graph).toEqual(patch.graph);
    expect(normalizePersistedPatch(patch).graph).toEqual(patch.graph);
  });
});


describe("branch authoring details", () => {
  it("shows the actual wired or formula condition and picks a useful audition note", () => {
    const graph = audioTemplate("drumset").graph;
    expect(defaultAuditionNote(graph)).toBe(36);
    expect(defaultAuditionNote(audioTemplate("empty").graph)).toBe(60);
    expect(controlFlowConditionLabel(graph, "kit")).toBe("Switch: notnum.inote");
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { "kit::selector": {
      expression: "in1 + 2", inputs: [{ token: "in1", from_node_id: "note", from_port_id: "inote" }] } });
    expect(controlFlowConditionLabel(graph, "kit")).toBe("Switch: notnum.inote + 2");
  });
  it("preserves canonical connection selections across both projections", () => {
    const graph = audioTemplate("drumset").graph;
    const stereo = projectAudioBlocks(graph, { input: "Input", output: "Output" }, catalog);
    const collapsed = projectControlFlow(stereo.graph, stereo.opcodes);
    for (const link of graph.connections.filter((c) => c.from_node_id === "velocity" || c.from_node_id === "kit")) {
      const displayed = collapsed.projectConnection(stereo.projectConnection(link));
      expect(stereo.restoreConnection(collapsed.restoreConnection(displayed))).toEqual(link);
    }
  });
  it("blocks moves that would turn a shared source into a sibling dependency", () => {
    const graph = audioTemplate("drumset").graph;
    expect(() => moveNodesToCase(graph, ["velocity"], { blockId: "kit", caseId: "kick" })).toThrow(/velocity.iamp/);
    expect(() => moveNodesToCase(graph, ["kick_tone"], null)).toThrow(/kick_env.kenv/);
  });
  it("keeps first-channel formulas and previews the loss of right-channel dependencies", () => {
    const graph = audioTemplate("drumset").graph;
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, {
      "output_left::asignal": { expression: "in1 * 0.5", inputs: [{ token: "in1", from_node_id: "kit", from_port_id: "left" }] },
      "output_right::asignal": { expression: "in1 * 0.5", inputs: [{ token: "in1", from_node_id: "kit", from_port_id: "right" }] }
    });
    const mono = changeControlFlowFormat(graph, "kit", "mono");
    expect(readInputFormulaMap(mono.ui_layout)["output_left::asignal"]).toEqual(readInputFormulaMap(graph.ui_layout)["output_left::asignal"]);
    expect(readInputFormulaMap(mono.ui_layout)["output_right::asignal"]).toBeUndefined();
    expect(mono.connections.some((c) => c.from_node_id === "kit" && c.from_port_id === "right")).toBe(false);
  });
  it.each([0, 1.5, 3, -1])("rejects unsupported imported version %s without rounding", (schema_version) => {
    const patch = audioTemplate("drumset");
    expect(() => parseExportedPatchDefinition({ ...patch, sourcePatchId: patch.id, schema_version })).toThrow(/Unsupported/);
  });
});
