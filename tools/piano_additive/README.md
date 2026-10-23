# Piano Addiitive Synthesis

Import [the instrument](../../examples/instruments/Piano_Addiitive_Synthesis.orch.instrument.zip) in Instrument Design, or import [the complete demo](../../examples/performances/Piano_Addiitive_Synthesis_Demo.orch.zip) in Perform. The name deliberately preserves the requested spelling. Both are separate additions; the original piano and performance are unchanged.

This playable MIDI piano retains `prepiano`, Stereo Output, and all ten controller IDs, labels, ranges and defaults. Rubber and rattle preparations remain disabled. Its 34 portable HETRO files contain generated integer amplitude/frequency breakpoints, not recordings. The files are bundled in both native and Csound exports.

## Registers and synthesis

The anchors are C1, F#1, C2, C3, A3, C4, D#4, F#4, A4, C5, D#5, F#5, A5 and B5 (MIDI 24, 30, 36, 48, 57, 60, 63, 66, 69, 72, 75, 78, 81, 83). Adjacent anchors blend; only overlapping register branches perform. Below C1 the first profile is transposed. The reinforcement fades out at C6; the existing physical/contact model supplies the upper keyboard.

Two to four velocity files per register reproduce the four calibration velocities 40/60/92/124 with continuous gain interpolation. A nonnegative fit removes redundant stored profiles when the energy-weighted bank amplitude error stays within 0.5 dB at each calibration velocity. This bound concerns the fitted bank data, not complete audio or arbitrary velocities. [velocity_basis.json](velocity_basis.json) records the retained files and coefficients.

Thirty of the former 32 explicit partial oscillators move into HETRO. Partials 2 and 4 retain their exact oscillator, phase, tuning and envelope formulas: replacing those caused interference with the physical strings and weakened the approved attack. Weaker upper partials in the middle register regain independent decay curves instead of sharing four envelopes. The approved bass curves and G#5–A#5 noise reduction remain in the source model.

`adsyn` changes whole-file amplitude, frequency and speed ([Csound manual](https://csound.com/docs/manual/adsyn.html)). Decay/loss therefore scale the bank's time axis; a shared shelf and gain approximate hardness/strike brightness. The physical strings and retained partials keep their original per-parameter behavior. Stiffness and detune still affect the physical strings; the fixed HETRO frequency tracks do not independently stretch with stiffness. These are explicit approximations of the new bank, not identical knob transfer functions. Csound's fixed-point `adsyn` oscillators also quantize frequency and start at zero phase; keeping the two dominant oscillators avoids the largest resulting interference errors.

## Complexity and comparison

| Measurement | Current piano | Additive piano |
| --- | ---: | ---: |
| `prepiano` | 1 | 1 |
| `oscil3` | 32 | 2 |
| `expsega` | 17 | 5 |
| `adsyn` definitions | 0 | 34 |
| Graph nodes, including structural branch markers | 99 | 130 |
| Graph connections | 722 | 492 |
| Native graph JSON bytes | 474,397 | 282,820 |
| Total uncompressed bundle bytes | 474,397 | 468,276 |
| Delivered native export | JSON, 474,397 bytes | ZIP, 92,371 bytes |
| Eight-note 4-second SCORE render, median | 2.575 s | 1.807 s |

The graph JSON is 40.4% smaller and the local render benchmark takes 29.8% less time. The extra graph nodes are mainly register selection/result markers; this is not a reduction in total editor-node count. The ZIP-size reduction also includes compression and should not be interpreted as an equivalent reduction in uncompressed model data. Benchmark timings exclude compilation and include Csound initialization/rendering; they are not a universal CPU guarantee.

At velocity 92, measured C4–F#5 stage levels differ from the current piano by at most 0.020 dB over 100 ms–4 s. The Yamaha energy-weighted partial discrepancy is effectively unchanged: 1.617 to 1.617 dB across those seven anchor notes. Bass C1/C2 stage-level changes remain below 0.20 dB in this check. Across 45 additional note/velocity combinations between profiles, the largest measured level difference is 0.73 dB, including 0.41 dB in the first 25 ms. This wider check exposed a bass interpolation error and motivated the F#1 profile.

These measurements support preserving the current timbre with less runtime work. They do not establish a perceptual improvement or an exact Yamaha match. The restored independent weak-partial decays improve model detail, but the measured overall Yamaha score changes negligibly. The original physical attack, unison beating, body radiation and recorded room still differ from the Yamaha; no extra noise has been added to imitate its microphone/room sound. See [comparison.json](comparison.json), [off_grid.json](off_grid.json), and [validation.json](validation.json).

The Yamaha reference is Alexander Holm's [Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano), recorded Yamaha C5, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Numeric fitting data in [fit.json](fit.json) derive from earlier spectral measurements. The instrument and demo contain no Yamaha audio.

## Reproduce the synthetic files

From the repository root, with NumPy and the backend dependencies installed:

```sh
.venv/bin/python tools/piano_additive/build_profiles.py --out-dir /tmp/piano-additive-rebuild
```

The builder reads the versioned original piano, checks its graph hash, and writes `revised.json`, `assets.json`, `velocity_basis.json` and `assets/*.het`. It reproduces all 34 packaged HETRO payloads byte for byte. The raw graph uses local asset names for authoring; upload these files through Orchestron's asset API and replace `sampleAsset` metadata before compile/save. Import the supplied native ZIP for immediate use without that authoring step.

The portable files use `HETRO N`, paired `-1` amplitude / `-2` frequency tracks, integer millisecond breakpoints, and terminal `32767` sentinels. Adaptive linear approximation uses about 0.03 dB curve tolerance above the integer quantization floor. Tracks end at zero. Header/track validation runs through Orchestron's HETRO validator.

## Verification

- Fifty held-note renders, 45 additional combinations between profiles, and 31 control/boundary/chord/retrigger/release/offline checks passed. All ten controls were exercised at minimum/default/maximum. Four anchor velocities have increasing measured RMS.
- Both demo export modes rendered at 48 kHz stereo, 55.684 seconds. SCORE peak 0.640; MIDI peak 0.643; both finish in silence. All 220 note events, routing, mixer settings and controller overrides match the original performance.
- Compile preflight, native ZIP expansion, asset inclusion and deterministic regeneration passed. The original saved instrument and performance remained unchanged.
- Final Mel/log-STFT views of the demo, three-way comparison, controller audition and 88-key sweep were generated and opened; attack and temporal-evolution figures were also inspected. No listening by ear was performed.
- Frontend production build and Docker frontend build passed, with the existing frontend chunk-size warning. The shared raw analog-drumkit build input exists.
