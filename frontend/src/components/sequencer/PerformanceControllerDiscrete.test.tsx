// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controllerDefaults } from "../../lib/performanceControllers";
import { PerformanceControllerDiscrete } from "./PerformanceControllerDiscrete";
import { createPerformanceEditorStore, PerformanceEditorProvider } from "./PerformanceEditorState";
import type { PerformanceControllerDefinition } from "../../types";

const integer = { ...controllerDefaults("integer"), node_id: "setting", label: "Octave", min: -2, max: 2 };
const bool = { ...controllerDefaults("bool"), node_id: "setting", label: "Enabled" };
afterEach(cleanup);
function Harness({ definition = integer, onChange = vi.fn(), onReset = vi.fn() }: {
  definition?: PerformanceControllerDefinition; onChange?: (value: number) => void; onReset?: () => void;
}) {
  const [value, setValue] = useState(definition.default);
  return <PerformanceControllerDiscrete definition={definition} value={value} language="english"
    onChange={next => { setValue(next); onChange(next); }} onReset={() => { setValue(definition.default); onReset(); }} />;
}
describe("discrete rack controllers", () => {
  it("steps, respects bounds, and supports keyboard endpoints", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Octave · Increase"));
    fireEvent.click(screen.getByLabelText("Octave · Increase"));
    expect((screen.getByLabelText("Octave · Increase") as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("2");
    fireEvent.keyDown(input, { key: "Home" });
    expect(input.value).toBe("-2");
    expect((screen.getByLabelText("Octave · Decrease") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("-1");
    fireEvent.keyDown(input, { key: "End" });
    expect(input.value).toBe("2");
    expect(onChange.mock.calls.every(([v]) => Number.isInteger(v))).toBe(true);
  });
  it("commits integers, clamps, rejects fractions, cancels, and resets", () => {
    const onChange = vi.fn(), onReset = vi.fn();
    render(<Harness onChange={onChange} onReset={onReset} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("2");
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.blur(input);
    expect(input.value).toBe("2");
    input.focus();
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("2");
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Octave · Reset to patch default"));
    expect(onReset).toHaveBeenCalledOnce();
    expect(input.value).toBe("0");
  });
  it("toggles numeric zero/one and resets the bool", () => {
    const onChange = vi.fn(), onReset = vi.fn();
    render(<Harness definition={bool} onChange={onChange} onReset={onReset} />);
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.textContent).toBe("On");
    fireEvent.click(toggle);
    expect(onChange.mock.calls).toEqual([[1], [0]]);
    fireEvent.click(screen.getByLabelText("Enabled · Reset to patch default"));
    expect(onReset).toHaveBeenCalledOnce();
  });
  it("retains an integer draft while collapsed", () => {
    const store = createPerformanceEditorStore();
    const view = (visible: boolean) => <PerformanceEditorProvider retainedStore={store}>{visible && <Harness />}</PerformanceEditorProvider>;
    const { rerender } = render(view(true));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "-1" } });
    rerender(view(false));
    rerender(view(true));
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("-1");
  });
  it("disables invalid controls", () => {
    render(<Harness definition={{ ...bool, error: "Invalid" }} />);
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Enabled · Reset to patch default") as HTMLButtonElement).disabled).toBe(true);
  });
});
