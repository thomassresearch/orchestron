# Custom Drum Patterns

For clip sessions, use [the clip song workflow](song_workflow.md) and [scoped cell/structure operations](song_editing.md). The pad commands and eight-pad limits below describe legacy sessions; musical syntax and control semantics still apply.

Use a Drummer Sequencer for drum-kit parts, including Analog Drumkit. Choose MIDI keys from the actual instrument's mapping; the CLI's General MIDI presets are optional. Custom keys automatically add rows shared by all eight pads, alongside the existing default rows.

## CLI

```bash
uv run --locked orchestron_cli --json edit add-drummer --channel 10 \
  --name "Kick and percussion" --length-beats 4 \
  --hits "35@0:115 35@4:108 35@8:112 35@12:108 38@4:100 38@12:106 54@7:64" \
  --pad-hits "2=35@0:115 38@12:96 38@14:70 38@15:55" \
  --pad-hits "3=" --pad-groove "4=electro" \
  --pad-loop "A A 2 3" --pad-loop-group "A=1 1 1 4"
```

- Each token is `KEY@STEP:VELOCITY`, separated by whitespace. MIDI keys are integers 0–127; velocity is 1–127. Steps start at 0 on the track's local grid.
- `--pad 1..8` selects the primary pad (default 1). Repeat `--pad-hits "PAD=..."` for other patterns.
- `--hits ""` or `--pad-hits "3="` creates an explicitly silent pattern. Omitted hits remain inactive; no preset is layered underneath a custom pattern.
- Choose either `--groove` or `--hits` for a pad. Different pads may mix custom patterns and presets. With neither primary option, the primary pad defaults to backbeat, unless that pad has an explicit `--pad-hits` / `--pad-groove` assignment.
- Multiple drum keys can sound on the same step. Duplicate key/step pairs, repeated definitions of the same pad pattern, and hits outside the pad's active length are errors. Use ratchets for repeated hits within one cell.

## YAML/JSON Score

Use `edit apply-score /absolute/path/drums.yaml` for custom local meter/subdivision, per-pad lengths and larger arrangements. Both score-spec versions accept `hits` at track level (the primary pad) or inside a pad:

```yaml
version: 2
tempo: 116
tracks:
  - type: drummer
    name: Dance drums
    channel: 10
    length_beats: 4
    timing: {steps_per_beat: 4}
    pads:
      - pad: 1
        hits:
          - {key: 35, at_step: 0, velocity: 115}
          - {key: 35, at_step: 4, velocity: 108}
          - {key: 38, at_step: 4, velocity: 98}
          - {key: 54, at_step: 7, velocity: 65}
        step_timing:
          - {key: 38, at_step: 4, timing_offset_percent: 5}
      - pad: 2
        hits:
          - {key: 38, at_step: 12, velocity: 100}
        step_ratchets:
          - {key: 38, at_step: 12, ratchets: 4, ratchet_end_velocity: 40}
      - pad: 3
        hits: []
    pad_loop: {root: [1, 1, 1, 2, 3], repeat: false}
```

Each hit accepts `key`, `at_step` and optional `velocity` (default 100). All are integers; unknown hit fields are rejected. `at_step` must be less than that pad's `length_beats × steps_per_beat`. A pad holds 1–16 local beats. `hits: []` means silence; `null` is invalid. Define a pad's material once, using either `hits` or `groove`, including when combining track-level and pad-level fields.

For early/late hits, use [step timing](step_timing.md); for rolls and velocity ramps, use [ratchets](step_ratchets.md). These fields operate on the custom rows just as on preset rows. Inspect IDs with `edit sequencers list`. These commands stage ordinary Drummer data, retained through save/load and runtime export; they do not create Score Sequencers.
