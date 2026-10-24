# Evidence index

[Documentation home](../README.md) · [Method](reference-and-method.md) · [History](development-history.md) · [Current results](results.md)

This directory preserves the figures and analysis records used by these documents. The plots are copies of the original scientific figures, with their original labels. In historical figures, “current”, “previous” and “revised” refer to the stage listed below, not automatically to the latest instrument.

[Asset provenance and SHA-256 manifest](assets.json) records the original repository-relative artifact location, original hash, packaged hash and size for every copied file. The original `output/` paths are provenance identifiers; they are not required to read this documentation. PNGs were copied unchanged. CSV line endings were normalized to LF without changing any cells. JSON copies replace machine-specific absolute paths with portable artifact identifiers; numerical values, reference URLs and audio hashes are preserved.

[Revision identity](revision.json) records the current native bundles and production input hashes. These documentation snapshots do not update automatically when the instrument changes. Refresh the evidence and this identity record together with a future documented revision.

The Yamaha-derived data and plots credit Alexander Holm, Salamander Grand Piano V3 (Yamaha C5), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [source library](https://github.com/sfzinstruments/SalamanderGrandPiano). The early attack plots also contain the attributed Iowa Steinway comparison described in [reference and method](reference-and-method.md). No source audio is bundled here.

## Early attack diagnosis

| Artifact | Purpose/type |
| --- | --- |
| [attack_25ms_detail.png](plots/attack/attack_25ms_detail.png) | Scientific plot |
| [attack_time_frequency.png](plots/attack/attack_time_frequency.png) | Scientific plot |
| [velocity_brightness.png](plots/attack/velocity_brightness.png) | Scientific plot |
| [measurements.json](data/attack/measurements.json) | Numeric results or provenance |
| [sources.json](data/attack/sources.json) | Numeric results or provenance |

## Original physical-model spectral diagnosis

| Artifact | Purpose/type |
| --- | --- |
| [partial_evolution.png](plots/original_spectra/partial_evolution.png) | Scientific plot |
| [spectra_over_time.png](plots/original_spectra/spectra_over_time.png) | Scientific plot |
| [partial_envelopes.png](plots/original_spectra/partial_envelopes.png) | Scientific plot |
| [detune_diagnostic.png](plots/original_spectra/detune_diagnostic.png) | Scientific plot |
| [upper_body_evolution.png](plots/original_spectra/upper_body_evolution.png) | Scientific plot |
| [measurements.json](data/original_spectra/measurements.json) | Numeric results or provenance |
| [partial_summary.csv](data/original_spectra/partial_summary.csv) | Per-partial table |
| [calibration.json](data/original_spectra/calibration.json) | Numeric results or provenance |
| [threshold_sensitivity.json](data/original_spectra/threshold_sensitivity.json) | Numeric results or provenance |
| [sources.json](data/original_spectra/sources.json) | Numeric results or provenance |

## Compact explicit-oscillator revision

| Artifact | Purpose/type |
| --- | --- |
| [middle_partials.png](plots/compact/middle_partials.png) | Scientific plot |
| [middle_decay.png](plots/compact/middle_decay.png) | Scientific plot |
| [comparison.json](data/compact/comparison.json) | Numeric results or provenance |
| [validation.json](data/compact/validation.json) | Numeric results or provenance |
| [sources.json](data/compact/sources.json) | Numeric results or provenance |

## Initial adsyn conversion

| Artifact | Purpose/type |
| --- | --- |
| [attack_spectra.png](plots/additive/attack_spectra.png) | Scientific plot |
| [decay_comparison.png](plots/additive/decay_comparison.png) | Scientific plot |
| [comparison.json](data/additive/comparison.json) | Numeric results or provenance |
| [off_grid.json](data/additive/off_grid.json) | Numeric results or provenance |
| [validation.json](data/additive/validation.json) | Numeric results or provenance |
| [demo_audio_validation.json](data/additive/demo_audio_validation.json) | Numeric results or provenance |

## Higher-partial-count experiment

| Artifact | Purpose/type |
| --- | --- |
| [spectral_evolution.png](plots/density/spectral_evolution.png) | Scientific plot |
| [attack_25ms.png](plots/density/attack_25ms.png) | Scientific plot |
| [summary.json](data/density/summary.json) | Numeric results or provenance |
| [comparisons.json](data/density/comparisons.json) | Numeric results or provenance |
| [reference_survey.json](data/density/reference_survey.json) | Numeric results or provenance |
| [benchmark.json](data/density/benchmark.json) | Numeric results or provenance |
| [sources.json](data/density/sources.json) | Numeric results or provenance |

## Adopted bass enrichment

| Artifact | Purpose/type |
| --- | --- |
| [validation.json](data/bass/validation.json) | Numeric results or provenance |

## Current C3–B4 refinement

| Artifact | Purpose/type |
| --- | --- |
| [harmonic_decay.png](plots/middle/harmonic_decay.png) | Scientific plot |
| [Piano_Addiitive_Synthesis_Demo.mel.png](plots/middle/Piano_Addiitive_Synthesis_Demo.mel.png) | Scientific plot |
| [Piano_Addiitive_Synthesis_Demo.stft.png](plots/middle/Piano_Addiitive_Synthesis_Demo.stft.png) | Scientific plot |
| [Yamaha_Previous_Revised.stft.png](plots/middle/Yamaha_Previous_Revised.stft.png) | Scientific plot |
| [summary.json](data/middle/summary.json) | Numeric results or provenance |
| [validation.json](data/middle/validation.json) | Numeric results or provenance |
| [sources.json](data/middle/sources.json) | Numeric results or provenance |
| [holdout_sources.json](data/middle/holdout_sources.json) | Numeric results or provenance |
| [before.json](data/middle/before.json) | Numeric results or provenance |
| [after.json](data/middle/after.json) | Numeric results or provenance |
| [holdout_before.json](data/middle/holdout_before.json) | Numeric results or provenance |
| [holdout_after.json](data/middle/holdout_after.json) | Numeric results or provenance |

## Current design and source data

[Selected current graph formula, controls and opcode counts](data/middle/design_snapshot.json) is a readable design snapshot, not an importable patch. The complete current graph is in the native instrument bundle linked from the documentation home.

The production numeric inputs remain canonical under `tools/piano_additive/`: [original fit](../../../../tools/piano_additive/fit.json), [bass enrichment](../../../../tools/piano_additive/bass_enrichment.json), [middle refinement](../../../../tools/piano_additive/middle_refinement.json), [original velocity basis](../../../../tools/piano_additive/velocity_basis.json) and [middle basis](../../../../tools/piano_additive/middle_velocity_basis.json). The [reproduction guide](../design/hetro-and-reproduction.md) explains their use.

## What is and is not archived

The package includes selected original diagnostic measurements, fitting/holdout stage errors, reference-source manifests, validation summaries, an initial-conversion comparison, the harmonic-density experiment, and current render/asset checks. The large original WAV/FLAC recordings, per-frame NPZ arrays, exploratory candidate renders and environment-dependent experiment scripts are not copied. Source URLs/hashes and method descriptions identify the evidence without making the documentation depend on a developer’s local paths.

Instrument generation is reproducible from the versioned numeric inputs without those recordings. Repeating the original audio-analysis experiments is a separate task and requires reconstructing the recorded experimental environment; the documentation does not claim the archived JSON files alone are an executable analysis pipeline.
