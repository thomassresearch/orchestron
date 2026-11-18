# FM6 voice contract

`fm6_voice` embeds `vcs_fm6_voice` once in each compiled orchestra. The same emitter
serves standalone compilation, mixer compilation, partition lowering and both
offline export modes. It returns dry mono audio and owns no global channels,
tables, random streams or effects. Use `pan2` and normal Stereo Output routing.

## Persistent voice data

`backend/app/data/fm6.json` is shared by Python and TypeScript. Its version-one
bank owns algorithm routing, operator ranges, custom defaults and twelve presets.
Existing preset IDs and voice definitions are stable; append new entries rather
than changing the sounds of saved performances. The regression test pins the
bank digest. Intentional future bank expansion must retain existing entries.

Node parameters store `algorithm`, `feedback` and `op1_…` through `op6_…` fields.
The input `ipreset` selects custom parameters at 0 and bank entries at 1–12.
Selecting a bank entry preserves custom parameters. Editing a bank voice copies
its full effective definition to custom and selects 0. Graph connections/formulas
still take priority over stored port values; the editor explains this precedence.
Voice fields are finite bounded numbers validated at the API and compiler boundary.
Numeric preset literals must be whole numbers in range. Wired/scalar expressions
are resolved by the existing graph compiler and bounded at note initialization.

## Synthesis and lifetime

Each voice has six private sine phases, six linear `madsr` envelopes and a private
note-synchronous vibrato phase. Frequency accepts K/I rate; velocity and all
performance settings initialize once per note. Operator frequency is base pitch
times ratio times cent detuning. Enabled operator level is
`level/100 * (1 - sensitivity/100 * (1 - velocity))`.

An edge carries `8 * brightness/100 * source_output` radians of phase modulation.
Parallel edges sum. Operator 6 alone adds self-feedback, using four radians times
the feedback fraction times the mean of its preceding two output samples. UDO
`setksmps 1` makes this independent of the enclosing engine block size. Operators
evaluate from 6 down to 1; all non-feedback edges point to a lower number.

Only selected carriers reach the output. Their sum uses fixed gain `ampdb(igain)/6`;
it is not dynamically normalized. Independent release times are explicit in each
`madsr` call so Csound's longest-release default cannot stretch shorter envelopes.
The note lives through the longest operator release. Continuous instruments and
`midi_legato` phrases are explicitly rejected. No oversampling, hardware DAC model,
DX envelope-rate emulation or SysEx decoding is claimed.

Feedback input −1 follows the selected voice's feedback; 0–100 overrides it.
Brightness affects edges only, so algorithm 8 (six carriers) ignores Brightness.
Muted operators contribute neither audio nor modulation. Phase resets at note-on.

## Editor and supplied instrument

`Fm6VoiceEditor` uses the existing modal frame and localized EN/DE/FR/ES copy.
It edits a local draft, validates fields, previews routing and ADSR, and supports
operator copy/paste. Apply preserves graph wiring, formulas and other metadata.
Cancel does not mutate the graph. Performance inputs driven by the graph show
their sources. The graph node folds unconnected optional controls; connected
controls stay visible. Applied graph edits follow existing audition-restart rules.

Almost DX7 is a separate additive example with six stable performance controller
IDs: `fm6_preset`, `fm6_brightness`, `fm6_attack`, `fm6_release`, `fm6_vibrato`,
`fm6_gain`. Preset is integer 1–12; all controls have initialization update mode.
The graph contains MIDI pitch/normalized velocity, FM6, centered pan, Stereo Output
and a 16-voice allocation limit. Effects belong in external mixer routing.
Tests read the independent versioned fixture, never developer examples.

## Verification

Native regression tests compare all eight algorithms with an independent NumPy
phase-modulation reference, exercise all preset tails, verify block sizes 1/16/64,
feedback ownership, overlapping notes, rack-instance isolation, velocity, tuning,
brightness, gain, attack/release scales and MIDI/score sound parity. API tests cover
catalog metadata, invalid parameters, integer controllers, native round trips and
both CSD exports. React tests cover all four languages, preset/custom preservation,
operator copy/paste, invalid edits, cancellation, graph sources and Rete integration.

A local 48 kHz audition used all twelve presets with soft/hard notes, octave notes,
chords and complete tails. Every exposed controller was checked at its minimum,
default and maximum. Samples were finite, stereo channels matched, representative
outputs stayed below clipping and tails became silent. Both Mel and logarithmic
STFT images were opened and inspected. This is numerical/visual validation, not a
listening assessment. A six-second 16-voice render at ksmps 64 took 1.87 seconds
including Python PCM copying on the development Mac; it is not a deployment guarantee.

The Docker frontend target, full image and a browser-driven isolated native audition
were also checked. User documentation is in `documentation/instrument_design/fm6_voice.md`.
