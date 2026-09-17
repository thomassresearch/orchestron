# Multitrack Arranger

**Navigation:** [Up](performance.md) | [Prev](pattern_pads_and_pad_looper.md) | [Next](controller_sequencers.md)

The arranger is the only editor of song order. Each lane places references to its eight pads, reusable groups and supergroups, and rests. Sequencers edit the contents of those definitions. Editing a shared definition changes every occurrence; changing its duration shifts following material on that lane.

## Place and move material

Select a lane to show its palette and Add controls. Choose a pad, group, supergroup or rest, then drag it to the timeline or use Add at the displayed position. Empty phrase drafts cannot be placed. The ruler numbers master bars and beats; each lane snaps to whole local beats using its existing beat ratio. Drop previews show the resulting master-beat position and duration.

Musical items fit into available silence or extend the lane. A move leaves equal-duration silence at the source and preserves all unselected positions. Red previews reject occupied destinations. **Insert and shift later items** inserts at an item boundary and shifts only that lane. Adding a rest always inserts time at a boundary.

**New pattern** opens an unused existing pad slot. It never overwrites another pattern or creates a ninth pad. **Duplicate occurrence** keeps the shared definition reference. **Create variation** copies a pad into an available slot, or creates a new group/supergroup definition, and retargets only the selected occurrence.

Double-click a pad to edit it in its sequencer. Select a group or supergroup and use **Edit**, or double-click it, to open the same definition editor used by the sequencer. Group, Supergroup and Ungroup work on selected phrase contents; ungrouping keeps the original definition in the library.

## Delete and resize rests

- **Delete/Backspace** and **Remove, leave gap** replace selected musical occurrences with equal-duration silence. Other occurrences keep their positions.
- **Remove and close gap** (also Shift+Delete) removes selected musical occurrences or rest spans and closes their time on this lane. Multiple selections form one edit.
- Consecutive pause tokens appear as one rest span. Drag its right edge or edit its Duration field to resize it in whole local beats, shifting later items.
- Leading, internal, trailing and rest-only arrangements are preserved. Trailing silence contributes to Fit, playback duration, repetition and exports.

Click to select an occurrence; Ctrl/Cmd/Shift+click adds to the selection. Drag the handle to move a contiguous selection. Ctrl/Cmd+C/V copies and pastes; keys 1–8 place a pad at the current position. Right-click selects a placement position and exposes the lane actions.

## Playback and audition

Each lane has **Playback source: Arrangement | Manual pads**. The same setting appears in the sequencer. Empty lanes use Manual pads. Adding the first occurrence enables Arrangement; closing all time returns to Manual pads. Ordinary deletion leaves rests and retains Arrangement.

For Arrangement lanes, **At end: Stop track | Repeat track sequence** controls the whole authored sequence. New devices stop at the end; imported repeat settings remain intact. **Loop selected range** is the separate shared transport loop. Click its ruler to seek and clear the loop, or drag a range to loop it. Rewind/Fast forward move one master beat. Fit shows the whole longest lane, including trailing rests.

**Play** ends all auditions, starts Arrangement lanes and stops Manual pads sequencers. It starts the instrument engine when needed. **Stop** clears and stops auditions and Arrangement lanes while preserving independently started manual sequencers. It leaves the rack engine running. Double-click Stop resets to the loop start or song start when no manual track keeps transport active.

Use **Audition** on a selected pad, group or supergroup to hear it temporarily. During playback it takes over only that track at the next pad/rest boundary, from its first token, and repeats until stopped. Other tracks continue. Editing, Playing, Queued and Auditioning are separate states; selecting a pad never launches it.

**Return to arrangement** waits for the next boundary, then restores the authored sequence at the current song position. It can return into a rest or an already-ended finite track. **Stop audition** stops this track and clears its override without restarting its arrangement. Cancel launch discards a pending change.

With transport stopped, Audition starts only the selected track. Seeks and loop wraps restart active auditions at their first token on the shared clock. Queued audition replacements or returns take effect at the seek or loop destination. During song playback, the song's range and end remain authoritative. Arranger arpeggiators support definition audition; independent Live arpeggiators retain their own existing launch controls.

## Saved format

Performances still store root sequences, pads, groups, supergroups and supported pause tokens. Version 16 and imports of versions 1–16 remain supported; the app-state and native bundle envelope versions are unchanged. Old enabled arrangements that resolve to no tokens are imported as an explicit occurrence of their former active pad, preserving their repeat setting and sound.

Audition commands, selection, position, sounding pads and temporary enablement are session state. Save, autosave, native bundles and both CSD exports use authored data. Musical edits made while auditioning save normally.
