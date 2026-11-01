import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CONTROL_HEIGHT, RACK_GAP, type RackMetrics } from "../../lib/rackLayout";

/** Observe geometry only. Value/MIDI/transport renders do not schedule measurement. */
export function useRackGeometry(contentKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 0, controlHeight: CONTROL_HEIGHT, headerHeight: 58 });
  const [font, setFont] = useState("12px sans-serif");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      if (!width) return;
      const heights = (selector: string) => [...element.querySelectorAll<HTMLElement>(selector)].map(node => node.getBoundingClientRect().height);
      // Measure natural contents, not the equalized tile height: otherwise a tall
      // hint would permanently ratchet the minimum height upwards after removal.
      const tileHeights = [...element.querySelectorAll<HTMLElement>("[data-rack-controller-tile]")].map(tile =>
        (tile.querySelector("[data-performance-controller]")?.getBoundingClientRect().height ?? 0) +
        (tile.querySelector("[data-rack-controller-footer]")?.getBoundingClientRect().height ?? 0) + RACK_GAP);
      const controlHeight = Math.ceil(Math.max(0, ...tileHeights)) || CONTROL_HEIGHT;
      const headerHeight = Math.ceil(Math.max(0, ...heights("[data-rack-card-header]"))) || 58;
      setGeometry(previous => previous.width === width && previous.controlHeight === controlHeight && previous.headerHeight === headerHeight
        ? previous : { width, controlHeight, headerHeight });
      setFont(`12px ${getComputedStyle(element).fontFamily}`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll("[data-rack-card-header], [data-performance-controller], [data-rack-controller-footer]").forEach(node => observer.observe(node));
    document.fonts?.addEventListener("loadingdone", measure);
    return () => { observer.disconnect(); document.fonts?.removeEventListener("loadingdone", measure); };
  }, [contentKey]);
  const metrics: RackMetrics = useMemo(() => {
    // jsdom has no canvas renderer. Pure layout tests use the deterministic fallback.
    const canvas = typeof CanvasRenderingContext2D !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (canvas) canvas.font = font;
    const cache = new Map<string, number>();
    return { controlHeight: geometry.controlHeight, headerHeight: geometry.headerHeight,
      textWidth: text => {
        if (!cache.has(text)) cache.set(text, canvas?.measureText(text).width ?? text.length * 7);
        return cache.get(text)!;
      } };
  }, [font, geometry.controlHeight, geometry.headerHeight]);
  return { ref, width: geometry.width, metrics };
}
