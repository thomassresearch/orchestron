// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { emptyAudioGraph } from "../lib/audioRouting";
import { audioTemplate } from "../lib/audioTemplates";
import { toPatchListItem } from "../lib/patchCatalog";
import { wireInsertChain } from "../lib/insertRouting";
import { useAppStore } from "../store/useAppStore";
import type { AudioDiagnostic, GuiLanguage } from "../types";
import { PerformMixer } from "./PerformMixer";

const source = toPatchListItem(audioTemplate("instrument"));
const effect = toPatchListItem(audioTemplate("effect"));
const bindings = [
  { id: "source", patchId: source.id, midiChannel: 1, level: 10, effectSourceIds: [], effectRoutes: [] },
  { id: "insert", patchId: effect.id, midiChannel: 0, level: 10, effectSourceIds: [], effectRoutes: [] }
];
function expand(label: string) {
  const details = screen.getByText(label, { selector: "summary" }).closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return details;
}
beforeEach(() => useAppStore.setState({ patches: [source, effect], sequencerInstruments: bindings, activeSessionState: "idle", audioGraph: emptyAudioGraph() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAppStore.setState(useAppStore.getInitialState(), true); });

it.each([
  ["english", "Routing diagnostics", "Invalid insert ownership"],
  ["german", "Routing-Diagnose", "Ungültige Insert-Zuordnung"],
  ["french", "Diagnostic du routage", "Attribution d’insert invalide"],
  ["spanish", "Diagnóstico de rutas", "Asignación de inserción no válida"]
])("shows orphan ownership immediately in %s", (language, summary, label) => {
  useAppStore.setState({ guiLanguage: language as GuiLanguage, audioGraph: { ...emptyAudioGraph(), insertOwners: { removedProcessor: "removedOwner" } } });
  render(<PerformMixer onStop={() => undefined} />);
  const panel = expand(summary);
  expect(within(panel).getByText(`${label}: removedProcessor → removedOwner`).className).toContain("text-rose-300");
});

it("shows backend failures beside Check routing and replaces previous diagnostics", async () => {
  const check = vi.spyOn(api, "validateAudio").mockResolvedValueOnce({ diagnostics: [{ code: "test", message: "Previous result", severity: "warning" }] })
    .mockRejectedValueOnce(new Error("Insert ownership references a missing or invalid instance."));
  render(<PerformMixer onStop={() => undefined} />);
  const panel = expand("Routing diagnostics");
  fireEvent.click(within(panel).getByRole("button", { name: "Check routing" }));
  await screen.findByText(/Previous result/);
  fireEvent.click(within(panel).getByRole("button", { name: "Check routing" }));
  await waitFor(() => expect(within(panel).getByRole("alert").textContent).toContain("Insert ownership"));
  expect(screen.queryByText(/Previous result/)).toBeNull();
  expect(check).toHaveBeenCalledTimes(2);
});

it.each(["bindings", "patches", "mixer", "graph"])("discards pending validation after %s changes", async change => {
  let reject!: (error: Error) => void;
  vi.spyOn(api, "validateAudio").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  render(<PerformMixer onStop={() => undefined} />);
  expand("Routing diagnostics");
  fireEvent.click(screen.getByRole("button", { name: "Check routing" }));
  act(() => {
    const state = useAppStore.getState();
    if (change === "bindings") useAppStore.setState({ sequencerInstruments: [...state.sequencerInstruments] });
    if (change === "patches") useAppStore.setState({ patches: [...state.patches] });
    if (change === "mixer") useAppStore.setState({ mixer: { ...state.mixer } });
    if (change === "graph") useAppStore.setState({ audioGraph: { ...state.audioGraph } });
  });
  await act(async () => reject(new Error("Stale error")));
  expect(screen.queryByText("Stale error")).toBeNull();
});

it("keeps the latest check when requests complete out of order", async () => {
  const finish: ((result: { diagnostics: AudioDiagnostic[] }) => void)[] = [];
  vi.spyOn(api, "validateAudio").mockImplementation(() => new Promise(resolve => finish.push(resolve)));
  render(<PerformMixer onStop={() => undefined} />);
  expand("Routing diagnostics");
  const button = screen.getByRole("button", { name: "Check routing" });
  fireEvent.click(button); fireEvent.click(button);
  await act(async () => finish[1]({ diagnostics: [{ code: "test", message: "Latest result", severity: "warning" }] }));
  await act(async () => finish[0]({ diagnostics: [{ code: "test", message: "Stale result", severity: "warning" }] }));
  expect(screen.getByText(/Latest result/)).toBeTruthy();
  expect(screen.queryByText(/Stale result/)).toBeNull();
});

it("uses the shared removal action for the insert × button", () => {
  useAppStore.setState({ audioGraph: wireInsertChain(emptyAudioGraph(), bindings, [source, effect], "source", ["insert"]) });
  render(<PerformMixer onStop={() => undefined} />);
  const strip = screen.getAllByRole("button", { name: source.name })[0].closest("article")!;
  const details = within(strip).getByText("Inserts · 1").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  fireEvent.click(within(details).getByRole("button", { name: "×" }));
  const state = useAppStore.getState();
  expect(state.sequencerInstruments.map(b => b.id)).toEqual(["source"]);
  expect(state.audioGraph).toEqual(emptyAudioGraph());
});
