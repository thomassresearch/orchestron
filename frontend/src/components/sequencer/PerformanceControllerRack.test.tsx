// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PerformanceControllerRack } from "./PerformanceControllerRack";
import { useAppStore } from "../../store/useAppStore";
import type { PatchListItem, SequencerInstrumentBinding } from "../../types";
const binding: SequencerInstrumentBinding = { id: "one", patchId: "patch", midiChannel: 3, level: 10, effectSourceIds: [], effectRoutes: [], performanceControllerMidiCCs: { gain: 21 } };
const patch = { id: "patch", performance_controllers: [
  { node_id: "gain", min: 0, max: 1, default: .5, scale: "linear", label: "Gain" },
  { node_id: "count", controller_type: "integer", min: 0, max: 4, default: 1, scale: "linear", label: "Count" },
  { node_id: "enabled", controller_type: "bool", min: 0, max: 1, default: 0, scale: "linear", label: "Enabled" }
] } as PatchListItem;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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
