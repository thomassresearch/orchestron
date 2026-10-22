# Piano — prepiano

[Import the native instrument](Piano_prepiano.orch.instrument.json) in **Instrument Design → Import**, then add it to the Perform rack and route its **Stereo Output** to **Master**. It is a polyphonic Melody instrument with no sample dependencies.

This example uses Csound's [`prepiano`](https://csound.com/docs/manual/prepiano.html) as an ordinary struck-string piano: three slightly detuned strings, fixed pivoting boundaries, and a stationary pickup. Both preparation-table inputs are fixed at zero. There are no rattle, rubber, or scanning controls.

MIDI notes provide pitch through `cpsmidi`. MIDI velocity drives both hammer strength and output amplitude through `ampmidi`, so harder playing changes the strike as well as volume. An `madsr` envelope damps each note after key release. The sound is dry and centered, with equal left/right output; add room reverb in the mixer if desired. Hammer excitation tracks pitch above 400 Hz so the short treble strings receive enough energy to sound pitched. Above 800 Hz, string decay becomes progressively shorter, guided by acoustic-piano recordings. This corrects the previous revision's excessive upper-register ringing while retaining the native physical model.

## Performance controls

Settings apply to newly played notes. Sounding notes keep their initialized settings.

| Control | Range | Default | Purpose |
| --- | --- | --- | --- |
| String decay (s) | 0.5–8 | 4 | Base 30 dB decay parameter, shortened above 800 Hz; actual decay also depends on pitch and damping. |
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

## Acoustic reference comparison

The treble revision was compared with sixteen individual C5–C8 recordings:

- [Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano), Yamaha C5 recordings by Alexander Holm, velocity layers 8 and 12, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MISpiano.html), Steinway & Sons model B played by Evan Mazunik, `mf` and `ff` recordings.

The comparison matches pitch and normalizes each note to its maximum 20 ms RMS.
A fourth-order high-pass at half the fundamental removes microphone/hammer rumble
consistently from both recordings and synthesis for measurement. The table reports
the last crossing of −20 dB in the first five seconds after that maximum, allowing
for unison beating. It measures prominent decay, not complete silence, note-off
release or the opcode's nominal `iT30` value. The model was held for five seconds
at velocity 90. Recorded dynamics do not correspond to an exactly matched MIDI
velocity, and the two pianos differ substantially.

| Note | Acoustic references | Previous model | Revised model |
| --- | --- | --- | --- |
| C6 | 0.56–0.72 s | 0.98 s | 0.78 s |
| C7 | 0.14–0.80 s | 1.26 s | 0.46 s |
| C8 | 0.12–0.18 s | 1.22 s | 0.24 s |

For `t = max(frequency − 800, 0)`, the new native decay parameter is
`String decay / (1 + t / (200 + t) + t / 2000)`. At the default control value of
4 seconds this produces approximately 2.40 at C6, 1.59 at C7 and 1.10 at C8.
The formula changes the model's string damping, without adding a sampled layer
or an artificial key-release cutoff. Notes through G5 retain their prior response.
All ten controller definitions and IDs remain unchanged.

The reference samples are analysis material only; the instrument and performance
exports remain sample-free. Local source URLs, SHA-256 hashes, measurements, decay
plots and an attack-level-matched comparison are under
`output/prepiano/reference_comparison/`. The comparison plays C6, C7 and C8, each
as **Yamaha reference → previous model → revised model**, at 3.3-second intervals.
Reference excerpts are trimmed to three seconds, gain matched and faded over the
last 20 ms; their attribution is also recorded in `CREDITS.txt` there.

## Validation

The revision passed 74 instrument renders, including an 88-key sweep, host MIDI,
MIDI-file and score playback, four velocities, repeated notes, all ten controls
at their limits, eight combined extreme settings and dense chords. Samples were
finite, channels balanced, release tails complete and peaks below clipping;
the loudest tested case reached 0.654 (about −3.7 dBFS).

C2, C3, C4, C5 and G5 comparisons were sample-identical. C6–C8 pitch checks were
within 4 cents. Both saved demo export modes also rendered successfully, and its
MIDI notes, velocities and mixer levels were retained. Mel and log-STFT plots
were inspected after the correction. These are numerical and visual checks;
listening was not performed. Frontend production and Docker frontend builds passed.
