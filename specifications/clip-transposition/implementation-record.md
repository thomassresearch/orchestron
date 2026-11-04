# Clip transposition implementation record

Implemented in the clip-arranger preview on 2026-11-04. Baseline commit: `e37a079`. This change does not enable the broader clip-arranger rollout or migrate user performances automatically.

## Delivered contract

- Performance v25, app state v7, clip model v3 and runtime schedule v2 are allocated. Readers retain the earlier versions; untouched documents retain their earlier writers. Clip v3 includes instrument automation. Native envelope versions are unchanged.
- Definitions reference lane-local shared profiles. Each profile contains a default pair and sparse, exact repetition replacements. Explicit zero/equal-to-default entries survive persistence. Pattern, group and supergroup references and clip-local full paths add independent plans.
- Repetition indices are source-relative, with a preserved `repeatIndexBase` for isolated windows. Crops, seeks and lane cycles do not enumerate virtual repetitions. Transpose-only edits neither split clips nor fork musical definitions.
- The sum of all diatonic steps applies once in each leaf's configured theory, followed by the sum of semitones. Accidentals retain their distance above the lower scale tone. Only the final pitch is range-filtered. Authored payloads remain unchanged.
- Preparation builds immutable melodic/score variants and arpeggiator pitch maps outside the rendering path. Score indexes are rebuilt from untruncated source notes; strums keep their original tone spacing. Existing MIDI ownership, collisions and releases use actual output pitches.
- Live updates latch the current occurrence and any anticipated future occurrence. The next uncommitted occurrence uses the latest successful preparation. Mixed musical edits prepare the old pair against the new content. Releases retain the correct owning occurrence, including an early note followed by a configuration update. Seek/restart clears latches. Status identifies the actual pending target clip/repetition/leaf.
- Clip-aware audition freezes the selected logical index, includes all enclosing/descendant scopes, preserves exact rests and plays the full selected definition. Structural snapshots carry path remaps; subsequent transpose/structure changes require a new audition snapshot.
- The inspector offers shared, parent and placement scopes, both pitch components, default/repetition selection, explicit zero versus inheritance, reset, Save/Discard, contribution totals, affected clip names, draft comparisons, omission counts and pending-target feedback. Strings are provided in EN/DE/FR/ES. Note-map previews show effective pitch; musical editors retain source notes.
- Musical and transposition saves can form one history action. A local musical variation copies its own shared profile; automatic ancestor copies retain shared links. Structural operations preserve/remap full paths, and ungroup snapshots removed contributions at the appropriate scope. Invalid/stale/over-budget transactions fail before commit.
- Frontend projection, standalone CLI projection, persistence/native bundles and MIDI/SCORE exports honor the new representation. Temporary audition/latch/status data is excluded from authored saves.

## Source map

| Area | Implementation |
| --- | --- |
| Types, algebra, validation | [frontend domain](../../frontend/src/lib/clipArranger/transposition.ts), [authored validation](../../frontend/src/lib/clipArranger/transposeModel.ts), [backend domain](../../backend/app/models/clip_transposition.py), [backend validator](../../backend/app/models/clip_transposition_validation.py) |
| Editing, conflicts, structural remaps | [transpose commands](../../frontend/src/lib/clipArranger/transposeEdits.ts), [store actions](../../frontend/src/store/clipActions.ts), [structure](../../frontend/src/lib/clipArranger/structure.ts), [operations](../../frontend/src/lib/clipArranger/operations.ts) |
| Runtime/audition projection | [frontend adapter](../../frontend/src/lib/clipArranger/runtime.ts), [runtime schedule](../../backend/app/models/clip_arrangement.py), [preparation cache](../../backend/app/services/clip_transposition.py) |
| Playback and ownership | [shared Python/Cython kernel](../../backend/app/services/_sequencer_playback.py), [clip playback](../../backend/app/services/clip_playback.py), [runtime installation](../../backend/app/services/sequencer_runtime.py), [arpeggiators](../../backend/app/services/arpeggiator_runtime.py) |
| UI and session feedback | [inspector](../../frontend/src/components/clipArranger/TransposeInspector.tsx), [translations](../../frontend/src/components/clipArranger/transposeCopy.ts), [session status](../../frontend/src/lib/clipArranger/transposeStatus.ts) |
| Standalone CLI | [projection](../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_arrangement.py), [independent validation](../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_transposition.py) |

## Acceptance evidence

The executable tests below exercise the acceptance matrix's contracts. Scenario families share fixtures; the table does not imply that every possible combination has a separate test.

| Acceptance area | Executable evidence |
| --- | --- |
| Pitch vectors, accidentals, negative octaves, identity, range | [shared vectors](../../backend/tests/fixtures/clip_transposition/pitches.json), [TypeScript vectors](../../frontend/src/lib/clipArranger/transposition.test.ts), [Python vectors](../../backend/tests/test_clip_transposition.py); every root/mode/MIDI pitch receives identity/octave checks |
| Shared repetitions, three scopes, nested totals, no source mutation | [editing tests](../../frontend/src/lib/clipArranger/transposeEdits.test.ts), [nested authored fixture](../../backend/tests/fixtures/clip_transposition/performance.json) |
| Crops/repeat bases, forks, copied placement paths, local/all ungroup, 25-step undo/redo | Editing tests plus existing clip structure/history suites |
| Strict authored/runtime validation, hidden/unused settings, resource preflight/cache bounds | Backend transposition tests, frontend domain tests and CLI validation test |
| Same-pad repeated transforms, omission, strum spacing, score collisions, current/future latching, mixed edits, restart | Captured output-note tests in `test_clip_transposition.py`; assertions include exact attack/release times for anticipated notes and strums |
| Arpeggiator mapping/bypass and selected-context audition | Backend transposition tests plus existing arpeggiator pattern/audition suites |
| Full-definition/cropped audition, exact rests, structural descendant paths, first unsaved setting | Frontend editing tests and backend audition tests |
| Selection/mode is inert, both components persist, zero/inherit/discard and combined Save | [inspector tests](../../frontend/src/components/clipArranger/TransposeInspector.test.tsx) |
| API save/load/autosave/native and atomic invalid writes | `test_clip_transposition_persistence_history_native_and_atomic_rejection` in [API tests](../../backend/tests/test_api.py) |
| Actual MIDI/SCORE output, cropped sustained-note chase/release | `test_transposed_clip_export_chases_and_releases_output_pitch`, both event sources, in API tests |
| Frontend/CLI wire agreement and CLI round trip | [shared runtime fixture](../../backend/tests/fixtures/clip_transposition/schedule.json), frontend editing test and [CLI tests](../../integrations/skills/orchestron-performance-creator/tests/test_clip_arrangement.py) |

### Commands and observed results

- `npm --prefix frontend run check`: lint, TypeScript, 105 test files / 1,125 tests, production build passed. The final accessibility-label change is included in the passing check.
- `.venv/bin/python -m pytest backend/tests -q`: **2,709 passed**. An earlier full run had two saxophone acoustic-measurement failures; all 22 saxophone tests passed on isolated rerun and the subsequent full suite passed.
- `VISUALCSOUND_BUILD_CYTHON=required uv sync --extra dev`: rebuilt the extension after the shared playback-kernel changes. Explicit Python and Cython runs exercised transposition, clip schedules, note timing, strums, arpeggiator patterns and score sequencing. The final focused set passed **210 tests under Python and 210 under Cython**, including the later cache, validation, status and release-ownership changes, without changing the compiled kernel source.
- `PYTHONPATH=integrations/skills/orchestron-performance-creator/src .venv/bin/python -m pytest integrations/skills/orchestron-performance-creator/tests -q`: **346 passed**. The fixture was corrected to include the required empty instrument list; subsequent focused projection/validation checks passed.
- A final full API run passed **407 tests**. Backend Ruff, `git diff --check`, and validation of **295 local Markdown/image links** passed.

The full-suite count is a snapshot of that run; additional focused tests were added afterward for preflight/cache bounds, repeated future edits, restart and pending-target status. Do not infer the total collected test count from the earlier full run.

### Production-browser verification

Used an isolated SQLite database and local backend on port 9027, with the versioned nested score fixture and a versioned instrument patch. No developer performance/database was edited. Verified selecting repetition 2 by keyboard, editing/saving its shared value, changed linked previews, reload persistence, independent placement selection, arrangement Play/Stop and selected-context Play edit/Stop edit. The production browser clock advanced and real Csound emitted nonzero PCM; this is functional audio-path evidence, not a claim of subjective listening or external MIDI hardware testing. The only console errors were missing `favicon.ico` requests.

Inspected the inspector at 520-pixel width. Verified all four language controls retain the selected chromatic value. Current screenshots are [shared scope](../../screenshots/clip-transposition-shared.png) and [placement scope](../../screenshots/clip-transposition-placement.png). Regenerated the English [manual PDF](../../documentation/user_documentation.pdf) with `node tools/build_user_docs_pdf.mjs`; inspected the affected rendered pages, including both screenshots.

## Budgets and measurements

Authored bounds remain ±127 per component, 4,096 replacements per plan, 1,024 profiles per lane, 1,024 placements per clip, and 65,536 aggregate authored entries/placements. Logical repetition indices are bounded at 40,320,000,000. Derived bounds are 65,536 effective changes, 256 nonidentity variants per lane, 1,024 per performance, and 200,000 transformed score records. Both authored preflight and runtime preparation enforce limits before allocating variants; audition and sounding pinned variants also count at preparation.

The preparation LRU is capped at 256 entries, 200,000 transformed score records and **128 MiB of conservative retained-size accounting**. Complete content keys include timing, notes, theory and pair. A lock serializes cache mutations among preparation/export threads. The byte estimate counts shared source objects again per entry, intentionally overestimating unique heap usage. A 64 MiB candidate evicted variants at the supported dense limit and was rejected after measurement; 128 MiB retains that case. Identity pads bypass the cache.

Reproduce with `.venv/bin/python -m backend.tools.benchmark_clip_transposition`. Raw [preparation/render results](measurements/preparation-and-render.json) and [paired identity comparison](measurements/identity-comparison.json) record macOS 15.7.9 arm64, seven measured preparations per case after one warmup, and 1,000 render blocks at each position (48 kHz, 64 frames, 1.3333 ms block budget). These measurements isolate sequencer/preparation work; they do not include instrument DSP or prove whole-system latency.

| Workload | Cold median | Cached median | One-entry median | Retained prepared data | Worst render block |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing TB303 identity fixture | 2.75 ms | 0.64 ms | 0.60 ms (unchanged identity request) | 273 KB | 0.114 ms |
| 4,096 entries, million-beat loop, 128-note score | 32.59 ms | 4.78 ms | 4.86 ms | 3.22 MB | 0.065 ms |
| 10,000-note score / 200,000 transformed records | 2,773 ms | 151 ms | 151 ms | 46.72 MB | 0.115 ms |

The dense fixture serializes to 17.41 MB in about 607 ms. It remains a costly preparation outside the audio path; playback retains the previous configuration until preparation succeeds. Cached/one-entry results reuse existing pitch variants. The original 64 MiB cache candidate took about 2.8 seconds even when unchanged; retaining all supported variants removed that repeated work.

Three interleaved matched identity runs had cached medians baseline/current of 0.6004/0.6236, 0.6347/0.6078 and 0.5908/0.6217 ms. No repeatable >10% median regression appeared in this workload. A micro-fixture showed several microseconds of additional setup; it is not used as evidence of a render deadline regression. Render p99/max results for all measured cases are retained in the JSON.

## Verification limits and rollout

This remains part of the existing development preview. No default-rollout flag, publishing, deployment or user-data migration was performed. Tests and measurements cover the local macOS environment. External MIDI hardware, subjective listening, cross-browser/platform certification, long-running soak tests and exhaustive manual combinations of zoom/language/structure are unperformed. Existing broader clip-arranger release gates remain in force. The acceptance matrix remains the regression checklist for further platform qualification; historical tests or screenshots are not substituted for the results above.
