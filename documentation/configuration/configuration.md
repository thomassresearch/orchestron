# Configuration

**Navigation:** [Up](../user_documentation.md) | [Prev](../performance/live_status_and_safety_controls.md) | [Next](gui_language_and_integrated_help.md)

The Configuration chapter covers both UI-visible settings and practical runtime/deployment behaviors that affect how Orchestron is used.

## What Is Covered

- GUI language switching and integrated help/docs behavior
- Config page engine settings (`sr`, control rate, buffers, derived `ksmps`) plus browser-clock latency controls when relevant
- MIDI setup and runtime input binding workflow
- Browser audio modes (`browser_clock` PCM, `streaming` WebRTC) vs local audio mode
- Docker/browser-clock latency tuning from the Config page
- App-state persistence and default values

## Chapter Contents

- [GUI Language and Integrated Help](gui_language_and_integrated_help.md)
- [Audio Engine Settings (Config Page)](audio_engine_settings.md)
- [MIDI Setup and Inputs](midi_setup_and_inputs.md)
- [Browser Audio Streaming (WebRTC)](browser_audio_streaming_webrtc.md)
- [Browser-Clock Latency](browser_clock_latency.md)
- [Persistence and Defaults](persistence_and_defaults.md)

## Configuration Scope Clarification

Orchestron has two kinds of configuration:

- **Patch-level configuration** (stored with a patch, editable in the Config page)
- **Runtime/startup configuration** (backend launch mode, especially local vs browser-clock PCM vs WebRTC streaming audio)
- **Workspace runtime tuning** (browser-clock latency settings stored in app state)

Both are important for successful use.

## Screenshots

<p align="center">
  <img src="../../screenshots/config.png" alt="Configuration page overview" width="1100" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Configuration page overview of engine settings. The dedicated Browser-Clock Latency chapter shows the browser-clock-specific tuning section in detail.</em></p>

**Navigation:** [Up](../user_documentation.md) | [Prev](../performance/live_status_and_safety_controls.md) | [Next](gui_language_and_integrated_help.md)
