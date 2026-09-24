# Code quality review and improvements

Review baseline: `967694b`. Implementation date: 2026-09-24.

Priorities reflect impact and reproducibility: P1 covers audio safety, data loss and unbounded work; P2 covers lifecycle correctness and resource handling; P3 covers maintenance and avoidable overhead. These are findings in the reviewed paths, not a claim that the repository has no other defects.

## Prioritized findings and changes

| Priority | Finding | Implemented improvement |
| --- | --- | --- |
| P1 | Engine Stop could tear down Csound while another thread called `performKsmps`, or a mock render could advance its cursor after Stop. | Start, Stop and rendering share render ownership with a consistent lock order. Rendering rechecks running state after acquiring ownership. |
| P1 | Compilation, database work, archive processing and export estimation could occupy the event loop used by audio websocket refills. | Library handlers and serialization, session creation/validation/compilation, archive work and export validation run in worker threads. Audio uploads move disk writes and quota work off the event loop. |
| P1 | A short export range with an enormous absolute start could trigger unbounded history traversal before the export timeout began. | Validate both the range length and absolute end against 65,536 transport steps before event estimation. |
| P1 | A delayed patch load/save or engine-setting response could overwrite the active tab or a newer draft. | Bind requests to their originating tab and generation. Preserve edits made during a save while accepting the saved identity and timestamps. |
| P1 | Failure of autosave A could overwrite already queued snapshot B and retry every 400 ms. | Keep the newest pending snapshot and use exponential retry delays capped at 30 seconds. |
| P2 | Overlapping starts could create multiple engine sessions; Stop could be followed by a late successful start. | Share pending creation/start promises and invalidate pending starts on Stop. Delete obsolete creations and stop late starts. |
| P2 | A reconnect could race automatic Stop; a new controller claim could arrive while deletion awaited the old connection. | Serialize lifecycle operations, recheck connection ownership before automatic Stop, and reject claims once deletion or stopping begins. |
| P2 | An old AudioContext close or websocket callback could invalidate a replacement audio connection. | Detach old resources before awaiting close and check pipeline/socket identity before applying callbacks. |
| P2 | Compiling a running session replaced its artifact while the engine kept using the old program. Failed rendering also skipped native cleanup. | Reject full compilation while running with HTTP 409; serialize lifecycle and controller-setting changes; clean up native resources even after running becomes false. |
| P2 | Import preview stored assets before confirmation, later failures left partial imports, and duplicate/malformed definitions could be silently remapped. | Preview without storage, validate all definitions, and commit selected patches/performance in one database transaction under an asset batch that rolls back new files on failure. |
| P2 | ZIP export held complete archives and individual audio assets in memory. | Spool archives to temporary files above 1 MiB, stream responses in 64 KiB chunks, and copy asset files directly into ZIP entries. |
| P3 | Performance listing decoded complete configuration JSON to return four metadata fields. | Query only the list columns in `PerformanceRepository.list_items`. |
| P3 | Playback/export duplicated controller interpolation and timing constants; offline export globally replaced `time.perf_counter`. | Share pure controller math and transport constants; inject an export-local clock into the sequencer runtime. Estimation and actual event generation retain their distinct responsibilities. |
| P3 | Tests exercised an obsolete frontend transport path, and unused helpers remained from earlier designs. | Remove the obsolete hook command, test the UI's `transportDevice` path, and remove unused MIDI/timing/label/routing helpers and the unused mock engine loop. |
| P3 | Integrated help promised same-channel instrument layering although validation requires unique MIDI channels. | Correct EN/DE/FR/ES help and the piano-roll documentation. |

## Regression coverage

Final verification: **1,129 backend tests passed**, **666 frontend tests passed**; Ruff, ESLint, TypeScript, the frontend production build, local Markdown links and `git diff --check` passed. Native Csound tests ran as part of the backend suite. No manual browser/audio listening or Docker validation was performed in this change.

- [Engine tests](backend/tests/test_csound_worker.py): Stop waits for rendering; cleanup after native render failure.
- [Session lifecycle tests](backend/tests/test_session_lifecycle.py): reconnect during a pending stop, claim during deletion, and event-loop responsiveness during blocking work.
- [API tests](backend/tests/test_api.py): running-session compilation, absolute export bounds, import preview/rollback, definition validation, export clock isolation and export-validation responsiveness. Existing round trips verify public field aliases.
- [Store async tests](frontend/src/store/useAppStore.async.test.ts): originating tabs, newer drafts, queued autosave recovery, cancelled session creation and overlapping starts.
- [Browser audio tests](frontend/src/lib/browserClockAudio.test.ts) and [worker tests](frontend/src/audio/browserClockWorker.test.ts): replacement connections survive delayed shutdown and stale callbacks.
- [Import tests](frontend/src/lib/bundleImportExport.test.ts): strict definition handling and destination ID planning before performance remapping.
- Existing runtime/export fixtures cover controller curves, transport timing, routes, assets, instrument types and native bundle round trips.

## Compatibility and operational notes

- Native import dialogs retain their existing choices. Confirmation now calls `/api/bundles/import/commit` with a multipart file and JSON plan. `python-multipart` is included in the dependency lockfile.
- `/api/bundles/import/expand` retains its default asset-storage behavior for existing CLI consumers; `?preview=true` is read-only. Transactional library imports use the new commit endpoint.
- Import rollback handles validation and storage failures. Filesystem writes and SQLite are separate storage systems; this does not promise recovery from power loss at every instruction boundary.
- Full compilation requires a stopped engine. Live sequencer editing continues through the existing configuration preparation path.
- CSD export requests use the configured bundle JSON limit (8 MiB by default), in addition to the existing MIDI-event and generation-time limits.
- README, backend reference, localized help and the generated user documentation PDF are updated. The changed PDF pages were visually checked.

## Further improvement plan

1. Add a browser integration scenario covering playback, temporary disconnection, reconnect, rapid Stop/Start and import cancellation using an isolated library. Unit and API tests cover these races; listening under real browser/host load remains useful validation.
2. Split the large application store and session service by ownership boundary after these fixes settle. Keep lifecycle, persistence and authored/runtime state contracts explicit, and retain the new regressions during extraction.
3. Measure large-library and large-asset workloads before further optimization. The changes remove identified full-config decoding and archive buffering; broader caching should follow measured bottlenecks.
