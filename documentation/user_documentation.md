# Orchestron User Documentation

**Navigation:** [Next](getting_started.md)

<a id="interactive-architecture-guide"></a>

<a id="scope"></a>

<a id="reading-order"></a>

<a id="instrument-design"></a>

<a id="performance"></a>

<a id="configuration"></a>

<a id="appendix"></a>

<a id="feature-coverage-map"></a>

<a id="file-format-quick-reference"></a>

Orchestron lets you build instruments, arrange music and perform it in your browser. You can start with a built-in instrument, import a supplied sound, or design your own graph of Csound opcodes.

## Start here

Follow [Getting Started](getting_started.md) to make a sound and save a short performance. No external MIDI keyboard or existing instrument library is required. If Orchestron is not running yet, use the [installation and startup instructions](../README.md#install-and-open-orchestron).

The app has three working areas:

- **Instrument Design** creates, edits and saves individual instruments and effects.
- **Perform** assembles saved instruments into a rack, mixes them and plays notes, patterns and songs.
- **Config** adjusts audio-engine and browser playback settings. Language and help are available throughout the app.

Read Instrument Design before Performance when learning the whole app. For ready-made sounds, go directly to Supplied Instruments and Effects. Configuration and the optional authoring tools can be consulted when needed.

## Manual contents

<!-- manual-contents:start -->
- [Getting Started](getting_started.md)
- [Instrument Design](instrument_design/instrument_design.md)
- [Performance](performance/performance.md)
- [Supplied Instruments and Effects](supplied/supplied.md)
- [Configuration](configuration/configuration.md)
- [Appendix: Optional Authoring Tools](appendix/appendix.md)
<!-- manual-contents:end -->

## Musical terms

| Term | Meaning in Orchestron |
| --- | --- |
| Instrument or patch | A saved graph that generates or processes sound. “Patch” is used in some controls and file formats. |
| Rack instance | One use of a saved instrument in a performance, with its own channel, controls and mixer settings. |
| Performance | A saved setup containing instruments, routes, mixer settings and musical material. |
| Track | A lane in the arranger assigned to a source of notes or controller values. |
| Pattern | Musical content such as a melody, drum rhythm or controller curve. |
| Clip | A window that places patterns or phrases on the song timeline; trimming the window retains the underlying content. |
| Arrangement | The song order and timing of clips across tracks. |
| Audition | Temporary playback used to hear an instrument or musical draft before saving it. |
| Workspace | The current editing context. Some workspace state is recovered after reload, but it is not a substitute for saving library entries. |

<a id="save-and-share"></a>

For backups and sharing, see [saving and recovery](configuration/persistence_and_defaults.md), [instrument files](instrument_design/instrument_import_export.md), and [performance files](performance/performance_import_export.md).

**Navigation:** [Next](getting_started.md)
