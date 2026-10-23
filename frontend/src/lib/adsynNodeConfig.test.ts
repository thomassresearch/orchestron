import { describe, expect, it } from "vitest";
import { audioTemplate } from "./audioTemplates";
import { addControlFlowBlock, moveNodesToCase, removeGraphNodes } from "./controlFlow";
import { getSfloadNodeConfig, setSfloadNodeConfig } from "./sfloadNodeConfig";
import { parseExportedPatchDefinition } from "./bundleImportExport";

const asset = { asset_id: "analysis", original_name: "tone.het", stored_name: "stored.het", content_type: "application/octet-stream", size_bytes: 520 };

describe("adsyn managed analysis configuration", () => {
  it("survives native export parsing and branch transfer, and is pruned on delete", () => {
    const patch = audioTemplate("empty");
    patch.graph = addControlFlowBlock(patch.graph, "switch");
    patch.graph.nodes.push({ id: "tone", opcode: "adsyn", params: {}, position: { x: 0, y: 0 } });
    patch.graph.ui_layout = setSfloadNodeConfig(patch.graph.ui_layout, "tone", { sampleAsset: asset, samplePath: "" }, "adsyn_nodes");
    const [blockId, block] = Object.entries(patch.graph.control_flow!)[0];
    const moved = moveNodesToCase(patch.graph, ["tone"], { blockId, caseId: block.cases[0].id });
    expect(getSfloadNodeConfig(moved.ui_layout, "tone", "adsyn_nodes").sampleAsset).toEqual(asset);
    const imported = parseExportedPatchDefinition(JSON.parse(JSON.stringify({ ...patch, graph: moved, schema_version: 2, sourcePatchId: "source" })))!;
    expect(imported.graph.ui_layout.adsyn_nodes).toEqual(moved.ui_layout.adsyn_nodes);
    const deleted = removeGraphNodes(moved, new Set(["tone"]));
    expect(getSfloadNodeConfig(deleted.ui_layout, "tone", "adsyn_nodes").sampleAsset).toBeNull();
  });
  it("keeps SoundFont and analysis selections independent", () => {
    let layout = setSfloadNodeConfig({}, "tone", { sampleAsset: asset, samplePath: "" }, "adsyn_nodes");
    layout = setSfloadNodeConfig(layout, "sf", { sampleAsset: { ...asset, stored_name: "bank.sf2" }, samplePath: "" });
    expect(getSfloadNodeConfig(layout, "tone", "adsyn_nodes").sampleAsset?.stored_name).toBe("stored.het");
    expect(getSfloadNodeConfig(layout, "sf").sampleAsset?.stored_name).toBe("bank.sf2");
  });
});
