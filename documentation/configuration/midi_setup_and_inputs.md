# MIDI Setup and Inputs

**Navigation:** [Up](configuration.md) | [Prev](audio_engine_settings.md) | [Next](browser_clock_latency.md)

This page covers practical MIDI setup and how external MIDI binding works in Orchestron's unified browser-clock runtime.

## External MIDI Input Binding In Orchestron

External MIDI input is bound in the **Instrument Design Runtime panel** (not on the Config page).

Workflow:

1. Open Instrument Design.
2. Use the Runtime panel `MIDI Input` dropdown.
3. Select the desired input:
   - `internal:loopback` for the built-in app-only loopback
   - a `host_bridge` input published by `host-midi-helper` for external hardware or DAW MIDI
4. Start the instrument session and play from your hardware/DAW.

The selected MIDI input is reflected in the Perform page footer status line.

## Internal Performance Controls Do Not Require External MIDI

These features generate MIDI/control events internally and do not require an external MIDI input device or host bridge:

- melodic sequencers
- controller sequencers
- piano rolls (on-screen keyboard)
- manual MIDI controller knob lanes

External MIDI input is only needed when you want to play Orchestron from outside the app. Internal MIDI is always delivered directly into the session engine and ignores the external input binding.

## External MIDI Bridge

The backend no longer relies on direct OS MIDI enumeration for session playback. External MIDI arrives through the optional Rust host bridge in [`host-midi-helper/`](../../host-midi-helper/README.md).

General setup pattern:

1. Start the backend with `VISUALCSOUND_HOST_MIDI_TOKEN` set.
2. Start `host-midi-helper` on the same host OS with the same token.
3. Bind the helper-published input in the Runtime panel.

If no helper is running, `internal:loopback` remains available and internal performance tools still work.

## macOS Loopback Setup (IAC Driver)

For DAW/app -> Orchestron MIDI routing on macOS:

1. Open **Audio MIDI Setup**.
2. Open **MIDI Studio**.
3. Open **IAC Driver**.
4. Enable **Device is online**.
5. Add/select an IAC bus (for example `IAC Driver Bus 1`).
6. Route your DAW/app MIDI output to that IAC bus.
7. Select that input in Orchestron's Runtime panel.

## Troubleshooting MIDI Inputs

### No External MIDI Inputs Listed

- Ensure your OS/device/virtual bus is enabled (for example IAC Driver on macOS, ALSA/JACK route on Linux, loopMIDI on Windows).
- Confirm `host-midi-helper` is running and uses the same token as the backend.
- Restart the helper after changing system MIDI configuration.

### Perform Page Footer Shows `midi input: internal:loopback`

- Internal app MIDI is working.
- External hardware/DAW MIDI will not reach the session until a helper-provided input is bound.

### Sequencer/Piano Roll Works But Hardware MIDI Does Not

- This usually means internal controls are working, but no external helper-provided MIDI input is bound.

## Related Pages

- [Runtime Panel and Compilation Workflow](../instrument_design/runtime_panel_and_compilation.md)
- [Live Status and Safety Controls](../performance/live_status_and_safety_controls.md)

## Screenshots

<p align="center">
  <img src="../../screenshots/instrument_runtime_panel_midi_input_dropdown_open.png" alt="Runtime panel MIDI input dropdown" width="560" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Runtime panel MIDI input dropdown expanded with available MIDI inputs.</em></p>

**Navigation:** [Up](configuration.md) | [Prev](audio_engine_settings.md) | [Next](browser_clock_latency.md)
