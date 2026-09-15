# Performance

**Navigation:** [Up](../user_documentation.md) | [Prev](../instrument_design/supported_opcodes.md) | [Next](instrument_rack_and_engine_transport.md)

This chapter covers the `Perform` page (labeled `Perform` / `Performance` depending language), where you build a playable multi-instrument setup and perform it live.

The performance description field displays three lines with automatic text wrapping and preserves manual line breaks. Longer descriptions scroll vertically within the field. Hover over the description to see its full text in a tooltip.

## Device Names

Melodic sequencers, drummer sequencers, controller sequencers, arpeggiators, piano rolls, and MIDI controllers all support custom names. Click the pen immediately to the right of a device name to edit it. The input receives focus with its current name selected.

- Save or Enter applies the name. Cancel or Escape discards the draft. Clicking elsewhere does not save; switching performances or removing the device discards the draft.
- Names must be nonempty after trimming surrounding whitespace and contain at most 65 Unicode characters. HTML and angle brackets (`<` and `>`) are rejected.
- Names must be unique across all six device types within the performance, ignoring case and surrounding whitespace. Validation messages appear while typing, and Save is disabled until the name is valid.
- Names retain their capitalization. Melodic synchronization choices and arranger track titles show the stored names. New devices receive an unused numbered default name.
- Renaming preserves device IDs, synchronization, routing, patterns, and playback state. Names survive performance save/load, browser persistence, raw snapshot import, and native JSON/ZIP export/import.
- Existing/imported names remain intact under the existing loading rules, even if they violate the new editing rules. They display as plain text and need a valid replacement only when renamed. CLI/API acceptance is unchanged.


## Collapsible Panels

Click a panel title or focus it and press Enter or Space to collapse or expand its contents. Header actions, status and help remain available. Panels collapse independently, start expanded and remember your choices across view switches until browser reload. Adding a device opens its group. Collapsing preserves edits and does not stop playback. The shared tempo stays outside the sequencer groups.

Instrument Rack, Melodic Sequencers, Drummer Sequencers, Controller Sequencers, Arpeggiators, Piano Rolls (keyboards), MIDI Controllers, and Multitrack Arranger each have their own toggle. Empty drummer/controller groups keep their Add buttons. The arranger appears when at least one melodic, drummer, controller sequencer, or arpeggiator exists. These layout choices are not saved into performances or exports.

Collapsed visual bodies are suspended: hidden grids and timelines are not built, animation loops stop, and hidden meters unsubscribe. This includes the Mixer and each nested routing, matrix, diagram, channel-mapping, diagnostic and insert section. Playback, pad switching, MIDI processing, audio controls and meter collection continue. Visible headers, rack summary, shared tempo and footer transport status keep updating. Expanding displays the current playback position and latest meters immediately, without replaying missed animation frames.

Draft names and controller values, validation feedback, arpeggiator preset drafts, pad-loop selections, open containers, arranger clipboard, zoom and scroll positions survive collapse/expand while the Perform page remains open. Nested Mixer sections remember their open state when a parent collapses. New, Load and Import clear retained editor state after successfully replacing the workspace, even when reloading the same performance. Saving does not clear it. Removed devices and invalid selections are discarded; restored scroll positions are limited to the current content. This temporary editor state is not stored in performance files or browser storage and does not survive a page reload or leaving Perform.

Collapsing closes temporary menus and pickers, cancels active drag previews and releases manually held piano notes. Already-applied edits remain, and existing input save/commit rules still apply. Sequenced notes continue playing. Offscreen panels that remain expanded still render normally. Collapsing reduces visual work; any reduction in audio dropouts depends on the workload and audio system.

The collapsed rack shows channel and patch name in one horizontally scrolling row. See [Compact Rack](instrument_rack_and_engine_transport.md#compact-rack) for continuous instruments, long names, and keyboard scrolling.

## What You Can Do Here

- Assemble an instrument rack from saved patches and assign MIDI channels
- Mix audio with dB faders, pan/balance, mute/solo, meters, inserts and pre/post sends
- Route instruments and returns through Master or explicit direct paths
- Start/stop the instrument engine session
- Create multiple melodic sequencers, drummer sequencers, and controller sequencers
- Add backend-run arpeggiators that turn held notes into routed arpeggiated instrument output
- Use pattern pads with queued switching and pad-loop sequences
- Arrange multiple track timelines in the multitrack arranger with shared transport and loop-range playback
- Perform live with piano rolls and manual MIDI controller knobs
- Save/load/clone/delete performances
- Import/export performance bundles (with optional patch definitions)
- Export offline Csound render ZIPs either with `.csd` + `.mid` playback or with inline Csound score playback

## Chapter Contents

- [Instrument Rack and Engine Transport](instrument_rack_and_engine_transport.md)
- [Audio Mixer and Routing](audio_mixer_and_routing.md)
- [Melodic Sequencers and Step Editing](sequencer_tracks_and_steps.md)
- [Drummer Sequencers](drummer_sequencers.md)
- [Pattern Pads, Queued Switching, and Pad Looper](pattern_pads_and_pad_looper.md)
- [Multitrack Arranger](multitrack_arranger.md)
- [Controller Sequencers](controller_sequencers.md)
- [Arpeggiators](arpeggiators.md)
- [Piano Rolls](piano_rolls.md)
- [MIDI Controllers](midi_controllers.md)
- [Performance Import / Export](performance_import_export.md)
- [Live Status and Safety Controls](live_status_and_safety_controls.md)

## Important Concept: Patch vs Performance

- **Patch (Instrument Design page):** one instrument graph
- **Performance (Perform page):** a full live setup that references one or more patches and stores sequencer/piano-roll/controller state plus explicit audio routes and mixer settings

## Practical Workflow

1. Save at least one patch in Instrument Design.
2. Add instruments to the performance rack and assign channels.
3. Open Mixer, check the destination of each strip, and connect effects/returns. Guided instruments get a neutral Master automatically; existing direct routes stay direct.
4. Use Routing diagnostics → Check routing, then Start Instruments. Adjust existing mixer controls during playback.
5. Build melodic sequencers / drummer sequencers / controller sequencers / piano rolls.
6. Save the performance to retain the rack, routes and current mix.
7. Export the performance bundle for backup/sharing, or use `Export CSD (MIDI)` / `Export CSD (SCORE)` when you need an offline Csound render package.

## Screenshots

<p align="center">
  <img src="../../screenshots/perform_mixer_sends_inserts_master.png" alt="Perform mixer with instrument, stereo return, send, insert and pinned Master" width="1100" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Perform mixer with a post-fader send, dedicated insert and pinned Master. See the following chapters for rack and sequencer controls.</em></p>

**Navigation:** [Up](../user_documentation.md) | [Prev](../instrument_design/supported_opcodes.md) | [Next](instrument_rack_and_engine_transport.md)
