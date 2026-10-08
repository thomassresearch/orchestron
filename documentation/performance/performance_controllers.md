# Performance Controllers

**Navigation:** [Up](performance.md) | [Rack and transport](instrument_rack_and_engine_transport.md) | [Import and export](performance_import_export.md)

Use `perf_controller` to adapt a patch to a particular performance: envelope times, sustain, distortion amount, or another parameter accepting I-rate. Each rack instance owns its settings, even when several instances use the same patch.

## Define a Controller

Add `perf_controller` from Constants in Instrument Design. Click its gear button and configure:

| Field | Initial value | Meaning |
| --- | --- | --- |
| Minimum | 0 | Lowest setting |
| Maximum | 1 | Highest setting |
| Default | 0.5 | Setting before a rack override |
| Scale | Linear | Linear or logarithmic knob movement |
| Label | Parameter | Caption displayed in the rack |

The fields are fixed values, without input sockets or formulas. Numbers must be finite, minimum smaller than maximum, and default within the range. Logarithmic minimum must be positive. Labels must contain non-whitespace text and be no more than 128 characters long. For a logarithmic attack-time control, try minimum `0.001`, maximum `5`, default `0.01`, and label `Attack (s)`. Connect `iout` to the envelope’s I-rate attack input, then save the patch.

## Tune a Rack Instrument

Controllers appear in patch-node order beneath patch and channel. Controls wrap onto additional rows to fit the available card width. Each shows a caption, scale dashes, endpoints, LIN/LOG indicator, and current value. Linear ticks are equally spaced; logarithmic ticks follow ratios and mark decade boundaries.

- Drag vertically, or use arrow keys. Hold Shift for fine adjustment.
- Enter an exact number below the knob; Enter or leaving the field applies it. Escape cancels.
- Home and End choose the endpoints. Double-click, Delete, or Backspace on the focused knob resets to the patch default.
- Changes affect newly started notes. Sounding notes keep their initialized value. Continuous instruments require a rack restart.

For an instrument using [`midi_legato`](../instrument_design/midi_legato.md), settings are sampled at the start of each **phrase**. Touching and overlapping notes keep the same voice and settings; the next note after a gap reads current values.

For example, the [steel-string guitars](../../examples/instruments/steel_string_guitar/README.md)
expose Finger → Plectrum, Brightness, Body resonance, String sustain, and Release.
The legato version also exposes Slide half-time. Finger → Plectrum blends attack
and tone continuously, but its setting is still read at the next phrase or note;
moving the knob does not morph a string that is already sounding.

## Save, Reload, and Export

Untouched controls follow the patch default. After a value changes, an explicit instance override remains until reset, including when it is subsequently set to the current default. App state retains edits immediately through the existing persistence workflow; Save Performance is required to update a saved performance. Native JSON/ZIP bundles and both CSD (MIDI) and CSD (SCORE) exports preserve instance values. The CSD contains its initial settings and runs without a controller client. These controls do not send MIDI CC and do not become MIDI automation.

Node IDs identify controls; duplicate labels are allowed. Changing the selected patch clears its overrides. Editing a patch range clamps saved values; deleting a controller removes its override, with a notice in the rack. Standalone patch export and isolated audition use defaults; audition within a performance uses the selected instance’s values.

`perf_controller` is an Orchestron editor construct lowered to [I-rate chnget](https://csound.com/docs/manual/chnget.html) and channel initialization. It is not a native Csound opcode.
