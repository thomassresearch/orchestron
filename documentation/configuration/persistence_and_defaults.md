# Persistence and Defaults

**Navigation:** [Up](configuration.md) | [Prev](browser_audio_streaming_webrtc.md)

Orchestron persists both library data (patches/performances) and a separate app-state snapshot (workspace state).

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
- sequencer state (tracks, controller sequencers, piano rolls, MIDI controllers)
- performance workspace metadata (`currentPerformanceId`, name, description)
- sequencer instrument bindings (rack assignments)
- active MIDI input selection reference

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
  - `sr = 44100`
  - `control_rate = 1378`
  - `ksmps = 32`
  - `nchnls = 2`
  - `software_buffer = 128`
  - `hardware_buffer = 512`
  - `0dbfs = 1`

## Compile Status vs Persistence

The compile status badge (`compiled`, `pending changes`, `errors`) indicates compile state for the current patch snapshot. It does **not** indicate whether the patch has been saved to the patch library.

## Recommended Habits

1. Use app-state restore for convenience.
2. Use `Save` / `Save Performance` for intentional versions.
3. Use `Export` bundles for backups or sharing across machines.

**Navigation:** [Up](configuration.md) | [Prev](browser_audio_streaming_webrtc.md)
