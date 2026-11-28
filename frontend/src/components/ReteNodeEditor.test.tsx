// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReteNodeEditor } from "./ReteNodeEditor";
import { AudioGraphEditor } from "./AudioGraphEditor";
import type { OpcodeSpec, PatchGraph } from "../types";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the original graph order when choosing a DX7 preset beside a collapsed stereo output", async () => {
  const { default: fixture } = await import("../../../backend/tests/fixtures/patches/dx7.patch.json");
  const { default: catalog } = await import("../../../backend/app/data/opcodes.json");
  const graph = structuredClone(fixture.graph) as unknown as PatchGraph;
  graph.nodes.push({ id: "polyphony", opcode: "maxalloc", params: { icount: 16 }, position: { x: 40, y: 330 } });
  const change = vi.fn();
  const selection = vi.fn();
  render(<AudioGraphEditor graph={graph} opcodes={catalog as unknown as OpcodeSpec[]} guiLanguage="english"
    viewportKey="dx7-stereo" onGraphChange={change} onSelectionChange={selection} onDeleteAudioGroup={vi.fn()} />);
  await waitFor(() => expect(selection).toHaveBeenCalled(), { timeout: 3000 });
  fireEvent.click(await screen.findByRole("button", { name: "Edit DX7 voice" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Preset" }), { target: { value: "1" } });
  const next: PatchGraph = change.mock.lastCall![0];
  const params = next.nodes.find(n => n.opcode === "fm_dx7")!.params;
  expect(params.custom_voice).toBeTruthy();
  expect(params.voice).not.toBe(params.custom_voice);
  expect(next).toEqual({ ...graph, nodes: graph.nodes.map(n => n.opcode === "fm_dx7" ? { ...n, params } : n) });
});

it("refreshes changed formulas without replacing unrelated nodes or resetting focus", async () => {
  const opcodes = [
    { name: "const_i", category: "constants", inputs: [], outputs: [] },
    { name: "test", category: "math", inputs: [{ id: "in", name: "Input", signal_type: "i", required: false, default: 1 }], outputs: [] }
  ] as unknown as OpcodeSpec[];
  const graph: PatchGraph = {
    nodes: [
      { id: "constant", opcode: "const_i", params: { value: "1" }, position: { x: 0, y: 0 } },
      { id: "target", opcode: "test", params: {}, position: { x: 400, y: 0 } }
    ], connections: [], ui_layout: { input_formulas: { "target::in": { expression: "2", inputs: [] } } },
    engine_config: { sr: 48000, control_rate: 1500, ksmps: 32, nchnls: 2, software_buffer: 128, hardware_buffer: 512, "0dbfs": 1 }
  };
  const selection = vi.fn(), change = vi.fn();
  const editor = (value: PatchGraph) => <ReteNodeEditor graph={value} opcodes={opcodes} viewportKey="formula-test"
    guiLanguage="english" onGraphChange={change} onSelectionChange={selection} />;
  const view = render(editor(graph));
  await waitFor(() => expect(selection).toHaveBeenCalled());
  const input = await screen.findByRole("textbox");
  const socket = await screen.findByTitle(/^Saved formula: 2/);
  input.focus();
  const selectionCalls = selection.mock.calls.length;
  const moved = { ...graph, nodes: graph.nodes.map(node => ({ ...node, position: { x: node.position.x + 100, y: 50 } })) };
  view.rerender(editor(moved));
  await waitFor(() => expect(screen.getByTitle(/^Saved formula: 2/)).toBe(socket));
  view.rerender(editor({ ...moved, ui_layout: { input_formulas: { "target::in": { expression: "3", inputs: [] } } } }));
  await screen.findByTitle(/^Saved formula: 3/);
  expect(screen.getByRole("textbox")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(selection).toHaveBeenCalledTimes(selectionCalls);
});

it.each(["const_i", "const_k", "const_a", "const_s", "zfilter2"])("keeps the %s input focused across graph updates", async opcode => {
  const parameter = opcode === "zfilter2" ? "icoeffs" : "value";
  const changes = vi.fn();
  const selection = vi.fn();
  const opcodes = [{ name: opcode, category: "constants", inputs: [], outputs: [] }] as unknown as OpcodeSpec[];
  function Harness() {
    const [graph, setGraph] = useState<PatchGraph>({ nodes: [{ id: "constant", opcode, params: { [parameter]: "0" }, position: { x: 0, y: 0 } }], connections: [], ui_layout: {}, engine_config: { sr: 48000, control_rate: 1500, ksmps: 32, nchnls: 2, software_buffer: 128, hardware_buffer: 512, "0dbfs": 1 } });
    // The store callback is stable, as it is in the instrument editor.
    const onChange = useState(() => (next: PatchGraph) => { changes(next); setGraph(next); })[0];
    return <ReteNodeEditor graph={graph} opcodes={opcodes} viewportKey="test" guiLanguage="english"
      onGraphChange={onChange} onSelectionChange={selection} />;
  }
  render(<Harness />);
  await waitFor(() => expect(selection).toHaveBeenCalled());
  const input = await screen.findByRole("textbox") as HTMLInputElement;
  input.focus();
  const drafts = opcode === "const_s" ? ["a", "ab", "abc"] : opcode === "zfilter2" ? ["1", "1,", "1, .", "1, .5"] : [".", ".2", ".25"];
  for (const value of drafts) {
    await act(async () => { fireEvent.change(input, { target: { value } }); });
    await waitFor(() => expect(changes.mock.lastCall?.[0].nodes[0].params[parameter]).toBe(value));
    expect(screen.getByRole("textbox")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(value);
  }
});

it("opens FM6, preserves formulas and connections, and keeps connected controls visible when collapsed", async () => {
  const { default: catalog } = await import("../../../backend/app/data/opcodes.json");
  const opcodes = catalog.filter(s => ["fm6_voice", "const_i"].includes(s.name)) as unknown as OpcodeSpec[];
  const change = vi.fn(), selection = vi.fn();
  const graph: PatchGraph = {
    nodes: [{ id: "fm", opcode: "fm6_voice", params: { ipreset: 1 }, position: { x: 300, y: 0 } },
      { id: "control", opcode: "const_i", params: { value: 100 }, position: { x: 0, y: 0 } }],
    connections: [{ from_node_id: "control", from_port_id: "iout", to_node_id: "fm", to_port_id: "ibrightness" }],
    ui_layout: { input_formulas: { "fm::ibrightness": { expression: "in1 / 2", inputs: [{ token: "in1", from_node_id: "control", from_port_id: "iout" }] } } },
    engine_config: { sr: 48000, control_rate: 1500, ksmps: 32, nchnls: 2, software_buffer: 128, hardware_buffer: 512, "0dbfs": 1 }
  };
  render(<ReteNodeEditor graph={graph} opcodes={opcodes} viewportKey="fm6-test" guiLanguage="english" onGraphChange={change} onSelectionChange={selection} />);
  const edit = await screen.findByRole("button", { name: "Edit FM6 voice" });
  expect(await screen.findByTitle(/^Saved formula: in1 \/ 2/)).toBeTruthy();
  expect(screen.queryByText("Vibrato rate")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "+ Performance inputs" }));
  expect(await screen.findByText("Vibrato rate")).toBeTruthy();
  fireEvent.click(edit);
  await screen.findByRole("dialog", { name: "FM6 Voice Editor" });
  fireEvent.click(screen.getByRole("button", { name: "Operator 1 Carrier" }));
  fireEvent.change(screen.getByLabelText("Ratio ×"), { target: { value: "2.25" } });
  expect(change.mock.lastCall?.[0].nodes[0].params).toMatchObject({ ipreset: 0, op1_ratio: 2.25 });
  expect(change.mock.lastCall?.[0].connections).toEqual(graph.connections);
  expect(change.mock.lastCall?.[0].ui_layout).toEqual(graph.ui_layout);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(change.mock.lastCall?.[0].nodes[0].params).toEqual({ ipreset: 1 });
});
