# Template Families

Choose a small family first. Add detail only when the description requires it.

## simple_osc

Use for plain tones, utility patches, and simple synth sounds.

Default source:

```yaml
layers:
  - id: osc
    opcode: oscili
    gain: 0.45
    table: 1
```

Good additions: `butterlp`, `reverb2`.

## subtractive

Use for analog-style basses, leads, brass-like tones, pads based on saw/square sources, and sounds described with filter sweeps.

Default source:

```yaml
layers:
  - id: osc
    opcode: vco2
    gain: 0.45
    mode: 0
    pulse_width: 0.5
effects:
  - opcode: moogladder2
    cutoff: 2400
    resonance: 0.2
```

Use `vco2.mode` values from Csound `vco2` conventions. Common values: `0` sawtooth, `2` square/PWM, `4` saw/triangle/ramp, `12` triangle.

## fm_pad

Use for FM, phase modulation, glass, bells, metallic tones, evolving harmonic pads, and synth recipes with carrier/modulator language.

Default sources:

```yaml
layers:
  - id: fm_a
    opcode: foscili
    gain: 0.55
    carrier_ratio: 1
    mod_ratio: 2
    mod_index: 1.6
    table: 1
  - id: fm_b
    opcode: foscili
    gain: 0.35
    carrier_ratio: 1
    mod_ratio: 3.01
    mod_index: 0.8
    table: 1
```

For soft pads, use long `madsr.attack` and `madsr.release`, moderate `mod_index`, `moogladder2` or `butterlp`, `flanger`, and `reverb2`.

## noise_texture

Use for breath, air, wind, sweeps, noise percussion, and texture layers.

Default source:

```yaml
layers:
  - id: noise
    opcode: noise
    gain: 0.35
    color: 0.2
```

Good additions: `butterhp`, `butterlp`, `moogladder2`, `flanger`, `reverb2`.
