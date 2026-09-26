import { DrummerRatchetControl, drummerRatchetCopy } from "./DrummerRatchetControl";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { SequencerPage } from "../SequencerPage";
import { INITIAL_PANEL_COLLAPSE_STATE } from "../CollapsiblePanel";
import type { SequencerPageProps } from "./sequencerPageContracts";
import { NoteTimingControl } from "./NoteTimingControl";
import { DEFAULT_SEQUENCER_TIMING_CONFIG } from "../../lib/sequencer";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().addDrummerSequencerTrack();
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = "mouse"; }
  });
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Page() {
  const state = useAppStore();
  const noop = () => undefined;
  const action = new Proxy({}, { get: () => noop });
  const actions = Object.fromEntries(["instrumentActions", "performanceActions", "transportActions", "melodicTrackActions", "drummerTrackActions", "pianoRollActions", "midiControllerActions", "controllerSequencerActions", "arpeggiatorActions"].map(key => [key, action])) as unknown as Omit<SequencerPageProps, "data">;
  return <SequencerPage {...actions} drummerTrackActions={{ ...actions.drummerTrackActions,
    onDrummerSequencerCellToggle: state.toggleDrummerSequencerCell,
    onDrummerSequencerCellVelocityChange: state.setDrummerSequencerCellVelocity,
    onDrummerSequencerCellRatchetsChange: state.setDrummerSequencerCellRatchets,
    onDrummerSequencerCellTimingOffsetChange: state.setDrummerSequencerCellTimingOffset }}
    collapsedPanels={{ ...Object.fromEntries(Object.keys(INITIAL_PANEL_COLLAPSE_STATE).map(key => [key, true])), drummer: false } as SequencerPageProps["collapsedPanels"]}
    data={{ guiLanguage: "english", patches: [], performances: [], instrumentBindings: [], sequencer: state.sequencer,
      sequencerTransportSubunit: 0, currentPerformanceId: null, performanceName: "", performanceDescription: "",
      instrumentsRunning: false, sessionState: "stopped", midiInputName: null, transportError: null }} />;
}
function cell() { return useAppStore.getState().sequencer.drummerTracks[0].pads[0].rows[0].steps[1]; }
function hit() { return screen.getAllByRole("button", { name: /^Step 2, drum key/ })[0]; }

it("locks horizontal drum dragging to timing and retains click toggling and vertical velocity", () => {
  render(<Page />);
  const led = hit();
  fireEvent.pointerDown(led, { clientX: 100, clientY: 100 });
  fireEvent.pointerMove(led, { clientX: 125, clientY: 101 });
  fireEvent.pointerMove(led, { clientX: 130, clientY: 130 });
  fireEvent.pointerUp(led);
  expect(cell()).toMatchObject({ active: true, timingOffsetPercent: 30, velocity: 127 });
  fireEvent.pointerDown(led, { clientX: 100, clientY: 100 });
  fireEvent.pointerMove(led, { clientX: 101, clientY: 116 });
  fireEvent.pointerUp(led);
  expect(cell()).toMatchObject({ active: true, timingOffsetPercent: 30, velocity: 111 });
  fireEvent.pointerDown(led, { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(led);
  expect(cell()).toMatchObject({ active: false, timingOffsetPercent: 30 });
});

it("supports keyboard timing and precise controls without activating an inactive hit", () => {
  render(<Page />);
  fireEvent.keyDown(hit(), { key: "ArrowLeft" });
  expect(cell()).toMatchObject({ active: false, timingOffsetPercent: -1 });
  fireEvent.contextMenu(hit());
  const input = screen.getByRole("spinbutton", { name: "Timing (%)" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "" } });
  expect(input.value).toBe("");
  expect(cell().timingOffsetPercent).toBe(-1);
  fireEvent.change(input, { target: { value: "-20" } });
  expect(cell().timingOffsetPercent).toBe(-20);
  expect(screen.getByText("Early: -20% (-25.0 ms)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset timing" }));
  expect(cell().timingOffsetPercent).toBe(0);
});

it("shows tempo-scaled timing in all supported languages and exposes the slider value", () => {
  const change = vi.fn();
  const { rerender } = render(<NoteTimingControl value={20} timing={DEFAULT_SEQUENCER_TIMING_CONFIG} language="german" onChange={change} />);
  expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain("Spät: +20% (25.0 ms)");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "-10" } });
  expect(change).toHaveBeenCalledWith(-10);
  rerender(<NoteTimingControl value={20} timing={{ ...DEFAULT_SEQUENCER_TIMING_CONFIG, tempoBPM: 60 }} language="french" onChange={change} />);
  expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain("En retard: +20% (50.0 ms)");
});


it("edits ratchets in the step panel, retains a disabled ramp, and closes on pad selection", () => {
  render(<Page />);
  fireEvent.keyDown(hit(), { key: "F10", shiftKey: true });
  expect(screen.getByRole("group", { name: "Step properties" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Ratchets" }), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Velocity ramp" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Final velocity" }), { target: { value: "40" } });
  expect(cell()).toMatchObject({ active: false, ratchets: 4, ratchetEndVelocity: 40 });
  expect(hit().getAttribute("aria-label")).toContain("Ratchets: 4");
  expect(hit().textContent).toContain("×4");
  fireEvent.change(screen.getByRole("combobox", { name: "Ratchets" }), { target: { value: "1" } });
  expect((screen.getByRole("spinbutton", { name: "Final velocity" }) as HTMLInputElement).disabled).toBe(true);
  expect(cell().ratchetEndVelocity).toBe(40);
  fireEvent.keyDown(screen.getByRole("group", { name: "Step properties" }), { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Step properties" })).toBeNull();
  fireEvent.contextMenu(hit());
  fireEvent.click(screen.getByRole("button", { name: "#2" }));
  expect(screen.queryByRole("group", { name: "Step properties" })).toBeNull();
});


it.each(["english", "german", "french", "spanish"] as const)("localizes accessible ratchet controls in %s", language => {
  const copy = drummerRatchetCopy[language];
  const change = vi.fn();
  render(<DrummerRatchetControl cell={{ active: true, velocity: 100, ratchets: 4, ratchetEndVelocity: 40 }}
    language={language} onChange={change} />);
  expect(screen.getAllByRole("option")).toHaveLength(8);
  fireEvent.change(screen.getByRole("combobox", { name: copy.ratchets }), { target: { value: "8" } });
  expect(change).toHaveBeenCalledWith(8, 40);
  fireEvent.change(screen.getByRole("spinbutton", { name: copy.final }), { target: { value: "0" } });
  expect(change).toHaveBeenCalledWith(4, 0);
  expect((screen.getByRole("checkbox", { name: copy.ramp }) as HTMLInputElement).checked).toBe(true);
});
