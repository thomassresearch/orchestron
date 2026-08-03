export function clampMidiControllerValue(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

export function midiControllerKnobAngle(value: number): number {
  return -135 + (clampMidiControllerValue(value) / 127) * 270;
}

export function midiControllerValueFromVerticalDrag(
  startValue: number,
  startY: number,
  currentY: number
): number {
  return clampMidiControllerValue(startValue + (startY - currentY) * 0.5);
}
