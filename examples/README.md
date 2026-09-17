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

[The End of the Summer](performances/the_end_of_the_summer/README.md) is a six-minute
dark-wave performance using Analog Drumkit and eight EBM / Dark Wave instruments.
It includes an editable arrangement, native and Csound exports, a reproducible score,
and a WAV render with two warm passages within the industrial groove.

## Import an instrument (Instrument Design -> Import)

1. Open the **Instrument Design** tab.
2. Click **Import**.
3. Select a file from `examples/instruments/`.

## Import a performance (Performance -> Import)

1. Open the **Perform** tab.
2. Click **Import** (in the performance/instrument rack area).
3. Select a file from `examples/performances/`.

During import, the app can also import included patch definitions and handle name conflicts (overwrite, rename, or skip), depending on the export file.
