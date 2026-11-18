# Milestone 7 · Perform workspace release

**19 November 2026.** The ordinary Perform entry opens Arrange, Live and Mix for clip-based and legacy performances. A project can move between all three views during playback. New, Load, Save, Import and Export use the existing performance formats. Legacy conversion is still explicit. [User guide](../../documentation/performance/performance.md) · [Measured results](milestone-7-measurements.json)

## What changed at release

- **Song Stop** now tells the renderer where to leave the arrangement cursor when it stops the arrangement sources. The acknowledgement and the subsequent audible markers agree. Previously a local reset could be replaced by a later PCM update, leaving Pause highlighted. Pause holds the cursor. Stop returns to the selected range start or zero. The reset affects only song time. The backend test advances an independently running Manual device through the reset and verifies its phase and sounding pad. [Transport implementation](../../backend/app/services/sequencer_source_transport.py) · [Service regression](../../backend/tests/test_sequencer_source_transport.py)
- The normal app and the browser test entry mount the same workspace. The production build was served by FastAPI and exercised at its root URL with both saved songs. In all three views the document measured 1440 × 900 on desktop and 390 × 844 on the phone-sized viewport. Milestone 1 measured heights of 2,844 and 4,606 on desktop and 4,292 and 7,374 on the phone for the same pair. [Baseline](milestone-1-baseline.md)
- The README, English manual, screenshots and integrated help now direct musicians to the shipped controls. Project contains the library and file commands. The bottom line shows engine state, MIDI input, pending clip edits and errors. Diagnostics exposes the full error and engine statistics. [Perform manual](../../documentation/performance/performance.md) · [Audio and troubleshooting](../../documentation/performance/live_status_and_safety_controls.md)

## Musical and layout checks

| Workflow | Result on the application |
| --- | --- |
| First instrument and Arrange | Created and auditioned a first note, opened each of the five device editors, edited one repeated occurrence, saved a structure across three uses, and cancelled a conflicting edit. A Live pad edit preserved the open clip draft on the same device. Edited an automation curve, undid the edit, switched views and redid it. |
| Navigation and resizing | The active session kept playing while switching Live → Mix → Mix → Arrange and resizing the editor. The probe observed **zero worker sequencer requests and zero HTTP sequencer writes**. The mounted editor control, draft and authored revision survived divider gestures. |
| Independent Live playback | Desktop keyboard and two-finger touch both held C4, E♭4 and G4 through two launches. Queued and sounding indicators changed at the pattern boundary. Leaving Live sent one release per note. The Manual device kept playing through song seek and Stop. A saved clip performance retained its extra Manual device and pad edits on reload. |
| Mix and routing | With Master muted, direct output reached the browser audio destination. Muting the direct strip as well produced silence. In the nine-strip bank, both pinned regions kept their position after scrolling 1,037 pixels horizontally and 218 vertically. Two meter subscriptions remained with the bank scrolled down, and zero after leaving Mixer. The second sample kit and instrument controls addressed their own rack instances. |
| Browser and input | Passed 1440 × 900, 1280 × 720, 736 × 720, 390 × 844 and 640 × 360. The split retained the ruler and track-name positions. Closing the editor reclaimed its entire height. Keyboard resizing, gesture cancellation, touch drag, drawer focus and Escape passed. At actual Chromium 200% zoom the CSS viewport changed from 1280 × 723 to 640 × 361 with no document overflow. The controls passed pointer hit testing. EN, DE, FR and ES controls were reachable in both narrow and short layouts. |
| Failure and recovery | An empty rack reported its engine-start error with the panels closed. Diagnostics retained the full message across views. A rejected live preparation kept playback moving and retained the edited tempo. Navigation caused no retry, and the next edit applied. For both song formats, a failed Save retained the description and a successful retry survived reload. The browser injected the preparation and storage failure responses. Native service regressions exercise compiler failure and retention of the previous audio configuration. |
| Legacy compatibility | The clip-enabled build rejected an incompatible Manual-source conversion without changing the song. After making the source compatible, conversion downloaded the backup. With `VITE_CLIP_ARRANGER=0`, legacy occurrences still opened in the bounded editor and saved clip performances still opened in Arrange. |

The split switches to one pane below 700 CSS pixels of working width, below 600 pixels of browser height, or when the real overview and open editor no longer fit. The minimum dock is 180 pixels. Its maximum is 60% of the pane area, reduced to keep the ruler and track controls usable. The divider is 12 pixels with a fine pointer and 24 with a coarse pointer. These limits apply to both performance formats. [Shell](../../frontend/src/components/sequencer/WorkspaceShell.tsx) · [Divider](../../frontend/src/components/sequencer/DockDivider.tsx)

## File and audio parity

Each pre-edit baseline song was exported through Project, imported under a fresh name with its existing patch definitions, saved and reloaded. The complete serialized authored configuration matched, including array order. Clip wrote v23 and legacy wrote v22. Each song also produced separate MIDI and SCORE CSD packages through the UI. All four packages rendered locally with Csound 6.18. Each render was finite stereo 48 kHz float32 with 288,000 frames. Within each song, MIDI and SCORE produced byte-identical PCM.

| Fixture | Peak in both modes | Song Stop after the audio queue drained |
| --- | ---: | --- |
| UX Baseline Clip | 0.08798 | 0 beats, Stop highlighted, separately started instruments still running |
| UX Baseline Legacy | 0.06484 | 0 beats, Stop highlighted, separately started instruments still running |

The clip baseline record includes an additional musical edit before its historical export. The comparison here uses each fixture's current MIDI and SCORE exports. Exact hashes and timing samples are in the [measurement file](milestone-7-measurements.json).

## Runtime measurements

Chromium 139.0.7258.5, native browser-clock Csound, 1440 × 900, instrumented Vite development build. Each legacy sample ran for 15 seconds after warm-up. The 46-device song and audio client matched milestone 1. The new launcher keeps its device rows and MIDI controls visible after the editor closes.

| Legacy workload | DOM elements | Main-thread task | Script | Layout | Added underruns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original page, all panels open | 21,635 | 14.999 s | 13.745 s | 53.6 ms | 0 |
| Workspace, one device editor open | 2,717 | 3.365 s | 2.655 s | 6.6 ms | 0 |
| Original page, all panels collapsed | 125 | 0.721 s | 0.486 s | 37.3 ms | 0 |
| Workspace, launcher after three Mix/Arrange trips | 1,584 | 1.973 s | 1.887 s | 8.9 ms | 0 |

The launcher sample recorded zero hidden melodic editor and meter renders. The active launcher and its visible MIDI controllers continued rendering. Across three 30-second clip audio samples, measured browser PCM peaked at 0.07466 and underruns increased by zero. Playback recovered after reconnect.

| Clip workload | DOM, baseline → workspace | Task time, baseline → workspace | Script time, baseline → workspace |
| --- | ---: | ---: | ---: |
| Compact | 489 → 407 | 2.657 → 2.655 s | 2.330 → 2.578 s |
| Dense, expanded | 808 → 693 | 3.950 → 3.364 s | 3.586 → 3.268 s |
| Dense, collapsed | 600 → 463 | 3.484 → 2.599 s | 3.183 → 2.511 s |

The separate 16,000-beat layout fixture rendered 480 elements compact and 692 expanded. At 16 beats it rendered 415 and 437. Timing values are single local observations. Audio verification sampled rendered PCM and the browser destination. Touch input used Chromium emulation. Physical touch hardware, external MIDI devices and other browser engines were outside this run.

## Replay

1. Start the local FastAPI and Vite profiling servers with a disposable database and asset directory. Import the paired baseline bundles once. Use a fresh English browser context at 1440 × 900 with the engine stopped for each script. [Server commands](../../frontend/tests/performance/README.md#clip-arranger-acceptance) · [Fixtures and import procedure](milestone-1-baseline.md#replay-the-two-performances)
2. Open `/tests/performance/workspace.html`, choose Perform, then load the named song under Project. From the repository root run `playwright-cli run-code --filename frontend/tests/performance/verify-workspace-<name>.js` for the entries below. The import, first-track and instance checks create items in the disposable library.

   | Starting fixture | Checks |
   | --- | --- |
   | Clip | `shell`, `access`, `navigation`, `arrange`, `first-track`, `live-save`, `mix-instances`, `preparation` |
   | Legacy | `legacy-arrange`, `live`, `live-devices`, `mix` |
   | Each separately | `transport`, `roundtrip` |

3. The round-trip check writes bundles and CSD ZIPs under `output/playwright/workspace-release-*`. Extract each ZIP separately, run `csound <exported-name>.csd` in its directory and compare the WAV data chunks for the two modes of each song. For the compatibility run, restart Vite with `VITE_CLIP_ARRANGER=0` and repeat `legacy-arrange`.
4. For timing, open `collapse-profile.html?workspace=1` or `clip-arranger.html?workspace=1` under `/tests/performance/`. Use the existing collapse, clip layout and clip audio measurement scripts with their documented setup. For zoom, set actual browser zoom to 200%, open the editor, open and dismiss the Inspector and Diagnostics, and focus the song transport. [Profiling procedures](../../frontend/tests/performance/README.md)
5. Run `npm --prefix frontend run check`, `make backend-check`, the backend tests, `make docs-check` and `git diff --check`. Generate the manual with `node tools/build_user_docs_pdf.mjs`. Open the compiled app at the ordinary server URL and load both songs. [Manual PDF](../../documentation/user_documentation.pdf)

## Verification result

Frontend lint, all 1,480 frontend tests and the production build passed. Backend lint and all 3,608 backend tests passed. Pytest reported one Starlette TestClient deprecation warning. Manual validation covered 63 source pages, and the rendered Arrange, Live, drawer and Mix figures were inspected in the 218-page English PDF. The specification links and whitespace checks passed.

The release switch lives in [App.tsx](../../frontend/src/App.tsx). Setting the default of `performWorkspace` to `false` restores the former Perform composition for a rollback. The clip-arranger compatibility switch continues to control clip creation and legacy conversion independently. No stored performance or app-state migration is required.
