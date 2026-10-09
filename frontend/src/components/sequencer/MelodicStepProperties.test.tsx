// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useAppStore } from "../../store/useAppStore";
import { SequencerPage } from "../SequencerPage";
import type { SequencerPageProps } from "./sequencerPageContracts";
import { INITIAL_PANEL_COLLAPSE_STATE } from "../CollapsiblePanel";
import { DEFAULT_SEQUENCER_TIMING_CONFIG } from "../../lib/sequencer";
import { MelodicStepProperties, melodicStepCopy } from "./MelodicStepProperties";

beforeEach(() => { useAppStore.setState(useAppStore.getInitialState(), true); useAppStore.setState(state => ({ sequencer: { ...state.sequencer, tracks: [] } })); useAppStore.getState().addSequencerTrack(); });
afterEach(cleanup);
function Page({ collapsed = false }: { collapsed?: boolean }) {
  const state = useAppStore();
  const actions = Object.fromEntries(["instrumentActions", "performanceActions", "transportActions", "melodicTrackActions", "drummerTrackActions", "pianoRollActions", "midiControllerActions", "controllerSequencerActions", "arpeggiatorActions"].map(key => [key, new Proxy({}, { get: () => () => undefined })])) as unknown as Omit<SequencerPageProps, "data">;
  return <SequencerPage {...actions} melodicTrackActions={{ ...actions.melodicTrackActions,
    onSequencerTrackStepStrumChange: state.setSequencerTrackStepStrum,
    onSequencerTrackStepTimingOffsetChange: state.setSequencerTrackStepTimingOffset,
    onSequencerTrackStepChordChange: state.setSequencerTrackStepChord,
    onSequencerTrackStepNoteChange: state.setSequencerTrackStepNote }}
    collapsedPanels={{ ...Object.fromEntries(Object.keys(INITIAL_PANEL_COLLAPSE_STATE).map(key => [key, true])), melodic: collapsed } as SequencerPageProps["collapsedPanels"]}
    data={{ guiLanguage: "english", patches: [], performances: [], instrumentBindings: [], sequencer: state.sequencer,
      sequencerTransportSubunit: 0, currentPerformanceId: null, performanceName: "", performanceDescription: "",
      instrumentsRunning: false, sessionState: "stopped", midiInputName: null, transportError: null }} />;
}
function step() { return useAppStore.getState().sequencer.tracks[0].pads[0].steps[0]; }
function prepareChord() {
  const store = useAppStore.getState(), id = store.sequencer.tracks[0].id;
  store.setSequencerTrackStepNote(id, 0, 60); store.setSequencerTrackStepChord(id, 0, "maj");
}
it("opens from the properties button on a rest and edits timing without adding notes", () => {
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Step properties 1" }));
  expect((screen.getByRole("combobox", { name: "Strum" }) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText("Select a chord to enable strumming.")).toBeTruthy();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Timing (%)" }), { target: { value: "-20" } });
  expect(step()).toMatchObject({ note: null, timingOffsetPercent: -20 });
  fireEvent.keyDown(screen.getByRole("group", { name: "Step properties" }), { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Step properties" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Step properties 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Timing -20%" }));
  expect(screen.getByRole("group", { name: "Step properties" })).toBeTruthy();
});
it("opens from chord context and keyboard, retains disabled settings and shows summaries", () => {
  prepareChord(); render(<Page />);
  const chord = screen.getByRole("combobox", { name: "Chord 1" });
  fireEvent.contextMenu(chord);
  fireEvent.change(screen.getByRole("combobox", { name: "Strum" }), { target: { value: "up" } });
  fireEvent.change(screen.getByRole("slider", { name: "Spread" }), { target: { value: "100" } });
  expect(step()).toMatchObject({ strumDirection: "up", strumSpreadPercent: 100 });
  expect(screen.getByText("125.0 ms")).toBeTruthy();
  fireEvent.change(chord, { target: { value: "none" } });
  expect((screen.getByRole("slider", { name: "Spread" }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(chord, { target: { value: "maj" } });
  fireEvent.click(screen.getByRole("button", { name: "Close step properties" }));
  fireEvent.click(screen.getByRole("button", { name: "↑ 100%" }));
  fireEvent.click(screen.getByRole("button", { name: "Close step properties" }));
  fireEvent.keyDown(chord, { key: "F10", shiftKey: true });
  expect(screen.getByRole("group", { name: "Step properties" })).toBeTruthy();
});
it("closes on editing-pad changes and collapse", () => {
  const { rerender } = render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Step properties 1" }));
  fireEvent.click(screen.getByRole("button", { name: "#2" }));
  expect(screen.queryByRole("group", { name: "Step properties" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Step properties 1" }));
  rerender(<Page collapsed />); rerender(<Page />);
  expect(screen.queryByRole("group", { name: "Step properties" })).toBeNull();
});
it.each(["english", "german", "french", "spanish"] as const)("localizes controls and reports musical spread in %s", language => {
  const onStrum = vi.fn(); const copy = melodicStepCopy[language];
  render(<MelodicStepProperties step={{ note: 60, chord: "maj", hold: false, velocity: 100, strumDirection: "down", strumSpreadPercent: 40 }}
    index={0} label="C" timing={DEFAULT_SEQUENCER_TIMING_CONFIG} language={language} onTiming={vi.fn()} onStrum={onStrum} onClose={vi.fn()} />);
  const panel = screen.getByRole("group", { name: copy.properties });
  expect(within(panel).getByRole("slider", { name: copy.spread }).getAttribute("aria-valuetext")).toBe("40% (50.0 ms)");
  fireEvent.click(screen.getByRole("button", { name: copy.reset }));
  expect(onStrum).toHaveBeenCalledWith("down", 0);
});
