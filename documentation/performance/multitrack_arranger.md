# Multitrack Arranger

**Navigation:** [Up](performance.md) | [Prev](pattern_pads_and_pad_looper.md) | [Next](controller_sequencers.md)

The **Multitrack Arranger** is a shared timeline view for pad-loop arrangements across all sequencer types. It appears on the Perform page when at least one melodic sequencer, drummer sequencer, or controller sequencer exists.

## Collapse the Panel

Collapse the Multitrack Arranger header to hide its timelines. Device summary, transport, zoom controls and help remain available. Reopening preserves zoom, horizontal scroll and editing state, and adapts the timeline to the current viewport. Panels start expanded and remember your choice across view switches until browser reload. Collapsing does not stop playback or discard edits.

## What It Arranges

The arranger shows one row per track:

- melodic sequencers
- drummer sequencers
- controller sequencers

Each row includes:

- track title (`Melodic Sequencer N`, `Drummer Sequencer N`, `Controller Sequencer N`)
- track subtitle (MIDI channel + assigned patch name, or `CC N` for controller sequencers)
- a root pattern timeline aligned to the shared transport beat grid

## Root Timeline Tokens

The root timeline displays arranged pattern tokens:

- pad tokens (`1..8`)
- group tokens (`A`, `B`, `C`, ...)
- super-group tokens (`I`, `II`, `III`, ...)

Pause tokens are part of the underlying data model, but they are hidden in the root timeline to keep the overview compact.

The arranger always shows the current absolute playhead position, even while stopped.

## Arranger Transport

The arranger header provides cassette-style transport controls with icon buttons:

- `Rewind`: move the playhead `1` beat backward
- `Stop`: stop sequencers whose `Pad Looper` is on while preserving the current playhead position; manually started sequencers whose `Pad Looper` is off keep running
- `Play`: start the instrument engine if needed, start sequencers whose `Pad Looper` is on, and stop sequencers whose `Pad Looper` is off so arranger playback stays synchronized
- `Fast forward`: move the playhead `1` beat forward
- `?`: open the integrated multilingual help modal for a concise arranger workflow summary

The transport controls the pad-loop arrangement for melodic sequencers, drummer sequencers, and controller sequencers. Individual sequencer `Start` / `Stop` buttons remain available for composing and auditioning patterns outside arranger playback. Arpeggiators, piano rolls, and manual MIDI controller lanes remain individually controlled.

Double-click `Stop` to reset the playhead to the selected loop start. If no loop range is selected, the playhead resets to step `0`.

## Root Timeline Editing

You can edit arrangement structure directly on each row:

- click to select a token
- use `Ctrl/Cmd/Shift + click` for additive multi-selection
- right-click to open the context menu

Context menu actions:

- `Add pad` submenu (insert a pad token at the clicked pause gap, or append at the end)
- `Add group` submenu (insert an existing lettered group token)
- `Add super-group` submenu (insert an existing roman-numeral super-group token)
- `Copy` / `Paste` (duplicate selected pads/groups/super-groups; root pastes use a large-enough pause gap or the sequence end)
- `Group` (creates a lettered group)
- `Super-group` (creates a roman-numeral super-group)
- `Ungroup` (expands grouped content inline)
- `Remove` (deletes selected tokens)

### Drag Reorder in Root

Use the `::` handle on a token to drag it on the root timeline.

- drag moves are quantized to the shared transport beat grid
- dragging a selected contiguous block moves that whole block
- dropping beyond current content can extend the timeline
- when needed, pause spans are re-materialized automatically to preserve timing structure
- quick swap is supported for single-token moves onto an adjacent non-pause token with matching length

## Group/Super-group Editor

Click a group or super-group token to open its nested editor.

In the opened editor, you can:

- return to root with `Main`
- append pads using `1..8`
- append pauses using `P1`, `P2`, `P4`, `P8`, `P16`
- drag-and-drop tokens to reorder within the same container
- remove individual tokens with `x`
- right-click for `Add pad`, `Add group`, `Add super-group`, `Copy`, `Paste`, `Group`, `Super-group`, `Ungroup`, `Remove`

The editor also shows `Total steps` for the opened container, resolved from beat lengths on the shared transport grid.

## Zoom and Timeline Navigation

Arranger timeline controls:

- cassette-style transport buttons
- `Fit`, immediately left of `Zoom -`, adjusts zoom to show the full length of the longest track without horizontal scrolling and returns the view to the start
- `Zoom -` / `Zoom +`
- live zoom percent readout
- horizontal scroll via mouse wheel (and `Shift + wheel` support)
- bottom scrollbar for long timelines

**DE:** `Einpassen` links neben `Zoom -` passt den Zoom an die gesamte Laenge der laengsten Spur an und setzt die Ansicht an den Anfang, ohne horizontales Scrollen.

**FR :** `Ajuster`, a gauche de `Zoom -`, adapte le zoom a toute la longueur de la piste la plus longue et revient au debut, sans defilement horizontal.

**ES:** `Ajustar`, a la izquierda de `Zoom -`, adapta el zoom a toda la longitud de la pista mas larga y vuelve al inicio, sin desplazamiento horizontal.

## Loop Range Selection

Above the horizontal scrollbar, the arranger shows a shared loop-range ruler quantized to beat blocks.

- click anywhere on the ruler to clear any loop selection and move the playhead to the clicked beat
- if playback is running, it continues from that beat; if stopped, it stays stopped
- drag on the ruler in either direction to preview a playback range, including a single beat; release to activate it
- if the playhead is outside a newly selected range, it jumps to the range start
- cancelling a drag leaves the previous range and playback position unchanged
- the selected span is highlighted across all arranger rows
- when a range is selected, playback loops inside that range
- when no range is selected, playback continues until stopped; continuously looping tracks keep cycling according to their own repeat settings

## Keyboard Shortcuts

When a timeline container is focused:

- `1..8`: append corresponding pad token
- `Delete` / `Backspace`: remove current token selection

## Notes

- Arranger edits write directly into each track's pad-loop pattern state.
- Playback range selection is stored with the performance and restored when the performance is loaded again.
- The section currently shows `1 device (auto)` as the device summary.
- If no sequencer-type tracks exist, the multitrack arranger is hidden.

## Screenshot

<p align="center">
  <img src="../../screenshots/perform_sequencers_nested_pattern_pad_sequences.png" alt="Multitrack arranger nested group editor" width="900" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Nested sequence editing inside the pattern pad sequencer (groups and super-groups).</em></p>

<p align="center">
  <img src="../../screenshots/perform_multitrack_arranger.png" alt="Multitrack arranger track view" width="900" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Multitrack arranger (track view, all instruments).</em></p>


**Navigation:** [Up](performance.md) | [Prev](pattern_pads_and_pad_looper.md) | [Next](controller_sequencers.md)
