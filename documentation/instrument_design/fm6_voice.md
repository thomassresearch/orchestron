# FM6 Voice and Almost DX7

**Navigation:** [Up](instrument_design.md) | [Previous](gen_table_editor.md) | [Next](control_flow.md)

`fm6_voice` is a dry six-operator synthesizer inspired by 1980s FM sounds. Each sine operator has its own tuning, level, velocity response and ADSR envelope. Operators modulate other operators or contribute directly to the output. This is a simplified phase-modulation instrument, without DX7 SysEx import or exact hardware emulation.

## Start with Almost DX7

[Download Almost DX7](../../examples/instruments/fm/Almost_DX7.orch.instrument.json), import it in Instrument Design and save it. Add the instrument in Perform and route its Stereo Output to Master. Add reverb, chorus or delay as separate mixer effects if desired; the instrument itself contains none.

Each new note reads the performance controls; held notes retain their original settings. Preset accepts whole numbers only. The instrument allows up to 16 simultaneous voices, including release tails.

| Control | Range | Default | Use |
| --- | --- | --- | --- |
| Preset | 1–12, integer | 1 | Select a starter sound below. |
| Brightness | 0–200% | 100% | Scale modulation between operators. |
| Attack | 0.25–4× | 1× | Multiply all six attack times. |
| Release | 0.25–4× | 1× | Multiply all six release times. |
| Vibrato | 0–100 cents | 0 | Pitch vibrato at 5 Hz. |
| Output | −36–0 dB | −12 dB | Gain before the mixer. |

| Preset | Sound | Algorithm |
| --- | --- | --- |
| 1 | Tine Piano | 1 |
| 2 | Soft Electric Piano | 1 |
| 3 | FM Bass | 3 |
| 4 | Slap Bass | 7 |
| 5 | Glass Bell | 1 |
| 6 | Wooden Mallet | 3 |
| 7 | Synth Brass | 5 |
| 8 | Digital Organ | 8 |
| 9 | Bright Pluck | 1 |
| 10 | Evolving Pad | 2 |
| 11 | Metallic Lead | 4 |
| 12 | Shimmer Keys | 6 |

Preset numbers are also listed in the instrument description and opcode **?** help.

![Almost DX7 audition with its integer preset selector and performance controls](../../screenshots/almost_dx7_audition.png)

## Design a voice

Add `fm6_voice` from the **fm** category and click its **FM6** button. The node initially shows frequency, velocity and preset sockets. Expand **Performance inputs** for the others; connected sockets stay visible when collapsed. Double-click a socket to edit its value or formula with the Input Formula Assistant.

![FM6 editor with routing, operators and envelopes](../../screenshots/fm6_voice_editor.png)

1. Choose a starter or **Custom voice (0)**.
2. Choose an algorithm. The diagram shows modulation arrows, audible carriers and operator-6 feedback.
3. Select an operator button and edit its controls. **Copy operator** and **Paste operator** transfer its tuning, level, velocity and envelope together.
4. Set voice feedback and the performance input defaults.
5. Choose **Apply to draft**, then restart draft audition. **Cancel** discards dialog edits. Save the instrument to keep applied changes.

Editing an operator, voice feedback or algorithm copies the starter into **Custom (0)**. Browsing starter presets preserves custom settings. The starter bank itself is unchanged by edits.

Graph-driven fields identify their source and preserve their connections and formulas. The corresponding performance fields are read-only. A connected preset input takes priority over the dialog selection: the dialog then browses voices while the graph decides which sounds. To hear custom edits in Almost DX7, disconnect the preset controller or extend its minimum to **0** and select **0**.

## Eight algorithms

Arrows mean “modulates”; audible outputs are mixed. These are Orchestron numbers, not Yamaha's original numbering. Operator 6 can feed back into itself in every algorithm.

| No. | Name | Modulation paths | Audible operators |
| --- | --- | --- | --- |
| 1 | Three pairs | 2 → 1; 4 → 3; 6 → 5 | 1 + 3 + 5 |
| 2 | Two stacks | 3 → 2 → 1; 6 → 5 → 4 | 1 + 4 |
| 3 | Four plus two | 6 → 5 → 4 → 3; 2 → 1 | 1 + 3 |
| 4 | Deep stack | 6 → 5 → 4 → 3 → 2 → 1 | 1 |
| 5 | Parallel modulators | 2, 3, 4, 5, 6 → 1 | 1 |
| 6 | Shared modulation | 6 → 5; 5 → 1, 2, 3, 4 | 1 + 2 + 3 + 4 |
| 7 | Stack, pair and sine | 6 → 5 → 4; 3 → 2; 1 directly out | 1 + 2 + 4 |
| 8 | Six carriers | All operators directly out | 1 + 2 + 3 + 4 + 5 + 6 |

Three pairs suit layered electric pianos and bells; two stacks allow separately evolving layers. The deep stack produces complex metallic spectra. Six carriers works as a small additive organ: Brightness has no effect there, although operator-6 feedback still works.

## Operator controls

| Control | Range | Meaning |
| --- | --- | --- |
| Enabled | On/off | Silence this operator and its modulation contribution. |
| Ratio | 0.25–32× | Frequency relative to the played note. Fractional ratios support inharmonic sounds. |
| Detune | −100–100 cents | Fine tuning relative to the ratio. |
| Level | 0–100% | Volume for a carrier; modulation depth for a modulator. |
| Velocity sensitivity | 0–100% | At 0, velocity has no effect. At 100, level follows normalized velocity. |
| Attack | 0.001–10 s | Rise from zero to full level. |
| Decay | 0.001–20 s | Fall from full level to sustain. |
| Sustain | 0–100% | Level after attack and decay while held. |
| Release | 0.001–20 s | Fade from the current level after note-off. |

The envelope drawing shows attack, decay, a short held period and release. Actual sustain duration follows the MIDI note. A modulator's envelope changes timbre; a carrier's envelope changes audible level. Short modulator decays create bright attacks with softer bodies.

## Opcode inputs and output

Connect `cpsmidi.kfreq` to Frequency and `ampmidi.iamp` to Velocity, with `ampmidi` scaled to **1**. No external amplitude envelope is needed: FM6 includes six operator envelopes. Connect its mono output through `pan2` to Stereo Output.

Frequency can change during a note. All other inputs initialize with each new note. FM6 supports polyphonic note-activated instruments; Continuous and `midi_legato` are not supported.

FM6 also exposes **Feedback override** and **Vibrato rate**. Override **−1** uses the voice's feedback; **0–100%** replaces it. Thus each starter retains its own feedback when switching presets. Vibrato rate spans **0.1–12 Hz**. Voice feedback spans **0–100%** and always belongs to operator 6.

Carriers use a fixed mix scale, so changing algorithms does not normalize loudness. Adjust carrier levels and Output as needed. Extreme ratios, modulation and feedback can produce aliasing on high notes; reduce those settings for cleaner tones.

**Navigation:** [Up](instrument_design.md) | [Previous](gen_table_editor.md) | [Next](control_flow.md)
