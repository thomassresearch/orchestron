// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fm6VoiceEditor } from "./Fm6VoiceEditor";
import { fm6Copy } from "../lib/fm6Copy";
import { FM6 } from "../lib/fm6";
import type { NodeInstance } from "../types";

afterEach(cleanup);
const node: NodeInstance = { id: "fm", opcode: "fm6_voice", params: { ipreset: 1, op1_ratio: 7, ibrightness: 83 }, position: { x: 0, y: 0 } };
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const branch = (from: number, to: number) => screen.getByRole("slider", { name: `Branch weight · Operator ${from} → Operator ${to}` });

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
    const arrow = screen.getByRole("slider", { name: `${copy.branchWeight} · ${copy.operator} 2 → ${copy.operator} 1` });
    expect(arrow.querySelector("text")!.textContent?.replace(/\s/g, "")).toBe(language === "english" ? "22.0%" : "22,0%");
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
  it("moves the tuning markers and their exact readouts with each slider input", () => {
    render(<Fm6VoiceEditor node={node} language="english" drivenInputs={{}} onChange={vi.fn()} onClose={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "Operator 2 Modulator" });
    const other = screen.getByRole("button", { name: "Operator 1 Carrier" });
    const copy = fm6Copy("english");
    const markerX = (box: HTMLElement, title: string) => {
      const scale = within(box).getByText(title, { selector: "title" }).parentElement!;
      return Number(scale.querySelector("circle")!.getAttribute("cx"));
    };
    const others = () => [markerX(other, copy.ratioScale), markerX(other, copy.detuneScale)];
    const originalOthers = others();
    fireEvent.click(tile);
    const slide = (label: string, value: number) =>
      fireEvent.input(screen.getByRole("slider", { name: name => name.startsWith(label) }), { target: { value: String(value) } });
    const ratio = (value: number) => {
      slide(copy.ratio, value);
      expect(within(tile).getByText(`${value}×`, { selector: "text" })).toBeTruthy();
      return markerX(tile, copy.ratioScale);
    };
    const min = ratio(.25), max = ratio(32), octave = (max - min) / 7;
    expect(octave).toBeGreaterThan(0);
    expect(ratio(1)).toBeCloseTo(min + 2 * octave);
    expect(ratio(3)).toBeCloseTo(min + Math.log2(3 / .25) * octave);
    const ratioAtThree = markerX(tile, copy.ratioScale);
    const detune = (value: number) => {
      slide(copy.detune, value);
      expect(within(tile).getByText(`${value > 0 ? "+" : ""}${value} ¢`, { selector: "text" })).toBeTruthy();
      return markerX(tile, copy.detuneScale);
    };
    const flat = detune(-100), center = detune(0), sharp = detune(100);
    expect(sharp).toBeGreaterThan(flat);
    expect(center).toBeCloseTo((flat + sharp) / 2);
    expect(detune(-10)).toBeCloseTo((flat + center) / 2);
    expect(detune(10)).toBeCloseTo((sharp + center) / 2);
    expect(detune(6)).toBeCloseTo(center + .3 * (sharp - center));
    expect(detune(-55)).toBeCloseTo(center - .75 * (sharp - center));
    expect(markerX(tile, copy.ratioScale)).toBe(ratioAtThree);
    expect(others()).toEqual(originalOthers);
  });
  it("redraws the edited operator's envelope during slider and numeric input", () => {
    render(<Fm6VoiceEditor node={node} language="english" drivenInputs={{}} onChange={vi.fn()} onClose={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "Operator 2 Modulator" });
    const other = screen.getByRole("button", { name: "Operator 1 Carrier" }).querySelector("polyline")!;
    const originalOther = other.getAttribute("points");
    const points = () => tile.querySelector("polyline")!.getAttribute("points")!.split(" ").map(p => p.split(",").map(Number));
    const slideTime = (label: RegExp, seconds: number) => fireEvent.input(screen.getByRole("slider", { name: label }),
      { target: { value: String(Math.log(seconds)) } });
    fireEvent.click(tile);
    const initial = points();
    slideTime(/^Attack \(s\)/, .05);
    const attack = points();
    expect(attack[1][0]).toBeGreaterThan(initial[1][0] + 3);
    slideTime(/^Decay/, 4);
    const decay = points();
    expect(decay[1]).toEqual(attack[1]);
    expect(decay[2][0]).toBeGreaterThan(attack[2][0]);
    fireEvent.change(screen.getByLabelText("Sustain (%)"), { target: { value: "75" } });
    expect(points()[2]).toEqual([decay[2][0], 5]);
    expect(points()[3]).toEqual([decay[3][0], 5]);
    fireEvent.input(screen.getByRole("slider", { name: /^Sustain/ }), { target: { value: "0" } });
    const silentTail = points();
    slideTime(/^Release \(s\)/, 6);
    expect(points().slice(0, 4)).toEqual(silentTail.slice(0, 4));
    expect(points()[4][0]).toBeGreaterThan(silentTail[4][0]);
    expect(points()[4][1]).toBe(20);
    expect(other.getAttribute("points")).toBe(originalOther);
  });
  it("shows each source level on all of its outgoing connections as it is edited", () => {
    render(<Fm6VoiceEditor node={node} language="english" drivenInputs={{}} onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Algorithm"), { target: { value: "6" } });
    const route = (from: number, to: number) => branch(from, to).querySelector("path[marker-end]")!;
    const branches = [1, 2, 3, 4].map(op => route(5, op));
    const width = (path: Element) => Number(path.getAttribute("stroke-width"));
    const incoming = route(6, 5), output = screen.getByText(/^Operator 1 → Dry output ·/, { selector: "path > title" }).parentElement!;
    const incomingWidth = width(incoming), outputWidth = width(output);
    fireEvent.click(screen.getByRole("button", { name: "Operator 5 Modulator" }));
    const slide = (level: number) => fireEvent.input(screen.getByRole("slider", { name: /^Level/ }), { target: { value: String(level) } });
    slide(10);
    const quiet = width(branches[0]);
    slide(85);
    const loud = width(branches[0]);
    expect(loud).toBeGreaterThan(quiet);
    expect(branches.map(width)).toEqual([loud, loud, loud, loud]);
    expect(width(incoming)).toBe(incomingWidth);
    expect(width(output)).toBe(outputWidth);
    fireEvent.click(screen.getByLabelText("Enabled"));
    expect(branches.every(p => width(p) < quiet && p.hasAttribute("stroke-dasharray"))).toBe(true);
    fireEvent.click(screen.getByLabelText("Enabled"));
    expect(branches.map(width)).toEqual([loud, loud, loud, loud]);
    fireEvent.click(screen.getByRole("button", { name: "Operator 1 Carrier" }));
    slide(0);
    expect(output.hasAttribute("stroke-dasharray")).toBe(true);
    slide(85);
    expect(width(output)).toBe(loud);
    expect(output.hasAttribute("stroke-dasharray")).toBe(false);
    expect(width(incoming)).toBe(incomingWidth);
  });
  it("drags a single branch from a preset, preserves its weight across algorithms and restores the opening patch", () => {
    const onChange = vi.fn(), original = { ...node, params: { ipreset: 12, weight_5_1: .25 } };
    render(<Fm6VoiceEditor node={original} language="english" drivenInputs={{}} onChange={onChange} onClose={vi.fn()} />);
    const sourceLevel = FM6.presets[11].voice.op5_level;
    const route = branch(5, 1);
    expect(route.getAttribute("aria-valuenow")).toBe("1");
    Object.assign(route, { setPointerCapture: vi.fn() });
    fireEvent.pointerDown(route, { pointerId: 1, button: 0, clientY: 100 });
    expect(value("Branch weight")).toBe("1");
    fireEvent.pointerMove(route, { pointerId: 1, clientY: 180 });
    expect(value("Branch weight")).toBe("0.5");
    expect(route.querySelector("text")!.textContent).toBe(`${(sourceLevel * .5).toFixed(1)}%`);
    expect(branch(5, 2).getAttribute("aria-valuenow")).toBe("1");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ipreset: 0, weight_5_1: .5 }));
    fireEvent.pointerMove(route, { pointerId: 1, clientY: 500 });
    expect(value("Branch weight")).toBe("0");
    fireEvent.lostPointerCapture(route);
    fireEvent.keyDown(route, { key: "ArrowUp" });
    expect(value("Branch weight")).toBe("0.01");
    fireEvent.change(screen.getByLabelText("Branch weight", { selector: "input" }), { target: { value: ".373" } });
    expect(route.querySelector("text")!.textContent).toBe("5.2%");
    fireEvent.change(screen.getByLabelText("Algorithm"), { target: { value: "8" } });
    expect(screen.queryByRole("slider", { name: /^Branch weight/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Algorithm"), { target: { value: "6" } });
    expect(branch(5, 1).getAttribute("aria-valuenow")).toBe("0.373");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).toHaveBeenLastCalledWith(original.params);
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
    if (exit === "Escape") fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    else if (exit === "backdrop") fireEvent.mouseDown(screen.getByRole("dialog"));
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
