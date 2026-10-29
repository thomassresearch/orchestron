# Score Sequencer authoring

`edit add-score-sequencer --spec PATH` appends a dedicated sparse Score Sequencer
to the staged performance. PATH is a JSON or YAML track object in authored
camelCase form. This is separate from `edit apply-score`: composition-score v1/v2
inputs keep their existing melodic-step interpretation.

```json
{
  "id": "score-strings",
  "name": "Long strings",
  "midiChannel": 2,
  "launchQuantization": "bar",
  "pads": [{
    "lengthBeats": 1200,
    "scaleRoot": "C",
    "scaleType": "minor",
    "mode": "aeolian",
    "notes": [
      {"id": "c", "pitch": 60, "velocity": 90, "startTicks": 0, "durationTicks": 80640},
      {"id": "eb", "pitch": 63, "velocity": 76, "startTicks": 20160, "durationTicks": 40320}
    ]
  }]
}
```

At 120 BPM and 4/4, 1,200 beats last ten minutes. Notes use **20,160 integer ticks
per quarter note before playback-speed scaling**. In /8 meter a local beat is
10,080 ticks. Subdivision affects the editing grid, not stored events.

```bash
uv run --locked orchestron_cli --json edit add-score-sequencer --spec /absolute/path/score-track.json
uv run --locked orchestron_cli --json edit sequencers list
uv run --locked orchestron_cli --json edit validate
uv run --locked orchestron_cli --json edit commit
```

The command fills omitted pads to eight, defaulting to four local bars. Pads are
array entries 0–7; `activePad` uses the same zero-based indexing. Each pad has its
own scale, mode, length and notes. Optional track `timing` uses the normal meter,
subdivision and rational beat-rate fields; tempo follows the performance.
`launchQuantization` is `bar` (next local bar or earlier pad end) or `score`
(end of score). `padLoopPattern`, `padLoopEnabled` and `padLoopRepeat` use the
existing arrangement structure. A pad remains a whole arranger occurrence.

Note IDs must be nonempty, unique within their pad, at most 128 characters, and
stable across edits. Pitch and velocity are integers 0–127; velocity zero is
silent. Start is 0–165,150,719 ticks, duration 1–165,150,720 ticks. Pad length is
1–8,192 local beats. Maximums are 16 tracks, 10,000 notes per pad and 50,000 notes
per performance. Invalid additions leave the staged document unchanged.

Shortening preserves hidden notes and clips playback at the pad end; extending
restores their original timing. Different pitches sustain independently;
same-pitch retriggers replace the preceding release. Seeking or exporting from
inside a note starts its remaining duration.

The CLI writes performance v21 and accepts v1–21. Older documents normalize to
an empty `sequencer.scoreTracks`. Save/load, cloning, native JSON/ZIP and runtime
conversion retain all notes and pad definitions. Session requests use
`score_tracks`, `start_ticks`, `duration_ticks` and the corresponding snake_case
track fields. MIDI and SCORE exports use the live scheduler and existing event
budgets. App state is v4; native bundle envelopes remain v1.
