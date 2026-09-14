import { sequencerEditAccess } from "./sequencerEdits";
import { validatePerformanceDeviceName } from "../lib/performanceDeviceNames";
import type { StoreApi } from "zustand";

import type { AppStore } from "./appStoreTypes";
import {
  createPerformanceControlStoreActions,
  type PerformanceControlStoreActions
} from "./appStorePerformanceControlsSlice";
import {
  createSequencerTrackStoreActions,
  type SequencerTrackStoreActions
} from "./appStoreSequencerTracksSlice";
import {
  createTransportStoreActions,
  type TransportStoreActions
} from "./appStoreTransportSlice";

type AppStoreSet = StoreApi<AppStore>["setState"];
type AppStoreGet = StoreApi<AppStore>["getState"];

export type SequencerStoreActions =
  & Pick<AppStore, "renamePerformanceDevice">
  & SequencerTrackStoreActions
  & PerformanceControlStoreActions
  & TransportStoreActions;

export function createSequencerStoreActions(
  set: AppStoreSet,
  get: AppStoreGet,
): SequencerStoreActions {
  const edit = sequencerEditAccess(set, get);
  const transport = createTransportStoreActions(set, get);
  const controls = createPerformanceControlStoreActions(set, get);
  return {
    renamePerformanceDevice: (kind, id, name) => {
      const sequencer = get().sequencer;
      const result = validatePerformanceDeviceName(sequencer, kind, id, name);
      if (!result.ok) return result;
      const device = sequencer[kind].find((candidate) => candidate.id === id)!;
      if (device.name !== result.name) {
        set({ sequencer: {
          ...sequencer,
          [kind]: sequencer[kind].map((candidate) => candidate.id === id ? { ...candidate, name: result.name } : candidate)
        } });
      }
      return result;
    },
    ...createSequencerTrackStoreActions(edit.set, edit.get),
    ...createPerformanceControlStoreActions(edit.set, edit.get),
    ...createTransportStoreActions(edit.set, edit.get),
    applySequencerConfigSnapshot: createSequencerTrackStoreActions(set, get).applySequencerConfigSnapshot,
    syncSequencerRuntime: transport.syncSequencerRuntime,
    syncSequencerTransportRuntime: transport.syncSequencerTransportRuntime,
    setSequencerPlaying: transport.setSequencerPlaying,
    setSequencerPlayhead: transport.setSequencerPlayhead,
    setSequencerTransportAbsoluteStep: transport.setSequencerTransportAbsoluteStep,
    syncControllerSequencerRuntime: controls.syncControllerSequencerRuntime,
    syncArpeggiatorRuntime: controls.syncArpeggiatorRuntime
  };
}
