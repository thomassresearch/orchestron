# Examples

This folder contains example exports for Orchestron in two subfolders:

- `instruments/` contains exported instrument files (`*.orch.instrument.json`, `*.orch.instrument.zip`)
- `performances/` contains exported performance files (`*.orch.json`, `*.orch.zip`)

[Granular Synthesis](instruments/granular_synthesis/README.md) uses two `grain3`
streams and 32 performance controls. Its guide compares `grain3` with `granule`
and includes five sound recipes, audio previews and the native instrument.

The EDM, techno and psy trance instruments are available as native exports:
[Rubber Core FM Bass](instruments/Rubber_Core_FM_Bass.orch.instrument.json),
[Prism FM Pluck](instruments/Prism_FM_Pluck.orch.instrument.json),
[Furnace Techno Stab](instruments/Furnace_Techno_Stab.orch.instrument.json),
[Undertow Motion Pad](instruments/Undertow_Motion_Pad.orch.instrument.json),
[Goa Ray Lead](instruments/Goa_Ray_Lead.orch.instrument.json), and
[Psy Rotor Bass](instruments/Psy_Rotor_Bass.orch.instrument.json).

[Trance Gate](instruments/Trance_Gate.orch.instrument.json) retains CH16/CC24 gating
and adds a swept triangle LFO on CH16/CC29. See its
[controls and setup](../documentation/instrument_design/trance_gate.md).

The [Goa Trance FM Lead](instruments/Goa_Trance_FM_Lead.orch.instrument.json)
retains its stereo `statevar` filters with pitch-dependent stability guards.
See the [guard derivation and validation](../documentation/instrument_design/goa_trance_fm_lead.md).

The [Goa / Psytrance guide](instruments/GOA_PSYTRANCE.md) describes
six more instruments with built-in echoes and reverb: acid lead, FM bleeps,
vowel talker, laser zaps, stepped bubbles, and a rising noise/FM effect.

The [EBM / Dark Wave guide](instruments/EBM_DARKWAVE_INSTR.md) describes thirteen
instruments with per-instance controls: leads, strings, pads, brass, three basses,
plucks, a glass bell, a synthetic choir, industrial stabs, and noise/metal effects.
Both guides include native export links, sound descriptions, suggested registers, and control ranges and defaults.

The [acoustic steel-string guitar pair](instruments/steel_string_guitar/README.md)
provides a monophonic lead with semitone-stepped legato and a matching polyphonic
guitar for chords and sequenced strums. The guide includes native instruments,
listening previews, finger/plectrum and tone controls, and reproduction commands.

The [expressive tenor saxophone](instruments/tenor_saxophone/README.md) provides
one legato reed voice, with velocity-controlled breath, growl and an overblown
squeal at the top of the velocity range. Its guide includes the native instrument,
four performance controls, dry WAV previews and reproducible validation.

[The End of the Summer](performances/the_end_of_the_summer/README.md) is a six-minute
dark-wave performance using Analog Drumkit and eight EBM / Dark Wave instruments.
It includes an editable arrangement, native and Csound exports, a reproducible score,
and a WAV render with two warm passages within the industrial groove.

[Hardtrance Demo](performances/hardtrance_demo/README.md) documents a seven-minute,
146 BPM hard trance arrangement, its instrument settings, and its shared effects routing.

[Psysound II](performances/psysound_ii/README.md) develops Psysound into a separate
seven-minute psytrance performance with a recurring A–B♭–E signature, pad-free
contrasts, a shorter breakdown and a brighter second-half peak. Its native backup,
WAV previews and reproduction files preserve the original Psysound unchanged.

The [Piano — prepiano example](instruments/Piano_prepiano.orch.instrument.json) is a sample-free,
polyphonic piano with MIDI pitch and velocity, ten performance controls and no
rattle or rubber preparations. Its bass and middle registers combine the physical
strings with sparse harmonic reinforcement and shared spectral envelopes,
calibrated against [Salamander Yamaha C5 spectra](https://github.com/sfzinstruments/SalamanderGrandPiano)
(Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)).
The compact revision refines the C4–G5 spectra and decay and reduces hammer noise
on G#5–A#5, while preserving the bass and high-treble character. All ten controls
retain their IDs and settings. The native instrument contains numerical synthesis
parameters, not recordings. The native instrument is approximately 474 KB.

[Piano — From Bass to Bells](performances/Piano_From_Bass_to_Bells.orch.json) is a short
two-hand solo using that piano. Bass and middle-register phrases lead to sustained
treble notes, with varied MIDI velocities, gently spread chords and dry sound.
The native performance includes the updated instrument and an editable score.

[Piano Addiitive Synthesis](instruments/Piano_Addiitive_Synthesis.orch.instrument.zip)
is a separate version with synthetic HETRO files for 14 overlapping registers,
retaining `prepiano` and the same ten controls. Two explicit harmonic oscillators
preserve the dominant attack; `adsyn` supplies the remaining reinforcement.
Its [From Bass to Bells demo](performances/Piano_Addiitive_Synthesis_Demo.orch.zip)
preserves the original notes, timing and velocities. The
[design, comparison measurements and profile builder](../tools/piano_additive/README.md)
document the smaller graph data, runtime reduction and synthesis approximations.

[Piano — The Light That Returns](performances/Piano_The_Light_That_Returns.md)
is a D Dorian solo for one pianist: a mellow recurring theme moves into the warmth
of the natural sixth, retreats, and finds a fuller resolution. Its native bundle
and editable score use four lanes with native chord cells, coordinated two-hand
phrasing, dynamics and expressive timing.

[The Light That Returns — Flowing](performances/Piano_The_Light_That_Returns_Flowing.md)
keeps that melody and adds a more varied left hand: held chords open into broken
figures and rising or falling arpeggios, with both hands together at important
arrivals. It is saved as a separate performance with the latest piano and reverb settings.

[The Light That Returns — Expressive](performances/Piano_The_Light_That_Returns_Expressive.md)
adds subtle shared rubato and phrase-shaped dynamic swells to the Flowing version.
Both hands retain coordinated arrivals, with the same notes, accompaniment and sound settings.

[The Light That Returns — Contrast](performances/Piano_The_Light_That_Returns_Contrast.md)
deepens the quiet minor passages, builds A-based tension before the warm return,
and settles into a sparse ending with a delayed, coordinated final D.

## Import an instrument (Instrument Design -> Import)

[Analog Drumkit](instruments/analog_drumkit/README.md) includes 17 GM-mapped voices
and per-instance controls for breakbeats. Its original kicks, snare and hi-hats
retain their sound at the new controls' defaults; the guide lists all note
numbers, control ranges, synthesis details and reproduction commands.

[Tube Overdrive](instruments/tube_overdrive/README.md) is a warm stereo continuous
effect with Drive, Tone and Output performance controls. It is supplied alongside
the original Overdrive, with an editable graph and reproducible audio comparisons.

[Stereo Flanger](instruments/stereo_flanger/README.md) is a continuous stereo
effect with six performance controls, independent delay lines and signed feedback.
Its example includes a native instrument, editable graph and reproducible previews.

[Stereo Widener, Bit Crusher, and Harmonizer](instruments/continuous_effects/README.md): continuous stereo effects with configurable performance controls.

1. Open the **Instrument Design** tab.
2. Click **Import**.
3. Select a file from `examples/instruments/`.

## Import a performance (Performance -> Import)

1. Open the **Perform** tab.
2. Click **Import** (in the performance/instrument rack area).
3. Select a file from `examples/performances/`.

During import, the app can also import included patch definitions and handle name conflicts (overwrite, rename, or skip), depending on the export file.

## Physical steel-string guitar

[Steel String Guitar — Physical Model](instruments/steel_string_waveguide/README.md)
is a sample-free polyphonic guitar with editable excitation and twelve body modes,
plus pluck-position, palm-mute and natural-variation controls. Its folder contains
the builder, raw and native patches, dry previews and matched-level comparisons.

- [Granular Capture](instruments/granular_capture/README.md): continuous stereo stutter, freeze and grains with step-sequenced MIDI switches.
