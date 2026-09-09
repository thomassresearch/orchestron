import { describe, expect, it } from "vitest";
import { addControlFlowBlock, addControlFlowCase, setBranchCollapsed } from "./controlFlow";
import { audioTemplate } from "./audioTemplates";
import { applyNodePositions, BRANCH_CONTENT_TOP, BRANCH_GAP, BRANCH_PADDING, clampNodesToBranch, containsPoint, layoutBranches, previewNodeDrag, type NodeSize } from "./branchLayout";
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
  return { graph: applyNodePositions(graph, layout.positions), id, item, sizes, layout };
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
  it("resizes for changing parameter height and returns to the original layout", () => {
    const { graph, sizes, layout } = fixture();
    const taller = layoutBranches(graph, { ...sizes, tall: { width: 400, height: 900 } }, layout);
    expect(taller.frames[0].height).toBe(layout.frames[0].height + 220);
    expect(taller.frames[0].width).toBe(layout.frames[0].width + 180);
    expect(taller.frames[1].y).toBe(layout.frames[1].y + 220);
    expect(layoutBranches(applyNodePositions(graph, taller.positions), sizes, taller)).toEqual(layout);
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
  it("grows then shrinks after ordinary member dragging", () => {
    const { graph, sizes, layout } = fixture();
    const moved = previewNodeDrag(graph, ["tall"], { x: 200, y: 300 }, layout, false);
    const after = layoutBranches(moved, sizes, layout);
    expect(after.frames[0].height).toBe(layout.frames[0].height + 300);
    const movedBack = previewNodeDrag(applyNodePositions(moved, after.positions), ["tall"], { x: -200, y: -300 }, after, false);
    expect(layoutBranches(movedBack, sizes, after)).toEqual(layout);
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
});
