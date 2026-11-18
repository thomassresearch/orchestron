# Workspace redesign study

The interactive study shows the proposed layout. The real application preview now runs Arrange, Live and Mix in a bounded workspace with a shared song transport, right-hand Inspector and resizable editor.

Arrange uses one fixed order with the **arrangement above and the editor or keyboard below**.
The Inspector opens on the right in all three views. Arrange, Live and Mix remember their
own selections, panel layout and scroll positions for the current session.

- [Layout decisions and interaction rules](layout-and-interaction-spec.md) are the authoritative
  record of the selected direction, browser behavior, and requirements for future implementation.
- [Implementation plan](implementation-plan.md) maps those decisions to frontend components,
  seven delivery milestones, compatibility checks and release criteria.
- [Milestone 1 baseline](milestone-1-baseline.md) includes importable clip and legacy performances,
  musician workflows, command owners, browser measurements and two current behavior gaps.
- [Milestone 2 preview and verification](milestone-2-view-state.md) explains how to try a same-device pad and clip edit, restore a view and check navigation during playback.
- [Milestone 3 preview and verification](milestone-3-workspace-shell.md) shows the desktop split and phone drawer and records the layout, zoom and playback checks.
- The [musician and producer walkthrough](layout-and-interaction-spec.md#musician-and-producer-walkthrough)
  compares six session tasks against the current application and identifies priorities for usability testing.
- [Interactive study source](orchestron-studio-study.html) is the saved HTML fragment used in
  the conversation. It contains illustrative data and simulated interactions; it has no audio
  engine or backend connection.
- [Preview checker](orch-study-preview-check.mjs) wraps the fragment in a standalone browser
  page, exercises interactions, and produces screenshots and a JSON report.

Older study sessions restore their editor height using the fixed pane order. The
**Content-sized** option demonstrates embedding the study within a page.

The mock now uses a draggable divider instead of the **Editor height** slider. Drag the grip
between panes, or focus it and use Up/Down (Shift for fine adjustment), Home/End for the size
limits, and Escape to cancel a drag. The lower pane retains its chosen height when reopened.

To try the three musician workflows in the silent study:

- In **Live**, start Spark and the keyboard, enable Autochord, and hold a focused piano key
  with Space while clicking a Spark pad. Advance the loop boundary. **Edit** opens the pad.
- In **Arrange**, edit one Bass step with **Create variation here** and save. Select another
  occurrence to see the updated linked-use count on its Save button.
- In **Mix**, play the song and mute Master. Cloud routes directly to **Audio Output**.
  Mute Cloud to silence the final meter. On a narrow window, scroll the bank while watching Master.

To try switching views, select the Bass chorus in Arrange and scroll its open Inspector.
Launch a Spark pad in Live, then select Cloud and scroll the channel bank in Mix. Revisit
each view to pick up at the same item and scroll position. On a phone, open the Inspector
in one view and switch away and back. Escape closes the drawer and focuses its button.

## Preview validation

Run from the repository root with an existing Playwright installation and Chromium:

```sh
node specifications/redesign-user-experience/orch-study-preview-check.mjs
```

Use `--help` for source, output, viewport and appearance options. If Playwright or Chromium
is installed outside the normal resolution paths, set `PLAYWRIGHT_MODULE` and
`PLAYWRIGHT_EXECUTABLE_PATH` to those existing installations. The checker installs nothing
and does not start the application or contact its APIs. Its default output directory is
`output/playwright/redesign-user-experience/`.

The browser checks cover the fixed pane order, restoring an older session, panel
closure, keyboard toggling, desktop and narrow viewports, and a 640 × 360 effective viewport
representing the space available at 200% zoom on a 1280 × 720 viewport. The recorded run
passed without script errors and measured no reserved dock gap after closing panels.
The checker also exercises divider dragging outside its handle, keyboard resizing, minimum
and maximum heights, Escape cancellation, preserved editor content and selection, and reopening.
It also checks right-edge placement, drawer focus, and a round trip through all three views
with different selections, scroll positions, open panels and split heights during playback.
These checks validate the mock's geometry and simulated interactions, not application audio,
real browser zoom, complete accessibility, or runtime behavior.
