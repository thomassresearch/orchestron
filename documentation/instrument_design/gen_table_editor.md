# GEN Table Editor (GEN Meta-Opcode)

**Navigation:** [Up](instrument_design.md) | [Prev](input_formula_assistant.md) | [Next](runtime_panel_and_compilation.md)

The `GEN` meta-opcode is a specialized table generator node that opens a dedicated editor for building `ftgen` / `ftgenonce` lines visually.

## Why The GEN Meta-Opcode Exists

Csound function-table generation is powerful but argument-heavy. The GEN editor provides a structured UI for common GEN routines and a preview of the generated `ftgen`/`ftgenonce` line.

## Opening The GEN Editor

- Add the `GEN` opcode to the graph.
- Click the `GEN` button on the node card.

## Editor Overview

The editor has two main areas:

- Left side: generation mode, routine selection, parameters
- Right side: preview (`Effective GEN`, flattened args, rendered line) and notes

## Table Generation Mode (Top Section)

### Opcode Mode

Choose which Csound table opcode style to generate:

- `ftgen`
- `ftgenonce`

### Routine Selection

You can choose from structured editors for common routines and a named routine option:

- `GEN01` - Audio File
- `GEN02` - Value List
- `GEN07` - Segments
- `GEN10` - Harmonic Sine Partials
- `GEN11` - Harmonic Cosine Partials
- `GEN17` - Step Table From x/y Pairs
- `GEN20` - Window / Distribution Function
- `GENpadsynth` (named routine)
- Custom routine number / raw arguments

### Core Table Fields

- `Routine Number`
- `Table Number`
- `Table Size`
- `Start Time` (disabled for `ftgenonce` UI mode)
- `Normalize table` (positive GEN number vs negative GEN number behavior)

## Supported Routine Editors (Structured UI)

| Routine | Purpose | Main Parameters In Editor |
| --- | --- | --- |
| `GEN10` | Harmonic sine partial amplitudes | Harmonic amplitude list |
| `GEN11` | Harmonic cosine partials | harmonic count, lowest harmonic, multiplier |
| `GEN02` | Literal value list | Numeric value list |
| `GEN07` | Segments | Start value + repeated length/value rows |
| `GEN17` | Step table from x/y pairs | x/y pairs (editable list) |
| `GEN20` | Window / distribution | window type, max, optional parameter (for selected windows) |
| `GEN01` | Load audio file into table | uploaded asset or fallback path, skip time, format, channel |

## `GENpadsynth` (Named Routine)

Orchestron supports a named GEN routine for padsynth (`GENpadsynth`).

- Select the `GENpadsynth` routine option.
- Enter padsynth parameters and partial amplitude/frequency pairs in the raw arguments editor.
- Argument order follows the Csound `GENpadsynth` documentation.

## Custom / Raw Routine Arguments

For routines without a dedicated structured editor:

- Use the raw arguments editor.
- Separate tokens by commas or new lines.
- Quote string literals manually (for example `"file.wav"`).
- Prefix an argument with `expr:` to force raw Csound expression rendering without quotes.

Examples:

```text
1, 0.5, expr:1024*2, "file.wav"
```

## GEN01 Audio File Workflow (Important)

The `GEN01` editor supports two ways to specify the sound file:

### 1. Uploaded Asset (Recommended for Portability)

- Click `Upload Audio File`
- Select an audio file (UI accepts common formats such as WAV/AIFF/FLAC/MP3/OGG and `audio/*`)
- Orchestron stores the uploaded asset on the backend and references it in the GEN node config

Benefits:

- Instrument/performance exports can include the audio file automatically
- Imports can restore the asset automatically when using ZIP bundles

### 2. Fallback Sample Path

- Enter an absolute path manually (advanced/local use)
- This is less portable across machines

### Additional GEN01 Parameters

- `Skip Time`
- `Format`
- `Channel`

### Upload Limits and Notes

- Backend upload limit for GEN audio assets: **64 MiB** per file
- The preview/note panel explains that uploaded assets take precedence when present

## Preview Panel

The preview section shows:

- `Effective GEN` (including normalization sign / named routine behavior)
- Flattened argument list
- Rendered `ftgen` / `ftgenonce` line preview

Use this to verify the exact Csound line before compile.

## Editor Notes Worth Knowing

- `ftgenonce` behavior differs from `ftgen` and the editor shows notes about the differences.
- `GEN01` asset-backed generation is resolved by the backend compiler to stored asset paths.
- `GEN01` asset dependencies are automatically bundled in ZIP exports when referenced.

## Save Behavior

- `Save GEN` writes the GEN node configuration into patch UI metadata (`graph.ui_layout`).
- Closing without saving leaves the previous GEN node settings unchanged.

## Screenshots

<p align="center">
  <img src="../../screenshots/ instrument_gen_editor_structured_preview.png" alt="GEN editor structured routine mode" width="1000" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>GEN editor in structured routine mode with live preview panel.</em></p>

<p align="center">
  <img src="../../screenshots/instrument_gen_editor_gen01_uploaded_asset.png" alt="GEN01 editor with uploaded audio asset" width="980" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>GEN01 table setup using an uploaded backend audio asset.</em></p>

<p align="center">
  <img src="../../screenshots/ instrument_gen_editor_padsynth_raw_args.png" alt="GENpadsynth editor using raw arguments" width="980" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>GENpadsynth named routine using raw arguments input.</em></p>

**Navigation:** [Up](instrument_design.md) | [Prev](input_formula_assistant.md) | [Next](runtime_panel_and_compilation.md)
