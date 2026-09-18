// @vitest-environment jsdom
import { Profiler, StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/collapsed_gui.json";
import { useAppStore } from "../store/useAppStore";
import { api } from "../api/client";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import * as sequencerMath from "../lib/sequencer";
import * as meterRuntime from "../lib/mixerRuntime";
import * as routing from "../lib/audioRouting";
import { SequencerPage } from "./SequencerPage";
import { CollapsiblePanel, INITIAL_PANEL_COLLAPSE_STATE, type PanelCollapseState } from "./CollapsiblePanel";
import { EditorDetails, PerformanceEditorProvider, usePerformanceEditorState } from "./sequencer/PerformanceEditorState";
import type { SequencerPageProps } from "./sequencer/sequencerPageContracts";
import type { PatchListItem } from "../types";

const allCollapsed = Object.fromEntries(Object.keys(INITIAL_PANEL_COLLAPSE_STATE).map(k => [k, true])) as PanelCollapseState;
const noop = vi.fn();
const action = new Proxy({}, { get: () => noop });
const actions = Object.fromEntries(["instrumentActions", "performanceActions", "transportActions", "melodicTrackActions", "drummerTrackActions", "pianoRollActions", "midiControllerActions", "controllerSequencerActions", "arpeggiatorActions"].map(key => [key, action])) as unknown as Omit<SequencerPageProps, "data" | "collapsedPanels" | "onPanelCollapsedChange">;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
let observers: Set<ResizeObserver>;
function Page({ initiallyCollapsed = true, audible }: { initiallyCollapsed?: boolean; audible?: () => number | null }) {
  const state = useAppStore();
  const [panels, setPanels] = useState(initiallyCollapsed ? allCollapsed : INITIAL_PANEL_COLLAPSE_STATE);
  return <SequencerPage {...actions} collapsedPanels={panels} onPanelCollapsedChange={(panel, collapsed) => setPanels(p => ({ ...p, [panel]: collapsed }))}
    data={{ guiLanguage: "english", patches: state.patches, performances: [], instrumentBindings: state.sequencerInstruments,
      sequencer: mergedSequencerState(state.sequencer, state.sequencerRuntime), sequencerTransportSubunit: state.sequencerRuntime.transportSubunit,
      readPlaybackTransportSubunit: audible, currentPerformanceId: state.currentPerformanceId, performanceName: state.performanceName,
      performanceDescription: "", instrumentsRunning: true, sessionState: "running", midiInputName: null, transportError: null }} />;
}
function togglePanel(name: string) { fireEvent.click(screen.getByRole("button", { name: new RegExp(`^▸?▾?${name}$`) })); }
function details(name: string) { return screen.getAllByText(name).find(node => node.tagName === "SUMMARY")!.parentElement as HTMLDetailsElement; }
function toggleDetails(name: string, open: boolean) {
  const node = details(name);
  act(() => { node.open = open; fireEvent(node, new Event("toggle")); });
}
function tick(step: number) { act(() => useAppStore.getState().syncSequencerRuntime({ isPlaying: true, playhead: step, cycle: 0, transportSubunit: step * 420 })); }
function runFrame(now: number) { act(() => { const batch = [...frames.values()]; frames.clear(); batch.forEach(cb => cb(now)); }); }

beforeEach(() => {
  frames = new Map(); observers = new Set(); frameId = 0; noop.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() { observers.add(this as unknown as ResizeObserver); } disconnect() { observers.delete(this as unknown as ResizeObserver); } });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse"; }
  });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ patches: fixture.patches as PatchListItem[] });
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  useAppStore.getState().syncSequencerRuntime({ isPlaying: true, playhead: 0, cycle: 0, transportSubunit: 0 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); meterRuntime.clearMeters(); });

it("does not build collapsed device grids or run their observers and animation frames", () => {
  const notes = vi.spyOn(sequencerMath, "buildSequencerNoteOptions");
  const curves = vi.spyOn(sequencerMath, "buildControllerCurvePath");
  const diagnostics = vi.spyOn(routing, "audioGraphDiagnostics");
  const { container } = render(<Page />);
  toggleDetails("Mixer", false);
  const hidden = [...container.querySelectorAll("div[hidden]")];
  expect(hidden).toHaveLength(8);
  expect(hidden.every(body => body.childNodes.length === 0)).toBe(true);
  expect(notes).not.toHaveBeenCalled(); expect(curves).not.toHaveBeenCalled(); expect(diagnostics).not.toHaveBeenCalled();
  for (let step = 1; step <= 12; step++) tick(step);
  expect(notes).not.toHaveBeenCalled(); expect(curves).not.toHaveBeenCalled();
  expect(frames.size).toBe(0); expect(observers.size).toBe(0);
  expect(useAppStore.getState().sequencerRuntime.transportSubunit).toBe(12 * 420);
  expect(screen.getByText(/playhead: 5/)).toBeTruthy();
});

it("cancels controller loops on collapse and resumes at the latest audible position exactly once", () => {
  const { container } = render(<StrictMode><Page audible={() => 1680} /></StrictMode>);
  togglePanel("Controller Sequencers");
  expect(frames.size).toBe(1);
  const cursor = () => container.querySelector('line[stroke-dasharray="5 4"]');
  const initialX = cursor()!.getAttribute("x1");
  expect(Number(initialX)).toBeGreaterThan(0);
  runFrame(16); expect(cursor()!.getAttribute("x1")).not.toBe(initialX);
  for (let repeat = 0; repeat < 3; repeat++) {
    togglePanel("Controller Sequencers");
    expect(cursor()).toBeNull(); expect(frames.size).toBe(0); expect(observers.size).toBe(0);
    tick(8); runFrame(1000);
    togglePanel("Controller Sequencers");
    expect(cursor()!.getAttribute("x1")).toBe(initialX); expect(frames.size).toBe(1);
  }
  act(() => useAppStore.getState().syncSequencerRuntime({ isPlaying: false }));
  expect(frames.size).toBe(0); expect(cursor()).toBeNull();
});

it("preserves a rename draft and grid scroll while other panels continue updating", () => {
  const { container } = render(<Page />);
  togglePanel("Melodic Sequencers");
  fireEvent.click(screen.getByRole("button", { name: "Rename: Warm Lead" }));
  fireEvent.change(container.querySelector('input[aria-invalid]')!, { target: { value: "Unfinished name" } });
  const grid = container.querySelector(".overflow-x-auto.pb-1")!;
  fireEvent.scroll(grid, { target: { scrollLeft: 214, scrollTop: 12 } });
  togglePanel("Melodic Sequencers");
  expect(container.querySelector('input[aria-invalid]')).toBeNull();
  togglePanel("Drummer Sequencers"); tick(4);
  expect(container.querySelectorAll("article").length).toBeGreaterThan(0);
  togglePanel("Melodic Sequencers");
  expect((container.querySelector('input[aria-invalid]') as HTMLInputElement).value).toBe("Unfinished name");
  expect(container.querySelector(".overflow-x-auto.pb-1")!.scrollLeft).toBe(214);
  expect(container.querySelector(".overflow-x-auto.pb-1")!.scrollTop).toBe(12);
});

it("unsubscribes hidden meters and restores the newest meter snapshot without hidden React commits", () => {
  const commits = vi.fn();
  const { container } = render(<Profiler id="page" onRender={commits}><Page /></Profiler>);
  expect(container.querySelectorAll('[aria-label$=" meter"]').length).toBeGreaterThan(0);
  toggleDetails("Mixer", false);
  commits.mockClear();
  act(() => meterRuntime.publishMeters({ $output: { peakL: 1, peakR: 1, rmsL: 0.5, rmsR: 0.5 } }));
  expect(commits).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label$=" meter"]')).toBeNull();
  toggleDetails("Mixer", true);
  expect(screen.getAllByText("CLIP")).toHaveLength(2);
});

it("retains nested Mixer expansion and forms but omits closed diagnostics construction", () => {
  const diagnostics = vi.spyOn(routing, "audioGraphDiagnostics");
  render(<Page />);
  expect(diagnostics).not.toHaveBeenCalled();
  const routingDetails = details("Audio routing");
  const source = within(routingDetails).getAllByRole("combobox")[0];
  fireEvent.change(source, { target: { value: "binding-collapse-test" } });
  const subdetails = [...routingDetails.querySelectorAll("details")];
  expect(subdetails.length).toBeGreaterThan(0);
  const chosen = subdetails[0]; const label = chosen.querySelector("summary")!.textContent!;
  toggleDetails(label, true); toggleDetails("Audio routing", false);
  expect(routingDetails.querySelector("select")).toBeNull();
  toggleDetails("Mixer", false); tick(4); toggleDetails("Mixer", true);
  expect(details("Audio routing").open).toBe(false);
  toggleDetails("Audio routing", true);
  expect(details(label).open).toBe(true);
  expect((within(details("Audio routing")).getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("binding-collapse-test");
});

it("releases manually held piano notes once when the keyboard collapses", () => {
  const { container } = render(<StrictMode><Page /></StrictMode>);
  togglePanel("Piano Rolls");
  const key = container.querySelector(".overflow-x-auto.pb-1 button");
  expect(key).toBeTruthy();
  fireEvent.pointerDown(key!, { pointerId: 9, pointerType: "touch", button: 0 });
  expect(noop).toHaveBeenCalled();
  noop.mockClear(); togglePanel("Piano Rolls");
  expect(noop).toHaveBeenCalledTimes(1);
  expect(noop.mock.calls[0]).toHaveLength(3);
  expect(useAppStore.getState().sequencerRuntime.isPlaying).toBe(true);
});

it("retains editor state through unmount, prunes deleted owners, and keeps ordinary panels mounted by default", () => {
  const lazyBody = vi.fn();
  function Draft() {
    const [value, setValue] = usePerformanceEditorState("device:one", "draft", "");
    return <input aria-label="Draft" value={value} onChange={e => setValue(e.target.value)} />;
  }
  function Harness({ exists = true, generation = 0 }) {
    const [closed, setClosed] = useState(false);
    return <PerformanceEditorProvider key={generation} owners={exists ? ["device:one", "mixer"] : ["mixer"]}>
      <CollapsiblePanel title="Draft panel" collapsed={closed} onCollapsedChange={setClosed} unmountOnCollapse>{exists && <Draft />}</CollapsiblePanel>
      <EditorDetails owner="mixer" field="test" summary="Lazy">{() => { lazyBody(); return <div>Body</div>; }}</EditorDetails>
    </PerformanceEditorProvider>;
  }
  const view = render(<Harness />);
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Keep me" } });
  togglePanel("Draft panel"); expect(screen.queryByLabelText("Draft")).toBeNull();
  togglePanel("Draft panel"); expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Keep me");
  view.rerender(<Harness exists={false} />); view.rerender(<Harness />);
  expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("");
  expect(lazyBody).not.toHaveBeenCalled();
  view.unmount();
  render(<CollapsiblePanel title="Legacy" collapsed onCollapsedChange={noop}><span>Legacy child</span></CollapsiblePanel>);
  expect(screen.getByText("Legacy child").closest("[hidden]")).toBeTruthy();
});

it("cancels a pending transpose long-press when the melodic panel unmounts", () => {
  const view = render(<Page />); togglePanel("Melodic Sequencers");
  vi.useFakeTimers();
  try {
    fireEvent.pointerDown(screen.getByRole("button", { name: "Transpose pattern pad #1 up (click: in-scale, hold: key-step)" }), { pointerId: 1, pointerType: "mouse", button: 0 });
    togglePanel("Melodic Sequencers"); noop.mockClear();
    act(() => vi.advanceTimersByTime(1000));
    expect(noop).not.toHaveBeenCalled();
  } finally { view.unmount(); vi.useRealTimers(); }
});

it("preserves arranger zoom, selection, position and scroll while closing menus on collapse", () => {
  const { container } = render(<Page />); togglePanel("Multitrack Arranger");
  fireEvent.click(screen.getByRole("button", { name: "Zoom +" }));
  const list = container.querySelector('[role="list"]')!;
  const token = within(list as HTMLElement).getAllByRole("listitem")[0];
  fireEvent.click(token);
  const selectedStyle = token.style.width;
  fireEvent.change(screen.getByRole("spinbutton", { name: /Position/ }), { target: { value: "32" } });
  const scrollbar = container.querySelector(".h-4.overflow-x-auto")!;
  Object.defineProperty(scrollbar, "clientWidth", { value: 100 });
  fireEvent.scroll(scrollbar, { target: { scrollLeft: 30 } });
  fireEvent.contextMenu(token, { clientX: 100, clientY: 30 });
  expect(screen.getByRole("menu")).toBeTruthy();
  togglePanel("Multitrack Arranger"); tick(4); togglePanel("Multitrack Arranger");
  const restored = within(container.querySelector('[role="list"]') as HTMLElement).getAllByRole("listitem")[0];
  expect(restored.style.width).toBe(selectedStyle);
  expect(restored.className).toContain("ring-2");
  expect(container.querySelector(".h-4.overflow-x-auto")!.scrollLeft).toBe(30);
  expect((screen.getByRole("spinbutton", { name: /Position/ }) as HTMLInputElement).value).toBe("32");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Paste$/ })).toBeNull();
});

it("retains rack controller drafts and clears them only on a new workspace generation", () => {
  render(<Page />); togglePanel("Instrument Rack");
  const entry = screen.getByRole("spinbutton", { name: /Cutoff/ });
  fireEvent.change(entry, { target: { value: "2345" } });
  togglePanel("Instrument Rack"); tick(3);
  act(() => useAppStore.setState({ currentPerformanceId: "first-save" }));
  togglePanel("Instrument Rack");
  expect((screen.getByRole("spinbutton", { name: /Cutoff/ }) as HTMLInputElement).value).toBe("2345");
  act(() => useAppStore.setState(s => ({ performanceWorkspaceGeneration: s.performanceWorkspaceGeneration + 1 })));
  expect((screen.getByRole("spinbutton", { name: /Cutoff/ }) as HTMLInputElement).value).toBe("1000");
});

it("shows pad switches received while hidden and retains the arpeggiator preset draft", () => {
  render(<Page />);
  togglePanel("Arpeggiators");
  const preset = screen.getByRole("textbox", { name: "Save as preset" });
  fireEvent.change(preset, { target: { value: "Unfinished preset" } });
  togglePanel("Arpeggiators");
  act(() => useAppStore.getState().syncSequencerRuntime({ isPlaying: true, tracks: [{ trackId: "tracks-1", activePad: 1, queuedPad: null }] }));
  togglePanel("Melodic Sequencers");
  expect(screen.getAllByRole("button", { name: "#1" }).some(button => button.getAttribute("aria-pressed") === "true")).toBe(true);
  expect(screen.getByText("Playing: #2")).toBeTruthy();
  togglePanel("Arpeggiators");
  expect((screen.getByRole("textbox", { name: "Save as preset" }) as HTMLInputElement).value).toBe("Unfinished preset");
});

it("removes body-owned global listeners and meter subscriptions under Strict Mode", () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const subscribe = meterRuntime.subscribeMeters;
  const active = new Set<() => void>();
  vi.spyOn(meterRuntime, "subscribeMeters").mockImplementation(callback => {
    active.add(callback); const unsubscribe = subscribe(callback);
    return () => { active.delete(callback); unsubscribe(); };
  });
  render(<StrictMode><Page initiallyCollapsed={false} /></StrictMode>);
  expect(active.size).toBe(3);
  for (const name of ["Instrument Rack", "Melodic Sequencers", "Drummer Sequencers", "Controller Sequencers", "Arpeggiators", "Piano Rolls", "MIDI Controllers \\(1/6\\)", "Multitrack Arranger"]) togglePanel(name);
  toggleDetails("Mixer", false);
  expect(active.size).toBe(0); expect(frames.size).toBe(0); expect(observers.size).toBe(0);
  for (const [event, handler] of add.mock.calls.filter(([event]) => ["resize", "pointermove", "pointerup", "mousedown", "keydown"].includes(event))) {
    expect(remove.mock.calls.some(([removedEvent, removedHandler]) => event === removedEvent && handler === removedHandler)).toBe(true);
  }
  toggleDetails("Mixer", true); expect(active.size).toBe(3);
});

it("keeps pending audio-control synchronization alive when Mixer collapses", async () => {
  render(<Page />);
  vi.useFakeTimers();
  try {
    const state = useAppStore.getState();
    useAppStore.setState({ activeSessionId: "collapse-audio-test", activeSessionAudioSignature: JSON.stringify({ graph: state.audioGraph, patches: state.patches.map(patch => [patch.id, patch.updated_at]) }) });
    vi.spyOn(api, "getMixer").mockResolvedValue({ mixer: state.mixer, revision: 1 });
    const update = vi.spyOn(api, "updateMixer").mockResolvedValue({ mixer: state.mixer, revision: 2 });
    fireEvent.change(screen.getAllByRole("spinbutton", { name: "Gain dB" })[0], { target: { value: "-9" } });
    toggleDetails("Mixer", false);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(update).toHaveBeenCalledWith("collapse-audio-test", expect.objectContaining({ strips: expect.objectContaining({ "binding-collapse-test": expect.objectContaining({ gainDb: -9 }) }) }), 1);
  } finally { vi.useRealTimers(); }
});

it("retains asynchronous Mixer feedback across collapse but isolates results from replaced workspaces", async () => {
  let finish!: (result: { diagnostics: import("../types").AudioDiagnostic[] }) => void;
  vi.spyOn(api, "validateAudio").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Page />);
  toggleDetails("Routing diagnostics", true);
  fireEvent.click(screen.getByRole("button", { name: "Check routing" }));
  toggleDetails("Mixer", false);
  await act(async () => finish({ diagnostics: [{ code: "test-feedback", message: "Retained result", severity: "warning" }] }));
  toggleDetails("Mixer", true);
  expect(screen.getByText(/Retained result/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check routing" }));
  act(() => useAppStore.setState(state => ({ performanceWorkspaceGeneration: state.performanceWorkspaceGeneration + 1 })));
  await act(async () => finish({ diagnostics: [{ code: "test-feedback", message: "Stale result", severity: "warning" }] }));
  toggleDetails("Routing diagnostics", true);
  expect(screen.queryByText(/Stale result/)).toBeNull();
});

it("discards deleted arranger selections so adding positions later does not revive them", () => {
  const { container } = render(<Page />); togglePanel("Multitrack Arranger");
  const list = container.querySelector('[role="list"]')!;
  fireEvent.click(within(list as HTMLElement).getAllByRole("listitem")[1]);
  togglePanel("Multitrack Arranger");
  const pattern = useAppStore.getState().sequencer.tracks[0].padLoopPattern;
  const replace = (rootSequence: typeof pattern.rootSequence) => act(() => useAppStore.setState(state => ({
    sequencer: { ...state.sequencer, tracks: state.sequencer.tracks.map(track => ({ ...track, padLoopPattern: { ...pattern, rootSequence } })) }
  })));
  replace(pattern.rootSequence.slice(0, 1)); togglePanel("Multitrack Arranger");
  replace(pattern.rootSequence);
  const second = within(container.querySelector('[role="list"]') as HTMLElement).getAllByRole("listitem")[1];
  expect(second.className).not.toContain("ring-2");
});
