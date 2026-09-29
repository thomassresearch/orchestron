# Monophonic Legato

**Navigation:** [Up](instrument_design.md) | [Opcode catalog](opcode_catalog_and_documentation.md)

## Phrase Behavior

Add one **midi_legato** node from **MIDI** to the main graph of a MIDI instrument. Connect **Frequency (Hz)** to control-rate oscillator frequencies and **Velocity** to amplitude and blowing-pressure formulas. At least one **madsr** phrase envelope is required; compilation fails without it. Keep **cpsmidi** and **ampmidi** for initial values needed by init-rate inputs.

- Touching and overlapping notes share one synthesis voice. Pitch changes immediately without glide. Envelopes, oscillator phase, resonances and vibrato continue.
- The last note played has priority. Releasing it returns to the most recently held note, including its velocity.
- Velocity is MIDI velocity divided by 128, matching `ampmidi 1`. Its first value is immediate; changes have a **10 ms half-time**.
- A gap starts a new phrase, even during a release tail. Initialization contours and performance-controller values refresh then. Connected notes retain phrase-initial settings and do not repeat attack bursts or pressure overshoots.
- All events within the existing Csound control boundary settle together. There is **no extra legato grace period**. Live resolution follows `ksmps`; CSD exports use `ksmps=1`.
- `madsr` retains delay, attack, decay, sustain and release semantics, including explicit `ireltim`. A new phrase applies a 2 ms amplitude declick to interrupt an old release; this is not pitch glide.
- `maxalloc` limits synthesis voices; internal note collectors remain available. Each rack instance has separate state. Live MIDI, sequencers and MIDI/SCORE CSD exports use the same phrase logic. Stopping the instrument engine clears its phrase state; MIDI panic releases the phrase. Stopping a sequencer releases its own notes without stopping other devices or the rack engine.

This is an **Orchestron virtual opcode**, not a native Csound opcode. Use it once, outside If/Switch cases, on a MIDI-activated instrument. Native release/turnoff opcodes other than `madsr` are not supported in a legato graph. Patches without this node retain their normal voice behavior. Recompile/restart a running instrument after adding it.

## Implementation references

[Csound release](https://csound.com/docs/manual/release.html), [madsr](https://csound.com/docs/manual/madsr.html), [reinit](https://csound.com/docs/manual/reinit.html), [portk](https://csound.com/docs/manual/portk.html).
