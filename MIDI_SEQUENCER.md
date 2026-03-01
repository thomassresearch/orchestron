# MIDI Sequencer and Multitrack Arranger (Current Implementation)

## 1. Scope
The current sequencer system is a hybrid:

- Backend-timed note sequencing for melodic and drummer tracks (low-jitter clock and boundary-safe switching)
- Frontend-timed controller-sequencer automation (CC curves), synchronized to global transport state
- Shared performance UI on the `Sequencer` page, including the multitrack arranger

This document reflects the code in:

- `frontend/src/App.tsx`
- `frontend/src/components/SequencerPage.tsx`
- `frontend/src/components/MultitrackArranger.tsx`
- `frontend/src/lib/padLoopPattern.ts`
- `frontend/src/store/useAppStore.ts`
- `backend/app/services/sequencer_runtime.py`
- `backend/app/api/sessions.py`

## 2. Sequencer Page Architecture
The sequencing/performance page includes:

- Instrument rack and session transport controls (`Start Instruments`, `Stop Instruments`, `Start All`, `Stop All`)
- Global sequencer clock (`BPM`, `REWIND`, `FORWARD`, running/stopped badge)
- Melodic sequencer tracks
- Drummer sequencer tracks
- Controller sequencers
- Piano rolls (manual note input)
- Manual MIDI controllers (CC knob lanes)
- Multitrack arranger (cross-track pad-loop timeline editor)

The app still has three pages:

- `Instrument Design`
- `Sequencer`
- `Config`

## 3. Device Types and Limits
From store/runtime constraints:

- Melodic sequencer tracks: up to 8
- Drummer tracks: up to 8
- Controller sequencers: up to 8
- Piano rolls: up to 8
- Manual MIDI controller lanes: up to 6
- Pads per sequencer/drummer/controller track: 8 (`P1..P8`)

## 4. Global Transport Behavior

### 4.1 Session vs Sequencer Transport
- Instrument engine session and sequencer transport are separate.
- Sequencer transport requires a running instrument session.

### 4.2 Start/Stop Helpers
- `Start All`:
  - enables non-piano-roll devices (melodic/drummer/controller sequencers + manual MIDI controllers)
  - starts instruments if needed
  - enables piano rolls after engine start
- `Stop All`:
  - disables all performance devices
  - stops instruments if running

### 4.3 Auto Transport Start/Stop
When instruments are running:

- If any melodic/drummer/controller sequencer is enabled and transport is stopped, transport auto-starts.
- If no melodic/drummer/controller sequencer remains enabled (or queued to remain enabled), transport auto-stops.

### 4.4 Runtime Status Sync
While transport is running, frontend polls backend sequencer status every `80ms`:

- `/api/sessions/{sessionId}/sequencer/status`
- updates `isPlaying`, `playhead`, `cycle`, track runtime states

Footer status currently shows:

- `playhead`
- `cycle`
- active MIDI input name

## 5. Track Types

### 5.1 Melodic Sequencer Tracks
Each track has:

- MIDI channel (`1..16`)
- scale root/type + mode
- per-track sync target (`syncToTrackId`)
- step count options `4 | 8 | 16 | 32`
- step editor with note/chord/hold/velocity
- pad loop controls
- queued pad switching and queued enable/disable at loop boundaries

Backend step data supports:

- rest (`null`)
- single note (`int`)
- chord (`int[]`)

### 5.2 Drummer Sequencer Tracks
Each drummer track has:

- MIDI channel (`1..16`)
- step count `4 | 8 | 16 | 32`
- multiple drum rows (each row has MIDI note key)
- per-cell active + velocity
- pad loop controls

At backend config time, each drummer row is mapped to an internal runtime track:

- `drumrow:{drummerTrackId}:{rowId}`

Pad queue operations for drummer tracks fan out to all row runtime tracks.

### 5.3 Controller Sequencers
Controller sequencers are not executed by backend sequencer runtime.
They run in frontend and send MIDI CC messages via `/midi-event`:

- curve step count `8 | 16 | 32 | 64`
- per-pad curve keypoints
- pad loop controls and pad queue behavior
- runtime phase (`runtimePadStartStep`) tracked in frontend state

Sampling/sending behavior:

- internal sampling resolution: `8` samples per transport step
- CC is sent only when sampled value changes

UI playback indicator behavior:

- Curve playhead visualization is updated at most once per transport step
- CC send cadence is unchanged (still high-resolution internal sampling)

### 5.4 Piano Rolls and Manual MIDI Controllers
- Piano roll note input uses direct MIDI events (`note_on` / `note_off`) while session is running.
- Keyboard range in code is `C0..B7` (96 notes).
- Manual MIDI controller lanes send `control_change` messages to all active performance channels.

## 6. Multitrack Arranger (New Timeline Editor)
The multitrack arranger appears when there is at least one melodic/drummer/controller sequencer.

Core behavior:

- One row per sequencer/drummer/controller track
- Shared horizontal timeline on a 4-step grid
- Zoom and horizontal scroll
- Cross-row visual playhead (orange vertical bar) during playback

Token types:

- pad token (`1..8`)
- pause token (`P4`, `P8`, `P16`, `P32`)
- group token (`A`, `B`, `C`, ...)
- super-group token (`I`, `II`, `III`, ...)

Editing workflow:

- Root timeline: compact timeline view, drag handles for block moves
- Nested editors: open a group/super-group for detailed token editing
- Context menu actions: `Group`, `Super-group`, `Ungroup`, `Remove`
- Selection: single or additive (Ctrl/Cmd/Shift)
- Keyboard: `1..8` append pad token, `Delete/Backspace` remove selection
- Drag/drop reorder inside nested editors

Playhead visualization details:

- Quantized to 4-step grid for arranger display
- Computed from global transport (`cycle`, `stepCount`, `playhead`)
- Anchored per playback run so restart (`START ALL` -> new run) remains visible instead of rendering off-screen

## 7. Pad Loop Pattern Model
Pad-loop authoring is stored as structured pattern state:

```ts
type PadLoopPatternState = {
  rootSequence: PadLoopPatternItem[];
  groups: { id: string; sequence: PadLoopPatternItem[] }[];
  superGroups: { id: string; sequence: PadLoopPatternItem[] }[];
};
```

Hierarchy rules (enforced in `padLoopPattern.ts`):

- Group containers: pads + pauses only
- Super-group containers: pads + pauses + groups
- Root containers: pads + pauses + groups + super-groups
- Invalid references and unreachable group definitions are sanitized away

Compilation:

- Pattern is flattened to `padLoopSequence: number[]` (max 256 tokens)
- Pad tokens: `0..7`
- Pause tokens: `-4`, `-8`, `-16`, `-32`
- Flattened sequence is what backend note runtime consumes

This means:

- Groups/super-groups are a frontend authoring abstraction
- Backend runtime sees only the compiled token stream

## 8. Frontend State Model (Current)
Top-level sequencer state:

```ts
interface SequencerState {
  isPlaying: boolean;
  bpm: number;
  stepCount: 16 | 32;
  playhead: number;
  cycle: number;
  tracks: SequencerTrackState[];
  drummerTracks: DrummerSequencerTrackState[];
  controllerSequencers: ControllerSequencerState[];
  pianoRolls: PianoRollState[];
  midiControllers: MidiControllerState[];
}
```

Runtime-only fields are present on device states (for example `queuedPad`, `padLoopPosition`, `runtimeLocalStep`, `runtimePadStartStep`) and are cleared for persistence snapshots.

## 9. Backend Sequencer Runtime (Notes/Drums)
Per session, backend creates a dedicated runtime thread with:

- monotonic scheduling (`time.perf_counter`)
- 16th-note tick duration: `60 / bpm / 4`
- note-on batch sending for chord tones
- deterministic note-off behavior and panic-safe release
- queued enable/disable and pad switch on local boundaries
- pad-loop sequencing with pause tokens and optional non-repeat stop-on-loop-end
- optional track sync-to-master boundary alignment (`sync_to_track_id`)

Status payload includes:

- global `current_step`, `cycle`, `step_count`
- per-runtime-track `local_step`, `active_pad`, `queued_pad`, `pad_loop_position`, `queued_enabled`, `active_notes`

## 10. Sequencer API Surface
Current endpoints:

- `PUT /api/sessions/{sessionId}/sequencer/config`
- `POST /api/sessions/{sessionId}/sequencer/start`
- `POST /api/sessions/{sessionId}/sequencer/stop`
- `GET /api/sessions/{sessionId}/sequencer/status`
- `POST /api/sessions/{sessionId}/sequencer/rewind`
- `POST /api/sessions/{sessionId}/sequencer/forward`
- `POST /api/sessions/{sessionId}/sequencer/tracks/{trackId}/queue-pad`

Direct MIDI endpoint (manual notes + CC + controller sequencer output):

- `POST /api/sessions/{sessionId}/midi-event`

## 11. Snapshot/Persistence Format
Sequencer/performance config snapshot version is currently `4`.

Snapshot includes:

- instrument assignments
- melodic/drummer/controller sequencers
- piano rolls
- manual MIDI controllers
- pad loop pattern data (and compatibility with legacy sequence fields)

When persisting app state, runtime playback fields are normalized/reset:

- `isPlaying: false`
- `playhead: 0`
- `cycle: 0`
- runtime queue/position fields cleared

## 12. Summary
Current implementation is fully multitrack in both runtime and UI authoring:

- backend-native note/drum transport
- frontend controller-sequencer automation synced to transport
- structured pad-loop model with nested groups/super-groups
- multitrack arranger for cross-track pattern timeline editing

This is the current baseline for sequencer behavior and future extension work.
