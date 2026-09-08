import type { Connection, PatchGraph } from "../types";

export interface GraphSelection { nodeIds: string[]; connections: Connection[] }
export interface GraphViewport { x: number; y: number; k: number }
export interface GraphEditorState { selection?: GraphSelection; viewport?: GraphViewport }

export function writeGraphEditorState(layout: PatchGraph["ui_layout"], state: GraphEditorState): PatchGraph["ui_layout"] {
  return { ...layout, editor_state: {
    ...(state.selection ? { selection: { nodeIds: state.selection.nodeIds, connections: state.selection.connections.map((c) => ({ ...c })) } } : {}),
    ...(state.viewport ? { viewport: { ...state.viewport } } : {})
  } };
}

/** Presentation data is optional; ignore malformed data from older/external files. */
export function readGraphEditorState(layout: PatchGraph["ui_layout"]): GraphEditorState {
  const raw = layout.editor_state as GraphEditorState | undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const { selection, viewport } = raw;
  return {
    ...(viewport && [viewport.x, viewport.y, viewport.k].every(Number.isFinite) && viewport.k > 0 ? { viewport } : {}),
    ...(selection && Array.isArray(selection.nodeIds) && selection.nodeIds.every((id) => typeof id === "string") &&
      Array.isArray(selection.connections) && selection.connections.every((c) => c &&
        [c.from_node_id, c.from_port_id, c.to_node_id, c.to_port_id].every((id) => typeof id === "string")) ? { selection } : {})
  };
}
