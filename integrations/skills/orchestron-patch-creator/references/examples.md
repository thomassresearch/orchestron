# Examples

## Warm Subtractive Lead

```yaml
name: Warm Subtractive Lead
description: Playable saw lead with moderate ladder filtering.
family: subtractive
envelope:
  attack: 0.01
  decay: 0.22
  sustain: 0.62
  release: 0.18
layers:
  - id: saw
    opcode: vco2
    gain: 0.42
    mode: 0
effects:
  - opcode: moogladder2
    cutoff: 2600
    resonance: 0.22
  - opcode: distort1
    pre_gain: 1.4
    post_gain: 0.7
    shape1: 0.1
    shape2: 0.1
output:
  pan: 0.5
```

## Evolving FM Pad

```yaml
name: Evolving FM Pad
description: Two-layer soft FM pad with slow attack and roomy tail.
family: fm_pad
envelope:
  attack: 1.4
  decay: 2.0
  sustain: 0.8
  release: 4.2
layers:
  - id: fm_a
    opcode: foscili
    gain: 0.52
    carrier_ratio: 1
    mod_ratio: 2
    mod_index: 1.25
    table: 1
  - id: fm_b
    opcode: foscili
    gain: 0.32
    carrier_ratio: 1
    mod_ratio: 3.01
    mod_index: 0.72
    table: 1
effects:
  - opcode: moogladder2
    cutoff: 4300
    resonance: 0.18
  - opcode: flanger
    delay: 0.0035
    feedback: 0.22
    max_delay: 0.02
  - opcode: reverb2
    time: 3.0
    damping: 5200
output:
  pan: 0.5
```

## Airy Noise Texture

```yaml
name: Airy Noise Texture
description: Playable noise bed with slow envelope and filtered air.
family: noise_texture
envelope:
  attack: 0.8
  decay: 1.2
  sustain: 0.65
  release: 2.5
layers:
  - id: air
    opcode: noise
    gain: 0.22
    color: 0.35
effects:
  - opcode: butterhp
    cutoff: 500
  - opcode: butterlp
    cutoff: 6500
  - opcode: reverb2
    time: 2.2
    damping: 5000
output:
  pan: 0.5
```
