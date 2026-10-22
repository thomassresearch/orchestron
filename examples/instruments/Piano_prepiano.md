# Piano — prepiano

[Import the native instrument](Piano_prepiano.orch.instrument.json) in **Instrument Design → Import**, then add it to the Perform rack and route its **Stereo Output** to **Master**. It is a polyphonic Melody instrument with no sample dependencies.

This example uses Csound's [`prepiano`](https://csound.com/docs/manual/prepiano.html) as an ordinary struck-string piano: three slightly detuned strings, fixed pivoting boundaries, and a stationary pickup. Both preparation-table inputs are fixed at zero. There are no rattle, rubber, or scanning controls.

MIDI notes provide pitch through `cpsmidi`. MIDI velocity drives both hammer strength and output amplitude through `ampmidi`, so harder playing changes the strike as well as volume. An `madsr` envelope damps each note after key release. The sound is dry and centered, with equal left/right output; add room reverb in the mixer if desired. The bass and middle register are the most resonant. The native finite-difference model becomes much shorter and more percussive in the high treble; this is a physical-model example rather than a sampled grand piano.

## Performance controls

Settings apply to newly played notes. Sounding notes keep their initialized settings.

| Control | Range | Default | Purpose |
| --- | --- | --- | --- |
| String decay (s) | 0.5–8 | 4 | Native 30 dB decay-time parameter; actual decay also depends on pitch and damping. |
| String detune (cents) | 0–10 | 4 | Total tuning spread across three strings. |
| String stiffness | 0.25–2 | 1 | Relative stiffness, tracked with MIDI pitch. |
| High-frequency loss | 0.0001–0.01 | 0.002 | Damping of upper partials. |
| Hammer mass | 0.5–2 | 1 | Hammer/string mass ratio. |
| Hammer hardness (Hz) | 2000–6000 | 3500 | Hammer vibration frequency and strike character. |
| Strike position | 0.08–0.2 | 0.09 | Base fractional position along the string. |
| Hammer strength | 10–40 | 30 | Maximum strike velocity, scaled by played MIDI velocity. |
| Damper release (s) | 0.05–1.5 | 0.25 | Fade after note-off. |
| Output (dB) | −18–0 | −3 | Per-note output gain. |

Stiffness uses `control × frequency / 60`. Strike position adds `frequency / 24000` to the control value to keep the hammer away from the fixed endpoint on the coarser treble grid. Gain compensation for pitch, mass, stiffness and position keeps the timbre controls useful without excessive level changes. Dense polyphony still adds together at the mixer.

The graph uses the first `prepiano` output followed by `pan2`. This gives a balanced centered pair and avoids the unequal stereo-readout gain in Csound 6.18 when using a stationary pickup. The unused second source output remains available for graph experiments.

## Validation

The completed example passed 35 native Csound renders: host MIDI, MIDI-file and score playback; an 88-key sweep; representative pitch checks; four velocities; repeated notes; all ten performance controls at their minimum and maximum; and a dense eight-note chord with the loudest physical settings. Channels were balanced, samples finite, releases complete, and all renders below clipping. The dense chord peaked at 0.654 (about −3.7 dBFS). Representative C2–C5 pitch checks were within 11 cents, including the modeled string inharmonicity and detune.

Both Mel and log-STFT spectrograms were inspected for the musical preview and matched control comparisons. They showed pitched attacks, decaying chords, the expected decay/hardness changes, and silence after the releases. Listening was not performed. Frontend production and Docker frontend builds also passed.
