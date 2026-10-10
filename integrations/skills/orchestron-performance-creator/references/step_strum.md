# Melodic Chord Strumming

Use strumming to play a melodic chord once in pitch order instead of attacking all notes together. `up` plays low to high, `down` high to low, and `off` plays simultaneously. **Spread** is an integer **0–100% of one local grid step**, measured from the first to the last note, not the gap between individual notes or the distance to the next occupied step.

At 120 BPM, 4/4, Subdivision 4 and speed 1×, one step lasts 125 ms. A three-note chord at 40% starts at 0, 25 and 50 ms; at 100%, at 0, 62.5 and 125 ms. The last note at 100% reaches the next grid step. Spread follows global tempo and the sequencer's meter, subdivision and beat ratio. Timing offsets shift the entire strum.

## Inspect and Edit a Staged Performance

Discover exact melodic track IDs with `edit sequencers list`; IDs below are examples. Pads are **1–8** or **P1–P8**. Steps are **zero-based** and must be inside the selected pad's current step count. Repeat `--step` to select several; repeated indices are deduplicated. `list` without `--step` reads all visible steps in that pad.

```bash
uv run orchestron_cli --json edit sequencers list
uv run orchestron_cli --json edit strum list --track voice-1 --pad 1
uv run orchestron_cli --json edit strum set --track voice-1 --pad 1 --step 0 --step 4 --direction up --spread 40
uv run orchestron_cli --json edit strum set --track voice-1 --pad P2 --step 0 --direction down --spread 100
uv run orchestron_cli --json edit strum set --track voice-1 --pad 1 --step 4 --spread 65
uv run orchestron_cli --json edit strum set --track voice-1 --pad 1 --step 4 --direction off
uv run orchestron_cli --json edit strum reset --track voice-1 --pad 1 --step 0 --step 4
```

`set` requires `--direction`, `--spread`, or both; an omitted setting retains its value. `--spread-percent` is an alias for `--spread`. Set both on a new chord to make the strum audible: defaults are off/0. Direction `off` retains the spread; `reset` restores **off and 0%**. Mutations require explicit track, pad and steps. These commands accept melodic tracks only; drum rolls use [ratchets](step_ratchets.md), while repeating note patterns use [arpeggiators](harmony_arpeggiation.md).

Commands change only strum settings. Notes, chords, velocity, HOLD, timing, other pads and arrangement data are preserved. Settings can be stored on rests, HOLD continuations and single notes without activating them; they take effect when that step contains a chord. Listing never writes the staged file. Once a staged session exists, these commands work without a backend connection. Invalid selections, directions and percentages leave the staged file unchanged and report `error.path` / `error.retry`.

Results include track identity and per-step `pad`, `step`, note/chord/HOLD/velocity, timing, `strumDirection`, `strumSpreadPercent`, `strumSpreadMilliseconds` and `strumActive`. Milliseconds describe the configured spread, even while disabled. `strumActive` requires multiple resolved pitches, nonzero velocity, direction up/down and nonzero spread; it does not report whether transport is running.

After staging changes, use `edit validate`, `edit commit`, and, for an attached runtime, `edit push-runtime`. Strum edits need no rack rebuild. Use these commands instead of manually patching staged JSON or SQLite.

## YAML / JSON Scores

Melodic tracks and pads accept `step_strum` lists. Each entry requires `at_step` and at least one of `strum_direction` / `strum_spread_percent`. Track-level entries target the primary pad (`pad`, `pad_index`, or P1 by default); pad-level entries target that pad. They apply after notes are generated, so they also work with compact `steps` and `grid_pattern` strings.

```yaml
version: 1
tempo: 120
tracks:
  - type: melodic
    channel: 2
    pad: 2
    step_strum:
      - at_step: 4
        strum_direction: down
        strum_spread_percent: 100
    pads:
      - pad: 2
        steps: "s0=C3:maj/4s s4=F3:min7/4s"
        step_strum:
          - at_step: 0
            strum_direction: up
            strum_spread_percent: 40
        step_timing:
          - at_step: 4
            timing_offset_percent: -20
      - pad: 3
        events:
          - root: G3
            chord: dom7
            duration_steps: 4
            strum_direction: down
            strum_spread_percent: 65
```

Melodic `events` and object-form `progression` entries also accept `strum_direction` and `strum_spread_percent` directly:

```yaml
tracks:
  - type: melodic
    key: C
    mode: ionian
    progression:
      - roman: Imaj7
        duration_steps: 4
        strum_direction: up
        strum_spread_percent: 40
      - roman: IV7
        duration_steps: 4
        timing_offset_percent: 20
        strum_direction: down
        strum_spread_percent: 75
```

Omitted progression positions follow the existing duration-based cursor. Inline strumming applies to the attack step, not its generated HOLD continuations. Compact note/chord tokens remain unchanged.

Use integer percentages and step indices, not booleans, decimal values or numeric strings. In YAML, quote **`"off"`** because unquoted `off` is interpreted as a boolean by the YAML loader. Unknown keys in `step_strum` entries, missing values, non-melodic targets, duplicate assignments to one pad/step (including inline/list conflicts), and strumming attached to material hidden by higher-priority `steps`/`events` are errors. A failed `edit apply-score` leaves the staged file unchanged. Timing and strumming may target the same step. Score-spec version remains 1.

## Playback and Persistence

Each note keeps the original chord duration, including HOLD extensions, so delayed notes can overlap later steps. Repeated pitches retrigger and replace their old release; at simultaneous same-pitch attacks, the later logical step wins. Different pitches at the same boundary remain audible. Off, 0% and single notes play simultaneously. Melodic strumming has no ratchet setting.

Direction, spread and timing edits to a started strum affect its next occurrence; HOLD edits still adjust releases. Same-pad repeats can carry delayed notes across their boundary. Stops, seeks, different pads, arrangement rests and finite endings cancel unfinished strums. This behavior is shared by live playback and both MIDI/SCORE CSD exports, within their timing resolution.

The CLI writes performance v19 and reads v1–19. Stored steps use `strumDirection` / `strumSpreadPercent`; runtime requests use `strum_direction` / `strum_spread_percent`. Normalization, save/load, native bundles, hidden steps and copies retain inactive settings. Existing performances default to off/0. App-state v3 and native envelope v1 are unchanged.
