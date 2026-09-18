// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import { useAppStore } from "../store/useAppStore";
import { useLaneOutput } from "../lib/laneOutput";
import { MultitrackArranger } from "./MultitrackArranger";
import { PadLoopPatternEditor } from "./sequencer/PadLoopPatternEditor";
import { PerformanceEditorProvider } from "./sequencer/PerformanceEditorState";
import { SEQUENCER_UI_COPY } from "./sequencer/sequencerUiCopy";

const selectionChanged = vi.fn();
const noop = () => {};
const copy = new Proxy({ selectionHint: "Loop ruler", clearSelection: "Clear loop" }, {
  get: (target, key) => key in target ? target[key as keyof typeof target] :
    String(key).endsWith("WithIndex") ? (index: number) => `Track ${index}` : String(key)
}) as ComponentProps<typeof MultitrackArranger>["copy"];

function Arranger() {
  const sequencer = useAppStore(state => state.sequencer);
  return <MultitrackArranger collapsed={false} onCollapsedChange={noop} guiLanguage="english" copy={copy}
    sequencer={sequencer} patches={[]} instrumentBindings={[]} onTransportPlay={noop} onTransportStop={noop}
    onTransportStopDoubleClick={noop} onTransportRewind={noop} onTransportFastForward={noop}
    onArrangerLoopSelectionChange={selectionChanged} onSequencerTrackPadLoopPatternChange={(id, pattern) => useAppStore.getState().setSequencerTrackPadLoopPattern(id, pattern)}
    onDrummerSequencerTrackPadLoopPatternChange={noop} onControllerSequencerPadLoopPatternChange={noop} />;
}

beforeEach(() => {
  vi.stubGlobal("DragEvent", class extends MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init: DragEventInit) { super(type, init); this.dataTransfer = init.dataTransfer ?? null; }
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  });
  selectionChanged.mockReset();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const view = render(<Arranger />);
  const ruler = screen.getByLabelText("Loop ruler");
  vi.spyOn(ruler, "getBoundingClientRect").mockReturnValue({ left: 100 } as DOMRect);
  return { ...view, ruler };
}
const pointer = (step: number) => ({ clientX: 100 + step * 9, pointerId: 1, pointerType: "mouse", button: 0 });

it.each([null, { startStep: 0, endStep: 16 }, { startStep: 24, endStep: 32 }])(
  "clicks seek and clear the loop, including clicks outside %j", selection => {
    useAppStore.getState().setSequencerArrangerLoopSelection(selection);
    const { ruler } = setup();
    fireEvent.pointerDown(ruler, pointer(9));
    fireEvent.pointerUp(ruler, pointer(9));
    expect(selectionChanged).toHaveBeenCalledExactlyOnceWith(null, 8);
  }
);

it.each([
  [1, 17, 18, { startStep: 0, endStep: 24 }],
  [18, 9, 1, { startStep: 0, endStep: 24 }],
  [9, 10, 10, { startStep: 8, endStep: 16 }]
])("previews a drag from %s and commits the final pointer position on release", (start, move, end, selection) => {
  const { ruler } = setup();
  fireEvent.pointerDown(ruler, pointer(start));
  fireEvent.pointerMove(ruler, pointer(move));
  expect(selectionChanged).not.toHaveBeenCalled();
  expect(ruler.querySelector("span.border-x")).toBeTruthy();
  fireEvent.pointerUp(ruler, pointer(end));
  expect(selectionChanged).toHaveBeenCalledExactlyOnceWith(selection);
});

it("recognizes a drag without an intermediate move event", () => {
  const { ruler } = setup();
  fireEvent.pointerDown(ruler, pointer(1));
  fireEvent.pointerUp(ruler, pointer(9));
  expect(selectionChanged).toHaveBeenCalledExactlyOnceWith({ startStep: 0, endStep: 16 });
});

it.each(["pointerCancel", "lostPointerCapture"] as const)("cancels the preview on %s without changing playback", event => {
  useAppStore.getState().setSequencerArrangerLoopSelection({ startStep: 24, endStep: 32 });
  const { ruler } = setup();
  fireEvent.pointerDown(ruler, pointer(1));
  fireEvent.pointerMove(ruler, pointer(9));
  fireEvent[event](ruler, pointer(9));
  fireEvent.pointerUp(ruler, pointer(9));
  expect(selectionChanged).not.toHaveBeenCalled();
  expect((ruler.querySelector("span.border-x") as HTMLElement).style.left).toBe("216px");
});

it("maps a scrolled, zoomed ruler to the correct beat", () => {
  const { ruler, container } = setup();
  fireEvent.click(screen.getByRole("button", { name: "zoomIn" }));
  const scrollbar = container.querySelector(".h-4.overflow-x-auto")!;
  Object.defineProperty(scrollbar, "clientWidth", { value: 100 });
  fireEvent.scroll(scrollbar, { target: { scrollLeft: 60 } });
  const pixelsPerBeat = Number.parseFloat((ruler.firstElementChild as HTMLElement).style.backgroundSize);
  const event = { ...pointer(0), clientX: 100 + 3.5 * pixelsPerBeat - 60 };
  fireEvent.pointerDown(ruler, event);
  fireEvent.pointerUp(ruler, event);
  expect(selectionChanged).toHaveBeenCalledExactlyOnceWith(null, 24);
});


it("collapses a selected lane, clears highlights on empty space, and reopens on occurrence selection", () => {
  setup();
  const lane = screen.getAllByRole("region")[0];
  const ui = within(lane);
  const toggle = ui.getAllByRole("button")[0];
  const timeline = ui.getByRole("list");
  const clip = within(timeline).getAllByRole("listitem")[0];
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(ui.queryByLabelText("Patterns and phrases")).toBeNull();
  fireEvent.click(clip);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(clip.className).toContain("ring-2");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(ui.queryByLabelText("Patterns and phrases")).toBeNull();
  fireEvent.click(timeline, { clientX: 250 });
  expect(clip.className).not.toContain("ring-2");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(clip);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(ui.getByLabelText("Patterns and phrases")).toBeTruthy();
});

function musicalLane() {
  const track = useAppStore.getState().sequencer.tracks[0];
  useAppStore.getState().setSequencerTrackPadLoopPattern(track.id, { rootSequence: [
    { type: "pad", padIndex: 0 }, { type: "pad", padIndex: 1 }, { type: "group", groupId: "A" }
  ], groups: [{ id: "A", sequence: [{ type: "pad", padIndex: 0 }] }], superGroups: [] });
  const store = useAppStore.getState();
  for (const pad of [0, 2]) {
    store.selectSequencerEditingPad(track.id, pad);
    store.setSequencerTrackStepNote(track.id, 0, 60);
  }
  setup();
  const lane = screen.getAllByRole("region")[0];
  return { lane, timeline: within(lane).getByRole("list"), pattern: () => useAppStore.getState().sequencer.tracks[0].padLoopPattern };
}

it("preserves modifier selection on right-click and explicitly updates an existing group", () => {
  const { timeline, pattern } = musicalLane();
  const clips = within(timeline).getAllByRole("listitem");
  fireEvent.click(clips[0]); fireEvent.click(clips[1], { metaKey: true });
  fireEvent.contextMenu(clips[0], { clientX: 100, clientY: 100 });
  expect(clips[1].getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("menuitem", { name: "Group…" }));
  const dialog = screen.getByRole("dialog");
  expect((within(dialog).getByRole("combobox") as HTMLSelectElement).value).toBe("");
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "A" } });
  expect(within(dialog).getByText(/Edits update all occurrences/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  expect(pattern().rootSequence).toEqual([{ type: "group", groupId: "A" }, { type: "group", groupId: "A" }]);
  expect(pattern().groups[0].sequence).toEqual([{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 1 }]);
});

it("places only through drag/drop, inserts at boundaries, and rejects occupied bodies", () => {
  const { lane, timeline, pattern } = musicalLane();
  fireEvent.click(within(timeline).getAllByRole("listitem")[0]);
  const original = pattern();
  fireEvent.keyDown(timeline, { key: "3" }); fireEvent.keyDown(timeline, { key: "v", metaKey: true });
  expect(pattern()).toBe(original);
  expect(within(lane).queryByRole("button", { name: /^Add|^Insert|^Paste|^Duplicate/ })).toBeNull();
  const entry = within(lane).getByRole("button", { name: "3" });
  fireEvent.click(entry); expect(pattern()).toBe(original);
  const data = new Map<string, string>();
  const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "" };
  fireEvent.dragStart(entry.parentElement!, { dataTransfer });
  const firstWidth = parseFloat(within(timeline).getAllByRole("listitem")[0].style.width);
  fireEvent.drop(timeline, { clientX: firstWidth, dataTransfer });
  expect(pattern().rootSequence.slice(0, 3)).toEqual([{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 2 }, { type: "pad", padIndex: 1 }]);
  const inserted = pattern();
  fireEvent.drop(timeline, { clientX: firstWidth / 2, dataTransfer });
  expect(pattern()).toBe(inserted);
  expect(screen.getByRole("alert").textContent).toContain("does not fit");
});

it("sets a shared colour through a keyboard context menu and keeps audio revision unchanged", () => {
  const { lane, timeline, pattern } = musicalLane();
  const clip = within(timeline).getAllByRole("listitem")[0];
  const revision = useAppStore.getState().sequencerEditRevision;
  fireEvent.keyDown(clip, { key: "F10", shiftKey: true });
  fireEvent.click(screen.getByRole("menuitem", { name: "Set colour…" }));
  fireEvent.change(screen.getByLabelText("Custom colour"), { target: { value: "#ccaa33" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(pattern().definitionColors).toEqual({ "pad:0": "#ccaa33" });
  expect(clip.style.backgroundColor).toBe("rgb(204, 170, 51)");
  expect(within(lane).getByRole("button", { name: "1" }).parentElement!.style.backgroundColor).toBe("rgb(204, 170, 51)");
  expect(useAppStore.getState().sequencerEditRevision).toBe(revision);
  fireEvent.contextMenu(clip);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(document.activeElement).toBe(clip);
});

it("keeps playback settings independent and replaces the phrase panel with a palette", async () => {
  setup();
  const lane = screen.getAllByRole("region")[0];
  const ui = within(lane);
  const toggle = ui.getAllByRole("button")[0];
  const settings = ui.getByText("Playback settings").parentElement as HTMLDetailsElement;
  expect(settings.open).toBe(false);
  expect(ui.queryByLabelText("Playback source")).toBeNull();
  await act(async () => { settings.open = true; fireEvent(settings, new Event("toggle")); });
  await waitFor(() => expect(ui.getByLabelText("Playback source")).toBeTruthy());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(ui.queryByRole("button", { name: "Patterns and phrases" })).toBeNull();
  expect(ui.getByLabelText("Patterns and phrases")).toBeTruthy();
});

it("toggles only lane state without changing the mixer, transport, or lane expansion", () => {
  setup();
  const ui = within(screen.getAllByRole("region")[0]);
  const state = useAppStore.getState();
  fireEvent.click(ui.getByRole("button", { name: "Mute" }));
  expect(ui.getByRole("button", { name: "Mute" }).getAttribute("aria-pressed")).toBe("true");
  expect(useAppStore.getState().mixer).toBe(state.mixer);
  expect(useAppStore.getState().sequencer).toBe(state.sequencer);
  expect(useAppStore.getState().sequencerEditRevision).toBe(state.sequencerEditRevision);
  expect(ui.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("false");
  expect(Object.values(useLaneOutput.getState().lanes).some(value => value.mute)).toBe(true);
});

it("opens the selected definition in the arranger and retains disclosures across view changes until workspace reset", () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  const track = useAppStore.getState().sequencer.tracks[0];
  useAppStore.getState().applySequencerConfigSnapshot({ ...fixture.config, sequencer: { tracks: [{ ...track,
    padLoopPattern: { ...track.padLoopPattern, groups: [{ id: "A", sequence: [{ type: "pad", padIndex: 0 }] }] }
  }] } });
  const current = useAppStore.getState().sequencer.tracks[0];
  function Workspace({ generation = 0, library = true }) {
    return <PerformanceEditorProvider key={generation}>
      {library ? <PadLoopPatternEditor track={current} ui={SEQUENCER_UI_COPY.english} hostId={current.id}
        stepsPerBeat={1} padStepCounts={Array(8).fill(4)} defaultPadStepCount={4} isPlaying={false}
        linkedPadLoopStepPosition={null} onLinkedPadLoopStepPositionChange={noop}
        onPadLoopEnabledChange={noop} onPadLoopRepeatChange={noop} onPadLoopPatternChange={noop} /> : <Arranger />}
    </PerformanceEditorProvider>;
  }
  const view = render(<Workspace />);
  fireEvent.click(screen.getByRole("button", { name: "Patterns and phrases" }));
  fireEvent.click(screen.getByRole("button", { name: "Group A" }));
  fireEvent.click(screen.getByRole("button", { name: "Patterns and phrases" }));
  expect(screen.queryByText("Editing: A")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Patterns and phrases" }));
  expect(screen.getByText("Editing: A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open in arranger" }));
  view.rerender(<Workspace library={false} />);
  expect(screen.queryByText("Editing: A")).toBeNull();
  expect(screen.getByRole("button", { name: "Group A" })).toBe(document.activeElement);
  view.rerender(<Workspace />);
  expect(screen.getByText("Editing: A")).toBeTruthy(); // Independent sequencer disclosure.
  view.rerender(<Workspace library={false} />);
  expect(screen.queryByText("Editing: A")).toBeNull();
  view.rerender(<Workspace library={false} generation={1} />);
  expect(screen.queryByRole("button", { name: "Patterns and phrases" })).toBeNull();
});

it("highlights the arranger transport state and freezes its cursor during a stopped audition", () => {
  useAppStore.setState(state => ({ sequencerRuntime: { ...state.sequencerRuntime,
    isPlaying: true, arrangerActive: false, transportSubunit: 24 * 420, arrangerTransportSubunit: 8 * 420 } }));
  const { ruler } = setup();
  const play = screen.getByRole("button", { name: "transportPlay" });
  const stop = screen.getByRole("button", { name: "transportStop" });
  expect(play.getAttribute("aria-pressed")).toBe("false");
  expect(stop.getAttribute("aria-pressed")).toBe("true");
  expect(stop.className).toContain("ring-2");
  const cursor = ruler.querySelector(".bg-amber-200") as HTMLElement;
  expect(cursor.style.left).toBe("72px");
  act(() => useAppStore.setState(state => ({ sequencerRuntime: { ...state.sequencerRuntime,
    transportSubunit: 32 * 420 } })));
  expect(cursor.style.left).toBe("72px");
  act(() => useAppStore.setState(state => ({ sequencerRuntime: { ...state.sequencerRuntime, arrangerActive: true } })));
  expect(play.getAttribute("aria-pressed")).toBe("true");
  expect(play.className).toContain("ring-2");
  expect(stop.getAttribute("aria-pressed")).toBe("false");
  expect(stop.className).not.toContain("ring-2");
});
