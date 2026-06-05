# Persistence and Defaults

**Navigation:** [Up](configuration.md) | [Prev](browser_clock_latency.md)

Orchestron persists both library data (patches/performances) and a separate app-state snapshot (workspace state).

Persistent JSON documents are bounded before storage so direct API clients cannot grow request memory or the SQLite database without limit. Defaults are 8 MiB for app state (`VISUALCSOUND_APP_STATE_MAX_BYTES`), 4 MiB for saved patch graphs (`VISUALCSOUND_PATCH_GRAPH_MAX_BYTES`), 1 MiB for patch UI layout metadata (`VISUALCSOUND_PATCH_UI_LAYOUT_MAX_BYTES`), 8 MiB for performance configs (`VISUALCSOUND_PERFORMANCE_CONFIG_MAX_BYTES`), and 64 KiB for any single nested JSON string (`VISUALCSOUND_PERSISTED_JSON_STRING_MAX_BYTES`).

## Two Persistence Layers (Important)

### 1. Library Data (Explicit Save)

These are stored when you click save actions:

- Patches (Instrument Design `Save`)
- Performances (Perform page `Save Performance`)

### 2. App-State Snapshot (Automatic)

Orchestron also persists a workspace/app-state snapshot in the backend to restore your working context after reload.

Persisted app state includes (current implementation):

- active page (`Instrument Design` / `Perform` / `Config`)
- GUI language
- instrument tabs (including editable patch snapshots)
- active instrument tab
- sequencer state (tracks, controller sequencers, arpeggiators, piano rolls, MIDI controllers)
- performance workspace metadata (`currentPerformanceId`, name, description)
- sequencer instrument bindings (rack assignments)
- active MIDI input selection reference
- browser-clock latency settings for the current workspace/runtime path

New sessions default that MIDI input reference to `internal:loopback` unless a different external input is explicitly bound.

## What This Means In Practice

- You can reload the app and continue from a similar workspace state.
- Unsaved edits may reappear because they exist in the app-state snapshot.
- Unsaved edits are **not** the same as saved library data.

Always use explicit save actions when you want stable, shareable library entries.

## Default New Patch Values

A new patch starts with:

- Name: `Untitled Instrument`
- Empty graph (`nodes = []`, `connections = []`)
- Default engine config values (current defaults):
  - `sr = 48000`
  - `control_rate = 1500`
  - `ksmps = 32`
  - `nchnls = 2`
  - `software_buffer = 128`
  - `hardware_buffer = 512`
  - `0dbfs = 1`

## Compile Status vs Persistence

The compile status badge (`compiled`, `pending changes`, `errors`) indicates compile state for the current patch snapshot. It does **not** indicate whether the patch has been saved to the patch library.

## Runtime Defaults

- runtime audio mode is fixed to `browser_clock`
- the default session MIDI binding is `internal:loopback`
- external host MIDI is disabled unless `VISUALCSOUND_HOST_MIDI_TOKEN` is configured and a helper connects
- runtime session creation is bounded by `VISUALCSOUND_SESSION_MAX_ACTIVE`, `VISUALCSOUND_SESSION_MAX_ACTIVE_PER_CLIENT`, `VISUALCSOUND_SESSION_CREATE_RATE_PER_MINUTE`, and `VISUALCSOUND_SESSION_CREATE_RATE_BURST`; stopped idle sessions are deleted after `VISUALCSOUND_SESSION_IDLE_TIMEOUT_SECONDS`
- session event WebSocket observers are bounded by `VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_TOTAL`, `VISUALCSOUND_SESSION_EVENT_WS_MAX_SUBSCRIPTIONS_PER_SESSION`, `VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_PER_MINUTE`, and `VISUALCSOUND_SESSION_EVENT_WS_CONNECT_RATE_BURST`

## Recommended Habits

1. Use app-state restore for convenience.
2. Use `Save` / `Save Performance` for intentional versions.
3. Use `Export` bundles for backups or sharing across machines.

**Navigation:** [Up](configuration.md) | [Prev](browser_clock_latency.md)
