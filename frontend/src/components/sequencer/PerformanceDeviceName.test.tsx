// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../backend/tests/fixtures/performances/device_names.json";
import { performanceDeviceKinds } from "../../lib/performanceDeviceNames";
import { useAppStore } from "../../store/useAppStore";
import { PerformanceDeviceName } from "./PerformanceDeviceName";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(cleanup);

function Editor({ kind = "tracks" }: { kind?: typeof performanceDeviceKinds[number] }) {
  const state = useAppStore();
  return <PerformanceDeviceName device={state.sequencer[kind][0]} kind={kind} fallback="Fallback"
    sequencer={state.sequencer} guiLanguage="english" onRename={state.renamePerformanceDevice} />;
}

describe("inline performance name editor", () => {
  it.each(performanceDeviceKinds)("edits %s with focus, selection, and Enter", (kind) => {
    render(<Editor kind={kind} />);
    fireEvent.click(screen.getByRole("button", { name: /^Rename:/ }));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    fireEvent.change(input, { target: { value: "  My New Name  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename: My New Name" })).toBeTruthy();
    expect(useAppStore.getState().sequencer[kind][0].name).toBe("My New Name");
  });

  it("shows validation as input changes and prevents invalid saves", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: /^Rename:/ }));
    const input = screen.getByRole("textbox");
    for (const name of ["", "broken beat", "X".repeat(66), "<img src=x onerror=alert(1)>"]) {
      fireEvent.change(input, { target: { value: name } });
      const error = screen.getByRole("alert");
      expect(input.getAttribute("aria-describedby")).toBe(error.id);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(useAppStore.getState().sequencer.tracks[0].name).toBe("Warm Lead");
    }
    fireEvent.change(input, { target: { value: "🎹".repeat(65) } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useAppStore.getState().sequencer.tracks[0].name).toBe("🎹".repeat(65));
  });

  it("does not commit on blur, and Cancel/Escape discard the draft", () => {
    render(<Editor />);
    for (const cancel of ["Cancel", "Escape"]) {
      fireEvent.click(screen.getByRole("button", { name: /^Rename:/ }));
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Discard me" } });
      fireEvent.blur(input);
      expect(useAppStore.getState().sequencer.tracks[0].name).toBe("Warm Lead");
      expect(screen.getByRole("textbox")).toBe(input);
      if (cancel === "Cancel") fireEvent.click(screen.getByRole("button", { name: cancel }));
      else fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("textbox")).toBeNull();
    }
  });

  it("renders legacy HTML as literal text and reports store validation errors", () => {
    const sequencer = useAppStore.getState().sequencer;
    const device = { ...sequencer.tracks[0], name: "<b>Legacy</b>" };
    const onRename = vi.fn().mockReturnValue({ ok: false, error: "duplicate" });
    const { container } = render(<PerformanceDeviceName device={device} kind="tracks" sequencer={sequencer}
      guiLanguage="english" fallback="Fallback" onRename={onRename} />);
    expect(screen.getByText(device.name)).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Rename:/ }));
    expect(screen.getByRole("alert").textContent).toContain("HTML");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Concurrent Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("already uses");
  });
});
