# Workspace layout decisions and interaction rules

Status: design direction recorded on 2026-11-14; application implementation has not started.

The user selected **arrangement above, editor below** after reviewing both vertical orders.
This document records that decision and the interaction rules developed in the workspace
study. It is a specification for future work, not a description of functionality already
implemented in Orchestron.

## Scope and priorities

Reduce the long Perform page by placing song overview, focused editing, live operation and
mixing in bounded workspaces. Keep existing musical capabilities and make the relationship
between selection, editing, audition and playback clear.

Retain **Perform** and **Instrument Design** as the primary working contexts. Within Perform,
use **Arrange**, **Live** and **Mix** as views of the same performance. Switching views does
not create another performance, save a draft, restart instruments, or change the song cursor.
Configuration is outside this study.

The existing performance model, transport semantics, quantization, draft resolution,
save/export formats and audio behavior remain governed by the current contracts. A change
to one of those requires a separate decision; a simulated mock interaction is not authority
to change it.

## Selected Arrange layout

The desktop workspace has this stable order:

```text
Application navigation · performance identity · project/library/save actions
Arrange / Live / Mix · panel toggles · instrument engine control
Optional compact rack
┌──────────────────────────────────┬────────────────────┐
│ Song transport and position      │ Context inspector  │
│ Arrangement tools and ruler      │                    │
│ Track headers and clip timeline  │                    │
│ Timeline scroll/zoom controls    │                    │
├──────── Resizable divider ───────┤                    │
│ Editor context, scope and Save   │                    │
│ Selected editor OR keyboard     │                    │
└──────────────────────────────────┴────────────────────┘
Session status and access to runtime diagnostics
```

- Keep the song transport immediately above the arrangement. It includes the existing
  play/resume, pause, stop, seek, position, tempo and song-loop controls.
- Keep the arrangement above the lower detail dock. Do not ship the study's vertical-order
  selector, automatically swap the panes, or place the arrangement below the editor.
- Opening or closing the dock changes the arrangement's available height while preserving
  its top edge, ruler and transport position. Preserve track and timeline scroll positions
  where the new scroll bounds allow.
- The lower dock contains one focused editor or the keyboard at a time. Pattern, instrument
  and routing views are contextual destinations within that dock, not vertically stacked panels.
- The optional inspector occupies the right side and has its own scrolling. It shows concise
  properties of the current selection; it does not duplicate the full musical editor.
- Keep engine start/stop distinct from song transport. Both remain reachable when panels close.

The reason for this order is spatial stability during repeated clip selection and editing.
The alternative with the timeline below moves the ruler and transport when the upper editor
opens or changes height. That alternative has been considered and is not the selected design.

## Browser sizing and scrolling

The application shell fills the available browser viewport. Size it from the available
dynamic viewport height, accounting for surrounding application chrome, rather than using
the mock's fixed preview height. The shell must not create a long document page as panels open.

| Region | Sizing and scrolling rule |
| --- | --- |
| Navigation, workspace controls, transport and status | Remain accessible; do not scroll away with track or editor content. |
| Arrangement | Takes the remaining work area above the dock; tracks scroll vertically within it. |
| Timeline | Scrolls horizontally within its own region, with ruler and clips synchronized; keep track names reachable. |
| Detail dock | Has a user-resizable height within usable limits; its content scrolls independently. |
| Inspector | Uses bounded width and independent vertical scrolling. |
| Closed pane | Occupies no space and leaves no divider or minimum-height placeholder. |

Avoid competing scroll areas inside the same editor unless the content is inherently two
dimensional, such as a score or piano roll. Keep the horizontal timeline scrollbar reachable
without scrolling through all tracks. Resizing must not trap controls outside the visible area.

### When panels are closed

- Closing Editor or Keyboard removes the dock and divider completely. Arrangement receives
  the freed height. Closing Inspector returns its width to the working area.
- Closing all three does not leave a blank panel below the arrangement. The timeline extends
  to its footer and uses the available workspace height.
- A small project may still have unused timeline canvas beneath its tracks. Continue the
  grid and provide an unobtrusive Add track target there; do not fill it with unrelated cards.
- Preserve normal track heights when panels close. **Fit tracks** is an explicit display
  option for larger rows and previews, with a sensible maximum height and scrolling when
  there are many tracks. Do not enlarge a single track to fill the entire window.
- **Fit tracks** changes presentation only. Keep it distinct from **Fit song to clips** and
  clip/content fitting, which can change authored song or clip boundaries.
- Content-sized preview mode may shrink the mock around its contents. It is not the default
  sizing rule for the full application and is not a product preference required by this spec.

### Narrow, short and zoomed windows

Switch to one working pane when the arrangement and editor cannot both remain useful.
Show either the arrangement or the selected detail view, retain song transport, and provide
an explicit way back to the arrangement. Keep the same conceptual hierarchy; do not reverse
the vertical order to accommodate a small window.

Use an Inspector drawer instead of stacking the full inspector above or below the timeline.
Closing it restores focus to its trigger. Reduce less frequent chrome into the project menu
without removing access to save, library, Instrument Design, help or engine controls.

Controls and text reflow; musical canvases retain local scrolling where needed. Do not shrink
the entire desktop UI to fit. On very short windows, allow the editor's context header to
scroll with its content if fixing it would leave no usable editing space.

The mock explores a one-pane threshold around 700 CSS pixels wide or 600 pixels of workspace
height. Those values, pane limits and exact chrome sizes are provisional. Validate them with
real controls, translations, enlarged text and browser zoom before implementation is accepted.

## Placement of current Orchestron capabilities

| Existing capability | Proposed home |
| --- | --- |
| Performance name, description, New/Load/Clone/Delete, native and CSD import/export | Project menu; retain visible identity and save status in the shell. |
| Instrument library and patch selection | Library browser and contextual pickers. |
| Rack instances, patch/channel assignments, continuous instruments | Compact rack for selection; detailed rack management in Mix and contextual instance settings. |
| Song order, fixed clip windows, nested content, rests, sections and transposition | Arrange timeline and contextual structural editing. Only Arrange edits song order. |
| Melodic, drummer, Score, controller and arpeggiator editing | One type-specific editor in the lower dock, preserving each device's controls. |
| Instrument-bound automation | Preserve direct curve editing in expanded arrangement clips and existing target/routing semantics. |
| Pads, independent device play and Arrangement/Manual pads source choice | Live view, with selection, playing and queued states visibly distinct. |
| Piano keyboard, chord controls and manual MIDI controls | Keyboard/detail view with explicit target and independent activation. |
| Per-instance performance controls and CC mappings | Contextual Instrument view, retaining groups, control types and update-mode labels. |
| Faders, pan/balance, meters, mute/solo, sends and inserts | Mix view with the pinned Master and clear Direct Audio Output indicators. |
| Routing matrix, diagram, exact mappings and diagnostics | Mix routing view and contextual routing access. |
| MIDI input, engine state, audio health, runtime errors and engine statistics | Compact persistent status plus accessible diagnostic detail; runtime failures remain visible. |
| Instrument graph, opcode browser and isolated draft audition | Instrument Design, with a clear return to the performance context. |

The rack and contextual instrument controls operate on the same instances. Master remains
the fixed output endpoint, with no library patch or rack slot. Moving controls between views
does not change their ownership, routing, saved values or update timing.

## Selection and panel interactions

| Action | Required result |
| --- | --- |
| Select a track or clip | Update selection and inspector context without opening a closed dock or starting playback. |
| Select another compatible target while its editor is open | Follow the new context while retaining per-target drafts and the editor's view state. |
| Double-click editable content, or activate its accessible Open editor action | Open the appropriate editor below the arrangement; identify the target with its breadcrumb. |
| Press Editor | Open the selected editor, replace Keyboard if visible, or close the currently visible editor. |
| Press Keyboard | Open Keyboard, replace the editor if visible, or close Keyboard if already visible. |
| Press Inspector | Open or close the inspector independently of the dock. |
| Resize the dock | Adjust the split without changing selection, musical data, zoom, playback or save state. |
| Expand editor | Temporarily give the editor the working area while preserving accessible song transport; restore the previous split on return. |
| Close a panel | Retain its drafts and view state; close its menus, cancel active drags, and release held keyboard notes. |
| Switch Arrange / Live / Mix | Retain performance, applicable selection and view state; do not implicitly save or discard edits. |

Selection highlights, shared-definition relationship highlights, and actual multi-selection
must be visually and behaviorally distinct. Preserve the existing nested-content selection,
keyboard navigation and structural editing rules.

A closed editor stays closed during ordinary selection and playback updates. If selection
requires resolving a draft conflict, use the existing Save/Discard/Cancel flow; do not silently
discard the draft. A failed save keeps both the draft and useful error feedback.

Retain existing loading behavior: tracks start compact and the editor remains closed while
the restored clip/loop selection is visible. The study's initially open dock demonstrates
editing and does not override that behavior.

## Editing scope, saving and audition

- Show track/clip/pattern context, unsaved status, editing scope, Play edit and Save together
  at the top of the editor. Keep scope visible before the first content-changing action.
- Preserve **Edit linked pattern** and **Create variation here** for musical editing, and the
  corresponding local/all-linked structural scope. Changing scope never commits content.
- Preserve existing Save/Discard/Cancel conflict resolution, structural draft Undo/Redo,
  saved arranger history and local-only operations. The layout does not add a new commit path.
- Distinguish pattern/structure Save from Save Performance. Performance save/export must retain
  the existing handling of unresolved drafts; closing a pane is never a save operation.
- Keep song Play, device Play, keyboard activation, Play edit and engine start/stop visibly
  distinguishable. Selecting or opening an editor does not audition it.
- Audition remains temporary and follows the current editor lifecycle. Closing the editor
  ends its audition while retaining its draft. Ordinary panel collapse does not stop authored
  song or independently running device playback.
- Retain current seek, pause, stop, loop, independent Manual pads and engine-ownership semantics.
  The layout study's simplified timers and buttons do not redefine these behaviors.

The [arranger guide](../../documentation/performance/multitrack_arranger.md),
[pattern guide](../../documentation/performance/pattern_pads_and_pad_looper.md), and
[engine transport guide](../../documentation/performance/instrument_rack_and_engine_transport.md)
own the detailed musical and transport behavior.

## Live, mix and instrument interaction rules

In Live, distinguish the pad selected for editing from the playing pad and queued launch.
Running Manual pads actions retain boundary-quantized launches; stopped or Arrangement-source
pad clicks only select for editing. Device Play remains an explicit independent action.
Preserve existing queued/playing colors and pair them with labels or indicators.

In Mix, selecting a strip reveals its controls and routing without altering the sound.
Keep live mixer controls available while rack/topology edits remain locked during instrument
playback. Explain that lock beside the unavailable action and provide the existing explicit
stop-to-edit path. Never stop the engine merely because a routing view was opened.

Performance controls retain Float/Integer/Bool behavior, exact-value entry, reset, grouped
labels, CC mappings, and Live/Requires restart/Not connected indications. Do not imply that
all knob changes affect held notes. Preserve per-instance identity when a patch is used twice.

See [mixer and routing](../../documentation/performance/audio_mixer_and_routing.md),
[performance controls](../../documentation/performance/performance_controllers.md), and
[live status](../../documentation/performance/live_status_and_safety_controls.md).

## State lifetime and accessibility

Panel visibility, split size, Fit tracks and view preferences are presentation state, not
musical data. They must not dirty the performance, enter native/CSD exports, or trigger audio
preparation. Keep them through view switches during the session. Persistence across browser
reloads is a separate, currently undecided preference.

Retain drafts, selection, clipboard, editor zoom and scroll when panels close and reopen.
New/Load/Import reset temporary editor state through the existing resolution flow. Hidden
panels suspend visual work and meter subscriptions while playback continues; reopening uses
the current audible snapshot. See [collapsible panels](../../documentation/performance/performance.md#collapsible-panels).

Use native, labeled controls and a logical focus order matching the visible layout. Provide
keyboard access to resizing, opening/closing panes and actions otherwise reached by double-click
or drag. Restore focus when a drawer or dialog closes. Avoid shortcuts that intercept typing
in editable fields, and keep all essential actions available without hover. Exact new shortcut
assignments remain to be designed.

Support EN/DE/FR/ES labels and integrated help in the eventual UI. Test long labels, touch
targets, enlarged text and browser zoom. Readability and accessible controls take priority
over preserving the desktop's density at every viewport size.

## Acceptance criteria for future implementation

1. Arrange consistently presents the timeline above the detail dock, with transport above
   the timeline and no vertical-order preference.
2. Opening or closing the dock preserves the ruler's position; closed dock/divider elements
   occupy no space. Closing Inspector returns its width.
3. Selecting clips with the dock closed leaves it closed; explicit opening reveals the correct
   context. Editor and Keyboard replace one another and toggle closed on a second activation.
4. Many tracks, long patterns, large racks and detailed inspectors scroll within usable regions
   without turning Perform into a long document or hiding essential transport controls.
5. Few tracks do not leave a reserved blank dock. Fit tracks changes only display geometry.
6. Narrow/short windows use a usable single-pane view and inspector drawer, with a clear return
   to the arrangement and continued access to transport and project actions.
7. Panel/view changes preserve drafts, authored playback and session state, applying the existing
   audition lifecycle and releasing held notes where required.
8. Existing scope, save, conflict resolution, Undo/Redo, routing locks, independent transport,
   instance controls and export behavior remain intact.
9. Keyboard-only, touch, translated-label and actual browser-zoom checks find no unreachable
   controls or accidental musical edits caused by layout actions.
10. Application implementation includes updated user documentation and screenshots, localized
    help, and checks appropriate to the changed behavior. The current mock does not satisfy
    those application acceptance checks by itself.

## Study limitations and remaining decisions

The saved [mock](orchestron-studio-study.html) retains historical comparison controls and
simplifies editing, saving, Undo, routing, transport and audio. It illustrates placement and
interaction intent. This document takes precedence where the mock differs.

Remaining design details are exact breakpoints and pane limits, new shortcut assignments,
whether display preferences survive reload, and the final compact runtime-status composition.
None reopens the selected arrangement-above/editor-below order. Configuration remains outside
scope. No application source, runtime behavior or user manual is changed by this specification.
