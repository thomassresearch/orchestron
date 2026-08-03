import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import {
  buildControllerCurvePath,
  sampleControllerCurveValue,
  sequencerTransportSubunitCount
} from "../../lib/sequencer";
import type { ControllerSequencerKeypoint, ControllerSequencerState } from "../../types";
import type { SequencerUiCopy } from "./sequencerUiCopy";
import { clampMidiControllerValue } from "./sequencerUiMath";

function clampControllerCurveUiPosition(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function controllerCurveValueToY(value: number, height: number): number {
  const safeHeight = Math.max(1, height);
  return safeHeight - (clampMidiControllerValue(value) / 127) * safeHeight;
}

function controllerCurveYToValue(y: number, height: number): number {
  const safeHeight = Math.max(1, height);
  const normalized = 1 - Math.max(0, Math.min(safeHeight, y)) / safeHeight;
  return clampMidiControllerValue(normalized * 127);
}

interface ControllerSequencerCurveEditorProps {
  ui: Pick<SequencerUiCopy, "curveEditorHint" | "removeCurvePoint">;
  controllerSequencer: ControllerSequencerState;
  playbackTransport:
    | {
        transportSubunit: number;
        transportSubunitDurationMs: number;
      }
    | null;
  onAddPoint: (position: number, value: number) => void;
  onPointChange: (keypointId: string, position: number, value: number) => void;
  onPointRemove: (keypointId: string) => void;
}

export const ControllerSequencerCurveEditor = memo(function ControllerSequencerCurveEditor({
  ui,
  controllerSequencer,
  playbackTransport,
  onAddPoint,
  onPointChange,
  onPointRemove
}: ControllerSequencerCurveEditorProps) {
  const [width, setWidth] = useState(960);
  const height = 150;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<
    | {
        pointerId: number;
        keypointId: string;
        startClientX: number;
        startClientY: number;
        startPosition: number;
        startValue: number;
        dragging: boolean;
      }
    | null
  >(null);
  const transportAnchorRef = useRef<{
    transportSubunit: number;
    transportSubunitDurationMs: number;
    timestampMs: number;
  } | null>(null);
  const [playbackTransportSubunit, setPlaybackTransportSubunit] = useState<number>(0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(320, Math.round(svg.clientWidth || svg.getBoundingClientRect().width || 960));
      setWidth((previous) => (previous === nextWidth ? previous : nextWidth));
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(svg);
    return () => {
      observer.disconnect();
    };
  }, []);

  const path = useMemo(
    () => buildControllerCurvePath(controllerSequencer.keypoints, width, height),
    [controllerSequencer.keypoints, height, width]
  );

  useEffect(() => {
    if (!playbackTransport) {
      transportAnchorRef.current = null;
      return;
    }
    const anchoredSubunit = Math.max(
      0,
      Math.floor(playbackTransport.transportSubunit)
    );
    setPlaybackTransportSubunit((previous) => (previous === anchoredSubunit ? previous : anchoredSubunit));
    transportAnchorRef.current = {
      ...playbackTransport,
      timestampMs: typeof performance !== "undefined" ? performance.now() : Date.now()
    };
  }, [playbackTransport?.transportSubunit, playbackTransport?.transportSubunitDurationMs]);

  useEffect(() => {
    if (!playbackTransport) {
      return;
    }

    let rafId = 0;
    let cancelled = false;
    const frame = (now: number) => {
      if (cancelled) {
        return;
      }
      const anchor = transportAnchorRef.current;
      if (anchor) {
        const elapsedSubunits = Math.max(
          0,
          (now - anchor.timestampMs) / Math.max(0.001, anchor.transportSubunitDurationMs)
        );
        const absoluteSubunit = Math.max(0, Math.floor(anchor.transportSubunit + elapsedSubunits));
        setPlaybackTransportSubunit((previous) => (previous === absoluteSubunit ? previous : absoluteSubunit));
      }
      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [playbackTransport !== null]);

  const playbackT = useMemo(() => {
    if (!playbackTransport) {
      return null;
    }
    const repeatLength = Math.max(
      1,
      Math.round(sequencerTransportSubunitCount(controllerSequencer.timing, controllerSequencer.lengthBeats))
    );
    const patternStartStep =
      typeof controllerSequencer.runtimePadStartSubunit === "number" && Number.isFinite(controllerSequencer.runtimePadStartSubunit)
        ? controllerSequencer.runtimePadStartSubunit
        : 0;
    const normalized =
      (((playbackTransportSubunit - patternStartStep) % repeatLength) + repeatLength) % repeatLength;
    return clampControllerCurveUiPosition(normalized / repeatLength);
  }, [
    controllerSequencer.lengthBeats,
    controllerSequencer.runtimePadStartSubunit,
    controllerSequencer.timing,
    playbackTransport,
    playbackTransportSubunit
  ]);
  const playbackValue =
    playbackT === null ? null : sampleControllerCurveValue(controllerSequencer.keypoints, playbackT);

  const getSvgPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    return {
      x: Math.max(0, Math.min(width, x)),
      y: Math.max(0, Math.min(height, y))
    };
  }, []);

  const handleBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      if (event.button !== 0) {
        return;
      }
      const point = getSvgPoint(event);
      if (!point) {
        return;
      }
      const position = clampControllerCurveUiPosition(point.x / width);
      const value = controllerCurveYToValue(point.y, height);
      if (position <= 0 || position >= 1) {
        return;
      }
      onAddPoint(position, value);
    },
    [getSvgPoint, onAddPoint]
  );

  const releaseDrag = useCallback((pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) {
      return;
    }
    dragRef.current = null;
  }, []);

  const handlePointPointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, keypointId: string) => {
      if (event.button !== 0) {
        return;
      }
      const keypoint = controllerSequencer.keypoints.find((point) => point.id === keypointId);
      if (!keypoint) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        pointerId: event.pointerId,
        keypointId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPosition: keypoint.position,
        startValue: keypoint.value,
        dragging: false
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [controllerSequencer.keypoints]
  );

  const handlePointPointerMove = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      const dragDistance = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY);
      if (!dragState.dragging && dragDistance < 3) {
        return;
      }
      if (!dragState.dragging) {
        dragRef.current = {
          ...dragState,
          dragging: true
        };
      }
      event.preventDefault();
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const sortedKeypoints = controllerSequencer.keypoints;
      const keypointIndex = sortedKeypoints.findIndex((keypoint) => keypoint.id === dragState.keypointId);
      if (keypointIndex < 0) {
        return;
      }
      const currentKeypoint = sortedKeypoints[keypointIndex];
      const isStart = currentKeypoint.position <= 1e-6;
      const isEnd = currentKeypoint.position >= 1 - 1e-6;
      const deltaX = event.clientX - dragState.startClientX;
      const deltaY = event.clientY - dragState.startClientY;
      let nextPosition = clampControllerCurveUiPosition(dragState.startPosition + deltaX / rect.width);
      const nextValue = clampMidiControllerValue(dragState.startValue + (-deltaY / rect.height) * 127);

      if (isStart) {
        nextPosition = 0;
      } else if (isEnd) {
        nextPosition = 1;
      } else {
        const epsilon = 0.001;
        const previousNeighbor = sortedKeypoints[keypointIndex - 1];
        const nextNeighbor = sortedKeypoints[keypointIndex + 1];
        const minPosition = Math.min(1 - epsilon, (previousNeighbor?.position ?? 0) + epsilon);
        const maxPosition = Math.max(epsilon, (nextNeighbor?.position ?? 1) - epsilon);
        nextPosition = Math.max(minPosition, Math.min(maxPosition, nextPosition));
      }

      onPointChange(dragState.keypointId, nextPosition, nextValue);
    },
    [controllerSequencer.keypoints, onPointChange]
  );

  const handlePointPointerUp = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      releaseDrag(event.pointerId);
    },
    [releaseDrag]
  );

  const handlePointPointerCancel = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      releaseDrag(event.pointerId);
    },
    [releaseDrag]
  );

  const handlePointDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGCircleElement>, keypointId: string) => {
      event.stopPropagation();
      onPointRemove(keypointId);
    },
    [onPointRemove]
  );

  const visualPoints = useMemo(
    () =>
      controllerSequencer.keypoints.map((point) => ({
        ...point,
        removable: point.position > 1e-6 && point.position < 1 - 1e-6
      })) as Array<ControllerSequencerKeypoint & { removable: boolean }>,
    [controllerSequencer.keypoints]
  );

  return (
    <div className="rounded-xl border border-teal-700/50 bg-slate-950/70 p-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ui.curveEditorHint}
        className="h-40 w-full cursor-crosshair overflow-visible rounded-lg border border-slate-700 bg-slate-950"
      >
        <defs>
          <linearGradient id={`controller-curve-${controllerSequencer.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="55%" stopColor="#5eead4" />
            <stop offset="100%" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>

        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onPointerDown={handleBackgroundPointerDown}
        />

        {Array.from({ length: 8 }, (_, index) => {
          const y = (index / 7) * height;
          return (
            <line
              key={`grid-y-${index}`}
              x1={0}
              y1={y}
              x2={width}
              y2={y}
              stroke={index === 0 || index === 7 ? "rgba(100,116,139,0.45)" : "rgba(51,65,85,0.35)"}
              strokeWidth={1}
            />
          );
        })}
        {Array.from({ length: 9 }, (_, index) => {
          const x = (index / 8) * width;
          return (
            <line
              key={`grid-x-${index}`}
              x1={x}
              y1={0}
              x2={x}
              y2={height}
              stroke={index === 0 || index === 8 ? "rgba(100,116,139,0.45)" : "rgba(51,65,85,0.3)"}
              strokeWidth={1}
            />
          );
        })}

        <path
          d={path}
          fill="none"
          stroke={`url(#controller-curve-${controllerSequencer.id})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {playbackT !== null && playbackValue !== null ? (
          <>
            <line
              x1={playbackT * width}
              y1={0}
              x2={playbackT * width}
              y2={height}
              stroke="rgba(103,232,249,0.45)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <circle
              cx={playbackT * width}
              cy={controllerCurveValueToY(playbackValue, height)}
              r={5}
              fill="#67e8f9"
              stroke="rgba(15,23,42,0.9)"
              strokeWidth={2}
            />
          </>
        ) : null}

        {visualPoints.map((point) => {
          const cx = point.position * width;
          const cy = controllerCurveValueToY(point.value, height);
          return (
            <circle
              key={`${controllerSequencer.id}-${point.id}`}
              cx={cx}
              cy={cy}
              r={point.removable ? 5 : 4}
              fill={point.removable ? "#ccfbf1" : "#94a3b8"}
              stroke={point.removable ? "#14b8a6" : "#475569"}
              strokeWidth={2}
              className={point.removable ? "cursor-move" : "cursor-ns-resize"}
              onPointerDown={(event) => handlePointPointerDown(event, point.id)}
              onPointerMove={handlePointPointerMove}
              onPointerUp={handlePointPointerUp}
              onPointerCancel={handlePointPointerCancel}
              onLostPointerCapture={handlePointPointerCancel}
              onDoubleClick={
                point.removable ? (event) => handlePointDoubleClick(event, point.id) : undefined
              }
              aria-label={point.removable ? ui.removeCurvePoint : undefined}
            />
          );
        })}
      </svg>
      <div className="mt-2 text-[10px] text-slate-500">{ui.curveEditorHint}</div>
    </div>
  );
}, areControllerSequencerCurveEditorPropsEqual);

function areControllerSequencerCurveEditorPropsEqual(
  previous: ControllerSequencerCurveEditorProps,
  next: ControllerSequencerCurveEditorProps
): boolean {
  const previousPlayback = previous.playbackTransport;
  const nextPlayback = next.playbackTransport;
  const playbackEqual =
    previousPlayback === nextPlayback ||
    (previousPlayback !== null &&
      nextPlayback !== null &&
      previousPlayback.transportSubunit === nextPlayback.transportSubunit &&
      previousPlayback.transportSubunitDurationMs === nextPlayback.transportSubunitDurationMs);

  return previous.ui === next.ui && previous.controllerSequencer === next.controllerSequencer && playbackEqual;
}
