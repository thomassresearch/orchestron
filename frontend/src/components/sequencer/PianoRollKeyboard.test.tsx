// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultPianoRoll } from "../../store/appStoreModel";
import { PianoRollKeyboard, type PianoRollHighlightTheory } from "./PianoRollKeyboard";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import type { PianoRollState } from "../../types";

const on = vi.fn(), off = vi.fn();
let roll: PianoRollState;
const key = (name: string) => screen.getByRole("button", { name });
const down = (name: string, pointerId = 1) => fireEvent.pointerDown(key(name), { pointerId, button: 0 });
const up = (name: string, pointerId = 1) => fireEvent.pointerUp(key(name), { pointerId, button: 0 });
const view = (running = true, theories: PianoRollHighlightTheory[] = []) => <StrictMode><PianoRollKeyboard
  roll={roll} ui={SEQUENCER_UI_COPY.english} instrumentsRunning={running}
  highlightTheories={theories} onNoteOn={on} onNoteOff={off} /></StrictMode>;
beforeEach(() => {
  roll = { ...defaultPianoRoll(), enabled: true, scaleType: "major", mode: "ionian", autoChordEnabled: true };
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  });
  vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(() => {});
  on.mockClear(); off.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
// jsdom does not implement pointer capture.
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value() {} });

it("plays and highlights all chord tones with the same channel and velocity", () => {
  render(view()); down("C4");
  expect(on.mock.calls).toEqual([60, 64, 67].map(note => [roll.id, note, 2, 110]));
  for (const note of ["C4", "E4", "G4"]) expect(key(note).getAttribute("aria-pressed")).toBe("true");
  up("C4");
  expect(off.mock.calls).toEqual([60, 64, 67].map(note => [roll.id, note, 2]));
  expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
});
it("shares overlapping pitches until their last pointer releases", () => {
  render(view()); down("C4", 1); down("E4", 2);
  expect(on.mock.calls.map(call => call[1])).toEqual([60, 64, 67, 71]);
  up("C4", 1);
  expect(off.mock.calls.map(call => call[1])).toEqual([60]);
  expect(key("E4").getAttribute("aria-pressed")).toBe("true");
  up("E4", 2);
  expect(off.mock.calls.map(call => call[1])).toEqual([60, 64, 67, 71]);
});
it("snapshots notes and channel while subsequent presses adopt new settings", () => {
  const result = render(view()); down("C4");
  roll = { ...roll, autoChordSize: 5, midiChannel: 3, mode: "aeolian" };
  result.rerender(view()); down("C4", 2);
  expect(on.mock.calls.slice(3)).toEqual([60, 63, 67, 70, 74].map(note => [roll.id, note, 3, 110]));
  roll = { ...roll, autoChordEnabled: false };
  result.rerender(view()); up("C4");
  expect(off.mock.calls).toEqual([60, 64, 67].map(note => [roll.id, note, 2]));
  expect(key("C4").getAttribute("aria-pressed")).toBe("true");
  up("C4", 2); down("D4", 3);
  expect(on.mock.calls[on.mock.calls.length - 1]?.slice(1)).toEqual([62, 3, 110]);
});
it("follows highlighted theories without retuning an already held chord", () => {
  const result = render(view(true, [{ scaleRoot: "C", mode: "ionian" }, { scaleRoot: "G", mode: "ionian" }]));
  down("C4"); expect(on.mock.calls.map(call => call[1])).toEqual([60, 64, 69]);
  result.rerender(view(true, [{ scaleRoot: "D", mode: "ionian" }]));
  up("C4"); expect(off.mock.calls.map(call => call[1])).toEqual([60, 64, 69]);
  down("D4"); expect(on.mock.calls.slice(3).map(call => call[1])).toEqual([62, 66, 69]);
});
it.each(["cancel", "lostCapture", "disabled", "engineStop", "unmount"])("releases each sounding pitch once on %s", reason => {
  const result = render(view()); down("C4"); down("E4", 2);
  if (reason === "cancel" || reason === "lostCapture") {
    const release = reason === "cancel" ? fireEvent.pointerCancel : fireEvent.lostPointerCapture;
    release(key("C4"), { pointerId: 1 }); release(key("E4"), { pointerId: 2 });
    release(key("C4"), { pointerId: 1 });
  } else if (reason === "disabled") { roll = { ...roll, enabled: false }; result.rerender(view()); }
  else if (reason === "engineStop") result.rerender(view(false));
  else result.unmount();
  expect(off.mock.calls.map(call => call[1])).toEqual([60, 64, 67, 71]);
  result.unmount(); expect(off).toHaveBeenCalledTimes(4);
});
it("keeps chromatic keys single and ignores inactive or non-primary presses", () => {
  const result = render(view()); down("C#4");
  expect(on.mock.calls.map(call => call[1])).toEqual([61]); up("C#4");
  fireEvent.pointerDown(key("C4"), { pointerId: 2, button: 2 });
  result.rerender(view(false)); down("C4"); expect(on).toHaveBeenCalledTimes(1);
});
it("releases a reused pointer before starting its next chord", () => {
  render(view()); down("C4"); down("D4");
  expect(off.mock.calls.map(call => call[1])).toEqual([60, 64, 67]);
  expect(on.mock.calls.slice(3).map(call => call[1])).toEqual([62, 65, 69]);
});
