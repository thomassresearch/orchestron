// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OpcodeCatalog } from "./OpcodeCatalog";
import type { OpcodeSpec } from "../types";

it("inserts the highlighted category result, offers its help and describes an empty search", () => {
  const opcodes = ["oscili", "vco2"].map(name => ({ name, category: "oscillator", icon: "/icon.svg", tags: [] })) as unknown as OpcodeSpec[];
  const add = vi.fn(), help = vi.fn(), close = vi.fn();
  render(<OpcodeCatalog guiLanguage="english" opcodes={opcodes} onAddOpcode={add} onOpcodeHelpRequest={help} drawerOpen onCloseDrawer={close} />);
  const search = screen.getByRole("combobox");
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: "oscillator" } });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(screen.getByRole("option", { selected: true }).id).toBe(search.getAttribute("aria-activedescendant"));
  fireEvent.click(screen.getByRole("button", { name: "Help · vco2" }));
  expect(help).toHaveBeenCalledWith("vco2");
  fireEvent.keyDown(search, { key: "Enter" });
  expect(add).toHaveBeenCalledWith(opcodes[1]);
  expect(close).toHaveBeenCalledOnce();
  fireEvent.change(search, { target: { value: "missing" } });
  expect(screen.getByRole("status").textContent).toBe("No matching opcodes");
  fireEvent.keyDown(search, { key: "Enter" });
  expect(add).toHaveBeenCalledTimes(1);
});
