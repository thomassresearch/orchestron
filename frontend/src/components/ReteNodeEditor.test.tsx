// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReteNodeEditor } from "./ReteNodeEditor";
import type { OpcodeSpec, PatchGraph } from "../types";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
