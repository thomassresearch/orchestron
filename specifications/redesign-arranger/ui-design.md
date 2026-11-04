# UI design

[Index](README.md) · [Chosen mockup](reference/orchestron-preview.html) · [Data and playback contracts](data-and-playback-contracts.md)

## Performance view layout

Use the existing Orchestron typography, dark slate panels, borders, spacing, green Start and orange Stop controls, cyan selection and existing focus treatment. The chosen mockup establishes the composition; reuse actual application components and design tokens rather than importing its CSS.

The vertical order is:

1. Existing performance actions, instrument rack and mixer, with their current collapse and routing behavior.
2. Multitrack arranger as the primary full-width working surface, with song transport, tempo, loop/range controls, undo/redo and Add clip.
3. Contextual content editor for the selected clip or nested item, directly attached to the arranging workflow. Keep timeline context visible while editing.
4. Live playground below the arranger/editor: one fixed piano keyboard, then manual MIDI controller rows, each using the available full width.

Do not put live devices in a side column or a grid of narrow cards. Existing rack topology locks while instruments run still apply; the redesign does not make changing an instrument graph a live operation.

## Compact and expanded lanes

All unselected lanes use a compact timeline of approximately 48 CSS pixels, subject to accessible target sizes and text scaling. Show lane name/type, target/routing summary, mute/solo state and a meaningful content preview. Keep detailed device controls out of this strip.

Click a lane or clip to select and expand that lane; keep the others compact. A selected lane may be collapsed explicitly without losing its selection. Clicking a nested box selects that specific occurrence. Double-click, Enter or an explicit Edit action opens its editor. Selection does not launch audio or silently change the editing target when playback advances.

Expanded lanes show clip boundaries, content-cycle boundaries, nested boxes and the selected path. Use duration-proportional widths and horizontal zoom/scroll. The minimum label width is a presentation affordance; it must not distort event timing. When too small, hide a label or provide a tooltip/breadcrumb rather than expanding the musical duration.

Only visible lanes and the selected editor animate. Retain drafts, zoom, scroll, clipboard and selection across collapse/view switches using the current editor-state infrastructure. End active pointer gestures and release held input notes on collapse; do not stop the song. Audition lifecycle is separately specified in the transport contract.

## Clips and content length

The outer clip border is the playback window. The inner boxes are source content. Show both values in the selected-clip inspector with explicit units, for example **Clip: 16 master beats · Content: 8 master beats · Loop: 2 passes**. Where native timing differs, also show **Pattern: 4 local beats, 7/8, speed 3:2**; never display an unqualified beat count that could mean either domain.

| Interaction | Result |
| --- | --- |
| Draw on an empty lane or Add clip | Create a window; offer New pattern or an existing compatible definition. New-lane flow also chooses source type/routing. |
| Drag clip body | Move its window; keep source offset, length and downstream clips unchanged. |
| Drag right border | Change window length only. |
| Trim left border | Change start/window and source offset together, preserving the musical alignment of what remains. |
| Change native pattern length | Change source duration; leave every clip start and end fixed. |
| Once | Play source from its offset once; hatch/label any trailing silent region. |
| Loop | Repeat the source inside the window; show cycle divisions and a partial last pass. |
| Fit clip to content | Explicitly size the selected window to the remaining source duration; refuse a collision rather than moving later clips silently. |

Cropping shows a cut-edge indicator, not deleted source content. Auto repeats use a subdued border or repeat label; do not encode a repeat solely by reducing note brightness, because brightness also communicates velocity. Show an empty clip's editable placeholder without implying it contains a note.

For an eight-master-beat source starting at offset zero:

| Clip window | Mode | Visible/playing result |
| --- | --- | --- |
| 4 master beats | Once | First four beats; the remaining source is retained outside the window. |
| 16 master beats | Once | Eight beats of content followed by eight beats of silence. |
| 16 master beats | Loop | Two full passes. |
| 10 master beats | Loop | One full pass and the first two beats of the next pass. |

Proposed first-release overlap policy: prevent overlapping clips on one source lane. Allow separate lanes targeting the same instrument. Moving/deleting leaves time in place; inserting or closing time is an explicitly named operation. Preserve existing multi-lane section copy/overwrite/insert tools with previews and atomic undo.

## Nested boxes and editing context

Use labeled containment, following the mockup's green patterns, rose groups and violet supergroups, with accessible border/label alternatives to color. A clip may contain several patterns/groups/supergroups and explicit rests. A group contains patterns/rests; a supergroup contains groups/patterns/rests. Keep the existing bounded hierarchy; no recursive supergroups or cross-device contents in this release.

Example breadcrumb: **Bass / Verse clip / Supergroup I / Group A / Pulse variation**. Show linked-use information and whether the editor contains unsaved changes. Automatic repeats remain identifiable as a particular pass of the same source.

Pattern selection opens the current musical editor. Group/supergroup selection opens contextual child assembly: reorder, add/adopt, group, supergroup, ungroup, remove and inspect children. These operations occur within the selected clip and share its draft; there is no separate loose pattern workspace. Removing an occurrence does not delete its reusable definition. Deleting a definition with references requires a deliberate replacement/removal workflow.

Keep a compatible definition picker/library, including unused definitions. **Adopt linked** reuses a definition; **Create variation** starts an independent copy. This replaces fixed eight-pad navigation as the main selection mechanism, without changing what a pattern can contain.

## Compact previews

**Note map is the chosen default, not an additional mandatory mode switch.** The previous comparison study's Step cells/Phrase contour options are not required. Previews summarize the stored musical data; the actual editor remains the editing authority.

| Source | Compact representation | Expanded detail and limits |
| --- | --- | --- |
| Melodic | Horizontal time/duration and vertical pitch using small note marks; stacked marks for actual chord tones; velocity by luminance | Scale root/type/mode badge, holds as sustained marks, timing displacement from a faint grid anchor, strummed chord onsets staggered according to stored direction/spread. Do not add melodic ratchet semantics. |
| Score | Same Note map, using sparse notes and their real durations | Polyphonic overlaps, velocity and visible pitch range. Use a stable pitch range within the lane so neighboring previews remain comparable. Preserve all sparse notes and hidden data in the editor. |
| Drummer | Instrument rows with dots at real hit times; a consistent low-to-high velocity color gradient | Ratchet clusters and their velocity ramp where supported; timing offsets displace the hit cluster. Inactive cells are not bright hits. Labels/tooltips identify the drum row. |
| Arpeggiator | Compact parameter text such as **Up · 2 oct · 1/16 · gate 60% · 5 steps** | Include selected pattern/order, octave span, rate and relevant settings, with overflow summary/tooltip. No inferred pitches, note map or predicted melodic contour. Native runtime pitch feedback may remain in the actual arpeggiator editor. |
| Controller, curve | Curve using the production interpolation and independent endpoint values | Selected occurrence exposes draggable real keypoints, exact values and source position. |
| Controller, step | Bars at populated time steps, height from CC value | Distinguish empty/no-message cells from a real zero; preserve repeated identical values and Reset Value behavior. |

Velocity colors must use a fixed scale within a type, not renormalize per clip. Provide numeric values in the selected editor/tooltip and text alternatives for screen readers. Limit annotation density: timing/strum badges appear only when nondefault; exact values live in the current editor. Never infer unsupported musical features merely to fill a preview.

A melodic note map can resolve stored scale/chord settings. An arpeggiator cannot resolve future chord input, which is why it uses parameters. Preview rendering must share musical resolution helpers where practical and remain independent of audio scheduling.

## Reuse the current musical editors

The following is a preservation checklist, not a replacement UI design. Source links identify where current bodies/controls can be hosted with a new selected-definition adapter.

| Editor/device | Preserve | Changes around it |
| --- | --- | --- |
| Melodic | Existing step grid, pitch/chord/hold/rest controls, velocity, timing offset, scale root/type/mode, strum, meter/subdivision/speed, copy/clear and hidden-step retention | Bind to one selected pattern draft; replace pad-workspace/source controls with breadcrumb, pattern picker, Play edit and scope-aware Save. |
| Score | Existing sparse piano-roll score editor, draw/move/resize/select/copy notes, velocity, zoom/scroll/fit, full pitch range, native ticks, hidden notes/Trim hidden and per-pattern undo | Contextual selection and audition; do not convert notes to the melodic step grid or reduce the editor to the mockup plot. |
| Drummer | Current drum rows/keys, hit toggles, velocity/timing gestures and properties, ratchet count/ramp, copy/clear, timing and retained inactive/hidden data | Selected-pattern adapter and contextual header only. |
| Controller sequencer | Current Curve/Step toggle, both retained datasets, CC 0–127, multi-channel selection, Reset Value, timing and all curve gestures | Share a draft with inline curve editing; distinguish device-wide settings from reusable pattern fields. |
| Arpeggiator | Input/target routing, rhythm actions, gate/probability/ratchets, order/rate/octaves, expression, scale handling, hold/restart/processing, deterministic seeds, presets, runtime pitch feedback | Replace standalone workspace and Arrangement/Manual pads selection. Preserve legitimate Arranger/Live clock semantics and launch quantization; these are not the obsolete source selector. |
| Piano keyboard | Current keyboard range and scrolling, scale/mode/degree colors, velocity, MIDI channel, autochord, note ownership and explicit Start/Stop | One fixed row in new performances, below arranger/editor. Do not substitute the mockup's shortened keyboard. |
| Manual MIDI controllers | Current named knob rows, numeric values, CC 0–127, multi-channel/OMNI selection, Start/Stop, Add/Remove and persistence/export seeding | Move unchanged full-width rows below the keyboard. Retain current limits, presently six controllers; do not adopt the prototype's simplified routing. |

Melodic/drummer/controller bodies and input-device wrappers currently live in [SequencerPage](../../frontend/src/components/SequencerPage.tsx). Reuse [ScoreEditor](../../frontend/src/components/sequencer/ScoreEditor.tsx), [ScoreSequencers](../../frontend/src/components/sequencer/ScoreSequencers.tsx), [ArpeggiatorEditor](../../frontend/src/components/sequencer/ArpeggiatorEditor.tsx), [ControllerSequencerCurveEditor](../../frontend/src/components/sequencer/ControllerSequencerCurveEditor.tsx), [ControllerSequencerStepEditor](../../frontend/src/components/sequencer/ControllerSequencerStepEditor.tsx), [PianoRollKeyboard](../../frontend/src/components/sequencer/PianoRollKeyboard.tsx) and [MidiControllerKnob](../../frontend/src/components/sequencer/MidiControllerKnob.tsx). The instrument [PerformanceControllerRack](../../frontend/src/components/sequencer/PerformanceControllerRack.tsx) is a different feature and remains with its instrument controls.

## Direct curve editing

Selecting a curve occurrence reveals its keypoints in the expanded lane. Dragging edits the same draft shown in the actual controller editor. Preserve production interactions: click background to add an interior point, drag to move/value-edit, double-click an interior point to remove, anchored endpoint positions, independent start/end values, endpoint-value snapping and Shift to bypass snapping. These take precedence over any different prototype gesture.

Provide keyboard focus, arrow-key adjustments and exact position/value entry for inline handles. Display musical position while mapping through the current normalized 0–1 keypoint storage. Use the existing interpolation, sampling and clamping; do not approximate a different curve in the timeline. A resize of the clip does not stretch the curve; a change to the controller pattern's own duration retains its existing normalized-length behavior.

For repeats or cropped content, convert pointer coordinates through the selected occurrence's source offset and pass. Endpoints outside the visible crop are edited through the contextual full editor, not replaced with invented endpoints at the clip border. Dragging stages a draft; releasing is one undoable gesture and does not commit all linked occurrences. Save uses the same scope dialog as every other pattern edit. No modal on every mouse move.

## Save-scope dialog

Open on Save at pattern, group and supergroup level, including inline curve changes and container restructuring. Show entity name/type, selected occurrence breadcrumb, number of direct links and number of affected timeline uses (including nested/repeated uses), and any duration impact.

| Choice | Explanation shown to the user |
| --- | --- |
| Only this occurrence — default | Save a variation for this selected use. Other uses retain their existing definition. Shared ancestors are copied only where necessary. |
| All linked occurrences | Update this definition everywhere it is referenced, including nested uses and the reusable library. Clip windows stay fixed. |
| Cancel | Keep the draft; do not change authored content. |

Allow a name for a local variation. Offer the dialog even for a single-use definition so saving behaves consistently. If the target is one generated repeat pass, explain that the clip will be split into before/edited/after windows to isolate it. Show a preview of those windows and preserve their combined coverage. An empty or invalid definition cannot become a playable saved source.

Editing a child does not implicitly edit every child of a group. The dialog names exactly the selected definition and its changed payload. Draft operations that change several definitions must show their combined impact and commit atomically, or be split into explicit saves. Do not flatten sharing or deep-copy unrelated content invisibly.

Changing tracks retains drafts. Save Performance/export must offer to resolve pending drafts or explicitly use the last saved definitions; neither silently saves a shared edit nor discards it. New/Load/Import uses the existing unsaved-work protection and then resets temporary editor state.

## Audition and live playground

Play edit starts required instruments automatically. With the song stopped, it auditions the selected pattern/group/supergroup without moving the song cursor. With the song running, the proposed contract replaces that lane temporarily and leaves other lanes playing. Clearly distinguish **Editing**, **Audition queued**, **Auditioning** and **Arranged playback**; Stop edit returns to the arrangement's current position.

The keyboard and controllers keep explicit Start/Stop even with automatic engine startup elsewhere. Preserve current Auto/Live/Listening buffering, inactivity and held-input behavior. The reference's two-state Playback/Live badge is illustrative; the new view must not force low latency forever merely because a device remains enabled. Show the actual runtime mode if a mode indicator is included.

Keep one fixed keyboard for new performances; compatibility for existing multiple keyboards is covered in the migration contract. Stop song is not Panic/Stop all. Keep a clearly separate global stop action that releases all sources and pending commands.

## Accessibility and responsive behavior

Provide keyboard alternatives for draw/move/trim, selection, nesting, grouping and curve points. Focus returns to the initiating item after dialogs. Use visible labels for selected, queued, playing, shared and unsaved state; color alone is insufficient. Nested boxes need meaningful tree/sequence names and an accessible breadcrumb rather than hundreds of tab stops in miniature previews.

On narrow screens, keep timeline horizontal scrolling and move the selected editor below it; retain a full-width playground. Existing dense musical grids may scroll as they do now. Test at text zoom and with coarse pointers. Clip resize handles and curve handles need usable hit areas without changing the displayed musical geometry.

## Direct content manipulation — November 2026 follow-up

The expanded timeline is the primary assembly surface. Single-click and Shift-click select consecutive sibling occurrences in one displayed pass; drag to insertion boundaries or compatible containers within that clip. Patterns/rests form groups; groups form supergroups. A contextual toolbar and right-click menu expose grouping, ungrouping, insertion and keyboard move alternatives. The content picker searches same-track definitions and offers linked adoption, variations, new patterns and rests.

Structural work uses a session-only transaction and draft undo/redo. Save structure resolves local/all-linked scope and commits one arranger history entry. Removing the final child removes its empty container occurrence; reusable definitions remain available. Performance replacement and export/save resolve structural drafts alongside musical drafts.

For these structural operations, the following **chosen growth policy supersedes fixed-window preservation**: lengthening content grows affected windows when space permits; Loop preserves normalized phase and visible full/partial repetition span. All-linked saves evaluate every affected clip. A collision rejects the complete transaction and retains its draft; independent clips never ripple. Local pass edits may shift the following generated portions of their own original clip. Song end grows when needed; shortening content does not shrink windows. Native musical-pattern length edits retain their existing separate behavior.
