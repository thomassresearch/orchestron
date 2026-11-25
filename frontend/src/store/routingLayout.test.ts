import { afterEach, expect, it } from "vitest";
import { buildPersistedAppStateSnapshot, capturePersistWatchState, hasPersistableStateChange } from "./appStoreModel";
import { useAppStore } from "./useAppStore";
import { sessionAudioSignature } from "./sessionSignature";

afterEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

it("saves graph coordinates as display metadata and restores only positions belonging to the loaded performance", async () => {
  const state = useAppStore.getState();
  const before = capturePersistWatchState(state);
  const layout = { "$master": {x:-321.5,y:88}, "$output": {x:870,y:104} };
  useAppStore.setState({ routingLayout:layout });
  const arranged = useAppStore.getState(), snapshot = arranged.buildSequencerConfigSnapshot();
  expect(hasPersistableStateChange(capturePersistWatchState(arranged),before)).toBe(true);
  expect(sessionAudioSignature(arranged)).toEqual(sessionAudioSignature(state));
  expect(arranged.audioGraph).toBe(state.audioGraph);
  expect(buildPersistedAppStateSnapshot(arranged).routingLayout).toEqual(layout);
  expect(snapshot.routingLayout).toEqual(layout);
  await arranged.newPerformanceWorkspace();
  expect(useAppStore.getState().routingLayout).toEqual({});
  state.applySequencerConfigSnapshot({...snapshot, routingLayout:{...layout,removed:{x:12,y:34}}});
  expect(useAppStore.getState().routingLayout).toEqual(layout);
  state.applySequencerConfigSnapshot({...snapshot, routingLayout:{"$output":{x:Infinity,y:0},"$master":layout.$master}});
  expect(useAppStore.getState().routingLayout).toEqual({"$master":layout.$master});
  delete snapshot.routingLayout;
  state.applySequencerConfigSnapshot(snapshot);
  expect(useAppStore.getState().routingLayout).toEqual({});
});
