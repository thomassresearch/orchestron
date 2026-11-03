# Clip arranger preview

The clip arranger is a development preview. It introduces fixed clip windows and reusable patterns, groups and supergroups while keeping the existing musical editors. The compatibility arranger remains available; the preview is not yet the default rollout.

For a development build, start the frontend with `VITE_CLIP_ARRANGER=1 npm --prefix frontend run dev`. **New** creates an empty clip arrangement and one fixed piano keyboard. **Add track** chooses Melodic, Score, Drummer, Controller or Arpeggiator and creates its first pattern. Assign the instrument through the existing rack and MIDI-channel controls.

For an existing compatible performance, **Multitrack arranger · Preview** downloads its original configuration before converting. Keep that file: import it to recover the original workflow. Existing Manual pads, Live arpeggiators and multiple-keyboard performances remain in the compatibility view; conversion reports the reason instead of changing their playback behavior. A new-format performance requires a version-23-capable reader. Disabling the preview flag does not downgrade saved data.

## Arrange fixed windows

Unselected tracks stay compact. Click a track header to expand its clips into nested pattern, group and supergroup boxes. Drag a clip header to move it, or its borders to trim it; the inspector also accepts numeric start, length and source offset in master beats. Double-click empty lane space to add content at that position, or use its **+** button to append. The add dialog also accepts an exact start. Moves and deletion leave other clips in place. Overlap on the same lane is rejected.

The clip window and content duration are independent. **Once** plays the content from its source offset and leaves silence after its end. **Loop** repeats content within the window. Trimming preserves the original notes and content; **Fit clip to content** explicitly changes the window. A local edit of one generated repeat splits its original window into before, edited and after parts.

![Expanded clip hierarchy and contextual supergroup editor](../../screenshots/clip-arranger-nested.png)

Open **Content** for the selected clip to adopt existing definitions, create a new pattern, add a rest, reorder children, or select adjacent children for Group/Supergroup. Grouping retains reusable definitions. Ungroup opens one level. Removing an occurrence retains its definition. Groups and supergroups have their own contextual child editor.

**Sections** copies a range of all tracks or the selected track. Paste and overwrite, paste and insert, insert time and close time show a preview before applying one undoable transaction. A repeating legacy lane must first be converted to song clips; this materializes its repeats across the current song duration. Ordinary clip edits do not silently change that independent cycle. Track-order arrows change the visible lane order. Removing a track removes its source and drafts; source creation/removal clears clip history because source topology is outside clip-only undo.

## Edit the current musical controls

Double-click a nested box, or focus its name and press Enter, to open the existing sequencer or arpeggiator in context. Its separate pattern workspace and old pad-source controls are replaced by the clip breadcrumb, draft status, Play edit and Save. Musical controls remain the production controls: notes/chords/holds/strums, sparse score notes, drum velocities/ratchets, both controller datasets, and arpeggiator parameters/presets. Lane-wide timing, routing and instrument settings affect the whole track.

Melodic and Score clips use compact Note maps. Drums use step dots with a fixed velocity gradient. Arpeggiators show parameters, because their pitches depend on incoming chords. Controller Step Mode uses bars; Curve Mode uses the real interpolation. Selecting a curve pattern also opens the production curve editor inside its expanded lane, sharing the same draft as the full editor. Drag, click and double-click retain their usual behavior; the point list offers numeric position and value editing, including independent endpoint values.

**Save** always asks whether to update **Only this occurrence** or **All linked occurrences**. Local is the default. A local variation gets a new definition; shared ancestors are copied only where necessary. Clip boundaries remain fixed after a content-duration change. Cancel retains the draft. Conflicting revisions or invalid content leave the saved arrangement untouched.

![Save-scope dialog](../../screenshots/clip-arranger-save-scope.png)

Performance save and native/CSD export use saved definitions. If drafts changed, return to resolve their individual scopes or explicitly use the saved definitions. Autosave does not commit drafts. New/Load/Import prompts before discarding changed drafts. Drafts survive ordinary view switches; they are not reload recovery data.

## Play and jam

**Play song** and **Play edit** start instruments when needed. With the song stopped, Play edit auditions its target. With the song playing, the editor audition temporarily replaces its source lane while other lanes continue. Song start/stop/seek preserves the editor audition; Stop edit returns to the arrangement's current position or silence when the song is stopped. Audition state appears in the compact lane header. Closing the editor or leaving Perform ends the audition and retains its draft.

The actual piano keyboard and configurable MIDI controller rows sit below the arranger/editor, each full width. They retain Start/Stop, routing, channel/OMNI, scale/autochord, velocity and CC controls. Their existing Auto/Live/Listening buffer policy still applies. An enabled device does not force low-latency buffering indefinitely. Arpeggiator Arranger/Live clock settings remain separate from clip placement.

## Preview limits and release verification

The rollout gate remains off by default until the implementation acceptance matrix is complete. Do not treat the development preview as a promise of lossless downgrade to an older app. Keep the downloaded original and existing saved performances when evaluating migration. Long/dense visual workloads and the full hardware-input/transport stress matrix require final release review. Group audition currently uses the bounded legacy audition sequence: rests must fit whole local beats, and at most 256 tokens can be auditioned. Arrangement playback itself supports exact tick rests. Legacy CLI pad-edit commands reject clip performances; CLI round trips, runtime compilation and exports support the new format. See the implementation record under `specifications/redesign-arranger/` for the current evidence and remaining gates.
