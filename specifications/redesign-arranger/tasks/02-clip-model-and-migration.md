# Task 02 — Clip model, transactions and migration

Status: planned. Depends on: [Task 01](01-baseline-and-contracts.md). Gate: G2. Next: [Task 03](03-playback-audition-and-exports.md); [Task 04](04-arranger-and-previews.md) may begin read-only integration.

## Result

A versioned authored model with stable reusable definitions, independent clip windows, exact resolved time and atomic edits, plus lossless migration and persistence. Keep new-format writes gated until the runtime/export path can consume them.

Authoritative detail: [contracts sections 1–4 and 7–8](../data-and-playback-contracts.md). Primary seams: `frontend/src/types/index.ts`, `appStoreModel.ts`, `padLoopPattern.ts`, `sequencerEdits.ts`, `arrangementRange.ts`, `arrangerHistory.ts`, backend session/persistence models, validators and CLI serializers.

## Work

1. Add stable pattern, group, supergroup, clip and child-occurrence identities. Retain typed musical payloads, lane-wide settings, unused definitions and display colors. Implement a bounded hierarchy validator and exact duration/occurrence resolver; separate resolution from rendering and engine mutation.
2. Implement pure operations for create/adopt, move, trim, offset, Once/Loop, fit, copy, delete-with-gap, explicit time insert/close, grouping/ungrouping and supported multi-lane section operations. Reject same-lane collisions predictably. Preserve fixed clip boundaries when definition lengths change.
3. Implement revisioned draft/change-set primitives and local/global save transactions. A local save copies the changed definition and only the necessary ancestor path. Support two references to the same child in one container. Isolate one generated repeat using before/edited/after windows with exact offsets and unchanged coverage.
4. Integrate atomic arranger history with the existing 25-action/cursor behavior. Keep editor-local undo separate. Treat a repeat split plus local fork as one transaction, including redo identities and dangling-reference cleanup.
5. Migrate legacy pads and hierarchical root sequences deterministically, preserving rests, lane repeat/end settings, routing, sparse notes, hidden steps, both controller modes, presets and manual inputs. Produce conversion diagnostics; route unsupported independent/manual/multiple-keyboard cases to the agreed compatibility path without modifying originals.
6. Add version/capability checks across save/load/autosave, frontend/backend validation, native import/export and CLI. Preserve original data for recovery. Define failure behavior for unknown versions, malformed references, limits and incompatible history. Prevent legacy writers from stripping new fields.

## Validation

Test the pure operations with exact interval and identity assertions, including nested duration changes, partial first/last loops, nonzero offsets, local group/supergroup edits and undo/redo. Test all supported time ratios and native score positions without float drift.

Round-trip more than eight pattern definitions, unused definitions, hidden notes/steps, independent curve endpoints, controller channel targets and arpeggiator seeds. Migrate every fixture twice and verify idempotence. Invalid cycles/references, zero-duration playable containers and resource overflows must fail with useful errors before expensive traversal.

Run relevant frontend store/history/persistence tests and backend model/API/import tests, including additions to `backend/tests/test_api.py` where persistence behavior changes. An authored save must never contain draft/audition/held-note state.

## Acceptance

- Legacy-compatible fixtures resolve to the same ordered musical content and exact timing.
- Clip geometry is independent from all referenced definition durations.
- Save-scope operations affect exactly the intended occurrence/definition; cancel changes nothing authored.
- New-format round trips preserve all authored fields and sharing; invalid data is rejected consistently.
- Compatibility and recoverable originals cover every unresolved legacy case.

## Stop and rollback boundary

Do not enable new-format user saves through old scheduling/export code. A failed migration leaves the original loadable in the compatibility path. UI fallback must reject incompatible new-format writes; restoring an older application is not an automatic data downgrade.
