# Per-note Timing and Syncopated Patterns

Use per-note timing to push or pull selected melodic notes/chords or individual drum hits while keeping the rest of a straight pattern unchanged. On-grid offbeats, rests and accents can also create syncopation; not every syncopated pattern needs an offset. Keep an anchor such as the kick straight and shift selected snares, hats, bass notes or stabs when the musical brief calls for anticipation or a laid-back feel.

## Musical meaning

- `timingOffsetPercent` is a whole percentage of one **local sequencer step**, from **−50 to +50**. Negative means early, positive means late; zero/missing means on grid.
- The equivalent milliseconds scale with global tempo, local grid and beat ratio. At 120 BPM, 4/4, subdivision 4 and speed 1×, −20% means 25 ms early. The CLI reports signed `timingOffsetMilliseconds` for inspection; it stores percentages, not milliseconds.
- A melodic step's chord moves together. Drummer offsets belong to individual row cells, independently of other simultaneous hits.
- The note's release moves with its attack, retaining its length and HOLD extension. A following attack clips overlap; if neighboring attacks coincide, the later logical step wins.
- An early first step anticipates a confirmed same-pad repeat. Fresh starts and different-pad launches clamp it to the boundary. Queued stops, pauses and finite arrangement ends suppress anticipation; a command cannot undo an attack that has already sounded.
- This is deliberate per-note placement. Swing changes recurring subdivisions; random humanization varies timing; beat ratios change a whole sequencer's speed. Do not change the beat ratio merely to nudge a few notes.

Timing is supported by melodic and drummer sequencers. Controller sequencers, piano rolls and arpeggiators are outside these commands.

## Read → edit → verify

Start a staged edit with `edit begin --performance PERFORMANCE_ID`, or create tracks in a new edit session. Discover IDs instead of guessing from device names:

```bash
uv run orchestron_cli --json edit sequencers list
```

The result lists track IDs/types, pad numbers and lengths, and drum row IDs/MIDI keys. In the following examples, replace `voice-1`, `drum-1` and the drum row ID with values from that result:

```bash
uv run orchestron_cli --json edit step-timing list --track voice-1 --pad 1
uv run orchestron_cli --json edit step-timing set --track voice-1 --pad 1 --step 3 --step 11 --percent -20
uv run orchestron_cli --json edit step-timing list --track voice-1 --pad 1 --step 3 --step 11

uv run orchestron_cli --json edit step-timing list --track drum-1 --pad 1 --key 38
uv run orchestron_cli --json edit step-timing set --track drum-1 --pad 1 --key 38 --step 4 --step 12 --percent 15
uv run orchestron_cli --json edit step-timing reset --track drum-1 --pad 1 --row drum-row-2 --step 4
```

Pads are **1-based** (`1..8` or `P1..P8`). Steps are **0-based**, like `s0` and score `at_step`: `--step 3` means the fourth visible cell. Indices must be inside the selected pad's current pattern length. `--track` and `--pad` are always explicit, including for inactive pads.

`list` defaults to every step in the selected pad, including rests, HOLDs and inactive hits. It includes note/hit identity, velocity, offset percentage and milliseconds. A drum listing without a selector includes all rows. Drum edits require one `--row` or `--key`; when several rows share a key, use a unique row ID. Melodic commands reject drum selectors. Repeat `--step` to apply the same setting to several cells; `reset` restores zero only on those cells.

Edits preserve note content, HOLD, velocity and activation. An offset on a rest or inactive hit is retained without creating an attack. Failed edits do not write partial changes. Listing is read-only. These commands operate on the staged file and require no running backend once that file exists.

After verifying the result:

```bash
uv run orchestron_cli --json edit validate
uv run orchestron_cli --json edit commit
# When attached to a matching live runtime:
uv run orchestron_cli --json edit push-runtime
```

Validation, commit and runtime operations use the existing backend workflow. Timing changes require a runtime push, not a rack rebuild. Never edit SQLite or patch the staged JSON manually just to change timing.

## Generate patterns with timing

Melodic `events` and object-form `progression` entries accept `timing_offset_percent`. Continuation HOLD cells do not inherit the attack's offset; the scheduler moves the held note's duration automatically.

```yaml
tracks:
  - type: melodic
    channel: 2
    events:
      - at_step: 3
        root: C3
        chord: min7
        duration_steps: 2
        timing_offset_percent: -20
  - type: melodic
    channel: 3
    progression:
      - roman: i7
        at_step: 0
        duration_steps: 4
      - roman: IV7
        at_step: 4
        duration_steps: 4
        timing_offset_percent: 10
```

Use `step_timing` for compact/grid patterns, drum grooves, or separate pad variations. It is applied after the notes or groove are generated:

```yaml
tracks:
  - type: melodic
    channel: 2
    pads:
      - pad: 1
        grid_pattern: "C3 . . G3 . . . Bb3"
        step_timing:
          - at_step: 3
            timing_offset_percent: -20
      - pad: 2
        steps: "s0=F3/2s s7=C4"
        step_timing:
          - at_step: 7
            timing_offset_percent: 15
  - type: drummer
    channel: 10
    groove: backbeat
    step_timing:
      - at_step: 4
        key: 38
        timing_offset_percent: 15
      - at_step: 12
        key: 38
        timing_offset_percent: 15
```

Apply YAML or JSON with `edit apply-score path/to/score.yaml`. Track-level `step_timing` targets that track's primary pad (`pad`, `pad_index`, or P1 by default); it does not spread to other pads. A pad's own `step_timing` targets only that pad. Drummer entries require a MIDI `key` identifying an existing row; melodic entries omit it.

Offsets and step indices must be integers, not booleans, decimals or numeric strings in a score. Duplicate assignments to the same pad/step/hit are errors, including conflicts between inline event timing, track-level timing and pad-level timing. Timing on events/progressions hidden by a higher-priority `steps` pattern is rejected. Errors include a score path; the staged performance remains unchanged if any entry fails. Existing note/chord token syntax stays unchanged.

## Persistence

The CLI writes performance config v16 and reads v1–16. Persisted steps/cells use `timingOffsetPercent`; score events and the runtime API use `timing_offset_percent`. Save/load, native bundles, CLI runtime conversion and both CSD export modes preserve supported offsets. App-state version 2, native envelope version 1 and score-spec version 1 remain unchanged.

## Meter timing and compatibility

Performance configurations write v17. The CLI migrates v1–16 before normalization, including /8 pad/rest lengths and saved arranger history. Session requests explicitly send `beat_unit: "meter"`; omitted API values retain legacy quarter-beat interpretation. Subdivision accepts 1, 2, 3, 4, 6, 8; melodic/drum lengths accept 1–16 and controller lengths 1–32, with a strict 128-step limit. Rest tokens include -32. Global BPM remains quarter-note based; /8 local beats last half a quarter. Millisecond offsets include the denominator and playback-speed ratio. Native bundle envelopes are unchanged.

For twelve triplet steps over one 4/4 bar, set `lengthBeats: 4`, timing `meterNumerator: 4`, `meterDenominator: 4`, `stepsPerBeat: 3`, and speed numerator/denominator 1/1. A 6/8 bar uses length 6 and spans three shared quarter beats. See the [multilingual timing guide](../../../../documentation/performance/sequencer_timing.md).
