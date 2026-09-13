import { describe, expect, it, vi } from "vitest";
import { createReteViewportScrollbars, graphScrollAxis } from "./reteViewportScrollbars";

describe("graph scrollbar navigation bounds", () => {
  it("does not add a scroll range to an empty graph or reset its pan", () => {
    const axis = graphScrollAxis(800, -125, null);
    expect(axis.size).toBe(800);
    expect(-axis.min - axis.offset).toBe(-125);
  });

  it.each([
    { viewport: 800, pan: 120, min: -2400, max: 5200 },
    { viewport: 450, pan: -1700, min: 0, max: 5000 },
    { viewport: 1200, pan: 4500, min: -3200, max: -1500 },
    { viewport: 500, pan: -123.75, min: -812.5, max: 1900.25 }
  ])("reaches both graph edges and preserves the current pan: %j", ({ viewport, pan, min, max }) => {
    const axis = graphScrollAxis(viewport, pan, { min, max });
    expect(axis.offset).toBeGreaterThanOrEqual(0);
    expect(axis.offset).toBeLessThanOrEqual(axis.size - viewport);
    expect(-axis.min - axis.offset).toBeCloseTo(pan);
    // The full scroll range extends past both extreme nodes, leaving room
    // to reach their edges even when the original pan was outside the graph.
    const firstEdge = min - axis.min;
    const lastEdge = max - axis.min - (axis.size - viewport);
    expect(firstEdge).toBeGreaterThanOrEqual(48);
    expect(lastEdge).toBeLessThanOrEqual(viewport - 48);
  });

  it("recalculates the range after a panel resize without moving the graph", () => {
    const bounds = { min: -400, max: 3200 };
    const wide = graphScrollAxis(1100, -500, bounds);
    const narrow = graphScrollAxis(600, -500, bounds);
    expect(narrow.size - 600).toBeGreaterThan(wide.size - 1100);
    expect(-narrow.min - narrow.offset).toBe(-wide.min - wide.offset);
  });

  it("ignores stale native scroll events until the new graph viewport is synchronized", async () => {
    let nextFrame = () => {};
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { nextFrame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    vi.stubGlobal("MutationObserver", Observer);
    const horizontal = Object.assign(new EventTarget(), { scrollLeft: 450, firstElementChild: { style: {} } });
    const vertical = Object.assign(new EventTarget(), { scrollTop: 300, firstElementChild: { style: {} } });
    const transform = { x: 80, y: 80, k: 1 };
    const translate = vi.fn(async (x: number, y: number) => { transform.x = x; transform.y = y; });
    const node = { getBoundingClientRect: () => ({ left: transform.x, top: transform.y,
      right: transform.x + 2200, bottom: transform.y + 1400, width: 2200, height: 1400 }) };
    const area = { transform, translate, content: { holder: { querySelectorAll: () => [node] } as unknown as HTMLElement } };
    const viewport = { clientWidth: 1000, clientHeight: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as HTMLElement;
    const scrollbars = createReteViewportScrollbars(area, viewport, horizontal as unknown as HTMLElement, vertical as unknown as HTMLElement);
    try {
      horizontal.dispatchEvent(new Event("scroll"));
      vertical.dispatchEvent(new Event("scroll"));
      expect(translate).not.toHaveBeenCalled();
      nextFrame();
      expect(transform).toEqual({ x: 80, y: 80, k: 1 });
      horizontal.scrollLeft += 250;
      horizontal.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      expect(transform).toEqual({ x: -170, y: 80, k: 1 });
    } finally {
      scrollbars.destroy();
      vi.unstubAllGlobals();
    }
  });
});
