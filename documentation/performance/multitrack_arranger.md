# Multitrack Arranger

**Navigation:** [Up](performance.md) | [Prev](pattern_pads_and_pad_looper.md) | [Next](controller_sequencers.md)

The arranger is the only editor of song order. Each lane places references to its eight pads, reusable groups and supergroups, and rests. Sequencers edit pad contents; melodic and drummer devices assemble reusable phrases in their upper-right pattern workspace. In the arranger, edit phrases by ungrouping, rearranging, and regrouping timeline material. Editing a shared definition changes every occurrence; changing its duration shifts following material on that lane.

Pads are labelled **1–8** in arranger lanes and palettes, and **#1–#8** in sequencers and phrase editors. Pads are green, groups are red, and supergroups are violet throughout the sequencers, phrase libraries, palettes and arranger lanes. Rests keep their dark styling; the number in **Rest 1/2/4/8/16** is its duration in local beats, while a pad number identifies a reusable slot. Right-click a musical item or palette entry to Set colour or Reset colour. Custom colours apply to every occurrence of that definition within its lane and are saved with the performance. The picker offers swatches and a custom colour; text contrast adjusts automatically. Sequencer colours remain the defaults for now. Selection outlines and Playing/Queued indicators remain separate from these colours.

## Compact track headers

Each lane starts collapsed. Click the triangle or track title (Enter/Space when focused) to open or close its editing tools. Click anywhere in an occurrence box to select it and open the lane; the triangle can close it again while retaining the editing context. Clicking empty timeline space clears occurrence highlights and chooses the insertion position without changing panel expansion. Double-click a pad or choose Edit pattern to open its sequencer editor. Open in arranger opens the lane and focuses the definition in its palette.

The expanded lane shows **Position (master beats)** followed by the wrapping palette. There is no separate Patterns and phrases panel in the arranger; melodic and drummer sequencers provide their own pattern workspace. **Playback settings** contains Playback source and, for Arrangement lanes, At end, and starts collapsed. Disclosure choices survive view switches; New/Load/Import resets them. Closing panels preserves drafts, selections and scroll, cancels active gestures and momentary previews, and leaves normal playback running.

## Temporary lane Mute and Solo

The small **Mute** and **Solo** buttons control this sequencer lane, independently of the instrument mixer. Several lanes can drive the same instrument and still be controlled separately. A drummer's rows act together. Multiple Solo buttons may be active; explicitly muted lanes stay muted. A dashed amber Mute button indicates suppression by another lane's Solo.

Lanes keep advancing through pads, rests, loops and auditions while suppressed. Changes apply at the next available engine block; already buffered audio still plays. New attacks are suppressed, while sounding notes complete their scheduled releases and effects decay normally. Unmuting resumes future events at the current position without retriggering held notes. Controller lanes stop sending CC values while muted; the last applied value remains until an active source updates it.

Solo preserves the upstream inputs and downstream arpeggiator processing needed by the selected lane. Explicit mute overrides these dependencies. External MIDI and independent Live arpeggiators remain outside arranger solo selection. Instrument mixer mute/solo still applies independently.

Lane controls survive transport stop/start and engine restart within this performance. They reset on New/Load/Import and browser reload; deleted lanes lose their controls. Save, autosave, native bundles and both CSD exports exclude this temporary state.

## Place and move material

Expand a lane to show its palette of populated pattern pads, groups, supergroups and rests on the Position row. Melodic, drummer and arpeggiator pads appear only when they contain a non-rest step; their original numbers are preserved. Empty pads remain editable in the sequencer, and existing timeline occurrences remain intact. Controller curves remain available, including zero-valued curves. Drag a palette item to add an occurrence. Clicking an entry only focuses it. Empty phrase drafts cannot be placed or previewed. Add, Insert, Paste, Duplicate and number-key placement are removed from the arranger; sequencer editing shortcuts remain unchanged.

Drop at an element edge to insert and shift later material on this lane. Drop musical material inside a rest when it fits to replace that portion of silence. Drop after the final element to fill the gap with supported pause tokens and append. Dropping inside occupied musical material is rejected with a red preview. Rest palette items insert time at boundaries or extend the lane after its end.

The ruler numbers master bars and beats. Placement snaps to whole local beats using the lane's beat ratio; previews show the exact master-beat position and duration. Drag an occurrence body to move it, or move a contiguous selection together. Moves leave equivalent silence at the source; dropping at the original position changes nothing. Placement stays within the originating lane. Invalid or over-limit edits leave the whole arrangement unchanged.

Right-click to open lane actions. Right-clicking a selected occurrence preserves the selection; right-clicking another selects it. Cmd/Ctrl-click toggles additional selections. Grouping requires at least two adjacent selected elements. **Group** accepts pads/rests; **Supergroup** also accepts groups. **Ungroup** expands one level and retains the reusable definition in the palette.

After ungrouping, rearrange the material, then select and group it again. Choose **Create new definition** (the default) to leave other occurrences unchanged, or explicitly select **Update existing definition** to update all its references. The dialog lists uses and explains that duration changes shift following material. Groups retain letter IDs and supergroups Roman numeral IDs.

**Create variation** copies a pad into an unused slot, or copies a group/supergroup under a new ID, and retargets only the selected occurrence. It inherits the source colour. The eight-pad limit remains. Palette context menus allow deleting unused definitions; saved references list their uses and block deletion. Temporary workspace references expand into the saved contents, including retained drafts in closed panels; the deleted definition’s own draft is removed.

Use Enter/Space to select a focused occurrence, Cmd/Ctrl-click for multiple selection, and Shift+F10 or the Context Menu key for its menu. Arrow keys navigate occurrences or menu actions; Escape closes menus and cancels gestures. Menus return focus to their originating item.

## Delete and resize rests

- **Delete/Backspace** and **Remove, leave gap** replace selected musical occurrences with equal-duration silence. Other occurrences keep their positions.
- **Remove and close gap** (also Shift+Delete) removes selected musical occurrences or rest spans and closes their time on this lane. Multiple selections form one edit.
- Consecutive pause tokens appear as one rest span. Drag its right edge or choose Duration from its context menu to resize it in whole local beats, shifting later items.
- Leading, internal, trailing and rest-only arrangements are preserved. Trailing silence contributes to Fit, playback duration, repetition and exports.

## Playback and audition

Each lane has **Playback source: Arrangement | Manual pads**. The same setting appears in the sequencer. Empty lanes use Manual pads. Adding the first occurrence enables Arrangement; closing all time returns to Manual pads. Ordinary deletion leaves rests and retains Arrangement.

For Arrangement lanes, **At end: Stop track | Repeat track sequence** controls the whole authored sequence. New devices stop at the end; imported repeat settings remain intact. **Loop selected range** is the separate shared transport loop. Click its ruler to seek and clear the loop, or drag a range to loop it. Rewind/Fast forward move one master beat. Fit shows the whole longest lane, including trailing rests.

**Play** ends all auditions, starts Arrangement lanes and stops Manual pads sequencers. It starts the instrument engine when needed. **Stop** clears and stops auditions and Arrangement lanes while preserving independently started manual sequencers. It leaves the rack engine running. Double-click Stop resets to the loop start or song start when no manual track keeps transport active.

Every musical occurrence and available pad/group/supergroup has a small speaker icon near its right edge. Hold it for **250 ms** to begin a momentary preview from its first token. Shorter clicks do nothing. While the arranger is running, prepared previews start at the lane’s next pad/rest cycle boundary. While stopped, they start at the next available audio block without moving the arranger playhead; existing audio buffering still contributes latency. It repeats while held. Selecting content never launches it.

Release the speaker to end preview and restore the lane's previous playback at the current shared-clock position. An Arrangement lane can return into a rest or a finite track that has ended. Previously stopped lanes stay stopped. Independently playing manual pads and existing sequencer auditions are restored. Other lanes continue and lane Mute/Solo remains effective. Releases preserve other lanes sharing an instrument/channel.

Hold Space/Enter on a focused speaker for the same behaviour. Releasing outside it, cancelling the gesture, losing focus, collapsing, or leaving the view ends the preview. Preparation failures retain current playback; releasing before preparation finishes prevents a late launch. Transport Play/Stop cancels previews, and a late release cannot restart playback.

With the arranger stopped, preview starts only that lane through the normal instrument startup flow. The song cursor stays fixed and the Stop button stays highlighted. Play resumes the song from that cursor. During song playback, Play is highlighted instead. Seeks and loop wraps restart held previews at their first token on the shared clock. During song playback, song range/end remain authoritative. Arranger arpeggiators support previews; independent Live arpeggiators remain unchanged.

Melodic and drummer sequencers use a [pattern workspace](pattern_pads_and_pad_looper.md) with a Play/Stop toggle and the same momentary speakers. A speaker held over workspace playback restores the workspace on release; stopping the workspace restores the prior lane state. Controller sequencers and arpeggiators retain their existing Audition/Return/Stop controls.

## Saved format

Performances still store root sequences, pads, groups, supergroups and supported pause tokens. Version 16 and imports of versions 1–16 remain supported; the app-state and native bundle envelope versions are unchanged. Old enabled arrangements that resolve to no tokens are imported as an explicit occurrence of their former active pad, preserving their repeat setting and sound.

Optional `definitionColors` metadata maps typed definition references (`pad:0`, `group:A`, `super:I`) to hexadecimal colours. It does not change sequence compilation or trigger audio preparation. Missing/invalid colours use type defaults. Save/load, autosave, native bundles and CLI handling retain valid colours. CSD audio ignores them.

Audition/preview commands and restoration state, selection, position, sounding pads and temporary enablement are session state. Save, autosave, native bundles and both CSD exports use authored data. Musical edits made while auditioning save normally.
