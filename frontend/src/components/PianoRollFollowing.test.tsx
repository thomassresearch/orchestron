// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/device_names.json";
import { useAppStore } from "../store/useAppStore";
import { INITIAL_PANEL_COLLAPSE_STATE } from "./CollapsiblePanel";
import { SequencerPage } from "./SequencerPage";

import { migrateClipArrangement, sourceKeys } from "../lib/clipArranger/migration";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import { beginDraft } from "../lib/clipArranger/operations";
import { clipAuditionState } from "../lib/clipArranger/runtime";

const onNoteOn = vi.fn();
function actions<T>(overrides: object = {}): T {
  return new Proxy(overrides, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as T;
}
function Page() {
  const store = useAppStore();
  const { setMidiControllerTargetChannels, setControllerSequencerTargetChannels } = store;
  const sequencer = mergedSequencerState(store.sequencer, store.sequencerRuntime);
  return <SequencerPage collapsedPanels={INITIAL_PANEL_COLLAPSE_STATE} onPanelCollapsedChange={() => {}}
    instrumentActions={actions()} transportActions={actions()} melodicTrackActions={actions()} drummerTrackActions={actions()}
    pianoRollActions={actions({ onPianoRollEnabledChange: useAppStore.getState().setPianoRollEnabled, onPianoRollNoteOn: onNoteOn, onPianoRollAutoChordEnabledChange: useAppStore.getState().setPianoRollAutoChordEnabled,
      onPianoRollAutoChordSizeChange: useAppStore.getState().setPianoRollAutoChordSize })} arpeggiatorActions={actions()} performanceActions={actions()}
    midiControllerActions={actions({ onMidiControllerTargetChannelsChange: setMidiControllerTargetChannels })}
    controllerSequencerActions={actions({ onControllerSequencerTargetChannelsChange: setControllerSequencerTargetChannels })}
    data={{ guiLanguage: "english", patches: [], performances: [], instrumentBindings: [], sequencer,
      sequencerTransportSubunit: 0, currentPerformanceId: null, performanceName: "Channels", performanceDescription: "",
      instrumentsRunning: true, sessionState: "running", midiInputName: null, transportError: null }} />;
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId = 1;
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value() {} });
  onNoteOn.mockClear();
  const state = structuredClone(useAppStore.getState().sequencer);
  state.tracks = state.tracks.slice(0, 1); state.drummerTracks = []; state.controllerSequencers = []; state.arpeggiators = [];
  state.scoreTracks = state.scoreTracks.slice(0, 1);
  for (const kind of Object.values(sourceKeys)) for (const track of state[kind]) {
    track.enabled = false; track.padLoopEnabled = true;
    track.padLoopPattern = { groups: [], superGroups: [], rootSequence: [{ type: "pad", padIndex: 0 }] };
  }
  state.pianoRolls = [{ ...state.pianoRolls[0], enabled: false, scaleRoot: "D", scaleType: "major", mode: "ionian", autoChordEnabled: true }];
  state.clipArrangement = migrateClipArrangement(state).model!;
  for (const lane of state.clipArrangement.lanes) {
    lane.definitions = lane.definitions.slice(0, 1);
    const definition = lane.definitions[0];
    if (definition.kind === "pattern" && (definition.source === "sequencer" || definition.source === "score"))
      Object.assign(definition.payload, { scaleRoot: "E", scaleType: "minor", mode: "aeolian" });
  }
  useAppStore.setState({ sequencer: state });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


function keyboard() {
  const scale = screen.getByRole("combobox", { name: "Scale" }) as HTMLSelectElement;
  const mode = screen.getByRole("combobox", { name: "Mode" }) as HTMLSelectElement;
  return { scale, mode, article: within(scale.closest("article")!) };
}
function play(trackId: string, enabled = true) {
  act(() => useAppStore.getState().syncSequencerRuntime({ isPlaying: true, independentSources: true,
    arrangementRunning: true, arrangementPlaybackSubunit: 0,
    tracks: [{ trackId, enabled, activePad: 0, runtimePadStartSubunit: enabled ? 0 : null }] }));
}

it.each(["sequencer", "score"] as const)("follows the playing %s clip and restores editable keyboard settings on source stop", source => {
  const before = useAppStore.getState().sequencer;
  const lane = before.clipArrangement!.lanes.find(l => l.source === source)!;
  render(<Page />);
  const { scale, mode, article } = keyboard();
  fireEvent.click(article.getByRole("button", { name: "Start" }));
  expect([scale.value, mode.value, scale.disabled]).toEqual(["D:major", "ionian", false]);
  play(lane.id);
  expect([scale.value, mode.value, scale.disabled, mode.disabled]).toEqual(["E:minor", "aeolian", true, true]);
  const e4 = article.getByRole("button", { name: "E4" });
  fireEvent.pointerDown(e4, { pointerId: 1, button: 0 });
  expect(onNoteOn.mock.calls.map(call => call[1])).toEqual([64, 67, 71]);
  fireEvent.pointerUp(e4, { pointerId: 1, button: 0 });
  play(lane.id, false);
  expect([scale.value, mode.value, scale.disabled, mode.disabled]).toEqual(["D:major", "ionian", false, false]);
  expect(useAppStore.getState().sequencer.pianoRolls[0]).toMatchObject({ scaleRoot: "D", mode: "ionian" });
  expect(useAppStore.getState().sequencer.clipArrangement).toEqual(before.clipArrangement);
});

it("uses only audible sources for mixed scales and restores the keyboard when transport stops", () => {
  const state = useAppStore.getState().sequencer;
  const melodic = state.tracks[0], score = state.scoreTracks[0];
  const definition = state.clipArrangement!.lanes.find(l => l.id === score.id)!.definitions[0];
  if (definition.kind !== "pattern" || definition.source !== "score") throw Error("Expected score");
  Object.assign(definition.payload, { scaleRoot: "G", scaleType: "major", mode: "ionian" });
  render(<Page />);
  const { scale, mode, article } = keyboard();
  fireEvent.click(article.getByRole("button", { name: "Start" }));
  play(melodic.id); play(score.id);
  expect(scale.selectedOptions[0].textContent).toBe("mixed");
  expect(mode.selectedOptions[0].textContent).toBe("mixed");
  play(score.id, false);
  expect([scale.value, mode.value]).toEqual(["E:minor", "aeolian"]);
  act(() => useAppStore.getState().syncSequencerRuntime({ isPlaying: false }));
  expect([scale.value, mode.value, scale.disabled]).toEqual(["D:major", "ionian", false]);
});

it("follows an audible audition without following the queued or merely edited draft", () => {
  const state = useAppStore.getState().sequencer, lane = state.clipArrangement!.lanes[0], clip = lane.clips[0];
  const draft = beginDraft(state.clipArrangement!, { laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 });
  if (draft.definition.kind !== "pattern" || draft.definition.source !== "sequencer") throw Error("Expected melodic pattern");
  Object.assign(draft.definition.payload, { scaleRoot: "A", scaleType: "neutral", mode: "dorian" });
  useAppStore.setState({ clipAuditionDraft: draft });
  render(<Page />);
  const { scale, mode, article } = keyboard();
  fireEvent.click(article.getByRole("button", { name: "Start" }));
  expect(scale.value).toBe("D:major");
  play(lane.id);
  expect(scale.value).toBe("E:minor");
  const { sequence } = clipAuditionState(state, draft);
  act(() => useAppStore.setState({ performanceAuditions: { [lane.id]: {
    active: false, queued: null, workspace_active: false, workspace_queued: true
  } } }));
  expect(scale.value).toBe("E:minor");
  act(() => useAppStore.setState(s => ({
    sequencerRuntime: { ...s.sequencerRuntime, arrangementRunning: false },
    performanceAuditions: { [lane.id]: { active: true, queued: null, workspace_active: true,
      workspace_sequence: sequence, workspace_position: 0 } }
  })));
  expect([scale.value, mode.value]).toEqual(["A:neutral", "dorian"]);
  act(() => useAppStore.setState({ performanceAuditions: {}, clipAuditionDraft: null }));
  expect([scale.value, mode.value, scale.disabled]).toEqual(["D:major", "ionian", false]);
});
