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

General MIDI drummer grooves:

```text
backbeat, four_on_floor, half_time, breakbeat, electro, sparse
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

The current implementation supports explicit events, Roman numeral progressions, drummer grooves, controller curves, and arpeggiator tracks. If validation fails, inspect `error.path` and `error.retry`.
