import { useEffect, useRef, useState, type DragEvent } from "react";
import { useAppStore } from "../../store/useAppStore";
import { focusInOverview } from "./focusInOverview";
import type { SequencerPageMelodicTrackActions } from "./sequencerPageContracts";

const deviceMime = "application/x-orchestron-live-melodic-device";
type Position = "before" | "after";
type Drop = { id: string; position: Position };
type Drag = { source: string; generation: number; target?: string; frame?: number; velocity: number };

export function useLiveDeviceReorder(move: SequencerPageMelodicTrackActions["onSequencerTrackReorder"]) {
  const drag = useRef<Drag | null>(null);
  const [marker, setMarker] = useState<Drop | null>(null);
  function cancel() {
    if (drag.current?.frame !== undefined) cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    setMarker(null);
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) { e.preventDefault(); cancel(); }
    };
    const unsubscribe = useAppStore.subscribe((s, previous) => {
      const active = drag.current;
      if (!active || s.sequencer.tracks === previous.sequencer.tracks && s.performanceWorkspaceGeneration === active.generation) return;
      if (s.performanceWorkspaceGeneration !== active.generation || [active.source, active.target].some(id => id && !s.sequencer.tracks.some(t => t.id === id))) cancel();
    });
    window.addEventListener("keydown", escape, true);
    return () => { unsubscribe(); window.removeEventListener("keydown", escape, true); cancel(); };
  }, []);

  function moveRow(source: string, target: string, position: Position, row: HTMLElement, trigger?: HTMLButtonElement) {
    move(source, target, position);
    requestAnimationFrame(() => {
      if (!row.isConnected) return;
      const focus = trigger && !trigger.disabled ? trigger : row.querySelector<HTMLElement>(".ws-live-name, select");
      if (focus) focusInOverview(focus);
    });
  }
  function edgeScroll(pane: HTMLElement, y: number, active: Drag) {
    const bounds = pane.getBoundingClientRect(), edge = Math.min(48, pane.clientHeight / 4);
    active.velocity = y < bounds.top + edge ? -6 : y > bounds.bottom - edge ? 6 : 0;
    if (!active.velocity || active.frame !== undefined) return;
    const tick = () => {
      active.frame = undefined;
      if (active !== drag.current || !active.velocity) return;
      const top = pane.scrollTop;
      pane.scrollTop += active.velocity;
      if (pane.scrollTop !== top) active.frame = requestAnimationFrame(tick);
    };
    active.frame = requestAnimationFrame(tick);
  }
  function receive(event: DragEvent<HTMLElement>, drop: boolean) {
    const active = drag.current;
    if (!active || !event.dataTransfer.types.includes(deviceMime)) return;
    const row = (event.target as Element).closest<HTMLElement>("[data-live-device]");
    const id = row?.dataset.liveDevice;
    const tracks = useAppStore.getState().sequencer.tracks;
    const valid = row && id && id !== active.source && tracks.some(t => t.id === id);
    const pane = event.currentTarget.closest<HTMLElement>(".ws-overview");
    if (!drop && pane) edgeScroll(pane, event.clientY, active);
    active.target = valid ? id : undefined;
    if (!valid) { setMarker(null); if (drop) cancel(); return; }
    event.preventDefault();
    event.stopPropagation(); // Pad actions inside this row own a different drag type.
    const bounds = row.getBoundingClientRect();
    const position = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    if (!drop) {
      event.dataTransfer.dropEffect = "move";
      setMarker(old => old?.id === id && old.position === position ? old : { id, position });
      return;
    }
    const sourceRow = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-live-device]")).find(node => node.dataset.liveDevice === active.source);
    if (sourceRow && event.dataTransfer.getData(deviceMime) === active.source) moveRow(active.source, id, position, sourceRow);
    cancel();
  }
  return {
    marker, moveRow,
    start(event: DragEvent, source: string) {
      cancel();
      drag.current = { source, generation: useAppStore.getState().performanceWorkspaceGeneration, velocity: 0 };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(deviceMime, source);
    },
    launcherEvents: {
      onDragOverCapture: (e: DragEvent<HTMLElement>) => receive(e, false),
      onDropCapture: (e: DragEvent<HTMLElement>) => receive(e, true),
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (drag.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          drag.current.velocity = 0;
          drag.current.target = undefined;
          setMarker(null);
        }
      },
      onDragEnd: () => { if (drag.current) cancel(); }
    }
  };
}
