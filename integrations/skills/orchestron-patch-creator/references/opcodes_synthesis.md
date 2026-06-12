# Synthesis Opcode Reference

Use these opcodes as source layers.

## oscili

Purpose: Classic interpolating table oscillator.

Inputs:

- `amp` (`k`, required, default `0.4`): Amplitude.
- `freq` (`k`, required, default `440`): Frequency.
- `ifn` (`i`, required, default `1`): Function table.

Outputs:

- `asig` (`a`): Audio signal.

Usage note: Use for simple sine/table oscillator patches. The CLI maps `table` to `ifn`.

## vco2

Purpose: Improved anti-aliased analog-style oscillator.

Inputs:

- `kamp` (`k`, required, default `0.4`): Amplitude.
- `kcps` (`k`, required, default `440`): Frequency.
- `imode` (`i`, optional, default `0`): Waveform and control flags.
- `kpw` (`k`, optional, default `0.5`): Pulse width or ramp/shape parameter.
- `kphs` (`k`, optional, default `0`): Phase.
- `inyx` (`i`, optional, default `0.5`): Sync shape.

Outputs:

- `asig` (`a`)

Usage note: Good default for subtractive patches. Common `imode` choices include `0` sawtooth, `2` square/PWM, `4` saw/triangle/ramp, and `12` triangle.

## foscili

Purpose: Audio-rate FM oscillator with harmonic ratios.

Inputs:

- `xamp` (`k`, required, default `0.4`): Amplitude.
- `kcps` (`k`, required, default `220`): Base frequency.
- `xcar` (`k`, required, default `1`): Carrier ratio.
- `xmod` (`k`, required, default `2`): Modulator ratio.
- `kndx` (`k`, required, default `2`): Modulation index.
- `ifn` (`i`, required, default `1`): Function table.
- `iphs` (`i`, optional, default `0`): Initial phase.

Outputs:

- `asig` (`a`)

Usage note: Best first choice for FM pads and carrier/modulator descriptions. The CLI maps `carrier_ratio`, `mod_ratio`, `mod_index`, `table`, and `phase`.

## noise

Purpose: Variable-color random audio noise.

Inputs:

- `amp` (`k`, required, default `0.25`): Amplitude.
- `beta` (`k`, required, default `0`): Noise color.
- `iseed` (`i`, optional): Random seed.
- `iskip` (`i`, optional): Skip initialization.

Outputs:

- `aout` (`a`)

Usage note: Good for air, breath, sweeps, hats, and layered texture. The CLI maps `color` to `beta`.

## pinker

Purpose: Pink noise generator.

Inputs: none.

Outputs:

- `aout` (`a`)

Usage note: Because `pinker` has no amplitude input, the CLI adds `k_to_a` and `a_mul` so the source still follows velocity and the `madsr` envelope.
