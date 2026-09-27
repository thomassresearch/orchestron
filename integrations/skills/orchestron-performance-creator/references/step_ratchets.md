# Drummer Ratchets and Velocity Ramps

Use ratchets for drum rolls within one local step. Counts are **1–8**; one hit is normal playback. A nullable final velocity selects constant velocity or a linear ramp from the cell's existing velocity. Final velocity accepts **0–127**; zero is a silent strike. Four hits from 100 to 40 produce velocities 100, 80, 60, 40.

## CLI: inspect, set and reset

Start an edit session and create a groove with `edit add-drummer`, or load an existing performance. Discover the actual track and row IDs with `edit sequencers list`. Run these commands from the skill directory, replacing `drum-1` with the discovered ID:

```bash
uv run orchestron_cli --json edit sequencers list
uv run orchestron_cli --json edit ratchets list --track drum-1 --pad 1
uv run orchestron_cli --json edit ratchets set --track drum-1 --pad 1 --key 38 --step 4 --step 12 --count 4 --end-velocity 40
uv run orchestron_cli --json edit ratchets list --track drum-1 --pad 1 --key 38 --step 4 --step 12
uv run orchestron_cli --json edit ratchets set --track drum-1 --pad 1 --key 38 --step 4 --count 8 --constant
uv run orchestron_cli --json edit ratchets reset --track drum-1 --pad 1 --key 38 --step 12
```

- Pads are **1-based** (`1..8` or `P1..P8`); steps are **zero-based** and must fit the selected pad's current length.
- `set` and `reset` require `--track`, `--pad`, one or more `--step`, and either `--row ROW_ID` or `--key MIDI_KEY`. Use a row ID when several rows share the same MIDI key. These commands support drummer tracks only.
- `set` requires `--count 1..8`. Omit both ramp flags to retain the current final velocity, including when setting count 1. Count 1 ignores the retained ramp during playback.
- `--end-velocity 0..127` sets the ramp endpoint. `--constant` clears it to null. The two flags are mutually exclusive. `reset` restores count 1 and clears the ramp.
- `list` defaults to all rows and steps of the selected pad. Optional row/key and step selectors narrow it. Output includes activation, initial velocity, timing, count and final velocity, including defaults for legacy cells.

Edits affect the explicitly selected pad, preserve initial velocity and timing, and **do not activate inactive cells**. Apply ratchets to active groove hits to hear a roll. Listing never writes the staged file, and invalid selections or values leave it unchanged. Once a staged file exists, these commands work without a backend connection.

After checking the result, use `edit validate`, `edit commit`, and, for an attached live session, `edit push-runtime`. A ratchet edit requires no rack rebuild. Use these commands instead of manually patching staged JSON or SQLite.

## YAML/JSON score authoring

Apply `step_ratchets` after generating a drummer groove. Each entry requires `key`, `at_step` and `ratchets`; `ratchet_end_velocity` is optional and defaults to null (constant velocity).

```yaml
version: 1
tempo: 120
tracks:
  - type: drummer
    channel: 10
    groove: backbeat
    step_ratchets:
      - key: 38
        at_step: 4
        ratchets: 4
        ratchet_end_velocity: 40
    pads:
      - pad: 2
        groove: backbeat
        step_ratchets:
          - key: 38
            at_step: 12
            ratchets: 8
            ratchet_end_velocity: 0
        step_timing:
          - key: 38
            at_step: 12
            timing_offset_percent: -20
```

Load with `edit apply-score path/to/score.yaml` (or `.json`). Track-level `step_ratchets` targets the primary pad (`pad`, `pad_index`, or P1 by default); each pad's list targets only that pad. Neither form activates inactive cells. Timing and ratchets can target the same hit.

Score values must be integers, not booleans, decimals or numeric strings; only the final velocity accepts null. Unknown entry fields, missing fields, invalid rows/steps, duplicate assignments to the same pad/row/step, and use on non-drummer tracks fail with a score path. Failure leaves the staged file unchanged, even if earlier tracks in that score were valid. Score-spec version remains 1.

## Playback and persistence

At 120 BPM, 4/4 and Subdivision 4, four ratchets sound at 0, 31.25, 62.5 and 93.75 ms. Timing shifts the whole roll; a following active cell in the same row cuts off remaining repeats. An early first roll is clamped at fresh starts and different-pad launches, and can anticipate confirmed same-pad repeats. Edits made during a roll take effect on its next occurrence after live preparation.

Performance v18 stores `ratchets` and `ratchetEndVelocity`; the runtime API uses `ratchets` and `ratchet_end_velocity`. Save/load, native bundles and both CSD exports preserve them. Deactivation retains settings; Clear Steps in the editor resets them. The CLI reads performance versions 1–18. Missing fields mean one hit and constant velocity. Drummer counts of 1–8 are separate from arpeggiator ratchets, which have their own 1–4 range.
