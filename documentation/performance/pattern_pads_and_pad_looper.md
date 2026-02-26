# Pattern Pads, Queued Switching, and Pad Looper

**Navigation:** [Up](performance.md) | [Prev](drummer_sequencers.md) | [Next](controller_sequencers.md)

Pattern pads are the per-track pattern banks (`P1..P8`). They support live switching, copying, and pad-loop sequencing for melodic, drummer, and controller sequencers (with transposition available on melodic sequencer pads only).

## Pattern Pads Overview

Each melodic sequencer track, drummer sequencer, and controller sequencer contains 8 pattern pads:

- `P1` to `P8`
- one active pad
- optional queued pad during live playback

Each pad stores the pattern content for that track:

- melodic sequencers: step notes/holds and related pad theory state used by pad operations
- drummer sequencers: per-row drum hits and per-hit velocities
- controller sequencers: controller curve/keypoint patterns

## Pad States

Pad buttons use visual states to indicate:

- Active pad
- Queued pad (will switch on loop boundary)
- Idle pad

## Live Pad Switching (Queued On Boundary)

Pad press behavior depends on transport state:

- When sequencer transport is stopped: pad selection changes immediately
- When sequencer transport is running: the pad switch is queued and applied on the next loop boundary

This avoids mid-pattern timing glitches and keeps pattern changes musical.

## Pad Copy (Drag-and-Drop)

You can copy one pad onto another by dragging and dropping pad buttons.

What gets copied:

- step note/hold data
- pad scale/mode settings used by pad-aware behavior (as documented in the integrated help)

This is the fastest way to create variations.

## Pad Edge Transpose Buttons (`-` / `+`) (Melodic Sequencer Pads)

Melodic sequencer pad buttons include small edge buttons for transposition.

Drummer sequencer pads do **not** include transpose edge buttons.

### Short Press (Quick Click)

- Transposes stored notes within the current scale by one degree up/down
- Keeps the same scale root and mode

Use this for quick harmonic variants of the same pattern.

### Long Press (Hold, about 350 ms)

- Performs a diatonic key-step transpose (moves pad tonic/root to adjacent scale degree)
- Keeps the mode
- Updates the pad scale root accordingly

Use this to move the pattern to a new key center while preserving mode character.

## Pad Looper (Pad Sequence)

Each track includes a **Pad Looper** section that can play a sequence of pads automatically.

Controls:

- `Pad Looper: On/Off`
- `Repeat: On/Off`
- Pad Sequence entry area

### Building The Pad Sequence

You can add pad steps to the pad-loop sequence by:

- Clicking the sequence area and pressing keyboard `1..8`
- Dragging pad buttons into the sequence area

### Sequence Display

The pad sequence area shows:

- ordered pad numbers
- remove (`x`) button per sequence item
- current pad-loop position highlight while running

### Nested Pad Sequences (Groups and Super-Groups)

The pad looper now supports **nested pattern sequences** on all sequencer types.

You can build reusable structures in two hierarchy levels:

- **Groups** labeled with capital letters (`A`, `B`, `C`, ...)
- **Super-groups** labeled with roman numerals (`I`, `II`, `III`, ...)

This lets you create sequences such as:

- root sequence: `A B B A`
- where `A` and `B` are reusable grouped pad patterns

#### Creating Groups / Super-Groups

- In the pad sequence editor, select multiple sequence items (Ctrl/Cmd-click)
- Right-click to open the context menu
- Choose:
  - `Group` to create a lettered group
  - `Super-group` to create a roman-numeral super-group (from selected groups)

#### Editing Groups (Reference-Based)

- Click a group (`A`) or super-group (`II`) to open/edit it
- The selected group expands into its own editable sequence area
- Changes are stored by reference, so **all occurrences** of that group/super-group in the root sequence use the updated content

You can edit grouped content by:

- reordering items (drag-and-drop)
- adding pads (`1..8` or drag pad buttons)
- removing items
- ungrouping selected items back inline

#### Recursion / Hierarchy Rules

To prevent recursive pattern definitions, hierarchy rules are enforced:

- groups can contain pads only
- super-groups can contain pads and groups
- root sequence can contain pads, groups, and super-groups
- same-level or higher-level nesting is blocked

#### Playback Highlighting (Nested)

While the sequencer is running, the pad looper highlights:

- the currently playing item in the **root sequence**
- the active group/super-group reference when the runtime position is inside it
- the currently playing item **inside an opened group/super-group editor**

#### Visual Color Coding

Nested pad-sequence tokens are color-coded by hierarchy:

- pads: green shades
- groups (`A`, `B`, `C`, ...): orange shades
- super-groups (`I`, `II`, `III`, ...): violet shades

### Repeat Toggle

- `Repeat: On` loops the pad sequence continuously
- `Repeat: Off` runs through the programmed sequence without repeating behavior (per runtime handling)

## When To Use Pad Looper vs Manual Pad Presses

Use manual pad presses for performance improvisation.

Use pad looper when you want:

- repeatable song-form-like pattern changes
- scripted variation cycles
- hands-free movement through pad banks while you play piano rolls/controllers

## Screenshots

<p align="center">
  <img src="../../screenshots/perform_pattern_pads_pad_looper_transpose.png" alt="Pattern pads and pad looper" width="900" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Pattern pads with transpose edge buttons and pad-loop sequence controls.</em></p>

<p align="center">
  <img src="../../screenshots/perform_sequencers_nested_pattern_pad_sequences.png" alt="Nested pad-loop sequences with groups and super-groups" width="900" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Nested pad-loop editor with reusable groups (A, B, C, ...) and super-groups (I, II, III, ...).</em></p>

**Navigation:** [Up](performance.md) | [Prev](drummer_sequencers.md) | [Next](controller_sequencers.md)
