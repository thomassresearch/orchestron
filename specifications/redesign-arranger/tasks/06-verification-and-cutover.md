# Task 06 — Compatibility verification, documentation and cutover

Status: planned. Depends on: Tasks [01](01-baseline-and-contracts.md), [02](02-clip-model-and-migration.md), [03](03-playback-audition-and-exports.md), [04](04-arranger-and-previews.md) and [05](05-editors-save-scope-and-live-inputs.md). Gate: G6.

## Result

A verified, documented performance redesign that can become the default without losing existing performances or musical editing features. Compatibility and recovery behavior must be concrete before removing any obsolete entry point.

## Work

1. Run the complete [acceptance matrix](../implementation-plan.md) against new and migrated fixtures. Include all supported import versions, multiple keyboards, Manual pads, Live arps, unused definitions, hidden notes/steps, independent curve endpoints, routes/Master/mixer and enabled manual controllers.
2. Rehearse New → edit → save → reload → native bundle round trip → CLI round trip → both CSD exports. Validate pending-draft choices, rejected migrations, unknown versions, oversized/reference-invalid data and incompatible history. Compare online/offline events and representative rendered audio.
3. Test transport races and actual browser-clock audio under a dense nested arrangement: preparation failures, rapid edits, seek/loop/end, input activity, collapse, view switches and reconnect. Compare rendering/preparation with Task 01 baseline; confirm expanded visuals do not interrupt refills.
4. Review accessibility and responsive behavior with keyboard-only navigation, text zoom, coarse-pointer targets, screen-reader labels, dialog focus and meaningful non-color states. Check all editor and input-device capabilities against the preservation checklist.
5. Update README capabilities, relevant English performance/manual pages, integrated EN/DE/FR/ES labels/help and new screenshots under `screenshots/`. Preserve the README opening and Built With Codex section. Regenerate the manual PDF through the repository's documentation workflow when manual edits are final.
6. Document migration reports and the supported compatibility route. Test restoring recoverable originals. Verify that UI rollback cannot open a new-format performance for destructive legacy writes; never promise an unimplemented downgrade.
7. Enable the new default only after G1–G5 and this gate pass. Remove obsolete new-workflow workspace/source entry points and dead-only code in a separate reviewable change. Keep musical components, required legacy readers, useful pure helpers and compatibility routes until their consumers are actually gone.

## Verification commands and evidence

Run targeted suites first, then:

```sh
npm --prefix frontend run check
uv run --extra dev pytest backend/tests
make backend-check
git diff --check
```

Run `make benchmark-runtime` and `.venv/bin/python -m backend.tools.benchmark_sequencer_preparation` for the changed scheduling/preparation path. Use the current repository procedures for browser screenshots, manual PDF generation and link checks. Record real audio/export checks separately from component tests and list any unavailable environment checks accurately.

Do not introduce changes to examples or shared build inputs just to make a demonstration. If such scope is separately authorized later, follow the additional frontend/Docker build requirements in AGENTS.md.

## Acceptance

- All supported legacy categories convert without loss or have the agreed functional compatibility handling.
- No production editor capability is lost; all six tasks' evidence is recorded.
- New-format saved state, runtime and exports agree; temporary state remains temporary.
- Actual audio, failure recovery, accessibility, localization and performance checks pass.
- User documentation explains the new interaction and screenshots show the real integrated UI.
- Rollout and recovery work on copied real-format data, not only the prototype.

## Stop and rollback boundary

Do not make the redesign the only path if migration, audio parity, editor preservation or recovery fails. Keep the gate off, fix the specific failure and rerun affected checks. Roll back UI activation independently from format support; retain new-format readers and original backups as necessary. Publication of the design mockup remains outside this work.
