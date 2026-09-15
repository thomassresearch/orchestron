import React, { Profiler, useState } from "react";
import { createRoot } from "react-dom/client";
import fixture from "../../../backend/tests/fixtures/performances/collapsed_gui.json";
import voice from "../../../backend/tests/fixtures/patches/velocity_if.patch.json";
import { SequencerPage } from "../../src/components/SequencerPage";
import { INITIAL_PANEL_COLLAPSE_STATE } from "../../src/components/CollapsiblePanel";
import { useAppStore } from "../../src/store/useAppStore";
import { mergedSequencerState } from "../../src/lib/mergedSequencerState";
import { BrowserClockAudioClient } from "../../src/lib/browserClockAudio";
import { meterSnapshot } from "../../src/lib/mixerRuntime";
import { LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS } from "../../src/lib/browserClockLatencyConfig";
import { buildSequencerStepChordMidiNotes } from "../../src/lib/sequencer";
import { compileArrangerTransportSequence } from "../../src/lib/arrangerTransport";
import { buildDrummerRowTrackConfigs, buildBackendArpeggiatorConfigs } from "../../src/appOrchestration";
import { normalizeSessionInstrumentAssignments } from "../../src/store/appStoreModel";
import { api } from "../../src/api/client";
import "../../src/index.css";

// Eight of each device type (MIDI controllers normalize to the supported six), with versioned data only. No app bootstrap/save calls.
const config = structuredClone(fixture.config);
for (const field of ["tracks", "drummerTracks", "controllerSequencers", "arpeggiators", "pianoRolls", "midiControllers"]) {
  config.sequencer[field] = Array.from({ length: 8 }, (_, index) => {
    const device = structuredClone(fixture.config.sequencer[field][0]);
    device.id += `-${index}`;
    device.name += ` ${index + 1}`;
    return device;
  });
}
useAppStore.setState({ patches: fixture.patches });
useAppStore.getState().applySequencerConfigSnapshot(config);

let sessionId = null;
let diagnostics = null;
let counts = {};
let commits = 0;
let reactMs = 0;
let mutationCount = 0;
let maximumAudioPeak = 0;
const errors = [];
const profile = window.__collapseProfile = {
  count(name) { counts[name] = (counts[name] ?? 0) + 1; },
  reset() { counts = {}; commits = 0; reactMs = 0; mutationCount = 0; maximumAudioPeak = 0; },
  snapshot() { return { counts, commits, reactMs, mutationCount, diagnostics, errors, maximumAudioPeak,
    elementCount: document.querySelectorAll("*").length,
    hiddenBodyChildren: [...document.querySelectorAll("div[hidden]")].map(node => node.childElementCount),
    runtime: useAppStore.getState().sequencerRuntime }; },
  async stop() {
    await client.disconnect();
    if (sessionId) { await api.stopSession(sessionId); await api.deleteSession(sessionId); sessionId = null; }
    useAppStore.getState().syncSequencerRuntime({ isPlaying: false });
  }
};

const client = new BrowserClockAudioClient({
  onStatusChange(status) { document.title = `Profile · ${status}`; },
  onErrorChange(error) { if (error) errors.push(error); },
  onDiagnostics(value) {
    diagnostics = value;
    const output = meterSnapshot("$output");
    maximumAudioPeak = Math.max(maximumAudioPeak, output.peakL, output.peakR);
  },
  getLatencySettings: () => LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS,
  onSequencerStatus(status) {
    useAppStore.getState().syncSequencerRuntime({ isPlaying: status.running, playhead: status.current_step,
      cycle: status.cycle, transportStepCount: status.step_count, transportSubunit: status.transport_subunit });
  },
  onTransportEvents(events) {
    for (const { payload, kind } of events) {
      if (kind === "stopped") { useAppStore.getState().syncSequencerRuntime({ isPlaying: false }); continue; }
      if (kind !== "step" && kind !== "pad_switches") continue;
      useAppStore.getState().syncSequencerRuntime({ isPlaying: payload.running,
        playhead: payload.current_step, cycle: payload.cycle, transportStepCount: payload.step_count,
        transportSubunit: payload.transport_subunit,
        tracks: (payload.tracks ?? []).map(track => ({ trackId: track.track_id, localStep: track.local_step })) });
      for (const switched of payload.switches ?? []) {
        const update = { activePad: switched.active_pad, queuedPad: switched.queued_pad,
          padLoopPosition: switched.pad_loop_position, runtimePadStartSubunit: switched.runtime_pad_start_subunit };
        if (switched.track_kind === "controller") {
          useAppStore.getState().syncControllerSequencerRuntime([{ ...update, controllerSequencerId: switched.track_id }]);
        } else {
          useAppStore.getState().syncSequencerRuntime({ isPlaying: payload.running, tracks: [{ ...update, trackId: switched.track_id }] });
        }
      }
    }
  }
});

function timing(value) {
  return { tempo_bpm: value.tempoBPM, meter_numerator: value.meterNumerator,
    meter_denominator: value.meterDenominator, steps_per_beat: value.stepsPerBeat,
    beat_rate_numerator: value.beatRateNumerator, beat_rate_denominator: value.beatRateDenominator };
}
function backendConfig() {
  const state = useAppStore.getState().sequencer;
  const common = track => ({ track_id: track.id, timing: timing(track.timing), length_beats: track.lengthBeats,
    active_pad: track.activePad, queued_pad: null, pad_loop_enabled: track.padLoopEnabled,
    pad_loop_repeat: track.padLoopRepeat, pad_loop_sequence: compileArrangerTransportSequence(track.padLoopPattern, track.activePad),
    enabled: track.enabled });
  return {
    timing: { ...timing(state.timing), steps_per_beat: 8 }, step_count: 32,
    playback_start_step: 0, playback_end_step: 256, playback_loop: true,
    tracks: [...state.tracks.map(track => ({ ...common(track), midi_channel: track.midiChannel,
      scale_root: track.scaleRoot, scale_type: track.scaleType, mode: track.mode, velocity: 72,
      gate_ratio: 0.8, sync_to_track_id: null, queued_enabled: null,
      pads: track.pads.map((pad, pad_index) => ({ pad_index, length_beats: pad.lengthBeats,
        scale_root: pad.scaleRoot, scale_type: pad.scaleType, mode: pad.mode,
        steps: pad.steps.map(step => {
          const notes = buildSequencerStepChordMidiNotes(step.note, step.chord, pad.scaleRoot, pad.mode);
          return { note: notes.length ? notes : null, hold: step.hold, velocity: step.velocity };
        }) })) })), ...state.drummerTracks.flatMap(track => buildDrummerRowTrackConfigs(track, true, false))],
    controller_tracks: state.controllerSequencers.map(track => ({ ...common(track), controller_number: track.controllerNumber,
      pads: track.pads.map((pad, pad_index) => ({ pad_index, length_beats: pad.lengthBeats, keypoints: pad.keypoints })) })),
    arpeggiators: buildBackendArpeggiatorConfigs(state)
  };
}
async function start() {
  try {
    await client.prime();
    const state = useAppStore.getState();
    const session = await api.createPreview({ patches: [{ ...voice, id: fixture.patches[0].id }],
      session: { instruments: normalizeSessionInstrumentAssignments(state.sequencerInstruments),
        audio_graph: state.audioGraph, mixer: state.mixer } });
    sessionId = session.session_id;
    await api.compileSession(sessionId);
    await api.startSession(sessionId);
    await client.connect(sessionId);
    await client.startSequencer(sessionId, { config: backendConfig(), positionStep: 0 });
  } catch (error) { errors.push(String(error)); throw error; }
}
profile.start = start;

const noop = () => {};
const action = new Proxy({}, { get: () => noop });
const actions = Object.fromEntries(["instrumentActions", "performanceActions", "transportActions", "melodicTrackActions",
  "drummerTrackActions", "pianoRollActions", "midiControllerActions", "controllerSequencerActions", "arpeggiatorActions"].map(key => [key, action]));
function Page() {
  const state = useAppStore();
  const [panels, setPanels] = useState(INITIAL_PANEL_COLLAPSE_STATE);
  return <main className="p-4"><button onClick={() => void start()}>Start profile audio</button>
    <button onClick={() => void profile.stop()}>Stop profile audio</button>
    <Profiler id="Perform" onRender={(_id, _phase, duration) => { commits++; reactMs += duration; }}>
      <SequencerPage {...actions} collapsedPanels={panels}
        onPanelCollapsedChange={(panel, collapsed) => setPanels(previous => ({ ...previous, [panel]: collapsed }))}
        data={{ guiLanguage: "english", patches: state.patches, performances: [], instrumentBindings: state.sequencerInstruments,
          sequencer: mergedSequencerState(state.sequencer, state.sequencerRuntime), sequencerTransportSubunit: state.sequencerRuntime.transportSubunit,
          readPlaybackTransportSubunit: () => client.getPlaybackTransportSubunit(), currentPerformanceId: null,
          performanceName: "46-device collapse profile", performanceDescription: "Versioned fixtures / temporary audio session",
          instrumentsRunning: true, sessionState: "running", midiInputName: null, transportError: null }} />
    </Profiler>
  </main>;
}
new MutationObserver(records => { mutationCount += records.length; }).observe(document.getElementById("root"),
  { subtree: true, childList: true, attributes: true, characterData: true });
createRoot(document.getElementById("root")).render(<Page />);
