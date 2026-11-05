# Task 04 — Instrument-bound automation and coordinated updates

Status: implemented. Evidence: [implementation record](../implementation-record.md). Stage: 2 — Song authoring. Depends on: [Task 02](02-authoring-and-migration.md); [Task 03](03-song-specifications-and-transposition.md) for complete song-spec integration. Exit gate: **G4**. Next: [Task 05](05-editing-history-and-audition.md).

## Result

An agent can map discovered performance controllers, generate owned automation, edit long curves and revise mappings while preserving music. Saved ownership and derived MIDI routing remain consistent, including live updates and missing targets.

Use the [automation user contract](../../../documentation/performance/instrument_automation.md), [automation domain](../../../frontend/src/lib/clipArranger/automation.ts), [store actions](../../../frontend/src/store/automationActions.ts), [backend service](../../../backend/app/services/instrument_automation.py) and current session performance-controller API. Keep fixed per-instance values, generic MIDI CC automation and instrument-bound automation distinct in commands and documentation.

## Work

1. Extend controller discovery to return stable rack/controller-node identities, type/range/scale, effective value, mapping, target eligibility and existing owned lanes. Do not assume labels or conventional CC numbers identify a controller. Continuous instances have no eligible per-instance CC channel under the existing contract.
2. Add mapping list/set/reset and owner-aware automation commands. Validate current CC bounds and node identities from source definitions. Bind through `automationTarget`; derive channel and CC from the rack rather than authoring independent, conflicting routing fields.
3. Generate automation from a selected instrument clip or explicit supported owner/window. Resolve receiving instruments and require an unambiguous owner selector when several qualify. Create one lane per distinct assigned CC, reusing existing owned lanes. Controls sharing a CC share ownership of one lane.
4. Generate a zero-offset Once clip and equally long curve using the first mapped controller in patch order and its effective value converted through the existing linear/logarithmic/Boolean rules. Preserve existing same-window automation unchanged. Reject other overlaps and unsupported Step Mode generation atomically; do not reset an existing lane's mode.
5. Implement explicit curve editing with two to ten distinct normalized points including endpoints, independent endpoint values and exact `curveDurationTicks`. Support use-clip-length as an explicit operation. Preserve stored steps, hidden cells and reset behavior when switching lane modes. Stretching curve duration and trimming a clip must remain separate operations.
6. Integrate bound automation into Task 03's song schema and reuse/update contract. Large-scale parameter movement should need one long curve definition, not many short duplicated pads. Retain generic controller support and its distinct lane limits; bound lanes follow the current arranger-wide limit.
7. Implement reconciliation on rack/controller mapping changes. Channel/CC retarget preserves musical content; split copies complete lanes with fresh identities; identical merges combine; different merges return a conflict requiring an explicit surviving lane. Dry run reports affected clips/definitions and any history reset.
8. Retain automation for Off/unmapped/missing owners or removed controls with a suspended status and no MIDI output. Reassignment reconciles preserved music. Deleting the originating note clip/lane must not delete automation. Never silently choose the first conflicting lane or drop an unmapped lane.
9. Coordinate mapping and sequencer changes in the backend's revision-checked transaction, preparing before installation at a render boundary. Do not use the old serial override-map plus sequencer calls to implement mapping edits. Handle configuration generation/controller revisions, rejected preparation and superseded requests without partial installation.
10. Preserve current I-rate behavior: changes affect new notes/phrases, while continuous instance value changes follow restart rules. Report staged versus prepared/pending/applied status accurately. Keep fixed-value commands compatible, and report when an active mapped lane will supply subsequent values.
11. Return ownership, effective route, normalized values/duration, generated/reused/skipped counts and suspension/conflict reasons. Provide usable repair/survivor selectors. Extend validation to authored routing and actual rack agreement, not only the existence of an `automationTarget` field.

## Regression tests

- Generation with melodic, drummer, sparse-score and arpeggiator sources; one or multiple receiving instances; no eligible controllers; same CC shared by multiple controls; repeated generation and occupied overlapping windows.
- Conversion of current float/integer/Boolean and logarithmic controller values to MIDI, using the actual patch definitions rather than ad hoc CLI scaling.
- Two- and ten-point curves, duplicate/missing endpoint rejection, maximum supported duration, cropped/nested/repeated coordinates and independent endpoint values. Mode switching retains both datasets and their separate lengths.
- Owner channel/CC edits, split, identical merge, different merge with explicit survivor/cancel, removed instrument/control, Off and later reassignment. Assert full retained lane music, fresh IDs where copied and no unintended broadcast.
- Beyond sixteen bound lanes within the total arranger ceiling, alongside generic-lane and aggregate-limit rejection. Keep existing resource limits unchanged.
- API tests in `backend/tests/test_api.py` and relevant service tests for stale revisions, failed/superseded preparation and mapping+schedule atomicity. Capture CC output on exact target channels around the update boundary.
- Save/load/native/runtime/MIDI/SCORE round trips retain automation ownership, curves, steps and mappings. Source deletion leaves owned automation intact.
- `apply-song` generation/update/retry remains idempotent; all responses distinguish created, reused, skipped and suspended objects.

## Acceptance criteria — G4

- [A12–A14](../implementation-plan.md#5-cross-task-regression-and-acceptance-matrix) pass, with inherited format, atomicity and output requirements.
- A documented command sequence discovers controls, maps them, creates a song-length curve and changes its ownership mapping without raw JSON edits.
- Routing follows the instrument; missing/unmapped owners remain inspectable and silent.
- Split/merge behavior matches the GUI and never silently discards conflicting automation.
- Failed or stale live updates preserve the previously playing mapping/music and return an actionable result; successful updates apply mapping and schedules together.

## Boundary

No new controller synthesis semantics or generic MIDI broadcast defaults. No automation on unsupported continuous-instance targets. Keep default controller values, fixed performance overrides, mappings and curve events separately represented and explained.
