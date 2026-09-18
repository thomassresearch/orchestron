# Pattern Pads and Reusable Phrases

**Navigation:** [Up](performance.md) | [Prev](drummer_sequencers.md) | [Next](multitrack_arranger.md)

Each sequencer has eight pattern slots, #1–#8. Click a pad to select it for editing. Playback and queued launches never change this editing selection. The Playing and Queued indicators show what is sounding separately.

Pads are labelled **1–8** in arranger lanes and palettes, and **#1–#8** in sequencers and phrase editors. Pads are green, groups are red, and supergroups are violet throughout the sequencers, phrase libraries, palettes and arranger lanes. Rests keep their dark styling; the number in **Rest 1/2/4/8/16** is its duration in local beats, while a pad number identifies a reusable slot. Selection outlines and Playing/Queued indicators remain separate from these type colours.

## Pad contents

Melodic pads store notes, chords, holds, timing offsets and theory settings. Drummer pads store hits and velocities for each row. Controller pads store automation curves. Arpeggiator pads store complete musical variations and rhythm steps.

Pad lengths are 1–8 local beats for melodic and drummer devices, and 1–8 or 16 beats for controller and arpeggiator devices. Arpeggiator durations use master beats. Meter, grid and beat ratio belong to the owning sequencer; tempo is shared.

Drag one pad onto another to copy it explicitly. Melodic pad edge buttons transpose by a scale degree on a short press, or change the diatonic key on a long press. Drummer and controller pads do not use these transpose controls.

## Reusable groups and supergroups

Click the triangle beside **Patterns and phrases** to expand or collapse the library. It starts collapsed, retains the selected definition when closed, and remembers its disclosure state in the sequencer. The library has explicit New group and New supergroup actions. Groups use letter IDs and contain pads/rests. Supergroups use Roman numeral IDs and contain pads/rests/groups. Song order is edited only in the [arranger](multitrack_arranger.md), where phrases are edited by ungrouping, rearranging, and regrouping. Open in arranger focuses the selected definition in its lane palette.

Choose a definition to edit its contents. Add items, select them, drag to reorder, or delete to close up the phrase. Deleting inside a definition changes the phrase itself; it does not leave an absolute-time gap. Definition edits affect every occurrence. Duration changes shift following song material, as stated in the editor.

Unused definitions remain in the library through save/load and import/export. Empty definitions are valid drafts but cannot be placed or auditioned. A referenced definition cannot be emptied: remove its occurrences and references first. **Delete definition** is disabled while the arrangement or another definition uses it; the library lists those uses. Removing or ungrouping a song occurrence leaves the definition intact.

A pattern container and its expanded sequence may contain at most 256 tokens. Over-limit edits fail as a whole rather than dropping musical content. Pause lengths remain 1, 2, 4, 8 and 16 beats; longer visible rests combine these existing tokens.

## Playback source and audition

**Playback source: Arrangement** follows the song timeline. Its Stop/Repeat-at-end option lives in the arranger lane. **Manual pads** enables a separate Launch pad action for jamming. Selection alone never starts sound.

In the sequencer’s Arrangement mode, use **Audition** for a pad or phrase. It temporarily replaces only that track at the next boundary and repeats independently of its saved repeat setting. With transport stopped it starts only this track, using the normal instrument startup flow. **Return to arrangement** restores the authored song at the current position on the next boundary; **Stop audition** stops the track. See the [arranger transport contract](multitrack_arranger.md#playback-and-audition).

Arpeggiators in independent Live mode keep their existing cycle/bar launch quantization. Their Arranger mode uses the shared definition library and temporary audition.

The arranger provides separate momentary speaker previews: hold for 250 ms, release to restore previous playback immediately at the current song position. Its context menus also set saved, per-definition colours. These changes leave sequencer controls and default colours unchanged.
