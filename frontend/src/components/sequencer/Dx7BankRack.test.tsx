// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../api/client";
import { toPatchListItem } from "../../lib/patchCatalog";
import { useAppStore } from "../../store/useAppStore";
import type { Patch, SequencerInstrumentBinding } from "../../types";
import { Dx7BankRack } from "./Dx7BankRack";

const initial = useAppStore.getState();
const patch: Patch = { id: "dx7", name: "DX7", description: "", created_at: "", updated_at: "", schema_version: 1,
  instrument_type: "melody", always_on: false, is_template: false, graph: {
    nodes: [{ id: "voice", opcode: "fm_dx7", params: {}, position: { x: 0, y: 0 } }],
    connections: [], ui_layout: {}
  } };
const item = toPatchListItem(patch);
const binding: SequencerInstrumentBinding = { id: "rack", patchId: patch.id, level: 1, midiChannel: 1, effectRoutes: [], effectSourceIds: [] };

function Rack({ running = false }: { running?: boolean }) {
  const row = useAppStore(s => s.sequencerInstruments[0]);
  return <Dx7BankRack binding={row} definitions={item.performance_controllers!} language="english" running={running} />;
}

beforeEach(() => {
  vi.spyOn(api, "getPatch").mockResolvedValue(patch);
  useAppStore.setState({ patches: [item], sequencerInstruments: [binding], performanceName: "Brass" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAppStore.setState(initial, true); });

it("defaults to the editor voice and selects rack presets during playback", async () => {
  render(<Rack running />);
  const display = screen.getByLabelText("Selected preset");
  await waitFor(() => expect(display.textContent).toContain("P00"));
  const preset = screen.getByLabelText("Preset");
  fireEvent.change(preset, { target: { value: "2" } });
  expect(display.textContent).toContain("B00 / P02");
  fireEvent.change(preset, { target: { value: "0" } });
  expect(display.textContent).toContain("P00");
  expect((preset as HTMLSelectElement).options).toHaveLength(33);
  fireEvent.click(screen.getByText("Manage banks"));
  expect((screen.getByLabelText("Cartridge slot") as HTMLSelectElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("shows Save only for changed cartridges, retaining the edit through remount and save failure", async () => {
  vi.spyOn(api, "dx7Voices").mockResolvedValue([]);
  vi.spyOn(api, "createPerformance").mockRejectedValueOnce(new Error("Save failed"))
    .mockImplementation(async payload => ({ ...payload, id: "saved", created_at: "", updated_at: "" }));
  vi.spyOn(api, "listPerformances").mockResolvedValue([]);
  const view = render(<Rack />);
  fireEvent.click(screen.getByText("Manage banks"));
  const input = view.container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["invalid"], "invalid.syx")] } });
  expect(screen.getByRole("alert").textContent).toContain("32-voice");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

  const raw = new Uint8Array(4104);
  raw.set([240, 67, 0, 9, 32, 0]);
  raw.set(Array.from("Loop Brass", c => c.charCodeAt(0)), 124);
  raw[4102] = -raw.slice(6, 4102).reduce((sum, n) => sum + n, 0) & 127;
  raw[4103] = 247;
  const file = new File([raw], "Studio.syx");
  Object.defineProperty(file, "arrayBuffer", { value: async () => raw.buffer });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("button", { name: "Save" });
  fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "1" } });
  expect(screen.getByLabelText("Selected preset").textContent).toBe("B01 / P01Loop Brass");
  view.unmount();
  render(<Rack />);
  fireEvent.click(screen.getByText("Manage banks"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Save failed");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Performance saved.");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.getByLabelText("Selected preset").textContent).toContain("B00 / P01");
  expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
});
