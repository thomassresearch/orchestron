# Pattern Pads and Reusable Phrases

**Navigation:** [Up](performance.md) | [Prev](drummer_sequencers.md) | [Next](multitrack_arranger.md)

Each sequencer has eight pattern slots, #1–#8. Click a pad to select it for editing. Playback and queued launches never change this editing selection. The Playing and Queued indicators show what is sounding separately.

Pads are labelled **1–8** in arranger lanes and palettes, and **#1–#8** in sequencers and phrase editors. In melodic and drummer sequencers, pads are green only when their playable steps contain at least one note or active hit with velocity above zero; empty, hold-only and zero-velocity pads stay dark. Selection and queued outlines still appear on empty pads. Groups are red and supergroups violet. Arranger palettes and controller/arpeggiator workflows retain their existing availability and colour rules. Rests keep their dark styling; the number in **Rest 1/2/4/8/16** is its duration in local beats, while a pad number identifies a reusable slot. Selection outlines and Playing/Queued indicators remain separate from these type colours.

## Pad contents

Melodic pads store notes, chords, holds, timing offsets and theory settings. Drummer pads store hits and velocities for each row. Controller pads store automation curves. Arpeggiator pads store complete musical variations and rhythm steps.

Pad lengths are 1–8 local beats for melodic and drummer devices, and 1–8 or 16 beats for controller and arpeggiator devices. Arpeggiator durations use master beats. Meter, grid and beat ratio belong to the owning sequencer; tempo is shared.

Drag one pad onto another to copy it explicitly. Melodic pad edge buttons transpose by a scale degree on a short press, or change the diatonic key on a long press. Drummer and controller pads do not use these transpose controls.

## Pattern workspace

Melodic and drummer sequencers show an always-visible **Pattern workspace** in the upper-right header area. On narrow screens it stacks below the musical controls. The eight pads and step grid remain below the header.

Drag pads or saved groups/supergroups into **Free workspace** to assemble a phrase. A drop inserts at the visible marker; dragging an existing item or selection moves it. Dragging one of the eight pads onto another still copies that pad. Workspace references stay within their owning sequencer.

Click an item to select it. Cmd/Ctrl-click toggles extra items; Shift-click selects a range. **Group** gathers at least two selected pads/rests in left-to-right order, including separated selections, and places the new group at the first selected position. **Supergroup** also accepts groups. Unselected items retain their relative order. These actions create reusable definitions immediately; groups use letter IDs and supergroups Roman numeral IDs. Groups cannot contain groups; supergroups cannot contain supergroups.

Right-click an item, or use Shift+F10, for **Edit**, **Group**, **Supergroup**, **Ungroup**, and **Remove**. Ungroup expands one level locally and keeps the saved definition. Delete/Backspace removes selected workspace items and closes the gap. Use **Add rest…** for rests of 1, 2, 4, 8 or 16 local beats. Long assemblies scroll horizontally; the saved phrase palette has a bounded height.

Choose a saved phrase or double-click a workspace group/supergroup to edit its draft. **Apply** updates every saved use; **Save as new** creates an independent definition. **Discard changes** restores its saved contents. The editor lists arrangement/phrase uses and warns that changing duration shifts later song material. Workspace construction never edits song order; place saved phrases in the [arranger](multitrack_arranger.md). **Open in arranger** focuses the selected definition there.

Each definition has a separate draft, and the free workspace is retained when switching between definitions. Drafts, selection and scroll survive panel collapse and view switches. New/Load/Import and browser reload clear temporary drafts. Loose workspace items and unapplied edits are excluded from save, autosave and export; Group/Supergroup creation and Apply save through the existing performance workflow.

**Delete definition** is available in saved phrase and arranger palettes. Saved arrangement or phrase references block deletion. Temporary references expand into the saved contents, preserving order and selection even in closed workspaces; the definition’s own draft is removed. Empty definitions can remain drafts but cannot be placed or auditioned. Referenced definitions cannot be applied empty. Containers and expanded sequences are limited to 256 tokens; invalid edits leave drafts unchanged.

Controllers and arpeggiators keep their collapsible phrase editor and immediate definition edits.

## Playback source and audition

**Playback source: Arrangement** follows the song timeline. Its Stop/Repeat-at-end option lives in the arranger lane. **Manual pads** enables a separate Launch pad action for jamming. Selection alone never starts sound.

The play button beside the workspace loops the **entire displayed assembly**, regardless of selection. An amber outline follows the currently playing pad, group, supergroup or rest, independently of the cyan editing selection. It follows audible playback, including repeated pads and loop wrap; a momentary speaker preview hides the workspace outline until release. Click it again to restore the track's previous arrangement, manual pad or stopped state. It works before saving a phrase. Workspace edits enter at the next cycle boundary after the normal 80 ms coalescing delay. Failed preparation retains the previous sound and the edited draft; another edit or explicit restart retries.

Every pad, group and supergroup has a separate speaker button. Hold for **250 ms** to begin a momentary preview; shorter clicks do nothing. Preview repeats until release. With the arranger running it enters at the next lane cycle boundary; with the arranger stopped it starts at an audio block without moving the song cursor. Space/Enter supports the same hold/release gesture. The speaker never selects, transposes or drags its item.

A speaker preview temporarily overrides workspace playback, then returns to that workspace at the current clock position. Stopping the workspace restores the original track state. Releasing before preparation or a queued boundary cancels the preview. Pointer cancellation, focus loss and leaving the view end speaker previews; collapse/navigation also end workspace playback. Arranger Play/Stop cancels both layers, and late replies/releases cannot restart them. Other tracks continue and lane Mute/Solo stays effective.

Controller sequencers and arranger-mode arpeggiators retain **Audition**, **Return to arrangement**, **Stop audition** and **Cancel launch**. Independent Live arpeggiators retain their cycle/bar launch quantization. The arranger's speaker previews and saved per-definition colours remain available.
