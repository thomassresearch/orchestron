// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/device_names.json";
import { useAppStore } from "../store/useAppStore";
import { INITIAL_PANEL_COLLAPSE_STATE } from "./CollapsiblePanel";
import { SequencerPage } from "./SequencerPage";

function actions<T>(overrides: object = {}): T {
  return new Proxy(overrides, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as T;
}
function Page() {
  const { sequencer, setMidiControllerTargetChannels, setControllerSequencerTargetChannels } = useAppStore();
  return <SequencerPage collapsedPanels={INITIAL_PANEL_COLLAPSE_STATE} onPanelCollapsedChange={() => {}}
    instrumentActions={actions()} transportActions={actions()} melodicTrackActions={actions()} drummerTrackActions={actions()}
    pianoRollActions={actions()} arpeggiatorActions={actions()} performanceActions={actions()}
    midiControllerActions={actions({ onMidiControllerTargetChannelsChange: setMidiControllerTargetChannels })}
    controllerSequencerActions={actions({ onControllerSequencerTargetChannelsChange: setControllerSequencerTargetChannels })}
    data={{ guiLanguage: "english", patches: [], performances: [], instrumentBindings: [], sequencer,
      sequencerTransportSubunit: 0, currentPerformanceId: null, performanceName: "Channels", performanceDescription: "",
      instrumentsRunning: false, sessionState: "stopped", midiInputName: null, transportError: null }} />;
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("wires both selectors independently, checks all channels by default, and protects the final channel", () => {
  render(<Page />);
  const groups = screen.getAllByRole("group", { name: "MIDI Channels" });
  expect(groups).toHaveLength(2);
  for (const group of groups) {
    expect(within(group).getAllByRole("checkbox")).toHaveLength(16);
    for (const checkbox of within(group).getAllByRole("checkbox")) expect((checkbox as HTMLInputElement).checked).toBe(true);
  }
  for (let channel = 1; channel <= 15; channel++) fireEvent.click(within(groups[0]).getByRole("checkbox", { name: `MIDI channel ${channel}` }));
  const last = within(groups[0]).getByRole("checkbox", { name: "MIDI channel 16" }) as HTMLInputElement;
  expect(last.checked).toBe(true);
  expect(last.disabled).toBe(true);
  expect(useAppStore.getState().sequencer.controllerSequencers[0].targetChannels).toEqual([16]);
  expect(within(groups[1]).getAllByRole("checkbox").every(input => (input as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(within(groups[1]).getByRole("checkbox", { name: "MIDI channel 1" }));
  expect(useAppStore.getState().sequencer.midiControllers[0].targetChannels).not.toContain(1);
  fireEvent.click(within(groups[0]).getByRole("checkbox", { name: "MIDI channel 1" }));
  expect(last.disabled).toBe(false);
  last.focus();
  expect(document.activeElement).toBe(last);
});
