import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent
} from "react";

import {
  PAD_LOOP_PAD_COUNT,
  PAD_LOOP_PAUSE_STEP_OPTIONS,
  canCreatePadLoopGroupFromSelection,
  canInsertItemIntoPadLoopContainer,
  compilePadLoopPattern,
  decodePadLoopPauseToken,
  getPadLoopContainerSequence,
  groupPadLoopItemsInContainer,
  insertPadLoopItem,
  itemColorKind,
  itemDisplayLabel,
  movePadLoopItemWithinContainer,
  removePadLoopItemsFromContainer,
  ungroupPadLoopItemsInContainer,
  type PadLoopContainerRef
} from "../../lib/padLoopPattern";
import type { PadLoopPatternItem, PadLoopPatternState } from "../../types";
import { numberArrayEqual } from "./PianoRollKeyboard";
import type { SequencerUiCopy } from "./sequencerUiCopy";

const PAD_LOOP_ITEM_DRAG_MIME = "application/x-visualcsound-pad-loop-item";
const PAD_LOOP_REF_DRAG_MIME = "application/x-visualcsound-pad-loop-ref";
const SEQUENCER_PAD_DRAG_MIME = "application/x-visualcsound-sequencer-pad";

type SequencerPadDragPayload = {
  trackId: string;
  padIndex: number;
};

type PadLoopItemDragPayload = {
  sourceContainer: PadLoopContainerRef;
  sourceIndex: number;
};

type PadLoopReferenceDragPayload = {
  item: PadLoopPatternItem;
};


function dragEventHasMimeType(event: ReactDragEvent, mimeType: string): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes(mimeType);
}

function parseSequencerPadDragPayload(event: ReactDragEvent): SequencerPadDragPayload | null {
  const raw =
    event.dataTransfer.getData(SEQUENCER_PAD_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SequencerPadDragPayload>;
    if (typeof parsed.trackId !== "string" || typeof parsed.padIndex !== "number" || !Number.isFinite(parsed.padIndex)) {
      return null;
    }
    return {
      trackId: parsed.trackId,
      padIndex: Math.round(parsed.padIndex)
    };
  } catch {
    return null;
  }
}

function parsePadLoopItemDragPayload(event: ReactDragEvent): PadLoopItemDragPayload | null {
  const raw = event.dataTransfer.getData(PAD_LOOP_ITEM_DRAG_MIME) || event.dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PadLoopItemDragPayload>;
    if (
      !parsed.sourceContainer ||
      typeof parsed.sourceContainer !== "object" ||
      typeof parsed.sourceIndex !== "number" ||
      !Number.isFinite(parsed.sourceIndex)
    ) {
      return null;
    }
    const sourceContainer = parsed.sourceContainer as Partial<PadLoopContainerRef>;
    if (sourceContainer.kind === "root") {
      return {
        sourceContainer: { kind: "root" },
        sourceIndex: Math.round(parsed.sourceIndex)
      };
    }
    if (
      (sourceContainer.kind === "group" || sourceContainer.kind === "super") &&
      typeof sourceContainer.id === "string"
    ) {
      return {
        sourceContainer: {
          kind: sourceContainer.kind,
          id: sourceContainer.id
        },
        sourceIndex: Math.round(parsed.sourceIndex)
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parsePadLoopReferenceDragPayload(event: ReactDragEvent): PadLoopReferenceDragPayload | null {
  const raw = event.dataTransfer.getData(PAD_LOOP_REF_DRAG_MIME);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PadLoopReferenceDragPayload>;
    if (!parsed.item || typeof parsed.item !== "object") {
      return null;
    }
    const item = parsed.item as Partial<PadLoopPatternItem>;
    if (item.type === "pad" && typeof item.padIndex === "number") {
      return {
        item: {
          type: "pad",
          padIndex: Math.max(0, Math.min(7, Math.round(item.padIndex)))
        }
      };
    }
    if (item.type === "group" && typeof item.groupId === "string") {
      return {
        item: {
          type: "group",
          groupId: item.groupId
        }
      };
    }
  if (item.type === "super" && typeof item.superGroupId === "string") {
      return {
        item: {
          type: "super",
          superGroupId: item.superGroupId
        }
      };
    }
    if (item.type === "pause" && typeof item.lengthBeats === "number") {
      const normalizedLengthBeats = Math.round(item.lengthBeats);
      if (
        normalizedLengthBeats === 1 ||
        normalizedLengthBeats === 2 ||
        normalizedLengthBeats === 4 ||
        normalizedLengthBeats === 8 ||
        normalizedLengthBeats === 16
      ) {
        return {
          item: {
            type: "pause",
            lengthBeats: normalizedLengthBeats
          }
        };
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

function padSequencePadIndexFromKey(event: ReactKeyboardEvent): number | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  if (!/^[1-8]$/.test(event.key)) {
    return null;
  }
  return Number(event.key) - 1;
}


function padLoopContainerKey(container: PadLoopContainerRef): string {
  if (container.kind === "root") {
    return "root";
  }
  return `${container.kind}:${container.id}`;
}

function padLoopContainerLabel(container: PadLoopContainerRef): string {
  if (container.kind === "root") {
    return "Main";
  }
  return container.id;
}

function padLoopContainerFromItem(item: PadLoopPatternItem): PadLoopContainerRef | null {
  if (item.type === "group") {
    return { kind: "group", id: item.groupId };
  }
  if (item.type === "super") {
    return { kind: "super", id: item.superGroupId };
  }
  return null;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function padLoopTokenColors(
  item: PadLoopPatternItem,
  seed: number,
  selected: boolean,
  active: boolean,
  linked: boolean
): CSSProperties {
  const kind = itemColorKind(item);
  const hue = kind === "pad" ? 142 : kind === "pause" ? 198 : kind === "group" ? 28 : 272;
  const shadeSeed = seed + (kind === "pad" ? 7 : kind === "pause" ? 9 : kind === "group" ? 11 : 17);
  const light = 20 + (shadeSeed % 6) * 4;
  const borderAlpha = active ? 0.95 : linked ? 0.9 : selected ? 0.8 : 0.58;
  const bgAlpha = active ? 0.3 : linked ? 0.26 : selected ? 0.24 : 0.18;
  return {
    borderColor: `hsla(${hue}, 82%, ${Math.min(88, light + 32)}%, ${borderAlpha})`,
    backgroundColor: `hsla(${hue}, 85%, ${light}%, ${bgAlpha})`,
    color: `hsl(${hue}, 92%, 88%)`,
    boxShadow: active
      ? `0 0 0 1px hsla(${hue}, 90%, 70%, 0.5), inset 0 1px 0 hsla(${hue}, 90%, 90%, 0.08)`
      : linked
        ? `0 0 0 1px hsla(${hue}, 90%, 70%, 0.38), 0 0 0 3px hsla(${hue}, 90%, 55%, 0.2), inset 0 1px 0 hsla(${hue}, 90%, 90%, 0.08)`
      : selected
        ? `0 0 0 1px hsla(${hue}, 90%, 70%, 0.22) inset`
        : "inset 0 1px 0 rgba(255,255,255,0.03)"
  };
}

type PadLoopCompiledRange = {
  start: number;
  end: number;
};

type PadLoopRangeIndex = Record<string, PadLoopCompiledRange[][]>;

function buildPadLoopRangeIndex(
  pattern: PadLoopPatternState,
  tokenStepCount: (item: PadLoopPatternItem) => number = () => 1
): PadLoopRangeIndex {
  const byKey: PadLoopRangeIndex = {};
  const groups = new Map(pattern.groups.map((group) => [group.id, group]));
  const superGroups = new Map(pattern.superGroups.map((group) => [group.id, group]));
  let cursor = 0;

  const ensureContainer = (containerKey: string, length: number): PadLoopCompiledRange[][] => {
    const current = byKey[containerKey] ?? [];
    if (current.length < length) {
      for (let index = current.length; index < length; index += 1) {
        current.push([]);
      }
    }
    byKey[containerKey] = current;
    return current;
  };

  const walkSequence = (
    container: PadLoopContainerRef,
    sequence: PadLoopPatternItem[],
    path: string[]
  ): void => {
    const containerKey = padLoopContainerKey(container);
    const containerRanges = ensureContainer(containerKey, sequence.length);

    for (let index = 0; index < sequence.length; index += 1) {
      const item = sequence[index];
      const start = cursor;
      if (!item) {
        containerRanges[index].push({ start, end: start });
        continue;
      }

      if (item.type === "pad") {
        cursor += Math.max(1, Math.round(tokenStepCount(item)));
      } else if (item.type === "pause") {
        cursor += Math.max(1, Math.round(tokenStepCount(item)));
      } else if (item.type === "group") {
        const refKey = `group:${item.groupId}`;
        if (!path.includes(refKey)) {
          const group = groups.get(item.groupId);
          if (group) {
            walkSequence({ kind: "group", id: item.groupId }, group.sequence, [...path, refKey]);
          }
        }
      } else if (item.type === "super") {
        const refKey = `super:${item.superGroupId}`;
        if (!path.includes(refKey)) {
          const group = superGroups.get(item.superGroupId);
          if (group) {
            walkSequence({ kind: "super", id: item.superGroupId }, group.sequence, [...path, refKey]);
          }
        }
      }

      containerRanges[index].push({ start, end: cursor });
    }
  };

  walkSequence({ kind: "root" }, pattern.rootSequence, []);
  return byKey;
}

type PadLoopEditorTrackLike = {
  id: string;
  enabled: boolean;
  padLoopEnabled: boolean;
  padLoopRepeat: boolean;
  padLoopPosition: number | null;
  padLoopPattern: PadLoopPatternState;
};

type PadLoopPatternEditorProps = {
  ui: Pick<
    SequencerUiCopy,
    "padLoopSequence" | "padLoopSequenceEmpty" | "padLoopSequenceHint" | "padLooper" | "repeat" | "on" | "off" | "remove"
  >;
  hostId: string;
  track: PadLoopEditorTrackLike;
  stepsPerBeat: number;
  padStepCounts: number[];
  defaultPadStepCount: number;
  isPlaying: boolean;
  linkedPadLoopStepPosition: number | null;
  onLinkedPadLoopStepPositionChange: (position: number | null) => void;
  onPadLoopEnabledChange: (enabled: boolean) => void;
  onPadLoopRepeatChange: (repeat: boolean) => void;
  onPadLoopPatternChange: (pattern: PadLoopPatternState) => void;
};

type PadLoopContextMenuState = {
  x: number;
  y: number;
  container: PadLoopContainerRef;
};

export const PadLoopPatternEditor = memo(function PadLoopPatternEditor({
  ui,
  hostId,
  track,
  stepsPerBeat,
  padStepCounts,
  defaultPadStepCount,
  isPlaying,
  linkedPadLoopStepPosition,
  onLinkedPadLoopStepPositionChange,
  onPadLoopEnabledChange,
  onPadLoopRepeatChange,
  onPadLoopPatternChange
}: PadLoopPatternEditorProps) {
  const [activeContainer, setActiveContainer] = useState<PadLoopContainerRef>({ kind: "root" });
  const [selectionByContainer, setSelectionByContainer] = useState<Record<string, number[]>>({});
  const [contextMenu, setContextMenu] = useState<PadLoopContextMenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ containerKey: string; index: number } | null>(null);
  const draggedItemRef = useRef<PadLoopItemDragPayload | null>(null);

  const compiledPattern = useMemo(() => compilePadLoopPattern(track.padLoopPattern), [track.padLoopPattern]);
  const compiledPatternStepCount = useMemo(() => {
    const normalizedFallback = Math.max(1, Math.round(defaultPadStepCount));
    let total = 0;
    for (const token of compiledPattern.sequence) {
      if (token >= 0) {
        const padIndex = Math.round(token);
        const candidate =
          padIndex >= 0 && padIndex < PAD_LOOP_PAD_COUNT
            ? padStepCounts[padIndex]
            : undefined;
        const normalized = typeof candidate === "number" && Number.isFinite(candidate) ? Math.round(candidate) : normalizedFallback;
        total += normalized > 0 ? normalized : normalizedFallback;
        continue;
      }
      const pauseStepCount = decodePadLoopPauseToken(token);
      if (pauseStepCount !== null) {
        total += pauseStepCount * Math.max(1, Math.round(stepsPerBeat));
      }
    }
    return total;
  }, [compiledPattern.sequence, defaultPadStepCount, padStepCounts, stepsPerBeat]);
  const rangeIndexByContainer = useMemo(() => buildPadLoopRangeIndex(track.padLoopPattern), [track.padLoopPattern]);
  const timelineRangeIndexByContainer = useMemo(() => {
    const normalizedFallback = Math.max(1, Math.round(defaultPadStepCount));
    return buildPadLoopRangeIndex(track.padLoopPattern, (item) => {
      if (item.type === "pause") {
        return Math.max(1, Math.round(item.lengthBeats * Math.max(1, Math.round(stepsPerBeat))));
      }
      if (item.type === "pad") {
        const candidate = padStepCounts[item.padIndex];
        const normalized = typeof candidate === "number" && Number.isFinite(candidate) ? Math.round(candidate) : normalizedFallback;
        return normalized > 0 ? normalized : normalizedFallback;
      }
      return 1;
    });
  }, [defaultPadStepCount, padStepCounts, stepsPerBeat, track.padLoopPattern]);

  useEffect(() => {
    if (activeContainer.kind === "root") {
      return;
    }
    if (getPadLoopContainerSequence(track.padLoopPattern, activeContainer) !== null) {
      return;
    }
    setActiveContainer({ kind: "root" });
  }, [activeContainer, track.padLoopPattern]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handlePointerDown = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const selectedIndexesFor = useCallback(
    (container: PadLoopContainerRef): number[] => selectionByContainer[padLoopContainerKey(container)] ?? [],
    [selectionByContainer]
  );

  const setSelectionFor = useCallback((container: PadLoopContainerRef, nextIndexes: number[]) => {
    const key = padLoopContainerKey(container);
    const normalized = Array.from(new Set(nextIndexes.map((index) => Math.max(0, Math.round(index))))).sort(
      (a, b) => a - b
    );
    setSelectionByContainer((previous) =>
      normalized.length === 0 ? Object.fromEntries(Object.entries(previous).filter(([entryKey]) => entryKey !== key)) : { ...previous, [key]: normalized }
    );
  }, []);

  const commitPattern = useCallback(
    (nextPattern: PadLoopPatternState) => {
      onPadLoopPatternChange(nextPattern);
      setContextMenu(null);
    },
    [onPadLoopPatternChange]
  );

  const applyDrop = useCallback(
    (event: ReactDragEvent, container: PadLoopContainerRef, insertIndex: number) => {
      const padPayload = parseSequencerPadDragPayload(event);
      if (padPayload && padPayload.trackId === hostId) {
        const nextPattern = insertPadLoopItem(track.padLoopPattern, container, insertIndex, {
          type: "pad",
          padIndex: padPayload.padIndex
        });
        if (nextPattern !== track.padLoopPattern) {
          commitPattern(nextPattern);
        }
        return true;
      }

      const itemPayload = parsePadLoopItemDragPayload(event);
      const resolvedItemPayload = itemPayload ?? draggedItemRef.current;
      if (resolvedItemPayload) {
        if (padLoopContainerKey(resolvedItemPayload.sourceContainer) !== padLoopContainerKey(container)) {
          return false;
        }
        const nextPattern = movePadLoopItemWithinContainer(
          track.padLoopPattern,
          container,
          resolvedItemPayload.sourceIndex,
          insertIndex
        );
        if (nextPattern !== track.padLoopPattern) {
          commitPattern(nextPattern);
        }
        return true;
      }

      const refPayload = parsePadLoopReferenceDragPayload(event);
      if (refPayload) {
        if (!canInsertItemIntoPadLoopContainer(track.padLoopPattern, container, refPayload.item)) {
          return false;
        }
        const nextPattern = insertPadLoopItem(track.padLoopPattern, container, insertIndex, refPayload.item);
        if (nextPattern !== track.padLoopPattern) {
          commitPattern(nextPattern);
        }
        return true;
      }

      return false;
    },
    [commitPattern, hostId, track.padLoopPattern]
  );

  const sequencePanel = useCallback(
    (container: PadLoopContainerRef, title: string, emphasis: "root" | "group" | "super") => {
      const sequence = getPadLoopContainerSequence(track.padLoopPattern, container) ?? [];
      const containerKey = padLoopContainerKey(container);
      const selectedIndexes = selectedIndexesFor(container);
      const selectedIndexSet = new Set(selectedIndexes);

      const openContextMenu = (event: ReactMouseEvent, fallbackSelection?: number[]) => {
        event.preventDefault();
        event.stopPropagation();
        if (fallbackSelection) {
          setSelectionFor(container, fallbackSelection);
        }
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          container
        });
      };

      const selectToken = (event: ReactMouseEvent, index: number, item: PadLoopPatternItem) => {
        event.stopPropagation();
        const current = selectedIndexesFor(container);
        const stepRanges = timelineRangeIndexByContainer[containerKey]?.[index] ?? [];
        const linkedPosition = stepRanges.find((range) => range.end > range.start)?.start ?? null;
        onLinkedPadLoopStepPositionChange(linkedPosition);
        if (event.metaKey || event.ctrlKey) {
          const next = current.includes(index) ? current.filter((value) => value !== index) : [...current, index];
          setSelectionFor(container, next);
        } else {
          setSelectionFor(container, [index]);
          if (item.type !== "pad") {
            const nested = padLoopContainerFromItem(item);
            if (nested) {
              setActiveContainer(nested);
            }
          }
        }
      };

      const containerHueClass =
        emphasis === "group"
          ? "border-orange-400/35 bg-orange-500/5"
          : emphasis === "super"
            ? "border-violet-400/35 bg-violet-500/5"
            : "border-slate-700 bg-slate-900/55";

      const panelLabelClass =
        emphasis === "group"
          ? "text-orange-200"
          : emphasis === "super"
            ? "text-violet-200"
            : "text-slate-300";

      const supportsPadLoopDrop = (event: ReactDragEvent): boolean =>
        dragEventHasMimeType(event, SEQUENCER_PAD_DRAG_MIME) ||
        dragEventHasMimeType(event, PAD_LOOP_ITEM_DRAG_MIME) ||
        dragEventHasMimeType(event, PAD_LOOP_REF_DRAG_MIME) ||
        draggedItemRef.current !== null;

      const updatePadLoopDropEffect = (event: ReactDragEvent) => {
        const itemDragPayload = parsePadLoopItemDragPayload(event) ?? draggedItemRef.current;
        event.dataTransfer.dropEffect =
          itemDragPayload &&
          padLoopContainerKey(itemDragPayload.sourceContainer) === padLoopContainerKey(container)
            ? "move"
            : "copy";
      };

      return (
        <div className={`flex flex-col gap-1.5 rounded-lg border p-2 ${containerHueClass}`} key={`panel-${containerKey}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${panelLabelClass}`}>{title}</div>
            {container.kind !== "root" && (
              <button
                type="button"
                onClick={() => setActiveContainer({ kind: "root" })}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
              >
                Main
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {PAD_LOOP_PAUSE_STEP_OPTIONS.map((pauseStepCount) => {
              const item: PadLoopPatternItem = { type: "pause", lengthBeats: pauseStepCount };
              const allowed = canInsertItemIntoPadLoopContainer(track.padLoopPattern, container, item);
              return (
                <button
                  key={`${containerKey}-pause-ref-${pauseStepCount}`}
                  type="button"
                  onClick={() => {
                    if (allowed) {
                      commitPattern(insertPadLoopItem(track.padLoopPattern, container, sequence.length, item));
                    }
                  }}
                  draggable
                  onDragStart={(event) => {
                    draggedItemRef.current = null;
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(PAD_LOOP_REF_DRAG_MIME, JSON.stringify({ item }));
                    event.dataTransfer.setData("text/plain", `P${pauseStepCount}`);
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                    allowed
                      ? "border-cyan-500/45 bg-cyan-500/10 text-cyan-200 hover:border-cyan-300/70"
                      : "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  }`}
                  title={`Insert pause token for ${pauseStepCount} beats`}
                >
                  P{pauseStepCount}
                </button>
              );
            })}
            {track.padLoopPattern.groups.map((group) => {
              const item: PadLoopPatternItem = { type: "group", groupId: group.id };
              const allowed = canInsertItemIntoPadLoopContainer(track.padLoopPattern, container, item);
              const isEditing = activeContainer.kind === "group" && activeContainer.id === group.id;
              return (
                <button
                  key={`${containerKey}-group-ref-${group.id}`}
                  type="button"
                  onClick={() => {
                    if (allowed) {
                      commitPattern(insertPadLoopItem(track.padLoopPattern, container, sequence.length, item));
                    }
                    setActiveContainer({ kind: "group", id: group.id });
                  }}
                  draggable
                  onDragStart={(event) => {
                    draggedItemRef.current = null;
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(PAD_LOOP_REF_DRAG_MIME, JSON.stringify({ item }));
                    event.dataTransfer.setData("text/plain", group.id);
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                    isEditing
                      ? "border-orange-300/80 bg-orange-500/20 text-orange-100"
                      : allowed
                        ? "border-orange-500/45 bg-orange-500/10 text-orange-200 hover:border-orange-300/70"
                        : "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  }`}
                  title={allowed ? "Click to add / drag into sequence" : "Groups are not allowed in this level"}
                >
                  {group.id}
                </button>
              );
            })}
            {track.padLoopPattern.superGroups.map((group) => {
              const item: PadLoopPatternItem = { type: "super", superGroupId: group.id };
              const allowed = canInsertItemIntoPadLoopContainer(track.padLoopPattern, container, item);
              const isEditing = activeContainer.kind === "super" && activeContainer.id === group.id;
              return (
                <button
                  key={`${containerKey}-super-ref-${group.id}`}
                  type="button"
                  onClick={() => {
                    if (allowed) {
                      commitPattern(insertPadLoopItem(track.padLoopPattern, container, sequence.length, item));
                    }
                    setActiveContainer({ kind: "super", id: group.id });
                  }}
                  draggable
                  onDragStart={(event) => {
                    draggedItemRef.current = null;
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(PAD_LOOP_REF_DRAG_MIME, JSON.stringify({ item }));
                    event.dataTransfer.setData("text/plain", group.id);
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                    isEditing
                      ? "border-violet-300/80 bg-violet-500/20 text-violet-100"
                      : allowed
                        ? "border-violet-500/45 bg-violet-500/10 text-violet-200 hover:border-violet-300/70"
                        : "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  }`}
                  title={allowed ? "Click to add / drag into sequence" : "Super-groups are not allowed in this level"}
                >
                  {group.id}
                </button>
              );
            })}
            {track.padLoopPattern.groups.length === 0 && track.padLoopPattern.superGroups.length === 0 && (
              <span className="text-[10px] text-slate-500">No groups yet. Select pads/groups, right-click, Group.</span>
            )}
          </div>

          <div
            tabIndex={0}
            role="list"
            aria-label={ui.padLoopSequence}
            onKeyDown={(event) => {
              const padIndex = padSequencePadIndexFromKey(event);
              if (padIndex === null) {
                return;
              }
              event.preventDefault();
              commitPattern(insertPadLoopItem(track.padLoopPattern, container, sequence.length, { type: "pad", padIndex }));
            }}
            onClick={() => {
              setSelectionFor(container, []);
              onLinkedPadLoopStepPositionChange(null);
            }}
            onContextMenu={(event) => openContextMenu(event)}
            onDragOver={(event) => {
              if (!supportsPadLoopDrop(event)) {
                return;
              }
              event.preventDefault();
              updatePadLoopDropEffect(event);
              setDropTarget({ containerKey, index: sequence.length });
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              applyDrop(event, container, sequence.length);
              draggedItemRef.current = null;
            }}
            onDragLeave={() => {
              setDropTarget((previous) => (previous?.containerKey === containerKey ? null : previous));
            }}
            className="min-h-[42px] rounded-md border border-dashed border-slate-700 bg-slate-950/75 px-2 py-1 outline-none ring-accent/40 transition focus:ring"
          >
            {sequence.length === 0 ? (
              <div className="flex min-h-[26px] items-center text-[10px] text-slate-500">{ui.padLoopSequenceEmpty}</div>
            ) : (
              <div className="flex min-h-[26px] flex-wrap items-center gap-1">
                {sequence.map((item, index) => {
                  const nestedContainer = padLoopContainerFromItem(item);
                  const isSelected = selectedIndexSet.has(index);
                  const itemRanges = rangeIndexByContainer[containerKey]?.[index] ?? [];
                  const itemTimelineRanges = timelineRangeIndexByContainer[containerKey]?.[index] ?? [];
                  const isCurrentLoopStep =
                    track.padLoopEnabled &&
                    isPlaying &&
                    track.enabled &&
                    track.padLoopPosition !== null &&
                    itemRanges.some(
                      (range) =>
                        range.end > range.start &&
                        track.padLoopPosition !== null &&
                        track.padLoopPosition >= range.start &&
                        track.padLoopPosition < range.end
                    );
                  const isLinkedStep =
                    linkedPadLoopStepPosition !== null &&
                    itemTimelineRanges.some(
                      (range) =>
                        range.end > range.start &&
                        linkedPadLoopStepPosition >= range.start &&
                        linkedPadLoopStepPosition < range.end
                    );
                  const dropBefore = dropTarget?.containerKey === containerKey && dropTarget.index === index;
                  const label = itemDisplayLabel(item);
                  const seed = item.type === "pad" ? item.padIndex : hashString(label);
                  const tokenStyle = padLoopTokenColors(item, seed + index, isSelected, isCurrentLoopStep, isLinkedStep);

                  return (
                    <Fragment key={`${containerKey}-item-${index}-${label}-${item.type}`}>
                      {dropBefore && <span className="h-5 w-[2px] rounded-full bg-accent/90" aria-hidden />}
                      <span
                        role="listitem"
                        draggable
                        onDragStart={(event) => {
                          const itemPayload = {
                            sourceContainer: container,
                            sourceIndex: index
                          } satisfies PadLoopItemDragPayload;
                          draggedItemRef.current = itemPayload;
                          const payload = JSON.stringify(itemPayload);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(PAD_LOOP_ITEM_DRAG_MIME, payload);
                          event.dataTransfer.setData("text/plain", payload);
                        }}
                        onDragEnd={() => {
                          draggedItemRef.current = null;
                        }}
                        onDragOver={(event) => {
                          if (!supportsPadLoopDrop(event)) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          setDropTarget({ containerKey, index });
                          updatePadLoopDropEffect(event);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setDropTarget(null);
                          applyDrop(event, container, index);
                          draggedItemRef.current = null;
                        }}
                        onContextMenu={(event) => {
                          const current = selectedIndexesFor(container);
                          const fallbackSelection = current.includes(index) ? current : [index];
                          openContextMenu(event, fallbackSelection);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition"
                        style={tokenStyle}
                      >
                        <button
                          type="button"
                          onClick={(event) => selectToken(event, index, item)}
                          className="inline-flex items-center gap-1 rounded px-0.5 text-left outline-none"
                          title={
                            nestedContainer
                              ? `Click to edit ${nestedContainer.kind === "group" ? "group" : "super-group"} ${label}`
                              : item.type === "pause"
                                ? `Pause ${label}`
                                : `Pad ${label}`
                          }
                        >
                          <span className="font-mono">{label}</span>
                          {nestedContainer && (
                            <span
                              className={`text-[10px] ${
                                activeContainer.kind !== "root" &&
                                activeContainer.kind === nestedContainer.kind &&
                                activeContainer.id === nestedContainer.id
                                  ? "text-white"
                                  : "text-slate-200/80"
                              }`}
                              aria-hidden
                            >
                              ▾
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            commitPattern(removePadLoopItemsFromContainer(track.padLoopPattern, container, [index]));
                          }}
                          className="rounded px-1 text-[10px] leading-none text-slate-200/75 transition hover:bg-black/20 hover:text-rose-200"
                          aria-label={`${ui.remove} ${label}`}
                          title={ui.remove}
                        >
                          x
                        </button>
                      </span>
                    </Fragment>
                  );
                })}
                {dropTarget?.containerKey === containerKey && dropTarget.index === sequence.length && (
                  <span
                    className="h-5 w-[2px] rounded-full bg-accent/90"
                    aria-hidden
                    onDragOver={(event) => {
                      if (!supportsPadLoopDrop(event)) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      setDropTarget({ containerKey, index: sequence.length });
                      updatePadLoopDropEffect(event);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDropTarget(null);
                      applyDrop(event, container, sequence.length);
                      draggedItemRef.current = null;
                    }}
                  />
                )}
                <span
                  className="text-[10px] text-slate-500"
                  onDragOver={(event) => {
                    if (!supportsPadLoopDrop(event)) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    setDropTarget({ containerKey, index: sequence.length });
                    updatePadLoopDropEffect(event);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDropTarget(null);
                    applyDrop(event, container, sequence.length);
                    draggedItemRef.current = null;
                  }}
                >
                  {ui.padLoopSequenceHint}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    },
    [
      activeContainer,
      applyDrop,
      commitPattern,
      dropTarget,
      hostId,
      isPlaying,
      linkedPadLoopStepPosition,
      onLinkedPadLoopStepPositionChange,
      rangeIndexByContainer,
      selectedIndexesFor,
      setSelectionFor,
      timelineRangeIndexByContainer,
      track.enabled,
      track.padLoopEnabled,
      track.padLoopPattern,
      track.padLoopPosition,
      ui.padLoopSequence,
      ui.padLoopSequenceEmpty,
      ui.padLoopSequenceHint,
      ui.remove
    ]
  );

  const contextMenuSelection = contextMenu ? selectedIndexesFor(contextMenu.container) : [];
  const hasUngroupableSelection =
    contextMenu !== null &&
    contextMenuSelection.some((index) => {
      const sequence = getPadLoopContainerSequence(track.padLoopPattern, contextMenu.container) ?? [];
      const item = sequence[index];
      return item && (item.type === "group" || item.type === "super");
    });
  const canCreateGroup =
    contextMenu !== null &&
    canCreatePadLoopGroupFromSelection(track.padLoopPattern, contextMenu.container, contextMenuSelection, "group");
  const canCreateSuperGroup =
    contextMenu !== null &&
    canCreatePadLoopGroupFromSelection(track.padLoopPattern, contextMenu.container, contextMenuSelection, "super");
  const canRemoveSelection = contextMenuSelection.length > 0;

  return (
    <div className="flex min-w-[300px] flex-1 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{ui.padLoopSequence}</span>
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-600 bg-slate-950 p-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPadLoopEnabledChange(!track.padLoopEnabled)}
            className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
              track.padLoopEnabled
                ? "border-accent/70 bg-accent/20 text-accent"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
            }`}
            aria-pressed={track.padLoopEnabled}
          >
            {ui.padLooper}: {track.padLoopEnabled ? ui.on : ui.off}
          </button>
          <button
            type="button"
            onClick={() => onPadLoopRepeatChange(!track.padLoopRepeat)}
            className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
              track.padLoopRepeat
                ? "border-emerald-400/55 bg-emerald-500/10 text-emerald-300"
                : "border-amber-400/55 bg-amber-500/10 text-amber-300"
            }`}
            aria-pressed={track.padLoopRepeat}
          >
            {ui.repeat}: {track.padLoopRepeat ? ui.on : ui.off}
          </button>
          <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300">
            compiled: {compiledPattern.sequence.length}
          </div>
          <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300">
            steps: {compiledPatternStepCount}
          </div>
        </div>

        {sequencePanel({ kind: "root" }, "Main Sequence", "root")}

        {activeContainer.kind !== "root" &&
          sequencePanel(
            activeContainer,
            `${activeContainer.kind === "group" ? "Group" : "Super-group"} ${padLoopContainerLabel(activeContainer)}`,
            activeContainer.kind
          )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-[1600] w-48 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {padLoopContainerLabel(contextMenu.container)}
          </div>
          <button
            type="button"
            disabled={!canCreateGroup}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              commitPattern(
                groupPadLoopItemsInContainer(
                  track.padLoopPattern,
                  contextMenu.container,
                  selectedIndexesFor(contextMenu.container),
                  "group"
                )
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              canCreateGroup
                ? "text-slate-200 hover:bg-slate-800"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>Group</span>
            <span className="text-[10px] text-orange-300">A..Z</span>
          </button>
          <button
            type="button"
            disabled={!canCreateSuperGroup}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              commitPattern(
                groupPadLoopItemsInContainer(
                  track.padLoopPattern,
                  contextMenu.container,
                  selectedIndexesFor(contextMenu.container),
                  "super"
                )
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              canCreateSuperGroup
                ? "text-slate-200 hover:bg-slate-800"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>Super-group</span>
            <span className="text-[10px] text-violet-300">I..X</span>
          </button>
          <button
            type="button"
            disabled={!hasUngroupableSelection}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              commitPattern(
                ungroupPadLoopItemsInContainer(
                  track.padLoopPattern,
                  contextMenu.container,
                  selectedIndexesFor(contextMenu.container)
                )
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              hasUngroupableSelection
                ? "text-slate-200 hover:bg-slate-800"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>Ungroup</span>
            <span className="text-[10px] text-slate-400">inline</span>
          </button>
          <button
            type="button"
            disabled={!canRemoveSelection}
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              const container = contextMenu.container;
              commitPattern(
                removePadLoopItemsFromContainer(track.padLoopPattern, container, selectedIndexesFor(container))
              );
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
              canRemoveSelection
                ? "text-rose-200 hover:bg-rose-500/10"
                : "cursor-not-allowed text-slate-500"
            }`}
          >
            <span>{ui.remove}</span>
            <span className="text-[10px] text-slate-400">{contextMenuSelection.length || 0}</span>
          </button>
        </div>
      )}
    </div>
  );
}, arePadLoopPatternEditorPropsEqual);

function arePadLoopPatternEditorPropsEqual(
  previous: PadLoopPatternEditorProps,
  next: PadLoopPatternEditorProps
): boolean {
  return (
    previous.ui === next.ui &&
    previous.hostId === next.hostId &&
    previous.track.id === next.track.id &&
    previous.track.enabled === next.track.enabled &&
    previous.track.padLoopEnabled === next.track.padLoopEnabled &&
    previous.track.padLoopRepeat === next.track.padLoopRepeat &&
    previous.track.padLoopPosition === next.track.padLoopPosition &&
    previous.track.padLoopPattern === next.track.padLoopPattern &&
    previous.stepsPerBeat === next.stepsPerBeat &&
    previous.defaultPadStepCount === next.defaultPadStepCount &&
    previous.isPlaying === next.isPlaying &&
    previous.linkedPadLoopStepPosition === next.linkedPadLoopStepPosition &&
    numberArrayEqual(previous.padStepCounts, next.padStepCounts)
  );
}
