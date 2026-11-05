# Acceptance implementation follow-up — 2026-11-05

Baseline: `6764027` (the prioritized review). This change implements the confirmed
runtime gaps and adds acceptance coverage. Default activation remains off. The
[original audit](remaining-work-review.md) is historical; use the status below for
what this follow-up actually closes.

## Delivered

- Every clip model uses an exact audition schedule, including fractional rests and
  hierarchies exceeding 256 leaves. The saved model/version is untouched.
- A runtime-only bank reserves slots 512–1023 for audition payloads. Authored
  definitions remain capped at 512. Extra slots must be referenced by an audition
  schedule and are forbidden in the song schedule. Temporary frontend headroom is
  limited to the auditioned lane; unrelated staged additions are omitted. Draft
  trees exceeding their own budget fail before runtime preparation.
- Standalone arpeggiator configuration updates now carry the same audition schedule
  as combined sequencer updates, retaining exact timing and reserved-slot validity.
- Transport buttons wrap at narrow widths/enlarged text. Browser measurement found
  450 px page overflow at a 390 px viewport and 200% text before this fix; the same
  matrix now measures 390 px, with all transport actions retained. A subsequent touch check exposed sticky
  headers covering the timeline at 200% text; headers now use the same bounded
  CSS-pixel width as timeline calculations and wrap their controls. The
  transposition fieldset/header also wrap without horizontal dialog overflow.
- Recovery/preservation tests cover versioned legacy fixtures, nested shared groups,
  colors, cycles, native round trips, original-config restoration, rejection of
  Manual sources/Live arps/multiple keyboards, hidden notes/hits, ratchet ramps,
  controller null/zero/endpoints, arpeggiator seeds and preset metadata. Both save
  scopes preserve payloads and distinguish linked occurrences.
- Live/export event comparisons now include melodic, drummer, score and controller
  sources in both MIDI and SCORE modes. Four additional real render-clock/router
  cases compare chord-fed arpeggiators with hold on/off and ascending/seeded-random
  patterns against both export modes.

## Verification

| Check | Result |
| --- | --- |
| Full frontend check | 114 files / 1,320 tests, ESLint, TypeScript and production build passed after all production changes. The 10 migration tests passed again after strengthening routing/mixer assertions. |
| Backend changed clip/API/export set | 55 passed, including native capacity audition and every source's runtime-slot validation; the expanded live/export parity file subsequently passed all eight tests. |
| Explicit Python playback implementation | 88 clip/transposition/export tests passed. Default implementation is also covered by the targeted/full runs. No shared playback-kernel source changed. |
| Native Csound/browser-clock regression | 20 seconds of rendered audio at capacity: nonzero finite PCM before/after deliberately failed preparation, bounded markers after finite song end, then silence after Stop edit and release tails. This is accelerated protocol/render verification, not 20 wall-clock seconds of browser speaker playback. |
| Performance Creator | All 370 tests passed. |
| Full backend run | **Final: 2,750 passed, one saxophone tuning assertion failed** (`test_normal_register_is_tuned_and_releases_cleanly[32]`, note 48: 21.57 cents versus 15 allowed). An earlier full run had 2,743 passes/one other saxophone acoustic failure. Two earlier clean-HEAD isolated saxophone runs each passed 22. This change does not fix the saxophone or make the full suite green. |
| Backend lint | Ruff passed. The Make target later hit a sandboxed uv-cache access error; the equivalent installed `.venv/bin/ruff` check passed. |
| Documentation | English PDF rebuilt from 55 documents (216 pages); updated pages 31 and 36–37 rendered and inspected. README and EN/DE/FR/ES help updated. |

Separate saxophone test/fixture edits appeared in the shared workspace between
the two full runs. They are not part of this implementation and were not overwritten.
The final run includes the workspace state at collection; the newly expanded
arpeggiator parity cases were also run separately.

### Browser and recovery evidence

The isolated fixture browser used production React components without production
persistence or audio. A real click on the migration button downloaded the recovery
JSON and created clip model v1. Applying that file through the same store reader
used by raw-config Import restored equal configuration contents. Property order was
ignored. This verifies GUI download plus the recovery reader, not every full-App
import-dialog interaction or recovery on a different instrument library.

The profiling fixture initially left stale legacy sequence mirrors after manually
adding nested groups. Its harness now compiles those mirrors before conversion;
this was a fixture correction, not a production migration change. The new
[recovery driver](../../frontend/tests/performance/verify-clip-recovery.js) reproduces
this check with a fresh browser context and `VITE_CLIP_ARRANGER=1`.

At 1440/520/390 px and normal/200% text, the page has no horizontal overflow and
track headers occupy at most 45% of the timeline viewport (capped at 192 px). All
four UI languages fit at 390 px/200%. Emulated coarse-pointer taps open the
transposition dialog; its 12 exposed controls have accessible names, its content
fits its 318 px client width, Escape closes it and focus returns to the trigger.
Keyboard Enter activation also passed. A stable scrollbar gutter was enabled.
These are browser accessibility-tree/touch checks, not native screen-reader or
OS scrollbar certification. [Final responsive/recovery data](measurements/2026-11-05-responsive.json).
See the [narrow screenshot](../../screenshots/clip-arranger-acceptance-narrow.png)
and [text-zoom screenshot](../../screenshots/clip-arranger-text-zoom.png).

The [measurement driver](../../frontend/tests/performance/measure-clip-arranger.js)
compares 16 and 16,000 beats in collapsed/expanded views. Observed two-frame settle
samples were 14.88/26.72 ms collapsed and 17.59/26.57 ms expanded; document nodes stayed
between 449 and 752. These are single local development-build samples, not a
matched pre-redesign production baseline. The separate audio run below checks
continuity with this GUI mounted.
[Raw layout/locale/preparation data](measurements/2026-11-05-acceptance.json).

Render/audio medians at 16/64/128 tracks were 0.002/0.004/0.007; boundary medians
0.034/0.123/0.244 ms. Preparation cold/cached/one-pad medians were
3.900/0.157/0.907 ms; process round trips 25.661/20.465/20.323 ms. The Make benchmark
target hit the same uv-cache sandbox restriction; its three modules were run
sequentially with the installed Python instead. Retained raw [render](measurements/2026-11-05-render.csv),
[boundary](measurements/2026-11-05-boundary.csv) and [score](measurements/2026-11-05-score.json)
results are machine observations, not release thresholds.

### Real browser audio

The opt-in [audio harness](../../frontend/tests/performance/clip-audio.js) uses the
production Worker, SharedArrayBuffer and AudioWorklet with native Csound and a
versioned voice. It reserves pad 512 for a draft with an exact one-tick rest, while
the real nested arranger renders 16 or 16,000 beats. Each of compact, expanded and
collapsed states ran for 30 wall-clock seconds after warm-up. All three recorded
zero new underruns/overruns, finite nonzero PCM (peak 0.0747) and no client errors.
Main-thread task totals were 1.75/2.50/1.65 seconds per 30-second sample. Four draft
pitch updates, audition start/end/cancel, beat seek and disconnect/reconnect
completed; playback returned live with nonzero PCM and no underruns. The earlier
run under concurrent backend-test load also passed. These are local paired GUI
samples with one sounding voice, not maximum-polyphony or subjective listening
certification. [Raw final measurement](measurements/2026-11-05-browser-audio.json).

### Editor preservation evidence reused

| Capability | Evidence |
| --- | --- |
| All source adapters, contextual playback, both save scopes/reload | `ClipPlaybackHighlight.test.tsx`, `clipActions.test.ts`, new `migration.test.ts` |
| Drummer hidden/inactive hits and ratchet ramps | `drummerRatchets.test.ts`, new scoped migration cases, backend drummer timing tests |
| Score hidden notes, local undo, selection/clipboard/collapse, keyboard ownership | `ScoreEditor.test.tsx`, `useScoreKeyboardPreview.test.tsx`, contextual playback matrix |
| Controller Curve/Step datasets, reset values, endpoints and channels | `controllerSteps.test.ts`, both controller editor suites, `automationActions.test.ts`, new scoped migration cases |
| Arpeggiator presets, seed, selected pad/input/hold | `ArpeggiatorEditor.test.tsx`, `test_arpeggiator_patterns.py`, new scoped migration and chord/export parity cases |
| Draft/structural conflicts, cancellation, atomic history | `structuralDraftResolution.test.ts`, `ContainerStructure.test.tsx`, `history.test.ts` |

The full frontend/backend runs exercise these existing suites. No musical editor
was replaced or simplified as part of the fixes.

## Remaining release acceptance

| Original priority | Disposition |
| --- | --- |
| P1 exact audition + headroom | Implemented, with frontend/backend/API and real-engine regressions. |
| P1 migration/recovery | Core legacy-category matrix and actual browser download/recovery-reader rehearsal passed, including nonempty routing/mixer round trips. Raw backup recovery is explicitly same-library; a native bundle is needed for instruments/assets on another installation. Wider historical project collections remain manual qualification. |
| P2 audio/input | Native preparation-failure regression, 90-second browser/audio run, edit/cancel/seek/reconnect, and all-source/chord-arp export comparisons passed. Longer subjective/realistic-polyphony sessions remain manual acceptance. External MIDI hardware testing is deferred and does not block release. |
| P2 editor preservation | Automated preservation matrix covered by new scoped tests plus the existing production control/highlight/undo suites mapped above. Manual user acceptance remains distinct from automated coverage. |
| P2 dense UI | Bounded-growth and paired compact/dense browser/audio measurements plus standard runtime benchmarks recorded. A matched pre-redesign production benchmark is not available; no performance improvement claim is made. |
| P2 responsive/accessibility | Transport/header/dialog text-zoom defects fixed; narrow/locale/accessibility-tree/coarse-touch/dialog-focus checks passed. Native classic-scrollbar and screen-reader review remain manual acceptance. |
| P3 default cutover | **Not enabled.** Requires manual acceptance and a green backend release check; the final full run still has the unrelated saxophone tuning failure. Dead-code cleanup is deferred until cutover review. |

### Concrete remaining manual checks

These are the outstanding human/environment checks behind the table above, not
additional implementation tasks or a request to repeat the automated matrix:

1. **Representative existing performances:** use copies of a few older real
   projects in the full app. Convert, edit, save/reload, export/import a native
   bundle, and restore the downloaded original through the actual Import dialog.
   Compare musical content, instruments, routing, mixer and controller settings.
   The fixture matrix and recovery reader already pass; this covers real project
   combinations and the complete app workflow.
2. **Listening under realistic load:** play a dense, multi-instrument performance
   for longer than the 90-second automated sample while editing/auditioning,
   seeking/looping, collapsing panels and switching views. Listen for clicks,
   dropouts, stuck notes and unexpected restarts; compare representative exports
   with live playback. Automated PCM/event checks do not provide subjective
   listening or realistic instrument/polyphony coverage.
3. **Editing workflow usability:** perform a normal arrange/edit/save session
   across the source types actually used, including local versus shared Save,
   Cancel, Undo/Redo, hidden material and the on-screen keyboard/controllers.
   This is a usability spot-check of the integrated workflow; preservation,
   scopes, controls and playback already have automated coverage.
4. **Native accessibility/platform behavior:** review the workflow with a native
   screen reader (names, order, state announcements and dialog focus), and with
   always-visible OS scrollbars (last lane, resize handles and horizontal access).
   Browser accessibility-tree, keyboard, emulated touch, text-zoom and four-language
   layout checks already pass.

Separately, the saxophone tuning assertion is an automated-suite issue, not a
manual arranger check. The recorded full backend run is still not green.

### Deferred: external MIDI

User decision, 2026-11-05: external MIDI hardware testing is **deferred and not
required for release** because it is rarely used. No hardware is available for
the current check. Revisit testing and fixes if an actual need or issue arises;
this deferral applies to G3/G5/G6 and supersedes earlier hardware-test backlog
wording. Existing external MIDI functionality remains in place.

No deployment, database migration, production performance edit or obsolete-reader
removal was performed.
