# MIDI Sequencer Implementation

## 1. Purpose
The sequencer is now driven by a backend-native timing clock to reduce audible jitter and provide an extensible foundation for:
- multiple sequencers/tracks running in parallel
- polyphonic steps (chords)
- manual live MIDI input (for future piano-roll/jam workflows) while sequencers run

## 2. Page Structure
The frontend contains three pages:
- `Instrument Design`
- `Sequencer`
- `Config`

Sequencer editing and transport happen on the `Sequencer` page, but session/runtime controls remain globally available via the toolbar.

## 3. Sequencer UX (Current)
- Start / Stop transport
- BPM (`30..300`)
- MIDI channel (`1..16`)
- Step count (`16` / `32`)
- Scale + mode guided note selection
- 8 pattern pads (`P1..P8`)
  - stopped: pressing a pad selects it immediately
  - playing: pressing a pad queues it; switch happens at next loop boundary
- Piano roll section below the step sequencer
  - independent MIDI channel
  - independent scale + mode
  - 7-octave horizontal keyboard (`C1..B7`) styled as white/black piano keys
  - keyboard uses full viewport width and shows left/right scroll arrows when needed
  - mouse press-hold sends `note_on`; mouse release sends `note_off`
  - scale notes highlighted with degree labels on keys

## 4. Note Selection and Theory Aids
- Step notes are chosen as named notes with octaves, not raw MIDI integers.
- Enharmonic labels are shown (for example `F#5 / Gb5`, `B2 / Cb3`).
- In-scale notes are highlighted and show degree `(1)..(7)`.
- Out-of-scale notes remain selectable.
- Step note select ergonomics:
  - if current step is `Rest`, opening the menu preselects the preceding non-rest note (if available)
  - if current step already has a note, the browser menu opens at that selected note

Internally, notes are still persisted as MIDI note numbers (`0..127`).

## 5. Frontend State Model

```ts
interface SequencerState {
  isPlaying: boolean;
  bpm: number;
  midiChannel: number;
  scaleRoot: SequencerScaleRoot;
  scaleType: "major" | "minor";
  mode: "ionian" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "aeolian" | "locrian";
  trackId: string;           // current default: "voice-1"
  stepCount: 16 | 32;
  playhead: number;
  cycle: number;
  activePad: number;         // 0..7
  queuedPad: number | null;  // 0..7 or null
  pads: Array<Array<number | null>>; // 8 pads x 32 steps
  steps: Array<number | null>;       // active-pad view cache
  pianoRollMidiChannel: number;
  pianoRollScaleRoot: SequencerScaleRoot;
  pianoRollScaleType: "major" | "minor";
  pianoRollMode: "ionian" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "aeolian" | "locrian";
}
```

## 6. Backend-Native Transport

### 6.1 Runtime Design
Each session has a dedicated sequencer runtime thread:
- monotonic clock (`time.perf_counter`)
- deterministic 16th-note step scheduling
- per-track gate timing (`gate_ratio`)
- due note-off heap for precise note release
- loop-boundary pad switching (`queued_pad -> active_pad`)

This avoids per-step browser + HTTP timing jitter.

### 6.2 Backend Endpoints
New session endpoints:
- `PUT /api/sessions/{sessionId}/sequencer/config`
- `POST /api/sessions/{sessionId}/sequencer/start`
- `POST /api/sessions/{sessionId}/sequencer/stop`
- `GET /api/sessions/{sessionId}/sequencer/status`
- `POST /api/sessions/{sessionId}/sequencer/tracks/{trackId}/queue-pad`

## 7. Extensibility for Multi-Track and Polyphony
Backend config supports multiple tracks already:
- `tracks[]`
  - `track_id`
  - `midi_channel`
  - `velocity`
  - `gate_ratio`
  - `active_pad` / `queued_pad`
  - `pads[]`

Each step accepts:
- `null` (rest)
- single MIDI note (`int`)
- multiple notes (`int[]`) for polyphony/chords

Current frontend sends one track (`voice-1`), but backend model is multi-track ready.

## 8. Coexistence with Manual MIDI (Jam / Future Piano Roll)
The direct MIDI path remains unchanged:
- `POST /api/sessions/{sessionId}/midi-event`

This is intentionally kept so manual note entry and future piano-roll input can run alongside sequencer playback.
The piano-roll keys trigger note-on/note-off through this same endpoint while backend sequencers are running.

## 9. Patch Persistence
Sequencer UI config is saved in `graph.ui_layout.sequencer`, including:
- transport config (`bpm`, `midiChannel`, `stepCount`)
- theory config (`scaleRoot`, `scaleType`, `mode`)
- pad state (`activePad`, `queuedPad`, `pads`)
- piano roll config (`pianoRollMidiChannel`, `pianoRollScaleRoot`, `pianoRollScaleType`, `pianoRollMode`)
- compatibility `steps` field for active pad

## 10. Current Status
Implemented:
- backend-native sequencer clock/runtime
- sequencer API surface for config/start/stop/status/queue-pad
- frontend integration with backend transport
- 8-pad pattern storage and loop-boundary queued switching
- piano roll panel with independent channel/scale/mode and in-scale degree highlighting
- in-scale highlighting + degree labels
- preserved direct MIDI event endpoint for live/manual input
