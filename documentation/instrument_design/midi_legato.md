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

## Steel-string guitar example

The [acoustic steel-string guitar pair](../../examples/instruments/steel_string_guitar/README.md)
includes a legato patch that rounds its pitch slide to equal-tempered semitones.
Connected notes preserve the decaying string without another pluck; the phrase's
initial velocity sets its pluck strength. A gap starts a new pluck and reads the
current performance controls. The Slide setting is a smoothing half-time, so
larger intervals take longer to reach their final fret. The matching polyphonic
patch gives each note its own pluck for chords and manually timed strums.
Both guitars use `wgpluck2` with velocity-sensitive pluck position and adjustable damping.
Since that model's pitch is fixed at initialization, a period-synchronous delay
readout transposes the ringing string. The guitar rounds the target pitch before
this readout, with no pitch smoothing afterward and no new excitation at fret changes.
Its default Slide half-time is 0.12 seconds so intermediate
frets have more distinct dwell times. Reset an existing rack override to adopt
this default.

## Expressive tenor saxophone example

[Tenor Saxophone — Expressive Legato](../../examples/instruments/tenor_saxophone/README.md)
uses one continuous STK reed model with velocity-sensitive breath, reed response,
filtering and loudness. Play concert A♭2–E5 (MIDI 44–76); there is no automatic
tenor transposition. Route **Stereo Output → Master** in Perform.

The balanced acoustic revision retunes the reed's blow position, aperture,
stiffness and pressure together, then adds body at 850 Hz and presence at 2,400 Hz.
Normal velocities have a richer upper-harmonic spectrum, with restrained breath
noise and output gain compensated for the stronger excitation. The example guide
provides level-matched before/after previews; the four controls keep their IDs,
ranges and defaults so existing performance overrides remain valid.

Velocities 1–95 cover normal playing, 96–114 progressively add growl, and 115–127
blend in a sustained overblown octave squeal. Hard connected notes can provoke
the squeal; softer notes and held-note fallback restore their own velocity.
Gaps restart a 10–35 ms tongue contour followed by 80 ms settling; release is
100 ms. Tone, Growl, Squeal and Vibrato are 0–1 performance controls, with defaults
0.5, 0.35, 0.65 and 0.2. Zero Growl/Squeal disables its added effect. Knob changes
apply at the next phrase, while note velocity remains live throughout legato.

The native model fixes pitch at initialization, so period-synchronous delay
readouts transpose the same reed signal for legato and overblowing. The readout
can add up to two initial note periods of delay, and wide leaps can color the
timbre. The graph stays editable using existing opcodes. Csound STK and its
rawwave data are required and included in Orchestron's Docker image. The example
guide includes native import instructions, control translations and WAV previews.

## Implementation references

[Csound release](https://csound.com/docs/manual/release.html), [madsr](https://csound.com/docs/manual/madsr.html), [reinit](https://csound.com/docs/manual/reinit.html), [portk](https://csound.com/docs/manual/portk.html).
