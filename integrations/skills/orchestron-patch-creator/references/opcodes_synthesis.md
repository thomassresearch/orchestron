# Synthesis Opcode Reference

Use these opcodes as source layers. For original, detailed Csound opcode documentation, start at https://csound.com/docs/manual/PartReference.html.

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

Purpose: Audio-rate two-oscillator FM shortcut with one carrier and one modulator.

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

Usage note: Use only when the sound can be represented as one carrier plus one modulator. `kcps` is the reference frequency; `xcar * kcps` is the carrier frequency, `xmod * kcps` is the modulator frequency, and `kndx` is the modulation index. The CLI maps `carrier_ratio`, `mod_ratio`, `mod_index`, `table`, and `phase`.

Do not use parallel audible `foscili` layers to represent multiple FM operators modulating one another. As soon as more than one oscillator modulates the carrier or operators are chained/cross-connected, build the graph explicitly with `oscil3`.

## oscil3

Purpose: Cubic-interpolating oscillator suitable for explicit FM graphs because its frequency input can accept audio-rate modulation.

Inputs:

- `amp` (`k`, required, default `0.4`): Amplitude. Orchestron accepts `a`, `k`, or `i` inputs for this port.
- `freq` (`k`, required, default `440`): Frequency in cycles per second. Orchestron accepts `a`, `k`, or `i` inputs for this port, so it can receive audio-rate FM.
- `ifn` (`i`, optional, default `-1`): Function table. `-1` uses the default sine.
- `iphs` (`i`, optional, default `0`): Initial phase.

Outputs:

- `asig` (`a`)

Usage note: Use `oscil3` for arbitrary FM operator graphs. A practical pattern is:

1. Convert the carrier base frequency to audio rate with `upsamp` or `k_to_a` when it comes from `cpsmidi`.
2. Generate each modulator with `oscil3`.
3. Set each modulator's amplitude to the desired maximum frequency deviation in Hz. For a traditional FM modulation index, `deviation_hz = mod_index * modulator_frequency`.
4. Sum modulator outputs with `mix2` nodes.
5. Add the summed modulation to the carrier base frequency and feed that audio-rate signal into the carrier `oscil3.freq`.

Use `a_mul`, `mix2`, `const_a`/`const_k`, and formula-capable inputs where needed to express `mod_index * modulator_frequency` and frequency sums.

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
