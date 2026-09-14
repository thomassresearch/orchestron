// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatchPicker } from "./PatchPicker";
import type { PatchListItem } from "../types";

const patches: PatchListItem[] = [
  { id: "z", name: "Zulu Pad", description: "Soft strings", instrument_type: "melody", is_template: false },
  { id: "a", name: "Alpha Lead", description: "BRIGHT sawtooth", instrument_type: "melody", is_template: true },
  { id: "b", name: "Bass Drum", description: "Low kick", instrument_type: "percussion", is_template: false },
  { id: "r", name: "Reverb", description: "Bright room", instrument_type: "continuous", is_template: false }
].map((patch) => ({ ...patch, always_on: patch.instrument_type === "continuous", schema_version: 1,
  updated_at: "", audio_inlet_names: [], audio_outlet_names: [] } as PatchListItem));

function setup() {
  const select = vi.fn();
  render(<PatchPicker patches={patches} guiLanguage="english" label="Load Patch" templateToken="TEMPLATE" onSelectPatch={select} />);
  fireEvent.click(screen.getByRole("button", { name: "Load Patch" }));
  return { select, input: screen.getByRole("searchbox") };
}
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe("patch picker", () => {
  it("locks rack selection when disabled and resets an open search before unlocking", () => {
    const select = vi.fn();
    const props = { patches, guiLanguage: "english" as const, label: "Zulu Pad", ariaLabel: "Patch 1", onSelectPatch: select };
    const { rerender } = render(<PatchPicker {...props} disabled />);
    const trigger = screen.getByRole("button", { name: "Patch 1" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<PatchPicker {...props} />);
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bright" } });
    tick(250);
    rerender(<PatchPicker {...props} disabled />);
    tick(500);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(select).not.toHaveBeenCalled();

    rerender(<PatchPicker {...props} />);
    fireEvent.click(trigger);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Melody 2" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Percussion 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Bass Drum" }));
    expect(select).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("starts collapsed with counts, expands alphabetically and selects a patch", () => {
    const { select, input } = setup();
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Zulu Pad" })).toBeNull();
    const group = screen.getByRole("button", { name: "Melody 2" });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(group);
    const list = document.getElementById(group.getAttribute("aria-controls")!)!;
    expect(within(list).getAllByRole("button").map((button) => button.textContent)).toEqual(["Alpha Lead TEMPLATE", "Zulu Pad"]);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Lead TEMPLATE" }));
    expect(select).toHaveBeenCalledExactlyOnceWith("a");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Load Patch" }));
  });

  it("requires four trimmed characters and waits for 500 ms without typing", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "  Alp  " } });
    tick(1000);
    expect(screen.queryByRole("button", { name: "Alpha Lead TEMPLATE" })).toBeNull();
    fireEvent.change(input, { target: { value: "Alph" } });
    tick(499);
    expect(screen.queryByRole("button", { name: "Alpha Lead TEMPLATE" })).toBeNull();
    fireEvent.change(input, { target: { value: "  ALPHA  " } });
    tick(499);
    expect(screen.queryByRole("button", { name: "Alpha Lead TEMPLATE" })).toBeNull();
    tick(1);
    expect(screen.getByRole("button", { name: "Alpha Lead TEMPLATE" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zulu Pad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Percussion 1" })).toBeNull();
  });

  it("searches descriptions across groups and cancels/reset searches below four characters", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "bright" } });
    tick(500);
    expect(screen.getByRole("button", { name: "Alpha Lead TEMPLATE" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reverb" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "nothing" } });
    tick(250);
    fireEvent.change(input, { target: { value: "bri" } });
    expect(screen.getByRole("button", { name: "Melody 2" }).getAttribute("aria-expanded")).toBe("false");
    tick(1000);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(input, { target: { value: "nothing" } });
    tick(500);
    expect(screen.getByRole("status").textContent).toBe("No matching patches.");
  });

  it("supports arrow navigation, Enter search selection and Escape with focus restoration", () => {
    const { input, select } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Percussion 1" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Melody 2" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Load Patch" }));
    fireEvent.click(document.activeElement!);
    const search = screen.getByRole("searchbox");
    expect((search as HTMLInputElement).value).toBe("");
    fireEvent.change(search, { target: { value: "bright" } });
    tick(500);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Alpha Lead TEMPLATE" }));
    fireEvent.keyDown(search, { key: "Enter" });
    expect(select).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("closes on outside click, clears pending timers and resets browsing on reopen", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "bright" } });
    tick(250);
    fireEvent.pointerDown(document.body);
    tick(500);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load Patch" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Melody 2" }).getAttribute("aria-expanded")).toBe("false");
  });
});
