# MIDI Setup and Inputs

**Navigation:** [Up](configuration.md) | [Prev](audio_engine_settings.md) | [Next](browser_audio_streaming_webrtc.md)

This page covers practical MIDI setup and how MIDI input selection works in Orchestron.

## External MIDI Input Binding In Orchestron

External MIDI input is bound in the **Instrument Design Runtime panel** (not on the Config page).

Workflow:

1. Open Instrument Design.
2. Use the Runtime panel `MIDI Input` dropdown.
3. Select the desired backend MIDI input.
4. Start the instrument session and play from your hardware/DAW.

The selected MIDI input is reflected in the Perform page footer status line.

## Internal Performance Controls Do Not Require External MIDI

These features generate MIDI/control events internally and do not require an external MIDI input device:

- sequencer tracks
- controller sequencers
- piano rolls (on-screen keyboard)
- manual MIDI controller knob lanes

External MIDI input is only needed when you want to play Orchestron from outside the app.

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

### No MIDI Inputs Listed

- Ensure your OS/device/virtual bus is enabled (for example IAC Driver on macOS).
- Restart backend and browser after changing system MIDI configuration.

### Perform Page Footer Shows `midi input: none`

- No input is currently bound to the session.
- Bind a MIDI input in the Instrument Design Runtime panel.

### Sequencer/Piano Roll Works But Hardware MIDI Does Not

- This usually means internal controls are working, but no external MIDI input is bound.

## Related Pages

- [Runtime Panel and Compilation Workflow](../instrument_design/runtime_panel_and_compilation.md)
- [Live Status and Safety Controls](../performance/live_status_and_safety_controls.md)

## Screenshots

<p align="center">
  <img src="../../screenshots/instrument_runtime_panel_midi_input_dropdown_open.png .png" alt="Runtime panel MIDI input dropdown" width="560" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Runtime panel MIDI input dropdown expanded with available MIDI inputs.</em></p>

**Navigation:** [Up](configuration.md) | [Prev](audio_engine_settings.md) | [Next](browser_audio_streaming_webrtc.md)
