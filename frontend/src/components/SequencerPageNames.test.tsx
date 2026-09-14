// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/device_names.json";
import { performanceDeviceKinds } from "../lib/performanceDeviceNames";
import { useAppStore } from "../store/useAppStore";
import { INITIAL_PANEL_COLLAPSE_STATE } from "./CollapsiblePanel";
import { SequencerPage } from "./SequencerPage";
import type { SequencerPageProps } from "./sequencer/sequencerPageContracts";

function actions<T>(): T {
  const noop = vi.fn();
  return new Proxy({}, { get: () => noop }) as T;
}
const actionProps = {
  instrumentActions: actions<SequencerPageProps["instrumentActions"]>(),
  transportActions: actions<SequencerPageProps["transportActions"]>(),
  melodicTrackActions: actions<SequencerPageProps["melodicTrackActions"]>(),
  drummerTrackActions: actions<SequencerPageProps["drummerTrackActions"]>(),
  pianoRollActions: actions<SequencerPageProps["pianoRollActions"]>(),
  midiControllerActions: actions<SequencerPageProps["midiControllerActions"]>(),
  controllerSequencerActions: actions<SequencerPageProps["controllerSequencerActions"]>(),
  arpeggiatorActions: actions<SequencerPageProps["arpeggiatorActions"]>()
};

function Page({ performanceId = "first" }: { performanceId?: string }) {
  const { sequencer, renamePerformanceDevice } = useAppStore();
  return <SequencerPage {...actionProps} collapsedPanels={INITIAL_PANEL_COLLAPSE_STATE} onPanelCollapsedChange={() => {}}
    performanceActions={new Proxy({ onRenamePerformanceDevice: renamePerformanceDevice }, {
      get: (target, key) => key === "onRenamePerformanceDevice" ? target.onRenamePerformanceDevice : () => {}
    }) as SequencerPageProps["performanceActions"]}
    data={{ guiLanguage: "english", patches: [], performances: [], instrumentBindings: [], sequencer,
      sequencerTransportSubunit: 0, currentPerformanceId: performanceId, performanceName: "Test", performanceDescription: "",
      instrumentsRunning: false, sessionState: "stopped", midiInputName: null, transportError: null }} />;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows editable names for all six types and updates sync choices and arranger titles", () => {
  useAppStore.getState().addSequencerTrack();
  const { container } = render(<Page />);
  for (const kind of performanceDeviceKinds) {
    const oldName = fixture.config.sequencer[kind][0].name;
    fireEvent.click(screen.getByRole("button", { name: `Rename: ${oldName}` }));
    const editor = container.querySelector('input[aria-invalid]')!;
    fireEvent.change(editor, { target: { value: `Renamed ${kind}` } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(screen.getByRole("button", { name: `Rename: Renamed ${kind}` })).toBeTruthy();
    if (["tracks", "drummerTracks", "controllerSequencers"].includes(kind)) {
      expect(screen.getAllByText(`Renamed ${kind}`).length).toBeGreaterThanOrEqual(2);
    }
  }
  expect(screen.getByRole("option", { name: "Renamed tracks" })).toBeTruthy();
  expect(screen.queryByText("Warm Lead")).toBeNull();
});

it("discards the editor on a performance switch or device removal", () => {
  const { rerender, container } = render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Rename: Warm Lead" }));
  fireEvent.change(container.querySelector('input[aria-invalid]')!, { target: { value: "Unsaved draft" } });
  rerender(<Page performanceId="second" />);
  expect(container.querySelector('input[aria-invalid]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Rename: Warm Lead" }));
  expect((container.querySelector('input[aria-invalid]') as HTMLInputElement).value).toBe("Warm Lead");
  act(() => useAppStore.getState().removeSequencerTrack(useAppStore.getState().sequencer.tracks[0].id));
  expect(container.querySelector('input[aria-invalid]')).toBeNull();
});
