# Piano Addiitive Synthesis

Import [the instrument](../../examples/instruments/Piano_Additive_Synthesis.orch.instrument.zip) in Instrument Design, or import [the complete demo](../../examples/performances/Piano_Addiitive_Synthesis_Demo.orch.zip) in Perform. The name deliberately preserves the requested spelling. The original prepiano instrument and performance remain available separately.

This playable MIDI piano retains `prepiano`, Stereo Output, and all ten controller IDs, labels, ranges and defaults. Rubber and rattle preparations remain disabled. Its 51 portable HETRO files contain generated integer amplitude/frequency breakpoints, not recordings. The files are bundled in both native and Csound exports.

## Current middle-register refinement: C3–B4

The existing harmonic orders now have individually fitted levels and decay trajectories at C3, D#3, F#3, A3, C4, D#4, F#4 and A4. Four calibration velocities retain continuous interpolation. The added D#3/F#3 anchors capture the large change in harmonic balance between C3 and A3. No additional oscillator or envelope opcodes were added: the instrument still has one `prepiano`, two `oscil3` and five `expsega` nodes.

The physical core and retained second/fourth harmonics use revised middle-register envelope levels. The existing physical-core EQ also reduces excessive second-harmonic sustain on selected notes; the additive second harmonic then restores its measured trajectory. HETRO tracks use more time points for the early body and decay. Attack noise is not increased to imitate the recorded room or microphone sound.

A MIDI mask restricts these changes to notes 48–71. The original C3 HETRO branch remains available for interpolation below C3, while the revised branch supplies C3 upward. The revised A4 branch blends toward the unchanged C5 profile. Bass enrichment and the approved upper-register sound retain their original synthesis. All notes A0–B2 and C5–C8 rendered bit-identically before/after at velocity 92; additional protected notes also matched at simultaneous minimum and maximum controller settings.

| Reference-energy-weighted partial error, 100 ms–4 s | Previous | Revised |
| --- | ---: | ---: |
| 32 calibration recordings: eight pitches × four velocities | 3.240 dB | 0.813 dB |
| 16 independent recorded velocity layers, excluded from fitting | 3.104 dB | 0.833 dB |
| Eight semitone-transposed pitch proxies, excluded from fitting | 3.229 dB | 1.968 dB |

The metric uses 64 ms Hann windows at 4 ms hops, independently tracked partials, local noise subtraction, a fixed before-model loudness reference, and five equally weighted decay stages. The pitch proxies are not recordings of those exact keys; D3 and B3 regress by 0.45 and 0.71 dB respectively. Physical/additive interference and detailed unison beating still differ from the Yamaha. These measurements establish closer spectral envelopes in the tested cases, not a perceptual score or an exact recreation. No listening by ear was performed.

Three redundant middle velocity profiles were removed using a 0.25 dB bank-error limit. The result has 51 files and 156 graph nodes; only overlapping register branches run. The native instrument ZIP is 169,703 bytes, its graph document is 392,855 bytes, and its HETRO payloads total 378,041 bytes. The saved instrument and demo retain their IDs and names.

The update passed 69 audio checks, including all ten controller extremes, increasing RMS across four velocities, eight-note chords, short notes, retriggers, long decay and protected-register comparisons. Both demo export modes render the same 110 notes / 220 note events at 48 kHz stereo for 55.684 seconds, with peaks below 0.643 and silent tails. MIDI bytes and score events, routing, mixer settings and controller overrides are unchanged. Compile preflight, all 51 bundled payloads, deterministic regeneration, frontend production build and Docker frontend build passed. Final Mel/log-STFT views and harmonic-decay plots were inspected.

Numeric data and evidence: [middle_refinement.json](middle_refinement.json), [middle_velocity_basis.json](middle_velocity_basis.json), [middle_refinement_validation.json](middle_refinement_validation.json).

## Preserved bass enrichment

Six files at C1, F#1 and C2 include 61 additional tracks in total, selected from missing partials through number 48. Individual files contain 34–45 tracks in these registers; weak components without reliable reference evidence are omitted. C1/C2 additions follow measured Yamaha inharmonic frequency ratios and independent decay curves. F#1 interpolates those profiles. The additions blend out at C3.

The data are in [bass_enrichment.json](bass_enrichment.json), with reference attribution and source hashes. The builder appends them after fitting the original velocity basis, so additions cannot alter the gain of existing partials. This stage reduced the hard C1/C2 spectral discrepancy from 2.9305 to 2.7378 dB, capturing about 96% of the improvement from extending through partial 80. Adding higher partial counts did not materially improve the sampled middle register.

The earlier bass-only revision passed 47 audio checks and preserved C3–C8 bit-identically. Its historical validation is in [bass_enrichment_validation.json](bass_enrichment_validation.json). The present revision intentionally changes C3–B4 while preserving that enriched bass.

## Synthesis and controls

The original register anchors are MIDI 24, 30, 36, 48, 57, 60, 63, 66, 69, 72, 75, 78, 81 and 83. The middle revision uses the denser anchors described above. Adjacent anchors blend; only overlapping branches perform. Below C1 the first profile is transposed. Harmonic reinforcement fades out at C6, leaving the existing physical/contact model to supply the upper keyboard.

Thirty of the original 32 explicit partial oscillators moved into HETRO. Partials 2 and 4 retain their oscillators, phase and tuning to avoid interference changes with the physical strings. Their envelope levels are now fitted within C3–B4 only. Outside that range their formulas retain the original behavior. The approved G#5–A#5 noise reduction remains in the source model.

`adsyn` changes whole-file amplitude, frequency and speed ([Csound manual](https://csound.com/docs/manual/adsyn.html)). Decay/loss therefore scale the bank's time axis; a shared shelf and gain approximate hardness/strike brightness. The physical strings and retained partials keep their existing per-parameter relationships. Stiffness and detune still affect the physical strings; fixed HETRO frequency tracks do not independently stretch with stiffness. These remain approximations of the original oscillator bank's control response. Csound's fixed-point `adsyn` oscillators also quantize frequency and start at zero phase.

Outside the revised middle, two to four stored velocity profiles reproduce calibration velocities 40/60/92/124 with a 0.5 dB bank-error bound. [velocity_basis.json](velocity_basis.json) records that original basis. Middle profiles use the separate, tighter audit linked above. These limits concern bank amplitudes, not complete audio or arbitrary velocities.

## Initial conversion history

The original conversion reduced `oscil3` from 32 to 2 and `expsega` from 17 to 5. Its graph document shrank from 474,397 to 282,820 bytes; its ZIP was 92,371 bytes. A local eight-note four-second SCORE render benchmark fell from 2.575 to 1.807 seconds median. These numbers predate both the bass enrichment and current middle refinement; they are not current CPU measurements.

Initial conversion comparisons and verification remain in [comparison.json](comparison.json), [off_grid.json](off_grid.json) and [validation.json](validation.json). The initial conversion preserved the previous spectral match with less synthesis work; the middle refinement now improves the harmonic envelopes themselves.

## References and regeneration

The Yamaha reference is Alexander Holm's [Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano), recorded Yamaha C5, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). [fit.json](fit.json), bass enrichment and middle refinement data derive from spectral measurements, with source hashes in their metadata. The instrument and demo contain no Yamaha audio.

From the repository root, with NumPy and the backend dependencies installed:

```sh
.venv/bin/python tools/piano_additive/build_profiles.py --out-dir /tmp/piano-additive-rebuild
```

The builder reads the versioned original piano and numeric refinement data, checks the source graph hash, and writes `revised.json`, `assets.json`, the original `velocity_basis.json`, `middle_velocity_basis.json` and `assets/*.het`. It reproduces all 51 current packaged payloads byte for byte. No reference recordings are required. The raw graph uses local asset names for authoring; upload the files through Orchestron's asset API and replace `sampleAsset` metadata before compile/save. Import the supplied native ZIP for immediate use.

The portable files use `HETRO N`, paired `-1` amplitude / `-2` frequency tracks, integer millisecond breakpoints, and terminal `32767` sentinels. Adaptive linear approximation uses about 0.03 dB curve tolerance above the integer quantization floor. Tracks end at zero. Each file passes Orchestron's HETRO validator.
