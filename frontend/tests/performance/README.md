# Collapsed performance profiling

## Recorded result — 15 September 2026

Chrome 153.0.8010.36, headed, local backend in browser-clock mode. The normalized fixture contains 46 devices: eight melodic, drummer, controller, arpeggiator and piano devices, plus the supported maximum of six MIDI controllers. A temporary preview session uses the versioned `velocity_if.patch.json` voice with explicit melodic notes and drum hits. No saved performance, patch or app-state records are written.

Each sample ran for 15 seconds after a three-second warm-up. This uses a Vite development build with React Profiler and test-only construction counters. Timing includes instrumentation overhead and is not a production benchmark. The driver forwards audible worker events into the real store and mounts the real Perform components; it does not bootstrap the full App or its persistence effects.

| Metric | Expanded | Collapsed |
| --- | ---: | ---: |
| Render calls per device/rack/arranger body | 241 | **0** |
| Mixer body render calls | 241 | **0** |
| Meter renders | 858 | **0** |
| Note-option construction calls | 1,928 | **0** |
| Controller-curve construction calls | 56 | **0** |
| React commits, including visible shell | 894 | 240 |
| React render time | 9,859 ms | 201 ms |
| Main-thread task time | 14.537 s | 0.625 s |
| Main-thread script time | 11.077 s | 0.403 s |
| Style recalculations | 860 | 0 |
| DOM mutation records, including visible shell | 31,686 | 265 |
| DOM elements | 17,558 | 106 |
| Audio underrun increment | 0 | 0 |
| Maximum observed output peak | 0.632 | 0.632 |

All eight collapsed panel body containers were empty throughout the collapsed sample. Mixer contents were also absent. Playback continued; remaining React commits and DOM changes belong to visible headers, summaries and transport. The browser audio context reported 24 kHz; the local backend health endpoint reported a 48 kHz engine. Nonzero output peaks confirm sounding audio in both samples.

**Acceptance result:** hidden visual work was eliminated. Main-thread task time fell by 95.7% in this local run. Both states had zero underruns, so this measurement does not establish a reduction in audio dropouts. A longer production session on representative hardware is needed to measure that separately.

Raw measurements: [collapse-profile-result.json](collapse-profile-result.json).

## Reproduce

1. Run a local backend on port 8000 with browser-clock audio enabled.
2. From `frontend/`, run:

   ```sh
   node node_modules/vite/bin/vite.js --config tests/performance/vite.config.mjs
   ```

3. From the repository root, open `http://127.0.0.1:5178/tests/performance/collapse-profile.html` in an isolated Playwright CLI browser session. Take a snapshot before interacting. The profile page has Start/Stop controls; the measurement script starts its temporary audio session if necessary.
4. Run the measurement with the installed Playwright CLI:

   ```sh
   playwright-cli -s=collapse-profile open http://127.0.0.1:5178/tests/performance/collapse-profile.html --headed
   playwright-cli -s=collapse-profile snapshot
   playwright-cli -s=collapse-profile --raw run-code --filename frontend/tests/performance/measure-collapse.js
   ```

5. Stop the temporary session with **Stop profile audio** before closing the page, then close the isolated browser and stop the profiling server. The Stop action disconnects the audio client and deletes only the preview session it created.

The profiling server reuses the frontend test configuration's fixture isolation: imports of the production drumkit template resolve to the checked-in test snapshot. Counters are injected only by this profiling config. Screenshots go to `output/playwright/`.

## Automated validation

`npm --prefix frontend run check` passed: frontend lint, **308 tests in 29 files**, and the production build. The 15 collapse regressions and two workspace-generation regressions cover hidden construction, current playback on expansion, animation/observer/listener/subscription cleanup, nested visibility, retained drafts and selections, clipboard/zoom/scroll, held-note cleanup, pending Mixer synchronization, asynchronous result isolation, successful workspace replacement, deletion and ordinary saves. Strict Mode and repeated toggles are included.

README, performance/Mixer documentation and integrated EN/DE/FR/ES help were updated. `node tools/build_user_docs_pdf.mjs` rebuilt the 115-page PDF; the cover, table of contents, Mixer page and complete performance-panel explanation were rendered and visually checked.

## Timing editor review

With the same isolated Vite server running, open `/tests/performance/timing-review.html`. It loads one melodic, drum and controller fixture locally, with a twelve-step 4/4 triplet melody. It does not bootstrap API, audio or autosave. Timing selectors update the real store. Inspect controls and beat/bar headers at 1440 and 390 pixels, including subdivision 1, partial bars and 32-beat controller curves. The editors retain horizontal scrolling and their usual collapse behavior.
