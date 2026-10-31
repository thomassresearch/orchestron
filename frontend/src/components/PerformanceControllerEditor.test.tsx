// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PerformanceControllerEditor } from "./PerformanceControllerEditor";
import { performanceControllerCopy } from "../lib/performanceControllerCopy";

afterEach(cleanup);
const node = { id: "setting", opcode: "perf_controller", position: { x: 0, y: 0 }, params: {} };
describe("controller configuration", () => {
  it.each(["english", "german", "french", "spanish"] as const)("shows type-specific fields in %s", language => {
    const copy = performanceControllerCopy(language), onSave = vi.fn();
    render(<PerformanceControllerEditor node={node} language={language} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByLabelText(copy.scale)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(copy.type), { target: { value: "integer" } });
    expect(screen.queryByLabelText(copy.scale)).toBeNull();
    expect((screen.getByLabelText(copy.default) as HTMLInputElement).value).toBe("1");
    fireEvent.change(screen.getByLabelText(copy.default), { target: { value: "0.5" } });
    expect((screen.getByRole("button", { name: copy.save }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(copy.type), { target: { value: "bool" } });
    expect(screen.queryByLabelText(copy.min)).toBeNull();
    expect(screen.queryByLabelText(copy.max)).toBeNull();
    fireEvent.change(screen.getByLabelText(copy.default), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(onSave).toHaveBeenCalledWith({ controller_type: "bool", min: 0, max: 1, default: 0, scale: "linear", label: "Parameter" });
  });
  it("requires correction when integer rounding collapses the range", () => {
    render(<PerformanceControllerEditor node={{ ...node, params: { min: 0.1, max: 0.4, default: 0.2, scale: "logarithmic" } }} language="english" onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "integer" } });
    expect(screen.getByRole("alert").textContent).toContain("smaller");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("loads type-only definitions with a zero default", () => {
    render(<PerformanceControllerEditor node={{ ...node, params: { controller_type: "integer" } }} language="english" onSave={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Default") as HTMLInputElement).value).toBe("0");
  });
});
