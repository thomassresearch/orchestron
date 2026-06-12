# Patch Spec

Use YAML or JSON. YAML is easier for authoring; JSON works without PyYAML. The CLI accepts either.

## Top-Level Fields

- `name`: Patch name used when creating a patch unless `--name` overrides it.
- `description`: Patch description.
- `family`: One of `simple_osc`, `subtractive`, `fm_pad`, `noise_texture`.
- `engine`: Optional Csound engine config. Defaults are 48 kHz, stereo, `ksmps=64`.
- `envelope`: Main `madsr` envelope.
- `layers`: Source layers. Omit to use family defaults.
- `effects`: Optional mono effect chain.
- `output`: Output pan configuration.
- `is_template`: Optional boolean. Use only for intentionally incomplete or starter patches.

## Envelope

The CLI always creates one `madsr` node and feeds its required ADSR inputs from explicit `const_i` nodes:

```yaml
envelope:
  attack: 0.8
  decay: 1.4
  sustain: 0.72
  release: 3.5
  delay: 0
  release_time: -1
```

Field mapping:

- `attack` -> `const_i.value` -> `madsr.iatt`
- `decay` -> `const_i.value` -> `madsr.idec`
- `sustain` -> `const_i.value` -> `madsr.islev`
- `release` -> `const_i.value` -> `madsr.irel`
- `delay` -> optional `const_i.value` -> `madsr.idel`
- `release_time` -> optional `const_i.value` -> `madsr.ireltim`

The CLI also creates an `ampmidi` node and connects its required `iscal` input from `const_i.iout` with value `1.0`.

## Layers

Supported source opcodes are `oscili`, `vco2`, `foscili`, `noise`, and `pinker`.

All pitch-aware layers receive `cpsmidi.kfreq`. All amplitude-aware layers receive velocity/envelope-scaled control amplitude.

Layer examples:

```yaml
layers:
  - id: carrier
    opcode: foscili
    gain: 0.55
    carrier_ratio: 1
    mod_ratio: 2
    mod_index: 1.4
    table: 1
  - id: air
    opcode: noise
    gain: 0.12
    color: 0.2
```

Each layer can include `params` for exact Orchestron port IDs. Named aliases are more readable where supported:

- `oscili.table` -> `ifn`
- `vco2.mode` -> `imode`
- `vco2.pulse_width` -> `kpw`
- `vco2.phase` -> `kphs`
- `foscili.carrier_ratio` -> `xcar`
- `foscili.mod_ratio` -> `xmod`
- `foscili.mod_index` -> `kndx`
- `foscili.table` -> `ifn`
- `noise.color` -> `beta`

## Effects

Supported effect opcodes are `butterlp`, `butterhp`, `moogladder`, `moogladder2`, `diode_ladder`, `distort1`, `flanger`, and `reverb2`.

Effects are applied in listed order:

```yaml
effects:
  - opcode: moogladder2
    cutoff: 3600
    resonance: 0.22
  - opcode: flanger
    delay: 0.004
    feedback: 0.18
    max_delay: 0.02
  - opcode: reverb2
    time: 2.8
    damping: 6000
```

Use `params` when an exact port ID is needed and no alias exists.

## Output

Generated graphs are mono internally unless an explicit stereo source is added in a later CLI version. The current CLI always inserts `pan2` before `outs`.

```yaml
output:
  pan: 0.5
  mode: 0
```

## Complete FM Pad Example

```yaml
name: Evolving FM Pad
description: Slow evolving FM-style pad with two harmonic layers and soft space.
family: fm_pad
envelope:
  attack: 1.5
  decay: 2.0
  sustain: 0.78
  release: 4.0
layers:
  - id: fm_a
    opcode: foscili
    gain: 0.52
    carrier_ratio: 1
    mod_ratio: 2
    mod_index: 1.3
    table: 1
  - id: fm_b
    opcode: foscili
    gain: 0.34
    carrier_ratio: 1
    mod_ratio: 3.01
    mod_index: 0.7
    table: 1
effects:
  - opcode: moogladder2
    cutoff: 4200
    resonance: 0.18
  - opcode: flanger
    delay: 0.003
    feedback: 0.2
    max_delay: 0.02
  - opcode: reverb2
    time: 3.2
    damping: 5000
output:
  pan: 0.5
```
