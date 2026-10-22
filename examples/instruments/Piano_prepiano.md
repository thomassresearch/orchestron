# Piano — prepiano

[Import the native instrument](Piano_prepiano.orch.instrument.json) in **Instrument Design → Import**, then add it to the Perform rack and route its **Stereo Output** to **Master**. It is a polyphonic Melody instrument with no sample dependencies.

This example uses Csound's [`prepiano`](https://csound.com/docs/manual/prepiano.html) as an ordinary struck-string piano: three slightly detuned strings, fixed pivoting boundaries, and a stationary pickup. Both preparation-table inputs are fixed at zero. There are no rattle, rubber, or scanning controls.

MIDI notes provide pitch through `cpsmidi`. MIDI velocity drives both hammer strength and output amplitude through `ampmidi`, so harder playing changes the strike as well as volume. An `madsr` envelope damps each note after key release. The sound is dry and centered, with equal left/right output; add room reverb in the mixer if desired. Hammer excitation tracks pitch above 400 Hz so the short treble strings receive enough energy to ring. High notes now retain a pitched decay through C8, with gain compensation keeping their level controlled. This is a dry physical-model piano.

## Performance controls

Settings apply to newly played notes. Sounding notes keep their initialized settings.

| Control | Range | Default | Purpose |
| --- | --- | --- | --- |
| String decay (s) | 0.5–8 | 4 | Native 30 dB decay-time parameter; actual decay also depends on pitch and damping. |
| String detune (cents) | 0–10 | 4 | Total tuning spread across three strings. |
| String stiffness | 0.25–2 | 1 | Relative stiffness, tracked with MIDI pitch. |
| High-frequency loss | 0.0001–0.01 | 0.002 | Damping of upper partials. |
| Hammer mass | 0.5–2 | 1 | Hammer/string mass ratio. |
| Hammer hardness (Hz) | 2000–6000 | 3500 | Base hammer parameter and strike character, tracked with pitch in the treble. |
| Strike position | 0.08–0.2 | 0.09 | Base fractional position along the string. |
| Hammer strength | 10–40 | 30 | Maximum strike velocity, scaled by played MIDI velocity. |
| Damper release (s) | 0.05–1.5 | 0.25 | Fade after note-off. |
| Output (dB) | −18–0 | −3 | Per-note output gain. |

Stiffness uses `control × frequency / 60`. Strike position adds `frequency / 24000` to the control value to keep the hammer away from the fixed endpoint on the coarser treble grid. Gain compensation for pitch, mass, stiffness and position keeps the timbre controls useful without excessive level changes. Above 400 Hz, the effective hammer parameter is `hardness × (frequency / 400)²`. The pitch-dependent gain factor is `0.5 + frequency / (200 + max(frequency − 400, 0) / 4)`, which approaches 4.5 in the treble. Below that boundary both formulas retain their original values. These changes preserve all ten controller IDs, labels, ranges and defaults, including existing performance overrides. Dense polyphony still adds together at the mixer.

The graph uses the first `prepiano` output followed by `pan2`. This gives a balanced centered pair and avoids the unequal stereo-readout gain in Csound 6.18 when using a stationary pickup. The unused second source output remains available for graph experiments.

## Validation

The revision passed 84 native Csound renders, including before/after comparisons, host MIDI, MIDI-file and score playback, an 88-key sweep, four velocities, repeated notes, all ten controls at their limits, sixteen combined extreme settings, and dense bass and treble chords. Samples were finite, channels balanced, release tails complete, and peaks below clipping; the loudest tested case reached 0.679 (about −3.4 dBFS).

The bass/middle comparison at C2, C3, C4 and G4 was sample-identical. At default settings and MIDI velocity 100, C6, C7 and C8 all retained pitched energy in the 1–1.5 second window after the attack. Representative C5–C8 pitch checks were within 9 cents. The original string-decay and damper-release controls continue to shape the note tail.

Both Mel and log-STFT spectrograms were inspected for the before/after treble audition and matched control comparisons. Listening was not performed. Frontend production and Docker frontend builds also passed.
