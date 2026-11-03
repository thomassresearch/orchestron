# Implementation plan

[Index](README.md) · [Contracts](data-and-playback-contracts.md) · [Six implementation tasks](tasks/README.md)

## Strategy

Introduce a versioned clip/definition model and an adapter around existing musical editors. Separate data migration, scheduling and presentation so failures can be isolated. Keep the current performance path available during development and for explicitly unsupported legacy cases. Do not fork a second implementation of each musical editor or build the redesign by embedding the mockup.

The lowest-risk order is: characterize existing behavior → implement pure model operations and migration → implement runtime/export resolution → build the arranger surface → host existing editors and live inputs → verify and cut over. A read-only arranger shell can be developed after the model while runtime work completes, but audio-enabled editing depends on the runtime gate.

## Existing implementation seams

Paths are verified against the captured baseline; implementation may extract small adapters/components as needed. These are starting points, not permission to rewrite every listed module.

| Concern | Current source | Intended adaptation |
| --- | --- | --- |
| Performance composition and device bodies | [SequencerPage](../../frontend/src/components/SequencerPage.tsx), [sequencerPageContracts](../../frontend/src/components/sequencer/sequencerPageContracts.ts) | Reorder performance layout; extract existing editor bodies behind typed selected-pattern props without changing their controls. |
| Timeline and range tools | [MultitrackArranger](../../frontend/src/components/MultitrackArranger.tsx), [arrangementRange](../../frontend/src/lib/arrangementRange.ts), [padLoopPattern](../../frontend/src/lib/padLoopPattern.ts) | Render fixed clip windows and nested occurrences; preserve range operations and exact timing through a new resolver. |
| Workspace and temporary context | [PatternWorkspace](../../frontend/src/components/sequencer/PatternWorkspace.tsx), [patternWorkspace helpers](../../frontend/src/lib/patternWorkspace.ts), [PerformanceEditorState](../../frontend/src/components/sequencer/PerformanceEditorState.tsx) | Reuse pure grouping/copy logic and retained editor context; retire the separate workspace surface only after equivalent contextual actions exist. |
| Editor audition | [PerformanceAudition](../../frontend/src/components/sequencer/PerformanceAudition.tsx), [runtime controller hook](../../frontend/src/hooks/useSequencerRuntimeController.ts) | Introduce explicit target/revision-aware editor audition using existing preparation/command mechanisms. |
| Authored state and serializers | [types](../../frontend/src/types/index.ts), [appStoreModel](../../frontend/src/store/appStoreModel.ts), [sequencer edits](../../frontend/src/store/sequencerEdits.ts), [track actions](../../frontend/src/store/appStoreSequencerTracksSlice.ts), [transport actions](../../frontend/src/store/appStoreTransportSlice.ts), [history](../../frontend/src/store/arrangerHistory.ts) | Stable definition/occurrence IDs, versioned migration and atomic edit transactions; keep runtime and draft state separate. |
| Backend input validation | [session models](../../backend/app/models/session.py), [performance models](../../backend/app/models/performance.py), [app-state models](../../backend/app/models/app_state.py), [persisted limits](../../backend/app/services/persisted_json_limits.py) | Validate new runtime/persistence structures, references, versions and bounded expansion consistently. |
| Source timing and playback | [runtime](../../backend/app/services/sequencer_runtime.py), [runtime config](../../backend/app/services/sequencer_runtime_config.py), [runtime models](../../backend/app/services/sequencer_runtime_models.py), [source transport](../../backend/app/services/sequencer_source_transport.py), [playback](../../backend/app/services/sequencer_playback.py), [playback implementation](../../backend/app/services/_sequencer_playback.py) | Resolve clip intervals and overlay sources while preserving render-driven timing, source ownership and compiled/Python parity. |
| Arpeggiator and score behavior | [arpeggiator runtime](../../backend/app/services/arpeggiator_runtime.py), [score sequencer](../../backend/app/services/score_sequencer.py) | Retain input/clock/seed semantics and sparse-score timing; adapt occurrence lookup, not musical generation. |
| Curve rendering and sampling | [curve editor](../../frontend/src/components/sequencer/ControllerSequencerCurveEditor.tsx), [sequencer helpers](../../frontend/src/lib/sequencer.ts), [controller service](../../backend/app/services/sequencer_controller.py) | Reuse interpolation and keypoint normalization for timeline and full editor; route changes into the same draft. |
| Audio and input policy | [browser-clock hook](../../frontend/src/hooks/useBrowserClockAudioController.ts), [playback policy](../../frontend/src/audio/browserPlaybackPolicy.ts), [worker](../../frontend/src/audio/browserClockWorker.ts) | Preserve source activity and buffer transitions; update ownership plumbing only where needed. |
| Persistence and export | [performance service](../../backend/app/services/performance_service.py), [app-state service](../../backend/app/services/app_state_service.py), [bundle import](../../backend/app/services/bundle_import_service.py), [export service](../../backend/app/services/performance_export_service.py), [export selection](../../backend/app/services/performance_export_selection.py) | Accept/version/validate the new authored model and preserve native/runtime/export parity. Audit CLI serializers and import/export callers as part of the same change. |

Do not replace actual sequencer payloads with the mockup's compact event arrays. The editor adapter supplies a typed selected definition, lane settings, callbacks, draft status and audition context. If an existing editor expects a selected pad, use a temporary view model at the boundary; it must not impose an eight-definition storage limit or write a hidden pad copy back into authored state.

## Dependency and review gates

| Gate | Required evidence before proceeding |
| --- | --- |
| G1 — Contracts | Task 1 maps every current editor field and records timing, audition, legacy conversion and buffer-policy decisions. Representative fixtures and baseline event traces exist. |
| G2 — Data | Task 2 passes pure operation, migration, reference/limit and round-trip tests. No new-format writes are enabled through an incompatible runtime/export path. |
| G3 — Sound | Task 3 passes clip-boundary, audition-race, source-ownership and online/offline parity tests, including actual engine preparation. |
| G4 — View | Task 4 passes compact/expanded hierarchy, preview, selection and fixed-window geometry checks. |
| G5 — Editing | Task 5 passes all existing editor capability checks, save scopes at three levels, inline curve editing and real input-device behavior. |
| G6 — Release | Task 6 passes supported legacy imports, full regression checks, representative audio/performance checks, accessible/localized workflows and documentation/screenshot review. |

Use small reviewable commits within each task. Pure model/resolver changes should be reviewed separately from component movement, which should be reviewed separately from changed runtime behavior. Feature gating must cover loading, writing, runtime configuration and exports coherently, not just hide a button.

## Risk register

| Risk | Prevention and evidence | Owner task |
| --- | --- | --- |
| Eight-pad normalization discards new definitions | Stable IDs, typed adapters, explicit version validators; round-trip a performance with more than eight definitions. | 01, 02, 05 |
| Shared edits leak before Save | Draft layer separated from authored state; cancel/reload/export checks; revision conflicts and atomic scope transactions. | 02, 05 |
| Local save alters siblings or all repeats | Occurrence-path IDs, ancestor-only copies and exact repeat-pass isolation; identity and event comparisons before/after/undo. | 02, 05 |
| Duration changes ripple song positions | Clip geometry stored independently; fixed-window assertions across all linked uses and nested duration changes. | 02, 04 |
| Musical editor loses features during extraction | Field/control inventory, characterization tests and real-editor browser checks; no toy replacements. | 01, 05 |
| Drift or wrong crop in polymeter | Exact time, native score ticks, rational-speed fixtures, offsets and partial-cycle tests. | 02, 03 |
| Audition duplicates notes or restarts after Stop | One owned overlay, generation IDs, cancellation races and restoration at current song position. | 03 |
| Controller/arpeggiator transitions sound different | Preserve controller reset/hold rules, arp chord/clock/seed behavior and same-pattern continuation; event parity. | 03 |
| Preview appears plausible but is false | Shared musical resolver where possible; arp parameters only; zero-versus-empty and velocity/ratchet checks. | 04 |
| Legacy Manual sources or keyboards disappear | Explicit compatibility route and conversion report, recoverable original; no silent consolidation. | 01, 02, 06 |
| New format corrupts rollback or older clients | Capability/version gating and backups; distinguish UI fallback from data downgrade. | 02, 06 |
| Timeline work interrupts sound or grows without bounds | Render outside audio path; bounded traversal, memoization/visible previews, collapsed suspension; performance comparison. | 03, 04, 06 |
| Live buffer behavior is accidentally simplified | Reuse Auto/Live/Listening policy and real input ownership, including inactivity, sustain and external MIDI. | 03, 05 |

## Acceptance and test matrix

Tests should verify user-visible contracts and event output rather than mirror implementation details. Reuse existing versioned fixtures; tests must not import developer examples. Add frontend tests near the changed domain/components and backend regressions in [test_api.py](../../backend/tests/test_api.py) plus relevant service suites.

| Scenario | Required outcome |
| --- | --- |
| Short/long clip against a source, Once/Loop, nonzero offset | Correct crop, silence, repeats and partial final pass; no source mutation. |
| Linked pattern/group/supergroup length changes | All source uses update; every clip boundary and later placement stays fixed. |
| Local edit at each nesting level and a repeated pass | Only selected use changes; necessary ancestors fork; undo restores IDs, links, coverage and sound. |
| Same definition twice inside one group | Occurrence selection and local save affect exactly one child use. |
| Melodic chord/hold/strum/timing, drummer ratchets/ramp, sparse score overlaps | Existing musical behavior and hidden data survive editor extraction, saves and exports. |
| Arp input chord changes, Live clock, hold/bypass/mute, 5-step rhythm in 4-beat duration | Same musical generation as baseline; no guessed timeline pitches or artificial test chord. |
| Controller curves and sparse steps | Same curve sampling, endpoint snaps/values, null/zero/repeats, channel routing and reset semantics. |
| Edit while stopped/running, Song Play/Stop/seek/end, queued preparation cancellation | Proposed transport matrix holds; no double sound, stale restart, transport reset or lost draft. |
| Keyboard/controllers started while song/editor runs | Existing UI, MIDI routing and independent Start/Stop; correct engine lifetime and buffer policy. |
| Save/reload/autosave/native bundle/CLI/CSD MIDI/CSD SCORE | Authored state and sound match; no audition/draft/mute/solo leakage. |
| Compact/expanded/collapsed UI, narrow screen, keyboard-only/text zoom | Accessible operations; retained context; bounded rendering and unchanged playback. |
| Old formats, unused/hidden data, multiple keyboards and Manual sources | Deterministic conversion or explicit compatible fallback with no data loss. |

Useful existing suites include [arranger component tests](../../frontend/src/components/MultitrackArranger.test.tsx), [history tests](../../frontend/src/store/arrangerHistory.test.ts), [edit tests](../../frontend/src/store/sequencerEdits.test.ts), [collapse tests](../../frontend/src/components/CollapsedPerformance.test.tsx), [runtime-hook tests](../../frontend/src/hooks/useSequencerRuntimeController.test.tsx), [source-transport tests](../../backend/tests/test_sequencer_source_transport.py), [runtime tests](../../backend/tests/test_sequencer_runtime.py), [playback tests](../../backend/tests/test_sequencer_playback.py), [curve tests](../../backend/tests/test_controller_curve.py), [score tests](../../backend/tests/test_score_sequencer.py), [arpeggiator tests](../../backend/tests/test_arpeggiator_runtime.py) and [export tests](../../backend/tests/test_performance_export_service.py).

Run targeted suites during each stage, then `npm --prefix frontend run check`, `uv run --extra dev pytest backend/tests` and `make backend-check` at integration. Use `make benchmark-runtime` and the sequencer preparation benchmark when scheduler/preparation changes warrant them. Record actual environment limitations; a simulated UI check does not substitute for Csound playback or export validation.

## Cutover and documentation

Before making the redesign default, rehearse New, Load, Save, reload, native import/export and rollback on copied fixtures. Compare old/new event traces for equivalent legacy songs, then exercise new features that have no legacy representation. Test failed preparation, rejected migration, reconnect and late responses deliberately.

Update README capabilities while preserving its opening and Built With Codex section, the English user manual, integrated EN/DE/FR/ES labels/help, and relevant screenshots under `screenshots/`. Explain clip versus content length, save scopes, auditions, compatibility cases and fixed keyboard/manual controls. Regenerate the documentation PDF using the repository workflow when the shipped manual changes.

Retire obsolete Pattern Workspace and Playback source UI only after all its still-needed selection, reuse, grouping, draft and audition functions are available in context. Keep musical editor components, pure helpers and legacy readers that remain required. Removal is not an excuse to lose legacy performances or duplicate editor implementations.
