# MIDI Sequencer Concept

## 1. Goal
Add a simple built-in step sequencer page so a user can quickly test and play instruments created in VisualCSound.

Required controls:
- MIDI channel (1-16)
- Tempo in BPM
- Start/Stop button
- 16 or 32 steps
- MIDI note number per step (0-127, with rest support)

## 2. Context from Existing Architecture
From `ARCHITECTURE.md` and `DECISIONS.md`, the relevant constraints are:
- Current UI is a single instrument-design screen (catalog + graph editor + runtime panel).
- Runtime session lifecycle already exists (`compile`, `start`, `stop`, `panic`).
- MIDI routing model is session-bound MIDI input (`/api/midi/inputs`, `/api/sessions/{id}/midi-input`).
- Product scope avoids full DAW timeline features; this should stay a lightweight test sequencer.

## 3. Proposed UI Extension: Two Pages

### 3.1 Navigation Model
Add a top-level page switch in the main app shell:
- `Instrument design` (existing UI, unchanged in behavior)
- `Sequencer` (new page)

Recommended control:
- Segmented tab control directly under header so switching is one click and visually obvious.

### 3.2 Page Definitions
1. **Instrument design**
- Keep current layout and interactions exactly as-is.
- Keep toolbar actions (`Save`, `Compile`, `Start`, `Stop`, `Panic`) global and available from this page.

2. **Sequencer**
- New panel focused only on transport/pattern programming.
- Keep runtime status visible (session state + selected MIDI input name) for confidence.

## 4. Sequencer Page Functional Spec

## 4.1 Layout
- Top row: transport and core config.
- Main section: step grid (16 or 32 columns).
- Footer/status row: current step indicator and safety controls.

## 4.2 Controls
1. **Start/Stop**
- Single toggle button.
- Start behavior:
  - Ensure session exists.
  - Ensure session is running (auto-start runtime if needed).
  - Start sequencer clock.
- Stop behavior:
  - Stop sequencer clock.
  - Send note-off for any active note and an "all notes off" message for selected channel.

2. **BPM**
- Numeric input or knob (range: 30-300, default: 120).
- Applied live while running.

3. **MIDI Channel**
- Integer 1-16 (default: 1).
- MIDI status bytes use channel-1 internally.

4. **Step Count**
- Toggle `16` / `32`.
- Preserve existing values when switching:
  - 16 mode uses steps `[0..15]`.
  - 32 mode uses steps `[0..31]`.

5. **Per-Step Note**
- One note value per step (`0..127`).
- Empty value means rest.
- Optional step active toggle is useful, but not required if empty = rest.

## 4.3 Playback Behavior
- Resolution: 16th notes.
- Step duration formula:
  - `stepMs = 60000 / BPM / 4`
- For each step:
  - If note exists: send Note On at step start.
  - Send Note Off before next step (gate at 80% of step duration, minimum 10 ms).
- Playhead wraps at configured step length.

## 5. MIDI Transport Strategy (Recommended MVP)

## 5.1 Recommendation
Use **frontend clock + Web MIDI output** to the same macOS IAC bus that is bound as session MIDI input.

Why this is best for MVP:
- Minimal backend changes.
- Matches existing architecture pattern ("external MIDI source -> IAC -> CSound").
- Fast to implement and easy to reason about.

## 5.2 Flow
1. User binds session MIDI input (existing runtime control).
2. Sequencer Start requests Web MIDI access in browser.
3. Sequencer resolves an output port matching the selected/bound MIDI bus name.
4. Sequencer sends Note On/Off MIDI bytes on each step tick.
5. CSound session receives notes through existing MIDI input path.

## 5.3 Browser/Platform Notes
- Web MIDI is best-supported on Chromium-based browsers.
- If Web MIDI is unavailable, show actionable guidance:
  - "Web MIDI not available in this browser. Use Chrome/Edge or route from an external MIDI app."

## 6. State Model Changes (Frontend)
Add a sequencer domain to the store:

```ts
type AppPage = "instrument" | "sequencer";

interface SequencerStep {
  note: number | null; // null = rest
}

interface SequencerState {
  isPlaying: boolean;
  bpm: number; // 30..300
  midiChannel: number; // 1..16
  stepCount: 16 | 32;
  playhead: number; // 0-based
  steps: SequencerStep[]; // always length 32, stepCount decides active range
}
```

Notes:
- Keep `steps` length fixed at 32 to avoid array reallocation when toggling 16/32.
- Keep sequencer state patch-scoped so each instrument can have its own pattern.

## 7. Patch Persistence Proposal
Persist sequencer settings in patch UI metadata (`graph.ui_layout`) so pattern loads with patch.

Suggested shape:

```json
{
  "ui_layout": {
    "sequencer": {
      "bpm": 120,
      "midiChannel": 1,
      "stepCount": 16,
      "steps": [60, null, 67, null, "..."]
    }
  }
}
```

Rationale:
- No backend schema migration required for MVP.
- Fits existing architecture intent for UI-scoped layout metadata.

## 8. Backend Impact
MVP can ship with **no new backend endpoints** if Web MIDI path is used.

Optional hardening phase (later):
- Add backend note-trigger endpoint or internal sequencer service for tighter timing and non-Web-MIDI environments.
- Keep this out of first iteration to reduce complexity.

## 9. Implementation Plan (No Code Yet)
1. Add page switch UI and route rendering in `App.tsx`.
2. Extract current central layout into `InstrumentDesignPage` component (behavior unchanged).
3. Add `SequencerPage` component with transport/config + step grid.
4. Add sequencer store state/actions/timer lifecycle.
5. Add Web MIDI output binding and Note On/Off dispatch logic.
6. Persist sequencer config in `graph.ui_layout.sequencer` via existing patch save flow.
7. Add guards and user-facing errors for:
- session not running
- missing MIDI output match
- unavailable Web MIDI API
8. Add tests:
- unit tests for timing math and step traversal
- store tests for 16/32 switching and state persistence mapping
- manual E2E checklist with IAC bus.

## 10. Acceptance Criteria
1. User can switch between `Instrument design` and `Sequencer` without losing graph state.
2. Sequencer exposes MIDI channel, BPM, step count (16/32), and note per step.
3. Start/Stop works reliably and does not leave hanging notes.
4. Running session receives sequencer notes and audibly plays designed instruments.
5. Sequencer settings are restored when patch is saved and reloaded.

