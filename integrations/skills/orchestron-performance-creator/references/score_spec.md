# Score Spec Reference

Use YAML or JSON score specs for multitrack performance generation.

The importer accepts score versions **1 and 2** (missing version means 1).
Composition Creator exports version 2. Both versions support event velocity and
local track timing; v2 additionally rejects unknown melodic event fields,
overlapping events in a voice, fractional step indices/durations, and events
outside the active pad. These checks prevent silent loss during composition
handoffs. The performance configuration stays v19, independently of score versions.
Score application is atomic: an invalid track leaves the staged performance unchanged.

`edit apply-score` appends tracks. Apply a whole-song export once to a new staged
draft, after binding the score's MIDI channels to instruments. The score file is
not a native performance bundle and is not imported with the GUI's Import button.

Score tracks with `type: controller` are MIDI CC automation. For fixed instrument customization using `perf_controller` (ADSR times, distortion, etc.), use the separate staged `edit performance-controllers` commands described in [performance controllers](performance_controllers.md). Do not put these values in a CC curve or invent a `perf_controller` score-track type.

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
uv run --locked orchestron_cli --json edit apply-score path/to/score.yaml
```

For early/late placement, see [per-note timing](step_timing.md): melodic `events` and object-form `progression` entries accept `timing_offset_percent`; melodic/drummer tracks and pads accept `step_timing` lists. Values are integer percentages from −50 to +50. These additions retain score-spec version 1.

For strummed chords, melodic `events` and object-form `progression` entries accept `strum_direction` (`"off"`, `up`, `down`) and `strum_spread_percent` (integer 0–100). Tracks and pads can instead use `step_strum` lists with `at_step` and either or both settings. Spread measures the first-to-last attack interval as a percentage of one local grid step; each note retains its full duration. See [melodic strumming](step_strum.md) for examples, targeting, inactive settings and validation. Quote `"off"` in YAML to avoid boolean conversion. Score-spec version remains 1.

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

An event's `velocity` overrides its pad/track velocity. Object-form `progression`
entries support the same override. Values must be integers 1..127. Velocities
attached to events hidden by a higher-priority `steps` pattern are rejected.
HOLD continuation cells preserve duration; the attack velocity controls the note.

## Local timing and composition handoff

Orchestron supports up to 16 sequencers of each type (melodic, drummer and
controller), each with eight pattern pads. Preserve every generated voice when
loading or saving the score; eight pads is not an eight-track limit. The skill's
Python loader and Orchestron's frontend loader are separate. Older frontend
builds truncated imported performances to eight sequencers even though the CLI
and offline renderer retained them. When checking a many-voice handoff, verify
the track count after loading it in the current app as well as in the CLI.

Melodic, drummer and controller tracks accept `timing` with these snake-case fields:

| Field | Values |
| --- | --- |
| `meter_numerator` | 2, 3, 4, 5, 6, 7 |
| `meter_denominator` | 4, 8 |
| `steps_per_beat` | 1, 2, 3, 4, 6, 8 |
| `beat_rate_numerator`, `beat_rate_denominator` | Ratios 1/1, 2/1, 3/2, 4/3, 3/4, 5/4, 4/5, 7/4 |

Unspecified fields inherit the current global timing; the resulting track owns an
independent timing object. Tempo remains global, set by top-level `tempo` (quarter
notes per minute). Local timing belongs to the track, not an individual pad.
Arpeggiators use their existing `rate` setting. All tracks still obey the 128-step
pad limit and existing melodic/drummer/controller length limits.

```yaml
version: 2
tempo: 108
key: D
mode: dorian
tracks:
  - type: melodic
    name: Melody
    channel: 1
    length_beats: 4
    timing:
      meter_numerator: 4
      meter_denominator: 4
      steps_per_beat: 3
      beat_rate_numerator: 1
      beat_rate_denominator: 1
    events:
      - {at_step: 0, root: D4, duration_steps: 1, velocity: 94}
      - {at_step: 2, root: F4, duration_steps: 2, velocity: 76}
      - {at_step: 6, root: D4, duration_steps: 3, velocity: 82}
    pad_loop: {repeat: false, root: [1]}
```

Use `events: []` for an explicitly silent pad. Blank tail cells and finite pad-loop
rests retain the closing time. V2 explicit events must not overlap, including
their held durations. Supported named chords share an attack/duration; arbitrary
voicings or independent overlapping voices use coordinated separate tracks on the
same MIDI channel. Do not supply MIDI pitch arrays to persisted note/chord cells.

Composition Creator performs that voice splitting, grid selection and pad layout
and exports `orchestron-score.json`. Read its sibling
[score/handoff reference](../../orchestron-composition-creator/references/score_and_handoff.md)
when converting from its rational-time `composition.json`. Preview MIDI programs
do not identify Orchestron patch IDs: discover and bind suitable instruments.

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

Drummer tracks and pads also accept `step_ratchets` entries with `key`, `at_step`, `ratchets` (1–8) and optional `ratchet_end_velocity` (0–127 or null). These settings apply to generated cells without changing their activation or initial velocity. See [drummer ratchets](step_ratchets.md) for full score examples, pad targeting, strict validation and velocity ramps.

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
