# VisualCSound FastAPI Backend

This document describes the FastAPI backend in `backend/app`, how it is wired together, and what every public endpoint does.

## Overview

The backend is responsible for four distinct jobs:

1. Serving the FastAPI API used by the frontend.
2. Persisting patches, performances, and application state in SQLite.
3. Compiling patch graphs into Csound orchestra/CSD text.
4. Managing realtime session state, MIDI routing, and browser-clock PCM audio.

At a high level, the code is organized like this:

| Path | Responsibility |
| --- | --- |
| `backend/app/main.py` | App creation, lifespan, router registration, `/api/health`, static/frontend mounting, CLI entrypoint. |
| `backend/app/api/` | FastAPI routers. Each file owns one API area. |
| `backend/app/core/` | Configuration, logging, dependency container. |
| `backend/app/models/` | Pydantic request/response and domain models. |
| `backend/app/services/` | Business logic for opcodes, persistence-backed resources, sessions, MIDI, compilation, assets, and sequencer runtime. |
| `backend/app/engine/` | Csound worker, session runtime object, browser-clock PCM helpers. |
| `backend/app/storage/` | SQLAlchemy database setup and repositories. |

## Application Lifecycle

### App creation

`create_app()` in `backend/app/main.py` builds the FastAPI app and applies:

- `CORSMiddleware` with origins from `VISUALCSOUND_CORS_ORIGINS` or the defaults `http://localhost:5173` and `http://127.0.0.1:5173`.
- A static mount at `/static` backed by `backend/app/static`.
- A frontend mount at `/client` backed by `frontend/dist` when the frontend has been built.
- A fallback `GET /client` handler that returns `503` with build instructions if `frontend/dist` does not exist.

The REST API routers are mounted under `settings.api_prefix`, which defaults to `/api`. The WebSocket router is mounted without that prefix, so session events live under `/ws/...`.

### Lifespan

The `lifespan()` context manager:

- Loads settings via `get_settings()`.
- Configures logging.
- Ensures the static icon directory and GEN audio asset directory exist.
- Builds the dependency container and stores it on `app.state.container`.

### Dependency container

`AppContainer` is a plain dataclass that holds singleton-ish services for the running process:

- `Database`
- `PatchRepository`
- `AppStateRepository`
- `PerformanceRepository`
- `OpcodeService`
- `GenAssetService`
- `PatchService`
- `PerformanceService`
- `AppStateService`
- `CompilerService`
- `MidiService`
- `SessionEventBus`
- `SessionService`

FastAPI dependencies obtain it through `get_container()` from `backend/app/api/deps.py`.

## Configuration

Settings come from `backend/app/core/config.py` using `pydantic-settings` with the prefix `VISUALCSOUND_`.

The most important settings are:

| Setting | Default | Meaning |
| --- | --- | --- |
| `APP_NAME` | `Orchestron API` | FastAPI title. |
| `APP_VERSION` | `0.1.0` | FastAPI version string. |
| `DEBUG` | `false` | Enables debug logging. |
| `API_PREFIX` | `/api` | Prefix for REST routers. |
| `DATABASE_URL` | `sqlite:///backend/data/visualcsound.db` | SQLite database path by default. |
| `STATIC_DIR` | `backend/app/static` | Static asset root. |
| `FRONTEND_DIST_DIR` | `frontend/dist` | Built frontend root for `/client`. |
| `ICONS_URL_PREFIX` | `/static/icons` | Prefix used when building opcode icon URLs. |
| `GEN_AUDIO_ASSETS_DIR` | `backend/data/assets/audio` | Filesystem directory for uploaded/imported GEN audio assets. |
| `DEFAULT_RTMIDI_MODULE` | platform-dependent | Default rtmidi module for Csound startup (`coremidi`, `alsaseq`, or `winmme`). |
| `DEFAULT_MIDI_DEVICE` | `0` | Preferred MIDI input selector when creating sessions. |
| `AUDIO_OUTPUT_MODE` | `local` | `local` sends audio to the host DAC, `browser_clock` renders PCM in the browser via the controller WebSocket. |
| `FRONTEND_DISCONNECT_GRACE_SECONDS` | `5.0` | Delay before auto-stopping a running session after the last frontend disconnects. |
| `FRONTEND_HEARTBEAT_TIMEOUT_SECONDS` | `5.0` | Heartbeat timeout for active WebSocket clients. |

### CLI flags

`python -m backend.app.main` also accepts runtime flags:

- `--audio-output-mode {local,browser_clock}`
- `--host`
- `--port`
- `--log-level`
- `--reload/--no-reload`
- `--access-log/--no-access-log`
- `--debug/--no-debug`

The CLI flags update the relevant `VISUALCSOUND_*` environment variables before recreating the app.

## Persistence and Runtime State

The backend uses both SQLite and in-memory process state.

| Storage | Backing implementation | Contents |
| --- | --- | --- |
| SQLite table `patches` | `PatchRepository` | Saved patch graphs and engine config. |
| SQLite table `performances` | `PerformanceRepository` | Saved performance configs. |
| SQLite table `app_state` | `AppStateRepository` | The last persisted frontend/application state under the fixed key `last`. |
| Filesystem `backend/data/assets/audio` | `GenAssetService` | Uploaded/imported audio files referenced by GEN or `sfload` nodes. |
| In-memory `SessionService._sessions` | Python dict | Active session runtimes, compile artifacts, sequencer state, frontend heartbeat bookkeeping. |
| In-memory `SessionEventBus` | async queues | Per-session WebSocket subscriptions. |

Important consequence: sessions are **not persisted**. Restarting the backend drops all session state, compile artifacts, and realtime event subscriptions.

## Core Services

### OpcodeService

- Defines the built-in opcode catalog used by the visual patch editor.
- Loads extra opcode help sections from `ADD_OPCODES.md` if present.
- Builds icon URLs under `/static/icons`.
- Exposes categories and per-opcode lookup.

### PatchService

- CRUD service for `PatchDocument`.
- Raises `404` when a patch does not exist.
- Validates patch graphs through Pydantic model validation before persistence.

### PerformanceService

- CRUD service for `PerformanceDocument`.
- Persists arbitrary JSON config payloads.

### AppStateService

- Reads and overwrites the singleton application state record with id `last`.
- `GET /api/app-state` returns `404` until something has been saved.

### GenAssetService

- Stores raw uploaded audio files for GEN and sample-loading workflows.
- Enforces a 64 MiB size limit.
- Sanitizes original filenames and stored names.
- Resolves stored names safely to avoid path traversal.
- Can import assets from bundle ZIP files while preserving an existing stored name.
- Can create numeric `soundin.<filecode>` aliases for GEN01 workflows.

### CompilerService

- Validates patch graphs before compilation.
- Rejects empty graphs.
- Rejects unknown opcodes.
- Requires at least one `outs` node in every compiled patch.
- Validates connection endpoints and signal-type compatibility.
- Topologically sorts nodes before rendering.
- Emits both `orc` and full `csd` strings.
- Supports multi-instrument session compilation by assigning MIDI channels with `massign`.

Implementation note: when compiling a multi-instrument bundle, the engine settings are taken from the first target patch in the session.

### MidiService

- Uses `mido` when available.
- Does not require `python-rtmidi` for the base install; if the native MIDI backend is unavailable, it falls back automatically and the Rust host bridge path still works.
- Falls back to synthetic inputs when the host MIDI backend is unavailable.
- Generates stable MIDI input ids so the frontend can keep selections across backend reordering.
- Can send MIDI messages to a real output or to registered virtual sinks.
- Virtual sinks are used to deliver direct MIDI into a running `ctcsound` worker when host MIDI callbacks are enabled.

Fallback inputs are currently:

- macOS: `IAC Driver Bus 1`, `IAC Driver Bus 2`
- other fallback environments: `Virtual MIDI Input 1`, `Virtual MIDI Input 2`

### SessionService

- Owns the lifetime of all sessions.
- Creates `RuntimeSession` objects in memory.
- Compiles, starts, stops, and deletes sessions.
- Handles MIDI input binding.
- Owns the browser-clock controller lifecycle and sequencer runtime.
- Tracks frontend WebSocket connections and heartbeat timeouts.
- Auto-stops running sessions when the last frontend disconnects or a heartbeat times out.

### SessionEventBus

- Fan-out channel used by the session service and sequencer runtime.
- Each subscriber gets an `asyncio.Queue` with max size `100`.
- If a queue is full, the oldest event is dropped before enqueueing the new event.

## API Conventions

- REST base prefix: `/api`
- WebSocket base path: `/ws`
- Authentication: none
- Content type: JSON for almost all endpoints, except binary uploads/imports and bundle export responses
- Time values: UTC timestamps serialized by FastAPI/Pydantic
- Common error styles:
  - `404` for missing saved resources or unknown sessions/opcodes/MIDI inputs
  - `409` for runtime state conflicts such as sending MIDI to a stopped session or claiming browser-clock control when it is unavailable
  - `422` for request validation errors and compile/sequencer validation failures
  - `500` for engine startup failures or backend MIDI delivery failures

Because this is a standard FastAPI app, `/docs`, `/redoc`, and `/openapi.json` are also available unless disabled elsewhere.

## Endpoint Reference

### Health, Hosting, and Static Content

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/health` | none | `{status, audio_output_mode, browser_clock_enabled, browser_audio_sample_rate}` | Lightweight process health check. `browser_audio_sample_rate` is currently hardcoded to `48000`. |
| `GET` | `/api/health/realtime` | none | `{status, running_sessions}` | Counts in-memory sessions whose state is `running`. |
| `GET` | `/client` | none | Built frontend app or `503` JSON | Served by `StaticFiles` when `frontend/dist` exists. |
| `GET` | `/static/...` | none | Static files | Includes opcode icons and other app static files. |

### Opcodes

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/opcodes` | none | `list[OpcodeSpec]` | Optional `category` query param filters the list. |
| `GET` | `/api/opcodes/categories` | none | `dict[str, int]` | Returns category -> opcode count. |
| `GET` | `/api/opcodes/{opcode_name}` | none | `OpcodeSpec` | `404` if the opcode does not exist. |
| `GET` | `/api/opcodes/{opcode_name}/icon` | none | redirect | Redirects to the opcode icon URL. `404` if the opcode does not exist. |

`OpcodeSpec` contains:

| Field | Meaning |
| --- | --- |
| `name` | Opcode identifier used in patch graphs. |
| `category` | Display category used by the frontend palette. |
| `description` | Short summary. |
| `icon` | Public icon URL, usually under `/static/icons/...`. |
| `documentation_markdown` | Markdown help shown in the UI. |
| `documentation_url` | Csound manual or overview URL. |
| `inputs` / `outputs` | Lists of `PortSpec` entries. |
| `template` | Compiler template used to render the Csound line(s). |
| `tags` | Extra frontend metadata. |

Each `PortSpec` includes `id`, `name`, `signal_type`, `accepted_signal_types`, `required`, `default`, and `description`.

### Assets

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/assets/gen-audio` | raw binary body | `201` `GenAudioAssetUploadResponse` | Optional `X-File-Name` header sets the original filename. `Content-Type` is preserved in the response. Returns `400` for empty uploads, oversize uploads, or invalid filenames. |

`GenAudioAssetUploadResponse` returns:

- `asset_id`: generated UUID
- `original_name`: sanitized original filename
- `stored_name`: filename persisted on disk
- `content_type`
- `size_bytes`

### Import/Export Bundles

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/bundles/export/patch` | arbitrary JSON object | `application/json` or `application/zip` | Exports a patch payload. |
| `POST` | `/api/bundles/export/performance` | arbitrary JSON object | `application/json` or `application/zip` | Exports a performance payload. |
| `POST` | `/api/bundles/import/expand` | raw JSON bytes or ZIP bytes | expanded JSON payload | Optional `X-File-Name` header helps ZIP detection. Returns `400` for malformed imports. |

Bundle behavior:

- If the export payload does not reference stored GEN/sample assets, the response is plain JSON with header `X-Orchestron-Export-Format: json`.
- If the payload references stored audio assets, the response becomes a ZIP archive with header `X-Orchestron-Export-Format: zip`.
- Patch exports place the JSON at `instrument.orch.instrument.json`.
- Performance exports place the JSON at `performance.orch.json`.
- Referenced audio files are stored under `audio/<stored_name>` inside the ZIP.

Import behavior:

- Raw UTF-8 JSON is returned as parsed JSON.
- ZIP imports must contain exactly one JSON file at the archive root.
- Audio members must live under `audio/`.
- Referenced stored asset names are extracted from:
  - `graph.ui_layout.gen_nodes[*].sampleAsset.stored_name`
  - `graph.ui_layout.sfload_nodes[*].sampleAsset.stored_name`
  - the same structures inside `patch_definitions[*].graph`
- Missing referenced assets, invalid ZIP layout, invalid JSON, or conflicting asset contents return `400`.

### Application State

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/app-state` | none | `AppStateResponse` | Returns the singleton state record. `404` if nothing has been saved yet. |
| `PUT` | `/api/app-state` | `AppStateUpdateRequest` | `AppStateResponse` | Creates or overwrites the singleton state record. |

Schemas:

- `AppStateUpdateRequest`: `{ "state": { ... arbitrary JSON ... } }`
- `AppStateResponse`: `{ "state": { ... }, "updated_at": "<UTC timestamp>" }`

### Runtime Configuration

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/runtime-config` | none | `RuntimeConfigResponse` | Returns runtime-mode flags used by the frontend. |

`RuntimeConfigResponse` currently contains two fields:

- `audio_output_mode`: backend startup mode reflected to the frontend
- `browser_clock_enabled`: boolean flag indicating whether the backend started in `browser_clock` mode

### Patches

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/patches` | `PatchCreateRequest` | `201` `PatchResponse` | Creates a new patch document. |
| `GET` | `/api/patches` | none | `list[PatchListItem]` | Ordered by `updated_at` descending. |
| `GET` | `/api/patches/{patch_id}` | none | `PatchResponse` | `404` if the patch does not exist. |
| `PUT` | `/api/patches/{patch_id}` | `PatchUpdateRequest` | `PatchResponse` | Partial update; omitted fields keep their previous values. |
| `DELETE` | `/api/patches/{patch_id}` | none | `204` | `404` if the patch does not exist. |

#### Patch schema details

`PatchCreateRequest` and `PatchResponse` use this structure:

| Field | Meaning |
| --- | --- |
| `name` | Required patch name, max 128 chars. |
| `description` | Optional description, max 2048 chars. |
| `schema_version` | Patch schema version, currently default `1`. |
| `graph` | `PatchGraph` payload. |

`PatchGraph` contains:

| Field | Meaning |
| --- | --- |
| `nodes` | Up to 500 `NodeInstance` entries. Node ids must be unique. |
| `connections` | Up to 2000 `Connection` entries. |
| `ui_layout` | Arbitrary JSON used by the frontend for layout and editor-side metadata. |
| `engine_config` | Audio/runtime parameters used during compilation. |

`NodeInstance` contains `id`, `opcode`, `params`, and `position`.

`Connection` contains:

- `from_node_id`
- `from_port_id`
- `to_node_id`
- `to_port_id`

`engine_config` fields:

| Field | Meaning |
| --- | --- |
| `sr` | Audio sample rate, must be between `22000` and `48000`. |
| `control_rate` | Control sample rate, must be between `25` and `48000`. |
| `ksmps` | Samples per control period. If `control_rate` is omitted, it is derived from `sr / ksmps`. |
| `nchnls` | Output channel count. |
| `software_buffer` | Must be between `32` and `8192`. |
| `hardware_buffer` | Must be between `32` and `8192`. |
| `0dbfs` | Serialized as `0dbfs`, stored on the model as `zero_dbfs`. |

### Performances

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/performances` | `PerformanceCreateRequest` | `201` `PerformanceResponse` | Creates a new saved performance. |
| `GET` | `/api/performances` | none | `list[PerformanceListItem]` | Ordered by `updated_at` descending. |
| `GET` | `/api/performances/{performance_id}` | none | `PerformanceResponse` | `404` if the performance does not exist. |
| `PUT` | `/api/performances/{performance_id}` | `PerformanceUpdateRequest` | `PerformanceResponse` | Partial update. |
| `DELETE` | `/api/performances/{performance_id}` | none | `204` | `404` if the performance does not exist. |

Performance documents are intentionally loose:

- `name`
- `description`
- `config`: arbitrary JSON blob owned by the frontend/performance workflow

### MIDI

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/midi/inputs` | none | `list[MidiInputRef]` | Lists available MIDI inputs with stable ids. |
| `PUT` | `/api/midi/sessions/{session_id}/midi-input` | `BindMidiInputRequest` | `SessionInfo` | Convenience alias for the session MIDI-binding route. |

`MidiInputRef` fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable backend-generated identifier. |
| `name` | Human-readable backend MIDI port name. |
| `backend` | Usually `mido` or `fallback`. |
| `selector` | Backend-specific selector, typically the input index as a string. |

`BindMidiInputRequest` is:

```json
{
  "midi_input": "mido:my-port:abc123..."
}
```

The service accepts a stable id, backend selector, or literal input name. A successful rebind clears the existing compile artifact so the session will recompile before the next start.

### Sessions

Sessions are the runtime bridge between saved patch documents and a live Csound worker. They are not stored in SQLite.

#### Session lifecycle endpoints

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/sessions` | `SessionCreateRequest` | `201` `SessionCreateResponse` | Creates a new in-memory session. |
| `GET` | `/api/sessions` | none | `list[SessionInfo]` | Lists active in-memory sessions only. |
| `GET` | `/api/sessions/{session_id}` | none | `SessionInfo` | `404` if missing. |
| `POST` | `/api/sessions/{session_id}/compile` | none | `CompileResponse` | Compiles the session patches into Csound text. Returns `422` with diagnostics on compile failure. |
| `POST` | `/api/sessions/{session_id}/start` | none | `SessionActionResponse` | Auto-compiles first if needed. Returns `500` on engine startup failure. |
| `POST` | `/api/sessions/{session_id}/stop` | none | `SessionActionResponse` | Stops sequencer, closes browser-clock control, then stops the worker. |
| `POST` | `/api/sessions/{session_id}/panic` | none | `SessionActionResponse` | Best-effort panic/turnoff request to the worker. |
| `DELETE` | `/api/sessions/{session_id}` | none | `204` | Fully tears down the worker, sequencer, event subscriptions, and frontend tracking. |

`SessionCreateRequest` supports two creation modes:

```json
{
  "patch_id": "single-patch-id"
}
```

or

```json
{
  "instruments": [
    { "patch_id": "patch-a", "midi_channel": 1 },
    { "patch_id": "patch-b", "midi_channel": 2 }
  ]
}
```

Validation rules:

- At least one of `patch_id` or `instruments` must be provided.
- Up to 16 instrument assignments are allowed.
- MIDI channels must be unique across `instruments`.
- Every referenced patch must already exist.

Creation behavior:

- If only `patch_id` is supplied, the backend creates one instrument assignment on MIDI channel `1`.
- The default MIDI input is resolved from `VISUALCSOUND_DEFAULT_MIDI_DEVICE`; if that is unavailable, the first listed input is used.
- A `SessionSequencerRuntime` is created immediately, but it does not start running until explicitly configured and started.

Important session response fields:

| Field | Meaning |
| --- | --- |
| `session_id` | Runtime UUID. |
| `patch_id` | The first instrument patch id. For multi-instrument sessions this is not the full instrument list. |
| `instruments` | Full list of patch/channel assignments. |
| `state` | `idle`, `compiled`, `running`, or `error`. |
| `midi_input` | Stable MIDI input id bound to the session. |
| `created_at` / `started_at` | UTC timestamps. |

#### Compilation

`POST /api/sessions/{session_id}/compile` returns:

| Field | Meaning |
| --- | --- |
| `session_id` | Session id. |
| `state` | Usually `compiled`; becomes `error` on failure. |
| `orc` | The generated orchestra text. |
| `csd` | The wrapped CSD document used to start Csound. |
| `diagnostics` | Compiler warnings/notes; compile failures are returned as HTTP `422` with `detail.diagnostics`. |

Compile failures include conditions such as:

- empty graphs
- unknown opcodes
- missing `outs` nodes
- invalid connections or incompatible signal types
- invalid MIDI channel assignments
- missing referenced GEN audio assets

#### Engine start and stop

Worker behavior depends on the installed runtime:

- If `ctcsound` is available, it is used as the realtime backend.
- Otherwise the backend falls back to a mock engine.
- Setting `VISUALCSOUND_FORCE_MOCK_ENGINE=1` forces the mock engine even if `ctcsound` is installed.

`POST /api/sessions/{session_id}/start`:

- compiles on demand if no compile artifact exists
- starts the Csound worker
- syncs direct MIDI sinks when supported
- marks the session as `running`

`POST /api/sessions/{session_id}/stop`:

- stops the sequencer if it exists
- closes any browser-clock controller session
- stops the worker
- returns the session to `compiled` when a compile artifact still exists, otherwise `idle`

#### Direct MIDI events

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/sessions/{session_id}/midi-event` | `SessionMidiEventRequest` | `SessionActionResponse` | Session must already be running, otherwise `409`. |

`SessionMidiEventRequest` supports four event types:

| `type` | Required fields | Sent MIDI bytes |
| --- | --- | --- |
| `note_on` | `channel`, `note`, optional `velocity` | `0x90 + channel-1, note, velocity` |
| `note_off` | `channel`, `note` | `0x80 + channel-1, note, 0` |
| `control_change` | `channel`, `controller`, `value` | `0xB0 + channel-1, controller, value` |
| `all_notes_off` | `channel` | `CC 123` and `CC 120` |

Error behavior:

- `409` if the session is not running
- `404` if the bound MIDI input cannot be resolved
- `500` if MIDI sending fails in the backend

#### Browser-clock controller WebSocket

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `WS` | `/ws/sessions/{session_id}/browser-clock` | JSON control messages | JSON status messages and raw PCM render bytes | Only valid when the backend runs in `browser_clock` mode and the session is running. The browser claims controller ownership, requests render chunks, sends manual MIDI, starts/stops the sequencer, queues pads, and releases control. |

Supported message types:

- `claim_controller` opens the controller session and returns the stream configuration.
- `request_render` asks the backend to render PCM blocks and returns JSON metadata followed by the raw PCM bytes.
- `manual_midi` forwards a direct MIDI event through the browser-clock controller path.
- `sequencer_start`, `sequencer_stop`, `sequencer_rewind`, and `sequencer_forward` control the sequencer from the browser.
- `queue_pad` queues a pad switch for the active track.
- `release_controller` releases browser ownership of the controller session.

Common `409` cases:

- `VISUALCSOUND_AUDIO_OUTPUT_MODE=local`
- session not running
- browser-clock controller not ready yet
- `ctcsound` backend not available

Unexpected backend failures return `500`.

#### Session MIDI binding

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `PUT` | `/api/sessions/{session_id}/midi-input` | `BindMidiInputRequest` | `SessionInfo` | Same behavior as `/api/midi/sessions/{session_id}/midi-input`. |

Binding a new MIDI input:

- stores the resolved stable input id on the session
- updates the sequencer input if the sequencer already exists
- re-syncs any direct MIDI sink registration
- clears the compile artifact
- resets the session state to `idle` if the worker is not currently running

#### Sequencer endpoints

| Method | Path | Request body | Response | Notes |
| --- | --- | --- | --- | --- |
| `PUT` | `/api/sessions/{session_id}/sequencer/config` | `SessionSequencerConfigRequest` | `SessionSequencerStatus` | Replaces the active sequencer configuration. |
| `POST` | `/api/sessions/{session_id}/sequencer/start` | `SessionSequencerStartRequest` | `SessionSequencerStatus` | Starts the sequencer thread; auto-starts the session if needed. |
| `POST` | `/api/sessions/{session_id}/sequencer/stop` | none | `SessionSequencerStatus` | Stops the sequencer and sends note-off/all-notes-off cleanup. |
| `GET` | `/api/sessions/{session_id}/sequencer/status` | none | `SessionSequencerStatus` | Reads current transport and track state. |
| `POST` | `/api/sessions/{session_id}/sequencer/rewind` | none | `SessionSequencerStatus` | Moves the stopped transport backward by the runtime’s quantized seek block and returns the new status. |
| `POST` | `/api/sessions/{session_id}/sequencer/forward` | none | `SessionSequencerStatus` | Moves the stopped transport forward by the runtime’s quantized seek block and returns the new status. |
| `POST` | `/api/sessions/{session_id}/sequencer/tracks/{track_id}/queue-pad` | `SessionSequencerQueuePadRequest` | `SessionSequencerStatus` | Queues a pad switch for a note or controller track, or switches immediately when stopped. |

`SessionSequencerConfigRequest` contains:

| Field | Meaning |
| --- | --- |
| `timing` | Global timing baseline. |
| `step_count` | Visible transport step count. |
| `playback_start_step` | Start of the playback window. |
| `playback_end_step` | End of the playback window, must be greater than `playback_start_step`. |
| `playback_loop` | Whether transport loops at the playback boundary. |
| `tracks` | Note sequencer tracks. |
| `controller_tracks` | Controller automation tracks. |

Validation rules:

- At least one note track or controller track is required.
- Track ids must be unique across both track lists.
- `sync_to_track_id` cannot point to the same track and must reference an existing note track.

Note-track fields include:

- `track_id`
- `midi_channel`
- `timing`
- `length_beats`
- `velocity`
- `gate_ratio`
- `sync_to_track_id`
- `active_pad`
- `queued_pad`
- `pad_loop_enabled`
- `pad_loop_repeat`
- `pad_loop_sequence`
- `enabled`
- `queued_enabled`
- `pads`

Controller-track fields include:

- `track_id`
- `controller_number`
- `timing`
- `length_beats`
- `active_pad`
- `queued_pad`
- `pad_loop_enabled`
- `pad_loop_repeat`
- `pad_loop_sequence`
- `enabled`
- `pads`
- `target_channels`

Sequencer-specific model details:

- Note pads use up to 8 pads per track and allow pad lengths from `1..8` beats.
- Controller pads also use 8 pads but allow lengths from `1..8` plus `16` beats.
- Pad loop sequences accept either pad indexes `0..7` or pause tokens `-1`, `-2`, `-4`, `-8`, `-16`.
- Controller keypoints are normalized into a curve over `position` `0.0..1.0` and `value` `0..127`.
- Empty `target_channels` on controller tracks fall back to the session instrument MIDI channels, or channel `1` if none are available.

`SessionSequencerStartRequest`:

```json
{
  "config": { "... optional full config ..." },
  "position_step": 0
}
```

`SessionSequencerQueuePadRequest`:

```json
{
  "pad_index": 3
}
```

Setting `pad_index` to `null` clears a queued pad change.

`SessionSequencerStatus` returns:

| Field | Meaning |
| --- | --- |
| `session_id` | Session id. |
| `running` | Whether the sequencer thread is active. |
| `timing` | Current transport timing. |
| `step_count` | Visible transport step count. |
| `current_step` | Current transport step. |
| `cycle` | Current playback cycle count. |
| `transport_subunit` | Fine-grained transport position. |
| `tracks` | Note-track runtime status list. |
| `controller_tracks` | Controller-track runtime status list. |

Track status includes pad selection, queue state, local step, active notes, controller value, pad-loop position, and enabled flags.

All sequencer validation failures return `422`.

## WebSocket API

| Method | Path | Direction | Purpose |
| --- | --- | --- | --- |
| `WS` | `/ws/sessions/{session_id}` | bidirectional | Real-time session and sequencer events. |

### Server-to-client message shape

Every outbound event uses the `SessionEvent` envelope:

```json
{
  "session_id": "session-uuid",
  "ts": "2026-03-15T12:34:56.000000Z",
  "type": "started",
  "payload": {
    "backend": "ctcsound"
  }
}
```

### Client-to-server message shape

The WebSocket currently understands heartbeat messages only:

```json
{
  "type": "heartbeat"
}
```

If a connected frontend stops sending heartbeats for longer than `FRONTEND_HEARTBEAT_TIMEOUT_SECONDS`, the backend treats that connection as lost and may stop the session immediately if it was the last frontend connection.

If the last frontend disconnects normally, the backend waits `FRONTEND_DISCONNECT_GRACE_SECONDS` before auto-stopping the session.

### Event types published today

| Event type | When it is emitted | Typical payload keys |
| --- | --- | --- |
| `session_created` | After a session is created | `patch_id`, `instrument_count` |
| `compile_failed` | After compilation fails | `errors` |
| `compiled` | After compilation succeeds | `diagnostics` |
| `start_failed` | After engine startup fails | `error` |
| `started` | After a session starts | `backend`, `detail`, `midi_input`, `audio_mode` |
| `stopped` | After a session stops | `detail` |
| `panic` | After a panic request | `detail` |
| `midi_event` | After direct MIDI delivery | `type`, `channel`, `output`, plus note/velocity/controller/value when relevant |
| `midi_bound` | After MIDI input rebinding | `midi_input` |
| `session_deleted` | After teardown | none |
| `sequencer_configured` | After config update | `tempo_bpm`, `step_count`, `tracks` |
| `sequencer_started` | After sequencer start | `tempo_bpm`, `step_count` |
| `sequencer_stopped` | After sequencer stop | `cycle` |
| `sequencer_pad_queued` | After queueing a pad change | `track_id`, `pad_index` |
| `sequencer_cycle_rewound` | After transport rewind | `cycle`, `step`, `running` |
| `sequencer_cycle_forwarded` | After transport forward | `cycle`, `step`, `running` |
| `sequencer_step` | As transport advances | `step`, `next_step`, `cycle`, `track_count` |
| `sequencer_pad_switched` | When a track actually changes pad on a boundary | `track_id`, `active_pad`, `cycle` |

## Backend Behavior Notes

### Session state machine

The session state enum is:

- `idle`
- `compiled`
- `running`
- `error`

Typical transitions:

1. `POST /api/sessions` -> `idle`
2. `POST /api/sessions/{id}/compile` -> `compiled`
3. `POST /api/sessions/{id}/start` -> `running`
4. `POST /api/sessions/{id}/stop` -> `compiled` if a compile artifact still exists, otherwise `idle`

Compile/start failures can set the state to `error`.

### Mock vs real engine

If `ctcsound` is not importable, the backend still works for API and test flows by using a mock realtime engine. That means:

- session APIs still function
- compile still returns generated `orc`/`csd`
- panic may become a no-op
- browser audio is unavailable

### Frontend disconnect handling

The backend keeps track of frontend WebSocket clients per session. This is used to avoid leaving orphaned audio sessions running after the UI disappears.

### Tests

Backend regression coverage lives primarily in:

- `backend/tests/test_api.py`
- `backend/tests/test_startup_initialization.py`
- `backend/tests/test_compiler_service.py`
- `backend/tests/test_midi_service.py`
- `backend/tests/test_csound_worker.py`

Those tests are the best executable reference for edge cases not obvious from the route signatures alone.
