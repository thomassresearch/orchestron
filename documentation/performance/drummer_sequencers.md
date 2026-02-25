# Drummer Sequencers

**Navigation:** [Up](performance.md) | [Prev](sequencer_tracks_and_steps.md) | [Next](pattern_pads_and_pad_looper.md)

Drummer sequencers are drum-machine style step sequencers for fixed MIDI drum keys.

They are optimized for per-step drum hit programming instead of melodic note/chord entry.

## What Makes Them Different

Compared to melodic sequencer tracks, drummer sequencers:

- use MIDI key numbers (`0..127`) per row (drum instrument selection)
- do not use scale / mode / chord controls
- do not use pad transpose edge buttons
- let you program multiple drum rows per step
- store velocity per active drum hit (per row + step)

## Adding / Removing Drummer Sequencers

- Use the `Drummer` button in the sequencer section header to add a drummer sequencer card
- Each drummer sequencer card has its own `Remove` button

## Per-Drummer-Sequencer Controls

Each drummer sequencer card provides:

- track state badge (running/stopped or queued start/stop state)
- `Start` / `Stop` (enable state)
- `Remove`
- `Clear Steps`
- `+ Key` (add another drum row)
- `MIDI Channel` (`1..16`)
- `Steps` (`4`, `8`, `16`, `32`)
- Pad Looper controls (same concept as melodic sequencers)

## Drum Rows (`Keys`)

The left side of the drummer grid contains vertically stacked drum rows.

Each row has:

- row index label
- MIDI key input (`0..127`)
- row remove button (`x`)

### Auditioning Drum Keys While Editing

When the instrument engine session is running, changing a row key sends a short one-shot MIDI note preview on the drummer sequencer's MIDI channel.

This helps identify which drum sound is mapped to a given MIDI key number.

## Drum Step Grid (LED Matrix)

The grid is row-based:

- rows = selected drum keys
- columns = steps (`4/8/16/32`)

This keeps the `Keys` column horizontally aligned with the LED rows.

### LED States

- inactive step: dark LED with visible border
- active step: red LED
- active step in the current playing column: flashing green LED

### Velocity (Per Hit)

Velocity is shown by LED color saturation (stronger color = higher velocity).

The LED border color stays visible even at low velocities, so low-velocity active hits remain distinguishable from inactive steps.

### Editing Workflow

- Click an inactive LED to activate a hit
- Click an active LED (without dragging) to deactivate it
- Click and drag vertically on an LED to change velocity (`0..127`)
- Keyboard:
  - `Enter` / `Space` toggles the hit
  - `Arrow Up` / `Arrow Down` adjusts velocity

## Pattern Pads and Pad Looper

Drummer sequencers support the same `P1..P8` pattern-pad workflow and queued pad switching as melodic sequencer tracks.

They also support pad-loop sequences (`Pad Looper`, `Repeat`, pad sequence list).

Differences vs melodic sequencer pads:

- no transpose edge buttons (`-` / `+`)
- pad content is drum-row hit data + per-hit velocities (not note/chord/theory state)

## Typical Uses

- Kick / snare / hat step programming
- Percussion layers with multiple rows
- Switching between groove variations using pattern pads
- Automating drum pattern changes with pad looper while performing on piano roll/controllers

**Navigation:** [Up](performance.md) | [Prev](sequencer_tracks_and_steps.md) | [Next](pattern_pads_and_pad_looper.md)
