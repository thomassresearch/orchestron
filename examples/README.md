# Examples

This folder contains example exports for Orchestron in two subfolders:

- `instruments/` contains exported instrument files (`*.orch.instrument.json`, `*.orch.instrument.zip`)
- `performances/` contains exported performance files (`*.orch.json`, `*.orch.zip`)

The EDM, techno and psy trance instruments are available as native exports:
[Rubber Core FM Bass](instruments/Rubber_Core_FM_Bass.orch.instrument.json),
[Prism FM Pluck](instruments/Prism_FM_Pluck.orch.instrument.json),
[Furnace Techno Stab](instruments/Furnace_Techno_Stab.orch.instrument.json),
[Undertow Motion Pad](instruments/Undertow_Motion_Pad.orch.instrument.json),
[Goa Ray Lead](instruments/Goa_Ray_Lead.orch.instrument.json), and
[Psy Rotor Bass](instruments/Psy_Rotor_Bass.orch.instrument.json).

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

[The End of the Summer](performances/the_end_of_the_summer/README.md) is a six-minute
dark-wave performance using Analog Drumkit and eight EBM / Dark Wave instruments.
It includes an editable arrangement, native and Csound exports, a reproducible score,
and a WAV render with two warm passages within the industrial groove.

[Hardtrance Demo](performances/hardtrance_demo/README.md) documents a seven-minute,
146 BPM hard trance arrangement, its instrument settings, and its shared effects routing.

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
