# Synthetic HETRO files and reproducible construction

[Documentation home](../README.md) · [Architecture](architecture.md) · [Analysis method](../analysis/reference-and-method.md)

## From measurement to an authored instrument

The Yamaha recordings are a reference for numeric trajectories. The playable instrument uses analytically generated sinusoids and physical strings, not slices of the reference audio.

The current builder starts from the preserved compact [prepiano graph](../../Piano_prepiano.orch.instrument.json). It checks the source graph's SHA-256 before transforming it, removes most explicit partial oscillators and their envelopes, creates register branches, writes HETRO files, and rewires their sum into the original output structure. Two oscillators remain for partials 2 and 4.

The production inputs are:

| Input | Purpose |
| --- | --- |
| [build_profiles.py](../../../../tools/piano_additive/build_profiles.py) | Common graph construction, base profiles, adaptive breakpoint encoding and original velocity-basis fitting |
| [fit.json](../../../../tools/piano_additive/fit.json) | Earlier measured partial levels used to restore independent weaker-partial decay |
| [bass_enrichment.json](../../../../tools/piano_additive/bass_enrichment.json) | Selected missing bass components, reference provenance and hashes |
| [refine_middle.py](../../../../tools/piano_additive/refine_middle.py) | Middle-only branch replacement, envelope formulas and file generation |
| [middle_refinement.json](../../../../tools/piano_additive/middle_refinement.json) | Fitted C3–B4 levels, frequency ratios, EQ cuts, time points and source metadata |

The existing generator beside the documentation README is an older snapshot. The paths in this table are authoritative for the current instrument.

## Portable file structure

The generator writes ASCII HETRO, validated by Orchestron's [analysis-file validator](../../../../backend/app/services/adsyn_analysis.py). This format is not a WAV or a table of samples. A minimal one-partial example is:

```text
HETRO 1
-1,0,30000,1000,0,32767
-2,0,250,1000,250,32767
```

`HETRO N` declares the number of partials. Each partial has an amplitude track beginning with `-1` and a frequency track beginning with `-2`; the generator emits them as pairs. Each track contains integer `(time_ms, value)` pairs and ends with the standalone sentinel `32767`, which is not another time/value pair. Times are nondecreasing, nonnegative and below 32767; values are nonnegative and at most 32767. Header count and amplitude/frequency track counts must agree. Each track needs at least one breakpoint. The example above is structural, not a piano preset.

The official [`adsyn` documentation](https://csound.com/docs/manual/adsyn.html) describes the resynthesis controls. For this implementation, the repository validator and generated portable files are the source of truth for the text representation.

## Amplitude, frequency and time normalization

A file's largest authored amplitude is normalized to integer 30,000, leaving headroom below the signed 16-bit limit. If `norm = 30000 / largest_level`, the emitted amplitude multiplier includes `65536 / norm`, followed by the profile's velocity/register weights and shared control gains. Preserve this compensation when changing file contents; normalizing each file without adjusting its gain would change the sound.

Frequencies are encoded at a nominal **250 Hz reference fundamental**:

```text
stored_frequency = round(250 × fitted_partial_ratio)
kfmod             = desired_MIDI_frequency / 250
```

This supports transposition while keeping the represented ratios inside the integer range. It also introduces frequency quantization. A proposed new high partial must satisfy `250 × ratio <= 32767`; a higher index is not automatically representable when low strings are strongly inharmonic.

Middle profiles use amplitude time points at 0, 50, 100, 150, 250, 400, 600, 800, 1200, 1500, 2000, 3000, 4000, 6000 and 13000 ms. Log-amplitude interpolation describes the authored curves; adaptive linear breakpoints approximate them to about 0.03 dB above the integer quantization floor. The emitted amplitude tracks end at zero. The same partial's frequency track remains constant here. Shared `ksmod` scales the traversal time, as described in [controls](registers-and-controls.md).

HETRO amplitude quantization means very weak tails cannot retain arbitrary precision. This design does not add noise to hide that floor. Note-off envelopes and runtime release handling remain necessary even when files end at zero.

## Minimal complexity without flattening the timbre

The first conversion moved 30 of 32 explicit oscillators into files. This reduced separate DSP nodes and large formula/envelope structures. It did not eliminate additive oscillators internally: `adsyn` still performs oscillator-bank synthesis.

Files are partitioned by register so one global profile need not approximate the whole keyboard. Only overlapping branches perform. Nonnegative velocity-basis fitting then removes redundant stored files. The middle refinement keeps extra profiles where reducing them would exceed its 0.25 dB bank-error bound. The current 51-file model is a quality-constrained compromise, not a proof of minimum possible complexity.

The base bass normalization and gain coefficients are deliberately frozen before appending enrichment. This prevents a small new upper partial from renormalizing all established bass components. The old C3 branch is also preserved for below-C3 interpolation.

## Rebuild the current instrument data

Run from the repository root, with NumPy and the backend dependencies installed:

```sh
.venv/bin/python tools/piano_additive/build_profiles.py \
  --out-dir /tmp/piano-additive-rebuild
```

The builder writes:

- `revised.json`: raw authored graph using local asset identifiers.
- `assets/*.het` and `assets.json`: the 51 referenced synthetic profiles and their metadata.
- `velocity_basis.json`: original register fitting audit.
- `middle_velocity_basis.json`: selected middle profiles, coefficients and errors.

It does not download recordings or refit them. The saved numeric parameters make synthesis regeneration independent of the old experimental directories. All 51 emitted payloads and the generated graph matched the validated candidate in the recorded rebuild check.

For immediate use, import the current native bundle linked from the README. For authoring through the API, upload each HETRO payload through `/api/assets/gen-audio`, replace local `sampleAsset` metadata with returned managed metadata, then compile before saving. Raw local paths are not valid uploaded assets. Native bundles package the managed payloads; both SCORE and MIDI CSD exports also include required HETRO files.

The archived measurements document the fitting process, but do not constitute a standalone re-analysis toolchain. Re-running the original spectral experiments requires their audio sources and analysis scripts; rebuilding the delivered instrument does not. Source URLs/hashes, measurement settings and results are preserved in [the evidence index](../analysis/evidence-index.md).
