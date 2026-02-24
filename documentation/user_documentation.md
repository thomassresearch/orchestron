# Orchestron User Documentation

**Navigation:** [Next](instrument_design/instrument_design.md)

This manual documents the current Orchestron user-facing functionality as implemented in the repository (frontend, backend API behavior visible to users, and feature history from the git log) as of **2026-02-24**.

It is organized by chapter and subchapter so you can read it front-to-back or jump directly to a workflow.

## Scope

- Visual instrument design (opcode graph editor, formulas, GEN tables, compile/runtime testing)
- Live performance workflow (instrument rack, sequencers, piano rolls, MIDI controllers, import/export)
- Configuration and runtime behavior (audio engine settings, MIDI setup, browser streaming, persistence)

## Reading Order

- Start with **Instrument Design** if you are creating patches.
- Continue with **Performance** to build and perform a multi-instrument setup.
- Use **Configuration** for audio engine tuning, MIDI setup, UI language/help, and browser streaming mode.

## [Instrument Design](instrument_design/instrument_design.md)

- [Patch Toolbar and Instrument Tabs](instrument_design/patch_toolbar_and_tabs.md)
- [Opcode Catalog and Integrated Documentation](instrument_design/opcode_catalog_and_documentation.md)
- [Graph Editor](instrument_design/graph_editor.md)
- [Input Formula Assistant](instrument_design/input_formula_assistant.md)
- [GEN Table Editor (GEN Meta-Opcode)](instrument_design/gen_table_editor.md)
- [Runtime Panel and Compilation Workflow](instrument_design/runtime_panel_and_compilation.md)
- [Instrument Import / Export and CSD Export](instrument_design/instrument_import_export.md)
- [Supported Opcodes](instrument_design/supported_opcodes.md)

## [Performance](performance/performance.md)

- [Instrument Rack and Engine Transport](performance/instrument_rack_and_engine_transport.md)
- [Sequencer Tracks and Step Editing](performance/sequencer_tracks_and_steps.md)
- [Pattern Pads, Queued Switching, and Pad Looper](performance/pattern_pads_and_pad_looper.md)
- [Controller Sequencers](performance/controller_sequencers.md)
- [Piano Rolls](performance/piano_rolls.md)
- [MIDI Controllers](performance/midi_controllers.md)
- [Performance Import / Export](performance/performance_import_export.md)
- [Live Status and Safety Controls](performance/live_status_and_safety_controls.md)

## [Configuration](configuration/configuration.md)

- [GUI Language and Integrated Help](configuration/gui_language_and_integrated_help.md)
- [Audio Engine Settings (Config Page)](configuration/audio_engine_settings.md)
- [MIDI Setup and Inputs](configuration/midi_setup_and_inputs.md)
- [Browser Audio Streaming (WebRTC)](configuration/browser_audio_streaming_webrtc.md)
- [Persistence and Defaults](configuration/persistence_and_defaults.md)

## Feature Coverage Map

| Feature | Where It Is Documented |
| --- | --- |
| Multi-language UI (EN/DE/FR/ES) | [GUI Language and Integrated Help](configuration/gui_language_and_integrated_help.md) |
| Integrated help pages and opcode docs modal | [GUI Language and Integrated Help](configuration/gui_language_and_integrated_help.md), [Opcode Catalog and Integrated Documentation](instrument_design/opcode_catalog_and_documentation.md) |
| Visual graph editor, zoom, selection, deletion | [Graph Editor](instrument_design/graph_editor.md) |
| Input Formula Assistant (multi-input formulas + functions) | [Input Formula Assistant](instrument_design/input_formula_assistant.md) |
| GEN meta-opcode editor (GEN01/GENpadsynth/etc.) | [GEN Table Editor (GEN Meta-Opcode)](instrument_design/gen_table_editor.md) |
| Instrument import/export bundles + CSD export | [Instrument Import / Export and CSD Export](instrument_design/instrument_import_export.md) |
| Performance rack, multi-instrument assignments, engine transport | [Instrument Rack and Engine Transport](performance/instrument_rack_and_engine_transport.md) |
| Sequencer tracks, pattern pads, pad looper, transposition | [Sequencer Tracks and Step Editing](performance/sequencer_tracks_and_steps.md), [Pattern Pads, Queued Switching, and Pad Looper](performance/pattern_pads_and_pad_looper.md) |
| Controller sequencers and CC curve editor | [Controller Sequencers](performance/controller_sequencers.md) |
| Piano rolls, scale/mode following, mixed-mode highlighting | [Piano Rolls](performance/piano_rolls.md) |
| Manual MIDI controller panel (up to 6 knobs) | [MIDI Controllers](performance/midi_controllers.md) |
| Performance bundle import/export with conflict resolution | [Performance Import / Export](performance/performance_import_export.md) |
| Audio engine settings (`sr`, `control_rate`, `ksmps`, buffers) | [Audio Engine Settings (Config Page)](configuration/audio_engine_settings.md) |
| Browser audio streaming (WebRTC / Docker mode) | [Browser Audio Streaming (WebRTC)](configuration/browser_audio_streaming_webrtc.md) |
| App-state persistence and defaults | [Persistence and Defaults](configuration/persistence_and_defaults.md) |
| Supported opcode catalog (87 opcodes) | [Supported Opcodes](instrument_design/supported_opcodes.md) |

## File Format Quick Reference

- Instrument definition export: `.orch.instrument.json` or `.orch.instrument.zip`
- Performance export: `.orch.json` or `.orch.zip`
- Csound export from Instrument Design: `.csd`
- ZIP exports are used automatically when referenced GEN01 audio assets are included.

**Navigation:** [Next](instrument_design/instrument_design.md)
