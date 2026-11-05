# Task 03 — Song specifications, compact reuse and transposition

Status: implemented. Evidence: [implementation record](../implementation-record.md). Stage: 2 — Song authoring. Depends on: [Task 02](02-authoring-and-migration.md). Exit gate: **G3**. Automation fields integrate in [Task 04](04-instrument-automation.md); complete editing follows in [Task 05](05-editing-history-and-audition.md).

## Result

A declarative song document and equivalent incremental commands build reusable sections, repeated material and pitch variations efficiently. Reapplying the document is safe and predictable. Transposition preserves original notes and the current arranger's ownership semantics.

Read [transposition contracts](../../clip-transposition/implementation-record.md), [scoped edits](../../../frontend/src/lib/clipArranger/transposeEdits.ts) and the existing [score handoff](../../../integrations/skills/orchestron-performance-creator/references/score_spec.md).

## Work

1. Define a distinct versioned song schema and `apply-song` path. Include document identity, instrument bindings, lane IDs/settings, pattern/container libraries, clip placements, exact time units, song end and transposition. Reserve/validate automation integration explicitly; unsupported fields must fail rather than silently disappear. Keep native performance envelopes and composition score v1/v2 distinct.
2. Publish machine-readable schema/capability inspection plus concise YAML/JSON examples. Reject unknown fields, invalid enum/type values, duplicate IDs and ambiguous units with useful paths. Validate dependencies and references before creating anything. Use the same operations as incremental authoring; avoid a second musical parser.
3. Implement dry run and explicit create/update/scoped-replace. Use stable object IDs and a declared managed scope, with transaction metadata kept outside musical payloads when appropriate. Missing objects in an update are retained. Replacement previews exactly what will be removed; never interpret a missing track list as permission to clear the song.
4. Make retries deterministic. Reapplying identical input creates no duplicate tracks, definitions, profiles, clips or history entries. Interrupted or stale operations use Task 01's revisions/identity mapping; report no-op/updated/conflict counts. Preserve intentional independent definitions even when their payload bytes match.
5. Support reusable within-lane phrases and cross-lane section placement as authoring conveniences. Compile repeat counts to scalar windows and linked content. Expose pattern/definition reuse statistics and warnings about redundant copies; do not automatically merge intentional variations.
6. Add shared/parent/placement transposition commands and corresponding song fields. Plans support default diatonic/chromatic pairs and sparse per-repetition replacements. Provide explicit set-zero, inherit, reset-component and reset-plan operations. Preserve hidden repetition entries when windows shrink.
7. Resolve each contribution at its owning reference's logical index. Handle cropped offsets, `repeatIndexBase`, fixed `repeatIndex`, shared profiles and full nested placement paths. Return effective totals and their origins; distinguish omitted out-of-range pitches from clamping. Each leaf uses its own configured scale/mode.
8. Apply pitch-only changes without copying musical patterns or rewriting notes. Local musical variation copies its appropriate profile when required by current semantics; a separate explicitly shared transposition change retains its shared scope. Increment relevant revisions and upgrade to existing v25/v26 formats only as required.
9. Preserve arpeggiator mapping order/bypass and deterministic seeds/input behavior. Reject pitch transposition on drummer, generic controller and bound automation sources. Avoid treating a changed chord quality or altered voice leading as a simple pitch offset unless the resulting notes exactly match accepted material.
10. Maintain Composition Creator v1/v2 handoffs and existing score application semantics. Add an explicit adapter to the clip song workflow that preserves notes, velocities, independent voices and timing. Reuse exact motifs where safe; never silently quantize, merge overlapping voices or select Score devices solely because the input is called a score.
11. Add targeted usage/effective-transposition inspection and bounded resolved-event previews. Return usable selectors for one repetition/placement, the shared impact list and the next relevant validation action.
12. Execute the note/drum/transposition portion of the efficiency fixture defined in the plan and record counts, input/output sizes, authoring calls and timing. Task 04 adds automation and Task 06 performs the integrated run. Long Loop extents must remain compact even when they contain sparse repetition overrides.

## Regression tests

- Whole-document atomicity: a bad final lane leaves all earlier candidates unapplied. Unknown fields, unsupported schema versions and ambiguous names fail before persistence.
- Create/update/replace/retry matrix, including partial managed scopes, unrelated GUI edits, missing IDs and two distinct definitions with identical notes. Reapply twice and assert unchanged IDs, bytes except explicitly nonsemantic logs, revisions and history.
- Incremental versus declarative construction produces equivalent authored graphs and schedules, allowing only documented identity allocation differences.
- Shared golden pitch vectors and nested authored fixtures cover positive/negative diatonic/chromatic offsets, mixed scales, additive cancellation, explicit zero/inherit and MIDI-range omission.
- Cropped first/last passes, repeated same-pad transforms, base offsets, fixed child indices and ancestor ownership survive JSON/native round trips. Use the existing repetition-grouping fixture as an oracle.
- Melodic chord/HOLD/strum timing, sparse-score collisions and arpeggiator active/bypass behavior retain attacks, durations and release ownership under transformation.
- Composition handoff tests preserve accepted notes/velocities/timing for melodic/drummer/controller/arpeggiator and explicitly selected sparse-score material. Existing v1/v2 loader tests continue to pass.
- Efficiency checks enforce exact definition counts and no pattern growth for transposition, retries or longer loop windows; bounded inspect output does not expand all passes.

## Acceptance criteria — G3

- [A08–A11](../implementation-plan.md#5-cross-task-regression-and-acceptance-matrix), A23's handoff requirements and the note/drum/transposition portion of the efficiency fixture pass.
- One documented song document constructs the intended sections and can be reapplied safely; an invalid document produces an actionable field path and no partial result.
- Repeating motifs and pure pitch variations retain sharing. Agent output states how much was reused or forked.
- Effective pitch/timing agrees with frontend and backend contracts, including fixed reference indices after structural materialization.
- All supported time conversions are exact and no accepted composition is altered merely to fit a device or compress its representation.

## Boundary

This is a new authoring schema, not a replacement native persistence format. Preserve old score interpretation and existing musical algorithms. Broad fuzzy motif detection, automatic reharmonization and a new composition engine are outside scope.
