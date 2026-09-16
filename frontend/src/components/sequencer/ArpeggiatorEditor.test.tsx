// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { normalizeArpeggiatorState } from "../../store/appStoreModel";
import { arrangerTransportExtent } from "../../lib/arrangerTransport";
import { buildBackendArpeggiatorConfigs } from "../../appOrchestration";
import { SEQUENCER_UI_COPY } from "./sequencerUiCopy";
import { ArpeggiatorEditor } from "./ArpeggiatorEditor";
import type { ArpeggiatorState } from "../../types";
import { scaleDegreeBorderBackground } from "../../lib/scaleDegreeColors";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
afterEach(cleanup);
const make = () => normalizeArpeggiatorState({ id: "arp", inputChannel: 6, targetChannel: 5 }, 0);

function previewProps() {
  const arp = make();
  arp.enabled = true;
  arp.stepIndex = 2;
  arp.pads[0].scaleMode = "custom";
  arp.pads[0].steps[7].kind = "chord";
  arp.pads[0].steps[8].kind = "rest";
  arp.pads[0].steps[9].kind = "tie";
  arp.runtimeStatus = {
    arpeggiator_id: arp.id, enabled: true, input_channel: 6, target_channel: 5,
    held_notes: [60, 64, 67], active_note: 64, step_index: 2, last_velocity: 100,
    active_pad: 0, state: "playing", effective_scale: "C ionian",
    preview_notes: [[60], [62], [64], [65], [67], [69], [71], [60, 64, 67, 72], [], []],
    preview_degrees: [[1], [2], [3], [4], [5], [6], [7], [1, 3, 5, 1], [], []]
  };
  return { arp, language: "english" as const, ui: SEQUENCER_UI_COPY.english, name: "Arp", help: null,
    presets: [], instruments: [], patches: [], canRemove: true, engineRunning: true, transportPlaying: true,
    stepsPerBeat: 8, onChange: vi.fn(), onEnabled: vi.fn(), onRemove: vi.fn(), onCommand: vi.fn(),
    onPreset: vi.fn(), onSave: vi.fn() };
}

function stepBorder(button: HTMLElement) {
  return button.parentElement?.querySelector<HTMLElement>(":scope > span[aria-hidden='true']");
}

it("shows degree borders and complete accessible chord previews alongside selection and playback", () => {
  render(<ArpeggiatorEditor {...previewProps()} />);
  const steps = within(screen.getByRole("group", { name: "Rhythm steps" })).getAllByRole("button");
  for (let i = 0; i < 7; i++) {
    const description = document.getElementById(steps[i].getAttribute("aria-describedby")!);
    expect(description?.textContent).toContain(`Scale degrees: ${i + 1}`);
    expect(stepBorder(steps[i])?.style.background).toBeTruthy();
  }
  expect(steps[0].getAttribute("aria-pressed")).toBe("true");
  expect(steps[0].parentElement?.className).toContain("outline-cyan-200");
  expect(steps[2].parentElement?.className).toContain("bg-cyan-900/70");
  expect(steps[7].title).toBe("Preview notes: C4 E4 G4 C5; Scale degrees: 1, 3, 5");
  expect(document.getElementById(steps[7].getAttribute("aria-describedby")!)?.textContent).toBe(steps[7].title);
  const expectedBorder = document.createElement("span");
  expectedBorder.style.background = scaleDegreeBorderBackground([1, 3, 5])!;
  expect(stepBorder(steps[7])?.style.background).toBe(expectedBorder.style.background);
  expect(stepBorder(steps[8])).toBeNull();
  expect(stepBorder(steps[9])).toBeNull();
  fireEvent.keyDown(steps[0], { key: "ArrowRight" });
  expect(document.activeElement).toBe(steps[1]);
  expect(steps[1].getAttribute("aria-pressed")).toBe("true");
  expect(stepBorder(steps[0])?.style.background).toBeTruthy();
});

it("keeps borders neutral without matching degree metadata or when Scale is Off", () => {
  const props = previewProps();
  const { rerender } = render(<ArpeggiatorEditor {...props} />);
  const step = () => screen.getByRole("button", { name: "Step 1: Next note" });
  for (const degrees of [undefined, [], [[1, 3]], [[null]], [[0]], [[8]]]) {
    const arp = { ...props.arp, runtimeStatus: { ...props.arp.runtimeStatus!, preview_degrees: degrees } };
    rerender(<ArpeggiatorEditor {...props} arp={arp} />);
    expect(stepBorder(step())).toBeNull();
    expect(step().title).toBe("Preview notes: C4");
  }
  const arp = { ...props.arp, pads: props.arp.pads.map(pad => ({ ...pad, scaleMode: "off" as const })) };
  rerender(<ArpeggiatorEditor {...props} arp={arp} />);
  expect(stepBorder(step())).toBeNull();
  expect(step().title).toBe("Preview notes: C4");
});

it("hides stale previews on other pads and steps edited into rests or ties", () => {
  const props = previewProps();
  const { rerender } = render(<ArpeggiatorEditor {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Editing P2" }));
  const step = screen.getByRole("button", { name: "Step 1: Next note" });
  expect(step.title).toBe("");
  expect(stepBorder(step)).toBeNull();
  rerender(<ArpeggiatorEditor {...props} arp={{ ...props.arp, runtimeStatus: { ...props.arp.runtimeStatus!, active_pad: 1 } }} />);
  expect(step.title).toBe("Preview notes: C4"); // The second pad has Scale Off.
  fireEvent.click(screen.getByRole("button", { name: "Editing P1" }));
  for (const kind of ["rest", "tie"] as const) {
    const arp = { ...props.arp, pads: props.arp.pads.map(pad => ({ ...pad, steps: pad.steps.map(s => ({ ...s, kind })) })) };
    rerender(<ArpeggiatorEditor {...props} arp={arp} />);
    const button = screen.getByRole("button", { name: kind === "rest" ? "Step 1: Rest" : "Step 1: Tie" });
    expect(stepBorder(button)).toBeNull();
    expect(button.title).toBe("");
  }
});

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
