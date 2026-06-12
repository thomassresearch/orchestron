# Effects And Filter Opcode Reference

Use these opcodes in the `effects` list. Effects run in listed order. For original, detailed Csound opcode documentation, start at https://csound.com/docs/manual/PartReference.html.

## butterlp

Purpose: Second-order Butterworth low-pass filter.

Inputs:

- `asig` (`a`, required): Audio input.
- `xfreq` (`k`, required, default `1200`): Cutoff frequency.
- `iskip` (`i`, optional, default `0`): Skip initialization.

Outputs:

- `aout` (`a`)

Usage note: Smooth high-frequency reduction. The CLI maps `cutoff` to `xfreq`.

## butterhp

Purpose: Second-order Butterworth high-pass filter.

Inputs:

- `asig` (`a`, required): Audio input.
- `xfreq` (`k`, required, default `200`): Cutoff frequency.
- `iskip` (`i`, optional, default `0`): Skip initialization.

Outputs:

- `aout` (`a`)

Usage note: Remove rumble or isolate noisy/high layers. The CLI maps `cutoff` to `xfreq`.

## moogladder

Purpose: Moog ladder low-pass filter.

Inputs:

- `ain` (`a`, required): Audio input.
- `kcf` (`k`, required, default `2000`): Cutoff frequency.
- `kres` (`k`, required, default `0.2`): Resonance.

Outputs:

- `aout` (`a`)

Usage note: Warm subtractive low-pass. The CLI maps `cutoff` and `resonance`.

## moogladder2

Purpose: Nonlinear Moog-style ladder filter with audio-rate modulation support.

Inputs:

- `ain` (`a`, required): Audio input.
- `xcf` (`k`, required, default `2000`): Cutoff frequency.
- `xres` (`k`, required, default `0.2`): Resonance.

Outputs:

- `aout` (`a`)

Usage note: Prefer this over `moogladder` when descriptions mention richer nonlinear analog movement. The CLI maps `cutoff` and `resonance`.

## diode_ladder

Purpose: Diode ladder low-pass filter model.

Inputs:

- `ain` (`a`, required): Audio input.
- `xcf` (`k`, required, default `2000`): Cutoff frequency.
- `xk` (`k`, required, default `0.6`): Resonance.
- `inlp` (`i`, optional, default `1`): Nonlinear position.
- `isaturation` (`i`, optional, default `1`): Saturation behavior.
- `istor` (`i`, optional, default `0`): Skip initialization.

Outputs:

- `aout` (`a`)

Usage note: Use for squelchy or diode-ladder-style analog tones. The CLI maps `cutoff`, `resonance`, `nonlinear_position`, `saturation`, and `skip_init`.

## distort1

Purpose: Waveshaping distortion with configurable transfer curve.

Inputs:

- `asig` (`a`, required): Audio input.
- `kpregain` (`k`, required, default `2`): Pregain.
- `kpostgain` (`k`, required, default `0.5`): Postgain.
- `kshape1` (`k`, required, default `0`): Shape parameter 1.
- `kshape2` (`k`, required, default `0`): Shape parameter 2.
- `imode` (`i`, optional, default `1`): Mode.

Outputs:

- `aout` (`a`)

Usage note: Use low pregain for saturation and higher pregain for aggressive tones. The CLI maps `pre_gain`, `post_gain`, `shape1`, `shape2`, and `mode`.

## flanger

Purpose: Flanger effect with delay modulation and feedback.

Inputs:

- `asig` (`a`, required): Audio input.
- `adel` (`k`, required, default `3`): Delay time. The backend casts non-audio delay values to audio for this opcode.
- `kfeedback` (`k`, required, default `0.3`): Feedback.
- `imaxd` (`i`, optional): Maximum delay.

Outputs:

- `aout` (`a`)

Usage note: Use very small delay values, for example `0.002` to `0.008`, for chorus/flanger movement. The CLI maps `delay`, `feedback`, and `max_delay`.

## reverb2

Purpose: Schroeder reverb processor.

Inputs:

- `asig` (`a`, required): Audio input.
- `krvt` (`k`, required, default `1.5`): Reverb time.
- `khf` (`k`, required, default `0.5`): High-frequency damping.
- `iskip` (`i`, optional): Skip initialization.

Outputs:

- `aout` (`a`)

Usage note: Use for simple space. The CLI maps `time`, `damping`, and `skip_init`.
