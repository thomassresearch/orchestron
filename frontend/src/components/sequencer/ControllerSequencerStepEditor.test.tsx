// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ControllerSequencerStepEditor } from "./ControllerSequencerStepEditor";
import { defaultControllerSequencer } from "../../store/appStoreModel";
import { createPerformanceEditorStore, PerformanceEditorProvider } from "./PerformanceEditorState";

afterEach(cleanup);

it("commits integers and empty cells, rejects invalid text, and cancels with Escape", () => {
  const track = defaultControllerSequencer(), change = vi.fn();
  track.pads[0].steps[1] = 0;
  render(<ControllerSequencerStepEditor track={track} language="english" transportSubunit={0} onChange={change} />);
  const input = screen.getByRole("textbox", { name: "Step 1" });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "127" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(change).toHaveBeenLastCalledWith(0, 127);
  change.mockClear();
  for (const invalid of ["128", "-1", "1.5", "hello"]) {
    fireEvent.change(input, { target: { value: invalid } });
    fireEvent.blur(input);
    expect(change).not.toHaveBeenCalled();
  }
  fireEvent.change(input, { target: { value: "64" } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.blur(input);
  expect(change).not.toHaveBeenCalled();
  const zero = screen.getByRole("textbox", { name: "Step 2" });
  expect((zero as HTMLInputElement).value).toBe("0");
  fireEvent.change(zero, { target: { value: "" } });
  fireEvent.blur(zero);
  expect(change).toHaveBeenLastCalledWith(1, null);
  expect(input.getAttribute("aria-current")).toBe("step");
});

it("retains drafts and scroll through panel collapse, with no highlight on an inactive pad", () => {
  const track = defaultControllerSequencer(), store = createPerformanceEditorStore();
  const editor = (visible: boolean) => <PerformanceEditorProvider retainedStore={store}>
    {visible && <ControllerSequencerStepEditor track={track} language="german" transportSubunit={null} onChange={vi.fn()} />}
  </PerformanceEditorProvider>;
  const view = render(editor(true));
  fireEvent.change(screen.getByRole("textbox", { name: "Schritt 1" }), { target: { value: "42" } });
  view.rerender(editor(false));
  view.rerender(editor(true));
  expect((screen.getByRole("textbox", { name: "Schritt 1" }) as HTMLInputElement).value).toBe("42");
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
});
