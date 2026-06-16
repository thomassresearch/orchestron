# Instrument Rack and Engine Transport

**Navigation:** [Up](performance.md) | [Prev](performance.md) | [Next](sequencer_tracks_and_steps.md)

The Instrument Rack is the top section of the Perform page and controls the live session, instrument assignments, and performance metadata.

## Performance Metadata and Library Actions

The rack includes fields and actions for the current performance:

- `Performance Name`
- `Description`
- `Load Performance` dropdown
- `Save Performance`
- `Clone`
- `Delete`
- `Export`
- `Export CSD (MIDI)`
- `Export CSD (SCORE)`
- `Import`

These actions operate on the performance configuration (instrument rack + sequencers + controllers + piano rolls), not on individual patch definitions.

- `Export` writes an Orchestron `.orch.json` / `.orch.zip` performance bundle for backup, sharing, and re-import.
- `Export CSD (MIDI)` writes an offline-render ZIP with a compiled `.csd`, the arranger performance as `.mid`, bundled uploaded sample/SF assets, and a `README.txt` with the render command. `Export CSD (SCORE)` embeds notes and controller sweeps directly in the Csound score, omits the `.mid`, rewrites supported MIDI opcodes for score playback, and writes a matching no-`-F` render command. Both modes seed enabled manual MIDI Controller lane values at time 0 on each assigned instrument channel and use 32-bit float WAV output (`-f`) to preserve headroom. GEN01 and `sfload` sample files must be uploaded/imported assets; raw local `samplePath` values are rejected before compilation.

## Instrument Assignments (Rack Slots)

Each rack entry lets you choose:

- A saved patch (`Patch N` dropdown)
- A MIDI channel (`1..16`)
- A level value (`1..10`)
- Remove action

If the selected patch is marked `Always On?`, the rack slot becomes an effect slot:

- The MIDI channel field is replaced with an `Effect` badge.
- The slot runs continuously when `Start Instruments` starts the rack session.
- The slot shows an audio source matrix with one row per normal rack instrument or always-on effect slot that exposes `outleta` channel labels.
- Each source row contains checkboxes for all of that instrument's resolved `outleta` channel labels.
- Routes that would feed an effect back into itself through the current effect chain are shown disabled, so cascaded effects can be built without creating feedback loops.
- Checked channel boxes are connected when the session compiles; unchecked channel boxes are not routed.

If no other rack instrument exposes `outleta`, the matrix is empty. Add or edit source patches with `outleta` nodes and add at least one `inleta` node to the effect patch to make routes available. Source outlet labels do not need to match effect inlet labels; exact matches are used when available, and stereo-style labels such as `dryl`/`dryr` are mapped to `left`/`right` inlets.

While instruments are running, rack assignment changes are locked:

- `Add Instrument` is disabled
- Rack-slot `Remove` is disabled
- Patch and MIDI channel selectors are disabled
- `Level` remains active so you can rebalance the live mix without stopping the engine

### Add Instrument

- Use `Add Instrument` to create another rack slot.
- This enables multi-instrument performances driven by different MIDI channels.
- Always-on effect patches are included only when they are explicitly added as rack slots.
- The button is unavailable while the engine is running; stop instruments before changing rack assignments.

## Rack Transport (Instrument Engine Control)

The rack transport controls the instrument runtime session itself.

Buttons:

- `Start Instruments`
- `Stop Instruments`

### `Start Instruments` / `Stop Instruments`

These start/stop the underlying instrument engine session.

Global arrangement transport now lives in the multitrack arranger section. There, cassette-style `Rewind`, `Stop`, `Play`, and `Fast forward` buttons drive sequencers that have `Pad Looper` enabled and move the shared playhead in `1-beat` transport blocks. Arranger `Play` stops sequencers whose `Pad Looper` is off, while arranger `Stop` stops only the pad-loop-driven sequencers; manually started non-pad-loop sequencers can keep running. The arranger `Stop` button does not stop the instrument engine; `Stop Instruments` in the rack does that. Double-clicking arranger `Stop` resets the playhead to the selected loop start or to step `0` when no manually running sequencer keeps transport active.

## Session State Badge

The rack shows current session state (localized label), for example:

- running
- stopped / idle

This is the state of the instrument engine session, not just the sequencer transport.

## Error Banner

If engine start/stop or transport actions fail, the Perform page shows an error banner below the rack transport section.

## Tips

- Save the performance after significant changes (rack assignments, sequencers, piano rolls, controller mappings).
- Use distinct MIDI channels per instrument unless you intentionally want multiple instruments layered on the same channel.
- Use `sname` labels on source `outleta` nodes to name the available matrix channels. The label can be stored directly on the node or supplied by a direct `const_s` connection.

## Screenshots

<p align="center">
  <img src="../../screenshots/perform_instrument_rack_transport_controls.png" alt="Instrument rack and transport controls" width="1100" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Instrument rack detail with performance metadata, assignments, and transport controls.</em></p>

**Navigation:** [Up](performance.md) | [Prev](performance.md) | [Next](sequencer_tracks_and_steps.md)
