import { beforeEach, expect, it } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/device_names.json";
import { MIDI_CHANNELS, normalizeControllerTargetChannels } from "../lib/midiControllerChannels";
import { buildPerformanceExportPayload, parsePerformanceExportPayload } from "../lib/bundleImportExport";
import { buildPersistedAppStateSnapshot, normalizeSequencerState } from "./appStoreModel";
import { useAppStore } from "./useAppStore";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});

it("normalizes legacy and invalid channel selections without sharing defaults", () => {
  for (const raw of [undefined, null, [], [0, 17, 1.5, "2", true]]) {
    expect(normalizeControllerTargetChannels(raw)).toEqual(MIDI_CHANNELS);
  }
  expect(normalizeControllerTargetChannels([16, 2, 1, 2, 0, "3"])).toEqual([1, 2, 16]);
  const state = useAppStore.getState();
  expect(state.sequencer.midiControllers[0].targetChannels).toEqual(MIDI_CHANNELS);
  expect(state.sequencer.controllerSequencers[0].targetChannels).toEqual(MIDI_CHANNELS);
  expect(state.sequencer.midiControllers[0].targetChannels).not.toBe(state.sequencer.controllerSequencers[0].targetChannels);
});

it("preserves channels through snapshots, native JSON and autosave restoration", () => {
  const store = useAppStore.getState();
  store.setMidiControllerTargetChannels(store.sequencer.midiControllers[0].id, [16, 1]);
  store.setControllerSequencerTargetChannels(store.sequencer.controllerSequencers[0].id, [3, 9]);
  const snapshot = useAppStore.getState().buildSequencerConfigSnapshot();
  expect(snapshot.version).toBe(18);
  const native = buildPerformanceExportPayload({ snapshot, selectedPatches: [], performanceName: "Channels", performanceDescription: "" });
  const restored = parsePerformanceExportPayload(JSON.parse(JSON.stringify(native.payload)));
  expect(restored).not.toBeNull();
  useAppStore.getState().applySequencerConfigSnapshot(restored!.performance.config);
  const persisted = JSON.parse(JSON.stringify(buildPersistedAppStateSnapshot(useAppStore.getState())));
  expect(persisted.version).toBe(3);
  const reloaded = normalizeSequencerState(persisted.sequencer);
  expect(reloaded.midiControllers[0].targetChannels).toEqual([1, 16]);
  expect(reloaded.controllerSequencers[0].targetChannels).toEqual([3, 9]);
});

it("tracks channel edits without changing queued pads or resetting transport, and rejects an empty UI selection", () => {
  const store = useAppStore.getState();
  const id = store.sequencer.controllerSequencers[0].id;
  store.syncSequencerTransportRuntime({ isPlaying: true, transportSubunit: 1000, playhead: 3 });
  store.setControllerSequencerQueuedPad(id, 3);
  const before = useAppStore.getState();
  store.setControllerSequencerTargetChannels(id, [16]);
  const after = useAppStore.getState();
  expect(after.sequencerEditRevision).toBe(before.sequencerEditRevision + 1);
  expect(after.sequencerRuntime.transportSubunit).toBe(1000);
  expect(after.sequencerRuntime.controllerStateById[id]?.queuedPad).toBe(before.sequencerRuntime.controllerStateById[id]?.queuedPad);
  store.setControllerSequencerTargetChannels(id, []);
  expect(useAppStore.getState().sequencer.controllerSequencers[0].targetChannels).toEqual([16]);
  const revision = useAppStore.getState().sequencerEditRevision;
  store.setMidiControllerTargetChannels(store.sequencer.midiControllers[0].id, [4]);
  expect(useAppStore.getState().sequencerEditRevision).toBe(revision);
});

it.each(Array.from({ length: 12 }, (_, index) => index + 1))("imports version %i without channel fields as OMNI", version => {
  const config = JSON.parse(JSON.stringify(fixture.config));
  config.version = version;
  useAppStore.getState().applySequencerConfigSnapshot(config);
  const { sequencer } = useAppStore.getState();
  expect(sequencer.midiControllers[0].targetChannels).toEqual(MIDI_CHANNELS);
  expect(sequencer.controllerSequencers[0].targetChannels).toEqual(MIDI_CHANNELS);
});
