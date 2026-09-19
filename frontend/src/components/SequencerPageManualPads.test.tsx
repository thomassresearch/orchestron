// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/device_names.json";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import { useAppStore } from "../store/useAppStore";
import { INITIAL_PANEL_COLLAPSE_STATE } from "./CollapsiblePanel";
import { SequencerPage } from "./SequencerPage";

const devices = [
  { collection: "tracks", runtimeKey: "trackStateById" },
  { collection: "drummerTracks", runtimeKey: "drummerStateById" },
  { collection: "controllerSequencers", runtimeKey: "controllerStateById" }
] as const;
type Device = typeof devices[number];

function actions<T>(overrides: object = {}): T {
  return new Proxy(overrides, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as T;
}
function Page({ launch }: { launch: (id: string, pad: number) => void }) {
  const store = useAppStore();
  const sequencer = mergedSequencerState(store.sequencer, store.sequencerRuntime);
  return <SequencerPage collapsedPanels={INITIAL_PANEL_COLLAPSE_STATE} onPanelCollapsedChange={() => {}}
    instrumentActions={actions()} transportActions={actions()}
    melodicTrackActions={actions({ onSequencerPadPress: launch })}
    drummerTrackActions={actions({ onDrummerSequencerPadPress: launch })}
    controllerSequencerActions={actions({ onControllerSequencerPadPress: launch })}
    pianoRollActions={actions()} arpeggiatorActions={actions()} performanceActions={actions()} midiControllerActions={actions()}
    data={{ guiLanguage: "english", patches: [], performances: [], instrumentBindings: [], sequencer,
      sequencerTransportSubunit: 0, currentPerformanceId: null, performanceName: "Manual pads", performanceDescription: "",
      instrumentsRunning: true, sessionState: "running", midiInputName: null, transportError: null }} />;
}
function playback(device: Device, id: string, activePad: number, queuedPad: number | null, enabled = true) {
  useAppStore.setState(state => ({ sequencerRuntime: { ...state.sequencerRuntime, isPlaying: true,
    [device.runtimeKey]: { ...state.sequencerRuntime[device.runtimeKey], [id]: { enabled, activePad, queuedPad } }
  } }));
}
function setup(device: Device, arrangement = false, enabled = true) {
  const id = useAppStore.getState().sequencer[device.collection][0].id;
  useAppStore.setState(state => ({ sequencer: { ...state.sequencer,
    [device.collection]: state.sequencer[device.collection].map(track => ({ ...track, padLoopEnabled: arrangement }))
  } }));
  playback(device, id, 0, null, enabled);
  const launch = vi.fn((trackId: string, pad: number) => {
    const playing = useAppStore.getState().sequencerRuntime[device.runtimeKey][trackId]?.activePad ?? 0;
    playback(device, trackId, playing, pad === playing ? null : pad);
  });
  const { container } = render(<Page launch={launch} />);
  const article = within(container.querySelector<HTMLElement>(`#sequencer-${id}`)!);
  const pad = (index: number) => article.getByRole("button", {
    name: device.collection === "controllerSequencers" ? new RegExp(`^Controller pattern pad #${index + 1}( |$)`) : `#${index + 1}`
  });
  return { id, launch, pad, article };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(devices)("queues $collection pad clicks and follows the sounding pad through the boundary", device => {
  const { id, launch, pad, article } = setup(device);
  const authored = useAppStore.getState().sequencer;
  fireEvent.click(pad(1));
  expect(launch).toHaveBeenLastCalledWith(id, 1);
  expect(useAppStore.getState().sequencerEditingPads[id]).toBe(1);
  expect(pad(0).className).toContain("ring-cyan-400");
  expect(pad(1).className).toContain("outline-amber-400");
  expect(pad(1).className).not.toContain("ring-cyan-400");
  expect(article.getByRole("button", { name: "Stop" })).toBeTruthy();

  fireEvent.click(pad(2));
  expect(launch).toHaveBeenLastCalledWith(id, 2);
  expect(pad(1).className).not.toContain("outline-amber-400");
  expect(pad(2).className).toContain("outline-amber-400");
  act(() => playback(device, id, 2, null));
  expect(pad(2).className).toContain("ring-cyan-400");
  expect(pad(2).className).not.toContain("outline-amber-400");
  expect(pad(0).className).not.toContain("ring-cyan-400");
  expect(useAppStore.getState().sequencer).toBe(authored);
});

it.each(devices)("keeps $collection Arrangement pad clicks as editing selection", device => {
  const { id, launch, pad } = setup(device, true);
  fireEvent.click(pad(1));
  expect(useAppStore.getState().sequencerEditingPads[id]).toBe(1);
  expect(launch).not.toHaveBeenCalled();
});

it.each(devices)("does not launch a stopped $collection device while another device plays", device => {
  const { id, launch, pad } = setup(device, false, false);
  fireEvent.click(pad(1));
  expect(useAppStore.getState().sequencerEditingPads[id]).toBe(1);
  expect(launch).not.toHaveBeenCalled();
});
