import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  DragEvent as ReactDragEvent
} from "react";

import {
  PAD_LOOP_PAUSE_STEP_OPTIONS,
  canCreatePadLoopGroupFromSelection,
  getPadLoopContainerSequence,
  groupPadLoopItemsInContainer,
  insertPadLoopItem,
  movePadLoopItemWithinContainer,
  removePadLoopItemsFromContainer,
  ungroupPadLoopItemsInContainer,
  type PadLoopContainerRef
} from "../lib/padLoopPattern";
import type {
  PadLoopPatternItem,
  PadLoopPatternState,
  PatchListItem,
  SequencerInstrumentBinding,
  SequencerState
} from "../types";

const STEP_GRID_QUANTUM = 4;
const DEFAULT_STEP_PIXEL_WIDTH = 9;
const MIN_STEP_PIXEL_WIDTH = 4;
const MAX_STEP_PIXEL_WIDTH = 24;
const STEP_PIXEL_WIDTH_ZOOM_STEP = 2;
const TOKEN_REORDER_DRAG_MIME = "application/x-visualcsound-arranger-token";

type ArrangerTrackKind = "sequencer" | "drummer" | "controller";

type ArrangerTrack = {
  key: string;
  id: string;
  kind: ArrangerTrackKind;
  index: number;
  title: string;
  subtitle: string;
  padLoopPattern: PadLoopPatternState;
  padStepCounts: number[];
  defaultPadStepCount: number;
  enabled: boolean;
};

type ArrangerTimelineToken = {
  sourceIndex: number;
  item: PadLoopPatternItem;
  startStep: number;
  endStep: number;
  stepCount: number;
};

type ArrangerContextMenuState = {
  x: number;
  y: number;
  trackId: string;
  container: PadLoopContainerRef;
};

type RootDragState = {
  pointerId: number;
  trackId: string;
  sourceIndex: number;
  originStartStep: number;
  stepCount: number;
  totalSteps: number;
  otherRanges: Array<{ startStep: number; endStep: number }>;
  startClientX: number;
  moved: boolean;
};

type ArrangerTokenDragPayload = {
  trackId: string;
  container: PadLoopContainerRef;
  sourceIndex: number;
};

type MultitrackArrangerProps = {
  sequencer: SequencerState;
  patches: PatchListItem[];
  instrumentBindings: SequencerInstrumentBinding[];
  onSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onDrummerSequencerTrackPadLoopPatternChange: (trackId: string, pattern: PadLoopPatternState) => void;
  onControllerSequencerPadLoopPatternChange: (controllerSequencerId: string, pattern: PadLoopPatternState) => void;
};

function containerKey(container: PadLoopContainerRef): string {
  if (container.kind === "root") {
    return "root";
  }
  return `${container.kind}:${container.id}`;
}

function selectionKey(trackId: string, container: PadLoopContainerRef): string {
  return `${trackId}:${containerKey(container)}`;
}

function normalizeQuantizedStepCount(value: number): number {
  const rounded = Math.max(STEP_GRID_QUANTUM, Math.round(value));
  const quantized = Math.round(rounded / STEP_GRID_QUANTUM) * STEP_GRID_QUANTUM;
  return Math.max(STEP_GRID_QUANTUM, quantized);
}

function pauseTokensForGap(totalSteps: number): PadLoopPatternItem[] {
  let remaining = Math.max(0, Math.round(totalSteps));
  const result: PadLoopPatternItem[] = [];
  const sizes = [...PAD_LOOP_PAUSE_STEP_OPTIONS].sort((a, b) => b - a);
  for (const size of sizes) {
    while (remaining >= size) {
      result.push({ type: "pause", stepCount: size });
      remaining -= size;
    }
  }
  return result;
}

function parseTokenDragPayload(event: ReactDragEvent): ArrangerTokenDragPayload | null {
  const raw = event.dataTransfer.getData(TOKEN_REORDER_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ArrangerTokenDragPayload>;
    if (!parsed || typeof parsed.trackId !== "string" || !parsed.container || typeof parsed.sourceIndex !== "number") {
      return null;
    }
    const container = parsed.container as Partial<PadLoopContainerRef>;
    if (container.kind === "root") {
      return {
        trackId: parsed.trackId,
        container: { kind: "root" },
        sourceIndex: Math.max(0, Math.round(parsed.sourceIndex))
      };
    }
    if ((container.kind === "group" || container.kind === "super") && typeof container.id === "string") {
      return {
        trackId: parsed.trackId,
        container: { kind: container.kind, id: container.id },
        sourceIndex: Math.max(0, Math.round(parsed.sourceIndex))
      };
    }
  } catch {
    return null;
  }
  return null;
}

function tokenLabel(item: PadLoopPatternItem): string {
  if (item.type === "pad") {
    return `P${item.padIndex + 1}`;
  }
  if (item.type === "pause") {
    return `P${item.stepCount}`;
  }
  if (item.type === "group") {
    return item.groupId;
  }
  return item.superGroupId;
}

function tokenClass(item: PadLoopPatternItem): string {
  if (item.type === "pad") {
    return "border-cyan-400/60 bg-cyan-500/10 text-cyan-100";
  }
  if (item.type === "pause") {
    return "border-slate-600 bg-slate-800/60 text-slate-300";
  }
  if (item.type === "group") {
    return "border-orange-400/60 bg-orange-500/10 text-orange-100";
  }
  return "border-violet-400/60 bg-violet-500/10 text-violet-100";
}

function clonePatternItem(item: PadLoopPatternItem): PadLoopPatternItem {
  if (item.type === "pad") {
    return { type: "pad", padIndex: item.padIndex };
  }
  if (item.type === "pause") {
    return { type: "pause", stepCount: item.stepCount };
  }
  if (item.type === "group") {
    return { type: "group", groupId: item.groupId };
  }
  return { type: "super", superGroupId: item.superGroupId };
}

function replaceContainerSequence(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  nextSequence: PadLoopPatternItem[]
): PadLoopPatternState {
  const existing = getPadLoopContainerSequence(pattern, container) ?? [];
  let nextPattern = removePadLoopItemsFromContainer(
    pattern,
    container,
    Array.from({ length: existing.length }, (_, index) => index)
  );
  for (let index = 0; index < nextSequence.length; index += 1) {
    nextPattern = insertPadLoopItem(nextPattern, container, index, nextSequence[index]);
  }
  return nextPattern;
}

function buildTrackSubtitle(
  trackKind: ArrangerTrackKind,
  midiChannel: number | null,
  patchByChannel: Map<number, string>,
  controllerNumber: number | null
): string {
  if (trackKind === "controller") {
    return controllerNumber === null ? "CC-only track" : `CC ${controllerNumber}`;
  }
  if (midiChannel === null) {
    return "MIDI channel not assigned";
  }
  const patchName = patchByChannel.get(midiChannel) ?? "Unassigned patch";
  return `CH ${midiChannel} - ${patchName}`;
}

function quantizeToGrid(value: number): number {
  return Math.round(value / STEP_GRID_QUANTUM) * STEP_GRID_QUANTUM;
}

function sameContainer(a: PadLoopContainerRef, b: PadLoopContainerRef): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "root") {
    return true;
  }
  return a.id === (b as typeof a).id;
}

export function MultitrackArranger({
  sequencer,
  patches,
  instrumentBindings,
  onSequencerTrackPadLoopPatternChange,
  onDrummerSequencerTrackPadLoopPatternChange,
  onControllerSequencerPadLoopPatternChange
}: MultitrackArrangerProps) {
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollbarRef = useRef<HTMLDivElement | null>(null);
  const [openContainerByTrack, setOpenContainerByTrack] = useState<Record<string, PadLoopContainerRef>>({});
  const [selectionByContainer, setSelectionByContainer] = useState<Record<string, number[]>>({});
  const [contextMenu, setContextMenu] = useState<ArrangerContextMenuState | null>(null);
  const [stepPixelWidth, setStepPixelWidth] = useState<number>(DEFAULT_STEP_PIXEL_WIDTH);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState<number>(0);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState<number>(0);
  const [rootDragPreview, setRootDragPreview] = useState<{
    trackId: string;
    sourceIndex: number;
    nextStartStep: number;
    valid: boolean;
  } | null>(null);
  const dragStateRef = useRef<RootDragState | null>(null);

  const patchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const patch of patches) {
      map.set(patch.id, patch.name);
    }
    return map;
  }, [patches]);

  const patchByChannel = useMemo(() => {
    const map = new Map<number, string>();
    for (const binding of instrumentBindings) {
      const channel = Math.max(1, Math.min(16, Math.round(binding.midiChannel)));
      if (map.has(channel)) {
        continue;
      }
      const patchName = patchNameById.get(binding.patchId) ?? `Patch ${binding.patchId}`;
      map.set(channel, patchName);
    }
    return map;
  }, [instrumentBindings, patchNameById]);

  const arrangerTracks = useMemo<ArrangerTrack[]>(() => {
    const tracks: ArrangerTrack[] = [];
    sequencer.tracks.forEach((track, index) => {
      tracks.push({
        key: `sequencer:${track.id}`,
        id: track.id,
        kind: "sequencer",
        index,
        title: `Sequencer ${index + 1}`,
        subtitle: buildTrackSubtitle("sequencer", track.midiChannel, patchByChannel, null),
        padLoopPattern: track.padLoopPattern,
        padStepCounts: track.pads.map((pad) => pad.stepCount),
        defaultPadStepCount: track.stepCount,
        enabled: track.enabled
      });
    });
    sequencer.drummerTracks.forEach((track, index) => {
      tracks.push({
        key: `drummer:${track.id}`,
        id: track.id,
        kind: "drummer",
        index,
        title: `Drummer Sequencer ${index + 1}`,
        subtitle: buildTrackSubtitle("drummer", track.midiChannel, patchByChannel, null),
        padLoopPattern: track.padLoopPattern,
        padStepCounts: track.pads.map((pad) => pad.stepCount),
        defaultPadStepCount: track.stepCount,
        enabled: track.enabled
      });
    });
    sequencer.controllerSequencers.forEach((track, index) => {
      tracks.push({
        key: `controller:${track.id}`,
        id: track.id,
        kind: "controller",
        index,
        title: `Controller Sequencer ${index + 1}`,
        subtitle: buildTrackSubtitle("controller", null, patchByChannel, track.controllerNumber),
        padLoopPattern: track.padLoopPattern,
        padStepCounts: track.pads.map((pad) => pad.stepCount),
        defaultPadStepCount: track.stepCount,
        enabled: track.enabled
      });
    });
    return tracks;
  }, [patchByChannel, sequencer.controllerSequencers, sequencer.drummerTracks, sequencer.tracks]);

  const commitTrackPattern = useCallback(
    (track: ArrangerTrack, nextPattern: PadLoopPatternState) => {
      if (track.kind === "sequencer") {
        onSequencerTrackPadLoopPatternChange(track.id, nextPattern);
        return;
      }
      if (track.kind === "drummer") {
        onDrummerSequencerTrackPadLoopPatternChange(track.id, nextPattern);
        return;
      }
      onControllerSequencerPadLoopPatternChange(track.id, nextPattern);
    },
    [
      onControllerSequencerPadLoopPatternChange,
      onDrummerSequencerTrackPadLoopPatternChange,
      onSequencerTrackPadLoopPatternChange
    ]
  );

  const tokenStepCounter = useCallback((track: ArrangerTrack) => {
    const groupById = new Map(track.padLoopPattern.groups.map((group) => [group.id, group.sequence]));
    const superById = new Map(track.padLoopPattern.superGroups.map((group) => [group.id, group.sequence]));
    const fallbackPadStepCount = normalizeQuantizedStepCount(track.defaultPadStepCount);

    const countFor = (item: PadLoopPatternItem, path: string[]): number => {
      if (item.type === "pad") {
        const raw = track.padStepCounts[item.padIndex] ?? fallbackPadStepCount;
        return normalizeQuantizedStepCount(raw);
      }
      if (item.type === "pause") {
        return normalizeQuantizedStepCount(item.stepCount);
      }
      if (item.type === "group") {
        const pathKey = `group:${item.groupId}`;
        if (path.includes(pathKey)) {
          return STEP_GRID_QUANTUM;
        }
        const sequence = groupById.get(item.groupId) ?? [];
        if (sequence.length === 0) {
          return STEP_GRID_QUANTUM;
        }
        const total = sequence.reduce((sum, nested) => sum + countFor(nested, [...path, pathKey]), 0);
        return normalizeQuantizedStepCount(total);
      }
      const pathKey = `super:${item.superGroupId}`;
      if (path.includes(pathKey)) {
        return STEP_GRID_QUANTUM;
      }
      const sequence = superById.get(item.superGroupId) ?? [];
      if (sequence.length === 0) {
        return STEP_GRID_QUANTUM;
      }
      const total = sequence.reduce((sum, nested) => sum + countFor(nested, [...path, pathKey]), 0);
      return normalizeQuantizedStepCount(total);
    };

    return (item: PadLoopPatternItem): number => countFor(item, []);
  }, []);

  const buildTimeline = useCallback(
    (
      track: ArrangerTrack,
      container: PadLoopContainerRef,
      includePauseTokens: boolean
    ): {
      sequence: PadLoopPatternItem[];
      allTokens: ArrangerTimelineToken[];
      visibleTokens: ArrangerTimelineToken[];
      totalSteps: number;
    } => {
      const sequence = getPadLoopContainerSequence(track.padLoopPattern, container) ?? [];
      const countSteps = tokenStepCounter(track);
      const allTokens: ArrangerTimelineToken[] = [];
      const visibleTokens: ArrangerTimelineToken[] = [];
      let cursor = 0;
      for (let index = 0; index < sequence.length; index += 1) {
        const item = sequence[index];
        const stepCount = countSteps(item);
        const startStep = cursor;
        const endStep = startStep + stepCount;
        cursor = endStep;
        const token: ArrangerTimelineToken = {
          sourceIndex: index,
          item,
          startStep,
          endStep,
          stepCount
        };
        allTokens.push(token);
        if (includePauseTokens || item.type !== "pause") {
          visibleTokens.push(token);
        }
      }
      return {
        sequence,
        allTokens,
        visibleTokens,
        totalSteps: cursor
      };
    },
    [tokenStepCounter]
  );

  const rootTimelines = useMemo(() => {
    const byTrackKey: Record<
      string,
      {
        sequence: PadLoopPatternItem[];
        allTokens: ArrangerTimelineToken[];
        visibleTokens: ArrangerTimelineToken[];
        totalSteps: number;
      }
    > = {};
    for (const track of arrangerTracks) {
      byTrackKey[track.key] = buildTimeline(track, { kind: "root" }, false);
    }
    return byTrackKey;
  }, [arrangerTracks, buildTimeline]);

  const maxRootSteps = useMemo(() => {
    return arrangerTracks.reduce((max, track) => {
      const total = rootTimelines[track.key]?.totalSteps ?? STEP_GRID_QUANTUM;
      return Math.max(max, total);
    }, Math.max(sequencer.stepCount, STEP_GRID_QUANTUM));
  }, [arrangerTracks, rootTimelines, sequencer.stepCount]);

  const quantizedPlayhead = useMemo(() => {
    if (!sequencer.isPlaying) {
      return null;
    }
    const step = Math.max(0, Math.floor(sequencer.playhead));
    return Math.floor(step / STEP_GRID_QUANTUM) * STEP_GRID_QUANTUM;
  }, [sequencer.isPlaying, sequencer.playhead]);

  useEffect(() => {
    const nextOpenByTrack: Record<string, PadLoopContainerRef> = {};
    let changed = false;
    for (const track of arrangerTracks) {
      const current = openContainerByTrack[track.id];
      if (!current) {
        continue;
      }
      if (current.kind === "root") {
        nextOpenByTrack[track.id] = current;
        continue;
      }
      const sequence = getPadLoopContainerSequence(track.padLoopPattern, current);
      if (sequence !== null) {
        nextOpenByTrack[track.id] = current;
      } else {
        changed = true;
      }
    }

    const knownTrackIds = new Set(arrangerTracks.map((track) => track.id));
    for (const trackId of Object.keys(openContainerByTrack)) {
      if (!knownTrackIds.has(trackId)) {
        changed = true;
      }
    }

    if (!changed) {
      return;
    }
    setOpenContainerByTrack(nextOpenByTrack);
  }, [arrangerTracks, openContainerByTrack]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const getSelection = useCallback(
    (trackId: string, container: PadLoopContainerRef): number[] => {
      return selectionByContainer[selectionKey(trackId, container)] ?? [];
    },
    [selectionByContainer]
  );

  const setSelection = useCallback((trackId: string, container: PadLoopContainerRef, indexes: number[]) => {
    const key = selectionKey(trackId, container);
    const next = Array.from(new Set(indexes.map((index) => Math.max(0, Math.round(index))))).sort((a, b) => a - b);
    setSelectionByContainer((previous) => {
      if (next.length === 0) {
        const entries = Object.entries(previous).filter(([entryKey]) => entryKey !== key);
        return Object.fromEntries(entries);
      }
      return {
        ...previous,
        [key]: next
      };
    });
  }, []);

  const appendPadToken = useCallback(
    (track: ArrangerTrack, container: PadLoopContainerRef, padIndex: number) => {
      const nextPattern = insertPadLoopItem(track.padLoopPattern, container, Number.MAX_SAFE_INTEGER, {
        type: "pad",
        padIndex: Math.max(0, Math.min(7, Math.round(padIndex)))
      });
      if (nextPattern !== track.padLoopPattern) {
        commitTrackPattern(track, nextPattern);
      }
    },
    [commitTrackPattern]
  );

  const appendPauseToken = useCallback(
    (track: ArrangerTrack, container: PadLoopContainerRef, stepCount: number) => {
      const normalized = PAD_LOOP_PAUSE_STEP_OPTIONS.includes(stepCount as (typeof PAD_LOOP_PAUSE_STEP_OPTIONS)[number])
        ? (stepCount as (typeof PAD_LOOP_PAUSE_STEP_OPTIONS)[number])
        : STEP_GRID_QUANTUM;
      const nextPattern = insertPadLoopItem(track.padLoopPattern, container, Number.MAX_SAFE_INTEGER, {
        type: "pause",
        stepCount: normalized
      });
      if (nextPattern !== track.padLoopPattern) {
        commitTrackPattern(track, nextPattern);
      }
    },
    [commitTrackPattern]
  );

  const startRootDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      track: ArrangerTrack,
      token: ArrangerTimelineToken,
      totalSteps: number,
      visibleTokens: ArrangerTimelineToken[]
    ) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const sourceIndex = token.sourceIndex;
      const otherRanges = visibleTokens
        .filter((candidate) => candidate.sourceIndex !== sourceIndex)
        .map((candidate) => ({
          startStep: candidate.startStep,
          endStep: candidate.endStep
        }));
      dragStateRef.current = {
        pointerId: event.pointerId,
        trackId: track.id,
        sourceIndex,
        originStartStep: token.startStep,
        stepCount: token.stepCount,
        totalSteps,
        otherRanges,
        startClientX: event.clientX,
        moved: false
      };
      setRootDragPreview({
        trackId: track.id,
        sourceIndex,
        nextStartStep: token.startStep,
        valid: true
      });
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    []
  );

  const commitRootDrag = useCallback(
    (dragState: RootDragState, nextStartStep: number) => {
      const track = arrangerTracks.find((candidate) => candidate.id === dragState.trackId);
      if (!track) {
        return;
      }
      const timeline = buildTimeline(track, { kind: "root" }, true);
      const movedToken = timeline.allTokens.find((token) => token.sourceIndex === dragState.sourceIndex);
      if (!movedToken) {
        return;
      }
      const nextEndStep = nextStartStep + movedToken.stepCount;
      const hasOverlap = timeline.allTokens
        .filter((token) => token.sourceIndex !== dragState.sourceIndex && token.item.type !== "pause")
        .some((token) => nextStartStep < token.endStep && nextEndStep > token.startStep);
      if (hasOverlap) {
        return;
      }

      const nonPauseTokens = timeline.allTokens.filter((token) => token.item.type !== "pause");
      const moved = nonPauseTokens.find((token) => token.sourceIndex === dragState.sourceIndex);
      if (!moved) {
        return;
      }
      const others = nonPauseTokens.filter((token) => token.sourceIndex !== dragState.sourceIndex);
      const withMoved = [
        ...others,
        {
          ...moved,
          startStep: nextStartStep,
          endStep: nextStartStep + moved.stepCount
        }
      ].sort((a, b) => (a.startStep === b.startStep ? a.sourceIndex - b.sourceIndex : a.startStep - b.startStep));

      const nextRootSequence: PadLoopPatternItem[] = [];
      let cursor = 0;
      for (const token of withMoved) {
        if (token.startStep > cursor) {
          nextRootSequence.push(...pauseTokensForGap(token.startStep - cursor));
        }
        nextRootSequence.push(clonePatternItem(token.item));
        cursor = token.endStep;
      }
      if (timeline.totalSteps > cursor) {
        nextRootSequence.push(...pauseTokensForGap(timeline.totalSteps - cursor));
      }

      const nextPattern = replaceContainerSequence(track.padLoopPattern, { kind: "root" }, nextRootSequence);
      if (nextPattern !== track.padLoopPattern) {
        commitTrackPattern(track, nextPattern);
      }
    },
    [arrangerTracks, buildTimeline, commitTrackPattern]
  );

  const onRootDragMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const deltaSteps = Math.round((event.clientX - drag.startClientX) / stepPixelWidth);
      const proposedStart = quantizeToGrid(drag.originStartStep + deltaSteps);
      const clampedStart = Math.max(0, Math.min(drag.totalSteps - drag.stepCount, proposedStart));
      const proposedEnd = clampedStart + drag.stepCount;
      const hasOverlap = drag.otherRanges.some(
        (range) => clampedStart < range.endStep && proposedEnd > range.startStep
      );
      if (Math.abs(event.clientX - drag.startClientX) > 1) {
        drag.moved = true;
      }
      setRootDragPreview({
        trackId: drag.trackId,
        sourceIndex: drag.sourceIndex,
        nextStartStep: clampedStart,
        valid: !hasOverlap
      });
    },
    [stepPixelWidth]
  );

  const onRootDragEnd = useCallback(
    (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const preview = rootDragPreview;
      dragStateRef.current = null;
      setRootDragPreview(null);
      if (!preview || preview.trackId !== drag.trackId || preview.sourceIndex !== drag.sourceIndex) {
        return;
      }
      if (!preview.valid) {
        return;
      }
      if (!drag.moved || preview.nextStartStep === drag.originStartStep) {
        return;
      }
      commitRootDrag(drag, preview.nextStartStep);
    },
    [commitRootDrag, rootDragPreview]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => onRootDragMove(event);
    const handlePointerUp = (event: PointerEvent) => onRootDragEnd(event);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [onRootDragEnd, onRootDragMove]);

  const handleContainerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, track: ArrangerTrack, container: PadLoopContainerRef) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.trim();
      if (/^[1-8]$/.test(key)) {
        event.preventDefault();
        appendPadToken(track, container, Number(key) - 1);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const selection = getSelection(track.id, container);
        if (selection.length === 0) {
          return;
        }
        event.preventDefault();
        const nextPattern = removePadLoopItemsFromContainer(track.padLoopPattern, container, selection);
        if (nextPattern !== track.padLoopPattern) {
          commitTrackPattern(track, nextPattern);
          setSelection(track.id, container, []);
        }
      }
    },
    [appendPadToken, commitTrackPattern, getSelection, setSelection]
  );

  const timelineWidth = Math.max(maxRootSteps * stepPixelWidth, 240);
  const maxTimelineScrollLeft = Math.max(0, timelineWidth - timelineViewportWidth);
  const zoomPercent = Math.round((stepPixelWidth / DEFAULT_STEP_PIXEL_WIDTH) * 100);
  const canZoomOut = stepPixelWidth > MIN_STEP_PIXEL_WIDTH;
  const canZoomIn = stepPixelWidth < MAX_STEP_PIXEL_WIDTH;

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) {
      return;
    }
    const updateWidth = () => {
      setTimelineViewportWidth(viewport.clientWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [arrangerTracks.length]);

  useEffect(() => {
    setTimelineScrollLeft((previous) => Math.min(previous, maxTimelineScrollLeft));
  }, [maxTimelineScrollLeft]);

  useEffect(() => {
    const scrollbar = timelineScrollbarRef.current;
    if (!scrollbar) {
      return;
    }
    if (Math.abs(scrollbar.scrollLeft - timelineScrollLeft) <= 1) {
      return;
    }
    scrollbar.scrollLeft = timelineScrollLeft;
  }, [timelineScrollLeft]);

  if (arrangerTracks.length === 0) {
    return null;
  }

  return (
    <div className="relative mt-4 rounded-xl border border-amber-700/45 bg-slate-950/85 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-amber-200">Multitrack Arranger</div>
        <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-300">
          1 device (auto)
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStepPixelWidth((value) => Math.max(MIN_STEP_PIXEL_WIDTH, value - STEP_PIXEL_WIDTH_ZOOM_STEP))}
            disabled={!canZoomOut}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Zoom -
          </button>
          <button
            type="button"
            onClick={() => setStepPixelWidth((value) => Math.min(MAX_STEP_PIXEL_WIDTH, value + STEP_PIXEL_WIDTH_ZOOM_STEP))}
            disabled={!canZoomIn}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Zoom +
          </button>
          <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-300">
            {zoomPercent}%
          </span>
        </div>
      </div>
      <div className="mb-2 grid grid-cols-[280px_minmax(0,1fr)] gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
        <div>Instrument</div>
        <div>Pattern Timeline (4-step grid)</div>
      </div>

      <div className="space-y-2">
        {arrangerTracks.map((track) => {
          const rootTimeline = rootTimelines[track.key] ?? {
            sequence: [],
            allTokens: [],
            visibleTokens: [],
            totalSteps: STEP_GRID_QUANTUM
          };
          const openContainer = openContainerByTrack[track.id];
          const rowSelection = getSelection(track.id, { kind: "root" });
          const selectedSet = new Set(rowSelection);

          return (
            <div key={track.key} className="rounded-lg border border-slate-700 bg-slate-900/70 p-2">
              <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-2">
                <div className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-100">{track.title}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{track.subtitle}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    {track.enabled ? "running" : "stopped"}
                  </div>
                </div>

                <div
                  ref={track.index === 0 ? timelineViewportRef : null}
                  className="overflow-hidden"
                >
                  <div
                    role="list"
                    tabIndex={0}
                    onKeyDown={(event) => handleContainerKeyDown(event, track, { kind: "root" })}
                    onClick={() => {
                      setSelection(track.id, { kind: "root" }, []);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        trackId: track.id,
                        container: { kind: "root" }
                      });
                    }}
                    className="relative h-12 rounded-md border border-slate-700 bg-slate-950/80 outline-none ring-accent/40 focus:ring"
                    style={{
                      width: `${timelineWidth}px`,
                      transform: `translateX(${-timelineScrollLeft}px)`
                    }}
                  >
                    {Array.from({ length: Math.floor(maxRootSteps / STEP_GRID_QUANTUM) + 1 }, (_, gridIndex) => {
                      const left = gridIndex * STEP_GRID_QUANTUM * stepPixelWidth;
                      return (
                        <span
                          key={`${track.id}-grid-${gridIndex}`}
                          className="pointer-events-none absolute inset-y-0 border-l border-slate-800/70"
                          style={{ left: `${left}px` }}
                          aria-hidden
                        />
                      );
                    })}

                    {quantizedPlayhead !== null && (
                      <span
                        className="pointer-events-none absolute inset-y-0 z-20 w-[2px] rounded-full bg-amber-300/80"
                        style={{ left: `${quantizedPlayhead * stepPixelWidth}px` }}
                        aria-hidden
                      />
                    )}

                    {rootTimeline.visibleTokens.map((token) => {
                      const selected = selectedSet.has(token.sourceIndex);
                      const preview =
                        rootDragPreview &&
                        rootDragPreview.trackId === track.id &&
                        rootDragPreview.sourceIndex === token.sourceIndex
                          ? rootDragPreview
                          : null;
                      const tokenStart = preview ? preview.nextStartStep : token.startStep;
                      const tokenWidth = token.stepCount * stepPixelWidth;
                      const tokenIsOpen =
                        token.item.type === "group"
                          ? openContainer?.kind === "group" && openContainer.id === token.item.groupId
                          : token.item.type === "super"
                            ? openContainer?.kind === "super" && openContainer.id === token.item.superGroupId
                            : false;

                      return (
                        <div
                          key={`${track.id}-root-${token.sourceIndex}`}
                          className={`absolute top-1.5 flex h-9 items-center rounded-md border px-1 text-[11px] ${tokenClass(token.item)} ${
                            selected ? "ring-2 ring-cyan-300/60" : ""
                          } ${preview && !preview.valid ? "opacity-45" : ""}`}
                          style={{ left: `${tokenStart * stepPixelWidth}px`, width: `${tokenWidth}px` }}
                        >
                          <button
                            type="button"
                            onPointerDown={(event) =>
                              startRootDrag(event, track, token, rootTimeline.totalSteps, rootTimeline.visibleTokens)
                            }
                            className="mr-1 inline-flex h-6 w-4 shrink-0 items-center justify-center rounded border border-slate-600 bg-slate-950/80 text-[10px] text-slate-300"
                            title="Drag token"
                            aria-label="Drag token"
                          >
                            ::
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              const current = getSelection(track.id, { kind: "root" });
                              if (event.metaKey || event.ctrlKey) {
                                const next = current.includes(token.sourceIndex)
                                  ? current.filter((index) => index !== token.sourceIndex)
                                  : [...current, token.sourceIndex];
                                setSelection(track.id, { kind: "root" }, next);
                              } else {
                                setSelection(track.id, { kind: "root" }, [token.sourceIndex]);
                              }

                              if (token.item.type === "group") {
                                const groupId = token.item.groupId;
                                setOpenContainerByTrack((previous) => {
                                  const current = previous[track.id];
                                  const alreadyOpen = current?.kind === "group" && current.id === groupId;
                                  return {
                                    ...previous,
                                    [track.id]:
                                      alreadyOpen
                                        ? ({ kind: "root" } as PadLoopContainerRef)
                                        : ({ kind: "group", id: groupId } as PadLoopContainerRef)
                                  };
                                });
                              }
                              if (token.item.type === "super") {
                                const superGroupId = token.item.superGroupId;
                                setOpenContainerByTrack((previous) => {
                                  const current = previous[track.id];
                                  const alreadyOpen = current?.kind === "super" && current.id === superGroupId;
                                  return {
                                    ...previous,
                                    [track.id]:
                                      alreadyOpen
                                        ? ({ kind: "root" } as PadLoopContainerRef)
                                        : ({ kind: "super", id: superGroupId } as PadLoopContainerRef)
                                  };
                                });
                              }
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const current = getSelection(track.id, { kind: "root" });
                              const nextSelection = current.includes(token.sourceIndex)
                                ? current
                                : [token.sourceIndex];
                              setSelection(track.id, { kind: "root" }, nextSelection);
                              setContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                trackId: track.id,
                                container: { kind: "root" }
                              });
                            }}
                            className="min-w-0 flex-1 truncate text-left font-mono"
                            title={tokenLabel(token.item)}
                          >
                            {tokenLabel(token.item)}{tokenIsOpen ? " ▾" : ""}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {openContainer && openContainer.kind !== "root" ? (
                <OpenedContainerEditor
                  track={track}
                  container={openContainer}
                  buildTimeline={buildTimeline}
                  onClose={() => {
                    setOpenContainerByTrack((previous) => ({
                      ...previous,
                      [track.id]: { kind: "root" }
                    }));
                  }}
                  onPatternCommit={(nextPattern) => commitTrackPattern(track, nextPattern)}
                  getSelection={(container) => getSelection(track.id, container)}
                  setSelection={(container, indexes) => setSelection(track.id, container, indexes)}
                  openNestedContainer={(container) => {
                    setOpenContainerByTrack((previous) => ({
                      ...previous,
                      [track.id]: container
                    }));
                  }}
                  onContextMenu={(event, container) => {
                    event.preventDefault();
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      trackId: track.id,
                      container
                    });
                  }}
                  onContainerKeyDown={(event, container) => handleContainerKeyDown(event, track, container)}
                  onAppendPad={(padIndex) => appendPadToken(track, openContainer, padIndex)}
                  onAppendPause={(stepCount) => appendPauseToken(track, openContainer, stepCount)}
                  stepPixelWidth={stepPixelWidth}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-2 grid grid-cols-[280px_minmax(0,1fr)] gap-2">
        <div />
        <div
          ref={timelineScrollbarRef}
          className="h-4 overflow-x-auto overflow-y-hidden rounded border border-slate-700 bg-slate-900/60"
          onScroll={(event) => {
            setTimelineScrollLeft(event.currentTarget.scrollLeft);
          }}
        >
          <div style={{ width: `${timelineWidth}px`, height: "1px" }} />
        </div>
      </div>

      {contextMenu ? (
        <ArrangerContextMenu
          contextMenu={contextMenu}
          tracks={arrangerTracks}
          getSelection={getSelection}
          setSelection={setSelection}
          commitTrackPattern={commitTrackPattern}
          close={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

type OpenedContainerEditorProps = {
  track: ArrangerTrack;
  container:
    | {
        kind: "group";
        id: string;
      }
    | {
        kind: "super";
        id: string;
      };
  buildTimeline: (
    track: ArrangerTrack,
    container: PadLoopContainerRef,
    includePauseTokens: boolean
  ) => {
    sequence: PadLoopPatternItem[];
    allTokens: ArrangerTimelineToken[];
    visibleTokens: ArrangerTimelineToken[];
    totalSteps: number;
  };
  onClose: () => void;
  onPatternCommit: (pattern: PadLoopPatternState) => void;
  getSelection: (container: PadLoopContainerRef) => number[];
  setSelection: (container: PadLoopContainerRef, indexes: number[]) => void;
  openNestedContainer: (container: PadLoopContainerRef) => void;
  onContextMenu: (event: ReactMouseEvent, container: PadLoopContainerRef) => void;
  onContainerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, container: PadLoopContainerRef) => void;
  onAppendPad: (padIndex: number) => void;
  onAppendPause: (stepCount: number) => void;
  stepPixelWidth: number;
};

function OpenedContainerEditor({
  track,
  container,
  buildTimeline,
  onClose,
  onPatternCommit,
  getSelection,
  setSelection,
  openNestedContainer,
  onContextMenu,
  onContainerKeyDown,
  onAppendPad,
  onAppendPause,
  stepPixelWidth
}: OpenedContainerEditorProps) {
  const timeline = buildTimeline(track, container, true);
  const tokenSelection = getSelection(container);
  const selectedSet = new Set(tokenSelection);
  const label = container.kind === "group" ? `Group ${container.id}` : `Super-group ${container.id}`;

  return (
    <div className="mt-2 ml-[288px] rounded-md border border-slate-700 bg-slate-950/75 p-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">{label}</div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
        >
          Main
        </button>
        <span className="text-[10px] text-slate-500">Pause tokens are visible in opened groups.</span>
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        {Array.from({ length: 8 }, (_, index) => (
          <button
            key={`${track.id}-pad-add-${index}`}
            type="button"
            onClick={() => onAppendPad(index)}
            className="rounded border border-cyan-500/45 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200 hover:border-cyan-300/70"
          >
            {index + 1}
          </button>
        ))}
        {PAD_LOOP_PAUSE_STEP_OPTIONS.map((stepCount) => (
          <button
            key={`${track.id}-pause-add-${stepCount}`}
            type="button"
            onClick={() => onAppendPause(stepCount)}
            className="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
          >
            P{stepCount}
          </button>
        ))}
      </div>

      <div
        role="list"
        tabIndex={0}
        onKeyDown={(event) => onContainerKeyDown(event, container)}
        onClick={() => setSelection(container, [])}
        onContextMenu={(event) => onContextMenu(event, container)}
        className="flex min-h-[42px] flex-wrap items-center gap-1 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 outline-none ring-accent/40 focus:ring"
      >
        {timeline.visibleTokens.length === 0 ? (
          <span className="text-[11px] text-slate-500">Empty</span>
        ) : (
          timeline.visibleTokens.map((token) => {
            const selected = selectedSet.has(token.sourceIndex);
            return (
              <div
                key={`${track.id}-${containerKey(container)}-${token.sourceIndex}`}
                draggable
                onDragStart={(event) => {
                  const payload: ArrangerTokenDragPayload = {
                    trackId: track.id,
                    container,
                    sourceIndex: token.sourceIndex
                  };
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(TOKEN_REORDER_DRAG_MIME, JSON.stringify(payload));
                  event.dataTransfer.setData("text/plain", JSON.stringify(payload));
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const payload = parseTokenDragPayload(event);
                  if (!payload || payload.trackId !== track.id || !sameContainer(payload.container, container)) {
                    return;
                  }
                  const nextPattern = movePadLoopItemWithinContainer(
                    track.padLoopPattern,
                    container,
                    payload.sourceIndex,
                    token.sourceIndex
                  );
                  if (nextPattern !== track.padLoopPattern) {
                    onPatternCommit(nextPattern);
                  }
                }}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${tokenClass(token.item)} ${
                  selected ? "ring-2 ring-cyan-300/60" : ""
                }`}
                style={{ width: `${Math.max(token.stepCount * stepPixelWidth, 32)}px` }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const current = getSelection(container);
                  const nextSelection = current.includes(token.sourceIndex) ? current : [token.sourceIndex];
                  setSelection(container, nextSelection);
                  onContextMenu(event, container);
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    const current = getSelection(container);
                    if (event.metaKey || event.ctrlKey) {
                      const next = current.includes(token.sourceIndex)
                        ? current.filter((index) => index !== token.sourceIndex)
                        : [...current, token.sourceIndex];
                      setSelection(container, next);
                    } else {
                      setSelection(container, [token.sourceIndex]);
                    }
                    if (token.item.type === "group") {
                      openNestedContainer({ kind: "group", id: token.item.groupId });
                    }
                    if (token.item.type === "super") {
                      openNestedContainer({ kind: "super", id: token.item.superGroupId });
                    }
                  }}
                  className="min-w-0 flex-1 truncate text-left font-mono"
                >
                  {tokenLabel(token.item)}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextPattern = removePadLoopItemsFromContainer(track.padLoopPattern, container, [token.sourceIndex]);
                    if (nextPattern !== track.padLoopPattern) {
                      onPatternCommit(nextPattern);
                    }
                  }}
                  className="rounded px-1 text-[10px] text-slate-300 hover:bg-black/25 hover:text-rose-200"
                  aria-label="Remove token"
                >
                  x
                </button>
              </div>
            );
          })
        )}

        {timeline.visibleTokens.length > 0 && (
          <span
            className="h-6 w-[2px] rounded-full bg-accent/85"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const payload = parseTokenDragPayload(event);
              if (!payload || payload.trackId !== track.id || !sameContainer(payload.container, container)) {
                return;
              }
              const nextPattern = movePadLoopItemWithinContainer(
                track.padLoopPattern,
                container,
                payload.sourceIndex,
                timeline.sequence.length
              );
              if (nextPattern !== track.padLoopPattern) {
                onPatternCommit(nextPattern);
              }
            }}
          />
        )}

        <span className="text-[10px] text-slate-500">Drag to reorder</span>
      </div>

      <div className="mt-1 text-[10px] text-slate-500">Total steps: {timeline.totalSteps}</div>
    </div>
  );
}

type ArrangerContextMenuProps = {
  contextMenu: ArrangerContextMenuState;
  tracks: ArrangerTrack[];
  getSelection: (trackId: string, container: PadLoopContainerRef) => number[];
  setSelection: (trackId: string, container: PadLoopContainerRef, indexes: number[]) => void;
  commitTrackPattern: (track: ArrangerTrack, nextPattern: PadLoopPatternState) => void;
  close: () => void;
};

function ArrangerContextMenu({
  contextMenu,
  tracks,
  getSelection,
  setSelection,
  commitTrackPattern,
  close
}: ArrangerContextMenuProps) {
  const track = tracks.find((candidate) => candidate.id === contextMenu.trackId) ?? null;
  const selection = track ? getSelection(track.id, contextMenu.container) : [];

  if (!track) {
    return null;
  }

  const canGroup = canCreatePadLoopGroupFromSelection(track.padLoopPattern, contextMenu.container, selection, "group");
  const canSuper = canCreatePadLoopGroupFromSelection(track.padLoopPattern, contextMenu.container, selection, "super");
  const canUngroup = selection.length > 0;
  const canRemove = selection.length > 0;

  const handleAction = (action: "group" | "super" | "ungroup" | "remove") => {
    let nextPattern = track.padLoopPattern;
    if (action === "group") {
      nextPattern = groupPadLoopItemsInContainer(track.padLoopPattern, contextMenu.container, selection, "group");
    } else if (action === "super") {
      nextPattern = groupPadLoopItemsInContainer(track.padLoopPattern, contextMenu.container, selection, "super");
    } else if (action === "ungroup") {
      nextPattern = ungroupPadLoopItemsInContainer(track.padLoopPattern, contextMenu.container, selection);
    } else {
      nextPattern = removePadLoopItemsFromContainer(track.padLoopPattern, contextMenu.container, selection);
    }
    if (nextPattern !== track.padLoopPattern) {
      commitTrackPattern(track, nextPattern);
      setSelection(track.id, contextMenu.container, []);
    }
    close();
  };

  return (
    <div
      className="fixed z-[1700] w-48 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
        {track.title} / {containerKey(contextMenu.container)}
      </div>

      <button
        type="button"
        disabled={!canGroup}
        onClick={() => handleAction("group")}
        className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
          canGroup ? "text-slate-200 hover:bg-slate-800" : "cursor-not-allowed text-slate-500"
        }`}
      >
        <span>Group</span>
        <span className="text-[10px] text-orange-300">A..Z</span>
      </button>

      <button
        type="button"
        disabled={!canSuper}
        onClick={() => handleAction("super")}
        className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
          canSuper ? "text-slate-200 hover:bg-slate-800" : "cursor-not-allowed text-slate-500"
        }`}
      >
        <span>Super-group</span>
        <span className="text-[10px] text-violet-300">I..X</span>
      </button>

      <button
        type="button"
        disabled={!canUngroup}
        onClick={() => handleAction("ungroup")}
        className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
          canUngroup ? "text-slate-200 hover:bg-slate-800" : "cursor-not-allowed text-slate-500"
        }`}
      >
        <span>Ungroup</span>
        <span className="text-[10px] text-slate-400">inline</span>
      </button>

      <button
        type="button"
        disabled={!canRemove}
        onClick={() => handleAction("remove")}
        className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
          canRemove ? "text-rose-200 hover:bg-rose-500/10" : "cursor-not-allowed text-slate-500"
        }`}
      >
        <span>Remove</span>
        <span className="text-[10px] text-slate-400">{selection.length}</span>
      </button>
    </div>
  );
}
