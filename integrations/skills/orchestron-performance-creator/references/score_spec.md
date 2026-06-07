# Score Spec Reference

Use YAML or JSON score specs for multitrack performance generation.

Minimal YAML example:

```yaml
version: 1
title: modal sketch
tempo: 124
key: C
mode: dorian
tracks:
  - type: melodic
    name: Harmony
    channel: 2
    length_beats: 4
    progression:
      - roman: i7
        at_step: 0
        duration_steps: 4
      - roman: IV7
        at_step: 4
        duration_steps: 4
      - roman: bVIImaj7
        at_step: 8
        duration_steps: 4
      - roman: v7
        at_step: 12
        duration_steps: 4
  - type: drummer
    channel: 10
    groove: backbeat
  - type: controller
    cc: 74
    curve: slow_sweep
```

Apply it:

```bash
uv run orchestron_cli --json edit apply-score path/to/score.yaml
```

Melodic explicit events:

```yaml
tracks:
  - type: melodic
    channel: 3
    events:
      - at_step: 0
        root: C3
        chord: min7
        duration_steps: 4
        velocity: 96
      - at_step: 4
        root: F3
        chord: dom7
        duration_steps: 4
```

Melodic pattern pads:

```yaml
tracks:
  - type: melodic
    channel: 2
    pads:
      - pad: 1
        grid_pattern: "C3 . . ."
      - pad: 2
        grid_pattern: "F3 . . ."
      - pad: 3
        steps: "s0=G3:min7/4s s4=Bb3:maj7/4s"
```

Pad numbers are user-facing `1..8` (`P1..P8` in the UI). If you need to mirror the persisted zero-based shape directly, use `pad_index: 0..7`.

Pad-loop sequences:

```yaml
tracks:
  - type: melodic
    channel: 2
    pads:
      - pad: 1
        grid_pattern: "C3 . . ."
      - pad: 2
        grid_pattern: "F3 . . ."
      - pad: 3
        grid_pattern: "G3 . . ."
    pad_loop:
      repeat: true
      groups:
        A: [1, 2, P4, 2]
        B: [3, 2]
      super_groups:
        I: [A, B, B, A]
      root: [I, P8, I]
```

Sequence tokens:

- pads: `1..8`
- pauses: `P1`, `P2`, `P4`, `P8`, `P16`
- groups: capital letters such as `A`, `B`
- super-groups: roman numerals such as `I`, `II`

Groups may contain pads and pauses. Super-groups may contain pads, pauses, and groups. Root sequences may contain pads, pauses, groups, and super-groups. If a root token is ambiguous, use `group:A` or `super:I`.

General MIDI drummer grooves:

```text
backbeat, four_on_floor, half_time, breakbeat, electro, sparse
```

Drummer pads can define one groove per pad:

```yaml
tracks:
  - type: drummer
    channel: 10
    pads:
      - pad: 1
        groove: backbeat
      - pad: 2
        groove: breakbeat
    pad_loop: [1, 2, P2, 2]
```

Controller curve presets:

```text
flat, ramp_up, ramp_down, triangle, pulse, slow_sweep, adsr
```

Controller curves can also be explicit:

```yaml
tracks:
  - type: controller
    cc: 74
    curve: "0:24,0.5:96,1:48"
```

Controller sequencer pads can define one curve per pad:

```yaml
tracks:
  - type: controller
    cc: 74
    pads:
      - pad: 1
        curve: slow_sweep
      - pad: 2
        curve: triangle
      - pad: 3
        length_beats: 16
        curve: "0:24,0.5:96,1:48"
    pad_loop: [1, P4, 2, 3]
```

The current implementation supports explicit events, Roman numeral progressions, melodic pattern pads, drummer groove pads, controller curve pads, nested pad loops, and arpeggiator tracks. If validation fails, inspect `error.path` and `error.retry`.
