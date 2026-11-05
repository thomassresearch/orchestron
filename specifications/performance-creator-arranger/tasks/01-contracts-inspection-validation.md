# Task 01 — Contracts, authoritative inspection and validation

Status: implemented. Evidence: [implementation record](../implementation-record.md). Stage: 1 — Foundation. Depends on: none. Exit gate: **G1**. Next: [Task 02](02-authoring-and-migration.md).

## Result

An agent can discover supported capabilities, inspect the actual clip song and obtain trustworthy, structured validation without changing staged or saved music. Public identity, transaction and response contracts are fixed before authoring commands depend on them.

Read the [implementation plan](../implementation-plan.md), [backend contracts](../../../BACKEND.md), [authored clip validator](../../../backend/app/models/clip_validation.py) and current CLI/session code before changing behavior.

## Work

1. Characterize repository and extracted-plugin behavior. Record current versions of CLI, plugin, performance, app state, clip model, runtime schedule, history and native envelope. Reproduce the known overlap-validation false positive, shadow-pad inspection, parser non-JSON error and duplicate `apply-score` behavior as focused regressions or characterization tests.
2. Freeze the proposed command families, strict song/operation schemas, time units, index conventions, stable IDs and occurrence selectors. Keep display names separate from IDs. Define revision/fingerprint checks, no-op behavior, response channels, exit codes and pagination. Mark newly proposed fields distinctly from existing persistence fields.
3. Introduce shared result/error formatting for all new commands and adapt existing commands without dropping their existing `result` fields. Handle argument parsing, missing files, malformed JSON/YAML, domain exceptions and backend errors. Add `stateChanged` on failures and stage-specific validation status. Do not expose an unhandled `ValueError` traceback as an ordinary user correction path.
4. Add capabilities discovery that distinguishes local CLI support from verified server support. Report minimum format/feature requirements and degraded/offline status. A server version alone is insufficient proof of a feature; use explicit capability data or a documented verified compatibility mechanism. Unknown support is reported as unknown, never success.
5. Add authoritative inspection for song, all five lane kinds, definitions, clips, references, unused material and automation ownership. Include definition usage, exact duration, effective pitches/contributions and suspended reasons where applicable. Retain legacy pad inspection only for legacy performances or explicitly labeled compatibility data.
6. Bound tree expansion and impact listings. Resolve a requested time interval, not all loop passes. Return stable selectors, revision, total counts and continuation information. Inspection must not allocate IDs, normalize stored data in place, mark a session dirty or change runtime state.
7. Factor portable local preflight from backend validation. Implement the complete side-effect-free validation API described in the plan, reusing save/import validators and request-size limits. Include instrument/routing resolution without storing a draft or starting audio. Document the distinction between structural/routing success and optional runtime preparation. Register routes safely and run blocking validation/preparation off the audio-serving event loop.
8. Validate unsupported versions, all definitions including unused content, source/lane correspondence, references/hierarchy, strict ticks, overlaps/extents, musical payloads, transposition and automation bindings. Keep existing limits and return a field/object path and conflict details. Backend-authoritative failures must be visible even when local preflight passes.
9. Add shared edit-session transaction infrastructure: candidate copy, expected revision/fingerprint, file-writer coordination, atomic file replacement, dry-run result and no-op detection. Stage failure must leave the previous file intact. Define how later commit commands detect external server changes; add a conditional-write mechanism if required rather than claiming that an unguarded GET followed by PUT is atomic.
10. Add initial command/help documentation and the implementation-record skeleton. Capture validation and response fixtures for later tasks; do not replace the full skill workflow until its authoring commands exist.

## Regression tests

- CLI subprocess tests: valid JSON success, invalid subcommand/flag, missing argument/file, malformed specification, unsupported version and unreachable/rejecting backend. Parse the documented output channel and assert exit code and actionable error fields.
- Structural corpus: same-lane overlaps, beyond-song windows, missing/cross-lane definitions, cycles, duplicate IDs, invalid hidden/unused patterns, excessive references and non-integral resolved time. Assert frontend/backend/local agreement for shared fixtures.
- API tests in `backend/tests/test_api.py`: complete validation succeeds/fails without creating/updating rows, sessions or engine state; oversized/invalid inputs respect existing limits. Include routing failures and separate preparation failures when supported.
- Inspection fixture with different authoritative definitions and legacy shadows; include melodic, drummer, score, controller, arpeggiator and suspended automation lanes. Assert reported music comes from definitions.
- Session tests: rejected mutation, concurrent writers, stale selector, interrupted/failed replacement, dry run and no-op. Check exact stored bytes/revision and absence of partial state.
- Large-loop inspection: fixed page/window size, explicit truncation, stable selector round trip and bounded output independent of virtual repeat count.

## Acceptance criteria — G1

- [A01–A04](../implementation-plan.md#5-cross-task-regression-and-acceptance-matrix) pass for the implemented foundation, including the overlapping-clip regression.
- No command reports complete validation when authored checks or required backend stages were skipped.
- Both successful and failed calls identify what happened and whether state changed; an agent can target a discovered occurrence without reading raw config.
- Full validation is side-effect-free and leaves current playback untouched.
- The portable CLI imports and local inspection work without the backend Python package; online checks use HTTP.
- Frozen contracts and actual test commands/results are recorded for Tasks 02–06.

## Boundary

This task does not enable new authoring by weakening the legacy pad guard. Unknown capabilities, invalid references and unresolved concurrency must produce explicit failures or accurately limited read-only results. No implementation or validation step may silently migrate a saved performance.
