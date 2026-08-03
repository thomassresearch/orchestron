import { memo, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  clampMidiControllerValue,
  midiControllerKnobAngle,
  midiControllerValueFromVerticalDrag
} from "./sequencerUiMath";

interface MidiControllerKnobProps {
  ariaLabel: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

export const MidiControllerKnob = memo(function MidiControllerKnob({ ariaLabel, value, disabled, onChange }: MidiControllerKnobProps) {
  const pointerStateRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null);
  const normalizedValue = clampMidiControllerValue(value);
  const angle = midiControllerKnobAngle(normalizedValue);

  const releasePointer = useCallback((pointerId: number) => {
    if (pointerStateRef.current?.pointerId !== pointerId) {
      return;
    }
    pointerStateRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || disabled) {
        return;
      }

      event.preventDefault();
      pointerStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startValue: normalizedValue
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [disabled, normalizedValue]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const pointerState = pointerStateRef.current;
      if (!pointerState || pointerState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const nextValue = midiControllerValueFromVerticalDrag(
        pointerState.startValue,
        pointerState.startY,
        event.clientY
      );
      onChange(nextValue);
    },
    [onChange]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      releasePointer(event.pointerId);
    },
    [releasePointer]
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      releasePointer(event.pointerId);
    },
    [releasePointer]
  );

  useEffect(() => {
    if (!disabled) {
      return;
    }
    pointerStateRef.current = null;
  }, [disabled]);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      className={`relative h-16 w-16 rounded-full border transition ${
        disabled
          ? "cursor-not-allowed border-slate-700 bg-slate-900/80 opacity-50"
          : "border-cyan-400/70 bg-slate-900 hover:border-cyan-300"
      }`}
      aria-label={ariaLabel}
    >
      <span className="absolute inset-1 rounded-full border border-slate-700 bg-[radial-gradient(circle_at_35%_25%,_#1e293b,_#020617_72%)]" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className="relative h-9 w-1.5"
          style={{
            transform: `rotate(${angle}deg)`
          }}
        >
          <span className="absolute inset-x-0 top-0 h-3.5 rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(34,211,238,0.55)]" />
        </span>
      </span>
    </button>
  );
}, areMidiControllerKnobPropsEqual);

function areMidiControllerKnobPropsEqual(previous: MidiControllerKnobProps, next: MidiControllerKnobProps): boolean {
  return previous.ariaLabel === next.ariaLabel && previous.value === next.value && previous.disabled === next.disabled;
}
