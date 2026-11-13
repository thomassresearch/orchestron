# Workspace redesign study

Status: design specification and mock only. No application implementation is included.

The selected Arrange layout is **arrangement above, editor or keyboard below**.
The alternative with the arrangement below is no longer part of the proposed product.

- [Layout decisions and interaction rules](layout-and-interaction-spec.md) are the authoritative
  record of the selected direction, browser behavior, and requirements for future implementation.
- [Interactive study source](orchestron-studio-study.html) is the saved HTML fragment used in
  the conversation. It contains illustrative data and simulated interactions; it has no audio
  engine or backend connection.
- [Preview checker](orch-study-preview-check.mjs) wraps the fragment in a standalone browser
  page, exercises interactions, and produces screenshots and a JSON report.

The saved study retains its earlier **Timeline above / Timeline below** comparison control.
That control is historical exploration, not a requirement to implement both layouts. The
written specification takes precedence. Its **Content-sized** preview option is likewise
a study aid; the proposed application fills the available browser viewport.

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

The browser checks performed during the study covered both historical layouts, panel
closure, keyboard toggling, desktop and narrow viewports, and a 640 × 360 effective viewport
representing the space available at 200% zoom on a 1280 × 720 viewport. The recorded run
passed without script errors and measured no reserved dock gap after closing panels.
These checks validate the mock's geometry and simulated interactions, not application audio,
real browser zoom, complete accessibility, or runtime behavior.
