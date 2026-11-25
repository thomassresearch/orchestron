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
import { MixerBody, PerformMixer } from "./PerformMixer";
import { MixWorkspace } from "./sequencer/MixWorkspace";
import { PerformanceEditorProvider, PerformViewContext } from "./sequencer/PerformanceEditorState";

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

it("offers live bypass only on continuous inserts and preserves the routing graph", async () => {
  const graph = wireInsertChain(emptyAudioGraph(), bindings, [source, effect], "source", ["insert"]);
  const flush = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ audioGraph: graph, activeSessionState: "running", flushMixer: flush });
  render(<PerformMixer onStop={() => undefined} />);
  const details = screen.getByText("Inserts · 1").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  const toggle = within(details).getByRole("button", { name: `${effect.name} Bypass` });
  expect((toggle as HTMLButtonElement).disabled).toBe(false);
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getAllByRole("button", { name: /Bypass/ })).toHaveLength(1);
  expect((within(details).getByRole("button", { name: "×" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(toggle);
  expect(useAppStore.getState().mixer.strips.insert.bypass).toBe(true);
  expect(useAppStore.getState().audioGraph).toBe(graph);
  expect(useAppStore.getState().activeSessionState).toBe("running");
  expect(within(details).getByText("Bypassed")).toBeTruthy();
  expect(flush).toHaveBeenCalledOnce();
  fireEvent.click(toggle);
  expect(useAppStore.getState().mixer.strips.insert.bypass).toBe(false);
  act(() => useAppStore.setState({ patches: [source, { ...effect, always_on: false }] }));
  expect(screen.queryByRole("button", { name: /Bypass/ })).toBeNull();
});

function feedbackGraph() {
  const graph = wireInsertChain(emptyAudioGraph(), bindings, [source, effect], "source", ["insert"]);
  for (const port of ["left", "right"]) graph.routes.push({ id: `send-${port}`, sourceId: "source", sourcePort: port, targetId: "insert", targetPort: port, sourceStage: "strip", targetStage: "input", kind: "send" });
  graph.routes.push({ id: "output", sourceId: "source", sourcePort: "left", targetId: "$master", targetPort: "left", sourceStage: "strip", targetStage: "input", kind: "main" });
  return graph;
}

it("opens the filtered routing diagram from a feedback warning on the preview mixer", () => {
  useAppStore.setState({ audioGraph: feedbackGraph() });
  render(<PerformanceEditorProvider><PerformViewContext.Provider value="mix">
    <MixWorkspace language="english" running={false} onStop={vi.fn()} onAdd={vi.fn()} patches={[source, effect]} rack={null} />
  </PerformViewContext.Provider></PerformanceEditorProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Show offending connections" }));
  const filter = screen.getByRole("checkbox", { name: "Only feedback connections" }) as HTMLInputElement;
  expect(filter.checked).toBe(true);
  expect(filter.closest("details")?.open).toBe(true);
  expect(filter.closest("details")?.querySelectorAll("[data-feedback-routes]")).toHaveLength(2);
  expect(screen.queryByRole("region", { name: "Master" })).toBeNull();
});

it("adds the chosen patch after browsing Rack and shows its channel only when it receives MIDI", () => {
  render(<PerformanceEditorProvider><PerformViewContext.Provider value="mix">
    <MixWorkspace language="english" running={false} onStop={vi.fn()} onAdd={useAppStore.getState().addSequencerInstrument}
      patches={[source, effect]} rack={null} />
  </PerformViewContext.Provider></PerformanceEditorProvider>);
  const nav = within(screen.getByRole("navigation", { name: "Mixer" }));
  fireEvent.click(nav.getByRole("button", { name: "Rack" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Instrument" }));
  const menu = within(screen.getByRole("dialog", { name: "Add Instrument" }));
  fireEvent.click(menu.getByRole("button", { name: /Continuous/ }));
  expect(useAppStore.getState().sequencerInstruments).toEqual(bindings);
  fireEvent.click(menu.getByRole("button", { name: effect.name }));
  const rack = useAppStore.getState().sequencerInstruments;
  expect(rack).toHaveLength(bindings.length + 1);
  const added = rack[bindings.length];
  expect(added).toMatchObject({ patchId: effect.id, midiChannel: 0 });
  expect(screen.queryByRole("button", { name: "Instrument controls" })).toBeNull();
  fireEvent.click(nav.getByRole("button", { name: "Routing" }));
  const sources = screen.getByRole("combobox", { name: "Source" }) as HTMLSelectElement;
  expect(sources.value).toBe(added.id);
  expect(sources.selectedOptions[0].text).not.toContain("MIDI");
  expect(sources.querySelector('option[value="source"]')?.textContent).toContain("MIDI Ch. 1");
});

it.each([
  ["english", "Show offending connections", "Closed routing path", "Only feedback connections"],
  ["german", "Betroffene Verbindungen zeigen", "Geschlossener Routing-Pfad", "Nur Rückkopplungsverbindungen"],
  ["french", "Afficher les connexions en cause", "Chemin de routage fermé", "Connexions de boucle uniquement"],
  ["spanish", "Mostrar conexiones afectadas", "Ruta de audio cerrada", "Solo conexiones del bucle"]
])("reveals the named stereo loop and filters highlighted routes in %s", (language, show, path, filter) => {
  const graph = feedbackGraph();
  useAppStore.setState({ guiLanguage: language as GuiLanguage, audioGraph: graph });
  const { container } = render(<PerformMixer onStop={() => undefined} />);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain(path);
  expect(alert.textContent).toContain(source.name);
  expect(alert.textContent).toContain(effect.name);
  expect(alert.textContent).toContain("left / right → left / right");
  expect(container.querySelector('[data-feedback-instance="source"]')).toBeTruthy();
  expect(container.querySelector('[data-feedback-instance="$master"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: show }));
  expect((screen.getByRole("checkbox", { name: filter }) as HTMLInputElement).checked).toBe(true);
  const diagram = screen.getByRole("checkbox", { name: filter }).closest("details")!;
  expect(diagram.querySelectorAll("[data-feedback-routes]")).toHaveLength(2);
  expect(diagram.textContent).not.toContain(language === "spanish" ? "Máster" : "Master");
  const highlighted = [...diagram.querySelectorAll("[data-feedback-routes]")].flatMap(node => node.getAttribute("data-feedback-routes")!.split(" "));
  expect(highlighted).toContain("send-left");
  expect(highlighted).toContain("send-right");
  expect(highlighted).not.toContain("output");
  act(() => useAppStore.setState({ audioGraph: { ...graph, routes: graph.routes.filter(r => r.id !== "send-left") } }));
  expect(screen.getByRole("alert")).toBeTruthy();
  act(() => useAppStore.setState({ audioGraph: { ...graph, routes: graph.routes.filter(r => !r.id.startsWith("send-")) } }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(container.querySelector("[data-feedback-routes], [data-feedback-instance], [data-feedback-route]")).toBeNull();
  expect(diagram.textContent).toContain(language === "spanish" ? "Máster" : "Master"); // Clearing the loop restores all connections.
});

it("uses structured backend feedback and discards it after routing changes", async () => {
  const { ApiError } = await import("../api/client");
  const { audioGraphDiagnostics } = await import("../lib/audioRouting");
  const graph = feedbackGraph();
  const diagnostic = audioGraphDiagnostics(bindings, [source, effect], graph).find(d => d.code === "feedback")!;
  diagnostic.routingPath![0].source.name = "Backend instrument name";
  vi.spyOn(api, "validateAudio").mockRejectedValue(new ApiError(422, "Unprocessable Content", JSON.stringify({ detail: { diagnostics: ["Feedback detected"], audioDiagnostics: [diagnostic] } })));
  useAppStore.setState({ audioGraph: graph });
  render(<PerformMixer onStop={() => undefined} />);
  expand("Routing diagnostics");
  fireEvent.click(screen.getByRole("button", { name: "Check routing" }));
  await screen.findByText("Backend instrument name");
  act(() => useAppStore.setState({ audioGraph: { ...graph, routes: graph.routes.filter(r => !r.id.startsWith("send-")) } }));
  expect(screen.queryByText("Backend instrument name")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("projects every destination-matrix channel exactly once, including damaged routes and partial direct output", () => {
  const graph = feedbackGraph();
  graph.routes.push(
    { ...graph.routes[graph.routes.length - 1], id: "orphan", sourceId: "lost", sourcePort: "old", targetId: "insert", targetPort: "aux", kind: "custom" },
    { ...graph.routes[graph.routes.length - 1], id: "explicit-left", sourceId: "$master", sourcePort: "$direct.left", targetId: "$output" }
  );
  useAppStore.setState({ audioGraph: graph });
  const { container } = render(<PerformanceEditorProvider><MixerBody surface="routing" onStop={vi.fn()} /></PerformanceEditorProvider>);
  const matrix = expand("Destination matrix");
  for (const details of matrix.querySelectorAll("details")) {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  }
  const matrixIds = [...matrix.querySelectorAll<HTMLElement>("[data-matrix-route]")].map(el => el.dataset.matrixRoute).sort();
  const drawn = [...container.querySelectorAll("[data-route-ids]")].flatMap(el => JSON.parse(el.getAttribute("data-route-ids")!)).sort();
  expect(matrixIds).toEqual(graph.routes.map(r => r.id).sort());
  expect(drawn).toEqual(matrixIds);
  expect(container.querySelectorAll("[data-implicit]")).toHaveLength(1);
  expect(container.querySelector('[data-routing-node="lost"]')).toBeTruthy();
  expect(useAppStore.getState().audioGraph).toBe(graph);
});

it("previews stage feedback, cancels cleanly and preserves send identity and gain on reconnection", () => {
  const graph = wireInsertChain(emptyAudioGraph(), bindings, [source, effect], "source", ["insert"]);
  useAppStore.setState({ audioGraph: graph });
  const { container } = render(<PerformanceEditorProvider><MixerBody surface="routing" onStop={vi.fn()} /></PerformanceEditorProvider>);
  const canvas = within(container.querySelector(".routing-canvas") as HTMLElement);
  const socket = (node: string, side: string, stage: string) => container.querySelector<HTMLButtonElement>(
    `[data-routing-node="${node}"] .rc-socket.${side}[data-stage="${stage}"]`)!;
  fireEvent.click(canvas.getByRole("button", { name: "Send" }));
  fireEvent.click(socket("source", "out", "strip"));
  fireEvent.focus(socket("insert", "in", "input"));
  expect(container.querySelector('.rc-preview[data-status="error"]')).toBeTruthy();
  expect(container.querySelector('[data-routing-node="source"][data-status="error"]')).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".rc-preview")).toBeNull();
  expect(useAppStore.getState().audioGraph).toBe(graph);
  fireEvent.click(socket("source", "out", "strip"));
  fireEvent.click(socket("$master", "in", "input"));
  const added = useAppStore.getState().audioGraph.routes.filter(r => r.kind === "send");
  expect(added.map(r => r.sourcePort)).toEqual(["left", "right"]);
  for (const r of added) expect(useAppStore.getState().mixer.sends[r.id]).toEqual({ gainDb: null, tap: "post" });
  const inspector = within(container.querySelector(".rc-inspect") as HTMLElement);
  fireEvent.change(inspector.getByRole("spinbutton", { name: "Gain dB" }), { target: { value: "-11" } });
  fireEvent.change(inspector.getByRole("combobox", { name: "Send" }), { target: { value: "pre" } });
  fireEvent.click(inspector.getByRole("button", { name: "Reconnect destination" }));
  fireEvent.click(socket("$output", "in", "input"));
  for (const r of added) {
    expect(useAppStore.getState().audioGraph.routes).toContainEqual({ ...r, targetId: "$output" });
    expect(useAppStore.getState().mixer.sends[r.id]).toEqual({ gainDb: -11, tap: "pre" });
  }
  act(() => useAppStore.setState({ activeSessionState: "running" }));
  expect(socket("source", "out", "strip").disabled).toBe(true);
  expect((inspector.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);
  expect((inspector.getByRole("spinbutton", { name: "Gain dB" }) as HTMLInputElement).disabled).toBe(false);
});

it("updates graph port warnings from automatic validation and ignores superseded results", async () => {
  const finish: ((result: { diagnostics: AudioDiagnostic[] }) => void)[] = [];
  vi.spyOn(api, "validateAudio").mockImplementation(() => new Promise(resolve => finish.push(resolve)));
  const { container } = render(<PerformanceEditorProvider><MixerBody surface="routing" onStop={vi.fn()} /></PerformanceEditorProvider>);
  await waitFor(() => expect(finish.length).toBe(1));
  act(() => useAppStore.setState({audioGraph: { ...emptyAudioGraph() }}));
  await waitFor(() => expect(finish.length).toBe(2));
  await act(async () => finish[1]({diagnostics: [{code: "incomplete_stereo", severity: "warning", message: "right",
    direction: "output", ports: ["right"], instanceId: "source"}]}));
  fireEvent.click(screen.getByRole("checkbox", {name: "Individual ports"}));
  const sockets = container.querySelectorAll('.rc-socket[data-status="warning"]');
  expect([...sockets].map(s => s.getAttribute("data-ports"))).toEqual(['["right"]']);
  await act(async () => finish[0]({diagnostics: []}));
  expect(container.querySelectorAll('.rc-socket[data-status="warning"]')).toHaveLength(1);
});

it("repairs a single send channel from the grouped cable and leaves the other channel and parallel send intact", () => {
  const graph = emptyAudioGraph();
  for (const port of ["right", "left"]) for (const pair of [1, 2]) {
    graph.routes.push({ id: pair + port, sourceId: "source", targetId: "$master", kind: "send",
      sourceStage: "strip", targetStage: "input", sourcePort: port, targetPort: port });
  }
  useAppStore.setState({ audioGraph: graph });
  const { container } = render(<PerformanceEditorProvider><MixerBody surface="routing" onStop={vi.fn()} /></PerformanceEditorProvider>);
  const cables = container.querySelectorAll('[data-cable-kind="send"]');
  expect(cables).toHaveLength(2);
  fireEvent.click(cables[0]);
  const inspector = within(container.querySelector(".rc-inspect") as HTMLElement);
  fireEvent.change(inspector.getByLabelText("Exact channel mapping"), { target: { value: "1right" } });
  fireEvent.click(inspector.getByText("Reconnect destination"));
  expect((screen.getByLabelText("Individual ports") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(container.querySelector('[data-routing-node="insert"] .rc-socket.in[data-ports=\'["left"]\']')!);
  expect(useAppStore.getState().audioGraph.routes).toEqual(graph.routes.map(r => r.id === "1right" ?
    { ...r, targetId: "insert", targetPort: "left" } : r));
});

it("connects custom before-insert and strip-return sockets without changing insert ownership", () => {
  const { container } = render(<PerformanceEditorProvider><MixerBody surface="routing" onStop={vi.fn()} /></PerformanceEditorProvider>);
  fireEvent.click(within(container.querySelector(".rc-kinds") as HTMLElement).getByText("Custom routing"));
  fireEvent.click(container.querySelector('[data-routing-node="source"] .rc-socket.out[data-stage="raw"]')!);
  fireEvent.click(container.querySelector('[data-routing-node="insert"] .rc-socket.in[data-stage="strip"]')!);
  const graph = useAppStore.getState().audioGraph;
  expect(graph.insertOwners).toEqual({});
  expect(graph.routes.map(r => [r.kind, r.sourceStage, r.targetStage, r.sourcePort, r.targetPort])).toEqual([
    ["custom", "raw", "strip", "left", "left"], ["custom", "raw", "strip", "right", "right"],
  ]);
});
