# Intent and scope

[Index](README.md) · [UI design](ui-design.md) · [Contracts](data-and-playback-contracts.md)

## Purpose

The performance view should answer three questions in one place: what plays, when it plays, and which reusable musical material it uses. Today those decisions are split between arranger lanes, eight-pad banks, pattern workspaces and playback-source controls. The redesign makes the timeline the entry point and keeps the actual musical editing tools familiar.

The performance remains a rack of instruments and routes, controlled by several types of musical and automation sources. A timeline lane is a source with its own timing and routing, not necessarily one instrument: multiple lanes may drive the same instrument, and an arpeggiator receives notes from another source or live input.

## Chosen design

| Decision | Intended result |
| --- | --- |
| Arranger is the master UI | Add/select/resize clips, choose their sequencer type and edit their content from the timeline. |
| Clip window and content length are independent | A long clip may repeat a short pattern; a short clip crops a long source without deleting it. Resizing never implicitly stretches notes. |
| Reusable nested content | A clip can contain patterns, groups, supergroups and rests. Expanded lanes show their containment as nested boxes. |
| Edit at every level | Edit a pattern with its existing musical editor; edit a group/supergroup by changing its ordered children inside the clip context. |
| Explicit save scope | Every pattern/group/supergroup save offers only the edited occurrence or all linked occurrences. Local saves create a variation without changing other uses. |
| Compact unselected tracks | A narrow preview remains visible. Selecting a track expands its hierarchy; the rest stay compact. |
| Note map is the default | Melodic and score previews show time and pitch; drums show velocity-colored dots; arps show parameters; controllers show curves or step bars. |
| Direct controller-curve editing | Manipulate real curve keypoints inside an expanded clip, sharing the same draft as the existing editor. |
| Edit and jam from a clip | Play edit auditions the selected content, starts required instruments and can run with the song. No separate live sequencer workspace is needed. |
| Small live playground below | One fixed piano keyboard plus a configurable number of manual MIDI controllers, full width for the piano keyboard, using current controls and Start/Stop. |
| Preserve current musical tools | The mockup does not replace the sequencer grids, score editor, arpeggiator controls, keyboard or manual controller UI. |

## Representative workflows

### Compose a phrase

1. Add a lane or choose an existing lane and draw a clip over a time range.
2. For a new lane, select a source type and configure its existing instrument/channel routing. Existing lanes keep their type and routing.
3. Double-click the clip, choose New pattern or adopt an existing compatible pattern, and edit with the current type-specific UI.
4. Set the pattern's native length separately from the clip window. Choose Once or Loop, or explicitly Fit clip to content.
5. Use Play edit to listen. Save only this occurrence or update all linked uses.

### Build and vary a section

1. Expand a lane and select adjacent patterns/rests within one clip container.
2. Group them; combine groups/patterns/rests into a supergroup.
3. Reuse the section in another clip without copying every musical payload.
4. Select a nested pattern, change a musical property and choose Only this occurrence.
5. The selected path becomes a variation. Other occurrences keep their previous sound. Undo restores the entire operation in one step.

### Jam while a song plays

1. Create or select a clip and open its actual sequencer/arpeggiator editor.
2. Press Play edit. The proposed transport contract temporarily replaces that lane's arranged output while the other lanes continue.
3. Change the draft and hear prepared updates without resetting the song clock.
4. Stop edit to return that lane to the current song position. Save scope determines reuse, independently of audition.
5. Use the fixed keyboard or an added manual controller for human input. Their Start/Stop controls and current buffer settings remain available.

An arpeggiator still requires input/held notes. The app must not manufacture a test chord because the reference mockup can animate without audio.

## Boundary of this redesign

In scope: performance-view composition, clip editing, nested definitions, scope-aware drafts, contextual auditions, compact previews, the narrow live playground, compatibility and export support needed by those changes.

Out of scope:

- Rewriting the musical editors or adding musical features absent from them, such as melodic ratchets merely because a prototype glyph suggests them.
- A separate live clip-launch grid, recording system, audio clips, waveform editing, time stretching, arbitrary-depth groups or cross-device groups.
- Redesigning instrument graphs, rack routing, mixer, Master, effects, per-instance instrument controls, MIDI host integration or the audio clock.
- Predicting an arpeggiator's notes from its parameters before its input chord exists.
- Publishing the mockup or turning it into application code.

Existing arranging capabilities also need preservation: multi-lane range operations, explicit insert/close time, loop selection, seek, mute/solo, retained unused definitions, hidden musical data, undo/redo, import/export and failure handling. A smaller prototype surface is not authorization to drop them.

## Proposed contracts requiring an early engineering decision

The plan supplies defaults in [Data and playback contracts](data-and-playback-contracts.md). Task 1 records agreement or a reasoned amendment before implementation:

- Exact audition lifecycle through Song Play/Stop, seek, finite song end, selection changes and navigation; launch quantization per source type.
- Clip offset semantics, same-lane overlap policy, leaf continuation across loops and deterministic identity for a selected repeat pass.
- New schema/API version, stable definition identities beyond eight legacy pad slots, and resource limits.
- Lossless handling of independently running Manual pads, Live arpeggiators and multiple legacy keyboards.

These are implementation choices around the chosen interaction, not invitations to replace its visual design or the existing musical editors. Unsupported legacy cases must retain a working compatibility route until their conversion is defined and tested.
