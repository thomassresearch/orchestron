// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GenNodeEditorModal } from "./GenNodeEditorModal";
import { defaultGenNodeConfig, normalizeGenNodeConfig } from "../lib/genNodeConfig";

afterEach(cleanup);

it("selects GEN19, edits partials, previews and saves rows", () => {
  const onSave = vi.fn();
  render(<GenNodeEditorModal nodeId="g" guiLanguage="english" initialConfig={defaultGenNodeConfig()} onClose={vi.fn()} onSave={onSave} />);
  fireEvent.change(screen.getByRole("combobox", { name: "GEN Routine" }), { target: { value: "num:19" } });
  for (const value of ["", "0", "0.", "0.5"]) {
    fireEvent.change(screen.getByRole("textbox", { name: "Partial number 1" }), { target: { value } });
    expect((screen.getByRole("textbox", { name: "Partial number 1" }) as HTMLInputElement).value).toBe(value);
  }
  fireEvent.change(screen.getByRole("textbox", { name: "Strength 1" }), { target: { value: "-2" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Phase (°) 1" }), { target: { value: "270" } });
  fireEvent.change(screen.getByRole("textbox", { name: "DC offset 1" }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("textbox", { name: "Partial number 2" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Normalize table (use positive GEN number)" }));
  expect(screen.getByText("{ift} ftgen 0, 0, 16384, -19, 0.5, -2, 270, 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save GEN" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ routineNumber: 19, normalize: false, gen19Partials: [{ partial: 0.5, strength: -2, phase: 270, offset: 2 }] }));
});

it.each([
  ["english", "Partial number"], ["german", "Teiltonnummer"],
  ["french", "Numéro de partielle"], ["spanish", "Número de parcial"]
] as const)("shows localized GEN19 controls in %s", (language, label) => {
  render(<GenNodeEditorModal nodeId="g" guiLanguage={language} initialConfig={normalizeGenNodeConfig({ routineNumber: 19 })} onClose={vi.fn()} onSave={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: `${label} 1` })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Csound GEN19" }).getAttribute("href")).toBe("https://csound.com/docs/manual/GEN19.html");
});

it("keeps the raw editor when opening an older GEN19 patch", () => {
  const onSave = vi.fn();
  render(<GenNodeEditorModal nodeId="g" guiLanguage="english" initialConfig={normalizeGenNodeConfig({ routineNumber: 19, rawArgs: [1, "1/2", 270, 0.5] })} onClose={vi.fn()} onSave={onSave} />);
  expect(screen.queryByRole("textbox", { name: "Partial number 1" })).toBeNull();
  expect(screen.getByDisplayValue("1, 1/2, 270, 0.5")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save GEN" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ gen19Partials: null, rawArgsText: "1, 1/2, 270, 0.5" }));
});
