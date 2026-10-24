# Registers, velocity and performance controls

[Documentation home](../README.md) · [Architecture](architecture.md) · [HETRO generation](hetro-and-reproduction.md)

## Keyboard regions

Note names use C4 = MIDI 60. The instrument is validated across the conventional A0–C8 range; individual comparisons cover selected pitches and velocities, not every possible setting.

| Region | Current treatment |
| --- | --- |
| Below C1 | Transpose the first additive anchor; retain the physical model |
| C1, F#1, C2 anchors (24, 30, 36) | Original harmonic profiles plus selected missing bass partials through index 48 |
| Below C3 | Keep the original C3 anchor as an interpolation endpoint; bass enrichment fades to zero at C3 |
| C3–B4 (48–71) | Revised levels and decay of existing partials, with anchors at 48, 51, 54, 57, 60, 63, 66, 69 |
| C5–B5 | Original upper profiles at 72, 75, 78, 81, 83; overall additive reinforcement fades toward C6 |
| C6 and above | Additive gate reaches zero; existing physical/contact treatment remains |

Adjacent anchor weights are clamped triangular/linear functions of MIDI note. Only branches with nonzero register weight perform. Stored-file count is therefore not a count of simultaneously active banks. Between middle anchors, two register branches can contribute, each with its selected velocity files.

The original C3 branch is still needed by notes below C3. Replacing its HETRO files directly would have changed the accepted bass through interpolation. The latest revision instead adds a separate middle C3 branch and uses a mask that is exactly one for integer MIDI 48–71 and zero outside. The mask ramps across 47–48 and 71–72. The middle A4 branch blends toward the unchanged C5 profile.

The middle physical-envelope formulas also retain their old expressions outside the mask. Preservation was checked acoustically, not just by inspecting file names: every note A0–B2 and C5–C8 matched bit for bit at velocity 92, plus selected protected notes at all-minimum and all-maximum controls.

## Pitch and velocity interpolation

The calibration velocities are 40, 60, 92 and 124. These select Yamaha sample layers 4, 8, 12 and 16 in the reference library; they do not represent measured physical hammer speeds.

The original bank stores two to four profiles per register. A nonnegative least-squares fit removes redundant velocity files when the energy-weighted amplitude error remains within 0.5 dB at each calibration point. The refined middle uses a tighter 0.25 dB bound. Three middle files were removed; 29 new middle profiles replace 12 old profiles, leaving 51 total including 22 unchanged files. See the [middle basis audit](../../../../tools/piano_additive/middle_velocity_basis.json).

HETRO profile gains interpolate continuously over MIDI velocity and register. Values below velocity 40 retain a soft-velocity scaling factor. The fitted middle physical/retained-oscillator envelope levels interpolate in decibels. These operations are not identical, so the complete instrument is always rendered again after fitting.

A single HETRO file's partial frequencies are scaled together by `MIDI_frequency / 250`. Individual stored ratios can be inharmonic; “partial 8” does not promise exactly eight times the fundamental. Within one file, frequencies are constant over time in this design, while amplitudes have independent trajectories.

## The ten preserved controls

Controls are per-instance initialization settings: new notes adopt changed values. IDs, labels, ranges and defaults are unchanged by the additive and middle-register revisions.

| Label | ID | Range | Default | Scale |
| --- | --- | --- | ---: | --- |
| Damper release (s) | `piano_release` | 0.05–1.5 | 0.25 | Logarithmic |
| String decay (s) | `piano_decay` | 0.5–8 | 4 | Logarithmic |
| String detune (cents) | `piano_detune` | 0–10 | 4 | Linear |
| String stiffness | `piano_stiffness` | 0.25–2 | 1 | Logarithmic |
| High-frequency loss | `piano_loss` | 0.0001–0.01 | 0.002 | Logarithmic |
| Hammer mass | `piano_mass` | 0.5–2 | 1 | Logarithmic |
| Hammer hardness (Hz) | `piano_hardness` | 2000–6000 | 3500 | Logarithmic |
| Strike position | `piano_strike` | 0.08–0.20 | 0.09 | Linear |
| Hammer strength | `piano_strength` | 10–40 | 30 | Linear |
| Output (dB) | `piano_level` | −18–0 | −3 | Linear |

The exact authored definitions are in the [design snapshot](../analysis/data/middle/design_snapshot.json).

The physical strings retain their parameter-dependent response. The additive bank approximates some of that response through shared transformations:

- **Decay and loss:** change HETRO playback speed using `4 / decay × (1 + loss / 0.002 × 0.25) / 1.25`. It equals one at defaults. Faster traversal means shorter partial envelopes.
- **Hardness and strike:** modify a shared harmonic gain and shelf. They do not independently recompute every partial's excitation.
- **Mass, strength and output:** also influence the additive gate/gain; those controls are not exclusive to `prepiano`.
- **Release:** gates the sounding note after note-off; reaching a file's final breakpoint is not the sole release mechanism.
- **Stiffness and detune:** affect physical strings, but do not individually stretch or detune the fixed HETRO tracks.

Consequently, unchanged controls means the same user interface and operative mappings, not that every timbre at every knob setting is an exact Yamaha match. Likewise, the String decay value is a model parameter, not a guaranteed measured decay time for the mixed output. The earlier isolated-string diagnostic showed why reading a knob value as an acoustic T30 would be misleading.
