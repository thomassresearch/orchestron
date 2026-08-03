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
  & SequencerTrackStoreActions
  & PerformanceControlStoreActions
  & TransportStoreActions;

export function createSequencerStoreActions(
  set: AppStoreSet,
  get: AppStoreGet,
): SequencerStoreActions {
  return {
    ...createSequencerTrackStoreActions(set, get),
    ...createPerformanceControlStoreActions(set, get),
    ...createTransportStoreActions(set, get)
  };
}

