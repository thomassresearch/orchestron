// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { emptyAudioGraph } from "../lib/audioRouting";
import { audioTemplate } from "../lib/audioTemplates";
import { toPatchListItem } from "../lib/patchCatalog";
import { insertChain, wireInsertChain } from "../lib/insertRouting";
import { useAppStore } from "../store/useAppStore";
import type { AudioDiagnostic, GuiLanguage } from "../types";
import { MixerBody, PerformMixer } from "./PerformMixer";
import { MixWorkspace } from "./sequencer/MixWorkspace";
import { PerformNavigation, PerformWorkspace } from "./sequencer/PerformWorkspace";
import { PerformanceEditorProvider } from "./sequencer/PerformanceEditorState";

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

function routingFixture() {
  const { container } = render(<PerformanceEditorProvider><MixerBody surface="routing" onStop={vi.fn()}/></PerformanceEditorProvider>);
  const action = (selector: string) => fireEvent.click(container.querySelector(selector)!);
  const dialog = () => within(screen.getByRole("dialog"));
  return { container, action, dialog,
    add: (id: string) => { action(`[data-routing-node="${id}"] .rc-add-insert`); fireEvent.click(dialog().getByText(effect.name)); },
    menu: (id: string) => {action(`[data-insert-id="${id}"] .rc-insert-name`); return dialog();} };
}

it.each([
  ["Add insert", '[data-routing-node="$master"] .rc-add-insert'],
  ["an existing insert", '[data-insert-id="insert"] .rc-insert-name'],
  ["an output jack", '[data-routing-node="source"] .rc-socket.out']
])("dismisses %s on Escape, an outside pointer or focus loss", (_name, selector) => {
  const graph = wireInsertChain(emptyAudioGraph(), bindings, [source, effect], "source", ["insert"]);
  useAppStore.setState({ audioGraph: graph });
  const { container, action } = routingFixture();
  const trigger = container.querySelector<HTMLElement>(selector)!;
  const outside = container.querySelector<HTMLButtonElement>('[data-routing-node="insert"] .rc-title')!;
  action(selector);
  expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);

  action(selector);
  fireEvent.pointerDown(outside);
  expect(screen.queryByRole("dialog")).toBeNull();
  action(selector);
  act(() => outside.focus());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(outside);
  expect(useAppStore.getState().audioGraph).toBe(graph);
});

it("discards unfinished routes when the destination or effect picker is dismissed", async () => {
  const { container, action, dialog } = routingFixture();
  const { audioGraph, sequencerInstruments } = useAppStore.getState();
  const open = () => {
    action('[data-routing-node="source"] .rc-socket.out');
    fireEvent.click(dialog().getByText("Send"));
    expect(container.querySelector(".rc-preview")).toBeTruthy();
  };
  const dismissed = () => {
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector(".rc-preview")).toBeNull();
    expect(useAppStore.getState().audioGraph).toBe(audioGraph);
    expect(useAppStore.getState().sequencerInstruments).toBe(sequencerInstruments);
  };
  open();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  dismissed();
  open();
  fireEvent.pointerDown(container.querySelector('[data-routing-node="source"]')!);
  dismissed();
  open();
  act(() => container.querySelector<HTMLButtonElement>('.rc-socket[data-compatible]')!.focus());
  dismissed();
  open();
  fireEvent.click(dialog().getByText("New effect from library…"));
  const search = dialog().getByRole("searchbox");
  act(() => search.focus());
  expect(dialog().getByRole("searchbox")).toBe(search);
  await act(async () => search.blur());
  dismissed();
  open();
  fireEvent.blur(window);
  dismissed();
});

it("adds an insert at the clicked cable, reorders and removes individual copies", () => {
  const graph = emptyAudioGraph();
  useAppStore.setState({audioGraph:graph, patches:[source, effect, {...effect,id:"template",name:"Template only",is_template:true}]});
  const {action, dialog, add, menu} = routingFixture();
  const order = () => insertChain(useAppStore.getState().audioGraph,"source")!;
  add("source"); add("source");
  const [first,last] = order();
  const link = useAppStore.getState().audioGraph.routes.find(r => r.sourceId === first && r.targetId === last)!;
  action(`[data-route-ids*="${link.id}"]`);
  expect(dialog().queryByText("Template only")).toBeNull();
  fireEvent.click(dialog().getByText(effect.name));
  const middle = order()[1];
  expect(order()).toEqual([first,middle,last]);
  expect(new Set(order()).size).toBe(3);
  fireEvent.click(menu(last).getByText("Move earlier"));
  expect(order()).toEqual([first,last,middle]);
  fireEvent.click(menu(first).getByText("Move later"));
  expect(order()).toEqual([last,first,middle]);
  for (const id of [first,last,middle]) fireEvent.click(menu(id).getByText("Remove insert"));
  expect(useAppStore.getState().audioGraph).toEqual(graph);
  expect(useAppStore.getState().sequencerInstruments).toEqual(bindings);
});

it("drops a processor across multiple positions within its owner and cancels a drop outside the list", () => {
  const rack = [...bindings,...["middle","last"].map(id=>({...bindings[1],id}))];
  const graph = wireInsertChain(emptyAudioGraph(),rack,[source,effect],"source",["insert","middle","last"]);
  useAppStore.setState({audioGraph:graph, sequencerInstruments:rack});
  const {container} = routingFixture();
  const handle = container.querySelector('[data-insert-id="insert"] .rc-grip')!;
  const target = container.querySelector('[data-insert-id="last"]')!;
  const pointer = {pointerId:1,button:0,clientX:10,clientY:20};
  const original = Object.getOwnPropertyDescriptor(document,"elementFromPoint");
  const hit = vi.fn().mockReturnValue(null);
  Object.defineProperty(document,"elementFromPoint",{configurable:true,value:hit});
  try {
    fireEvent.pointerDown(handle,pointer); fireEvent.pointerUp(handle,pointer);
    expect(useAppStore.getState().audioGraph).toBe(graph);
    hit.mockReturnValue(target);
    fireEvent.pointerDown(handle,pointer); fireEvent.pointerMove(handle,pointer);
    expect(useAppStore.getState().audioGraph).toBe(graph);
    fireEvent.pointerUp(handle,pointer);
    expect(insertChain(useAppStore.getState().audioGraph,"source")).toEqual(["middle","last","insert"]);
  } finally {
    if (original) Object.defineProperty(document,"elementFromPoint",original);
    else Reflect.deleteProperty(document,"elementFromPoint");
  }
});

it("supports Master and nested inserts and keeps bypass live during playback", () => {
  useAppStore.setState({audioGraph:wireInsertChain(emptyAudioGraph(), bindings,[source,effect],"$master",["insert"]),activeSessionState:"running"});
  const {container,menu,add} = routingFixture();
  const controls = menu("insert");
  expect((controls.getByText("Remove insert") as HTMLButtonElement).disabled).toBe(true);
  expect((controls.getByRole("button",{name:/Bypass/}) as HTMLButtonElement).disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('[data-routing-node="insert"] .rc-add-insert')!.disabled).toBe(true);
  act(() => useAppStore.setState({activeSessionState:"idle"}));
  add("insert");
  expect(insertChain(useAppStore.getState().audioGraph,"insert")).toHaveLength(1);
  expect(insertChain(useAppStore.getState().audioGraph,"$master")).toEqual(["insert"]);
});

it("handles an empty effect library and mismatched channel counts", () => {
  useAppStore.setState({patches:[source]});
  const {action,dialog} = routingFixture();
  action('[data-routing-node="source"] .rc-add-insert');
  expect(dialog().getByText(/save a continuous instrument/)).toBeTruthy();
  const mono = {...effect,audio_interface:undefined,audio_inlet_names:["mono"],audio_outlet_names:["mono"]};
  act(() => useAppStore.setState({patches:[source,mono]}));
  action('[data-routing-node="source"] .rc-add-insert');
  expect((dialog().getByText(effect.name) as HTMLButtonElement).disabled).toBe(true);
  expect(useAppStore.getState().sequencerInstruments).toBe(bindings);
});

it("preserves custom insert wiring when removing a processor and disables serial moves", () => {
  const rack = [...bindings, { ...bindings[1], id: "last" }];
  const graph = wireInsertChain(emptyAudioGraph(), rack, [source,effect],"source",["insert","last"]);
  for (const r of graph.routes.filter(r=>r.targetId==="source")) r.targetPort=r.sourcePort==="left"?"right":"left";
  useAppStore.setState({audioGraph:graph,sequencerInstruments:rack});
  const {menu,container} = routingFixture();
  expect(container.querySelector<HTMLButtonElement>('[data-routing-node="source"] .rc-add-insert')!.disabled).toBe(true);
  const controls = menu("insert");
  expect(controls.getByText(/custom wiring/)).toBeTruthy();
  expect((controls.getByText("Move later") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(controls.getByText("Remove insert"));
  expect(useAppStore.getState().audioGraph.routes).toEqual(graph.routes.filter(r=>r.targetId!=="insert" && r.sourceId!=="insert"));
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

function renderMix() {
  const result = render(<PerformanceEditorProvider><PerformWorkspace language="english">{(view, navigate) =>
    <><PerformNavigation view={view} language="english" navigate={navigate} />{view === "mix" && <MixWorkspace navigate={navigate} language="english" running={false}
      onStop={vi.fn()} onAdd={useAppStore.getState().addSequencerInstrument} patches={[source, effect]} rack={null} />}</>
  }</PerformWorkspace></PerformanceEditorProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Mix" }));
  return result;
}

it("opens the filtered routing diagram from a feedback warning on the preview mixer", () => {
  useAppStore.setState({ audioGraph: feedbackGraph() });
  renderMix();
  fireEvent.click(screen.getByRole("button", { name: "Show offending connections" }));
  const filter = screen.getByRole("checkbox", { name: "Only feedback connections" }) as HTMLInputElement;
  expect(filter.checked).toBe(true);
  expect(filter.closest("details")?.open).toBe(true);
  expect(filter.closest("details")?.querySelectorAll("[data-feedback-routes]")).toHaveLength(2);
  expect(screen.queryByRole("region", { name: "Master" })).toBeNull();
});

it("adds the chosen patch after browsing Rack and shows its channel only when it receives MIDI", () => {
  const { container } = renderMix();
  const nav = within(screen.getByRole("navigation", { name: "Mix pages" }));
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
  expect(screen.queryByText("Advanced routing")).toBeNull();
  expect(screen.queryByText("Routing diagnostics", {selector: "summary"})).toBeNull();
  expect(container.querySelector(`[data-routing-node="${added.id}"][data-selected] small`)?.textContent).toContain("Continuous");
  expect(container.querySelector('[data-routing-node="source"] small')?.textContent).toContain("MIDI Ch. 1");
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
  const classic = render(<PerformMixer onStop={vi.fn()}/>);
  const matrix = expand("Destination matrix");
  for (const details of matrix.querySelectorAll("details")) {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  }
  const matrixIds = [...matrix.querySelectorAll<HTMLElement>("[data-matrix-route]")].map(el => el.dataset.matrixRoute).sort();
  classic.unmount();
  const { container } = routingFixture();
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
  const socket = (node: string, side: string, stage: string) => container.querySelector<HTMLButtonElement>(
    `[data-routing-node="${node}"] .rc-socket.${side}[data-stage="${stage}"]`)!;
  fireEvent.click(socket("source", "out", "strip"));
  fireEvent.click(within(screen.getByRole("dialog")).getByText("Send"));
  fireEvent.click(within(screen.getByRole("dialog")).getByText("Choose on graph"));
  fireEvent.focus(socket("insert", "in", "input"));
  expect(container.querySelector('.rc-preview[data-status="error"]')).toBeTruthy();
  expect(container.querySelector('[data-routing-node="source"][data-status="error"]')).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".rc-preview")).toBeNull();
  expect(useAppStore.getState().audioGraph).toBe(graph);
  fireEvent.click(socket("source", "out", "strip"));
  fireEvent.click(within(screen.getByRole("dialog")).getByText("Send"));
  fireEvent.pointerDown(socket("$master", "in", "input"));
  act(() => socket("$master", "in", "input").focus());
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

it("creates a distinct return with stereo input, explicit onward routing and silent sends in one edit", () => {
  const {action,dialog} = routingFixture();
  action('[data-routing-node="source"] .rc-socket.out[data-stage="strip"]');
  fireEvent.click(dialog().getByText("Send"));
  fireEvent.click(dialog().getByText("New effect from library…"));
  const updates = vi.fn();
  const unsubscribe = useAppStore.subscribe(updates);
  fireEvent.click(dialog().getByText(effect.name + " → Master"));
  unsubscribe();
  const state = useAppStore.getState(), added = state.sequencerInstruments[2];
  expect(updates).toHaveBeenCalledOnce();
  expect(added.patchId).toBe(effect.id);
  expect(state.audioGraph.insertOwners).toEqual({});
  const sends = state.audioGraph.routes.filter(r => r.targetId === added.id);
  expect(sends.map(r => [r.sourceId,r.kind,r.targetPort])).toEqual([["source","send","left"],["source","send","right"]]);
  for (const route of sends) expect(state.mixer.sends[route.id]).toEqual({gainDb:null,tap:"post"});
  expect(state.audioGraph.routes.filter(r=>r.sourceId===added.id).map(r=>[r.kind,r.targetId])).toEqual([["main","$master"],["main","$master"]]);
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

it("checks routing from the graph, shows global failures and locates a damaged channel", async () => {
  const graph = emptyAudioGraph();
  graph.routes.push({ id: "lost-channel", sourceId: "source", sourcePort: "lost", sourceStage: "strip",
    targetId: "$master", targetPort: "left", targetStage: "input", kind: "custom" });
  useAppStore.setState({audioGraph: graph});
  vi.spyOn(api, "validateAudio").mockRejectedValueOnce(new Error("Validation unavailable"))
    .mockResolvedValue({diagnostics: [{code: "test", severity: "warning", message: "Whole-performance warning"}]});
  const {container} = routingFixture();
  const check = screen.getByRole("button", {name: "Check routing"});
  fireEvent.click(check);
  const report = within(screen.getByRole("region", {name:"Routing diagnostics"}));
  expect((await report.findByRole("alert")).textContent).toBe("Validation unavailable");
  fireEvent.click(check);
  await report.findByText("Whole-performance warning");
  fireEvent.click(report.getByRole("button", {name: /lost → left/}));
  expect(container.querySelector('[data-route-ids=\'["lost-channel"]\']')?.getAttribute("data-selected")).toBe("true");
  fireEvent.click(report.getByRole("button", {name:"Dismiss"}));
  expect(screen.queryByRole("region", {name:"Routing diagnostics"})).toBeNull();
  expect(document.activeElement).toBe(check);
});

it("offers the existing missing-Master repair in the graph, only while stopped", async () => {
  const graph = {...emptyAudioGraph(), masterId:"lost-master"};
  useAppStore.setState({ audioGraph:graph, activeSessionState:"running" });
  const repair = vi.spyOn(api, "repairPerformanceMaster").mockImplementation(async config =>
    ({...config, audioGraph:{...graph, masterId:"$master"}}));
  routingFixture();
  const button = screen.getByRole("button", {name:"Replace missing Master with internal output"}) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  act(() => useAppStore.setState({activeSessionState:"idle"}));
  fireEvent.click(button);
  await waitFor(() => expect(useAppStore.getState().audioGraph.masterId).toBe("$master"));
  expect(repair).toHaveBeenCalledOnce();
  expect(screen.queryByText("Replace missing Master with internal output")).toBeNull();
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
  fireEvent.click(container.querySelector('[data-routing-node="$master"] .rc-title')!);
  const incoming = screen.getByRole("combobox", {name:"Incoming connections"}) as HTMLSelectElement;
  expect([...incoming.options].filter(o => o.text.includes("Send"))).toHaveLength(2);
  fireEvent.change(incoming, {target:{value:"1right"}});
  const inspector = within(container.querySelector(".rc-inspect") as HTMLElement);
  expect(inspector.getByRole("button", {name:"Remove connection group (4)"})).toBeTruthy();
  fireEvent.change(inspector.getByLabelText("Exact channel mapping"), { target: { value: "1right" } });
  fireEvent.click(inspector.getByText("Reconnect destination"));
  expect((screen.getByLabelText("Individual ports") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(container.querySelector('[data-routing-node="insert"] .rc-socket.in[data-ports=\'["left"]\']')!);
  expect(useAppStore.getState().audioGraph.routes).toEqual(graph.routes.map(r => r.id === "1right" ?
    { ...r, targetId: "insert", targetPort: "left" } : r));
});

it("removes a destination group of parallel sends in one graph edit and keeps other destinations", () => {
  const graph = feedbackGraph();
  const sends = graph.routes.filter(r => r.kind === "send");
  graph.routes.push(...sends.map(r => ({...r, id:"parallel-" + r.id})));
  useAppStore.setState({audioGraph:graph});
  const {action} = routingFixture();
  action('[data-cable-kind="send"]');
  fireEvent.click(screen.getByRole("button", {name:"Remove connection group (4)"}));
  expect(useAppStore.getState().audioGraph.routes).toEqual(graph.routes.filter(r => r.kind !== "send"));
});

it("connects custom before-insert and strip-return sockets without changing insert ownership", () => {
  const { container } = render(<PerformanceEditorProvider><MixerBody surface="routing" onStop={vi.fn()} /></PerformanceEditorProvider>);
  fireEvent.click(screen.getByLabelText("Processing stages"));
  fireEvent.click(container.querySelector('[data-routing-node="source"] .rc-socket.out[data-stage="raw"]')!);
  fireEvent.click(within(screen.getByRole("dialog")).getByText("Custom routing"));
  fireEvent.click(container.querySelector('[data-routing-node="insert"] .rc-socket.in[data-stage="strip"]')!);
  const graph = useAppStore.getState().audioGraph;
  expect(graph.insertOwners).toEqual({});
  expect(graph.routes.map(r => [r.kind, r.sourceStage, r.targetStage, r.sourcePort, r.targetPort])).toEqual([
    ["custom", "raw", "strip", "left", "left"], ["custom", "raw", "strip", "right", "right"],
  ]);
});
