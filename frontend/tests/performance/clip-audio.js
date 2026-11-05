import voice from '../../../backend/tests/fixtures/patches/velocity_if.patch.json';
import fixture from '../../../backend/tests/fixtures/performance_creator/all_sources.json';
import { BrowserClockAudioClient } from '../../src/lib/browserClockAudio';
import { LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS } from '../../src/lib/browserClockLatencyConfig';
import { meterSnapshot } from '../../src/lib/mixerRuntime';
import { api } from '../../src/api/client';

// Opt-in only. Use PROFILE_BACKEND_URL with a temporary database/assets backend.
if (import.meta.env.VITE_PROFILE_AUDIO !== '1') throw Error('Isolated audio profiling is not enabled.');
const Q = 20160;
const config = structuredClone(fixture.wire);
const track = config.tracks[0];
const pad = { ...track.pads[0], length_beats: 1,
  steps: [{ note: [60], velocity: 80, hold: false }] };
track.pads = Array.from({ length: 513 }, (_, pad_index) => ({ ...structuredClone(pad), pad_index }));
track.pads[512].steps[0].note = [72];
track.active_pad = 0;
track.clip_schedule = { end: 64 * Q, cycle_ticks: Q, clips: [
  { id: 'song', start: 0, length: Q, content: [{ pad: 0, length: Q }] }
] };
track.audition_schedule = { end: Q + 1, cycle_ticks: Q + 1, clips: [
  { id: 'draft', start: 0, length: Q + 1, content: [{ pad: 512, length: Q }, { pad: null, length: 1 }] }
] };
config.tracks = [track];
config.score_tracks = [];
config.controller_tracks = [];
config.arpeggiators = [];
config.playback_loop = true;
config.playback_end_step = 64 * config.timing.steps_per_beat;

let sessionId, diagnostics, status, peak = 0;
const errors = [];
const client = new BrowserClockAudioClient({
  getLatencySettings: () => LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS,
  onStatusChange(value) { status = value; },
  onErrorChange(value) { if (value) errors.push(value); },
  onDiagnostics(value) {
    diagnostics = value;
    const output = meterSnapshot('$output');
    peak = Math.max(peak, output.peakL, output.peakR);
  },
  onSequencerStatus() {},
  onTransportEvents(events) {
    for (const { payload, kind } of events) if (kind === 'step') {
      window.__clipTest.store.getState().syncSequencerRuntime({ isPlaying: payload.running,
        playhead: payload.current_step, cycle: payload.cycle, transportSubunit: payload.transport_subunit });
    }
  }
});
window.__clipAudio = {
  snapshot() {
    // Test-only inspection of the real PCM ring, independent of meter subscriptions.
    let pcmPeak = 0, finite = true;
    if (client.sampleBufferSab) for (const sample of new Float32Array(client.sampleBufferSab)) {
      finite &&= Number.isFinite(sample);
      pcmPeak = Math.max(pcmPeak, Math.abs(sample));
    }
    return { status, diagnostics, peak, pcmPeak, finite, errors: [...errors], transport: client.getPlaybackTransportSubunit() };
  },
  async start() {
    await client.prime();
    const session = await api.createPreview({ patches: [{ ...voice, id: 'clip-audio-voice' }],
      session: { instruments: [{ patch_id: 'clip-audio-voice', id: 'clip-audio-voice',
        midi_channel: track.midi_channel }], audio_graph: null, mixer: { strips: {}, sends: {} } } });
    sessionId = session.session_id;
    await api.compileSession(sessionId);
    await api.startSession(sessionId);
    await client.connect(sessionId);
    await client.startSequencer(sessionId, { config, positionStep: 0, arrangerActive: true });
  },
  async audition(revision, active) {
    return client.audition(sessionId, { action: active ? 'workspace_start' : 'workspace_end',
      track_ids: [track.track_id], sequence: active ? [512] : [], clip_context: true,
      gesture_id: 'browser-capacity', revision });
  },
  async edit(pitch) {
    track.pads[512].steps[0].note = [pitch];
    return api.configureSessionSequencer(sessionId, config);
  },
  async reconnect() { await client.disconnect(); await client.connect(sessionId); },
  async seek() { return client.forwardSequencer(sessionId); },
  async stop() {
    await client.disconnect();
    if (sessionId) { await api.stopSession(sessionId); await api.deleteSession(sessionId); sessionId = null; }
    window.__clipTest.store.getState().syncSequencerRuntime({ isPlaying: false });
  }
};
const button = document.createElement('button');
button.textContent = 'Start isolated clip audio';
button.onclick = () => window.__clipAudio.start().catch(error => errors.push(String(error)));
document.querySelector('main').prepend(button);
