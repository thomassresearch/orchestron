import { describe, expect, it } from "vitest";
import { addControlFlowBlock, controlFlowIssues } from "./controlFlow";
import { audioTemplate } from "./audioTemplates";
import { addBranchNode, branchTransferIssues, transferBranchNodes } from "./branchTransfer";
import { writeInputFormulaMap } from "./graphFormula";
import { useAppStore } from "../store/useAppStore";
import type { NodeInstance, OpcodeSpec } from "../types";
import catalogData from "../../../backend/app/data/opcodes.json";

const node = (id: string, opcode = "const_a"): NodeInstance => ({ id, opcode, params: { value: 1 }, position: { x: 500, y: 400 } });
const wire = (a: string, b: string) => ({ from_node_id: a, from_port_id: "aout", to_node_id: b, to_port_id: "left" });
function fixture() {
  const graph = addControlFlowBlock(audioTemplate("empty").graph, "if");
  const blockId = Object.keys(graph.control_flow!)[0];
  const [first, last] = graph.control_flow![blockId].cases;
  return { graph, target: { blockId, caseId: first.id }, silent: { blockId, caseId: last.id }, first, last };
}

describe("atomic branch transfers", () => {
  it("allows root-only constructs to move within the main graph", () => {
    const { graph, target } = fixture(); graph.nodes.push(node("out", "outs"));
    expect(branchTransferIssues(graph, ["out"], null)).toEqual([]);
    expect(branchTransferIssues(graph, ["out"], target)).not.toEqual([]);
  });
  it("always accepts an unconnected ordinary node and activates Silence", () => {
    const { graph, silent, last } = fixture(); const before = structuredClone(graph);
    const next = addBranchNode(graph, node("new"), silent);
    expect(next.control_flow![silent.blockId].cases[1].silence).toBe(false);
    expect(next.control_flow![silent.blockId].cases[1].node_ids).toEqual([last.result_node_id, "new"]);
    expect(controlFlowIssues(next)).toEqual([]); expect(graph).toEqual(before);
  });
  it("rejects a partial group with the exact unmoved connection and leaves all state intact", () => {
    const { graph, silent } = fixture(); graph.nodes.push(node("a"), node("b")); graph.connections.push(wire("a", "b"));
    graph.ui_layout.gen_nodes = { a: { label: "retained" } }; const before = structuredClone(graph);
    expect(branchTransferIssues(graph, ["a"], silent).join("\n")).toMatch(/a.aout → b.left.*b/);
    expect(() => transferBranchNodes(graph, ["a"], silent)).toThrow();
    expect(graph).toEqual(before);
  });
  it("accepts a complete connected group without changing IDs, wires or positions", () => {
    const { graph, target, first } = fixture(); graph.nodes.push(node("a"), node("b")); graph.connections.push(wire("a", "b"));
    const next = transferBranchNodes(graph, ["a", "b"], target);
    expect(next.nodes).toEqual(graph.nodes); expect(next.connections).toEqual(graph.connections);
    expect(next.control_flow![target.blockId].cases[0].node_ids).toEqual([first.result_node_id, "a", "b"]);
  });
  it("accepts endpoints already in the destination, including its result", () => {
    const { graph, target, first } = fixture(); graph.nodes.push(node("a")); graph.connections.push(wire("a", first.result_node_id));
    expect(branchTransferIssues(graph, ["a"], target)).toEqual([]);
    expect(controlFlowIssues(transferBranchNodes(graph, ["a"], target))).toEqual([]);
  });
  it("checks formula bindings even when a wire is missing", () => {
    const initial = fixture(); const { target } = initial; let { graph } = initial; graph.nodes.push(node("a"), node("b"));
    graph = { ...graph, ui_layout: writeInputFormulaMap(graph.ui_layout, { "b::left": { expression: "x * 2", inputs: [{ token: "x", from_node_id: "a", from_port_id: "aout" }] } }) };
    expect(branchTransferIssues(graph, ["b"], target).join("\n")).toContain("ƒ a.aout → b.left");
    expect(transferBranchNodes(graph, ["a", "b"], target).ui_layout).toEqual(graph.ui_layout);
  });
  it("keeps existing deliberately wired shared inputs valid", () => {
    const initial = fixture(); let { graph } = initial;
    const blockId = Object.keys(graph.control_flow!)[0]; const caseId = graph.control_flow![blockId].cases[0].id;
    graph = addBranchNode(graph, node("member"), { blockId, caseId }); graph.nodes.push(node("source")); graph.connections.push(wire("source", "member"));
    expect(controlFlowIssues(graph)).toEqual([]);
    expect(branchTransferIssues(graph, ["member"], { blockId, caseId })).toEqual([]);
    expect(branchTransferIssues(graph, ["member"], { blockId, caseId: graph.control_flow![blockId].cases[1].id }).length).toBeGreaterThan(0);
  });
  it("requires a full group when moving out or between cases", () => {
    const initial = fixture(); const { target, silent, first } = initial; let { graph } = initial;
    graph = addBranchNode(graph, node("a"), target); graph = addBranchNode(graph, node("b"), target); graph.connections.push(wire("a", "b"));
    expect(() => transferBranchNodes(graph, ["a"], null)).toThrow();
    const changed = transferBranchNodes(graph, ["a", "b"], silent);
    expect(changed.control_flow![target.blockId].cases[0].node_ids).toEqual([first.result_node_id]);
    expect(controlFlowIssues(changed)).toEqual([]);
    expect(transferBranchNodes(changed, ["a", "b"], null).control_flow![target.blockId].cases[1].node_ids).toHaveLength(1);
  });
  it.each(["If", "Switch", "CaseResult", "outs", "inleta", "outleta", "sfload", "maxalloc", "__stereo_output"])("refuses %s in a branch", (opcode) => {
    const { graph, target } = fixture(); expect(() => addBranchNode(graph, node("bad", opcode), target)).toThrow();
  });
  it("uses the normal catalog defaults and commits case creation as one store update", () => {
    const { graph, silent } = fixture(); const patch = { ...audioTemplate("empty"), graph, schema_version: 2 };
    useAppStore.setState({ currentPatch: patch });
    const spec = catalogData.find((s) => s.name === "oscili")!;
    useAppStore.getState().addNodeFromOpcode({ ...spec, icon: spec.icon_filename } as OpcodeSpec, { x: 220, y: 440 }, silent);
    const result = useAppStore.getState().currentPatch;
    const added = result.graph.nodes.find((n) => n.opcode === "oscili")!;
    expect(added.params).toHaveProperty("freq"); expect(added.position).toEqual({ x: 220, y: 440 });
    expect(result.graph.control_flow![silent.blockId].cases[1].node_ids).toContain(added.id);
    expect(result.graph.control_flow![silent.blockId].cases[1].silence).toBe(false);
    expect(result.schema_version).toBe(2);
  });
});
