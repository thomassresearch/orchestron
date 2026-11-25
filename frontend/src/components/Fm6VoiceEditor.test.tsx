// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fm6VoiceEditor } from "./Fm6VoiceEditor";
import { fm6Copy } from "../lib/fm6Copy";
import { FM6 } from "../lib/fm6";
import type { NodeInstance } from "../types";

afterEach(cleanup);
const node: NodeInstance = { id: "fm", opcode: "fm6_voice", params: { ipreset: 1, op1_ratio: 7, ibrightness: 83 }, position: { x: 0, y: 0 } };
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe("FM6 voice editor", () => {
  it("offers all 32 presets and copies a browsed effects voice into Custom", () => {
    const onChange = vi.fn();
    render(<Fm6VoiceEditor node={node} language="english" drivenInputs={{}} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Operator 1 Carrier" }));
    const selector = screen.getByLabelText("Preset") as HTMLSelectElement;
    expect(selector.options).toHaveLength(33);
    expect(selector.options[13].text).toBe("13 · Solid Sub Bass");
    expect(selector.options[24].text).toBe("24 · Space Chime");
    expect(selector.options[25].text).toBe("25 · Crosswind");
    expect(selector.options[32].text).toBe("32 · Alien Transmission");
    for (const id of [13, 20, 24, 25, 28, 32]) {
      fireEvent.change(selector, { target: { value: String(id) } });
      expect(value("Algorithm")).toBe(String(FM6.presets[id - 1].voice.algorithm));
      expect(value("Level (%)")).toBe(String(FM6.presets[id - 1].voice.op1_level));
    }
    fireEvent.change(screen.getByLabelText("Ratio ×"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ...FM6.presets[31].voice, ipreset: 0, op1_ratio: 2 }));
  });
  it.each(["english", "german", "french", "spanish"] as const)("edits a preset as Custom with all six operators in %s", language => {
    const copy = fm6Copy(language), onChange = vi.fn();
    render(<Fm6VoiceEditor node={node} language={language} drivenInputs={{}} onChange={onChange} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: copy.title })).toBeTruthy();
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(6);
    expect(screen.queryByLabelText(copy.ratio)).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: `${copy.operator} 1 ${copy.carrier}` }), { key: "Enter" });
    fireEvent.change(screen.getByLabelText(copy.ratio), { target: { value: "2.5" } });
    expect(value(copy.preset)).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: copy.apply }));
    const saved = onChange.mock.calls[0][0];
    expect(saved).toMatchObject({ ...FM6.presets[0].voice, op1_ratio: 2.5, ipreset: 0, ibrightness: 83 });
    expect(node.params.op1_ratio).toBe(7);
  });
  it("preserves custom edits while browsing presets, changes roles, and copies operators", () => {
    render(<Fm6VoiceEditor node={node} language="english" drivenInputs={{}} onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Operator 1 Carrier" }));
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "0" } });
    expect(value("Ratio ×")).toBe("7");
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "0" } });
    expect(value("Ratio ×")).toBe("7");
    fireEvent.change(screen.getByLabelText("Algorithm"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Operator 6 Carrier" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste operator" }));
    expect(value("Ratio ×")).toBe("7");
    fireEvent.change(screen.getByLabelText("Algorithm"), { target: { value: "4" } });
    expect(screen.getByRole("button", { name: "Operator 6 Modulator" })).toBeTruthy();
  });
  it("blocks invalid input and allows cancellation without saving", () => {
    const onChange = vi.fn(), onClose = vi.fn();
    render(<Fm6VoiceEditor node={node} language="english" drivenInputs={{}} onChange={onChange} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Operator 1 Carrier" }));
    for (const invalid of ["", "0", "NaN", "Infinity", "11"]) {
      fireEvent.change(screen.getByLabelText("Attack (s)"), { target: { value: invalid } });
      expect((screen.getByRole("button", { name: "Apply to draft" }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(screen.getByLabelText("Attack (s)"), { target: { value: ".1" } });
    expect((screen.getByRole("button", { name: "Apply to draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onChange.mock.calls.map(call => call[0])).toEqual([expect.objectContaining({ op1_attack: .1, ipreset: 0 }), node.params]);
  });
  it.each(["Cancel", "Close", "Escape", "backdrop"])("rolls back live changes through %s after parent rerenders", exit => {
    const onChange = vi.fn(), onClose = vi.fn();
    const editor = (params: NodeInstance["params"]) => <Fm6VoiceEditor node={{ ...node, params }} language="english" drivenInputs={{}} onChange={onChange} onClose={onClose} />;
    const view = render(editor(node.params));
    fireEvent.change(screen.getByLabelText("Algorithm"), { target: { value: "8" } });
    view.rerender(editor(onChange.mock.calls[0][0]));
    const tile = screen.getByRole("button", { name: "Operator 6 Carrier" });
    fireEvent.click(tile);
    fireEvent.change(screen.getByRole("slider", { name: /Level/ }), { target: { value: "34" } });
    expect(tile.textContent).toContain("34%");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ algorithm: 8, op6_level: 34 }));
    if (exit === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else if (exit === "backdrop") fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    else fireEvent.click(screen.getByRole("button", { name: exit }));
    expect(onChange).toHaveBeenLastCalledWith(node.params);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("shows graph-driven controls without replacing their stored values", () => {
    const onChange = vi.fn();
    render(<Fm6VoiceEditor node={node} language="english" drivenInputs={{ ipreset: "preset controller", ibrightness: "brightness controller" }} onChange={onChange} onClose={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: "Brightness (%)" })).toBeNull();
    expect(screen.getByText(/Custom edits are heard/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
