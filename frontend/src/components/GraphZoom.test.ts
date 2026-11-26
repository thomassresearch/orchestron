// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GraphZoom } from "./GraphZoom";

const host = document.createElement("div");
const onZoom = vi.fn();
let zoom: GraphZoom;

beforeEach(() => {
  zoom = new GraphZoom();
  onZoom.mockClear();
  zoom.initialize(host, host, onZoom);
});
afterEach(() => zoom.destroy());

it("halves trackpad pinch steps and keeps the cursor anchored", () => {
  for (const [ctrlKey, deltaY, delta] of [[true, -1, .05], [true, 1, -.05], [false, -1, .1]] as const) {
    host.dispatchEvent(new WheelEvent("wheel", { ctrlKey, deltaY, clientX: 100, clientY: 40 }));
    expect(onZoom).toHaveBeenLastCalledWith(delta, -100 * delta, -40 * delta, "wheel");
  }
});

it("halves a touch spread while following the full movement of the midpoint", () => {
  const pointer = (target: EventTarget, type: string, pointerId: number, clientX: number) =>
    target.dispatchEvent(new PointerEvent(type, { pointerType: "touch", pointerId, clientX, clientY: 40 }));
  pointer(host, "pointerdown", 1, 50);
  pointer(host, "pointerdown", 2, 150);
  pointer(window, "pointermove", 2, 150);
  pointer(window, "pointermove", 2, 200);
  // 50% spread -> 25% zoom. The point at (100, 40) now sits at (125, 40).
  expect(onZoom).toHaveBeenLastCalledWith(.25, 0, -10, "touch");
  pointer(window, "pointercancel", 2, 200);
  pointer(window, "pointermove", 1, 40);
  expect(onZoom).toHaveBeenCalledTimes(1);
});
