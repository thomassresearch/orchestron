// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/arranger_seek.json";
import { useAppStore } from "../store/useAppStore";
import { MultitrackArranger } from "./MultitrackArranger";

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
