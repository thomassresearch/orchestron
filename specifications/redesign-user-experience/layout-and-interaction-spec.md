# Workspace layout decisions and interaction rules

Design direction chosen on 2026-11-14. Musician and producer workflow review updated on 2026-11-18.

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
- Use one pane order in both the study and the product. The arrangement sits above the
  divider and the editor or keyboard sits below it. Restored sessions use the same order.
- Opening or closing the dock changes the arrangement's available height while preserving
  its top edge, ruler and transport position. Preserve track and timeline scroll positions
  where the new scroll bounds allow.
- The lower dock contains one focused editor or the keyboard at a time. Pattern, instrument
  and routing views are contextual destinations within that dock, not vertically stacked panels.
- In Arrange, Live and Mix, the optional Inspector occupies a right-hand column spanning the
  overview and dock. Opening it keeps the left edge of the working area fixed. Closing it
  returns the full width to the overview and dock. Its properties scroll independently.
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
| Detail dock | Resizes through the draggable divider within usable limits; its content scrolls independently. |
| Inspector | Uses bounded width and independent vertical scrolling. |
| Closed pane | Occupies no space and leaves no divider or minimum-height placeholder. |

Avoid competing scroll areas inside the same editor unless the content is inherently two
dimensional, such as a score or piano roll. Keep the horizontal timeline scrollbar reachable
without scrolling through all tracks. Resizing must not trap controls outside the visible area.

### Draggable divider

Replace the study's **Editor height** slider with a full-width horizontal divider between
the arrangement and the detail dock. A small central grip indicates that it can be dragged;
the entire divider is the hit target. Use a vertical-resize cursor, visible keyboard focus,
and hover/active feedback. Provide a larger, non-overlapping target for touch input.

- Drag upward to enlarge the editor and downward to enlarge the arrangement. Both panes
  update continuously; their combined size stays within the workspace. This is a pane resize,
  with no page scrolling or musical edit.
- Capture the pointer for the gesture so dragging continues outside the thin divider. Support
  mouse, touch and pen. Suppress text selection and touch scrolling only for the resize gesture.
- Clamp resizing before either pane becomes unusable. The study keeps the editor at least
  180 CSS pixels high and at most 60% of the working area, further limited to retain arrangement
  chrome and visible track space. These numerical limits remain provisional.
- Release to retain the chosen height. Escape, pointer cancellation, unexpected loss of capture,
  leaving the browser window's focus, or a layout change during the gesture restores the prior
  height and clears drag state. Resizing does not alter selection, editor content, save status,
  playback, or the arrangement ruler's vertical position.
- Tab reaches the divider. Up/Down move it by 10 CSS pixels; Shift+Up/Down use 1-pixel increments.
  Home gives the editor its smallest allowed height; End gives it its largest. These keys act
  only while the divider has focus. Panel buttons remain the explicit way to close the dock.
- Expose horizontal separator semantics, the controlled detail pane, and its current/minimum/
  maximum size to assistive technology. Keep the announced value synchronized with the rendered
  height. The interaction follows the sizing and arrow-key concepts of the
  [WAI-ARIA window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/);
  this study does not claim complete accessibility conformance.
- Reopening the editor or keyboard restores the chosen split. A smaller browser window may
  temporarily constrain it; enlarging the window restores the preferred size where possible.
  View changes preserve that preference without saving it as performance data.
- Hide the divider when the dock is closed, the editor is expanded, or the workspace uses one
  pane. The mock's content-sized preview also hides it because that preview has no bounded split.

The divider is the only editor-height control in the mock. The separate Tweak editor-height
slider is removed as well; browser-height exploration remains available.

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

The Inspector opens as a drawer from the right edge of the active pane. Opening it by button
focuses its close control. Close or Escape returns focus to the Inspector button. Each view
remembers its drawer separately from its desktop sidebar, so narrowing the window first leaves
the working pane visible and widening it recovers the desktop layout.
Reduce less frequent chrome into the project menu
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
| Performance name, description, New/Load/Clone/Delete, native bundle import/export and CSD exports | Project menu with visible performance identity and save status in the shell. |
| Instrument library and patch selection | Library browser and contextual pickers. |
| Rack instances, patch/channel assignments, continuous instruments | Compact rack for selection; detailed rack management in Mix and contextual instance settings. |
| Song order, fixed clip windows, nested content, rests, sections and transposition | Arrange timeline and contextual structural editing. Only Arrange edits song order. |
| Melodic, drummer, Score, controller and arpeggiator editing | One type-specific editor in the lower dock, preserving each device's controls. |
| Instrument-bound automation | Preserve direct curve editing in expanded arrangement clips and existing target/routing semantics. |
| Pads, independent device play and Arrangement/Manual pads source choice | Live view, with selection, playing and queued states visibly distinct. |
| Piano keyboard, chord controls and manual MIDI controls | Keyboard/detail view with explicit target and independent activation. |
| Per-instance performance controls and CC mappings | Contextual Instrument view, retaining groups, control types and update-mode labels. |
| Sample Player note maps | Open **Samples** from the selected rack instance in the Instrument dock. Show its MIDI channel, note, file, Preview and Stop preview together. |
| Faders, pan/balance, meters, mute/solo, sends and inserts | Mix view with the pinned Master and clear Direct Audio Output indicators. |
| Routing matrix, diagram, exact mappings and diagnostics | Mix routing view and contextual routing access. |
| MIDI input, engine state, audio health, runtime errors and engine statistics | Compact persistent status plus accessible diagnostic detail; runtime failures remain visible. |
| Instrument graph, opcode browser and isolated draft audition | Instrument Design, with a clear return to the performance context. |

The rack and contextual instrument controls operate on the same instances. Master remains
the fixed output endpoint, with no library patch or rack slot. Moving controls between views
does not change their ownership, routing, saved values or update timing.

## Musician and producer walkthrough

The fixed split addresses the long Perform page. The following recommendations come from
walking through common tasks in the study against the current app's controls and screenshots.
They are proposed product requirements. The walkthrough used a silent mock.

| Task | Finding and proposed behavior | Acceptance scenario |
| --- | --- | --- |
| Get the first instrument playing | Today's **Add track** creates a first clip and pattern. Keep that shortcut in the empty timeline, followed by an instrument/channel picker with **Add instrument** when the rack is empty. Keep the existing keyboard within reach. [Current arranger](../../documentation/performance/multitrack_arranger.md) | From New, assign a sound, open its first pattern and hear it with **Play edit**, all from Arrange. |
| Change the fill on the last chorus | The current editor names the audition target and shows the impact of a linked save. The study labels the project action **Save performance**. The pattern action shows **Save variation here** or **Save linked pattern (N uses)** according to its scope. Put **Play edit / Stop edit** beside the breadcrumb and show the auditioning lane on the timeline. [Current draft controls](../../screenshots/clip-arranger-edit-playback.png) · [Editing scope](../../documentation/performance/pattern_pads_and_pad_looper.md) | Loop the last chorus, audition a local drum fill against the bass, save it and verify the earlier chorus still uses its original fill. Repeat with linked scope and verify the displayed use count. |
| Navigate or automate during playback | The study shows bar and beat at the transport. The existing position field also accepts precise master-beat seeks. Retain editable position, the audible playhead, and the song-loop extent on the ruler. Keep clip **Once/Loop** in the inspector. Edit a bound CC curve directly in its lane with the owning instrument and parameter visible. [Transport](../../documentation/performance/multitrack_arranger.md#play-and-jam) · [Automation](../../documentation/performance/instrument_automation.md) | Enter a seek position during playback, then adjust a filter sweep against the chorus without losing sight of the playhead. Changing the view preserves the song end and the curve draft. |
| Jam over a running pattern | In the study, launching or selecting a pad preserves the open keyboard, its destination and held notes. A compact launcher shares the keyboard pane on narrow screens. **Edit** opens the selected device’s pad. Show the edit target, playing pad and queued pad separately, along with the device's source and launch boundary. [Pad workflows](../../documentation/performance/pattern_pads_and_pad_looper.md) · [Independent keyboard](../../documentation/performance/piano_rolls.md) | Hold a chord and queue the next Manual pad. The keyboard stays available, the current pad sounds until the device boundary, and a second launch is reachable on a narrow screen. |
| Balance the track and trace a sound | The current mixer shows strip destinations, a pinned Master and a separate final Audio Output meter. The study opens Mix with the detail dock closed. Source and return strips scroll together. Master stays on the right and a separate stereo **Audio Output** meter sits below the bank. Keep live **Bypass** beside its insert. [Current mixer](../../screenshots/perform_mixer_sends_inserts_master.png) · [Routing](../../documentation/performance/audio_mixer_and_routing.md) | With a wide rack, lower Master. Identify a still-audible direct strip from its destination badge and the final meter. Adjust its fader or bypass an existing insert while the song runs. |
| Set up two sample kits | **Samples** currently belongs to each Sample Player rack instance. The mock's general instrument controls omit the map. Preserve instance identity and routed preview in the dock. Keep assignments editable when instruments are stopped and inspection and preview available while they run. [Sample Player](../../documentation/performance/sample_player.md) | Give the same MIDI note different files on two instances. Preview each through its own strip, close Samples to end its preview, and return to the selected drum clip. |

In musician sessions, watch for a missed second launch or a linked save that changes a previously
approved passage. For the mixer walkthrough, use enough channels to scroll the bank while watching
Master and final output.

After a mixer adjustment, return to the same chorus occurrence, scroll position, draft and
dock state in Arrange. Use the right-hand Inspector to check the occurrence while the track
headers keep their left edge. In the next usability session, run the scenarios above on a laptop and
repeat the pad-launch task with a narrow viewport. Observe forced view changes, missed launches
and whether the player can identify what will sound or be saved before acting.

## Selection and panel interactions

| Action | Required result |
| --- | --- |
| Select a track or clip | Update selection and inspector context without opening a closed dock or starting playback. |
| Select another compatible target while its editor is open | Follow the new context while retaining per-target drafts and the editor's view state. |
| Double-click editable content, or activate its accessible Open editor action | Open the appropriate editor below the arrangement; identify the target with its breadcrumb. |
| Press Editor | Open the selected editor, replace Keyboard if visible, or close the currently visible editor. |
| Press Keyboard | Open Keyboard, replace the editor if visible, or close Keyboard if already visible. |
| Press Inspector | Open or close the inspector independently of the dock. |
| Drag the divider or use its resize keys | Adjust the split within both panes' limits without changing selection, musical data, zoom, playback or save state. |
| Expand editor | Temporarily give the editor the working area while preserving accessible song transport; restore the previous split on return. |
| Close a panel | Retain its drafts and view state; close its menus, cancel active drags, and release held keyboard notes. |
| Switch Arrange / Live / Mix | Restore the destination's selection, open panels and scroll positions. Selecting the active view again leaves it in place. |

Selection highlights, shared-definition relationship highlights, and actual multi-selection
must be visually and behaviorally distinct. Preserve the existing nested-content selection,
keyboard navigation and structural editing rules.

A closed editor stays closed during ordinary selection and playback updates. If selection
requires resolving a draft conflict, use the existing Save/Discard/Cancel flow; do not silently
discard the draft. A failed save keeps both the draft and useful error feedback.

Retain existing loading behavior: tracks start compact and the editor remains closed while
the restored clip/loop selection is visible. The study's initially open dock demonstrates
editing and does not override that behavior.

### Returning to a view

Arrange, Live and Mix each remember where the musician was working during the current
performance session. The study starts Arrange on Bass with its pattern and Inspector open,
Live with the keyboard open, and Mix on the mixer with the dock closed. These defaults apply
only on first entry.

| View | What comes back |
| --- | --- |
| Arrange | The selected track, clip occurrence and editor selection, including a step, drum row or automation point. Restore Fit tracks and the timeline, editor and Inspector scroll positions. |
| Live | The selected device and its editing pad, the launcher or open dock, and the device-list and dock scroll positions. Playing and queued indicators reflect the current device state. |
| Mix | The selected strip or rack instance, the Mixer, Rack or Routing view, any open instrument control group, the channel-bank offset on both axes and the Master strip's own scroll position. |

Every view remembers its compact rack, Inspector, open editor or keyboard, expanded editor,
preferred split height and open property sections. A closed dock stays closed on return.
Restore scroll after laying out the destination. If the available space or content has changed,
use the nearest reachable position. Explicit actions such as **Manage rack** open their named
destination. The ordinary view buttons always resume where the musician left off.

The song cursor, transport, running devices, queued launches, mixer settings and musical drafts
belong to the shared performance session. Returning to a view reads their current values.
Leaving a keyboard releases held notes. Returning to it restores the controls without sounding
those notes again.

## Editing scope, saving and audition

- Show track/clip/pattern context, unsaved status, editing scope, Play edit and Save together
  at the top of the editor. The session mock starts each track with four occurrences sharing a
  pattern. After saving a local variation, revisiting a sibling shows **Save linked pattern
  (3 uses)**. A sole remaining use shows **Save pattern here**. The structure editor uses
  **Save structure here** or **Save linked structure (N uses)**. In Live, **Save pad N**
  targets the numbered pad of the device in the breadcrumb. **Save performance** keeps
  uncommitted editor drafts available. Keep scope visible before the first content-changing action.
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
Preserve existing queued/playing colors and pair them with labels or indicators. Queueing and
applying a launch preserve the musician’s held chord, chosen MIDI destination and device settings.
The compact keyboard pane includes a device picker, its eight pads, Play/Stop and Edit. The
silent study advances launches through **Advance loop boundary**. The application uses the
device’s musical clock.

In Mix, selecting a strip sets the target for its controls and routing. Open detail explicitly.
Use a horizontal bank for instrument and return strips, a pinned Master strip on the right
and a separate stereo Audio Output meter below both. Show the main destination on each strip.
Master gain and mute act on paths routed to Master. The final meter includes direct paths after
their own strip controls. In the study, play the song and mute Master. Cloud’s **Direct Audio
Output** path still registers on the final meter. Muting Cloud as well brings it to silence.
The meter readings are illustrative dBFS values driven by simulated activity, gain and routing.
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
assignments beyond the divider's resizing keys remain to be designed.

Support EN/DE/FR/ES labels and integrated help in the eventual UI. Test long labels, touch
targets, enlarged text and browser zoom. Readability and accessible controls take priority
over preserving the desktop's density at every viewport size.

## Acceptance criteria for future implementation

1. Arrange consistently presents the timeline above the detail dock, with transport above
   the timeline and no vertical-order preference.
2. Opening, closing or resizing the dock preserves the ruler's position; closed dock/divider
   elements occupy no space. Closing Inspector returns its width. The divider supports pointer
   capture, keyboard resizing, both size limits, gesture cancellation, and restoration of the
   chosen height, without dirtying the performance or rebuilding its editor contents.
3. Selecting clips with the dock closed leaves it closed; explicit opening reveals the correct
   context. Editor and Keyboard replace one another and toggle closed on a second activation.
4. Many tracks, long patterns, large racks and detailed inspectors scroll within usable regions
   without turning Perform into a long document or hiding essential transport controls.
5. Few tracks do not leave a reserved blank dock. Fit tracks changes only display geometry.
6. Narrow/short windows use a usable single-pane view and inspector drawer, with a clear return
   to the arrangement and continued access to transport and project actions.
7. Leave a scrolled chorus editor with a pending step edit in Arrange, select a pad with the
   keyboard open in Live, then select a strip and scroll its bank in Mix. Revisit all three.
   Each recovers its selection, panels and offsets. The draft is still pending and the running
   transport and pad show their current state. Repeat on a narrow screen with the Inspector
   drawer open in just one view.
8. Existing scope, save, conflict resolution, Undo/Redo, routing locks, independent transport,
   instance controls and export behavior remain intact.
9. Keyboard-only, touch, translated-label and actual browser-zoom checks find no unreachable
   controls or accidental musical edits caused by layout actions.
10. Application implementation includes updated user documentation and screenshots, localized
    help, and checks appropriate to the changed behavior. The current mock does not satisfy
    those application acceptance checks by itself.

## Study limitations and remaining decisions

The saved [mock](orchestron-studio-study.html) demonstrates the fixed Arrange stack and its
resizable dock. The walkthrough above identifies the remaining differences to evaluate with
musicians. Editing, saving, Undo, routing and transport are simulated.

Remaining design details are exact breakpoints and pane limits, other new shortcut assignments,
whether display preferences survive reload, and the final compact runtime-status composition.
None reopens the selected arrangement-above/editor-below order. Configuration remains outside
scope. No application source, runtime behavior or user manual is changed by this specification.
