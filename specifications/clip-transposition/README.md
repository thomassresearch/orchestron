# Clip transposition

Status: specified, not implemented. Date: 2026-11-04.

Add nondestructive diatonic and chromatic transposition to melodic, score and arpeggiator content in the clip arranger. Linked definitions share their repetition transpositions. Pattern, group and supergroup placements can add independent offsets without changing the referenced notes.

This package extends the [clip arranger design](../redesign-arranger/README.md) and its [current implementation record](../redesign-arranger/implementation-record.md). It does not enable the clip arranger by default or close its existing release gates.

## Reading order

| Document | Purpose |
| --- | --- |
| [Feature specification](specification.md) | Ownership, repeat indexing, musical rules, authored/runtime formats, editing, playback and compatibility contracts |
| [Implementation plan](implementation-plan.md) | Source seams, ordered work packages, dependencies, verification commands and delivery gates |
| [Acceptance scenarios](acceptance.md) | Concrete musical vectors and shared/local, structural, runtime, persistence and UI acceptance cases |

## Requirements and engineering decisions

The user requirements are:

- Patterns, groups and supergroups within a clip offer transposition.
- Diatonic transposition moves by a signed number of steps in the pattern's configured scale/mode; chromatic transposition moves by semitones.
- Transposition does not rewrite the original pattern notes.
- Each repetition can have its own transposition.
- Clips sharing a pattern in Repeat mode also share its repeat transpositions.
- Pattern offsets within groups, group offsets and supergroup offsets remain independently editable.

The specification supplies these engineering defaults:

- Shared definition profiles, contextual child-reference plans and clip-local placement plans have explicit, distinct ownership.
- Repetitions use source-relative indices; they never depend on how often transport has played a note.
- All applicable diatonic offsets add together; all chromatic offsets add together. Apply the diatonic total first, then the chromatic total, using each leaf pattern's theory.
- Off-scale notes retain their accidental relative to the lower scale tone. Final pitches outside MIDI 0–127 are omitted.
- Transposition-only live edits become audible at the next leaf-pattern occurrence boundary. Seeking or restarting uses the latest saved settings immediately.
- Melodic/score variants are prepared outside the render path; arpeggiators use prepared pitch maps for dynamically generated notes.
- Drum/controller transposition, independent nested repeat clocks and cycling the transposition plan itself are outside this delivery.

These are implementable defaults, not claims that the feature already exists. Implementation may refine internal representation or proposed resource budgets when measurements justify it; changes to audible behavior, sharing or persistence must update these documents and their acceptance cases together. Routine implementation does not require an additional user-approval checkpoint.

## Delivery boundaries

The first delivery includes the complete path from edit to save/reload, audition, live playback, native bundles, standalone CLI conversion and both CSD modes. A UI-only transpose button or destructive note-copy workaround is not completion.

The current baseline writes performance v24/app-state v6 for instrument automation and v23/v5 for other clip arrangements. Clip model versions are 1–2 and the runtime clip schedule is v1. This package proposes performance v25, app-state v7, clip model v3 and runtime schedule v2; confirm that these numbers remain unused at implementation time. Native bundle envelope versions need not change solely for this feature.

No application code, user performances, examples or generated user manual are changed by this specification package. Its source links describe the inspected baseline; its tests and benchmarks are future acceptance work, not completed validation.
