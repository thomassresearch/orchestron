# Orchestron CLI Performance Creation Plan

**Status:** implementation plan

This document describes the proposed command-line tooling for creating, editing, importing, and performing Orchestron performances through the running FastAPI backend. The goal is to make performance creation usable by humans and by Codex skills/agents while keeping the saved performance format compatible with the existing GUI.

## Goals

- Provide CLI utilities for creating and editing Orchestron performances through the running backend only.
- Support live Orchestron runtime sessions where possible.
- Keep performance JSON compatible with the current frontend snapshot model.
- Support patch bundle import from `.orch.instrument.json`, `.orch.instrument.zip`, `.orch.json`, and `.orch.zip`.
- Match GUI import conflict behavior: overwrite, skip, or rename.
- Support simple edits with CLI flags and complex multitrack composition with YAML/JSON score specs.
- Generate musically meaningful multitrack material using keys, modes, scales, chord progressions, rhythm templates, drum grooves, controller curves, and arpeggiator settings.
- Emit detailed errors that tell an agent exactly how to retry.
- Provide detailed `-h` / `--help` output for every command.

## Non-Goals

- Direct SQLite editing.
- Replacing the GUI performance editor.
- Full arbitrary notation editing in the first version.
- General-purpose DAW sequencing.
- Lossless round-trip of arbitrary MIDI voicings through the current GUI chord selector model.

## Current System Constraints

### Persisted Performances

Performances are currently persisted as generic bounded JSON through:

- `backend/app/models/performance.py`
- `backend/app/services/performance_service.py`
- `backend/app/api/performances.py`

The backend stores and validates size limits, but it does not yet own a typed performance config schema.

### Frontend Performance Snapshot

The rich persisted performance shape currently lives in `frontend/src/types/index.ts` as `SequencerConfigSnapshot`. It includes:

- version
- instrument assignments
- embedded patch definitions
- global sequencer timing
- melodic sequencer tracks
- drummer sequencer tracks
- controller sequencers
- arpeggiators
- arpeggiator presets
- piano rolls
- MIDI controllers
- arranger loop selection
- pad-loop patterns

### Runtime Session DTOs

The live runtime uses typed backend DTOs in `backend/app/models/session.py`, including:

- `SessionSequencerConfigRequest`
- `SessionSequencerTrackConfig`
- `SessionControllerSequencerTrackConfig`
- `SessionArpeggiatorConfig`
- `SessionMidiEventRequest`

The runtime DTO differs from the persisted frontend snapshot. For example:

- persisted melodic steps store `note`, `chord`, `hold`, `velocity`
- runtime sequencer steps use MIDI notes or MIDI note arrays
- persisted drummer tracks are row-based
- runtime drummer rows are flattened into note tracks
- persisted pad-loop patterns can contain groups and super-groups
- runtime pad-loop sequences are compiled token arrays

### Frontend Runtime Adapter

The current conversion logic lives primarily in:

- `frontend/src/App.tsx`
- `frontend/src/lib/sequencer.ts`
- `frontend/src/lib/padLoopPattern.ts`

The backend/CLI implementation should port or share equivalent logic so saved performance state, CLI edits, GUI rendering, and runtime playback stay aligned.

## Recommended Dependencies

### CLI Framework

Use `typer` for the command-line interface.

Reasons:

- command groups fit the required CLI structure
- command and option help can be written close to command code
- supports rich help panels and command suggestions
- built on Click, which is already present transitively in the lockfile

References:

- [Typer command help](https://typer.tiangolo.com/tutorial/commands/help/)
- [Typer subcommands](https://typer.tiangolo.com/tutorial/subcommands/)

Important implementation detail:

- Configure context settings so both `-h` and `--help` work.

### Score Spec Parsing

Use `PyYAML` for YAML score specs.

Reasons:

- already present in `uv.lock`
- easier for agents and humans to author than JSON
- `yaml.safe_load` is appropriate for untrusted score specs

Reference:

- [PyYAML documentation](https://pyyaml.org/wiki/PyYAMLDocumentation)

### Composition and Harmonic Material

Use `music21` for Roman numerals, chord generation, and harmonic parsing.

Reasons:

- direct Roman numeral support
- current PyPI metadata supports Python `>=3.11`, compatible with this repo's Python 3.13 target
- useful for converting higher-level chord progressions into concrete notes

References:

- [music21 PyPI](https://pypi.org/project/music21/)
- [music21 roman documentation](https://www.music21.org/music21docs/moduleReference/moduleRoman.html)
- [music21 Roman numeral guide](https://music21.org/music21docs/usersGuide/usersGuide_23_romanNumerals.html)

### MIDI Files

Continue using `mido`, already a project dependency.

Use cases:

- MIDI import prototypes
- MIDI export/debugging
- translating MIDI note names and events in tests

References:

- [Mido overview](https://mido.github.io/mido/)
- [Mido MIDI files](https://mido.github.io/mido/files/midi.html)

## Proposed Architecture

### Backend Modules

Add typed backend modules:

```text
backend/app/models/performance_config.py
backend/app/models/performance_edit.py
backend/app/services/performance_config_normalizer.py
backend/app/services/performance_runtime_adapter.py
backend/app/services/performance_editor_service.py
backend/app/api/performance_edit_sessions.py
```

#### `performance_config.py`

Own the typed persisted performance config shape.

Responsibilities:

- define Pydantic models for the persisted snapshot
- accept camelCase aliases matching the frontend JSON shape
- validate limits that are semantic, not only byte-size
- normalize defaults
- preserve GUI-compatible fields

Important: this model should not immediately reject older performance versions that the frontend currently accepts. It should have a normalization layer for versions `1..8`.

#### `performance_runtime_adapter.py`

Convert persisted performance state to runtime DTOs.

Responsibilities:

- resolve melodic step `note` + `chord` into MIDI note arrays
- flatten drummer sequencer rows into backend note tracks
- convert controller sequencers into `controller_tracks`
- compile pad-loop patterns into runtime pad-loop sequences
- build arpeggiator runtime config
- calculate transport step counts and playback ranges
- respect instrument levels when scaling velocities

This should match the behavior currently implemented in the frontend runtime adapter.

#### `performance_editor_service.py`

Provide pure editing operations over normalized performance snapshots.

Operations:

- create empty performance workspace
- copy existing performance
- add instrument assignment
- remove instrument assignment
- add melodic sequencer
- add drummer sequencer
- add controller sequencer
- add manual MIDI controller
- add arpeggiator
- set timing
- set arranger loop
- apply explicit step pattern
- apply score spec
- validate
- diff
- commit

This service should not know about Typer. It should be API-callable and testable.

### Backend API

Add edit-session endpoints:

```text
POST   /api/performance-edit-sessions
GET    /api/performance-edit-sessions/{edit_session_id}
PATCH  /api/performance-edit-sessions/{edit_session_id}
POST   /api/performance-edit-sessions/{edit_session_id}/apply-score
POST   /api/performance-edit-sessions/{edit_session_id}/validate
POST   /api/performance-edit-sessions/{edit_session_id}/commit
POST   /api/performance-edit-sessions/{edit_session_id}/abort
```

Add optional live runtime attachment:

```text
POST /api/performance-edit-sessions/{edit_session_id}/attach-session/{session_id}
PUT  /api/performance-edit-sessions/{edit_session_id}/runtime-config
POST /api/performance-edit-sessions/{edit_session_id}/runtime-start
POST /api/performance-edit-sessions/{edit_session_id}/runtime-stop
POST /api/performance-edit-sessions/{edit_session_id}/midi-event
```

Add active performance metadata to session creation:

```json
{
  "performance_id": "optional-performance-id",
  "instruments": [
    {
      "patch_id": "patch-id",
      "midi_channel": 1
    }
  ]
}
```

The frontend should pass `performance_id` when starting an instrument session from a saved performance.

## Synchronization With Frontend

### Problem

The frontend currently owns the open performance workspace in Zustand state and periodically persists app state through `/api/app-state`. Runtime session WebSockets publish runtime events, but there is no general workspace-sync channel.

If the CLI edits a performance that is currently open in the frontend, the frontend will not automatically know unless we add a protocol.

### Preferred Long-Term Solution: Workspace Sync Channel

Add a backend workspace event bus and frontend subscriber.

Possible endpoint:

```text
GET /api/performance-workspace/events
```

or:

```text
WS /ws/performance-workspace
```

Events:

```json
{
  "type": "performance_edit_started",
  "performance_id": "uuid",
  "edit_session_id": "uuid",
  "owner": "cli",
  "revision": 12
}
```

```json
{
  "type": "performance_snapshot_changed",
  "performance_id": "uuid",
  "edit_session_id": "uuid",
  "revision": 13,
  "source": "cli",
  "summary": "added melodic sequencer voice-2"
}
```

```json
{
  "type": "performance_committed",
  "performance_id": "uuid",
  "edit_session_id": "uuid",
  "revision": 14
}
```

Frontend behavior:

- If the affected performance is not open, refresh the performance list only.
- If the affected performance is open and local state is clean, fetch and apply the latest snapshot.
- If the affected performance is open and local state is dirty, show a conflict banner.
- If the CLI owns a lock, disable conflicting GUI edits and show lock owner/details.

### MVP Solution: Locking

If frontend sync is not implemented in the first version, use locks.

Rules:

- Only one edit owner can edit a performance at a time.
- The frontend obtains an edit lock when a saved performance is loaded into the Perform page.
- The CLI obtains an edit lock when `edit begin` starts.
- A lock includes owner type, owner label, creation time, expiry, heartbeat, and optional session ID.
- CLI commit requires the lock and expected revision.
- Lock conflicts return `423 Locked`.

Example lock error:

```json
{
  "error": {
    "code": "performance_locked",
    "message": "Performance is currently open in the frontend.",
    "performance_id": "abc",
    "lock_owner": "frontend",
    "lock_id": "lock-123",
    "retry": [
      "Close or unload the performance in the frontend.",
      "Run `orchestron edit begin --performance abc --force-lock` if you intentionally want to take over."
    ]
  }
}
```

## CLI Command Design

Executable:

```text
orchestron
```

Global options:

```text
--api-url URL              Backend API base URL. Default: http://localhost:8000/api
--json                     Emit machine-readable JSON.
--debug                    Include backend request/response details on errors.
--timeout SECONDS          Request timeout.
-h, --help                 Show detailed help.
```

### Patch Commands

```text
orchestron patches list
orchestron patches get PATCH_ID
orchestron patches import FILE
```

Import options:

```text
--on-conflict prompt|overwrite|skip|rename|fail
--rename-template "{name} (CLI copy)"
--include-performance / --no-include-performance
--include-patches / --no-include-patches
```

Conflict behavior:

- `prompt`: interactive overwrite/skip/rename, matching GUI behavior
- `overwrite`: update existing patches with matching normalized names
- `skip`: skip conflicting patches
- `rename`: create new patches with unique names
- `fail`: exit with retry instructions

Agent/non-TTY default:

- use `fail`, unless `--on-conflict` is explicitly supplied

### Performance Commands

```text
orchestron performances list
orchestron performances get PERFORMANCE_ID
orchestron performances copy SOURCE_PERFORMANCE_ID --name NAME
orchestron performances import FILE
orchestron performances export PERFORMANCE_ID --output FILE
```

Copy behavior:

- duplicate performance config
- generate new performance ID via backend
- preserve embedded patch definitions unless explicitly removed
- optionally set new name/description

### Edit Session Commands

```text
orchestron edit begin --performance PERFORMANCE_ID
orchestron edit begin --new --name NAME
orchestron edit status
orchestron edit validate
orchestron edit diff
orchestron edit commit
orchestron edit abort
```

Options:

```text
--attach-live SESSION_ID
--lock-timeout SECONDS
--force-lock
--session-file PATH
```

The CLI should store the active edit session ID in a local session file, for example:

```text
.orchestron/edit-session.json
```

That file should contain only connection/edit metadata, not the authoritative performance snapshot.

### Instrument Commands

```text
orchestron edit add-instrument --patch PATCH_ID --channel 1 --level 10
orchestron edit remove-instrument --channel 1
orchestron edit set-instrument-level --channel 1 --level 7
```

Patch references should accept:

- patch ID
- exact patch name
- unambiguous normalized patch name

Ambiguous names should fail with candidate IDs and retry instructions.

### Melodic Sequencer Commands

Simple:

```text
orchestron edit add-melodic --channel 2 --name Bass --key C --mode dorian
```

Explicit steps:

```text
orchestron edit add-melodic \
  --channel 2 \
  --length-beats 4 \
  --steps "s0=C3:min7/4s s4=F3:dom7/4s s8=Bb2:maj7/4s s12=G2:dom7/4s"
```

Grid pattern:

```text
orchestron edit add-melodic \
  --channel 2 \
  --grid-pattern "C3:min7 _ _ _ F3:dom7 _ _ _ Bb2:maj7 _ _ _ G2:dom7 _ _ _"
```

Token semantics:

- `s0=` means assign at absolute step 0
- `C3:min7` means root note C3 with Orchestron chord type `min7`
- `/4s` means duration of 4 sequencer steps
- `.` means rest
- `_` means hold previous event

Supported persisted chord labels:

```text
none
maj
min
dim
aug
sus2
sus4
maj7
min7
dom7
m7b5
dim7
minmaj7
```

Accepted aliases should normalize to persisted labels:

```text
Cmaj7  -> root C, chord maj7
Cm7    -> root C, chord min7
Cmin7  -> root C, chord min7
C7     -> root C, chord dom7
C half-dim7 -> root C, chord m7b5, if half-diminished aliases are allowed later
```

Use ASCII aliases in CLI help by default.

Persisted step output:

```json
{
  "note": 48,
  "chord": "min7",
  "hold": false,
  "velocity": 96
}
```

Continuation steps:

```json
{
  "note": null,
  "chord": "none",
  "hold": true,
  "velocity": 96
}
```

Runtime conversion:

- The persisted root/chord form must be expanded into MIDI note arrays before runtime configuration.
- The GUI should still show the root note and chord selector state after CLI edits.

### Drummer Sequencer Commands

```text
orchestron edit add-drummer --channel 10 --groove backbeat
orchestron edit add-drummer --channel 10 --grid-pattern "kick . snare . kick kick snare ."
```

General MIDI drum defaults:

```text
kick: 36
snare: 38
clap: 39
closed_hat: 42
open_hat: 46
low_tom: 45
mid_tom: 47
high_tom: 50
ride: 51
crash: 49
```

MVP grooves:

- four_on_floor
- backbeat
- half_time
- breakbeat
- electro
- sparse

Velocity templates:

- steady
- accented_downbeat
- human_light
- human_medium

### Controller Commands

Manual MIDI controller lanes:

```text
orchestron edit add-midi-controller --cc 74 --name Filter --value 32
```

Controller sequencer:

```text
orchestron edit add-controller-sequencer \
  --cc 74 \
  --length-beats 8 \
  --curve "0:24,0.5:96,1:48"
```

Curve presets:

- flat
- ramp_up
- ramp_down
- triangle
- sine
- pulse
- slow_sweep
- adsr

Controller curve syntax:

```text
position:value
```

Where:

- position is normalized `0.0..1.0`
- value is MIDI CC `0..127`

### Arpeggiator Commands

```text
orchestron edit add-arpeggiator \
  --input-channel 3 \
  --target-channel 2 \
  --pattern up \
  --rate 1/16 \
  --octaves 2 \
  --latch
```

Supported patterns:

```text
up
down
up_down
down_up
as_played
random
chord
inside_out
outside_in
```

## Score Spec Design

Use score specs for multitrack or harmonically generated material.

Supported file formats:

- YAML
- JSON

Top-level example:

```yaml
version: 1
title: modal sketch
tempo: 124
key: C
mode: dorian
meter: 4/4
grid: 4
structure:
  - id: A
    bars: 8
    progression: [i7, IV7, v7, bVII]
tracks:
  - type: melodic
    role: bass
    channel: 2
    rhythm: eighth_ostinato
  - type: melodic
    role: chords
    channel: 3
    voicing: close
  - type: drummer
    channel: 10
    groove: backbeat
  - type: controller
    cc: 74
    curve: slow_sweep
```

### Explicit Event Spec

```yaml
tracks:
  - type: melodic
    id: chords
    channel: 2
    length_beats: 4
    pad: 0
    events:
      - at_step: 0
        root: C3
        chord: min7
        duration_steps: 4
        velocity: 96
      - at_step: 4
        root: F3
        chord: dom7
        duration_steps: 4
      - at_step: 8
        root: Bb2
        chord: maj7
        duration_steps: 4
      - at_step: 12
        root: G2
        chord: dom7
        duration_steps: 4
```

### Roman Numeral Spec

```yaml
key: C
mode: dorian
tracks:
  - type: melodic
    id: harmony
    channel: 3
    length_beats: 4
    progression:
      - at_step: 0
        roman: i7
        duration_steps: 4
      - at_step: 4
        roman: IV7
        duration_steps: 4
      - at_step: 8
        roman: bVIImaj7
        duration_steps: 4
      - at_step: 12
        roman: v7
        duration_steps: 4
```

Implementation notes:

- Use `music21` to parse Roman numerals where possible.
- Normalize resulting chord qualities into Orchestron chord labels when representable.
- If not representable, either reject with retry guidance or use an advanced raw note-array mode.

### Advanced Voicing Mode

The current GUI chord selector cannot represent arbitrary chord voicings as named chord labels. Therefore, raw voicings should be opt-in.

Example:

```yaml
tracks:
  - type: melodic
    channel: 3
    allow_raw_voicings: true
    events:
      - at_step: 0
        voicing_notes: [48, 55, 63, 70]
        duration_steps: 4
```

Behavior:

- Persist as note arrays only if the persisted model is extended to support them.
- Otherwise reject with a message explaining that the current GUI-compatible model supports root-plus-chord labels only.

MVP recommendation:

- reject raw voicings
- keep GUI round-trip clean

## Runtime Integration

The CLI should be able to interact with live Orchestron sessions.

Runtime operations:

- attach edit session to live runtime session
- push updated sequencer config
- configure arpeggiators
- start/stop sequencer transport
- queue pads
- send manual MIDI events
- panic/all-notes-off

Existing endpoints already cover much of this:

```text
PUT  /api/sessions/{session_id}/sequencer/config
PUT  /api/sessions/{session_id}/arpeggiators/config
POST /api/sessions/{session_id}/sequencer/start
POST /api/sessions/{session_id}/sequencer/stop
POST /api/sessions/{session_id}/sequencer/tracks/{track_id}/queue-pad
POST /api/sessions/{session_id}/midi-event
POST /api/sessions/{session_id}/panic
```

The missing piece is mapping performance edit sessions to frontend-open runtime sessions.

## Error Contract

Every CLI error should be actionable for an agent.

Human mode:

```text
Error: performance is locked by frontend

Performance: Demo Performance (abc)
Lock owner: frontend
Lock age: 12s

Retry:
  1. Close or unload the performance in the frontend.
  2. Run `orchestron edit begin --performance abc --force-lock` to take over.
  3. Run `orchestron performances copy abc --name "Demo Performance CLI Copy"` to work on a copy.
```

JSON mode:

```json
{
  "ok": false,
  "error": {
    "code": "performance_locked",
    "message": "Performance is locked by frontend.",
    "operation": "edit.begin",
    "api_url": "http://localhost:8000/api",
    "performance_id": "abc",
    "retry": [
      {
        "command": "orchestron edit begin --performance abc --force-lock",
        "description": "Take over the lock if this is intentional."
      },
      {
        "command": "orchestron performances copy abc --name \"Demo Performance CLI Copy\"",
        "description": "Work on a copy without disturbing the open frontend."
      }
    ]
  }
}
```

Validation errors should include JSON paths:

```json
{
  "code": "invalid_step_pattern",
  "path": "tracks[0].pads[0].steps[12]",
  "message": "Unsupported chord label 'major9'.",
  "retry": [
    "Use one of: none, maj, min, dim, aug, sus2, sus4, maj7, min7, dom7, m7b5, dim7, minmaj7.",
    "Use a score spec with a representable Roman numeral chord.",
    "Use --explain-chords to print supported chord syntax."
  ]
}
```

Backend API errors should be preserved under `--debug`:

```json
{
  "backend": {
    "status": 422,
    "body": "... raw response body ..."
  }
}
```

## Help Output Requirements

Every command must include:

- short description
- examples
- required arguments
- option descriptions
- accepted enum values
- default backend URL behavior
- JSON output behavior
- common retry advice

Example:

```text
orchestron edit add-melodic --help

Usage:
  orchestron edit add-melodic [OPTIONS]

Examples:
  orchestron edit add-melodic --channel 2 --grid-pattern "C3:min7 _ _ _ F3:dom7 _ _ _"
  orchestron edit add-melodic --channel 3 --steps "s0=C4:maj7/8s s8=G3:dom7/8s"

Chord labels:
  none, maj, min, dim, aug, sus2, sus4, maj7, min7, dom7, m7b5, dim7, minmaj7

Step tokens:
  .      rest
  _      hold previous note/chord
  C3:min root note and chord
```

## Testing Plan

### Backend Unit Tests

Add focused tests for:

- performance config normalization
- chord label validation
- explicit step pattern parsing
- grid pattern parsing
- Roman numeral progression conversion
- drummer groove generation
- controller curve parsing
- pad-loop pattern compilation
- runtime DTO conversion
- lock acquisition and conflict handling
- commit revision checks

### API Tests

Add regression tests in `backend/tests/test_api.py` or dedicated service tests for:

- create edit session from existing performance
- create edit session for new performance
- commit creates/updates performance
- lock returns `423`
- stale revision returns `409`
- invalid score spec returns detailed `422`
- live runtime attach validates session existence
- patch bundle import conflict resolution

### CLI Tests

Use Typer's test runner or subprocess tests for:

- each command's `--help`
- `-h` alias
- `--json` output shape
- conflict retry messages
- non-TTY conflict failure
- YAML score application
- command parsing for melodic chord patterns

### Frontend Tests

When workspace sync is added:

- frontend receives performance workspace events
- clean open performance auto-refreshes
- dirty open performance shows conflict/lock state
- lock banner disables conflicting edits

## Documentation Plan

When implementation starts:

- Update `README.md` with CLI overview.
- Add user docs for CLI performance creation.
- Add score spec examples under `examples/performances/`.
- Add a future Codex skill once the CLI is stable.
- Ask the user for new screenshots if frontend lock/sync UI changes are made.

## Future Codex Skill

Create a skill after the CLI stabilizes.

Skill contents:

```text
orchestron-performance-creator/
  SKILL.md
  references/
    score_spec.md
    chord_syntax.md
    examples.md
  scripts/
    validate_score_spec.py
```

Skill behavior:

- prefer score specs for multitrack work
- use CLI flags for simple edits
- always run `orchestron edit validate` before commit
- use `--json` for agent-readable output
- retry based on structured error hints
- commit only after validation succeeds

## Implementation Phases

### Phase 1: Typed Config and Runtime Adapter

- Add backend persisted performance config models.
- Port frontend normalization where needed.
- Add runtime adapter parity tests.
- Preserve existing performance CRUD behavior.

### Phase 2: CLI Scaffold

- Add Typer dependency.
- Add CLI entry point.
- Implement backend URL config.
- Implement `--json`, `--debug`, `-h`, `--help`.
- Implement patch/performance list/get.

### Phase 3: Import and Conflict Handling

- Implement bundle upload through existing expand endpoint.
- Port GUI conflict rules.
- Add interactive and non-interactive modes.
- Ensure embedded patch definitions are preserved.

### Phase 4: Edit Sessions With Locking

- Add edit-session API.
- Add locks, revisions, commit, abort.
- Implement add instrument, melodic, drummer, controller, arpeggiator commands.
- Add validation and diff commands.

### Phase 5: Score Specs

- Add YAML/JSON parser.
- Add explicit event spec.
- Add chord step syntax.
- Add initial drum grooves and controller curves.
- Add `music21` Roman numeral integration.

### Phase 6: Live Runtime Attachment

- Add performance/session association.
- Attach CLI edit sessions to live runtime sessions.
- Push runtime sequencer/arpeggiator configs.
- Support start/stop/queue-pad/manual MIDI.

### Phase 7: Frontend Synchronization

- Add workspace sync channel or polling fallback.
- Add frontend lock/conflict UI.
- Auto-apply clean external updates.
- Protect dirty local work.

### Phase 8: Skill Packaging

- Create the Codex skill.
- Include concise instructions and references.
- Validate agent workflow end to end.

## Open Implementation Decisions

- Whether workspace sync uses SSE or WebSocket.
- Whether locks are stored in memory only or persisted.
- Exact edit-session expiry and heartbeat timings.
- Whether raw arbitrary voicings should be supported before the GUI model can display them cleanly.
- Whether score-spec generated material should default to creating new tracks or updating existing named tracks.
- Whether CLI command names should be a single `orchestron` executable or multiple narrower utilities.
