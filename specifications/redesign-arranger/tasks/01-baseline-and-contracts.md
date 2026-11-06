# Task 01 — Baseline and compatibility contracts

Status (updated 2026-11-05): Contracts, versioned migration-category coverage, editor capability mapping and paired dense GUI/audio measurements are recorded. Broader historical/manual release qualification remains separate. See the [acceptance follow-up](../acceptance-follow-up.md). Depends on: none. Gate: G1. Next: [Task 02](02-clip-model-and-migration.md).

Implementation follow-up: [new regression/browser evidence and remaining gates](../acceptance-follow-up.md).

Evidence and remaining work: [implementation record](../implementation-record.md).

## Result

A reviewed set of behavior contracts, representative fixtures and editor-integration seams that lets the redesign proceed without guessing about musical features or legacy data. This task does not change the default performance UI or saved formats.

Read [intent](../intent-and-scope.md), [UI design](../ui-design.md), [contracts](../data-and-playback-contracts.md), root [AGENTS.md](../../../AGENTS.md), [original arranger contracts](../legacy-arranger-reference.md) and the type-specific editor references before implementation.

## Work

1. Record the actual current serializer/API versions and feature flags. Inventory readers/writers across frontend, backend, CLI, app state, native bundles and both CSD modes. Allocate the new schema/capability strategy before Task 02; do not infer it from old manual version labels.
2. Inventory every existing editor control and field: pattern-local versus lane-wide, authored versus runtime versus editor-only. Cover all five source types, keyboard, manual CCs, presets, copy/clear, hidden data, existing undo and launch controls. Use the [UI preservation table](../ui-design.md) as the minimum checklist.
3. Characterize current behavior with versioned test fixtures and event traces: hierarchy/rests, shared definitions, per-lane repeats, Manual pads, Live arps, multiple keyboards, score note chasing, controller resets, ratchets/strums, mixed meter and rational speed. Retain more than one use of the same definition inside one container.
4. Record decisions for the proposed transport matrix: single foreground audition, same-lane replacement, launch boundaries, Song Play/Stop/seek/end, selection/collapse/navigation and speaker priority. Mark intentional changes from current audition cancellation rather than silently changing tests to match new behavior.
5. Confirm exact clip offset, overlap, fit, repeated-pass isolation and source-continuation rules. Specify group child limits and bounded expansion. Decide which legacy cases convert automatically and which remain in a compatibility path with recoverable originals.
6. Locate small editor adapter seams in `SequencerPage`, `ScoreSequencers`, `ArpeggiatorEditor` and `PerformanceEditorState`. Capture the real editors and input controls as visual baselines. Prefer characterization first; if extracting bodies now, make it a behavior-preserving change with unchanged visual output.
7. Define a development/rollout gate covering read/write/runtime/export capability together. Record baseline rendering/preparation measurements with a representative nested performance so later comparisons are meaningful.

## Validation

Run targeted existing tests for the behaviors being characterized. Add missing regression fixtures in `backend/tests/fixtures/` and appropriate frontend fixtures, never imports from developer `examples/`. Check at least one actual engine trace for each source type where simulation would miss note ownership or boundary scheduling.

Compare the current keyboard/controller flow with `BrowserPlaybackPolicy`: explicit Auto/Live/Listening, inactivity, external input, sustain and gestures must remain. Do not adopt the mockup's “enabled means permanently Live” simplification.

## Acceptance

- Every current musical editor feature has a planned preservation route; no replacement toy editor is proposed.
- New model ownership and version/capability decisions are recorded with source references.
- Proposed transport/clip rules are explicitly accepted or amended in the contracts, with tests identified.
- Each supported legacy category has an automatic-conversion or compatibility treatment; no silent data loss is accepted.
- Existing baseline tests still pass; extracted components, if any, look and behave the same.

## Stop and rollback boundary

Do not start irreversible format conversion or switch the default UI while migration/transport choices remain implicit. Keep legacy behavior unchanged behind the gate. An unresolved case can block its conversion without blocking pure model work on already-defined cases.
