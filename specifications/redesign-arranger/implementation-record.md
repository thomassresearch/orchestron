# Integrated preview implementation record

Date: 2026-11-03. Baseline: `d82c682`. Status: integrated, opt-in development preview; **not default-cutover acceptance**. This record supplements the original six task definitions rather than marking unperformed checks complete.

## Activation and compatibility

Start the frontend with `VITE_CLIP_ARRANGER=1 npm --prefix frontend run dev`. New performances then receive an empty clip model and one fixed keyboard. The compatibility view offers explicit conversion and downloads the original configuration before applying it. Existing Manual-pad sources, Live-clock arpeggiators and multiple-keyboard performances remain in the compatibility view with conversion reasons. This restriction applies to automatic migration; a new clip arpeggiator retains its legitimate Arranger/Live clock control.

The flag is off by default. Saved clip performances always open through the clip-capable reader/editor, including when the flag is off; they cannot silently fall through to legacy writing. Restoration uses the downloaded original, not an invented downgrade of the new model. No production database, user examples or original performance files were modified during verification. Actual audio verification used an isolated temporary SQLite database and versioned test patches. Nothing was published through Sites.

## Implementation decisions adopted

These are engineering decisions taken under the specification's proposed contracts, not a claim of separate user sign-off.

| Area | Implemented contract |
| --- | --- |
| Versions | Performance v23 and app state v5 when `clipArrangement` exists; otherwise existing v22/v4 writers. Readers accept prior supported versions. Native envelope unchanged. Clip model carries version 1; compact clip history writes version 2 and reads versions 1–2. |
| Time | Integer 20,160 ticks per quarter note, exact rational source timing. Clip start/length/source offset are independent of native content duration. UI positions use master beats. |
| Hierarchy | Stable IDs for definitions, clip windows and child occurrences; patterns, groups containing patterns/rests, supergroups containing groups/patterns/rests. No cycles or cross-lane references. Unused definitions remain saved. |
| Bounds | At most 72 lanes, 512 definitions per lane, 256 children per container, 2,048 clips per lane and 65,536 resolved leaves per content traversal. Tick bound is one million quarter notes. Backend musical validators also apply. |
| Windows | Same-lane overlaps reject atomically. Once leaves silence after content ends; Loop repeats within a fixed window. Left trim maintains source phase. Fit is explicit. Remove clip leaves a gap and retains definitions. |
| Sharing | All-linked save updates the definition revision. Local save copies the selected definition and only necessary shared ancestors. Child occurrence IDs distinguish duplicate uses. One generated repeat is isolated into before/edited/after windows in one transaction. |
| Drafts | Session-only definitions, staged child definitions, selected occurrence paths and revision/fingerprint conflict checks. Real musical editors project the selected draft into their existing pad adapter. Save/cancel never leaks draft payload into authored state. |
| History | Up to 25 atomic clip transactions; reversible field/tail changes and one current-state basis, validated across the full undo/redo chain before use. Source topology creation/removal clears clip history because device objects are outside those snapshots. Editor-local score history is keyed by occurrence context. |
| Source ownership | One foreground editor audition replaces its lane. Song Play/Stop/seek preserves it. Stop edit restores authored playback at current song position, or silence while stopped. Existing quantization, preparation and browser-clock infrastructure remain in charge. |
| Human inputs | Existing keyboard and manual controllers below arranger/editor, full-width rows. Fixed keyboard cannot be added/removed in the new path. Existing Start/Stop and Auto/Live/Listening policy remain. |
| Migration | Deterministic pattern/group/supergroup conversion, explicit rests, colors and unused definitions retained. Legacy repeating lanes retain an independent cycle; an explicit operation materializes their repeats across the current song extent. Unsupported independent-source cases do not silently convert. |
| CLI | Normalize/round-trip/runtime/export support v23. Legacy source/pad mutation commands reject clip performances before writing; they do not edit obsolete shadow data. Mixer/routing operations remain separate. |

## Delivered source seams

- [Clip domain](../../frontend/src/lib/clipArranger/model.ts), [operations](../../frontend/src/lib/clipArranger/operations.ts), [migration](../../frontend/src/lib/clipArranger/migration.ts), [runtime projection](../../frontend/src/lib/clipArranger/runtime.ts): fixed windows, exact resolution, reusable references, range copy/paste/insert/close, cycle conversion and scope/history transactions.
- [Store actions](../../frontend/src/store/clipActions.ts), [existing edit adapter](../../frontend/src/store/sequencerEdits.ts), [persistence](../../frontend/src/store/appStoreModel.ts): draft separation, existing factories/defaults, source creation/removal, save/load/app-state integration and version guards.
- [Arranger](../../frontend/src/components/clipArranger/ClipArranger.tsx), [contextual integration](../../frontend/src/components/clipArranger/ClipPerformance.tsx), [previews](../../frontend/src/components/clipArranger/PatternPreview.tsx), [scope dialog](../../frontend/src/components/clipArranger/SaveScopeDialog.tsx): compact lanes, expanded nesting, window edits, shared scope and real editor hosting.
- [Inline curve](../../frontend/src/components/clipArranger/InlineCurve.tsx) uses [the production curve editor](../../frontend/src/components/sequencer/ControllerSequencerCurveEditor.tsx), including independent endpoints and snapping. Numeric point controls and cropped source coordinates share its draft. Component instance IDs prevent duplicate SVG gradient IDs when both editor views are mounted.
- [Performance shell](../../frontend/src/components/SequencerPage.tsx), [Score](../../frontend/src/components/sequencer/ScoreSequencers.tsx) and [Arpeggiator](../../frontend/src/components/sequencer/ArpeggiatorEditor.tsx): contextual wrappers replace the old pad workspace/source controls only. Existing musical controls, live input components, rack, mixer and instrument settings remain.
- [Authored validator](../../backend/app/models/clip_validation.py), [runtime schedule](../../backend/app/models/clip_arrangement.py), [clip playback](../../backend/app/services/clip_playback.py), [source transport](../../backend/app/services/sequencer_source_transport.py): bounded validation, lazy schedule lookup, exact source phase, owned-note boundaries and audition restoration.
- [Standalone CLI projection](../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_arrangement.py): no backend package dependency; same authored/runtime schedule representation. Existing exports retain rack, routing, mixer and instrument ownership rules.

## Verification evidence

### Automated checks

| Check | Result |
| --- | --- |
| `npm --prefix frontend run check` | Lint, 92 test files / 957 tests, TypeScript and production build passed. |
| Clip domain/store/component tests | Exact timing across supported ratios; offsets/crops/partial repeats; local ancestor forks and duplicate children; fixed windows on shared duration changes; history/range edits; source creation/removal; real melodic/curve draft capture; local-default scope and cancel; undo-branch conflict rejection. |
| Backend clip suite + clip API cases | 21 passed. Exact window scheduling; lazy long loops; >8 definitions; score chase/crop; controller gaps; song/audition coexistence including Live-clock arp; save/read/malformed-write rejection; native bundle round trip; both CSD modes preserve cropped score sustain. |
| Full backend suite | 2,637 passed, 3 failed in saxophone signal tests. The complete saxophone suite passed in an isolated rerun (22 passed). The full run is recorded as having failures, not green. New/updated clip API regressions passed separately. |
| Performance CLI suite | 344 passed, including >8-definition round trips and rejection of legacy pad mutation before any write. |
| `make backend-check` | Passed (Ruff). |
| Runtime benchmarks | Completed render ratio, boundary and score benchmarks; results below. No matched pre-change dense-clip baseline was captured, so these numbers are not a no-regression claim. |
| Preparation benchmark | Completed cold/cached/one-pad compiler-process measurements using versioned fixtures. |

Reproducible targeted checks:

```sh
.venv/bin/pytest backend/tests/test_clip_arrangement.py backend/tests/test_api.py -k clip_ -q
PYTHONPATH=integrations/skills/orchestron-performance-creator/src \
  .venv/bin/pytest integrations/skills/orchestron-performance-creator/tests -q
make benchmark-runtime
.venv/bin/python -m backend.tools.benchmark_sequencer_preparation
```

Measured runtime render/audio ratios (median) were 0.002/0.005/0.007 at 16/64/128 tracks. Boundary processing medians were 0.034/0.123/0.241 ms; corresponding maxima were 0.047/0.146/0.273 ms. Controller preparation cold/cached/one-pad medians were 4.013/0.156/0.942 ms; compiler-process round-trip medians were 25.631/21.099/21.101 ms. These are local machine samples, not throughput guarantees.

### Actual browser and audio checks

The production app was served against an isolated FastAPI/Csound instance, with a fixture-derived nested performance and a versioned test instrument. Play song automatically started instruments, opened the browser-clock PCM WebSocket and produced nonzero rendered audio. Play edit used the actual melodic editor/runtime. Song Play/Stop left editor audition active; Stop edit ended it. The existing manual-controller Start/Stop and keyboard Stop controls were also exercised; instruments were stopped after verification. This is actual engine/browser integration, distinct from the UI-only harness and deterministic MIDI event tests. It is not a subjective listening assessment or a hardware MIDI test.

The UI harness at `frontend/tests/performance/clip-arranger.html` uses production components and a versioned performance fixture. It is for reproducible layout/interaction inspection, not simulated evidence of audio correctness. Screenshots show compact lanes, expanded supergroup/group/pattern containment, the contextual editor, scope choices and input rows. Native save/add dialogs support Escape and focus restoration. A 600-pixel viewport review exposed an inline-curve sizing issue, which was fixed. Cropped pointer verification also exposed stale SVG resize coordinates; a regression test now proves a visible midpoint in the 50–100% crop adds a point at source position 75%, including the short inline height. The English manual PDF was rebuilt (54 source documents collected, 195 PDF pages); preview pages 31–34 were rendered and visually inspected. Markdown links and `git diff --check` pass. See the [user guide](../../documentation/performance/clip_arranger_preview.md).

## Remaining gates before default cutover

The preview is deliberately not marked fully accepted. The following work is still required by the six-task plan:

1. **Container audition capacity and exact rests:** the existing audition protocol accepts up to 256 tokens and whole local-beat rest tokens. Clip scheduling itself accepts exact tick rests and larger bounded hierarchies. A container with fractional local-beat rests or more audition tokens needs an explicit clip-aware audition payload; currently it reports failure rather than approximating timing. Audition also needs capacity reserved when a lane already reaches the definition limit.
2. **Complete preservation/migration matrix:** exercise every musical control through each contextual editor, including drummer row topology, score hidden notes/local undo, arpeggiator presets/seeds and controller modes, followed by all round trips. Existing source components and regression suites remain, but that is not proof of the entire new interaction matrix. Rehearse downloaded-original restoration across legacy fixture categories.
3. **Transport/input stress:** deliberate failed preparation, rapid switching/cancellation, reconnect, finite end/selected loops, independently started engine ownership, sustain/held-note removal and actual external MIDI hardware alongside song/editor playback. Existing tests and the actual playback smoke test cover a subset.
4. **Dense/responsive/accessibility acceptance:** compare nested preview and preparation costs to a matched baseline; review narrow widths, text zoom, all dialogs, labels/help in EN/DE/FR/ES, coarse pointers and screen-reader descriptions. Rendering filters offscreen clips and nested preview content, but traversal and lower zoom need measured limits.
5. **Full-suite stability and release review:** resolve/reproduce the full-run saxophone signal failures and rerun affected checks. Default activation must follow G1–G6 acceptance, not merely the presence of the new UI.

These are concrete release blockers/verification gaps. Keep the gate off while addressing them. Retain format readers and original backups even if UI activation is rolled back. No dead-code cleanup or publication is part of this preview delivery.

## Drummer clip regression fix (2026-11-03)

The first interactive drummer report exposed an adapter error: spreading the pattern payload onto the track replaced `{ id, key }` track rows with `{ rowId, steps }` pad rows. The editor then displayed empty keys, addressed multiple cells with the same missing row ID, and emitted duplicate `drumrow:<track>:undefined` runtime IDs. The clip editor now projects only drummer length/step-count mirrors; track row identities and MIDI keys stay on the track, and per-row hits stay in the selected pattern draft.

Regression coverage follows the reported workflow: add a drummer clip, select keys 35 and 38, remove the other rows, toggle independent hits, change one velocity, construct the actual audition/runtime requests, save using each scope, and reload. Both source IDs and drum notes survive. A related bootstrap correction preserves app-state v5 when a clip performance needs a legacy mixer migration; that path previously attempted a v4 write and could receive another 422.

Verification: 960 frontend tests passed, followed by a successful TypeScript/production build and Docker `frontend-build` with `VITE_CLIP_ARRANGER=1`. The final fixture metadata correction was checked again with the 13 focused store tests. In the isolated production browser/Csound session, the reported key/delete/toggle sequence succeeded, Play edit submitted two distinct row IDs and received HTTP 200, and Csound rendered nonzero audio. Stop edit, scoped Save, v5 autosave and browser reload also succeeded. No user Docker database was accessed or changed. The intended editor layout and musical controls are unchanged by this fix.

## Clip transport and uninterrupted audition (2026-11-03)

The clip arranger now displays the runtime's mapped song position instead of the continuously advancing shared audio clock. The selected-window loop has an amber button and ruler range; selecting a newly created clip enables that control immediately. Seeking preserves the loop, and sub-beat clip boundaries survive configuration snapshots and reloads without rounding to whole beats. The existing tape icons are shared with the preview: rewind/forward move one beat, Play resumes, Pause holds position, and Stop resets to the loop start or song start. Song transport remains independent of editor audition.

Untouched Play edit dropouts were reproduced using an explicitly authorized local copy of the reported performance and its instruments. The original Docker app was read but never modified. After the finite song ended, inactive peer tracks scheduled their next silent boundary one musical tick later and changed their source origin on every tick. This generated tens of thousands of transport markers per second, saturated JSON serialization and starved browser-clock PCM. Silent spans now have a stable source origin; after a finite schedule ends, there is no next clip boundary. Cyclic lanes retain their next-cycle boundary. Note lookahead, controller playback and arpeggiator scheduling handle the absent boundary consistently. Play edit also waits for an in-flight arranger engine stop before deciding whether to reuse or start instruments.

Verification covers the following:

- Store regressions edit melodic notes/chords/velocity/timing, sparse score notes, controller steps/curves and arpeggiator parameters through the actual draft adapters, construct audition requests, save with both scopes, then serialize/reload and compare linked occurrences. Existing drummer row-identity and both-scope regressions remain.
- Component/hook regressions cover the mapped song cursor, visible loop toggling, new-clip selection, tape actions, unchanged audition during transport updates, coalesced musical edits and Stop/Play edit startup ordering.
- The complete frontend check passed lint, 975 tests in 92 files, TypeScript and the production build, including stopped/running seeks to fractional song ends. A separate Docker image built successfully with `VITE_CLIP_ARRANGER=1`, including the compiled Linux Cython backend; the user's running container was not replaced.
- Backend service regressions cover stable gaps and finite ends, bounded audition markers with inactive note/score/controller peers, and ended arpeggiator clips in both clock modes. A browser-clock API regression renders beyond the finite song while audition continues and bounds transport-message volume. The targeted service suite passed 168 tests, the clip/audition/browser-clock API subset passed 9, and all 23 clip tests also passed with the Python implementation. Ruff passed.
- The production browser and compiled Csound/Cython runtime reproduced thousands of underruns before the fix. Afterward, the copied drum pattern ran for 170 seconds with zero underruns; the melodic pattern ran alone for 55 seconds and then alongside looping song playback with zero underruns. Render/audio ratios were approximately 0.17–0.19, with a healthy PCM queue. The displayed cursor wrapped within the 16-beat clip, song Stop reset it to zero while preserving audition, and Stop edit shut down its owned engine. These are measured integration checks, not subjective listening or external MIDI hardware tests.
- Browser checks also exercised score, controller and arpeggiator editor playback requests, scoped saves, autosave and reload. The screenshot uses versioned fixtures, not the copied private performance. README, EN/DE/FR/ES help and the English manual describe the transport controls and the distinction between song-window and clip-content looping. The manual PDF was rebuilt from 54 documents (195 pages), and its updated screenshot page was visually checked. Local Markdown links and `git diff --check` passed. The temporary performance snapshot and test database were removed after verification.

The broader default-cutover gates above remain open; these fixes do not claim completion of every musical-control, migration or hardware-input case.

### Restored loop toggle follow-up

A browser reproduction exposed a missing selection after reload: the loop bounds were persisted, but the selected clip was session-only. The first click turned the loaded loop off; with neither an active loop nor a selected clip, the button became disabled. Subsequent Play/Stop/Rewind could not restore it. The arranger now selects a matching clip when restoring loop bounds, while retaining compact tracks and leaving the editor closed. An existing selection or editor target takes precedence. Regression coverage checks repeated off/on toggles around transport updates without opening an editor.

Verification: 976 frontend tests, lint, TypeScript, production build and Docker frontend build passed. The isolated production app reproduced the disabled button before the fix and passed reload → loop off → Play → Stop → Rewind → loop on, plus repeated toggles, afterward. The screenshot and manual describe the restored selection; no Docker performance data was accessed for this follow-up.

### Loading with looping off and explicit song end

The next report exposed the case missed above: loading with looping already off has no saved loop bounds from which to recover selection. The arranger now chooses a matching saved-loop clip, otherwise a clip under the cursor, otherwise the earliest clip. It retains valid selections, compact lanes and a closed editor. An empty arrangement still has no clip-loop target.

A read-only inspection of the reported Docker arrangement found two clips ending at 16 master beats and a saved song end at 19.25. Playback was honoring the saved trailing silence. Preserve that authored extent rather than silently truncating rests: the UI now exposes Song end, a dashed end marker and an explicit Fit song to clips action. Both numeric and fit edits use existing validation, undo/history, runtime recompilation and persistence. Values before the last clip are rejected. Labels and help cover EN/DE/FR/ES, and the manual explains master-beat units versus ruler bar/beat labels.

Verification: 978 frontend tests passed, including loaded-off toggling, explicit 19.25 → 16 fitting, playback-bound compilation, undo, invalid shortening and reload. In the isolated production app, the equivalent fixture loaded with looping off and an enabled toggle; after fitting, playback stopped at Position 16, and the new end survived reload. Stop/Rewind and repeated loop toggles also passed. The original Docker arrangement was not modified.

### Play edit playback highlighting

The contextual editor received authored sequencer state without the runtime overlay, so the existing melodic/drummer/controller highlight checks saw playback as stopped; score origins and arpeggiator status were also absent. `ClipPerformance` now merges the live runtime into the editor input before applying the draft pad adapter. Arrangement operations still read authored state, and transport updates do not alter drafts or resubmit auditions.

Regression coverage renders the production melodic, drummer and controller step editors, starts Play edit, advances runtime markers with a nonzero pattern origin while the song cursor stays stationary, and verifies highlight movement and clearing on Stop edit. Additional cases cover score runtime origins and arpeggiator live notes/step status while retaining the draft target. All 983 frontend tests passed; lint and the final TypeScript/production build passed. The focused five tests were rerun after correcting the test status type.

A real browser against the isolated local repository drum fixture confirmed advancing highlights during standalone audition (song Position 0), during looping song playback, across the pattern wrap, and clearing after stopping. No private Docker performance data was changed. Updated the README, EN/DE/FR/ES integrated help, preview manual, playback screenshot and generated English PDF.

### Complete Play edit and persistence matrix (2026-11-04)

Expanded playback checks to melodic, drummer, score, controller step, controller curve and arpeggiator editors. The component regression matrix exercises actual editor controls and scoped-save dialogs, verifies audition content and moving/cleared indicators before saving, after each scope, and after a serialized performance reload. It also verifies that local saves preserve a second linked occurrence, all-occurrence saves update it, and runtime markers never mutate authored state or trigger another audition request.

The expanded checks exposed three issues, now corrected:

- Arpeggiator runtime slots refer to arrangement definitions (including the temporary audition definition), whereas its existing editor displays synthetic pad zero. The editor now maps the matching saved/audition slot to that displayed pad and suppresses highlights for other definitions or a waiting-for-notes status.
- An arpeggiator audition can play while its authored enable switch is off. Automatic idle-clock shutdown now respects active auditions instead of immediately stopping that source.
- Starting Play edit after reloading can replace the stopped audio session. Session cleanup previously invalidated the pending workspace request, leaving an Auditioning label without a backend audition. An unbound request survives its own startup within the same workspace generation; real performance/transport changes still invalidate stale work. A deferred-start regression covers replacement both with and without reload.

Verification: all 998 frontend tests across 93 files, ESLint, TypeScript and the production build passed with `VITE_CLIP_ARRANGER=1`. The isolated production browser/Csound app passed all six initial playback cases and all twelve save-scope/reload cases. Each case sampled five distinct visible playback positions; arpeggiators received a C/E/G chord on their input channel. The saved fixture database independently confirmed edited values and linked-occurrence behavior for every scope/type pair. These were runtime/indicator checks using versioned repository fixtures, not subjective listening or external MIDI hardware testing. No user Docker performance data was accessed or modified.

Updated README, EN/DE/FR/ES help and the English preview guide. Added the arpeggiator playback screenshot, rebuilt the manual (196 pages), and visually checked the updated text and screenshot pages. Separate fixture performances per case keep the large legacy-pad test fixture's undo snapshots within existing persistence limits; production limits were unchanged. The user's running Docker container was not rebuilt or restarted.


### Compact clip history persistence (2026-11-04)

Clip history version 1 duplicated the whole arrangement before and after every edit. A simple drum/melodic/controller performance reached the 8 MiB persistence limit with 25 entries. Version 2 retains one current arrangement basis for external-edit detection and reversible field changes, with tail splices for array growth/shrinkage. Unchanged patterns and inactive cells are no longer repeated per action. Performance v23, app-state v5, clip-model v1 and native bundle envelope versions remain unchanged; older preview clients can still load the music but discard the unrecognized optional history.

The loader validates every transition on both sides of the cursor and converts contiguous v1 snapshots, preserving all 25 entries and the cursor. Save and autosave also convert old histories still held in memory. Invalid/stale metadata is discarded without discarding the authored music. Track topology changes retain their existing history-reset behavior. The 8 MiB backend limits are unchanged, as are the retained legacy pad datasets and all hidden/unused musical content.

Regression coverage exercises 25 mixed drum/controller/timeline edits against a fixture whose old history exceeds 8 MiB; save/autosave reload, complete undo/redo, legacy cursors, eviction/branching, optional fields, array edits, malformed history and external conflicts. API coverage checks exact preservation through save/update/load, app state and native bundle export/import. A temporary read-only copy of the reported state shrank from 8,484,969 to 1,165,414 bytes; its 25-entry history shrank from 7,594,304 to 274,877 bytes, with full undo/redo equivalence. No production data was modified.

Verification: all 1,005 frontend tests in 94 files, ESLint, TypeScript and the production build passed. Six targeted API tests passed, including the new compact-history persistence/bundle case and existing size-limit guards; Ruff passed for the API tests. Both reconstructed user payloads passed the backend schemas and unchanged persistence limits. The English manual was rebuilt (196 pages) and the updated page was visually checked; modified Markdown links and `git diff --check` passed. Temporary copies of private state were removed. The running Docker container was not rebuilt or restarted.

### Direct content manipulation (2026-11-04)

Added an occurrence-aware structural transaction layer and session-only draft store. The expanded timeline supports sibling range selection, grouping/supergrouping, linked/variation insertion through a searchable picker, pointer moves within and between compatible containers, and keyboard move controls. The root Content inspector selects the same timeline occurrences. Musical editors and their existing container editor remain available through double-click.

Local saves fork changed definitions and ancestors; all-linked saves update affected definitions and reject contradictory occurrence-specific edits. Empty shared container occurrences can be removed while retaining their reusable definitions. Structural saves stop editor audition, protect intersecting musical drafts, validate the complete candidate, and create one compact arranger-history entry. Unsaved structure never enters saved configuration or audio preparation.

Growth uses integer-rational phase/span scaling for loops, retains trailing space on shortening, expands Song end when necessary and rejects overlapping windows atomically. A local pass is isolated with its following generated portions shifted, while independent clips keep their starts. The saved performance/API versions are unchanged.

Verification includes pure operation tests for collisions, local pass splitting, shared growth, empty containers, fractional phases, conflicting shared edits and no-op moves; UI tests exercise grouping/reordering with both scopes, snapshot reload and undo/redo for melodic, score, drummer, controller step/curve and arpeggiator tracks. Existing Play edit/highlighting tests remain part of the full suite. Real-browser fixture checks exercised Shift-click grouping, pointer reordering, cross-container dragging, all-linked save, and API persistence/reload. The captured screenshot uses repository fixtures, not user performance data.

Final checks: 1,035 frontend tests in 98 files passed with the clip preview enabled, followed by ESLint, TypeScript and a production build. The 12-case structural UI matrix covers both save scopes for all six editor variants, snapshot reload and two-step undo/redo. The English manual was rebuilt from 54 source documents (198 pages); its new screenshot page was visually checked. Updated Markdown links and `git diff --check` passed. The isolated browser/backend were stopped after verification. The user's Docker container was not rebuilt or restarted.
