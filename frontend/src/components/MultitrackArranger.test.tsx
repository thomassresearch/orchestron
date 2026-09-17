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
    onArrangerLoopSelectionChange={selectionChanged} onSequencerTrackPadLoopPatternChange={noop}
    onDrummerSequencerTrackPadLoopPatternChange={noop} onControllerSequencerPadLoopPatternChange={noop} />;
}

beforeEach(() => {
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
  const clip = within(timeline).getAllByRole("button").find(button => button.textContent === "1")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(ui.queryByText("New pattern")).toBeNull();
  fireEvent.click(clip);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(clip.parentElement?.className).toContain("ring-2");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(ui.queryByText("New pattern")).toBeNull();
  fireEvent.click(timeline, { clientX: 250 });
  expect(clip.parentElement?.className).not.toContain("ring-2");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(clip);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(ui.getByText("New pattern")).toBeTruthy();
});

it("keeps playback settings and the phrase library independently collapsible", async () => {
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
  const library = ui.getByRole("button", { name: "Patterns and phrases" });
  expect(library.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(library);
  expect(library.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(library);
  expect(library.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(ui.getByRole("button", { name: "Patterns and phrases" }).getAttribute("aria-expanded")).toBe("false");
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
  expect(screen.getByText("Editing: A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Patterns and phrases" }));
  view.rerender(<Workspace />);
  expect(screen.getByText("Editing: A")).toBeTruthy(); // Independent sequencer disclosure.
  view.rerender(<Workspace library={false} />);
  expect(screen.queryByText("Editing: A")).toBeNull();
  view.rerender(<Workspace library={false} generation={1} />);
  expect(screen.queryByRole("button", { name: "Patterns and phrases" })).toBeNull();
});
