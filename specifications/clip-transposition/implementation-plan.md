# Clip transposition implementation plan

Status: implemented in the clip-arranger preview; see [implementation and verification record](implementation-record.md). Date: 2026-11-04.

The [feature specification](specification.md) defines behavior; [acceptance scenarios](acceptance.md) define completion evidence. This plan does not authorize publishing, modifying user performances or enabling the broader clip arranger rollout.

## 1. Delivery strategy

Implement the model and musical transform as pure code first, then persistence and transactions, then preparation/playback and audition/export, then the integrated UI. Keep authoring unavailable until every consumer can read and play the new representation. Use existing production editors, history, preparation services and runtime kernels.

There is no requirement to change Csound instrument compilation or add opcodes. Do not introduce a second note scheduler or apply a generic MIDI output offset after note ownership has already been established. Prepared variants and dynamic arpeggiator maps belong to the existing source playback pipeline.

| Task | Deliverable | Dependencies | Exit gate |
| --- | --- | --- | --- |
| T1 | Baseline, golden fixtures, allocated versions and measured budgets | — | G1: contracts characterized |
| T2 | Pure plan algebra, authored types and validators | T1 | G2: deterministic cross-language semantics |
| T3 | Persistence, editing scopes and structural preservation | T2 | G3: lossless atomic authoring |
| T4 | Runtime projection, bounded preparation and live playback | T2; T3 for integrated saves | G4: correct emitted notes and releases |
| T5 | Occurrence-aware audition, CLI and offline export parity | T3, T4 | G5: one musical result across consumers |
| T6 | Inspector, repeat editing, previews and draft integration | T3; T4–T5 before audio-enabled completion | G6: complete accessible workflow |
| T7 | Full verification, documentation and gated delivery | T1–T6 | G7: reviewed release evidence |

T4 can be developed against versioned fixtures once T2 is stable. T6 can begin with read-only fixture rendering after T3. These dependency notes do not call for separate agents or independent implementations of the contracts.

## 2. T1 — Characterize the baseline

### Work

1. Re-read [AGENTS.md](../../AGENTS.md), [BACKEND.md](../../BACKEND.md), the [clip implementation record](../redesign-arranger/implementation-record.md), [direct-content review](../redesign-arranger/direct-content-review.md) and [fixture rules](../../backend/tests/fixtures/README.md). Check current source versions and repository status; do not assume this document's numeric versions are still unallocated.
2. Record the actual performance/app-state/clip/runtime/history/native-envelope versions in a new implementation record in this directory. Allocate the proposed next versions if available, otherwise update the complete package consistently before dependent work.
3. Inventory every path that constructs/clones/rebuilds `ContentItem`, `Definition`, `Clip`, structural draft nodes and runtime spans. Current structural materialization reconstructs records explicitly and would otherwise drop new fields.
4. Characterize existing musical save scope, local loop-pass isolation, source offset behavior, structural phase scaling, container audition limits, editor audition ownership, live score reconciliation and arpeggiator same-pad boundaries.
5. Add a small shared golden-vector file and compact authored/wire fixtures under versioned test fixtures. Include a melodic chord pattern, dense and sparse score patterns, and an arpeggiator with deterministic input/seed. Tests must not load `examples/` or mutable developer performance files.
6. Capture matched preparation/render baselines using the same fixtures and process configuration that later measurements will use. Measure retained prepared-score memory and serialization cost, not just dictionary lookup time.
7. Review the proposed authored/derived budgets from specification section 5.1. Record executable constants, fixture counts, warmup policy and measured consequences. Adjust a budget only together with validation, fixtures and this contract; no silent JSON-limit increases.

### G1 evidence

- A source/version map and fixture manifest with no unsupported claims about current feature behavior.
- Golden fixtures distinguish original authored pitches from expected sounding pitches.
- Reproducible identity-only baseline and a measurement plan for cold, cached and changed-repeat preparation.
- Explicit inventory of field-dropping constructors and all format readers/writers, including automation exact-version checks.

## 3. T2 — Pure transposition domain and validation

### Source seams

Extend [clip model](../../frontend/src/lib/clipArranger/model.ts) and [authored validator](../../backend/app/models/clip_validation.py). Add focused transposition-domain modules in frontend and backend rather than embedding pitch math in React components. The current [scale helper](../../frontend/src/lib/sequencer.ts) provides root/mode definitions but its destructive, clamping one-step function is not the new algorithm.

The standalone CLI must not import the backend package. Keep its plan projection independent and compare wire output against the frontend fixtures. Do not create a third different musical interpretation.

### Work

1. Implement strict pitch-pair and sparse-plan validation, identity evaluation, indexed replacement and additive composition. Preserve explicit equal-to-base entries in authored state; prepared representations may deduplicate values without altering authored intent.
2. Implement arbitrary signed scale-step transformation with floor arithmetic and final-only MIDI filtering. Use the same golden vectors in TypeScript and Python, including accidentals, negative octaves, collisions and cancellation of an intermediate overflow.
3. Add profiles, definition references, child plans, placement paths and repeat-index bases to authored types. Keep all musical payload types untouched.
4. Extend content resolution to expose the contributing plan references and full occurrence path. Keep timing resolution independent from pitch calculation.
5. Add logical-pass calculation and validation for Loop/Once, offsets, legacy lane cycles and derived index extents. Enumerate visible windows only; never allocate per-pass authored state.
6. Define plan algebra operations for snapshotting a removed container's contribution, finite union of changed indices and resource preflight. Bound work before constructing an oversized union/result.
7. Add pure model tests for missing/dangling/cross-lane profile references, duplicate indices, unsupported sources, rest plans and invalid placement paths. Validate unused definitions/profiles as well as placed content.

### G2 evidence

All musical-vector and model cases in [acceptance sections 2–5](acceptance.md) pass with exact integer assertions. Identity transformation returns identical musical data, and long source windows have bounded plan-resolution cost. Frontend/backend/CLI validators agree on the accepted/rejected fixture corpus.

## 4. T3 — Persistence, scopes and structural preservation

### Source seams

- [operations.ts](../../frontend/src/lib/clipArranger/operations.ts), [structure.ts](../../frontend/src/lib/clipArranger/structure.ts), [structureStore.ts](../../frontend/src/lib/clipArranger/structureStore.ts) and [history.ts](../../frontend/src/lib/clipArranger/history.ts).
- [clipActions.ts](../../frontend/src/store/clipActions.ts), [appStoreModel.ts](../../frontend/src/store/appStoreModel.ts) and [sequencerEdits.ts](../../frontend/src/store/sequencerEdits.ts).
- [Performance models](../../backend/app/models/performance.py), [app-state models](../../backend/app/models/app_state.py), [clip validation](../../backend/app/models/clip_validation.py), existing native-bundle service/serializers and CLI format readers.

### Work

1. Add the version/capability gates without enabling UI authoring. Accept old identity-only data and preserve untouched old writers. Support instrument automation in clip v3; replace exact-v2 checks only where the newer version intentionally includes that capability.
2. Add pure commands for shared-profile base/entry edits, child-reference base/entry edits and placement base/entry edits. Each returns a fully validated candidate, revision changes, affected links and occurrence-path remaps.
3. Make first shared edits attach a single canonical profile to the definition. Every existing linked reference observes it. Local transpose edits create placement metadata and must not invoke musical `saveDraft`/pass isolation.
4. Integrate session-only drafts, dependency fingerprints, Save/Discard/Cancel and the existing structural/musical conflict resolver. Reject stale impact previews. Keep unrelated drafts intact and correctly remapped.
5. Extend every identified constructor and clone path to preserve new fields. Musical variations fork the chosen definition's profile; automatic ancestor forks preserve profile links. Copying clips copies local plan records while retaining shared references.
6. Preserve source-repeat indices in pass isolation, section operations, explicit time edits, lane-cycle conversion and splits. Include nonzero repeat bases in history and save/reload tests.
7. Implement grouping/ungrouping algebra and path remapping. Distribute removed shared versus placement contributions at the correct scope. For moves, preserve the item's own plans and adopt destination inheritance. Show the resulting change rather than compensating secretly.
8. Store each user action as one compact arranger-history transaction. Validate the complete replay chain; test all 25 entries and the cursor through save/load, autosave and native bundles. Runtime pending/latch state must never enter the history basis.
9. Add API regression coverage in `backend/tests/test_api.py`, relevant persistence/service tests, frontend store/model tests and CLI round-trip tests. Invalid writes must leave the previous document untouched.

### G3 evidence

Two differently sized/cropped linked clips share one profile across save/reload; nested local adjustments remain local. Every supported structural operation either preserves/transforms settings according to the specification or rejects atomically with a useful error. Legacy and automation fixtures round-trip without losing data. New format cannot pass through an older incompatible writer.

## 5. T4 — Runtime and preparation

### Source seams

- [Frontend projection](../../frontend/src/lib/clipArranger/runtime.ts), [runtime schedule](../../backend/app/models/clip_arrangement.py) and [clip playback](../../backend/app/services/clip_playback.py).
- [Preparation service](../../backend/app/services/sequencer_preparation.py), [runtime compilation](../../backend/app/services/sequencer_runtime_config.py), [runtime models](../../backend/app/services/sequencer_runtime_models.py).
- [Sequencer runtime](../../backend/app/services/sequencer_runtime.py), [shared playback kernel](../../backend/app/services/_sequencer_playback.py), [Cython declarations](../../backend/app/services/_sequencer_playback.pxd), [strums](../../backend/app/services/sequencer_strum.py), [scores](../../backend/app/services/score_sequencer.py) and [arpeggiators](../../backend/app/services/arpeggiator_runtime.py).

### Work

1. Define runtime schedule v2 with a plan bank, per-leaf references and repeat base. Preserve v1 identity behavior. Add strict bounds/reference validation independent of authored-document validation.
2. Intern plan-reference sets and effective pairs. Derive cases from sparse index unions, not all repetitions or Cartesian products of plan values. Count effective changes/variants/score records before allocation; report the source causing a limit failure.
3. Build and cache melodic/score variants by complete content/timing/theory/offset/version keys. Keep variant identity separate from authored pad index and UI definition identity. Transform strum pitches without changing attack spacing; rebuild score ownership indexes.
4. Select variants from lazy clip position lookup. Include effective transform identity in boundary/reconciliation decisions even when consecutive passes use the same pad. Update Python/Cython paths together and rebuild the extension before claiming parity.
5. Add arpeggiator pitch maps after current generation/quantization and retain configured pattern theory for the new layer. Update same-pad repeat detection and output previews. Test active, bypass and mute modes separately.
6. Implement actual-output-pitch ownership, duplicate-pitch ordering, range omission, note chasing and clipping. Include early attacks, strums, ratchets and releases around changed-transform boundaries.
7. Implement per-occurrence transform latching for live edits. Preserve the current pair until the next leaf boundary; latest successful pending edit wins. Include active pinned pairs in preparation when musical content changes concurrently, and prevent superseded preparations from installing.
8. Keep runtime intent, variant tables and latch/pending state out of persisted/config-sync projections. Preparation failure preserves current music and the edited draft; Stop/seek/restart follow the specified cancellation/reset behavior.
9. Measure identity, dense nested, same-pad alternating-transform and maximum supported sparse-plan fixtures. Record cold/cached/one-entry edit preparation, process round trip, retained memory and render/boundary percentiles/maxima.

### G4 evidence

Exact captured MIDI events match the acceptance vectors and timing contracts in both kernels. No orphaned notes, unexpected transport resets or render-thread preparations occur. Long-loop costs depend on content/explicit settings rather than virtual pass count. Performance evidence meets the recorded baseline criteria; an unbuilt Cython extension is an unperformed check, not a pass.

## 6. T5 — Audition, CLI and exports

### Source seams

Use [clip audition adapters](../../frontend/src/lib/clipArranger/runtime.ts), [structure audition](../../frontend/src/lib/clipArranger/structureAudition.ts), [session request models](../../backend/app/models/session.py), current source-transport/audition services and [CLI clip projection](../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_arrangement.py). Discover current export entry points with `rg` before editing them; keep the shared runtime as the musical authority.

### Work

1. Add a versioned clip-aware audition payload with bounded schedule/context, while retaining legacy token requests. Include enclosing transforms, selected logical index and draft snapshots. Retain definition-editor audition from the selected definition's own start; arranged clip playback retains source offsets/crops.
2. Keep selected-occurrence audition on that logical index across its audition loop. Use arranger/clip playback for progression preview. Test audition entry/exit during song playback and while stopped, including arpeggiator input ownership.
3. Extend CLI normalization/version guards/projection and compare generated schedules against frontend fixtures. New-format legacy-pad mutations must still fail before writing.
4. Route both MIDI and SCORE exports through the same prepared transform resolution. Verify range-start chasing, cropped sustained notes, same-pitch collisions, arpeggiator output and release tails with existing instrument-selection rules.
5. Update export estimates conservatively and retain all native metadata, hidden entries, unused profiles and shared identities. Prove save/export does not read an unsaved transpose draft or a temporary latch.
6. Add persistence/native/API and actual MIDI/SCORE collection tests; compare event pitches, attack/release times, channels and velocities, not just the presence of new JSON fields.

### G5 evidence

The same fixture produces the same sounding notes and timing through authored playback, selected-occurrence audition at the equivalent phase, frontend/CLI runtime requests and both CSD modes. Arpeggiator live input comparisons use the same deterministic injected input. Native round trips preserve sharing and undo history exactly.

## 7. T6 — Integrated editing UI

### Source seams

Use the existing [clip arranger](../../frontend/src/components/clipArranger/ClipArranger.tsx), [contextual performance host](../../frontend/src/components/clipArranger/ClipPerformance.tsx), [scope controls](../../frontend/src/components/clipArranger/EditScopeControls.tsx), [Note map preview](../../frontend/src/components/clipArranger/PatternPreview.tsx), copy/help modules and T3 commands. Avoid duplicate musical editors or independent UI-only pitch algorithms.

### Work

1. Add an inspector section for Shared transposition, Offset in parent and Offset in this placement. Make the selected owner and affected uses visible before editing. Shared repeat edits must not silently take the legacy local-save default.
2. Add mode/amount controls, current logical repetition, base/entry selection, explicit inherit/zero controls, contribution breakdown and signed effective values. Permit entry of negative amounts and show both nonzero components.
3. Select a generated repeat directly in the existing expanded timeline. Add compact localized badges and accessible descriptions without creating child boxes for offscreen passes.
4. Render effective melodic/score Note maps from the same pure transform contract. Preserve authored notes in musical editors and parameter-only arpeggiator timeline previews. Add range-omission and pending-live indicators where applicable.
5. Integrate common draft Save/Discard/Cancel, conflicts, history, focus restoration and Play edit. Do not auto-audition or submit runtime config on mere selection/mode-tab changes.
6. Keep collapsed panels and offscreen content from doing visual transform work. Preserve zoom, scroll and selection; playback continues independently.
7. Localize labels/help in EN/DE/FR/ES. Verify desktop/narrow widths, keyboard-only use, text zoom, distinguishable units and screen-reader descriptions.

### G6 evidence

Browser tests complete all primary user workflows with correct sharing, saved round trips and actual playback. Screenshots document nested offsets, repeat-plan editing and local/shared scope. UI-only harness results are explicitly distinguished from real browser-clock/Csound verification.

## 8. T7 — Verification and documentation

Run the complete [acceptance matrix](acceptance.md). Record exact commands, versions, fixture identities, failures and any unperformed checks in an implementation record. Do not mark a gate complete based on a simulated playhead, stale compiled binary or unrelated historical benchmark.

Update README capabilities without changing its protected opening or **Built With Codex** section. Update the English [arranger guide](../../documentation/performance/multitrack_arranger.md), relevant sequencer/score/arpeggiator/import-export pages, integrated help and new screenshots under `screenshots/`. Keep the user manual English-only. When updating manual source or its PDF, use the available VisualCSound documentation-PDF skill and render/inspect affected pages.

Update [AGENTS.md](../../AGENTS.md) and [BACKEND.md](../../BACKEND.md) with concise current contracts/version references once implementation is real; do not put a planned feature into their current-behavior sections now. Link to detailed implementation contracts rather than duplicating this whole package.

Authoring remains gated until G1–G7 pass. Compatible readers must continue to honor saved new-format music even if new authoring is disabled. The existing broader clip-preview default-cutover gate remains separate.

## 9. Verification commands

Use focused tests during each work package, then the full appropriate checks once integration is complete. New test filenames below are suggested additions, not files claimed to exist today.

| Purpose | Command / procedure |
| --- | --- |
| Frontend focused | `npm --prefix frontend run test -- src/lib/clipArranger src/store/clipActions.test.ts` plus new transpose and component cases |
| Frontend full | `npm --prefix frontend run check` |
| Backend focused | `uv run --extra dev pytest backend/tests/test_clip_arrangement.py backend/tests/test_sequencer_playback.py backend/tests/test_score_sequencer.py backend/tests/test_arpeggiator_patterns.py backend/tests/test_api.py` with focused selectors while iterating |
| Backend full | `uv run --extra dev pytest backend/tests` and `make backend-check` |
| Python kernel | Run focused runtime cases with `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=python` set before import |
| Cython kernel | Rebuild through the repository build procedure, then run the same cases with `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython`; explicit mode must not fall back |
| Standalone CLI | `PYTHONPATH=integrations/skills/orchestron-performance-creator/src uv run --extra dev pytest integrations/skills/orchestron-performance-creator/tests` |
| Existing runtime benchmarks | `make benchmark-runtime` |
| Preparation | `.venv/bin/python -m backend.tools.benchmark_sequencer_preparation`, supplemented by versioned transpose fixtures and matched measurements |
| UI/actual audio | Production build against an isolated fixture database and real browser-clock/Csound session; no user Docker performance data |
| Documentation | Relative Markdown target/anchor validation, relevant PDF visual inspection when updated, `git diff --check` |

No example/instrument changes are expected. If implementation does change example/build inputs, apply the additional repository frontend-build and Docker validation rules; report unavailable Docker checks as unperformed.

## 10. Risks and completion criteria

| Risk | Control and required evidence |
| --- | --- |
| Settings silently become clip-local | Canonical shared profile references; two-clip edits and reload tests |
| Nested offsets disappear during structural edits | Explicit node-field preservation and path remap results; grouping/ungrouping/fork matrix |
| Pitch math differs between preview and playback | Shared golden vectors and exact frontend/backend event expectations |
| Repeated patterns grow into large copied datasets | Sparse plans, bounded unions, separate variants, measured memory and maximum-duration loops |
| Stuck or incorrectly released notes | Actual-pitch ownership, collision/chase/early-attack tests and mixed-edit stress |
| Arpeggiator repeat changes are missed | Transform identity tracked independently of pad index; deterministic repeated-input cases |
| New clip version drops automation or history | Superset capability checks and mixed-feature API/native/CLI fixtures |
| Audition sounds different from arrangement | Explicit selected-occurrence context and shared schedule/transform implementation |
| New data is written before all readers work | Reader/runtime/export gates before authoring, no silent downgrade path |

Completion means all required acceptance scenarios pass, documentation and screenshots match the delivered UI, limits/benchmarks are recorded honestly, and saved data is correctly consumed by every supported path. Remaining broader clip-preview limitations must still be reported separately.
