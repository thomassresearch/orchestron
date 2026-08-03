import { describe, expect, it } from "vitest";

import {
  clampMidiControllerValue,
  midiControllerKnobAngle,
  midiControllerValueFromVerticalDrag
} from "./sequencerUiMath";

describe("sequencer UI math", () => {
  it("clamps and rounds MIDI controller values", () => {
    expect(clampMidiControllerValue(-4)).toBe(0);
    expect(clampMidiControllerValue(63.6)).toBe(64);
    expect(clampMidiControllerValue(200)).toBe(127);
  });

  it("maps the MIDI range to the knob's 270 degree sweep", () => {
    expect(midiControllerKnobAngle(0)).toBe(-135);
    expect(midiControllerKnobAngle(127)).toBe(135);
  });

  it("maps upward pointer travel to increasing controller values", () => {
    expect(midiControllerValueFromVerticalDrag(64, 100, 80)).toBe(74);
    expect(midiControllerValueFromVerticalDrag(5, 100, 200)).toBe(0);
    expect(midiControllerValueFromVerticalDrag(120, 100, 0)).toBe(127);
  });
});
