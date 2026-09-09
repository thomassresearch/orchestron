import type { NodePosition, PatchGraph } from "../types";
import { branchCollapsed, controlFlowOwners } from "./controlFlow";
import { readCaseSizes, writeCaseSizes } from "./branchCaseSizes";

export interface NodeSize { width: number; height: number }
export interface BranchTarget { blockId: string; caseId: string }
export interface BranchRect extends NodePosition, NodeSize, BranchTarget { resultNodeId: string }
export interface BranchResize extends BranchTarget { size: NodeSize }
export interface BranchLayout {
  frames: BranchRect[];
  positions: Record<string, NodePosition>;
  blocks: Record<string, NodePosition>;
}
export const BRANCH_PADDING = 24;
export const BRANCH_TITLE = 40;
export const BRANCH_CONTENT_TOP = BRANCH_TITLE + BRANCH_PADDING;
export const BRANCH_GAP = 32;

export const containsPoint = (rect: NodePosition & NodeSize, point: NodePosition) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

/** Full node sizes are measured by the view. Results never determine content bounds. */
export function layoutBranches(graph: PatchGraph, sizes: Record<string, NodeSize>, previous?: BranchLayout, resize?: BranchResize): BranchLayout {
  const positions = Object.fromEntries(graph.nodes.map((n) => [n.id, { ...n.position }]));
  const frames: BranchRect[] = []; const blocks: Record<string, NodePosition> = {};
  const retained = readCaseSizes(graph);
  const size = (id: string) => sizes[id] ?? { width: 180, height: 160 };
  for (const [blockId, block] of Object.entries(graph.control_flow ?? {})) {
    const origin = positions[blockId]; if (!origin) continue;
    blocks[blockId] = { ...origin };
    if (branchCollapsed(graph, blockId)) continue;
    let top = origin.y + size(blockId).height + BRANCH_PADDING;
    for (const item of block.cases) {
      if (!positions[item.result_node_id]) continue;
      const members = item.node_ids.filter((id) => id !== item.result_node_id && positions[id]);
      const old = previous?.frames.find((r) => r.blockId === blockId && r.caseId === item.id);
      const oldBlock = previous?.blocks[blockId];
      if (old && oldBlock) {
        // Contents already follow a moved block; this offset is only case reflow.
        const dy = top - old.y - (origin.y - oldBlock.y);
        for (const id of members) positions[id].y += dy;
      }
      // Normalize legacy/foreign positions as a group, retaining internal spacing.
      const dx = Math.max(0, origin.x + BRANCH_PADDING - Math.min(Infinity, ...members.map((id) => positions[id].x)));
      const dy = Math.max(0, top + BRANCH_CONTENT_TOP - Math.min(Infinity, ...members.map((id) => positions[id].y)));
      for (const id of members) positions[id] = { x: positions[id].x + dx, y: positions[id].y + dy };
      const resultSize = size(item.result_node_id);
      const minimumRight = Math.max(origin.x + Math.max(size(blockId).width, 240 + 2 * BRANCH_PADDING, resultSize.width + 2 * BRANCH_PADDING),
        ...members.map((id) => positions[id].x + size(id).width + BRANCH_PADDING));
      const contentBottom = Math.max(top + BRANCH_CONTENT_TOP + 160, ...members.map((id) => positions[id].y + size(id).height));
      // Only a result resize can lower the retained dimensions. Its position is
      // always an output of layout, never an input to the content bounding box.
      const requested = resize?.blockId === blockId && resize.caseId === item.id ? resize.size
        : retained[blockId]?.[item.id] ?? old ?? { width: 0, height: 0 };
      const right = Math.max(minimumRight, origin.x + requested.width);
      const bottom = Math.max(contentBottom + BRANCH_PADDING + resultSize.height + BRANCH_PADDING, top + requested.height);
      positions[item.result_node_id] = { x: right - BRANCH_PADDING - resultSize.width, y: bottom - BRANCH_PADDING - resultSize.height };
      frames.push({ blockId, caseId: item.id, resultNodeId: item.result_node_id, x: origin.x, y: top, width: right - origin.x, height: bottom - top });
      top = bottom + BRANCH_GAP;
    }
  }
  return { frames, positions, blocks };
}

export function applyNodePositions(graph: PatchGraph, positions: Record<string, NodePosition>): PatchGraph {
  return { ...graph, nodes: graph.nodes.map((n) => positions[n.id] ? { ...n, position: { ...positions[n.id] } } : n) };
}

/** Commit visible dimensions and managed positions together; retain hidden cases. */
export function applyBranchLayout(graph: PatchGraph, layout: BranchLayout): PatchGraph {
  const sizes = readCaseSizes(graph);
  for (const frame of layout.frames) (sizes[frame.blockId] ??= {})[frame.caseId] = { width: frame.width, height: frame.height };
  return { ...applyNodePositions(graph, layout.positions), ui_layout: writeCaseSizes(graph.ui_layout, sizes) };
}

/** Correct a newly dropped group without shifting existing destination members. */
export function clampNodesToBranch(graph: PatchGraph, selected: string[], frame: BranchRect): PatchGraph {
  const ids = new Set(selected); const nodes = graph.nodes.filter((n) => ids.has(n.id));
  const dx = Math.max(0, frame.x + BRANCH_PADDING - Math.min(Infinity, ...nodes.map((n) => n.position.x)));
  const dy = Math.max(0, frame.y + BRANCH_CONTENT_TOP - Math.min(Infinity, ...nodes.map((n) => n.position.y)));
  return applyNodePositions(graph, Object.fromEntries(nodes.map((n) => [n.id, { x: n.position.x + dx, y: n.position.y + dy }])));
}

/** One delta for the selection; owned nodes follow selected blocks exactly once. */
export function previewNodeDrag(graph: PatchGraph, selected: string[], delta: NodePosition, layout: BranchLayout, transfer: boolean): PatchGraph {
  const ids = new Set(selected); const owners = controlFlowOwners(graph);
  let { x, y } = delta;
  if (!transfer) for (const node of graph.nodes) {
    if (!ids.has(node.id)) continue;
    const owner = owners.get(node.id); if (!owner || ids.has(owner.blockId)) continue;
    const frame = layout.frames.find((r) => r.blockId === owner.blockId && r.caseId === owner.caseId);
    if (!frame) continue;
    x = Math.max(x, frame.x + BRANCH_PADDING - node.position.x);
    y = Math.max(y, frame.y + BRANCH_CONTENT_TOP - node.position.y);
  }
  for (const id of selected) graph.control_flow?.[id]?.cases.forEach((c) => c.node_ids.forEach((member) => ids.add(member)));
  return { ...graph, nodes: graph.nodes.map((n) => ids.has(n.id) ? { ...n, position: { x: n.position.x + x, y: n.position.y + y } } : n) };
}
