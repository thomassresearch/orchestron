// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultControllerSequencer } from "../../store/appStoreModel";
import { ControllerSequencerCurveEditor } from "./ControllerSequencerCurveEditor";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.setPointerCapture = vi.fn();
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 127, width: 960, height: 127, toJSON() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(start = 50, end = 80) {
  const change = vi.fn();
  function Editor() {
    const [track, setTrack] = useState(() => ({ ...defaultControllerSequencer(), keypoints: [
      { id: "start", position: 0, value: start },
      { id: "middle", position: .5, value: 70 },
      { id: "end", position: 1, value: end }
    ] }));
    return <ControllerSequencerCurveEditor ui={SEQUENCER_UI_COPY.english} controllerSequencer={track}
      playbackTransport={null} onAddPoint={vi.fn()} onPointRemove={vi.fn()}
      onPointChange={(id, position, value) => {
        change(id, position, value);
        setTrack(t => ({ ...t, keypoints: t.keypoints.map(p => p.id === id ? { ...p, position, value } : p) }));
      }} />;
  }
  const view = render(<Editor />);
  const points = () => view.container.querySelectorAll("circle.cursor-ns-resize, circle.cursor-move");
  const down = (index: number) => fireEvent.pointerDown(points()[index], { pointerId: 1, clientX: index * 480, clientY: 100, button: 0 });
  const move = (index: number, delta: number, shiftKey = false) => fireEvent.pointerMove(points()[index],
    { pointerId: 1, clientX: index * 480, clientY: 100 - delta, shiftKey });
  return { change, points, down, move };
}

it.each([{ delta: -27, expected: 50 }, { delta: -33, expected: 50 },
  { delta: -26, expected: 54 }, { delta: -34, expected: 46 }])(
  "snaps endpoints within three CC units inclusive ($delta)", ({ delta, expected }) => {
    const { change, down, move } = setup();
    down(2); move(2, delta);
    expect(change).toHaveBeenLastCalledWith("end", 1, expected);
    expect(screen.queryByRole("status")?.textContent ?? null).toBe(expected === 50 ? "Endpoint snap: 50" : null);
    expect(change.mock.calls.every(([id]) => id === "end")).toBe(true);
  }
);

it("toggles Shift immediately at a stationary pointer and clears the indicator on release", () => {
  const { change, points, down, move } = setup();
  down(2); move(2, -28);
  expect(change).toHaveBeenLastCalledWith("end", 1, 50);
  fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
  expect(change).toHaveBeenLastCalledWith("end", 1, 52);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.keyUp(window, { key: "Shift" });
  expect(change).toHaveBeenLastCalledWith("end", 1, 50);
  fireEvent.pointerUp(points()[2], { pointerId: 1 });
  expect(screen.queryByRole("status")).toBeNull();
  change.mockClear();
  fireEvent.keyDown(window, { key: "Shift" });
  expect(change).not.toHaveBeenCalled();
});

it("snaps the start symmetrically, respects Shift during motion, and leaves interior points free", () => {
  const { change, down, move } = setup();
  down(0); move(0, 28, true);
  expect(change).toHaveBeenLastCalledWith("start", 0, 78);
  expect(screen.queryByRole("status")).toBeNull();
  move(0, 28);
  expect(change).toHaveBeenLastCalledWith("start", 0, 80);
  down(1); move(1, 9);
  expect(change).toHaveBeenLastCalledWith("middle", .5, 79);
  expect(screen.queryByRole("status")).toBeNull();
});

it.each(["pointerCancel", "lostPointerCapture", "blur"] as const)("clears snapping on %s", (event) => {
  const { change, points, down, move } = setup();
  down(2); move(2, -28);
  expect(screen.getByRole("status").textContent).toContain("50");
  if (event === "blur") fireEvent.blur(window);
  else fireEvent[event](points()[2], { pointerId: 1 });
  expect(screen.queryByRole("status")).toBeNull();
  change.mockClear(); move(2, -30);
  expect(change).not.toHaveBeenCalled();
});
