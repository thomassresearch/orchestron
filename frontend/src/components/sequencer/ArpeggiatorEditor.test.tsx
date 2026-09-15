// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { normalizeArpeggiatorState } from "../../store/appStoreModel";
import { arrangerTransportExtent } from "../../lib/arrangerTransport";
import { buildBackendArpeggiatorConfigs } from "../../appOrchestration";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import { ArpeggiatorEditor } from "./ArpeggiatorEditor";
import type { ArpeggiatorState } from "../../types";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
afterEach(cleanup);
const make = () => normalizeArpeggiatorState({ id: "arp", inputChannel: 6, targetChannel: 5 }, 0);

it("keeps legacy pitches, accents and routing in P1 while adopting the new transport defaults", () => {
  const arp = normalizeArpeggiatorState({ id: "arp", inputChannel: 6, targetChannel: 5, rate: "1/8T", pattern: "down", octaves: 3, latch: true,
    velocityMode: "accent", accentCycle: [127, 64], restartMode: "first_note", presetId: "mine" }, 0);
  expect(arp).toMatchObject({ playbackMode: "arranger", holdMode: "off", restartMode: "free", inputChannel: 6, targetChannel: 5 });
  expect(arp.pads[0]).toMatchObject({ rate: "1/8T", pattern: "down", octaves: 3, fixedVelocity: 127, octaveTraversal: "range" });
  expect(arp.pads[0].steps.map(s => s.velocity)).toEqual([100, 50]);
  expect(arp.pads[1].steps).toHaveLength(16);
  expect(arp.pads[0]).not.toBe(arp.pads[1]);
});

it("uses pad durations for arpeggiator-only arrangement bounds and runtime payloads", () => {
  const arp = make();
  arp.pads[0].lengthBeats = 7;
  arp.pads[0].steps = arp.pads[0].steps.slice(0, 5);
  const state = { ...useAppStore.getState().sequencer, tracks: [], drummerTracks: [], controllerSequencers: [], arpeggiators: [arp] };
  expect(arrangerTransportExtent(state)).toBe(56);
  expect(buildBackendArpeggiatorConfigs(state)[0].pads[0]).toMatchObject({ length_beats: 7, steps: expect.any(Array) });
});

it("edits the selected pad through keyboard and pointer controls while another pad plays", () => {
  const arp = make();
  const change = vi.fn(); const command = vi.fn(); const preset = vi.fn();
  const props = { arp, language: "english" as const, ui: SEQUENCER_UI_COPY.english, name: "Arp", help: null,
    presets: [{ id: "test", name: "Test", builtin: false, settings: arp.pads[0] }], instruments: [], patches: [], canRemove: true,
    engineRunning: true, transportPlaying: true, stepsPerBeat: 8, onChange: change, onEnabled: vi.fn(), onRemove: vi.fn(),
    onCommand: command, onPreset: preset, onSave: vi.fn() };
  const { rerender } = render(<ArpeggiatorEditor {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Editing P3" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Step 1: Next note" }), { key: "t" });
  expect(change.mock.lastCall?.[0].pads[2].steps[0].kind).toBe("tie");
  expect(change.mock.lastCall?.[0].pads[0].steps[0].kind).toBe("next");
  fireEvent.change(screen.getByRole("combobox", { name: "Preset" }), { target: { value: "test" } });
  expect(preset).toHaveBeenCalledWith("test", 2);
  const playing = { ...arp, activePad: 1 } as ArpeggiatorState;
  rerender(<ArpeggiatorEditor {...props} arp={playing} />);
  expect(screen.getByRole("button", { name: "Editing P3" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Launch P4" }));
  expect(command).toHaveBeenCalledWith({ command: "launch", pad_index: 3 });
  rerender(<ArpeggiatorEditor {...props} arp={{ ...arp, enabled: true, playbackMode: "live" }} engineRunning={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onEnabled).toHaveBeenCalledWith(true);
});

it("presets change one pad and runtime status never edits the authored configuration", () => {
  useAppStore.getState().addArpeggiator();
  const arp = useAppStore.getState().sequencer.arpeggiators[0];
  useAppStore.getState().applyArpeggiatorPreset(arp.id, "builtin-octave-down", 2);
  const before = useAppStore.getState().sequencer;
  useAppStore.getState().syncArpeggiatorRuntime([{ arpeggiatorId: arp.id, heldNotes: [60], activeNote: 60, stepIndex: 3, lastVelocity: 100 }]);
  expect(useAppStore.getState().sequencer).toBe(before);
  useAppStore.getState().saveArpeggiatorPreset(arp.id, "Mine", 2);
  const updated = useAppStore.getState().sequencer.arpeggiators[0];
  expect(updated.pads[0]).toEqual(arp.pads[0]);
  expect(updated.inputChannel).toBe(arp.inputChannel);
  expect(updated.padPresetIds[2]).toBeTruthy();
});
