# Core Opcode Reference

Use these opcodes for the required patch spine. For original, detailed Csound opcode documentation, start at https://csound.com/docs/manual/PartReference.html.

## cpsmidi

Purpose: Read the active MIDI note pitch as cycles per second. Use this as the pitch source for playable instruments.

Inputs: none.

Outputs:

- `kfreq` (`i`): MIDI note frequency. Connect to pitch/frequency inputs such as `oscili.freq`, `vco2.kcps`, or `foscili.kcps`.

Usage note: Even though the output is init-rate, Orchestron allows init-rate signals into control-rate inputs.

## const_i

Purpose: Provide an init-rate constant value.

Inputs: none.

Outputs:

- `iout` (`i`): Init-rate constant.

Usage note: Generated patches use `const_i` nodes for required init-rate values instead of storing those values directly on consuming nodes. Use `const_i.iout` for `ampmidi.iscal` and the required `madsr` ADSR inputs.

## ampmidi

Purpose: Generate amplitude from the played MIDI note velocity.

Inputs:

- `iscal` (`i`, required, default `1`): Scale factor.
- `ifn` (`i`, optional): Optional curve table.

Outputs:

- `iamp` (`i`): Velocity-derived amplitude.

Usage note: The CLI connects `ampmidi.iamp` into `k_mul` with the `madsr` envelope so source amplitude follows both note velocity and envelope shape.

Required connection: connect `ampmidi.iscal` from `const_i.iout` with `const_i.params.value = 1.0`.

## madsr

Purpose: MIDI release-sensitive ADSR envelope. This is the default envelope opcode for generated patches.

Inputs:

- `iatt` (`i`, required, default `0.01`): Attack time.
- `idec` (`i`, required, default `0.15`): Decay time.
- `islev` (`i`, required, default `0.7`): Sustain level.
- `irel` (`i`, required, default `0.2`): Release time.
- `idel` (`i`, optional, default `0`): Delay before attack.
- `ireltim` (`i`, optional, default `-1`): Release-time behavior.

Outputs:

- `kenv` (`k`): Envelope control signal.

Usage note: Use longer attack/release for pads; short attack and decay for plucks and basses.

Required connections: connect `iatt`, `idec`, `islev`, and `irel` from separate `const_i.iout` sources because all four are i-rate inputs. Attack, decay, and release are seconds; sustain is normalized from `0` to `1`.

## k_mul

Purpose: Multiply two control-rate signals.

Inputs:

- `a` (`k`, required)
- `b` (`k`, required)

Outputs:

- `kout` (`k`)

Usage note: The CLI uses one `k_mul` to combine velocity and envelope, and additional `k_mul` nodes for per-layer gain.

## a_mul

Purpose: Multiply two audio-rate signals.

Inputs:

- `a` (`a`, required)
- `b` (`a`, required)

Outputs:

- `aout` (`a`)

Usage note: Used for source opcodes with no native amplitude input after converting a control envelope to audio via `k_to_a`.

## k_to_a

Purpose: Interpolate a control signal to audio rate.

Inputs:

- `kin` (`k`, required)

Outputs:

- `aout` (`a`)

Usage note: Needed when scaling audio sources that lack a control-rate amplitude input.

## mix2

Purpose: Mix two mono audio signals.

Inputs:

- `a` (`a`, required)
- `b` (`a`, required)

Outputs:

- `aout` (`a`)

Usage note: The CLI chains `mix2` nodes for multi-layer patches.

## pan2

Purpose: Pan a mono audio signal to stereo.

Inputs:

- `asig` (`a`, required): Mono input.
- `xp` (`k`, required, default `0.5`): Pan position. `0` left, `0.5` center, `1` right.
- `imode` (`i`, optional, default `0`): Pan law/mode.

Outputs:

- `aleft` (`a`)
- `aright` (`a`)

Usage note: Generated mono patches always pass through `pan2` before `outs`.

## outs

Purpose: Final stereo audio sink.

Inputs:

- `left` (`a`, required): Left output.
- `right` (`a`, required): Right output.

Outputs: none.

Usage note: Every generated patch must end with exactly one `outs` node. No node may be connected after `outs`.
