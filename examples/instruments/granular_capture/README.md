# Granular Capture

One continuous stereo insert for stutter, freeze and granular playback. [Usage and controls](../../../documentation/instrument_design/granular_capture.md).

- [Native instrument](../Granular_Capture.orch.instrument.json)
- [Editable raw graph](granular_capture.patch.json)
- [Controller step configuration](step_sequencer.json), ready for a session's sequencer API: 120 BPM, channel 16, CC20–23, Reset Value 0.

From the repository root:

```bash
.venv/bin/python -m examples.instruments.granular_capture.build
.venv/bin/python -m examples.instruments.granular_capture.save
.venv/bin/python -m examples.instruments.granular_capture.render
.venv/bin/python -m pytest backend/tests/test_granular_capture.py -q
```

The builder compiles before writing exports. Each instance stores its own channel, CC mapping and sound settings. Change these performance knobs and restart the rack; MIDI switches work live. Send 0 between capture triggers. Stutter and Freeze keep playing captured audio until released. Granular switches between live-history grains and frozen grains. All playback switches off passes dry, making this an insert rather than an inactive silent send return.

The audition script writes 25 previews (defaults and every performance-controller endpoint), source audio and metrics to `output/granular-capture/`. It includes mono chords, separate stereo tones, noise transients, capture/recapture, mode changes, releases and silence. MIDI-mapping endpoint renders send gestures to the corresponding remapped channel/CC.

To inspect Mel and log-STFT spectra, run the patch skill's `scripts/render_spectrograms.py` for the WAV files and open both resulting images. Tests use independent committed fixtures, never the example graph. Subjective listening must be reported separately from numerical and visual validation.

## Validation — 2026-10-17

- 41 capture/DSP tests pass, including actual sequencer-generated CC events, MIDI/SCORE paths, block sizes 1/32/64/128, measured pitch shifts, mapping endpoints, capture edges, silence, stereo separation and reset tails.
- Compiler/catalog/capture suite: 543 passed. Additional API, export, controller-step and existing effect regressions passed; native round trips and independent instance settings are covered.
- 25 default/endpoint previews were finite, with peak ≤0.100001 and silent final tails. Both Mel and log-STFT images were inspected for all previews. Remapped CC endpoint previews match the default gestures.
- Native macOS and Docker Csound MIDI/SCORE audio smoke tests passed. Frontend and Docker frontend-build passed; the shared raw drumkit build input is preserved.
- Saved through backend compile preflight, loaded and compiled in the UI. The documentation PDF was rebuilt and visually inspected.
- Subjective listening was not performed. No multi-instance realtime load benchmark was performed.
