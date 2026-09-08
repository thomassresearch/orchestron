import { describe, expect, it } from "vitest";
import { addStereoBlock, audioPortName, audioPorts, convertDirectOutput, deleteAudioGraphItems, executeStereoCommand, groupStereoNodes, normalizeStereoChannelNames, projectAudioBlocks, reconcileAudioGraph, renameStereoBlock, repairStereoBlock, resolveStereoMembers } from "./audioBlocks";
import { audioTemplate } from "./audioTemplates";
import { readInputFormulaMap, writeInputFormulaMap } from "./graphFormula";
import { APP_COPY } from "./appUiCopy";
import { applyGraphSelectionDeletePlan, buildGraphSelectionDeletePlan } from "../appOrchestration";
import { stereoCatalogEntries } from "./stereoCatalog";
import { useAppStore } from "../store/useAppStore";
import { normalizePatch, normalizePersistedInstrumentTabs } from "../store/appStoreModel";
import { audioGraphDiagnostics } from "./audioRouting";
import type { AudioPortGroup, PatchGraph, PatchListItem } from "../types";
const labels = { input: "Stereo Input", output: "Stereo Output" };
const group = (graph: PatchGraph): AudioPortGroup => graph.audio_interface!.groups[graph.audio_interface!.groups.length - 1];
const deleteGroup = (graph: PatchGraph, id: string) => buildGraphSelectionDeletePlan(graph, { nodeIds: [], connections: [] }, [], APP_COPY.english, "english", [id]);

describe("stereo lifecycle", () => {
  it.each(["input", "output"] as const)("creates %s blocks at the drop position using only ordinary nodes", (direction) => {
    const next = executeStereoCommand(audioTemplate("empty").graph, { kind: "create", direction, position: { x: 110, y: 220 } });
    expect(next.nodes).toHaveLength(2);
    expect(next.nodes[0].position).toEqual({ x: 110, y: 220 });
    expect(next.connections).toEqual([]);
    expect(group(next).ports).toEqual(["left", "right"]);
    const display = projectAudioBlocks(next, labels, []);
    expect(display.graph.nodes).toHaveLength(1);
    expect(display.restore(display.graph)).toEqual(next);
  });
  it("deletes the template output and recreates its mapping and block", () => {
    const graph = audioTemplate("instrument").graph;
    const plan = deleteGroup(graph, "main-output");
    expect(plan.nodeIds).toEqual(["output-left", "output-right"]);
    expect(plan.connectionKeys).toHaveLength(2);
    expect(plan.groupIds).toEqual(["main-output"]);
    expect(plan.itemLabels.some((label) => label.includes("Exact channel mapping"))).toBe(true);
    const removed = applyGraphSelectionDeletePlan(graph, plan);
    expect(removed.audio_interface!.groups).toEqual([]);
    expect(removed.audio_interface!.mainOutput).toBeNull();
    const next = addStereoBlock(removed, "output");
    expect(group(next).ports).toEqual(["left", "right"]);
    expect(next.audio_interface!.role).toBe("instrument");
    expect(next.audio_interface!.guided).toBe(true);
    expect(projectAudioBlocks(next, labels, []).members.size).toBe(1);
  });
  it("cleans mapping metadata through projected deletion and store removal", () => {
    const graph = audioTemplate("instrument").graph;
    const projection = projectAudioBlocks(graph, labels, []);
    const removed = projection.restore({ ...projection.graph, nodes: projection.graph.nodes.filter((n) => !projection.members.has(n.id)) });
    expect(removed.audio_interface!.groups).toEqual([]);
    useAppStore.getState().setGraph(graph);
    useAppStore.getState().removeNode("output-left");
    const next = useAppStore.getState().currentPatch.graph;
    expect(next.audio_interface!.groups).toEqual([]);
    expect(next.nodes.some((n) => n.id === "output-right")).toBe(true);
  });
  it("removes formula targets and source references and previews them", () => {
    const graph = audioTemplate("effect").graph;
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { "output-left::asignal": { expression: "0.5 * in1", inputs: [{ token: "in1", from_node_id: "input-left", from_port_id: "asignal" }] } });
    const plan = deleteGroup(graph, "main-input");
    expect(plan.itemLabels.some((label) => label.includes("Remove input formula"))).toBe(true);
    const next = applyGraphSelectionDeletePlan(graph, plan);
    expect(readInputFormulaMap(next.ui_layout)).toEqual({});
    expect(next.audio_interface!.mainOutput).toBe("main-output");
  });
  it("connection-only deletion keeps the pair and mapping", () => {
    const graph = audioTemplate("instrument").graph;
    const next = deleteAudioGraphItems(graph, [], [graph.connections[graph.connections.length - 1]]);
    expect(next.nodes).toEqual(graph.nodes);
    expect(next.audio_interface).toEqual(graph.audio_interface);
  });
  it("allocates names against nodes and stale mappings across repeated deletions", () => {
    let graph = addStereoBlock(audioTemplate("empty").graph, "output");
    const first = group(graph).id;
    graph = addStereoBlock(graph, "output");
    expect(group(graph).ports).toEqual(["bus1.left", "bus1.right"]);
    graph = applyGraphSelectionDeletePlan(graph, deleteGroup(graph, first));
    graph = addStereoBlock(graph, "output");
    expect(group(graph).ports).toEqual(["left", "right"]);
    graph = addStereoBlock(graph, "output");
    expect(group(graph).ports).toEqual(["bus2.left", "bus2.right"]);
    graph.nodes = graph.nodes.filter((n) => !group(graph).ports.includes(String(n.params.sname)));
    expect(group(addStereoBlock(graph, "output")).ports).toEqual(["bus3.left", "bus3.right"]);
    expect(group(addStereoBlock(graph, "input")).ports).toEqual(["left", "right"]);
  });
  it("does not promote another group after deleting the main group", () => {
    const graph = addStereoBlock(audioTemplate("instrument").graph, "output");
    const next = applyGraphSelectionDeletePlan(graph, deleteGroup(graph, "main-output"));
    expect(next.audio_interface!.mainOutput).toBeNull();
    expect(next.audio_interface!.groups).toHaveLength(1);
  });
  it("catalog commands never persist pseudo opcodes", () => {
    useAppStore.getState().setGraph(audioTemplate("empty").graph);
    for (const spec of stereoCatalogEntries([], "english")) useAppStore.getState().addNodeFromOpcode(spec, { x: 25, y: 50 });
    const graph = useAppStore.getState().currentPatch.graph;
    expect(graph.nodes.map((n) => n.opcode)).toEqual(["inleta", "inleta", "outleta", "outleta"]);
    expect(graph.nodes[2].position).toEqual({ x: 25, y: 50 });
    expect(graph.audio_interface!.groups).toHaveLength(2);
  });
});

describe("legacy grouping, names and repair", () => {
  const legacyGraph = (direction: "input" | "output", grouped = false) => {
    const graph = audioTemplate("effect").graph;
    graph.audio_interface = grouped ? {
      ...graph.audio_interface!,
      groups: graph.audio_interface!.groups.filter((g) => g.direction === direction).map((g) => ({ ...g, ports: ["legacy_left", "legacy_right"] }))
    } : null;
    for (const side of ["left", "right"]) {
      graph.nodes.find((n) => n.id === `${direction}-${side}`)!.params.sname = `stale_${side}`;
      graph.nodes.push({ id: `name-${side}`, opcode: "const_s", params: { value: `legacy_${side}` }, position: { x: 100, y: 100 } });
      graph.connections.push({ from_node_id: `name-${side}`, from_port_id: "sout", to_node_id: `${direction}-${side}`, to_port_id: "sname" });
    }
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { "output-left::asignal": { expression: "0.5 * in1", inputs: [{ token: "in1", from_node_id: "input-left", from_port_id: "asignal" }] } });
    return graph;
  };
  it.each(["input", "output"] as const)("owns legacy %s names through grouping, editing, expansion and deletion", (direction) => {
    const graph = legacyGraph(direction);
    graph.nodes.push({ id: "unrelated", opcode: "const_s", params: { value: "keep_me" }, position: { x: 0, y: 0 } });
    const snapshot = JSON.stringify(graph);
    const next = groupStereoNodes(graph, direction, [`${direction}-left`, `${direction}-right`]);
    const mapping = group(next);
    expect(mapping.ports).toEqual(["legacy_left", "legacy_right"]);
    expect(next.nodes.filter((n) => n.opcode === "const_s").map((n) => n.id)).toEqual(["unrelated"]);
    expect(next.connections).toEqual(graph.connections.filter((c) => c.to_port_id !== "sname"));
    expect(next.ui_layout.input_formulas).toEqual(graph.ui_layout.input_formulas);
    for (const side of ["left", "right"]) {
      const original = graph.nodes.find((n) => n.id === `${direction}-${side}`)!;
      expect(next.nodes.find((n) => n.id === original.id)).toEqual({ ...original, params: { ...original.params, sname: `legacy_${side}` } });
    }
    expect(JSON.stringify(graph)).toBe(snapshot); // Cancelling the preview leaves the legacy graph intact.
    const projection = projectAudioBlocks(next, labels, []);
    expect(projection.members.size).toBe(1);
    const restored = projection.restore(projection.graph);
    expect({ ...restored, nodes: next.nodes }).toEqual(next);
    expect(restored.nodes).toEqual(expect.arrayContaining(next.nodes));
    expect(restored.nodes).toHaveLength(next.nodes.length);
    const blockId = `__audio_block_${mapping.id}`;
    const moved = projection.restore({ ...projection.graph, nodes: projection.graph.nodes.map((n) => n.id === blockId ? { ...n, position: { x: n.position.x + 50, y: n.position.y + 20 } } : n) });
    expect(audioPorts(moved, direction)).toEqual(mapping.ports);
    expect(moved.nodes.some((n) => n.id === "name-left")).toBe(false);
    const renamed = renameStereoBlock(moved, mapping.id, ["renamed_left", "legacy_right"]);
    expect(audioPorts(renamed, direction)).toEqual(["renamed_left", "legacy_right"]);
    expect(projectAudioBlocks(JSON.parse(JSON.stringify(renamed)), labels, []).members.size).toBe(1);
    const expanded = projectAudioBlocks({ ...renamed, ui_layout: { ...renamed.ui_layout, audio_blocks: { [mapping.id]: false } } }, labels, []);
    expect(expanded.graph.nodes).toEqual(renamed.nodes);
    expect(expanded.restore(expanded.graph)).toEqual(expanded.graph);
    const removed = applyGraphSelectionDeletePlan(renamed, deleteGroup(renamed, mapping.id));
    expect(removed.nodes.some((n) => n.id.startsWith(`${direction}-`))).toBe(false);
    expect(removed.audio_interface!.groups).toEqual([]);
    const survivor = deleteAudioGraphItems(renamed, [`${direction}-left`]);
    expect(survivor.audio_interface!.groups).toEqual([]);
    expect(audioPortName(survivor, survivor.nodes.find((n) => n.id === `${direction}-right`)!)).toBe("legacy_right");
  });
  it.each(["input", "output"] as const)("normalizes previously saved %s groups on load and workspace restore", (direction) => {
    const graph = legacyGraph(direction, true);
    const snapshot = JSON.stringify(graph);
    const patch = { ...audioTemplate("effect"), graph };
    const loaded = normalizePatch(patch);
    const restored = normalizePersistedInstrumentTabs([{ id: "legacy-tab", patch }]);
    expect(restored[0].patch.graph).toEqual(loaded.graph);
    expect(loaded.graph.nodes.some((n) => n.opcode === "const_s")).toBe(false);
    expect(loaded.graph.audio_interface).toEqual(graph.audio_interface);
    expect(loaded.graph.ui_layout).toEqual(graph.ui_layout);
    expect(normalizeStereoChannelNames(loaded.graph)).toBe(loaded.graph);
    expect(projectAudioBlocks(loaded.graph, labels, []).members.size).toBe(1);
    useAppStore.setState({ currentPatch: normalizePatch(audioTemplate("empty")) });
    useAppStore.getState().setGraph(graph);
    expect(useAppStore.getState().currentPatch.graph).toEqual(loaded.graph);
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
  it("detaches shared naming constants while preserving other consumers", () => {
    const graph = audioTemplate("effect").graph;
    graph.audio_interface = null;
    graph.nodes.push({ id: "name", opcode: "const_s", params: { value: "left" }, position: { x: 0, y: 0 } });
    graph.connections.push(...["input-left", "output-left"].map((id) => ({ from_node_id: "name", from_port_id: "sout", to_node_id: id, to_port_id: "sname" })));
    const next = groupStereoNodes(graph, "output", ["output-left", "output-right"]);
    expect(next.nodes).toEqual(graph.nodes);
    expect(next.connections).toEqual(graph.connections.filter((c) => !(c.to_node_id === "output-left" && c.to_port_id === "sname")));
    const deleted = deleteAudioGraphItems(next, ["name"]);
    expect(resolveStereoMembers(deleted, group(deleted)).issue).toBeUndefined();
    expect(projectAudioBlocks(deleted, labels, []).members.size).toBe(1);
    const renamed = renameStereoBlock(next, group(next).id, ["dryL", "dryR"]);
    expect(audioPorts(renamed, "output")).toEqual(["dryL", "dryR"]);
    expect(renamed.nodes.find((n) => n.id === "name")!.params.value).toBe("left");
    expect(renamed.connections.some((c) => c.to_node_id === "input-left" && c.from_node_id === "name")).toBe(true);
    expect(renamed.connections.some((c) => c.to_node_id === "output-left" && c.to_port_id === "sname")).toBe(false);
    expect(graph.nodes.find((n) => n.id === "output-left")!.params.sname).toBe("left");
    const both = groupStereoNodes(next, "input", ["input-left", "input-right"]);
    expect(both.nodes.some((n) => n.id === "name")).toBe(false);
    expect(projectAudioBlocks(both, labels, []).members.size).toBe(2);
  });
  it("keeps constants referenced only by formulas", () => {
    const graph = legacyGraph("output");
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { "output-left::asignal": { expression: "in1", inputs: [{ token: "in1", from_node_id: "name-left", from_port_id: "sout" }] } });
    const next = groupStereoNodes(graph, "output", ["output-left", "output-right"]);
    expect(next.nodes.some((n) => n.id === "name-left")).toBe(true);
    expect(next.nodes.some((n) => n.id === "name-right")).toBe(false);
    expect(next.ui_layout.input_formulas).toEqual(graph.ui_layout.input_formulas);
  });
  it.each(["rename", "repair"] as const)("internalizes legacy names during %s", (operation) => {
    const graph = legacyGraph("output", true);
    const next = operation === "rename" ? renameStereoBlock(graph, "main-output", ["renamed_left", "legacy_right"]) : repairStereoBlock(graph, "main-output");
    expect(next.nodes.some((n) => n.opcode === "const_s")).toBe(false);
    expect(resolveStereoMembers(next, group(next)).issue).toBeUndefined();
  });
  it("leaves ungrouped, ambiguous and unresolved legacy names untouched", () => {
    const graph = legacyGraph("output");
    expect(normalizeStereoChannelNames(graph)).toBe(graph);
    graph.audio_interface = legacyGraph("output", true).audio_interface;
    graph.nodes.push({ ...graph.nodes.find((n) => n.id === "output-left")!, id: "duplicate", params: { sname: "legacy_left" } });
    expect(normalizeStereoChannelNames(graph)).toBe(graph);
    graph.nodes.pop();
    const link = graph.connections.find((c) => c.to_port_id === "sname")!;
    link.from_port_id = "invalid";
    expect(normalizeStereoChannelNames(graph)).toBe(graph);
    expect(() => groupStereoNodes(graph, "output", ["output-left", "output-right"], "main-output")).toThrow("dynamicMembers");
    link.from_port_id = "sout";
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { "name-left::value": { expression: "in1", inputs: [{ token: "in1", from_node_id: "name-right", from_port_id: "sout" }] } });
    expect(normalizeStereoChannelNames(graph)).toBe(graph);
    expect(() => groupStereoNodes(graph, "output", ["output-left", "output-right"], "main-output")).toThrow("dynamicMembers");
  });
  it("rejects duplicate, empty, reserved and colliding names without mutating the graph", () => {
    const graph = addStereoBlock(audioTemplate("instrument").graph, "output");
    const snapshot = JSON.stringify(graph);
    for (const names of [["same", "same"], ["", "other"], ["bus1.left", "other"], ["$direct.left", "other"]]) expect(() => renameStereoBlock(graph, "main-output", names as [string, string])).toThrow();
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
  it("reports ambiguous, overlapping and dynamically named members", () => {
    const graph = audioTemplate("instrument").graph;
    graph.nodes.push({ ...graph.nodes.find((n) => n.id === "output-left")!, id: "duplicate" });
    expect(resolveStereoMembers(graph, group(graph)).issue).toBe("ambiguousMembers");
    graph.nodes.pop();
    graph.audio_interface!.groups.push({ ...group(graph), id: "overlap" });
    expect(resolveStereoMembers(graph, group(graph)).issue).toBe("overlappingMembers");
    graph.audio_interface!.groups.pop();
    graph.connections.push({ from_node_id: "oscillator", from_port_id: "asig", to_node_id: "output-left", to_port_id: "sname" });
    expect(audioPortName(graph, graph.nodes.find((n) => n.id === "output-left")!)).toBeNull();
    expect(resolveStereoMembers(graph, group(graph)).issue).toBe("dynamicMembers");
    expect(projectAudioBlocks(graph, labels, []).members.size).toBe(0);
  });
  it("keeps stale mappings on load and explicitly repairs only missing members", () => {
    const graph = audioTemplate("instrument").graph;
    graph.nodes = graph.nodes.filter((n) => n.id !== "output-left");
    graph.connections = graph.connections.filter((c) => c.to_node_id !== "output-left");
    expect(reconcileAudioGraph(graph, structuredClone(graph)).audio_interface).toEqual(graph.audio_interface);
    const repaired = repairStereoBlock(graph, "main-output");
    expect(repaired.nodes.filter((n) => n.opcode === "outleta")).toHaveLength(2);
    expect(repaired.nodes.some((n) => n.id === "output-right")).toBe(true);
    expect(repaired.connections).toEqual(graph.connections);
    expect(resolveStereoMembers(repaired, group(repaired)).issue).toBeUndefined();
    const removed = applyGraphSelectionDeletePlan(graph, deleteGroup(graph, "main-output"));
    expect(removed.nodes).toEqual(graph.nodes);
    expect(removed.audio_interface!.mainOutput).toBeNull();
  });
  it("repairs a stale mapping with a chosen existing pair and preserves the group id", () => {
    const graph = audioTemplate("instrument").graph;
    graph.audio_interface!.groups[0].ports = ["missingL", "missingR"];
    const next = groupStereoNodes(graph, "output", ["output-left", "output-right"], "main-output");
    expect(group(next).ports).toEqual(["left", "right"]);
    expect(next.audio_interface!.mainOutput).toBe("main-output");
    expect(() => groupStereoNodes(next, "output", ["output-left", "output-right"])).toThrow("overlappingMembers");
  });
  it("retains raw nodes when changing away from stereo", () => {
    const graph = audioTemplate("instrument").graph;
    graph.audio_interface!.groups[0].layout = "custom";
    const projection = projectAudioBlocks(graph, labels, []);
    expect(projection.members.size).toBe(0);
    expect(projection.graph.nodes).toEqual(graph.nodes);
  });
});

describe("direct output conversion", () => {
  it("preserves wires, literal inputs, formulas, metadata and persistence through the projection", () => {
    const graph = audioTemplate("output").graph;
    graph.nodes.find((n) => n.id === "output")!.params.right = 0.25;
    graph.ui_layout = writeInputFormulaMap(graph.ui_layout, { "output::left": { expression: "0.5 * in1", inputs: [{ token: "in1", from_node_id: "input-left", from_port_id: "asignal" }] } });
    const snapshot = JSON.stringify(graph);
    const next = convertDirectOutput(graph, "output");
    const pair = resolveStereoMembers(next, next.audio_interface!.groups.find((g) => g.id === "main-output")!).nodes;
    expect(pair[1].params.asignal).toBe(0.25);
    expect(next.connections.find((c) => c.from_node_id === "input-left")!.to_node_id).toBe(pair[0].id);
    expect(readInputFormulaMap(next.ui_layout)[`${pair[0].id}::asignal`].expression).toBe("0.5 * in1");
    expect(readInputFormulaMap(next.ui_layout)["output::left"]).toBeUndefined();
    expect(next.audio_interface!.mainOutput).toBe("main-output");
    expect(next.audio_interface!.role).toBe("output");
    expect(next.audio_interface!.groups).toHaveLength(2);
    expect(next.audio_interface!.groups.find((g) => g.id === "main-output")!.name).toBe("Stereo Output");
    expect(JSON.stringify(graph)).toBe(snapshot); // Cancelling a preview is a no-op.
    const projected = projectAudioBlocks(next, labels, []);
    expect(projected.restore(projected.graph)).toEqual(next);
    expect(projectAudioBlocks(JSON.parse(JSON.stringify(next)), labels, []).members.size).toBe(2);
    useAppStore.getState().setGraph(graph);
    useAppStore.getState().setGraph(next);
    expect(useAppStore.getState().currentPatch.graph.audio_interface).toEqual(next.audio_interface);
  });
  it("leaves missing inputs unconnected and converts only the selected outs", () => {
    const graph = audioTemplate("output").graph;
    graph.connections = [];
    graph.nodes.push({ id: "other", opcode: "outs", params: {}, position: { x: 100, y: 100 } });
    const next = convertDirectOutput(graph, "output");
    expect(next.nodes.some((n) => n.id === "other" && n.opcode === "outs")).toBe(true);
    expect(next.nodes.some((n) => n.id === "output")).toBe(false);
    expect(next.connections).toEqual([]);
    expect(next.audio_interface!.groups.find((g) => g.id === "main-output")!.ports).toEqual(["$direct.left", "$direct.right"]);
  });
  it("preserves performance routes and diagnoses removed direct ports", () => {
    const route = { id: "route", sourceId: "instance", sourcePort: "$direct.left", targetId: "$output", targetPort: "left", kind: "main" as const, sourceStage: "strip" as const, targetStage: "input" as const };
    const routing = { routes: [route], masterId: null, insertOwners: {} };
    const graph = convertDirectOutput(audioTemplate("output").graph, "output");
    const patch: PatchListItem = { id: "patch", name: "Patch", description: "", schema_version: 1, is_template: false, always_on: false, updated_at: "", audio_inlet_names: audioPorts(graph, "input"), audio_outlet_names: audioPorts(graph, "output"), has_direct_output: false };
    expect(audioGraphDiagnostics([{ id: "instance", patchId: "patch", midiChannel: 1, level: 10, effectSourceIds: [], effectRoutes: [] }], [patch], routing).some((d) => d.code === "broken_route" && d.routeId === "route")).toBe(true);
    expect(routing.routes).toEqual([route]);
  });
});
