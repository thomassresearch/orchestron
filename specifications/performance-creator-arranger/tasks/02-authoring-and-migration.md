# Task 02 — Reusable clip authoring and migration

Status: implemented. Evidence: [implementation record](../implementation-record.md). Stage: 1 — Foundation. Depends on: [Task 01](01-contracts-inspection-validation.md). Exit gate: **G2**. Next: [Task 03](03-song-specifications-and-transposition.md) and [Task 04](04-instrument-automation.md).

## Result

An agent can construct a clip song from named, reusable musical definitions, place them on exact timelines, and migrate supported legacy performances without losing music or routing. All operations use Task 01's transaction and response contracts.

Primary semantics: [model](../../../frontend/src/lib/clipArranger/model.ts), [operations](../../../frontend/src/lib/clipArranger/operations.ts), [migration](../../../frontend/src/lib/clipArranger/migration.ts) and [editor adapters](../../../frontend/src/lib/clipArranger/editorAdapter.ts). Preserve the standalone [projection](../../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_arrangement.py).

## Work

1. Add explicit clip-mode new-session creation. Build the current valid empty clip performance and input-device defaults, including the fixed keyboard expected by the new workflow. Keep ordinary legacy creation and loading compatible; do not depend on the frontend rollout flag to read an existing clip performance.
2. Add lane creation/list/get/update/removal with stable IDs and source/device settings. Keep one matching source record per lane. Validate MIDI routing, timing, drum row identities, controller mode and arpeggiator settings. Lane removal reports affected content and follows the app's owned-automation and history rules; no implicit deletion of independent automation.
3. Add pattern definition creation/inspection/update for melodic, drummer, sparse score, generic controller step/curve and arpeggiator payloads. Reuse supported note/chord/HOLD, velocity, timing, ratchet, strum, curve and sparse-note parsers. Adapt targeted timing/strum/ratchet editing to definition/occurrence selectors; retain legacy `--pad` commands for legacy data.
4. Preserve hidden notes/cells, inactive settings, both controller datasets, independent endpoints, arpeggiator presets/seeds, display colors and unused definitions. Do not round-trip projected runtime slots through an eight-pad normalizer. Lane-wide settings remain on the lane/source; musical content remains in definitions.
5. Add named groups/supergroups and explicit rests. Resolve child references to lane-local definitions with globally valid occurrence identities. Reusing a group reuses its children; linked placement must not recursively clone payloads. Validate hierarchy and capacity before expansion.
6. Add clip create/place/get/update/remove, Once/Loop, exact start/length/source offset and explicit repeat-count convenience. Add fit-to-content, explicit song end/fit-to-clips and song-loop settings. Distinguish local beats, master beats, ticks and bars through the frozen Task 01 contract.
7. Implement core shared-definition edits and occurrence-local variation. Preserve musical-save clip windows; fork only the changed definition and necessary shared ancestors. Use the existing loop-pass isolation rules where needed. Return copied IDs, surviving links and affected windows. Extended structural operations follow in Task 05.
8. Preview any collision, resource use, scope impact or song-end change before applying a batch. Atomic rejection must retain the staged candidate for correction only when the command explicitly creates a separate draft; never replace valid authored state with an invalid draft.
9. Add explicit migration preview/apply. Port the current deterministic frontend conversion semantics, retaining lane cycles and every stored pad/group even when unused. Produce a recoverable original in an external user working directory before applying conversion; record its path and identity. Migration of an already converted document is a no-op.
10. Reject unsupported Manual-pad, Live-arpeggiator and multiple-keyboard legacy conversions with specific reasons. Preserve the original as usable legacy data. Explicit conversion of supported legacy repeating lanes to song clips remains a separate operation; do not infer it from ordinary clip edits.
11. Select the appropriate existing feature format (v23 for basic clips and higher versions as features require). Preserve existing newer features on unrelated edits and refuse unknown future formats. Do not downgrade a loaded v26 document through legacy normalization.
12. Integrate the eventual history contract now: preserve unrelated valid history; until Task 05 adds complete replay support, explicitly invalidate conflicting clip history and report the reason rather than persisting a stale basis. Record this temporary limitation; G6 requires the final history behavior.

## Regression tests

- Table-driven authoring across all five source types, including more than eight definitions, duplicate labels with distinct IDs, hidden score notes, custom drum keys, inactive strums/ratchets and both controller datasets.
- Shared pattern/group use in two clips; update shared music, create a local variation, and verify unchanged unrelated identities and payloads.
- Exact interval cases: nonzero offsets, cropped first/last repetition, partial loops, Once tails, leading/trailing rests, polymeter and supported rational beat ratios. Compare resolved frontend/CLI schedules.
- Window versus content versus song-end cases, collision failures and explicit fit operations. Musical resizing must not silently shift independent clips.
- Migration corpus for supported legacy versions/structures and each unsupported transport category. Compare ordered musical events, durations, lane cycles, routing/mixer/controllers, unused definitions and recovery bytes. Repeated migration is idempotent.
- Persistence/API/native round trips for basic clip construction and loaded v24–26 features. Assert the legacy mutation guard still rejects shadow-pad writes and unrelated mixer changes preserve clip data/history.

## Acceptance criteria — G2

- [A05–A07](../implementation-plan.md#5-cross-task-regression-and-acceptance-matrix) pass, together with inherited atomicity/output gates.
- A fresh draft can be built into a valid multi-lane clip performance entirely through supported commands, without hand-editing config JSON or using the GUI to finish it.
- More than eight musical definitions work without adding lanes to obtain pad slots.
- Linked placement creates references, and a local variation changes only the selected musical occurrence.
- Successful migration has exact musical parity and a verified recoverable original; failed migration changes nothing.
- Save/load/runtime projection preserve current features and minimal necessary format versions, with no implicit downgrade.

## Boundary

Do not remove the legacy writer guard, replace existing editors, alter synthesis or expand persistence limits. Keep low-level runtime slots an implementation detail. Structural completeness and interoperable history remain required Task 05 work.
