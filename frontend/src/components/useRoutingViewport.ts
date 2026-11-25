import { useLayoutEffect, useRef, useState } from "react";
import { AreaPlugin } from "rete-area-plugin";
import { cardWidth, type Point, type RoutingNode } from "../lib/routingCanvas";
import { usePerformanceEditorState } from "./sequencer/PerformanceEditorState";

type Transform = Point & { k: number };
export function useRoutingViewport(nodes: Map<string, RoutingNode>, positions: Record<string, Point>) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<AreaPlugin<never>>();
  const [plane, setPlane] = useState<HTMLDivElement | null>(null);
  const [saved, save] = usePerformanceEditorState<Transform | null>("mixer", "routingViewport", null);
  const initial = useRef(saved);
  const geometry = useRef({ nodes, positions });
  geometry.current = { nodes, positions };

  function fit(initialFit = false) {
    const viewport = view.current;
    if (!viewport || !host.current?.clientWidth) return;
    const { nodes, positions } = geometry.current;
    const bounds = [...nodes.values()].map(n => ({ ...n, ...positions[n.id] }));
    const left = Math.min(...bounds.map(n => n.x)) - 94, top = Math.min(...bounds.map(n => n.y)) - 12;
    const right = Math.max(...bounds.map(n => n.x + cardWidth)) + 94, bottom = Math.max(...bounds.map(n => n.y + n.height)) + 64;
    const scale = Math.max(initialFit ? .7 : .001, Math.min(1.15, (host.current.clientWidth - 50) / (right - left), (host.current.clientHeight - 50) / (bottom - top)));
    void viewport.area.zoom(scale).then(() => {
      if (view.current !== viewport || !host.current) return;
      const x = Math.max(18, (host.current.clientWidth - (right - left) * scale) / 2);
      const y = Math.max(18, (host.current.clientHeight - (bottom - top) * scale) / 2);
      void viewport.area.translate(x - left * scale, y - top * scale);
    });
  }
  useLayoutEffect(() => {
    const viewport = new AreaPlugin<never>(host.current!);
    view.current = viewport;
    viewport.addPipe(event => event.type === "zoom" && (event.data.zoom < .001 || event.data.zoom > 3) ? undefined : event);
    const layer = document.createElement("div");
    viewport.area.content.add(layer);
    setPlane(layer);
    const transform = initial.current;
    if (transform) {
      void viewport.area.zoom(transform.k).then(() => viewport.area.translate(transform.x, transform.y));
    } else fit(true);
    return () => {
      save({ ...viewport.area.transform });
      view.current = undefined;
      viewport.destroy();
      viewport.area.content.holder.remove();
    };
  }, [save]);
  function zoom(factor: number) {
    const viewport = view.current;
    if (!viewport || !host.current) return;
    const { x, y, k } = viewport.area.transform;
    void viewport.area.zoom(Math.max(.001, Math.min(3, k * factor)), host.current.clientWidth / 2 - x, host.current.clientHeight / 2 - y);
  }
  function center(n: RoutingNode) {
    const viewport = view.current;
    if (!viewport || !host.current) return;
    const p = positions[n.id] ?? n, k = Math.max(.8, viewport.area.transform.k);
    const x = (host.current.clientWidth - cardWidth * k) / 2 - p.x * k;
    const y = (host.current.clientHeight - n.height * k) / 2 - p.y * k;
    void viewport.area.zoom(k).then(() => { if (view.current === viewport) void viewport.area.translate(x, y); });
  }
  function point(client: Point) {
    const rect = host.current!.getBoundingClientRect();
    const { x, y, k } = view.current!.area.transform;
    return { x: (client.x - rect.left - x) / k, y: (client.y - rect.top - y) / k };
  }
  return { host, plane, view, fit, zoom, center, point };
}
