import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

export const DIVIDER_HEIGHT = 12;
export const MIN_DOCK = 180;
export const maxDockHeight = (height: number, overview: number, divider: number) => Math.max(MIN_DOCK, Math.min(Math.floor(height * .6), height - overview - divider));
export const clampDock = (height: number, max: number) => Math.max(MIN_DOCK, Math.min(max, Math.round(height)));

export function DockDivider({ label, controls, height, max, layoutWidth, layoutHeight, onCommit }: {
  label: string; controls: string; height: number; max: number; layoutWidth: number; layoutHeight: number; onCommit: (height: number) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startY: number; height: number; current: number } | null>(null);
  const [displayed, setDisplayed] = useState<number | null>(null);
  function end(commit: boolean) {
    const current = drag.current, divider = node.current;
    if (!current || !divider) return;
    drag.current = null;
    if (commit) onCommit(current.current);
    divider.parentElement?.style.removeProperty("--drag-height");
    if (divider.hasPointerCapture(current.id)) divider.releasePointerCapture(current.id);
    setDisplayed(null);
  }
  const cancelRef = useRef(() => end(false));
  cancelRef.current = () => end(false);
  useLayoutEffect(() => {
    const cancel = () => cancelRef.current();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    return () => { cancel(); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); };
  }, [layoutWidth, layoutHeight, max]);
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    current.current = clampDock(current.height + current.startY - event.clientY, max);
    event.currentTarget.parentElement?.style.setProperty("--drag-height", current.current + "px");
    setDisplayed(current.current);
  }
  return <div ref={node} className="ws-divider" data-dragging={displayed !== null || undefined} role="separator" tabIndex={0}
    aria-label={label} aria-orientation="horizontal" aria-controls={controls} aria-valuemin={MIN_DOCK} aria-valuemax={max} aria-valuenow={displayed ?? height}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, startY: event.clientY, height, current: height };
      setDisplayed(height);
    }} onPointerMove={move} onPointerUp={event => { if (drag.current?.id === event.pointerId) { move(event); end(true); } }}
    onPointerCancel={event => { if (drag.current?.id === event.pointerId) end(false); }}
    onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) end(false); }}
    onKeyDown={event => {
      if (drag.current) return;
      const step = event.shiftKey ? 1 : 10;
      const values: Record<string, number> = { ArrowUp: height + step, ArrowDown: height - step, Home: MIN_DOCK, End: max };
      if (!(event.key in values)) return;
      event.preventDefault(); onCommit(clampDock(values[event.key], max));
    }}><span /></div>;
}
