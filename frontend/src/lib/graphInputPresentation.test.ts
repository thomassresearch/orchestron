import { expect, it } from "vitest";
import { inputFormulasByNode, nodeInputPresentation } from "./graphInputPresentation";
import { readInputFormulaMap } from "./graphFormula";
import type { PatchGraph } from "../types";

it("retains presentation values and formula order while ignoring invalid formulas", () => {
  const nodes = ["one", "one::nested", "two", "empty"].map(id => ({ id, opcode: "test", params: { value: 1 }, position: { x: 0, y: 0 } }));
  const layout = { input_formulas: {
    "one::b": { expression: "x1", inputs: [{ token: "x1", from_node_id: "two", from_port_id: "out" }] },
    "two::a": { expression: "2", inputs: [] }, "one::a": { expression: "3", inputs: [] },
    "one::nested::in": { expression: "4", inputs: [] },
    "one::bad": { expression: 3, inputs: [] }, invalid: { expression: "4", inputs: [] }
  } };
  const formulas = readInputFormulaMap(layout);
  const expected = new Map(nodes.map(node => [node.id, JSON.stringify([node.params,
    Object.entries(formulas).filter(([key]) => key.startsWith(`${node.id}::`))])]));
  expect(nodeInputPresentation(nodes, inputFormulasByNode(layout))).toEqual(expected);
  expect(nodeInputPresentation(nodes, inputFormulasByNode({})).get("one")).toBe(JSON.stringify([{ value: 1 }, []]));
});

it.each([100, 300, 600])("validates each formula once for %s nodes", count => {
  let reads = 0;
  const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, opcode: "test", params: {}, position: { x: 0, y: 0 } }));
  const input_formulas = Object.fromEntries(nodes.map(node => [`${node.id}::in`, {
    get expression() { reads++; return "1"; }, inputs: []
  }]));
  const indexed = inputFormulasByNode({ input_formulas });
  // Validation reads each expression twice, independent of the number of nodes.
  expect(reads).toBe(count * 2);
  const presentation = nodeInputPresentation(nodes, indexed);
  const moved: PatchGraph["nodes"] = nodes.map(node => ({ ...node, position: { x: 100, y: 200 } }));
  expect(nodeInputPresentation(moved, indexed)).toEqual(presentation);
  expect(reads).toBe(count * 2);
  const edited = nodes.map((node, index) => index ? node : { ...node, params: { value: 2 } });
  const changed = nodeInputPresentation(edited, indexed);
  expect([...changed].filter(([id, value]) => presentation.get(id) !== value).map(([id]) => id)).toEqual(["n0"]);
});
