# Opcode Catalog and Integrated Documentation

**Navigation:** [Up](instrument_design.md) | [Prev](patch_toolbar_and_tabs.md) | [Next](graph_editor.md)

The opcode catalog is the source list of all supported building blocks you can place in the graph editor.

## What The Catalog Supports

- Search by opcode name
- Search by category
- Search by description text
- Search by tags
- Click to add an opcode to the graph
- Drag-and-drop an opcode into the graph canvas at a chosen position

## Search Behavior

The search field filters on these opcode fields:

- `name`
- `category`
- `description`
- `tags`

This makes it easy to find opcodes by function (for example `filter`, `midi`, `reverb`, `soundfont`) even if you do not remember the exact Csound opcode name.

## Adding Opcodes

### Click To Add

- Clicking an opcode row inserts the node into the graph using the app's add-node behavior.
- This is fastest when exact placement is not important yet.

### Drag-and-Drop To Place

- Drag an opcode from the catalog and drop it into the graph canvas.
- The graph editor computes the drop location and places the node there.
- While dragging over the graph, the canvas highlights to confirm drop targeting.

## Visual Information In The Catalog

Each catalog entry shows:

- Opcode icon (backend-served icon asset)
- Opcode name
- Category label

These same categories influence node coloring in the graph editor for quick visual grouping.

## Integrated Opcode Documentation (`?` on node)

After placing an opcode in the graph, use the node's `?` button to open the opcode documentation modal.

The opcode documentation modal provides:

- Localized description (English/German/French/Spanish)
- Category and syntax/template summary
- Input/output port descriptions (including optional/default/accepted types)
- Tags
- Direct link to the Csound reference page (`Open Csound Reference`)

## Monophonic Legato

Use [`midi_legato`](midi_legato.md) for touching or overlapping notes that share a voice. Its live pitch and velocity outputs drive the sound while `madsr` follows the phrase. Gaps restore articulation. The node is opt-in and belongs in the main graph.

## Atone High-Pass Filters

Search for `atone` or `highpass` in the `filter` category:

- [atone](https://csound.com/docs/manual/atone.html) filters an audio signal (`asig`) and produces audio (`aout`). Its `khp` cutoff accepts control-rate or init-rate values and starts at 200 Hz.
- [atonek](https://csound.com/docs/manual/atonek.html) filters a control signal (`ksig`) and produces control output (`kout`) for modulation. Its `khp` cutoff starts at 10 Hz. Both inputs accept control-rate or init-rate values.
- [atonex](https://csound.com/docs/manual/atonex.html) cascades multiple `atone` stages for a sharper cutoff. Its audio input/output are `asig`/`aout`; `xhp` accepts audio-rate, control-rate, or init-rate cutoff values and starts at 200 Hz. The optional init-rate `inumlayer` sets the stage count and defaults to 4.

Each filter exposes optional init-rate `iskip`: 0 clears its internal state at initialization, while a nonzero value retains previous state. The default is 0. Setting only `iskip` on `atonex` retains the default four layers. Cutoff defaults are editor starting values; Csound requires a cutoff argument.

Connect the audio outputs of `atone` and `atonex` to downstream audio nodes or both `outs` inputs. Connect `atonek` to a control input such as oscillator amplitude or frequency. The node's `?` help documents every port in English, German, French, and Spanish.

## ZDF and Custom IIR Filters

Search for `zdf` in the `filter` category. All five nodes accept audio input `ain`; `xcf` accepts init, control, or audio rate and starts at 1200 Hz. The two-pole and ladder filters also expose `xq` (0.5–25, default 1) at the same rates.

- [`zdf_1pole`](https://csound.com/docs/manual/zdf_1pole.html): 6 dB/oct, with `kmode` 0 = low-pass, 1 = high-pass, 2 = allpass.
- [`zdf_1pole_mode`](https://csound.com/docs/manual/zdf_1pole_mode.html): simultaneous `alp`, `ahp` outputs, in that order.
- [`zdf_2pole`](https://csound.com/docs/manual/zdf_2pole.html): 12 dB/oct, with `kmode` 0 = low-pass, 1 = high-pass, 2 = band-pass, 3 = unity-gain band-pass, 4 = notch, 5 = allpass, 6 = peak.
- [`zdf_2pole_mode`](https://csound.com/docs/manual/zdf_2pole_mode.html): simultaneous `alp`, `abp`, `ahp` outputs, in that order.
- [`zdf_ladder`](https://csound.com/docs/manual/zdf_ladder.html): four-pole (24 dB/oct) Moog ladder low-pass; Q = 25 reaches self-oscillation.

`kmode` accepts control or init rate and defaults to 0. Every ZDF node has optional init-rate `istor`: 0 clears filter memory, nonzero retains it. Setting `istor` alone preserves other defaults. Cutoff and Q defaults are editor starting values.

[`zfilter2`](https://csound.com/docs/manual/zfilter2.html) uses custom IIR coefficients with control/init-rate `kdamp` and `kfreq`. Positive damping adjustments lengthen ringing and negative ones shorten it; positive warp shifts pole frequencies upward and negative warp shifts them downward. Both start at 0 (unchanged poles); use values strictly between -1 and 1.

Edit its inline **Coefficients** field as a comma-separated list: all numerator coefficients starting at b0, followed by denominator coefficients starting at a1. The leading denominator coefficient a0 is implicitly 1. **NumeratorCount** (`im`) counts numerator coefficients including b0; **DenominatorCount** (`in`) counts denominator coefficients. Connect `const_i` nodes to change these counts. Defaults are 3 and 2, with `0.06745527, 0.13491055, 0.06745527, -1.1429805, 0.4128016`, a stable second-order low-pass filter.

You can instead connect init-rate sources to **Coefficients** in coefficient order. Each connection supplies one coefficient, replacing the entire inline list; these inputs are not summed, and the list does not accept a combine formula. Connection order survives save/export. Use separate upstream init-rate calculations for individual coefficients.

Supply exactly `im + in` coefficients. The editor supports 1–51 numerator coefficients and 1–49 denominator coefficients for Csound 6 compatibility: zero poles and 50 poles encounter native bugs in Csound 6.18. Invalid literal counts fail compilation; invalid connected counts stop the affected voice before the native filter initializes. Coefficients remain the responsibility of the filter design: count checks do not establish stability.

![ZDF catalog and custom IIR coefficient control](../../screenshots/instrument_zdf_filters.png)

## STK Instruments

Search for `stk` to find the 27 Synthesis Toolkit instruments in the `physical_modeling`, `fm`, and `oscillator` categories. They include strings, winds, percussion, voices, organs, and electric pianos. Each node produces one mono audio signal; connect it to both `outs` inputs for centered stereo output.

- `ifrequency` and `iamplitude` are init-rate inputs: frequency in Hz and note amplitude from 0 to 1. Use `cpsmidi` for note pitch; apply envelopes or gain after the audio output for continuous level changes.
- `STKDrummer` uses the frequency to select a drum sample. Connect `cpsmidi` and play MIDI drum notes. `STKDrummer`, `STKPlucked`, and `STKSitar` have no documented controller inputs.
- The other nodes expose the manual's controller number/value pairs in order. The controller number is prefilled with the documented number. Set or connect its paired `kv` value to enable that control. Both ports accept init-rate or control-rate sources, so controller values can change during a note.
- Unset controller values omit the entire pair and retain STK's instrument defaults. You can enable a later pair without filling earlier pairs. For example, set only `kv7` to `3` on `STKBandedWG` to send instrument preset controller `16` with value `3`.
- Most values range from 0 to 127, but preset selectors use model-specific ranges. `STKShakers` uses controller **1071**, not a MIDI CC in the 0–127 range, for its instrument selection. Check the node's `?` help for each controller's meaning.

Runtime requires the [Csound STK plugin (`stkopd`)](https://github.com/csound/plugins) and its rawwave data on the machine running the Csound backend. Set `RAWWAVE_PATH` to the installed rawwaves directory before starting the backend; some Csound builds do not register any STK opcodes without it. For example, an Apple Silicon Homebrew installation of STK uses `RAWWAVE_PATH=/opt/homebrew/opt/stk/share/stk/rawwaves/`. Catalog availability and successful graph compilation do not install this runtime dependency.

## Context Help (`?` in page sections)

In addition to opcode-level docs, the app provides context help buttons for page sections (toolbar, catalog, graph, runtime, sequencer panels, config panels). These open integrated markdown help content in the currently selected GUI language.

For the opcode catalog specifically, the integrated help now focuses on search/add workflow and on the distinction between catalog help and the node-level opcode documentation modal.

See also:

- [GUI Language and Integrated Help](../configuration/gui_language_and_integrated_help.md)
- [Supported Opcodes](supported_opcodes.md) for the full opcode index table

## Screenshots

<p align="center">
  <img src="../../screenshots/instrument_opcode_catalog_search_filtered.png" alt="Opcode catalog with filtered search" width="420" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Opcode catalog filtered by search text.</em></p>

<p align="center">
  <img src="../../screenshots/integrated_help_pages_opcodes.png" alt="Integrated opcode documentation modal" width="1000" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Integrated opcode documentation modal opened from a graph node.</em></p>

**Navigation:** [Up](instrument_design.md) | [Prev](patch_toolbar_and_tabs.md) | [Next](graph_editor.md)
