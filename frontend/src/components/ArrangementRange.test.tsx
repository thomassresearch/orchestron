// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import { useAppStore } from "../store/useAppStore";
import { arrangementRangeLanes } from "../lib/arrangementRange";
import { MultitrackArranger } from "./MultitrackArranger";
import { createPerformanceEditorStore, PerformanceEditorProvider, type PerformanceEditorStore } from "./sequencer/PerformanceEditorState";

const noop = () => {};
const copy = new Proxy({ selectionHint: "Loop ruler" }, { get: (target, key) => key in target ? target[key as keyof typeof target] :
  String(key).endsWith("WithIndex") ? (index: number) => `Track ${index}` : String(key) }) as ComponentProps<typeof MultitrackArranger>["copy"];
const loopChanged = vi.fn();
function Arranger({ collapsed = false }: { collapsed?: boolean }) {
  const sequencer = useAppStore(state => state.sequencer);
  return <MultitrackArranger collapsed={collapsed} onCollapsedChange={noop} guiLanguage="english" copy={copy}
    sequencer={sequencer} patches={[]} instrumentBindings={[]} onTransportPlay={noop} onTransportStop={noop} onTransportStopDoubleClick={noop}
    onTransportRewind={noop} onTransportFastForward={noop} onArrangerLoopSelectionChange={loopChanged}
    onArrangementRangeChange={(updates, action) => useAppStore.getState().applyArrangementRangeEdit(updates, action)} />;
}
function Workspace({ store, visible = true, collapsed = false }: { store: PerformanceEditorStore; visible?: boolean; collapsed?: boolean }) {
  return visible ? <PerformanceEditorProvider retainedStore={store}><Arranger collapsed={collapsed} /></PerformanceEditorProvider> : null;
}
const pad = (padIndex: number) => ({ type: "pad" as const, padIndex });
const root = (index = 0) => arrangementRangeLanes(useAppStore.getState().sequencer)[index].pattern.rootSequence;
const pointer = (time: number, lane = 0, extra: PointerEventInit = {}) => ({ clientX: 100 + time * 72, clientY: 100 + lane * 70 + 20, pointerId: 1, button: 0, ...extra });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  useAppStore.getState().addDrummerSequencerTrack();
  useAppStore.getState().addControllerSequencer();
  const sequencer = useAppStore.getState().sequencer;
  const configure = <T extends { pads: { lengthBeats: number }[] }>(track: T) => ({ ...track,
    padLoopPattern: { rootSequence: [pad(0), pad(0), pad(1), pad(1)], groups: [], superGroups: [] }, padLoopSequence: [0, 0, 1, 1],
    pads: track.pads.map(p => ({ ...p, lengthBeats: 8 as const })) });
  useAppStore.setState({ sequencer: { ...sequencer, tracks: sequencer.tracks.map(configure), drummerTracks: sequencer.drummerTracks.map(configure),
    controllerSequencers: sequencer.controllerSequencers.map(configure) } });
  loopChanged.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function geometry() {
  const ruler = screen.getByRole("group", { name: "Arrangement edit ruler" });
  vi.spyOn(ruler, "getBoundingClientRect").mockReturnValue({ left: 100, top: 70, bottom: 94 } as DOMRect);
  const timelines = screen.getAllByRole("list");
  timelines.forEach((node, index) => vi.spyOn(node, "getBoundingClientRect").mockReturnValue({ left: 100, top: 100 + index * 70, bottom: 148 + index * 70 } as DOMRect));
  return { ruler, timelines, surface: screen.getByRole("group", { name: "Range actions" }) };
}
function setup() {
  const store = createPerformanceEditorStore();
  const view = render(<Workspace store={store} />);
  return { ...view, store, ...geometry() };
}
function select(ruler: HTMLElement, start = 0, end = 16) {
  fireEvent.pointerDown(ruler, pointer(start)); fireEvent.pointerMove(ruler, pointer(end)); fireEvent.pointerUp(ruler, pointer(end));
}
function destination(ruler: HTMLElement, time: number) { fireEvent.pointerDown(ruler, pointer(time)); fireEvent.pointerUp(ruler, pointer(time)); }
function shortcut(surface: HTMLElement, key: string, shiftKey = false) { fireEvent.keyDown(surface, { key, ctrlKey: true, shiftKey }); }

it("selects all collapsed lanes and duplicates 16 beats as one edit, with repeated duplicate and undo/redo", () => {
  const { ruler, surface, timelines } = setup();
  const before = useAppStore.getState();
  select(ruler);
  expect(loopChanged).not.toHaveBeenCalled();
  expect(screen.getByText(`16 beats · ${timelines.length} lanes`)).toBeTruthy();
  expect(timelines.every(t => t.querySelector("[data-range-selection]"))).toBe(true);
  shortcut(surface, "d", true);
  expect(root()).toEqual([pad(0), pad(0), pad(0), pad(0), pad(1), pad(1)]);
  expect(useAppStore.getState().sequencerEditRevision).toBe(before.sequencerEditRevision + 1);
  expect(useAppStore.getState().sequencer.arrangerLoopSelection).toBe(before.sequencer.arrangerLoopSelection);
  shortcut(surface, "d", true);
  expect(root()).toHaveLength(8);
  shortcut(surface, "z"); expect(root()).toHaveLength(6);
  shortcut(surface, "z"); expect(root()).toEqual(before.sequencer.tracks[0].padLoopPattern.rootSequence);
  shortcut(surface, "z", true); expect(root()).toHaveLength(6);
  expect(loopChanged).not.toHaveBeenCalled();
});

it("Shift-drags occupied content across some lanes and inserts only copied lanes through the menu", () => {
  const { timelines, ruler } = setup();
  const clip = within(timelines[0]).getAllByRole("listitem")[0];
  fireEvent.pointerDown(clip, pointer(0, 0, { shiftKey: true }));
  fireEvent.pointerMove(clip, pointer(16, 1, { shiftKey: true }));
  fireEvent.pointerUp(clip, pointer(16, 1, { shiftKey: true }));
  expect(screen.getByText("16 beats · 2 lanes")).toBeTruthy();
  fireEvent.contextMenu(ruler, pointer(8));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Duplicate — insert, selected lanes only/ }));
  expect(root(0)).toHaveLength(6); expect(root(1)).toHaveLength(6); expect(root(2)).toHaveLength(4);
});

it("copies a rectangle from empty background and inserts silence on unselected lanes with Shift+V", () => {
  const { timelines, ruler, surface } = setup();
  fireEvent.pointerDown(timelines[0], pointer(0));
  fireEvent.pointerMove(timelines[0], pointer(16));
  fireEvent.pointerUp(timelines[0], pointer(16));
  expect(screen.getByText("16 beats · 1 lane")).toBeTruthy();
  shortcut(surface, "c"); destination(ruler, 16); shortcut(surface, "v", true);
  expect(root(0)).toHaveLength(6);
  expect(root(1)).toEqual([pad(0), pad(0), { type: "pause", lengthBeats: 16 }, pad(1), pad(1)]);
  expect(root(2)).toEqual(root(1));
});

it("overwrites without shifting later material, and retains clipboard after clearing selection", () => {
  const { ruler, surface } = setup();
  select(ruler, 0, 8); shortcut(surface, "c"); destination(ruler, 16); shortcut(surface, "v");
  expect(root()).toEqual([pad(0), pad(0), pad(0), pad(1)]);
  shortcut(surface, "z");
  destination(ruler, 24); shortcut(surface, "v");
  expect(root()).toEqual([pad(0), pad(0), pad(1), pad(0)]);
});

it("rejects partial-element paste with a reason and disables the matching menu action", () => {
  const { ruler, surface } = setup();
  select(ruler, 0, 8); shortcut(surface, "c"); destination(ruler, 4);
  const before = useAppStore.getState();
  shortcut(surface, "v");
  expect(useAppStore.getState()).toBe(before);
  expect(screen.getByRole("alert").textContent).toContain("element boundary");
  fireEvent.contextMenu(ruler, pointer(4));
  const action = screen.getByRole("menuitem", { name: /^Paste — overwrite/ }) as HTMLButtonElement;
  expect(action.disabled).toBe(true); expect(action.title).toContain("element boundary");
});

it("Alt-drags a selected occurrence as a range copy and Shift switches the preview to all-lane insertion", () => {
  const { ruler, timelines } = setup();
  select(ruler, 0, 16);
  const clip = within(timelines[0]).getAllByRole("listitem")[0];
  fireEvent.pointerDown(clip, pointer(1, 0, { altKey: true }));
  fireEvent.pointerMove(clip, pointer(17, 0, { altKey: true }));
  expect(screen.getByText(/Overwrite ·/)).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("group", { name: "Range actions" }), { key: "Shift", shiftKey: true });
  expect(screen.getByText(/Insert \+16 beats · all lanes/)).toBeTruthy();
  fireEvent.pointerUp(clip, pointer(17, 0, { altKey: true, shiftKey: true }));
  fireEvent.click(clip, { altKey: true });
  expect(root()).toHaveLength(6);
  expect(screen.getByText(`16 beats · ${timelines.length} lanes`)).toBeTruthy();
});

it.each(["pointerCancel", "lostPointerCapture", "escape", "blur"])("cancels %s without changing authorship or the prior range", event => {
  const { ruler, surface, timelines } = setup();
  select(ruler, 0, 8);
  const before = useAppStore.getState();
  const clip = within(timelines[0]).getAllByRole("listitem")[0];
  fireEvent.pointerDown(clip, pointer(1, 0, { altKey: true }));
  fireEvent.pointerMove(clip, pointer(17, 0, { altKey: true }));
  if (event === "escape") fireEvent.keyDown(surface, { key: "Escape" });
  else if (event === "blur") fireEvent.blur(window);
  else fireEvent[event as "pointerCancel" | "lostPointerCapture"](surface, pointer(17));
  fireEvent.pointerUp(surface, pointer(17, 0, { altKey: true }));
  expect(useAppStore.getState()).toBe(before);
  expect(screen.getByText(`8 beats · ${timelines.length} lanes`)).toBeTruthy();
  expect(surface.querySelector("[data-range-preview]")).toBeNull();
});

it("keeps saved history through editor remounts while resetting session-only clipboard", () => {
  const view = setup();
  select(view.ruler); shortcut(view.surface, "c"); shortcut(view.surface, "d", true);
  view.rerender(<Workspace store={view.store} collapsed />);
  expect(screen.queryByRole("group", { name: "Arrangement edit ruler" })).toBeNull();
  view.rerender(<Workspace store={view.store} />);
  expect(screen.getByText(`16 beats · ${view.timelines.length} lanes`)).toBeTruthy();
  view.rerender(<Workspace store={view.store} visible={false} />);
  view.rerender(<Workspace store={view.store} />);
  const { ruler, surface } = geometry();
  shortcut(surface, "z"); expect(root()).toHaveLength(4);
  destination(ruler, 16); shortcut(surface, "v", true); expect(root()).toHaveLength(6);
  view.rerender(<Workspace store={view.store} visible={false} />);
  view.rerender(<Workspace store={createPerformanceEditorStore()} />);
  shortcut(screen.getByRole("group", { name: "Range actions" }), "z"); expect(root()).toHaveLength(4);
  shortcut(screen.getByRole("group", { name: "Range actions" }), "v");
  expect(screen.getByRole("alert").textContent).toBe("Copy a range first.");
});

it("keeps history through runtime updates and clears it for external changes to recorded patterns", () => {
  const { ruler, surface } = setup();
  select(ruler); shortcut(surface, "d", true);
  act(() => useAppStore.getState().syncSequencerRuntime({ isPlaying: true, playhead: 7, cycle: 2 }));
  shortcut(surface, "z"); expect(root()).toHaveLength(4);
  shortcut(surface, "z", true); expect(root()).toHaveLength(6);
  const track = useAppStore.getState().sequencer.tracks[0];
  act(() => useAppStore.getState().setSequencerTrackPadLoopPattern(track.id, { ...track.padLoopPattern, definitionColors: { "pad:0": "#123456" } }));
  expect(useAppStore.getState().arrangerHistory.entries).toHaveLength(0);
  shortcut(surface, "z"); expect(root()).toHaveLength(6);
  expect(useAppStore.getState().sequencer.tracks[0].padLoopPattern.definitionColors).toEqual({ "pad:0": "#123456" });
  expect(screen.getByRole("status").textContent).toContain("history was cleared");
});

it("maps zoomed and scrolled ruler positions without seeking the loop transport", () => {
  const { ruler, surface, container } = setup();
  fireEvent.click(screen.getByRole("button", { name: "zoomIn" }));
  const scrollbar = container.querySelector(".h-4.overflow-x-auto")!;
  Object.defineProperty(scrollbar, "clientWidth", { value: 100 });
  fireEvent.scroll(scrollbar, { target: { scrollLeft: 250 } });
  const timeline = screen.getAllByRole("list")[0];
  const pixelsPerBeat = parseFloat(timeline.style.backgroundSize);
  const at = (time: number) => pointer(0, 0, { clientX: 100 + time * pixelsPerBeat - 250 });
  fireEvent.pointerDown(ruler, at(8)); fireEvent.pointerUp(ruler, at(24));
  expect(screen.getByText(`16 beats · ${screen.getAllByRole("list").length} lanes`)).toBeTruthy();
  shortcut(surface, "d", true);
  expect(root()).toEqual([pad(0), pad(0), pad(1), pad(0), pad(1), pad(1)]);
  expect(loopChanged).not.toHaveBeenCalled();
});

it("extends a range with the keyboard and leaves text-field shortcuts alone", () => {
  const { ruler, timelines } = setup();
  destination(ruler, 0);
  fireEvent.keyDown(timelines[0], { key: "ArrowRight", shiftKey: true });
  expect(screen.getByText("8 beats · 1 lane")).toBeTruthy();
  fireEvent.keyDown(timelines[0], { key: "ArrowDown", shiftKey: true });
  expect(screen.getByText("8 beats · 2 lanes")).toBeTruthy();
  fireEvent.keyDown(timelines[0], { key: "F10", shiftKey: true });
  expect(screen.getByRole("menu", { name: "Range actions" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  const clip = within(timelines[0]).getAllByRole("listitem")[0];
  fireEvent.keyDown(clip, { key: "Enter" });
  const input = screen.getByRole("spinbutton");
  const before = useAppStore.getState();
  fireEvent.keyDown(input, { key: "d", shiftKey: true, ctrlKey: true });
  expect(useAppStore.getState()).toBe(before);
});

it("selects and pastes at fractional master-beat boundaries on a rational lane", () => {
  const sequencer = useAppStore.getState().sequencer;
  useAppStore.setState({ sequencer: { ...sequencer, drummerTracks: [], controllerSequencers: [], tracks: sequencer.tracks.map(track => ({ ...track,
    timing: { ...track.timing, beatRateNumerator: 3, beatRateDenominator: 2 }, pads: track.pads.map(p => ({ ...p, lengthBeats: 1 })) })) } });
  const { ruler, surface, timelines } = setup();
  const clip = within(timelines[0]).getAllByRole("listitem")[1];
  fireEvent.pointerDown(clip, pointer(0.8, 0, { shiftKey: true }));
  fireEvent.pointerUp(clip, pointer(1.1, 0, { shiftKey: true }));
  expect(screen.getByText("0.6667 beats · 1 lane")).toBeTruthy();
  shortcut(surface, "c"); destination(ruler, 4 / 3); shortcut(surface, "v");
  expect(root()).toEqual([pad(0), pad(0), pad(0), pad(1)]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps a lane's Position field synchronized with a background click", () => {
  const { timelines } = setup();
  fireEvent.click(within(timelines[0]).getAllByRole("listitem")[0]);
  fireEvent.pointerDown(timelines[0], pointer(24)); fireEvent.pointerUp(timelines[0], pointer(24));
  fireEvent.click(timelines[0], pointer(24));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("24");
  expect(within(timelines[0]).getAllByRole("listitem")[0].getAttribute("aria-selected")).toBe("false");
});
