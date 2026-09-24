import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import fixture from "../../../backend/tests/fixtures/performances/collapsed_gui.json";
import { SequencerPage } from "../../src/components/SequencerPage";
import { INITIAL_PANEL_COLLAPSE_STATE } from "../../src/components/CollapsiblePanel";
import { useAppStore } from "../../src/store/useAppStore";
import "../../src/index.css";
import { normalizeSequencerState } from "../../src/store/appStoreModel";

// Isolated visual review: versioned fixtures, local edits, no API/audio/autosave bootstrap.
const config = structuredClone(fixture.config);
config.version = 17;
config.sequencer = normalizeSequencerState(config.sequencer);
for (const key of ["tracks", "drummerTracks", "controllerSequencers"]) {
  config.sequencer[key] = config.sequencer[key].slice(0,1);
  const track = config.sequencer[key][0];
  track.timing = { tempoBPM:120, meterNumerator:4, meterDenominator:4, stepsPerBeat:key === "tracks" ? 3 : 4, beatRateNumerator:1, beatRateDenominator:1 };
  track.lengthBeats = 4;
  track.pads.forEach(pad => { pad.lengthBeats = 4; });
}
for (const key of ["arpeggiators", "pianoRolls", "midiControllers"]) config.sequencer[key] = [];
useAppStore.setState({ patches:fixture.patches });
useAppStore.getState().applySequencerConfigSnapshot(config);
const noop = () => {};
const action = new Proxy({}, { get: (_object, key) => {
  const name = String(key).replace(/^on/, "set").replace(/Change$/, "");
  return (...args) => (useAppStore.getState()[name] ?? noop)(...args);
}});
const actions = Object.fromEntries(["instrumentActions", "performanceActions", "transportActions", "melodicTrackActions", "drummerTrackActions", "pianoRollActions", "midiControllerActions", "controllerSequencerActions", "arpeggiatorActions"].map(key => [key, action]));
function Page() {
  const state = useAppStore();
  const [panels,setPanels] = useState({...INITIAL_PANEL_COLLAPSE_STATE, rack:true, arranger:true});
  return <main className="p-3"><SequencerPage {...actions} collapsedPanels={panels}
    onPanelCollapsedChange={(panel,collapsed)=>setPanels(p=>({...p,[panel]:collapsed}))}
    data={{guiLanguage:"english",patches:state.patches,performances:[],instrumentBindings:state.sequencerInstruments,sequencer:state.sequencer,
    sequencerTransportSubunit:0,currentPerformanceId:null,performanceName:"Triplet timing review",performanceDescription:"4/4 bass: 12 steps / drums: 16 steps",
    instrumentsRunning:false,sessionState:"stopped",midiInputName:null,transportError:null}}/></main>;
}
const root = createRoot(document.getElementById("root"));
root.render(<Page/>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
