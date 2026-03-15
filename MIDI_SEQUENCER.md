# MIDI Sequencer and Multitrack Arranger (Current Implementation)

## 1. Scope
The current sequencer system is split by interaction type:

- Backend-timed sequencing for melodic tracks, drummer tracks, and controller sequencers
- Frontend-timed direct MIDI for piano rolls and manual MIDI controller lanes
- Shared performance UI on the `Sequencer` page, including the multitrack arranger

This document reflects the code in:

- `frontend/src/App.tsx`
- `frontend/src/components/SequencerPage.tsx`
- `frontend/src/components/MultitrackArranger.tsx`
- `frontend/src/lib/padLoopPattern.ts`
- `frontend/src/store/useAppStore.ts`
- `backend/app/models/session.py`
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
- updates `isPlaying`, `playhead`, `cycle`, `transportSubunit`, and note/drum/controller runtime states

Footer status currently shows:

- `playhead`
- `cycle`
- active MIDI input name

## 5. Track Types

### 5.1 Melodic Sequencer Tracks
Each track has:

- MIDI channel (`1..16`)
- per-track timing (`meter`, `steps per beat`, `beat ratio`)
- scale root/type + mode
- per-track sync target (`syncToTrackId`)
- per-pad beat length (`1..8`) with derived step count from timing
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
- per-track timing (`meter`, `steps per beat`, `beat ratio`)
- per-pad beat length (`1..8`) with derived step count from timing
- multiple drum rows (each row has MIDI note key)
- per-cell active + velocity
- pad loop controls

At backend config time, each drummer row is mapped to an internal runtime track:

- `drumrow:{drummerTrackId}:{rowId}`

Pad queue operations for drummer tracks fan out to all row runtime tracks.

### 5.3 Controller Sequencers
Controller sequencers are executed by backend sequencer runtime as `controller_tracks`:

- per-track timing (`meter`, `steps per beat`, `beat ratio`)
- curve length in beats (`1..8`, plus `16`) with derived step count from timing
- per-pad curve keypoints
- pad loop controls and backend-queued pad switching
- runtime phase (`runtimePadStartSubunit`) tracked from backend status

Sampling/sending behavior:

- backend compiles pad keypoints into controller automation events
- backend sequencer thread emits CC through `MidiService`
- CC is sent only when the scheduled value changes

UI playback indicator behavior:

- Curve playhead visualization is derived from backend transport plus backend controller runtime phase
- UI indication is presentation only; it does not own CC timing

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
- Per-sequencer beat-rate ratios are resolved in a finer hidden transport subdivision, so runtime polyrhythms stay exact even though the arranger display stays beat-grid aligned

Token types:

- pad token (`1..8`)
- pause token (`P1`, `P2`, `P4`, `P8`, `P16`)
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
- Pause tokens: `-1`, `-2`, `-4`, `-8`, `-16`
- Flattened sequence is what backend note and controller runtime consume

This means:

- Groups/super-groups are a frontend authoring abstraction
- Backend runtime sees only the compiled token stream

## 8. Frontend State Model (Current)
Top-level sequencer state:

```ts
interface SequencerState {
  isPlaying: boolean;
  timing: SequencerTimingConfig;
  stepCount: number;
  playhead: number;
  cycle: number;
  arrangerLoopSelection: ArrangerLoopSelection | null;
  tracks: SequencerTrackState[];
  drummerTracks: DrummerSequencerTrackState[];
  controllerSequencers: ControllerSequencerState[];
  pianoRolls: PianoRollState[];
  midiControllers: MidiControllerState[];
}
```

Runtime-only fields are present on device states (for example `queuedPad`, `padLoopPosition`, `runtimeLocalStep`, `runtimePadStartSubunit`) and are cleared for persistence snapshots.

## 9. Backend Sequencer Runtime (Notes/Drums/Controllers)
Per session, backend creates a dedicated runtime thread with:

- monotonic scheduling (`time.perf_counter`)
- transport-subunit scheduling instead of a fixed frontend clock
- note-on batch sending for chord tones
- controller CC event emission for `controller_tracks`
- deterministic note-off behavior and panic-safe release
- queued enable/disable for note/drum tracks and queued pad switch on local boundaries
- pad-loop sequencing with pause tokens `1 | 2 | 4 | 8 | 16` beats and optional non-repeat stop-on-loop-end
- optional melodic track sync-to-master boundary alignment (`sync_to_track_id`)

Status payload includes:

- global `current_step`, `cycle`, `step_count`, `transport_subunit`
- per-runtime-track `local_step`, `active_pad`, `queued_pad`, `pad_loop_position`, `queued_enabled`, `active_notes`
- per-controller-track `active_pad`, `queued_pad`, `pad_loop_position`, `enabled`, `runtime_pad_start_subunit`, `last_value`

## 10. Sequencer API Surface
Current endpoints:

- `PUT /api/sessions/{sessionId}/sequencer/config`
- `POST /api/sessions/{sessionId}/sequencer/start`
- `POST /api/sessions/{sessionId}/sequencer/stop`
- `GET /api/sessions/{sessionId}/sequencer/status`
- `POST /api/sessions/{sessionId}/sequencer/rewind`
- `POST /api/sessions/{sessionId}/sequencer/forward`
- `POST /api/sessions/{sessionId}/sequencer/tracks/{trackId}/queue-pad`

Notes:

- Sequencer config/start/status payloads now include `controller_tracks`
- `queue-pad` accepts `pad_index: null` to clear a queued pad

Direct MIDI endpoint (manual notes + manual CC):

- `POST /api/sessions/{sessionId}/midi-event`

## 11. Snapshot/Persistence Format
Sequencer/performance config snapshot version is currently `7`.

Snapshot includes:

- instrument assignments
- melodic/drummer/controller sequencers
- per-sequencer meter, grid, and beat-rate ratio timing
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

- backend-native note/drum/controller transport
- frontend direct MIDI for piano rolls and manual controller lanes
- structured pad-loop model with nested groups/super-groups
- multitrack arranger for cross-track pattern timeline editing

This is the current baseline for sequencer behavior and future extension work.
