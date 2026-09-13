# Performance

**Navigation:** [Up](../user_documentation.md) | [Prev](../instrument_design/supported_opcodes.md) | [Next](instrument_rack_and_engine_transport.md)

This chapter covers the `Perform` page (labeled `Perform` / `Performance` depending language), where you build a playable multi-instrument setup and perform it live.

## Collapsible Panels

Click a panel title or focus it and press Enter or Space to collapse or expand its contents. Header actions, status and help remain available. Panels collapse independently, start expanded and remember your choices across view switches until browser reload. Adding a device opens its group. Collapsing preserves edits and does not stop playback. The shared tempo stays outside the sequencer groups; Mixer keeps its existing behavior.

Instrument Rack, Melodic Sequencers, Drummer Sequencers, Controller Sequencers, Arpeggiators, Piano Rolls (keyboards), MIDI Controllers, and Multitrack Arranger each have their own toggle. Empty drummer/controller groups keep their Add buttons. The arranger appears when at least one melodic, drummer, or controller sequencer exists. These layout choices are not saved into performances or exports.

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
