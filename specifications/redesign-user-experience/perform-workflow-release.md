# Perform workflow release checks, stages 1–4

**19 November 2026 · Passed.** All seven workflows passed on the clip-based and legacy release fixtures, including the cases specific to each format. A single Manual pad click after a cold speaker preview queued and played the pad. At 640 × 360 the keyboard and a long save error left **97.4 CSS px** of usable Arrange editor in both formats with English selected. Perform stayed inside the browser viewport across all three views. The rerun used the working tree based on `51db777`. The measurements identify the tested application diff. [Acceptance plan](perform-workflow-follow-up-plan.md) · [Measurements](perform-workflow-release-results.json)

## Seven musician workflows

| # | Workflow | Result |
| --- | --- | --- |
| 1 | Play over an unsaved Arrange variation | **Passed.** The local variation on the second chorus pass kept its audition, scope and edits through opening the keys, playing, resizing and closing the keys. Stop ended the original gesture once. An arpeggiator draft generated notes while C4 was held. A same-device Live pad edit preserved the clip draft on return. At 640 × 360 a step could still be changed and restored with the keys open and a long error present. [Clip replay](../../frontend/tests/performance/verify-workspace-arrange.js) · [Arpeggiator replay](../../frontend/tests/performance/verify-workspace-first-track.js) |
| 2 | Identify and preview a pad without launching it | **Passed.** Empty and populated marks, short-press cancellation and held previews worked. A clip-lane preview used the edited physical pad. During established Manual playback, pad 2 kept its queued launch under a held pad 3 preview, and releasing the speaker preserved the editing pad and a second finger’s held key. Immediately after a cold preview, a single click selected pad 2, queued it while pad 1 was still playing and switched it into playback at the boundary. [Live replay](../../frontend/tests/performance/verify-live-pad-preparation.js) |
| 3 | Copy, transpose and build a phrase | **Passed.** The legacy song required confirmation before replacing pad 2. Both melodic transpose modes worked. The 1–2–1 group and edited pads survived saving, loading and native import. Drummer, controller, Score and arpeggiator pads copied independently, including hidden Score notes. In the clip song, copying pad 1 to 5 and transposing the copy from MIDI 60 to 62 preserved the source at 60 across native import and reload. [Pad actions](../../frontend/tests/performance/verify-live-pad-preparation.js) |
| 4 | Reorder melodic devices in Live | **Passed on both formats.** A six-device legacy set retained its final order through a native round trip. Dragging past a launcher edge, cancelling a drag and moving a playing device with a pad queued preserved device identity, MIDI channel and sync target. Reordering the two clip-song devices also survived reload, with their Arrange lanes in the original order. [Legacy reorder](../../frontend/tests/performance/verify-live-set-preparation.js) · [Clip playback](../../frontend/tests/performance/verify-workspace-live-save.js) |
| 5 | Open the exact legacy phrase in Arrange | **Passed.** The handoff reached the bass lane’s unused group, repeated group, supergroup and physical pad despite a previous selection on another lane. A deleted definition focused the surviving lane. Returning to Live retained the draft. The handoff issued zero transport, sequencer configuration or save writes. A clip-song device without a legacy destination correctly omitted the command. [Phrase handoff](../../frontend/tests/performance/verify-live-set-preparation.js) |
| 6 | Hold a chord from Live into Mix and adjust an insert | **Passed on both formats.** Desktop keyboard and emulated two-finger touch carried C4, E♭4 and G4 through pad launches, Mute, Solo, insert Bypass and a filter cutoff change. The engine received the new cutoff. Each pitch received one release on its original channel. Two separate keyboard destinations also retained channels 1 and 2 across navigation and resizing. The clip-song chord replay used a saved disposable copy with one Manual device alongside its clip lane. [Held-chord replay](../../frontend/tests/performance/verify-workspace-live.js) |
| 7 | Reach the mix controls during a sample preview or instrument edit | **Passed on both formats.** Gain, Mute, Solo and named insert Bypass were reachable with split or expanded detail, an offscreen strip and the keyboard open. Mute brought both the final meter and sampled browser PCM to zero. Unmute restored audio within the same preview gesture, with Instruments running or stopped. Duplicate, nested, Master and ineligible inserts addressed the expected instances. Master Mute left direct output audible, and muting the direct strip as well produced silence. [Mixer comparisons](../../frontend/tests/performance/verify-mix-comparison.js) · [Direct output](../../frontend/tests/performance/verify-workspace-mix.js) |

## Production rechecks of the release blockers

### First Manual pad launch after a cold preview

With Instruments stopped in **UX Baseline Legacy**, the replay held the pad 3 speaker on **Manual lead**, waited for the engine to confirm the preview, then pressed Escape and released the speaker. It switched to **Launch pads**, selected pad 1, pressed device **Play** and clicked pad 2 as soon as pad 1 showed as sounding. The test inserted no wait for a later cycle.

On three consecutive runs, Live selected pad 2, showed it queued while the engine still reported pad 1 active, then showed pad 2 sounding when the engine switched. Each run used one launch click. Previously the first click could move only the editing selection. Sequencer markers rendered during the preview could arrive after the acknowledgement for Device Play. The browser now checks the session’s source transport revision before applying those markers. The regression also delivers an older status reply and verifies that a current stop still works. [Production replay](perform-workflow-release-probes.js) · [Runtime regression](../../frontend/src/hooks/useSequencerRuntimeController.test.tsx)

### Editing at 640 × 360 with the keyboard and a long error

The production replay opened a melodic occurrence in each format, opened **Keyboard** and intercepted **Save Performance** with a 503 response containing a 3,142-character storage message. It opened the message from the status bar, paged to the final line, closed it with Escape and verified that focus returned to the disclosure. It then scrolled inside the editor, clicked **HOLD** on step 3 and reversed the edit with Enter. The replay also hit-tested the step control, **Back to overview**, song **Play** and a piano key.

| Measure at 640 × 360 | Earlier build with error | Fixed clip editor | Fixed legacy editor |
| --- | ---: | ---: | ---: |
| Working pane | 37.8 px | 97.4 px | 97.4 px |
| Editor content | 12 px | 97.4 px | 97.4 px |
| Document size | 640 × 360 | 640 × 360 | 640 × 360 |
| Window scroll, both axes | 0 px | 0 px | 0 px |

The editor kept the same height before the error appeared, with its summary visible and with the full message expanded. In both formats, English and Spanish retained 97.4 px. German and French retained 70.9 px with their longer toolbar labels. The toolbar, transport, error disclosure and playback checkbox passed the hit tests in all four languages. [Earlier screenshot](release-arrange-short-error.png) · [Fixed editor with step 3 held](../../screenshots/perform-arrange-short-error.png)

## Browser bounds, audio and persistence

The ordinary production entry was checked with both saved songs in all three views at **1440 × 900, 1280 × 720, 736 × 720, 390 × 844 and 640 × 360**. Document width and height matched the viewport, with zero horizontal or vertical window offset in all 30 combinations. The Inspector was toggled at each size. The instrumented build repeated the matrix with the keyboard, a long error, open editors and the Inspector or drawer. Real **200% Chrome zoom** changed the CSS viewport from 1440 × 900 to 720 × 450 and device pixel ratio from 1 to 2. All six song/view combinations remained bounded. Touch input was emulated. [Measurements by format and view](perform-workflow-release-results.json)

Navigation issued zero worker sequencer commands and zero HTTP sequencer writes during continuing song playback. In both formats, pure navigation and a held speaker preview preserved the authored configuration. Song Stop returned the cursor to zero after the audio queue drained. An injected preparation failure retained the edited tempo and running transport, navigation issued no retry, and the next deliberate edit succeeded. The legacy fallback build opened and edited a legacy occurrence and reopened a saved clip song.

Native export/import, a failed Save followed by a successful retry, and reload preserved the authored snapshots, including array order. The saved clip used config v23 and the legacy song used v22. The two baseline songs and two edited legacy exports each rendered in MIDI and SCORE modes to finite stereo 48 kHz float audio. Note channels, pitches, velocities, starts and durations matched within each pair. Re-rendering identical CSD files also produced different PCM hashes on some runs, so waveform identity was not established as a repeatable result for these fixtures.

The 46-device legacy profile added **zero underruns** in each of two 15-second samples. After three view-switch cycles, the hidden melodic editor and meters recorded zero renders while playback continued. The clip profile added **zero underruns** in each of three 30-second samples, including expanded and collapsed 16,000-beat arrangements. The browser PCM peak was 0.07466, and audio resumed after reconnect with no reported error. These are local measurements from Chrome 157 and Csound 6.18.

Frontend lint, **1,493 tests** and the production build passed. Backend lint and **3,612 tests** passed with one Starlette TestClient deprecation warning. Manual validation passed for all 63 source pages. The rebuilt English PDF has 223 pages. Rendered pages 70, 72 and 73 were inspected for the revised Live instructions, short-screen Arrange figure and adjacent page layout.

## Replay and evidence

Use the [versioned fixture archive](baseline/performance-fixtures.zip), native Csound and an isolated database and asset directory. Import legacy first, then import the clip song reusing the same patches. The [browser replay instructions](../../frontend/tests/performance/README.md) describe the workspace harness, sample fixtures and profiling entry points. The production checks loaded the compiled app through FastAPI. Fixture extensions, saves, injected failures and browser profiles were confined to the disposable release environment.

To rerun the two blocker regressions, open the production app in an isolated English Playwright CLI session with those songs already in its disposable library. The [production probes](perform-workflow-release-probes.js) return a top-level `pass` and separate results for pad selection, queue, sounding pad, error access, step editing, control reachability and document bounds. Check the returned booleans as well as the process exit status. The Save request used to produce the error is intercepted before storage.

```sh
playwright-cli --raw run-code --filename specifications/redesign-user-experience/perform-workflow-release-probes.js
```
