# Orchestron Architecture

## 1. Purpose

Orchestron is a two-tier application for designing Csound instruments visually and performing them live through a browser-clock audio runtime.

Primary outcomes:

- visual patching for Csound instruments
- deterministic graph compilation into `.orc` / `.csd`
- render-driven live playback with timestamped MIDI ingress
- the same execution model on macOS, Linux, Windows, and Docker

## 2. Core Runtime Model

The current runtime has four important rules:

1. `browser_clock` is the only realtime execution path.
2. The browser owns audible playback timing through `AudioContext` and `AudioWorklet`.
3. The backend render path owns engine time and is the only place where MIDI enters Csound.
4. Internal app MIDI and external host MIDI both converge into one engine-local timestamped scheduler.

Compatibility note:

- `local` is still accepted on the wire and in environment variables, but it is normalized to `browser_clock` at startup.

## 3. Technology Stack

### Frontend

- TypeScript
- React
- Tailwind CSS
- Rete.js for graph editing
- browser WebSocket controller for render requests, sequencer control, and timing telemetry

### Backend

- Python 3.13
- FastAPI
- Pydantic v2
- SQLAlchemy / SQLite persistence
- `ctcsound`

### Native MIDI Bridge

- Rust
- Tokio
- `tokio-tungstenite`
- `midir`

The Rust helper is optional. The app still works without it.

## 4. High-Level Architecture

```mermaid
flowchart LR
    A["Frontend (React + Rete.js)"] -->|REST| B["FastAPI API"]
    A -->|WS /ws/sessions/{id}| C["Session Event Bus"]
    A -->|WS /ws/sessions/{id}/browser-clock| D["Browser-Clock Controller"]
    B --> E["Patch Service"]
    B --> F["Compiler Service"]
    B --> G["Session Service"]
    E --> H["SQLite"]
    F --> I["Compile Artifact (.orc/.csd)"]
    G --> J["CsoundWorker"]
    D --> J
    J --> K["EngineMidiScheduler"]
    K --> L["performKsmps() Render Path"]
    L --> M["PCM Blocks"]
    M --> A
    N["Internal app MIDI producers"] --> K
    O["host-midi-helper (Rust)"] -->|WS /ws/host-midi| G
    P["External controllers / DAWs"] --> O
```

## 5. Timing and MIDI Architecture

### Browser audio

- The browser requests render chunks from the backend.
- Each request advances Csound block-by-block with `performKsmps()`.
- The browser queues returned PCM and owns the final playback clock.

### Internal MIDI

Internal producers include:

- melodic sequencers
- drummer sequencers
- controller sequencers
- piano roll keyboard
- manual controller gestures
- direct API MIDI events

These do not require any OS MIDI device. They are delivered through the session engine path and use the built-in `internal:loopback` input ref as a stable logical endpoint.

### External MIDI

External hardware or DAW MIDI arrives through the optional Rust helper:

- helper connects to `/ws/host-midi`
- helper publishes device inventory
- helper forwards inbound MIDI bytes with helper-local monotonic timestamps
- backend maps helper timestamps into backend monotonic time
- backend converts them into target engine sample positions
- render path injects them into Csound immediately before the relevant block

### Engine-local scheduler

`EngineMidiScheduler` is the convergence point for all MIDI sources.

Each queued event stores:

- source id
- raw MIDI bytes
- source timestamp
- mapped backend monotonic timestamp
- target engine sample
- `late` flag
- `sync_stale` flag

The scheduler is drained immediately before each `performKsmps()` block.

## 6. Logical Components

### Frontend

1. Patch editor
- node graph authoring
- opcode catalog and parameter editing

2. Performance UI
- instrument rack
- sequencers
- piano rolls
- controller panels

3. Browser-clock controller
- claims session controller ownership
- sends `timing_report`
- sends timestamped manual MIDI
- requests render chunks

### Backend

1. API layer
- patch, session, runtime, MIDI, and websocket endpoints

2. Patch service
- patch CRUD and persistence

3. Compiler service
- graph validation
- instrument code generation
- headless `.csd` generation with realtime MIDI options

4. Session service
- session lifecycle
- browser-clock controller ownership
- helper registration and clock mapping
- sequencer control

5. Csound worker
- starts Csound headless
- maintains render cursor
- owns engine MIDI scheduler
- injects host MIDI buffer per render block

6. MIDI service
- lists logical and backend MIDI inputs
- always exposes `internal:loopback`
- tracks helper-published host devices
- still supports backend-native device discovery for non-session diagnostics

7. Event bus
- session runtime event fan-out to frontend listeners

### Native host MIDI helper

1. Device inventory
- enumerate host MIDI inputs
- publish stable helper device ids

2. Clock sync
- send helper monotonic timestamps to backend

3. Event forwarding
- batch inbound MIDI events
- preserve timestamp quality metadata

## 7. Session Model

Each runtime session carries:

- compiled Csound artifact
- running state
- selected external MIDI input binding
- browser-clock controller lease
- optional render-driven sequencer

Important semantic detail:

- `midi_input` is an external-input binding only
- internal producers ignore it and always target the session engine queue

## 8. Compilation Model

The compiler generates a headless runtime CSD:

- `-d`
- `-n`
- `-M<device>`
- `-+rtmidi=<module>`
- configured `-b` / `-B`

That means session playback never depends on backend DAC output.

## 9. API Surface

### REST

- `GET /api/opcodes`
- `POST /api/patches`
- `POST /api/sessions`
- `POST /api/sessions/{sessionId}/compile`
- `POST /api/sessions/{sessionId}/start`
- `POST /api/sessions/{sessionId}/stop`
- `POST /api/sessions/{sessionId}/panic`
- `GET /api/midi/inputs`
- `PUT /api/sessions/{sessionId}/midi-input`

### WebSocket

- `WS /ws/sessions/{sessionId}`
  - runtime events
- `WS /ws/sessions/{sessionId}/browser-clock`
  - `claim_controller`
  - `request_render`
  - `manual_midi`
  - `timing_report`
  - sequencer control
- `WS /ws/host-midi`
  - `register_host`
  - `clock_sync`
  - `device_inventory`
  - `midi_events`

## 10. Deployment Topology

### Native development

- backend runs locally
- browser connects to backend directly
- helper, if used, also runs locally on the host OS

### Docker

- backend runs in a container
- browser still owns playback
- internal MIDI still works with no host MIDI devices
- helper runs on the Docker host, not in the container
- helper connects to the backend through the published backend port

## 11. Realtime Constraints

Important current constraints:

- MIDI timing is ultimately quantized by Csound `ksmps`
- the backend emits a runtime warning when `ksmps > 32`
- browser queue depth is the main live-latency tradeoff
- timestamped ingress reduces jitter, but does not remove the browser queue latency floor

## 12. Observability

The runtime exposes:

- `/api/health`
- `/api/health/realtime`
- session runtime events
- helper inventory connect/disconnect events through the MIDI input list and session event stream

## 13. Practical Summary

The current architecture is:

- browser-clock everywhere
- render-thread-owned engine timing
- one engine-local MIDI scheduler
- `internal:loopback` always available
- optional host MIDI bridge for external devices

That is the model the codebase now implements.
