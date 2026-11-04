import { migrateClipArrangement, sourceKeys } from "../../src/lib/clipArranger/migration";
import { openClipEditor } from "../../src/store/clipActions";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import fixture from "../../../backend/tests/fixtures/performances/collapsed_gui.json";
import { SequencerPage } from "../../src/components/SequencerPage";
import { INITIAL_PANEL_COLLAPSE_STATE } from "../../src/components/CollapsiblePanel";
import { useAppStore } from "../../src/store/useAppStore";
import { mergedSequencerState } from "../../src/lib/mergedSequencerState";
import "../../src/index.css";

// Production components with versioned fixtures; no application bootstrap or persistence.
const config = structuredClone(fixture.config);
useAppStore.setState({ patches: fixture.patches });
useAppStore.getState().applySequencerConfigSnapshot(config);
const authored = useAppStore.getState().sequencer;
for (const source of Object.keys(sourceKeys)) for (const track of authored[sourceKeys[source]]) {
  track.padLoopEnabled = true; track.padLoopRepeat = false;
  if (source === "arpeggiator") track.playbackMode = "arranger";
  track.padLoopPattern = { groups: [{ id: "A", sequence: [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 1 }] }],
    superGroups: [{ id: "I", sequence: [{ type: "group", groupId: "A" }, { type: "group", groupId: "A" }] }],
    rootSequence: [{ type: "super", superGroupId: "I" }] };
}
const report = migrateClipArrangement(authored);
if (!report.model) throw new Error(report.reasons.join(", "));
if (new URLSearchParams(location.search).get("selection") === "loop") {
  for (const lane of report.model.lanes) {
    const pattern = lane.definitions.find(definition => definition.kind === "pattern");
    lane.clips[0] = { ...lane.clips[0], mode: "loop", children: [{ id: `${lane.id}:selection-pattern`, definitionId: pattern.id }] };
  }
}
useAppStore.setState({ sequencer: { ...authored, clipArrangement: report.model } });
const restored = sessionStorage.getItem('clip-repetition-verification');
if (restored) {
  sessionStorage.removeItem('clip-repetition-verification');
  useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(restored));
}
window.__clipTest = { store: useAppStore, report, openClipEditor };

const noop = () => {};
const action = new Proxy({}, { get: (_, key) => {
  const name = String(key);
  const explicit = { onSequencerTrackStepChange: "setSequencerTrackStep", onSequencerTrackVelocityChange: "setSequencerTrackStepVelocity", onAddSequencerTrack: "addSequencerTrack", onAddDrummerSequencerTrack: "addDrummerSequencerTrack", onAddControllerSequencer: "addControllerSequencer", onAddArpeggiator: "addArpeggiator" };
  return (...args) => {
    const state = useAppStore.getState();
    const method = explicit[name] ?? (name.endsWith("Change") ? `set${name.slice(2, -6)}` : name.slice(2, 3).toLowerCase() + name.slice(3));
    return (state[method] ?? noop)(...args);
  };
} });
const actions = Object.fromEntries(["instrumentActions", "performanceActions", "transportActions", "melodicTrackActions",
  "drummerTrackActions", "pianoRollActions", "midiControllerActions", "controllerSequencerActions", "arpeggiatorActions"].map(key => [key, action]));
function Page() {
  const state = useAppStore();
  const [panels, setPanels] = useState({ ...INITIAL_PANEL_COLLAPSE_STATE, piano: true, midi: true, rack: true });
  return <main className="p-4">
      <SequencerPage {...actions} collapsedPanels={panels}
        onPanelCollapsedChange={(panel, collapsed) => setPanels(previous => ({ ...previous, [panel]: collapsed }))}
        data={{ guiLanguage: "english", patches: state.patches, performances: [], instrumentBindings: state.sequencerInstruments,
          sequencer: mergedSequencerState(state.sequencer, state.sequencerRuntime), sequencerTransportSubunit: state.sequencerRuntime.transportSubunit,
          readPlaybackTransportSubunit: () => null, currentPerformanceId: null,
          performanceName: "Nested clip arranger", performanceDescription: "Production editors / versioned fixtures",
          instrumentsRunning: false, sessionState: "stopped", midiInputName: null, transportError: null }} />
    <button className="mt-6 text-xs text-slate-400" onClick={() => {
      sessionStorage.setItem('clip-repetition-verification', JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()));
      location.reload();
    }}>Reload saved performance</button>
  </main>;
}
const root = createRoot(document.getElementById("root"));
root.render(<Page />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
