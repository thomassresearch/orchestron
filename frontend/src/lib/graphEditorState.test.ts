import { describe, expect, it } from "vitest";
import { readGraphEditorState, writeGraphEditorState } from "./graphEditorState";
import { audioTemplate } from "./audioTemplates";
import { normalizePersistedPatch } from "../store/appStoreModel";

describe("branch editor presentation", () => {
  it("round trips canonical selection and viewport with a saved patch", () => {
    const patch = audioTemplate("drumset");
    const selection = { nodeIds: [patch.graph.nodes[0].id], connections: [patch.graph.connections[0]] };
    const viewport = { x: -120, y: 50, k: .65 };
    patch.graph.ui_layout = writeGraphEditorState(patch.graph.ui_layout, { selection, viewport });
    const restored = normalizePersistedPatch(JSON.parse(JSON.stringify(patch)));
    expect(readGraphEditorState(restored!.graph.ui_layout)).toEqual({ selection, viewport });
  });
  it.each([null, [], { viewport: { x: 0, y: 0, k: -1 } }, { selection: { nodeIds: [null], connections: [] } },
    { selection: { nodeIds: [], connections: [null] } }])("ignores malformed optional presentation %j", (value) => {
    expect(readGraphEditorState(JSON.parse(JSON.stringify({ editor_state: value })))).toEqual({});
  });
});
