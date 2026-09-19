# Pattern Pads and Reusable Phrases

**Navigation:** [Up](performance.md) | [Prev](drummer_sequencers.md) | [Next](multitrack_arranger.md)

Each sequencer has eight pattern slots, #1–#8. Click a pad to select it for editing; on a running Manual pads device, this also queues it for playback. Playback and queued launches never change this editing selection. The Playing and Queued indicators show what is sounding separately.

Pads are labelled **1–8** in arranger lanes and palettes, and **#1–#8** in sequencers and phrase editors. In melodic and drummer sequencers, pads are green only when their playable steps contain at least one note or active hit with velocity above zero; empty, hold-only and zero-velocity pads stay dark. Selection and queued outlines still appear on empty pads. Groups are red and supergroups violet. Controller pads with only two zero-valued endpoints stay dark; extra points or nonzero values mark content. Zero remains valid CC output. Arpeggiator pads turn green for a note-producing step with positive velocity and probability; rest-only, tie-only and suppressed pads stay dark, regardless of held notes. Rests keep their dark styling; the number in **Rest 1/2/4/8/16** is its duration in local beats, while a pad number identifies a reusable slot. Selection outlines and Playing/Queued indicators remain separate from these type colours.

## Pad contents

Melodic pads store notes, chords, holds, timing offsets and theory settings. Drummer pads store hits and velocities for each row. Controller pads store automation curves. Arpeggiator pads store complete musical variations and rhythm steps.

Pad lengths are 1–8 local beats for melodic and drummer devices, and 1–8 or 16 beats for controller and arpeggiator devices. Arpeggiator durations use master beats. Meter, grid and beat ratio belong to the owning sequencer; tempo is shared.

Drag one pad onto another to copy it explicitly. Melodic pad edge buttons transpose by a scale degree on a short press, or change the diatonic key on a long press. Drummer and controller pads do not use these transpose controls.

## Pattern workspace

Melodic, drummer and controller sequencers and arpeggiators show an always-visible **Pattern workspace** in the upper-right header area. On narrow screens it stacks below the musical controls. The eight pads and step grid remain below the header.

Drag pads or saved groups/supergroups into **Free workspace** to assemble a phrase. A drop inserts at the visible marker; dragging an existing item or selection moves it. Dragging one of the eight pads onto another still copies that pad. Workspace references stay within their owning sequencer.

Click an item to select it. Cmd/Ctrl-click toggles extra items; Shift-click selects a range. **Group** gathers at least two selected pads/rests in left-to-right order, including separated selections, and places the new group at the first selected position. **Supergroup** also accepts groups. Unselected items retain their relative order. These actions create reusable definitions immediately; groups use letter IDs and supergroups Roman numeral IDs. Groups cannot contain groups; supergroups cannot contain supergroups.

Right-click an item, or use Shift+F10, for **Edit**, **Group**, **Supergroup**, **Ungroup**, and **Remove**. Ungroup expands one level locally and keeps the saved definition. Delete/Backspace removes selected workspace items and closes the gap. Use **Add rest…** for rests of 1, 2, 4, 8 or 16 local beats. Long assemblies scroll horizontally; the saved phrase palette has a bounded height.

Choose a saved phrase or double-click a workspace group/supergroup to edit its draft. **Apply** updates every saved use; **Save as new** creates an independent definition. **Discard changes** restores its saved contents. The editor lists arrangement/phrase uses and warns that changing duration shifts later song material. Workspace construction never edits song order; place saved phrases in the [arranger](multitrack_arranger.md). **Open in arranger** focuses the selected definition there.

Each definition has a separate draft, and the free workspace is retained when switching between definitions. Drafts, selection and scroll survive panel collapse and view switches. New/Load/Import and browser reload clear temporary drafts. Loose workspace items and unapplied edits are excluded from save, autosave and export; Group/Supergroup creation and Apply save through the existing performance workflow.

**Delete definition** is available in saved phrase and arranger palettes. Saved arrangement or phrase references block deletion. Temporary references expand into the saved contents, preserving order and selection even in closed workspaces; the definition’s own draft is removed. Empty definitions can remain drafts but cannot be placed or auditioned. Referenced definitions cannot be applied empty. Containers and expanded sequences are limited to 256 tokens; invalid edits leave drafts unchanged.

All four device types use this workspace, including Live arpeggiators. Live mode hides arrangement source and navigation controls while retaining phrase creation and editing.

## Playback source and audition

**Playback source: Arrangement** follows the song timeline. Device Play works while the arranger is stopped: the first device starts at the selected loop's beginning, or at the stopped song cursor without a loop; a cursor at song end restarts from the beginning. Other Arrangement devices join that position. Its Stop/Repeat-at-end option lives in the arranger lane.

With **Manual pads**, device Play repeats the pad selected for editing from its beginning. Click another pad to select it for editing and queue it for the end of the current pattern. The queued pad has an orange outline; the playing pad stays blue-green until the switch, when the new pad turns blue-green. Clicking the playing pad cancels the queue; clicking another pad replaces the queued choice. Launch pad also queues the selected pad. While stopped or using Arrangement, pad clicks only select for editing. Manual pads continue through arrangement seeks, loops and endings. Arranger Play adds all arrangement backing parts while preserving playing manual pads; Arranger Stop removes the backing parts and temporary playback, preserving independent manual pads. Device Stop affects only that device. Groups and supergroups play through speakers or workspace Play, never implicitly through device Play.

The play button beside the workspace loops the **entire displayed assembly**, regardless of selection. An amber outline follows the currently playing pad, group, supergroup or rest, independently of the cyan editing selection. It follows audible playback, including repeated pads and loop wrap; a momentary speaker preview hides the workspace outline until release. Click it again to restore the track's previous arrangement, manual pad or stopped state. It works before saving a phrase. Workspace edits enter at the next cycle boundary after the normal 80 ms coalescing delay. Failed preparation retains the previous sound and the edited draft; another edit or explicit restart retries.

Every pad, group and supergroup has a separate speaker button. Hold for **250 ms** to begin a momentary preview; shorter clicks do nothing. Preview repeats until release. With the arranger running it enters at the next lane cycle boundary; with the arranger stopped it starts at an audio block without moving the song cursor. Space/Enter supports the same hold/release gesture. The speaker never selects, transposes or drags its item.

A speaker preview temporarily overrides workspace playback, then returns to that workspace at the current clock position. Stopping the workspace restores the original track state. Releasing before preparation or a queued boundary cancels the preview. Pointer cancellation, focus loss and leaving the view end speaker previews; collapse/navigation also end workspace playback. Arranger Play/Stop cancels both layers, and late replies/releases cannot restart them. Other tracks continue and lane Mute/Solo stays effective.

Live arpeggiator workspace Play and held speakers start at the configured next rhythm cycle or master bar when a Live clock is established; otherwise they start at an audio block. Pad duration determines phrase lengths. Incoming or held notes are required; no test chord is supplied. Hold and Active/Bypass/Mute remain effective. Chord changes during previews are retained, and release restores the underlying Live pulse. **Launch pad** explicitly launches the editing pad in Live/manual mode, separately from temporary previews. Saved definitions retain the same performance format.
