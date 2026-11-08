// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PerformanceControllerRack } from "./PerformanceControllerRack";
import { useAppStore } from "../../store/useAppStore";
import type { PatchListItem, SequencerInstrumentBinding } from "../../types";
const binding: SequencerInstrumentBinding = { id: "one", patchId: "patch", midiChannel: 3, level: 10, effectSourceIds: [], effectRoutes: [], performanceControllerMidiCCs: { gain: 21 } };
const patch = { id: "patch", performance_controllers: [
  { node_id: "gain", min: 0, max: 1, default: .5, scale: "linear", label: "Gain" },
  { node_id: "count", controller_type: "integer", min: 0, max: 4, default: 1, scale: "linear", label: "Count" },
  { node_id: "enabled", controller_type: "bool", min: 0, max: 1, default: 0, scale: "linear", label: "Enabled" }
] } as PatchListItem;
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("offers only Off and 1–50 without repeating the instrument channel", () => {
  const setCC = vi.spyOn(useAppStore.getState(), "setPerformanceControllerMidiCC");
  render(<PerformanceControllerRack binding={binding} patch={patch} language="english" />);
  const selectors = screen.getAllByRole("combobox");
  expect(selectors).toHaveLength(3);
  expect(selectors[0].querySelectorAll("option")).toHaveLength(51);
  expect((selectors[0] as HTMLSelectElement).value).toBe("21");
  expect(screen.queryByText("Channel 3")).toBeNull();
  fireEvent.change(selectors[1], { target: { value: "50" } });
  expect(setCC).toHaveBeenCalledWith("one", "count", 50);
  fireEvent.change(selectors[0], { target: { value: "" } });
  expect(setCC).toHaveBeenCalledWith("one", "gain", null);
});
it("disables assignments for continuous instruments", () => {
  render(<PerformanceControllerRack binding={{ ...binding, midiChannel: 0 }} patch={{ ...patch, always_on: true }} language="english" />);
  expect(screen.getAllByRole("combobox").every(element => (element as HTMLSelectElement).disabled)).toBe(true);
});

it("groups mixed controls by name within each instrument and preserves edits on resize", () => {
  const grouped = { ...patch, performance_controllers: patch.performance_controllers!.map((d, i) => ({ ...d, controller_group: i === 1 ? "" : "Tone" })) };
  const { rerender } = render(<PerformanceControllerRack binding={binding} patch={grouped} language="english" />);
  expect(screen.getByRole("group", { name: "Tone" }).querySelectorAll("[data-performance-controller]")).toHaveLength(2);
  const input = screen.getByRole("spinbutton", { name: "Gain · Performance controller" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "0.1234" } });
  input.focus();
  rerender(<PerformanceControllerRack binding={{ ...binding, performanceControllerValues: { gain: .8 } }} patch={grouped} language="english" />);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("0.1234");
});

it("equalizes slots across groups and releases space when an error hint disappears", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const bodyHeight = this.dataset.performanceController === "gain" ? 165 : 177;
    const height = this.hasAttribute("data-performance-controller") ? bodyHeight
      : this.hasAttribute("data-rack-controller-footer") ? (this.textContent?.includes("Invalid") ? 104 : 40) : 0;
    return { width: 1000, height, x: 0, y: 0, top: 0, bottom: height, left: 0, right: 1000, toJSON() {} };
  });
  const grouped = { ...patch, performance_controllers: patch.performance_controllers!.map(d => ({ ...d, controller_group: d.label })) };
  const { container, rerender } = render(<PerformanceControllerRack binding={binding} patch={grouped} language="english" />);
  const heights = () => [...container.querySelectorAll<HTMLElement>("[data-rack-controller-tile]")].map(tile => tile.style.minHeight);
  expect(heights()).toEqual(["225px", "225px", "225px"]);
  rerender(<PerformanceControllerRack binding={binding} patch={{ ...grouped, performance_controllers: grouped.performance_controllers.map((d, i) => i === 0 ? { ...d, error: "Invalid" } : d) }} language="english" />);
  expect(heights()).toEqual(["277px", "277px", "277px"]);
  rerender(<PerformanceControllerRack binding={binding} patch={grouped} language="english" />);
  expect(heights()).toEqual(["225px", "225px", "225px"]);
});

it("reflows on ResizeObserver and window resize without remounting focused drafts", () => {
  let width = 1070;
  let resize = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.hasAttribute("data-performance-controller") ? 169 : this.hasAttribute("data-rack-controller-footer") ? 39 : 0;
    return { width, height, x: 0, y: 0, top: 0, bottom: height, left: 0, right: width, toJSON() {} };
  });
  const names = ["Wavetable", "Motion", "Stereo", "Envelope", "Output & MIDI"];
  const definitions = [3, 3, 2, 4, 2].flatMap((count, group) => Array.from({ length: count }, (_, i) => ({
    ...patch.performance_controllers![0], node_id: `${group}:${i}`, label: `${names[group]} ${i}`, controller_group: names[group]
  })));
  const { container } = render(<PerformanceControllerRack binding={binding} patch={{ ...patch, performance_controllers: definitions }} language="english" />);
  const envelope = screen.getByRole("group", { name: "Envelope" });
  const columns = () => (envelope.querySelector("[data-controller-grid]") as HTMLElement).style.gridTemplateColumns;
  expect(columns()).toBe("repeat(4, 80px)");
  const input = screen.getByRole("spinbutton", { name: "Envelope 0 · Performance controller" });
  fireEvent.change(input, { target: { value: "0.1234" } });
  input.focus();
  width = 200;
  act(() => resize());
  expect(columns()).toBe("repeat(2, 80px)");
  width = 1070;
  fireEvent(window, new Event("resize"));
  expect(columns()).toBe("repeat(4, 80px)");
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe("0.1234");
  expect([...container.querySelectorAll("[data-controller-group]")].map(group => group.getAttribute("data-controller-group"))).toEqual(names);
  expect([...container.querySelectorAll("[data-performance-controller]")].map(tile => tile.getAttribute("data-performance-controller"))).toEqual(definitions.map(definition => definition.node_id));
});
