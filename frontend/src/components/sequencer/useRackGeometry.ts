import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CARD_PADDING, CONTROL_HEIGHT, CONTROL_WIDTH, CONTROL_GAP_Y, GROUP_PADDING, RACK_GAP, type RackMetrics } from "../../lib/rackLayout";

// Computed dimensions remain in layout CSS pixels under CSS/browser zoom. Rects
// are a fallback for unstyled test environments, not the basis for column counts.
function dimension(node: Element, axis: "width" | "height") {
  const style = getComputedStyle(node);
  const value = Number.parseFloat(style[axis]);
  if (!Number.isFinite(value)) return node.getBoundingClientRect()[axis];
  const sides = axis === "width" ? ["Left", "Right"] as const : ["Top", "Bottom"] as const;
  return value + (style.boxSizing === "border-box" ? 0 : sides.reduce((sum, side) =>
    sum + (Number.parseFloat(style[`padding${side}`]) || 0) + (Number.parseFloat(style[`border${side}Width`]) || 0), 0));
}

/** Observe geometry only. Value/MIDI/transport renders do not schedule measurement. */
export function useRackGeometry(contentKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 0, controlHeight: CONTROL_HEIGHT, headerHeight: 58, controlWidth: CONTROL_WIDTH, controlGapX: RACK_GAP, controlGapY: CONTROL_GAP_Y, groupPadding: GROUP_PADDING, cardPadding: CARD_PADDING });
  const [font, setFont] = useState("12px sans-serif");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = Math.floor(dimension(element, "width"));
      if (!width) return;
      const heights = (selector: string) => [...element.querySelectorAll<HTMLElement>(selector)].map(node => dimension(node, "height"));
      // Measure natural contents, not the equalized tile height: otherwise a tall
      // hint would permanently ratchet the minimum height upwards after removal.
      const tiles = [...element.querySelectorAll<HTMLElement>("[data-rack-controller-tile]")];
      const grid = element.querySelector<HTMLElement>("[data-controller-grid]");
      const gridStyle = grid ? getComputedStyle(grid) : null;
      const controlWidth = tiles.length ? Math.max(...tiles.map(tile => Number.parseFloat(getComputedStyle(tile).width) || CONTROL_WIDTH)) : CONTROL_WIDTH;
      const controlGapX = Number.parseFloat(gridStyle?.columnGap ?? "") || RACK_GAP;
      const controlGapY = Number.parseFloat(gridStyle?.rowGap ?? "") || CONTROL_GAP_Y;
      const horizontalPadding = (selector: string, fallback: number) => Math.ceil(Math.max(fallback, ...[...element.querySelectorAll(selector)].map(node => {
        const style = getComputedStyle(node);
        return [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
      })));
      const groupPadding = horizontalPadding("fieldset[data-controller-group]", GROUP_PADDING);
      const cardPadding = horizontalPadding("[data-rack-binding-id]", CARD_PADDING);
      const naturalHeight = (tile: Element, selector: string) => { const node = tile.querySelector(selector); return node ? dimension(node, "height") : 0; };
      const tileHeights = [...element.querySelectorAll<HTMLElement>("[data-rack-controller-tile]")].map(tile =>
        naturalHeight(tile, "[data-performance-controller]") +
        naturalHeight(tile, "[data-rack-controller-footer]") + RACK_GAP);
      const controlHeight = Math.ceil(Math.max(0, ...tileHeights)) || CONTROL_HEIGHT;
      const headerHeight = Math.ceil(Math.max(0, ...heights("[data-rack-card-header]"))) || 58;
      const next = { width, controlHeight, headerHeight, controlWidth, controlGapX, controlGapY, groupPadding, cardPadding };
      setGeometry(previous => (Object.keys(next) as Array<keyof typeof next>).every(key => previous[key] === next[key]) ? previous : next);
      setFont(`12px ${getComputedStyle(element).fontFamily}`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll("[data-rack-card-header], [data-performance-controller], [data-rack-controller-footer]").forEach(node => observer.observe(node));
    window.addEventListener("resize", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); document.fonts?.removeEventListener("loadingdone", measure); };
  }, [contentKey]);
  const metrics: RackMetrics = useMemo(() => {
    // jsdom has no canvas renderer. Pure layout tests use the deterministic fallback.
    const canvas = typeof CanvasRenderingContext2D !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (canvas) canvas.font = font;
    const cache = new Map<string, number>();
    return { ...geometry,
      textWidth: text => {
        if (!cache.has(text)) cache.set(text, canvas?.measureText(text).width ?? text.length * 7);
        return cache.get(text)!;
      } };
  }, [font, geometry]);
  return { ref, width: geometry.width, metrics };
}
