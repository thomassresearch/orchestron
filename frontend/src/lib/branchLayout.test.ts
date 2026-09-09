import { describe, expect, it } from "vitest";
import { addControlFlowBlock, addControlFlowCase, changeControlFlowFormat, setBranchCollapsed, silenceControlFlowCase } from "./controlFlow";
import { readCaseSizes } from "./branchCaseSizes";
import { audioTemplate } from "./audioTemplates";
import { applyBranchLayout, applyNodePositions, BRANCH_CONTENT_TOP, BRANCH_GAP, BRANCH_PADDING, clampNodesToBranch, containsPoint, layoutBranches, previewNodeDrag, type NodeSize } from "./branchLayout";
import { addBranchNode, transferBranchNodes } from "./branchTransfer";
import { projectControlFlow } from "./controlFlowProjection";
import type { OpcodeSpec } from "../types";
import catalogData from "../../../backend/app/data/opcodes.json";

const catalog = catalogData.map((s) => ({ ...s, icon: s.icon_filename })) as OpcodeSpec[];
function fixture() {
  let graph = addControlFlowBlock(audioTemplate("empty").graph, "if", { x: 100, y: 100 });
  const id = Object.keys(graph.control_flow!)[0]; const item = graph.control_flow![id].cases[0];
  graph = addBranchNode(graph, { id: "tall", opcode: "expseg", params: {}, position: { x: 200, y: 350 } }, { blockId: id, caseId: item.id });
  const sizes: Record<string, NodeSize> = { [id]: { width: 320, height: 230 }, tall: { width: 220, height: 680 } };
  for (const c of graph.control_flow![id].cases) sizes[c.result_node_id] = { width: 180, height: 120 };
  const layout = layoutBranches(graph, sizes);
  return { graph: applyBranchLayout(graph, layout), id, item, sizes, layout };
}

describe("measured branch layout", () => {
  it("places complete tall nodes above a separate result row", () => {
    const { graph, id, item, sizes, layout } = fixture(); const frame = layout.frames[0];
    expect(frame.x).toBe(graph.nodes.find((n) => n.id === id)!.position.x);
    expect(frame.y).toBe(100 + sizes[id].height + BRANCH_PADDING);
    expect(layout.positions.tall.y).toBeGreaterThanOrEqual(frame.y + BRANCH_CONTENT_TOP);
    expect(layout.positions[item.result_node_id].y).toBe(layout.positions.tall.y + sizes.tall.height + BRANCH_PADDING);
    expect(layout.positions[item.result_node_id].x + 180 + BRANCH_PADDING).toBe(frame.x + frame.width);
    expect(layout.positions[item.result_node_id].y + 120 + BRANCH_PADDING).toBe(frame.y + frame.height);
    expect(layout.frames[1].y).toBe(frame.y + frame.height + BRANCH_GAP);
  });
  it("is idempotent and does not grow from the result's previous position", () => {
    const { graph, sizes, layout } = fixture();
    expect(layoutBranches(graph, sizes, layout)).toEqual(layout);
    const result = layout.frames[0].resultNodeId;
    expect(layoutBranches(applyNodePositions(graph, { [result]: { x: 50000, y: 50000 } }), sizes, layout)).toEqual(layout);
  });
  it("retains growth after parameter bodies become smaller", () => {
    const { graph, sizes, layout } = fixture();
    const taller = layoutBranches(graph, { ...sizes, tall: { width: 400, height: 900 } }, layout);
    expect(taller.frames[0].height).toBe(layout.frames[0].height + 220);
    expect(taller.frames[0].width).toBe(layout.frames[0].width + 180);
    expect(taller.frames[1].y).toBe(layout.frames[1].y + 220);
    expect(layoutBranches(applyBranchLayout(graph, taller), sizes, taller)).toEqual(taller);
  });
  it("clamps a group at both fixed edges, preserving relative positions", () => {
    const { graph, id, item, sizes } = fixture();
    const added = addBranchNode(graph, { id: "second", opcode: "const_a", params: {}, position: { x: 260, y: 500 } }, { blockId: id, caseId: item.id });
    const layout = layoutBranches(added, sizes); const start = applyNodePositions(added, layout.positions);
    const moved = previewNodeDrag(start, ["tall", "second"], { x: -3000, y: -3000 }, layout, false);
    const a = moved.nodes.find((n) => n.id === "tall")!.position;
    const b = moved.nodes.find((n) => n.id === "second")!.position;
    expect(a).toEqual({ x: layout.frames[0].x + 24, y: layout.frames[0].y + BRANCH_CONTENT_TOP });
    expect(b.x - a.x).toBe(layout.positions.second.x - layout.positions.tall.x);
    expect(b.y - a.y).toBe(layout.positions.second.y - layout.positions.tall.y);
    expect(previewNodeDrag(start, ["tall"], { x: -3000, y: -3000 }, layout, true).nodes.find((n) => n.id === "tall")!.position.x).toBeLessThan(a.x);
  });
  it("moves selected blocks and their selected children exactly once", () => {
    const { graph, id, sizes, layout } = fixture();
    const moved = previewNodeDrag(graph, [id, "tall"], { x: 60, y: 75 }, layout, false);
    const after = layoutBranches(moved, sizes, layout);
    for (const node of graph.nodes) expect(after.positions[node.id]).toEqual({ x: node.position.x + 60, y: node.position.y + 75 });
    const projection = projectControlFlow(graph, catalog);
    const restored = projection.restore(applyNodePositions(projection.graph, after.positions), true);
    expect(restored.nodes.find((n) => n.id === "tall")!.position).toEqual(after.positions.tall);
  });
  it("clamps incoming groups without shifting existing case members", () => {
    const { graph, layout } = fixture();
    graph.nodes.push({ id: "new", opcode: "const_a", params: {}, position: { x: 0, y: 0 } });
    const next = clampNodesToBranch(graph, ["new"], layout.frames[0]);
    expect(next.nodes.find((n) => n.id === "new")!.position).toEqual({ x: layout.frames[0].x + 24, y: layout.frames[0].y + BRANCH_CONTENT_TOP });
    expect(next.nodes.find((n) => n.id === "tall")).toEqual(graph.nodes.find((n) => n.id === "tall"));
  });
  it("translates hidden members on collapsed block moves and retains canonical formulas", () => {
    const { graph, id } = fixture(); const projection = projectControlFlow(setBranchCollapsed(graph, id, true), catalog);
    const block = graph.nodes.find((n) => n.id === id)!;
    const restored = projection.restore(applyNodePositions(projection.graph, { [id]: { x: block.position.x + 20, y: block.position.y + 50 } }), true);
    expect(restored.nodes.find((n) => n.id === "tall")!.position).toEqual({ x: graph.nodes.find((n) => n.id === "tall")!.position.x + 20, y: graph.nodes.find((n) => n.id === "tall")!.position.y + 50 });
    expect(restored.ui_layout.input_formulas).toEqual(graph.ui_layout.input_formulas);
  });
  it("retains both dimensions after ordinary members move inward", () => {
    const { graph, sizes, layout } = fixture();
    const moved = previewNodeDrag(graph, ["tall"], { x: 200, y: 300 }, layout, false);
    const after = layoutBranches(moved, sizes, layout);
    expect(after.frames[0].height).toBe(layout.frames[0].height + 300);
    const movedBack = previewNodeDrag(applyBranchLayout(moved, after), ["tall"], { x: -200, y: -300 }, after, false);
    const retained = layoutBranches(movedBack, sizes, after);
    expect(retained.frames).toEqual(after.frames);
    expect(retained.positions.tall).toEqual(layout.positions.tall);
  });
  it("reflows reordered cases while retaining their member offsets", () => {
    const initial = fixture(); const { id, sizes } = initial; let { graph, layout } = initial;
    graph.control_flow![id].kind = "switch"; graph.nodes.find((n) => n.id === id)!.opcode = "Switch";
    graph.control_flow![id].cases[0].value = 36;
    graph = addControlFlowCase(graph, id);
    const item = graph.control_flow![id].cases[1];
    graph = addBranchNode(graph, { id: "other", opcode: "const_a", params: {}, position: { x: 220, y: 1500 } }, { blockId: id, caseId: item.id });
    layout = layoutBranches(graph, sizes, layout); graph = applyNodePositions(graph, layout.positions);
    const oldOffset = graph.nodes.find((n) => n.id === "other")!.position.y - layout.frames[1].y;
    const cases = graph.control_flow![id].cases; [cases[0], cases[1]] = [cases[1], cases[0]];
    const after = layoutBranches(graph, sizes, layout);
    expect(after.frames[0].caseId).toBe(item.id);
    for (const frame of after.frames) {
      const old = layout.frames.find((r) => r.caseId === frame.caseId)!;
      expect({ width: frame.width, height: frame.height }).toEqual({ width: old.width, height: old.height });
    }
    expect(after.positions.other.y - after.frames[0].y).toBe(oldOffset);
    expect(containsPoint(after.frames[0], after.positions.other)).toBe(true);
  });
  it("normalizes old positions without changing synthesis or identifiers", () => {
    const { graph, sizes } = fixture();
    const before = structuredClone(graph); const result = layoutBranches(graph, sizes);
    const next = applyNodePositions(graph, result.positions);
    expect(next.nodes.map(({ position: _position, ...node }) => node)).toEqual(before.nodes.map(({ position: _position, ...node }) => node));
    expect(next.connections).toEqual(before.connections); expect(next.control_flow).toEqual(before.control_flow);
  });
  it("keeps a connected transfer's positions until the target layout is measured", () => {
    const { graph, id, item } = fixture();
    const main = transferBranchNodes(graph, ["tall"], null);
    expect(transferBranchNodes(main, ["tall"], { blockId: id, caseId: item.id }).nodes).toEqual(main.nodes);
  });
  it("retains dimensions after deletion, transfer, Silence and format changes", () => {
    const { graph, id, item, sizes, layout } = fixture();
    const variants = [
      { ...graph, nodes: graph.nodes.filter((n) => n.id !== "tall") },
      transferBranchNodes(graph, ["tall"], null),
      silenceControlFlowCase(graph, id, item.id, true),
      changeControlFlowFormat(graph, id, "mono")
    ];
    for (const next of variants) {
      const smaller = { ...sizes, [item.result_node_id]: { width: 120, height: 40 } };
      expect(layoutBranches(next, smaller, layout).frames).toEqual(layout.frames);
    }
  });
  it("explicitly resizes both axes, clamps to complete contents and reflows later members", () => {
    const f = fixture();
    const second = f.graph.control_flow![f.id].cases[1];
    let graph = addBranchNode(f.graph, { id: "later", opcode: "const_a", params: {}, position: { x: 200, y: f.layout.frames[1].y + 100 } }, { blockId: f.id, caseId: second.id });
    const layout = layoutBranches(graph, f.sizes, f.layout); graph = applyBranchLayout(graph, layout);
    const frame = layout.frames[0]; const target = { blockId: f.id, caseId: f.item.id };
    const large = layoutBranches(graph, f.sizes, layout, { ...target, size: { width: frame.width + 350, height: frame.height + 420 } });
    expect(large.positions.tall).toEqual(layout.positions.tall);
    expect(large.positions.later).toEqual({ x: layout.positions.later.x, y: layout.positions.later.y + 420 });
    expect(large.positions[f.item.result_node_id]).toEqual({ x: layout.positions[f.item.result_node_id].x + 350, y: layout.positions[f.item.result_node_id].y + 420 });
    const enlarged = applyBranchLayout(graph, large);
    const partial = layoutBranches(enlarged, f.sizes, large, { ...target, size: { width: frame.width + 100, height: frame.height + 100 } });
    expect(partial.frames[0].width).toBe(frame.width + 100); expect(partial.frames[0].height).toBe(frame.height + 100);
    const minimum = layoutBranches(enlarged, f.sizes, large, { ...target, size: { width: -10000, height: -10000 } });
    expect(minimum).toEqual(layout);
    const committed = applyBranchLayout(enlarged, minimum);
    expect(layoutBranches(committed, f.sizes, minimum)).toEqual(minimum);
    expect(committed.connections).toEqual(graph.connections); expect(committed.control_flow).toEqual(graph.control_flow);
  });
  it("restores retained sizes from JSON without a layout cache, including collapsed cases", () => {
    const { graph, sizes, layout, id, item } = fixture();
    const large = layoutBranches(graph, sizes, layout, { blockId: id, caseId: item.id, size: { width: 1800, height: 1600 } });
    const saved = applyBranchLayout(graph, large);
    const restored = JSON.parse(JSON.stringify(saved));
    expect(layoutBranches(restored, sizes)).toEqual(large);
    const hidden = setBranchCollapsed(restored, id, true);
    const projection = projectControlFlow(hidden, catalog);
    const collapsed = applyBranchLayout(projection.graph, layoutBranches(projection.graph, sizes));
    const expanded = setBranchCollapsed(projection.restore(collapsed, true), id, false);
    expect(readCaseSizes(expanded)).toEqual(readCaseSizes(saved));
    expect(layoutBranches(expanded, sizes)).toEqual(large);
  });
  it.each([null, [], "invalid", { wrong: { width: 100, height: 100 } }])("ignores invalid presentation maps: %s", (entry) => {
    const { graph, sizes, layout } = fixture(); graph.ui_layout.control_flow_case_sizes = entry;
    expect(readCaseSizes(graph)).toEqual({});
    expect(layoutBranches(graph, sizes)).toEqual(layout);
  });
  it.each([{ width: -1, height: 500 }, { width: 800, height: 0 }, { width: Infinity, height: 500 }, { width: "800", height: 500 }])("regenerates malformed dimensions: %s", (size) => {
    const { graph, sizes, layout, id, item } = fixture(); graph.ui_layout.control_flow_case_sizes = { [id]: { [item.id]: size } };
    expect(readCaseSizes(graph)).toEqual({});
    const next = applyBranchLayout(graph, layoutBranches(graph, sizes));
    expect(readCaseSizes(next)[id][item.id]).toEqual({ width: layout.frames[0].width, height: layout.frames[0].height });
  });
});
